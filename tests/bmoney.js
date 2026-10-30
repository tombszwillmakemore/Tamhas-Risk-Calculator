const R=require('path').join(__dirname,'..','assets')+'/';
global.TTSessions=require(R+'sessions.js'); global.TTDD=require(R+'dd-core.js'); const D=TTDD, M=require(R+'money-core.js');
let pass=0,fail=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } }; const srt=x=>Array.isArray(x)?x.map(srt):(x&&typeof x==='object'?Object.keys(x).sort().reduce((o,k)=>(o[k]=srt(x[k]),o),{}):x); const eq=(n,a,b)=>ok(n,JSON.stringify(srt(a))===JSON.stringify(srt(b)),{got:a,want:b});
const NOW=Date.UTC(2026,9,29,18);
// ---- validation
let v=M.validateExpense({date:'2026-10-01',amount:'29.99',category:'data',vendor:' CQG ',note:'x'},{now:NOW}); ok('expense ok',v.ok&&v.record.amountCents===2999&&v.record.vendor==='CQG'&&v.record.accountId===null,v);
ok('expense: subscription allowed without account',M.validateExpense({date:'2026-10-01',amount:'10',category:'subscription'},{now:NOW}).ok);
ok('expense: account-linked must use fee kinds',!M.validateExpense({date:'2026-10-01',amount:'10',category:'subscription',accountId:'a'},{now:NOW}).ok);
ok('expense: zero/negative/letters/3-decimals rejected',['0','-5','abc','1.234',''].every(a=>!M.validateExpense({date:'2026-10-01',amount:a,category:'data'},{now:NOW}).ok));
ok('expense: bad/future date rejected',!M.validateExpense({date:'2026-02-30',amount:'5',category:'data'},{now:NOW}).ok&&!M.validateExpense({date:'2027-01-01',amount:'5',category:'data'},{now:NOW}).ok);
ok('expense: tomorrow tolerated (timezone slack)',M.validateExpense({date:'2026-10-30',amount:'5',category:'data'},{now:NOW}).ok);
ok('recurring: validation',M.validateRecurring({title:'Feed',amount:'25',cadence:'monthly',startDate:'2026-01-15',category:'data'}).ok&&!M.validateRecurring({title:'',amount:'25',cadence:'daily',startDate:'x',category:'zzz'}).ok&&!M.validateRecurring({title:'a',amount:'1',cadence:'monthly',startDate:'2026-05-01',endDate:'2026-04-01',category:'data'}).ok);
// ---- fixtures
const L=(o)=>Object.assign({id:'l'+Math.random(),accountId:'a1',type:'fee',feeKind:'evaluation',amountCents:10000,date:'2026-09-05',at:Date.UTC(2026,8,5,19),voided:false},o);
const ledger=[ L({id:'f1',amountCents:15000,date:'2026-09-05'}), L({id:'f2',accountId:'a2',feeKind:'activation',amountCents:13000,date:'2026-09-20'}), L({id:'fv',amountCents:99999,voided:true}),
  L({id:'p1',type:'payout',feeKind:undefined,amountCents:100000,receivedCents:90000,date:'2026-10-10',accountId:'a2'}), L({id:'p2',type:'payout',feeKind:undefined,amountCents:50000,date:'2026-10-24',accountId:'a2'}),
  L({id:'d1',type:'deposit',feeKind:undefined,amountCents:500000,date:'2026-10-01'}), L({id:'s1',type:'snapshot',amountCents:undefined,balanceCents:5,date:'2026-10-02'}), L({id:'pv',type:'payout',amountCents:77777,voided:true,date:'2026-10-11',accountId:'a2'}) ];
const exps=[{id:'e1',date:'2026-09-01',amountCents:2999,category:'data',accountId:null},{id:'e2',date:'2026-10-01',amountCents:2999,category:'data'},{id:'ev',date:'2026-10-01',amountCents:5000,category:'data',voided:true},{id:'eb',date:'bad',amountCents:100,category:'data'}];
const ce=M.costEntries(ledger,exps); eq('cost entries exclude voided, non-fee, invalid',ce.map(x=>x.id).sort(),['e1','e2','f1','f2']);
eq('cost entries sources never overlap',ce.filter(x=>x.source==='ledger').length+ce.filter(x=>x.source==='expense').length,4);
let sc=M.summarizeCosts(ce); eq('total costs',sc.totalCents,15000+13000+2999+2999); eq('by category',sc.byCategory,{evaluation:15000,activation:13000,data:5998}); eq('by account (general bucket)',sc.byAccount,{a1:15000,a2:13000,general:5998}); eq('by month',sc.byMonth,{'2026-09':15000+13000+2999,'2026-10':2999});
eq('range filter inclusive',M.summarizeCosts(ce,{from:'2026-09-05',to:'2026-09-20'}).totalCents,28000); ok('empty range -> null not 0',M.summarizeCosts(ce,{from:'2030-01-01'}).totalCents===null);
eq('filter by account',M.summarizeCosts(ce,{accountId:'a2'}).totalCents,13000);
// ---- payouts
const pe=M.payoutEntries(ledger); eq('payout entries exclude voided',pe.map(x=>x.id).sort(),['p1','p2']);
let sp=M.summarizePayouts(pe); eq('gross total',sp.grossCents,150000); eq('received counts only entered',sp.receivedCents,90000); eq('received known/missing',[sp.receivedKnown,sp.receivedMissing],[1,1]); eq('avg gross',sp.avgGrossCents,75000); eq('gap days',sp.avgDaysBetween,14); eq('largest',sp.largest.id,'p1');
ok('no payouts -> nulls',(x=>x.grossCents===null&&x.receivedCents===null&&x.avgGrossCents===null&&x.count===0)(M.summarizePayouts([])));
// ---- economics
const accts=[{id:'a1',name:'Eval 1',category:'prop',status:'failed',firmSlug:'firmx'},{id:'a2',name:'Funded 2',category:'prop',status:'funded',firmSlug:'firmx'},{id:'a3',name:'Sim',category:'sim',status:'active'}];
const E=M.economics(accts,ledger,exps); const r=id=>E.accounts.find(a=>a.id===id);
eq('a1 costs',r('a1').costCents,15000); ok('a1 no payouts -> cashIn null, net = -cost',r('a1').cashInCents===null&&r('a1').netCents===-15000&&r('a1').roi===null);
eq('a2 cash in = received(90k)+gross where unknown(50k)',r('a2').cashInCents,140000); eq('a2 assumesGross flagged',r('a2').assumesGross,1); eq('a2 net',r('a2').netCents,140000-13000); eq('a2 roi',Math.round(r('a2').roi*1000)/1000,Math.round((127000/13000)*1000)/1000);
ok('a3 nothing recorded -> all null (not 0)',r('a3').costCents===null&&r('a3').netCents===null&&r('a3').cashInCents===null);
eq('general bucket holds expense items',r('general').costCents,5998);
eq('totals cost',E.totals.costCents,33998); eq('totals cash',E.totals.cashInCents,140000); eq('totals net',E.totals.netCents,140000-33998); ok('deposits/snapshots never counted as income or cost',E.totals.payoutCount===2&&E.totals.costCount===4);
const fx=E.firms.firmx; eq('firm grouping: accounts, failed, funded',[fx.accounts,fx.failed,fx.funded],[2,1,1]); eq('firm cost',fx.costCents,28000); eq('firm cost per payout',fx.costPerPayoutCents,14000);
ok('orphan ledger account does not crash and lands in general',(()=>{ const e=M.economics([],[L({accountId:'ghost',amountCents:500,id:'g'})],[]); return e.accounts.length===1&&e.accounts[0].costCents===500; })());
ok('economics range respected',M.economics(accts,ledger,exps,{from:'2026-10-01'}).totals.costCents===2999&&M.economics(accts,ledger,exps,{from:'2026-10-01'}).totals.payoutCount===2);
const mf=M.monthlyFlow(ledger,exps); eq('monthly flow',mf.map(m=>[m.month,m.costCents,m.cashInCents,m.cumulativeCents]),[['2026-09',30999,0,-30999],['2026-10',2999,140000,-30999+140000-2999]]);
ok('empty economics: totals null',(x=>x.totals.netCents===null&&x.totals.costCents===null)(M.economics([],[],[])));
// ---- recurring
eq('monthly 31st clamps',M.occurrences({startDate:'2026-01-31',cadence:'monthly'},'2026-04-30'),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
eq('monthly leap year',M.occurrences({startDate:'2024-01-30',cadence:'monthly'},'2024-03-01'),['2024-01-30','2024-02-29']);
eq('yearly Feb 29 -> Feb 28 in non-leap',M.occurrences({startDate:'2024-02-29',cadence:'yearly'},'2026-12-31'),['2024-02-29','2025-02-28','2026-02-28']);
eq('weekly',M.occurrences({startDate:'2026-10-01',cadence:'weekly'},'2026-10-22'),['2026-10-01','2026-10-08','2026-10-15','2026-10-22']);
eq('endDate respected',M.occurrences({startDate:'2026-01-15',cadence:'monthly',endDate:'2026-03-10'},'2026-12-31'),['2026-01-15','2026-02-15']);
eq('start in future -> nothing',M.occurrences({startDate:'2027-01-01',cadence:'monthly'},'2026-10-29'),[]);
ok('capped at 600',M.occurrences({startDate:'1990-01-01',cadence:'weekly'},'2026-10-29').length===600);
eq('unknown cadence/dates -> nothing',[M.occurrences({startDate:'x',cadence:'monthly'},'2026-01-01'),M.occurrences({startDate:'2026-01-01',cadence:'daily'},'2026-02-01')],[[],[]]);
const rec={id:'r1',startDate:'2026-08-15',cadence:'monthly',amountCents:2500};
eq('pending = all when none posted',M.pendingPostings(rec,[],'2026-10-29').map(x=>x.date),['2026-08-15','2026-09-15','2026-10-15']);
eq('pending skips already posted refs (no double posting)',M.pendingPostings(rec,[M.recRef(rec,'2026-08-15'),M.recRef(rec,'2026-10-15')],'2026-10-29').map(x=>x.date),['2026-09-15']);
eq('inactive -> nothing pending',M.pendingPostings(Object.assign({},rec,{active:false}),[],'2026-10-29'),[]);
eq('run rate: monthly 25 + yearly 120 + weekly 12',M.monthlyRunRate([{cadence:'monthly',amountCents:2500},{cadence:'yearly',amountCents:12000},{cadence:'weekly',amountCents:1200}]),Math.round(2500+1000+1200*52/12));
ok('run rate none -> null',M.monthlyRunRate([])===null);
// ---- ledger payout received
const lv=(x)=>D.validateLedger(Object.assign({type:'payout',accountId:'a',date:'2026-10-20',amount:'1000'},x),{now:NOW});
ok('payout received optional',lv({}).ok&&lv({}).record.receivedCents===undefined); eq('payout received stored',lv({received:'900'}).record.receivedCents,90000);
ok('received > gross rejected',!lv({received:'1000.01'}).ok); ok('received garbage rejected',!lv({received:'abc'}).ok); eq('received 0 allowed',lv({received:'0'}).record.receivedCents,0);
// ---- readiness
const days=[{day:'2026-10-01',pnlCents:30000,trades:2},{day:'2026-10-02',pnlCents:-10000,trades:1},{day:'2026-10-03',pnlCents:25000,trades:1},{day:'2026-10-04',pnlCents:0,trades:0},{day:'2026-10-05',pnlCents:60000,trades:3}];
let rd=M.readiness({},{days}); eq('no rules entered',rd.overall,'no-rules');
rd=M.readiness({minProfitCents:100000,minWinningDays:3,winningDayMinCents:20000},{days,bufferCents:300000,balanceCents:1,}); eq('profit since = 105000',rd.profitSinceCents,105000); eq('winning days >= $200: 3',rd.winningDays,3);
ok('all met -> eligible',rd.overall==='eligible'&&rd.items.every(i=>i.status==='met'),rd);
rd=M.readiness({minProfitCents:200000},{days}); eq('profit short -> not-yet',rd.overall,'not-yet');
rd=M.readiness({minWinningDays:3},{days,lastPayoutDay:'2026-10-02'}); eq('cycle starts after last payout (days 3,5 only)',[rd.daysCounted,rd.winningDays,rd.profitSinceCents,rd.overall],[2,2,85000,'not-yet']);
rd=M.readiness({bufferCents:100000},{days}); eq('buffer unknown -> incomplete (never assumed met)',[rd.items[0].status,rd.overall],['unknown','incomplete']);
rd=M.readiness({bufferCents:100000},{days,bufferCents:99999,balanceCents:1}); eq('buffer short by $0.01 -> not met',rd.items[0].status,'not met');
rd=M.readiness({consistencyPct:40},{days}); eq('consistency: best 60000/105000=57.1% > 40 -> not met',[rd.items[0].status,/57\.1%/.test(rd.items[0].detail)],['not met',true]);
rd=M.readiness({consistencyPct:60},{days}); eq('consistency 57.1% <= 60 met',rd.items[0].status,'met');
rd=M.readiness({consistencyPct:40},{days:[{day:'2026-10-01',pnlCents:-500,trades:1}]}); eq('consistency with no profit -> unknown',rd.items[0].status,'unknown');
rd=M.readiness({minPayoutCents:50000,bufferCents:100000,maxPayoutCents:70000,splitPct:90},{days,bufferCents:400000,balanceCents:1}); eq('requestable = min(profit 105000, room 300000, max 70000)',rd.requestableCents,70000); eq('your share 90% floor',rd.yourShareCents,63000); eq('min payout met',rd.items.find(i=>i.key==='minpayout').status,'met');
rd=M.readiness({splitPct:80},{days,bufferCents:50000,balanceCents:1}); eq('requestable limited by buffer room (no required buffer => room=buffer)',rd.requestableCents,50000);
rd=M.readiness({minPayoutCents:50000},{days}); ok('min payout unknown without buffer',rd.items[0].status==='unknown'&&rd.requestableCents===null);
// payout rule validation
let pv=M.validatePayoutRules({minProfitCents:'',minWinningDays:'5',winningDayMinCents:'$150',splitPct:'90%'}); ok('rules valid',pv.ok&&pv.clean.minWinningDays===5&&pv.clean.winningDayMinCents===15000&&pv.clean.splitPct===90&&pv.clean.minProfitCents===null,pv);
ok('rules: bad values rejected',!M.validatePayoutRules({minWinningDays:'2.5'}).ok&&!M.validatePayoutRules({splitPct:'150'}).ok&&!M.validatePayoutRules({minPayoutCents:'x'}).ok&&!M.validatePayoutRules({splitPct:'0'}).ok);
console.log(fail?'FAILED':'ALL PASSED',pass,'passed,',fail,'failed'); process.exit(fail?1:0);
