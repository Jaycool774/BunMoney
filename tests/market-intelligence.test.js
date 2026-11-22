const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCandles, calculate } = require("../market-intelligence-core");

function candles(count, stepMs, start, options = {}) {
  return Array.from({ length: count }, (_, i) => {
    const base = 100 + i * (options.drift || 0);
    return {
      datetime: new Date(start + i * stepMs).toISOString(),
      open: String(base), high: String(base + (options.range || 1)),
      low: String(base - (options.range || 1)), close: String(base),
      volume: "10"
    };
  });
}

test("normalizes and sorts provider candles chronologically", () => {
  const input = candles(3, 60000, Date.UTC(2026,10,22)).reverse();
  const result = normalizeCandles(input);
  assert.equal(result.length, 3);
  assert.ok(result[0].time < result[2].time);
});

test("calculates target distance, window position, volatility and historical hit rate", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");
  const one = candles(120, 60000, now - 120 * 60000, { range: 0.5 });
  const fifteen = candles(2880, 900000, now - 2880 * 900000, { range: 6 });
  const result = calculate({
    symbol: "BTC/USD", currentPrice: 100, target: 105,
    candles1m: one, candles15m: fifteen, windowMinutes: 15, now,
    samples: [{ time: now - 10000, price: 100 }, { time: now - 20000, price: 101 }]
  });
  assert.equal(result.moveNeeded.amount, 5);
  assert.equal(result.moveNeeded.direction, "UP");
  assert.equal(result.window.open, 100);
  assert.equal(result.settlement.sampleCount, 2);
  assert.equal(result.settlement.sampledAverage60s, 100.5);
  assert.equal(result.historical.targetHitRate, 100);
  assert.equal(result.data.fifteenMinuteBars, 2880);
});

test("returns no target probability until a positive target is supplied", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");
  const result = calculate({
    symbol: "ETH/USD", currentPrice: 100, candles1m: candles(50,60000,now-3000000),
    candles15m: candles(40,900000,now-36000000), now
  });
  assert.equal(result.moveNeeded, null);
  assert.equal(result.historical.targetHitRate, null);
});

test("rejects invalid quotes and insufficient candle history", () => {
  assert.throws(() => calculate({ currentPrice: 0 }), /valid live price/);
  assert.throws(() => calculate({ currentPrice: 100, candles1m: [], candles15m: [] }), /At least 20/);
});
