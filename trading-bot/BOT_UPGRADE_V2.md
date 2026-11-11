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
