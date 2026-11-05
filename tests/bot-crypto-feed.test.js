"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBotCryptoFeed } = require("../server/bot-crypto-feed");
const NOW = Date.parse("2026-11-05T14:45:30Z");
const candle = t => [t, 99, 101, 100, 100, 1];
function feed(ticker, bars) {
  return createBotCryptoFeed({ now: () => NOW, fetchImpl: async url => ({
    ok: true, status: 200,
    json: async () => url.toString().includes("/ticker") ? ticker : bars
  }) });
}
test("accepts fresh provider timestamp and rejects midnight daily timestamp", async () => {
  const good = feed({ price: "100", time: "2026-11-05T14:45:00Z" }, []);
  assert.equal((await good.quote("BTC/USD")).timestamp, (NOW - 30000)/1000);
  const stale = feed({ price: "100", time: "2026-11-05T00:00:00Z" }, []);
  await assert.rejects(stale.quote("BTC/USD"), /Stale/);
  await assert.rejects(good.quote("SOUN"), /Unsupported/);
});
test("requires contiguous completed UTC epoch candles", async () => {
  const end = Date.parse("2026-11-05T14:45:00Z")/1000;
  const bars = Array.from({length: 40}, (_, i) => candle(end - (i+1)*300));
  const d = await feed({}, bars).candles("ETH/USD");
  assert.equal(d.meta.exchange_timezone, "UTC");
  assert.equal(d.meta.source, "coinbase-exchange-epoch");
  assert.equal(d.values.length, 40);
  await assert.rejects(feed({}, bars.filter((_,i) => i !== 5)).candles("ETH/USD"), /Gap/);
  await assert.rejects(feed({}, bars.map(r => [r[0]-3600,...r.slice(1)])).candles("ETH/USD"), /stale/);
});
test("fails closed on malformed prices and candles", async () => {
  await assert.rejects(feed({price:"0",time:"2026-11-05T14:45:00Z"},[]).quote("BTC/USD"), /invalid/);
  await assert.rejects(feed({}, [[1,2,3,4,5,6]]).candles("BTC/USD"), /stale|Missing/);
});
