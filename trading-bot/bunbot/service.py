"""Loopback authenticated service and independent polling worker (stdlib only)."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
import signal
import threading
import time
from .core import Blocked, Engine
from .market import BunMoneyMarket

log = logging.getLogger('bunbot')


def handler(engine, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log request headers, tokens or control bodies.

        def reply(self, status, data):
            raw = json.dumps(data,allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Length',str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization','').encode(), ('Bearer '+token).encode())

        def do_GET(self):
            if self.path == '/health':
                try:
                    state = engine.snapshot()
                    fresh = state['last_cycle'] is not None and 0 <= engine.now()-state['last_cycle'] < 90
                    return self.reply(200 if fresh and not state['last_error'] else 503,
                                      {'service':'BunMoney paper bot','ready':fresh and not bool(state['last_error'])})
                except Exception:
                    return self.reply(503,{'ready':False})
            if not self.authorized():
                return self.reply(401,{'error':'Authentication required'})
            if self.path != '/state':
                return self.reply(404,{'error':'Unknown route'})
            try:
                self.reply(200,engine.snapshot())
            except Exception:
                self.reply(503,{'error':'Paper account unavailable'})

        def do_POST(self):
            if not self.authorized():
                return self.reply(401,{'error':'Authentication required'})
            if self.path != '/control':
                return self.reply(404,{'error':'Unknown route'})
            try:
                if self.headers.get_content_type() != 'application/json':
                    raise Blocked('JSON required')
                size = int(self.headers.get('Content-Length','0'))
                if not 0 < size <= 4096:
                    raise Blocked('Invalid body size')
                self.connection.settimeout(5)
                body = json.loads(self.rfile.read(size))
                if not isinstance(body,dict) or set(body)-{'action','value'} or not isinstance(body.get('action'),str):
                    raise Blocked('Invalid control')
                if body.get('value') is not None and not isinstance(body['value'],str):
                    raise Blocked('Invalid value')
                engine.controls(body['action'],body.get('value'))
                self.reply(200,engine.snapshot())
            except (ValueError,Blocked):
                self.reply(400,{'error':'Control rejected; refresh account state'})
            except Exception:
                self.reply(503,{'error':'Paper service unavailable'})
    return Handler


def main():
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    token = os.environ.get('BOT_SERVICE_TOKEN','')
    market_token = os.environ.get('MARKET_ENGINE_TOKEN','')
    if len(token)<32 or len(market_token)<32:
        raise SystemExit('Set independent BOT_SERVICE_TOKEN and MARKET_ENGINE_TOKEN (32+ characters)')
    if hmac.compare_digest(token,market_token):
        raise SystemExit('Use independent service and market tokens')
    stop = threading.Event()
    market = BunMoneyMarket(os.environ.get('MARKET_ENGINE_URL','http://127.0.0.1:3000'),market_token,time.time)
    engine = Engine(os.environ.get('BOT_DB','paper.sqlite3'),market,time.time)
    def worker():
        while not stop.is_set():
            try:
                engine.cycle()
                s=engine.snapshot()
                log.info('cycle status=%s mode=%s error=%s',s['status'],s['mode'],bool(s['last_error']))
            except Exception:
                log.error('Cycle failed; ledger unavailable; no new orders')
            stop.wait(30)
    server=ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('BOT_PORT','8765'))),handler(engine,token))
    server.daemon_threads=True
    def shutdown(*_args):
        stop.set()
        threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,shutdown)
    signal.signal(signal.SIGINT,shutdown)
    thread=threading.Thread(target=worker,daemon=True)
    thread.start()
    log.info('Paper-only service listening on loopback; not configured for live trading')
    try:
        server.serve_forever()
    finally:
        stop.set()
        thread.join(timeout=40)
        server.server_close()

if __name__ == '__main__':
    main()
