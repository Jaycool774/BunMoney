# Validation results

Run in the managed workspace with Python 3.12.14 and Node 24.19.0.

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
and conservative ambiguous-bar exits. Actual socket-level auth/health testing remains
required on an unrestricted development host or CI before merging this draft.
