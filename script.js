/* =========================================================
   BUNMONEY — MASTER BRAIN
   Prototype / Paper Trading / Analysis Assistant
========================================================= */

const API_KEY = "";
// Production: set MARKET_ENGINE_URL to your secure backend. Leave blank for CodePen prototype mode.
const MARKET_ENGINE_URL = "https://legendary-zebra-rqjgrgvwjxfp4j6-3000.app.github.dev";

// Set this to your deployed BunMoney backend URL in production. Keep provider secrets server-side.

async function marketEngineRequest(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString();
  if (MARKET_ENGINE_URL) {
    const backendEndpoint =
      endpoint === "/time_series" ? "/api/time-series" :
      endpoint === "/price" || endpoint === "/quote" ? "/api/quote" :
      endpoint;

    const response = await fetch(`${MARKET_ENGINE_URL}${backendEndpoint}?${query}`);
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
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  const target = document.getElementById(screenName);
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
  selectedTimeframe = timeframe;
  document.querySelectorAll(".timeframes button").forEach(button => {
    button.classList.remove("active");
    const buttonTimeframe = button.dataset.timeframe;
    if (buttonTimeframe === timeframe) button.classList.add("active");
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

/* ===== SMART TICKER SEARCH ===== */
const TICKER_DIRECTORY = [
  ["AAPL","Apple","Technology"],["ABNB","Airbnb","Travel"],["AMD","Advanced Micro Devices","Technology"],
  ["AMZN","Amazon","Consumer"],["BA","Boeing","Industrial"],["BBAI","BigBear.ai","AI / Defense"],
  ["COIN","Coinbase","Crypto / Finance"],["CRM","Salesforce","Technology"],["DIS","Disney","Entertainment"],
  ["F","Ford","Auto"],["GOLD","Gold.com","Precious Metals"],["GOOG","Alphabet Class C","Technology"],
  ["GOOGL","Alphabet Class A","Technology"],["GRAB","Grab Holdings","Technology"],["INTC","Intel","Technology"],
  ["IWM","iShares Russell 2000 ETF","ETF"],["JNJ","Johnson & Johnson","Healthcare"],["JPM","JPMorgan Chase","Finance"],
  ["KO","Coca-Cola","Consumer"],["META","Meta Platforms","Technology"],["MSFT","Microsoft","Technology"],
  ["MSTR","Strategy","Bitcoin / Finance"],["NFLX","Netflix","Entertainment"],["NIO","NIO","Auto"],
  ["NVDA","NVIDIA","Technology"],["ORCL","Oracle","Technology"],["PLTR","Palantir Technologies","AI / Defense"],
  ["QQQ","Invesco QQQ Trust","ETF"],["RIVN","Rivian","Auto"],["ROKU","Roku","Technology"],
  ["SHOP","Shopify","Technology"],["SMCI","Super Micro Computer","Technology"],["SOFI","SoFi Technologies","Finance"],
  ["SOUN","SoundHound AI","AI / Technology"],["SPY","SPDR S&P 500 ETF","ETF"],["T","AT&T","Telecom"],
  ["TSLA","Tesla","Auto / Technology"],["TQQQ","ProShares UltraPro QQQ","ETF"],["UBER","Uber","Technology"],
  ["V","Visa","Finance"],["WMT","Walmart","Consumer"],["XLE","Energy Select Sector SPDR","ETF"],
  ["XLF","Financial Select Sector SPDR","ETF"],["XOM","Exxon Mobil","Energy"],["XYZ","Block","Finance / Technology"],
  ["GME","GameStop","Retail"],["AMC","AMC Entertainment","Entertainment"],["RKLB","Rocket Lab","Aerospace"],
  ["IONQ","IonQ","Quantum"],["RGTI","Rigetti Computing","Quantum"],["QBTS","D-Wave Quantum","Quantum"],
  ["MU","Micron Technology","Semiconductors"],["ARM","Arm Holdings","Semiconductors"],["AVGO","Broadcom","Semiconductors"],
  ["CRWD","CrowdStrike","Cybersecurity"],["SNOW","Snowflake","Technology"],["SOXL","Direxion Semiconductor Bull 3X","ETF"],
  ["SQQQ","ProShares UltraPro Short QQQ","ETF"],["GLD","SPDR Gold Shares","Gold ETF"]
].map(([symbol,name,category]) => ({symbol,name,category}));

let tickerSearchTimer = null;
let tickerSuggestionIndex = -1;

function normalizeTickerQuery(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
}

function getTickerSuggestions(query) {
  const q = normalizeTickerQuery(query);
  if (!q) return TICKER_DIRECTORY.slice(0, 8);
  return TICKER_DIRECTORY.filter(item =>
    item.symbol.startsWith(q) || item.name.toUpperCase().includes(q) || item.category.toUpperCase().includes(q)
  ).sort((a,b) => {
    const as = a.symbol === q ? 0 : a.symbol.startsWith(q) ? 1 : a.name.toUpperCase().startsWith(q) ? 2 : 3;
    const bs = b.symbol === q ? 0 : b.symbol.startsWith(q) ? 1 : b.name.toUpperCase().startsWith(q) ? 2 : 3;
    return as - bs || a.symbol.localeCompare(b.symbol);
  }).slice(0, 7);
}

function hideTickerSuggestions() {
  const box = document.getElementById("tickerSuggestions");
  if (box) { box.hidden = true; box.innerHTML = ""; }
  tickerSuggestionIndex = -1;
}

function selectTickerSuggestion(symbol, action = "fill") {
  const input = document.getElementById("ticker");
  if (!input) return;
  input.value = symbol;
  hideTickerSuggestions();
  if (action === "analyze") analyze(true);
  else input.focus();
}

function addTickerSuggestionFavorite(symbol) {
  const input = document.getElementById("ticker");
  if (input) input.value = symbol;
  hideTickerSuggestions();
  if (typeof addFavorite === "function") {
    const favoriteInput = document.getElementById("favoriteInput");
    if (favoriteInput) favoriteInput.value = symbol;
    addFavorite();
  }
}

function renderTickerSuggestions(query) {
  const box = document.getElementById("tickerSuggestions");
  if (!box) return;
  const q = normalizeTickerQuery(query);
  const suggestions = getTickerSuggestions(q);
  if (!q) {
    box.innerHTML = `<div class="ticker-search-status">🔎 Search a ticker or company name</div>` +
      suggestions.map(item => tickerSuggestionMarkup(item)).join("");
  } else if (!suggestions.length) {
    box.innerHTML = `<div class="ticker-search-status">No local match for <strong>${escapeHtml(q)}</strong>. Press Analyze to verify it with market data.</div>`;
  } else {
    box.innerHTML = suggestions.map(item => tickerSuggestionMarkup(item)).join("");
  }
  box.hidden = false;
  tickerSuggestionIndex = -1;
}

function tickerSuggestionMarkup(item) {
  return `<button type="button" class="ticker-suggestion" data-ticker="${escapeHtml(item.symbol)}">
    <span class="ticker-suggestion-main"><span class="ticker-suggestion-symbol">${escapeHtml(item.symbol)}</span><span class="ticker-suggestion-name">${escapeHtml(item.name)} · ${escapeHtml(item.category)}</span></span>
    <span class="ticker-suggestion-action">Analyze →</span>
  </button>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
}

function initTickerSearch() {
  const input = document.getElementById("ticker");
  const box = document.getElementById("tickerSuggestions");
  if (!input || !box || input.dataset.smartSearchReady) return;
  input.dataset.smartSearchReady = "1";
  input.addEventListener("input", () => {
    clearTimeout(tickerSearchTimer);
    const raw = input.value;
    tickerSearchTimer = setTimeout(() => renderTickerSuggestions(raw), 80);
  });
  input.addEventListener("focus", () => renderTickerSuggestions(input.value));
  input.addEventListener("keydown", event => {
    const buttons = [...box.querySelectorAll(".ticker-suggestion")];
    if (event.key === "Escape") { hideTickerSuggestions(); return; }
    if (event.key === "ArrowDown" && buttons.length) {
      event.preventDefault(); tickerSuggestionIndex = Math.min(tickerSuggestionIndex + 1, buttons.length - 1);
      buttons.forEach((b,i) => b.style.outline = i === tickerSuggestionIndex ? "2px solid var(--lime)" : "none");
    }
    if (event.key === "ArrowUp" && buttons.length) {
      event.preventDefault(); tickerSuggestionIndex = Math.max(tickerSuggestionIndex - 1, 0);
      buttons.forEach((b,i) => b.style.outline = i === tickerSuggestionIndex ? "2px solid var(--lime)" : "none");
    }
    if (event.key === "Enter" && tickerSuggestionIndex >= 0 && buttons[tickerSuggestionIndex]) {
      event.preventDefault(); buttons[tickerSuggestionIndex].click();
    }
  });
  box.addEventListener("click", event => {
    const button = event.target.closest(".ticker-suggestion");
    if (button) selectTickerSuggestion(button.dataset.ticker, "analyze");
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".ticker-search-wrap")) hideTickerSuggestions();
  });
}

function smartSearchContextActions(symbol) {
  const box = document.getElementById("tickerSuggestions");
  if (!box) return;
  const safe = escapeHtml(normalizeTickerQuery(symbol));
  if (!safe) return;
  box.innerHTML = `<div class="ticker-search-status"><strong>${safe}</strong> selected</div><div class="ticker-context">
    <button type="button" onclick="selectTickerSuggestion('${safe}','analyze')">📊 Analyze</button>
    <button type="button" onclick="addTickerSuggestionFavorite('${safe}')">⭐ Add favorite</button>
    <button type="button" onclick="showScreen('trade'); hideTickerSuggestions()">🎯 Trade Lab</button>
  </div>`;
  box.hidden = false;
}

async function analyze(force = false) {
  const tickerElement = document.getElementById("ticker");
  if (!tickerElement) return;
  const ticker = normalizeTickerQuery(tickerElement.value);
  tickerElement.value = ticker;
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

    lastLivePrice = currentPrice;
    window.lastLivePrice = currentPrice;
    setText("price", formatMoney(currentPrice));
    setText("paperCurrentPrice", formatMoney(currentPrice));
    updatePaperPL(currentPrice);
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
  drawLevel(ctx, width, yPosition(entry), "rgba(255,255,255,.75)", "ENTRY");
  drawLevel(ctx, width, yPosition(stop), "rgba(239,68,68,.9)", "STOP");
  drawLevel(ctx, width, yPosition(target), "rgba(132,204,22,.9)", "TARGET");

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
function startLivePrice() {
  if (livePriceTimer) clearInterval(livePriceTimer);
  livePriceTimer = setInterval(async () => {
    const tickerElement = document.getElementById("ticker");
    if (!tickerElement) return;
    const ticker = tickerElement.value.toUpperCase().trim();
    if (!ticker) return;
    if (!MARKET_ENGINE_URL && (!API_KEY || API_KEY === "YOUR_TWELVE_DATA_API_KEY") && !demoMarketEnabled) return;
    try {
      const data = await marketEngineRequest("/price", { symbol: ticker });
      if (data.price && Number.isFinite(Number(data.price))) {
        const newPrice = Number(data.price);
        lastLivePrice = newPrice;
        window.lastLivePrice = newPrice;
        setText("price", formatMoney(newPrice));
        setText("paperCurrentPrice", formatMoney(newPrice));
        updatePaperPL(newPrice);
        if (window.lastCandles?.length) drawChart(window.lastCandles, window.lastSupport, window.lastResistance, window.lastEntry, window.lastStop, window.lastTarget, window.lastBreakoutIndex, window.lastRetestIndex, window.lastSma10, window.lastSma20);
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

function getDisplayedPrice() {
  const text = document.getElementById("price")?.textContent || "";
  const parsed = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function paperBuy() {
  if (position) { setText("reason", "You already have an open paper position."); return; }
  const price = Number.isFinite(lastLivePrice) ? lastLivePrice : getDisplayedPrice();
  if (!Number.isFinite(price)) { setText("reason", "Analyze a market before opening a paper trade."); return; }
  position = { side: "LONG", entry: price, amount: tradingBalance, symbol: document.getElementById("symbol")?.textContent || "" };
  setText("position", `LONG @ ${formatMoney(price)}`);
  setText("paperCurrentPrice", formatMoney(price));
  updatePaperPL(price);
  setText("reason", "Paper long opened. Bun is tracking your gain/loss as the market moves. 🐰📊");
  mascotReaction("Position opened. Protect the bag. 🐰💰");
  saveGameState();
}

function paperSell() {
  if (!position) { setText("reason", "There is no open paper position."); return; }
  const price = Number.isFinite(lastLivePrice) ? lastLivePrice : getDisplayedPrice();
  if (!Number.isFinite(price)) return;
  const percentageMove = (price - position.entry) / position.entry;
  const profit = position.amount * percentageMove;
  tradingBalance += profit;
  tradeHistory.push({ side: position.side, symbol: position.symbol || document.getElementById("symbol")?.textContent || "", entry: position.entry, exit: price, profit, time: new Date().toLocaleString() });
  position = null;
  setText("tradingBalance", formatMoney(tradingBalance));
  setText("position", "NONE");
  setText("paperCurrentPrice", formatMoney(price));
  setText("paperPL", formatMoney(profit));
  setText("paperPLPercent", `${profit >= 0 ? "+" : ""}${percentageMove.toFixed(2)}%`);
  setText("paperPLMessage", `${profit >= 0 ? "You gained" : "You lost"} ${formatMoney(Math.abs(profit))} on this paper trade.`);
  rewardPoints += profit > 0 ? 25 : 5;
  updateLevel(); updateRewards();
  setText("reason", `Paper trade closed: ${profit >= 0 ? "+" : "-"}${formatMoney(Math.abs(profit))} (${percentageMove >= 0 ? "+" : ""}${percentageMove.toFixed(2)}%).`);
  mascotReaction(profit >= 0 ? "Nice trade! Stack those wins. 🐰📈" : "Loss taken. Learn from it and protect the next trade. 🐰");
  saveGameState();
  renderTradeHistory();
}

function updatePaperPL(price) {
  if (!Number.isFinite(Number(price))) return;
  setText("paperCurrentPrice", formatMoney(Number(price)));
  if (!position) {
    setText("paperPL", "$0.00");
    setText("paperPLPercent", "0.00%");
    setText("paperPLMessage", "No open position.");
    return;
  }
  const current = Number(price);
  const move = (current - position.entry) / position.entry;
  const pl = position.amount * move;
  setText("paperPL", `${pl >= 0 ? "+" : "-"}${formatMoney(Math.abs(pl))}`);
  setText("paperPLPercent", `${move >= 0 ? "+" : ""}${(move * 100).toFixed(2)}%`);
  setText("paperPLMessage", `${pl >= 0 ? "You're up" : "You're down"} ${formatMoney(Math.abs(pl))} (${move >= 0 ? "+" : ""}${(move * 100).toFixed(2)}%) right now.`);
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
    if (img) { img.src = `assets/rank_${rank.toLowerCase()}.png`; img.alt = `${rank} Bun rank`; }
    else rankIcon.textContent = icons[rank];
  }
  const profileImg = document.getElementById("profileAvatarImage");
  if (profileImg && !localStorage.getItem("bunmoney_pfp_asset")) {
    profileImg.src = DEFAULT_PFP_URL;
  }
}
function updateRewards() { setText("rewardPoints", rewardPoints); }

const BUNMONEY_FUTURE_EVENTS = [
  { date: "2026-09-15", dateLabel: "Sep 15–16, 2026", title: "FOMC meeting", category: "Rates", codes: ["XAUUSD", "EURUSD", "USDJPY", "SPY", "QQQ"], why: "The Federal Reserve reviews monetary policy. Rate and guidance changes can quickly move stocks, bonds, the dollar and gold." },
  { date: "2026-09-16", dateLabel: "Sep 16, 2026 · 8:30 AM ET", title: "U.S. Import & Export Price Indexes", category: "Inflation", codes: ["XAUUSD", "DXY", "EURUSD"], why: "Trade-price data helps show imported inflation and pricing pressure, which can influence expectations for Fed policy and interest rates." },
  { date: "2026-09-18", dateLabel: "Sep 18, 2026 · 10:00 AM ET", title: "State Employment & Unemployment", category: "Jobs", codes: ["SPY", "QQQ", "DXY", "XAUUSD"], why: "State labor-market data gives a more detailed look at employment conditions and can add context to the national jobs picture." },
  { date: "2026-09-29", dateLabel: "Sep 29, 2026 · 10:00 AM ET", title: "JOLTS Job Openings", category: "Jobs", codes: ["SPY", "QQQ", "DXY", "XAUUSD"], why: "Job openings help measure labor demand. A stronger or weaker labor market can change expectations for future Fed policy." },
  { date: "2026-09-30", dateLabel: "Sep 30, 2026 · 10:00 AM ET", title: "Metropolitan Employment & Unemployment", category: "Jobs", codes: ["SPY", "QQQ", "DXY", "XAUUSD"], why: "Local labor data can reveal regional employment trends and help traders gauge how broadly the labor market is changing." },
  { date: "2026-10-07", dateLabel: "Oct 7, 2026 · 2:00 PM ET", title: "FOMC minutes", category: "Rates", codes: ["XAUUSD", "EURUSD", "USDJPY", "SPY", "QQQ"], why: "The minutes give more detail on what Fed officials discussed at the September meeting, which can shift expectations even after the decision." },
  { date: "2026-10-27", dateLabel: "Oct 27–28, 2026", title: "FOMC meeting", category: "Rates", codes: ["XAUUSD", "EURUSD", "USDJPY", "SPY", "QQQ"], why: "Another scheduled Fed policy meeting. Traders will watch the decision, statement and press conference for clues about the path of rates." }
];
function renderFutureEvents() {
  const el = document.getElementById("futureEvents");
  if (!el) return;
  const now = new Date();
  const upcoming = BUNMONEY_FUTURE_EVENTS.filter(e => new Date(e.date + "T23:59:59") >= now).slice(0, 6);
  el.innerHTML = upcoming.map(e => `<article class="future-event"><div class="future-event-date">${e.dateLabel}</div><div class="future-event-main"><div class="future-event-codes">${(e.codes || []).map(code => `<span>${code}</span>`).join("")}</div><div class="future-event-head"><strong>${e.title}</strong><span>${e.category}</span></div><p>${e.why}</p></div></article>`).join("") || `<div class="alert empty">No scheduled events in the current list.</div>`;
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
  updateArcadeBank();
  updateLevel();
  updateRank();
  updateRewards();
  renderFutureEvents();
  updateProfile();
  updateAchievements();
  restoreBunAssets();
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
  const container = document.getElementById("chartFavoritesList") || document.getElementById("favoritesList");
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
    content.innerHTML = `<div class="mini-game-selection"><h4>Single-player</h4><button onclick="startMiniGame('reaction')">⚡ Reaction Rush<small>Tap the target as fast as you can.</small></button><button onclick="startMiniGame('price')">🎯 Price Guess<small>Guess whether the next simulated tick goes up or down.</small></button></div>`;
  } else {
    content.innerHTML = `<div class="mini-game-selection"><h4>Online</h4><p class="mini-games-hint">Online matchmaking is a prototype lobby for now. Real multiplayer needs the future backend.</p><button onclick="startMiniGame('duel')">⚔️ 1v1 Reaction Duel<small>Play against a simulated opponent.</small></button><button onclick="startMiniGame('co-op')">🤝 Co-op Challenge<small>Team with a simulated player to reach a target.</small></button></div>`;
  }
}
function startMiniGame(game) {
  clearMiniGameTimer();
  miniGameState.game = game; miniGameState.score = 0;
  const content = document.getElementById("miniGamesContent");
  if (!content) return;
  if (game === "reaction" || game === "duel") {
    miniGameState.target = Math.floor(Math.random()*1000)+600;
    content.innerHTML = `<div class="mini-game-play"><div class="mini-score">Score <strong id="miniScore">0</strong></div><button id="reactionTarget" class="reaction-target" onclick="hitReactionTarget()">TAP!</button><p id="miniGameStatus">Hit the button 10 times.</p><button class="mini-back" onclick="chooseMiniGameMode('${miniGameState.mode}')">← Back</button></div>`;
  } else if (game === "price") {
    miniGameState.target = Math.random() > .5 ? 1 : -1;
    content.innerHTML = `<div class="mini-game-play"><h4>Next tick?</h4><p class="mini-price-symbol">${document.getElementById("symbol")?.textContent || "MARKET"}</p><div class="mini-choice-row"><button onclick="makePriceGuess(1)">📈 UP</button><button onclick="makePriceGuess(-1)">📉 DOWN</button></div><p id="miniGameStatus">Make your call.</p><button class="mini-back" onclick="chooseMiniGameMode('single')">← Back</button></div>`;
  } else {
    miniGameState.target = 10;
    content.innerHTML = `<div class="mini-game-play"><div class="mini-score">Team progress <strong id="miniScore">0</strong>/10</div><button class="reaction-target coop-target" onclick="coOpTap()">HELP TEAM</button><p id="miniGameStatus">Tap to help your teammate reach 10.</p><button class="mini-back" onclick="chooseMiniGameMode('online')">← Back</button></div>`;
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
    if (lastAnalysis) {
      updateFavoriteFromAnalysis(lastAnalysis.ticker, lastAnalysis);
      updateChartCopilot();
      updateBunAIHome();
      updateTradePlan();
      updateMarketSnapshot();
      renderFavorites();
    }
  };
}
function initializeBunMoneyUpgrade() {
  initTickerSearch();
  loadFavorites();
  createFavoritesScreen();
  createFavoritesNav();
  createChartCopilot();
  createQuickTradeButtons();
  updateChartCopilot();
  updateBunAIHome();
  updateTradePlan();
  updateMarketSnapshot();
  renderFutureEvents();
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

function demoLivePrice(symbol) {
  const base = DEMO_MARKET_BASE[symbol] || 25;
  const now = Date.now() / 1000;
  const seed = demoSeed(symbol);
  const waveA = Math.sin(now / 19 + seed) * 0.006;
  const waveB = Math.sin(now / 47 + seed * 0.7) * 0.0035;
  const drift = Math.sin(now / 180 + seed * 0.13) * 0.004;
  return base * (1 + waveA + waveB + drift);
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
      return { status: "ok", symbol, price: demoLivePrice(symbol).toFixed(4), demo: true };
    }
    throw error;
  }
};

/* Replace the analysis request reference so analyze/other callers use the demo fallback. */
marketEngineRequest = window.marketEngineRequest;

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

function showDataPrivacy() {
  showPopup("🔐 Prototype Privacy", "This version keeps demo profile, favorites, paper trades, XP, themes, and settings in this browser's local storage. No real brokerage credentials are stored here.");
}
function showKeyboardHelp() {
  showPopup("⌨️ Shortcuts", "/ = focus analyzer · A = analyze · H = Home · T = Trade. Input fields ignore these shortcuts.");
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
  renderTradeHistory();
  updateProfile();
  updateAchievements();
  updateRewards();
  updateLevel();
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
   BUNMONEY — TRADING COPILOT V2 UPGRADE
   Adds stronger confirmation logic, risk-based sizing,
   long/short paper trading, richer scanner + BunAI,
   and a cleaner approval-first workflow.
========================================================= */

(function installTradingCopilotV2() {
  const originalAnalyzeV2 = analyze;

  function pct(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function money(value) {
    return formatMoney(Number(value));
  }

  function getAccountRiskBudget(balance) {
    // Educational default: risk no more than 1% of paper balance per idea.
    return Math.max(0.01, Number(balance || 0) * 0.01);
  }

  function buildEnhancedAnalysis(a) {
    if (!a) return a;

    const candles = window.lastCandles || [];
    const last = candles[candles.length - 1];
    const prior = candles[candles.length - 2];

    const close = Number(a.currentPrice);
    const open = Number(last?.open);
    const high = Number(last?.high);
    const low = Number(last?.low);
    const priorHigh = Number(prior?.high);
    const priorLow = Number(prior?.low);

    const body = Math.abs(close - open);
    const upperWick = Number.isFinite(high) ? high - Math.max(open, close) : 0;
    const lowerWick = Number.isFinite(low) ? Math.min(open, close) - low : 0;

    const bullishRejection = Number.isFinite(lowerWick) && lowerWick > Math.max(body * 1.5, close * 0.002);
    const bearishRejection = Number.isFinite(upperWick) && upperWick > Math.max(body * 1.5, close * 0.002);

    const nearResistance = Math.abs(close - Number(a.resistance)) <= close * 0.012;
    const nearSupport = Math.abs(close - Number(a.support)) <= close * 0.012;

    const bullishMomentum = a.trend === "BULLISH" && Number(a.rsi) >= 50 && Number(a.rsi) < 72;
    const bearishMomentum = a.trend === "BEARISH" && Number(a.rsi) <= 50 && Number(a.rsi) > 28;
    const volumeConfirmed = Number(a.volumeRatio) >= 1.15;

    let longScore = 0;
    let shortScore = 0;

    if (a.trend === "BULLISH") longScore += 2;
    if (a.trend === "BEARISH") shortScore += 2;
    if (bullishMomentum) longScore += 1;
    if (bearishMomentum) shortScore += 1;
    if (bullishRejection && nearSupport) longScore += 2;
    if (bearishRejection && nearResistance) shortScore += 2;
    if (a.breakout === "POSSIBLE BREAKOUT" && volumeConfirmed) longScore += 2;
    if (a.retest === "RETEST AREA" && volumeConfirmed) longScore += 2;
    if (volumeConfirmed) {
      if (a.trend === "BULLISH") longScore += 1;
      if (a.trend === "BEARISH") shortScore += 1;
    }

    const resistanceBreak = Number.isFinite(priorHigh) && close > priorHigh;
    const supportBreak = Number.isFinite(priorLow) && close < priorLow;

    if (resistanceBreak && volumeConfirmed) longScore += 1;
    if (supportBreak && volumeConfirmed) shortScore += 1;

    const preferredDirection = longScore > shortScore ? "LONG" : shortScore > longScore ? "SHORT" : "NONE";

    let confirmation = "WAITING";
    if (preferredDirection === "LONG") {
      if (longScore >= 6 && volumeConfirmed && (a.breakout === "POSSIBLE BREAKOUT" || bullishRejection || a.retest === "RETEST AREA")) {
        confirmation = "CONFIRMED LONG WATCH";
      } else if (longScore >= 3) {
        confirmation = "FORMING LONG";
      }
    } else if (preferredDirection === "SHORT") {
      if (shortScore >= 6 && volumeConfirmed && (supportBreak || bearishRejection)) {
        confirmation = "CONFIRMED SHORT WATCH";
      } else if (shortScore >= 3) {
        confirmation = "FORMING SHORT";
      }
    }

    let direction = "NONE";
    if (confirmation.includes("LONG")) direction = "LONG";
    if (confirmation.includes("SHORT")) direction = "SHORT";

    let entry = close;
    let stop = close;
    let target = close;

    if (direction === "LONG") {
      stop = Math.min(Number(a.support), close * 0.985);
      if (!Number.isFinite(stop) || stop >= close) stop = close * 0.985;
      const riskDistance = Math.max(close - stop, close * 0.005);
      target = close + riskDistance * 2.25;
    } else if (direction === "SHORT") {
      stop = Math.max(Number(a.resistance), close * 1.015);
      if (!Number.isFinite(stop) || stop <= close) stop = close * 1.015;
      const riskDistance = Math.max(stop - close, close * 0.005);
      target = Math.max(0.01, close - riskDistance * 2.25);
    } else {
      stop = close * 0.985;
      target = close * 1.03;
    }

    const riskDistance = Math.abs(entry - stop);
    const rewardDistance = Math.abs(target - entry);
    const rr = riskDistance > 0 ? rewardDistance / riskDistance : 0;
    const riskBudget = getAccountRiskBudget(tradingBalance);
    const riskBasedShares = riskDistance > 0 ? riskBudget / riskDistance : 0;
    const maxLoss = riskDistance * riskBasedShares;
    const notional = entry * riskBasedShares;

    let decision = "WAIT";
    if (direction === "LONG" && confirmation === "CONFIRMED LONG WATCH" && rr >= 2) decision = "WATCH FOR LONG";
    else if (direction === "SHORT" && confirmation === "CONFIRMED SHORT WATCH" && rr >= 2) decision = "WATCH FOR SHORT";
    else if (direction !== "NONE") decision = direction === "LONG" ? "FORMING LONG" : "FORMING SHORT";

    const confidence = Math.max(5, Math.min(95, Math.round(
      45 + Math.max(longScore, shortScore) * 7 + (volumeConfirmed ? 6 : 0) + (rr >= 2 ? 7 : 0)
    )));

    const setupQuality = confidence >= 78 ? "HIGH" : confidence >= 60 ? "MODERATE" : "LOW";

    let trigger = "Wait for a clean price-action trigger.";
    if (direction === "LONG") {
      trigger = a.breakout === "POSSIBLE BREAKOUT"
        ? "Wait for a breakout close and/or successful retest above resistance."
        : bullishRejection && nearSupport
          ? "Watch for buyers to defend support after the rejection candle."
          : "Wait for buyers to reclaim a key level with volume."
    } else if (direction === "SHORT") {
      trigger = bearishRejection && nearResistance
        ? "Watch for sellers to defend resistance after the rejection candle."
        : "Wait for a breakdown/rejection with volume before considering the short."
    }

    let reason = `Trend: ${String(a.trend || "SIDEWAYS").toLowerCase()}. `;
    reason += `RSI: ${Number.isFinite(Number(a.rsi)) ? Number(a.rsi).toFixed(1) : "—"}. `;
    reason += `Volume: ${Number(a.volumeRatio || 0).toFixed(2)}x average. `;
    if (bullishRejection && nearSupport) reason += "Bullish rejection near support. ";
    if (bearishRejection && nearResistance) reason += "Bearish rejection near resistance. ";
    if (a.breakout === "POSSIBLE BREAKOUT") reason += "Price is testing a breakout. ";
    if (a.retest === "RETEST AREA") reason += "A retest is developing. ";
    reason += decision === "WAIT" ? "No clean confirmation yet — patience wins here." : `${trigger}`;

    return {
      ...a,
      entry,
      stop,
      target,
      rr,
      decision,
      setupQuality,
      confidence,
      confirmation,
      trigger,
      direction,
      longScore,
      shortScore,
      bullishRejection,
      bearishRejection,
      nearSupport,
      nearResistance,
      volumeConfirmed,
      riskBudget,
      riskBasedShares,
      positionSizeShares: riskBasedShares,
      positionNotional: notional,
      maxLoss,
      potentialReward: rewardDistance * riskBasedShares,
      enhanced: true,
      reason
    };
  }


  function setupType(a) {
    if (!a) return "NO SETUP";
    if (a.breakout === "POSSIBLE BREAKOUT" && a.volumeConfirmed) return "BREAKOUT / RETEST";
    if (a.bullishRejection && a.nearSupport) return "SUPPORT BOUNCE";
    if (a.bearishRejection && a.nearResistance) return "RESISTANCE REJECTION";
    if (a.direction === "LONG") return "BULLISH CONTINUATION";
    if (a.direction === "SHORT") return "BEARISH CONTINUATION";
    return "NO CLEAN SETUP";
  }

  function renderTradingIntelligenceV2(a) {
    let card = document.getElementById("tradingIntelligenceV2");
    const decision = document.getElementById("decision");
    if (!card && decision?.parentNode) {
      card = document.createElement("section");
      card.id = "tradingIntelligenceV2";
      card.className = "setup ti2-card";
      decision.parentNode.insertBefore(card, decision.nextSibling);
    }
    if (!card || !a) return;

    const dir = a.direction || "NONE";
    const setup = setupType(a);
    const score = Math.max(0, Math.min(100, Number(a.confidence || 0)));
    const risk = Math.abs(a.entry - a.stop);
    const tp1 = dir === "LONG" ? a.entry + risk * 1.5 : dir === "SHORT" ? Math.max(0.01, a.entry - risk * 1.5) : a.entry;
    const tp2 = dir === "LONG" ? a.entry + risk * 2.25 : dir === "SHORT" ? Math.max(0.01, a.entry - risk * 2.25) : a.entry;
    const entryLow = dir === "LONG" ? Math.min(a.entry, a.entry - risk * 0.25) : dir === "SHORT" ? a.entry : a.entry - risk * 0.25;
    const entryHigh = dir === "SHORT" ? Math.max(a.entry, a.entry + risk * 0.25) : dir === "LONG" ? a.entry : a.entry + risk * 0.25;
    const approvalKey = `${a.ticker}:${a.timestamp}`;
    const approved = sessionStorage.getItem("bunmoney_ti2_approved") === approvalKey;
    const checks = [
      [a.trend === "BULLISH" || a.trend === "BEARISH", "Trend has a direction"],
      [Number(a.rsi) >= 45 && Number(a.rsi) <= 75, "Momentum is not extreme"],
      [Boolean(a.volumeConfirmed), "Volume confirmation"],
      [a.rr >= 2, "Risk/reward ≥ 2:1"],
      [a.confirmation && a.confirmation !== "WAITING", "Price-action confirmation"]
    ];
    const checkHtml = checks.map(([ok, label]) => `<div class="ti2-check"><span>${ok ? "✓" : "•"}</span><small>${label}</small></div>`).join("");

    card.innerHTML = `
      <div class="section-title"><div><h3>🧠 Trading Intelligence 2.0</h3><p>Setup analysis, not an order.</p></div><strong class="ti2-score">${score}/100</strong></div>
      <div class="ti2-grid">
        <div><small>Bias</small><strong>${dir === "NONE" ? "NEUTRAL" : dir}</strong></div>
        <div><small>Setup</small><strong>${setup}</strong></div>
        <div><small>Confirmation</small><strong>${a.confirmation || "WAITING"}</strong></div>
        <div><small>R:R</small><strong>${a.rr ? a.rr.toFixed(2) + ":1" : "—"}</strong></div>
      </div>
      <div class="ti2-levels">
        <div><small>Entry zone</small><strong>${money(entryLow)} – ${money(entryHigh)}</strong></div>
        <div><small>Invalidation / SL</small><strong>${money(a.stop)}</strong></div>
        <div><small>TP1 (1.5R)</small><strong>${money(tp1)}</strong></div>
        <div><small>TP2 (2.25R)</small><strong>${money(tp2)}</strong></div>
      </div>
      <div class="ti2-checks">${checkHtml}</div>
      <p class="trade-plan-note">🐰 Trigger: ${a.trigger || "Wait for confirmation."}</p>
      <div class="ti2-gate ${approved ? "approved" : ""}">
        <strong>${approved ? "✓ SETUP APPROVED FOR YOUR REVIEW" : "🔐 MANUAL APPROVAL REQUIRED"}</strong>
        <small>${approved ? "BunMoney still does not place a real order." : "Review the levels and your risk before taking any action."}</small>
        <button class="mini-btn" id="ti2ApproveBtn">${approved ? "REVOKE APPROVAL" : "I REVIEWED THIS SETUP"}</button>
      </div>`;

    const btn = document.getElementById("ti2ApproveBtn");
    if (btn) btn.onclick = () => {
      if (sessionStorage.getItem("bunmoney_ti2_approved") === approvalKey) sessionStorage.removeItem("bunmoney_ti2_approved");
      else sessionStorage.setItem("bunmoney_ti2_approved", approvalKey);
      renderTradingIntelligenceV2(a);
    };
  }

  async function enhancedAnalyze(force = false) {
    await originalAnalyzeV2(force);
    if (!lastAnalysis || !window.lastCandles?.length) return;

    const enhanced = buildEnhancedAnalysis(lastAnalysis);
    lastAnalysis = enhanced;

    window.lastEntry = enhanced.entry;
    window.lastStop = enhanced.stop;
    window.lastTarget = enhanced.target;

    setText("entry", money(enhanced.entry));
    setText("stop", money(enhanced.stop));
    setText("target", money(enhanced.target));
    setText("rr", enhanced.rr ? enhanced.rr.toFixed(2) + ":1" : "—");
    setText("decision", enhanced.decision);
    setText("setupQuality", enhanced.setupQuality);
    setText("reason", enhanced.reason);
    setText("marketOutlook", enhanced.confirmation);
    const decisionElement = document.getElementById("decision");
    if (decisionElement) {
      decisionElement.classList.remove("long", "short", "wait");
      decisionElement.classList.add(enhanced.direction === "LONG" ? "long" : enhanced.direction === "SHORT" ? "short" : "wait");
    }

    updateTradePlanV2();
    updateMarketSnapshot();
    updateBunAIHome();
    updateChartCopilot();
    updatePositionSizerUI();
    renderTradingIntelligenceV2(enhanced);

    drawChart(
      window.lastCandles,
      window.lastSupport,
      window.lastResistance,
      enhanced.entry,
      enhanced.stop,
      enhanced.target,
      window.lastBreakoutIndex,
      window.lastRetestIndex,
      window.lastSma10,
      window.lastSma20
    );

    try {
      localStorage.setItem("bunmoney_last_analysis", JSON.stringify(enhanced));
    } catch (_) {}
  }

  analyze = enhancedAnalyze;
  window.analyze = enhancedAnalyze;

  function updatePositionSizerUI() {
    if (!lastAnalysis) return;
    let card = document.getElementById("positionSizerCard");
    const anchor = document.querySelector(".trade-plan-card") || document.querySelector(".readiness-card");
    if (!card && anchor) {
      card = document.createElement("section");
      card.id = "positionSizerCard";
      card.className = "setup position-sizer-card";
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }
    if (!card) return;

    const a = lastAnalysis;
    card.innerHTML = `
      <div class="section-title">
        <div><h3>🛡️ Risk-Based Position Size</h3><p>Educational sizing using a 1% paper-account risk budget.</p></div>
      </div>
      <div class="trade-plan-grid">
        <div class="trade-plan-stat"><small>Risk Budget</small><strong>${money(a.riskBudget)}</strong></div>
        <div class="trade-plan-stat"><small>Shares</small><strong>${Number(a.positionSizeShares).toFixed(4)}</strong></div>
        <div class="trade-plan-stat"><small>Notional</small><strong>${money(a.positionNotional)}</strong></div>
        <div class="trade-plan-stat"><small>Max Loss</small><strong>${money(a.maxLoss)}</strong></div>
      </div>
      <p class="trade-plan-note">Sizing is based on the distance to the stop, not a promise of profit. Paper trading only.</p>
    `;
  }

  function updateTradePlanV2() {
    if (!lastAnalysis) return;
    const a = lastAnalysis;
    const status = document.getElementById("tradePlanStatus");
    const direction = document.getElementById("tradePlanDirection");
    const entry = document.getElementById("tradePlanEntry");
    const stop = document.getElementById("tradePlanStop");
    const target = document.getElementById("tradePlanTarget");
    const confirmation = document.getElementById("planConfirmation");
    const reward = document.getElementById("planReward");
    const note = document.getElementById("tradePlanNote");
    if (![status, direction, entry, stop, target, confirmation, reward, note].every(Boolean)) return;

    const long = a.direction === "LONG";
    const short = a.direction === "SHORT";
    const confirmed = String(a.confirmation || "").includes("CONFIRMED");
    const rrGood = Number(a.rr) >= 2;
    const ready = confirmed && rrGood;

    direction.textContent = long ? "LONG WATCH" : short ? "SHORT WATCH" : "NO DIRECTION";
    direction.className = long ? "good" : short ? "bad" : "warn";
    entry.textContent = money(a.entry);
    stop.textContent = money(a.stop);
    target.textContent = money(a.target);
    status.textContent = ready ? "READY TO WATCH" : (long || short) ? "FORMING" : "WAIT";
    status.className = `trade-plan-status ${ready ? "good" : (long || short) ? "warn" : "neutral"}`;

    confirmation.classList.remove("ready", "caution", "blocked");
    confirmation.classList.add(confirmed ? "ready" : "caution");
    confirmation.querySelector("span").textContent = confirmed ? "✓" : "!";
    confirmation.querySelector("small").textContent = confirmed ? a.confirmation : a.trigger;

    reward.classList.remove("ready", "caution", "blocked");
    reward.classList.add(rrGood ? "ready" : "caution");
    reward.querySelector("span").textContent = rrGood ? "✓" : "!";
    reward.querySelector("small").textContent = rrGood
      ? `${Number(a.rr).toFixed(2)}:1 reward-to-risk.`
      : "Below the preferred 2:1 reward-to-risk threshold.";

    note.textContent = ready
      ? `Multiple confirmations are present. ${a.trigger}`
      : `No automatic trade is placed. ${a.trigger}`;
  }



  const originalPaperBuyV2 = paperBuy;
  const originalPaperSellV2 = paperSell;

  function openPaperPosition(side) {
    if (position) {
      if (position.side === side) {
        setText("reason", `You already have a ${side === "LONG" ? "long" : "short"} paper position.`);
        return;
      }
      closePaperPositionV2();
      return;
    }

    const price = Number.isFinite(lastLivePrice) ? lastLivePrice : getDisplayedPrice();
    if (!Number.isFinite(price)) {
      setText("reason", "Analyze a market before opening a paper trade.");
      return;
    }

    const symbol = document.getElementById("symbol")?.textContent || "";
    position = {
      side,
      entry: price,
      amount: Math.max(0.01, tradingBalance),
      symbol,
      openedAt: Date.now(),
      plannedStop: lastAnalysis?.stop ?? null,
      plannedTarget: lastAnalysis?.target ?? null
    };

    updatePaperPL(price);
    updatePositionUIV2();
    setText("reason", `${side === "LONG" ? "Paper long" : "Paper short"} opened at ${money(price)}. Bun is tracking it.`);
    mascotReaction(side === "LONG" ? "Long opened. Let buyers prove it. 🐰📈" : "Short opened. Let sellers prove it. 🐰📉");
    saveGameState();
  }

  function paperBuyV2() {
    if (position?.side === "SHORT") return closePaperPositionV2();
    openPaperPosition("LONG");
  }

  function paperSellV2() {
    if (position?.side === "LONG") return closePaperPositionV2();
    openPaperPosition("SHORT");
  }

  function closePaperPositionV2() {
    if (!position) {
      setText("reason", "There is no open paper position.");
      return;
    }

    const price = Number.isFinite(lastLivePrice) ? lastLivePrice : getDisplayedPrice();
    if (!Number.isFinite(price)) return;

    const rawMove = (price - position.entry) / position.entry;
    const move = position.side === "SHORT" ? -rawMove : rawMove;
    const profit = position.amount * move;

    tradingBalance += profit;
    tradeHistory.push({
      side: position.side,
      symbol: position.symbol || "",
      entry: position.entry,
      exit: price,
      profit,
      time: new Date().toLocaleString()
    });

    position = null;
    rewardPoints += profit > 0 ? 25 : 5;
    updateRewards();
    updateLevel();
    updateProfile();
    setText("tradingBalance", money(tradingBalance));
    setText("paperCurrentPrice", money(price));
    setText("paperPL", `${profit >= 0 ? "+" : "-"}${money(Math.abs(profit))}`);
    setText("paperPLPercent", `${move >= 0 ? "+" : ""}${(move * 100).toFixed(2)}%`);
    setText("paperPLMessage", `${profit >= 0 ? "You gained" : "You lost"} ${money(Math.abs(profit))} on this paper trade.`);
    setText("reason", `Paper ${position?.side || "trade"} closed: ${profit >= 0 ? "+" : "-"}${money(Math.abs(profit))}.`);
    mascotReaction(profit >= 0 ? "Winning trade. Stack those wins. 🐰📈" : "Loss taken. Learn and protect the next trade. 🐰");
    renderTradeHistory();
    updatePositionUIV2();
    saveGameState();
  }

  function updatePaperPLV2(price) {
    if (!Number.isFinite(Number(price))) return;
    const current = Number(price);
    setText("paperCurrentPrice", money(current));
    if (!position) {
      setText("paperPL", "$0.00");
      setText("paperPLPercent", "0.00%");
      setText("paperPLMessage", "No open position.");
      updatePositionUIV2();
      return;
    }
    const rawMove = (current - position.entry) / position.entry;
    const move = position.side === "SHORT" ? -rawMove : rawMove;
    const pl = position.amount * move;
    setText("paperPL", `${pl >= 0 ? "+" : "-"}${money(Math.abs(pl))}`);
    setText("paperPLPercent", `${move >= 0 ? "+" : ""}${(move * 100).toFixed(2)}%`);
    setText("paperPLMessage", `${pl >= 0 ? "You're up" : "You're down"} ${money(Math.abs(pl))} (${(move * 100).toFixed(2)}%) right now.`);
    updatePositionUIV2();
  }

  function updatePositionUIV2() {
    const positionEl = document.getElementById("position");
    if (!positionEl) return;
    positionEl.textContent = position
      ? `${position.side} @ ${money(position.entry)}`
      : "NONE";

    let close = document.getElementById("closePaperButton");
    const buttonRow = document.querySelector(".setup .button-row");
    if (!close && buttonRow) {
      close = document.createElement("button");
      close.id = "closePaperButton";
      close.className = "close-paper-button";
      close.textContent = "CLOSE POSITION";
      close.onclick = closePaperPositionV2;
      buttonRow.appendChild(close);
    }
    if (close) close.hidden = !position;
  }

  paperBuy = paperBuyV2;
  paperSell = paperSellV2;
  window.paperBuy = paperBuyV2;
  window.paperSell = paperSellV2;
  window.closePaperPosition = closePaperPositionV2;

  function getBunReplyV2(message) {
    const text = String(message || "").toLowerCase();
    const a = lastAnalysis;
    if (!a) return "Give me a ticker and analyze it first. I'll read the trend, levels, volume, confirmation, and risk.";

    if (text.includes("buy") || text.includes("enter")) {
      if (a.direction === "LONG" && String(a.confirmation).includes("CONFIRMED")) {
        return `LONG WATCH on ${a.ticker}. ${a.trigger} Entry ${money(a.entry)}, stop ${money(a.stop)}, target ${money(a.target)}, R/R ${a.rr.toFixed(2)}:1. This is not a guarantee.`;
      }
      return `I would WAIT on ${a.ticker}. ${a.trigger} Right now the setup is ${a.setupQuality.toLowerCase()}, not a confirmed entry.`;
    }
    if (text.includes("short") || text.includes("sell")) {
      if (a.direction === "SHORT" && String(a.confirmation).includes("CONFIRMED")) {
        return `SHORT WATCH on ${a.ticker}. ${a.trigger} Entry ${money(a.entry)}, stop ${money(a.stop)}, target ${money(a.target)}, R/R ${a.rr.toFixed(2)}:1. You still approve the trade.`;
      }
      return `I would WAIT on the short. ${a.trigger} Sellers need to prove control before you act.`;
    }
    if (text.includes("risk") || text.includes("stop")) {
      return `Risk check: ${a.riskBudget ? money(a.riskBudget) : "—"} educational risk budget, about ${Number(a.positionSizeShares || 0).toFixed(4)} shares by stop-distance sizing. Stop: ${money(a.stop)}.`;
    }
    if (text.includes("why")) return `${a.reason} Confidence is ${a.confidence}%.`;
    if (text.includes("rsi")) return `RSI is ${Number(a.rsi).toFixed(1)}. Use it with price action and volume — never as a standalone buy/sell trigger.`;
    if (text.includes("volume")) return `Volume is ${Number(a.volumeRatio).toFixed(2)}x its recent average. ${a.volumeConfirmed ? "That helps confirmation." : "That is not strong enough for my confirmation rule yet."}`;
    return `BunAI read: ${a.ticker} is ${a.trend.toLowerCase()}, setup ${a.setupQuality.toLowerCase()}, confirmation ${a.confirmation.toLowerCase()}. ${a.trigger}`;
  }

  getBunReply = getBunReplyV2;

  const originalScanMarketV2 = scanMarket;

  function scannerSetupScore(candles, closes, volumes, price, sma10, sma20, rsi) {
    const last = candles[candles.length - 1] || {};
    const prev = candles[candles.length - 2] || {};
    const recent = candles.slice(-20);
    const resistance = Math.max(...recent.map(c => Number(c.high || c.close)).filter(Number.isFinite));
    const support = Math.min(...recent.map(c => Number(c.low || c.close)).filter(Number.isFinite));
    const avgVol = average(volumes.slice(-20, -1));
    const volumeRatio = avgVol ? Number(volumes[volumes.length - 1]) / avgVol : 0;
    const trend = price > sma10 && sma10 > sma20 ? "BULLISH" : price < sma10 && sma10 < sma20 ? "BEARISH" : "SIDEWAYS";
    const range = Math.max(0.000001, resistance - support);
    const nearSupport = Math.abs(price - support) / Math.max(price, 0.000001) <= 0.015;
    const nearResistance = Math.abs(price - resistance) / Math.max(price, 0.000001) <= 0.015;
    const breakout = price >= resistance * 0.995 && price >= Number(prev.high || price);
    const breakdown = price <= support * 1.005 && price <= Number(prev.low || price);
    let direction = "NONE";
    if (trend === "BULLISH" && (breakout || nearSupport || rsi >= 50)) direction = "LONG";
    if (trend === "BEARISH" && (breakdown || nearResistance || rsi <= 50)) direction = "SHORT";
    let score = 0;
    score += trend === "SIDEWAYS" ? 8 : 25;
    score += direction === "LONG" || direction === "SHORT" ? 15 : 4;
    score += (rsi >= 45 && rsi <= 70) || (rsi <= 55 && rsi >= 30) ? 18 : 8;
    score += volumeRatio >= 1.25 ? 20 : volumeRatio >= 0.9 ? 10 : 3;
    score += breakout || breakdown ? 18 : nearSupport || nearResistance ? 13 : 6;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const setup = breakout || breakdown ? "BREAKOUT WATCH" : nearSupport ? "SUPPORT TEST" : nearResistance ? "RESISTANCE TEST" : direction === "LONG" ? "BULLISH CONTINUATION" : direction === "SHORT" ? "BEARISH CONTINUATION" : "NO CLEAN SETUP";
    const change = closes.length > 1 ? ((price - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : 0;
    const risk = direction === "LONG" ? Math.max(0.0001, price - support) : direction === "SHORT" ? Math.max(0.0001, resistance - price) : Math.max(0.0001, range * 0.25);
    const entry = price;
    const stop = direction === "LONG" ? Math.min(price - risk, support) : direction === "SHORT" ? Math.max(price + risk, resistance) : price - risk;
    const target = direction === "LONG" ? price + risk * 2 : direction === "SHORT" ? Math.max(0.01, price - risk * 2) : price;
    const rr = risk > 0 && direction !== "NONE" ? Math.abs(target - entry) / risk : 0;
    const reason = direction === "NONE"
      ? "No clear directional edge; wait for price action to break the range."
      : `${trend.toLowerCase()} trend, RSI ${rsi.toFixed(1)}, volume ${volumeRatio.toFixed(2)}x. ${breakout || breakdown ? "Price is testing a range edge." : "No decisive breakout yet."}`;
    return { price, change, trend, direction, score, setup, rsi, volumeRatio, support, resistance, entry, stop, target, rr, reason };
  }

  async function scanMarketV2() {
    const container = document.getElementById("scannerV2");
    const status = document.getElementById("scannerStatus");
    if (!container) return;
    container.innerHTML = `<div class="alert empty">Scanning watchlist…</div>`;
    if (status) status.textContent = "SCANNING";
    const symbols = ["GRAB", "SOUN", "BBAI"];
    const results = [];

    for (const symbol of symbols) {
      try {
        const data = await marketEngineRequest("/time_series", { symbol, interval: selectedTimeframe === "max" ? "1day" : selectedTimeframe, outputsize: 60 });
        if (!data?.values?.length) continue;
        const candles = [...data.values].reverse();
        const closes = candles.map(c => Number(c.close)).filter(Number.isFinite);
        const volumes = candles.map(c => Number(c.volume || 0));
        if (closes.length < 20) continue;
        const price = closes.at(-1);
        const sma10 = calculateSMA(closes, 10).at(-1);
        const sma20 = calculateSMA(closes, 20).at(-1);
        const rsi = calculateRSI(closes, 14).at(-1);
        results.push({ symbol, ...scannerSetupScore(candles, closes, volumes, price, sma10, sma20, rsi) });
      } catch (error) {
        console.log("Scanner error:", symbol, error);
      }
    }

    if (!results.length) {
      container.innerHTML = `<div class="alert empty">Scanner unavailable right now. Check market data and try again.</div>`;
      if (status) status.textContent = "ERROR";
      return;
    }

    results.sort((a, b) => b.score - a.score);
    container.innerHTML = results.map((r, i) => {
      const bias = r.direction === "LONG" ? "LONG WATCH" : r.direction === "SHORT" ? "SHORT WATCH" : "WAIT";
      const scoreLabel = r.score >= 80 ? "HIGH-QUALITY" : r.score >= 65 ? "WATCH" : r.score >= 45 ? "DEVELOPING" : "LOW SETUP";
      return `<button class="scanner-v2-item" onclick="analyzeTicker('${r.symbol}')">
        <div class="scanner-v2-top"><span class="scanner-v2-symbol">${i + 1}. ${r.symbol}</span><span class="scanner-v2-score">${r.score}/100</span></div>
        <div class="scanner-v2-meta"><span class="scanner-v2-chip">${bias}</span><span class="scanner-v2-chip">${scoreLabel}</span><span class="scanner-v2-chip">${r.setup}</span><span class="scanner-v2-chip">RSI ${r.rsi.toFixed(1)}</span><span class="scanner-v2-chip">Vol ${r.volumeRatio.toFixed(2)}x</span></div>
        <div class="scanner-v2-bar"><span style="width:${r.score}%"></span></div>
        <p class="scanner-v2-reason">${r.reason}</p>
      </button>`;
    }).join("");
    if (status) status.textContent = `${results[0].symbol} LEADS`;
  }

  window.scanMarket = scanMarketV2;

  // Replace the quick chart controls with explicit LONG / SHORT / CLOSE behavior.
  function refreshQuickTradeButtonsV2() {
    const canvas = document.getElementById("chart");
    if (!canvas) return;
    const chartCard = canvas.closest(".chart-card");
    if (!chartCard) return;
    let controls = document.getElementById("chartQuickTrade");
    if (!controls) {
      controls = document.createElement("div");
      controls.id = "chartQuickTrade";
      controls.className = "chart-quick-trade";
      chartCard.appendChild(controls);
    }
    controls.innerHTML = `
      <button class="quick-buy" onclick="paperBuy()">🐰 ↑ LONG</button>
      <button class="quick-sell" onclick="paperSell()">↓ SHORT 🐰</button>
      <button class="quick-close" id="chartClosePosition" onclick="closePaperPosition()" ${position ? "" : "disabled"}>✋ CLOSE</button>
    `;
  }

  const originalUpdatePaperPLV2 = updatePaperPL;
  updatePaperPL = updatePaperPLV2;
  window.updatePaperPL = updatePaperPLV2;

  // Rebuild controls once the DOM is ready, and refresh after each analysis/price update.
  function bootV2() {
    refreshQuickTradeButtonsV2();
    updatePositionSizerUI();
    updatePositionUIV2();
    if (lastAnalysis) {
      const enhanced = buildEnhancedAnalysis(lastAnalysis);
      lastAnalysis = enhanced;
      updatePositionSizerUI();
      updateTradePlanV2();
      }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootV2);
  else bootV2();

  // Keep chart controls and paper P/L in sync with live/demo price updates.
  setInterval(() => {
    refreshQuickTradeButtonsV2();
    updatePositionUIV2();
    if (Number.isFinite(lastLivePrice)) updatePaperPLV2(lastLivePrice);
  }, 2000);

  window.BunMoneyV2 = {
    buildEnhancedAnalysis,
    updatePositionSizerUI,
    updateTradePlanV2,
  };
})();

/* ================= BunMoney 3.0 Command Center ================= */
(function BunMoney30(){
  'use strict';
  const LSJ='bunmoney_trade_journal_v1', LSA='bunmoney_price_alerts_v1';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money=v=>Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
  const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
  let journal=read(LSJ,[]), alerts=read(LSA,[]);

  function currentSnapshot(){
    const ticker=($('ticker')?.value||$('symbol')?.textContent||'').trim().toUpperCase();
    const price=Number(window.lastLivePrice), entry=Number(window.lastEntry), stop=Number(window.lastStop), target=Number(window.lastTarget);
    const decision=$('decision')?.textContent||'WAIT';
    return {ticker,price,entry,stop,target,decision,trend:$('trend')?.textContent||'—',rsi:$('rsi')?.textContent||'—',rr:$('rr')?.textContent||'—',time:new Date().toISOString()};
  }
  function ensurePanel(){
    if($('bm30Panel')) return $('bm30Panel');
    const trade=$('trade'); if(!trade) return null;
    const panel=document.createElement('section'); panel.id='bm30Panel'; panel.className='bm3-card';
    panel.innerHTML=`<div class="bm3-head"><div><h3>🐰 BunMoney Command Center</h3><p class="bm3-sub">Plan, risk, journal and alerts — still manual approval only.</p></div><span class="bm3-pill" id="bm30DataBadge">NO ANALYSIS</span></div>
      <div class="bm3-grid">
        <div class="bm3-stat"><small>Current setup</small><strong id="bm30Decision">WAIT</strong></div>
        <div class="bm3-stat"><small>Data source</small><strong id="bm30Source">Waiting</strong></div>
        <div class="bm3-stat"><small>Entry → Stop</small><strong id="bm30RiskLine">—</strong></div>
        <div class="bm3-stat"><small>Entry → Target</small><strong id="bm30RewardLine">—</strong></div>
      </div>
      <div class="bm3-actions"><button class="primary" onclick="bm30RefreshPlan()">🔄 Refresh Plan</button><button onclick="bm30SaveJournal()">📓 Save to Journal</button><button onclick="bm30OpenJournal()">📚 Journal</button><button onclick="bm30OpenAlerts()">🔔 Alerts</button></div>
      <div class="bm3-form"><label>Account $<input id="bm30Account" type="number" min="0" step="0.01" value="10"></label><label>Risk %<input id="bm30RiskPct" type="number" min="0.1" max="10" step="0.1" value="1"></label><label>Max loss<input id="bm30MaxLoss" type="text" readonly value="$0.10"></label></div>
      <div id="bm30RiskOutput" class="bm3-list"></div>`;
    const scanner=$('scannerV2');
    if(scanner?.parentNode) scanner.parentNode.insertBefore(panel,scanner.nextSibling); else trade.appendChild(panel);
    ['bm30Account','bm30RiskPct'].forEach(id=>$(id)?.addEventListener('input',bm30RefreshPlan));
    return panel;
  }
  function bm30RefreshPlan(){
    ensurePanel(); const s=currentSnapshot(); const account=Math.max(0,Number($('bm30Account')?.value||10)); const pct=Math.max(0,Number($('bm30RiskPct')?.value||1)); const maxLoss=account*pct/100;
    if($('bm30MaxLoss')) $('bm30MaxLoss').value=money(maxLoss);
    const risk=Math.abs(s.entry-s.stop), shares=risk>0?maxLoss/risk:0, reward=Math.abs(s.target-s.entry), rr=risk>0?reward/risk:0;
    $('bm30Decision').textContent=s.decision||'WAIT';
    const has=Number.isFinite(s.price)&&s.price>0;
    $('bm30Source').textContent=has?'LIVE / CONNECTED':'Waiting'; $('bm30DataBadge').textContent=has?'LIVE DATA':'NO ANALYSIS';
    $('bm30RiskLine').textContent=has?`${money(s.entry)} → ${money(s.stop)}`:'—'; $('bm30RewardLine').textContent=has?`${money(s.entry)} → ${money(s.target)}`:'—';
    $('bm30RiskOutput').innerHTML=has?`<div class="bm3-row"><span><small>Risk distance</small><br><strong>${money(risk)}</strong></span><span><small>Max loss</small><br><strong>${money(maxLoss)}</strong></span><span><small>Size</small><br><strong>${shares.toFixed(4)} shares</strong></span><span><small>R:R</small><br><strong>${rr?rr.toFixed(2)+':1':'—'}</strong></span></div>`:'<div class="alert empty">Analyze a real ticker to calculate position sizing.</div>';
  }
  window.bm30RefreshPlan=bm30RefreshPlan;
  window.bm30SaveJournal=function(){
    const s=currentSnapshot(); if(!s.ticker||!Number.isFinite(s.price)){bm30Toast('Analyze a ticker before saving a journal entry.');return;}
    journal.unshift({...s,id:Date.now()}); journal=journal.slice(0,50); write(LSJ,journal); bm30Toast(`Saved ${s.ticker} to your trade journal.`);
  };
  window.bm30OpenJournal=function(){
    const modal=ensureModal('bm30JournalModal','📓 Trade Journal'); const body=$('bm30JournalBody');
    body.innerHTML=journal.length?journal.slice(0,20).map(x=>`<div class="bm3-row"><span><strong>${esc(x.ticker)}</strong> · ${esc(x.decision)}<br><small>${new Date(x.time).toLocaleString()} · Price ${money(x.price)}</small></span><span>${money(x.entry)} / ${money(x.stop)} / ${money(x.target)}</span></div>`).join(''):'<p>No saved setups yet.</p>'; modal.hidden=false;
  };
  window.bm30OpenAlerts=function(){
    const modal=ensureModal('bm30AlertsModal','🔔 Price Alerts'); const body=$('bm30AlertsBody');
    const s=currentSnapshot();
    body.innerHTML=`<div class="bm3-form"><label>Symbol<input id="bm30AlertSymbol" value="${esc(s.ticker)}"></label><label>Price<input id="bm30AlertPrice" type="number" step="0.01" value="${Number.isFinite(s.price)?s.price.toFixed(2):''}"></label><label>Condition<select id="bm30AlertCondition"><option value="above">Above</option><option value="below">Below</option></select></label></div><div class="bm3-actions"><button class="primary" onclick="bm30AddAlert()">🔔 Add Alert</button><button onclick="bm30ClearAlerts()">Clear All</button></div><div class="bm3-list">${alerts.length?alerts.map(a=>`<div class="bm3-row"><span><strong>${esc(a.symbol)}</strong> ${esc(a.condition)} ${money(a.price)}<br><small>${a.active?'Active':'Triggered'}</small></span></div>`).join(''):'<p>No alerts set.</p>'}</div>`; modal.hidden=false;
  };
  window.bm30AddAlert=function(){const symbol=String($('bm30AlertSymbol')?.value||'').trim().toUpperCase();const price=Number($('bm30AlertPrice')?.value);const condition=$('bm30AlertCondition')?.value;if(!symbol||!Number.isFinite(price)){bm30Toast('Enter a symbol and valid price.');return;} alerts.push({id:Date.now(),symbol,price,condition,active:true});write(LSA,alerts);bm30OpenAlerts();bm30Toast(`Alert set for ${symbol}.`)};
  window.bm30ClearAlerts=function(){alerts=[];write(LSA,alerts);bm30OpenAlerts()};
  function ensureModal(id,title){let m=$(id);if(m)return m; m=document.createElement('div');m.id=id;m.className='bm3-modal';m.hidden=true;m.innerHTML=`<div class="bm3-modal-card"><div class="bm3-head"><h3>${title}</h3><button onclick="document.getElementById('${id}').hidden=true">✕</button></div><div id="${id.replace('Modal','Body')}"></div></div>`;document.body.appendChild(m);return m;}
  function bm30Toast(msg){let t=$('bm30Toast');if(!t){t=document.createElement('div');t.id='bm30Toast';t.className='bm3-alert';document.body.appendChild(t)}t.textContent=msg;t.hidden=false;clearTimeout(t._timer);t._timer=setTimeout(()=>t.hidden=true,3200)}
  function checkAlerts(){const price=Number(window.lastLivePrice);if(!Number.isFinite(price))return;let changed=false;alerts.forEach(a=>{if(!a.active||!a.symbol)return;const current=String($('symbol')?.textContent||$('ticker')?.value||'').toUpperCase();if(current!==a.symbol)return;const hit=a.condition==='above'?price>=a.price:price<=a.price;if(hit){a.active=false;changed=true;bm30Toast(`🔔 ${a.symbol} crossed ${money(a.price)}.`)}});if(changed)write(LSA,alerts)}
  function boot(){ensurePanel();bm30RefreshPlan();setInterval(()=>{ensurePanel();bm30RefreshPlan();checkAlerts()},2000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  // =========================================================
  // LIVE MARKET BOARD — ranked choices + dollar move calculator
  // =========================================================
  const MARKET_BOARD_GROUPS = {
    stocks: [["NVDA","NVIDIA","AI / Semiconductors"],["TSLA","Tesla","EV / Technology"],["AAPL","Apple","Technology"],["AMZN","Amazon","Consumer / Cloud"],["META","Meta Platforms","Technology"],["MSFT","Microsoft","Technology"],["GOOGL","Alphabet","Technology"],["SOUN","SoundHound AI","AI / Technology"]],
    etfs: [["SPY","SPDR S&P 500 ETF","US Large Cap"],["QQQ","Invesco QQQ","Nasdaq-100"],["IWM","iShares Russell 2000 ETF","Small Cap"],["DIA","SPDR Dow Jones ETF","Dow Jones"],["XLK","Technology Select Sector SPDR","Technology"],["XLF","Financial Select Sector SPDR","Financials"]],
    crypto: [["BTC/USD","Bitcoin","Crypto"],["ETH/USD","Ethereum","Crypto"],["SOL/USD","Solana","Crypto"],["XRP/USD","XRP","Crypto"],["DOGE/USD","Dogecoin","Crypto"],["ADA/USD","Cardano","Crypto"]],
    forex: [["EUR/USD","Euro / US Dollar","Forex"],["GBP/USD","British Pound / US Dollar","Forex"],["USD/JPY","US Dollar / Japanese Yen","Forex"],["AUD/USD","Australian Dollar / US Dollar","Forex"],["USD/CAD","US Dollar / Canadian Dollar","Forex"],["USD/CHF","US Dollar / Swiss Franc","Forex"]]
  };
  let marketBoardCategory = "stocks", marketBoardBusy = false;
  function marketBoardAmount(){const n=Number(document.getElementById("marketAmount")?.value);return Number.isFinite(n)&&n>0?n:10}
  function marketQuotePercent(d){for(const v of [d?.percent_change,d?.change_percent,d?.changePct]){const n=Number(String(v??"").replace("%",""));if(Number.isFinite(n))return n}const p=Number(d?.close??d?.price),q=Number(d?.previous_close??d?.previousClose);return Number.isFinite(p)&&Number.isFinite(q)&&q!==0?(p-q)/q*100:null}
  function marketPrice(symbol,p){if(!Number.isFinite(p))return "—";return symbol.includes("/")?p.toLocaleString(undefined,{maximumFractionDigits:5}):formatMoney(p)}
  async function fetchMarketBoardQuote(item){const symbol=item[0],d=await marketEngineRequest("/quote",{symbol}),price=Number(d?.close??d?.price),pct=marketQuotePercent(d);if(!Number.isFinite(price)||!Number.isFinite(pct))throw new Error("Incomplete quote");return{symbol,name:item[1],category:item[2],price,pct}}
  function renderMarketBoard(results,errors=0){const c=document.getElementById("marketBoard"),status=document.getElementById("marketBoardStatus");if(!c)return;const amount=marketBoardAmount();results.sort((a,b)=>b.pct-a.pct);if(!results.length){c.innerHTML='<div class="alert empty">No live quotes returned. Check your API/backend and try again.</div>';if(status)status.textContent="NO DATA";return}c.innerHTML=results.map((r,i)=>{const dollars=amount*r.pct/100,sign=dollars>=0?"+":"−",ps=r.pct>=0?"+":"",cls=r.pct>=0?"up":"down",safe=r.symbol.replace(/'/g,"\\'");return `<button class="market-row ${cls}" onclick="selectMarketFromBoard('${safe}')"><span class="market-rank">${i+1}</span><span class="market-main"><strong>${r.symbol}</strong><small>${r.name} · ${r.category} · ${marketPrice(r.symbol,r.price)}</small></span><span class="market-right"><span class="market-pct">${ps}${r.pct.toFixed(2)}%</span><span class="market-dollar">${sign}$${Math.abs(dollars).toFixed(2)} on $${amount.toFixed(2)}</span></span></button>`}).join("");if(status)status.textContent=errors?`${results.length} LIVE · ${errors} MISSED`:`${results.length} LIVE`}
  async function refreshMarketBoard(){if(marketBoardBusy)return;const c=document.getElementById("marketBoard"),status=document.getElementById("marketBoardStatus");if(!c)return;marketBoardBusy=true;if(status)status.textContent="LOADING";c.innerHTML=`<div class="market-loading">🐰 Pulling live ${marketBoardCategory} quotes…</div>`;const items=MARKET_BOARD_GROUPS[marketBoardCategory]||MARKET_BOARD_GROUPS.stocks,results=[];let errors=0;for(const item of items){try{results.push(await fetchMarketBoardQuote(item))}catch(_){errors++}}renderMarketBoard(results,errors);marketBoardBusy=false}
  function setMarketCategory(category){if(!MARKET_BOARD_GROUPS[category])return;marketBoardCategory=category;document.querySelectorAll(".market-cat").forEach(b=>b.classList.toggle("active",b.dataset.marketCat===category));refreshMarketBoard()}
  function selectMarketFromBoard(symbol){const input=document.getElementById("ticker");if(input)input.value=symbol;showScreen("trade");analyze(true).catch(()=>{})}
  window.refreshMarketBoard=refreshMarketBoard;window.setMarketCategory=setMarketCategory;window.selectMarketFromBoard=selectMarketFromBoard;
  function bootMarketBoard(){refreshMarketBoard();const amount=document.getElementById("marketAmount");if(amount)amount.addEventListener("change",()=>refreshMarketBoard())}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootMarketBoard);else bootMarketBoard();


  // =========================================================
  // FLOATING BUNAI COPILOT
  // Replaces the large permanent Copilot card with a compact,
  // draggable assistant that stays visible while the user browses.
  // =========================================================
  function createFloatingCopilot(){
    if(document.getElementById("bmFloatingCopilot")) return;
    const el=document.createElement("div");
    el.id="bmFloatingCopilot";
    el.className="bm-float-copilot";
    el.innerHTML=`
      <div class="bm-float-bubble" role="dialog" aria-label="BunAI Copilot">
        <div class="bm-float-head"><strong>🐰 BunAI</strong><span class="bm-float-status" id="bmFloatStatus">READY</span></div>
        <p class="bm-float-msg" id="bmFloatMsg">I'm here while you browse. Tap Analyze to check the current ticker.</p>
        <div class="bm-float-row"><input id="bmFloatInput" maxlength="240" placeholder="Ask BunAI…" type="text"><button id="bmFloatAsk">Ask</button></div>
        <div class="bm-float-actions"><button id="bmFloatAnalyze">📊 Analyze</button><button id="bmFloatClose">Minimize</button></div>
      </div>
      <button class="bm-float-btn" id="bmFloatBtn" aria-label="Open BunAI Copilot" title="BunAI Copilot">
        <img src="assets/pfs_happy.webp" alt="BunAI" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span style="display:none">🐰</span>
        <i class="bm-float-dot"></i>
      </button>`;
    document.body.appendChild(el);
    const btn=el.querySelector("#bmFloatBtn"), bubble=el.querySelector(".bm-float-bubble"), input=el.querySelector("#bmFloatInput");
    btn.addEventListener("click",()=>{if(el.dataset.moved==="1"){el.dataset.moved="0";return;}el.classList.toggle("open");el.classList.remove("has-update");if(el.classList.contains("open"))setTimeout(()=>input?.focus(),50)});
    el.querySelector("#bmFloatClose")?.addEventListener("click",()=>el.classList.remove("open"));
    el.querySelector("#bmFloatAnalyze")?.addEventListener("click",()=>{
      const ticker=String(document.getElementById("ticker")?.value||"").trim().toUpperCase();
      if(!ticker){setFloatingCopilotMessage("Enter a ticker first, then I can analyze it.","WAITING");return;}
      el.classList.remove("open");
      showScreen("trade");
      if(typeof window.analyze==="function")window.analyze(true).catch(()=>{});
    });
    el.querySelector("#bmFloatAsk")?.addEventListener("click",floatingAsk);
    input?.addEventListener("keydown",e=>{if(e.key==="Enter")floatingAsk()});
    function floatingAsk(){
      const q=String(input?.value||"").trim();
      if(!q)return;
      const msg=document.getElementById("bmFloatMsg"),status=document.getElementById("bmFloatStatus");
      if(status)status.textContent="THINKING";
      if(msg)msg.textContent="BunAI is thinking…";
      const fn=window.askBunAI||askBunAI;
      Promise.resolve(fn(q,lastAnalysis||{})).then(data=>{
        if(msg)msg.textContent=data?.text||"BunAI has no response right now.";
        if(status)status.textContent="READY";
        el.classList.add("has-update");
      }).catch(err=>{
        if(msg)msg.textContent=err?.message||"BunAI is unavailable right now.";
        if(status)status.textContent="OFFLINE";
      });
    }
    let dragging=false,startX=0,startY=0,startLeft=0,startTop=0;
    const start=e=>{
      if(e.target.closest(".bm-float-bubble"))return;
      dragging=true;el.classList.add("dragging");el.dataset.moved="0";
      const p=e.touches?e.touches[0]:e;startX=p.clientX;startY=p.clientY;
      const r=el.getBoundingClientRect();startLeft=r.left;startTop=r.top;
      el.style.left=startLeft+"px";el.style.top=startTop+"px";el.style.right="auto";el.style.bottom="auto";
      e.preventDefault?.();
    };
    const move=e=>{if(!dragging)return;const p=e.touches?e.touches[0]:e;const dx=p.clientX-startX,dy=p.clientY-startY;if(Math.abs(dx)+Math.abs(dy)>8)el.dataset.moved="1";const maxX=Math.max(6,innerWidth-el.offsetWidth-6),maxY=Math.max(6,innerHeight-el.offsetHeight-6);el.style.left=Math.min(maxX,Math.max(6,startLeft+dx))+"px";el.style.top=Math.min(maxY,Math.max(6,startTop+dy))+"px";e.preventDefault?.()};
    const end=()=>{dragging=false;el.classList.remove("dragging")};
    btn.addEventListener("pointerdown",start);window.addEventListener("pointermove",move,{passive:false});window.addEventListener("pointerup",end);
    btn.addEventListener("touchstart",start,{passive:false});window.addEventListener("touchmove",move,{passive:false});window.addEventListener("touchend",end);
  }
  function setFloatingCopilotMessage(message,status="READY"){
    const msg=document.getElementById("bmFloatMsg"),st=document.getElementById("bmFloatStatus"),el=document.getElementById("bmFloatingCopilot");
    if(msg)msg.textContent=message;if(st)st.textContent=status;if(el){el.classList.add("has-update");}
  }
  function updateFloatingCopilot(){
    const el=document.getElementById("bmFloatingCopilot");if(!el)return;
    if(!lastAnalysis){setFloatingCopilotMessage("I'm here while you browse. Analyze a ticker when you're ready.","READY");return;}
    const a=lastAnalysis;
    const bias=a.trend||"NEUTRAL", setup=a.setupQuality||"NO SETUP";
    const message=`${a.ticker||"Market"}: ${bias.toLowerCase()}, ${setup.toLowerCase()} setup. ${a.trigger||"Waiting for a clean confirmation."}`;
    setFloatingCopilotMessage(message,"WATCHING");
  }
  window.createFloatingCopilot=createFloatingCopilot;
  window.updateFloatingCopilot=updateFloatingCopilot;
  window.setFloatingCopilotMessage=setFloatingCopilotMessage;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{createFloatingCopilot();updateFloatingCopilot()});else{createFloatingCopilot();updateFloatingCopilot()}

})();
