/* Structural BunMoney dashboard: move existing elements, never clone them.
   Preserve their IDs, event listeners, chart canvas and paper-trading state. */
(() => {
  function build() {
    const home = document.getElementById('home');
    const hero = home?.querySelector('.bun-welcome');
    const shortcuts = home?.querySelector('.bun-shortcuts');
    const scanner = document.getElementById('bun-scanner-guide');
    const bot = home?.querySelector('.bot-dashboard');
    const chart = document.getElementById('mainChartCard');
    if (!home || !hero || !shortcuts || !scanner || !bot || !chart) {
      console.warn('BunMoney dashboard: a required section is missing; original layout retained.');
      return;
    }
    if (home.querySelector('.bun-command-grid')) return;
    // The mascot banner and shortcuts belong at the very top, above the old header.
    home.prepend(hero, shortcuts);
    const heading = document.createElement('div');
    heading.className = 'bun-command-heading';
    heading.innerHTML = '<strong>📈 Market command dashboard</strong><span>Paper trading · Market research · Bot controls</span>';
    const stats = bot.querySelector('.bot-stats');
    if (stats) {
      stats.classList.add('bun-command-stats');
      shortcuts.after(stats);
    }
    const grid = document.createElement('div');
    grid.className = 'bun-command-grid';
    grid.setAttribute('aria-label', 'Market scanner, chart and Python trading bot');
    const left = document.createElement('div');
    left.className = 'bun-command-scanner';
    const center = document.createElement('div');
    center.className = 'bun-command-chart';
    const right = document.createElement('div');
    right.className = 'bun-command-bot';
    grid.append(left,center,right);
    (stats || shortcuts).after(heading,grid);
    left.append(scanner);
    // Use the real class/IDs from index.html; previous version targeted missing IDs.
    for (const id of ['homeSearch','homePriceCard','homeMetrics','mainChartCard']) {
      const node = document.getElementById(id);
      if (node) center.append(node);
    }
    right.append(bot);
    bot.open = true;
    // Preserve existing technical analysis, trade levels, trading controls,
    // history, news and calendars below the new dashboard.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, {once:true});
  } else {
    build();
  }
})();
