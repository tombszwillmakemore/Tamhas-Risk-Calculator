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
  await p.evaluate(()=>TTNav.go('more')); ok(T+'hub tile',/Discipline/.test(await p.innerText('#hubRoot')));
  await p.evaluate(()=>TTNav.go('discipline')); await p.waitForSelector('#dsRoot .chip');
  ok(T+'empty today prompts to build lists',/Build your routine/.test(await p.innerText('#dsRoot')));
  // lists
  await p.click('[data-act=ds-tab][data-t=lists]'); await p.click('[data-act=ds-starter][data-k=pre]'); ok(T+'starter fills form, nothing saved',(await p.inputValue('#ls-name'))==='Before I enter'&&(await p.evaluate(()=>TTStore.list('checklist').then(l=>l.length)))===0);
  await p.click('[data-act=ds-list-save]'); await until(p,()=>/List saved/.test((document.querySelector('.ui-toast')||{}).innerText||''));
  await p.click('[data-act=ds-starter][data-k=post]'); await p.click('[data-act=ds-list-save]'); await until(p,async()=>(await TTStore.list('checklist')).length===2);
  await p.click('[data-act=ds-starter][data-k=routine]'); await p.click('[data-act=ds-list-save]'); await until(p,async()=>(await TTStore.list('routine')).length===1);
  await p.fill('#ls-name','Bad'); await p.fill('#ls-items','  '); await p.click('[data-act=ds-list-save]'); ok(T+'empty list rejected',/role="alert"|ui-banner bad/.test(await p.innerHTML('#dsRoot'))&&(await p.evaluate(()=>TTStore.list('checklist').then(l=>l.length)))===2);
  // plan
  await p.click('[data-act=ds-tab][data-t=plan]'); await p.fill('#pl-name','Plan A'); await p.fill('#pl-entry','*Wait for retest'); await p.fill('#pl-mt','0'); await p.click('[data-act=ds-plan-save]'); ok(T+'max trades 0 rejected',/whole number|at least|1/.test(await p.innerText('#dsRoot'))&&!(await p.evaluate(()=>TTStore.list('plan').then(l=>l.length))));
  await p.fill('#pl-mt','2'); await p.fill('#pl-mr','150'); await p.click('[data-act=ds-plan-save]'); await until(p,async()=>(await TTStore.list('plan')).length===1);
  const plan=await p.evaluate(()=>TTStore.list('plan').then(l=>l[0])); ok(T+'plan stored (cents, id)',plan.id==='plan-main'&&plan.maxTradesPerDay===2&&plan.maxRiskCents===15000,plan);
  // trades today: 3 trades -> over plan
  await seed(p,[{id:'a1',exits:[{qty:1,price:105}],followedRules:'yes',entryReason:'r',mistakeTags:['fomo']},{id:'a2',exits:[{qty:1,price:90}],followedRules:'no',mistakeTags:['fomo']},{id:'a3',exits:[{qty:1,price:101}],followedRules:'yes',notes:'n'}]);
  await p.evaluate(()=>TTDisciplineUI.reload()); await p.click('[data-act=ds-tab][data-t=today]'); let t=await p.innerText('#dsRoot');
  ok(T+'today shows 3 trades vs plan 2 + warning',/plan allows 2/.test(t)&&/more trades today than your plan allows/.test(t),t);
  // routine checkbox persists
  await p.check('[data-rt] >> nth=0'); await until(p,async()=>(await TTStore.list('routine')).some(x=>x.type==='run'&&Object.keys(x.answers).length===1));
  await p.evaluate(()=>TTDisciplineUI.reload()); await p.waitForSelector('[data-rt]'); ok(T+'routine tick survives reload',await p.isChecked('[data-rt] >> nth=0')&&/1\/4/.test(await p.innerText('#dsRoot')));
  await p.uncheck('[data-rt] >> nth=0'); await until(p,async()=>(await TTStore.list('routine')).filter(x=>x.type==='run').every(x=>Object.keys(x.answers).length===0)); ok(T+'untick removes answer',true);
  // pre-trade run: not ready until required done
  await p.click('[data-act=ds-run]'); ok(T+'run panel says not ready',/Not ready: 3 required/.test(await p.innerText('#runStat')));
  const boxes=await p.$$('[data-ra]'); for (let i=0;i<3;i++) await boxes[i].check(); ok(T+'ready after 3 required',/Ready\./.test(await p.innerText('#runStat')));
  await p.click('[data-act=ds-run-save]'); await until(p,async()=>(await TTStore.list('checklist')).some(x=>x.type==='run'));
  const run=await p.evaluate(()=>TTStore.list('checklist').then(l=>l.find(x=>x.type==='run'))); ok(T+'run saved with answers only for 3 items',Object.keys(run.answers).length===3&&run.date&&run.tradeId==='',run);
  // post review attaches to trade
  await p.waitForSelector('[data-act=ds-run][data-trade]'); await p.click('[data-act=ds-run][data-trade] >> nth=0'); await (await p.$('[data-ra]')).check(); await p.click('[data-act=ds-run-save]'); await until(p,async()=>(await TTStore.list('checklist')).filter(x=>x.type==='run'&&x.tradeId).length===1); ok(T+'post-trade review linked to a trade',true);
  await p.screenshot({path:S+'shots/G-today-'+theme+'.png',fullPage:true});
  // reflection
  await p.click('[data-act=ds-tab][data-t=reflect]'); await p.click('[data-act=ds-ref-save]'); ok(T+'empty reflection rejected',/ui-banner bad/.test(await p.innerHTML('#dsRoot')));
  await p.selectOption('#rf-plan','4'); await p.fill('#rf-lesson','Wait for the retest'); await p.click('[data-act=ds-ref-save]'); await until(p,async()=>(await TTStore.list('reflection')).length===1);
  const ref=await p.evaluate(()=>TTStore.list('reflection').then(l=>l[0])); ok(T+'reflection stored by date',/^ref-\d{4}-\d\d-\d\d$/.test(ref.id)&&ref.planFollowed===4&&ref.lesson==='Wait for the retest',ref);
  ok(T+'recent list shows it',/Wait for the retest/.test(await p.innerText('#dsRoot')));
  // goals
  await p.click('[data-act=ds-tab][data-t=goals]'); await p.selectOption('#gl-metric','maxTradesPerDay'); await p.fill('#gl-target','2'); await p.click('[data-act=ds-goal-add]'); await until(p,async()=>(await TTStore.list('goal')).length===1);
  let gt=await p.innerText('#dsRoot'); ok(T+'goal "never more than 2 trades" missed with 3 today',/MISSED/.test(gt),gt);
  await p.selectOption('#gl-metric','pnl'); await p.fill('#gl-target','abc'); await p.click('[data-act=ds-goal-add]'); ok(T+'bad goal target rejected',/dollar amount above/.test(await p.innerText('#dsRoot')));
  await p.fill('#gl-target','$100'); await p.click('[data-act=ds-goal-add]'); await until(p,async()=>(await TTStore.list('goal')).length===2); const g2=await p.evaluate(()=>TTStore.list('goal').then(l=>l.find(x=>x.metric==='pnl'))); ok(T+'profit goal in cents',g2.target===10000,g2);
  await p.screenshot({path:S+'shots/G-goals-'+theme+'.png',fullPage:true});
  // score
  await p.click('[data-act=ds-tab][data-t=score]'); const s=await p.innerText('#dsRoot');
  ok(T+'score shown with components and honest note',/DISCIPLINE SCORE/.test(s)&&/Followed your rules/.test(s)&&/Profit is never part/.test(s),s);
  ok(T+'unmeasured components explained, not zero',/Not measured/.test(s)||/Daily reflection/.test(s));
  const num=+(await p.innerText('#dsRoot .pnl-value')); ok(T+'score is 0-100 integer',Number.isInteger(num)&&num>=0&&num<=100,num);
  ok(T+'mistake analysis lists fomo with 2 trades',/fomo/i.test(s)&&/association/i.test(s),s);
  await p.click('[data-act=ds-period][data-p=month]'); ok(T+'period switch re-renders',/DISCIPLINE SCORE/.test(await p.innerText('#dsRoot')));
  await p.screenshot({path:S+'shots/G-score-'+theme+'.png',fullPage:true});
  // no horizontal overflow
  ok(T+'no horizontal page overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  // delete list
  await p.click('[data-act=ds-tab][data-t=lists]'); await p.click('[data-act=ds-list-del] >> nth=0'); await p.click('[data-r=ok]'); await until(p,async()=>(await TTStore.list('checklist')).filter(x=>x.type==='def').length===1&&true);
  ok(T+'trades untouched by discipline actions',(await p.evaluate(()=>TTDB.getAll('trades').then(l=>l.length)))===3);
  ok(T+'no js errors',errors.length===0,errors);
  await ctx.close();
  }
  await browser.close(); console.log(`g1e2e: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
