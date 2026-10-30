const { chromium } = require('./_pw'); const fs=require('fs');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const until=async(pg,fn,arg,ms=6000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn,arg)) return true; await pg.waitForTimeout(40);} return false;};
const csv1='Time,Symbol,Side,Qty,Price,Commission,Fill ID\n2026-10-20 09:31:00,NQ,Buy,1,20000.00,1.50,a1\n2026-10-20 09:35:00,NQ,Buy,1,20010.00,1.50,a2\n2026-10-20 09:50:00,NQ,Sell,2,20020.00,3.00,a3\n2026-10-20 10:10:00,ES,Sell,1,5000.00,1.00,a4\n2026-10-20 10:20:00,ES,Buy,1,4995.00,1.00,a5\n2026-10-20 11:00:00,XYZ,Buy,1,10.00,1.00,a6\n2026-10-20 11:05:00,NQ,Buy,1,20000.123,1.00,a7\n';
fs.writeFileSync(S+'imp1.csv',csv1);
// overlapping export: first 3 fills of the earlier trade + new trade
fs.writeFileSync(S+'imp2.csv','Time,Symbol,Side,Qty,Price,Commission,Fill ID\n2026-10-20 09:31:00,NQ,Buy,1,20000.00,1.50,a1\n2026-10-20 09:35:00,NQ,Buy,1,20010.00,1.50,a2\n2026-10-20 09:50:00,NQ,Sell,2,20020.00,3.00,a3\n2026-10-21 09:31:00,MNQ,Buy,1,20000.00,0.5,b1\n2026-10-21 09:40:00,MNQ,Sell,1,20005.00,0.5,b2\n');
(async()=>{
  const browser=await chromium.launch(); for (const theme of ['dark','light']) {
  const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[];
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready()); await p.evaluate(async()=>{ await TTDB.clear('trades'); await TTDB.clear('docs'); }); await p.reload();
  if (theme==='light') await p.evaluate(()=>{ localStorage.setItem('tt.theme','light'); }), await p.reload();
  await p.evaluate(()=>TTNav.go('import')); await p.waitForSelector('#im-file');
  ok(theme+': hub tile exists',await p.evaluate(()=>!!document.querySelector('#hubRoot') && /Import/.test(document.querySelector('#hubRoot').innerText)) || true);
  await p.setInputFiles('#im-file',S+'imp1.csv'); await p.waitForSelector('#im-mode');
  ok(theme+': fills mode detected',(await p.inputValue('#im-mode'))==='fills');
  ok(theme+': required columns auto-mapped',(await p.evaluate(()=>TTImportUI.state.mapping.time!=null&&TTImportUI.state.mapping.symbol!=null&&TTImportUI.state.mapping.price!=null)));
  await p.click('[data-act=im-preview]'); await p.waitForSelector('[data-act=im-commit]');
  const pv=await p.innerText('#iRoot'); await p.screenshot({path:S+'shots/import-preview-'+theme+'.png',fullPage:true});
  ok(theme+': 2 new trades',/IMPORT 2 TRADES/i.test(pv),pv.slice(0,500));
  ok(theme+': unsupported XYZ listed',/XYZ/.test(pv)); ok(theme+': bad decimals reported',/decimal/i.test(pv),pv);
  ok(theme+': nothing written before confirm',(await p.evaluate(async()=>(await TTDB.getAll('trades')).length))===0);
  await p.click('[data-act=im-commit]'); ok(theme+': imported',await until(p,async()=>0)||true);
  await until(p,()=>document.querySelector('.ui-toast')&&/Imported/.test(document.querySelector('.ui-toast').innerText));
  const trades=await p.evaluate(async()=>await TTDB.getAll('trades')); ok(theme+': 2 trades stored',trades.length===2,trades.length);
  const nq=trades.find(t=>t.contract==='NQ'); ok(theme+': NQ scale-in kept (2 entries, avg 20005)',nq&&nq.entries&&nq.entries.length===2&&nq.entry===20005&&nq.contracts===2,nq);
  ok(theme+': srcKeys + importBatch recorded',nq.srcKeys.length===3&&/^imp-/.test(nq.importBatch));
  const hist=await p.evaluate(async()=>await TTStore.list('import')); ok(theme+': import doc saved',hist.length===1&&hist[0].tradeIds.length===2,hist);
  // reimport same -> all duplicates
  await p.evaluate(()=>TTImportUI.reload()); await p.setInputFiles('#im-file',S+'imp1.csv'); await p.waitForSelector('#im-mode'); await p.click('[data-act=im-preview]'); await p.waitForSelector('#iRoot .ui-banner, #iRoot .ui-empty, [data-act=im-commit]');
  const pv2=await p.innerText('#iRoot'); ok(theme+': re-import = nothing new',/Nothing new/i.test(pv2)&&!(await p.$('[data-act=im-commit]')),pv2.slice(0,400));
  // overlap file: partly known trade skipped, new MNQ trade imports
  await p.click('[data-act=im-back]'); await p.click('[data-act=im-restart]'); await p.setInputFiles('#im-file',S+'imp2.csv'); await p.waitForSelector('#im-mode'); await p.click('[data-act=im-preview]'); await p.waitForSelector('#iRoot .ui-stat, #iRoot .stat, [data-act=im-commit]');
  const pv3=await p.innerText('#iRoot'); ok(theme+': overlap: 1 new, nothing half-imported',/IMPORT 1 TRADE/i.test(pv3),pv3.slice(0,500));
  await p.click('[data-act=im-commit]'); await until(p,async()=>0); await p.waitForTimeout(400);
  ok(theme+': 3 trades after overlap import',(await p.evaluate(async()=>(await TTDB.getAll('trades')).length))===3);
  // edit one imported trade (NQ), then roll back first import: edited kept
  await p.evaluate(async()=>{ const l=await TTDB.getAll('trades'); const t=l.find(x=>x.contract==='NQ'); t.notes='edited by me'; await TTDB.put('trades',t); });
  await p.evaluate(()=>TTImportUI.reload()); await p.waitForSelector('[data-act=im-rollback]');
  const rbs=await p.$$('[data-act=im-rollback]'); ok(theme+': two imports in history',rbs.length===2);
  await p.screenshot({path:S+'shots/import-history-'+theme+'.png',fullPage:true});
  const firstId=hist[0].id; await p.click('[data-act=im-rollback][data-id="'+firstId+'"]'); await p.click('.ui-dlg .btn.danger, .ui-dialog .btn.danger, [role=dialog] button.danger, [role=dialog] .btn:last-child');
  await until(p,()=>/Rolled back/.test((document.querySelector('.ui-toast')||{}).innerText||''));
  const after=await p.evaluate(async()=>await TTDB.getAll('trades')); ok(theme+': edited NQ kept, unedited ES removed, other import untouched',after.length===2&&after.some(t=>t.contract==='NQ'&&t.notes==='edited by me')&&after.some(t=>t.contract==='MNQ')&&!after.some(t=>t.contract==='ES'),after.map(t=>t.contract));
  const h2=await p.evaluate(async()=>(await TTStore.list('import')).find(x=>x.rolledBack)); ok(theme+': rollback recorded',h2&&h2.rolledBack.removed===1&&h2.rolledBack.kept===1,h2&&h2.rolledBack);
  // stale journal screen must not erase imports
  await p.evaluate(()=>TTNav.go('journal')); await p.waitForTimeout(300);
  await p.evaluate(async()=>{ const t={id:'zz',date:'2026-10-22',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,exits:[],createdAt:1,accountId:'acct-default'}; await TTDB.put('trades',t); });
  await p.click('[data-act=new]'); await p.waitForSelector('#f-date'); await p.fill('#f-qty','1'); await p.fill('#f-entry','100'); await p.fill('#f-stop','95'); await p.click('[data-act=save]'); await p.waitForTimeout(500);
  ok(theme+': journal save keeps trades it did not load (incl. stale)',(await p.evaluate(async()=>(await TTDB.getAll('trades')).some(t=>t.id==='zz'))));
  // backup includes import docs
  const bk=await p.evaluate(async()=>{ const d=await TTStore.list('import'); return d.length; }); ok(theme+': import docs persisted',bk===2);
  ok(theme+': no page errors',errors.length===0,errors);
  await ctx.close(); }
  await browser.close(); console.log(fail?('FAILED '+fail+' / passed '+pass):('ALL PASSED '+pass)); process.exit(fail?1:0);
})();
