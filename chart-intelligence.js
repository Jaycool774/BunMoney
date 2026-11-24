(function(){
"use strict";
const $=id=>document.getElementById(id);
const TIMEFRAMES=[
 {id:"now",label:"NOW",interval:"1min",size:21,description:"Immediate price action · latest 20 minutes"},
 {id:"15m",label:"15 MIN",interval:"1min",size:60,description:"Short-term structure · 1-minute candles"},
 {id:"1h",label:"1 HOUR",interval:"5min",size:60,description:"Intraday structure · 5-minute candles"},
 {id:"1y",label:"1 YEAR",interval:"1day",size:365,description:"Long-term structure · daily candles"}
];
const state={symbol:"",cache:new Map(),busy:false,active:"now",timer:null,request:0};
function text(node,value){if(node)node.textContent=value==null?"—":String(value);}
function money(n){return Number.isFinite(Number(n))?"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";}
function tone(value){return value>0?"is-up":value<0?"is-down":"is-flat";}
function ensureUI(){
 if($("chartIntelligenceScreen"))return;
 const nav=document.querySelector(".main-nav"),existing=nav?.querySelector('[data-screen="intelligenceScreen"]');
 if(nav&&existing){const b=document.createElement("button");b.type="button";b.className="nav-button";b.dataset.action="showScreen";b.dataset.screen="chartIntelligenceScreen";b.textContent="📈 Chart Intelligence";existing.insertAdjacentElement("afterend",b);b.addEventListener("click",()=>window.showScreen?.("chartIntelligenceScreen"));}
 const screen=document.createElement("section");screen.id="chartIntelligenceScreen";screen.className="screen ci-screen";screen.setAttribute("aria-label","Chart Intelligence");
 screen.innerHTML='<div class="ci-header"><div><span class="bun-eyebrow">BUNMONEY / CHART INTELLIGENCE</span><h2>📈 Chart Intelligence</h2><p>Automatic chart snapshots and rule-based pattern recognition for the selected market.</p></div><div class="ci-symbol"><label for="ciSymbol">Market</label><input id="ciSymbol" maxlength="30" placeholder="Select from Trading Core"><button id="ciRefresh" type="button">Refresh</button></div></div><p id="ciStatus" class="ci-status" role="status" aria-live="polite">Choose a market in Trading Core, then open Chart Intelligence.</p><div class="ci-timeframes" role="tablist" aria-label="Chart snapshot timeframe"></div><div class="ci-main"><section class="ci-snapshot-panel"><div class="ci-panel-head"><div><span id="ciFrameLabel">NOW</span><h3 id="ciSnapshotTitle">Latest price action</h3><p id="ciFrameDescription">—</p></div><strong id="ciSnapshotPrice">—</strong></div><div class="ci-canvas-wrap"><canvas id="ciCanvas" aria-label="Automatic chart snapshot"></canvas></div><div class="ci-chart-legend"><span><i class="ci-dot ci-green"></i> Price</span><span><i class="ci-dot ci-blue"></i> Support</span><span><i class="ci-dot ci-red"></i> Resistance</span></div></section><section class="ci-pattern-panel"><div class="ci-pattern-head"><div><span class="ci-eyebrow">AUTOMATIC FORMATION DETECTION</span><h3 id="ciPatternName">Waiting for chart data</h3></div><span id="ciPatternStatus" class="ci-status-pill">—</span></div><div class="ci-pattern-stats"><div><small>Direction</small><strong id="ciDirection">—</strong></div><div><small>Confidence</small><strong id="ciConfidence">—</strong></div><div><small>RSI (14)</small><strong id="ciRsi">—</strong></div><div><small>Volume vs avg.</small><strong id="ciVolume">—</strong></div></div><p id="ciPatternReason" class="ci-explanation">Pattern explanation will appear here.</p><div class="ci-scenarios"><article><strong>↗ Bullish scenario</strong><p id="ciBullish">—</p></article><article><strong>↘ Bearish scenario</strong><p id="ciBearish">—</p></article><article><strong>↔ If price stays in range</strong><p id="ciNeutral">—</p></article></div><div class="ci-levels"><div><small>Recent support</small><strong id="ciSupport">—</strong></div><div><small>Recent resistance</small><strong id="ciResistance">—</strong></div></div><p id="ciCaution" class="ci-caution">Pattern recognition is educational and not a guarantee of future price movement.</p></section></div><section class="ci-all-frames"><div class="ci-section-head"><h3>All timeframe snapshots</h3><p>Each snapshot is rendered from the selected symbol's actual market candles.</p></div><div id="ciFrameGrid" class="ci-frame-grid"></div></section>';
 const mi=$("intelligenceScreen");if(mi)mi.insertAdjacentElement("afterend",screen);else document.querySelector("main.screen")?.insertAdjacentElement("afterend",screen);
 const frameBar=screen.querySelector(".ci-timeframes");
 for(const frame of TIMEFRAMES){const b=document.createElement("button");b.type="button";b.dataset.frame=frame.id;b.setAttribute("role","tab");b.textContent=frame.label;b.addEventListener("click",()=>selectFrame(frame.id));frameBar.append(b);}
 $("ciRefresh")?.addEventListener("click",()=>refresh(true));
 $("ciSymbol")?.addEventListener("change",()=>{const v=$("ciSymbol").value.trim().toUpperCase();if(v){state.symbol=v;state.cache.clear();refresh(true);}});
 screen.addEventListener("click",e=>{const card=e.target.closest("[data-ci-card]");if(card)selectFrame(card.dataset.ciCard);});
}
function getSymbol(){return (window.selectedSymbol?.()||$("ticker")?.value||$("symbol")?.textContent||"").trim().toUpperCase();}
function api(path,params){if(typeof window.marketEngineRequest!=="function")throw new Error("Market data service is unavailable.");return window.marketEngineRequest(path,params);}
function setStatus(s){text($("ciStatus"),s);}
function selectFrame(id){state.active=id;document.querySelectorAll("[data-frame]").forEach(b=>b.classList.toggle("active",b.dataset.frame===id));renderActive();}
function canvasDraw(canvas,candles,analysis){
 if(!canvas||!candles.length)return;const dpr=window.devicePixelRatio||1,w=Math.max(320,canvas.clientWidth||600),h=300;canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext("2d");c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
 const pad={l:16,r:72,t:22,b:28},lo=Math.min(...candles.map(x=>x.low),analysis.support),hi=Math.max(...candles.map(x=>x.high),analysis.resistance),range=hi-lo||1;
 const x=i=>pad.l+i/(candles.length-1||1)*(w-pad.l-pad.r),y=v=>pad.t+(hi-v)/range*(h-pad.t-pad.b);
 c.font="11px system-ui";c.strokeStyle="rgba(148,163,184,.15)";c.fillStyle="#94a3b8";
 for(let i=0;i<5;i++){const yy=pad.t+i/4*(h-pad.t-pad.b);c.beginPath();c.moveTo(pad.l,yy);c.lineTo(w-pad.r,yy);c.stroke();const val=hi-i/4*range;c.fillText(money(val),w-pad.r+7,yy+4);}
 for(const [v,label,color] of [[analysis.support,"SUPPORT","#60a5fa"],[analysis.resistance,"RESISTANCE","#fb7185"]]){if(!Number.isFinite(v))continue;c.strokeStyle=color;c.setLineDash([5,4]);c.beginPath();c.moveTo(pad.l,y(v));c.lineTo(w-pad.r,y(v));c.stroke();c.setLineDash([]);c.fillStyle=color;c.fillText(label,w-pad.r+5,y(v)-5);}
 const candleW=Math.max(2,Math.min(9,(w-pad.l-pad.r)/candles.length*.62));
 candles.forEach((bar,i)=>{const xx=x(i),up=bar.close>=bar.open;c.strokeStyle=up?"#84cc16":"#fb7185";c.fillStyle=up?"#84cc16":"#fb7185";c.beginPath();c.moveTo(xx,y(bar.high));c.lineTo(xx,y(bar.low));c.stroke();const top=y(Math.max(bar.open,bar.close)),bottom=y(Math.min(bar.open,bar.close));c.fillRect(xx-candleW/2,top,candleW,Math.max(1,bottom-top));});
 const p=analysis.pattern;c.fillStyle="#e2e8f0";c.font="bold 12px system-ui";c.fillText(p.name+" · "+p.status.toUpperCase(),pad.l,pad.t-7);
}
function renderActive(){
 const frame=TIMEFRAMES.find(x=>x.id===state.active),data=state.cache.get(frame.id);if(!data)return;
 text($("ciFrameLabel"),frame.label);text($("ciSnapshotTitle"),frame.id==="now"?"Latest price action":frame.id==="15m"?"15-minute structure":frame.id==="1h"?"1-hour structure":"1-year structure");text($("ciFrameDescription"),frame.description);text($("ciSnapshotPrice"),money(data.analysis.price));
 const a=data.analysis,p=a.pattern;
 text($("ciPatternName"),p.name);text($("ciPatternStatus"),p.status.toUpperCase());$("ciPatternStatus").className="ci-status-pill "+(p.status==="confirmed"?"is-confirmed":"is-forming");
 text($("ciDirection"),p.direction);$("ciDirection").className=tone(p.direction==="BULLISH"?1:p.direction==="BEARISH"?-1:0);
 text($("ciConfidence"),p.confidence+"% · heuristic");text($("ciRsi"),a.rsi.toFixed(1));text($("ciVolume"),a.volumeRatio==null?"Unavailable":a.volumeRatio.toFixed(2)+"×");
 text($("ciPatternReason"),a.summary);text($("ciBullish"),a.scenarios.bullish);text($("ciBearish"),a.scenarios.bearish);text($("ciNeutral"),a.scenarios.neutral);text($("ciSupport"),money(a.support));text($("ciResistance"),money(a.resistance));text($("ciCaution"),a.caution);
 canvasDraw($("ciCanvas"),data.candles,a);
 document.querySelectorAll("[data-frame]").forEach(b=>b.classList.toggle("active",b.dataset.frame===frame.id));
}
function renderGrid(){
 const grid=$("ciFrameGrid");if(!grid)return;grid.replaceChildren();
 for(const f of TIMEFRAMES){const d=state.cache.get(f.id);const card=document.createElement("button");card.type="button";card.dataset.ciCard=f.id;card.className="ci-frame-card"+(f.id===state.active?" active":"");const head=document.createElement("span"),name=document.createElement("strong"),desc=document.createElement("small"),meta=document.createElement("span");head.textContent=f.label;name.textContent=d?d.analysis.pattern.name:"Loading…";desc.textContent=d?d.analysis.pattern.direction+" · "+d.analysis.pattern.status:f.description;meta.textContent=d?money(d.analysis.price):"—";card.append(head,name,desc,meta);grid.append(card);}
}
async function refresh(force=false){
 if(state.busy)return;const symbol=getSymbol()||state.symbol;if(!symbol){setStatus("Choose a market in Trading Core first.");return;}state.symbol=symbol;const id=++state.request;state.busy=true;text($("ciSymbol"),"");if($("ciSymbol"))$("ciSymbol").value=symbol;
 setStatus("Building four chart snapshots for "+symbol+"…");
 const jobs=TIMEFRAMES.map(async f=>{
  const cached=state.cache.get(f.id);if(!force&&cached&&Date.now()-cached.loadedAt<60000)return;
  const response=await api("/time_series",{symbol,interval:f.interval,outputsize:f.size});
  const candles=window.BunChartIntelligence.normalize(response.values);if(candles.length<20)throw new Error(f.label+": provider returned fewer than 20 valid candles.");
  const quote=Number(window.lastLivePrice)||Number($("price")?.textContent?.replace(/[^0-9.]/g,""))||candles.at(-1).close;
  const analysis=window.BunChartIntelligence.analyze({symbol,candles,currentPrice:quote});
  state.cache.set(f.id,{candles,analysis,loadedAt:Date.now()});
 });
 const results=await Promise.allSettled(jobs);if(id!==state.request)return;
 const failures=results.filter(r=>r.status==="rejected");renderGrid();renderActive();state.busy=false;
 if(failures.length===TIMEFRAMES.length)setStatus("Chart snapshots unavailable: "+failures[0].reason.message);
 else if(failures.length)setStatus("Loaded "+(4-failures.length)+" of 4 snapshots. "+failures.map(x=>x.reason.message).join(" "));
 else setStatus(symbol+" · Four snapshots updated from provider candles · "+new Date().toLocaleTimeString());
}
function onOpen(){const sym=getSymbol();if(sym&&sym!==state.symbol){state.symbol=sym;state.cache.clear();}refresh(false);}
function init(){
 ensureUI();const nav=document.querySelector('[data-screen="chartIntelligenceScreen"]');nav?.addEventListener("click",onOpen);
 document.addEventListener("click",e=>{const b=e.target.closest('[data-action="showScreen"][data-screen="chartIntelligenceScreen"]');if(b)onOpen();});
 window.addEventListener("resize",()=>{if($("chartIntelligenceScreen")?.classList.contains("active"))renderActive();});
 if(state.timer)clearInterval(state.timer);state.timer=setInterval(()=>{if($("chartIntelligenceScreen")?.classList.contains("active"))refresh(false);},60000);
 const ticker=$("ticker");ticker?.addEventListener("change",()=>{if($("chartIntelligenceScreen")?.classList.contains("active")){state.symbol=getSymbol();state.cache.clear();refresh(true);}});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
window.BunChartIntelligenceUI={refresh,selectFrame};
})();