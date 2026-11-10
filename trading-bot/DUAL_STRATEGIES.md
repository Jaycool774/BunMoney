# Dual-strategy paper trading (draft)

Both strategies are enabled by the strategy evaluator. **Quick** uses a 10/20 moving-average crossover on completed five-minute candles. **Patient** uses a 20/40 crossover with ten-bar directional confirmation. Quick has priority if both fire on the same completed bar. Both use the same paper cash ledger and shared position, daily-entry, daily-loss and combined-open-risk limits.

Maximum planned risk per entry defaults to **0.5%** of paper equity (`Settings.risk_fraction = 0.005`). This is a sizing ceiling, not a guarantee of maximum realized loss; gap moves and execution costs can increase loss.

Automatic mode is supported, but **existing accounts are not silently switched**. After reviewing and merging, select Automatic and Start in the dashboard. A service restart deliberately pauses trading and cancels pending proposals. No broker API or live execution is added.

Trade proposals and signals now record the strategy and reason. Closed trades record the exit explanation and profit/loss outcome. The backtest returns separate trade counts, win counts and net P/L for both strategies. It uses completed historical candles, next-open entries, modeled fees/slippage and conservative stop-first assumptions for ambiguous candles.

Run checks from the repository root:

```bash
python3 -m unittest discover -s trading-bot/tests -v
npm run check --prefix server
npm test --prefix server
```

**Review checklist:** confirm tests, historical market-data depth, automatic paper execution, unchanged shared limits, dashboard explanations and restart behavior before merging. The strategy is experimental; no positive returns are claimed.
