"""Paper-only, transactional trading engine. No live broker implementation exists."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import math
import sqlite3
import threading
from typing import Protocol

SYMBOLS = ('BTC/USD', 'ETH/USD')
MODES = ('manual', 'approval', 'automatic')


class Blocked(ValueError):
    pass


def positive(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise Blocked('Missing or invalid price') from None
    if not math.isfinite(number) or number <= 0:
        raise Blocked('Missing or invalid price')
    return number


@dataclass(frozen=True)
class Quote:
    symbol: str
    price: float
    timestamp: float


@dataclass(frozen=True)
class Candle:
    timestamp: float  # UTC opening time, five-minute candles
    open: float
    high: float
    low: float
    close: float


class MarketData(Protocol):
    def quote(self, symbol: str) -> Quote: ...
    def candles(self, symbol: str) -> list[Candle]: ...


class FutureBroker(Protocol):
    """Extension contract only. Never injected into the v1 paper engine."""
    def account_snapshot(self) -> dict: ...
    def submit(self, client_order_id: str, order: dict) -> dict: ...
    def reconcile(self, client_order_id: str) -> dict: ...
    # Broker balances/withdrawal information must be read-only capabilities.


@dataclass(frozen=True)
class Settings:
    starting_balance: float = 1000.0
    risk_fraction: float = 0.005
    daily_loss_fraction: float = 0.02
    daily_trades: int = 3
    max_positions: int = 1
    fee_fraction: float = 0.001  # 10 bps each side
    slippage_fraction: float = 0.0005  # adverse 5 bps each side
    stop_fraction: float = 0.01
    reward_multiple: float = 2.0
    proposal_ttl: int = 120
    quote_max_age: int = 90


def signal(candles: list[Candle]) -> str | None:
    if len(candles) < 21:
        return None
    prices = [positive(c.close) for c in candles[-21:]]
    previous = sum(prices[-11:-1]) / 10 - sum(prices[-21:-1]) / 20
    current = sum(prices[-10:]) / 10 - sum(prices[-20:]) / 20
    if previous <= 0 < current:
        return 'buy'
    if previous >= 0 > current:
        return 'sell'
    return None


class Engine:
    def __init__(self, path, market: MarketData, now, settings=Settings()):
        self.market, self.now, self.settings = market, now, settings
        self.lock = threading.RLock()
        self.halt_requested = threading.Event()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=10)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at REAL NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL)')
        with self.transaction() as s:
            if not s:
                s.update(cash=settings.starting_balance, status='stopped', mode='manual', emergency=False,
                         position=None, orders={}, proposals={}, signals={}, trades=[], marks={},
                         day='', day_equity=settings.starting_balance, day_entries=0, day_shutdown=False,
                         last_error=None, last_cycle=None)
            else:
                s['status'] = 'paused'
                s['marks'] = {}
                self.cancel(s, 'restart')
                self.event('recovery', {'message': 'Recovered paper ledger; explicit start required'})
            self.verify(s)
            if s['emergency']:
                self.halt_requested.set()

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                row = self.db.execute('SELECT data FROM state WHERE id=1').fetchone()
                s = json.loads(row[0]) if row else {}
                yield s
                self.db.execute('INSERT OR REPLACE INTO state VALUES (1,?)', (json.dumps(s, allow_nan=False),))
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK')
                raise

    def event(self, kind, data):
        self.db.execute('INSERT INTO events(at,kind,data) VALUES (?,?,?)',
                        (self.now(), kind, json.dumps(data, allow_nan=False)))

    def verify(self, s):
        if not math.isfinite(s['cash']) or s['cash'] < -1e-7:
            raise Blocked('Paper account cannot be verified')
        p = s['position']
        if p:
            if p['symbol'] not in SYMBOLS or not 0 < p['stop'] < p['entry'] < p['target']:
                raise Blocked('Paper position cannot be verified')
            positive(p['qty'])
            if p['id'] not in s['orders'] or s['orders'][p['id']]['status'] != 'filled':
                raise Blocked('Paper order ledger cannot be verified')
        # Reconcile cash and inventory against every immutable fill.
        expected = self.settings.starting_balance
        unmatched = []
        for key, o in s['orders'].items():
            if o['id'] != key or o['status'] != 'filled' or o['side'] not in ('buy','sell'):
                raise Blocked('Paper order state cannot be reconciled')
            for field in ('qty','price','notional','fee'):
                positive(o[field])
            if abs(o['qty']*o['price']-o['notional']) > 1e-6:
                raise Blocked('Paper fill notional mismatch')
            if abs(o['fee']-o['notional']*self.settings.fee_fraction) > 1e-6:
                raise Blocked('Paper fill fee mismatch')
            expected += (-o['notional'] if o['side'] == 'buy' else o['notional']) - o['fee']
            if o['side'] == 'buy':
                exit_order = s['orders'].get(key+':exit')
                if not exit_order:
                    unmatched.append(key)
                elif exit_order['side'] != 'sell' or abs(exit_order['qty']-o['qty']) > 1e-9:
                    raise Blocked('Paper exit inventory mismatch')
            elif key.removesuffix(':exit') not in s['orders'] or not key.endswith(':exit'):
                raise Blocked('Paper exit has no entry')
        if abs(expected - s['cash']) > 1e-6:
            raise Blocked('Paper cash ledger cannot be reconciled')
        if unmatched != ([p['id']] if p else []):
            raise Blocked('Paper inventory cannot be reconciled')
        if p:
            entry = s['orders'][p['id']]
            if any(abs(p[a]-entry[b]) > 1e-9 for a,b in [('qty','qty'),('entry','price'),('entry_fee','fee')]):
                raise Blocked('Paper position differs from entry fill')

    def checked_quote(self, symbol):
        q = self.market.quote(symbol)
        return self.validate_quote(q, symbol)

    def validate_quote(self, q, symbol):
        if q.symbol != symbol or not math.isfinite(q.timestamp) or not 0 <= self.now() - q.timestamp <= self.settings.quote_max_age:
            raise Blocked('Stale or future market quote')
        positive(q.price)
        return q

    def equity(self, s, quote=None):
        p = s['position']
        if not p:
            return s['cash']
        price = quote.price if quote and quote.symbol == p['symbol'] else s['marks'].get(p['symbol'], {}).get('price')
        if price is None:
            raise Blocked('Open position valuation unavailable')
        # Liquidation equity includes estimated adverse slippage and exit fees.
        return s['cash'] + p['qty'] * price * (1-self.settings.slippage_fraction) * (1-self.settings.fee_fraction)

    def daily(self, s, equity):
        day = datetime.fromtimestamp(self.now(), timezone.utc).date().isoformat()
        if day != s['day']:
            s.update(day=day, day_equity=equity, day_entries=0, day_shutdown=False)
        usage = max(0, s['day_equity'] - equity)
        if usage >= s['day_equity'] * self.settings.daily_loss_fraction:
            s['day_shutdown'] = True
            self.cancel(s, 'daily loss shutdown')
        return usage

    def cancel(self, s, reason):
        for p in s['proposals'].values():
            if p['status'] == 'pending':
                p.update(status='cancelled', reason=reason)
                self.event('proposal_cancelled', p)

    def expire(self, s):
        for p in s['proposals'].values():
            if p['status'] == 'pending' and self.now() >= p['expires']:
                p['status'] = 'expired'
                self.event('proposal_expired', p)

    def controls(self, action, value=None):
        if action == 'emergency':
            self.halt_requested.set()
        with self.transaction() as s:
            self.verify(s)
            self.expire(s)
            if action == 'mode':
                if value not in MODES:
                    raise Blocked('Unknown mode')
                self.cancel(s, 'mode changed')
                s['mode'] = value
            elif action in ('start', 'pause', 'stop'):
                if action == 'start' and s['emergency']:
                    raise Blocked('Reset emergency stop explicitly before starting')
                s['status'] = {'start':'running', 'pause':'paused', 'stop':'stopped'}[action]
                self.cancel(s, action)
            elif action == 'emergency':
                s.update(emergency=True, status='stopped')
                self.cancel(s, 'emergency stop')
            elif action == 'reset-emergency':
                s.update(emergency=False, status='paused')
                self.halt_requested.clear()
            elif action in ('approve', 'reject'):
                p = s['proposals'].get(value)
                if not p or p['status'] != 'pending':
                    raise Blocked('Proposal is not pending')
                if action == 'reject':
                    p['status'] = 'rejected'
                elif s['mode'] != 'approval':
                    raise Blocked('Approval mode required')
                else:
                    # Failure is recorded and terminal; retrying cannot turn it into an order.
                    try:
                        q = self.checked_quote(p['symbol'])
                        self.execute_proposal(s, p, q)
                        p['status'] = 'executed'
                    except Exception as exc:
                        p.update(status='blocked', reason=str(exc))
                        s['last_error'] = str(exc)
                self.event('proposal_decision', p)
            else:
                raise Blocked('Unknown control')
            self.event('control', {'action': action, 'value': value})

    def plan(self, s, symbol, key, price):
        cfg = self.settings
        entry = price * (1+cfg.slippage_fraction)
        stop = price * (1-cfg.stop_fraction)
        target = entry + cfg.reward_multiple * (entry-stop)
        loss_per_unit = entry*(1+cfg.fee_fraction) - stop*(1-cfg.slippage_fraction)*(1-cfg.fee_fraction)
        equity = self.equity(s)
        remaining = s['day_equity']*cfg.daily_loss_fraction - max(0,s['day_equity']-equity)
        budget = min(equity * cfg.risk_fraction, remaining)
        positive(budget)
        qty = min(budget/loss_per_unit, s['cash']/(entry*(1+cfg.fee_fraction)))
        return dict(id=key, side='buy', symbol=symbol, entry=entry, stop=stop, target=target, qty=qty,
                    planned_risk=qty*loss_per_unit, risk_reward=(target*(1-cfg.slippage_fraction)*(1-cfg.fee_fraction)-entry*(1+cfg.fee_fraction))/loss_per_unit,
                    created=self.now(), expires=self.now()+cfg.proposal_ttl, status='pending')

    def execute_proposal(self, s, proposal, quote):
        if proposal.get('side') != 'sell':
            return self.enter(s, proposal, quote)
        self.verify(s)
        self.validate_quote(quote, proposal['symbol'])
        position = s['position']
        if (s['status'] != 'running' or s['mode'] == 'manual' or s['emergency']
                or self.halt_requested.is_set() or self.now() >= proposal['expires']
                or not position or position['id'] != proposal['position_id']):
            raise Blocked('Sale proposal is no longer eligible')
        if abs(quote.price/proposal['entry']-1) > 0.002:
            raise Blocked('Price moved outside approved sale')
        self.exit(s, quote, 'sma_sell')
        self.daily(s, self.equity(s))

    def enter(self, s, p, q):
        self.verify(s)
        self.validate_quote(q, p['symbol'])
        cfg = self.settings
        equity = self.equity(s)
        self.daily(s, equity)
        if self.halt_requested.is_set() or s['emergency'] or s['status'] != 'running' or s['mode'] == 'manual':
            raise Blocked('Entries disabled')
        if s['day_shutdown'] or s['day_entries'] >= cfg.daily_trades or s['position']:
            raise Blocked('Risk limit reached')
        if p['id'] in s['orders'] or self.now() >= p['expires']:
            raise Blocked('Duplicate or expired order')
        # Approvals authorize a bounded plan; never chase a changed market.
        entry = q.price*(1+cfg.slippage_fraction)
        if abs(entry/p['entry']-1) > 0.002 or not p['stop'] < entry < p['target']:
            raise Blocked('Price moved outside approved plan')
        loss = entry*(1+cfg.fee_fraction)-p['stop']*(1-cfg.slippage_fraction)*(1-cfg.fee_fraction)
        remaining = s['day_equity']*cfg.daily_loss_fraction-max(0,s['day_equity']-equity)
        qty = min(p['qty'], min(equity*cfg.risk_fraction,remaining)/loss, s['cash']/(entry*(1+cfg.fee_fraction)))
        positive(qty)
        notional, fee = qty*entry, qty*entry*cfg.fee_fraction
        order = dict(id=p['id'], side='buy', status='created', at=self.now())
        s['orders'][p['id']] = order
        self.event('order_created', order)
        order.update(status='filled', notional=notional, fee=fee, price=entry, qty=qty)
        s['cash'] -= notional+fee
        s['position'] = dict(p, entry=entry, qty=qty, entry_fee=fee, opened=self.now(), planned_risk=qty*loss)
        s['marks'][q.symbol] = asdict(q)
        s['day_entries'] += 1
        self.event('order_filled', order)
        self.verify(s)

    def exit(self, s, q, reason):
        p, cfg = s['position'], self.settings
        self.validate_quote(q, p['symbol'])
        if self.halt_requested.is_set() or s['emergency']:
            raise Blocked('Emergency stop active')
        key = p['id']+':exit'
        if key in s['orders']:
            raise Blocked('Duplicate exit')
        price = q.price*(1-cfg.slippage_fraction)
        notional = p['qty']*price
        fee = notional*cfg.fee_fraction
        pnl = notional-fee-p['qty']*p['entry']-p['entry_fee']
        order = dict(id=key, side='sell', status='created', at=self.now())
        self.event('order_created', order)
        order.update(status='filled', notional=notional, fee=fee, price=price, qty=p['qty'])
        s['orders'][key] = order
        s['cash'] += notional-fee
        trade = dict(p, exit=price, closed=self.now(), pnl=pnl, fees=fee+p['entry_fee'], reason=reason)
        s['trades'].append(trade)
        s['position'] = None
        self.event('order_filled', order)
        self.event('trade_closed', trade)
        self.verify(s)

    def cycle(self):
        # Market reads and ledger mutations share one lock, including controls.
        with self.transaction() as s:
            self.verify(s)
            self.expire(s)
            try:
                if s['emergency']:
                    return
                quotes = {symbol:self.checked_quote(symbol) for symbol in SYMBOLS}
                s['marks'] = {symbol:asdict(q) for symbol,q in quotes.items()}
                self.daily(s, self.equity(s))
                p = s['position']
                if p:
                    q = quotes[p['symbol']]
                    reason = 'stop_loss' if q.price <= p['stop'] else 'take_profit' if q.price >= p['target'] else 'daily_loss' if s['day_shutdown'] else None
                    if reason:
                        self.exit(s, q, reason)
                        self.daily(s, self.equity(s))
                if s['status'] != 'running':
                    s['last_cycle'] = self.now()
                    s['last_error'] = None
                    return
                histories = {symbol: self.market.candles(symbol) for symbol in SYMBOLS}
                for candles in histories.values():
                    self.validate_candles(candles)
                for symbol in SYMBOLS:
                    candles = histories[symbol]
                    side = signal(candles)
                    if not side:
                        continue
                    key = f'{symbol}:{candles[-1].timestamp}:{side}'
                    if key in s['signals']:
                        continue
                    s['signals'][key] = dict(side=side, at=self.now(), symbol=symbol)
                    self.event('signal', dict(id=key, **s['signals'][key]))
                    if side == 'sell':
                        position = s['position']
                        if not position or position['symbol'] != symbol:
                            continue
                        proposal = dict(id=key, side='sell', symbol=symbol, position_id=position['id'],
                                        entry=quotes[symbol].price, stop=position['stop'], target=position['target'],
                                        qty=position['qty'], planned_risk=0, risk_reward=None,
                                        created=self.now(), expires=self.now()+self.settings.proposal_ttl, status='pending')
                    else:
                        if s['position'] or s['day_shutdown'] or s['day_entries'] >= self.settings.daily_trades:
                            continue
                        proposal = self.plan(s, symbol, key, quotes[symbol].price)
                    if s['mode'] == 'manual':
                        proposal['status'] = 'manual'
                    s['proposals'][key] = proposal
                    self.event('proposal_created', proposal)
                    if s['mode'] == 'automatic':
                        self.execute_proposal(s, proposal, quotes[symbol])
                        proposal['status'] = 'executed'
                s.update(last_cycle=self.now(), last_error=None)
            except Exception as exc:
                # A recoverable feed outage blocks entries until an explicit start.
                s.update(status='paused', last_error=f'{type(exc).__name__}: {exc}')
                self.cancel(s, 'service error')
                self.event('error', {'message': s['last_error']})

    def validate_candles(self, candles):
        if len(candles) < 21:
            raise Blocked('At least 21 completed candles required')
        for i,c in enumerate(candles):
            for n in (c.open,c.high,c.low,c.close): positive(n)
            if not c.low <= min(c.open,c.close) <= max(c.open,c.close) <= c.high:
                raise Blocked('Invalid OHLC candle')
            if not math.isfinite(c.timestamp) or c.timestamp+300 > self.now():
                raise Blocked('Incomplete or future candle')
            if i and c.timestamp-candles[i-1].timestamp != 300:
                raise Blocked('Unordered, duplicate or missing candles')
        if self.now()-(candles[-1].timestamp+300) > 360:
            raise Blocked('Stale market candles')

    def snapshot(self):
        with self.transaction() as s:
            self.verify(s)
            self.expire(s)
            result = json.loads(json.dumps(s))
            try:
                p = s['position']
                mark = s['marks'].get(p['symbol']) if p else None
                if p and (not mark or not 0 <= self.now()-mark['timestamp'] <= self.settings.quote_max_age):
                    raise Blocked('Valuation stale')
                equity = self.equity(s)
                unrealized = equity - s['cash'] - (p['qty']*p['entry']+p['entry_fee'] if p else 0)
            except Blocked:
                equity = unrealized = None
            realized = sum(t['pnl'] for t in s['trades'])
            since = self.now()-86400
            day_trades = [t for t in s['trades'] if since <= t['closed'] <= self.now()]
            errors = self.db.execute("SELECT at,data FROM events WHERE kind='error' AND at>=? ORDER BY id DESC LIMIT 20", (since,)).fetchall()
            result.update(equity=equity, unrealized=unrealized, realized=realized, risk=asdict(self.settings),
                          daily_loss_usage=max(0,s['day_equity']-equity) if equity is not None else None,
                          report=dict(period='last 24 hours (UTC)', generated=self.now(), trades=len(day_trades), wins=sum(t['pnl']>0 for t in day_trades),
                                      losses=sum(t['pnl']<0 for t in day_trades), fees=sum(o['fee'] for o in s['orders'].values() if since <= o['at'] <= self.now()),
                                      balance=s['cash'], equity=equity, errors=[{'at':a,**json.loads(d)} for a,d in errors]))
            return result
