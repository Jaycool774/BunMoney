const test = require("node:test");
const assert = require("node:assert/strict");
const Feed = require("../coinbase-feed");
function setup() {
  const sockets = [],
    timers = new Map(),
    prices = [];
  let id = 0,
    time = Date.now();
  class Socket {
    constructor(url) {
      this.url = url;
      this.messages = [];
      sockets.push(this);
    }
    send(data) {
      this.messages.push(JSON.parse(data));
    }
    close() {
      this.onclose?.();
    }
  }
  const f = new Feed({
    Socket,
    onPrice: (...p) => prices.push(p),
    now: () => time,
    schedule: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    cancel: (i) => timers.delete(i),
  });
  return {
    f,
    sockets,
    timers,
    prices,
    tick: () => (time += 21000),
    message: (
      s,
      product = "BTC-USD",
      price = "100",
      timestamp = new Date(time).toISOString(),
    ) =>
      s.onmessage({
        data: JSON.stringify({
          channel: "ticker",
          timestamp,
          events: [{ tickers: [{ product_id: product, price }] }],
        }),
      }),
  };
}
test("Subscribes to ticker and heartbeats and accepts only fresh matching prices", () => {
  const t = setup();
  t.f.start("BTC/USD");
  const s = t.sockets[0];
  s.onopen();
  assert.equal(s.messages[0].product_ids[0], "BTC-USD");
  t.message(s);
  assert.equal(t.prices.length, 1);
  assert.ok(t.f.fresh("BTC/USD"));
  t.message(s, "ETH-USD");
  t.message(s, "BTC-USD", "-1");
  t.message(s, "BTC-USD", "100", "2020-01-01");
  assert.equal(t.prices.length, 1);
  t.tick();
  assert.equal(t.f.fresh("BTC/USD"), false);
});
test("Reconnects after disconnection and stops retries when switching symbols", () => {
  const t = setup();
  t.f.start("BTC/USD");
  const old = t.sockets[0];
  old.onclose();
  assert.equal(t.timers.size, 1);
  [...t.timers.values()][0]();
  assert.equal(t.sockets.length, 2);
  t.f.start("SOUN");
  t.message(old);
  assert.equal(t.prices.length, 0);
  assert.equal(t.f.symbol, null);
  assert.equal(t.timers.size, 0);
});
test("Malformed data does not throw and stale connection watchdog closes socket", () => {
  const t = setup();
  t.f.start("BTC/USD");
  const s = t.sockets[0];
  s.onopen();
  assert.doesNotThrow(() => s.onmessage({ data: "broken" }));
  [...t.timers.values()][0]();
  assert.equal(t.f.fresh("BTC/USD"), false);
});
