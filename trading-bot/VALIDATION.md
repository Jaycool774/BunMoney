# Validation results

GitHub Actions run [40005505740](https://github.com/Jaycool774/BunMoney/actions/runs/40005505740)
passed on implementation commit `33892af8c4bdbce87c42d1352440887111b917a5`:

- Python: **37/37 pass**, including socket-level authentication and health checks.
- JavaScript: **41/41 pass** (3 bot proxy, 3 Coinbase, 21 trading, 14 server).
- JavaScript syntax checks and browser smoke: **pass**. Browser checks cover the
  existing frontend and the new dashboard rejection, mode and emergency controls.
- CI uses Python 3.12.15, Node from `.node-version`, and Playwright Chromium.

The implementation is unchanged after that run; this validation update records
its results. Live provider data, real historical datasets and an always-on host
were not exercised by CI.

Local runs used Python 3.12.14 and Node 24.19.0. The following sandbox restrictions
were resolved by running the complete suite on GitHub Actions:

- Python unittest suite: 37 tests; 36 pass, 1 blocked by socket restrictions
  (`test_service_authentication_and_health`, `PermissionError: Operation not permitted`).
  The equivalent handler auth/control cases also run without sockets and pass.
- New Node proxy unit tests: 3/3 pass (missing config/auth, independent service
  token and fixed destination, connection failure).
- Existing Coinbase feed tests: 3/3 pass.
- Existing trading/frontend logic tests: 21/21 pass.
- Existing server tests: 6/14 pass; 8 require binding a localhost socket and fail
  with `listen EPERM`. These are environment blocks, not claimed passing tests.
- JavaScript syntax checks (`npm run check --prefix server`): pass, including new
  proxy/dashboard scripts. Python compilation: pass. `git diff --check`: pass.
- Browser smoke: attempted, blocked because Playwright is absent in the available
  dependency installation. Local socket restrictions would also prevent its test
  server. Its selectors were adjusted for the additional dashboard disclosure,
  and dashboard reject/mode/emergency interactions were added for CI execution.
- Real provider connectivity, real historical datasets, always-on deployment,
  systemd behavior and production browser integration have not been verified here.
  No live orders, withdrawals or performance/profitability claims are made.

Python coverage includes SMA crossover signals; manual/approval/automatic modes;
position and cash limits; risk including fees/slippage; approval expiry at the exact
boundary; rejection; changed-price/stale approvals; concurrent and repeated approvals;
duplicate signals after exit; quote/candle freshness; missing prices/disconnections;
whole-cycle data validation; stop gaps; targets; sticky daily loss shutdown and UTC
rollover; three entries/day; emergency persistence and mode bypass protection;
mode-specific discretionary sales and expired sale proposals; protective exits while paused; restart recovery/cancellation; corrupted ledger or
inventory; rollback before commit; report time windows; next-open backtest fills
and conservative ambiguous-bar exits. Socket-level auth/health and browser verification subsequently passed in CI, as recorded above.
Deployment and live-provider smoke testing remain outstanding.
