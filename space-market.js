/* BunMoney Space Market — Phase 1 visual layer.
   Mirrors Trading Core DOM values only; no market API calls or orders. */
(() => {
  "use strict";
  const canvas=document.getElementById("spaceFlightCanvas");
  if(!canvas)return;
  const ctx=canvas.getContext("2d");
  const separateCanvas=document.getElementById("spaceSeparateChart");
  const separateCtx=separateCanvas?.getContext("2d");
  const sourcePrice=document.getElementById("price");
  const sourceSymbol=document.getElementById("symbol");
  const sourceChange=document.getElementById("change");
  const priceOut=document.getElementById("spaceMarketPrice");
  const symbolOut=document.getElementById("spaceMarketSymbol");
  const changeOut=document.getElementById("spaceMarketChange");
  const statusOut=document.getElementById("spaceMarketStatus");
  const latestOut=document.getElementById("spaceMarketLatest");
  const trailOut=document.getElementById("spaceMarketTrail");
  const chartPanel=document.getElementById("spaceMarketChartPanel");
  const toggleButtons=[...document.querySelectorAll("[data-space-layout]")];
  const stars=Array.from({length:95},(_,i)=>({x:((i*73.17)%997)/997,y:((i*137.31)%991)/991,r:.35+((i*19)%13)/10,a:.2+((i*7)%7)/10}));
  const points=[];
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches||false;
  let symbol="—",lastValue=null,layout="overlay",frame=0,raf=0,stageW=0,stageH=0;

  function parsePrice(text){const m=String(text||"").replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;}
  function sync(){
    const value=parsePrice(sourcePrice?.textContent);
    symbol=(sourceSymbol?.textContent||"—").trim()||"—";
    const change=(sourceChange?.textContent||"").trim();
    if(value!==null&&Number.isFinite(value)&&value>0){
      if(lastValue===null||value!==lastValue||points.at(-1)?.symbol!==symbol){points.push({value,symbol});if(points.length>120)points.shift();lastValue=value;}
      if(statusOut)statusOut.textContent="Mirroring Trading Core · observed updates only";
    }else if(statusOut)statusOut.textContent="Awaiting market data · analyze a symbol in Trading Core first";
    if(symbolOut)symbolOut.textContent=symbol;
    if(priceOut)priceOut.textContent=value===null?"—":new Intl.NumberFormat(undefined,{style:"currency",currency:"USD",maximumFractionDigits:value<1?6:2}).format(value);
    if(changeOut){changeOut.textContent=change||"Price change unavailable";changeOut.classList.toggle("up",/\+|gain|up/i.test(change));changeOut.classList.toggle("down",/-|loss|down/i.test(change));}
    if(latestOut)latestOut.textContent=value===null?"—":value.toLocaleString(undefined,{maximumFractionDigits:6});
    if(trailOut)trailOut.textContent=points.length+" captured updates";
    draw();
    drawSeparate();
  }
  function setCanvasSize(el,context){
    if(!el||!context)return null;
    const rect=el.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);}
    context.setTransform(dpr,0,0,dpr,0,0);
    return {w,h};
  }
  function drawTrail(context,w,h,color="#93c5fd"){
    if(points.length<2)return;
    const values=points.map(p=>p.value),min=Math.min(...values),max=Math.max(...values),range=max-min||Math.max(Math.abs(max)*.001,.000001),pad=22;
    context.beginPath();
    points.forEach((p,i)=>{const x=pad+i/(points.length-1)*(w-pad*2),y=pad+(1-(p.value-min)/range)*(h-pad*2);i?context.lineTo(x,y):context.moveTo(x,y);});
    context.strokeStyle=color;context.lineWidth=2.5;context.shadowColor="#818cf8";context.shadowBlur=9;context.stroke();context.shadowBlur=0;
    const last=points[points.length-1],x=w-pad,y=pad+(1-(last.value-min)/range)*(h-pad*2);
    context.fillStyle="#e0f2fe";context.shadowColor="#93c5fd";context.shadowBlur=13;context.beginPath();context.arc(x,y,4,0,Math.PI*2);context.fill();context.shadowBlur=0;
  }
  function draw(){
    const size=setCanvasSize(canvas,ctx);if(!size)return;
    const {w,h}=size;stageW=w;stageH=h;ctx.clearRect(0,0,w,h);
    stars.forEach((s,i)=>{ctx.globalAlpha=s.a;ctx.fillStyle=i%5===0?"#a5b4fc":"#dbeafe";ctx.beginPath();ctx.arc(s.x*w,s.y*h,s.r,0,Math.PI*2);ctx.fill();});
    ctx.globalAlpha=1;ctx.strokeStyle="rgba(148,163,255,.10)";ctx.lineWidth=1;
    for(let x=0;x<w;x+=Math.max(42,w/9)){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=0;y<h;y+=42){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    if(layout==="overlay")drawTrail(ctx,w,h);
    // Top-down rocket stays centered in Phase 1; its chart trail is price-driven.
    ctx.save();ctx.translate(w/2,h/2);ctx.rotate(0);ctx.shadowColor="#818cf8";ctx.shadowBlur=18;ctx.fillStyle="#e0f2fe";
    ctx.beginPath();ctx.moveTo(0,-18);ctx.quadraticCurveTo(12,-6,9,12);ctx.lineTo(0,7);ctx.lineTo(-9,12);ctx.quadraticCurveTo(-12,-6,0,-18);ctx.fill();
    ctx.shadowBlur=0;ctx.fillStyle="#818cf8";ctx.beginPath();ctx.moveTo(-4,10);ctx.lineTo(0,24+Math.sin(frame/8)*2);ctx.lineTo(4,10);ctx.fill();
    ctx.fillStyle="#60a5fa";ctx.beginPath();ctx.arc(0,-4,2.5,0,Math.PI*2);ctx.fill();ctx.restore();
    if(points.length===0){ctx.fillStyle="#a5b4fc";ctx.font="12px Arial";ctx.textAlign="center";ctx.fillText("ANALYZE A MARKET TO BEGIN FLIGHT TRACKING",w/2,h/2+58);ctx.textAlign="start";}
  }
  function drawSeparate(){
    if(!separateCanvas||!separateCtx||!chartPanel||chartPanel.hidden)return;
    const size=setCanvasSize(separateCanvas,separateCtx);if(!size)return;
    const {w,h}=size;separateCtx.clearRect(0,0,w,h);separateCtx.fillStyle="#080d20";separateCtx.fillRect(0,0,w,h);
    separateCtx.strokeStyle="rgba(148,163,255,.12)";for(let y=20;y<h;y+=32){separateCtx.beginPath();separateCtx.moveTo(0,y);separateCtx.lineTo(w,y);separateCtx.stroke();}
    if(points.length<2){separateCtx.fillStyle="#9aaeff";separateCtx.font="12px Arial";separateCtx.fillText("Waiting for at least two observed price updates",12,h/2);return;}
    drawTrail(separateCtx,w,h);
  }
  function setLayout(next){
    layout=next==="separate"?"separate":"overlay";
    if(chartPanel)chartPanel.hidden=layout!=="separate";
    toggleButtons.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.spaceLayout===layout)));
    try{localStorage.setItem("bunmoney_space_chart_layout",layout);}catch{}
    draw();requestAnimationFrame(drawSeparate);
  }
  toggleButtons.forEach(b=>b.addEventListener("click",()=>setLayout(b.dataset.spaceLayout)));
  let saved="overlay";try{saved=localStorage.getItem("bunmoney_space_chart_layout")||saved;}catch{}
  setLayout(saved);
  if(sourcePrice&&sourceSymbol){const observer=new MutationObserver(sync);[sourcePrice,sourceSymbol,sourceChange].filter(Boolean).forEach(el=>observer.observe(el,{childList:true,subtree:true,characterData:true}));sync();}
  else if(statusOut)statusOut.textContent="Trading Core price fields were not found.";
  const resize=()=>{draw();drawSeparate();};
  if("ResizeObserver"in window){const ro=new ResizeObserver(resize);ro.observe(canvas);if(separateCanvas)ro.observe(separateCanvas);}else window.addEventListener("resize",resize);
  function animate(){frame++;if(!reduced){draw();drawSeparate();}raf=requestAnimationFrame(animate);}
  resize();if(!reduced)raf=requestAnimationFrame(animate);
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&raf)cancelAnimationFrame(raf);else if(!document.hidden&&!reduced)raf=requestAnimationFrame(animate);});
  window.addEventListener("beforeunload",()=>{if(raf)cancelAnimationFrame(raf);});
})();
