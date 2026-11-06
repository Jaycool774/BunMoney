/* BunMoney command center: structural layout only, preserving live nodes and handlers. */
(() => {
  function mountDashboard() {
    const home=document.getElementById('home');
    const scanner=document.getElementById('bun-scanner-guide');
    const chart=document.getElementById('mainChartCard');
    const bot=home?.querySelector('.bot-dashboard');
    if(!home||!scanner||!chart||!bot) return;
    if(document.querySelector('.bun-command-grid')) return;
    const grid=document.createElement('div');
    grid.className='bun-command-grid';
    grid.setAttribute('aria-label','Market command dashboard');
    const left=document.createElement('div');
    left.className='bun-command-scanner';
    const center=document.createElement('div');
    center.className='bun-command-chart';
    const right=document.createElement('div');
    right.className='bun-command-bot';
    grid.append(left,center,right);
    const heading=document.createElement('div');
    heading.className='bun-command-heading';
    heading.innerHTML='<strong>📊 Market Command Dashboard</strong><span>Market research and simulated trading</span>';
    home.querySelector('.app-header')?.after(heading,grid);
    left.append(scanner);
    for(const selector of ['.home-search','.home-price-card','.home-metrics','.home-chart']){
      const node=home.querySelector(selector);
      if(node) center.append(node);
    }
    right.append(bot);
    bot.open=true;
    const stats=bot.querySelector('.bot-stats');
    if(stats){
      const overview=document.createElement('div');
      overview.className='bun-account-overview';
      overview.innerHTML='<div class="bun-command-heading"><strong>💰 Bot Paper Account</strong><span>Separate from browser paper balance</span></div>';
      stats.before(overview);
      overview.append(stats);
      heading.before(overview);
    }
    // No clones: existing IDs, listeners, state and bot control actions are retained.
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mountDashboard);
  else mountDashboard();
})();
