const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluate}=require('../godmode-performance.js');
const bar=(price,time)=>({open:price,high:price*1.02,low:price*.98,close:price,datetime:time});
test('insufficient history and invalid OHLC fail closed',()=>{
  assert.match(evaluate(Array.from({length:20},()=>bar(100))).error,/35/);
  const bars=Array.from({length:40},()=>bar(100));
  bars[10].low=110;
  assert.match(evaluate(bars).error,/Invalid/);
});
test('flat market produces no signals or invented win rate',()=>{
  const result=evaluate(Array.from({length:65},()=>bar(100)));
  assert.equal(result.count,0);
  assert.equal(result.winRate,null);
  assert.equal(result.realizedRR,null);
});
test('signal enters on next open and uses no same-bar future information',()=>{
  const prices=[...Array(40).fill(100),110,...Array(25).fill(110)];
  const bars=prices.map(bar);
  const result=evaluate(bars);
  assert.ok(result.count>=1);
  assert.equal(result.trades[0].signalIndex,40);
  assert.equal(result.trades[0].entryIndex,41);
  assert.equal(result.trades[0].entry,110*1.0005);
});
test('ambiguous target and stop bar conservatively chooses stop',()=>{
  const bars=[...Array(40).fill(100),110,...Array(25).fill(110)].map(bar);
  bars[41]={open:110,high:160,low:80,close:110};
  const result=evaluate(bars);
  assert.equal(result.trades[0].outcome,'stop');
  assert.ok(result.trades[0].netR<0);
});
test('appending future bars cannot change already settled trade result',()=>{
  const bars=[...Array(40).fill(100),110,...Array(25).fill(110)].map(bar);
  const original=evaluate(bars).trades[0];
  const expanded=evaluate([...bars,...Array(25).fill(90).map(bar)]).trades[0];
  assert.deepEqual(expanded,original);
});
