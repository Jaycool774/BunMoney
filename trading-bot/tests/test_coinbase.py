from datetime import datetime, timezone
from email.message import Message
from email.utils import format_datetime
from io import BytesIO
import json
import math
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

from bunbot.coinbase import BASE, CoinbaseMarket
from bunbot.core import Blocked, Engine
from bunbot.market import BunMoneyMarket, create_market


class PublicOpener:
    def __init__(self, clock):
        self.clock=clock;self.calls=[];self.failure=None;self.ticker=None;self.rows=None
    def open(self,req,timeout):
        self.calls.append(req)
        if self.failure:raise self.failure
        if '/ticker' in req.full_url:
            payload=self.ticker if self.ticker is not None else {'price':'100','time':datetime.fromtimestamp(self.clock[0]-1,timezone.utc).isoformat()}
        else:
            end=int((self.clock[0]-10)//300)*300
            payload=self.rows if self.rows is not None else [[end-(i+1)*300,99,101,100,100,2] for i in range(40)]
        return BytesIO(json.dumps(payload).encode())


class CoinbaseTests(unittest.TestCase):
    def setUp(self):
        self.clock=[1800000015.0]
        self.opener=PublicOpener(self.clock)
        self.m=CoinbaseMarket(lambda:self.clock[0],self.opener)
    def ticker(self,price='100',age=1,**extra):
        return {'price':price,'time':datetime.fromtimestamp(self.clock[0]-age,timezone.utc).isoformat(),**extra}
    def rows(self):
        end=int((self.clock[0]-10)//300)*300
        return [[end-(i+1)*300,99,101,100,100,2] for i in range(40)]

    def test_default_never_constructs_twelve_data(self):
        with patch('bunbot.market.BunMoneyMarket',side_effect=AssertionError('Billable provider forbidden')):
            market=create_market({'TWELVE_DATA_API_KEY':'configured-but-not-used'},lambda:0)
            self.assertIsInstance(market,CoinbaseMarket)
        with self.assertRaises(ValueError):create_market({'BOT_DATA_PROVIDER':'typo'},lambda:0)
        legacy=create_market({'BOT_DATA_PROVIDER':'twelve_data','MARKET_ENGINE_TOKEN':'private'},lambda:0)
        self.assertIsInstance(legacy,BunMoneyMarket)

    def test_quote_is_endpoint_bound_keyless_and_timestamped(self):
        for symbol,product in [('BTC/USD','BTC-USD'),('ETH/USD','ETH-USD')]:
            q=self.m.quote(symbol);self.assertEqual(q.symbol,symbol);self.assertEqual(q.price,100)
            self.assertEqual(q.timestamp,self.clock[0]-1)
            req=self.opener.calls[-1]
            self.assertEqual(req.full_url,BASE+'/products/'+product+'/ticker')
            self.assertFalse(req.has_header('Authorization'));self.assertNotIn('apikey',req.full_url)

    def test_unsupported_symbols_never_request(self):
        for symbol in ['BTC-USD','btc/usd','AAPL','ETH/EUR','SOL/USD','../BTC/USD']:
            with self.assertRaises(Blocked):self.m.quote(symbol)
            with self.assertRaises(Blocked):self.m.candles(symbol)
        self.assertFalse(self.opener.calls)

    def test_quote_ten_second_cache_and_expiry(self):
        self.m.quote('BTC/USD');self.clock[0]+=9
        self.m.quote('BTC/USD');self.assertEqual(len(self.opener.calls),1)
        self.clock[0]+=1;self.m.quote('BTC/USD');self.assertEqual(len(self.opener.calls),2)
        self.m.quote('ETH/USD');self.assertEqual(len(self.opener.calls),3)

    def test_cached_quote_still_checks_freshness(self):
        self.opener.ticker=self.ticker(age=89)
        self.m.quote('BTC/USD');self.clock[0]+=2
        with self.assertRaises(Blocked):self.m.quote('BTC/USD')
        self.assertEqual(len(self.opener.calls),2)

    def test_invalid_prices_symbols_and_times_fail_closed(self):
        invalid=[{},[],self.ticker(price=None),self.ticker(price='nan'),self.ticker(price=0),self.ticker(price=-1),self.ticker(price=True),
                 self.ticker(age=91),self.ticker(age=-1),self.ticker(product_id='ETH-USD'),
                 {'price':'100','time':self.clock[0]}, {'price':'100','time':'2027-01-15 08:00:00'}]
        for payload in invalid:
            with self.subTest(payload=payload):
                m=CoinbaseMarket(lambda:self.clock[0],self.opener);self.opener.ticker=payload
                with self.assertRaises(Blocked):m.quote('BTC/USD')
                self.assertEqual(m.diagnostics()['status'],'unavailable')

    def test_timestamp_regression_is_rejected(self):
        self.m.quote('BTC/USD');self.clock[0]+=11
        self.opener.ticker=self.ticker(age=20)
        with self.assertRaises(Blocked):self.m.quote('BTC/USD')

    def test_candle_mapping_interval_and_window(self):
        bars=self.m.candles('ETH/USD');self.assertEqual(len(bars),40)
        self.assertTrue(all(c.timestamp%300==0 and c.open==100 and c.low==99 and c.high==101 for c in bars))
        url=urllib.parse.urlparse(self.opener.calls[0].full_url);params=urllib.parse.parse_qs(url.query)
        self.assertEqual(url.path,'/products/ETH-USD/candles');self.assertEqual(params['granularity'],['300'])
        self.assertEqual(bars[-1].timestamp+300,int((self.clock[0]-10)//300)*300)
        self.assertNotIn('apikey',params)

    def test_candle_cache_rolls_after_settlement_delay(self):
        self.m.candles('BTC/USD');self.clock[0]=1800000309
        self.m.candles('BTC/USD');self.assertEqual(len(self.opener.calls),1)
        self.clock[0]=1800000310;self.m.candles('BTC/USD');self.assertEqual(len(self.opener.calls),2)
        self.m.candles('BTC/USD');self.assertEqual(len(self.opener.calls),2)

    def test_candle_cache_returns_independent_list(self):
        bars=self.m.candles('BTC/USD');bars.clear()
        self.assertEqual(len(self.m.candles('BTC/USD')),40);self.assertEqual(len(self.opener.calls),1)

    def test_unordered_rows_sorted_and_incomplete_filtered(self):
        rows=self.rows();end=rows[0][0]+300
        self.opener.rows=[rows[10],*rows[:10],*rows[11:],[end,99,101,100,100,1]]
        bars=self.m.candles('BTC/USD');self.assertEqual(len(bars),40)
        self.assertEqual(bars[-1].timestamp,end-300)
        self.assertTrue(all(a.timestamp<b.timestamp for a,b in zip(bars,bars[1:])))

    def test_invalid_candles_missing_gaps_and_duplicates(self):
        cases=[[],{},self.rows()[:20],self.rows()[1:],self.rows()[:10]+self.rows()[11:],self.rows()+[self.rows()[0]]]
        for column,value in [(0,self.clock[0]+300),(0,1800000001),(0,'nan'),(1,0),(2,90),(3,'nan'),(5,-1),(5,'inf'),(5,True)]:
            rows=self.rows();rows[0][column]=value;cases.append(rows)
        cases.append(self.rows()+[[1,2]])
        for rows in cases:
            with self.subTest(rows=rows[:1] if isinstance(rows,list) else rows):
                m=CoinbaseMarket(lambda:self.clock[0],self.opener);self.opener.rows=rows
                with self.assertRaises(Blocked):m.candles('BTC/USD')

    def test_stale_candles_never_enter_cache(self):
        self.opener.rows=[[r[0]-900,*r[1:]] for r in self.rows()]
        with self.assertRaises(Blocked):self.m.candles('BTC/USD')
        self.assertFalse(self.m.cache)

    def test_rate_limit_honors_retry_after_and_blocks_all_requests(self):
        headers=Message();headers['Retry-After']='120'
        self.opener.failure=urllib.error.HTTPError(BASE,429,'rate limit',headers,None)
        with self.assertRaises(Blocked):self.m.quote('BTC/USD')
        self.opener.failure=None
        for method in [self.m.quote,self.m.candles]:
            with self.assertRaises(Blocked):method('ETH/USD')
        self.assertEqual(len(self.opener.calls),1)
        self.clock[0]+=120;self.m.quote('BTC/USD')
        self.assertEqual(len(self.opener.calls),2);self.assertEqual(self.m.status,'connected')

    def test_retry_after_http_date_and_malformed_value(self):
        future=datetime.fromtimestamp(self.clock[0]+100,timezone.utc)
        self.assertEqual(self.m.retry_after(format_datetime(future)),100)
        for value in [None,'bad','nan','inf']:
            self.assertEqual(self.m.retry_after(value),60)

    def test_disconnection_clears_cache_and_retries_without_fallback(self):
        self.m.quote('BTC/USD');self.clock[0]+=11;self.opener.failure=OSError('disconnect')
        with self.assertRaises(Blocked):self.m.quote('BTC/USD')
        self.assertFalse(self.m.cache)
        with patch.object(BunMoneyMarket,'request',side_effect=AssertionError('No fallback')):
            self.opener.failure=None
            with self.assertRaises(Blocked):self.m.quote('ETH/USD')
            self.clock[0]+=5;self.m.quote('ETH/USD')
        self.assertTrue(all(r.full_url.startswith(BASE+'/products/') for r in self.opener.calls))

    def test_exponential_backoff_is_bounded(self):
        self.opener.failure=TimeoutError('timeout')
        delays=[]
        for _ in range(10):
            with self.assertRaises(Blocked):self.m.quote('BTC/USD')
            delays.append(self.m.retry_at-self.clock[0]);self.clock[0]=self.m.retry_at
        self.assertEqual(delays[:3],[5,10,20]);self.assertEqual(delays[-1],300)

    def test_concurrent_duplicate_requests_coalesce(self):
        errors=[]
        def fetch():
            try:self.m.quote('BTC/USD');self.m.candles('BTC/USD')
            except Exception as exc:errors.append(exc)
        threads=[threading.Thread(target=fetch) for _ in range(12)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertFalse(errors);self.assertEqual(len(self.opener.calls),2)

    def test_request_frequency_for_one_hour(self):
        # Startup plus 119 cycles, fixed 30-second clock, both instruments.
        for _ in range(120):
            for symbol in ('BTC/USD','ETH/USD'):self.m.quote(symbol);self.m.candles(symbol)
            self.clock[0]+=30
        tickers=sum('/ticker' in r.full_url for r in self.opener.calls)
        candles=sum('/candles' in r.full_url for r in self.opener.calls)
        self.assertEqual(tickers,240);self.assertEqual(candles,24)

    def test_provider_restart_cancels_pending_without_resetting_ledger(self):
        with tempfile.TemporaryDirectory() as folder:
            clock=lambda:self.clock[0]
            # Use an existing pending proposal and persisted risk state to check
            # a provider restart does not reset or bypass them.
            e=Engine(folder+'/paper.db',self.m,clock)
            with e.transaction() as s:
                s['proposals']['proposal']={'status':'pending','expires':self.clock[0]+120}
                s['day_entries']=3;s['day_shutdown']=True
            e.db.close()
            legacy=BunMoneyMarket('http://127.0.0.1:3000','private',clock)
            e=Engine(folder+'/paper.db',legacy,clock)
            s=e.snapshot();e.db.close()
            self.assertEqual(s['data_provider'],'twelve_data');self.assertEqual(s['status'],'paused')
            self.assertEqual(s['proposals']['proposal']['status'],'cancelled')
            self.assertEqual(s['day_entries'],3);self.assertTrue(s['day_shutdown']);self.assertEqual(s['cash'],1000)

    def test_dashboard_snapshot_makes_no_provider_requests(self):
        with tempfile.TemporaryDirectory() as folder:
            e=Engine(folder+'/paper.db',self.m,lambda:self.clock[0])
            for _ in range(5):self.assertEqual(e.snapshot()['data_provider'],'coinbase')
            self.assertFalse(self.opener.calls);e.db.close()

    def test_running_engine_does_not_use_legacy_market_routes(self):
        with tempfile.TemporaryDirectory() as folder:
            e=Engine(folder+'/paper.db',self.m,lambda:self.clock[0])
            e.controls('mode','automatic');e.controls('start')
            with patch.object(BunMoneyMarket,'request',side_effect=AssertionError('Billable route called')):
                e.cycle();e.cycle();s=e.snapshot()
            self.assertEqual(s['status'],'running');self.assertIsNone(s['last_error'])
            self.assertEqual(len(self.opener.calls),4);e.db.close()

    def test_malformed_json_and_response_limit_fail_closed(self):
        class BadOpener:
            def __init__(self,body):self.body=body
            def open(self,*_args,**_kwargs):return BytesIO(self.body)
        for payload in [b'not json',b'x'*2_000_001]:
            m=CoinbaseMarket(lambda:self.clock[0],BadOpener(payload))
            with self.assertRaises(Blocked):m.quote('BTC/USD')
            self.assertEqual(m.status,'unavailable');self.assertFalse(m.cache)

    def test_engine_pauses_on_coinbase_outage(self):
        with tempfile.TemporaryDirectory() as folder:
            e=Engine(folder+'/paper.db',self.m,lambda:self.clock[0]);e.controls('start')
            self.opener.failure=OSError('disconnected');e.cycle()
            s=e.snapshot();e.db.close()
            self.assertEqual(s['status'],'paused');self.assertFalse(s['orders'])
            self.assertEqual(s['cash'],1000);self.assertEqual(s['data_provider'],'coinbase')


if __name__=='__main__':unittest.main()
