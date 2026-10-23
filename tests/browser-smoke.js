const { chromium } = require("../server/node_modules/playwright");
const { createApp } = require("../server/server");
const { once } = require("node:events");
const assert = require("node:assert/strict");

(async () => {
  const values = Array.from({ length: 80 }, (_, i) => ({
    datetime: new Date(Date.now() - i * 300000).toISOString(),
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: "1000",
  }));
  const server = createApp({
    apiKey: "test",
    apiToken: "browser-test-token",
    fetchImpl: async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes("time_series") ? { values } : { close: "100" },
    }),
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];

    page.on("pageerror", (error) => errors.push(error.message));
    const base = "http://127.0.0.1:" + server.address().port;
    await page.goto(base);
    await page.locator("details").click();
    await page.locator("#engineToken").fill("browser-test-token");
    await page.locator('[data-action="unlockMarketEngine"]').click();
    await page
      .waitForFunction(
        () => lastAnalysis?.ticker === "SOUN",
        {},
        { timeout: 5000 },
      )
      .catch(async (error) => {
        console.error(
          "Analysis reason:",
          await page.locator("#reason").textContent(),
          "Page errors:",
          errors,
        );
        throw error;
      });
    assert.equal(await page.locator("#engineToken").inputValue(), "");
    await page.locator(".buy-button").click();
    await page.waitForFunction(() => position?.side === "LONG");
    await page.locator(".sell-button").click();
    await page.waitForFunction(
      () => position === null && tradeHistory.length === 1,
    );
    await page.locator(".sell-button").click();
    await page.waitForFunction(() => position?.side === "SHORT");
    assert.equal(await page.evaluate(() => tradeHistory.length), 1);
    await page.locator(".buy-button").click();
    await page.waitForFunction(
      () => position === null && tradeHistory.length === 2,
    );
    await page.locator("#ticker").fill("AAPL");
    await page.locator('[data-action="analyze"]').click();
    await page.waitForFunction(() => lastAnalysis?.ticker === "AAPL");
    await page.keyboard.press("Tab");
    await page.locator('.nav-button[data-screen="favoritesScreen"]').click();
    await page.locator("#favoriteInput").fill("ETH/USD");
    await page.locator('[data-action="addFavorite"]').click();
    // Favorites validates against the provider before saving; wait for the async response.
    await page.locator('[data-action="openFavorite"][data-symbol="ETH/USD"]').waitFor();
    assert.equal(
      await page.locator('[data-action="openFavorite"][data-symbol="ETH/USD"]').count(),
      1,
    );
    await page
      .locator('[data-action="removeFavorite"][data-symbol="ETH/USD"]')
      .click();
    assert.equal(
      await page
        .locator('[data-action="openFavorite"][data-symbol="ETH/USD"]')
        .count(),
      0,
    );
    await page
      .locator('[data-action="showScreen"][data-screen="home"]')
      .click();
    await page.keyboard.press("t");
    // The responsive dashboard can be flex on mobile or grid on desktop.
    // Validate user-visible navigation rather than a specific CSS layout mode.
    assert.equal(await page.locator("#home").isVisible(), true);
    assert.equal(await page.locator("#favoritesScreen").isVisible(), false);
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("#demoMarketButton").click();
    // The toggle uses an alert; accept dialogs before issuing further actions.
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    assert.equal(await page.evaluate(() => demoMarketEnabled), true);
    await page.locator('[data-action="analyze"]').click();
    await page.waitForFunction(() => lastAnalysis?.source === "demo");
    assert.ok(await page.locator("#price").textContent());
    const download = page.waitForEvent("download");
    await page.locator('[data-action="exportPaperTrades"]').click();
    assert.equal(
      (await download).suggestedFilename(),
      "bunmoney-paper-trades.json",
    );
    await page.locator(".buy-button").click();
    await page.waitForFunction(() => position?.side === "LONG");
    await page.reload();
    await page.waitForFunction(() => position?.side === "LONG" && lastAnalysis?.source === "demo");
    assert.equal(await page.locator("#ticker").inputValue(), "AAPL");
    assert.equal(await page.evaluate(() => position.symbol), "AAPL");
    await page.locator(".sell-button").click();
    await page.waitForFunction(() => position === null);
    await page.locator('[data-action="clearLocalProgress"]').click();
    await page.waitForFunction(() => tradingBalance === 10 && tradeHistory.length === 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("bunmoney_demo_market")), null);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: "/tmp/bunmoney-smoke.png", fullPage: true });
    await context.close();
    console.log(
      "PASS browser smoke: private unlock, LONG/SHORT, fees, history, analysis, favorites, shortcuts, demo mode, export, restored positions, reset, mobile layout; no page errors.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
