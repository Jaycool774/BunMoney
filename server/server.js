const express = require("express");
const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");
const { createMarketEngine } = require("./market-engine");
const { explain } = require("./emperor-bunny");
const { makeAssistant } = require("./live-ai");
const { createNewsFeed } = require("./news-feed");
const { createEventsCalendar } = require("./events-calendar");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
function createApp({
  apiKey = process.env.TWELVE_DATA_API_KEY,
  apiToken = process.env.MARKET_ENGINE_TOKEN,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  requestLimit = 120,
  timeoutMs = 10000,
  aiKey = process.env.OPENAI_API_KEY,
  aiFetchImpl = globalThis.fetch,
  newsFetchImpl = globalThis.fetch,
  eventsFetchImpl = globalThis.fetch,
} = {}) {
  const app = express(),
    engine = createMarketEngine({ apiKey, fetchImpl, now, timeoutMs }),
    assistant = makeAssistant({apiKey:aiKey,fetchImpl:aiFetchImpl,now}),
    newsFeed = createNewsFeed({fetchImpl:newsFetchImpl,now}),
    eventsCalendar = createEventsCalendar({fetchImpl:eventsFetchImpl,now}),
    clients = new Map();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://i.ibb.co data:; connect-src 'self' wss://advanced-trade-ws.coinbase.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "BunMoney Market Engine" }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.get("sec-fetch-site") === "cross-site")
      return res
        .status(403)
        .json({ error: "Cross-site requests are not allowed." });
    if (req.get("origin")) {
      let origin;
      try {
        origin = new URL(req.get("origin"));
      } catch {
        return res.status(403).json({ error: "Invalid origin." });
      }
      if (
        origin.host !== req.get("host") ||
        !["http:", "https:"].includes(origin.protocol)
      )
        return res
          .status(403)
          .json({ error: "Use the same-origin BunMoney server." });
    }
    if (apiToken) {
      const actual = Buffer.from(req.get("authorization") || ""),
        expected = Buffer.from(`Bearer ${apiToken}`);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return res
          .status(401)
          .json({
            error: "Unlock this private market engine with its access token.",
          });
    }
    const time = now();
    for (const [ip, e] of clients) if (time >= e.reset) clients.delete(ip);
    const ip = req.ip,
      entry = clients.get(ip) || { count: 0, reset: time + 60000 };
    if (!clients.has(ip) && clients.size >= 10000)
      return res.status(503).json({ error: "Market service busy." });
    clients.set(ip, entry);
    if (++entry.count > requestLimit) {
      res.set("Retry-After", String(Math.ceil((entry.reset - time) / 1000)));
      return res
        .status(429)
        .json({ error: "Too many requests. Try again shortly." });
    }
    next();
  });
  const route = (method) => async (req, res) => {
    try {
      res.json(await engine[method](req.query));
    } catch (error) {
      res
        .status(error.status || 500)
        .json({
          error: error.status ? error.message : "Market service failed.",
        });
    }
  };
  app.post("/api/ai/chat", express.json({ limit: "12kb" }), async (req, res) => {
    try {
      // Do not silently describe canned answers as generative AI.
      const result = await assistant.chat(req.body || {});
      res.status(result.status || 200).json(result);
    } catch {
      res.status(502).json({error:"Assistant service unavailable."});
    }
  });
  app.get("/api/news", async (req,res) => {
    try {
      const result = await newsFeed.news(req.query.symbol);
      res.status(result.status || 200).json(result);
    } catch {
      res.status(502).json({error:"Market news service unavailable."});
    }
  });
  app.get("/api/events",async (_req,res)=>{
    try{res.json(await eventsCalendar.load());}
    catch{res.status(502).json({error:"Calendar temporarily unavailable."});}
  });
  app.get(["/api/quote", "/api/market/price"], route("quote"));
  app.get(["/api/time-series", "/api/market/time_series"], route("series"));
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint is not implemented." }),
  );
  const root = path.join(__dirname, "..");
  // Only these files are public. Never expose the checkout as a static directory.
  for (const name of [
    "index.html",
    "style.css",
    "script.js",
    "trading-core.js",
    "coinbase-feed.js",
  ])
    app.get(
      name === "index.html" ? ["/", "/index.html"] : `/${name}`,
      (_req, res) => res.sendFile(path.join(root, name)),
    );
  app.use(
    "/assets",
    express.static(path.join(root, "assets"), {
      dotfiles: "deny",
      index: false,
      fallthrough: false,
    }),
  );
  app.use((_req, res) => res.status(404).type("text").send("Not found"));
  app.use((error, _req, res, _next) =>
    res
      .status(error.status || 500)
      .type("text")
      .send("Request failed"),
  );
  return app;
}
if (require.main === module) {
  const host = process.env.HOST || "127.0.0.1";
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) &&
    !process.env.MARKET_ENGINE_TOKEN
  ) {
    console.error(
      "Set MARKET_ENGINE_TOKEN before binding to a non-loopback interface.",
    );
    process.exitCode = 1;
  } else
    createApp().listen(Number(process.env.PORT) || 3000, host, () =>
      console.log("BunMoney running on configured host and port."),
    );
}
module.exports = { createApp };
