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
  await p.evaluate(()=>TTNav.go('more')); ok(T+'hub tile',/Risk center/.test(await p.innerText('#hubRoot')));
  await p.evaluate(()=>TTNav.go('risk')); await p.waitForSelector('#rk-entry');
  ok(T+'gold contracts offered in the dropdown',(await p.$$eval('#rk-inst option',o=>o.map(x=>x.value))).join()==='NNQ,NES,MNQ,NQ,MES,MGC,GC,ES');
  await p.selectOption('#rk-inst','NQ'); await type(p,'#rk-entry','20000'); await type(p,'#rk-stop','19990'); await type(p,'#rk-risk','500');
  let o=await p.innerText('#rkOut'); ok(T+'NQ 10pt stop $500 -> 2 contracts, risk $400, leftover $100',/Contracts\s*2/i.test(o)&&/\$400\.00/.test(o)&&/Leftover \$100\.00/.test(o),o);
  await type(p,'#rk-target','20030'); o=await p.innerText('#rkOut'); ok(T+'target 30pt -> 1 : 3.00, break-even win rate 25.0%',/1 : 3\.00/.test(o)&&/25\.0%/.test(o),o);
  await type(p,'#rk-fee','5'); o=await p.innerText('#rkOut'); ok(T+'fees: $205/contract -> still 2, net RR shown, break-even price',/Contracts\s*2/i.test(o)&&/After fees/i.test(o)&&/20000\.25/.test(o),o);
  await type(p,'#rk-entry','20000.123'); ok(T+'3-decimal price rejected',/at most 2 decimals/.test(await p.innerText('#rkOut'))); await type(p,'#rk-entry','20000');
  await type(p,'#rk-target','19990'); ok(T+'target on wrong side gives a clear message',/target must be above/.test(await p.innerText('#rkOut'))); await type(p,'#rk-target','');
  await type(p,'#rk-risk','50'); ok(T+'risk below one contract explains instead of showing 0 silently',/Contracts\s*0/i.test(await p.innerText('#rkOut'))&&/more than your limit/.test(await p.innerText('#rkOut')));
  await p.selectOption('#rk-inst','GC'); await type(p,'#rk-risk','1000'); await type(p,'#rk-fee',''); await type(p,'#rk-entry','2400'); await type(p,'#rk-stop','2398.5'); o=await p.innerText('#rkOut'); ok(T+'GC 1.5pt x $100 = $150 -> 6 contracts at $1,000 ($900 used)',/Contracts\s*6/i.test(o)&&/\$900\.00/.test(o),o);
  await p.screenshot({path:S+'shots/F-calc-'+theme+'.png',fullPage:true});
  // limits
  await p.click('[data-act=rk-tab][data-t=limits]'); await p.waitForSelector('#rl-dailyLossCents');
  await type(p,'#rl-dailyLossCents','abc'); await p.click('[data-act=rk-save-limits]'); ok(T+'invalid limit message',/dollar amount above \$0/.test(await p.innerText('#rkRoot')));
  await type(p,'#rl-dailyLossCents','$300'); await type(p,'#rl-maxTradesPerDay','2'); await type(p,'#rl-maxRiskPerTradeCents','150'); await p.click('[data-act=rk-save-limits]'); await until(p,()=>/Limits saved/.test((document.querySelector('.ui-toast')||{}).innerText||''));
  const doc=await p.evaluate(async()=>(await TTStore.list('risklimit'))[0]); ok(T+'limits stored as cents',doc&&doc.limits.dailyLossCents===30000&&doc.limits.maxTradesPerDay===2&&doc.limits.maxRiskPerTradeCents===15000&&doc.limits.warnPct===80&&!('maxContracts' in doc.limits),doc);
  // exposure
  await seed(p,[{id:'x1',exits:[{qty:1,price:80}],contracts:1},{id:'x2',exits:[{qty:1,price:95}],contracts:1},{id:'x3',contracts:2,stop:undefined}]);
  await p.evaluate(()=>TTRiskUI.reload()); await p.click('[data-act=rk-tab][data-t=exposure]'); await p.waitForSelector('#rkRoot .ui-list'); let ex=await p.innerText('#rkRoot');
  ok(T+'daily loss -$500 vs $300 limit = OVER LIMIT banner',/exceeded today/.test(ex)&&/OVER LIMIT/.test(ex)&&/\$500\.00 of \$300\.00/.test(ex),ex);
  ok(T+'3 trades vs max 2 flagged',/3 of 2/.test(ex)); ok(T+'open trade without a stop -> open risk unknown (dash), not $0',/1 open trade with no stop/.test(ex));
  ok(T+'max risk per trade: largest planned risk today $100 vs $150 limit is ok',/\$100\.00 of \$150\.00/.test(ex)); await p.screenshot({path:S+'shots/F-exposure-'+theme+'.png',fullPage:true});
  // calc checks against own limit
  await p.click('[data-act=rk-tab][data-t=calc]'); await p.selectOption('#rk-inst','NQ'); await type(p,'#rk-entry','100'); await type(p,'#rk-stop','95'); await type(p,'#rk-risk','500'); await p.waitForTimeout(100); const wo=await p.innerText('#rkOut'); ok(T+'calc warns when size risks more than my own max per trade ($150)',/above your own max of \$150\.00 per trade/.test(wo),wo);
  // scenarios
  await p.click('[data-act=rk-tab][data-t=scen]'); await type(p,'#sc-win','50'); await type(p,'#sc-rr','1'); await type(p,'#sc-risk','100'); await type(p,'#sc-n','3'); await type(p,'#sc-limit','200');
  let sc=await p.innerText('#scOut'); ok(T+'50% at 1:1 -> break-even 50.0%, EV $0.00',/50\.0%/.test(sc)&&/\$0\.00/.test(sc),sc); ok(T+'P(2 losses in a row in 3 trades)=37.5%',/37\.5%/.test(sc)); ok(T+'limit text: 2 full losses reach $200, chance 37.5%',/takes 2 full losses/.test(sc)&&/37\.5%/.test(sc),sc);
  await type(p,'#sc-seq','-1, -1, 2, -1, 3'); ok(T+'sequence total $200 and max DD $200',/\$200\.00/.test(await p.innerText('#scSeq')),await p.innerText('#scSeq')); await type(p,'#sc-seq','-1, x'); ok(T+'bad sequence message',/numbers separated by commas/.test(await p.innerText('#scSeq')));
  await type(p,'#sc-win','150'); ok(T+'win rate over 100 rejected',/between 0 and 100/.test(await p.innerText('#scOut')));
  await seed(p,[1,2,3,4,5,6].map(i=>({id:'m'+i,date:'2026-10-'+String(10+i),exits:[{qty:1,price:i%2?110:97.5}]}))); await p.evaluate(()=>TTRiskUI.reload()); await p.click('[data-act=rk-tab][data-t=scen]'); await p.click('[data-act=sc-mine]'); await p.waitForTimeout(150);
  ok(T+'USE MY JOURNAL STATS fills win rate 50 and risk 100',(await p.inputValue('#sc-win'))==='50'&&(await p.inputValue('#sc-risk'))==='100',[await p.inputValue('#sc-win'),await p.inputValue('#sc-risk'),await p.inputValue('#sc-rr')]);
  // history
  await seed(p,[{id:'h1',exits:[{qty:1,price:110}]},{id:'h2',exits:[{qty:1,price:92}]},{id:'h3',contracts:1,stop:undefined,exits:[{qty:1,price:101}]}]); await p.evaluate(()=>TTRiskUI.reload()); await p.click('[data-act=rk-tab][data-t=hist]'); const hs=await p.innerText('#rkRoot');
  ok(T+'history: 1 trade without stop, 1 loss beyond plan (92 vs stop 95)',/No stop entered\s*\n?1/i.test(hs)&&/1 \/ 2/.test(hs)&&/lost more than the risk/.test(hs),hs); await p.screenshot({path:S+'shots/F-history-'+theme+'.png',fullPage:true});
  // backup carries limits
  const bk=await p.evaluate(async()=>{ const d=await TTDB.getAll('docs'); const r=TTJournalCore.parseBackup(TTJournalCore.serializeBackup([],{}, {accounts:[],ledger:[],docs:d})); return r.docs.map(x=>x.kind); }); ok(T+'risklimit docs survive backup',bk.includes('risklimit'),bk);
  ok(T+'no page errors',errors.length===0,errors); await ctx.close(); }
  await browser.close(); console.log(fail?('FAILED '+fail+' / passed '+pass):('ALL PASSED '+pass)); process.exit(fail?1:0);
})();
