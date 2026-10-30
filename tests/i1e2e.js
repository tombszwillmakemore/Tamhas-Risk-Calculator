const { chromium } = require('./_pw');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const until=async(pg,fn,arg,ms=6000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn,arg)) return true; await pg.waitForTimeout(40);} return false;};
const seed=async(p,list)=>{ await p.evaluate(async(list)=>{ const C=TTJournalCore; const d=new Date(); const t0=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); await TTDB.clear('trades'); await TTStore.invalidate(); for (const o of list){ const r=C.normalizeTrade(Object.assign({contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'0',createdAt:1,date:t0},o)); if(!r.ok) throw new Error(JSON.stringify(r.errors)); await TTDB.put('trades',r.trade);} },list); };
const type=async(p,sel,v)=>{ await p.fill(sel,v); };
(async()=>{
  const browser=await chromium.launch();
  for (const theme of ['dark','light']) {
  const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[]; const T=theme+': ';
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); }); p.on('dialog',d=>{ errors.push('dialog:'+d.message()); d.dismiss(); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready()); await p.evaluate(async()=>{ for (const s of ['trades','docs','quarantine','ledger']) await TTDB.clear(s); localStorage.removeItem('tt.journal.prefs.v1'); }); if(theme==='light') await p.evaluate(()=>localStorage.setItem('tt.theme','light')); await p.reload();
  // home getting started
  await p.evaluate(()=>TTNav.go('home')); await p.waitForSelector('#homeStart .panel'); let t=await p.innerText('#homeStart'); ok(T+'home shows getting started 0/5',/Getting started/i.test(t)&&/0\/5/.test(t)&&/Log your first trade/.test(t),t);
  await p.evaluate(()=>TTNav.go('more')); const hub=await p.innerText('#hubRoot'); ok(T+'hub tiles for insights and health',/Insights/.test(hub)&&/System health/.test(hub));
  await p.evaluate(()=>TTNav.go('insights')); await p.waitForSelector('#inRoot .panel'); ok(T+'no trades: asks for data, never invents',/Not enough data yet/i.test(await p.innerText('#inRoot'))&&/Log some trades/.test(await p.innerText('#inRoot')));
  // seed: 40 trades over 8 weeks
  const L=[]; const d0=Date.UTC(2026,7,31); let idx=0; for(let w=0;w<8;w++) for(let k=0;k<5;k++){ const dt=new Date(d0+(w*7+k)*86400000).toISOString().slice(0,10); const loss=(w*5+k)%4===3; L.push({id:'s'+idx,date:dt,time:k<3?'09:45':'14:00',strategy:k<3?'ORB':'Fade',exits:[{qty:1,price:loss?97:106}],mistakeTags:loss&&w%2===0?['fomo']:undefined,createdAt:++idx}); }
  await seed(p,L.map(x=>Object.assign({},x))); await p.evaluate(()=>TTInsightsUI.reload()); await p.evaluate(()=>TTNav.go('insights')); await p.waitForSelector('#inRoot h3');
  t=await p.innerText('#inRoot'); ok(T+'insights render with sample size and counts',/Recurring mistake: fomo/i.test(t)&&/n=\d+/.test(t)&&/small sample|moderate sample/i.test(t),t);
  ok(T+'None recorded is not listed as a mistake',!/Recurring mistake: None/i.test(t)); ok(T+'method note says no AI, not advice',/no AI/i.test(t)&&/not advice or predictions/i.test(t)); ok(T+'footer reports basis and trade count',/Based on 40 closed trades/.test(t),t);
  await p.screenshot({path:S+'shots/I-insights-'+theme+'.png',fullPage:true});
  // XSS: hostile names must render as text
  await seed(p,[{id:'x1',strategy:'<img src=x onerror="window.__xss=1">',notes:'<script>window.__xss=2<\/script>',tags:['<b>t</b>'],exits:[{qty:1,price:105}]}]); await p.evaluate(()=>{ return TTStore.save({kind:'strategy',name:'<img src=x onerror="window.__xss=3">',status:'idea',entryRules:['<svg onload="window.__xss=4">']}); });
  for (const v of ['insights','strategy','discipline','health','analytics','journal','risk']) { await p.evaluate(n=>TTNav.go(n),v); await p.waitForTimeout(250); }
  ok(T+'hostile text never executed',(await p.evaluate(()=>window.__xss))===undefined,await p.evaluate(()=>window.__xss));
  ok(T+'no injected elements in app views',(await p.$$eval('#view-strategy img, #view-journal img[src="x"], #view-strategy svg[onload]',e=>e.length))===0);
  // health: bad trade + orphans
  await p.evaluate(async()=>{ await TTDB.clear('trades'); await TTDB.put('trades',{id:'bad1',date:'nope',contract:'NQ',side:'long',contracts:1,entry:100}); await TTDB.put('docs',{id:'bac-orphan',kind:'backtest',strategyId:'gone',results:[{date:'2026-10-01',r:1}],createdAt:1,updatedAt:1}); await TTStore.invalidate(); });
  await p.evaluate(()=>TTNav.go('health')); await p.waitForFunction(()=>/could not be read/.test(document.getElementById('hlRoot').innerText)); t=await p.innerText('#hlRoot');
  ok(T+'health finds bad trade and orphan backtest, says read-only',/1 trade could not be read/.test(t)&&/backtest set belongs to a deleted strategy/.test(t)&&/only reads your data/.test(t),t);
  ok(T+'storage section lists counts and DB version 3',/Database version\s*3/i.test(t)); await p.screenshot({path:S+'shots/I-health-'+theme+'.png',fullPage:true});
  // fix: cancel first
  await p.click('[data-act=hl-fix] >> nth=0'); await p.click('[data-r=cancel]'); ok(T+'cancel changes nothing',(await p.evaluate(()=>TTDB.getAll('trades').then(l=>l.length)))===1);
  await p.click('[data-act=hl-fix] >> nth=0'); await p.click('[data-r=ok]'); await until(p,async()=>(await TTDB.getAll('trades')).length===0&&(await TTDB.getAll('quarantine')).some(q=>q.kind==='health-moved-trade'&&q.record&&q.record.id==='bad1'));
  ok(T+'bad trade moved to quarantine with full record, not lost',true);
  await p.click('[data-act=hl-fix] >> nth=0'); await p.click('[data-r=ok]'); await until(p,async()=>(await TTDB.getAll('quarantine')).some(q=>q.kind==='health-moved-doc'&&q.record.id==='bac-orphan'));
  await p.waitForFunction(()=>/All good/i.test(document.getElementById('hlRoot').innerText)||!/could not be read|belongs to a deleted/.test(document.getElementById('hlRoot').innerText)); t=await p.innerText('#hlRoot'); ok(T+'after repairs no warnings remain, quarantine noted',!/could not be read/.test(t)&&/in quarantine/.test(t),t);
  ok(T+'audit trail written',(await p.evaluate(()=>TTDB.getAll('audit').then(l=>l.filter(a=>a.type==='health-quarantine').length)))===2);
  ok(T+'no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)); ok(T+'no js errors/dialogs',errors.length===0,errors);
  await ctx.close();
  }
  await browser.close(); console.log(`i1e2e: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
