"use strict";
// Dedicated, fail-closed Coinbase Exchange public market-data adapter for the paper bot.
// No API credentials, synthetic timestamps, or fallback to stale daily quotes.
const PRODUCTS = Object.freeze({ "BTC/USD": "BTC-USD", "ETH/USD": "ETH-USD", "SOL/USD": "SOL-USD", "LTC/USD": "LTC-USD", "DOGE/USD": "DOGE-USD", "ADA/USD": "ADA-USD", "XRP/USD": "XRP-USD", "AVAX/USD": "AVAX-USD", "LINK/USD": "LINK-USD" });
class FeedError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
function createBotCryptoFeed({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  async function get(path) {
    let response, data;
    try {
      response = await fetchImpl("https://api.exchange.coinbase.com" + path, {
        headers: { Accept: "application/json", "User-Agent": "BunMoney-paper-bot/1.0" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      data = await response.json();
    } catch { throw new FeedError("Crypto provider unavailable"); }
    if (!response.ok) throw new FeedError("Crypto provider rejected request", response.status === 429 ? 429 : 502);
    return data;
  }
  function product(symbol) {
    if (!Object.hasOwn(PRODUCTS, symbol)) throw new FeedError("Unsupported paper bot symbol", 400);
    return PRODUCTS[symbol];
  }
  async function quote(symbol) {
    const id = product(symbol);
    const d = await get("/products/" + id + "/ticker");
    const price = Number(d.price);
    const timestamp = Date.parse(d.time) / 1000;
    const age = now() / 1000 - timestamp;
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp) || age < 0 || age > 90)
      throw new FeedError("Stale or invalid Coinbase quote", 503);
    return { symbol, price, timestamp, source: "coinbase-exchange" };
  }
  async function candles(symbol, interval = "5min") {
    const id = product(symbol);
    if (!["5min", "15min"].includes(interval) || (interval === "15min" && symbol !== "BTC/USD"))
      throw new FeedError("Unsupported candle interval for this market", 400);
    const granularity = interval === "15min" ? 900 : 300;
    const d = await get("/products/" + id + "/candles?granularity=" + granularity);
    if (!Array.isArray(d)) throw new FeedError("Invalid Coinbase candles");
    const current = now() / 1000;
    const bars = d.map(row => {
      if (!Array.isArray(row) || row.length < 5) throw new FeedError("Invalid Coinbase candle");
      const [timestamp, low, high, open, close] = row.map(Number);
      if (![timestamp, low, high, open, close].every(Number.isFinite) ||
          timestamp % granularity !== 0 || Math.min(low, high, open, close) <= 0 ||
          low > high || open < low || open > high || close < low || close > high)
        throw new FeedError("Invalid Coinbase candle");
      return { timestamp, low, high, open, close };
    }).filter(c => c.timestamp + granularity <= current).sort((a,b) => a.timestamp - b.timestamp);
    const staleTolerance = interval === "15min" ? granularity + 360 : 360;
    if (bars.length < 21 || current - (bars[bars.length - 1].timestamp + granularity) > staleTolerance)
      throw new FeedError("Missing or stale completed Coinbase candles", 503);
    // Keep enough completed bars for both SMA(10/20) and SMA(20/40).
    const recent = bars.slice(-60);
    for (let i = 1; i < recent.length; i++)
      if (recent[i].timestamp - recent[i-1].timestamp !== granularity)
        throw new FeedError("Gap in Coinbase candles", 503);
    return { meta: { symbol, interval, exchange_timezone: "UTC", source: "coinbase-exchange-epoch" },
      values: recent.map(c => ({ datetime: new Date(c.timestamp * 1000).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close })) };
  }
  return { quote, candles };
}
module.exports = { createBotCryptoFeed, FeedError };
