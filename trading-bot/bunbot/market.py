"""Adapter for the existing BunMoney /api/quote and /api/time-series routes."""
from datetime import datetime, timezone
import json
import urllib.parse
import urllib.request
from .core import Blocked, Candle, Quote, positive


def timestamp(value):
    if isinstance(value, (int,float)) or isinstance(value,str) and value.isdigit():
        return float(value)
    if not isinstance(value,str):
        raise Blocked('Provider timestamp missing')
    dt = datetime.fromisoformat(value.replace('Z','+00:00'))
    # Twelve Data crypto series uses UTC; do not guess other time zones.
    return dt.replace(tzinfo=timezone.utc).timestamp() if dt.tzinfo is None else dt.timestamp()


class BunMoneyMarket:
    provider = "twelve_data"
    def __init__(self, base_url, token, now):
        parsed = urllib.parse.urlparse(base_url)
        if parsed.scheme not in ('http','https') or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Invalid market engine URL')
        if parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1','localhost','::1'):
            raise ValueError('Remote market engines require HTTPS')
        self.base, self.token, self.now = base_url.rstrip('/'), token, now
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, path, **params):
        req = urllib.request.Request(self.base+path+'?'+urllib.parse.urlencode(params),
                                     headers={'Authorization':'Bearer '+self.token})
        with self.opener.open(req, timeout=8) as response:
            raw = response.read(2_000_001)
            if len(raw)>2_000_000:
                raise Blocked('Market response too large')
            data = json.loads(raw)
        if not isinstance(data,dict) or data.get('status') == 'error' or data.get('error'):
            raise Blocked('Market engine rejected request')
        return data

    def quote(self, symbol):
        d = self.request('/api/quote', symbol=symbol)
        if d.get('symbol') != symbol:
            raise Blocked('Unexpected quote symbol')
        return Quote(symbol, positive(d.get('price',d.get('close'))), timestamp(d.get('timestamp')))

    def candles(self, symbol):
        d = self.request('/api/time-series', symbol=symbol, interval='5min', outputsize=40)
        meta = d.get('meta',{})
        if meta.get('symbol') != symbol or meta.get('interval') != '5min' or meta.get('exchange_timezone') not in ('UTC','Etc/UTC'):
            raise Blocked('Unexpected candle metadata or timezone')
        rows = [Candle(timestamp(c['datetime']), *(positive(c[k]) for k in ('open','high','low','close'))) for c in d['values']]
        return sorted((c for c in rows if c.timestamp+300 <= self.now()), key=lambda c:c.timestamp)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Blocked('Market redirect refused')


def create_market(environ, now):
    """Provider selection is explicit, startup-only and never an automatic fallback."""
    provider = environ.get('BOT_DATA_PROVIDER', 'coinbase')
    if provider == 'coinbase':
        from .coinbase import CoinbaseMarket
        return CoinbaseMarket(now)
    if provider == 'twelve_data':
        return BunMoneyMarket(environ.get('MARKET_ENGINE_URL','http://127.0.0.1:3000'),
                              environ.get('MARKET_ENGINE_TOKEN',''), now)
    raise ValueError('BOT_DATA_PROVIDER must be coinbase or twelve_data; no fallback enabled')
