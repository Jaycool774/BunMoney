# Coinbase public data and Twelve Data credit usage

The Python bot defaults to `BOT_DATA_PROVIDER=coinbase`. It makes **zero Twelve
Data requests in that mode**, including startup, approvals, dashboard refreshes,
provider outages and recovery. There is no automatic fallback. Unknown provider
settings fail startup. This changes the data source, not strategy or execution:
all funds remain simulated and every existing risk/authentication check remains.

## Inspection and provider choice

The original Python `BunMoneyMarket` adapter called Node's `/api/quote` for each
symbol every worker cycle and `/api/time-series` for each running analysis. Node's
`server/market-engine.js` forwards cache misses to Twelve Data `/quote` and
`/time_series`. The legacy cache is 15 seconds for quotes and 60 seconds for series,
with identical in-flight request coalescing. Stock and forex support stays intact.
These provider calls can consume Twelve Data credits according to its plan and
symbol weighting; cache hits do not make another upstream request. With a 30-second
bot loop and no other clients, the old running bot could issue roughly four quote
and two historical upstream requests per minute before errors/limits.

The existing browser `coinbase-feed.js` streams Advanced Trade ticker updates from
`wss://advanced-trade-ws.coinbase.com`, subscribes to heartbeats, watches freshness,
and reconnects. It only runs while a browser is open and does not bootstrap Python
history. It remains unchanged. The browser's REST analysis/history and fallback
requests still use the Node engine: opening BunMoney, scanning markets, displaying
favorites or refreshing a chart may use Twelve Data, even if a browser ticker is
showing Coinbase prices. The Python dashboard's provider indicator refers to the
**bot**, not those separate screens.

The new Python adapter reuses the existing `MarketData`, `Quote`, `Candle`, strict
engine risk checks and redirect refusal. It uses these documented, keyless Coinbase
Exchange REST endpoints for `BTC-USD` and `ETH-USD` only:

- `GET https://api.exchange.coinbase.com/products/{product_id}/ticker`
- `GET https://api.exchange.coinbase.com/products/{product_id}/candles?granularity=300&start=...&end=...`

This deliberately uses low-frequency verified REST snapshots rather than adding
a second long-lived WebSocket dependency to the server-side worker. It is not a
tick-by-tick stream: the existing paper engine still evaluates every 30 seconds.
Coinbase recommends WebSocket feeds for continuous real-time streaming; a future
server-side stream could reduce ticker requests further, but is not needed for
this five-minute strategy. Historical data is fetched once per new completed
five-minute window, not on every quote or dashboard refresh.

## Verification, caching and failure behavior

- Symbol-to-product mappings and the HTTPS host are fixed. Unsupported symbols
  cause no request. Coinbase public ticker responses need not echo the product;
  identity comes from the product-specific path. Conflicting supplied product IDs
  are rejected. No operator, provider or service tokens are sent to Coinbase.
- Ticker prices must be finite and positive. Provider timestamps require an explicit
  timezone offset, cannot be future or regressed, and must be within 90 seconds.
  Cached quotes are rechecked for freshness; local receipt time never replaces the
  provider timestamp. Cached ticker snapshots live for at most ten seconds.
- Candle responses use documented `[time, low, high, open, close, volume]` arrays.
  OHLC/volume must be valid; timestamps must align to 300 seconds. Up to 40 bars are
  requested, below the API's 300-bar maximum. Only completed bars within the requested
  window are used; rows before the requested range and the current partial bar may
  be returned by Coinbase and are excluded after validation. Rows are sorted, with
  duplicates, gaps, missing latest bar or fewer than 21 completed bars rejected.
  No price interpolation or synthetic gap filling occurs. Coinbase documents that
  history may have gaps when no trades occur; such gaps block the bot.
- A ten-second settlement delay avoids repeatedly requesting a just-closed bar.
  At :00–:09 of a new five-minute boundary, the previous completed cached window is
  used if still within the existing freshness limit. From :10 onward, a new window
  is fetched. Successful candle results are cached by symbol and window end time.
  Concurrent identical fetches share the cache via a lock around fetch/validation.
- Timeouts, network disconnects, HTTP errors, invalid JSON/data and 429s invalidate
  cached results and block trading. A provider-wide cooldown starts at 5 seconds,
  doubles after consecutive failures up to 300 seconds, and honors longer numeric
  or HTTP-date `Retry-After` values (60 seconds if a 429 header is absent/invalid).
  No immediate tight retry loop or alternate billable endpoint is used. The normal
  worker performs recovery attempts on later cycles; a valid response reconnects
  REST access. Existing engine behavior still pauses new entries on a feed error,
  cancels proposals, and requires explicit Start after recovery.
- Dashboard state/report refreshes read SQLite and in-memory provider diagnostics;
  they never fetch prices or candles. The indicator reports configured provider
  and connection status, including unavailable/not connected. It is not a promise
  that every trade condition has passed.
- Provider changes require changing the server environment and restarting Python.
  Recovery cancels proposals, clears marks/caches and pauses entries. Cash, orders,
  daily counters, daily shutdown and emergency state persist. Stable signal IDs
  stay independent of provider, so switching cannot repeat the same candle signal.
  Only future signals/proposals record the new provider; old provenance is retained.

## Estimated request frequency

For one running worker, two products, a healthy provider and no extra approvals:

| Request | Per product | Both products |
| --- | --- | --- |
| Ticker | roughly every 30 seconds | 4/minute, 240/hour |
| Candles | once per completed five-minute window | 0.4/minute, 24/hour |
| Total | | about 4.4/minute, 264/hour, 6,336/day |

There are four cold-start requests when running (two quotes + two candle windows).
If stopped/paused, the worker checks quotes for health and protective exits but
skips strategy history; about four requests/minute remain. Emergency freeze skips
market requests. Approvals may add a quote when the ten-second cache has expired;
repeated accesses within that cache window do not duplicate requests. Actual
frequency varies with latency, restart, errors and cooldown. Run only one worker:
caches/rate state are per-process, not a distributed or persistent quota system.

Coinbase's documented public allowance is 10 requests/second/IP, burst 15. Normal
operation is well below that; other applications on the same IP share the limit.
The bot has no paid Coinbase dependency. Twelve Data plan limits remain relevant
only for explicitly selected legacy bot data and the existing frontend features.

## Codespaces setup when available

1. Check out `feature/coinbase-paper-data`; do not merge the draft automatically.
2. Preserve the existing paper SQLite database. Keep the same absolute `BOT_DB`
   path so restarting cannot reset account/history or risk limits.
3. Set `BOT_DATA_PROVIDER=coinbase` in the Python process environment. No Coinbase
   account or API key is needed. Keep independent, matching `MARKET_ENGINE_TOKEN`
   and `BOT_SERVICE_TOKEN` (32+ characters) configured for Python and Node as before.
   Do not remove authentication because public market data needs no credentials.
4. Permit outbound HTTPS to `api.exchange.coinbase.com` from the Python host.
   The current managed workspace allowlist does not include it, so a live Coinbase
   request has not been verified here. Codespaces usually provides outbound HTTPS;
   verify it rather than disabling TLS or bypassing a configured proxy.
5. Run `npm ci --prefix server`, then `npm start --prefix server`. In another terminal
   with the matching environment, run `cd trading-bot && python3 -m bunbot.service`.
   The Node server can serve the bot dashboard without a Twelve Data key, although
   its stock/forex data features then remain unavailable. Existing stock analysis
   on the page may request Twelve Data if you configure that key.
6. Unlock BunMoney and verify **Data: coinbase (connected)**. Review recovered account
   state, then explicitly Start. Test freshness/error handling before unattended use.
   No always-on deployment or continuous running is claimed by this change.

Optional read-only live data check (no SQLite or orders):

```sh
cd trading-bot
python3 - <<'PY'
import time
from bunbot.coinbase import CoinbaseMarket
market = CoinbaseMarket(time.time)
for symbol in ('BTC/USD', 'ETH/USD'):
    quote = market.quote(symbol)
    bars = market.candles(symbol)
    print(symbol, 'price:', quote.price, 'provider_timestamp:', quote.timestamp,
          'completed_bars:', len(bars), 'last_close_time:', bars[-1].timestamp + 300)
print(market.diagnostics())
PY
```

To deliberately use the legacy billable provider instead, set
`BOT_DATA_PROVIDER=twelve_data`, configure Node's `TWELVE_DATA_API_KEY` and the bot's
`MARKET_ENGINE_URL`, and restart Python. This is an explicit provider selection,
never an automatic outage fallback. It leaves entries paused until reviewed.

## Official references

- [Ticker endpoint](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker)
- [Candles, intervals, gaps and limits](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)
- [Public REST rate limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits)
