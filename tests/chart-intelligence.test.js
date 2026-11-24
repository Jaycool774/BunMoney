const test=require("node:test");
const assert=require("node:assert/strict");
const {normalize,analyze}=require("../chart-intelligence-core");
function series(count=60){
 return Array.from({length:count},(_,i)=>{
  const close=100+Math.sin(i/3)*1.8+i*.035;
  return {datetime:new Date(Date.UTC(2026,0,1)+i*60000).toISOString(),open:close-.2,high:close+.55,low:close-.55,close,volume:100+i};
 });
}
test("normalizes provider candles chronologically and rejects invalid bars",()=>{
 const input=series(30).reverse();input.push({datetime:"bad",open:1,high:1,low:1,close:1});
 const result=normalize(input);assert.equal(result.length,30);assert.ok(result[0].time<result.at(-1).time);
});
test("detects a chart structure and returns actionable scenarios without a guaranteed prediction",()=>{
 const result=analyze({symbol:"BTC/USD",candles:series(),currentPrice:102});
 assert.equal(result.symbol,"BTC/USD");assert.ok(result.pattern.name);assert.ok(result.pattern.confidence>=0&&result.pattern.confidence<=100);
 assert.ok(result.support<result.resistance);assert.match(result.scenarios.bullish,/possible|remains possible/);assert.match(result.caution,/not guarantees/);
});
test("requires enough valid candles",()=>{
 assert.throws(()=>analyze({candles:series(10),currentPrice:100}),/At least 20/);
});
