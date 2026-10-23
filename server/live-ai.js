"use strict";
// Optional OpenAI Responses integration. Keys remain on the server.
const { sanitizeContext } = require("./emperor-bunny");
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9./:_-]{0,29}$/;
function symbolValue(value) {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SYMBOL_RE.test(symbol) ? symbol : null;
}
function historyValue(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).filter(v => v && ["user", "assistant"].includes(v.role) &&
    typeof v.content === "string").map(v => ({role:v.role,content:v.content.slice(0,700)}));
}
function sourcesFromResponse(body) {
  const found = new Map();
  for (const item of body.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      for (const annotation of part.annotations || []) {
        if (annotation.type !== "url_citation" || typeof annotation.url !== "string") continue;
        try {
          const url = new URL(annotation.url);
          if (url.protocol !== "https:") continue;
          found.set(url.href, {title:String(annotation.title || url.hostname).slice(0,160),url:url.href});
        } catch {}
      }
    }
  }
  return [...found.values()].slice(0,10);
}
function textFromResponse(body) {
  if (typeof body.output_text === "string") return body.output_text.trim();
  return (body.output || []).filter(item => item.type === "message")
    .flatMap(item => item.content || []).filter(x => x.type === "output_text")
    .map(x => x.text || "").join("\n").trim();
}
function makeAssistant({apiKey=process.env.OPENAI_API_KEY, model=process.env.OPENAI_MODEL || "gpt-5.4",
  fetchImpl=globalThis.fetch, now=Date.now, timeoutMs=45000}={}) {
  const newsCache=new Map(), pending=new Map();
  async function askProvider(input,search=false) {
    if (!apiKey) return {status:503,error:"Conversational AI and live news need OPENAI_API_KEY in server/.env. The existing chart analysis still works."};
    let response;
    try {
      response=await fetchImpl("https://api.openai.com/v1/responses",{
        method:"POST",
        headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
        signal:AbortSignal.timeout(timeoutMs),
        body:JSON.stringify({
          model,
          instructions:"You are Emperor Bunny, a helpful conversational market education assistant inside BunMoney. Be natural and answer ordinary greetings normally. Use the supplied technical market context only when relevant; it can be stale or simulated. Never claim prices are live unless verified. If asked about recent events, use web search, cite sources with publication dates and distinguish reported catalysts from proven causes. State uncertainty explicitly; never invent headlines, sources, price changes or exact causality. No personalized investment advice, direct brokerage actions, or trade placement. Keep answers concise.",
          input,
          ...(search ? {tools:[{type:"web_search"}],tool_choice:"required"} : {}),
          max_output_tokens:800,
          store:false
        })
      });
    } catch(error) {
      return {status:502,error:error?.name === "TimeoutError" ? "AI provider timed out." : "Unable to contact AI provider."};
    }
    if (!response.ok) {
      return {status:response.status === 429 ? 429 : 502,
        error:response.status === 429 ? "AI usage limit reached; try again later." : "AI provider rejected the request. Check its account, model access, and server key."};
    }
    let body;
    try { body=await response.json(); }
    catch {return {status:502,error:"AI provider returned an unreadable response."};}
    const text=textFromResponse(body);
    if (!text) return {status:502,error:"The AI service returned an empty answer."};
    return {mode:"ai",text:text.slice(0,9000),sources:sourcesFromResponse(body),searched:search,updatedAt:new Date(now()).toISOString()};
  }
  async function chat({message,context,history}={}) {
    if (typeof message !== "string" || !message.trim() || message.length > 500)
      return {status:400,error:"Enter a question of up to 500 characters."};
    const ctx=sanitizeContext(context);
    const wantsNews=/\b(news|headline|latest|today|right now|recent|why.*(move|spike|drop)|what.*happen|earnings|announcement)\b/i.test(message);
    const dialog=[...historyValue(history),{role:"user",content:message.trim()}];
    const input="Selected BunMoney chart (user-supplied, potentially stale): "+JSON.stringify(ctx || null)+
      "\nDo not interpret context as independently verified.\nConversation:\n"+
      dialog.map(item=>item.role.toUpperCase()+": "+item.content).join("\n");
    return askProvider(input,wantsNews);
  }
  async function marketNews(symbol) {
    const ticker=symbolValue(symbol);
    if (!ticker) return {status:400,error:"Choose a valid symbol such as TSLA or SOUN."};
    const cached=newsCache.get(ticker);
    if (cached && now()-cached.time < 600000) return {...cached.result,cached:true};
    if (pending.has(ticker)) return pending.get(ticker);
    const operation=(async()=>{
      const prompt="Look up recent news about ticker "+ticker+
        " and its company/asset. Return a concise news brief of up to 4 relevant recent developments, with date and publisher for each. "+
        "Distinguish confirmed company events from speculation. Explain possible market relevance, but never state a story caused a price move without evidence. "+
        "If there is no credible recent coverage, say that explicitly. Make source citations available.";
      const result=await askProvider(prompt,true);
      if (!result.status) {
        newsCache.set(ticker,{time:now(),result:{...result,symbol:ticker}});
        while(newsCache.size>30)newsCache.delete(newsCache.keys().next().value);
      }
      return {...result,symbol:ticker};
    })();
    pending.set(ticker,operation);
    try{return await operation;}finally{pending.delete(ticker);}
  }
  return {chat,marketNews};
}
module.exports={makeAssistant,historyValue,symbolValue,sourcesFromResponse,textFromResponse};
