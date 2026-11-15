const test=require('node:test');
const assert=require('node:assert/strict');
const x=require('../bot-insights.js');
test('leaderboard separates strategies and preserves no-trade nulls',()=>{
  const rows=[{strategy:'quick',pnl:8},{strategy:'quick',pnl:-3},{strategy:'patient',pnl:-2}];
  const [quick,patient]=x.leaderboard(rows);
  assert.equal(quick.trades,2);assert.equal(quick.netPnl,5);
  assert.equal(quick.profitFactor,8/3);
  assert.equal(patient.trades,1);assert.equal(patient.winRate,0);
  assert.equal(x.leaderboard([])[0].winRate,null);
});
test('risk calculations respect shared open and daily limits',()=>{
  const state={positions:[{symbol:'BTC/USD',planned_risk:5},{symbol:'ETH/USD',planned_risk:4}],equity:1000,day_equity:1000,daily_loss_usage:7,day_entries:1,
    risk:{daily_loss_fraction:.02,max_open_risk_fraction:.025,daily_trades:3}};
  const r=x.risk(state);
  assert.equal(r.openRisk,9);assert.equal(r.openRiskRemaining,16);
  assert.equal(r.dailyRemaining,13);assert.equal(r.entriesRemaining,2);
});
test('replay never returns unseen candles',()=>{
  const bars=[{close:1},{close:2},{close:3}];
  assert.deepEqual(x.replay(bars,1),[{close:1}]);
  const view=x.replay(bars,2);view[0].close=99;
  assert.equal(bars[0].close,1);
});
test('trend reports missing and mixed data instead of guessing',()=>{
  assert.equal(x.trend([]),'Insufficient data');
  assert.equal(x.trend(Array.from({length:20},()=>({close:100}))),'Mixed');
  assert.equal(x.trend(Array.from({length:20},(_,i)=>({close:i+100}))),'Bullish');
});
test('health is not 24/7 guarantee and detects stale cycles',()=>{
  assert.equal(x.health({status:'running',last_successful_cycle:100,last_error:null},150).healthy,true);
  assert.equal(x.health({status:'running',last_successful_cycle:100,last_error:null},250).healthy,false);
  assert.equal(x.health({status:'paused',last_successful_cycle:100,last_error:null},150).healthy,false);
});

test('unknown equity and heartbeat are unavailable, never zero or healthy',()=>{
  const risk=x.risk({positions:[],equity:null,day_equity:null,daily_loss_usage:null,risk:{daily_loss_fraction:.02,max_open_risk_fraction:.025,daily_trades:3}});
  assert.equal(risk.openRiskLimit,null);
  assert.equal(risk.dailyRemaining,null);
  const health=x.health({status:'running',last_successful_cycle:null,last_error:null},200);
  assert.equal(health.ageSeconds,null);
  assert.equal(health.healthy,false);
});
