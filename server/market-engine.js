const INTERVALS = new Set([
  "1min",
  "5min",
  "15min",
  "1h",
  "4h",
  "1day",
  "1week",
  "1month",
]);
class MarketError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
function parameters(query, series = false) {
  if (
    typeof query.symbol !== "string" ||
    !/^[A-Z0-9][A-Z0-9./:_-]{0,29}$/.test(query.symbol.trim().toUpperCase())
  )
    throw new MarketError("Enter a valid symbol (1–30 characters).", 400);
  const result = { symbol: query.symbol.trim().toUpperCase() };
  if (series) {
    const interval = query.interval ?? "5min",
      size = query.outputsize ?? "100";
    if (
      !["string", "number"].includes(typeof size) ||
      !INTERVALS.has(interval) ||
      !/^\d{1,4}$/.test(String(size)) ||
      Number(size) < 21 ||
      Number(size) > 5000
    )
      throw new MarketError("Invalid interval or outputsize (21–5000).", 400);
    Object.assign(result, { interval, outputsize: String(Number(size)) });
  }
  return result;
}
function createMarketEngine({
  apiKey,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 10000,
} = {}) {
  const cache = new Map(),
    pending = new Map();
  let retryAt = 0;
  async function request(query, series = false) {
    const params = parameters(query, series);
    if (!apiKey) throw new MarketError("Market API key is not configured", 503);
    const key = JSON.stringify([series, params]),
      cached = cache.get(key);
    if (cached && now() < cached.expires) return cached.value;
    if (pending.has(key)) return pending.get(key);
    if (now() < retryAt)
      throw new MarketError(
        "Market provider allowance exceeded. Try later.",
        429,
      );
    if (pending.size >= 20)
      throw new MarketError("Market service busy. Try again shortly.", 503);
    const operation = (async () => {
      try {
        const url = new URL(
          series
            ? "https://api.twelvedata.com/time_series"
            : "https://api.twelvedata.com/quote",
        );
        url.search = new URLSearchParams({ ...params, apikey: apiKey });
        const response = await fetchImpl(url, {
            signal: AbortSignal.timeout(timeoutMs),
          }),
          data = await response.json();
        if (response.status === 429 || data.code === 429)
          retryAt = now() + 60000;
        if (!response.ok || data.status === "error")
          throw new MarketError(
            response.status === 429 || data.code === 429
              ? "Market provider allowance exceeded. Try later."
              : "Market provider rejected this request.",
            response.status === 429 || data.code === 429 ? 429 : 502,
          );
        if (
          series
            ? !Array.isArray(data.values) || !data.values.length
            : !Number.isFinite(Number(data.close)) || Number(data.close) <= 0
        )
          throw new MarketError("Market provider returned invalid data.");
        const value = series ? data : { ...data, price: data.close };
        cache.delete(key);
        cache.set(key, { value, expires: now() + (series ? 60000 : 15000) });
        while (cache.size > 200) cache.delete(cache.keys().next().value);
        return value;
      } catch (error) {
        if (error instanceof MarketError) throw error;
        const timeout = ["TimeoutError", "AbortError"].includes(error.name);
        throw new MarketError(
          timeout
            ? "Market provider timed out."
            : "Unable to retrieve market data.",
          timeout ? 504 : 502,
        );
      }
    })();
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  }
  return { quote: (q) => request(q), series: (q) => request(q, true) };
}
module.exports = { createMarketEngine, parameters, MarketError };
