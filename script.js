/* =========================================================
   BUNMONEY — MASTER BRAIN
   Prototype / Paper Trading / Analysis Assistant
========================================================= */

const MARKET_ENGINE_URL = "/api/market";
const Trading = window.BunTrading;
const quoteCache = new Map();
const QUOTE_MAX_AGE = 20000;
const ANALYSIS_MAX_AGE = 120000;
let stateBlocked = false;
let engineToken = ""; // Memory only; never included in backups or local storage.
let liveUpdateRunning = false;
let candleRefreshTimer = null;
let coinbaseFeed = null;

async function marketEngineRequest(endpoint, params = {}, options = {}) {
  if (demoMarketEnabled) {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (endpoint === "/time_series") return demoCandles(params.symbol, params.interval, params.outputsize);
    if (endpoint === "/price") return { price: demoLivePrice(params.symbol) };
    throw new Error("Unsupported demo request.");
  }
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const headers = { ...options.headers };
  if (engineToken) headers.Authorization = `Bearer ${engineToken}`;
  const response = await fetch(`${MARKET_ENGINE_URL}${endpoint}?${new URLSearchParams(params)}`, { ...options, headers, signal });
  const data = await response.json();
  if (!response.ok || data.status === "error") throw new Error(data.error || data.message || "Market engine request failed");
  return data;
}
function unlockMarketEngine() {
  const input = document.getElementById("engineToken");
  engineToken = input?.value || "";
  if (input) input.value = "";
  analyze(true);
}
function marketSource() { return demoMarketEnabled ? "demo" : "live"; }
function selectedSymbol() { return document.getElementById("ticker")?.value.toUpperCase().trim() || ""; }
function acceptPrice(symbol, price, time = Date.now()) {
  if (!Trading.validSymbol(symbol) || !Trading.positive(price)) return;
  quoteCache.set(symbol, { price, time, source:marketSource() });
  if (quoteCache.size > 100) quoteCache.delete(quoteCache.keys().next().value);
  if (symbol === selectedSymbol()) {
    lastLivePrice = price; window.lastLivePrice = price; lastMarketDataTime = time;
    setText("price", formatMoney(price));
  }
  updatePaperPL(price, symbol, marketSource());
}
function invalidateAnalysis() {
  analyzeRequestId++;
  analyzeAbortController?.abort();
  lastAnalysis = null; lastLivePrice = null; window.lastLivePrice = undefined;
  window.lastCandles = [];
  window.lastEntry = window.lastStop = window.lastTarget = undefined;
  coinbaseFeed?.stop();
  setText("price", "$—"); setText("reason", "Analyze this market before opening a position.");
  ["entry","stop","target","rr","potentialLoss","potentialProfit","tradePlanEntry","tradePlanStop","tradePlanTarget","tradePlanScore","tradePlanDirection","trend","support","resistance","sma10","sma20","rsi","volumeRatio","breakout","retest","setupQuality","marketOutlook"].forEach(id => setText(id,"—"));
  updateTradePlan();
}

let selectedTimeframe = "5min";
let analyzeRequestId = 0;
let analyzeAbortController = null;
let chartZoom = 25;
let arcadeBank = 0;
let arcadeTimer = null;
let tradingBalance = 10;
let position = null;
let tradeHistory = [];
let rewardPoints = 0;
let xp = 0;
let activeBot = "BunBot";
let arenaRunning = false;
let arenaTimer = null;
let lastAnalysis = null;
let lastMarketDataTime = 0;
let lastLivePrice = null;

window.lastCandles = [];
window.lastSupport = undefined;
window.lastResistance = undefined;
window.lastEntry = undefined;
window.lastStop = undefined;
window.lastTarget = undefined;
window.lastBreakoutIndex = undefined;
window.lastRetestIndex = undefined;
window.lastSma10 = undefined;
window.lastSma20 = undefined;

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}
function formatMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return "$—";
  return "$" + Number(value).toFixed(2);
}
function average(values) {
  if (!values || !values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function showPopup(title, message) {
  const popup = document.getElementById("popup");
  if (!popup) { alert(message); return; }
  const popupTitle = document.getElementById("popupTitle");
  const popupMessage = document.getElementById("popupMessage");
  if (popupTitle) popupTitle.textContent = title;
  if (popupMessage) popupMessage.textContent = message;
  popup.classList.add("show");
}
function closePopup() {
  const popup = document.getElementById("popup");
  if (popup) popup.classList.remove("show");
}

function showScreen(screenName) {
  const target = document.getElementById(screenName);
  if (!target) return;
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  if (target) target.classList.add("active");
  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.remove("active");
    if (button.dataset.screen === screenName || button.getAttribute("data-screen") === screenName) {
      button.classList.add("active");
    }
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setTimeframe(timeframe) {
  if (selectedTimeframe === timeframe) return;

  selectedTimeframe = timeframe;

  document.querySelectorAll(".timeframes button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.timeframe === timeframe
    );
  });

  analyze(true);
}

function calculateSMA(values, period) {
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    result[i] = average(values.slice(i - period + 1, i + 1));
  }
  return result;
}

function calculateRSI(values, period = 14) {
  const rsi = new Array(values.length).fill(null);
  if (values.length <= period) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

async function analyze(force = false) {
  const requestId = ++analyzeRequestId;

  // Cancel the previous market request immediately.
  if (analyzeAbortController) {
    analyzeAbortController.abort();
  }

  analyzeAbortController = new AbortController();
  const signal = analyzeAbortController.signal;

  const tickerElement = document.getElementById("ticker");
  if (!tickerElement) return;
  const ticker = tickerElement.value.toUpperCase().trim();
  lastAnalysis = null;
  if (!Trading.validSymbol(ticker)) { setText("reason", "Enter a ticker symbol first."); return; }
  setText("symbol", ticker);
  setText("decision", "LOADING MARKET DATA...");
  setText("reason", "BunAI is analyzing the market...");
  try {
    const interval = selectedTimeframe === "max" ? "1month" : selectedTimeframe;
   const data = await marketEngineRequest(
  "/time_series",
  { symbol: ticker, interval, outputsize: selectedTimeframe === "max" ? 5000 : 80 },
  { signal }
);
    if (requestId !== analyzeRequestId) return;
    if (data.status === "error" || !data.values || !data.values.length) {
      if (data.message && data.message.toLowerCase().includes("credits")) {
        throw new Error("Twelve Data credits are exhausted for today.");
      }
      throw new Error(data.message || "No market data returned.");
    }

    if (data.meta?.symbol && data.meta.symbol.toUpperCase() !== ticker) throw new Error("Provider returned a different symbol.");
    const candles = Trading.candles(data.values);
const closes = candles.map(c => Number(c.close));
const highs = candles.map(c => Number(c.high));
const lows = candles.map(c => Number(c.low));
const volumes = candles.map(c => Number(c.volume || 0));

const lastCandlePrice = closes[closes.length - 1];
let currentPrice = lastCandlePrice;

try {
  const quote = await marketEngineRequest(
  "/price",
  { symbol: ticker },
  { signal }
);
  if (requestId !== analyzeRequestId || ticker !== selectedSymbol()) return;
  if (Trading.positive(Number(quote.price))) {
    currentPrice = Number(quote.price);
    acceptPrice(ticker, currentPrice);
  }
} catch (quoteError) {
  if (quoteError.name === "AbortError") throw quoteError;
  quoteCache.delete(ticker);
  console.log("Live quote unavailable; analysis uses candle close, trading remains locked.");
}

if (requestId !== analyzeRequestId || ticker !== selectedSymbol()) return;
const previousPrice = closes.length > 1
  ? closes[closes.length - 2]
  : lastCandlePrice;

const changePercent = previousPrice === 0
  ? 0
  : ((currentPrice - previousPrice) / previousPrice) * 100;

    const sma10Values = calculateSMA(closes, 10);
    const sma20Values = calculateSMA(closes, 20);
    const rsiValues = calculateRSI(closes, 14);
    const sma10 = sma10Values[sma10Values.length - 1];
    const sma20 = sma20Values[sma20Values.length - 1];
    const rsi = rsiValues[rsiValues.length - 1];

    const recentCount = Math.min(30, candles.length);
    const resistance = Math.max(...highs.slice(-recentCount));
    const support = Math.min(...lows.slice(-recentCount));

    const currentVolume = volumes[volumes.length - 1];
    const volumeWindow = volumes.slice(Math.max(0, volumes.length - 21), volumes.length - 1);
    const averageVolume = average(volumeWindow);
    const volumeRatio = averageVolume > 0 ? currentVolume / averageVolume : 0;

    let trend = "SIDEWAYS";
    if (Number.isFinite(sma10) && Number.isFinite(sma20)) {
      if (currentPrice > sma10 && sma10 > sma20) trend = "BULLISH";
      else if (currentPrice < sma10 && sma10 < sma20) trend = "BEARISH";
    }

    let breakout = "NO CONFIRMATION";
let breakoutIndex = null;
let breakoutDirection = null;

// Compare with levels that exclude the candidate candle. A retest must occur later.
const priorResistance = Math.max(...highs.slice(-21, -1));
const priorSupport = Math.min(...lows.slice(-21, -1));
if (currentPrice > priorResistance) {
  breakout = "POSSIBLE BREAKOUT"; breakoutIndex = candles.length - 1; breakoutDirection = "BULLISH";
} else if (currentPrice < priorSupport) {
  breakout = "POSSIBLE BREAKDOWN"; breakoutIndex = candles.length - 1; breakoutDirection = "BEARISH";
}
let retest = "WAITING", retestIndex = null;
if (breakoutIndex === null) {
  for (let i = candles.length - 2; i >= Math.max(20, candles.length - 6); i--) {
    const upper = Math.max(...highs.slice(i - 20, i));
    const lower = Math.min(...lows.slice(i - 20, i));
    const tolerance = currentPrice * 0.005;
    if (closes[i] > upper && lows.at(-1) <= upper + tolerance && currentPrice >= upper) {
      breakoutDirection = "BULLISH";
    } else if (closes[i] < lower && highs.at(-1) >= lower - tolerance && currentPrice <= lower) {
      breakoutDirection = "BEARISH";
    } else continue;
    retest = "RETEST AREA"; retestIndex = candles.length - 1; breakoutIndex = i; break;
  }
}

    let entry = currentPrice;
let stop;
let target;

// Build the direction from the market conditions first.
const preliminaryLong =
  trend === "BULLISH" ||
  breakout === "POSSIBLE BREAKOUT" ||
  (retest === "RETEST AREA" && breakoutDirection === "BULLISH");

const preliminaryShort =
  trend === "BEARISH" &&
  !preliminaryLong;

if (preliminaryShort) {
  // SHORT: stop above entry, target below entry.
  stop = Math.max(resistance, currentPrice * 1.02);
  target = Math.min(support, currentPrice * 0.96);

  if (stop <= entry) stop = entry * 1.02;
  if (target >= entry) target = entry * 0.96;
} else {
  // LONG: stop below entry, target above entry.
  stop = Math.min(support, currentPrice * 0.98);
  target = Math.max(resistance, currentPrice * 1.04);

  if (target <= entry) target = entry * 1.03;
  if (stop >= entry) stop = entry * 0.98;
}

const risk = preliminaryShort
  ? stop - entry
  : entry - stop;

const reward = preliminaryShort
  ? entry - target
  : target - entry;

const rr = risk > 0 ? reward / risk : 0;

    const tradeAmount = Number(document.getElementById("paperTradeAmount")?.value);
    const potentialLoss = Number.isFinite(tradeAmount) && tradeAmount > 0 && entry > 0
      ? tradeAmount * (risk / entry) + tradeAmount * 2 * (Trading.FEE + Trading.SLIPPAGE)
      : null;
    const potentialProfit = Number.isFinite(tradeAmount) && tradeAmount > 0 && entry > 0
      ? tradeAmount * (reward / entry) - tradeAmount * 2 * (Trading.FEE + Trading.SLIPPAGE)
      : null;

    let score = 0;

const signalFactors = {
  trend: 0,
  rsi: 0,
  volume: 0,
  breakout: 0,
  retest: 0,
  riskReward: 0
};

// Trend
if (trend === "BULLISH") signalFactors.trend = 2;
if (trend === "BEARISH") signalFactors.trend = -2;

// RSI
if (Number.isFinite(rsi)) {
  if (trend === "BULLISH") {
    if (rsi > 50 && rsi < 70) signalFactors.rsi = 1;
    if (rsi >= 70 && rsi <= 75) signalFactors.rsi = -1;
    if (rsi > 75) signalFactors.rsi = -2;
    if (rsi < 30) signalFactors.rsi = 1;
  }

  if (trend === "BEARISH") {
    if (rsi >= 30 && rsi < 50) signalFactors.rsi = -1;
    if (rsi < 30 && rsi >= 25) signalFactors.rsi = 1;
    if (rsi < 25) signalFactors.rsi = 2;
    if (rsi >= 70) signalFactors.rsi = -1;
  }
}

// Volume strength confirms the existing trend.
if (volumeRatio >= 3) {
  if (trend === "BULLISH") signalFactors.volume = 3;
  if (trend === "BEARISH") signalFactors.volume = -3;
} else if (volumeRatio >= 2) {
  if (trend === "BULLISH") signalFactors.volume = 2;
  if (trend === "BEARISH") signalFactors.volume = -2;
} else if (volumeRatio >= 1.5) {
  if (trend === "BULLISH") signalFactors.volume = 1;
  if (trend === "BEARISH") signalFactors.volume = -1;
}

// Breakout / breakdown.
if (breakout === "POSSIBLE BREAKOUT") {
  signalFactors.breakout = 2;
}

if (breakout === "POSSIBLE BREAKDOWN") {
  signalFactors.breakout = -2;
}

// Retest.
if (retest === "RETEST AREA") {
  if (breakoutDirection === "BULLISH") signalFactors.retest = 2;
  if (breakoutDirection === "BEARISH") signalFactors.retest = -2;
}

// Reward-to-risk.
if (rr >= 2) {
  signalFactors.riskReward = 1;
}

score =
  signalFactors.trend +
  signalFactors.rsi +
  signalFactors.volume +
  signalFactors.breakout +
  signalFactors.retest +
  signalFactors.riskReward;

    // Directional confirmation gate.
// A strong score alone is not enough; price must confirm the direction.
const longConfirmed =
  trend === "BULLISH" &&
  (
    breakout === "POSSIBLE BREAKOUT" ||
    (retest === "RETEST AREA" && breakoutDirection === "BULLISH")
  );

const shortConfirmed =
  trend === "BEARISH" &&
  (
    breakout === "POSSIBLE BREAKDOWN" ||
    (retest === "RETEST AREA" && breakoutDirection === "BEARISH")
  );

let decision = "WAIT";

if (longConfirmed && score >= 5) {
  decision = "WATCH FOR LONG";
} else if (shortConfirmed && score <= -3) {
  decision = "WATCH FOR SHORT";
}

let setupQuality = "LOW";

if (
  (longConfirmed && score >= 3) ||
  (shortConfirmed && score <= -3)
) {
  setupQuality = "MODERATE";
}

if (
  (longConfirmed && score >= 5) ||
  (shortConfirmed && score <= -5)
) {
  setupQuality = "HIGH";
}

    let outlook = "Market conditions are mixed.";
    if (trend === "BULLISH") outlook = "Momentum currently favors buyers.";
    if (trend === "BEARISH") outlook = "Momentum currently favors sellers.";

    let reason = `Trend is ${trend.toLowerCase()}. `;
    reason += `RSI is ${Number.isFinite(rsi) ? rsi.toFixed(1) : "unavailable"}. `;
    reason += `Volume is ${volumeRatio >= 1.5 ? "elevated" : "normal"}. `;
    if (breakout === "POSSIBLE BREAKOUT") reason += "Price is pushing beyond recent resistance. ";
    if (retest === "RETEST AREA") reason += "A retest area is developing. ";
    if (decision === "WAIT") reason += "There is not enough confirmation yet, so waiting is safer.";
    else reason += "This is an analysis signal, not a guaranteed prediction.";

    // Candle-only prices are display values, never execution quotes.
    setText("price", formatMoney(currentPrice));
    setText("paperCurrentPrice", formatMoney(currentPrice));
    // Position exits are processed only from symbol-tagged fresh quotes.
    setText("change", `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`);
    setText("trend", trend);
    setText("volume", currentVolume ? currentVolume.toLocaleString() : "—");
    setText("support", formatMoney(support));
    setText("resistance", formatMoney(resistance));
    setText("rsi", Number.isFinite(rsi) ? rsi.toFixed(1) : "—");
    setText("sma10", formatMoney(sma10));
    setText("sma20", formatMoney(sma20));
    setText("volumeRatio", volumeRatio ? volumeRatio.toFixed(2) + "x" : "—");
    setText("breakout", breakout);
    setText("retest", retest);
    setText("entry", formatMoney(entry));
    setText("stop", formatMoney(stop));
    setText("target", formatMoney(target));
    setText("rr", rr ? rr.toFixed(2) + ":1" : "—");
    setText("potentialLoss", potentialLoss !== null ? "-" + formatMoney(potentialLoss) : "—");
    setText("potentialProfit", potentialProfit !== null ? "+" + formatMoney(potentialProfit) : "—");
    setText("decision", decision);
    setText("reason", reason);
    setText("setupQuality", setupQuality);
    setText("marketOutlook", outlook);

    const decisionElement = document.getElementById("decision");
    if (decisionElement) {
      decisionElement.classList.remove("long", "short", "wait");
      if (decision.includes("LONG")) decisionElement.classList.add("long");
      else if (decision.includes("SHORT")) decisionElement.classList.add("short");
      else decisionElement.classList.add("wait");
    }

    lastAnalysis = {
  ticker,
  currentPrice,
  changePercent,
  trend,
  support,
  resistance,
  rsi,
  sma10,
  sma20,
  volumeRatio,
  breakout,
  breakoutDirection,
  retest,
  entry,
  stop,
  target,
  rr,
  score,
  signalFactors,
  decision,
  setupQuality,
  outlook,
  source: marketSource(),
  timestamp: Date.now()
};

    if (!demoMarketEnabled && coinbaseFeed?.symbol !== ticker) coinbaseFeed?.start(ticker);
    window.lastCandles = candles;
    window.lastSupport = support;
    window.lastResistance = resistance;
    window.lastEntry = entry;
    window.lastStop = stop;
    window.lastTarget = target;
    window.lastBreakoutIndex = breakoutIndex;
    window.lastRetestIndex = retestIndex;
    window.lastSma10 = sma10Values;
    window.lastSma20 = sma20Values;

    drawChart(candles, support, resistance, entry, stop, target, breakoutIndex, retestIndex, sma10Values, sma20Values);
    checkAlerts();
    updateRiskGuardian();
    updateMarketSnapshot();
    mascotReaction(decision === "WAIT" ? "Bun says wait for confirmation. 🐰" : decision.includes("LONG") ? "Bun sees bullish potential. 🐰📈" : "Bun sees bearish pressure. 🐰📉");

    try {
      localStorage.setItem("bunmoney_last_analysis", JSON.stringify(lastAnalysis));
    } catch (error) {
      console.log("Could not save local analysis.");
    }
    } catch (error) {
    if (error.name === "AbortError") return;
    if (requestId !== analyzeRequestId) return;

    lastAnalysis = null;
    updateTradePlan();
    console.error("Market analysis error:", error); 
    setText("decision", "MARKET DATA UNAVAILABLE");
    setText("reason", error.message.includes("credits")
      ? "The market-data provider has reached its current limit. BunMoney will work again when the provider allowance resets."
      : error.message.includes("not configured")
        ? "Connect the BunMoney Market Engine or configure prototype market data."
        : "Check the ticker or market-data connection.");
    mascotReaction("The market-data pipe is temporarily closed. 🐰🔧");
  }
}

function drawChart(candles, support, resistance, entry, stop, target, breakoutIndex, retestIndex, sma10Values, sma20Values) {
  const canvas = document.getElementById("chart");
  if (!canvas || !candles.length) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || 350;
  const height = canvas.clientHeight || 340;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const visibleCount = Math.min(chartZoom, candles.length);
  const start = candles.length - visibleCount;
  const visible = candles.slice(start);
  const highs = visible.map(c => Number(c.high));
  const lows = visible.map(c => Number(c.low));
  const chartPosition = position?.symbol === lastAnalysis?.ticker ? position : null;
  const chartRangeStop = chartPosition?.stop ?? stop;
const chartRangeTarget = chartPosition?.target ?? target;

const extents = [...highs,...lows,resistance,support,chartRangeStop,chartRangeTarget,chartPosition?.entry,window.lastLivePrice].filter(Trading.positive);
const maxPrice = Math.max(...extents);
const minPrice = Math.min(...extents);
  const padding = 22;
  const range = maxPrice - minPrice || 1;

  function xPosition(i) {
    return padding + (i / Math.max(1, visible.length - 1)) * (width - padding * 2);
  }
  function yPosition(price) {
    return height - padding - ((price - minPrice) / range) * (height - padding * 2);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const y = padding + (i / 5) * (height - padding * 2);
    ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
  }

  // Price scale: show readable numeric levels on the right side of the chart.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = "10px Arial";
  for (let i = 0; i <= 5; i++) {
    const ratio = i / 5;
    const priceLevel = maxPrice - ratio * range;
    const y = padding + ratio * (height - padding * 2);
    ctx.fillStyle = "rgba(255,255,255,.62)";
    ctx.fillText(formatMoney(priceLevel), width - 4, y);
  }
  ctx.textAlign = "left";

  visible.forEach((candle, i) => {
    const open = Number(candle.open), close = Number(candle.close), high = Number(candle.high), low = Number(candle.low);
    const x = xPosition(i);
    const candleWidth = Math.max(3, (width / visible.length) * .55);
    const yOpen = yPosition(open), yClose = yPosition(close), yHigh = yPosition(high), yLow = yPosition(low);
    const bullish = close >= open;
    ctx.strokeStyle = bullish ? "#84cc16" : "#ef4444";
    ctx.fillStyle = bullish ? "#84cc16" : "#ef4444";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yHigh); ctx.lineTo(x, yLow); ctx.stroke();
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  });

  drawIndicatorLine(ctx, visible, start, sma10Values, xPosition, yPosition, "#facc15");
  drawIndicatorLine(ctx, visible, start, sma20Values, xPosition, yPosition, "#c084fc");

  const zoneSize = range * .015;
  const supportTop = yPosition(support + zoneSize);
  const supportBottom = yPosition(support - zoneSize);
  ctx.fillStyle = "rgba(34,197,94,.08)";
  ctx.fillRect(20, supportTop, width - 40, supportBottom - supportTop);

  const resistanceTop = yPosition(resistance + zoneSize);
  const resistanceBottom = yPosition(resistance - zoneSize);
  ctx.fillStyle = "rgba(239,68,68,.08)";
  ctx.fillRect(20, resistanceTop, width - 40, resistanceBottom - resistanceTop);

  drawLevel(ctx, width, yPosition(support), "rgba(34,197,94,.75)", "SUPPORT");
  drawLevel(ctx, width, yPosition(resistance), "rgba(239,68,68,.75)", "RESISTANCE");
 const activePosition = chartPosition;
const chartEntry = chartPosition?.entry ?? entry;
const chartStop = chartPosition?.stop ?? stop;
const chartTarget = chartPosition?.target ?? target;
const chartSide = chartPosition?.side || "PLAN";

drawLevel(
  ctx,
  width,
  yPosition(chartEntry),
  "rgba(255,255,255,.75)",
  chartSide === "PLAN" ? "ENTRY" : `${chartSide} ENTRY`
);

drawLevel(
  ctx,
  width,
  yPosition(chartStop),
  "rgba(239,68,68,.9)",
  chartSide === "PLAN" ? "STOP" : `${chartSide} STOP`
);

drawLevel(
  ctx,
  width,
  yPosition(chartTarget),
  "rgba(132,204,22,.9)",
  chartSide === "PLAN" ? "TARGET" : `${chartSide} TARGET`
);

  const currentPrice = Number(window.lastLivePrice);
  if (Number.isFinite(currentPrice) && currentPrice >= minPrice && currentPrice <= maxPrice) {
    const y = yPosition(currentPrice);
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(width - 20, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(17,21,30,.95)";
    ctx.fillRect(width - 76, y - 10, 70, 20);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "right";
    ctx.fillText("NOW " + formatMoney(currentPrice), width - 10, y);
    ctx.textAlign = "left";
  }

  if (breakoutIndex !== null && breakoutIndex !== undefined) {
    const localIndex = breakoutIndex - start;
    if (localIndex >= 0 && localIndex < visible.length) {
      const candle = visible[localIndex], x = xPosition(localIndex), y = yPosition(Number(candle.high));
      ctx.fillStyle = "#a3e635"; ctx.beginPath(); ctx.arc(x, y - 10, 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 11px Arial"; ctx.fillText("BREAKOUT", x + 8, y - 7);
    }
  }

  if (retestIndex !== null && retestIndex !== undefined) {
    const localIndex = retestIndex - start;
    if (localIndex >= 0 && localIndex < visible.length) {
      const candle = visible[localIndex], x = xPosition(localIndex), y = yPosition(Number(candle.low));
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.arc(x, y + 10, 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 11px Arial"; ctx.fillText("RETEST", x + 8, y + 15);
    }
  }
}

function drawIndicatorLine(ctx, visible, start, values, xPosition, yPosition, color) {
  if (!values) return;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  let started = false;
  ctx.beginPath();
  for (let i = 0; i < visible.length; i++) {
    const originalIndex = start + i, value = values[originalIndex];
    if (value === null || !Number.isFinite(value)) continue;
    const x = xPosition(i), y = yPosition(value);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  if (started) ctx.stroke();
}

function drawLevel(ctx, width, y, color, label) {
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(width - 20, y); ctx.stroke();
  ctx.setLineDash([]); ctx.font = "bold 10px Arial"; ctx.fillStyle = color; ctx.fillText(label, 24, y - 5);
}

function changeChartZoom(value) {
  chartZoom = Number(value);
  setText("zoomValue", value);
  if (window.lastCandles && window.lastCandles.length) {
    drawChart(window.lastCandles, window.lastSupport, window.lastResistance, window.lastEntry, window.lastStop, window.lastTarget, window.lastBreakoutIndex, window.lastRetestIndex, window.lastSma10, window.lastSma20);
  }
}

let livePriceTimer = null;
async function updateLivePrice() {
  if (liveUpdateRunning) return;
  liveUpdateRunning = true;
  const source = marketSource();
  const symbols = [...new Set([selectedSymbol(), position?.symbol].filter(Trading.validSymbol))];
  try {
    await Promise.allSettled(symbols.map(async symbol => {
      if (!demoMarketEnabled && coinbaseFeed?.fresh(symbol)) return;
      try {
        const data = await marketEngineRequest("/price", {symbol});
        if (source === marketSource()) acceptPrice(symbol, Number(data.price));
      } catch { setText("feedStatus", "Price unavailable; stale quotes cannot open or close trades."); }
    }));
    if (window.lastCandles?.length) redrawChart();
  } finally { liveUpdateRunning = false; }
}
function redrawChart() {
  drawChart(window.lastCandles,window.lastSupport,window.lastResistance,window.lastEntry,window.lastStop,window.lastTarget,window.lastBreakoutIndex,window.lastRetestIndex,window.lastSma10,window.lastSma20);
}
function startLivePrice() {
  if (livePriceTimer) clearInterval(livePriceTimer);
  if (!coinbaseFeed && window.BunCoinbaseFeed) coinbaseFeed = new window.BunCoinbaseFeed({
    onPrice:(symbol,price,time) => { if (!demoMarketEnabled) { acceptPrice(symbol,price,time); if(window.lastCandles?.length) redrawChart(); } },
    onStatus:status => setText("feedStatus",status)
  });
  updateLivePrice();
  livePriceTimer = setInterval(updateLivePrice,15000);
  if (candleRefreshTimer) clearInterval(candleRefreshTimer);
  candleRefreshTimer = setInterval(() => { if (Trading.validSymbol(selectedSymbol())) analyze(true); },60000);
}

async function askBunAI(message, context = {}) {
  if (!MARKET_ENGINE_URL) {
    return { text: getBunReply(message) };
  }
  const response = await fetch(`${MARKET_ENGINE_URL.replace(/\/$/, "")}/../ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: `${message}\n\nMarket context: ${JSON.stringify(context)}` }] })
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") throw new Error(data.message || "BunAI is unavailable.");
  return data;
}

function getCurrentPrice(symbol = position?.symbol || selectedSymbol()) {
  const quote = quoteCache.get(symbol);
  return quote && quote.source === marketSource() && Date.now() - quote.time <= QUOTE_MAX_AGE ? quote.price : null;
}
function getDisplayedPrice() { return getCurrentPrice(selectedSymbol()); }
function openPaperPosition(side) {
  if (stateBlocked) return setText("reason", "Saved state needs recovery. Export your backup, then reset before trading.");
  if (position) {
    if (position.side === side) return setText("reason", `You already have an open ${side} position.`);
    return closePaperPosition(getCurrentPrice(position.symbol));
  }
  try {
    const symbol = selectedSymbol(), price = getCurrentPrice(symbol);
    if (!Trading.positive(price) || !lastAnalysis || lastAnalysis.ticker !== symbol || lastAnalysis.source !== marketSource() || Date.now() - lastAnalysis.timestamp > ANALYSIS_MAX_AGE) throw new Error("Analyze this symbol and obtain a fresh quote before trading.");
    const amount = Number(document.getElementById("paperTradeAmount")?.value);
    if (!Trading.positive(amount) || amount * (1 + Trading.FEE) > tradingBalance) throw new Error("Enter a positive amount within your balance, including the entry fee.");
    const entry = Trading.fill(price,side,true);
    position = { ...Trading.levels(side,entry,lastAnalysis), amount, symbol, source:marketSource(), entryFee:amount * Trading.FEE };
    tradingBalance -= amount + position.entryFee;
    setText("position", `${side} ${symbol} @ ${formatMoney(entry)}`);
    syncPaperBalance(); updatePaperPL(price,symbol,marketSource());
    setText("reason", `${side} paper position opened. Fees and adverse slippage apply.`);
    if(window.lastCandles?.length) redrawChart();
    saveGameState();
  } catch(error) { setText("reason",error.message); }
}
function syncPaperBalance() {
  setText("tradingBalance",formatMoney(tradingBalance)); setText("paperBalance",formatMoney(tradingBalance));
}
function paperBuy() { openPaperPosition("LONG"); }
function paperSell() { openPaperPosition("SHORT"); }
function closePaperPosition(price, closeReason = "MANUAL") {
  if (!position || !Trading.positive(price)) return setText("reason","A fresh quote for the position symbol is required to close.");
  const closed = position;
  const result = Trading.settlement(closed,price);
  // Preserve the ledger, including negative equity after extreme short gaps.
  tradingBalance += result.returned;
  tradeHistory.push({ side:closed.side,symbol:closed.symbol,entry:closed.entry,exit:result.exit,amount:closed.amount,profit:result.profit,fees:result.fees,reason:closeReason,time:new Date().toISOString() });
  position = null;
  syncPaperBalance(); setText("position","NONE");
  setText("paperPL",`${result.profit >= 0 ? "+" : "-"}${formatMoney(Math.abs(result.profit))}`);
  setText("paperPLMessage",`${closeReason}: net ${formatMoney(result.profit)} after fees. Filled at observed price with slippage.`);
  setText("reason",`${closed.side} ${closed.symbol} closed: ${closeReason}.`);
  renderTradeHistory(); updateConfidence(); updateLevel(); updateProfile(); updateAchievements();
  if(window.lastCandles?.length) redrawChart();
  saveGameState();
}

function updatePotentialRiskReward() {
  const entry = Number(window.lastEntry);
  const stop = Number(window.lastStop);
  const target = Number(window.lastTarget);
  const tradeAmount = Number(document.getElementById("paperTradeAmount")?.value);

  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stop) ||
    !Number.isFinite(target) ||
    !Number.isFinite(tradeAmount) ||
    tradeAmount <= 0 ||
    entry <= 0
  ) {
    setText("potentialLoss", "—");
    setText("potentialProfit", "—");
    return;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);

  const potentialLoss = tradeAmount * (risk / entry) + tradeAmount * 2 * (Trading.FEE + Trading.SLIPPAGE);
  const potentialProfit = tradeAmount * (reward / entry) - tradeAmount * 2 * (Trading.FEE + Trading.SLIPPAGE);

  setText("potentialLoss", "-" + formatMoney(potentialLoss));
  setText("potentialProfit", "+" + formatMoney(potentialProfit));
}

function updatePaperPL(price, symbol, source) {
  if (!Trading.positive(price) || !position || symbol !== position.symbol || source !== position.source) return;
  const result = Trading.settlement(position,price);
  setText("paperCurrentPrice",formatMoney(price));
  setText("paperPL",`${result.profit >= 0 ? "+" : "-"}${formatMoney(Math.abs(result.profit))}`);
  setText("paperPLPercent",`${(result.profit / position.amount * 100).toFixed(2)}%`);
  const stop = position.side === "SHORT" ? price >= position.stop : price <= position.stop;
  const target = position.side === "SHORT" ? price <= position.target : price >= position.target;
  if (stop || target) return closePaperPosition(price,stop ? "STOP LOSS" : "TAKE PROFIT");
  if (result.returned <= 0) return closePaperPosition(price,"COLLATERAL EXHAUSTED");
  setText("paperPLMessage",`${position.symbol}: estimated net P/L after fees and slippage. Browser must remain open for exits.`);
}

function updateConfidence() {
  if (!tradeHistory.length) {
    setText("confidenceText", "50%");
    const bar = document.getElementById("confidenceBar");
    if (bar) bar.style.width = "50%";
    return;
  }
  const wins = tradeHistory.filter(trade => trade.profit > 0).length;
  const winRate = wins / tradeHistory.length;
  const confidence = Math.max(10, Math.min(95, Math.round(40 + winRate * 55)));
  setText("confidenceText", confidence + "%");
  const bar = document.getElementById("confidenceBar");
  if (bar) bar.style.width = confidence + "%";
}

function updateLevel() {
  xp = tradeHistory.length * 25;
  let level = "Rookie";
  if (xp >= 100) level = "Trader";
  if (xp >= 250) level = "Hunter";
  if (xp >= 500) level = "Elite";
  if (xp >= 1000) level = "Market Beast";
  if (xp >= 2000) level = "Wall Street Legend";
  setText("xp", xp + " XP");
  setText("level", level);
  setText("profileLevel", level);
}

function calculateRank() {
  if (xp >= 2000) return "DIAMOND";
  if (xp >= 1000) return "PLATINUM";
  if (xp >= 500) return "GOLD";
  if (xp >= 250) return "SILVER";
  return "BRONZE";
}
function updateRank() {
  const rank = calculateRank();
  setText("rankName", rank);
  setText("profileRank", rank);
  const rankIcon = document.getElementById("rankIcon");
  if (rankIcon) {
    const icons = { BRONZE: "🥉", SILVER: "🥈", GOLD: "🥇", PLATINUM: "💎", DIAMOND: "💠" };
    const img = rankIcon.querySelector("img");
    if (img && ["GOLD","PLATINUM","DIAMOND"].includes(rank)) { img.src = `assets/rank_${rank.toLowerCase()}.webp`; img.alt = `${rank} Bun rank`; }
    else rankIcon.textContent = icons[rank];
  }
  const profileImg = document.getElementById("profileAvatarImage");
  if (profileImg && !localStorage.getItem("bunmoney_pfp_asset")) {
    profileImg.src = DEFAULT_PFP_URL;
  }
}
function updateRewards() { setText("rewardPoints", rewardPoints); }

function updateRiskGuardian() {
  if (!lastAnalysis) return;
  let risk = 50;
  if (lastAnalysis.rr >= 2) risk -= 15;
  if (lastAnalysis.volumeRatio >= 1.5) risk -= 10;
  if (lastAnalysis.rsi > 75 || lastAnalysis.rsi < 25) risk += 15;
  if (lastAnalysis.decision === "WAIT") risk += 15;
  risk = Math.max(5, Math.min(95, risk));
  setText("riskText", risk + "%");
  const bar = document.getElementById("riskBar");
  if (bar) bar.style.width = risk + "%";
  setText("riskMessage", risk >= 70
    ? "High-risk setup. Wait for stronger confirmation."
    : risk >= 45
      ? "Moderate risk. Manage position size carefully."
      : "Risk conditions look relatively controlled.");
}

function checkAlerts() {
  const container = document.getElementById("alerts");
  if (!container || !lastAnalysis) return;
  const alerts = [];
  if (lastAnalysis.volumeRatio >= 2) alerts.push({ type: "good", text: "🔥 Volume spike detected." });
  if (lastAnalysis.breakout === "POSSIBLE BREAKOUT") alerts.push({ type: "good", text: "🚀 Price is pushing through recent resistance." });
  if (lastAnalysis.retest === "RETEST AREA") alerts.push({ type: "warning", text: "🎯 Retest area detected. Watch price reaction." });
  if (lastAnalysis.rsi > 75) alerts.push({ type: "danger", text: "⚠️ RSI is highly elevated." });
  if (lastAnalysis.rsi < 25) alerts.push({ type: "warning", text: "⚠️ RSI is deeply oversold." });
  if (!alerts.length) {
    container.innerHTML = `<div class="alert empty">No major alerts right now.</div>`;
    return;
  }
  container.innerHTML = alerts.map(alert => `<div class="alert ${alert.type}">${alert.text}</div>`).join("");
}

function startAlertMonitor() {
  setInterval(() => {
    if (lastAnalysis && Date.now() - lastAnalysis.timestamp < 120000) {
      checkAlerts(); updateRiskGuardian();
    }
  }, 30000);
}

function startArcadeBank() {
  if (arcadeTimer) clearInterval(arcadeTimer);
  arcadeTimer = setInterval(() => { arcadeBank += 1; updateArcadeBank(); }, 60000);
}
function updateArcadeBank() { setText("bankBalance", arcadeBank.toFixed(2)); }
function playArcade(game) {
  const rewards = { coin: 5, runner: 10, target: 15, memory: 20 };
  const reward = rewards[game] || 5;
  rewardPoints += reward; updateRewards();
  const names = { coin: "Coin Grab", runner: "Bun Runner", target: "Bullseye", memory: "Market Memory" };
  showPopup(names[game] || "Arcade", `You earned ${reward} reward points!`);
}
function transferArcadeMoney() {
  if (arcadeBank <= 0) {
    showPopup("Arcade Bank", "You don't have anything to transfer yet.");
    return;
  }
  tradingBalance += arcadeBank; arcadeBank = 0; updateArcadeBank();
  setText("tradingBalance", formatMoney(tradingBalance));
  showPopup("Transfer Complete", "Your arcade money was moved into your paper-trading balance.");
}

const bots = {
  BunBot: { name: "BunBot", message: "Balanced market analysis and risk awareness." },
  AlphaBot: { name: "AlphaBot", message: "Momentum-focused analysis." },
  SniperBot: { name: "SniperBot", message: "Waits for precise breakout and retest conditions." },
  ScalperBot: { name: "ScalperBot", message: "Focused on short-term price movement." },
  MoonBot: { name: "MoonBot", message: "Aggressive speculative analysis. High risk." },
};
function selectBot(botName) {
  if (!bots[botName]) return;
  activeBot = botName;
  const bot = bots[botName];
  setText("activeBot", bot.name); setText("botMessage", bot.message);
  showPopup(bot.name, bot.message);
}

async function scanMarket() {
  const symbols = bunFavorites.slice(0,10);
  const container = document.getElementById("scanner");
  if (!container) return;
  container.innerHTML = `<div class="alert empty">Scanning watchlist...</div>`;
  const results = [];
  for (const symbol of symbols) {
    try {
      if (!MARKET_ENGINE_URL && !demoMarketEnabled) throw new Error("Market data is not configured");
      const data = await marketEngineRequest("/price", { symbol });
      if (data.price && Number.isFinite(Number(data.price))) results.push({ symbol, price: Number(data.price) });
    } catch (error) { console.log("Scanner error:", symbol); }
  }
  if (!results.length) {
    container.innerHTML = `<div class="alert empty">Scanner unavailable right now.</div>`;
    return;
  }
  container.innerHTML = results.map(result => `<div class="feature-card"><strong>${result.symbol}</strong><p>${formatMoney(result.price)}</p></div>`).join("");
}

/* Recent market spikes: observed provider candles, never invented market events.
   Detection timestamp is local scan time, not the precise time of a price jump. */
const BUN_SPIKE_THRESHOLD = 1.5;
const BUN_SPIKE_CANDLE_COUNT = 30;
const BUN_SPIKE_SCAN_LIMIT = 8;
let spikeScanBusy = false;
let spikeDetections = [];

function spikeTimeAgo(time) {
  const secs = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (secs < 60) return secs + " seconds ago";
  if (secs < 3600) return Math.floor(secs / 60) + " minutes ago";
  return Math.floor(secs / 3600) + " hours ago";
}
function renderSpikes() {
  const container = document.getElementById("spikeResults");
  if (!container) return;
  container.replaceChildren();
  if (!spikeDetections.length) {
    const empty = document.createElement("div");
    empty.className = "spike-empty";
    empty.textContent = "No spikes detected among the checked favorites. Try again later or add other markets.";
    container.append(empty);
    return;
  }
  for (const spike of spikeDetections) {
    const card = document.createElement("article");
    card.className = "spike-card " + (spike.change >= 0 ? "spike-up" : "spike-down");
    const top = document.createElement("div");
    top.className = "spike-top";
    const market = document.createElement("strong");
    market.textContent = spike.symbol;
    const move = document.createElement("strong");
    move.className = "spike-move";
    move.textContent = (spike.change >= 0 ? "+" : "") + spike.change.toFixed(2) + "% " + (spike.change >= 0 ? "▲ Spike" : "▼ Drop");
    top.append(market,move);
    const info = document.createElement("p");
    info.textContent = "5-minute candle: " + formatMoney(spike.previous) + " → " + formatMoney(spike.close);
    const timestamp = document.createElement("p");
    timestamp.className = "spike-time";
    timestamp.textContent = "Detected " + spikeTimeAgo(spike.detectedAt) + " · Candle: " + spike.candleTime + " (provider time)";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "View " + spike.symbol + " chart →";
    button.dataset.action = "viewSpikeMarket";
    button.dataset.symbol = spike.symbol;
    card.append(top,info,timestamp,button);
    container.append(card);
  }
}
async function scanSpikes() {
  if (spikeScanBusy) return;
  const status = document.getElementById("spikeStatus");
  const btn = document.getElementById("scanSpikesButton");
  const symbols = [...new Set(bunFavorites.filter(Trading.validSymbol))].slice(0,BUN_SPIKE_SCAN_LIMIT);
  if (!symbols.length) {
    spikeDetections = []; renderSpikes();
    if (status) status.textContent = "No favorites yet. Save a ticker to start scanning.";
    return;
  }
  spikeScanBusy = true;
  if (btn) btn.disabled = true;
  if (status) status.textContent = "Checking " + symbols.length + " favorite markets…";
  const detections = [];
  let completed = 0, failed = 0;
  try {
    // Sequential requests reduce the chance of hitting a provider credit burst.
    for (const symbol of symbols) {
      try {
        const data = await marketEngineRequest("/time_series", {
          symbol, interval:"5min", outputsize:BUN_SPIKE_CANDLE_COUNT
        });
        if (data.meta?.symbol && String(data.meta.symbol).toUpperCase() !== symbol) throw new Error("Unexpected symbol");
        const candles = Trading.candles(data.values);
        completed++;
        // Restrict to recent candles; provider times can be exchange-local without an offset.
        // Scan the last six 5-minute candles. No false exact-time estimates.
        for (let i = Math.max(1,candles.length-6); i < candles.length; i++) {
          const previous = candles[i-1].close;
          const close = candles[i].close;
          if (!Trading.positive(previous) || !Trading.positive(close)) continue;
          const change = ((close - previous) / previous) * 100;
          if (Math.abs(change) < BUN_SPIKE_THRESHOLD) continue;
          detections.push({ symbol, previous, close, change,
            candleTime:String(candles[i].datetime), detectedAt:Date.now(),
            source: demoMarketEnabled ? "demo" : "live" });
        }
      } catch (error) { failed++; }
    }
    detections.sort((a,b) => Math.abs(b.change)-Math.abs(a.change));
    spikeDetections = detections.slice(0,20);
    renderSpikes();
    if (status) status.textContent = (demoMarketEnabled ? "SIMULATED data · " : "") +
      completed + " checked, " + failed + " unavailable · " + detections.length +
      " unusual candle moves found (±" + BUN_SPIKE_THRESHOLD + "% threshold). " +
      "Checked " + new Date().toLocaleTimeString() + ".";
  } finally {
    spikeScanBusy = false;
    if (btn) btn.disabled = false;
  }
}
function viewSpikeMarket(symbol) {
  if (!Trading.validSymbol(symbol)) return;
  analyzeTicker(symbol);
  document.getElementById("homeSearch")?.scrollIntoView({behavior:"smooth",block:"start"});
}
setInterval(() => { if (spikeDetections.length) renderSpikes(); },15000);

function startArena() {
  if (arenaRunning) { showPopup("Trading Arena", "The arena is already running."); return; }
  arenaRunning = true;
  let playerScore = 0, aiScore = 0;
  setText("arenaStatus", "MATCH RUNNING"); setText("playerScore", "0"); setText("aiScore", "0");
  if (arenaTimer) clearInterval(arenaTimer);
  arenaTimer = setInterval(() => {
    playerScore += Math.floor(Math.random() * 12);
    aiScore += Math.floor(Math.random() * 10);
    setText("playerScore", playerScore); setText("aiScore", aiScore);
  }, 1500);
  setTimeout(endArena, 15000);
}
function endArena() {
  if (arenaTimer) { clearInterval(arenaTimer); arenaTimer = null; }
  arenaRunning = false; setText("arenaStatus", "MATCH COMPLETE");
  const player = Number(document.getElementById("playerScore")?.textContent || 0);
  const ai = Number(document.getElementById("aiScore")?.textContent || 0);
  if (player > ai) {
    rewardPoints += 50; updateRewards();
    showPopup("🏆 Victory!", "You beat the AI and earned 50 reward points.");
  } else {
    rewardPoints += 10; updateRewards();
    showPopup("Arena Complete", "You earned 10 reward points. Train and come back stronger.");
  }
}

function sendChat() {
  const input = document.getElementById("chatInput");
  const output = document.getElementById("chatMessages");
  if (!input || !output) return;
  const message = input.value.trim();
  if (!message) return;
  output.innerHTML += `<div class="feature-card"><strong>You</strong><p>${escapeHTML(message)}</p></div>`;
  input.value = "";
  const reply = getBunReply(message);
  setTimeout(() => {
    output.innerHTML += `<div class="feature-card"><strong>🐰 BunBot</strong><p>${reply}</p></div>`;
    output.scrollTop = output.scrollHeight;
  }, 350);
}
function getBunReply(message) {
  const text = message.toLowerCase();
  if (text.includes("buy")) return "Don't chase the move. Check trend, support, resistance, volume, and confirmation first.";
  if (text.includes("sell")) return "Before selling, know why you're selling and where your invalidation level is.";
  if (text.includes("bitcoin") || text.includes("crypto")) return "Crypto can move extremely fast. Risk management matters even more.";
  if (text.includes("gold")) return "Gold can react quickly to USD, rates, economic data, and market sentiment.";
  if (text.includes("help")) return "I'm here. Analyze first, wait for confirmation, then decide.";
  return "Bun says: think first, trade second. 🐰";
}
function escapeHTML(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const DEFAULT_PFP_URL = "https://i.ibb.co/d4TvJ1hJ/bunmoney-bun-pfp.png";

const BUN_ASSETS = {
  pfp: { happy: "assets/pfs_happy.webp", serious: "assets/pfs_serious.webp", chill: "assets/pfs_chill.webp", focused: "assets/pfs_focused.webp", confident: "assets/pfs_confident.webp", rich: "assets/pfs_rich.webp" },
  frame: { default: "assets/frame_default.webp", glow: "assets/frame_glow.webp", neon: "assets/frame_neon.webp", animated: "assets/frame_animated.webp", streak: "assets/frame_streak.webp", elite: "assets/frame_elite.webp", legendary: "assets/frame_legendary.webp" },
  background: { charts: "assets/bg_charts.webp", city: "assets/bg_city.webp", money: "assets/bg_money.webp", neon: "assets/bg_neon.webp", abstract: "assets/bg_abstract.webp", graffiti: "assets/bg_graffiti.webp", nature: "assets/bg_nature.webp", black: "assets/bg_black.webp" }
};
function setPfpAsset(name) {
  const src = BUN_ASSETS.pfp[name]; if (!src) return;
  const img = document.getElementById("profileAvatarImage");
  if (img) {
    img.onerror = () => { img.onerror = null; img.src = DEFAULT_PFP_URL; };
    img.src = src;
  }
  localStorage.setItem("bunmoney_pfp_asset", name);
  showPopup("🐰 PFP Updated", `${name.replaceAll("_", " ")} Bun is now your profile vibe.`);
}
function setFrameAsset(name) {
  const src = BUN_ASSETS.frame[name]; if (!src) return;
  const frame = document.getElementById("profileFrameImage"); if (frame) frame.src = src;
  localStorage.setItem("bunmoney_frame_asset", name);
}
function setPfpBackground(name) {
  const src = BUN_ASSETS.background[name]; if (!src) return;
  const avatar = document.getElementById("profileAvatar"); if (!avatar) return;
  avatar.style.backgroundImage = `url("${src}")`; avatar.style.backgroundSize = "cover"; avatar.style.backgroundPosition = "center";
  localStorage.setItem("bunmoney_bg_asset", name);
}
function restoreBunAssets() {
  const pfp = localStorage.getItem("bunmoney_pfp_asset");
  const profileImg = document.getElementById("profileAvatarImage");
  if (profileImg) {
    profileImg.onerror = () => { profileImg.onerror = null; profileImg.src = DEFAULT_PFP_URL; };
    profileImg.src = (pfp && BUN_ASSETS.pfp[pfp]) ? BUN_ASSETS.pfp[pfp] : DEFAULT_PFP_URL;
  }
  const avatar = document.getElementById("profileAvatar");
  const frame = localStorage.getItem("bunmoney_frame_asset");
  const bg = localStorage.getItem("bunmoney_bg_asset");
  const frameImg = document.getElementById("profileFrameImage");
  if (frameImg && frame && BUN_ASSETS.frame[frame]) frameImg.src = BUN_ASSETS.frame[frame];
  if (avatar && bg && BUN_ASSETS.background[bg]) { avatar.style.backgroundImage=`url("${BUN_ASSETS.background[bg]}")`; avatar.style.backgroundSize="cover"; avatar.style.backgroundPosition="center"; }
}

function setTheme(theme) {
  const root = document.documentElement;
  const themes = {
    default: { lime: "#a3e635", bg: "#090b10" },
    ocean: { lime: "#38bdf8", bg: "#061018" },
    purple: { lime: "#c084fc", bg: "#100914" },
    gold: { lime: "#facc15", bg: "#110f06" },
    red: { lime: "#fb7185", bg: "#120708" }
  };
  const selected = themes[theme];
  if (!selected) return;
  root.style.setProperty("--lime", selected.lime);
  root.style.setProperty("--bg", selected.bg);
}
function setMascot(emoji) {
  document.querySelectorAll(".bun-character").forEach(element => {
    const image = element.querySelector("#bunCharacterImage");

    if (image) {
      image.src = DEFAULT_PFP_URL;
      image.alt = "";
      image.setAttribute("aria-label", "BunMoney Bun");
      image.onerror = () => {
        image.onerror = null;
        image.src = DEFAULT_PFP_URL;
      };

      element.dataset.mascot = emoji;
    }
  });

  document.querySelectorAll(".profile-avatar").forEach(element => {
    const image = element.querySelector("#profileAvatarImage");

    if (image) {
      image.alt = "";
      image.setAttribute("aria-label", "Bun profile avatar");
      image.onerror = () => {
        image.onerror = null;
        image.src = DEFAULT_PFP_URL;
      };
    }
  });

  localStorage.setItem("bunmoney_mascot", emoji);
}

function openFeature(feature) {
  const screens = { home: "home", trade: "trade", arcade: "arcade", world: "world", profile: "profile" };
  if (screens[feature]) { showScreen(screens[feature]); return; }
  const messages = {
    chat: "Market Chat is coming soon.",
    arena: "Trading Arena is ready to test.",
    bots: "AI Bots are available in the Trade area.",
    marketplace: "Marketplace is coming soon.",
    social: "Social Lounge is coming soon."
  };
  showPopup("BunMoney", messages[feature] || "Feature coming soon.");
}
const quotes = [
  "Patience is a position too.", "Think first. Trade second.", "Small wins stack up.", "Protect the bag.",
  "The market doesn't care about your feelings.", "Your next trade isn't your last trade.", "Don't chase the candle.",
  "Wait for confirmation.", "Risk management comes first.", "Bun says: protect the bag. 🐰"
];
function rotateQuote() {
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  setText("quote", quote);
}
function mascotReaction(message) {
  setText("mascotMessage", message);

  const mascot = document.querySelector(".bun-character");
  const image = document.getElementById("bunCharacterImage");

  // Keep the official hosted Bun PFP as the permanent image.
  // Do not swap it for local reaction assets that CodePen may not have.
  if (image) {
    image.src = DEFAULT_PFP_URL;
    image.alt = "";
    image.setAttribute("aria-label", "BunMoney Bun");

    // If anything ever breaks the image, immediately restore it.
    image.onerror = () => {
      image.onerror = null;
      image.src = DEFAULT_PFP_URL;
    };
  }

  // Wiggle the existing PFP instead of replacing the image.
  if (mascot) {
    mascot.classList.remove("react");
    void mascot.offsetWidth;
    mascot.classList.add("react");

    setTimeout(() => {
      mascot.classList.remove("react");
    }, 900);
  }
}

function updateProfile() {
  setText("profileBalance", formatMoney(tradingBalance));
  setText("profileTrades", tradeHistory.length);
  const wins = tradeHistory.filter(trade => trade.profit > 0).length;
  const winRate = tradeHistory.length ? Math.round((wins / tradeHistory.length) * 100) : 0;
  setText("profileWinRate", winRate + "%");
  updateRank();
}
function updateAchievements() {
  const container = document.getElementById("achievements");
  if (!container) return;
  const achievements = [];
  if (tradeHistory.length >= 1) achievements.push("🐣 First Paper Trade");
  if (tradeHistory.length >= 5) achievements.push("📈 5 Trades");
  if (tradeHistory.filter(t => t.profit > 0).length >= 3) achievements.push("🔥 Three Wins");
  if (xp >= 250) achievements.push("🥈 Silver Trader");
  if (xp >= 500) achievements.push("🥇 Gold Trader");
  if (xp >= 1000) achievements.push("💎 Platinum Trader");
  if (xp >= 2000) achievements.push("💠 Diamond Trader");
  if (!achievements.length) achievements.push("🔒 Your first achievement is waiting.");
  container.innerHTML = achievements.map(achievement => `<div>${achievement}</div>`).join("");
}
function saveGameState() {
  if (stateBlocked) return;
  try {
    localStorage.setItem("bunmoney_state", JSON.stringify({ tradingBalance, tradeHistory, position, rewardPoints, arcadeBank, activeBot }));
  } catch (error) { console.log("Could not save BunMoney state."); }
}
function loadGameState() {
  try {
    const saved = localStorage.getItem("bunmoney_state");
    if (!saved) return;
    const state = Trading.state(JSON.parse(saved));
    ({ tradingBalance, tradeHistory, position, rewardPoints, arcadeBank, activeBot } = state);
    if (position) {
      demoMarketEnabled = position.source === "demo";
      const ticker = document.getElementById("ticker"); if (ticker) ticker.value = position.symbol;
    }
  } catch { stateBlocked = true; setText("reason","Saved state is invalid or from an older simulator. Export it before resetting; trading is locked."); }
}

document.addEventListener("DOMContentLoaded", () => {
  loadGameState();

  const paperTradeAmount = document.getElementById("paperTradeAmount");
  if (paperTradeAmount) {
    paperTradeAmount.addEventListener("input", updatePotentialRiskReward);
  }

  loadDemoSettings();
  if (position) demoMarketEnabled = position.source === "demo";
  document.getElementById("ticker")?.addEventListener("input",invalidateAnalysis);
  startLivePrice();
  startAlertMonitor();
  updateConfidence();
  syncPaperBalance();
  setText(
  "position",
  position
    ? `${position.side} @ ${formatMoney(position.entry)}`
    : "NONE"
);
  setText("arenaStatus", "READY");
  mascotReaction("Protect the bag. 🥕💰");
  const savedMascot = localStorage.getItem("bunmoney_mascot");
  if (savedMascot) setMascot(savedMascot);
  const closeButton = document.querySelector(".popup-close");
  if (closeButton) closeButton.addEventListener("click", closePopup);
  const popup = document.getElementById("popup");
  if (popup) popup.addEventListener("click", event => { if (event.target === popup) closePopup(); });
  setInterval(saveGameState, 10000);
});

window.addEventListener("resize", () => {
  if (window.lastCandles && window.lastCandles.length) {
    drawChart(window.lastCandles, window.lastSupport, window.lastResistance, window.lastEntry, window.lastStop, window.lastTarget, window.lastBreakoutIndex, window.lastRetestIndex, window.lastSma10, window.lastSma20);
  }
});

/* FAVORITES + CHART COPILOT */
const BUN_FAVORITES_KEY = "bunmoney_favorites";
let bunFavorites = ["GRAB", "SOUN", "BBAI"];
let favoritesTimer = null;

function loadFavorites() {
  try {
    const saved = localStorage.getItem(BUN_FAVORITES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) bunFavorites = [...new Set(parsed.filter(Trading.validSymbol))].slice(0,50);
    }
  } catch (error) { console.log("Could not load favorites."); }
}
function saveFavorites() {
  try { localStorage.setItem(BUN_FAVORITES_KEY, JSON.stringify(bunFavorites)); }
  catch (error) { console.log("Could not save favorites."); }
}
function openChartFavorites() {
  const overlay = document.getElementById("chartFavoritesOverlay");
  if (!overlay) return;
  renderFavorites();
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}
function closeChartFavorites() {
  const overlay = document.getElementById("chartFavoritesOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

function createFavoritesScreen() {
  if (document.getElementById("favoritesScreen")) return;
  const screen = document.createElement("section");
  screen.id = "favoritesScreen"; screen.className = "screen";
  screen.innerHTML = `
    <div class="section-title">
      <h2>⭐ Favorite Markets</h2>
      <p>Keep an eye on your markets while analyzing another chart.</p>
    </div>
    <div id="favoritesList"></div>
    <div class="favorites-add">
      <input id="favoriteInput" type="text" maxlength="30" placeholder="e.g. AAPL" aria-label="Add market ticker">
      <button data-action="addFavorite">+ Add favorite</button>
       <p id="favoriteFeedback" role="status" aria-live="polite"></p>
    </div>`;
  const app = document.querySelector(".app") || document.body;
  if (app) app.appendChild(screen);
  renderFavorites();
}
function createFavoritesNav() {
  const nav = document.querySelector(".main-nav");
  if (!nav || nav.querySelector('[data-screen="favoritesScreen"]')) return;
  const button = document.createElement("button");
  button.className = "nav-button"; button.dataset.screen = "favoritesScreen"; button.textContent = "⭐ Favorites";
  button.addEventListener("click", () => { showScreen("favoritesScreen"); updateFavorites(true); });
  nav.appendChild(button);
}
let favoritePending = false;
function favoriteFeedback(text) { setText("favoriteFeedback", text); }
async function addFavorite(fromChart = null) {
  if (favoritePending) return;
  const input = document.getElementById("favoriteInput");
  const symbol = String(fromChart || input?.value || "").trim().toUpperCase();
  if (!Trading.validSymbol(symbol)) return favoriteFeedback("Enter a valid symbol, like AAPL or BTC/USD.");
  if (bunFavorites.includes(symbol)) return favoriteFeedback(symbol + " is already in Favorites.");
  if (bunFavorites.length >= 50) return favoriteFeedback("Favorites is limited to 50 symbols.");
  favoritePending = true;
  favoriteFeedback("Checking " + symbol + "...");
  try {
    if (!demoMarketEnabled) {
      const quote = await marketEngineRequest("/price", { symbol });
      if (!Trading.positive(Number(quote.price)) ||
          (quote.symbol && String(quote.symbol).toUpperCase() !== symbol))
        throw new Error("Ticker not recognized by the provider.");
    }
    bunFavorites.push(symbol);
    saveFavorites();
    if (input) input.value = "";
    renderFavorites();
    favoriteFeedback(symbol + " saved." + (demoMarketEnabled ? " Demo quotes are simulated." : ""));
    updateFavorites(true);
  } catch(error) {
    favoriteFeedback("Could not add " + symbol + ": " + (error.message || "Provider unavailable"));
  } finally { favoritePending = false; }
}
function addCurrentFavorite() { addFavorite(selectedSymbol()); }
function removeFavorite(symbol) {
  bunFavorites = bunFavorites.filter(item => item !== symbol);
  favoriteDetailsCache.delete(symbol);
  saveFavorites(); renderFavorites(); mascotReaction(`${symbol} removed from favorites. 🐰`);
}
function focusAnalyzer() {
  const ticker = document.getElementById("ticker");
  if (ticker) {
    ticker.focus();
    ticker.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function analyzeTicker(symbol) {
  const ticker = document.getElementById("ticker");
  if (!ticker) return;
  ticker.value = String(symbol).toUpperCase();
  showScreen("home");
  mascotReaction(`Checking ${String(symbol).toUpperCase()}. Let's see what the market is doing. 🐰`);
  analyze(true);
}
function updateHomeMarketCard(symbol, price, changePercent) {
  const priceElement = document.getElementById(`favPrice${symbol}`);
  const changeElement = document.getElementById(`favChange${symbol}`);
  if (priceElement && Number.isFinite(Number(price))) priceElement.textContent = formatMoney(price);
  if (changeElement && Number.isFinite(Number(changePercent))) {
    changeElement.textContent = `${changePercent >= 0 ? "+" : ""}${Number(changePercent).toFixed(2)}%`;
    changeElement.style.color = changePercent >= 0 ? "#22c55e" : "#ef4444";
  }
}

function openFavorite(symbol) {
  const ticker = document.getElementById("ticker");
  if (!ticker) return;
  ticker.value = symbol;
  showScreen("home");
  mascotReaction(`Watching ${symbol}. Let's see what the market is doing. 🐰`);
  analyze(true);
}
const favoriteDetailsCache = new Map();
const FAVORITE_DETAILS_TTL = 15 * 60 * 1000;
let favoriteUpdatesRunning = false;

function renderFavoriteDetails(symbol, snapshot) {
  if (!bunFavorites.includes(symbol) || !snapshot) return;
  const field = (part, value) => setText(`favorite-${part}-${symbol}`, value);
  field("price", snapshot.price != null ? formatMoney(snapshot.price) : "—");
  field("change", snapshot.change == null ? "—" : `${snapshot.change >= 0 ? "+" : ""}${snapshot.change.toFixed(2)}%`);
  field("trend", snapshot.trend || "—");
  field("volume", snapshot.volume || "—");
  field("setup", snapshot.setup || "—");
  field("support", snapshot.support != null ? formatMoney(snapshot.support) : "—");
  field("resistance", snapshot.resistance != null ? formatMoney(snapshot.resistance) : "—");
  field("status", snapshot.error ? "Data unavailable · " + snapshot.error : 
    (snapshot.source === "demo" ? "Simulated data" : "Updated " + new Date(snapshot.fetchedAt).toLocaleTimeString()));
  const move = document.getElementById(`favorite-change-${symbol}`);
  if (move) move.style.color = snapshot.change == null ? "" : snapshot.change >= 0 ? "#a3e635" : "#fb7185";
}
function renderFavorites() {
  const container = document.getElementById("favoritesList") || document.getElementById("chartFavoritesList");
  if (!container) return;
  if (!bunFavorites.length) {
    container.innerHTML = '<div class="alert empty">No favorite markets yet. Add a ticker below.</div>';
    return;
  }
  container.innerHTML = bunFavorites.filter(Trading.validSymbol).map(symbol => `
    <article class="favorite-market" id="favorite-${symbol}">
      <div class="favorite-top">
        <div class="favorite-heading"><strong>⭐ ${symbol}</strong><span class="favorite-price" id="favorite-price-${symbol}">—</span></div>
        <button type="button" class="favorite-remove" data-action="removeFavorite" data-symbol="${symbol}" aria-label="Remove ${symbol} from favorites">×</button>
      </div>
      <div class="favorite-stats">
        <div><span>5m move</span><strong id="favorite-change-${symbol}">—</strong></div>
        <div><span>Trend</span><strong id="favorite-trend-${symbol}">—</strong></div>
        <div><span>Volume ratio</span><strong id="favorite-volume-${symbol}">—</strong></div>
        <div><span>Setup</span><strong id="favorite-setup-${symbol}">—</strong></div>
      </div>
      <div class="favorite-levels">
        <span>Support <strong id="favorite-support-${symbol}">—</strong></span>
        <span>Resistance <strong id="favorite-resistance-${symbol}">—</strong></span>
      </div>
      <p class="favorite-status" id="favorite-status-${symbol}">Checking market data…</p>
      <button type="button" class="favorite-open" data-action="openFavorite" data-symbol="${symbol}">View ${symbol} chart →</button>
    </article>`).join("");
  for (const symbol of bunFavorites) {
    if (favoriteDetailsCache.has(symbol)) renderFavoriteDetails(symbol, favoriteDetailsCache.get(symbol));
  }
}
async function fetchFavoriteDetails(symbol) {
  const quote = await marketEngineRequest("/price", { symbol });
  if (!Trading.positive(Number(quote.price)) ||
      (quote.symbol && String(quote.symbol).toUpperCase() !== symbol))
    throw new Error("Quote unavailable");
  const series = await marketEngineRequest("/time_series", {symbol,interval:"5min",outputsize:30});
  if (series.meta?.symbol && String(series.meta.symbol).toUpperCase() !== symbol)
    throw new Error("Mismatched market data");
  const candles = Trading.candles(series.values);
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const last = closes.at(-1), previous = closes.at(-2);
  const price = Number(quote.price);
  const sma10 = calculateSMA(closes,10).at(-1);
  const sma20 = calculateSMA(closes,20).at(-1);
  const trend = price > sma10 && sma10 > sma20 ? "BULLISH" :
                price < sma10 && sma10 < sma20 ? "BEARISH" : "SIDEWAYS";
  const recentVolumes = candles.slice(-21,-1).map(c => c.volume);
  const avgVolume = average(recentVolumes);
  const volumeRatio = avgVolume > 0 ? candles.at(-1).volume / avgVolume : null;
  // Exclude the current candle when checking breakout/breakdown.
  const upper = Math.max(...highs.slice(-21,-1));
  const lower = Math.min(...lows.slice(-21,-1));
  const setup = price > upper ? "POSSIBLE BREAKOUT" :
                price < lower ? "POSSIBLE BREAKDOWN" : "WAIT";
  return {price, change: previous > 0 ? (last-previous)/previous*100 : null,
    trend, volume: volumeRatio == null ? "N/A" : volumeRatio.toFixed(2)+"x",
    setup, support:Math.min(...lows.slice(-20)),
    resistance:Math.max(...highs.slice(-20)),fetchedAt:Date.now(),
    source:demoMarketEnabled ? "demo" : "live"};
}
async function updateFavorites(force = false) {
  if (favoriteUpdatesRunning || !bunFavorites.length) return;
  favoriteUpdatesRunning = true;
  const source = marketSource();
  try {
    // Read from per-symbol cache first to avoid exhausting provider credits.
    for (const symbol of [...bunFavorites]) {
      const cached = favoriteDetailsCache.get(symbol);
      if (cached && cached.source === source && Date.now()-cached.fetchedAt < FAVORITE_DETAILS_TTL) {
        renderFavoriteDetails(symbol,cached);
        continue;
      }
      try {
        const snapshot = await fetchFavoriteDetails(symbol);
        if (source !== marketSource() || !bunFavorites.includes(symbol)) continue;
        favoriteDetailsCache.set(symbol,snapshot);
        renderFavoriteDetails(symbol,snapshot);
        updateHomeMarketCard(symbol,snapshot.price,snapshot.change);
      } catch(error) {
        if (source !== marketSource() || !bunFavorites.includes(symbol)) continue;
        // Keep last good prices visibly marked as stale rather than erasing them.
        const fallback = cached && cached.source === source ? {...cached,error:"Refresh failed",fetchedAt:cached.fetchedAt} :
          {price:null,change:null,trend:"—",volume:"—",setup:"—",support:null,resistance:null,
            error:"Check provider, market hours or API limits",fetchedAt:Date.now(),source};
        renderFavoriteDetails(symbol,fallback);
      }
    }
  } finally { favoriteUpdatesRunning = false; }
}
function updateFavoriteFromAnalysis(symbol, analysis) {
  if (!bunFavorites.includes(symbol)) return;
  const existing = favoriteDetailsCache.get(symbol);
  if (!existing || existing.source !== analysis.source) return;
  // Keep the latest independent snapshot intact. Analysis can refresh the quote
  // but must not replace this symbol's 5-minute metrics with different intervals.
  updateHomeMarketCard(symbol,analysis.currentPrice,existing.change);
  renderFavoriteDetails(symbol,existing);
}
function createChartCopilot() {
  const canvas = document.getElementById("chart");
  if (!canvas) return;
  const chartCard = canvas.closest(".chart-card");
  if (!chartCard || document.getElementById("bunChartCopilot")) return;
  const copilot = document.createElement("div");
  copilot.id = "bunChartCopilot"; copilot.className = "bun-chart-copilot";
  copilot.innerHTML = `<div class="copilot-character">🐰</div><div class="copilot-bubble"><strong>BunAI</strong><p id="chartCopilotMessage">Watching the setup...</p></div>`;
  chartCard.appendChild(copilot);
}

function updateMarketSnapshot() {
  const ids = ["snapshotTicker","snapshotTrend","snapshotVolume","snapshotSupport","snapshotResistance","snapshotSetup","snapshotBias"];
  if (!ids.every(id => document.getElementById(id))) return;
  const fields = ["snapshotTrend","snapshotVolume","snapshotSupport","snapshotResistance","snapshotSetup","snapshotBias"];
  fields.forEach(id => { const el=document.getElementById(id); el.classList.remove("good","bad","warn"); });
  if (!lastAnalysis) {
    setText("snapshotTicker", "—");
    setText("snapshotTrend", "—");
    setText("snapshotVolume", "—");
    setText("snapshotSupport", "—");
    setText("snapshotResistance", "—");
    setText("snapshotSetup", "—");
    setText("snapshotBias", "WAITING");
    return;
  }
  const a = lastAnalysis;
  setText("snapshotTicker", a.ticker);
  setText("snapshotTrend", a.trend || "—");
  setText("snapshotVolume", Number.isFinite(Number(a.volumeRatio)) ? `${Number(a.volumeRatio).toFixed(2)}x` : "—");
  setText("snapshotSupport", formatMoney(a.support));
  setText("snapshotResistance", formatMoney(a.resistance));
  setText("snapshotSetup", a.setupQuality || "—");
  const bias = a.decision && a.decision.includes("LONG") ? "BULLISH" : a.decision && a.decision.includes("SHORT") ? "BEARISH" : (a.trend || "WAITING");
  setText("snapshotBias", bias);
  const trendEl=document.getElementById("snapshotTrend");
  const setupEl=document.getElementById("snapshotSetup");
  const biasEl=document.getElementById("snapshotBias");
  trendEl.classList.add(a.trend === "BULLISH" ? "good" : a.trend === "BEARISH" ? "bad" : "warn");
  setupEl.classList.add(a.setupQuality === "HIGH" ? "good" : a.setupQuality === "LOW" ? "bad" : "warn");
  biasEl.classList.add(bias === "BULLISH" ? "good" : bias === "BEARISH" ? "bad" : "warn");
}

function updateBunAIHome() {
  const status = document.getElementById("bunaiStatus");
  const bias = document.getElementById("bunaiBias");
  const setup = document.getElementById("bunaiSetup");
  const risk = document.getElementById("bunaiRisk");
  if (!status || !bias || !setup || !risk) return;
  [bias, setup, risk].forEach(el => el.className = "bunai-chip neutral");
  if (!lastAnalysis) {
    status.textContent = "STANDBY";
    status.classList.remove("live");
    bias.textContent = "WAITING";
    setup.textContent = "NO SETUP";
    risk.textContent = "RISK —";
    return;
  }
  const a = lastAnalysis;
  status.textContent = "WATCHING";
  status.classList.add("live");
  bias.textContent = a.trend || "NEUTRAL";
  bias.classList.add(a.trend === "BULLISH" ? "good" : a.trend === "BEARISH" ? "bad" : "warn");
  setup.textContent = a.setupQuality ? `${a.setupQuality} SETUP` : "SETUP —";
  setup.classList.add(a.setupQuality === "HIGH" ? "good" : a.setupQuality === "LOW" ? "bad" : "warn");
  const riskScore = Number(document.getElementById("riskBar")?.style.width?.replace("%", ""));
  risk.textContent = Number.isFinite(riskScore) ? `RISK ${Math.round(riskScore)}%` : "RISK —";
  risk.classList.add(riskScore >= 70 ? "bad" : riskScore >= 45 ? "warn" : "good");
}
function updateTradeReadiness() {
  const items = [
    document.getElementById("readyTrend"),
    document.getElementById("readyLevel"),
    document.getElementById("readyVolume"),
    document.getElementById("readyRisk")
  ];
  const scoreEl = document.getElementById("readinessScore");
  if (!items.every(Boolean) || !scoreEl) return;

  items.forEach(item => item.classList.remove("ready", "caution", "blocked"));
  if (!lastAnalysis) {
    scoreEl.textContent = "0/4";
    return;
  }

  const a = lastAnalysis;
  const trendOK = a.trend === "BULLISH" || a.trend === "BEARISH";
  const levelOK = Number.isFinite(Number(a.support)) && Number.isFinite(Number(a.resistance));
  const volumeOK = Number(a.volumeRatio) >= 1.05;
  const riskScore = Number(document.getElementById("riskBar")?.style.width?.replace("%", ""));
  const riskOK = Number.isFinite(riskScore) && riskScore < 70;
  const checks = [trendOK, levelOK, volumeOK, riskOK];
  const details = [
    trendOK ? `${a.trend} trend detected` : "No clear trend",
    levelOK ? `${formatMoney(a.support)} support / ${formatMoney(a.resistance)} resistance` : "Key levels unavailable",
    volumeOK ? `${Number(a.volumeRatio).toFixed(2)}x average volume` : "Volume is not confirming",
    riskOK ? "Risk is within guardian range" : "Risk is elevated — slow down"
  ];
  const labels = ["readyTrend", "readyLevel", "readyVolume", "readyRisk"];

  checks.forEach((ok, i) => {
    const item = items[i];
    item.classList.add(ok ? "ready" : (i === 3 && riskScore >= 70 ? "blocked" : "caution"));
    item.querySelector("span").textContent = ok ? "✓" : "!";
    item.querySelector("small").textContent = details[i];
  });
  scoreEl.textContent = `${checks.filter(Boolean).length}/4`;
}


function updateTradePlan() {
  const direction = document.getElementById("tradePlanDirection");
  const score = document.getElementById("tradePlanScore");
  const entry = document.getElementById("tradePlanEntry");
  const stop = document.getElementById("tradePlanStop");
  const target = document.getElementById("tradePlanTarget");
  const note = document.getElementById("tradePlanNote");

  if (![direction, score, entry, stop, target, note].every(Boolean)) return;

  if (!lastAnalysis) {
    score.textContent = "—";
    direction.textContent = "—";
    entry.textContent = "—";
    stop.textContent = "—";
    target.textContent = "—";
    note.textContent = "Analyze a market to build a trade plan.";
    return;
  }

  const a = lastAnalysis;

score.textContent = `${a.score > 0 ? "+" : ""}${a.score}`;
  const long = String(a.decision || "").includes("LONG");
  const short = String(a.decision || "").includes("SHORT");

  const confirmed =
    (a.breakout === "POSSIBLE BREAKOUT" || a.breakout === "POSSIBLE BREAKDOWN" ||
      a.retest === "RETEST AREA") &&
    Number(a.volumeRatio) >= 1.05;

  const rrGood =
    Number.isFinite(Number(a.rr)) &&
    Number(a.rr) >= 2;

  direction.textContent = long
    ? "LONG WATCH"
    : short
      ? "SHORT WATCH"
      : "NO DIRECTION";

  entry.textContent = formatMoney(a.entry);
  stop.textContent = formatMoney(a.stop);
  target.textContent = formatMoney(a.target);

  const ready = (long || short) && confirmed && rrGood;
  const watch = (long || short) || confirmed;

  note.textContent = ready
    ? `Setup has confirmation and ${Number(a.rr).toFixed(2)}:1 reward-to-risk. Still wait for your own entry trigger before acting.`
    : watch
      ? "A setup may be forming. Wait for confirmation and do not chase."
      : "No clean setup yet. Patience is part of the strategy.";
}

function updateChartCopilot() {
  const message = document.getElementById("chartCopilotMessage");
  if (!message) return;
  if (!lastAnalysis) { message.textContent = "Analyze a market and I'll tell you what I'm watching."; return; }
  const a = lastAnalysis;
  let text = "I'm watching the price action.";
  if (a.retest === "RETEST AREA") text = "Let it retest. Watch how price reacts before considering an entry.";
  else if (a.breakout === "POSSIBLE BREAKOUT") text = "Breakout is forming. Let it prove itself before chasing.";
  else if (a.trend === "BULLISH") text = "Buyers have the edge right now. Watch the next reaction.";
  else if (a.trend === "BEARISH") text = "Sellers have the edge right now. Watch for a reaction.";
  else text = "No clear setup yet. I'm watching for confirmation.";
  message.textContent = text;
}
function createQuickTradeButtons() {
  const canvas = document.getElementById("chart");
  if (!canvas) return;
  const chartCard = canvas.closest(".chart-card");
  if (!chartCard || document.getElementById("chartQuickTrade")) return;
  const controls = document.createElement("div");
  controls.id = "chartQuickTrade"; controls.className = "chart-quick-trade";
  controls.innerHTML = `<button class="quick-buy" data-action="paperBuy">🐰 ↑ BUY</button><button class="quick-sell" data-action="paperSell">↓ SELL 🐰</button>`;
  chartCard.appendChild(controls);
}
function quickCharacterReaction(action) {
  const copilot = document.getElementById("bunChartCopilot");
  if (!copilot) return;
  const character = copilot.querySelector(".copilot-character");
  if (!character) return;
  character.classList.remove("character-action"); void character.offsetWidth; character.classList.add("character-action");
  const message = document.getElementById("chartCopilotMessage");
  if (!message) return;
  message.textContent = action === "BUY"
    ? "BUY requests a LONG or closes an existing SHORT. Check the position status."
    : "SELL requests a SHORT or closes an existing LONG. Check the position status.";
}
let miniGameState = { mode: null, game: null, score: 0, timer: null, target: null };
function openMiniGames() {
  const overlay = document.getElementById("miniGamesOverlay");
  if (!overlay) return;
  clearMiniGameTimer();
  miniGameState = { mode: null, game: null, score: 0, timer: null, target: null };
  const mode = document.getElementById("miniGamesMode"), content = document.getElementById("miniGamesContent");
  if (mode) mode.hidden = false;
  if (content) content.innerHTML = "<p class='mini-games-hint'>Pick a mode. Your chart stays open behind this mini-screen.</p>";
  overlay.classList.remove("hidden"); overlay.setAttribute("aria-hidden", "false");
}
function closeMiniGames() {
  clearMiniGameTimer();
  const overlay = document.getElementById("miniGamesOverlay");
  if (overlay) { overlay.classList.add("hidden"); overlay.setAttribute("aria-hidden", "true"); }
}
function clearMiniGameTimer() { if (miniGameState.timer) clearInterval(miniGameState.timer); miniGameState.timer = null; }
function chooseMiniGameMode(mode) {
  miniGameState.mode = mode;
  const modeEl = document.getElementById("miniGamesMode"), content = document.getElementById("miniGamesContent");
  if (!modeEl || !content) return;
  modeEl.hidden = true;
  if (mode === "single") {
    content.innerHTML = `<div class="mini-game-selection"><h4>Single-player</h4><button data-action="startMiniGame" data-mode="reaction">⚡ Reaction Rush<small>Tap the target as fast as you can.</small></button><button data-action="startMiniGame" data-mode="price">🎯 Price Guess<small>Guess whether the next simulated tick goes up or down.</small></button></div>`;
  } else {
    content.innerHTML = `<div class="mini-game-selection"><h4>Online</h4><p class="mini-games-hint">Online matchmaking is a prototype lobby for now. Real multiplayer needs the future backend.</p><button data-action="startMiniGame" data-mode="duel">⚔️ 1v1 Reaction Duel<small>Play against a simulated opponent.</small></button><button data-action="startMiniGame" data-mode="co-op">🤝 Co-op Challenge<small>Team with a simulated player to reach a target.</small></button></div>`;
  }
}
function startMiniGame(game) {
  clearMiniGameTimer();
  miniGameState.game = game; miniGameState.score = 0;
  const content = document.getElementById("miniGamesContent");
  if (!content) return;
  if (game === "reaction" || game === "duel") {
    miniGameState.target = Math.floor(Math.random()*1000)+600;
    content.innerHTML = `<div class="mini-game-play"><div class="mini-score">Score <strong id="miniScore">0</strong></div><button id="reactionTarget" class="reaction-target" data-action="hitReactionTarget">TAP!</button><p id="miniGameStatus">Hit the button 10 times.</p><button class="mini-back" data-action="chooseMiniGameMode" data-mode="${miniGameState.mode}">← Back</button></div>`;
  } else if (game === "price") {
    miniGameState.target = Math.random() > .5 ? 1 : -1;
    content.innerHTML = `<div class="mini-game-play"><h4>Next tick?</h4><p class="mini-price-symbol">${document.getElementById("symbol")?.textContent || "MARKET"}</p><div class="mini-choice-row"><button data-action="makePriceGuess" data-guess="1">📈 UP</button><button data-action="makePriceGuess" data-guess="-1">📉 DOWN</button></div><p id="miniGameStatus">Make your call.</p><button class="mini-back" data-action="chooseMiniGameMode" data-mode="single">← Back</button></div>`;
  } else {
    miniGameState.target = 10;
    content.innerHTML = `<div class="mini-game-play"><div class="mini-score">Team progress <strong id="miniScore">0</strong>/10</div><button class="reaction-target coop-target" data-action="coOpTap">HELP TEAM</button><p id="miniGameStatus">Tap to help your teammate reach 10.</p><button class="mini-back" data-action="chooseMiniGameMode" data-mode="online">← Back</button></div>`;
  }
}
function hitReactionTarget() {
  miniGameState.score++;
  const score = document.getElementById("miniScore"), status = document.getElementById("miniGameStatus"), target = document.getElementById("reactionTarget");
  if (score) score.textContent = miniGameState.score;
  if (target) { target.style.transform = `translate(${Math.floor(Math.random()*70)-35}px,${Math.floor(Math.random()*40)-20}px)`; setTimeout(()=>{if(target) target.style.transform=""},120); }
  if (miniGameState.score >= 10) { if(status) status.textContent = miniGameState.game === "duel" ? `You won the prototype duel! 🐰 Score ${miniGameState.score}.` : "Clean run! 🐰⚡"; return; }
  if (status) status.textContent = miniGameState.game === "duel" ? `Your turn — keep going. Opponent score: ${Math.min(9, Math.floor(miniGameState.score*.8)+Math.floor(Math.random()*2))}.` : `${10-miniGameState.score} more hits.`;
}
function makePriceGuess(guess) {
  const actual = Math.random() > .5 ? 1 : -1, status = document.getElementById("miniGameStatus");
  if (!status) return;
  if (guess === actual) { miniGameState.score++; status.textContent = `Correct! +1 point. Total: ${miniGameState.score}. Play again?`; }
  else status.textContent = `Not this time — it moved ${actual > 0 ? "UP 📈" : "DOWN 📉"}. Total: ${miniGameState.score}.`;
}
function coOpTap() {
  miniGameState.score++;
  const score = document.getElementById("miniScore"), status = document.getElementById("miniGameStatus");
  if (score) score.textContent = miniGameState.score;
  if (miniGameState.score >= 10) { if(status) status.textContent = "Team challenge complete! 🤝🐰"; return; }
  if (status) status.textContent = `Keep helping — ${10-miniGameState.score} left. Your teammate is covering the rest.`;
}

function startFavoritesMonitor() {
  if (favoritesTimer) clearInterval(favoritesTimer);
  favoritesTimer = setInterval(() => { updateFavorites(false); }, 900000);
}
function connectFavoritesToAnalysis() {
  if (window.bunmoneyAnalysisConnected) return;
  window.bunmoneyAnalysisConnected = true;
  const originalAnalyze = analyze;
  window.analyze = async function(force = false) {
    await originalAnalyze(force);
    if (lastAnalysis && lastAnalysis.ticker === selectedSymbol()) {
      updateFavoriteFromAnalysis(lastAnalysis.ticker, lastAnalysis);
      updateChartCopilot();
      updateBunAIHome();
      updateTradeReadiness();
      updateTradePlan();
      updateMarketSnapshot();
      renderFavorites();
    }
  };
}
function initializeBunMoneyUpgrade() {
  loadFavorites();
  createFavoritesScreen();
  createFavoritesNav();
  createChartCopilot();
  createQuickTradeButtons();
  updateChartCopilot();
  updateBunAIHome();
  updateTradeReadiness();
  updateTradePlan();
  updateMarketSnapshot();
  renderFavorites();
  updateFavorites(true);
  startFavoritesMonitor();
  connectFavoritesToAnalysis();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeBunMoneyUpgrade);
} else {
  initializeBunMoneyUpgrade();
}


/* ===== FINAL PRODUCT POLISH ===== */
function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (busy) { button.dataset.originalText = button.textContent; button.textContent = label || "Working…"; }
  else if (button.dataset.originalText) { button.textContent = button.dataset.originalText; delete button.dataset.originalText; }
}

function showMarketError(message) {
  const clean = String(message || "Something went wrong.");
  setText("change", clean);
  const decision = document.getElementById("decision");
  if (decision) { decision.textContent = "DATA UNAVAILABLE"; decision.className = "decision wait"; }
}

function exportPaperTrades() {
  const payload = { recoveryState: stateBlocked ? localStorage.getItem("bunmoney_state") : null, exportedAt: new Date().toISOString(), balance: tradingBalance, position, tradeHistory };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "bunmoney-paper-trades.json"; link.click();
  URL.revokeObjectURL(url);
}

function handleKeyboardShortcuts(event) {
  if (event.target && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
  if (event.key === "/") { event.preventDefault(); focusAnalyzer(); }
  if (event.key.toLowerCase() === "a") analyze(true);
  if (event.key.toLowerCase() === "h") showScreen("home");
  if (event.key.toLowerCase() === "t") document.querySelector(".paper-trading-card")?.scrollIntoView({behavior:"smooth"});
}

function markInitialAppReady() {
  document.body.classList.add("bun-ready");
  const status = document.querySelector(".bun-header .status");
  if (status) status.setAttribute("title", "Real trading is locked until a secure brokerage connection is configured.");
}

document.addEventListener("keydown", handleKeyboardShortcuts);
document.addEventListener("DOMContentLoaded", markInitialAppReady);

/* ===== BUNMONEY MASTER FINAL FUNCTIONALITY ===== */
let chatMuted = false;
let chatSlowMode = true;
let lastChatSentAt = 0;
function connectBroker(name) {
  const status = document.getElementById("brokerStatus");
  if (status) status.textContent = "Demo connection ready — secure backend required for real accounts.";
  showPopup("🔗 Brokerage Connection", `${name} is a front-end demo. Real credentials and orders will only be handled by the secure BunMoney backend.`);
}
function brokerPreview(mode) {
  showPopup(mode === "View-only" ? "👀 View-only" : "✋ Trade Approval", mode === "View-only"
    ? "Future supported connections can show balances, positions, P/L and transactions without moving money."
    : "Future supported connections can prepare an order for you to review. You approve every consequential real-money action.");
}
function toggleMembershipExample(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("show");
}
function toggleChatSetting(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (id === "chatMute") chatMuted = !chatMuted;
  if (id === "chatSlowMode") chatSlowMode = !chatSlowMode;
  el.classList.toggle("active", id === "chatMute" ? chatMuted : chatSlowMode);
  if (chatMuted) showPopup("🔇 Chat Muted", "You won't receive BunBot replies until you unmute chat.");
}
function clearLocalProgress() {
  if (!confirm("Reset BunMoney's saved prototype progress on this device?")) return;
  ["bunmoney_state","bunmoney_favorites","bunmoney_mascot","bunmoney_last_analysis","bunmoney_profile","bunmoney_demo_market","bunmoney_pfp_asset","bunmoney_frame_asset","bunmoney_bg_asset"].forEach(k => localStorage.removeItem(k));
  stateBlocked = true; // Prevent unload from saving the state just removed.
  location.reload();
}
const originalSendChat = window.sendChat;
window.sendChat = function() {
  if (chatMuted) return showPopup("🔇 Chat Muted", "Unmute chat to continue.");
  if (chatSlowMode && Date.now() - lastChatSentAt < 4000) return showPopup("🐢 Slow Mode", "Give the chat a few seconds before sending another message.");
  lastChatSentAt = Date.now();
  if (typeof originalSendChat === "function") originalSendChat();
};

/* =========================================================
   FREE PROTOTYPE COMPLETION LAYER
   Local demo systems only — no paid services required.
========================================================= */
let demoMarketEnabled = false;
let demoProfile = { username: "Guest", createdAt: Date.now() };

const DEMO_MARKET_BASE = {
  GRAB: 3.42,
  SOUN: 6.74,
  BBAI: 2.94,
  GOLD: 46.42,
  AAPL: 250.00,
  NVDA: 180.00,
  TSLA: 350.00,
  SPY: 650.00
};

function demoSeed(symbol) {
  return String(symbol).split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}
function demoCandles(symbol, interval = "5min", count = 80) {
  const base = DEMO_MARKET_BASE[symbol] || 25;
  let seed = demoSeed(symbol + interval);
  let price = base;
  const candles = [];
  const stepMinutes = interval === "1day" ? 1440 : interval === "1week" ? 10080 : interval === "1month" ? 43200 : interval === "1h" ? 60 : interval === "4h" ? 240 : interval === "15min" ? 15 : interval === "1min" ? 1 : 5;
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const noise = (seed / 233280 - 0.5) * 0.035;
    const drift = Math.sin(i / 8) * 0.004 + Math.cos(i / 17) * 0.002;
    const open = price;
    const close = Math.max(base * 0.55, open * (1 + noise + drift));
    const high = Math.max(open, close) * (1 + Math.abs(noise) * 0.6 + 0.002);
    const low = Math.min(open, close) * (1 - Math.abs(noise) * 0.6 - 0.002);
    const volume = Math.round(300000 + ((seed % 900000) * (1 + Math.abs(noise) * 4)));
    candles.push({ datetime: new Date(now - i * stepMinutes * 60000).toISOString(), open: open.toFixed(4), high: high.toFixed(4), low: low.toFixed(4), close: close.toFixed(4), volume: String(volume) });
    price = close;
  }
  return { status: "ok", meta: { symbol, interval }, values: candles.reverse() };
}

function demoLivePrice(symbol) {
  const base = DEMO_MARKET_BASE[symbol] || 25;
  const now = Date.now() / 1000;
  const seed = demoSeed(symbol);
  const waveA = Math.sin(now / 19 + seed) * 0.006;
  const waveB = Math.sin(now / 47 + seed * 0.7) * 0.0035;
  const drift = Math.sin(now / 180 + seed * 0.13) * 0.004;
  return base * (1 + waveA + waveB + drift);
}

function saveDemoProfile() {
  const input = document.getElementById("demoUsername");
  const username = String(input?.value || "").trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 20);
  demoProfile.username = username || "Guest";
  demoProfile.createdAt = demoProfile.createdAt || Date.now();
  localStorage.setItem("bunmoney_profile", JSON.stringify(demoProfile));
  updateDemoProfileUI();
  showPopup("🪪 Profile Saved", `Your local demo profile is ${demoProfile.username}.`);
}
function loadDemoProfile() {
  try { demoProfile = { ...demoProfile, ...(JSON.parse(localStorage.getItem("bunmoney_profile")) || {}) }; } catch (_) {}
  updateDemoProfileUI();
}
function updateDemoProfileUI() {
  setText("demoProfileStatus", demoProfile.username || "Guest");
  const input = document.getElementById("demoUsername");
  if (input && !input.value) input.value = demoProfile.username === "Guest" ? "" : demoProfile.username;
}
function toggleDemoMarket() {
  if (position) return showPopup("Open position","Close the position before changing data sources.");
  demoMarketEnabled = !demoMarketEnabled;
  quoteCache.clear(); invalidateAnalysis();
  setText("feedStatus",demoMarketEnabled ? "SIMULATED data" : "REST polling");
  localStorage.setItem("bunmoney_demo_market", String(demoMarketEnabled));
  setText("demoMarketButton", `Demo Market: ${demoMarketEnabled ? "ON" : "OFF"}`);
  showPopup("📡 Demo Market", demoMarketEnabled ? "Synthetic data is explicitly selected. These are not live market prices." : "Live Twelve Data and Coinbase data selected.");
}
function loadDemoSettings() {
  const saved = localStorage.getItem("bunmoney_demo_market");
  if (saved !== null && !position) demoMarketEnabled = saved === "true";
  setText("demoMarketButton", `Demo Market: ${demoMarketEnabled ? "ON" : "OFF"}`);
}

function renderTradeHistory() {
  const box = document.getElementById("tradeHistoryList");
  if (!box) return;
  if (!tradeHistory.length) {
    box.innerHTML = `<div class="alert empty">No paper trades yet.</div>`;
    return;
  }
  box.innerHTML = tradeHistory.slice().reverse().slice(0, 20).map((trade, i) => {
    const profit = Number(trade.profit || 0);
    const cls = profit >= 0 ? "diag-pass" : "diag-warn";
    return `<div class="trade-history-item"><div><strong>${escapeHTML(trade.side || "TRADE")} ${trade.symbol ? escapeHTML(trade.symbol) : ""}</strong><small>Entry ${formatMoney(trade.entry)} → Exit ${formatMoney(trade.exit)} · ${escapeHTML(trade.time || "")}</small></div><strong class="trade-history-profit ${cls}">${profit >= 0 ? "+" : "-"}${formatMoney(Math.abs(profit))}</strong></div>`;
  }).join("");
}

function exportBunMoneyData() {
  const data = {
    recoveryState: stateBlocked ? localStorage.getItem("bunmoney_state") : null,
    app: "BunMoney",
    version: "prototype",
    exportedAt: new Date().toISOString(),
    profile: demoProfile,
    state: { tradingBalance, position, tradeHistory, rewardPoints, arcadeBank, xp, activeBot },
    favorites: (() => { try { return JSON.parse(localStorage.getItem("bunmoney_favorites") || "[]"); } catch (_) { return []; } })(),
    theme: document.documentElement.style.cssText
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "bunmoney-prototype-backup.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function importBunMoneyData() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json,.json";
  input.onchange = () => {
    const file = input.files?.[0]; if (!file) return;
    if (file.size > 2000000) return showPopup("Import Failed","Backup exceeds 2 MB.");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (position) throw new Error("Close your position before importing.");
        const importedState = Trading.state(data.state);
        if (!Array.isArray(data.favorites) || data.favorites.length > 50 || !data.favorites.every(Trading.validSymbol)) throw new Error("Invalid favorites.");
        data.state = importedState;
        data.profile = { username: String(data.profile?.username || "Guest").slice(0,40), createdAt: Number(data.profile?.createdAt) || Date.now() };
        if (data.profile) { demoProfile = { ...demoProfile, ...data.profile }; localStorage.setItem("bunmoney_profile", JSON.stringify(demoProfile)); }
        if (data.state) localStorage.setItem("bunmoney_state", JSON.stringify(data.state));
        if (Array.isArray(data.favorites)) localStorage.setItem("bunmoney_favorites", JSON.stringify(data.favorites));
        stateBlocked = true;
        showPopup("📥 Import Complete", "Your local prototype backup was imported. Reloading now.");
        setTimeout(() => location.reload(), 700);
      } catch (_) { showPopup("Import Failed", "That file is not a valid BunMoney prototype backup."); }
    };
    reader.readAsText(file);
  };
  input.click();
}

function previewCosmetic(name) {
  showPopup("🛍️ Cosmetic Preview", `${name} is a visual-only prototype item. No purchase is charged and no real money is involved.`);
}
function showDataPrivacy() {
  showPopup("🔐 Prototype Privacy", "This version keeps demo profile, favorites, paper trades, XP, themes, and settings in this browser's local storage. No real brokerage credentials are stored here.");
}
function showKeyboardHelp() {
  showPopup("⌨️ Shortcuts", "/ = focus analyzer · A = analyze · H = Home · T = Trade. Input fields ignore these shortcuts.");
}
function runPrototypeDiagnostics() {
  const box = document.getElementById("diagnostics");
  if (!box) return;
  const checks = [
    ["Navigation", document.querySelectorAll(".screen").length >= 5],
    ["Analyzer", typeof analyze === "function"],
    ["Paper trading", typeof paperBuy === "function" && typeof paperSell === "function"],
    ["Chart", Boolean(document.getElementById("chart")?.getContext)],
    ["BunAI", typeof askBunAI === "function"],
    ["Local storage", (() => { try { localStorage.setItem("bunmoney_diag", "1"); localStorage.removeItem("bunmoney_diag"); return true; } catch (_) { return false; } })()],
    ["Demo market", demoMarketEnabled],
    ["PWA shell", Boolean(document.querySelector('link[rel="manifest"]'))]
  ];
  box.hidden = false;
  box.innerHTML = checks.map(([name, pass]) => `<div class="diag-row"><span>${name}</span><strong class="${pass ? "diag-pass" : "diag-warn"}">${pass ? "PASS" : "CHECK"}</strong></div>`).join("");
}

/* Safer chat moderation for the local prototype. */
const blockedChatTerms = ["kill yourself", "kys", "racial slur"];
const originalSendChatBase = window.sendChat;
window.sendChat = function() {
  const input = document.getElementById("chatInput");
  const message = String(input?.value || "").trim().toLowerCase();
  if (blockedChatTerms.some(term => message.includes(term))) {
    if (input) input.value = "";
    showPopup("🛡️ Message Blocked", "That message was blocked by the prototype safety filter.");
    return;
  }
  if (message.length > 280) {
    showPopup("🛡️ Message Too Long", "Keep chat messages under 280 characters.");
    return;
  }
  originalSendChatBase();
};

/* Keep the UI in sync after the existing initialization routines run. */
document.addEventListener("DOMContentLoaded", () => {
  loadDemoProfile();
  renderTradeHistory();
  setTimeout(() => { if (!lastAnalysis) analyze(false).catch(() => {}); }, 250);
});

/* AI graceful fallback: the prototype remains testable without a paid AI key. */
const bunAIWithFallback = window.askBunAI || askBunAI;
window.askBunAI = async function(message, context = {}) {
  try {
    return await bunAIWithFallback(message, context);
  } catch (error) {
    return { text: getBunReply(message) + "\n\n[Demo AI mode: connect a server-side AI provider later for full generative responses.]" };
  }
};
askBunAI = window.askBunAI;

/* Keep reset behavior complete for every free prototype setting. */
const originalClearLocalProgress = window.clearLocalProgress || clearLocalProgress;
window.clearLocalProgress = function() {
  originalClearLocalProgress();
};
clearLocalProgress = window.clearLocalProgress;


/* =========================================================
   MARKET NEWS REPORT — EDUCATIONAL TICKER-AWARE DEMO
   ========================================================= */
(function setupMarketNewsReport() {
  const reports = {
    xauusd: {
      event: "US inflation, jobs, or Fed-rate updates",
      time: "Check the connected economic calendar",
      impact: "USD/rates can move gold sharply",
      explanation: "XAUUSD often reacts to the US dollar, Treasury yields, inflation data, employment releases, and Federal Reserve decisions. Stronger-than-expected US data can support the dollar and pressure gold, while weaker data or falling yields can support gold. Confirm the actual release time before trading."
    },
    gold: {
      event: "US dollar and interest-rate headlines",
      time: "Check the connected economic calendar",
      impact: "Can increase volatility in gold",
      explanation: "Gold commonly responds to the dollar, real yields, inflation expectations, central-bank decisions, and risk sentiment. Watch the scheduled release and compare the result with expectations rather than assuming the first candle is the final direction."
    },
  };
  reports["soun"] = {
    event: "Company earnings, guidance, and AI-sector headlines",
    time: "Check the company calendar and live news feed",
    impact: "Company-specific news can create gaps",
    explanation: "SOUN is a single-company equity, so earnings, guidance, contracts, analyst changes, AI-sector sentiment, and broader technology-market moves may affect its chart. A live news/calendar connection is required to show a verified future headline and exact release time."
  };

  function getReport(ticker) {
    const key = String(ticker || "").trim().toLowerCase().replace(/\s+/g, "");
    if (reports[key]) return reports[key];
    return {
      event: "Ticker-specific headlines and scheduled releases",
      time: "Check a live news/economic calendar",
      impact: "Depends on the asset and event",
      explanation: `${key.toUpperCase() || "This ticker"} needs a connected live news feed to identify the next verified event, its exact time, and the likely chart sensitivity. Review earnings, economic releases, sector news, and market-wide risk before acting.`
    };
  }

  function updateMarketNewsReport() {
    const input = document.getElementById("ticker");
    const ticker = String(input?.value || document.getElementById("symbol")?.textContent || "").trim();
    const report = getReport(ticker);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set("newsTicker", ticker.toUpperCase() || "—");
    set("newsEvent", report.event);
    set("newsTime", report.time);
    set("newsImpact", report.impact);
    set("newsExplanation", report.explanation);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateMarketNewsReport);
  } else {
    updateMarketNewsReport();
  }

  const input = document.getElementById("ticker");
  if (input) input.addEventListener("input", updateMarketNewsReport);
  const symbol = document.getElementById("symbol");
  if (symbol) new MutationObserver(updateMarketNewsReport).observe(symbol, { childList: true, characterData: true, subtree: true });
})();


// A CSP-compatible, explicit action table; no eval or inline script handlers.
document.addEventListener("click", event => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const actions = { analyze:() => analyze(true), paperBuy, paperSell, exportPaperTrades,
    addFavorite:() => addFavorite(), addCurrentFavorite, removeFavorite:() => removeFavorite(control.dataset.symbol),
    openFavorite:() => openFavorite(control.dataset.symbol),
    setTimeframe:() => setTimeframe(control.dataset.timeframe),
    startMiniGame:() => startMiniGame(control.dataset.mode), chooseMiniGameMode:() => chooseMiniGameMode(control.dataset.mode),
    hitReactionTarget, coOpTap, makePriceGuess:() => makePriceGuess(Number(control.dataset.guess)),
    showScreen:() => showScreen(control.dataset.screen), emperorPrompt:() => emperorAsk(control.dataset.prompt), scanMarket, scanSpikes, viewSpikeMarket:() => viewSpikeMarket(control.dataset.symbol), unlockMarketEngine,
    toggleDemoMarket, exportBunMoneyData, importBunMoneyData, clearLocalProgress };
  actions[control.dataset.action]?.();
});
document.addEventListener("input", event => {
  if (event.target.id === "zoomSlider") changeChartZoom(event.target.value);
});
window.addEventListener("beforeunload", () => { saveGameState(); coinbaseFeed?.stop(); });

document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target?.id === "favoriteInput") { e.preventDefault(); addFavorite(); } });


/* Emperor Bunny educational assistant — selected chart context only. */
let emperorBusy = false;
function emperorContext() {
  const a = lastAnalysis;
  if (!a || a.ticker !== selectedSymbol()) return null;
  return {
    symbol:a.ticker, trend:a.trend, setup:a.breakout || a.retest || "NO CONFIRMATION",
    price:a.currentPrice, support:a.support, resistance:a.resistance,
    rsi:a.rsi, volumeRatio:a.volumeRatio, rr:a.rr, stop:a.stop,
    target:a.target, source:a.source, ageMs:Date.now()-a.timestamp
  };
}
function emperorPost(speaker, message) {
  const panel = document.getElementById("emperorMessages");
  if (!panel) return;
  const item = document.createElement("p");
  item.className = speaker === "You" ? "emperor-user" : "emperor-response";
  const heading = document.createElement("strong");
  heading.textContent = speaker + ": ";
  const text = document.createElement("span");
  text.textContent = String(message);
  item.append(heading,text);
  panel.appendChild(item);
  panel.scrollTop = panel.scrollHeight;
}
async function emperorAsk(question) {
  const message = String(question || "").trim();
  if (!message || emperorBusy) return;
  const button = document.getElementById("emperorAskButton");
  const field = document.getElementById("emperorQuestion");
  emperorBusy = true;
  if (button) button.disabled = true;
  if (field) field.value = "";
  emperorPost("You", message);
  try {
    const response = await fetch("/api/ai/chat", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message, context:emperorContext()})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Assistant unavailable");
    emperorPost("Emperor Bunny", data.text || "No explanation available.");
  } catch (error) {
    emperorPost("Emperor Bunny", "Couldn't retrieve the explanation. Please check the BunMoney backend and try again.");
  } finally {
    emperorBusy = false;
    if (button) button.disabled = false;
  }
}
document.addEventListener("submit", event => {
  if (event.target?.id !== "emperorAskForm") return;
  event.preventDefault();
  emperorAsk(document.getElementById("emperorQuestion")?.value);
});
