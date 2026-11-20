/* BunMoney Space Market — Phase 1.
 * Visual-only layer. Reads the existing Trading Core price/symbol fields;
 * it does not fetch data, place orders, or modify the paper-trading engine.
 */
(() => {
  "use strict";
  const canvas = document.getElementById("spaceFlightCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const sourcePrice = document.getElementById("price");
  const sourceSymbol = document.getElementById("symbol");
  const sourceChange = document.getElementById("change");
  const priceOut = document.getElementById("spaceMarketPrice");
  const symbolOut = document.getElementById("spaceMarketSymbol");
  const changeOut = document.getElementById("spaceMarketChange");
  const statusOut = document.getElementById("spaceMarketStatus");
  const latestOut = document.getElementById("spaceMarketLatest");
  const trailOut = document.getElementById("spaceMarketTrail");
  const chartPanel = document.getElementById("spaceMarketChartPanel");
  const separateCanvas = document.getElementById("spaceSeparateChart");
  const separateCtx = separateCanvas ? separateCanvas.getContext("2d") : null;
  const stage = document.getElementById("spaceMarketStage");
  const toggleButtons = [...document.querySelectorAll("[data-space-layout]")];
  const points = [];
  const stars = Array.from({length:95},(_,i)=>({
    x:((i*73.17)%997)/997,y:((i*137.31)%991)/991,
    r:.35+((i*19)%13)/10,a:.2+((i*7)%7)/10
  }));
  let lastValue = null, currentSymbol = "—", currentChange = "", width = 0, height = 0, frame = 0, raf = 0, layoutMode = "overlay";
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function parsePrice(text) {
    const match = String(text || "").replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }
  function readSource() {
    if (!sourcePrice || !sourceSymbol) return;
    const value = parsePrice(sourcePrice.textContent);
    const symbol = (sourceSymbol.textContent || "").trim();
    const change = (sourceChange?.textContent || "").trim();
    if (symbol) currentSymbol = symbol;
    currentChange = change;
    if (value !== null && Number.isFinite(value) && value > 0) {
      if (lastValue === null || value !== lastValue || (points.length && points[points.length-1].symbol !== currentSymbol)) {
        points.push({value, symbol:currentSymbol, time:Date.now()});
        if (points.length > 120) points.shift();
        lastValue = value;
      }
      if (statusOut) statusOut.textContent = "Mirroring Trading Core · price updates when its market data refreshes";
    } else if (statusOut) {
      statusOut.textContent = "Awaiting market data · analyze a symbol in Trading Core first";
    }
    if (priceOut) priceOut.textContent = value === null ? "—" : new Intl.NumberFormat(undefined,{style:"currency",currency:"USD",maximumFractionDigits:value<1?6:2}).format(value);
    if (symbolOut) symbolOut.textContent = currentSymbol || "—";
    if (changeOut) {
      changeOut.textContent = change || "Price change unavailable";
      changeOut.classList.toggle("up", /\+|gain|up/i.test(change));
      changeOut.classList.toggle("down", /-|loss|down/i.test(change));
    }
    if (latestOut) latestOut.textContent = value === null ? "—" : value.toLocaleString(undefined,{maximumFractionDigits:6});
    if (trailOut) trailOut.textContent = points.length + " captured updates";
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1,2);
    width = Math.max(1,rect.width); height = Math.max(1,rect.height);
    canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    draw();
  }
  function draw() {
    if (!ctx || !width || !height) return;
    ctx.clearRect(0,0,width,height);
    const w=width,h=height;
    // Subtle star field, fixed positions so the chart never fabricates market motion.
    stars.forEach((s,i)=>{
      ctx.globalAlpha=s.a;
      ctx.fillStyle=i%5===0?"#a5b4fc":"#dbeafe";
      ctx.beginPath();ctx.arc(s.x*w,s.y*h,s.r,0,Math.PI*2);ctx.fill();
    });
    ctx.globalAlpha=1;
    // Navigation grid.
    ctx.strokeStyle="rgba(148,163,255,.10)";ctx.lineWidth=1;
    for(let x=0;x<w;x+=Math.max(42,w/9)){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=0;y<h;y+=42){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    // Draw price path only from observed Trading Core price updates.
    if(points.length>1 && layoutMode==="overlay"){
      const vals=points.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals),range=max-min||Math.max(Math.abs(max)*.001,.000001);
      const pad=30,plotW=w-pad*2,plotH=h-pad*2;
      const coords=points.map((p,i)=>({x:pad+(i/(points.length-1))*plotW,y:pad+(1-(p.value-min)/range)*plotH}));
      const grad=ctx.createLinearGradient(0,pad,0,h-pad);grad.addColorStop(0,"rgba(96,165,250,.95)");grad.addColorStop(1,"rgba(167,139,250,.55)");
      ctx.beginPath();coords.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=grad;ctx.lineWidth=2.5;ctx.shadowColor="#818cf8";ctx.shadowBlur=10;ctx.stroke();ctx.shadowBlur=0;
      const last=coords[coords.length-1];
      // Top-down rocket marker: nose points toward the top of the screen.
      ctx.save();ctx.translate(last.x,last.y);ctx.rotate(0);
      ctx.shadowColor="#93c5fd";ctx.shadowBlur=16;ctx.fillStyle="#e0f2fe";
      ctx.beginPath();ctx.moveTo(0,-14);ctx.quadraticCurveTo(10,-5,7,8);ctx.lineTo(0,5);ctx.lineTo(-7,8);ctx.quadraticCurveTo(-10,-5,0,-14);ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle="#818cf8";ctx.beginPath();ctx.moveTo(-4,7);ctx.lineTo(0,17+Math.sin(frame/8)*3);ctx.lineTo(4,7);ctx.fill();
      ctx.fillStyle="#60a5fa";ctx.beginPath();ctx.arc(0,-3,2.5,0,Math.PI*2);ctx.fill();ctx.restore();
      ctx.fillStyle="#c7d2fe";ctx.font="10px Arial";ctx.fillText("LATEST OBSERVED PRICE",12,h-13);
    } else {
      // Static top-down spacecraft while awaiting real observations.
      ctx.save();ctx.translate(w/2,h/2);ctx.shadowColor="#818cf8";ctx.shadowBlur=20;ctx.fillStyle="#dbeafe";
      ctx.beginPath();ctx.moveTo(0,-22);ctx.quadraticCurveTo(14,-8,10,14);ctx.lineTo(0,9);ctx.lineTo(-10,14);ctx.quadraticCurveTo(-14,-8,0,-22);ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle="#818cf8";ctx.beginPath();ctx.moveTo(-5,12);ctx.lineTo(0,26);ctx.lineTo(5,12);ctx.fill();ctx.restore();
      if(points.length===0){ctx.fillStyle="#a5b4fc";ctx.font="12px Arial";ctx.textAlign="center";ctx.fillText("ANALYZE A MARKET TO BEGIN FLIGHT TRACKING",w/2,h/2+58);ctx.textAlign="start";}
    }
  }
  function animate(){frame++;if(!reducedMotion){draw();drawSeparate();}raf=requestAnimationFrame(animate);}
  function setLayout(layout){
    const overlay=layout==="overlay";
    if(chartPanel) chartPanel.hidden=overlay;
    if(stage) stage.classList.toggle("chart-overlay",overlay);
    toggleButtons.forEach(btn=>btn.setAttribute("aria-pressed",String(btn.dataset.spaceLayout===layout)));
    try{localStorage.setItem("bunmoney_space_chart_layout",layout);}catch{}
  }
  toggleButtons.forEach(btn=>btn.addEventListener("click",()=>setLayout(btn.dataset.spaceLayout)));
  let initial="overlay";try{initial=localStorage.getItem("bunmoney_space_chart_layout")||initial;}catch{}
  setLayout(initial==="separate"?"separate":"overlay");
  if(sourcePrice&&sourceSymbol){
    const observer=new MutationObserver(readSource);
    [sourcePrice,sourceSymbol,sourceChange].filter(Boolean).forEach(el=>observer.observe(el,{childList:true,subtree:true,characterData:true}));
    readSource();
  } else if(statusOut) statusOut.textContent="Trading Core price fields were not found.";
  if("ResizeObserver" in window){new ResizeObserver(resize).observe(canvas);}else window.addEventListener("resize",resize);
  resize();
  if(!reducedMotion)raf=requestAnimationFrame(animate);
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&raf)cancelAnimationFrame(raf);else if(!document.hidden&&!reducedMotion)raf=requestAnimationFrame(animate);});
  window.addEventListener("beforeunload",()=>{if(raf)cancelAnimationFrame(raf);});
})();
