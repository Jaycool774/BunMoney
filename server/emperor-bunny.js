"use strict";

// Emperor Bunny's transparent, local educational reasoning engine.
// No provider account or key is required. This is not a generative AI model.
function finite(value) {
  const num = Number(value);
  return value == null || value === "" || !Number.isFinite(num) ? null : num;
}
function sanitizeContext(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9./:_-]{0,29}$/.test(symbol)) return null;
  const trend = ["BULLISH", "BEARISH", "SIDEWAYS"].includes(raw.trend) ? raw.trend : "UNKNOWN";
  const setup = typeof raw.setup === "string" ? raw.setup.slice(0, 75) : "NO CONFIRMATION";
  const snapshot = { symbol, trend, setup };
  for (const name of ["price", "support", "resistance", "rsi", "volumeRatio", "rr", "stop", "target"]) snapshot[name] = finite(raw[name]);
  const age = finite(raw.ageMs);
  snapshot.ageMs = age == null ? null : Math.max(0, age);
  snapshot.source = raw.source === "demo" ? "demo" : "live";
  return snapshot;
}
const cash = n => n == null ? "unavailable" : "$" + n.toFixed(2);
function explain(message, rawContext) {
  if (typeof message !== "string" || message.trim().length < 1 || message.length > 500)
    return { status:400, error:"Ask a question between 1 and 500 characters." };
  const context = sanitizeContext(rawContext);
  if (!context) return { mode:"educational", text:"Choose a market and press ANALYZE first. I'll explain the available chart readings, risk, and possible setups. I don't forecast prices or place trades." };
  const {symbol,trend,setup,price,support,resistance,rsi,volumeRatio,rr,stop,target,ageMs,source} = context;
  const stale = ageMs == null || ageMs > 120000;
  const opening = `${symbol}: ${trend.toLowerCase()} trend at ${cash(price)}. ${setup}. `;
  const caution = (source === "demo" ? "These are simulated values. " : "") +
    (stale ? "Analysis is over two minutes old or undated; refresh it before deciding. " : "");
  const lower = message.toLowerCase();
  let answer;
  if (/risk|stop|loss|reward|position|safe|size/.test(lower)) {
    answer = `Risk overview: support ${cash(support)}, resistance ${cash(resistance)}, proposed stop ${cash(stop)}, target ${cash(target)}${rr == null ? "" : `, reward/risk approximately ${rr.toFixed(2)}:1`}. Stops can slip or gap, so the quoted risk is not guaranteed. Use paper trading to rehearse first.`;
  } else if (/volume|spike|breakout|breakdown|momentum/.test(lower)) {
    answer = `Volume is ${volumeRatio == null ? "unavailable" : volumeRatio.toFixed(2) + "x the recent comparison average"}. ${setup}. An unusually high volume reading alone cannot confirm a breakout. Watch price relative to support ${cash(support)} and resistance ${cash(resistance)}.`;
  } else if (/rsi|indicator|sma|technical|trend/.test(lower)) {
    answer = `Current trend is ${trend.toLowerCase()}, RSI is ${rsi == null ? "unavailable" : rsi.toFixed(1)}. RSI describes momentum, not certainty. Check the candles and whether the trend agrees with the setup before considering any paper position.`;
  } else if (/buy|sell|long|short|trade|entry|should i/.test(lower)) {
    answer = `No automatic buy or sell recommendation. ${trend === "SIDEWAYS" ? "There is no clear trend; waiting for confirmation is reasonable." : "The trend is " + trend.toLowerCase() + ", but confirmation still matters."} Consider support ${cash(support)}, resistance ${cash(resistance)}, and a predefined invalidation point. You can practice a hypothesis in the paper simulator without risking funds.`;
  } else {
    answer = `Technical overview: support ${cash(support)}, resistance ${cash(resistance)}, RSI ${rsi == null ? "unavailable" : rsi.toFixed(1)}, volume ratio ${volumeRatio == null ? "unavailable" : volumeRatio.toFixed(2) + "x"}. Ask about risk, trend, volume, or a breakout for a focused explanation.`;
  }
  return {mode:"educational",text:opening + caution + answer + " Educational analysis only; not financial advice or a live trading signal.",symbol};
}
module.exports={explain,sanitizeContext};
