import copy
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from dataclasses import replace

from bunbot.core import Blocked, Candle, Engine, Quote, Settings, signal
from bunbot.market import BunMoneyMarket, timestamp
from bunbot.service import handler
from bunbot.backtest import run


class Market:
    def __init__(self, clock):
        self.clock=clock;self.price=100;self.age=0;self.failure=False;self.bad_series=False;self.trend=True
    def quote(self,symbol):
        if self.failure:raise OSError('Disconnected')
        return Quote(symbol,self.price,self.clock[0]-self.age)
    def candles(self,symbol):
        if self.bad_series and symbol=='ETH/USD':raise OSError('Series disconnected')
        return [Candle(self.clock[0]-300*(21-i),p,p,p,p) for i,p in enumerate([100]*20+[110 if self.trend else 100])]


class BotTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=self.tmp.name+'/paper.sqlite3'
        self.clock=[1800000000.0];self.market=Market(self.clock)
        self.e=Engine(self.path,self.market,lambda:self.clock[0])
    def tearDown(self):
        self.e.db.close();self.tmp.cleanup()
    def start(self,mode='automatic'):
        self.e.controls('mode',mode);self.e.controls('start');self.e.cycle()
    def state(self):return self.e.snapshot()
    def pending(self):return next(p for p in self.state()['proposals'].values() if p['status']=='pending')

    def test_strategy_crossovers_and_warmup(self):
        self.assertEqual(signal(self.market.candles('BTC/USD')),'buy')
        bars=self.market.candles('BTC/USD');bars[-1]=replace(bars[-1],close=90)
        self.assertEqual(signal(bars),'sell')
        self.assertIsNone(signal(bars[:20]))
        self.market.trend=False;self.assertIsNone(signal(self.market.candles('BTC/USD')))

    def test_manual_never_enters(self):
        self.start('manual');s=self.state()
        self.assertFalse(s['orders']);self.assertTrue(s['proposals']);self.assertEqual(s['cash'],1000)

    def test_paper_entry_costs_risk_and_no_leverage(self):
        self.start();s=self.state();p=s['position']
        self.assertLessEqual(p['planned_risk'],5.000001)
        self.assertGreaterEqual(s['cash'],0)
        self.assertEqual(len(s['orders']),1)
        self.assertGreater(p['entry'],100)
        self.assertGreater(p['entry_fee'],0)
        self.assertLess(s['equity'],1000)

    def test_approval_executes_only_once(self):
        self.start('approval');p=self.pending();self.assertFalse(self.state()['orders'])
        self.e.controls('approve',p['id']);self.assertTrue(self.state()['position'])
        with self.assertRaises(Blocked):self.e.controls('approve',p['id'])
        self.assertEqual(len(self.state()['orders']),1)

    def test_expiration_boundary(self):
        self.start('approval');p=self.pending();self.clock[0]=p['expires']
        with self.assertRaises(Blocked):self.e.controls('approve',p['id'])
        self.assertEqual(self.state()['proposals'][p['id']]['status'],'expired')
        self.assertFalse(self.state()['orders'])

    def test_rejected_never_executes(self):
        self.start('approval');p=self.pending();self.e.controls('reject',p['id'])
        self.e.controls('mode','automatic');self.e.cycle()
        self.assertFalse(self.state()['orders'])
        with self.assertRaises(Blocked):self.e.controls('approve',p['id'])

    def test_duplicate_signal_after_close_never_reenters(self):
        self.start();self.market.price=104;self.e.cycle();s=self.state()
        self.assertEqual(len(s['trades']),1);self.assertFalse(s['position'])
        for _ in range(3):self.e.cycle()
        self.assertEqual(len(self.state()['orders']),2)

    def test_take_profit_and_fees(self):
        self.start();self.market.price=104;self.e.cycle();t=self.state()['trades'][0]
        self.assertEqual(t['reason'],'take_profit');self.assertGreater(t['pnl'],0)
        self.assertAlmostEqual(self.state()['cash'],1000+t['pnl'])
        self.assertGreater(t['fees'],0)

    def test_gap_stop_can_exceed_planned_risk(self):
        self.start();planned=self.state()['position']['planned_risk']
        self.market.price=90;self.e.cycle();t=self.state()['trades'][0]
        self.assertEqual(t['reason'],'stop_loss');self.assertGreater(-t['pnl'],planned)
        self.assertLess(t['exit'],90)

    def test_restart_recovery_persists_ledger_and_pauses(self):
        self.start();before=self.state();self.e.db.close()
        self.e=Engine(self.path,self.market,lambda:self.clock[0])
        s=self.state();self.assertEqual(s['status'],'paused');self.assertEqual(s['position'],before['position'])
        self.assertIsNone(s['equity'])
        self.e.controls('start');self.e.cycle();self.assertEqual(len(self.state()['orders']),1)

    def test_restart_cancels_pending(self):
        self.start('approval');p=self.pending();self.e.db.close()
        self.e=Engine(self.path,self.market,lambda:self.clock[0])
        self.assertEqual(self.state()['proposals'][p['id']]['status'],'cancelled')

    def test_stale_quote_and_disconnect_pause(self):
        for attr,value in [('age',91),('failure',True),('price',float('nan')),('price',0)]:
            with self.subTest(attr=attr,value=value):
                self.market.age=0;self.market.failure=False;self.market.price=100
                setattr(self.market,attr,value)
                self.e.controls('start');self.e.cycle()
                self.assertEqual(self.state()['status'],'paused');self.assertFalse(self.state()['orders'])

    def test_stale_and_incomplete_candles(self):
        bars=self.market.candles('BTC/USD')
        with self.assertRaises(Blocked):self.e.validate_candles([replace(c,timestamp=c.timestamp-900) for c in bars])
        bars[-1]=replace(bars[-1],timestamp=self.clock[0])
        with self.assertRaises(Blocked):self.e.validate_candles(bars)

    def test_all_series_verified_before_entry(self):
        self.market.bad_series=True;self.start()
        self.assertFalse(self.state()['orders']);self.assertEqual(self.state()['status'],'paused')

    def test_stale_approval_blocked_terminal(self):
        self.start('approval');p=self.pending();self.market.age=91
        self.e.controls('approve',p['id'])
        self.assertEqual(self.state()['proposals'][p['id']]['status'],'blocked')
        self.assertFalse(self.state()['orders'])

    def test_price_drift_approval_blocked(self):
        self.start('approval');p=self.pending();self.market.price=101
        self.e.controls('approve',p['id']);self.assertFalse(self.state()['orders'])

    def test_daily_loss_shutdown_sticky_and_rollover(self):
        self.start();self.market.price=90;self.e.cycle();self.assertTrue(self.state()['day_shutdown'])
        self.clock[0]+=300;self.market.price=100;self.e.controls('start');self.e.cycle()
        self.assertFalse(self.state()['position'])
        self.clock[0]+=86400;self.e.cycle();self.assertFalse(self.state()['day_shutdown'])
        self.assertTrue(self.state()['position'])

    def test_daily_three_entry_limit(self):
        self.start()
        for i in range(3):
            self.market.price=104;self.e.cycle()
            self.clock[0]+=300;self.market.price=100;self.e.cycle()
        self.assertEqual(self.state()['day_entries'],3)
        self.assertEqual(len(self.state()['trades']),3)
        self.assertFalse(self.state()['position'])

    def test_emergency_cannot_be_bypassed_by_start_or_mode(self):
        self.start('approval');p=self.pending();self.e.controls('emergency')
        self.e.controls('mode','automatic')
        with self.assertRaises(Blocked):self.e.controls('start')
        with self.assertRaises(Blocked):self.e.controls('approve',p['id'])
        self.e.cycle();self.assertFalse(self.state()['orders'])
        self.e.controls('reset-emergency');self.assertEqual(self.state()['status'],'paused')

    def test_emergency_freezes_exits_and_persists(self):
        self.start();self.e.controls('emergency');self.market.price=90;self.e.cycle()
        self.assertTrue(self.state()['position']);self.e.db.close()
        self.e=Engine(self.path,self.market,lambda:self.clock[0]);self.assertTrue(self.state()['emergency'])

    def test_mode_switch_cancels_proposals_and_keeps_limits(self):
        self.start('approval');p=self.pending();self.e.controls('mode','automatic');self.e.cycle()
        self.assertFalse(self.state()['orders'])
        self.assertEqual(self.state()['proposals'][p['id']]['status'],'cancelled')
        with self.assertRaises(Blocked):self.e.controls('mode','live')
        self.clock[0]+=300;self.e.cycle();self.assertTrue(self.state()['position'])
        self.e.controls('mode','manual');self.market.price=90;self.e.cycle()
        self.assertEqual(self.state()['trades'][0]['reason'],'stop_loss')

    def test_pause_preserves_protective_exits(self):
        self.start();self.e.controls('pause');self.market.price=90;self.e.cycle()
        self.assertFalse(self.state()['position']);self.assertEqual(self.state()['status'],'paused')

    def test_corrupt_account_fails_closed(self):
        with self.e.transaction() as s:s['cash']=900
        with self.assertRaises(Blocked):self.e.cycle()
        with self.assertRaises(Blocked):self.e.controls('start')

    def test_concurrent_approvals_one_fill(self):
        self.start('approval');p=self.pending();errors=[]
        def approve():
            try:self.e.controls('approve',p['id'])
            except Blocked as exc:errors.append(exc)
        threads=[threading.Thread(target=approve) for _ in range(4)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(len(self.state()['orders']),1);self.assertEqual(len(errors),3)

    def test_event_audit_records_created_and_filled(self):
        self.start();kinds=[r[0] for r in self.e.db.execute('SELECT kind FROM events')]
        for kind in ('signal','proposal_created','order_created','order_filled','control'):self.assertIn(kind,kinds)

    def set_bearish(self):
        original=self.market.candles
        def candles(symbol):
            bars=original(symbol)
            bars[-1]=replace(bars[-1],open=90,high=90,low=90,close=90)
            return bars
        self.market.candles=candles

    def test_discretionary_sales_follow_modes(self):
        self.start();self.e.controls('mode','manual');self.set_bearish();self.e.cycle()
        self.assertTrue(self.state()['position'])
        sales=[p for p in self.state()['proposals'].values() if p.get('side')=='sell']
        self.assertEqual(sales[-1]['status'],'manual')
        self.e.controls('mode','approval');self.clock[0]+=300;self.e.cycle()
        sale=self.pending();self.assertEqual(sale['side'],'sell')
        self.assertTrue(self.state()['position']);self.e.controls('approve',sale['id'])
        self.assertFalse(self.state()['position'])
        self.assertEqual(self.state()['trades'][0]['reason'],'sma_sell')

    def test_expired_sale_proposal_never_executes(self):
        self.start();self.e.controls('mode','approval');self.set_bearish();self.e.cycle()
        sale=self.pending();self.clock[0]=sale['expires']
        with self.assertRaises(Blocked):self.e.controls('approve',sale['id'])
        self.assertTrue(self.state()['position']);self.assertEqual(len(self.state()['orders']),1)

    def test_corrupted_inventory_fails_closed(self):
        self.start()
        with self.e.transaction() as s:s['position']['qty']*=2
        with self.assertRaises(Blocked):self.e.cycle()

    def test_quote_is_revalidated_at_fill(self):
        self.start('approval');p=self.pending()
        with self.e.transaction() as s:
            with self.assertRaises(Blocked):
                self.e.enter(s,p,Quote(p['symbol'],100,self.clock[0]-91))
        self.assertFalse(self.state()['orders'])

    def test_transaction_rollback_does_not_leave_partial_fill(self):
        self.start('approval');p=self.pending()
        with self.assertRaises(RuntimeError):
            with self.e.transaction() as s:
                self.e.enter(s,p,self.market.quote(p['symbol']))
                raise RuntimeError('simulated process failure before commit')
        self.assertFalse(self.state()['orders']);self.assertEqual(self.state()['cash'],1000)
        self.e.controls('approve',p['id']);self.assertEqual(len(self.state()['orders']),1)

    def test_morning_report_includes_previous_utc_day(self):
        self.start();self.market.price=104;self.e.cycle()
        self.clock[0]+=3600
        self.assertEqual(self.state()['report']['trades'],1)
        self.clock[0]+=86400
        self.assertEqual(self.state()['report']['trades'],0)

    def test_http_handler_auth_without_sockets(self):
        from email.message import Message
        from io import BytesIO
        from types import SimpleNamespace
        cls=handler(self.e,'s'*32)
        def request(method,body=None,authorized=False):
            obj=cls.__new__(cls);obj.headers=Message()
            obj.headers['Content-Type']='application/json'
            if authorized:obj.headers['Authorization']='Bearer '+'s'*32
            raw=json.dumps(body).encode() if body else b''
            obj.headers['Content-Length']=str(len(raw))
            obj.rfile=BytesIO(raw);obj.connection=SimpleNamespace(settimeout=lambda _:None)
            obj.path='/control' if method=='POST' else '/state'
            replies=[];obj.reply=lambda status,data:replies.append((status,data))
            (obj.do_POST if method=='POST' else obj.do_GET)()
            return replies[0]
        self.assertEqual(request('GET')[0],401)
        self.assertEqual(request('POST',{'action':'start'})[0],401)
        self.assertEqual(request('POST',{'action':'start'},True)[0],200)
        self.assertEqual(request('POST',{'action':'mode','value':'live'},True)[0],400)
        self.assertEqual(request('GET',authorized=True)[0],200)

    def test_service_authentication_and_health(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.e,'x'*32))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            def request(method,path,body=None,token=None):
                c=HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                headers={'Content-Type':'application/json'}
                if token:headers['Authorization']='Bearer '+token
                c.request(method,path,json.dumps(body) if body else None,headers);r=c.getresponse();raw=r.read();c.close();return r.status,json.loads(raw)
            self.assertEqual(request('GET','/state')[0],401)
            self.assertEqual(request('POST','/control',{'action':'start'})[0],401)
            self.assertEqual(request('GET','/state',token='x'*32)[0],200)
            self.assertEqual(request('POST','/control',{'action':'mode','value':'live'},'x'*32)[0],400)
            self.assertEqual(request('POST','/control',{'action':'start'},'x'*32)[0],200)
            self.e.cycle();self.assertEqual(request('GET','/health')[0],200)
        finally:server.shutdown();server.server_close();thread.join()

    def test_backtest_next_open_costs_and_no_lookahead(self):
        bars=[Candle(1800000000+i*300,p,p,p,p) for i,p in enumerate([100]*20+[110,112,113,114,90,90])]
        result=run(bars)
        first=result['trades'][0]
        self.assertAlmostEqual(first['entry'],112*1.0005)
        self.assertGreater(result['fees'],0)
        changed=list(bars);changed[-1]=replace(changed[-1],open=95,high=95,low=95,close=95)
        self.assertEqual(run(changed)['trades'][0]['entry'],first['entry'])
        self.assertIsNone(result['last_error'])

    def test_backtest_ambiguous_bar_stop_first(self):
        bars=[Candle(1800000000+i*300,p,p,p,p) for i,p in enumerate([100]*20+[110,100,100])]
        bars[21]=replace(bars[21],high=110,low=90)
        result=run(bars);self.assertEqual(result['trades'][0]['reason'],'backtest_stop')
        self.assertLess(result['trades'][0]['pnl'],0)


class AdapterTests(unittest.TestCase):
    def test_existing_routes_and_provider_timestamps(self):
        adapter=BunMoneyMarket('http://127.0.0.1:3000','secret',lambda:1800000000)
        calls=[]
        def request(path,**params):
            calls.append((path,params))
            if path=='/api/quote':return {'symbol':'BTC/USD','close':'100','timestamp':1799999999}
            return {'meta':{'symbol':'BTC/USD','interval':'5min','exchange_timezone':'UTC'},'values':[{'datetime':'2027-01-15 07:55:00','open':'100','high':'101','low':'99','close':'100'}]}
        adapter.request=request
        self.assertEqual(adapter.quote('BTC/USD').price,100)
        adapter.candles('BTC/USD');self.assertEqual(calls[1][0],'/api/time-series')
        self.assertEqual(timestamp('2026-10-23T00:00:00Z'),timestamp('2026-10-23 00:00:00'))
        adapter.request=lambda *_a,**_k:{'symbol':'BTC/USD','close':'100'}
        with self.assertRaises(Blocked):adapter.quote('BTC/USD')
    def test_remote_plain_http_rejected(self):
        with self.assertRaises(ValueError):BunMoneyMarket('http://example.com','token',lambda:0)

if __name__=='__main__':unittest.main()
