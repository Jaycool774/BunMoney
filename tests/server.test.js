const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server/server");
const { createMarketEngine, parameters } = require("../server/market-engine");
async function serve(t, options = {}) {
  const server = createApp({
    apiKey: "test",
    apiToken: null,
    fetchImpl: async () => ({ ok: true, json: async () => ({ close: "100" }) }),
    ...options,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  return "http://127.0.0.1:" + server.address().port;
}
test("Only public assets are served, with CSP", async (t) => {
  const base = await serve(t);
  for (const path of [
    "/",
    "/script.js",
    "/trading-core.js",
    "/coinbase-feed.js",
    "/assets/bg_city.webp",
  ]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("content-security-policy"));
  }
  for (const path of [
    "/server/server.js",
    "/server/package-lock.json",
    "/server/.env",
    "/.git/config",
    "/README.txt",
    "/tests/trading.test.js",
  ])
    assert.equal((await fetch(base + path)).status, 404);
});
test("Private token and cross-origin protection", async (t) => {
  const base = await serve(t, { apiToken: "test-token" });
  assert.equal(
    (await fetch(base + "/api/market/price?symbol=AAPL")).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/api/market/price?symbol=AAPL", {
        headers: { Authorization: "Bearer test-token" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/market/price?symbol=AAPL", {
        headers: {
          Origin: "https://evil.example",
          Authorization: "Bearer test-token",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/market/price?symbol=AAPL", {
        headers: {
          "Sec-Fetch-Site": "cross-site",
          Authorization: "Bearer test-token",
        },
      })
    ).status,
    403,
  );
});
test("Request validation, missing key and provider error status", async (t) => {
  const base = await serve(t);
  assert.equal((await fetch(base + "/api/market/price")).status, 400);
  assert.equal(
    (await fetch(base + "/api/market/time_series?symbol=AAPL&interval=bogus"))
      .status,
    400,
  );
  const missing = await serve(t, { apiKey: "" });
  assert.equal(
    (await fetch(missing + "/api/market/price?symbol=AAPL")).status,
    503,
  );
  const failed = await serve(t, {
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ code: 429, message: "secret upstream detail" }),
    }),
  });
  const r = await fetch(failed + "/api/market/price?symbol=AAPL");
  assert.equal(r.status, 429);
  assert.ok(!(await r.text()).includes("secret upstream detail"));
});
test("Rate limiting ignores spoofed forwarding headers", async (t) => {
  const base = await serve(t, { requestLimit: 1 });
  assert.equal(
    (await fetch(base + "/api/market/price?symbol=AAPL")).status,
    200,
  );
  const r = await fetch(base + "/api/market/price?symbol=AAPL", {
    headers: { "X-Forwarded-For": "1.2.3.4" },
  });
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("retry-after"));
});
test("Equivalent concurrent requests share provider call; cache expires", async () => {
  let calls = 0,
    time = 0;
  const engine = createMarketEngine({
    apiKey: "test",
    now: () => time,
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: async () => ({ close: "100" }) };
    },
  });
  await Promise.all([
    engine.quote({ symbol: "aapl" }),
    engine.quote({ symbol: "AAPL" }),
  ]);
  assert.equal(calls, 1);
  await engine.quote({ symbol: "AAPL" });
  assert.equal(calls, 1);
  time = 16000;
  await engine.quote({ symbol: "AAPL" });
  assert.equal(calls, 2);
});
test("Timeouts propagate as 504 without provider details", async () => {
  const e = createMarketEngine({
    apiKey: "test",
    timeoutMs: 1,
    fetchImpl: async (_u, { signal }) => {
      signal.throwIfAborted();
      await new Promise((r) => setTimeout(r, 10));
      signal.throwIfAborted();
    },
  });
  await assert.rejects(e.quote({ symbol: "AAPL" }), { status: 504 });
});
test("Query arrays and oversized output cannot bypass validation", () => {
  for (const q of [
    { symbol: ["AAPL", "BTC"] },
    { symbol: "AAPL", interval: "1min", outputsize: 5001 },
    { symbol: "AAPL", interval: ["1min"] },
    { symbol: "<img>" },
  ])
    assert.throws(() => parameters(q, true));
});

test('Provider quota cooldown prevents repeated credit-consuming requests', async () => {
  let calls=0;
  const engine=createMarketEngine({apiKey:'test',fetchImpl:async()=>{calls++;return {ok:false,status:429,json:async()=>({code:429})};}});
  await assert.rejects(engine.quote({symbol:'AAPL'}),{status:429});
  await assert.rejects(engine.quote({symbol:'SOUN'}),{status:429});
  assert.equal(calls,1);
});
