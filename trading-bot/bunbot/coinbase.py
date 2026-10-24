"""Keyless Coinbase Exchange REST data. No trading/private endpoints or fallback."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import threading
import urllib.error
import urllib.parse
import urllib.request

from .core import Blocked, Candle, Quote, positive
from .market import NoRedirect, timestamp

PRODUCTS = {'BTC/USD': 'BTC-USD', 'ETH/USD': 'ETH-USD'}
BASE = 'https://api.exchange.coinbase.com'


def price(value):
    if isinstance(value, bool):
        raise Blocked('Boolean is not a price')
    return positive(value)


class CoinbaseMarket:
    provider = 'coinbase'
    quote_cache_seconds = 10
    candle_settlement_seconds = 10

    def __init__(self, now, opener=None):
        self.now = now
        self.opener = opener if opener is not None else urllib.request.build_opener(NoRedirect)
        self.lock = threading.RLock()
        self.cache = {}
        self.retry_at = 0
        self.failures = 0
        self.requests = 0
        self.last_request = None
        self.status = 'not connected'
        self.last_quote_times = {}

    def product(self, symbol):
        if symbol not in PRODUCTS:
            raise Blocked('Coinbase bot supports only BTC/USD and ETH/USD')
        return PRODUCTS[symbol]

    def diagnostics(self):
        with self.lock:
            return {'provider': self.provider, 'transport': 'public REST snapshots',
                    'status': self.status, 'requests': self.requests, 'retry_at': self.retry_at,
                    'last_request': self.last_request, 'automatic_fallback': False}

    def retry_after(self, value):
        try:
            seconds = float(value)
            if math.isfinite(seconds):
                return max(0, seconds)
        except (ValueError, TypeError):
            try:
                dt = parsedate_to_datetime(value)
                if dt.tzinfo is not None:
                    return max(0, dt.timestamp()-self.now())
            except (ValueError, TypeError, OverflowError):
                pass
        return 60

    def request(self, path, params):
        # Caller holds lock for fetch + validation + cache insertion. Concurrent
        # identical requests see the completed cache rather than issuing duplicates.
        if self.now() < self.retry_at:
            raise Blocked('Coinbase cooldown active; trading blocked')
        url = BASE+path+('?' + urllib.parse.urlencode(params) if params else '')
        req = urllib.request.Request(url, headers={'Accept':'application/json',
                                                   'User-Agent':'BunMoney-PaperBot/1.0'})
        self.requests += 1
        self.last_request = self.now()
        try:
            with self.opener.open(req, timeout=8) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise Blocked('Coinbase response too large')
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            delay = self.retry_after((exc.headers or {}).get('Retry-After')) if exc.code == 429 else 0
            self.failed(delay)
            raise Blocked('Coinbase rate limited' if exc.code == 429 else 'Coinbase HTTP request failed') from None
        except Exception:
            self.failed()
            raise Blocked('Coinbase disconnected or invalid response') from None

    def failed(self, delay=0):
        self.failures += 1
        self.retry_at = self.now()+max(delay, min(300, 5*2**min(self.failures-1,6)))
        self.status = 'unavailable'
        self.cache.clear()  # No stale cached fills after a provider failure.

    def validated(self):
        self.status = 'connected'
        self.failures = 0
        self.retry_at = 0

    def quote(self, symbol):
        product = self.product(symbol)
        with self.lock:
            key = ('quote', symbol)
            cached = self.cache.get(key)
            if self.now() < self.retry_at:
                raise Blocked('Coinbase cooldown active; trading blocked')
            if cached and 0 <= self.now()-cached[0] < self.quote_cache_seconds:
                q = cached[1]
                if 0 <= self.now()-q.timestamp <= 90:
                    return q
            data = self.request(f'/products/{product}/ticker', {})
            try:
                if not isinstance(data, dict):
                    raise Blocked('Invalid Coinbase ticker')
                # Endpoint binds the product; reject conflicting metadata if supplied.
                if data.get('product_id', product) != product:
                    raise Blocked('Coinbase ticker symbol mismatch')
                raw_time = data.get('time')
                if not isinstance(raw_time, str) or datetime.fromisoformat(raw_time.replace('Z','+00:00')).tzinfo is None:
                    raise Blocked('Coinbase ticker requires explicit UTC offset')
                at = timestamp(raw_time)
                if not math.isfinite(at) or not 0 <= self.now()-at <= 90 or at < self.last_quote_times.get(symbol,0):
                    raise Blocked('Stale, future or regressed Coinbase ticker')
                q = Quote(symbol, price(data.get('price')), at)
            except (ValueError, TypeError, KeyError, OverflowError):
                self.failed()
                raise Blocked('Coinbase ticker validation failed') from None
            self.validated()
            self.last_quote_times[symbol] = at
            self.cache[key] = (self.now(), q)
            return q

    def candles(self, symbol):
        product = self.product(symbol)
        with self.lock:
            # Give the newest close ten seconds to settle, then fetch once per
            # completed window. Never build history from ticker snapshots.
            end = int((self.now()-self.candle_settlement_seconds)//300)*300
            start = end-40*300
            key = ('candles', symbol)
            if self.now() < self.retry_at:
                raise Blocked('Coinbase cooldown active; trading blocked')
            cached = self.cache.get(key)
            if cached and cached[0] == end:
                return list(cached[1])
            iso = lambda t: datetime.fromtimestamp(t,timezone.utc).isoformat().replace('+00:00','Z')
            data = self.request(f'/products/{product}/candles',
                                {'granularity':300, 'start':iso(start), 'end':iso(end)})
            try:
                if not isinstance(data,list) or not data or len(data)>300:
                    raise Blocked('Missing Coinbase candles')
                rows = {}
                for row in data:
                    if not isinstance(row,list) or len(row)!=6:
                        raise Blocked('Invalid Coinbase candle shape')
                    # Coinbase format: [time, low, high, open, close, volume].
                    at = float(row[0])
                    if not math.isfinite(at) or at % 300 or at < 0 or at > self.now():
                        raise Blocked('Invalid Coinbase candle timestamp/interval')
                    low,high,opening,close = (price(n) for n in row[1:5])
                    if isinstance(row[5], bool):
                        raise Blocked('Invalid Coinbase volume')
                    volume = float(row[5])
                    if not math.isfinite(volume) or volume<0 or not low<=min(opening,close)<=max(opening,close)<=high:
                        raise Blocked('Invalid Coinbase candle OHLCV')
                    # The API may include rows before start or the in-progress bar.
                    # Validate their shape, but only use this completed requested window.
                    if not start <= at < end:
                        continue
                    if at in rows:
                        raise Blocked('Duplicate Coinbase candle')
                    rows[at] = Candle(at,opening,high,low,close)
                candles = sorted(rows.values(),key=lambda c:c.timestamp)
                if len(candles)<21 or candles[-1].timestamp != end-300:
                    raise Blocked('Missing latest completed Coinbase candle')
                if any(b.timestamp-a.timestamp != 300 for a,b in zip(candles,candles[1:])):
                    raise Blocked('Missing Coinbase candle; no synthetic gap filling')
                if self.now()-(candles[-1].timestamp+300)>360:
                    raise Blocked('Stale Coinbase history')
            except (ValueError, TypeError, KeyError, OverflowError):
                self.failed()
                raise Blocked('Coinbase candle validation failed') from None
            self.validated()
            self.cache[key] = (end,tuple(candles))
            return list(candles)
