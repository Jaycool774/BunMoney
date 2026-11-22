(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BunMarketIntelligence = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ALLOWED = new Set(["BTC/USD", "ETH/USD"]);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const mean = a => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
  const stdev = a => {
    if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, n) => s + (n - m) ** 2, 0) / (a.length - 1));
  };
  function normalizeCandles(values) {
    if (!Array.isArray(values)) return [];
    return values.map(v => ({
      time: Date.parse(v.datetime || v.timestamp || v.time || ""),
      open: Number(v.open), high: Number(v.high), low: Number(v.low),
      close: Number(v.close), volume: Number(v.volume || 0)
    })).filter(c => Number.isFinite(c.time) && [c.open,c.high,c.low,c.close].every(n => Number.isFinite(n) && n > 0))
      .sort((a,b) => a.time-b.time);
  }
  function returns(candles, step = 1) {
    const out = [];
    for (let i = step; i < candles.length; i++) {
      const a = candles[i-step].close, b = candles[i].close;
      if (a > 0 && b > 0) out.push((b/a - 1) * 100);
    }
    return out;
  }
  function rsi(values, period = 14) {
    if (values.length <= period) return null;
    let gain = 0, loss = 0;
    for (let i = values.length-period; i < values.length; i++) {
      const d = values[i] - values[i-1];
      gain += Math.max(0,d); loss += Math.max(0,-d);
    }
    if (!loss) return gain ? 100 : 50;
    return 100 - 100 / (1 + gain/loss);
  }
  function formatPercent(n, digits = 3) {
    return Number.isFinite(n) ? (n > 0 ? "+" : "") + n.toFixed(digits) + "%" : "—";
  }
  function calculate(input) {
    const { candles1m = [], candles15m = [], currentPrice, target = null,
      windowMinutes = 15, now = Date.now(), samples = [] } = input || {};
    const price = Number(currentPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error("A valid live price is required.");
    const one = normalizeCandles(candles1m), fifteen = normalizeCandles(candles15m);
    if (one.length < 20 || fifteen.length < 20) throw new Error("At least 20 one-minute and 15-minute candles are required.");
    const currentTarget = Number(target);
    const hasTarget = Number.isFinite(currentTarget) && currentTarget > 0;
    const delta = hasTarget ? currentTarget - price : null;
    const deltaPct = hasTarget ? delta / price * 100 : null;
    const bucketMs = 15 * 60 * 1000;
    const windowStart = Math.floor(now / bucketMs) * bucketMs;
    const windowEnd = windowStart + bucketMs;
    const openCandle = [...one].reverse().find(c => c.time <= windowStart && c.time + 60000 > windowStart)
      || [...fifteen].reverse().find(c => c.time <= windowStart && c.time + bucketMs > windowStart);
    const windowOpen = openCandle ? openCandle.open : null;
    const remainingMs = Math.max(0, windowEnd - now);
    const last1 = one.slice(-1)[0];
    const closes = one.map(c => c.close);
    const move = (minutes) => {
      const bars = Math.max(1, minutes);
      if (one.length <= bars) return null;
      return (price / one[one.length - 1 - bars].close - 1) * 100;
    };
    const vol = (minutes) => {
      const step = Math.max(1, minutes);
      const rs = returns(one.slice(-(Math.max(30, step * 30))), step);
      return { averageAbs: mean(rs.map(Math.abs)), stdDev: stdev(rs), high: rs.length ? Math.max(...rs) : null, low: rs.length ? Math.min(...rs) : null, samples: rs.length };
    };
    const oneVol = vol(1), fiveVol = vol(5), fifteenVol = vol(15);
    const targetDistance = hasTarget ? Math.abs(delta) : null;
    const direction = hasTarget ? (delta >= 0 ? "UP" : "DOWN") : null;
    const horizonBars = Math.max(1, Math.ceil(Math.min(60, Math.max(1, windowMinutes)) / 15));
    const history = fifteen.slice(-2880);
    const hits = [];
    if (hasTarget) {
      const thresholdPct = Math.abs(deltaPct);
      for (let i = 0; i < history.length - horizonBars; i++) {
        const start = history[i].close;
        if (!start) continue;
        let hi = -Infinity, lo = Infinity;
        for (let j = i + 1; j <= i + horizonBars; j++) {
          hi = Math.max(hi, history[j].high);
          lo = Math.min(lo, history[j].low);
        }
        const excursionUp = (hi / start - 1) * 100;
        const excursionDown = (lo / start - 1) * 100;
        hits.push(direction === "UP" ? excursionUp >= thresholdPct : excursionDown <= -thresholdPct);
      }
    }
    const hitRate = hits.length ? hits.filter(Boolean).length / hits.length * 100 : null;
    const pastReturns = returns(history, 1);
    const momentum = {
      oneMinute: move(1), fiveMinute: move(5), fifteenMinute: move(15), thirtyMinute: move(30),
      rsi14: rsi(closes)
    };
    const sampleWindow = samples.filter(s => Number.isFinite(s.time) && now - s.time <= 60000 && s.price > 0);
    const settlementAverage = sampleWindow.length ? mean(sampleWindow.map(s => s.price)) : null;
    const avgAbs15 = mean(pastReturns.map(Math.abs));
    return {
      symbol: input.symbol, price, target: hasTarget ? currentTarget : null,
      moveNeeded: hasTarget ? { amount: targetDistance, percent: Math.abs(deltaPct), direction } : null,
      window: { start: windowStart, end: windowEnd, remainingMs, open: windowOpen,
        distanceFromOpen: windowOpen ? price-windowOpen : null,
        distanceFromOpenPct: windowOpen ? (price/windowOpen-1)*100 : null },
      settlement: { sampledAverage60s: settlementAverage, sampleCount: sampleWindow.length,
        samplesNeeded: Math.max(0, 3-sampleWindow.length), method: "Average of BunMoney live quote samples from the last 60 seconds; not an exchange's official settlement value." },
      volatility: { oneMinute: oneVol, fiveMinute: fiveVol, fifteenMinute: fifteenVol,
        thirtyDayAverageAbs15m: avgAbs15, thirtyDayBars: history.length },
      momentum, historical: { targetHitRate: hitRate, sampleCount: hits.length,
        positive15mRate: pastReturns.length ? pastReturns.filter(n=>n>0).length/pastReturns.length*100 : null,
        averageAbs15m: avgAbs15, min15m: pastReturns.length ? Math.min(...pastReturns) : null,
        max15m: pastReturns.length ? Math.max(...pastReturns) : null },
      data: { oneMinuteBars: one.length, fifteenMinuteBars: history.length,
        oldest15m: history[0]?.time || null, newest15m: history.at(-1)?.time || null }
    };
  }
  return { ALLOWED, normalizeCandles, returns, rsi, calculate, formatPercent };
});
