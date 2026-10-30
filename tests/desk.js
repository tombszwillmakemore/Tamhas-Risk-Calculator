/* Desktop-width layout check: opens every screen at 1280x800 and 768x1024, fails on horizontal overflow or JS errors; saves screenshots to tests/out/shots. */
const { chromium } = require('./_pw'); const path=require('path'), fs=require('fs'); const out=path.join(__dirname,'out','shots'); fs.mkdirSync(out,{recursive:true});
const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html'); let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
(async()=>{ const b=await chromium.launch();
 for (const [w,h] of [[1280,800],[768,1024],[360,740]]) { const ctx=await b.newContext({viewport:{width:w,height:h}}); const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); await p.goto(URL); await p.evaluate(()=>TTDB.ready());
  await p.evaluate(async()=>{ const C=TTJournalCore; await TTDB.clear('trades'); for(let i=0;i<30;i++){ const r=C.normalizeTrade({id:'d'+i,date:new Date(Date.UTC(2026,8,1)+i*86400000).toISOString().slice(0,10),time:'09:45',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'4',createdAt:i+1,strategy:'ORB',exits:[{qty:1,price:i%3?108:97}]}); await TTDB.put('trades',r.trade);} await TTStore.invalidate(); });
  for (const v of ['home','calc','journal','accounts','more','analytics','risk','discipline','strategy','insights','health','import','money','intel','settings']) { await p.evaluate(n=>TTNav.go(n),v); await p.waitForTimeout(350);
   const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:window.innerWidth})); ok(w+'px '+v+': no horizontal overflow',o.sw<=o.iw+1,o);
   if(['analytics','strategy','insights'].includes(v)) await p.screenshot({path:path.join(out,'W'+w+'-'+v+'.png'),fullPage:false}); }
  ok(w+'px: no js errors',errs.length===0,errs); await ctx.close(); }
 await b.close(); console.log(`desk: ${pass} passed, ${fail} failed`); process.exit(fail?1:0); })();
