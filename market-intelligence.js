(function(){
"use strict";
const engine = window.BunMarketIntelligence;
if (!engine) return;
const $ = id => document.getElementById(id);
const state = {symbol:"BTC/USD",windowMinutes:15,target:"",samples:[],result:null,refreshing:false,timer:null,history:loadHistory()};
function loadHistory(){try{const v=JSON.parse(localStorage.getItem("bunmoney_mi_history")||"[]");return Array.isArray(v)?v.slice(-100):[];}catch{return [];}}
function saveHistory(){try{localStorage.setItem("bunmoney_mi_history",JSON.stringify(state.history.slice(-100)));}catch{}}
function money(n){return Number.isFinite(Number(n))?"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";}
function pct(n){return Number.isFinite(n)?(n>0?"+":"")+n.toFixed(3)+"%":"—";}
function duration(ms){const s=Math.max(0,Math.floor(ms/1000));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
function status(s){$("miStatus").textContent=s;}
function api(path,params){return marketEngineRequest(path,params);}
function render(r){
 state.result=r;
 $("miPrice").textContent=money(r.price);
 $("miChange").textContent=pct(r.momentum.fifteenMinute)+" / 15m";
 $("miWindowOpen").textContent=money(r.window.open);
 $("miWindowDistance").textContent=r.window.distanceFromOpen==null?"—":money(r.window.distanceFromOpen)+" ("+pct(r.window.distanceFromOpenPct)+")";
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
 $("miMom1").textContent=pct(r.momentum.oneMinute);
 $("miMom5").textContent=pct(r.momentum.fiveMinute);
 $("miMom15").textContent=pct(r.momentum.fifteenMinute);
 $("miMom30").textContent=pct(r.momentum.thirtyMinute);
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
async function refresh(){
 if(state.refreshing)return;state.refreshing=true;status("Loading "+state.symbol+" live quote and 30-day history…");
 try{
  const [quote,one,quarter]=await Promise.all([
   api("/price",{symbol:state.symbol}),
   api("/time_series",{symbol:state.symbol,interval:"1min",outputsize:300}),
   api("/time_series",{symbol:state.symbol,interval:"15min",outputsize:2880})
  ]);
  const price=Number(quote.price);if(!Number.isFinite(price)||price<=0)throw new Error("Provider returned an invalid quote.");
  const now=Date.now();state.samples=state.samples.filter(s=>now-s.time<=60000);state.samples.push({time:now,price});
  settleForecasts(price,now);
  const r=engine.calculate({symbol:state.symbol,currentPrice:price,candles1m:one.values,candles15m:quarter.values,target:state.target,windowMinutes:state.windowMinutes,now,samples:state.samples});
  render(r);status("Updated "+new Date(now).toLocaleTimeString()+" · "+(demoMarketEnabled?"DEMO DATA":"Provider data")+" · "+r.data.fifteenMinuteBars+" historical bars.");
 }catch(e){status(e.message||"Market intelligence update failed.");}
 finally{state.refreshing=false;}
}
function recordForecast(){
 const r=state.result;if(!r||!r.moveNeeded){status("Enter a target and refresh before recording a forecast.");return;}
 if(state.history.some(x=>x.windowStart===r.window.start&&x.symbol===state.symbol)){status("A forecast is already recorded for this market window.");return;}
 const f={id:state.symbol+":"+r.window.start,symbol:state.symbol,target:r.target,direction:r.moveNeeded.direction,probability:r.historical.targetHitRate,windowStart:r.window.start,windowEnd:r.window.end,createdAt:Date.now(),outcome:null,correct:null};
 state.history.push(f);state.history=state.history.slice(-100);saveHistory();render(r);status("Forecast recorded. It will be checked after the 15-minute window closes.");
}
function bind(){
 document.querySelectorAll("[data-mi-asset]").forEach(b=>b.addEventListener("click",()=>{state.symbol=b.dataset.miAsset;document.querySelectorAll("[data-mi-asset]").forEach(x=>x.classList.toggle("active",x===b));refresh();}));
 $("miWindow").addEventListener("change",e=>{state.windowMinutes=Number(e.target.value)||15;refresh();});
 $("miTarget").addEventListener("change",e=>{state.target=e.target.value.trim();refresh();});
 $("miRefresh").addEventListener("click",refresh);
 $("miRecord").addEventListener("click",recordForecast);
 document.querySelector('[data-screen="intelligenceScreen"]')?.addEventListener("click",()=>{if(!state.timer)state.timer=setInterval(()=>{if($("intelligenceScreen")?.classList.contains("active"))refresh();},15000);refresh();});
}
bind();
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",refresh,{once:true});else refresh();
})();