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

test("Rule-based engine remains usable without provider", () => {
  const { explain } = require("../server/emperor-bunny");
  const result = explain("Explain the risk", {
    symbol:"AAPL",trend:"BULLISH",setup:"WAIT",price:100,support:95,
    resistance:108,stop:94,target:112,rr:2,ageMs:2000,source:"live"
  });
  assert.equal(result.mode,"educational");
  assert.match(result.text,/AAPL/);
  assert.match(result.text,/risk/i);
});
test("Conversational AI requires private server API key", async t => {
  const base=await serve(t,{aiKey:""});
  const chat=await fetch(base+"/api/ai/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"Hello",history:[]})});
  assert.equal(chat.status,503);
  assert.match((await chat.json()).error,/OPENAI_API_KEY/);
  // News no longer requires an AI key; test its behavior independently above.
  const invalid=await fetch(base+"/api/news?symbol=%3Cscript%3E");
  assert.equal(invalid.status,400);
});
test("Conversational AI supports sourced news and bounded history", async t => {
  const calls=[];
  const mock=async (url,opts)=>{
    calls.push(JSON.parse(opts.body));
    return {ok:true,status:200,json:async()=>({output:[{type:"message",content:[{type:"output_text",text:"Tesla reported a new filing.",annotations:[{type:"url_citation",url:"https://example.com/report",title:"Official report"},{type:"url_citation",url:"javascript:alert(1)",title:"bad"}]}]}]})};
  };
  const base=await serve(t,{aiKey:"test-ai",aiFetchImpl:mock});
  const response=await fetch(base+"/api/ai/chat",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:"What's the latest news about TSLA?",context:{symbol:"TSLA",trend:"SIDEWAYS"},history:[{role:"user",content:"Hello"}]})});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.searched,true);
  assert.equal(data.sources.length,1);
  assert.equal(data.sources[0].url,"https://example.com/report");
  assert.equal(calls[0].tools[0].type,"web_search");
  assert.equal(calls.length,1); // Market news no longer calls the AI provider
});

test("Independent news returns sourced headlines without an AI key",async t=>{
 const xml='<?xml version="1.0"?><rss><channel><item><title>TSLA announces update &amp; guidance</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Thu, 22 Oct 2026 20:00:00 GMT</pubDate><source>Ticker News</source></item></channel></rss>';
 let calls=0;
 const base=await serve(t,{aiKey:"",newsFetchImpl:async()=>{calls++;return {ok:true,text:async()=>xml};}});
 const r=await fetch(base+"/api/news?symbol=TSLA");assert.equal(r.status,200);
 const data=await r.json();assert.equal(data.articles.length,1);assert.match(data.articles[0].title,/TSLA announces/);
 assert.equal(data.articles[0].source,"Ticker News");
 assert.equal((await fetch(base+"/api/news?symbol=TSLA")).status,200);assert.equal(calls,1);
 assert.equal((await fetch(base+"/api/news?symbol=%3Cscript%3E")).status,400);
});

test("News impact labels are heuristic, not confirmed price predictions",()=>{
 const {classifyHeadline}=require("../server/news-feed");
 assert.equal(classifyHeadline("TSLA raises guidance").impact,"potentially bullish");
 assert.equal(classifyHeadline("TSLA cuts guidance").impact,"potentially bearish");
 assert.equal(classifyHeadline("TSLA reports a new update").impact,"uncertain");
 assert.equal(classifyHeadline("TSLA raises and cuts guidance").impact,"uncertain");
});
