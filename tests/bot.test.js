const test=require('node:test');
const assert=require('node:assert/strict');
const {botProxy}=require('../server/bot-proxy');

function invoke(router,{token,method='GET',url='/state',body}={}) {
  return new Promise((resolve,reject)=>{
    const req={method,url,body,headers:{},get(name){return name.toLowerCase()==='authorization'?token:undefined;}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){resolve({status:this.statusCode,data});}};
    if(method==='POST') {
      // Exercise auth and forward independently of Express's HTTP body parser.
      const auth=router.stack[0].handle;
      auth(req,res,()=>router.stack.find(s=>s.route?.path==='/control').route.stack.at(-1).handle(req,res).catch(reject));
    } else router.handle(req,res,reject);
  });
}
test('Bot proxy refuses missing configuration and unauthorized controls',async()=>{
  let calls=0;
  const opts={apiToken:'market',serviceToken:'s'.repeat(32),fetchImpl:async()=>{calls++;throw Error('must not call');}};
  assert.equal((await invoke(botProxy({...opts,apiToken:null}))).status,503);
  const proxy=botProxy(opts);
  assert.equal((await invoke(proxy,{method:'POST',url:'/control',body:{action:'approve',value:'id'}})).status,401);
  assert.equal((await invoke(proxy,{token:'Bearer wrong'})).status,401);
  assert.equal(calls,0);
});
test('Bot proxy uses fixed loopback route and independent secret',async()=>{
  const calls=[];
  const proxy=botProxy({apiToken:'market',serviceToken:'s'.repeat(32),fetchImpl:async(url,options)=>{
    calls.push({url,options});return {status:200,json:async()=>({status:'stopped'})};
  }});
  const result=await invoke(proxy,{token:'Bearer market'});
  assert.equal(result.status,200);assert.equal(calls[0].url,'http://127.0.0.1:8765/state');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+'s'.repeat(32));
  assert.equal(calls[0].options.redirect,'error');
  await invoke(proxy,{method:'POST',url:'/control',token:'Bearer market',body:{action:'emergency'}});
  assert.deepEqual(JSON.parse(calls[1].options.body),{action:'emergency'});
  assert.equal(calls[1].url,'http://127.0.0.1:8765/control');
});
test('Bot proxy connection failure fails closed without exposing errors',async()=>{
  const proxy=botProxy({apiToken:'market',serviceToken:'s'.repeat(32),fetchImpl:async()=>{throw Error('secret');}});
  const r=await invoke(proxy,{token:'Bearer market'});
  assert.equal(r.status,503);assert.ok(!r.data.error.includes('secret'));
});
