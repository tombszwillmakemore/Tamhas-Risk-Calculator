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
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready()); await p.evaluate(async()=>{ for (const s of ['trades','docs']) await TTDB.clear(s); }); if(theme==='light') await p.evaluate(()=>localStorage.setItem('tt.theme','light')); await p.reload();
  await p.evaluate(()=>TTNav.go('more')); ok(T+'hub tile',/Strategy lab/.test(await p.innerText('#hubRoot')));
  await p.evaluate(()=>TTNav.go('strategy')); await p.waitForSelector('#stRoot [data-act=st-new]'); ok(T+'empty state',/No strategies yet/.test(await p.innerText('#stRoot')));
  // journal trades: 24 ORB trades, 2 per day, mixed; plus an unlinked name
  const L=[]; for(let i=0;i<24;i++){ const day=1+Math.floor(i/2); L.push({id:'o'+i,date:'2026-09-'+String(day).padStart(2,'0'),time:i%2?'10:30':'09:45',strategy:i%5===0?'orb':'ORB',exits:[{qty:1,price:i%3===2?95:110}],stop:95,createdAt:i+1}); } L.push({id:'z1',strategy:'Gap fade',exits:[{qty:1,price:110}]}); L.push({id:'z2',strategy:'ORB'});
  await seed(p,L); await p.evaluate(()=>TTStrategyUI.reload());
  ok(T+'unlinked journal name offered',/Gap fade \(1\)/.test(await p.innerText('#stRoot')));
  await p.click('[data-act=st-adopt][data-name="Gap fade"]'); ok(T+'adopt prefills name only',(await p.inputValue('#sf-name'))==='Gap fade'&&!(await p.evaluate(()=>TTStore.list('strategy').then(l=>l.length)))); await p.click('[data-act=st-form-cancel]');
  // create
  await p.click('[data-act=st-new]'); await p.click('[data-act=st-save]'); ok(T+'name required',/Give the strategy a name/.test(await p.innerText('#stRoot')));
  await p.fill('#sf-name','ORB'); await p.selectOption('#sf-status','testing'); await p.fill('#sf-entry','Break of range high\nRetest holds'); await p.fill('#sf-risk','1% max'); await p.click('[data-act=st-save]'); await until(p,async()=>(await TTStore.list('strategy')).length===1);
  await p.waitForSelector('[data-act=st-dtab]'); ok(T+'opens detail with rules',/Break of range high/.test(await p.innerText('#stRoot'))&&/testing/i.test(await p.innerText('#stRoot')));
  await p.click('[data-act=st-back]'); await p.click('[data-act=st-new]'); await p.fill('#sf-name','orb'); await p.click('[data-act=st-save]'); ok(T+'duplicate name (case-insensitive) rejected',/already exists/.test(await p.innerText('#stRoot'))); await p.click('[data-act=st-form-cancel]');
  // journal tab
  await p.click('[data-act=st-open]'); await p.click('[data-act=st-dtab][data-t=live]'); let t=await p.innerText('#stRoot');
  ok(T+'journal: 25 ORB trades found, 1 open, closed with R counted n=24',/25 trades found, 1 still open/.test(t)&&/Results\s*24/i.test(t),t);
  // R: 24 trades; i%3==2 -> -1R (8 losses at 95 => exit 95: (95-100)/5=-1) wins +2R: 16 wins -> exp (32-8)/24=1
  ok(T+'journal expectancy +1.00R',/\+1\.00R/.test(t),t); ok(T+'forward-vs-backtest note when no backtest yet',/forward test vs backtest/i.test(t)&&/both/.test(t));
  // customize hide stats
  await p.click('[data-act=st-sec][data-s=stats]'); ok(T+'hide statistics section',!/Win rate/.test(await p.innerText('#stRoot'))); ok(T+'hidden pref saved',(await p.evaluate(()=>TTStore.getPref('strategy.hidden',[]))).join()==='stats'); await p.click('[data-act=st-sec][data-s=stats]');
  // backtest
  await p.click('[data-act=st-dtab][data-t=backtest]'); ok(T+'backtest states no market data is fetched',/does not download market data/.test(await p.innerText('#stRoot')));
  await p.fill('#bf-date','2026-02-30'); await p.fill('#bf-r','abc'); await p.click('[data-act=st-add]'); ok(T+'bad result rejected with both errors',/Date must be/.test(await p.innerText('#stRoot'))&&/R must be a number/.test(await p.innerText('#stRoot')));
  await p.fill('#bf-date','2026-03-02'); await p.fill('#bf-r','2'); await p.fill('#bf-pnl','250'); await p.click('[data-act=st-add]'); await until(p,async()=>((await TTStore.list('backtest'))[0]||{results:[]}).results.length===1);
  await p.fill('#bp-text','date,r\n2026-03-03,-1\n2026-03-04,2\nnope,1\n2026-03-05,xx'); await p.click('[data-act=st-preview]'); ok(T+'preview: 2 valid, 2 rejected, with line numbers',/2 valid/.test(await p.innerText('#stRoot'))&&/Line 4/.test(await p.innerText('#stRoot'))&&/2 rejected/.test(await p.innerText('#stRoot')));
  ok(T+'preview saved nothing',((await p.evaluate(()=>TTStore.list('backtest')))[0].results.length)===1);
  await p.click('[data-act=st-import]'); await until(p,async()=>((await TTStore.list('backtest'))[0]||{results:[]}).results.length===3);
  // add 25 more via paste
  let big='date,r\n'; for(let i=0;i<30;i++) big+='2026-04-'+String(1+Math.floor(i/2)).padStart(2,'0')+','+(i%3===2?-1:1.5)+'\n'; await p.fill('#bp-text',big); await p.click('[data-act=st-preview]'); await p.click('[data-act=st-import]'); await until(p,async()=>((await TTStore.list('backtest'))[0]||{results:[]}).results.length===33);
  t=await p.innerText('#stRoot'); ok(T+'backtest stats show 33 results',/Results\s*33/i.test(t),t); await p.screenshot({path:S+'shots/H-backtest-'+theme+'.png',fullPage:true});
  await p.click('[data-act=st-rdel] >> nth=0'); await until(p,async()=>((await TTStore.list('backtest'))[0]).results.length===32); ok(T+'remove one entry',true);
  // forward vs backtest on journal tab
  await p.click('[data-act=st-dtab][data-t=live]'); ok(T+'forward vs backtest now compares',/consistent|differ/.test(await p.innerText('#stRoot')),await p.innerText('#stRoot'));
  // simulate
  await p.click('[data-act=st-dtab][data-t=sim]'); await p.click('[data-act=st-mc]'); let o=await p.innerText('#stRoot'); ok(T+'MC from journal (24 results) runs',/typical \(median\)/i.test(o)&&/not a forecast/.test(o),o);
  await p.fill('#mc-h','0'); await p.click('[data-act=st-mc]'); ok(T+'MC bad horizon message',/from 1 to 1000/.test(await p.innerText('#stRoot'))); await p.fill('#mc-h','50'); await p.fill('#mc-dd','4'); await p.click('[data-act=st-mc]'); const o1=await p.innerText('#stRoot'); await p.click('[data-act=st-mc]'); ok(T+'MC same seed -> same output',o1===await p.innerText('#stRoot')&&/hit -4R drawdown/i.test(o1));
  await p.click('[data-act=st-sw][data-k=firstN]'); ok(T+'sweep rows with earlier/later halves + overfit note',/earlier/i.test(await p.innerText('#stRoot'))&&/settings on the same/.test(await p.innerText('#stRoot')));
  await p.click('[data-act=st-sw][data-k=riskcap]'); ok(T+'risk-cap sweep: all same risk -> one row',/no cap/i.test(await p.innerText('#stRoot')));
  await p.click('[data-act=st-src][data-s=backtest]'); await p.click('[data-act=st-mc]'); ok(T+'MC from backtest (32)',/typical \(median\)/i.test(await p.innerText('#stRoot'))); await p.click('[data-act=st-sw][data-k=riskcap]'); ok(T+'risk cap on backtest says needs stops',/recorded stop/.test(await p.innerText('#stRoot')));
  await p.screenshot({path:S+'shots/H-sim-'+theme+'.png',fullPage:true});
  // small sample refusal: a second strategy with 3 results
  await p.click('[data-act=st-back]'); await p.click('[data-act=st-new]'); await p.fill('#sf-name','Tiny'); await p.click('[data-act=st-save]'); await until(p,async()=>(await TTStore.list('strategy')).length===2); await p.click('[data-act=st-dtab][data-t=sim]'); await p.click('[data-act=st-mc]'); ok(T+'MC refuses with no results',/Needs at least 20/.test(await p.innerText('#stRoot')));
  // compare
  await p.click('[data-act=st-back]'); await p.click('[data-act=st-cmp][data-k^="j:"] >> nth=0'); await p.click('[data-act=st-cmp][data-k^="b:"] >> nth=0'); await p.click('[data-act=st-compare]'); t=await p.innerText('#stRoot'); ok(T+'compare shows both sets with ranges',/ORB \(journal\)/i.test(t)&&/ORB \(backtest\)/i.test(t)&&/95% range/i.test(t),t); await p.screenshot({path:S+'shots/H-compare-'+theme+'.png',fullPage:true});
  // delete strategy keeps journal
  await p.click('[data-act=st-back]'); await p.click('[data-act=st-open] >> nth=0'); await p.click('[data-act=st-del]'); await p.click('[data-r=ok]'); await until(p,async()=>(await TTStore.list('strategy')).length===1&&(await TTStore.list('backtest')).length===0);
  ok(T+'delete removes strategy + its backtest, journal trades untouched',(await p.evaluate(()=>TTDB.getAll('trades').then(l=>l.length)))===26);
  ok(T+'no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)); ok(T+'no js errors',errors.length===0,errors);
  await ctx.close();
  }
  await browser.close(); console.log(`h1e2e: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
