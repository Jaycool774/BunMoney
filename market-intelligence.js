(function(){
"use strict";
const engine=window.BunMarketIntelligence;
if(!engine)return;
const $=id=>document.getElementById(id);
const state={symbol:"BTC/USD",windowMinutes:15,target:"",samples:[],result:null,refreshing:false,timer:null,countdownTimer:null,history:loadHistory(),historyCache:new Map()};
const HISTORY_TTL=5*60*1000;
function loadHistory(){try{const v=JSON.parse(localStorage.getItem("bunmoney_mi_history")||"[]");return Array.isArray(v)?v.slice(-100):[];}catch{return [];}}
function saveHistory(){try{localStorage.setItem("bunmoney_mi_history",JSON.stringify(state.history.slice(-100)));}catch{}}
function money(n){return n==null||n===""?"—":Number.isFinite(Number(n))?"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";}
function pct(n){return Number.isFinite(n)?(n>0?"+":"")+n.toFixed(3)+"%":"—";}
function duration(ms){const s=Math.max(0,Math.floor(ms/1000));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
function status(s){if($("miStatus"))$("miStatus").textContent=s;}
function api(path,params){return marketEngineRequest(path,params);}
function tone(node,value){if(!node)return;node.classList.remove("mi-up","mi-down","mi-warn");node.classList.add(value>0?"mi-up":value<0?"mi-down":"mi-warn");}
function render(r){
 state.result=r;
 $("miPrice").textContent=money(r.price);
 $("miChange").textContent=pct(r.momentum.fifteenMinute)+" / 15m";
 tone($("miChange"),r.momentum.fifteenMinute);
 $("miWindowOpen").textContent=money(r.window.open);
 $("miWindowDistance").textContent=r.window.distanceFromOpen==null?"—":money(r.window.distanceFromOpen)+" ("+pct(r.window.distanceFromOpenPct)+")";
 tone($("miWindowDistance"),r.window.distanceFromOpenPct);
 $("miCountdown").textContent=duration(r.window.remainingMs);
 $("miMoveAmount").textContent=r.moveNeeded?money(r.moveNeeded.amount):"Set a target";
 $("miMovePercent").textContent=r.moveNeeded?Math.abs(r.moveNeeded.percent).toFixed(4)+"% "+r.moveNeeded.direction:"—";
 $("miTargetHit").textContent=r.historical.targetHitRate==null?"Set target":r.historical.targetHitRate.toFixed(1)+"%";
 $("miTargetSamples").textContent=r.historical.sampleCount+" historical 15m windows";
 $("miTargetBar").style.width=(r.historical.targetHitRate??0)+"%";
 $("miSettlementAvg").textContent=money(r.settlement.sampledAverage60s);
 $("miSettlementCount").textContent=r.settlement.sampleCount+" samples in last 60s";
 $("miSettlementMethod").textContent=r.settlement.method;
 $("miVol1").textContent=pct(r.volatility.oneMinute.averageAbs);
 $("miVol5").textContent=pct(r.volatility.fiveMinute.averageAbs);
 $("miVol15").textContent=pct(r.volatility.fifteenMinute.averageAbs);
 $("miVol30").textContent=pct(r.volatility.thirtyDayAverageAbs15m);
 $("miMom1").textContent=pct(r.momentum.oneMinute);tone($("miMom1"),r.momentum.oneMinute);
 $("miMom5").textContent=pct(r.momentum.fiveMinute);tone($("miMom5"),r.momentum.fiveMinute);
 $("miMom15").textContent=pct(r.momentum.fifteenMinute);tone($("miMom15"),r.momentum.fifteenMinute);
 $("miMom30").textContent=pct(r.momentum.thirtyMinute);tone($("miMom30"),r.momentum.thirtyMinute);
 $("miRsi").textContent=Number.isFinite(r.momentum.rsi14)?r.momentum.rsi14.toFixed(1):"—";
 $("miHistUp").textContent=Number.isFinite(r.historical.positive15mRate)?r.historical.positive15mRate.toFixed(1)+"%":"—";
 $("miHistRange").textContent=Number.isFinite(r.historical.min15m)?pct(r.historical.min15m)+" to "+pct(r.historical.max15m):"—";
 $("miBars").textContent=r.data.fifteenMinuteBars+" 15m bars · "+r.data.oneMinuteBars+" 1m bars";
 $("miAccuracy").textContent=accuracyText();
 $("miForecasts").innerHTML=historyMarkup();
}
function accuracyText(){const done=state.history.filter(x=>x.outcome);if(!done.length)return "No settled forecasts yet.";const correct=done.filter(x=>x.correct).length;return correct+"/"+done.length+" correct ("+(correct/done.length*100).toFixed(1)+"%)";}
function historyMarkup(){if(!state.history.length)return '<div class="mi-empty">No recorded forecasts yet. Set a target and record a forecast.</div>';return state.history.slice(-8).reverse().map(x=>'<div class="mi-history-row"><span>'+x.symbol+' · '+x.direction+' · '+new Date(x.createdAt).toLocaleString()+'</span><strong>'+(x.outcome?(x.correct?'Correct':'Incorrect'):'Pending')+'</strong></div>').join("");}
function settleForecasts(price,now){let changed=false;for(const f of state.history){if(!f.outcome&&now>=f.windowEnd){f.outcome=price>=f.target?"ABOVE":"BELOW";f.correct=f.direction==="UP"?price>=f.target:price<f.target;f.settledAt=now;changed=true;}}if(changed)saveHistory();}
async function refresh(forceHistory=false){
 if(state.refreshing)return;
 state.refreshing=true;
 const symbol=state.symbol,now=Date.now();
 const cached=state.historyCache.get(symbol);
 const needsHistory=forceHistory||!cached||now-cached.loadedAt>=HISTORY_TTL;
 status("Refreshing "+symbol+" quote"+(needsHistory?" and historical candles…":"…"));
 try{
  const quotePromise=api("/price",{symbol});
  const historyPromise=needsHistory?Promise.all([
   api("/time_series",{symbol,interval:"1min",outputsize:300}),
   api("/time_series",{symbol,interval:"15min",outputsize:2880})
  ]):Promise.resolve(cached);
  const [quote,history]=await Promise.all([quotePromise,historyPromise]);
  if(symbol!==state.symbol)return;
  const hist=needsHistory?{one:history[0],quarter:history[1],loadedAt:Date.now()}:history;
  if(needsHistory)state.historyCache.set(symbol,hist);
  const price=Number(quote.price);
  if(!Number.isFinite(price)||price<=0)throw new Error("Provider returned an invalid quote.");
  const stamp=Date.now();state.samples=state.samples.filter(s=>stamp-s.time<=60000);state.samples.push({time:stamp,price});
  settleForecasts(price,stamp);
  const target=Number(state.target);
  const r=engine.calculate({symbol,currentPrice:price,candles1m:hist.one.values,candles15m:hist.quarter.values,target:state.target,windowMinutes:state.windowMinutes,now:stamp,samples:state.samples});
  render(r);
  status("Quote updated "+new Date(stamp).toLocaleTimeString()+" · "+(demoMarketEnabled?"DEMO DATA":"Provider data")+" · Historical candles refreshed "+(needsHistory?"now":"from 5-minute cache")+".");
 }catch(e){status(e.message||"Market intelligence update failed.");}
 finally{state.refreshing=false;if(symbol!==state.symbol)refresh(false);}
}
function tickCountdown(){
 const r=state.result;if(!r)return;
 const remaining=Math.max(0,r.window.end-Date.now());
 $("miCountdown").textContent=duration(remaining);
}
function recordForecast(){
 const r=state.result;if(!r||!r.moveNeeded){status("Enter a target and refresh before recording a forecast.");return;}if(r.window.end-Date.now()<=0){status("This 15-minute window has closed. Wait for the next window before recording.");return;}
 if(state.history.some(x=>x.windowStart===r.window.start&&x.symbol===state.symbol)){status("A forecast is already recorded for this market window.");return;}
 const f={id:state.symbol+":"+r.window.start,symbol:state.symbol,target:r.target,direction:r.moveNeeded.direction,probability:r.historical.targetHitRate,windowStart:r.window.start,windowEnd:r.window.end,createdAt:Date.now(),outcome:null,correct:null};
 state.history.push(f);state.history=state.history.slice(-100);saveHistory();render(r);status("Forecast recorded. It will be checked after the 15-minute window closes.");
}
function startAutoRefresh(){
 if(!state.timer)state.timer=setInterval(()=>{
  const home=$("home")?.classList.contains("active"),intel=$("intelligenceScreen")?.classList.contains("active");
  if(home||intel)refresh(false);
 },15000);
 if(!state.countdownTimer)state.countdownTimer=setInterval(tickCountdown,1000);
}
function bind(){
 document.querySelectorAll("[data-mi-asset]").forEach(b=>b.addEventListener("click",()=>{state.symbol=b.dataset.miAsset;state.samples=[];document.querySelectorAll("[data-mi-asset]").forEach(x=>x.classList.toggle("active",x===b));refresh(false);}));
 $("miWindow").addEventListener("change",e=>{state.windowMinutes=Number(e.target.value)||15;refresh(false);});
 $("miTarget").addEventListener("input",e=>{state.target=e.target.value.trim();if(state.result){try{const r=engine.calculate({symbol:state.symbol,currentPrice:state.result.price,candles1m:state.historyCache.get(state.symbol)?.one.values||[],candles15m:state.historyCache.get(state.symbol)?.quarter.values||[],target:state.target,windowMinutes:state.windowMinutes,now:Date.now(),samples:state.samples});render(r);}catch{}}});
 $("miRefresh").addEventListener("click",()=>refresh(false));
 $("miRecord").addEventListener("click",recordForecast);
 document.querySelector('[data-screen="intelligenceScreen"]')?.addEventListener("click",()=>{startAutoRefresh();refresh(false);});
 document.querySelector('[data-screen="home"]')?.addEventListener("click",startAutoRefresh);
 startAutoRefresh();
 if($("home")?.classList.contains("active"))refresh(false);
}
bind();
status("Loading BTC and ETH market intelligence…");
})();