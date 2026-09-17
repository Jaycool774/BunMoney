/* =========================================================
   BUNMONEY — MASTER BRAIN
   Prototype / Paper Trading / Analysis Assistant
========================================================= */

const API_KEY = "";
// Production: set MARKET_ENGINE_URL to your secure backend. Leave blank for CodePen prototype mode.
const MARKET_ENGINE_URL = window.BUNMONEY_MARKET_ENGINE_URL || (location.protocol !== "file:" && !/codepen\.io$/i.test(location.hostname) ? "/api/market" : "");
// Set this to your deployed BunMoney backend URL in production. Keep provider secrets server-side.

async function marketEngineRequest(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString();
  if (MARKET_ENGINE_URL) {
    const response = await fetch(`${MARKET_ENGINE_URL}${endpoint}?${query}`);
    const data = await response.json();
    if (!response.ok || data.status === "error") throw new Error(data.message || "Market engine request failed");
    return data;
  }
  if (!API_KEY || API_KEY === "YOUR_TWELVE_DATA_API_KEY") throw new Error("Market data is not configured. Add a provider key for prototype mode or connect BunMoney Market Engine.");
  const response = await fetch(`https://api.twelvedata.com${endpoint}?${query}&apikey=${encodeURIComponent(API_KEY)}`);
  const data = await response.json();
  if (!response.ok || data.status === "error") throw new Error(data.message || "Market data request failed");
  return data;
}

let selectedTimeframe = "5min";
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
  if (!Number.isFinite(Number(value))) return "$—";
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

  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.toggle("active", screen.id === screenName);
  });

  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle("active", button.dataset.screen === screenName);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setTimeframe(timeframe) {
  selectedTimeframe = timeframe;
  document.querySelectorAll(".timeframes button").forEach(button => {
    button.classList.remove("active");
    const text = button.textContent.toLowerCase().replace(/\s/g, "");
    if (
      text === "1m" && timeframe === "1min" ||
      text === "5m" && timeframe === "5min" ||
      text === "15m" && timeframe === "15min" ||
      text === "1h" && timeframe === "1h" ||
      text === "4h" && timeframe === "4h" ||
      text === "1d" && timeframe === "1day" ||
      text === "1w" && timeframe === "1week" ||
      text === "1m" && timeframe === "1month" ||
      text === "max" && timeframe === "max"
    ) button.classList.add("active");
  });
  analyze();
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
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

async function analyze(force = false) {
  const tickerElement = document.getElementById("ticker");
  if (!tickerElement) return;
  const ticker = tickerElement.value.toUpperCase().trim();
  if (!ticker) { setText("reason", "Enter a ticker symbol first."); return; }
  setText("symbol", ticker);
  setText("decision", "LOADING MARKET DATA...");
  setText("reason", "BunAI is analyzing the market...");
  try {
    const interval = selectedTimeframe === "max" ? "1month" : selectedTimeframe;
    const data = await marketEngineRequest("/time_series", { symbol: ticker, interval, outputsize: 80 });
    if (data.status === "error" || !data.values || !data.values.length) {
      if (data.message && data.message.toLowerCase().includes("credits")) {
        throw new Error("Twelve Data credits are exhausted for today.");
      }
      throw new Error(data.message || "No market data returned.");
    }

    const candles = [...data.values].reverse();
    const closes = candles.map(c => Number(c.close));
    const highs = candles.map(c => Number(c.high));
    const lows = candles.map(c => Number(c.low));
    const volumes = candles.map(c => Number(c.volume || 0));
    const currentPrice = closes[closes.length - 1];
    const previousPrice = closes.length > 1 ? closes[closes.length - 2] : currentPrice;
    const changePercent = previousPrice === 0 ? 0 : ((currentPrice - previousPrice) / previousPrice) * 100;

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
    if (candles.length >= 21) {
      const priorResistance = Math.max(...highs.slice(-21, -1));
      if (currentPrice > priorResistance) {
        breakout = "POSSIBLE BREAKOUT";
        breakoutIndex = candles.length - 1;
      }
    }

    let retest = "WAITING";
    let retestIndex = null;
    if (breakoutIndex !== null) {
      const distance = Math.abs(currentPrice - resistance);
      const tolerance = currentPrice * 0.01;
      if (distance <= tolerance) {
        retest = "RETEST AREA";
        retestIndex = candles.length - 1;
      }
    }

    let entry = currentPrice;
    let stop = Math.min(support, currentPrice * 0.98);
    let target = Math.max(resistance, currentPrice * 1.04);
    if (target <= entry) target = entry * 1.03;
    if (stop >= entry) stop = entry * 0.98;
    const risk = entry - stop;
    const reward = target - entry;
    const rr = risk > 0 ? reward / risk : 0;

    let score = 0;
    if (trend === "BULLISH") score += 2;
    if (trend === "BEARISH") score -= 2;
    if (Number.isFinite(rsi) && rsi > 50 && rsi < 70) score += 1;
    if (Number.isFinite(rsi) && rsi < 30) score += 1;
    if (Number.isFinite(rsi) && rsi > 75) score -= 1;
    if (volumeRatio >= 1.5) score += 1;
    if (breakout === "POSSIBLE BREAKOUT") score += 2;
    if (retest === "RETEST AREA") score += 2;
    if (rr >= 2) score += 1;

    let decision = "WAIT";
    if (score >= 5) decision = "WATCH FOR LONG";
    else if (score <= -3) decision = "WATCH FOR SHORT";

    let setupQuality = "LOW";
    if (score >= 2) setupQuality = "MODERATE";
    if (score >= 5) setupQuality = "HIGH";

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

    setText("price", formatMoney(currentPrice));
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

    lastAnalysis = { ticker, currentPrice, changePercent, trend, support, resistance, rsi, sma10, sma20, volumeRatio, breakout, retest, entry, stop, target, rr, score, decision, setupQuality, outlook, timestamp: Date.now() };
    lastMarketDataTime = Date.now();

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
  const maxPrice = Math.max(...highs, resistance, target);
  const minPrice = Math.min(...lows, support, stop);
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
  drawLevel(ctx, width, yPosition(entry), "rgba(255,255,255,.75)", "ENTRY");
  drawLevel(ctx, width, yPosition(stop), "rgba(239,68,68,.9)", "STOP");
  drawLevel(ctx, width, yPosition(target), "rgba(132,204,22,.9)", "TARGET");

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
function startLivePrice() {
  if (livePriceTimer) clearInterval(livePriceTimer);
  livePriceTimer = setInterval(async () => {
    const tickerElement = document.getElementById("ticker");
    if (!tickerElement) return;
    const ticker = tickerElement.value.toUpperCase().trim();
    if (!ticker) return;
    if (!MARKET_ENGINE_URL && (!API_KEY || API_KEY === "YOUR_TWELVE_DATA_API_KEY")) return;
    try {
      const data = await marketEngineRequest("/price", { symbol: ticker });
      if (data.price && Number.isFinite(Number(data.price))) {
        const newPrice = Number(data.price);
        setText("price", formatMoney(newPrice));
        updatePaperPL(newPrice);
      }
    } catch (error) { console.log("Live price unavailable."); }
  }, 60000);
}

async function askBunAIFromUI() {
  const input = document.getElementById("bunAiInput");
  const reply = document.getElementById("bunAiReply");
  const question = input?.value?.trim();
  if (!question) { if (reply) reply.textContent = "Type a question first."; return; }
  if (reply) reply.textContent = "BunAI is thinking…";
  try {
    const data = await askBunAI(question, lastAnalysis || {});
    if (reply) reply.textContent = data.text || "BunAI has no response right now.";
  } catch (error) {
    if (reply) reply.textContent = error.message || "BunAI is unavailable right now.";
  }
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

function paperBuy() {
  if (position) { setText("reason", "You already have an open paper position."); return; }
  const priceText = document.getElementById("price")?.textContent?.replace("$", "");
  const price = Number(priceText);
  if (!Number.isFinite(price)) { setText("reason", "Analyze a market before opening a paper trade."); return; }
  position = { side: "LONG", entry: price, amount: tradingBalance };
  setText("position", "LONG @ " + formatMoney(price));
  setText("reason", "Paper long opened. Bun is tracking the position. 🐰");
  mascotReaction("Position opened. Protect the bag. 🐰💰");
}
function paperSell() {
  if (!position) { setText("reason", "There is no open paper position."); return; }
  const priceText = document.getElementById("price")?.textContent?.replace("$", "");
  const price = Number(priceText);
  if (!Number.isFinite(price)) return;
  const percentageMove = (price - position.entry) / position.entry;
  const profit = position.amount * percentageMove;
  tradingBalance += profit;
  tradeHistory.push({ side: position.side, entry: position.entry, exit: price, profit: profit, time: new Date().toLocaleString() });
  position = null;
  setText("tradingBalance", formatMoney(tradingBalance));
  setText("position", "NONE");
  setText("paperPL", formatMoney(profit));
  rewardPoints += profit > 0 ? 25 : 5;
  updateConfidence(); updateLevel(); updateRewards();
  setText("reason", `Paper trade closed with ${profit >= 0 ? "a profit" : "a loss"} of ${formatMoney(Math.abs(profit))}.`);
  mascotReaction(profit >= 0 ? "Nice trade! Stack those wins. 🐰📈" : "Loss taken. Learn from it and protect the next trade. 🐰");
}

function updatePaperPL(price) {
  if (!position) return;
  const move = (price - position.entry) / position.entry;
  const pl = position.amount * move;
  setText("paperPL", formatMoney(pl));
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
    rankIcon.textContent = icons[rank];
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
  EmperorBunny: { name: "👑 Emperor Bunny", message: "Owner-only intelligence system. Backend connection required." }
};
function selectBot(botName) {
  if (!bots[botName]) return;
  activeBot = botName;
  const bot = bots[botName];
  setText("activeBot", bot.name); setText("botMessage", bot.message);
  if (botName === "EmperorBunny") {
    showPopup("👑 Emperor Bunny", "Emperor Bunny is owner-only and requires the secure BunMoney backend before its advanced capabilities can be activated.");
    mascotReaction("The Emperor is waiting for his throne room. 👑🐰");
    return;
  }
  showPopup(bot.name, bot.message);
}

async function scanMarket() {
  const symbols = ["GRAB", "SOUN", "BBAI"];
  const container = document.getElementById("scanner");
  if (!container) return;
  container.innerHTML = `<div class="alert empty">Scanning watchlist...</div>`;
  const results = [];
  for (const symbol of symbols) {
    try {
      if (!MARKET_ENGINE_URL && (!API_KEY || API_KEY === "YOUR_TWELVE_DATA_API_KEY")) throw new Error("Market data is not configured");
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
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
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
      image.style.filter = "drop-shadow(0 0 8px rgba(163,230,53,.28))";
      element.dataset.mascot = emoji;
    } else {
      element.textContent = emoji;
    }
  });
  document.querySelectorAll(".profile-avatar").forEach(element => { element.textContent = emoji; });
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
  if (mascot) {
    mascot.classList.remove("react");
    void mascot.offsetWidth;
    mascot.classList.add("react");
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
  try {
    localStorage.setItem("bunmoney_state", JSON.stringify({ tradingBalance, tradeHistory, rewardPoints, arcadeBank, activeBot }));
  } catch (error) { console.log("Could not save BunMoney state."); }
}
function loadGameState() {
  try {
    const saved = localStorage.getItem("bunmoney_state");
    if (!saved) return;
    const state = JSON.parse(saved);
    if (Number.isFinite(Number(state.tradingBalance))) tradingBalance = Number(state.tradingBalance);
    if (Array.isArray(state.tradeHistory)) tradeHistory = state.tradeHistory;
    if (Number.isFinite(Number(state.rewardPoints))) rewardPoints = Number(state.rewardPoints);
    if (Number.isFinite(Number(state.arcadeBank))) arcadeBank = Number(state.arcadeBank);
    if (state.activeBot) activeBot = state.activeBot;
  } catch (error) { console.log("Could not load saved state."); }
}

document.addEventListener("DOMContentLoaded", () => {
  loadGameState();
  startArcadeBank();
  startLivePrice();
  startAlertMonitor();
  rotateQuote();
  setInterval(rotateQuote, 15000);
  updateArcadeBank();
  updateConfidence();
  updateLevel();
  updateRank();
  updateRewards();
  updateProfile();
  updateAchievements();
  setText("tradingBalance", formatMoney(tradingBalance));
  setText("position", "NONE");
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
      if (Array.isArray(parsed) && parsed.length) bunFavorites = parsed;
    }
  } catch (error) { console.log("Could not load favorites."); }
}
function saveFavorites() {
  try { localStorage.setItem(BUN_FAVORITES_KEY, JSON.stringify(bunFavorites)); }
  catch (error) { console.log("Could not save favorites."); }
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
      <input id="favoriteInput" type="text" maxlength="10" placeholder="Add ticker...">
      <button onclick="addFavorite()">+ Add</button>
    </div>`;
  const app = document.querySelector(".app");
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
function addFavorite() {
  const input = document.getElementById("favoriteInput");
  if (!input) return;
  const symbol = input.value.toUpperCase().trim();
  if (!symbol) return;
  if (bunFavorites.includes(symbol)) {
    showPopup("Favorites", `${symbol} is already in your favorites.`); return;
  }
  bunFavorites.push(symbol); saveFavorites(); input.value = ""; renderFavorites(); updateFavorites(true);
  mascotReaction(`${symbol} joined the watchlist. ⭐🐰`);
}
function removeFavorite(symbol) {
  bunFavorites = bunFavorites.filter(item => item !== symbol);
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
function renderFavorites() {
  const container = document.getElementById("favoritesList");
  if (!container) return;
  if (!bunFavorites.length) {
    container.innerHTML = `<div class="alert empty">No favorite markets yet.</div>`; return;
  }
  container.innerHTML = bunFavorites.map(symbol => `
    <div class="favorite-market" id="favorite-${symbol}">
      <div class="favorite-top">
        <div><strong>⭐ ${symbol}</strong><span class="favorite-price" id="favorite-price-${symbol}">—</span></div>
        <button class="favorite-remove" onclick="removeFavorite('${symbol}')">×</button>
      </div>
      <div class="favorite-stats">
        <div><span>Move</span><strong id="favorite-change-${symbol}">—</strong></div>
        <div><span>Trend</span><strong id="favorite-trend-${symbol}">—</strong></div>
        <div><span>Volume</span><strong id="favorite-volume-${symbol}">—</strong></div>
        <div><span>Setup</span><strong id="favorite-setup-${symbol}">—</strong></div>
      </div>
      <div class="favorite-levels">
        <span>Support: <strong id="favorite-support-${symbol}">—</strong></span>
        <span>Resistance: <strong id="favorite-resistance-${symbol}">—</strong></span>
      </div>
      <button class="favorite-open" onclick="openFavorite('${symbol}')">View Chart →</button>
    </div>`).join("");
}
async function updateFavorites(force = false) {
  if (!bunFavorites.length) return;
  for (const symbol of bunFavorites) {
    try {
      if (!MARKET_ENGINE_URL && (!API_KEY || API_KEY === "YOUR_TWELVE_DATA_API_KEY")) continue;
      const data = await marketEngineRequest("/price", { symbol });
      if (!data.price || !Number.isFinite(Number(data.price))) continue;
      const price = Number(data.price);
      updateHomeMarketCard(symbol, price, NaN);
      const priceElement = document.getElementById(`favorite-price-${symbol}`);
      if (priceElement) priceElement.textContent = formatMoney(price);
      if (lastAnalysis && lastAnalysis.ticker === symbol) updateFavoriteFromAnalysis(symbol, lastAnalysis);
      else {
        const change = document.getElementById(`favorite-change-${symbol}`);
        if (change) change.textContent = "Live";
      }
    } catch (error) { console.log("Favorite update failed:", symbol); }
  }
}
function updateFavoriteFromAnalysis(symbol, analysis) {
  updateHomeMarketCard(symbol, analysis.currentPrice, analysis.changePercent);
  setText(`favorite-price-${symbol}`, formatMoney(analysis.currentPrice));
  const change = document.getElementById(`favorite-change-${symbol}`);
  if (change) {
    change.textContent = `${analysis.changePercent >= 0 ? "+" : ""}${analysis.changePercent.toFixed(2)}%`;
    change.style.color = analysis.changePercent >= 0 ? "#22c55e" : "#ef4444";
  }
  setText(`favorite-trend-${symbol}`, analysis.trend);
  setText(`favorite-volume-${symbol}`, analysis.volumeRatio ? analysis.volumeRatio.toFixed(1) + "x" : "—");
  let setup = "WAIT";
  if (analysis.retest === "RETEST AREA") setup = "RETEST";
  else if (analysis.breakout === "POSSIBLE BREAKOUT") setup = "BREAKOUT";
  else if (analysis.setupQuality === "HIGH") setup = "STRONG";
  else if (analysis.setupQuality === "MODERATE") setup = "FORMING";
  setText(`favorite-setup-${symbol}`, setup);
  setText(`favorite-support-${symbol}`, formatMoney(analysis.support));
  setText(`favorite-resistance-${symbol}`, formatMoney(analysis.resistance));
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
  const status = document.getElementById("tradePlanStatus");
  const direction = document.getElementById("tradePlanDirection");
  const entry = document.getElementById("tradePlanEntry");
  const stop = document.getElementById("tradePlanStop");
  const target = document.getElementById("tradePlanTarget");
  const confirmation = document.getElementById("planConfirmation");
  const reward = document.getElementById("planReward");
  const note = document.getElementById("tradePlanNote");
  if (![status,direction,entry,stop,target,confirmation,reward,note].every(Boolean)) return;

  [status, direction, confirmation, reward].forEach(el => el.classList.remove("good","bad","warn","neutral"));
  confirmation.classList.remove("ready","caution","blocked");
  reward.classList.remove("ready","caution","blocked");

  if (!lastAnalysis) {
    status.textContent = "WAIT"; status.classList.add("neutral");
    direction.textContent = "—"; entry.textContent = "—"; stop.textContent = "—"; target.textContent = "—";
    confirmation.querySelector("span").textContent = "•";
    confirmation.querySelector("small").textContent = "Waiting for analysis";
    reward.querySelector("span").textContent = "•";
    reward.querySelector("small").textContent = "Waiting for setup";
    note.textContent = "Analyze a market to build a trade plan.";
    return;
  }

  const a = lastAnalysis;
  const long = String(a.decision || "").includes("LONG");
  const short = String(a.decision || "").includes("SHORT");
  const confirmed = (a.breakout === "POSSIBLE BREAKOUT" || a.retest === "RETEST AREA") && Number(a.volumeRatio) >= 1.05;
  const rrGood = Number.isFinite(Number(a.rr)) && Number(a.rr) >= 2;

  direction.textContent = long ? "LONG WATCH" : short ? "SHORT WATCH" : "NO DIRECTION";
  direction.classList.add(long ? "good" : short ? "bad" : "warn");
  entry.textContent = formatMoney(a.entry);
  stop.textContent = formatMoney(a.stop);
  target.textContent = formatMoney(a.target);

  const ready = (long || short) && confirmed && rrGood;
  const watch = (long || short) || confirmed;
  status.textContent = ready ? "READY TO WATCH" : watch ? "WATCH" : "WAIT";
  status.classList.add(ready ? "good" : watch ? "warn" : "neutral");

  confirmation.classList.add(confirmed ? "ready" : "caution");
  confirmation.querySelector("span").textContent = confirmed ? "✓" : "!";
  confirmation.querySelector("small").textContent = confirmed
    ? "Price action and volume are giving confirmation."
    : "Wait for price action and volume to confirm.";

  reward.classList.add(rrGood ? "ready" : "caution");
  reward.querySelector("span").textContent = rrGood ? "✓" : "!";
  reward.querySelector("small").textContent = rrGood
    ? `${Number(a.rr).toFixed(2)}:1 reward-to-risk.`
    : "Reward-to-risk is below the preferred 2:1 threshold.";

  note.textContent = ready
    ? "Setup has multiple confirmations. Still wait for your own entry trigger before acting."
    : watch
      ? "A setup may be forming. Do not chase; wait for confirmation."
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
  controls.innerHTML = `<button class="quick-buy" onclick="paperBuy(); quickCharacterReaction('BUY')">🐰 ↑ BUY</button><button class="quick-sell" onclick="paperSell(); quickCharacterReaction('SELL')">↓ SELL 🐰</button>`;
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
    ? "Paper buy opened. Keep an eye on the stop and reaction."
    : "Paper position closed. Review what price did next.";
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
    if (lastAnalysis) {
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
  const payload = { exportedAt: new Date().toISOString(), balance: tradingBalance, position, tradeHistory };
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
  if (event.key.toLowerCase() === "t") showScreen("trade");
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
  ["bunmoney_state","bunmoney_favorites","bunmoney_mascot","bunmoney_last_analysis"].forEach(k => localStorage.removeItem(k));
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
let demoMarketEnabled = true;
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
  const stepMinutes = interval === "1day" ? 1440 : interval === "1week" ? 10080 : interval === "1month" ? 43200 : interval === "1h" ? 60 : interval === "4h" ? 240 : interval === "15min" ? 15 : 5;
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
  return { status: "ok", meta: { symbol, interval }, values: candles };
}

const originalMarketEngineRequest = window.marketEngineRequest || marketEngineRequest;
window.marketEngineRequest = async function(endpoint, params = {}) {
  try {
    return await originalMarketEngineRequest(endpoint, params);
  } catch (error) {
    if (!demoMarketEnabled) throw error;
    const symbol = String(params.symbol || "SOUN").toUpperCase();
    if (endpoint === "/time_series") return demoCandles(symbol, params.interval || "5min", Math.min(Number(params.outputsize || 80), 100));
    if (endpoint === "/price") {
      const candles = demoCandles(symbol, "5min", 3).values;
      const latest = candles[candles.length - 1];
      return { status: "ok", symbol, price: latest.close, demo: true };
    }
    throw error;
  }
};

/* Replace the analysis request reference so analyze/other callers use the demo fallback. */
marketEngineRequest = window.marketEngineRequest;

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
  demoMarketEnabled = !demoMarketEnabled;
  localStorage.setItem("bunmoney_demo_market", String(demoMarketEnabled));
  setText("demoMarketButton", `Demo Market: ${demoMarketEnabled ? "ON" : "OFF"}`);
  showPopup("📡 Demo Market", demoMarketEnabled ? "Demo market data will keep the prototype usable when live data is unavailable." : "Demo fallback is off. Live market data must be configured.");
}
function loadDemoSettings() {
  const saved = localStorage.getItem("bunmoney_demo_market");
  if (saved !== null) demoMarketEnabled = saved !== "false";
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

const originalPaperSell = window.paperSell || paperSell;
window.paperSell = function() {
  const symbol = document.getElementById("symbol")?.textContent || "";
  originalPaperSell();
  if (tradeHistory.length) tradeHistory[tradeHistory.length - 1].symbol = symbol;
  saveGameState();
  renderTradeHistory();
};
paperSell = window.paperSell;

function exportBunMoneyData() {
  const data = {
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
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.profile) { demoProfile = { ...demoProfile, ...data.profile }; localStorage.setItem("bunmoney_profile", JSON.stringify(demoProfile)); }
        if (data.state) localStorage.setItem("bunmoney_state", JSON.stringify(data.state));
        if (Array.isArray(data.favorites)) localStorage.setItem("bunmoney_favorites", JSON.stringify(data.favorites));
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
  loadDemoSettings();
  renderTradeHistory();
  updateProfile();
  updateAchievements();
  updateRewards();
  updateLevel();
  rotateQuote();
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
