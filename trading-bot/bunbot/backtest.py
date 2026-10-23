"""Chronological OHLC backtest: signal at close, execution at next open."""
import argparse
import csv
import json
import tempfile
from .core import Blocked, Candle, Engine, Quote, SYMBOLS
from .market import timestamp


def run(candles, symbol='BTC/USD'):
    if symbol not in SYMBOLS or len(candles)<22:
        raise Blocked('Supported symbol and at least 22 candles required')
    for i,c in enumerate(candles):
        if i and c.timestamp-candles[i-1].timestamp != 300:
            raise Blocked('Backtest requires chronological continuous five-minute candles')
        if not 0 < c.low <= min(c.open,c.close) <= max(c.open,c.close) <= c.high:
            raise Blocked('Invalid OHLC')
    clock=[candles[21].timestamp]
    class HistoricalMarket:
        index=21
        def quote(self, market_symbol):
            return Quote(market_symbol,candles[self.index].open,clock[0])
        def candles(self, market_symbol):
            rows=candles[max(0,self.index-40):self.index]
            # Other market has no crossover; only the selected instrument trades.
            return rows if market_symbol==symbol else [Candle(c.timestamp,100,100,100,100) for c in rows]
    market=HistoricalMarket()
    with tempfile.TemporaryDirectory() as directory:
        e=Engine(directory+'/backtest.sqlite3',market,lambda:clock[0])
        e.controls('mode','automatic');e.controls('start')
        for i in range(21,len(candles)):
            market.index=i;bar=candles[i];clock[0]=bar.timestamp
            e.cycle()  # Only earlier candles visible. Entries use this bar's open.
            with e.transaction() as s:
                p=s['position']
                if p:
                    # If both barriers occur in a bar, assume stop first. Gaps fill worse.
                    price= min(bar.open,p['stop']) if bar.low<=p['stop'] else p['target'] if bar.high>=p['target'] else None
                    if price is not None:
                        e.exit(s,Quote(symbol,price,clock[0]),'backtest_stop' if bar.low<=p['stop'] else 'backtest_target')
                    s['marks'][symbol]={'symbol':symbol,'price':bar.close,'timestamp':clock[0]}
                    e.daily(s,e.equity(s))
        with e.transaction() as s:
            if s['position']:
                e.exit(s,Quote(symbol,candles[-1].close,clock[0]),'backtest_end')
        result=e.snapshot()
        e.db.close()
        return {'assumptions':'next-open fills; 10bps fee and adverse 5bps slippage each side; stop first on ambiguous bars; final position liquidated',
                'balance':result['cash'],'pnl':result['realized'],'trades':result['trades'],
                'fees':sum(o['fee'] for o in result['orders'].values()),'last_error':result['last_error']}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('csv');p.add_argument('--symbol',choices=SYMBOLS,default=SYMBOLS[0]);args=p.parse_args()
    with open(args.csv,newline='') as f:
        rows=[Candle(timestamp(r['timestamp']),*(float(r[k]) for k in ('open','high','low','close'))) for r in csv.DictReader(f)]
    print(json.dumps(run(rows,args.symbol),indent=2,allow_nan=False))

if __name__=='__main__':main()
