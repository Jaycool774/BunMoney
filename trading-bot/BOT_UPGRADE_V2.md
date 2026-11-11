# BunMoney Bot Upgrade v2 — paper-only review plan

This draft PR combines related improvements in one review. It must not be merged until the Python, Node, and browser checks pass and a human verifies the dashboard.

## Implemented in this branch
- Activity tab with recent per-symbol scans, strategy, decision and reason.
- Quick Trader, Patient Trader and blocked/skipped filters.
- Strategy names and explanations in Signals and Trade Plans.
- Last successful strategy cycle distinguished from general worker status.
- Bounded scan audit (latest 1,000 records retained; latest 40 displayed).
- Regression tests for execution, no-signal scans, errors and bounded audit.

## Follow-up work before calling v2 complete
- Confirm the dashboard in Codespaces on mobile and desktop; improve styling if necessary.
- Add a read-only backtesting comparison UI **only after** designing safe historical-data input and explicit simulation assumptions. Existing Python CLI already returns per-strategy summary.
- Add stronger tests for strategy priority, blocked reasons, polling, recovery and no sensitive fields in API output.
- Review 24/7 deployment for a dedicated Linux VPS: persistent local SQLite, service supervision, health checks, HTTPS and private access. Do not imply Codespaces is 24/7 hosting.
- Keep explicit restart-paused behavior unless a separately tested recovery policy is approved.

## Non-goals / safety
No real orders, deposits, withdrawals, leverage, short selling or unattended auto-resume after restart. No changes to 0.5% per-entry planned risk, 2% daily loss protection, 2.5% combined open planned risk or three daily entries. Realized loss can exceed planned risk.

## Verification
```sh
PYTHONPATH=trading-bot python3 -m unittest discover -s trading-bot/tests -v
npm run check --prefix server
npm test --prefix server
npm run test:browser --prefix server
```

## November v2 analytics additions (read-only)

- **Strategy leaderboard:** summarizes completed paper trades by Quick and Patient strategy; net P/L, win rate, profit factor, and closed-trade drawdown. It does not mix in God Mode historical simulations.
- **Multi-timeframe comparison:** on-demand 5m, 15m, 1H and 4H SMA trend read from the selected chart symbol through the existing market provider. Informational only; the Python execution engine is still based on verified 5m crypto candles.
- **Advanced risk panel:** remaining planned open risk, daily loss headroom, daily entry capacity and active symbols, using the existing authenticated bot snapshot. It does not change risk settings.
- **Trade journal:** read-only completed-trade table and user-triggered CSV export. No credentials are exported.
- **Smart alerts:** opt-in in-dashboard health warnings while the dashboard is open; not push notifications and not a guaranteed delivery system.
- **Market replay:** offline step-through of user-supplied OHLC JSON, without accessing future candles or placing trades.
- **Health monitor:** reports age of last successful cycle, error/paused state, and freshness; does not itself provide 24/7 hosting.

### Not yet safe to claim complete

**Economic News Protection:** a warning panel is present, but no authoritative, time-zone-correct economic-calendar ingestion or server-side blackout is implemented. It does **not** block entries around CPI, NFP, FOMC or central-bank announcements. Do not claim the bot is news-protected.

**24/7:** Codespaces can stop; an always-on host, persistent storage, secured access, supervision and external heartbeat alerts are still required. Restart-paused protection remains unchanged.

**Automatic strategy gating:** multi-timeframe and God Mode remain read-only and do not modify the execution engine. Any server-side changes require separate data-validation and risk tests.

### Validation before merging

```sh
npm run check --prefix server
npm test --prefix server
npm run test:browser --prefix server
PYTHONPATH=trading-bot python3 -m unittest discover -s trading-bot/tests -v
```

Manually verify authenticated dashboard tabs, CSV export, replay step-by-step, all four timeframe provider responses, missing data, disconnects, stale scans, and mobile layout. No claims of CI success until verified.
