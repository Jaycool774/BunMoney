# BunMoney Python paper bot v1

Simulated funds only. No live order, exchange SDK, leverage, short selling, deposit,
or withdrawal implementation exists. This service is **not deployed** by this PR.
The browser's existing paper account, charts, news, trade plans, and frontend remain
separate. Python 3.11+ and Node 24.5–24.x are required. Python uses only the standard
library. The Node dependencies are unchanged.

## Start locally

1. From the repository root, run `npm ci --prefix server`.
2. Provide `TWELVE_DATA_API_KEY` to the existing Node server using its documented
   environment setup. No provider credential is assumed or stored by the bot.
3. Generate two independent random secrets, each at least 32 characters, and supply
   **the same** `MARKET_ENGINE_TOKEN` and `BOT_SERVICE_TOKEN` to both processes.
   Keep them in a protected environment file outside the checkout; do not commit
   them. Example generation: `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`.
4. In one terminal with that environment, run `npm start --prefix server` (port 3000).
5. In a second terminal with that environment:

   ```sh
   cd trading-bot
   export MARKET_ENGINE_URL=http://127.0.0.1:3000
   export BOT_DB=paper.sqlite3
   python3 -m bunbot.service
   ```

6. Open `http://127.0.0.1:3000`, unlock the existing private market engine with
   `MARKET_ENGINE_TOKEN`, and expand **Python Trading Bot** near the bottom. The
   first boot is stopped/manual; click Start to analyze. Choose Approval or
   Automatic paper and Apply mode to enable the corresponding behavior. Never put
   `BOT_SERVICE_TOKEN` or the provider key in a browser. Missing credentials leave
   bot controls disabled; existing market routes keep their existing behavior.

The Python server listens only on `127.0.0.1:8765`. Its `/state` and `/control`
require its service bearer token. BunMoney exposes authenticated same-origin
`GET /api/bot/state` and `POST /api/bot/control`, proxied to fixed loopback routes.
The existing API rate limit, cross-site rejection, CSP, and origin checks apply.
The frontend keeps the market access token in memory; no token enters backups or
local storage. One shared private operator token is v1's access model, not a
multi-user permissions system. Serve the Node app over HTTPS before remote access.

## Strategy and safety behavior

- BTC/USD and ETH/USD, completed five-minute candles only. A crossing of SMA10
  above SMA20 proposes a long; a crossing below signals a sale of a held long.
  Bearish signals without a held long are informational; no short positions.
- Manual records signals/plans without new orders. Discretionary SMA sales follow the same mode as entries. Approval requires a pending,
  unexpired proposal (120 seconds). Rejection, expiry, restart, stop, pause, or a
  mode change makes a proposal permanently ineligible. A failed approval is also
  terminal. Automatic executes eligible simulated entries only.
- Paper cash starts at $1,000; planned risk is capped at 0.5% of liquidation equity
  and the remaining daily loss allowance. Daily loss shutdown is 2%, with a maximum
  of three entries per UTC day and one open position across both markets.
  No leverage, averaging down, or adding to positions. Cash cannot fund more than
  the account owns. Risk settings are fixed server-side in `Settings`, displayed
  read-only; the API cannot raise them or switch to live trading.
- Stop distance is 1% of signal price; target distance is twice the entry-to-stop
  distance. Both estimated entry/exit fees (10 bps per side) and adverse slippage
  (5 bps per side) affect sizing, risk/reward and P/L. Net risk/reward is therefore
  below the gross 2:1 target. A proposal cannot chase more than 0.2% price drift;
  approval rechecks cash, mode, freshness, daily loss, position and duplicate limits.
  Sale approvals are tied to the original position and cannot close a later one.
- Quotes must include the matching symbol, a positive finite price and a provider
  timestamp no older than 90 seconds and not in the future. History requires matching
  symbol, five-minute interval, explicit UTC timezone, at least 21 contiguous valid
  completed candles, and latest completed close within six minutes. Missing or
  unexpected metadata **blocks trading** rather than fabricating a timestamp.
  Data comes from the existing `/api/quote` and `/api/time-series` routes. No
  alternative provider endpoints or credentials are invented.
- A feed error pauses entries and cancels pending proposals; explicit Start is
  required after recovery. A cycle validates both markets before creating entries.
  Unknown account state prevents any fill. SQLite cash and inventory must reconcile
  against immutable fills. Signals have stable symbol/candle/direction IDs; entry
  and exit IDs persist across restart. Every signal, proposal, decision, order state,
  trade and error is in the SQLite `events` audit table. Simulated orders transition
  created → filled in the same atomic transaction as the cash/position update.
- Pause/Stop block entries but keep protective paper exits active while the worker
  runs. Emergency Stop freezes **all** orders, cancels approvals and persists across
  restarts; it does **not** liquidate an existing position. Reset emergency leaves
  the bot paused. Mode changes or Start cannot override a latched emergency.
  An emergency request also sets an in-process halt flag before waiting on the
  database lock, blocking fills after an in-flight data request returns. Wait for
  the dashboard's acknowledgement; HTTP/network latency still applies.
- Prices are polled every 30 seconds, so stops/targets can be missed between polls.
  Stop exits fill at the next verified observed price, with adverse slippage and
  fees. Gaps, outages and emergency freezes can cause losses beyond planned risk.
  No stale-price fills are manufactured during outages. If either market's quote
  is unavailable, all simulated execution waits for verified data.
- The daily baseline is the first verified liquidation equity observed on a UTC
  day, including unrealized P/L and estimated exit costs. Shutdown latches until the
  next UTC day. If the service misses midnight, this is a first-observation baseline,
  not a reconstructed midnight price. With no fresh position mark, equity/P/L is
  shown as unavailable. The morning report covers the last 24 hours, including
  trades, wins/losses, fees, balance, equity and the latest 20 errors in that period.

## Persistence and overnight deployment

Use one bot worker and one persistent SQLite path on a local disk; do not use
an ephemeral container filesystem or a network filesystem for the ledger. SQLite
WAL + FULL synchronization and `BEGIN IMMEDIATE` serialize updates. Both created
and filled audit events commit together: a crash commits the complete simulated
fill or neither. Recovery verifies the account, cancels approvals, clears cached
marks and pauses entries. Existing positions regain protection after fresh quotes
arrive, even while paused. **Restart does not automatically resume new entries.**
Never delete or recreate a ledger as an error-recovery step. Back up a running DB
with SQLite's backup API; do not copy only the main file while its WAL is active.

For an always-on Linux host:

1. Install the repository under `/opt/BunMoney`, with Node dependencies installed
   and Python 3.11+ available as `/usr/bin/python3`. Create a dedicated `bunmoney`
   service user/group with read access to the checkout.
2. Run the existing Node server as a separate supervised process on loopback 3000.
   Configure its provider key and both operator/service tokens. Put HTTPS and
   appropriate private access controls in front of Node, not Python.
3. Copy `deploy/bot.env.example` to `/etc/bunmoney/bot.env`; fill the independent
   secrets, restrict it to root (mode 600), and ensure its tokens match Node's.
   The sample uses `/var/lib/bunmoney-bot/paper.sqlite3` for durable storage.
4. Install `deploy/bunmoney-paper-bot.service` under `/etc/systemd/system/`, then:

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now bunmoney-paper-bot
   sudo journalctl -u bunmoney-paper-bot -f
   curl --fail http://127.0.0.1:8765/health
   ```

5. Unlock BunMoney, review account state, and explicitly Start. Test a pause,
   emergency stop, restart and stale-feed scenario before leaving it unattended.

The unit restarts failed processes but leaves entries paused on recovery. Logs
report cycle status/mode/error presence without headers, credentials or raw provider
payloads; detailed safe error messages remain in the authenticated audit/report.
`GET /health` returns only service readiness, with 503 for no successful recent
cycle, stale worker heartbeat or data/account errors. Readiness does not mean
entries are enabled: stopped and paused are legitimate states. Emergency freezes
will eventually make readiness stale. Monitor it; there is no remote alert delivery
in v1. Retention/archival and account paging are future work; ledger history is
retained without deletion and may grow during extended operation.

## Tests and backtesting

From the repository root:

```sh
PYTHONPATH=trading-bot python3 -m unittest discover -s trading-bot/tests -v
npm run check --prefix server
npm test --prefix server
npm run test:browser --prefix server
```

The browser suite needs Playwright and Chromium: after `npm ci --prefix server`,
run `cd server && npx playwright install chromium`. CI installs browser dependencies
and runs Python, JavaScript and browser tests. See `VALIDATION.md` for actual local
results and restrictions; added checks are not described as passing unless run.

Backtest a supplied, chronological five-minute CSV with columns
`timestamp,open,high,low,close` (timestamps are Unix seconds or ISO UTC):

```sh
cd trading-bot
python3 -m bunbot.backtest history.csv --symbol BTC/USD
```

At least 22 contiguous bars are required. Signals only inspect earlier completed
bars; fills use the next bar's open. Stops/targets then use that bar's OHLC, assume
stop first if both are touched, apply fees/adverse slippage, and honor adverse stop
gaps. Any final open position is liquidated at the last close. The same entry risk
engine and paper ledger are used; no production DB is touched. This is a basic
single-instrument simulator without order-book depth, latency, partial fills or
historical provider downloads. It does not establish strategy profitability.

## Before any future live trading

Keep live execution disabled. Future work requires a separately reviewed broker
adapter, verified broker balances/inventory, persistent client-order IDs plus
remote-order reconciliation, partial/rejected/unknown-fill handling, exchange tick
and quantity rules, venue-specific fees, actual broker-side protective orders,
authorization/permissions, operational alerting and extended out-of-sample and
paper validation. `MarketData` and the unimplemented `FutureBroker` protocol mark
integration boundaries for stocks/ETFs, crypto, forex/gold and read-only balance or
withdrawal information. No broker implementation can be selected through this API.
Withdrawals and real-money credentials are outside this version.
