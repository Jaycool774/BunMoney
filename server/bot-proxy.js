const {timingSafeEqual} = require('node:crypto');
const express = require('express');

// Fixed loopback destination. Browser credentials never go to the Python service.
function botProxy({apiToken, serviceToken=process.env.BOT_SERVICE_TOKEN,
                   fetchImpl=globalThis.fetch, port=process.env.BOT_PORT || '8765'}={}) {
  const router=express.Router();
  router.use((req,res,next)=>{
    if (!apiToken || !serviceToken || serviceToken.length<32 || !/^\d{1,5}$/.test(String(port)))
      return res.status(503).json({error:'Paper bot authentication is not configured.'});
    const actual=Buffer.from(req.get('authorization') || ''),expected=Buffer.from(`Bearer ${apiToken}`);
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected))
      return res.status(401).json({error:'Unlock the private market engine to control the bot.'});
    next();
  });
  const forward=path=>async(req,res)=>{
    try {
      const response=await fetchImpl(`http://127.0.0.1:${port}/${path}`,{
        method:req.method,redirect:'error',signal:AbortSignal.timeout(25000),
        headers:{Authorization:`Bearer ${serviceToken}`,'Content-Type':'application/json'},
        ...(req.method==='POST'?{body:JSON.stringify(req.body)}:{})
      });
      const data=await response.json();
      res.status(response.status).json(data);
    } catch {res.status(503).json({error:'Paper bot unavailable; no order confirmed. Refresh before retrying.'});}
  };
  router.get('/state',forward('state'));
  router.post('/control',express.json({limit:'4kb'}),forward('control'));
  return router;
}
module.exports={botProxy};
