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
    <div id="bot-account"></div><h3>Pending approvals</h3><div id="bot-approvals"></div>
    <h3>Signals (sell signals close held longs; no short selling)</h3><div id="bot-signals"></div><h3>Trade plans</h3><div id="bot-plans"></div>
    <h3>Open position</h3><pre id="bot-position"></pre><h3>Trade history</h3><div id="bot-history"></div>
    <h3>Risk settings and morning report (UTC)</h3><pre id="bot-report"></pre>`;
  (document.querySelector('main') || document.body).append(panel);
  let pending=0,latestRequest=0;
  const el=id=>document.getElementById(id), money=x=>x==null?'unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(x);
  function table(container,rows,keys){
    container.replaceChildren();
    if(!rows.length){container.textContent='None';return;}
    const t=document.createElement('table'),head=document.createElement('tr');
    keys.forEach(key=>{const th=document.createElement('th');th.textContent=key;head.append(th);});t.append(head);
    rows.forEach(row=>{const tr=document.createElement('tr');keys.forEach(key=>{const td=document.createElement('td');td.textContent=typeof row[key]==='number'?String(Math.round(row[key]*1e6)/1e6):String(row[key]??'');tr.append(td);});t.append(tr);});container.append(t);
  }
  function render(s){
    el('bot-mode').value=s.mode;
    el('bot-message').textContent=`${s.status} · ${s.mode} · Data: ${s.data_provider || 'unknown'} (${s.provider_status?.status || 'configured'}) · Emergency ${s.emergency?'ON':'off'} · Last completed cycle ${s.last_cycle?new Date(s.last_cycle*1000).toISOString():'never'}${s.last_error?' · '+s.last_error:''}`;
    el('bot-account').textContent=`Paper cash ${money(s.cash)} · Equity ${money(s.equity)} · Realized P/L ${money(s.realized)} · Unrealized P/L ${money(s.unrealized)} · Daily loss ${money(s.daily_loss_usage)} / ${money(s.day_equity*s.risk.daily_loss_fraction)} · Entries ${s.day_entries}/${s.risk.daily_trades} · Daily shutdown ${s.day_shutdown?'ON':'off'}`;
    el('bot-position').textContent=JSON.stringify(s.position,null,2);
    table(el('bot-history'),s.trades.slice(-50).reverse(),['symbol','entry','exit','qty','pnl','fees','reason']);
    table(el('bot-signals'),Object.values(s.signals).slice(-20).reverse(),['symbol','side','at']);
    table(el('bot-plans'),Object.values(s.proposals).slice(-20).reverse(),['symbol','side','status','entry','stop','target','qty','planned_risk','risk_reward']);
    el('bot-report').textContent=JSON.stringify({settings:s.risk,morning_report:s.report},null,2);
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
  panel.addEventListener('click',e=>{const b=e.target.closest('[data-bot]');if(b)request(b.dataset.bot,b.dataset.bot==='mode'?el('bot-mode').value:b.dataset.proposal);});
  panel.addEventListener('toggle',()=>{if(panel.open)request();});
  setInterval(()=>{if(panel.open)request();},15000);
})();
