/* Layout-only enhancement: preserve original elements, IDs, handlers and trading state. */
(() => {
  const main = document.getElementById('home');
  const scanner = document.getElementById('bun-scanner-guide');
  const chart = document.getElementById('mainChartCard');
  const bot = document.querySelector('.bot-dashboard');
  if (!main || !scanner || !chart || !bot) return;
  const grid = document.createElement('div');
  grid.className = 'bun-command-grid';
  grid.setAttribute('aria-label', 'BunMoney market command dashboard');
  const left = document.createElement('div');
  left.className = 'bun-command-scanner';
  const center = document.createElement('div');
  center.className = 'bun-command-chart';
  const right = document.createElement('div');
  right.className = 'bun-command-bot';
  const heading = document.createElement('div');
  heading.className = 'bun-command-heading';
  heading.innerHTML = '<strong>📈 Market command dashboard</strong><span>Research markets · Practice only · No guaranteed signals</span>';
  grid.append(left, center, right);
  scanner.before(heading, grid);
  left.append(scanner);
  for (const id of ['homeSearch','homePriceCard','homeMetrics','mainChartCard']) {
    const node = document.getElementById(id);
    if (node) center.append(node);
  }
  right.append(bot);
  bot.open = true;
  const stats = bot.querySelector('.bot-stats');
  if (stats) {
    stats.classList.add('bun-command-stats');
    heading.before(stats);
  }
  const connection = main.querySelector('.connection-settings');
  if (connection) {
    connection.classList.add('bun-connection-panel');
    grid.after(connection);
  }
  const fit = () => {
    // Chart canvas is responsive to its parent; dispatch resize after relocation.
    window.dispatchEvent(new Event('resize'));
  };
  requestAnimationFrame(fit);
})();
