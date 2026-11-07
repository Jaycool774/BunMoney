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
    <div class="bot-stats"><div>💰 Equity <strong id="bot-equity">—</strong></div><div>📈 P/L <strong id="bot-profit">—</strong></div><div>🔔 Pending <strong id="bot-pending-count">0</strong></div><div>🛡️ Risk <strong id="bot-risk">—</strong></div></div><nav class="bot-tabs"><button type="button" data-tab="overview">🏠 Overview</button><button type="button" data-tab="approvals">🔔 Approvals</button><button type="button" data-tab="signals">📊 Signals</button><button type="button" data-tab="trades">💼 Trades</button><button type="button" data-tab="settings">⚙️ Settings</button></nav><section data-section="overview"><h3>Account overview</h3><div id="bot-account"></div></section><section data-section="approvals" hidden><h3>Pending approvals</h3><button type="button" id="bot-notify">🔔 Enable browser alerts</button><p id="bot-notify-info">Alerts work while this page is open and connected.</p><div id="bot-approvals"></div>
    </section><section data-section="signals" hidden><h3>Signals (sell signals close held longs; no short selling)</h3><div id="bot-signals"></div><h3>Trade plans</h3><div id="bot-plans"></div>
    </section><section data-section="trades" hidden><h3>Open position</h3><pre id="bot-position"></pre><h3>Trade history</h3><div id="bot-history"></div>
    </section><section data-section="settings" hidden><h3>Risk settings and morning report (UTC)</h3><pre id="bot-report"></pre></section>`;
  (document.getElementById('bunBotMount') || document.querySelector('main') || document.body).append(panel);
  let pending=0,latestRequest=0,notifyEnabled=false,seenIds=null;\n  const marketSymbols=['BTC/USD','ETH/USD','SOL/USD','LTC/USD','DOGE/USD','ADA/USD','XRP/USD','AVAX/USD','LINK/USD'];\n  const marketOptions=document.getElementById('bot-market-options');\n  marketSymbols.forEach(symbol=>{const label=document.createElement('label');label.style.cssText='display:inline-flex;gap:5px;align-items:center;margin:5px 10px 5px 0';const input=document.createElement('input');input.type='checkbox';input.value=symbol;input.checked=['BTC/USD','ETH/USD'].includes(symbol);label.append(input,document.createTextNode(symbol));marketOptions.append(label);});
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
    keys.forEach(key=>{const th=document.createElement('th');th.textContent=key;head.append(th);});t.append(head);
    rows.forEach(row=>{const tr=document.createElement('tr');keys.forEach(key=>{const td=document.createElement('td');td.textContent=key==='at'&&Number.isFinite(Number(row[key]))?new Date(Number(row[key])*1000).toLocaleString():typeof row[key]==='number'?String(Math.round(row[key]*1e6)/1e6):String(row[key]??'');tr.append(td);});t.append(tr);});container.append(t);
  }
  function render(s){
    el('bot-mode').value=s.mode;\n    marketOptions.querySelectorAll('input').forEach(input=>{input.checked=(s.enabled_symbols||['BTC/USD','ETH/USD']).includes(input.value);});\n    el('bot-market-status').textContent='Scanning: '+(s.enabled_symbols||['BTC/USD','ETH/USD']).join(', ')+' · Maximum one open paper position';
    el('bot-message').textContent=`${s.status} · ${s.mode} · Emergency ${s.emergency?'ON':'off'} · Last completed cycle ${s.last_cycle?new Date(s.last_cycle*1000).toISOString():'never'}${s.last_error?' · '+s.last_error:''}`;
    el('bot-account').textContent=`Paper cash ${money(s.cash)} · Equity ${money(s.equity)} · Realized P/L ${money(s.realized)} · Unrealized P/L ${money(s.unrealized)} · Daily loss ${money(s.daily_loss_usage)} / ${money(s.day_equity*s.risk.daily_loss_fraction)} · Entries ${s.day_entries}/${s.risk.daily_trades} · Daily shutdown ${s.day_shutdown?'ON':'off'}`;
    el('bot-position').textContent=s.position?JSON.stringify(s.position,null,2):'No open position';
    el('bot-equity').textContent=money(s.equity);
    const pl=(Number(s.realized)||0)+(Number(s.unrealized)||0);
    el('bot-profit').textContent=money(pl);
    el('bot-profit').style.color=pl<0?'#fda4af':'#86efac';
    el('bot-risk').textContent=money(s.daily_loss_usage)+' / '+money(s.day_equity*s.risk.daily_loss_fraction);
    table(el('bot-history'),s.trades.slice(-50).reverse(),['symbol','entry','exit','qty','pnl','fees','reason']);
    table(el('bot-signals'),Object.values(s.signals).slice(-20).reverse(),['symbol','side','at']);
    table(el('bot-plans'),Object.values(s.proposals).slice(-20).reverse(),['symbol','side','status','entry','stop','target','qty','planned_risk','risk_reward']);
    el('bot-report').textContent=JSON.stringify({settings:s.risk,morning_report:s.report},null,2);
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
  panel.addEventListener('click',e=>{const b=e.target.closest('[data-bot]');if(b)request(b.dataset.bot,b.dataset.bot==='mode'?el('bot-mode').value:b.dataset.bot==='markets'?Array.from(marketOptions.querySelectorAll('input:checked')).map(x=>x.value).join(','):b.dataset.proposal);});
  panel.addEventListener('toggle',()=>{if(panel.open)request();});
  setInterval(()=>{if(panel.open)request();},15000);
  const style=document.createElement('style');
  style.textContent='.bot-dashboard{background:linear-gradient(145deg,#121d36,#1b2840);border:1px solid #455a82;border-radius:18px;padding:16px;color:#eaf4ff}.bot-dashboard summary{font-size:19px;font-weight:800;color:#a5f3fc}.bot-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:16px 0}.bot-stats>div{padding:15px 10px;border-radius:14px;background:#1d3652;border:1px solid #3c5579;font-size:12px}.bot-stats>div:nth-child(2){background:#19453d}.bot-stats>div:nth-child(3){background:#392452}.bot-stats>div:nth-child(4){background:#4b381d}.bot-stats strong{display:block;margin-top:8px;font-size:20px;overflow-wrap:anywhere}.bot-tabs{display:flex;gap:7px;overflow-x:auto;margin:15px 0}.bot-tabs button{white-space:nowrap;background:#263b59;color:#e4efff;border:1px solid #496386;border-radius:10px;padding:10px}.bot-tabs button.active{background:#6856d9;color:white}.bot-dashboard [data-section]{background:#14243b;border:1px solid #344e6d;padding:14px;border-radius:14px}.bot-dashboard [data-section][hidden]{display:none}.bot-dashboard table{display:block;overflow-x:auto;max-width:100%;font-size:12px}.bot-dashboard pre{white-space:pre-wrap;overflow-wrap:anywhere}.bot-dashboard #bot-notify{background:#6744aa;color:white;padding:10px;border-radius:10px}@media(max-width:650px){.bot-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}';
  document.head.append(style);
})();
