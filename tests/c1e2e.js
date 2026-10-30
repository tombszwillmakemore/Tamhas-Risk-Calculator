const { chromium } = require('playwright');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const until=async(pg,fn,arg,ms=6000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn,arg)) return true; await pg.waitForTimeout(40);} return false;};
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[];
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready()); await p.evaluate(async()=>{ await TTDB.clear('trades'); }); await p.reload();
  await p.click('.nav button[data-view=journal]'); await p.click('[data-act=new]'); await p.waitForSelector('#f-date');
  ok('times hidden by default',!(await p.isVisible('.exrow .ex-time')));
  await p.fill('#f-qty','2'); await p.fill('#f-entry','100'); await p.fill('#f-stop','95');
  await p.click('[data-act=sc-add]'); await p.fill('#scList .scrow:nth-child(1) .sc-qty','1'); await p.fill('#scList .scrow:nth-child(1) .sc-price','103');
  ok('lone exit row auto-follows total (3)',(await p.inputValue('.exrow .ex-qty'))==='3');
  await p.fill('.exrow .ex-price','105'); await p.waitForTimeout(150);
  const prev=await p.innerText('#fPreview'); ok('preview: closed, gross computed FIFO ((105-100)x2 + (105-103)) x $2 = $2.40 on the default NNQ ($0.20/pt)',/\$2\.40/.test(prev)&&/CLOSED/i.test(prev),prev);
  ok('preview shows risk (2x5+1x8)=18pts x $2 = $36',/\$3\.60/.test(prev),prev);
  await p.click('[data-act=fill-times]'); ok('fill times toggle shows time inputs',await p.isVisible('.exrow .ex-time')&&await p.isVisible('.scrow .sc-time'));
  await p.fill('.scrow .sc-time','09:40'); await p.fill('.exrow .ex-time','10:15');
  // bad stop: above an entry
  await p.fill('#f-stop','101'); await p.waitForTimeout(150); ok('stop above entry flagged in preview',/below/.test(await p.innerText('#fPreview')),await p.innerText('#fPreview')); await p.fill('#f-stop','95');
  await p.click('[data-act=save]'); await p.waitForSelector('.jt.open');
  const saved=await p.evaluate(async()=>(await TTDB.getAll('trades'))[0]);
  ok('saved as multi-fill trade',saved.entries&&saved.entries.length===2&&saved.contracts===3&&saved.entry===101&&saved.entries[1].time==='09:40'&&saved.exits[0].time==='10:15',saved);
  const det=await p.innerText('.jt.open'); ok('detail lists entries, avg and exit time',/2 @ 100/.test(det)&&/1 @ 103/.test(det)&&/avg 101/.test(det)&&/3 @ 105 \(10:15\)/.test(det),det.slice(0,600));
  ok('journal analytics counts it as closed win $2.40',/\$2\.40/.test(det));
  // edit round trip keeps scale-in + times + provenance fields
  await p.evaluate(async()=>{ const t=(await TTDB.getAll('trades'))[0]; t.srcKeys=['kk1']; t.importBatch='imp-x'; await TTDB.put('trades',t); }); await p.reload();
  await p.click('.nav button[data-view=journal]'); await p.click('.jt-head'); await p.click('[data-act=edit]'); await p.waitForSelector('#f-date');
  ok('edit form restores first entry + scale-in + times mode',(await p.inputValue('#f-qty'))==='2'&&(await p.inputValue('#f-entry'))==='100'&&(await p.inputValue('.scrow .sc-qty'))==='1'&&(await p.inputValue('.scrow .sc-price'))==='103'&&await p.isVisible('.scrow .sc-time')&&(await p.inputValue('.scrow .sc-time'))==='09:40');
  await p.fill('#f-notes','edited'); await p.click('[data-act=save]'); await p.waitForSelector('.jt.open');
  const after=await p.evaluate(async()=>(await TTDB.getAll('trades'))[0]); ok('editing keeps entries, srcKeys and importBatch',after.entries.length===2&&after.srcKeys&&after.srcKeys[0]==='kk1'&&after.importBatch==='imp-x'&&after.notes==='edited',after);
  // remove scale-in -> legacy single entry
  await p.click('[data-act=edit]'); await p.waitForSelector('#f-date'); await p.click('[data-act=sc-del]'); await p.fill('.exrow .ex-qty','2'); await p.click('[data-act=save]'); await p.waitForSelector('.jt.open');
  const one=await p.evaluate(async()=>(await TTDB.getAll('trades'))[0]); ok('removing scale-in returns to a plain single-entry trade',!one.entries&&one.contracts===2&&one.entry===100,one);
  ok('no page errors',errors.length===0,errors);
  await p.click('[data-act=edit]'); await p.waitForSelector('#f-date'); await p.click('[data-act=sc-add]'); await p.click('[data-act=fill-times]'); await p.screenshot({path:S+'shots/C-form.png'});
  console.log(fail?'FAILED':'ALL PASSED',pass,'passed,',fail,'failed'); await browser.close(); process.exit(fail?1:0);
})();
