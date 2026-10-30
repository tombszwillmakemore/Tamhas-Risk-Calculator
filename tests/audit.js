const { chromium, devices } = require('playwright'); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0; const ok=(n,c,d)=>{ if(!c) fail++; console.log(c?'ok  ':'FAIL',n,c?'':'\n     '+d); };
(async()=>{ const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1100,height:900}}); const p=await ctx.newPage(); const dialogs=[], errs=[];
 p.on('dialog',d=>{dialogs.push(d.message()); d.dismiss();}); p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL+'#journal'); await p.waitForSelector('[data-act=new]');
 const X1='<img src=x onerror="window.__xss=1">', X2='"><script>window.__xss=2<\/script>', X3="'><svg onload=window.__xss=3>";
 await p.evaluate(async([X1,X2,X3])=>{ await TTDB.ready(); window.__xss=undefined; const C=window.TTJournalCore;
   const mk=(i,o)=>C.normalizeTrade(Object.assign({id:'x'+i,date:'2026-10-2'+i,contract:'MNQ',side:'long',contracts:1,entry:'100',exits:[{qty:1,price:'101'}],fees:'1'},o)).trade;
   const t=[mk(1,{strategy:X1,entryReason:X2,exitReason:X3,mistakes:X1,lessons:X2,notes:X3,session:'London'}),mk(2,{strategy:X2,notes:X1})];
   await TTDB.batch([{store:'trades',type:'clear'}].concat(t.map(x=>({store:'trades',type:'put',value:x}))));
   const A=TTAccountsCore; const ac=A.newAccount({id:'hx',name:X1,category:'prop',note:X3}).account; ac.rules={profitTarget:{value:X2,source:'javascript:alert(1)',sourceType:'user',verifiedOn:null,origin:'edited'}};
   const cv=TTDD.confirmVersion(null,{model:'static',basis:'balance',startingBalanceCents:5000000,maxLossCents:200000},{confirmed:true,verifiedOn:'2026-10-29',source:X3,note:X1}); ac.dd=cv.dd; await TTDB.put('accounts',ac);
   await TTDB.put('ledger',{id:'hl',accountId:'hx',type:'payout',amountCents:100,at:Date.now()-1000,date:'2026-10-29',createdAt:1,note:X2,ref:X3,voided:false});
   localStorage.setItem('tt.settings.v1',JSON.stringify({displayName:X1}));
   localStorage.setItem('tt.intel.user.v1',JSON.stringify([{title:X2,date:'2026-11-12',time:'09:00',cat:'PULSE',tz:'et',note:X3}]));
 },[X1,X2,X3]);
 await p.reload(); await p.waitForSelector('#jRoot');
 await p.click('.nav button[data-view=home]'); await p.waitForTimeout(150);
 await p.click('.nav button[data-view=journal]'); await p.waitForSelector('.jt');
 for(const h of await p.locator('.jt-head').all()){ await h.click(); } await p.waitForTimeout(150);
 await p.click('[data-act=toggle-filters]');
 await p.click('.jt.open [data-act=edit] >> nth=0'); await p.waitForSelector('#f-date'); await p.click('[data-act=cancel]');
 for(const t of ['analytics','calendar','backup']){ await p.click('[data-tab='+t+']'); await p.waitForTimeout(150); }
 await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('.a-card'); await p.click('.a-head:has-text("<img")'); await p.waitForTimeout(150); for(const sm of await p.locator('#aRoot summary').all()){ await sm.click(); } await p.waitForTimeout(150);
 await p.evaluate(()=>TTNav.go('intel')); await p.waitForTimeout(200);
 const evs=p.locator('#intelList .ev'); for(let i=0;i<await evs.count();i++){ const t=await evs.nth(i).innerText(); if(/script|onerror/i.test(t)){ await evs.nth(i).click(); break; } }
 await p.evaluate(()=>TTNav.go('settings')); await p.waitForTimeout(150);
 // backup import with hostile content
 await p.evaluate(([X1])=>{ window.__hostile=window.TTJournalCore.serializeBackup([{id:'bk1',date:'2026-10-25',contract:'MNQ',side:'long',contracts:1,entry:'100',exits:[],strategy:X1,notes:X1}],{}); },[X1]);
 const parsed=await p.evaluate(()=>window.TTJournalCore.parseBackup(window.__hostile)); 
 const xss=await p.evaluate(()=>window.__xss); const injected=await p.evaluate(()=>({imgx:document.querySelectorAll('img[src="x"]').length, svgload:document.querySelectorAll('svg[onload]').length, scripts:[...document.scripts].filter(s=>/__xss/.test(s.textContent)).length}));
 ok('XSS probe: no payload executed across Home/Entries/Edit form/Filters/Analytics/Calendar/Backup/Intel/Settings', xss===undefined&&dialogs.length===0, JSON.stringify({xss,dialogs}));
 ok('XSS probe: no injected elements in the DOM', injected.imgx===0&&injected.svgload===0&&injected.scripts===0, JSON.stringify(injected));
 ok('XSS probe: hostile backup imported as inert text', parsed.ok&&parsed.trades[0].strategy.startsWith('<img'));
 ok('XSS probe: javascript: source links are never rendered as links',await p.evaluate(()=>[...document.querySelectorAll('a')].every(a=>!/^javascript:/i.test(a.getAttribute('href')||''))),'bad link');
 ok('XSS probe: no page errors', errs.length===0, errs.join('; '));
 // ---- scale test ----
 const sc=await p.evaluate(async()=>{ await TTDB.ready(); const C=window.TTJournalCore, out={}; const t0=[]; const days=[]; 
   const trades=[]; let seed=7; const rnd=()=>(seed=(seed*1664525+1013904223)%4294967296)/4294967296;
   const sess=['Asia','London','New York'],strat=['ORB','Pullback','Reversal','Breakout','Trend'];
   for(let i=0;i<3000;i++){ const d=new Date(2024,0,1+Math.floor(i/4)); const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
     const win=rnd()<0.5, pts=Math.round((5+rnd()*25)*4)/4; const r=C.normalizeTrade({id:'s'+i,date:key,time:'09:30',contract:['MNQ','NQ','MES','ES'][i%4],side:'long',contracts:1+(i%3),entry:'20000',stop:'19980',exits:[{qty:1+(i%3),price:String(win?20000+pts:20000-pts)}],fees:'1.50',session:sess[i%3],strategy:strat[i%5],entryReason:'Reason text for trade number '+i+' with some typical length of words in it.',notes:'Notes '+i,mistakes:'',lessons:'',rating:3});
     if(!r.ok) throw new Error(r.errors.join()); trades.push(r.trade); }
   const json=C.serializeStored(trades); out.bytes=json.length; out.n=trades.length;
   try{ await TTDB.batch([{store:'trades',type:'clear'}].concat(trades.map(x=>({store:'trades',type:'put',value:x})))); out.stored=(await TTDB.count('trades'))===3000; }catch(e){ out.stored=false; out.err=String(e&&e.name); }
   let t=performance.now(); const rows=C.analyze(trades); out.analyzeMs=Math.round(performance.now()-t);
   t=performance.now(); C.stats(rows,'net'); C.breakdown(rows,r=>r.t.strategy,null,'net'); C.dailyMap(rows,'net'); out.statsMs=Math.round(performance.now()-t);
   t=performance.now(); C.toCsv(rows); out.csvMs=Math.round(performance.now()-t);
   // estimate: how many trades before 5MB (UTF-16 quota counted in chars ~5M)
   out.perTrade=Math.round(json.length/trades.length); out.maxApprox=Math.floor(5e6/out.perTrade);
   return out; });
 console.log('   SCALE:',JSON.stringify(sc));
 ok('scale: 3000 detailed trades stored in IndexedDB', sc.stored, JSON.stringify(sc));
 await p.reload(); await p.waitForSelector('#jRoot',{state:'attached'}); await p.click('.nav button[data-view=journal]'); await p.waitForSelector('.jt');
 let t0=Date.now(); await p.click('[data-tab=analytics]'); await p.waitForSelector('.kpi'); const aMs=Date.now()-t0;
 t0=Date.now(); await p.click('[data-tab=calendar]'); await p.waitForSelector('.cal'); const cMs=Date.now()-t0;
 t0=Date.now(); await p.click('[data-tab=entries]'); await p.fill('#jq','trade number 2999'); await p.waitForFunction(()=>/Showing 1 of 3000/.test(document.getElementById('jCount').textContent)); const sMs=Date.now()-t0;
 console.log('   UI @3000 trades: analytics',aMs,'ms | calendar',cMs,'ms | search',sMs,'ms');
 ok('scale: UI responsive at 3000 trades (<1.5s each)', aMs<1500&&cMs<1500&&sMs<1500, [aMs,cMs,sMs].join(','));
 await b.close(); console.log(fail?fail+' FAILED':'AUDIT PROBES PASSED');
})().catch(e=>{console.error('ERR',e);process.exit(1)});
