"use strict";
// Independent market news feed: Google News RSS, no AI credits or AI API required.
const aliases = {TSLA:"Tesla", SOUN:"SoundHound AI", BBAI:"BigBear.ai", GRAB:"Grab Holdings",
 AAPL:"Apple", NVDA:"Nvidia", MSFT:"Microsoft", AMZN:"Amazon", GOOGL:"Alphabet"};
const symbolValid = s => typeof s === "string" && /^[A-Z0-9][A-Z0-9./:_-]{0,29}$/.test(s);
const decode = s => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
 .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
 .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
function tag(xml,name) {
 const match = xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+name+">","i"));
 return match ? decode(match[1]).trim() : "";
}
function parseFeed(xml,limit=8) {
 const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
 return items.slice(0,limit*3).map(m=>{
   const item=m[1], title=tag(item,"title"), link=tag(item,"link"), source=tag(item,"source") || "Google News", published=tag(item,"pubDate");
   let url;
   try { url=new URL(link); if (url.protocol!=="https:" || !["news.google.com","www.google.com"].includes(url.hostname)) return null; }
   catch {return null;}
   const date=Date.parse(published);
   if(!title || !Number.isFinite(date))return null;
   return {title:title.slice(0,240),url:url.href,source:source.slice(0,100),publishedAt:new Date(date).toISOString()};
 }).filter(Boolean).slice(0,limit);
}
// Headline-only heuristic, not proof of causation or a price forecast.
const patterns=[
 {re:/\\b(raises? guidance|beats? estimates|record revenue|strong earnings|wins? contract|new partnership|approved|upgrade[ds]?|buyback|profit jumps?)\\b/i,impact:"potentially bullish",why:"The headline suggests better earnings, demand, financing conditions, or market confidence."},
 {re:/\\b(cuts? guidance|misses? estimates|earnings miss|layoffs|investigation|lawsuit|recall|downgrade[ds]?|loss widens?|revenue falls?|offering|dilution)\\b/i,impact:"potentially bearish",why:"The headline suggests weaker performance, higher risk, dilution, or lower investor confidence."},
 {re:/\\b(acquisition|merger|deal|earnings|launch|regulation|tariff|interest rate|fed decision)\\b/i,impact:"mixed / uncertain",why:"The outcome depends on financial details and market expectations, which the headline does not establish."}
];
function classifyHeadline(title){
 const matches=patterns.filter(p=>p.re.test(title));
 if(matches.length!==1)return {impact:"uncertain",why:"The headline alone does not establish how investors will react."};
 return {impact:matches[0].impact,why:matches[0].why};
}
function createNewsFeed({fetchImpl=globalThis.fetch,now=Date.now,cacheMs=600000}={}){
 const cache=new Map(),pending=new Map();
 async function news(symbol){
   const ticker=typeof symbol==="string"?symbol.toUpperCase().trim():"";
   if(!symbolValid(ticker))return {status:400,error:"Enter a valid market ticker."};
   const existing=cache.get(ticker);
   if(existing && now()-existing.time<cacheMs)return {...existing.value,cached:true};
   if(pending.has(ticker))return pending.get(ticker);
   const work=(async()=>{
    // Scope searches to both symbol and company where known; these are search results, not verified catalysts.
    const query=aliases[ticker]?'"'+ticker+'" '+aliases[ticker]+' stock business news when:7d':'"'+ticker+'" stock market news when:7d';
    const url=new URL("https://news.google.com/rss/search");
    url.search=new URLSearchParams({q:query,hl:"en-US",gl:"US",ceid:"US:en"});
    try {
     const response=await fetchImpl(url,{headers:{"Accept":"application/rss+xml,application/xml,text/xml"},signal:AbortSignal.timeout(12000)});
     if(!response.ok)return {status:502,error:"News feed temporarily unavailable."};
     const xml=await response.text();
     if(xml.length>1500000) return {status:502,error:"News feed response exceeded safe size."};
     const articles=parseFeed(xml).map(article=>({...article,...classifyHeadline(article.title)}));
     const value={symbol:ticker,articles,updatedAt:new Date(now()).toISOString(),provider:"Google News RSS"};
     cache.set(ticker,{time:now(),value});
     while(cache.size>40)cache.delete(cache.keys().next().value);
     return value;
    } catch {return {status:502,error:"Could not reach the market news feed."};}
   })();
   pending.set(ticker,work);
   try{return await work;}finally{pending.delete(ticker);}
 }
 return {news};
}
module.exports={createNewsFeed,parseFeed,classifyHeadline};
