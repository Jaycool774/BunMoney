/* BunMoney market experience: focused navigation, compact watchlist and chart UX.
   All market actions remain observational or paper-only. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const safeText = (node, value) => { if (node) node.textContent = value; };
  const fmtMoney = (n) => Number.isFinite(Number(n)) ? "$" + Number(n).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2}) : "—";
  const fmtPct = (n) => Number.isFinite(Number(n)) ? (Number(n) > 0 ? "+" : "") + Number(n).toFixed(2) + "%" : "—";
  const markets = [
    ["BTC/USD","Bitcoin"],["ETH/USD","Ethereum"],["SOL/USD","Solana"],["XRP/USD","XRP"],
    ["AAPL","Apple"],["MSFT","Microsoft"],["NVDA","NVIDIA"],["TSLA","Tesla"],
    ["AMZN","Amazon"],["GOOGL","Alphabet"],["META","Meta"],["AMD","AMD"],
    ["SOUN","SoundHound AI"],["PLTR","Palantir"],["BBAI","BigBear.ai"],["GRAB","Grab"],
    ["EUR/USD","Euro / US Dollar"],["GBP/USD","British Pound / US Dollar"],["USD/JPY","US Dollar / Japanese Yen"],
    ["AUD/USD","Australian Dollar / US Dollar"],["USD/CAD","US Dollar / Canadian Dollar"],
    ["XAU/USD","Gold / US Dollar"],["XAG/USD","Silver / US Dollar"]
  ];
  let modal, modalTitle, modalBody, modalTools, modalSearch;
  let chartMode = "candles";
  let lastPrice = null;
  let drawFrame = 0;
  let queuedDraw = null;
  let originalDraw = null;
  let originalAcceptPrice = null;
  let countdownTimer = null;
  let snapshotTimer = null;

  function ensureModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.id = "bmExperienceModal";
    modal.className = "bm-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<div class="bm-modal-backdrop" data-bm-close></div><section class="bm-modal-panel" role="dialog" aria-modal="true" aria-labelledby="bmModalTitle"><header class="bm-modal-head"><div><span class="bm-modal-eyebrow">BUNMONEY / QUICK VIEW</span><h2 id="bmModalTitle">Markets</h2></div><button type="button" class="bm-modal-close" aria-label="Close" data-bm-close>×</button></header><div id="bmModalTools" class="bm-modal-tools"></div><div id="bmModalBody" class="bm-modal-body"></div></section>';
    document.body.append(modal);
    modalTitle = $("bmModalTitle");
    modalBody = $("bmModalBody");
    modalTools = $("bmModalTools");
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-bm-close]")) closeModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("open")) closeModal();
    });
  }
  function restoreScannerNodes(){
    const guide=$("bun-scanner-guide"),status=$("bun-scanner-status"),output=$("bun-scanner-results");
    if(guide&&status&&output){guide.append(status,output);}
  }
  function openModal(title) {
    ensureModal();
    restoreScannerNodes();
    safeText(modalTitle, title);
    modalTools.replaceChildren();
    modalBody.replaceChildren();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("bm-modal-open");
  }
  function closeModal() {
    if (!modal) return;
    restoreScannerNodes();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("bm-modal-open");
  }
  function createSearchBox() {
    const wrap = document.createElement("div");
    wrap.className = "bm-market-search";
    const input = document.createElement("input");
    input.type = "search"; input.id = "bmMarketSearch"; input.placeholder = "Search ticker, crypto, forex or metal…";
    input.autocomplete = "off"; input.setAttribute("aria-label", "Search markets");
    const results = document.createElement("div");
    results.className = "bm-market-results"; results.id = "bmMarketResults";
    wrap.append(input, results);
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const matches = markets.filter(([symbol,name]) => !q || symbol.toLowerCase().includes(q) || name.toLowerCase().includes(q)).slice(0,12);
      results.replaceChildren();
      if (!matches.length) { const empty=document.createElement("p");empty.className="bm-empty";empty.textContent="No suggested match. You can still enter a valid provider symbol in Analyze.";results.append(empty);return; }
      for (const [symbol,name] of matches) {
        const button=document.createElement("button");button.type="button";button.className="bm-market-option";
        const left=document.createElement("span");left.innerHTML='<strong></strong><small></small>';
        left.querySelector("strong").textContent=symbol;left.querySelector("small").textContent=name;
        const action=document.createElement("span");action.textContent="Analyze →";
        button.append(left,action);
        button.addEventListener("click",()=>{const ticker=$("ticker");if(ticker)ticker.value=symbol;closeModal();if(typeof showScreen==="function")showScreen("home");if(typeof analyze==="function")analyze(true);});
        results.append(button);
      }
    };
    input.addEventListener("input",render);
    modalTools.append(wrap);
    render();
    input.focus();
  }
  function openMarkets() { openModal("Find a market"); createSearchBox(); }
  function openMovers(mode="movers",directionFilter="all") {
    openModal(mode==="movers"?"Top movers":mode.replace(/\b\w/g,x=>x.toUpperCase()));
    const status=$("bun-scanner-status"), output=$("bun-scanner-results");
    if (status && output) {
      modalBody.append(status,output);
      status.textContent="Preparing watchlist scan…";
      const filter=document.createElement("input");filter.type="search";filter.className="bm-result-filter";filter.placeholder="Filter scan results…";filter.setAttribute("aria-label","Filter scan results");
      modalTools.append(filter);
      filter.addEventListener("input",()=>{for(const card of output.children){const matches=card.textContent.toLowerCase().includes(filter.value.toLowerCase());const move=card.textContent.match(/20-bar change\s+([+-]?\d+(?:\.\d+)?)%/i);const value=move?Number(move[1]):null;const directionOk=directionFilter==="all"||(directionFilter==="up"&&value!==null&&value>=0)||(directionFilter==="down"&&value!==null&&value<0);card.hidden=!(matches&&directionOk);}});
      if (typeof runBunScanner==="function") Promise.resolve(runBunScanner(mode)).then(()=>filter.dispatchEvent(new Event("input")));
      else status.textContent="Scanner module is unavailable. Refresh BunMoney and try again.";
    } else {
      const msg=document.createElement("p");msg.className="bm-empty";msg.textContent="Scanner results are unavailable on this build.";modalBody.append(msg);
    }
  }
  function openFavorites() {
    openModal("Favorites");
    const list=document.createElement("div");list.className="bm-favorite-grid";modalBody.append(list);
    const symbols=typeof bunFavorites!=="undefined"?bunFavorites:[];
    if (!symbols.length) {const empty=document.createElement("p");empty.className="bm-empty";empty.textContent="No favorites yet. Add markets from the Markets search.";list.append(empty);return;}
    for(const symbol of symbols){
      const cached=typeof favoriteDetailsCache!=="undefined"?favoriteDetailsCache.get(symbol):null;
      const card=document.createElement("button");card.type="button";card.className="bm-favorite-mini";
      const name=document.createElement("strong");name.textContent=symbol;
      const price=document.createElement("span");price.className="bm-fav-price";price.dataset.favPrice=symbol;price.textContent=fmtMoney(cached?.price);
      const move=document.createElement("span");move.className="bm-fav-move";move.dataset.favMove=symbol;
      const amount=Number(cached?.changeAmount),pct=Number(cached?.change);
      if(Number.isFinite(amount)&&Number.isFinite(pct)){
        const up=amount>=0;move.classList.add(up?"is-up":"is-down");
        move.textContent=(up?"+":"-")+fmtMoney(Math.abs(amount))+"  "+fmtPct(pct);
      }else{move.textContent="Waiting for quote";}
      const trend=document.createElement("small");trend.dataset.favTrend=symbol;trend.textContent=(cached?.trend||"Waiting for trend")+" · "+(cached?.setup||"No setup yet");
      card.append(name,price,move,trend);
      card.addEventListener("click",()=>{closeModal();if(typeof openFavorite==="function")openFavorite(symbol);});
      list.append(card);
    }
    const hint=document.createElement("p");hint.className="bm-modal-note";hint.textContent="Mini cards use the latest saved 5-minute snapshot. Provider refresh timing and market hours affect freshness.";modalBody.append(hint);
    if(typeof updateFavorites==="function")updateFavorites(false);
  }
  function openMiniMoverSearch() {
    openModal("Movers");
    const search=document.createElement("input");search.type="search";search.placeholder="What are you looking for? e.g. gainers, losers, SOUN…";search.className="bm-result-filter";modalTools.append(search);
    const actions=document.createElement("div");actions.className="bm-mover-filters";
    for(const [label,mode,direction] of [["All movers","movers","all"],["Top gainers","movers","up"],["Top losers","movers","down"],["Breakouts","breakouts","all"],["High volatility","volatility","all"],["Market leaders","leaders","all"],["Potential gems","gems","all"]]){
      const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",()=>openMovers(mode,direction));actions.append(button);
    }
    modalBody.append(actions);
    const note=document.createElement("p");note.className="bm-empty";note.textContent="Choose a scan to rank your saved favorites, then filter the results by ticker or details.";modalBody.append(note);
    search.addEventListener("input",()=>{const q=search.value.trim().toLowerCase();for(const button of actions.children)button.hidden=!button.textContent.toLowerCase().includes(q);note.textContent=q?"Showing scan types matching “"+search.value+"”.":"Choose a scan to rank your saved favorites, then filter the results by ticker or details.";});
    search.focus();
  }
  function installNavigation() {
    document.addEventListener("click",(event)=>{
      const shortcut=event.target.closest(".bun-shortcuts a");
      if(shortcut){
        const href=shortcut.getAttribute("href");
        if(href==="#homeSearch"){event.preventDefault();event.stopImmediatePropagation();openMarkets();return;}
        if(href==="#spikeBoard"){event.preventDefault();event.stopImmediatePropagation();openMiniMoverSearch();return;}
      }
      const scan=event.target.closest("[data-scanner-mode]");
      if(scan){event.preventDefault();event.stopImmediatePropagation();openMovers(scan.dataset.scannerMode);return;}
      const favNav=event.target.closest('.nav-button[data-screen="favoritesScreen"]');
      if(favNav){event.preventDefault();event.stopImmediatePropagation();openFavorites();return;}
      const preset=event.target.closest("#bun-market-presets button");
      if(preset){
        event.preventDefault();event.stopImmediatePropagation();
        const symbol=(preset.textContent||"").replace(/^\+\s*/,"").trim().toUpperCase();
        if(symbol&&typeof addFavorite==="function"){
          if(typeof bunFavorites!=="undefined"&&bunFavorites.includes(symbol)){if(typeof openFavorite==="function")openFavorite(symbol);return;}
          preset.disabled=true;
          addFavorite(symbol).then(()=>{if(typeof openFavorite==="function"&&typeof bunFavorites!=="undefined"&&bunFavorites.includes(symbol)){closeModal();openFavorite(symbol);}else if(typeof showPopup==="function"){showPopup("Market unavailable","The data provider could not verify "+symbol+". Check the symbol, provider plan and market hours.");}}).catch(()=>{}).finally(()=>{preset.disabled=false;});
        }
      }
    },true);
  }
  function updateTone(node, direction) {
    if(!node)return;
    node.classList.remove("bm-up","bm-down","bm-flat");
    node.classList.add(direction>0?"bm-up":direction<0?"bm-down":"bm-flat");
  }
  function installPriceTone() {
    if(typeof window.acceptPrice==="function"&&!window.bmAcceptPriceWrapped){
      originalAcceptPrice=window.acceptPrice;
      window.acceptPrice=function(symbol,price,time){
        const before=symbol===((typeof selectedSymbol==="function")?selectedSymbol():"")?Number(window.lastLivePrice):NaN;
        originalAcceptPrice(symbol,price,time);
        if(symbol===((typeof selectedSymbol==="function")?selectedSymbol():"")){
          const direction=Number(price)>before?1:Number(price)<before?-1:0;
          updateTone($("price"),direction);updateTone($("change"),direction);
        }
      };
      window.bmAcceptPriceWrapped=true;
    }
    const colorize=()=>{
      for(const id of ["miChange","miMom1","miMom5","miMom15","miMom30","miWindowDistance"]){
        const node=$(id);if(!node)continue;
        const value=node.textContent.trim();
        updateTone(node,value.startsWith("+")?1:value.startsWith("-")?-1:0);
      }
    };
    const observer=new MutationObserver(colorize);
    for(const id of ["miChange","miMom1","miMom5","miMom15","miMom30","miWindowDistance"]){const node=$(id);if(node)observer.observe(node,{childList:true,characterData:true,subtree:true});}
    colorize();
  }
  function timeframeMs() {
    const map={"1min":60000,"5min":300000,"15min":900000,"1h":3600000,"4h":14400000,"1day":86400000,"1week":604800000,"1month":2592000000,"max":2592000000};
    return map[typeof selectedTimeframe!=="undefined"?selectedTimeframe:"5min"]||300000;
  }
  function explainMovement() {
    const a=typeof lastAnalysis!=="undefined"?lastAnalysis:null;
    if(!a)return "Analyze a market to see the factors behind its latest move.";
    const parts=[];
    if(a.trend)parts.push(a.trend.toLowerCase()+" trend");
    if(Number.isFinite(Number(a.volumeRatio)))parts.push("volume "+Number(a.volumeRatio).toFixed(2)+"× average");
    if(a.breakout&&a.breakout!=="NO CONFIRMATION")parts.push(a.breakout.toLowerCase());
    if(a.retest&&a.retest!=="WAITING")parts.push(a.retest.toLowerCase());
    if(Number.isFinite(Number(a.rsi)))parts.push("RSI "+Number(a.rsi).toFixed(1));
    return parts.length?"Observed factors: "+parts.join(" · ")+". These describe the chart; they do not prove what caused the move.":"No strong directional factors detected in the latest analysis.";
  }
  function drawZigzag(args) {
    const [candles,support,resistance,entry,stop,target]=args;
    const canvas=$("chart");if(!canvas||!Array.isArray(candles)||!candles.length)return;
    const width=canvas.clientWidth||350,height=canvas.clientHeight||340,dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const zoom=Number($("zoomSlider")?.value||25),visible=candles.slice(-Math.min(zoom,candles.length));
    const values=visible.map(c=>Number(c.close)).filter(Number.isFinite);
    const levels=[...values,Number(support),Number(resistance),Number(entry),Number(stop),Number(target)].filter(Number.isFinite);
    const min=Math.min(...levels),max=Math.max(...levels),range=max-min||1,pad=24;
    const x=i=>pad+i/Math.max(1,values.length-1)*(width-pad*2),y=v=>height-pad-(v-min)/range*(height-pad*2);
    ctx.strokeStyle="rgba(255,255,255,.07)";ctx.lineWidth=1;
    for(let i=1;i<5;i++){const gy=pad+i/5*(height-pad*2);ctx.beginPath();ctx.moveTo(pad,gy);ctx.lineTo(width-pad,gy);ctx.stroke();}
    ctx.beginPath();values.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));
    const last=values.at(-1),first=values[0],up=last>=first;
    ctx.strokeStyle=up?"#84cc16":"#ef4444";ctx.lineWidth=2.4;ctx.lineJoin="round";ctx.lineCap="round";ctx.stroke();
    ctx.lineTo(x(values.length-1),height-pad);ctx.lineTo(x(0),height-pad);ctx.closePath();
    const fill=ctx.createLinearGradient(0,pad,0,height-pad);fill.addColorStop(0,up?"rgba(132,204,22,.20)":"rgba(239,68,68,.20)");fill.addColorStop(1,"rgba(10,14,20,0)");ctx.fillStyle=fill;ctx.fill();
    const current=values.at(-1);ctx.fillStyle=up?"#a3e635":"#fb7185";ctx.beginPath();ctx.arc(x(values.length-1),y(current),4,0,Math.PI*2);ctx.fill();
    ctx.font="11px Arial";ctx.textAlign="right";ctx.fillStyle="#dbe4ef";ctx.fillText(fmtMoney(max),width-4,pad+4);ctx.fillText(fmtMoney(min),width-4,height-pad-4);
    ctx.textAlign="left";ctx.fillStyle=up?"#a3e635":"#fb7185";ctx.font="bold 12px Arial";ctx.fillText((up?"▲ ":"▼ ")+fmtMoney(current),pad,pad+12);
    for(const [v,label,color] of [[support,"SUPPORT","#22c55e"],[resistance,"RESISTANCE","#ef4444"],[entry,"ENTRY","#e5e7eb"],[stop,"STOP","#ef4444"],[target,"TARGET","#84cc16"]]){
      if(!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)continue;
      ctx.strokeStyle=color;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pad,y(Number(v)));ctx.lineTo(width-pad,y(Number(v)));ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=color;ctx.font="9px Arial";ctx.fillText(label,pad+3,y(Number(v))-4);
    }
  }
  function installChart() {
    if(typeof window.drawChart!=="function"||window.bmDrawWrapped)return;
    originalDraw=window.drawChart;
    window.drawChart=function(...args){
      queuedDraw=args;
      if(drawFrame)return;
      drawFrame=requestAnimationFrame(()=>{
        drawFrame=0;const latest=queuedDraw;queuedDraw=null;
        if(chartMode==="zigzag")drawZigzag(latest);
        else originalDraw(...latest);
      });
    };
    window.bmDrawWrapped=true;
  }
  function addChartControls() {
    const card=$("mainChartCard");if(!card||$("bmChartExtras"))return;
    const heading=card.querySelector(".chart-heading");
    const controls=document.createElement("div");controls.className="bm-chart-controls";controls.id="bmChartExtras";
    controls.innerHTML='<div class="bm-chart-mode" role="group" aria-label="Chart style"><button type="button" data-chart-mode="candles" class="active">Candles</button><button type="button" data-chart-mode="zigzag">Zigzag</button></div><span id="bmCandleCountdown">Next candle in —</span>';
    if(heading)heading.insertAdjacentElement("afterend",controls);else card.prepend(controls);
    controls.querySelectorAll("[data-chart-mode]").forEach(button=>button.addEventListener("click",()=>{
      chartMode=button.dataset.chartMode;
      controls.querySelectorAll("[data-chart-mode]").forEach(b=>b.classList.toggle("active",b===button));
      if(typeof redrawChart==="function")redrawChart();
    }));
    const wrap=card.querySelector(".chart-wrap");
    const extras=document.createElement("section");extras.id="bmChartExtrasInfo";extras.className="bm-chart-intelligence";
    extras.innerHTML='<div class="bm-chart-why"><small>WHY IT IS MOVING</small><p id="bmWhyMoving">Analyze a market to see the factors behind its latest move.</p></div><div class="bm-chart-mi"><div class="bm-chart-mi-head"><strong>Market Intelligence</strong><button type="button" id="bmOpenIntelligence">Full view →</button></div><div class="bm-chart-mi-grid"><div><small>Active asset</small><strong id="bmMiBtc">BTC / USD</strong><span id="bmMiBtcChange">—</span></div><div><small>Live price</small><strong id="bmMiEth">—</strong><span id="bmMiEthChange">—</span></div><div><small>15m momentum</small><strong id="bmMiMomentum">—</strong></div><div><small>RSI (14)</small><strong id="bmMiRsi">—</strong></div></div><p class="bm-mi-foot">Provider quotes may be delayed or rate-limited. Indicators are descriptive, not predictions.</p></div>';
    if(wrap)wrap.insertAdjacentElement("afterend",extras);else card.append(extras);
    $("bmOpenIntelligence")?.addEventListener("click",()=>{if(typeof showScreen==="function")showScreen("intelligenceScreen");});
  }
  function syncFavoriteMiniCards(){
    if(!modal || !modal.classList.contains("open") || modalTitle?.textContent!=="Favorites" || typeof favoriteDetailsCache==="undefined")return;
    for(const symbol of (typeof bunFavorites!=="undefined"?bunFavorites:[])){
      const data=favoriteDetailsCache.get(symbol);if(!data)continue;
      const find=(attr)=>Array.from(modalBody.querySelectorAll("["+attr+"]")).find(node=>node.getAttribute(attr)===symbol);
      const price=find("data-fav-price"),move=find("data-fav-move"),trend=find("data-fav-trend");
      if(price)price.textContent=fmtMoney(data.price);
      if(move){const amount=Number(data.changeAmount),change=Number(data.change);move.classList.remove("is-up","is-down");if(Number.isFinite(amount)&&Number.isFinite(change)){const up=amount>=0;move.classList.add(up?"is-up":"is-down");move.textContent=(up?"+":"-")+fmtMoney(Math.abs(amount))+"  "+fmtPct(change);}}
      if(trend)trend.textContent=(data.trend||"Waiting for trend")+" · "+(data.setup||"No setup yet");
    }
  }
  function syncMiniIntelligence() {
    syncFavoriteMiniCards();
    const originalSymbol=document.querySelector('[data-mi-asset].active')?.dataset.miAsset||"BTC/USD";
    safeText($("bmMiBtc"),originalSymbol);safeText($("bmMiEth"),$("miPrice")?.textContent||"—");safeText($("bmMiBtcChange"),$("miChange")?.textContent||"—");
    const map=[["bmMiMomentum","miMom15"],["bmMiRsi","miRsi"]];
    for(const [dest,source] of map)safeText($(dest),$(source)?.textContent||"—");
    const miniChange=$("bmMiBtcChange");if(miniChange)updateTone(miniChange,(miniChange.textContent||"").startsWith("+")?1:(miniChange.textContent||"").startsWith("-")?-1:0);
    const mom=$("bmMiMomentum");if(mom)updateTone(mom,(mom.textContent||"").startsWith("+")?1:(mom.textContent||"").startsWith("-")?-1:0);
    safeText($("bmWhyMoving"),explainMovement());
  }
  function tickCountdown() {
    const node=$("bmCandleCountdown");if(!node)return;
    const span=timeframeMs(),remaining=span-(Date.now()%span);
    const seconds=Math.ceil(remaining/1000),m=Math.floor(seconds/60),s=seconds%60;
    safeText(node,"Next candle in "+(m?m+"m ":"")+String(s).padStart(2,"0")+"s");
  }
  function initialize() {
    ensureModal();installNavigation();installPriceTone();installChart();addChartControls();
    if(countdownTimer)clearInterval(countdownTimer);countdownTimer=setInterval(tickCountdown,1000);tickCountdown();
    if(snapshotTimer)clearInterval(snapshotTimer);snapshotTimer=setInterval(syncMiniIntelligence,1000);syncMiniIntelligence();
    const ticker=$("ticker");
    if(ticker){
      const list=document.createElement("div");list.id="bmInlineSuggestions";list.className="bm-inline-suggestions";list.hidden=true;
      const search=ticker.closest(".search")||ticker.parentElement;search?.append(list);
      const render=()=>{
        const q=ticker.value.trim().toLowerCase();
        if(!q){list.hidden=true;return;}
        const matches=markets.filter(([s,n])=>s.toLowerCase().includes(q)||n.toLowerCase().includes(q)).slice(0,7);
        list.replaceChildren();
        for(const [symbol,name] of matches){const button=document.createElement("button");button.type="button";button.innerHTML="<strong></strong><small></small>";button.querySelector("strong").textContent=symbol;button.querySelector("small").textContent=name;button.addEventListener("click",()=>{ticker.value=symbol;list.hidden=true;if(typeof analyze==="function")analyze(true);});list.append(button);}
        list.hidden=!matches.length;
      };
      ticker.addEventListener("input",render);ticker.addEventListener("focus",render);
      ticker.addEventListener("keydown",e=>{if(e.key==="Escape")list.hidden=true;if(e.key==="ArrowDown"&&!list.hidden){e.preventDefault();list.querySelector("button")?.focus();}});
      document.addEventListener("click",e=>{if(!e.target.closest("#homeSearch"))list.hidden=true;});
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initialize,{once:true});else initialize();
})();