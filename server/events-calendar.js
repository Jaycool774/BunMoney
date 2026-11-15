"use strict";
const isTicker = s => typeof s==="string" && /^[A-Z0-9][A-Z0-9./:_-]{0,29}$/.test(s);
function safeLink(input) {
 try {const url=new URL(input);return url.protocol==="https:"?url.href:null;}catch{return null;}
}
function cleanEconomic(entry) {
 if (!entry || typeof entry!=="object" || entry.country!=="US")return null;
 const date=typeof entry.date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)?entry.date:null;
 if(!date)return null;
 const stamp=typeof entry.release_at_utc==="string" && Number.isFinite(Date.parse(entry.release_at_utc)) ? new Date(entry.release_at_utc).toISOString():null;
 // Date-only and ranged records must never be shown as exact times.
 const precision=entry.time_precision || (stamp?"minute":"date");
 return {id:String(entry.id || entry.series_code || date).slice(0,100),kind:"economic",
  title:String(entry.name||entry.series_name||entry.title||"Economic event").slice(0,160),
  symbol:"US",date,at:precision==="minute"||precision==="second"?stamp:null,
  precision,impact:["high","medium","low"].includes(entry.impact)?entry.impact:"unknown",
  status:String(entry.status||"scheduled").slice(0,40),
  source:String(entry.source_name||"Economic calendar").slice(0,80),
  url:safeLink(entry.source_url)||safeLink(entry.url)||"https://www.financecalendar.com",
  note:"Scheduled releases can cause volatility, but neither direction nor timing of a price reaction is predictable."};
}
function cleanEarnings(entry) {
 if(!entry || !isTicker(entry.symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reportDate||""))return null;
 const time=String(entry.reportTime || "").toUpperCase();
 const session=time==="BMO"?"Before market open":time==="AMC"?"After market close":"Time not confirmed";
 return {id:entry.symbol+"-"+entry.reportDate,kind:"earnings",symbol:entry.symbol,date:entry.reportDate,
  title:String(entry.company||entry.symbol).slice(0,110)+" earnings",
  at:null,precision:"date",session,impact:"unknown",status:String(entry.status||"expected").slice(0,30),
  source:"EarningsNxt",url:safeLink(entry.webUrl)||"https://earningsnxt.ai",
  note:"Earnings may move prices before, during or after regular trading hours; exact release time is not provided."};
}
function createEventsCalendar({fetchImpl=globalThis.fetch,now=Date.now}={}){
 let cache={expires:0,value:null},inflight=null;
 async function load(){
  if(cache.value && now()<cache.expires)return {...cache.value,cached:true};
  if(inflight)return inflight;
  inflight=(async()=>{
   const start=new Date(now()).toISOString().slice(0,10);
   const end=new Date(now()+21*86400000).toISOString().slice(0,10);
   const economicUrl=new URL("https://www.financecalendar.com/wp-json/fc/v1/calendar");
   economicUrl.search=new URLSearchParams({country:"US",from:start,to:end,limit:"100",include:"holidays"});
   const earningsUrl=new URL("https://earningsnxt.ai/api/v1/calendar");
   earningsUrl.search=new URLSearchParams({from:start,to:end,limit:"200"});
   const targets=[["economic",economicUrl],["earnings",earningsUrl]];
   const calls=await Promise.all(targets.map(async ([type,url])=>{
    try{
     const response=await fetchImpl(url,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(11000)});
     if(!response.ok)return {type,error:"Provider unavailable"};
     const value=await response.json();return {type,rows:Array.isArray(value.events)?value.events:[]};
    }catch{return {type,error:"Provider unavailable"};}
   }));
   const events=[],unavailable=[];
   for(const call of calls){
    if(call.error){unavailable.push(call.type);continue;}
    for(const raw of call.rows.slice(0,250)){
     const event=call.type==="economic"?cleanEconomic(raw):cleanEarnings(raw);
     if(event && event.date>=start && event.date<=end)events.push(event);
    }
   }
   events.sort((a,b)=>a.date.localeCompare(b.date)||(a.at||"").localeCompare(b.at||"")||a.title.localeCompare(b.title));
   const result={events,unavailable,updatedAt:new Date(now()).toISOString(),
    attribution:[{title:"Finance Calendar",url:"https://www.financecalendar.com"},{title:"EarningsNxt",url:"https://earningsnxt.ai"}]};
   if(!unavailable.length || events.length){cache={value:result,expires:now()+15*60000};}
   return result;
  })();
  try{return await inflight;}finally{inflight=null;}
 }
 return {load};
}
module.exports={createEventsCalendar,cleanEconomic,cleanEarnings};
