BunMoney — Private Trading Core

Development
-----------
Use the existing checkout on private-core-v2. Each cloud task is isolated; do not
create another Git worktree just for setup. Node 24.19.0 is pinned in .node-version.

  cd server
  npm ci
  npm test
  npm run check
  npm start

The server serves the frontend and API together on loopback port 3000. No separate
static server, routing helper, or build is needed. npm start enables Node's environment
proxy support. Use PORT to choose another port. Store TWELVE_DATA_API_KEY in securely
injected environment variables or server/.env (ignored by Git). Never put provider
credentials in script.js, committed files, URLs shared with others, or backups.

For a non-loopback HOST, MARKET_ENGINE_TOKEN is mandatory. Use a strong random token
configured securely; enter it in the frontend's Private engine access panel. It is
held only in page memory and must be reentered after reload. Use HTTPS whenever the
app is accessed over a network. CORS is same-origin only; trust proxy is disabled.
The development server does not configure HTTPS or deploy itself.

Data and execution
------------------
Live candles and quotes use Twelve Data. Quotes are cached for 15 seconds, candles
for 60 seconds; duplicate upstream requests coalesce. Input limits, 10-second provider
timeouts, a bounded cache and 120 requests/minute per client protect the provider.
A provider quota response pauses new upstream calls for one minute. Account-level
provider plan limits still apply, including historical data limits. History requests
up to 5,000 bars, not unlimited history.

BTC/USD, ETH/USD and SOL/USD can stream public Coinbase Advanced Trade ticker data.
Other symbols use REST. The feed validates product, timestamp and price; it uses
heartbeats, a watchdog and bounded reconnect backoff. REST polls every 15 seconds
when streaming quotes are stale; analysis/candles refresh every 60 seconds. Coinbase
prices may differ from Twelve Data's aggregate candles. The feed uses the browser's
network: allow wss://advanced-trade-ws.coinbase.com if its network policy requires it.
The backend requires HTTPS access to api.twelvedata.com. These settings do not
establish that any real WebSocket connection has been verified.

Demo mode is an explicit choice, defaults OFF, uses labeled synthetic candles and
quotes, and never silently substitutes for live data. Close a position before
switching sources. A saved open position restores its symbol and source.

Paper trading only: BUY opens LONG or closes SHORT; SELL opens SHORT or closes LONG.
Both directions validate stops and targets. Execution requires successful analysis
for the selected symbol within 2 minutes and a quote received within 20 seconds.
A quote's receive time is not proof of exchange freshness; markets can be closed or
data delayed by the provider subscription. Check market hours and provider metadata.

The simulator charges 0.10% fee per side and applies 0.05% adverse slippage per fill.
The trade amount is notional; available cash reserves it plus the entry fee. Stop,
target and manual exits execute at the next observed price with slippage. Gaps can
produce worse fills, and intra-poll crossings can be missed. Extreme SHORT gaps can
leave negative equity. This is a practice model, not a broker or exchange simulator.
Stops run in the browser only: no monitoring while closed, sleeping or disconnected.
Browser local storage is editable, not an authoritative financial ledger.

Saved data is schema-validated. Invalid or older open-position formats lock new
trades without overwriting the original saved data. Export a backup before using
Reset local data. Recovery backups include the original raw state. Imported backups
are limited to 2 MB and are fully validated before any saved state is replaced.
Paper-trade export is JSON. Backups do not contain the engine access token.

Supported UI: analysis, candles and SMA overlays, RSI, directional trade levels,
paper positions/history, favorites, watchlist scanner (first 10 favorites), analysis
alerts and data export. AI helpers return canned educational guidance; there is no
generative AI server. News text is educational, not a live feed. Brokerage connections,
real orders, multiplayer and PWA/offline operation are not connected. No real funds
are involved.

Validation
----------
  cd server
  npm test
  npm run check
  npx playwright install chromium
  npm run test:browser

On machines with system Chromium, set CHROMIUM_PATH=/usr/bin/chromium instead of
installing a browser. The browser smoke test starts its own loopback server using
synthetic provider fixtures, never live credentials or orders. Tests cover LONG/SHORT,
fees, stop gaps, symbol/source isolation, request races, persistence recovery, API
security/caching/timeouts and Coinbase reconnect behavior. CI runs these checks.
A real Coinbase network connection and account-specific provider entitlements must
be checked separately; unit and browser fixtures do not validate them.
