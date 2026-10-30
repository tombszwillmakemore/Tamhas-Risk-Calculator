const A=require(require('path').join(__dirname,'..','assets/accounts-core.js'));
globalThis.window=globalThis; require(require('path').join(__dirname,'..','assets/instruments.js')); const C=require(require('path').join(__dirname,'..','assets/journal-core.js'));
const vm=require('vm'),fs=require('fs'); const ctx={window:{}}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','assets/propfirm-data.js'),'utf8'),ctx); const D=ctx.window.TTPropData;
let fail=0; const ok=(n,c,d)=>{ if(!c) fail++; console.log(c?'ok  ':'FAIL',n, c?'':JSON.stringify(d)); };
// data integrity
ok('17 researched firms, 21 listed-only',D.firms.length===17&&D.listedOnly.length===21,[D.firms.length,D.listedOnly.length]);
let bad=[],nofacts=0,total=0;
D.firms.forEach(f=>{ const all=[...Object.values(f.firmWide),...f.products.flatMap(p=>Object.values(p.facts))]; all.forEach(x=>{ total++; if(!x.src||!/^https?:\/\//.test(x.src)) bad.push(f.slug+':nosrc'); if(!['official','third-party'].includes(x.st)) bad.push(f.slug+':st'); }); });
ok('every fact has an http source and a source type ('+total+' facts)',bad.length===0,bad.slice(0,5));
ok('Apex facts are all third-party (official site was unreadable)',D.firms.find(f=>f.slug==='apex-trader-funding').products.every(p=>Object.values(p.facts).every(x=>x.st==='third-party')));
ok('Topstep has official facts',JSON.stringify(D.firms.find(f=>f.slug==='topstep')).includes('"st":"official"'));
ok('each firm carries unknown/conflict lists as arrays',D.firms.every(f=>Array.isArray(f.unknown)&&Array.isArray(f.conflicts)));
ok('no listed-only firm has rules',D.listedOnly.every(o=>!o.products&&!o.facts));
// template rules
const tp=D.firms.find(f=>f.slug==='topstep'); const r=A.templateRules(tp,tp.products[0]);
ok('template rules only use known fields',Object.keys(r).every(k=>A.FIELD_LABEL[k]),Object.keys(r));
ok('template rules carry source + type, unverified by user',Object.values(r).every(x=>x.source&&x.verifiedOn===null&&x.origin==='template'));
// account creation
ok('name required',!A.newAccount({category:'prop'}).ok);
ok('bad category rejected',!A.newAccount({name:'x',category:'zzz'}).ok);
ok('bad balance rejected',!A.newAccount({name:'x',category:'live',startingBalance:'-5'}).ok&&!A.newAccount({name:'x',category:'live',startingBalance:'abc'}).ok);
const a=A.newAccount({name:'  Topstep   50K ',category:'prop',startingBalance:'50,000',rules:r},1000).account;
ok('name cleaned, balance in cents',a.name==='Topstep 50K'&&a.startingBalanceCents===5000000,a);
ok('default prop status is evaluation, history started',a.status==='evaluation'&&a.statusHistory.length===1);
ok('live account default status active',A.newAccount({name:'L',category:'live'}).account.status==='active');
// edit rule + history
const v0=JSON.stringify(a);
let e1=A.editRule(a,'profitTarget','$3,000',{note:'checked help center',verifiedOn:'2026-10-29',source:'https://example.com/x',sourceType:'official'},2000);
ok('edit records history',e1.ok&&e1.account.ruleHistory.length===1&&e1.account.ruleHistory[0].to==='$3,000');
ok('edit does not mutate the original',JSON.stringify(a)===v0);
ok('verification date stored',e1.account.rules.profitTarget.verifiedOn==='2026-10-29'&&e1.account.rules.profitTarget.sourceType==='official');
ok('same value, nothing changed = no history entry',A.editRule(e1.account,'profitTarget','$3,000',{verifiedOn:'2026-10-29',source:'https://example.com/x'},3000).unchanged===true);
ok('re-verifying same value IS recorded',A.editRule(e1.account,'profitTarget','$3,000',{verifiedOn:'2026-11-05',source:'https://example.com/x'},3000).account.ruleHistory.length===2);
const e2=A.editRule(e1.account,'profitTarget','',{},4000); ok('clearing a rule removes value but keeps history',!e2.account.rules.profitTarget&&e2.account.ruleHistory.length===2&&e2.account.ruleHistory[1].to==='');
ok('unknown field rejected',!A.editRule(a,'__proto__','x').ok);
ok('non-http source ignored',A.editRule(a,'resetFee','$50',{source:'javascript:alert(1)'}).account.rules.resetFee.source==='');
// status
ok('invalid status for type',!A.setStatus(a,'active').ok); const s=A.setStatus(a,'funded','passed eval',5000).account; ok('status change logged',s.status==='funded'&&s.statusHistory.length===2);
// staleness
const rule=r[Object.keys(r)[0]];
ok('template rule within 30 days not stale',A.ruleAge(rule,'2026-10-29','2026-11-10').stale===false);
ok('template rule after 30 days is stale',A.ruleAge(rule,'2026-10-29','2026-12-15').stale===true);
ok('user-verified date wins',A.ruleAge({verifiedOn:'2026-12-10',origin:'edited'},'2026-10-29','2026-12-15').stale===false);
ok('rule with no date = stale/never verified',A.ruleAge({value:'x',origin:'edited',verifiedOn:null},null,'2026-12-15').stale===true);
// stats
const mk=o=>C.normalizeTrade(Object.assign({contract:'MNQ',side:'long',contracts:1,entry:'100'},o)).trade;
const rows=C.analyze([mk({id:'1',date:'2026-10-20',exits:[{qty:1,price:'110'}],fees:'1',accountId:'A'}),mk({id:'2',date:'2026-10-21',exits:[{qty:1,price:'90'}],accountId:'A'}),mk({id:'3',date:'2026-10-22',accountId:'B'}),mk({id:'4',date:'2026-10-22',exits:[{qty:1,price:'101'}]})]);
const sa=A.accountStats(rows,'A','acct-default'); ok('account A: 2 closed, gross +$20-$20=0, net only from fee-recorded trade',sa.closed===2&&sa.grossCents===0&&sa.netCents===1900&&sa.netTrades===1,sa);
const sb=A.accountStats(rows,'B','acct-default'); ok('account B: only an open trade -> money is null, not 0',sb.closed===0&&sb.grossCents===null&&sb.netCents===null&&sb.open===1,sb);
ok('trades without accountId belong to default',A.accountStats(rows,'acct-default','acct-default').trades===1);
console.log(fail?'FAILED '+fail:'ALL PASSED'); process.exit(fail?1:0);
