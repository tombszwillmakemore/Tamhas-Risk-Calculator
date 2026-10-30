const R=require('path').join(__dirname,'..','assets')+'/'; const C=require(R+'journal-core.js'), K=require(R+'risk-core.js'), I=require(R+'instruments.js');
let f=0,p=0; const ok=(n,c,d)=>{ if(c) p++; else { f++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } }; const eq=(n,a,b)=>ok(n,JSON.stringify(a)===JSON.stringify(b),{got:a,want:b}); const near=(n,a,b,e=1e-9)=>ok(n,a!=null&&Math.abs(a-b)<e,{got:a,want:b});
// instruments
ok('gold specs: GC $100/pt, MGC $10/pt, verified url',I.byId.GC.centsPerPoint===10000&&I.byId.MGC.centsPerPoint===1000&&/cmegroup/.test(I.byId.GC.url)&&I.list.length===8);
// position size (NQ $20/pt)
let r=K.positionSize({instId:'NQ',entry:20000,stop:19990,riskCents:50000}); ok('NQ 10pt stop = $200/contract; $500 risk -> 2 contracts, leftover $100',r.ok&&r.contracts===2&&r.perContractCents===20000&&r.stopRiskCents===40000&&r.leftoverCents===10000&&r.side==='long',r);
r=K.positionSize({instId:'MNQ',entry:100,stop:101.25,riskCents:10000}); ok('MNQ short, 1.25pt = $2.50/contract, $100 -> 40 contracts exactly',r.ok&&r.side==='short'&&r.contracts===40&&r.leftoverCents===0&&r.stopPoints===1.25,r);
r=K.positionSize({instId:'ES',entry:5000,stop:4990,riskCents:10000}); ok('risk smaller than one contract -> 0 contracts with explanation',r.ok&&r.contracts===0&&/more than your limit/.test(r.note)&&r.needForOneCents===50000,r);
r=K.positionSize({instId:'NQ',entry:20000,stop:19990,riskCents:50000,feePerContractCents:500}); ok('fees count toward risk: $205 per contract -> 2 (not 3), total 41000',r.contracts===2&&r.feeCents===1000&&r.totalRiskCents===41000&&r.leftoverCents===9000,r);
r=K.positionSize({instId:'NQ',entry:20000,stop:19990,riskCents:61500,feePerContractCents:500}); ok('fee boundary: $615 fits exactly 3 x $205',r.contracts===3&&r.leftoverCents===0,r);
r=K.positionSize({instId:'NNQ',entry:100,stop:99.99,riskCents:1e7}); ok('cap at 500 contracts and flagged',r.contracts===500&&r.capped===true,r);
r=K.positionSize({instId:'NNQ',entry:100,stop:99.99,riskCents:100}); ok('rounding never exceeds the limit (0.01pt x $0.20 = 0.2c each)',r.ok&&r.totalRiskCents<=100,r);
for (const [n,o] of [['entry=stop',{entry:100,stop:100,riskCents:100}],['bad price decimals',{entry:100.123,stop:99,riskCents:100}],['zero risk',{entry:100,stop:99,riskCents:0}],['non-integer risk',{entry:100,stop:99,riskCents:10.5}],['negative fee',{entry:100,stop:99,riskCents:100,feePerContractCents:-1}],['negative price',{entry:-1,stop:99,riskCents:100}]]) ok('reject: '+n,K.positionSize(Object.assign({instId:'NQ'},o)).ok===false);
ok('reject unknown contract',K.positionSize({instId:'ZZ',entry:1,stop:2,riskCents:100}).ok===false);
// randomized invariant: contracts*perStop+fees <= risk and one more would exceed
let bad=0; for(let i=0;i<2000;i++){ const id=I.list[i%8].id, e=Number((1000+Math.round(Math.random()*400000)/100).toFixed(2)), d=Math.round((0.01+Math.random()*50)*100)/100, st=Number((e-d).toFixed(2)), risk=100+Math.floor(Math.random()*5e6), fee=Math.floor(Math.random()*800); const x=K.positionSize({instId:id,entry:e,stop:st,riskCents:risk,feePerContractCents:fee}); if(!x.ok){bad++;continue;} if(x.capped) continue; const h=Math.round(e*100)-Math.round(st*100), cpp=I.byId[id].centsPerPoint; const tot=n=>Math.round(n*h*cpp/100)+n*fee; if(tot(x.contracts)>risk||tot(x.contracts+1)<=risk) bad++; } ok('2000 random sizes: never over risk, and maximal',bad===0,bad);
// reward:risk
r=K.rewardRisk({instId:'NQ',entry:20000,stop:19990,target:20030,contracts:2,feesCents:1000}); ok('RR 3:1, $400 risk, $1200 reward',r.ok&&r.rr===3&&r.riskCents===40000&&r.rewardCents===120000&&r.riskPoints===10&&r.rewardPoints===30,r);
near('break-even win rate 25%',r.breakEvenWinRate,0.25); ok('net: risk 41000 reward 119000',r.netRiskCents===41000&&r.netRewardCents===119000); near('net RR',r.netRR,119000/41000); near('net break-even win rate',r.netBreakEvenWinRate,41000/(41000+119000)); near('fees % of risk',r.feePctOfRisk,0.025);
r=K.rewardRisk({instId:'ES',entry:5000,stop:5010,target:4980}); ok('short RR 2:1',r.ok&&r.side==='short'&&r.rr===2); ok('target on wrong side rejected',!K.rewardRisk({instId:'ES',entry:5000,stop:4990,target:4980}).ok&&/above/.test(K.rewardRisk({instId:'ES',entry:5000,stop:4990,target:4980}).error));
ok('rr bad contracts rejected',!K.rewardRisk({instId:'ES',entry:5000,stop:4990,target:5020,contracts:0}).ok&&!K.rewardRisk({instId:'ES',entry:5000,stop:4990,target:5020,contracts:1.5}).ok);
// break-even
r=K.breakEven({instId:'NQ',entry:20000,side:'long',contracts:2,feesCents:1000}); ok('fees $10 on 2 NQ = 0.25pt -> 20000.25',r.ok&&r.points===0.25&&r.price===20000.25,r); r=K.breakEven({instId:'MNQ',entry:100,side:'short',contracts:3,feesCents:200}); ok('short: 2.00/ (3*2) = 0.34pt rounded up -> 99.66',r.points===0.34&&r.price===99.66,r); ok('zero fees -> entry',K.breakEven({instId:'NQ',entry:50,side:'long',contracts:1,feesCents:0}).price===50);
// streaks
near('P(loss run>=2 in 2 trades, p=.5)=.25',K.probLossRun(.5,2,2),.25); near('P(3 losses in 3 trades, p=.5)=.125',K.probLossRun(.5,3,3),.125); near('P(2 losses in a row in 3, p=.5)=.375',K.probLossRun(.5,3,2),.375); near('P(run>=1 in n) = 1-p^n',K.probLossRun(.6,5,1),1-Math.pow(.6,5),1e-12);
near('p=1 never loses',K.probLossRun(1,50,1),0); near('p=0 always loses',K.probLossRun(0,5,5),1); ok('k>n impossible = 0',K.probLossRun(.5,3,4)===0); ok('bad inputs null',K.probLossRun(1.2,3,2)===null&&K.probLossRun(.5,0,2)===null);
// brute force check for small n
function brute(pw,n,k){ let tot=0; for(let m=0;m<(1<<n);m++){ let pr=1,run=0,hit=false; for(let i=0;i<n;i++){ const w=(m>>i)&1; pr*=w?pw:1-pw; if(w) run=0; else { run++; if(run>=k) hit=true; } } if(hit) tot+=pr; } return tot; }
let mx=0; for(const pw of [.3,.5,.65]) for(let n=1;n<=10;n++) for(let k=1;k<=5;k++) mx=Math.max(mx,Math.abs(brute(pw,n,k)-K.probLossRun(pw,n,k))); ok('DP matches brute-force enumeration (max err '+mx.toExponential(1)+')',mx<1e-12);
// EV, losses to limit, sequence
near('EV: p=.4 rr=2 risk $100 -> +$20',K.expectedValue(.4,2,10000),2000); near('EV breakeven at p=1/3, rr=2',K.expectedValue(1/3,2,10000),0,1e-9); ok('EV bad input null',K.expectedValue(.4,0,100)===null);
ok('losses to $1000 limit at $300 risk = 4',K.lossesToLimit(100000,30000)===4&&K.lossesToLimit(90000,30000)===3&&K.lossesToLimit(0,5)===null); near('BE win rate rr 1.5 = 40%',K.breakEvenWinRate(1.5),.4);
let sq=K.sequenceR(10000,[-1,-1,2,-1,3]); ok('sequence -1,-1,2,-1,3 at $100: total $200, max DD $200',sq.totalCents===20000&&sq.maxDrawdownCents===20000&&sq.curve.join()==='-10000,-20000,0,-10000,20000',sq);
// limits validation
let v=K.validateLimits({dailyLossCents:'$1,000',maxTradesPerDay:'5',warnPct:'75'}); ok('limits parsed',v.ok&&v.limits.dailyLossCents===100000&&v.limits.maxTradesPerDay===5&&v.limits.warnPct===75,v); ok('default warn 80, blanks skipped',K.validateLimits({}).limits.warnPct===80&&Object.keys(K.validateLimits({}).limits).length===1);
for (const bad of [{dailyLossCents:'abc'},{dailyLossCents:'0'},{dailyLossCents:'-5'},{maxTradesPerDay:'2.5'},{maxContracts:'0'},{warnPct:'20'},{warnPct:'100'},{dailyLossCents:'1.234'}]) ok('limit rejected '+JSON.stringify(bad),K.validateLimits(bad).ok===false);
// evaluate
const L={dailyLossCents:100000,maxTradesPerDay:4,maxContracts:3,maxOpenRiskCents:50000,warnPct:80}; let ev=K.evaluate(L,{dayLossCents:79999,trades:4,maxContractsInTrade:4,openRiskCents:20000,maxTradeRiskCents:null});
const st=Object.fromEntries(ev.map(x=>[x.key,x.status])); ok('79.999% is ok; 4/4 trades is warn (100%? equals limit -> warn not breach for counts); 4>3 contracts breach',st.dailyLossCents==='ok'&&st.maxTradesPerDay==='warn'&&st.maxContracts==='breach'&&st.maxOpenRiskCents==='ok',st);
ev=K.evaluate(L,{dayLossCents:80000,trades:5,maxContractsInTrade:1,openRiskCents:0}); const st2=Object.fromEntries(ev.map(x=>[x.key,x.status])); ok('80% = warn, 5>4 trades breach',st2.dailyLossCents==='warn'&&st2.maxTradesPerDay==='breach',st2);
ev=K.evaluate(L,{dayLossCents:100000,trades:1,maxContractsInTrade:1,openRiskCents:0}); ok('hitting the loss limit exactly = breach',ev.find(x=>x.key==='dailyLossCents').status==='breach');
ev=K.evaluate({dailyLossCents:100000},{dayLossCents:0,openRiskUnknown:true}); ok('only limits you set are evaluated',ev.length===1); ev=K.evaluate({maxOpenRiskCents:1000},{openRiskUnknown:true,openRiskCents:0}); ok('unknown open risk reported, not 0',ev[0].status==='unknown'&&ev[0].used===null&&/no stop/.test(ev[0].note));
ok('no limits -> nothing',K.evaluate({},{dayLossCents:5}).length===0&&K.evaluate(null,{}).length===0);
// open risk
const mkT=(o)=>{ const x=C.normalizeTrade(Object.assign({id:'t'+Math.random(),date:'2026-10-26',contract:'NQ',side:'long',contracts:2,entry:100,stop:95,createdAt:1},o)); if(!x.ok) throw new Error(JSON.stringify(x.errors)); return x.trade; }; const rowOf=t=>({t,c:C.compute(t)});
let o1=rowOf(mkT({})); ok('open trade risk = 2 x 5pt x $20 = $200',K.openRisk(o1.t,o1.c).cents===20000);
let o2=rowOf(mkT({exits:[{qty:1,price:110}]})); ok('partial: 1 contract left x $100',K.openRisk(o2.t,o2.c).cents===10000&&K.openRisk(o2.t,o2.c).contracts===1);
let o3=rowOf(mkT({entries:[{qty:1,price:100},{qty:1,price:104}],contracts:2,stop:95,exits:[{qty:1,price:110}]})); ok('scale-in partial: oldest exits first, remaining lot @104 risks 9pt = $180',K.openRisk(o3.t,o3.c).cents===18000,K.openRisk(o3.t,o3.c));
let o4=rowOf(mkT({stop:undefined})); ok('no stop -> unknown, not 0',K.openRisk(o4.t,o4.c).unknown===true&&K.openRisk(o4.t,o4.c).cents===null); let o5=rowOf(mkT({exits:[{qty:2,price:101}]})); ok('closed -> 0',K.openRisk(o5.t,o5.c).cents===0);
// account context
const T=[mkT({id:'a',date:'2026-10-28',accountId:'A',contracts:1,exits:[{qty:1,price:95}],fees:'4'}),mkT({id:'b',date:'2026-10-28',accountId:'A',contracts:3,exits:[{qty:3,price:110}],fees:'0'}),mkT({id:'c',date:'2026-10-27',accountId:'A',contracts:1,exits:[{qty:1,price:90}],fees:'0'}),mkT({id:'d',date:'2026-10-28',accountId:'B',contracts:1,exits:[{qty:1,price:80}],fees:'0'}),mkT({id:'e',date:'2026-10-28',accountId:'A',contracts:2}),mkT({id:'f',date:'2026-10-28',accountId:'A',contracts:1,stop:undefined}),mkT({id:'g',date:'2026-10-19',accountId:'A',contracts:1,exits:[{qty:1,price:50}],fees:'0'})];
const rows=T.map(rowOf); let cx=K.accountContext(rows,'A','2026-10-28');
// day A: a -$104 (net: -100-4), b +$600 (3x10x20), e open pnl null, f open -> dayPnl=496 so loss 0
ok('day P&L net of known fees: +496.00 => no loss counted',cx.dayPnlCents===49600&&cx.dayLossCents===0,cx); ok('trades today for A = 4 (a,b,e,f)',cx.trades===4); ok('max planned risk today = $300 (3 contracts x $100)',cx.maxTradeRiskCents===30000); ok('max contracts today 3',cx.maxContractsInTrade===3);
ok('open risk: e 2x$100=$200; f unknown flagged',cx.openRiskCents===20000&&cx.openRiskUnknown===true&&cx.openUnknownCount===1); ok('week (Mon 10-26..Sun 11-01): -104+600-200(c) = +296.00; g is previous week',cx.weekPnlCents===29600&&cx.weekLossCents===0,cx.weekPnlCents);
cx=K.accountContext(rows,'B','2026-10-28'); ok('account B isolated: -$400 day loss (20 pts x $20), nothing open',cx.dayLossCents===40000&&cx.openRiskCents===0&&cx.openRiskUnknown===false&&cx.trades===1); cx=K.accountContext(rows,null,'2026-10-28'); ok('all accounts combined: trades 5',cx.trades===5);
cx=K.accountContext(rows,'A','2026-10-30'); ok('day with no trades: 0 trades, null max risk',cx.trades===0&&cx.maxTradeRiskCents===null&&cx.maxContractsInTrade===null);
// history
const hs=K.riskHistory(rows.filter(r=>r.t.accountId==='A')); ok('history counts: 6 trades, 5 with stop, 1 without',hs.trades===6&&hs.withStop===5&&hs.noStop===1,hs);
ok('history avg/max/min risk (100,300,100,200,100 => avg 160)',hs.avgRiskCents===16000&&hs.maxRiskCents===30000&&hs.minRiskCents===10000&&hs.medianRiskCents===10000,hs); ok('spread computed',hs.riskSpread>0); ok('worst day is the most negative day total',hs.worstDay&&hs.worstDay.cents<0,hs.worstDay);
const slip=[rowOf(mkT({id:'s1',contracts:1,stop:95,exits:[{qty:1,price:92}],fees:'0'}))]; ok('loss beyond planned risk counted (stopped at 92 vs stop 95)',K.riskHistory(slip).lossesBeyondRisk===1&&K.riskHistory(slip).closedWithStop===1);
ok('empty history has nulls not zeros',K.riskHistory([]).avgRiskCents===null&&K.riskHistory([]).worstDay===null&&K.riskHistory([]).trades===0);
console.log(f?('FAILED '+f+' / passed '+p):('ALL PASSED '+p+' passed, 0 failed')); process.exit(f?1:0);
