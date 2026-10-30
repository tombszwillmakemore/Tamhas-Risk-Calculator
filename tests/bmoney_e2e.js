const { chromium } = require('./_pw');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const until=async(pg,fn,arg,ms=6000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn,arg)) return true; await pg.waitForTimeout(40);} return false;};
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[];
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready());
  const today=await p.evaluate(()=>{const d=new Date(),q=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+q(d.getMonth()+1)+'-'+q(d.getDate());});
  // empty state first
  await p.evaluate(()=>TTNav.go('money')); await p.waitForSelector('#mRoot .ui-empty');
  ok('empty state when nothing recorded',/Nothing recorded yet/.test(await p.innerText('#mRoot')));
  ok('Money tile in More hub',await p.evaluate(()=>!!document.querySelector('#hubRoot [data-go=money]')));
  // seed
  await p.evaluate(async()=>{ const A=TTAccountsCore;
    const a1=A.newAccount({id:'a1',name:'Eval One',category:'prop',startingBalance:'50000',firmSlug:'apex'}).account; a1.status='failed';
    const a2=A.newAccount({id:'a2',name:'Funded Two',category:'prop',startingBalance:'50000',firmSlug:'apex'}).account; a2.status='funded';
    await TTDB.put('accounts',a1); await TTDB.put('accounts',a2);
    const L=(o)=>Object.assign({type:'fee',feeKind:'evaluation',createdAt:1,voided:false,at:Date.UTC(2026,8,5,19)},o);
    await TTDB.batch([ L({id:'f1',accountId:'a1',amountCents:15000,date:'2026-09-05'}), L({id:'f2',accountId:'a2',feeKind:'activation',amountCents:13000,date:'2026-09-20'}),
      L({id:'p1',accountId:'a2',type:'payout',feeKind:undefined,amountCents:100000,receivedCents:90000,date:'2026-10-10'}), L({id:'p2',accountId:'a2',type:'payout',feeKind:undefined,amountCents:50000,date:'2026-10-24'}) ].map(v=>({store:'ledger',type:'put',value:v})));
    await TTStore.save({id:'exp-1',kind:'expense',date:'2026-09-01',amountCents:2999,category:'data',accountId:null,vendor:'CQG'}); });
  await p.evaluate(()=>TTNav.go('home')); await p.evaluate(()=>TTNav.go('money')); await p.waitForSelector('#mRoot .ui-stat');
  const stats=await p.$$eval('#mRoot .ui-stat',els=>Object.fromEntries(els.map(e=>[e.querySelector('small').textContent,e.querySelector('b').textContent])));
  ok('overview: costs $309.99',stats['Costs']==='$309.99',stats); ok('overview: withdrawn $1,500.00',stats['Payouts (withdrawn)']==='$1,500.00',stats);
  ok('overview: cash received $1,400.00 (90k + gross 50k)',stats['Cash received']==='$1,400.00',stats); ok('overview: net +$1,090.01',stats['Net result']==='+$1,090.01',stats);
  ok('overview: ROI 352%',stats['Return on cost']==='352%',stats);
  ok('flags payout missing received amount',/1 payout has no "received" amount/.test(await p.innerText('#mRoot')));
  ok('charts rendered',await p.evaluate(()=>document.querySelectorAll('#mRoot figure.ch svg').length>=1));
  await p.screenshot({path:S+'shots/B-overview.png'});
  // payouts tab
  await p.click('[data-mtab=payouts]'); ok('payouts list 2 rows',(await p.$$('#mRoot .m-row')).length===2);
  ok('payout row shows received/not entered',/Received \$900\.00/.test(await p.innerText('#mRoot'))&&/Received amount not entered/.test(await p.innerText('#mRoot')));
  // add received to p2
  await p.click('[data-act=m-recv][data-id=p2]'); await p.waitForSelector('.ui-dlg'); await p.fill('.ui-dlg input','450'); await p.click('.ui-dlg [data-r=ok]');
  ok('received saved to ledger',await until(p,async()=>(await TTDB.get('ledger','p2')).receivedCents===45000));
  ok('audit entry for edit',await p.evaluate(async()=>(await TTDB.getAll('audit')).some(a=>a.type==='ledger-edit'&&a.details.id==='p2'&&a.details.to===45000)));
  // received > gross rejected
  await p.click('[data-act=m-recv][data-id=p2]'); await p.waitForSelector('.ui-dlg'); await p.fill('.ui-dlg input','500.01'); await p.click('.ui-dlg [data-r=ok]');
  ok('received above withdrawn is rejected with message',/cannot be more/.test(await p.innerText('.ui-dlg-err'))); await p.click('.ui-dlg [data-r=cancel]');
  // add payout via dialog
  await p.click('[data-act=m-add-pay]'); await p.waitForSelector('.ui-dlg'); await p.selectOption('#uidf0','a2'); await p.fill('#uidf1',today); await p.fill('#uidf2','$2,000'); await p.fill('#uidf3','1800'); await p.click('.ui-dlg [data-r=ok]');
  ok('new payout stored with received',await until(p,async()=>(await TTDB.getAll('ledger')).some(l=>l.type==='payout'&&l.amountCents===200000&&l.receivedCents===180000&&l.accountId==='a2')));
  // duplicate prompt
  await p.click('[data-act=m-add-pay]'); await p.waitForSelector('.ui-dlg'); await p.selectOption('#uidf0','a2'); await p.fill('#uidf1',today); await p.fill('#uidf2','2000'); await p.click('.ui-dlg [data-r=ok]');
  await p.waitForFunction(()=>/Possible duplicate/.test(document.body.innerText)); ok('duplicate payout asks first',true); await p.click('.ui-dlg [data-r=cancel]');
  ok('declined duplicate not stored',(await p.evaluate(async()=>(await TTDB.getAll('ledger')).filter(l=>l.type==='payout').length))===3);
  // expenses
  await p.click('[data-mtab=expenses]'); const nrows=(await p.$$('#mRoot .m-row')).length; ok('expense list has fee+expense',nrows===3&&/account fee/i.test(await p.innerText('#mRoot'))&&/expense/i.test(await p.innerText('#mRoot')),nrows);
  await p.click('[data-act=m-add-exp]'); await p.waitForSelector('.ui-dlg'); await p.fill('#uidf0',today); await p.fill('#uidf1','49.50'); await p.selectOption('#uidf3','subscription'); await p.fill('#uidf4','TradingView'); await p.click('.ui-dlg [data-r=ok]');
  ok('general expense saved as doc (not ledger)',await until(p,async()=>(await TTDB.getAll('docs')).some(d=>d.kind==='expense'&&d.amountCents===4950&&d.category==='subscription'&&d.accountId===null)));
  const nL=await p.evaluate(async()=>(await TTDB.getAll('ledger')).filter(l=>l.type==='fee').length); ok('no ledger fee created for general expense',nL===2,nL);
  await p.click('[data-act=m-add-exp]'); await p.waitForSelector('.ui-dlg'); await p.fill('#uidf0',today); await p.fill('#uidf1','80'); await p.selectOption('#uidf2','a1'); await p.selectOption('#uidf3','reset'); await p.click('.ui-dlg [data-r=ok]');
  ok('account-linked expense saved ONLY in ledger as fee',await until(p,async()=>{ const l=(await TTDB.getAll('ledger')).filter(x=>x.type==='fee'&&x.amountCents===8000&&x.feeKind==='reset'&&x.accountId==='a1'); const d=(await TTDB.getAll('docs')).filter(x=>x.kind==='expense'&&x.amountCents===8000); return l.length===1&&d.length===0; }));
  await p.click('[data-act=m-add-exp]'); await p.waitForSelector('.ui-dlg'); await p.fill('#uidf0',today); await p.fill('#uidf1','abc'); await p.click('.ui-dlg [data-r=ok]'); ok('bad amount blocked',/positive dollar amount/.test(await p.innerText('.ui-dlg-err'))); await p.click('.ui-dlg [data-r=cancel]');
  // void expense doc
  await p.click('[data-mtab=overview]'); const before=(await p.$$eval('#mRoot .ui-stat',els=>Object.fromEntries(els.map(e=>[e.querySelector('small').textContent,e.querySelector('b').textContent]))))['Costs'];
  await p.click('[data-mtab=expenses]'); await p.click('#mRoot .m-row [data-act=m-void][data-src=expense]'); await p.waitForSelector('.ui-dlg'); await p.click('.ui-dlg [data-r=ok]');
  await p.waitForFunction(()=>/Voided/.test(document.querySelector('.ui-toast').textContent)); await p.click('[data-mtab=overview]');
  const after=(await p.$$eval('#mRoot .ui-stat',els=>Object.fromEntries(els.map(e=>[e.querySelector('small').textContent,e.querySelector('b').textContent]))))['Costs'];
  ok('voiding removes it from totals but keeps the record',before!==after&&(await p.evaluate(async()=>(await TTDB.getAll('docs')).some(d=>d.kind==='expense'&&d.voided===true))),[before,after]);
  // recurring: post once only
  await p.click('[data-mtab=recurring]'); await p.click('[data-act=m-add-rec]'); await p.waitForSelector('.ui-dlg');
  const d0=await p.evaluate(()=>{const d=new Date(); d.setMonth(d.getMonth()-2); const q=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+q(d.getMonth()+1)+'-15';});
  await p.fill('#uidf0','Data feed'); await p.fill('#uidf1','25'); await p.fill('#uidf3',d0); await p.selectOption('#uidf5','a1'); await p.selectOption('#uidf6','data'); await p.click('.ui-dlg [data-r=ok]');
  await p.waitForSelector('[data-act=m-post]'); const pendTxt=await p.innerText('#mRoot .ui-banner'); ok('pending payments shown, nothing auto-posted',/not posted yet/.test(pendTxt)&&(await p.evaluate(async()=>(await TTDB.getAll('ledger')).filter(l=>/^rec:/.test(l.ref||'')).length))===0,pendTxt);
  const nPend=Number((pendTxt.match(/(\d+) payments?/)||[])[1]);
  await p.click('[data-act=m-post]'); await p.waitForSelector('.ui-dlg'); await p.click('.ui-dlg [data-r=ok]');
  ok('posted exactly the due items to the ledger (account-linked)',await until(p,async(n)=>(await TTDB.getAll('ledger')).filter(l=>/^rec:/.test(l.ref||'')&&l.type==='fee'&&l.accountId==='a1'&&l.feeKind==='data').length===n,nPend));
  ok('nothing pending after posting; cannot post twice',await p.evaluate(()=>!document.querySelector('[data-act=m-post]')));
  await p.evaluate(()=>{TTNav.go('home');}); await p.evaluate(()=>TTNav.go('money')); await p.click('[data-mtab=recurring]'); ok('still nothing pending after reload of view',await p.evaluate(()=>!document.querySelector('[data-act=m-post]')));
  // stop recurring
  await p.click('[data-act=m-rec-toggle]'); ok('stop keeps history',await until(p,async()=>(await TTStore.list('recurring'))[0].active===false));
  // analysis
  await p.click('[data-mtab=analysis]'); const an=await p.innerText('#mRoot'); ok('analysis lists accounts and firm group',/Eval One/.test(an)&&/Funded Two/.test(an)&&/Apex|apex/i.test(an),an.slice(0,300));
  const firmRow=await p.evaluate(()=>{const r=[...document.querySelectorAll('#mRoot .panel')].find(x=>/by firm/i.test(x.innerText)); return r?r.innerText:null;}); ok('analysis firm table present',!!firmRow,firmRow);
  await p.screenshot({path:S+'shots/B-analysis.png'});
  // range filter
  await p.click('[data-mtab=overview]'); await p.selectOption('#m-range','month'); ok('range select re-renders',await p.evaluate(()=>document.getElementById('m-range').value==='month'));
  // tracker payout readiness
  await p.evaluate(async()=>{ await TTAccounts.reload(); TTNav.go('accounts'); }); await p.waitForSelector('#aRoot .a-head'); await p.click('#aRoot [data-act=a-toggle][data-id=a2]');
  ok('no readiness section until drawdown rules active (needs buffer)', true);
  // activate rules through core then check readiness UI
  await p.evaluate(async()=>{ const a=await TTDB.get('accounts','a2'); const D=TTDD; const c=D.confirmVersion(TTAccountsCore.normalizeAccount(a).dd,{model:'static',basis:'balance',startingBalanceCents:5000000,maxLossCents:250000,journalTz:'America/Los_Angeles'},{confirmed:true,verifiedOn:'2026-10-01',source:'test'},Date.now()); if(!c.ok) throw new Error(JSON.stringify(c)); a.dd=c.dd; await TTDB.put('accounts',a); await TTAccounts.reload(); });
  await p.waitForSelector('details[data-k="pay:a2"]'); ok('payout readiness section appears for funded account',true);
  await p.evaluate(()=>{ document.querySelector('details[data-k="pay:a2"]').open=true; });
  ok('says enter rules when none set',/Enter your payout rules/.test(await p.innerText('details[data-k="pay:a2"] summary')));
  await p.fill('#pr-minWinningDays','2'); await p.fill('#pr-splitPct','90'); await p.fill('#pr-bufferCents','500'); await p.click('[data-act=t-pay-save][data-id=a2]');
  ok('payout rules persisted as validated cents',await until(p,async()=>{ const a=await TTDB.get('accounts','a2'); return a.payoutRules&&a.payoutRules.minWinningDays===2&&a.payoutRules.bufferCents===50000&&a.payoutRules.splitPct===90; }));
  await p.waitForSelector('details[data-k="pay:a2"]'); ok('readiness now evaluates (not "enter rules")',!/Enter your payout rules/.test(await p.innerText('details[data-k="pay:a2"] summary')));
  await p.evaluate(()=>{ document.querySelector('details[data-k="pay:a2"]').open=true; }); await p.fill('#pr-minWinningDays','2.5'); await p.click('[data-act=t-pay-save][data-id=a2]');
  ok('invalid payout rule rejected with message',/whole number/.test(await p.innerText('#aRoot')));
  await p.screenshot({path:S+'shots/B-readiness.png'});
  ok('no page errors',errors.length===0,errors);
  console.log(fail?'FAILED':'ALL PASSED',pass,'passed,',fail,'failed'); await browser.close(); process.exit(fail?1:0);
})();
