const { chromium } = require('playwright');
const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0; const ok=(n,c,d)=>{ if(!c) fail++; console.log(c?'ok  ':'FAIL',n, c?'':'\n     '+(d===undefined?'':JSON.stringify(d))); };
(async()=>{
  const browser=await chromium.launch(); const errors=[];
  async function fresh(){ const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message)); return {ctx,p}; }
  // A) legacy journal with 2 good trades + 1 bad record gets copied, original untouched
  let {ctx,p}=await fresh();
  await p.goto(URL); await p.evaluate(()=>{ localStorage.clear(); });
  const legacy=await p.evaluate(()=>{ const C=TTJournalCore; const mk=o=>C.normalizeTrade(Object.assign({contract:'MNQ',side:'long',contracts:1,entry:'100',stop:'95'},o)).trade;
    const t=[mk({id:'l1',date:'2026-10-20',exits:[{qty:1,price:'110'}],fees:'1'}),mk({id:'l2',date:'2026-10-21',exits:[{qty:1,price:'90'}]})];
    const raw=JSON.stringify({v:1,trades:[...t,{id:'junk'}]}); localStorage.setItem(C.STORE_KEY,raw); return raw; });
  // wipe the db created by the first load so migration runs on legacy data
  await p.evaluate(()=>new Promise(r=>{ const q=indexedDB.deleteDatabase('tt-platform'); q.onsuccess=q.onerror=q.onblocked=()=>r(); }));
  await p.reload(); await p.waitForFunction(()=>window.TTDB); 
  const r=await p.evaluate(async()=>{ await TTDB.ready(); return {trades:(await TTDB.getAll('trades')).map(t=>t.id).sort(), q:(await TTDB.getAll('quarantine')).length, accts:(await TTDB.getAll('accounts')).length, meta:await TTDB.getMeta('legacyMigrated'), ls:localStorage.getItem('tt.journal.v1'), acct:(await TTDB.getAll('trades')).map(t=>t.accountId)}; });
  ok('migrated 2 valid trades',JSON.stringify(r.trades)===JSON.stringify(['l1','l2']),r.trades);
  ok('rejected record quarantined, not lost',r.q===1,r.q);
  ok('default account created',r.accts===1);
  ok('trades assigned to default account',r.acct.every(a=>a==='acct-default'),r.acct);
  ok('legacy localStorage byte-identical',r.ls===legacy);
  ok('migration recorded',r.meta&&r.meta.trades===2&&r.meta.rejected===1,r.meta);
  // B) migration runs once: adding legacy later does not double-import
  await p.evaluate(()=>localStorage.setItem('tt.journal.v1',JSON.stringify({v:1,trades:[]})));
  await p.reload(); await p.waitForFunction(()=>window.TTDB);
  const n=await p.evaluate(async()=>{await TTDB.ready(); return TTDB.count('trades');}); ok('second load does not re-import or lose',n===2,n);
  // C) UI shows migrated trades; add + delete persists across reload and does not touch localStorage
  await p.click('nav [data-view="journal"], [data-nav="journal"], a[href="#journal"]').catch(()=>{});
  const bodyHas=await p.evaluate(async()=>{ await TTDB.ready(); return TTJournalCore.analyze((await TTDB.getAll('trades'))).length; }); ok('core reads migrated trades',bodyHas===2);
  const lsBefore=await p.evaluate(()=>localStorage.getItem('tt.journal.v1'));
  await p.evaluate(async()=>{ const t=TTJournalCore.normalizeTrade({id:'new1',date:'2026-10-27',contract:'ES',side:'short',contracts:1,entry:'5000',exits:[{qty:1,price:'4990'}]}).trade; await TTDB.put('trades',t); });
  await p.reload(); await p.waitForFunction(()=>window.TTDB);
  const n2=await p.evaluate(async()=>{await TTDB.ready(); return {c:await TTDB.count('trades'), ls:localStorage.getItem('tt.journal.v1')};});
  ok('new trade persisted across reload',n2.c===3,n2.c); ok('localStorage unchanged by new writes',n2.ls===lsBefore);
  // D) corrupt legacy data is quarantined verbatim
  await ctx.close(); ({ctx,p}=await fresh());
  await p.goto(URL); await p.evaluate(()=>{ localStorage.setItem('tt.journal.v1','{not json'); });
  await p.evaluate(()=>new Promise(r=>{ const q=indexedDB.deleteDatabase('tt-platform'); q.onsuccess=q.onerror=q.onblocked=()=>r(); }));
  await p.reload(); await p.waitForFunction(()=>window.TTDB);
  const d=await p.evaluate(async()=>{await TTDB.ready(); const q=await TTDB.getAll('quarantine'); return {q:q.map(x=>x.raw), n:await TTDB.count('trades'), ls:localStorage.getItem('tt.journal.v1')};});
  ok('corrupt journal quarantined verbatim',d.q[0]==='{not json'&&d.n===0&&d.ls==='{not json',d);
  // E) atomic batch rollback: a failing op leaves nothing written
  const a=await p.evaluate(async()=>{ try{ await TTDB.batch([{store:'trades',type:'put',value:{id:'x',date:'2026-01-01'}},{store:'trades',type:'bogus'}]); }catch(e){} return TTDB.count('trades'); });
  ok('failed batch writes nothing',a===0,a);
  // F) service worker + manifest valid
  const m=await p.evaluate(async()=>{const r=await fetch('manifest.webmanifest'); const j=await r.json(); const ic=await Promise.all(j.icons.map(i=>fetch(i.src).then(x=>x.status))); return {name:j.name,ic}; });
  ok('manifest + icons load',m.name==='TRC'&&m.ic.every(s=>s===200),m);
  const csp=await p.evaluate(()=>document.querySelector('meta[http-equiv="Content-Security-Policy"]').content); ok('CSP present',/default-src 'self'/.test(csp));
  ok('no page errors',errors.length===0,errors);
  await browser.close(); console.log(fail?('FAILED '+fail):'ALL PASSED'); process.exit(fail?1:0);
})();
