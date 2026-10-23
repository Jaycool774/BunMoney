(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BunCoinbaseFeed = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const products = {
    "BTC/USD": "BTC-USD",
    "ETH/USD": "ETH-USD",
    "SOL/USD": "SOL-USD",
  };
  return class CoinbaseFeed {
    constructor({
      onPrice,
      onStatus = () => {},
      Socket = globalThis.WebSocket,
      schedule = (...args) => globalThis.setTimeout(...args),
      cancel = (id) => globalThis.clearTimeout(id),
      now = Date.now,
    }) {
      Object.assign(this, { onPrice, onStatus, Socket, schedule, cancel, now });
      this.generation = 0;
      this.attempt = 0;
      this.lastTick = 0;
      this.lastTimestamp = 0;
    }
    start(symbol) {
      this.stop();
      if (!products[symbol] || !this.Socket) {
        this.onStatus("REST polling");
        return;
      }
      this.symbol = symbol;
      this.connect(this.generation);
    }
    connect(generation) {
      if (generation !== this.generation) return;
      this.onStatus("Coinbase connecting; REST fallback");
      let socket;
      try {
        socket = new this.Socket("wss://advanced-trade-ws.coinbase.com");
      } catch {
        this.retry(generation);
        return;
      }
      this.socket = socket;
      this.watchdog = this.schedule(() => socket.close(), 15000);
      socket.onopen = () => {
        if (generation !== this.generation || this.socket !== socket) return;
        this.cancel(this.watchdog);
        socket.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [products[this.symbol]],
            channel: "ticker",
          }),
        );
        socket.send(
          JSON.stringify({ type: "subscribe", channel: "heartbeats" }),
        );
        this.watchdog = this.schedule(() => socket.close(), 30000);
      };
      socket.onmessage = (event) => {
        if (generation !== this.generation || this.socket !== socket) return;
        try {
          const data = JSON.parse(event.data);
          if (!["ticker", "heartbeats"].includes(data.channel)) return;
          this.cancel(this.watchdog);
          this.watchdog = this.schedule(() => socket.close(), 30000);
          if (data.channel !== "ticker") return;
          const timestamp = Date.parse(data.timestamp);
          if (
            !Number.isFinite(timestamp) ||
            Math.abs(this.now() - timestamp) > 20000 || timestamp < this.lastTimestamp
          )
            return;
          for (const update of data.events || [])
            for (const tick of update.tickers || []) {
              const price = Number(tick.price);
              if (
                tick.product_id !== products[this.symbol] ||
                !Number.isFinite(price) ||
                price <= 0
              )
                continue;
              this.lastTimestamp = timestamp;
            this.lastTick = this.now();
              this.attempt = 0;
              this.onStatus("Coinbase live");
              this.onPrice(this.symbol, price, this.lastTick);
            }
        } catch {
          /* Ignore malformed provider messages; watchdog retains REST fallback. */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (generation !== this.generation || this.socket !== socket) return;
        this.cancel(this.watchdog);
        this.lastTick = 0;
        this.retry(generation);
      };
    }
    retry(generation) {
      if (generation !== this.generation) return;
      this.cancel(this.retryTimer);
      this.onStatus("Coinbase disconnected; REST fallback");
      this.retryTimer = this.schedule(
        () => this.connect(generation),
        Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)),
      );
    }
    fresh(symbol) {
      return (
        this.symbol === symbol &&
        this.lastTick > 0 &&
        this.now() - this.lastTick < 20000
      );
    }
    stop() {
      this.generation++;
      this.cancel(this.retryTimer);
      this.cancel(this.watchdog);
      if (this.socket) this.socket.close();
      this.socket = null;
      this.lastTick = 0;
      this.lastTimestamp = 0;
      this.symbol = null;
    }
  };
});
