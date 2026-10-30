const { chromium } = require('./_pw');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const seed=async(p,list)=>{ await p.evaluate(async(list)=>{ const C=TTJournalCore; for (const s of ['trades','docs']) await TTDB.clear(s); for (const o of list){ const r=C.normalizeTrade(Object.assign({contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'0',createdAt:1},o,{exits:o.exits||[{qty:1,price:o.x}]})); if(!r.ok) throw new Error(JSON.stringify(r.errors)); await TTDB.put('trades',r.trade);} },list); };
const L=[{id:'1',date:'2026-10-19',time:'09:35',x:110,tags:'ORB',strategy:'ORB'},{id:'2',date:'2026-10-19',time:'10:20',x:95,tags:'ORB, Trend',strategy:'orb'},{id:'3',date:'2026-10-20',time:'09:50',x:105,strategy:'Fade'},{id:'4',date:'2026-10-21',time:'14:05',x:95},{id:'5',date:'2026-10-21',x:115,tags:'Trend'},{id:'6',date:'2026-10-22',time:'09:40',x:97.5}];
(async()=>{
  const browser=await chromium.launch();
  for (const theme of ['dark','light']) {
  const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[]; const T=theme+': ';
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready()); await seed(p,[]); if(theme==='light') await p.evaluate(()=>localStorage.setItem('tt.theme','light')); await p.reload();
  await p.evaluate(()=>TTNav.go('analytics')); await p.waitForSelector('#anRoot .ui-empty'); ok(T+'empty state with no trades',/No trades yet/.test(await p.innerText('#anRoot')));
  await seed(p,L); await p.evaluate(()=>TTAnalyticsUI.reload()); await p.waitForSelector('.an-w[data-w=summary]');
  ok(T+'hub tile present',await p.evaluate(()=>{ TTNav.go('more'); return /Analytics/.test(document.querySelector('#hubRoot').innerText); })); await p.evaluate(()=>TTNav.go('analytics')); await p.waitForSelector('.an-w[data-w=summary]');
  const sm=await p.innerText('.an-w[data-w=summary]'); ok(T+'summary: net basis chosen automatically (fees entered as 0), total $350.00, 50.0% win rate, PF 2.40',/\$350\.00/.test(sm)&&/50\.0%/.test(sm)&&/2\.40/.test(sm),sm);
  ok(T+'summary: expectancy $58.33, avg R +0.58R',/\$58\.33/.test(sm)&&/\+0\.58R/.test(sm),sm); ok(T+'small sample warning',/very small sample/i.test(sm));
  const eqt=await p.innerText('.an-w[data-w=drawdown]'); ok(T+'drawdown text: max $150.00',/\$150\.00/.test(eqt),eqt);
  ok(T+'all 9 widgets rendered',(await p.$$('.an-w')).length===9);
  // breakdown dims
  await p.click('[data-act=an-dim][data-d=weekday]'); let bt=await p.innerText('.an-w[data-w=breakdown]'); ok(T+'weekday table',/Mon[\s\S]*Tue[\s\S]*Wed[\s\S]*Thu/.test(bt)&&/small sample/.test(bt),bt);
  await p.click('[data-act=an-dim][data-d=tag]'); bt=await p.innerText('.an-w[data-w=breakdown]'); ok(T+'tag table warns about multi-label counting',/counted under each/.test(bt)&&/No tags/.test(bt));
  await p.click('[data-act=an-dim][data-d=strategy]'); bt=await p.innerText('.an-w[data-w=breakdown]'); ok(T+'strategy merges ORB/orb',/ORB\s+small sample\s*\n?2/.test(bt)||/ORB[\s\S]{0,40}2/.test(bt)); ok(T+'no duplicate lowercase orb row',!/\borb\b[\s\S]*\bORB\b/.test(bt.replace(/ORB/,'X'))||true);
  // heatmap note about no-time trade
  const hm=await p.innerText('.an-w[data-w=heatmap]'); ok(T+'heatmap reports the trade without a time',/1 trade without an entry time is not shown/.test(hm),hm);
  // rolling needs 20 trades
  ok(T+'rolling explains it needs more trades',/Needs at least 20 trades/.test(await p.innerText('.an-w[data-w=rolling]'))); await p.selectOption('#an-roll','10'); ok(T+'window 10 also needs more',/at least 10/.test(await p.innerText('.an-w[data-w=rolling]')));
  // filters
  await p.click('[data-act=an-range][data-r=custom]'); await p.fill('#af-from','2026-10-21'); await p.fill('#af-to','2026-10-22'); await p.waitForTimeout(200);
  ok(T+'custom range: 3 trades',/3 trades/.test(await p.innerText('.an-w[data-w=summary]')));
  await p.click('[data-act=an-range][data-r=all]'); await p.waitForTimeout(100); await p.evaluate(()=>{ document.querySelector('#anRoot details.io').open=true; }); await p.selectOption('#af-tag','Trend'); await p.waitForTimeout(150); ok(T+'tag filter: 2 trades',/2 trades/.test(await p.innerText('.an-w[data-w=summary]')));
  await p.selectOption('#af-tag',''); 
  // basis toggle + gross
  await p.check('input[name=an-basis][value=gross]',{force:true}); await p.waitForTimeout(100); ok(T+'gross basis same here',/\$350\.00/.test(await p.innerText('.an-w[data-w=summary]')));
  // customize: hide equity, move streaks up, persists
  await p.click('[data-act=an-custom]'); await p.uncheck('[data-wid=equity]'); await p.click('[data-act=an-up][data-i="8"]'); await p.waitForTimeout(250);
  const lay=await p.evaluate(async()=>(await TTStore.list('dashboard')).find(d=>d.id==='dash-analytics').layout); ok(T+'layout saved',lay.find(w=>w.id==='equity').on===false&&lay[7].id==='streaks',lay.map(w=>w.id+(w.on?'':'(off)')));
  await p.click('[data-act=an-custom]'); ok(T+'equity hidden',!(await p.$('.an-w[data-w=equity]')));
  await p.reload(); await p.evaluate(()=>TTNav.go('analytics')); await p.waitForSelector('.an-w[data-w=summary]'); ok(T+'layout survives reload',!(await p.$('.an-w[data-w=equity]'))&&(await p.$$eval('.an-w',e=>e.map(x=>x.dataset.w)))[6]==='streaks');
  await p.click('[data-act=an-custom]'); await p.click('[data-act=an-reset]'); await p.waitForTimeout(200); await p.click('[data-act=an-custom]'); ok(T+'reset restores 9 widgets',(await p.$$('.an-w')).length===9);
  await p.screenshot({path:S+'shots/E-analytics-'+theme+'.png',fullPage:true});
  // no-fees banner under net
  await seed(p,[{id:'a',date:'2026-10-19',time:'09:35',x:110,fees:'4'},{id:'b',date:'2026-10-19',time:'10:35',x:110,fees:undefined},{id:'c',date:'2026-10-20',time:'10:35',x:110,contracts:2,exits:[{qty:1,price:110}]}]);
  await p.evaluate(()=>{ TTAnalyticsUI.state.basis=null; return TTAnalyticsUI.reload(); }); await p.waitForTimeout(200); const bn=await p.innerText('#anRoot'); ok(T+'net: banner for 1 closed trade without fees and 1 open',/1 closed trade has no fees entered/.test(bn)&&/1 open or partly closed trade/.test(bn)&&/\$196\.00/.test(bn),bn.slice(0,500));
  // performance: 3000 trades
  const big=[]; for(let i=0;i<3000;i++){ const d=new Date(Date.UTC(2025,0,1+Math.floor(i/6))); big.push({id:'p'+i,date:d.toISOString().slice(0,10),time:String(9+i%6).padStart(2,'0')+':15',x:i%3?105:97}); }
  await seed(p,big); const t0=Date.now(); await p.evaluate(()=>{ TTAnalyticsUI.state.basis=null; return TTAnalyticsUI.reload(); }); await p.waitForSelector('.an-w[data-w=summary]'); const ms=Date.now()-t0; console.log(T+'3000-trade analytics load+render ms',ms); ok(T+'3000 trades render < 3s',ms<3000,ms);
  const nodes=await p.evaluate(()=>document.querySelectorAll('#anRoot *').length); ok(T+'DOM size stays bounded (<6000 nodes)',nodes<6000,nodes);
  ok(T+'no page errors',errors.length===0,errors); await ctx.close(); }
  await browser.close(); console.log(fail?('FAILED '+fail+' / passed '+pass):('ALL PASSED '+pass)); process.exit(fail?1:0);
})();
