/* Shared validation and execution rules for the browser and regression tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BunTrading = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
  const validSymbol = (s) =>
    typeof s === "string" && /^[A-Z0-9][A-Z0-9./:_-]{0,29}$/.test(s);
  const validLevels = (p) =>
    p &&
    ["LONG", "SHORT"].includes(p.side) &&
    positive(p.entry) &&
    positive(p.stop) &&
    positive(p.target) &&
    (p.side === "LONG"
      ? p.stop < p.entry && p.target > p.entry
      : p.stop > p.entry && p.target < p.entry);
  function levels(side, entry, plan) {
    if (
      !positive(entry) ||
      !plan ||
      !positive(plan.entry) ||
      !positive(plan.stop) ||
      !positive(plan.target)
    )
      throw new Error("Analyze this market before trading.");
    const risk = Math.abs(plan.entry - plan.stop) / plan.entry;
    const reward = Math.abs(plan.target - plan.entry) / plan.entry;
    const direction = side === "SHORT" ? -1 : 1;
    const result = {
      side,
      entry,
      stop: entry * (1 - direction * risk),
      target: entry * (1 + direction * reward),
    };
    if (!validLevels(result))
      throw new Error("Invalid stop or target for this position.");
    return result;
  }
  function candles(values) {
    if (!Array.isArray(values) || values.length < 21 || values.length > 5000)
      throw new Error("At least 21 valid candles are required.");
    const result = values.map((c) => ({
      ...c,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume || 0),
    }));
    if (
      result.some(
        (c) =>
          !["open", "high", "low", "close"].every((k) => positive(c[k])) ||
          !Number.isFinite(c.volume) ||
          c.volume < 0 ||
          !Number.isFinite(Date.parse(c.datetime)) ||
          c.high < Math.max(c.open, c.close) ||
          c.low > Math.min(c.open, c.close) ||
          c.low > c.high,
      )
    )
      throw new Error("Invalid candle data.");
    result.sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
    if (result.some((c, i) => i && Date.parse(c.datetime) === Date.parse(result[i - 1].datetime)))
      throw new Error("Duplicate candle timestamps.");
    return result;
  }
  function validPosition(p) {
    return (
      validLevels(p) &&
      positive(p.amount) &&
      validSymbol(p.symbol) &&
      ["live", "demo"].includes(p.source) &&
      Number.isFinite(p.entryFee) &&
      p.entryFee >= 0
    );
  }
  function state(value) {
    if (
      !value ||
      typeof value !== "object" ||
      !Number.isFinite(value.tradingBalance) ||
      !Array.isArray(value.tradeHistory) ||
      value.tradeHistory.length > 10000
    )
      throw new Error("Invalid paper-trading backup.");
    if (value.position != null && !validPosition(value.position))
      throw new Error(
        "Saved position is invalid or from an unsupported simulator version. Export it before resetting.",
      );
    const history = value.tradeHistory.map((t) => {
      if (
        !t ||
        !["LONG", "SHORT"].includes(t.side) ||
        !validSymbol(t.symbol) ||
        !positive(t.entry) ||
        !positive(t.exit) ||
        !positive(t.amount) ||
        !Number.isFinite(t.profit) ||
        typeof t.time !== "string"
      )
        throw new Error("Invalid trade history.");
      return {
        side: t.side,
        symbol: t.symbol,
        entry: t.entry,
        exit: t.exit,
        amount: t.amount,
        profit: t.profit,
        time: t.time.slice(0, 100),
        reason: String(t.reason || "MANUAL").slice(0, 40),
        fees: Number.isFinite(t.fees) && t.fees >= 0 ? t.fees : 0,
      };
    });
    return {
      tradingBalance: value.tradingBalance,
      position: value.position
        ? {
            side: value.position.side,
            entry: value.position.entry,
            stop: value.position.stop,
            target: value.position.target,
            amount: value.position.amount,
            symbol: value.position.symbol,
            source: value.position.source,
            entryFee: value.position.entryFee,
          }
        : null,
      tradeHistory: history,
      rewardPoints: Math.max(0, Number(value.rewardPoints) || 0),
      arcadeBank: Math.max(0, Number(value.arcadeBank) || 0),
      activeBot:
        typeof value.activeBot === "string"
          ? value.activeBot.slice(0, 30)
          : "BunBot",
    };
  }
  // Market executions: 5 basis points adverse slippage and 10 basis points fee per side.
  const FEE = 0.001,
    SLIPPAGE = 0.0005;
  function fill(price, side, opening) {
    if (!positive(price))
      throw new Error("A positive market price is required.");
    const buy = opening ? side === "LONG" : side === "SHORT";
    return price * (1 + (buy ? SLIPPAGE : -SLIPPAGE));
  }
  function settlement(p, observedPrice) {
    if (!validPosition(p)) throw new Error("Invalid position.");
    const exit = fill(observedPrice, p.side, false);
    const direction = p.side === "SHORT" ? -1 : 1;
    const gross = p.amount * ((exit - p.entry) / p.entry) * direction;
    const exitFee = p.amount * (exit / p.entry) * FEE;
    const profit = gross - p.entryFee - exitFee;
    return {
      exit,
      profit,
      fees: p.entryFee + exitFee,
      returned: p.amount + gross - exitFee,
    };
  }
  return {
    positive,
    validSymbol,
    validLevels,
    validPosition,
    levels,
    candles,
    state,
    fill,
    settlement,
    FEE,
    SLIPPAGE,
  };
});
