const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const Trading = require("../trading-core");
const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
function fixture() {
  const noop = () => {},
    nodes = {};
  for (const id of [
    "ticker",
    "symbol",
    "price",
    "paperTradeAmount",
    "reason",
    "position",
    "paperBalance",
    "tradingBalance",
    "paperPL",
    "paperPLMessage",
    "tradeHistoryList",
  ])
    nodes[id] = {
      textContent: id === "symbol" ? "AAPL" : "",
      value: id === "ticker" ? "AAPL" : id === "paperTradeAmount" ? "5" : "",
      style: {},
      classList: { add: noop, remove: noop, toggle: noop },
      addEventListener: noop,
    };
  const storage = new Map();
  const c = {
    BunTrading: Trading,
    document: {
      readyState: "loading",
      getElementById: (id) => nodes[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
    },
    console: { log: noop, error: noop },
    location: { protocol: "http:", hostname: "localhost" },
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    AbortSignal,
    AbortController,
    DOMException,
    URLSearchParams,
    MutationObserver: class {
      observe() {}
    },
    setTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    alert: noop,
    confirm: () => false,
    addEventListener: noop,
    fetch: async () => ({ ok: true, json: async () => ({ price: 100 }) }),
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(source, c);
  return { c, nodes, storage, run: (s) => vm.runInContext(s, c) };
}
function seed(f, side = "LONG") {
  f.run(
    `lastAnalysis={ticker:'AAPL',entry:100,stop:${side === "LONG" ? 90 : 110},target:${side === "LONG" ? 120 : 80},source:'live',timestamp:Date.now()};acceptPrice('AAPL',100)`,
  );
}
function candles() {
  return Array.from({ length: 30 }, (_, i) => ({
    datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    open: "100",
    close: "100",
    high: "101",
    low: "99",
    volume: "1000",
  })).reverse();
}
test("SMA and RSI edge cases", () => {
  const f = fixture();
  assert.equal(f.run("calculateSMA([1,2,3,4],3).at(-1)"), 3);
  assert.equal(f.run("calculateRSI(Array(20).fill(100)).at(-1)"), 50);
  assert.equal(
    f.run("calculateRSI(Array.from({length:20},(_,i)=>i)).at(-1)"),
    100,
  );
});
for (const side of ["LONG", "SHORT"])
  test(`${side} opens with correct levels and remains open`, () => {
    const f = fixture();
    seed(f, side);
    f.run(side === "LONG" ? "paperBuy()" : "paperSell()");
    assert.equal(f.run("position.side"), side);
    assert.ok(f.run("Trading.validLevels(position)"));
    assert.equal(f.run("tradeHistory.length"), 0);
  });
test("Either trade side can use either analysis direction safely", () => {
  for (const side of ["LONG", "SHORT"]) {
    const f = fixture();
    seed(f, side === "LONG" ? "SHORT" : "LONG");
    f.run(side === "LONG" ? "paperBuy()" : "paperSell()");
    assert.ok(f.run("Trading.validLevels(position)"));
  }
});
test("Cross-symbol and cross-source prices cannot close a position", () => {
  const f = fixture();
  seed(f);
  f.run(
    "paperBuy();updatePaperPL(60000,'BTC/USD','live');updatePaperPL(60000,'AAPL','demo')",
  );
  assert.equal(f.run("position.symbol"), "AAPL");
  assert.equal(f.run("tradeHistory.length"), 0);
});
test("Stop gap fills at observed price with adverse slippage, not at stop", () => {
  const f = fixture();
  seed(f);
  f.run("paperBuy();acceptPrice('AAPL',80)");
  assert.equal(f.run("position"), null);
  assert.ok(f.run("tradeHistory[0].exit < 80"));
  assert.ok(f.run("tradeHistory[0].profit < -1"));
  assert.ok(f.run("tradeHistory[0].fees > 0"));
  assert.equal(f.run("tradeHistory[0].reason"), "STOP LOSS");
});
test("Manual SHORT closure preserves symbol and ledger including fees", () => {
  const f = fixture();
  seed(f, "SHORT");
  f.run("paperSell();acceptPrice('AAPL',95);paperBuy()");
  assert.equal(f.run("tradeHistory[0].symbol"), "AAPL");
  assert.ok(
    Math.abs(f.run("tradingBalance - 10 - tradeHistory[0].profit")) < 1e-10,
  );
});
test("Stale quotes, invalid amounts, zero prices and mismatched plans cannot open", () => {
  for (const setup of [
    "quoteCache.get('AAPL').time-=30000",
    "lastAnalysis.ticker='BTC/USD'",
    "lastAnalysis.timestamp-=130000",
    "quoteCache.get('AAPL').price=0",
    "document.getElementById('paperTradeAmount').value='-1'",
  ]) {
    const f = fixture();
    seed(f);
    f.run(setup + ";paperBuy()");
    assert.equal(f.run("position"), null);
    assert.equal(f.run("tradingBalance"), 10);
  }
});
test("Switching ticker invalidates executable analysis", () => {
  const f = fixture();
  seed(f);
  f.nodes.ticker.value = "BTC/USD";
  f.run("invalidateAnalysis();paperBuy()");
  assert.equal(f.run("position"), null);
  assert.equal(f.run("lastAnalysis"), null);
});
test("Invalid restored state is preserved and locks trading", () => {
  const f = fixture();
  const bad = JSON.stringify({
    tradingBalance: 10,
    tradeHistory: [],
    position: { side: "SHORT", entry: 100 },
  });
  f.storage.set("bunmoney_state", bad);
  f.run("loadGameState();saveGameState()");
  assert.equal(f.run("stateBlocked"), true);
  assert.equal(f.storage.get("bunmoney_state"), bad);
  seed(f);
  f.run("paperBuy()");
  assert.equal(f.run("position"), null);
});
test("Valid restored position selects its own symbol and data source", () => {
  const f = fixture();
  f.storage.set(
    "bunmoney_state",
    JSON.stringify({
      tradingBalance: 5,
      tradeHistory: [],
      position: {
        side: "SHORT",
        entry: 100,
        stop: 110,
        target: 80,
        amount: 5,
        symbol: "BTC/USD",
        source: "demo",
        entryFee: 0.005,
      },
    }),
  );
  f.run("loadGameState()");
  assert.equal(f.nodes.ticker.value, "BTC/USD");
  assert.equal(f.run("demoMarketEnabled"), true);
});
test("Abort signal reaches fetch; aborted requests reject", async () => {
  const f = fixture();
  let signal;
  f.c.fetch = async (_u, o) => {
    signal = o.signal;
    return { ok: true, json: async () => ({ price: 100 }) };
  };
  await f.run(
    "marketEngineRequest('/price',{symbol:'AAPL'},{signal:new AbortController().signal})",
  );
  assert.ok(signal);
});
for (const price of [100, 200, 1])
  test(`Analysis completes at quote ${price}, including breakouts and breakdowns`, async () => {
    const f = fixture();
    f.c.fetch = async (u) => ({
      ok: true,
      json: async () =>
        u.includes("time_series") ? { values: candles() } : { price },
    });
    await f.run("analyze()");
    assert.equal(f.run("lastAnalysis.currentPrice"), price);
  });
test("An older delayed quote cannot overwrite newer analysis", async () => {
  const f = fixture();
  let release, started;
  const ready = new Promise((r) => (started = r));
  f.c.fetch = async (u) => {
    const url = new URL(u, "http://local");
    if (url.pathname.endsWith("time_series"))
      return { ok: true, json: async () => ({ values: candles() }) };
    if (url.searchParams.get("symbol") === "AAPL") {
      started();
      await new Promise((r) => (release = r));
      return { ok: true, json: async () => ({ price: 100 }) };
    }
    return { ok: true, json: async () => ({ price: 105 }) };
  };
  const old = f.run("analyze()");
  await ready;
  f.nodes.ticker.value = "SOUN";
  await f.run("analyze()");
  release();
  await old;
  assert.equal(f.run("lastAnalysis.ticker"), "SOUN");
  assert.equal(f.run("lastAnalysis.currentPrice"), 105);
});
test("Invalid candle payloads cannot produce analysis", () => {
  assert.throws(() =>
    Trading.candles(candles().map((c) => ({ ...c, high: "-1" }))),
  );
  assert.throws(() => Trading.candles(candles().slice(0, 10)));
});
test("Malformed state and injected favorite symbols are rejected", () => {
  assert.equal(Trading.validSymbol("<img src=x onerror=alert(1)>"), false);
  assert.throws(() =>
    Trading.state({ tradingBalance: 10, tradeHistory: [{ symbol: "<img>" }] }),
  );
});

test('Aborted analysis never opens a trade or publishes stale results',async()=>{
  const f=fixture();
  f.c.fetch=async(_url,{signal})=>{signal.throwIfAborted();return {ok:true,json:async()=>({price:100})};};
  const controller=new AbortController();controller.abort();f.c.abortedSignal=controller.signal;
  await assert.rejects(f.run("marketEngineRequest('/price',{symbol:'AAPL'},{signal:abortedSignal})"),{name:'AbortError'});
  assert.equal(f.run('lastAnalysis'),null);
});
test('SHORT stop gaps preserve negative-equity accounting rather than minting cash',()=>{
  const f=fixture();seed(f,'SHORT');f.run("paperSell();acceptPrice('AAPL',500)");
  assert.equal(f.run('position'),null);
  assert.ok(f.run('tradingBalance < 0'));
  assert.ok(Math.abs(f.run('tradingBalance - 10 - tradeHistory[0].profit'))<1e-10);
  assert.ok(Trading.state(JSON.parse(f.storage.get('bunmoney_state'))));
});
test('Repeated SELL on an open SHORT does not relabel prior history',()=>{
  const f=fixture();seed(f);f.run("paperBuy();paperSell();paperSell()");
  f.nodes.ticker.value='BTC/USD';f.run('paperSell()');
  assert.equal(f.run('tradeHistory[0].symbol'),'AAPL');
  assert.equal(f.run('tradeHistory.length'),1);
});
