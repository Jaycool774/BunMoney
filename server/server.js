const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
      ok: true,
          service: "BunMoney Market Engine"
            });
            });

            app.get("/api/quote", async (req, res) => {
              try {
                  const symbol = String(req.query.symbol || "").trim().toUpperCase();

                      if (!symbol) {
                            return res.status(400).json({ error: "Missing symbol" });
                                }

                                    if (!API_KEY) {
                                          return res.status(500).json({
                                                  error: "Market API key is not configured"
                                                        });
                                                            }

                                                                const url =
                                                                      "https://api.twelvedata.com/quote" +
                                                                            `?symbol=${encodeURIComponent(symbol)}` +
                                                                                  `&apikey=${encodeURIComponent(API_KEY)}`;

                                                                                      const response = await fetch(url);
                                                                                          const data = await response.json();

                                                                                              if (!response.ok || data.status === "error") {
                                                                                                    return res.status(502).json({
                                                                                                            error: data.message || "Twelve Data request failed"
                                                                                                                  });
                                                                                                                      }

                                                                                                                          res.json(data);
                                                                                                                            } catch (error) {
                                                                                                                                console.error("Quote error:", error);
                                                                                                                                    res.status(500).json({
                                                                                                                                          error: "Unable to retrieve market data"
                                                                                                                                              });
                                                                                                                                                }
                                                                                                                                                });

                                                                                                                                                app.get("/api/time-series", async (req, res) => {
                                                                                                                                                  try {
                                                                                                                                                      const symbol = String(req.query.symbol || "").trim().toUpperCase();
                                                                                                                                                          const interval = String(req.query.interval || "5min").trim();
                                                                                                                                                              const outputsize = String(req.query.outputsize || "100").trim();

                                                                                                                                                                  if (!symbol) {
                                                                                                                                                                        return res.status(400).json({ error: "Missing symbol" });
                                                                                                                                                                            }

                                                                                                                                                                                if (!API_KEY) {
                                                                                                                                                                                      return res.status(500).json({
                                                                                                                                                                                              error: "Market API key is not configured"
                                                                                                                                                                                                    });
                                                                                                                                                                                                        }

                                                                                                                                                                                                            const params = new URLSearchParams({
                                                                                                                                                                                                                  symbol,
                                                                                                                                                                                                                        interval,
                                                                                                                                                                                                                              outputsize,
                                                                                                                                                                                                                                    apikey: API_KEY
                                                                                                                                                                                                                                        });

                                                                                                                                                                                                                                            const response = await fetch(
                                                                                                                                                                                                                                                  `https://api.twelvedata.com/time_series?${params.toString()}`
                                                                                                                                                                                                                                                      );

                                                                                                                                                                                                                                                          const data = await response.json();

                                                                                                                                                                                                                                                              if (!response.ok || data.status === "error") {
                                                                                                                                                                                                                                                                    return res.status(502).json({
                                                                                                                                                                                                                                                                            error: data.message || "Twelve Data request failed"
                                                                                                                                                                                                                                                                                  });
                                                                                                                                                                                                                                                                                      }

                                                                                                                                                                                                                                                                                          res.json(data);
                                                                                                                                                                                                                                                                                            } catch (error) {
                                                                                                                                                                                                                                                                                                console.error("Time-series error:", error);
                                                                                                                                                                                                                                                                                                    res.status(500).json({
                                                                                                                                                                                                                                                                                                          error: "Unable to retrieve market data"
                                                                                                                                                                                                                                                                                                              });
                                                                                                                                                                                                                                                                                                                }
                                                                                                                                                                                                                                                                                                                });

                                                                                                                                                                                                                                                                                                                app.listen(PORT, "0.0.0.0", () => {
                                                                                                                                                                                                                                                                                                                  console.log(`BunMoney Market Engine running on port ${PORT}`);
                                                                                                                                                                                                                                                                                                                  });