const { chromium } = require('./_pw');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const until=async(pg,fn,arg,ms=6000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn,arg)) return true; await pg.waitForTimeout(40);} return false;};
const seed=async(p,list)=>{ await p.evaluate(async(list)=>{ const C=TTJournalCore; const d=new Date(); const t0=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); await TTDB.clear('trades'); await TTStore.invalidate(); for (const o of list){ const r=C.normalizeTrade(Object.assign({contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'0',createdAt:1,date:t0},o)); if(!r.ok) throw new Error(JSON.stringify(r.errors)); await TTDB.put('trades',r.trade);} },list); };
const type=async(p,sel,v)=>{ await p.fill(sel,v); };
const BLANK=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/manifest.webmanifest');
// Build an old-version database exactly as earlier releases created it, with data in it, BEFORE the app ever loads.
const build=(ver)=>async(p)=>p.evaluate(async(ver)=>{
  await new Promise(r=>{ const q=indexedDB.deleteDatabase('tt-platform'); q.onsuccess=q.onerror=q.onblocked=()=>r(); });
  const db=await new Promise((res,rej)=>{ const rq=indexedDB.open('tt-platform',ver); rq.onupgradeneeded=()=>{ const d=rq.result;
    d.createObjectStore('meta',{keyPath:'key'}); d.createObjectStore('accounts',{keyPath:'id'}); const t=d.createObjectStore('trades',{keyPath:'id'}); t.createIndex('accountId','accountId'); t.createIndex('date','date'); d.createObjectStore('quarantine',{keyPath:'id'}); d.createObjectStore('audit',{keyPath:'id'});
    if(ver>=2){ const l=d.createObjectStore('ledger',{keyPath:'id'}); l.createIndex('accountId','accountId'); } if(ver>=3){ const x=d.createObjectStore('docs',{keyPath:'id'}); x.createIndex('kind','kind'); } };
    rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); });
  const put=(s,v)=>new Promise((res,rej)=>{ const tx=db.transaction(s,'readwrite'); tx.objectStore(s).put(v); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
  await put('accounts',{id:'acct-default',name:'Old Account',category:'unassigned',archived:false,createdAt:1,note:''}); await put('accounts',{id:'acct-2',name:'Apex 50K',category:'prop',archived:false,createdAt:2,note:''});
  for(let i=0;i<5;i++) await put('trades',{id:'old'+i,date:'2026-0'+(i+1)+'-10',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,exits:[{qty:1,price:110}],fees:'4',createdAt:i+1,accountId:i<3?'acct-default':'acct-2',strategy:'Old strat'});
  await put('meta',{key:'legacyMigrated',value:{at:1}}); await put('audit',{id:'au1',at:1,type:'seed',details:{}});
  if(ver>=2) await put('ledger',{id:'l1',accountId:'acct-2',type:'fee',amountCents:15000,date:'2026-01-05',createdAt:1});
  if(ver>=3){ await put('docs',{id:'str-old',kind:'strategy',name:'Old strat',status:'live',createdAt:1,updatedAt:1}); await put('docs',{id:'pref-x',kind:'pref',key:'x',value:1,createdAt:1,updatedAt:1}); }
  db.close(); return db.version; },ver);
(async()=>{
  const browser=await chromium.launch();
  for (const ver of [1,2,3]) {
    const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[]; const T='from v'+ver+': ';
    p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
    await p.goto(BLANK); ok(T+'old db built at that version',(await build(ver)(p))===ver);
    await p.goto(URL); await p.evaluate(()=>TTDB.ready());
    const s=await p.evaluate(async()=>({v:await new Promise(r=>{ const q=indexedDB.open('tt-platform'); q.onsuccess=()=>{ const v=q.result.version, n=[...q.result.objectStoreNames]; q.result.close(); r({v,n}); }; }), trades:await TTDB.getAll('trades'), accounts:await TTDB.getAll('accounts'), audit:await TTDB.getAll('audit'), ledger:await TTDB.getAll('ledger'), docs:await TTDB.getAll('docs')}));
    ok(T+'upgraded to current version 3 with all 7 stores',s.v.v===3&&['meta','accounts','trades','quarantine','audit','ledger','docs'].every(x=>s.v.n.includes(x)),s.v);
    ok(T+'all 5 trades kept byte-for-byte fields',s.trades.length===5&&s.trades.every(t=>t.fees==='4'&&t.strategy==='Old strat'&&t.exits[0].price===110),s.trades.length); ok(T+'both accounts kept, names unchanged',s.accounts.length===2&&s.accounts.some(a=>a.name==='Old Account')&&s.accounts.some(a=>a.name==='Apex 50K'));
    ok(T+'audit log kept',s.audit.some(a=>a.id==='au1')); ok(T+(ver>=2?'ledger entry kept':'ledger store created empty'),ver>=2?s.ledger.length===1&&s.ledger[0].amountCents===15000:s.ledger.length===0);
    ok(T+(ver>=3?'docs kept':'docs store created empty'),ver>=3?s.docs.some(d=>d.id==='str-old')&&s.docs.some(d=>d.id==='pref-x'):s.docs.length===0);
    // app screens work on migrated data
    await p.evaluate(()=>TTNav.go('journal')); await until(p,()=>/Old strat|NQ/.test(document.getElementById('view-journal').innerText)); ok(T+'journal shows migrated trades',await p.evaluate(()=>/NQ/.test(document.getElementById('view-journal').innerText)),await p.evaluate(()=>document.getElementById('view-journal').innerText.slice(0,200)));
    await p.evaluate(()=>TTNav.go('analytics')); await p.waitForSelector('#anRoot .panel'); ok(T+'analytics computes from migrated trades (5 trades)',/5/.test(await p.innerText('#anRoot')));
    await p.evaluate(()=>TTNav.go('health')); await p.waitForSelector('#hlRoot .panel'); const ht=await p.innerText('#hlRoot'); ok(T+'health check clean after migration',/ALL GOOD/i.test(ht),ht);
    // new features write fine on the migrated db
    await p.evaluate(async()=>{ await TTStore.save({kind:'goal',metric:'pnl',period:'week',target:100,title:'g'}); }); ok(T+'new docs can be saved',(await p.evaluate(()=>TTStore.list('goal').then(l=>l.length)))===1);
    // idempotent: reload does not duplicate or change anything
    await p.reload(); await p.evaluate(()=>TTDB.ready()); const after=await p.evaluate(async()=>({t:await TTDB.count('trades'),a:await TTDB.count('accounts')})); ok(T+'second load changes nothing',after.t===5&&after.a===2,after);
    ok(T+'no js errors',errors.length===0,errors); await ctx.close();
  }
  // legacy localStorage journal copy, original untouched
  { const ctx=await browser.newContext(); const p=await ctx.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message)); await p.goto(BLANK); await p.evaluate(async()=>{ await new Promise(r=>{ const q=indexedDB.deleteDatabase('tt-platform'); q.onsuccess=q.onerror=q.onblocked=()=>r(); }); localStorage.setItem('tt.journal.v1',JSON.stringify([{id:'L1',date:'2026-01-02',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,exits:[{qty:1,price:105}],createdAt:1},{id:'L2',date:'bad'}])); });
    const raw=await p.evaluate(()=>localStorage.getItem('tt.journal.v1')); await p.goto(URL); await p.evaluate(()=>TTDB.ready()); const r=await p.evaluate(async()=>({t:await TTDB.count('trades'),q:await TTDB.getAll('quarantine')}));
    ok('legacy: valid trade copied, bad one quarantined (kept)',r.t===1&&r.q.length>=1,r); ok('legacy: original localStorage entry untouched',(await p.evaluate(()=>localStorage.getItem('tt.journal.v1')))===raw); ok('legacy: no errors',errors.length===0,errors); await ctx.close(); }
  await browser.close(); console.log(`mig1e2e: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
