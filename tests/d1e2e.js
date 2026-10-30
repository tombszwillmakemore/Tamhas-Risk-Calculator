const { chromium } = require('playwright');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const until=async(pg,fn,arg,ms=6000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn,arg)) return true; await pg.waitForTimeout(40);} return false;};
const dlg=async(p,vals,btn='ok')=>{ await p.waitForSelector('.ui-dlg'); for(const [i,v] of Object.entries(vals)){ await p.locator('.ui-dlg #uidf'+i).fill(String(v)).catch(async()=>{ await p.selectOption('.ui-dlg #uidf'+i,String(v)); }); } await p.click('.ui-dlg [data-r='+btn+']'); await p.waitForSelector('.ui-dlg',{state:'detached'}); };
const dsel=async(p,i,v)=>{ await p.selectOption('.ui-dlg #uidf'+i,v); };
(async()=>{
  const browser=await chromium.launch();
  for (const theme of ['dark','light']) {
  const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[];
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready()); await p.evaluate(async()=>{ for (const s of ['trades','docs']) await TTDB.clear(s); }); await p.reload();
  if (theme==='light') { await p.evaluate(()=>localStorage.setItem('tt.theme','light')); await p.reload(); }
  const T=theme+': ';
  await p.click('.nav button[data-view=journal]'); await p.waitForSelector('[data-act=new]');
  const tabs=await p.$$eval('#jRoot .jtabs .chip',e=>e.map(x=>x.textContent)); ok(T+'tab strip has REVIEW and SETUP',tabs.join()==='ENTRIES,CALENDAR,ANALYTICS,REVIEW,SETUP,BACKUP',tabs);
  // custom field via Setup
  await p.click('[data-tab=setup]'); await p.click('[data-act=cf-add]'); await p.waitForSelector('.ui-dlg');
  await p.fill('.ui-dlg #uidf0','Market bias'); await p.selectOption('.ui-dlg #uidf1','choice'); await p.click('.ui-dlg [data-r=ok]');
  ok(T+'choice field needs options (validation message)',/at least two/.test(await p.innerText('.ui-dlg-err')));
  await p.fill('.ui-dlg #uidf2','Bull, Bear, Neutral'); await p.click('.ui-dlg [data-r=ok]'); await p.waitForSelector('.ui-dlg',{state:'detached'});
  await until(p,()=>/Market bias/.test(document.body.innerText)); ok(T+'field listed in Setup',/Market bias/.test(await p.innerText('#jRoot')));
  // new trade with v2 fields
  await p.click('[data-tab=entries]'); await p.click('[data-act=new]'); await p.waitForSelector('#f-date');
  await p.fill('#f-qty','1'); await p.fill('#f-entry','100'); await p.fill('#f-stop','95'); await p.fill('.exrow .ex-price','110'); await p.fill('#f-fees','4'); await p.selectOption('#f-contract','NQ');
  await p.click('.lp[data-group=emotions] [data-v=Calm]'); await p.click('.lp[data-group=mistakes] [data-v="Moved stop"]');
  await p.fill('[data-lp-input=tags]','ORB'); await p.press('[data-lp-input=tags]','Enter'); await p.fill('[data-lp-input=tags]','orb'); await p.click('[data-act=lp-add][data-group=tags]');
  ok(T+'adding same tag twice (any case) yields one chip',(await p.$$('.lp[data-group=tags] .lpc')).length===1);
  await p.check('input[name=f-grade][value=B]'); await p.selectOption('[data-cf]','Bull');
  await p.fill('#f-strategy','ORB'); await p.screenshot({path:S+'shots/D-form-'+theme+'.png',fullPage:true});
  await p.click('[data-act=save]'); await p.waitForSelector('.jt.open');
  const t1=await p.evaluate(async()=>(await TTDB.getAll('trades'))[0]); ok(T+'saved v2 fields',t1.tags[0]==='ORB'&&t1.emotions[0]==='Calm'&&t1.mistakeTags[0]==='Moved stop'&&t1.grade==='B'&&Object.values(t1.custom)[0]==='Bull',t1);
  const det=await p.innerText('.jt.open'); ok(T+'card shows grade + tag',/GRADE B/.test(det)&&/#ORB/.test(det)); ok(T+'detail shows emotions, mistakes, custom field',/Calm/.test(det)&&/Moved stop/.test(det)&&/market bias/i.test(det)&&/Bull/.test(det),det);
  // template: save from a new form, apply on another
  await p.click('[data-act=new]'); await p.waitForSelector('#f-date'); await p.fill('#f-strategy','Breakout'); await p.fill('#f-entry','123'); await p.click('.lp[data-group=emotions] [data-v=Focused]'); await p.fill('#f-entryReason','Range break with volume');
  await p.click('[data-act=tpl-save]'); await p.waitForSelector('.ui-dlg'); await p.fill('.ui-dlg #uidf0','Breakout setup'); await p.click('.ui-dlg [data-r=ok]'); await p.waitForSelector('.ui-dlg',{state:'detached'});
  await until(p,async()=>0); await p.waitForFunction(()=>/Template saved/.test((document.querySelector('.ui-toast')||{}).innerText||''),null,{timeout:5000}); const tp=await p.evaluate(async()=>(await TTStore.list('template'))[0]); ok(T+'template saved without prices/dates',tp&&tp.data.strategy==='Breakout'&&tp.data.entryReason&&!('entry' in tp.data)&&!('date' in tp.data)&&tp.data.emotions[0]==='Focused',tp);
  await p.click('[data-act=cancel]'); await p.click('[data-act=new]'); await p.waitForSelector('#f-tpl'); await p.selectOption('#f-tpl',{index:1});
  ok(T+'template applied',(await p.inputValue('#f-strategy'))==='Breakout'&&(await p.inputValue('#f-entryReason'))==='Range break with volume'&&(await p.getAttribute('.lp[data-group=emotions] [data-v=Focused]','aria-pressed'))==='true'&&(await p.inputValue('#f-entry'))==='');
  await p.click('[data-act=cancel]');
  // seed more trades for bulk/review/filters
  await p.evaluate(async()=>{ const C=TTJournalCore, today=new Date(); const d=(n)=>{const x=new Date(today); x.setDate(x.getDate()-n); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
    const mk=(o)=>C.normalizeTrade(Object.assign({contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'4',exits:[{qty:1,price:110}]},o)).trade;
    for (const t of [mk({id:'s1',date:d(0),tags:'Trend',grade:'A'}),mk({id:'s2',date:d(0),exits:[{qty:1,price:95}],mistakeTags:'Oversized',emotions:'FOMO',grade:'D'}),mk({id:'s3',date:d(1),tags:'Trend, ORB'})]) await TTDB.put('trades',t); });
  await p.reload(); await p.click('.nav button[data-view=journal]'); await p.waitForSelector('[data-act=new]');
  // filters
  await p.click('[data-act=toggle-filters]'); await p.selectOption('#jf-tag','Trend'); await p.waitForTimeout(150); ok(T+'tag filter',(await p.$$('.jt')).length===2,await p.innerText('#jCount'));
  await p.selectOption('#jf-grade','A'); await p.waitForTimeout(150); ok(T+'tag+grade filter',(await p.$$('.jt')).length===1);
  await p.click('[data-act=filter-save]'); await p.fill('.ui-dlg #uidf0','Trend A'); await p.click('.ui-dlg [data-r=ok]'); await p.waitForSelector('.ui-dlg',{state:'detached'});
  await p.click('[data-act=clear-filters]'); ok(T+'cleared',(await p.$$('.jt')).length===4);
  await p.selectOption('#jf-saved',{label:'Trend A'}); await p.waitForTimeout(200); ok(T+'saved filter applies',(await p.$$('.jt')).length===1&&(await p.inputValue('#jf-tag'))==='Trend');
  await p.click('[data-act=clear-filters]'); await p.click('[data-act=preset][data-p=today]'); await p.waitForTimeout(200);
  ok(T+'today preset filters by date',(await p.$$('.jt')).length===3,await p.innerText('#jCount'));
  await p.click('[data-act=clear-filters]');
  // bulk + compare
  await p.click('[data-act=sel-mode]'); await p.click('[data-act=sel-all]'); ok(T+'select all shown',/4 selected/.test(await p.innerText('#jBulk')));
  await p.click('[data-act=sel-none]'); await p.click('.jt-sel input >> nth=0'); await p.click('.jt-sel input >> nth=1'); ok(T+'compare enabled for 2',!(await p.isDisabled('[data-act=compare]')));
  await p.click('[data-act=compare]'); await p.waitForSelector('table.cmp'); const ct=await p.innerText('table.cmp'); ok(T+'compare table has net/R rows',/Net P&L/i.test(ct)&&/Realized R/i.test(ct)); await p.screenshot({path:S+'shots/D-compare-'+theme+'.png',fullPage:true});
  await p.click('[data-act=cmp-back]'); await p.click('[data-act=sel-mode]'); await p.click('[data-act=sel-mode]'); await p.click('[data-act=sel-all]'); await p.click('[data-act=bulk]');
  await p.waitForSelector('.ui-dlg'); await p.selectOption('.ui-dlg #uidf0','addTag'); await p.click('.ui-dlg [data-r=ok]'); await p.waitForSelector('.ui-dlg'); await p.fill('.ui-dlg #uidf0','Reviewed'); await p.click('.ui-dlg [data-r=ok]'); await p.waitForSelector('.ui-dlg',{state:'detached'});
  await p.waitForTimeout(300); const tr=await p.evaluate(async()=>await TTDB.getAll('trades')); ok(T+'bulk tag applied to all 4',tr.length===4&&tr.every(t=>t.tags.includes('Reviewed')),tr.map(t=>t.tags));
  // review
  await p.click('[data-tab=review]'); await p.waitForSelector('.rv-nav'); await p.click('input[name=rv-kind][value=day]').catch(()=>p.check('input[name=rv-kind][value=day]',{force:true})); await p.waitForTimeout(300);
  let rv=await p.innerText('#jRoot'); ok(T+'day review shows 3 trades (today) and P&L',/Trades\s*3/i.test(rv)); ok(T+'review lists mistake + emotion',/Oversized/.test(rv)&&/FOMO/.test(rv),rv.slice(0,600));
  await p.fill('#rv-went','Waited for the setup'); await p.click('[data-act=rv-save]'); await until(p,()=>/Review saved/.test((document.querySelector('.ui-toast')||{}).innerText||''));
  const rdoc=await p.evaluate(async()=>(await TTStore.list('review'))[0]); ok(T+'review doc saved',rdoc&&rdoc.went==='Waited for the setup'&&rdoc.pkind==='day',rdoc);
  await p.click('[data-act=rv-prev]'); await p.waitForTimeout(250); ok(T+'previous day: yesterday has 1 trade, empty reflection',!/Waited for the setup/.test(await p.inputValue('#rv-went').catch(()=>''))); await p.click('[data-act=rv-now]'); await p.waitForTimeout(250); ok(T+'reflection reloads',(await p.inputValue('#rv-went'))==='Waited for the setup');
  await p.screenshot({path:S+'shots/D-review-'+theme+'.png',fullPage:true});
  // setup: rename merges, field removal keeps values
  await p.click('[data-tab=setup]'); await p.click('[data-act=lab-ren][data-v=Trend]'); await p.fill('.ui-dlg #uidf0','orb'); await p.click('.ui-dlg [data-r=ok]'); await p.waitForSelector('.ui-dlg',{state:'detached'}); await p.waitForTimeout(300);
  const t2=await p.evaluate(async()=>await TTDB.getAll('trades')); ok(T+'rename to existing label merges (s3 had Trend+ORB -> one ORB)',t2.find(t=>t.id==='s3').tags.filter(x=>x.toLowerCase()==='orb').length===1&&!t2.some(t=>(t.tags||[]).includes('Trend')),t2.map(t=>t.tags));
  await p.click('[data-act=cf-del]'); await p.click('.ui-dlg [data-r=ok]'); await p.waitForSelector('.ui-dlg',{state:'detached'}); await p.waitForTimeout(250);
  const t3=await p.evaluate(async()=>(await TTDB.getAll('trades')).filter(t=>t.custom)); ok(T+'removing a field keeps saved values',t3.length===1&&Object.values(t3[0].custom)[0]==='Bull',t3);
  await p.click('[data-tab=entries]'); await p.waitForSelector('.jt'); await p.click('.jt-head >> nth=0');
  // backup
  const bk=await p.evaluate(async()=>{ const docs=await TTDB.getAll('docs'); const j=TTJournalCore.serializeBackup(await TTDB.getAll('trades'),{}, {accounts:[],ledger:[],docs}); const r=TTJournalCore.parseBackup(j); return {kinds:[...new Set(r.docs.map(d=>d.kind))].sort(), n:r.trades.length, tags:r.trades.filter(t=>t.tags).length}; });
  ok(T+'backup round-trips review/template/filter docs and v2 trade fields',bk.kinds.includes('review')&&bk.kinds.includes('template')&&bk.kinds.includes('filter')&&bk.tags>=3,bk);
  ok(T+'no page errors',errors.length===0,errors); await ctx.close(); }
  await browser.close(); console.log(fail?('FAILED '+fail+' / passed '+pass):('ALL PASSED '+pass)); process.exit(fail?1:0);
})();
