(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory();
  else root.BunChartIntelligence=factory();
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function normalize(values){
    if(!Array.isArray(values))return [];
    return values.map(v=>({time:Date.parse(v.datetime||v.timestamp||v.time||""),open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close),volume:Number(v.volume||0)}))
      .filter(c=>Number.isFinite(c.time)&&[c.open,c.high,c.low,c.close].every(n=>Number.isFinite(n)&&n>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close))
      .sort((a,b)=>a.time-b.time);
  }
  const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
  const pct=(a,b)=>b?((a/b)-1)*100:null;
  function pivots(candles,r=2){
    const highs=[],lows=[];
    for(let i=r;i<candles.length-r;i++){
      let hi=true,lo=true;
      for(let j=i-r;j<=i+r;j++){if(j!==i&&candles[j].high>=candles[i].high)hi=false;if(j!==i&&candles[j].low<=candles[i].low)lo=false;}
      if(hi)highs.push({i,price:candles[i].high});if(lo)lows.push({i,price:candles[i].low});
    }
    return {highs,lows};
  }
  function linearSlope(values){
    if(values.length<3)return 0;
    const n=values.length,mx=(n-1)/2,my=avg(values);
    let num=0,den=0;for(let i=0;i<n;i++){num+=(i-mx)*(values[i]-my);den+=(i-mx)**2;}
    return den?num/den:0;
  }
  function analyze(input){
    const candles=normalize(input&&input.candles),symbol=String(input&&input.symbol||"").toUpperCase(),price=Number(input&&input.currentPrice);
    if(candles.length<20)throw new Error("At least 20 valid candles are required for pattern analysis.");
    const closes=candles.map(c=>c.close),last=candles.at(-1),recent=candles.slice(-Math.min(30,candles.length)),recentCloses=recent.map(c=>c.close);
    const slope=linearSlope(recentCloses),trendPct=pct(recentCloses.at(-1),recentCloses[0])||0;
    const patternCandles=candles.slice(-Math.min(80,candles.length));\n    const piv=pivots(patternCandles,2),hi=piv.highs,lo=piv.lows;
    const highBand=hi.slice(-4),lowBand=lo.slice(-4);
    const near=(a,b,tol=0.007)=>Math.abs(a-b)/Math.max(Math.abs(a),Math.abs(b),1e-9)<=tol;
    const patterns=[];
    const add=(name,direction,status,confidence,reason,up,down)=>patterns.push({name,direction,status,confidence:Math.round(confidence),reason,up,down});
    const topPair=hi.length>=2?hi.slice(-2):[],bottomPair=lo.length>=2?lo.slice(-2):[];
    if(topPair.length===2&&near(topPair[0].price,topPair[1].price)&&topPair[1].i-topPair[0].i>=5){
      const between=patternCandles.slice(topPair[0].i,topPair[1].i+1),neck=Math.min(...between.map(c=>c.low));
      const confirmed=last.close<neck;
      add("Double top","BEARISH",confirmed?"confirmed":"forming",confirmed?78:62,"Two swing highs are close in price with a pullback between them.", "A close back above the twin highs weakens the setup.","A decisive close below the intervening low would confirm downside pressure.");
    }
    if(bottomPair.length===2&&near(bottomPair[0].price,bottomPair[1].price)&&bottomPair[1].i-bottomPair[0].i>=5){
      const between=patternCandles.slice(bottomPair[0].i,bottomPair[1].i+1),neck=Math.max(...between.map(c=>c.high));
      const confirmed=last.close>neck;
      add("Double bottom","BULLISH",confirmed?"confirmed":"forming",confirmed?78:62,"Two swing lows are close in price with a rebound between them.","A close below the twin lows invalidates the reversal idea.","A decisive close above the intervening high would confirm upside pressure.");
    }
    if(highBand.length>=2&&lowBand.length>=2){
      const h0=highBand[0].price,h1=highBand.at(-1).price,l0=lowBand[0].price,l1=lowBand.at(-1).price;
      if(near(h0,h1,0.009)&&l1>l0*1.003){
        const confirmed=last.close>Math.max(...highBand.map(p=>p.price));
        add("Ascending triangle","BULLISH",confirmed?"confirmed":"forming",confirmed?82:68,"Swing highs are clustering near resistance while swing lows are rising.","A close below the rising support line would weaken the bullish structure.","A close above the repeated highs, ideally with stronger volume, would confirm a breakout attempt.");
      }else if(near(l0,l1,0.009)&&h1<h0*0.997){
        const confirmed=last.close<Math.min(...lowBand.map(p=>p.price));
        add("Descending triangle","BEARISH",confirmed?"confirmed":"forming",confirmed?82:68,"Swing lows are clustering near support while swing highs are falling.","A close above descending resistance would weaken the bearish structure.","A close below the repeated lows, ideally with stronger volume, would confirm a breakdown attempt.");
      }
    }
    const impulseBars=recent.slice(-20,-8),consolidation=recent.slice(-8);
    if(impulseBars.length>=8&&consolidation.length>=5){
      const impulse=pct(impulseBars.at(-1).close,impulseBars[0].open)||0;
      const cons=pct(consolidation.at(-1).close,consolidation[0].open)||0;
      const consRange=(Math.max(...consolidation.map(c=>c.high))/Math.min(...consolidation.map(c=>c.low))-1)*100;
      if(impulse>2.2&&Math.abs(cons)<Math.max(1.6,Math.abs(impulse)*0.45)&&consRange<Math.abs(impulse)*0.9){
        const confirmed=last.close>Math.max(...consolidation.slice(0,-1).map(c=>c.high));
        add("Bull flag","BULLISH",confirmed?"confirmed":"forming",confirmed?80:64,"A sharp upward impulse is followed by a relatively tight pause.","A close below the flag's recent low would invalidate the continuation idea.","A close above the flag high may signal continuation; volume confirmation matters.");
      }else if(impulse< -2.2&&Math.abs(cons)<Math.max(1.6,Math.abs(impulse)*0.45)&&consRange<Math.abs(impulse)*0.9){
        const confirmed=last.close<Math.min(...consolidation.slice(0,-1).map(c=>c.low));
        add("Bear flag","BEARISH",confirmed?"confirmed":"forming",confirmed?80:64,"A sharp downward impulse is followed by a relatively tight pause.","A close above the flag's recent high would invalidate the continuation idea.","A close below the flag low may signal continuation; volume confirmation matters.");
      }
    }
    const support=Math.min(...recent.slice(-20).map(c=>c.low)),resistance=Math.max(...recent.slice(-20).map(c=>c.high));
    const rsiValues=closes.slice(-15),gains=[],losses=[];for(let i=1;i<rsiValues.length;i++){const d=rsiValues[i]-rsiValues[i-1];gains.push(Math.max(0,d));losses.push(Math.max(0,-d));}
    const g=avg(gains)||0,l=avg(losses)||0,rsi=l===0?(g?100:50):100-100/(1+g/l);
    const volumeBase=avg(candles.slice(-21,-1).map(c=>c.volume).filter(v=>v>0));
    const volumeRatio=volumeBase&&last.volume>0?last.volume/volumeBase:null;
    if(!patterns.length){
      const direction=trendPct>0.35?"BULLISH":trendPct< -0.35?"BEARISH":"NEUTRAL";
      add(direction==="NEUTRAL"?"Range / consolidation":direction==="BULLISH"?"Uptrend / channel":"Downtrend / channel",direction,"forming",Math.min(72,48+Math.abs(trendPct)*3),"No high-confidence textbook reversal or continuation pattern was found; recent price structure is described instead.","A break below recent support would weaken the current structure.","A break above recent resistance would strengthen the current structure.");
    }
    const primary=patterns.sort((a,b)=>b.confidence-a.confidence)[0];
    const current=Number.isFinite(price)&&price>0?price:last.close;
    const statusText=primary.status==="confirmed"?"Confirmed by a candle close": "Still forming; wait for a close beyond its trigger level";
    return {symbol,price:current,pattern:primary,patterns,support,resistance,trendPct,rsi,volumeRatio,lastTime:last.time,candleCount:candles.length,statusText,
      summary:primary.name+" ("+primary.status+"): "+primary.reason,
      scenarios:{bullish:primary.direction==="BULLISH"?"Upside follow-through is possible if price closes above nearby resistance and momentum/volume support the move.":"A bullish reversal remains possible if price reclaims nearby resistance and holds above it.",bearish:primary.direction==="BEARISH"?"Downside follow-through is possible if price closes below nearby support and selling pressure persists.":"A bearish reversal remains possible if price loses nearby support and cannot reclaim it.",neutral:"If neither boundary breaks, price may continue moving sideways; avoid treating the middle of the range as confirmation."},
      caution:statusText+". Pattern labels are rule-based interpretations, not guarantees or personalized trade signals."
    };
  }
  return {normalize,analyze,pivots};
});
