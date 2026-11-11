/* Read-only, paper-only dashboard analytics and deterministic market replay. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BunBotInsights=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function num(x){const n=Number(x);return Number.isFinite(n)?n:null;}
  function leaderboard(trades){
    return ['quick','patient'].map(strategy=>{
      const rows=(Array.isArray(trades)?trades:[]).filter(t=>t.strategy===strategy&&num(t.pnl)!==null);
      const wins=rows.filter(t=>t.pnl>0),losses=rows.filter(t=>t.pnl<0);
      const gain=wins.reduce((s,t)=>s+Number(t.pnl),0),loss=-losses.reduce((s,t)=>s+Number(t.pnl),0);
      let cumulative=0,peak=0,drawdown=0;
      for(const t of rows){cumulative+=Number(t.pnl);peak=Math.max(peak,cumulative);drawdown=Math.max(drawdown,peak-cumulative);}
      return {strategy,trades:rows.length,wins:wins.length,winRate:rows.length?100*wins.length/rows.length:null,
        netPnl:gain-loss,profitFactor:loss?gain/loss:null,maxDrawdownDollars:drawdown};
    });
  }
  function risk(state){
    const positions=Array.isArray(state.positions)?state.positions:[];
    const equity=num(state.equity),base=num(state.day_equity),cfg=state.risk||{};
    const openRisk=positions.reduce((s,p)=>s+Math.max(0,num(p.planned_risk)||0),0);
    const dailyUsed=num(state.daily_loss_usage),dailyLimit=base!==null?base*(num(cfg.daily_loss_fraction)||0):null;
    const maxOpen=equity!==null?equity*(num(cfg.max_open_risk_fraction)||0):null;
    const dailyEntries=Number(state.day_entries)||0;
    return {openRisk,openRiskLimit:maxOpen,openRiskRemaining:maxOpen===null?null:Math.max(0,maxOpen-openRisk),
      dailyUsed,dailyLimit,dailyRemaining:dailyLimit===null||dailyUsed===null?null:Math.max(0,dailyLimit-dailyUsed),
      entriesRemaining:Math.max(0,(num(cfg.daily_trades)||0)-dailyEntries),
      overlappingSymbols:[...new Set(positions.map(p=>p.symbol))],status:state.day_shutdown?'Daily shutdown active':'Paper limits only; gap losses can exceed planned risk'};
  }
  function trend(bars){
    if(!Array.isArray(bars)||bars.length<20)return 'Insufficient data';
    const closes=bars.map(c=>num(c.close));
    if(closes.some(x=>x===null||x<=0))return 'Invalid data';
    const mean=n=>closes.slice(-n).reduce((a,b)=>a+b,0)/n;
    const fast=mean(10),slow=mean(20),last=closes.at(-1);
    return last>fast&&fast>slow?'Bullish':last<fast&&fast<slow?'Bearish':'Mixed';
  }
  function replay(bars,visible){
    if(!Array.isArray(bars)||!Number.isInteger(visible)||visible<1)return [];
    return bars.slice(0,Math.min(visible,bars.length)).map(c=>({...c}));
  }
  function health(state,nowSeconds){
    const last=num(state.last_successful_cycle),age=last===null?null:Math.max(0,nowSeconds-last);
    return {ageSeconds:age,healthy:state.status==='running'&&!state.last_error&&age!==null&&age<90,
      reason:state.last_error?'Bot error reported':state.status!=='running'?'Bot is not running':age===null?'No successful scan recorded':age>=90?'Last successful scan is stale':'Recent successful scan'};
  }
  return {leaderboard,risk,trend,replay,health};
});
