/* Historical, non-executing God Mode signal evaluation.
   Signal at completed candle i, entry at i+1 open, never same-bar fills.
   Conservative stop-first when both barriers touch. Results in R units net of
   modeled 10 bps fee and 5 bps adverse slippage on each side. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BunGodPerformance=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const fee=0.001, slip=0.0005;
  function sma(prices,n,i){
    if(i<n-1) return null;
    let sum=0;for(let j=i-n+1;j<=i;j++)sum+=prices[j];
    return sum/n;
  }
  function evaluate(raw,options={}){
    const horizon=Number.isInteger(options.horizon)&&options.horizon>=1&&options.horizon<=100?options.horizon:12;
    const candles=Array.isArray(raw)?raw.map(c=>({open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})):[];
    if(candles.some(c=>!Number.isFinite(c.open)||!Number.isFinite(c.high)||!Number.isFinite(c.low)||!Number.isFinite(c.close)||c.low<=0||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)))
      return {error:'Invalid historical OHLC data',trades:[],count:0};
    if(candles.length<35)return {error:'At least 35 candles required',trades:[],count:0};
    const closes=candles.map(c=>c.close),trades=[];
    let nextAvailable=20;
    for(let i=20;i<candles.length-1;i++){
      if(i<nextAvailable)continue;
      const previousFast=sma(closes,10,i-1),previousSlow=sma(closes,20,i-1);
      const fast=sma(closes,10,i),slow=sma(closes,20,i);
      const side=previousFast<=previousSlow&&fast>slow&&closes[i]>fast?'BUY':
        previousFast>=previousSlow&&fast<slow&&closes[i]<fast?'SELL':null;
      if(!side)continue;
      const direction=side==='BUY'?1:-1;
      const entryCandle=candles[i+1];
      const entry=entryCandle.open*(1+direction*slip);
      const lookback=candles.slice(Math.max(0,i-9),i+1);
      const stop=direction===1?Math.min(...lookback.map(c=>c.low)):Math.max(...lookback.map(c=>c.high));
      const risk=direction*(entry-stop);
      if(!(risk>0))continue;
      const target=entry+direction*risk*1.5;
      const last=Math.min(candles.length-1,i+horizon);
      let exitPrice=null,exitIndex=last,outcome='time exit';
      for(let j=i+1;j<=last;j++){
        const c=candles[j];
        const stopped=direction===1?c.low<=stop:c.high>=stop;
        const targeted=direction===1?c.high>=target:c.low<=target;
        if(stopped){exitPrice=direction===1?Math.min(stop,c.open):Math.max(stop,c.open);exitIndex=j;outcome='stop';break;}
        if(targeted){exitPrice=target;exitIndex=j;outcome='target';break;}
      }
      if(exitPrice===null)exitPrice=candles[last].close;
      const exit=exitPrice*(1-direction*slip);
      const cost=fee*(entry+exit);
      const netR=(direction*(exit-entry)-cost)/risk;
      trades.push({side,signalIndex:i,entryIndex:i+1,exitIndex,entry,stop,target,exit,netR,outcome});
      nextAvailable=exitIndex+1;
    }
    const wins=trades.filter(t=>t.netR>0),losses=trades.filter(t=>t.netR<0);
    const avg=arr=>arr.length?arr.reduce((s,t)=>s+t.netR,0)/arr.length:null;
    const total=trades.reduce((s,t)=>s+t.netR,0);
    return {count:trades.length,wins:wins.length,losses:losses.length,breakeven:trades.length-wins.length-losses.length,
      winRate:trades.length?100*wins.length/trades.length:null,
      averageR:avg(trades),averageWinR:avg(wins),averageLossR:avg(losses),
      realizedRR:losses.length&&wins.length?avg(wins)/Math.abs(avg(losses)):null,
      totalR:total,assumptions:'Completed SMA10/20 crossovers; next-bar open; 10-bar stop; 1.5R target; 12-bar maximum hold; 10 bps fee and 5 bps adverse slippage each side; stop first on ambiguous bars; non-overlapping trades. Historical simulation only.',trades};
  }
  return {evaluate};
});
