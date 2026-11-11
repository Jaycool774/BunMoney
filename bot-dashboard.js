/* Isolated dashboard; existing charts, plans and paper accounts remain independent. */
(() => {
  const panel=document.createElement('details');
  panel.className='bot-dashboard';
  panel.innerHTML=`<summary>Python Trading Bot · Simulated funds only</summary>
    <p>This account is separate from browser paper trading. SMA signals are experimental. Stops may fill beyond the planned loss.</p>
    <p>Use the existing private engine unlock above. Credentials stay in memory.</p>
    <div class="bot-controls"><button type="button" data-bot="refresh">Refresh report</button>
    <label>Mode <select id="bot-mode"><option value="manual">Manual</option><option value="approval">Approval</option><option value="automatic">Automatic paper</option></select></label>
    <button type="button" data-bot="mode">Apply mode</button><button type="button" data-bot="start">Start</button>
    <button type="button" data-bot="pause">Pause entries</button><button type="button" data-bot="stop">Stop entries</button>
    <button type="button" data-bot="emergency" class="bot-emergency">EMERGENCY STOP</button>
    <button type="button" data-bot="reset-emergency">Reset emergency (stays paused)</button></div>
    <p>Pause and stop block entries; protective paper exits remain active. Emergency stop freezes all orders and does not close a position.</p>
    <p id="bot-message" role="status" aria-live="polite">Not connected. No continuous operation is claimed.</p>
    <div class="bot-stats"><div>💰 Equity <strong id="bot-equity">—</strong></div><div>📈 P/L <strong id="bot-profit">—</strong></div><div>🔔 Pending <strong id="bot-pending-count">0</strong></div><div>🛡️ Risk <strong id="bot-risk">—</strong></div></div><nav class="bot-tabs"><button type="button" data-tab="overview">🏠 Overview</button><button type="button" data-tab="approvals">🔔 Approvals</button><button type="button" data-tab="signals">📊 Signals</button><button type="button" data-tab="activity">🛰️ Activity</button><button type="button" data-tab="trades">💼 Trades</button><button type="button" data-tab="insights">📈 Insights</button><button type="button" data-tab="safety">🛡️ Safety</button><button type="button" data-tab="replay">⏪ Replay</button><button type="button" data-tab="settings">⚙️ Settings</button></nav><section data-section="overview"><h3>Account overview</h3><div id="bot-account"></div></section><section data-section="approvals" hidden><h3>Pending approvals</h3><button type="button" id="bot-notify">🔔 Enable browser alerts</button><p id="bot-notify-info">Alerts work while this page is open and connected.</p><div id="bot-approvals"></div>
    </section><section data-section="signals" hidden><h3>Signals (sell signals close held longs; no short selling)</h3><div id="bot-signals"></div><h3>Trade plans</h3><div id="bot-plans"></div>
    </section><section data-section="activity" hidden><h3>Live strategy scan activity</h3><p>Latest completed scan results; refreshes every 15 seconds while this panel is open. No signal is not a trade.</p><p id="bot-last-success">Last successful strategy scan: never</p><p id="bot-activity-count">No scan results yet.</p><label>Show activity <select id="bot-activity-filter"><option value="all">All decisions</option><option value="quick">Quick Trader</option><option value="patient">Patient Trader</option><option value="blocked">Blocked / skipped</option></select></label><div id="bot-activity"></div></section><section data-section="trades" hidden><h3>Open position</h3><pre id="bot-position"></pre><h3>Trade history</h3><div id="bot-history"></div>
    </section><section data-section="insights" hidden><h3>Strategy leaderboard — completed paper trades only</h3><p>Historical God Mode simulations are separate from actual paper-trade results.</p><div id="bot-leaderboard"></div><h3>Automatic trade journal</h3><p>Read-only ledger of closed simulated trades. Export excludes credentials.</p><button type="button" id="bot-journal-export">Export paper journal CSV</button><div id="bot-journal"></div></section><section data-section="safety" hidden><h3>Advanced paper risk monitor</h3><pre id="bot-risk-details"></pre><h3>24/7 readiness and health</h3><p id="bot-health-details">Not connected. Browser monitoring does not keep Codespaces running.</p><h3>Smart alerts</h3><label><input type="checkbox" id="bot-smart-alerts"> Show risk and connection warnings (while dashboard is open)</label><div id="bot-smart-alert-log" role="status"></div><h3>Economic event blackout — manually scheduled</h3><p>Manually enter verified event windows in UTC. New paper BUY entries are blocked during configured windows; protective exits continue. No automatic economic calendar feed is connected. Empty windows mean NO protection.</p><textarea id="bot-news-windows" rows="3" placeholder="2026-11-12T12:00:00Z,2026-11-12T15:00:00Z,CPI release"></textarea><button type="button" id="bot-news-apply">Apply UTC blackout windows</button><button type="button" id="bot-news-clear">Clear windows</button><p id="bot-news-status" role="status"></p><h3>Multi-timeframe confirmation</h3><p>Read-only analysis of the selected chart symbol using Twelve Data. Does not authorize or block paper orders.</p><button type="button" id="bot-mtf-check">Check 5m / 15m / 1H / 4H</button><p id="bot-mtf-status">Not checked.</p><div id="bot-mtf-results"></div></section><section data-section="replay" hidden><h3>Historical market replay (offline, read-only)</h3><p>Paste an OHLC JSON array, then step forward one candle at a time. Replay never sends an order or reads future bars.</p><textarea id="bot-replay-input" rows="3" placeholder='[{"open":100,"high":102,"low":99,"close":101},...]'></textarea><button type="button" id="bot-replay-load">Load candles</button><button type="button" id="bot-replay-next">Next candle</button><button type="button" id="bot-replay-reset">Reset</button><p id="bot-replay-status">No replay loaded.</p><pre id="bot-replay-output"></pre></section><section data-section="settings" hidden><h3>Markets to scan</h3><p>Choose optional markets. Multiple markets can be scanned together; choose up to five simultaneous paper positions with independent stops.</p><div id="bot-market-options"></div><button type="button" data-bot="markets">Apply market selection</button><p id="bot-market-status"></p><h3>Simultaneous paper trades</h3><label>Maximum open positions <select id="bot-max-positions"><option value="1">1 (default)</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label><button type="button" data-bot="max-positions">Apply position limit</button><p id="bot-position-limit-info">Combined planned open risk is capped at 2.5% of paper equity; daily entries remain capped at 3.</p><h3>Risk settings and morning report (UTC)</h3><pre id="bot-report"></pre></section>`;
  (document.getElementById('bunBotMount') || document.querySelector('main') || document.body).append(panel);
  let pending=0,latestRequest=0,notifyEnabled=false,seenIds=null,latestActivity=[],lastSnapshot=null,lastHealthWarning="",replayBars=[],replayIndex=0;
  const marketSymbols=['BTC/USD','ETH/USD','SOL/USD','LTC/USD','DOGE/USD','ADA/USD','XRP/USD','AVAX/USD','LINK/USD'];
  const marketOptions=document.getElementById('bot-market-options');
  marketSymbols.forEach(symbol=>{const label=document.createElement('label');label.style.cssText='display:inline-flex;gap:5px;align-items:center;margin:5px 10px 5px 0';const input=document.createElement('input');input.type='checkbox';input.value=symbol;input.checked=['BTC/USD','ETH/USD'].includes(symbol);label.append(input,document.createTextNode(symbol));marketOptions.append(label);});
  function showTab(name){panel.querySelectorAll('[data-section]').forEach(x=>x.hidden=x.dataset.section!==name);panel.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));}
  panel.addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(tab)showTab(tab.dataset.tab);});
  document.getElementById('bot-notify').addEventListener('click',async()=>{
    if(notifyEnabled){notifyEnabled=false;document.getElementById('bot-notify').textContent='🔔 Enable browser alerts';return;}
    if(!('Notification' in window)){document.getElementById('bot-notify-info').textContent='Notifications unavailable in this browser.';return;}
    try{notifyEnabled=(await Notification.requestPermission())==='granted';}catch(_){notifyEnabled=false;}
    document.getElementById('bot-notify').textContent=notifyEnabled?'🔕 Disable alerts':'🔔 Enable browser alerts';
    document.getElementById('bot-notify-info').textContent=notifyEnabled?'Alerts enabled while this page is open.':'Permission not granted.';
  });
  showTab('overview');
  const el=id=>document.getElementById(id), money=x=>x==null?'unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(x);
  function table(container,rows,keys){
    container.replaceChildren();
    if(!rows.length){container.textContent='None';return;}
    const t=document.createElement('table'),head=document.createElement('tr');
    t.className='bot-data-table';
    keys.forEach(key=>{const th=document.createElement('th');th.textContent=key;head.append(th);});t.append(head);
    rows.forEach(row=>{const tr=document.createElement('tr');keys.forEach(key=>{const td=document.createElement('td');td.dataset.label=key.replaceAll('_',' ');td.textContent=key==='at'&&Number.isFinite(Number(row[key]))?new Date(Number(row[key])*1000).toLocaleString():typeof row[key]==='number'?String(Math.round(row[key]*1e6)/1e6):String(row[key]??'');tr.append(td);});t.append(tr);});container.append(t);
  }
  function renderActivity(){
    const filter=el('bot-activity-filter').value;
    const rows=latestActivity.filter(a=>filter==='all'||(filter==='blocked'?['blocked','skip','duplicate'].includes(a.decision):a.strategy===filter));
    el('bot-activity-count').textContent=rows.length+' of '+latestActivity.length+' recent scan results';
    table(el('bot-activity'),rows,['at','symbol','strategy','decision','reason']);
  }
  el('bot-activity-filter').addEventListener('change',renderActivity);
  const insights=window.BunBotInsights;
  function csvCell(v){const str=String(v??'');return '"'+( /^[=+@-]/.test(str)?'\''+str:str).replaceAll('"','""')+'"';}
  el('bot-journal-export').addEventListener('click',()=>{
    const rows=Array.isArray(lastSnapshot?.trades)?lastSnapshot.trades:[];
    const keys=['symbol','strategy','side','entry','exit','qty','pnl','fees','reason','closed'];
    const csv=[keys.join(','),...rows.map(t=>keys.map(k=>csvCell(t[k])).join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='bunmoney-paper-journal.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  el('bot-replay-load').addEventListener('click',()=>{
    try{
      const bars=JSON.parse(el('bot-replay-input').value);
      if(!Array.isArray(bars)||bars.length>5000||!bars.length)throw Error('Supply 1–5,000 candles');
      for(const c of bars)if(![c.open,c.high,c.low,c.close].every(x=>Number.isFinite(Number(x))&&Number(x)>0)||Number(c.low)>Math.min(c.open,c.close)||Number(c.high)<Math.max(c.open,c.close))throw Error('Invalid OHLC');
      replayBars=bars.map(c=>({open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)}));replayIndex=0;
      el('bot-replay-status').textContent=replayBars.length+' candles loaded. Press Next candle.';
      el('bot-replay-output').textContent='';
    }catch(e){replayBars=[];replayIndex=0;el('bot-replay-status').textContent='Replay rejected: '+e.message;}
  });
  el('bot-replay-reset').addEventListener('click',()=>{replayIndex=0;el('bot-replay-output').textContent='';el('bot-replay-status').textContent='Replay reset.';});
  el('bot-replay-next').addEventListener('click',()=>{
    if(!replayBars.length||replayIndex>=replayBars.length){el('bot-replay-status').textContent='No more candles.';return;}
    replayIndex++;
    const visible=insights.replay(replayBars,replayIndex);
    el('bot-replay-status').textContent='Revealed '+replayIndex+' / '+replayBars.length+' candles · '+insights.trend(visible);
    el('bot-replay-output').textContent=JSON.stringify(visible.at(-1),null,2);
  });
  el('bot-mtf-check').addEventListener('click',async()=>{
    const symbol=typeof selectedSymbol==='function'?selectedSymbol():null;
    const status=el('bot-mtf-status'),button=el('bot-mtf-check');
    if(!symbol||typeof marketEngineRequest!=='function'){status.textContent='Market chart is not ready.';return;}
    button.disabled=true;status.textContent='Checking '+symbol+' across four timeframes…';
    const rows=[];
    try{
      for(const interval of ['5min','15min','1h','4h']){
        try{
          const data=await marketEngineRequest('/time_series',{symbol,interval,outputsize:40});
          if(data.meta?.symbol&&String(data.meta.symbol).toUpperCase()!==symbol)throw Error('Mismatched symbol');
          const bars=Array.isArray(data.values)?data.values.slice().reverse():[];
          rows.push({interval,trend:insights.trend(bars),candles:bars.length});
        }catch(_){rows.push({interval,trend:'Unavailable',candles:0});}
      }
      table(el('bot-mtf-results'),rows,['interval','trend','candles']);
      status.textContent='Checked '+symbol+' · '+new Date().toLocaleTimeString()+' · Advisory only; provider data may be delayed.';
    }finally{button.disabled=false;}
  });
  function applyNewsWindows(clear=false){
    try{
      const lines=clear?[]:el('bot-news-windows').value.split('\\n').map(x=>x.trim()).filter(Boolean);
      const windows=lines.map(line=>{
        const [start,end,...label]=line.split(',');
        const a=Date.parse(start),b=Date.parse(end);
        if(!start?.endsWith('Z')||!end?.endsWith('Z')||!Number.isFinite(a)||!Number.isFinite(b)||!label.join(',').trim())throw Error('Use UTC ISO timestamps ending in Z, comma-separated with a label.');
        return {start:a/1000,end:b/1000,label:label.join(',').trim()};
      });
      el('bot-news-status').textContent='Submitting '+windows.length+' manually verified windows…';
      request('news-blackouts',windows);
    }catch(e){el('bot-news-status').textContent=e.message;}
  }
  el('bot-news-apply').addEventListener('click',()=>applyNewsWindows(false));
  el('bot-news-clear').addEventListener('click',()=>applyNewsWindows(true));
  function render(s){
    lastSnapshot=s;
    el('bot-news-status').textContent=(s.news_blackouts||[]).length+' configured UTC windows · '+((s.news_blackouts||[]).some(w=>w.start<=Date.now()/1000&&Date.now()/1000<w.end)?'BLACKOUT ACTIVE':'No blackout active')+' · Schedule is manually maintained.';
    el('bot-mode').value=s.mode;
    el('bot-max-positions').value=String(s.max_open_positions||1);
    el('bot-position-limit-info').textContent=`Open ${s.positions?.length||0} / ${s.max_open_positions||1} positions · Combined planned risk ${money((s.positions||[]).reduce((sum,p)=>sum+(p.planned_risk||0),0))} · Limit ${((s.risk?.max_open_risk_fraction||0.025)*100).toFixed(1)}% of paper equity · ${s.risk?.daily_trades||3} entries/day`;
    marketOptions.querySelectorAll('input').forEach(input=>{input.checked=(s.enabled_symbols||['BTC/USD','ETH/USD']).includes(input.value);});
    el('bot-market-status').textContent='Scanning: '+(s.enabled_symbols||['BTC/USD','ETH/USD']).join(', ')+' · Up to ${s.max_open_positions||1} simultaneous paper positions';
    el('bot-message').textContent=`${s.status} · ${s.mode} · Emergency ${s.emergency?'ON':'off'} · Last completed cycle ${s.last_cycle?new Date(s.last_cycle*1000).toISOString():'never'}${s.last_error?' · Error: '+s.last_error:''} · ${s.status==='running'?(s.mode==='approval'?'Waiting for a qualifying SMA crossover; new paper entries require approval.':s.mode==='automatic'?'Qualifying signals can execute paper trades automatically within risk limits.':'Manual mode: no automatic entries.'):'New entries disabled; protective paper exits continue unless emergency stop is active.'}`;
    el('bot-account').textContent=`Paper cash ${money(s.cash)} · Equity ${money(s.equity)} · Realized P/L ${money(s.realized)} · Unrealized P/L ${money(s.unrealized)} · Daily loss ${money(s.daily_loss_usage)} / ${money(s.day_equity*s.risk.daily_loss_fraction)} · Entries ${s.day_entries}/${s.risk.daily_trades} · Daily shutdown ${s.day_shutdown?'ON':'off'}`;
    el('bot-position').textContent=s.positions?.length?JSON.stringify(s.positions,null,2):'No open position';
    el('bot-equity').textContent=money(s.equity);
    const pl=(Number(s.realized)||0)+(Number(s.unrealized)||0);
    el('bot-profit').textContent=money(pl);
    el('bot-profit').style.color=pl<0?'#fda4af':'#86efac';
    el('bot-risk').textContent=money(s.daily_loss_usage)+' / '+money(s.day_equity*s.risk.daily_loss_fraction);
    el('bot-last-success').textContent='Last successful strategy scan: '+(s.last_successful_cycle?new Date(s.last_successful_cycle*1000).toLocaleString():'never');
    latestActivity=Array.isArray(s.activity)?s.activity:[];
    renderActivity();
    table(el('bot-history'),s.trades.slice(-50).reverse(),['symbol','entry','exit','qty','pnl','fees','reason']);
    table(el('bot-signals'),Object.values(s.signals).slice(-20).reverse(),['symbol','side','strategy','reason','at']);
    table(el('bot-plans'),Object.values(s.proposals).slice(-20).reverse(),['symbol','side','strategy','explanation','status','reason','entry','stop','target','qty','planned_risk','risk_reward']);
    el('bot-report').textContent=JSON.stringify({settings:s.risk,morning_report:s.report},null,2);
    if(insights){
      table(el('bot-leaderboard'),insights.leaderboard(s.trades),['strategy','trades','wins','winRate','netPnl','profitFactor','maxDrawdownDollars']);
      table(el('bot-journal'),s.trades.slice(-50).reverse(),['symbol','strategy','side','pnl','fees','reason','closed']);
      const risk=insights.risk(s),health=insights.health(s,Date.now()/1000);
      el('bot-risk-details').textContent=JSON.stringify(risk,null,2);
      el('bot-health-details').textContent=health.reason+' · Last successful scan age: '+(health.ageSeconds===null?'unknown':Math.floor(health.ageSeconds)+'s')+' · Service uptime not guaranteed; requires an always-on host and external monitoring.';
      const warning=health.healthy?'':health.reason;
      if(el('bot-smart-alerts').checked&&warning&&warning!==lastHealthWarning){
        el('bot-smart-alert-log').textContent='Warning: '+warning+' · '+new Date().toLocaleTimeString();
      }
      lastHealthWarning=warning;
    }
    const waiting=Object.values(s.proposals).filter(p=>p.status==='pending');
    el('bot-pending-count').textContent=String(waiting.length);
    const ids=new Set(waiting.map(p=>String(p.id)));
    if(seenIds!==null&&notifyEnabled&&'Notification' in window&&Notification.permission==='granted'){
      waiting.filter(p=>!seenIds.has(String(p.id))).forEach(p=>{try{const n=new Notification('🐰 BunMoney: Approval needed',{body:p.symbol+' paper trade needs review.',tag:'bunmoney-'+p.id});n.onclick=()=>{window.focus();panel.open=true;showTab('approvals');n.close();};}catch(_){}});
    }
    seenIds=ids;
    const box=el('bot-approvals');box.replaceChildren();
    Object.values(s.proposals).filter(p=>p.status==='pending').forEach(p=>{
      const row=document.createElement('p');row.textContent=`${p.side || 'buy'} ${p.symbol}: reference entry ${money(p.entry)}, stop ${money(p.stop)}, target ${money(p.target)}, risk ${money(p.planned_risk)}. Expires ${new Date(p.expires*1000).toISOString()} `;
      ['approve','reject'].forEach(action=>{const b=document.createElement('button');b.type='button';b.textContent=action;b.dataset.bot=action;b.dataset.proposal=p.id;row.append(b);});box.append(row);
    });
    if(!box.childNodes.length)box.textContent='None';
  }
  async function request(action='refresh',value){
    if(pending && action!=='emergency')return;
    pending++; const requestId=++latestRequest;
    panel.querySelectorAll('button').forEach(b=>b.disabled=b.dataset.bot!=='emergency');
    try{
      const headers={};
      if(typeof engineToken==='string' && engineToken)headers.Authorization=`Bearer ${engineToken}`;
      const options={headers,signal:AbortSignal.timeout(30000)};
      if(action!=='refresh'){options.method='POST';headers['Content-Type']='application/json';options.body=JSON.stringify({action,value});}
      const response=await fetch(`/api/bot/${action==='refresh'?'state':'control'}`,options),data=await response.json();
      if(!response.ok)throw Error(data.error || 'Bot request failed');
      if(requestId===latestRequest)render(data);
    }catch(error){if(requestId===latestRequest)el('bot-message').textContent=error.message;}
    finally{pending--;if(!pending)panel.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  panel.addEventListener('click',e=>{const b=e.target.closest('[data-bot]');if(b)request(b.dataset.bot,b.dataset.bot==='mode'?el('bot-mode').value:b.dataset.bot==='markets'?Array.from(marketOptions.querySelectorAll('input:checked')).map(x=>x.value).join(','):b.dataset.bot==='max-positions'?el('bot-max-positions').value:b.dataset.proposal);});
  panel.addEventListener('toggle',()=>{if(panel.open)request();});
  setInterval(()=>{if(panel.open)request();},15000);
  const style=document.createElement('style');
  style.textContent='.bot-dashboard{background:linear-gradient(145deg,#121d36,#1b2840);border:1px solid #455a82;border-radius:18px;padding:16px;color:#eaf4ff}.bot-dashboard summary{font-size:19px;font-weight:800;color:#a5f3fc}.bot-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:16px 0}.bot-stats>div{padding:15px 10px;border-radius:14px;background:#1d3652;border:1px solid #3c5579;font-size:12px}.bot-stats>div:nth-child(2){background:#19453d}.bot-stats>div:nth-child(3){background:#392452}.bot-stats>div:nth-child(4){background:#4b381d}.bot-stats strong{display:block;margin-top:8px;font-size:20px;overflow-wrap:anywhere}.bot-tabs{display:flex;gap:7px;overflow-x:auto;margin:15px 0}.bot-tabs button{white-space:nowrap;background:#263b59;color:#e4efff;border:1px solid #496386;border-radius:10px;padding:10px}.bot-tabs button.active{background:#6856d9;color:white}.bot-dashboard [data-section]{background:#14243b;border:1px solid #344e6d;padding:14px;border-radius:14px}.bot-dashboard [data-section][hidden]{display:none}.bot-dashboard table{display:block;overflow-x:auto;max-width:100%;font-size:12px}.bot-dashboard pre{white-space:pre-wrap;overflow-wrap:anywhere}.bot-dashboard #bot-notify{background:#6744aa;color:white;padding:10px;border-radius:10px}@media(max-width:650px){.bot-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.bot-dashboard .bot-data-table{display:block;overflow:visible}.bot-dashboard .bot-data-table>tr:first-child{display:none}.bot-dashboard .bot-data-table>tr{display:block;margin:10px 0;padding:10px;border:1px solid #455a82;border-radius:10px}.bot-dashboard .bot-data-table td{display:flex;justify-content:space-between;gap:12px;overflow-wrap:anywhere;border:0;padding:5px 0;text-align:right}.bot-dashboard .bot-data-table td::before{content:attr(data-label);font-weight:700;text-align:left;flex-shrink:0}}}';
  document.head.append(style);
})();
