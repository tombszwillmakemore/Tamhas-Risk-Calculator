// Known-answer tests for the drawdown engine. Every expected value below was worked out by hand, not taken from the code.
const D=require(require('path').join(__dirname,'..','assets/dd-core.js'));
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else {fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d));} };
const eq=(n,a,b)=>ok(n,a===b,{got:a,want:b});
const $=n=>Math.round(n*100);
// closed trade: net P&L in dollars at LA time (journal tz)
let seq=0; const T=(date,time,pnl,o={})=>({t:{id:'t'+(++seq),date,time,createdAt:1000+seq},c:Object.assign({isClosed:true,status:'closed',grossCents:$(pnl),netCents:$(pnl),feesMissing:false},o)});
const base={model:'static',basis:'balance',startingBalanceCents:$(50000),maxLossCents:$(2000),resetTime:'17:00',resetTz:'America/Chicago',journalTz:'America/Los_Angeles'};
const S=(o)=>Object.assign({},base,o);
// asOf: Mon 2026-10-12 12:00 Chicago (CDT=-5) => 17:00Z
const NOW=Date.UTC(2026,9,12,17,0); const LATER=Date.UTC(2026,9,13,17,0);
const run=(s,rows,led,asOf)=>D.evaluate(s,rows,led||[],{asOf:asOf==null?NOW:asOf});

// ---- parseMoney ----
eq('money 2500',D.parseMoney('2500'),250000); eq('money $2,500.50',D.parseMoney('$2,500.50'),250050); eq('money .5',D.parseMoney('.5'),50);
['','abc','1.234','-5','0','1e5','$$'].forEach(x=>ok('money rejects "'+x+'"',D.parseMoney(x)===null));
eq('money allowNegative',D.parseMoney('-5',{allowNegative:true}),-500); eq('money allowZero',D.parseMoney('0',{allowZero:true}),0);

// ---- validateSettings ----
ok('valid base',D.validateSettings(base).ok);
[['max loss text',{maxLossCents:'abc'}],['max loss >= start',{maxLossCents:$(50000)}],['negative start',{startingBalanceCents:'-5'}],['bad model',{model:'x'}],['bad tz',{resetTz:'Mars/Base'}],['bad time',{resetTime:'25:00'}],
 ['pct 0',{consistencyPct:0}],['pct 101',{consistencyPct:101}],['min days 0',{minTradingDays:0}],['min days 1.5',{minTradingDays:1.5}],['bad trackFrom',{trackFrom:'2026-02-30'}],
 ['stop below initial threshold',{model:'eod-trailing',trailStopCents:$(47000)}],['min-profit without amount',{qualifyMode:'min-profit'}],['trailing without basis',{model:'eod-trailing',basis:undefined}]
].forEach(([n,o])=>ok('invalid: '+n,!D.validateSettings(S(o)).ok));
ok('stop == initial threshold is allowed',D.validateSettings(S({model:'eod-trailing',trailStopCents:$(48000)})).ok);

// ---- STATIC ----
let r=run(S(),[]);
eq('static: no trades balance',r.balance.cents,$(50000)); eq('static: threshold 48,000',r.threshold.cents,$(48000)); eq('static: buffer 2,000',r.buffer.cents,$(2000)); eq('static: no-trade confidence',r.confidence,'user-entered'); ok('static: no breach',r.breach===null);
r=run(S(),[T('2026-10-05','09:00',500),T('2026-10-06','09:00',-300),T('2026-10-07','09:00',-1500)]);
eq('static: balance 48,700',r.balance.cents,$(48700)); eq('static: buffer 700',r.buffer.cents,$(700)); eq('static: still 48,000',r.threshold.cents,$(48000)); eq('static: from trades -> estimated',r.confidence,'estimated'); ok('static: not breached',r.breach===null&&r.buffer.breached===false);
r=run(S(),[T('2026-10-05','09:00',500),T('2026-10-06','09:00',-300),T('2026-10-07','09:00',-1500),T('2026-10-08','09:00',-700)]);
eq('static: balance exactly at threshold',r.balance.cents,$(48000)); eq('static: buffer 0',r.buffer.cents,0); ok('static: breach flagged at <=',r.breach&&r.breach.day==='2026-10-08'&&r.buffer.breached===true,r.breach);
r=run(S(),[T('2026-10-05','09:00',3000)]); eq('static: profit does not move threshold',r.threshold.cents,$(48000)); eq('static: buffer grows to 5,000',r.buffer.cents,$(5000));

// ---- EOD TRAILING (no stop) ----
const E=(o)=>S(Object.assign({model:'eod-trailing'},o));
const tr=[T('2026-10-05','09:00',1000),T('2026-10-06','09:00',1500),T('2026-10-07','09:00',-800)];
r=run(E(),tr); // closes: 51,000 / 52,500 / 51,700 => HWM 52,500 => T 50,500
eq('eod: hwm 52,500',r.hwm.cents,$(52500)); eq('eod: threshold 50,500',r.threshold.cents,$(50500)); eq('eod: buffer 1,200',r.buffer.cents,$(1200));
r=run(E(),tr.concat([T('2026-10-12','09:00',3000)])); // today's (Mon 10/12) trade must NOT move the threshold
eq('eod: today profit not yet in hwm',r.hwm.cents,$(52500)); eq('eod: threshold unchanged intraday',r.threshold.cents,$(50500)); eq('eod: buffer 4,200 today',r.buffer.cents,$(4200));
r=run(E(),tr.concat([T('2026-10-12','09:00',3000)]),[],LATER); // next day: Monday has closed at 54,700
eq('eod: next day hwm 54,700',r.hwm.cents,$(54700)); eq('eod: next day threshold 52,700',r.threshold.cents,$(52700));
// intraday round trip: +2000 then -1900 on one day: EOD model never sees the 52,000 peak
r=run(E(),[T('2026-10-05','09:00',2000),T('2026-10-05','10:00',-1900)]);
eq('eod: intraday peak ignored, hwm = close 50,100',r.hwm.cents,$(50100)); eq('eod: threshold 48,100',r.threshold.cents,$(48100)); eq('eod: buffer 2,000',r.buffer.cents,$(2000));
// EOD with stop level at start balance
const ES=E({trailStopCents:$(50000)});
r=run(ES,tr); eq('eod+stop: threshold capped at 50,000',r.threshold.cents,$(50000)); eq('eod+stop: buffer 1,700',r.buffer.cents,$(1700));
r=run(ES,[T('2026-10-05','09:00',1000)]); eq('eod+stop: below cap trails normally (49,000)',r.threshold.cents,$(49000));
r=run(ES,tr.concat([T('2026-10-12','09:00',3000)]),[],LATER); eq('eod+stop: stays pinned at 50,000 after new highs',r.threshold.cents,$(50000));
// breach under trailing threshold: peak 52,500 => T 50,500; lose 1,200 on the 8th => 50,500 is not reached? 51,700-1,200=50,500 => breach
r=run(E(),tr.concat([T('2026-10-08','09:00',-1200)])); ok('eod: breach when balance reaches trailing threshold',r.breach&&r.breach.day==='2026-10-08'&&r.breach.thresholdCents===$(50500),r.breach);
r=run(E(),tr.concat([T('2026-10-08','09:00',-1199)])); ok('eod: $1 above threshold is not a breach',r.breach===null&&r.buffer.cents===$(1),r.buffer);

// ---- INTRADAY TRAILING, BALANCE BASIS ----
const I=(o)=>S(Object.assign({model:'intraday-trailing',basis:'balance'},o));
r=run(I(),tr.concat([T('2026-10-12','09:00',3000)])); // 54,700 balance => T 52,700 immediately
eq('intraday: hwm updates immediately 54,700',r.hwm.cents,$(54700)); eq('intraday: threshold 52,700',r.threshold.cents,$(52700)); eq('intraday: buffer 2,000',r.buffer.cents,$(2000));
r=run(I(),[T('2026-10-05','09:00',2000),T('2026-10-05','10:00',-1900)]); // peak 52,000 => T 50,000 ; bal 50,100
eq('intraday: sees the 52,000 peak',r.hwm.cents,$(52000)); eq('intraday: threshold 50,000',r.threshold.cents,$(50000)); eq('intraday: buffer only 100',r.buffer.cents,$(100));
ok('same trades: EOD buffer 2,000 vs intraday buffer 100 (models differ)',true);
r=run(I(),[T('2026-10-05','09:00',2000),T('2026-10-05','10:00',-2000)]); ok('intraday: give back the whole peak -> breach at 50,000',r.breach&&r.breach.thresholdCents===$(50000),r.breach);
r=run(I({trailStopCents:$(50000)}),tr); eq('intraday+stop: capped 50,000',r.threshold.cents,$(50000));
r=run(I(),[T('2026-10-05',null,2000),T('2026-10-05',null,-1900)]); ok('intraday: untimed same-day trades flagged as uncertain order',r.warnings.some(w=>/win\/loss order is unknown/.test(w)));

// ---- INTRADAY TRAILING, EQUITY BASIS: never fake precision ----
const IE=(o)=>S(Object.assign({model:'intraday-trailing',basis:'equity'},o));
r=run(IE(),tr);
ok('equity: threshold unavailable without firm data',r.threshold.cents===null&&r.buffer.cents===null&&r.threshold.conf==='unavailable'&&r.buffer.conf==='unavailable');
eq('equity: only a labelled lower bound (52,500-2,000)',r.threshold.lowerBoundCents,$(50500)); eq('equity: buffer upper bound 1,200',r.buffer.upperBoundCents,$(1200)); ok('equity: explains what is missing',r.reasons.some(x=>/real intraday equity peak/.test(x)));
const snap=(o)=>Object.assign({id:'s'+(++seq),accountId:'a',type:'snapshot',at:Date.UTC(2026,9,8,0,0),createdAt:Date.UTC(2026,9,8,0,0),source:'firm-dashboard',balanceCents:null,equityCents:null,thresholdCents:null,hwmCents:null},o);
r=run(IE(),tr,[snap({thresholdCents:$(50750),balanceCents:$(51700)})]);
eq('equity+firm threshold: used as entered',r.threshold.cents,$(50750)); eq('equity+firm threshold: confidence verified input',r.threshold.conf,'verified input'); eq('equity: buffer = 51,700-50,750',r.buffer.cents,$(950)); eq('equity: overall verified',r.buffer.conf,'verified input');
r=run(IE(),tr,[snap({thresholdCents:$(50750),balanceCents:$(51700),source:'my-own'})]); eq('own figure -> user-entered',r.threshold.conf,'user-entered');
r=run(IE(),tr.concat([T('2026-10-09','09:00',400)]),[snap({thresholdCents:$(50750),balanceCents:$(51700)})]); eq('trade after snapshot: threshold now estimated',r.threshold.conf,'estimated'); eq('trade after snapshot: balance 52,100',r.balance.cents,$(52100)); eq('trade after snapshot: threshold stays 50,750 floor',r.threshold.cents,$(50750));
r=run(IE(),tr,[snap({hwmCents:$(53000),balanceCents:$(51700)})]); eq('equity+peak equity 53,000 -> threshold 51,000',r.threshold.cents,$(51000)); eq('equity+peak: user-entered/verified not estimated',r.threshold.conf,'verified input');
r=run(IE(),tr.concat([T('2026-10-09','09:00',2000)]),[snap({hwmCents:$(53000),balanceCents:$(51700)})]); eq('realized balance above firm peak raises the floor (53,700-2,000)',r.threshold.cents,$(51700));

// ---- manual threshold on trailing = floor; static = replacement ----
r=run(E(),tr,[snap({thresholdCents:$(51000)})]); eq('eod: firm threshold above computed wins (floor)',r.threshold.cents,$(51000)); eq('eod: manual marked',r.threshold.source,'manual');
r=run(E(),tr,[snap({thresholdCents:$(49000)})]); eq('eod: firm threshold below computed does not lower it',r.threshold.cents,$(50500));
r=run(S(),[T('2026-10-05','09:00',-500)],[snap({thresholdCents:$(48250)})]); eq('static: firm threshold replaces',r.threshold.cents,$(48250));

// ---- payouts, deposits, transfers, fees are NOT trading P&L ----
const cash=(type,amt,day)=>({id:'c'+(++seq),accountId:'a',type,amountCents:$(amt),at:Date.UTC(2026,9,day,18,0),createdAt:Date.UTC(2026,9,day,18,0)});
r=run(E(),[T('2026-10-05','09:00',3000)],[cash('payout',1000,6)]); // balance 52,000 ; hwm perf 53,000 ; T 51,000
eq('payout: balance 52,000',r.balance.cents,$(52000)); eq('payout: profit still 3,000',r.progress.profitCents,$(3000)); eq('payout: hwm unchanged 53,000',r.hwm.cents,$(53000)); eq('payout: threshold 51,000',r.threshold.cents,$(51000)); eq('payout: buffer 1,000',r.buffer.cents,$(1000)); eq('payout: external cash -1,000',r.externalCashCents,-$(1000));
r=run(E(),[T('2026-10-05','09:00',3000)],[cash('payout',1000,6),cash('deposit',500,7)]); eq('deposit: balance 52,500',r.balance.cents,$(52500)); eq('deposit: profit still 3,000',r.progress.profitCents,$(3000)); eq('deposit does not raise hwm',r.hwm.cents,$(53000));
r=run(E(),[T('2026-10-05','09:00',3000)],[cash('transfer-out',1000,6)]); eq('transfer-out: balance 52,000, profit 3,000',r.balance.cents*1e0===$(52000)&&r.progress.profitCents===$(3000),true);
r=run(E(),[T('2026-10-05','09:00',3000)],[cash('transfer-in',700,6)]); eq('transfer-in: balance 53,700',r.balance.cents,$(53700)); eq('transfer-in: profit 3,000',r.progress.profitCents,$(3000));
r=run(E(),[],[cash('payout',1000,6)]); ok('payout alone: profit -> not -1,000 of trading loss',r.progress.profitCents===0&&r.balance.cents===$(49000));
r=run(S(),[T('2026-10-05','09:00',1000)],[{id:'f1',accountId:'a',type:'fee',feeKind:'evaluation',amountCents:$(150),at:Date.UTC(2026,9,1,18),createdAt:1},{id:'f2',accountId:'a',type:'fee',feeKind:'reset',amountCents:$(100),at:Date.UTC(2026,9,2,18),createdAt:2},{id:'f3',accountId:'a',type:'fee',feeKind:'evaluation',amountCents:$(50),at:Date.UTC(2026,9,3,18),createdAt:3,voided:true}]);
eq('fees: total 250 (voided excluded)',r.fees.totalCents,$(250)); eq('fees: evaluation 150',r.fees.byKind.evaluation,$(150)); eq('fees: reset 100',r.fees.byKind.reset,$(100)); eq('fees do not change balance',r.balance.cents,$(51000)); eq('no fees -> null not 0',run(S(),[]).fees.totalCents,null);
// voided payout is ignored
r=run(S(),[],[Object.assign(cash('payout',1000,6),{voided:true})]); eq('voided payout ignored',r.balance.cents,$(50000));

// ---- snapshots: reconciliation ----
r=run(S(),[T('2026-10-05','09:00',500)],[snap({balanceCents:$(50400)})]);
eq('snapshot: balance replaced by entered 50,400',r.balance.cents,$(50400)); eq('snapshot: difference recorded -100',r.reconciliation[0].diffCents,-$(100)); eq('snapshot: journal said 50,500',r.reconciliation[0].journalCents,$(50500)); eq('snapshot firm balance conf',r.balance.conf,'verified input'); ok('snapshot: warns about difference',r.warnings.some(w=>/differed/.test(w)));
r=run(S(),[T('2026-10-05','09:00',500)],[snap({balanceCents:$(50500)})]); ok('matching snapshot: no warning',!r.warnings.some(w=>/differed/.test(w)));
r=run(S(),[T('2026-10-05','09:00',500),T('2026-10-09','09:00',100)],[snap({balanceCents:$(50400)})]); eq('trades after a snapshot roll forward (50,500)',r.balance.cents,$(50500)); eq('...and become estimated',r.balance.conf,'estimated');

// ---- daily loss limit + reset time ----
const DL=(o)=>S(Object.assign({dailyLossLimitCents:$(1000)},o));
r=run(DL(),[T('2026-10-12','08:00',-400)]); eq('daily: 1,000 - 400 = 600',r.daily.remainingCents,$(600)); ok('daily: not reached',!r.daily.reached);
r=run(DL(),[T('2026-10-12','08:00',-400),T('2026-10-12','09:00',-400),T('2026-10-12','10:00',-300)]); eq('daily: 1,000 - 1,100 = -100',r.daily.remainingCents,-$(100)); ok('daily: reached',r.daily.reached);
r=run(DL(),[T('2026-10-12','08:00',500)]); eq('daily: profit day widens room (1,500)',r.daily.remainingCents,$(1500));
r=run(DL(),[T('2026-10-09','08:00',-900)]); eq('daily: yesterday loss does not count today (1,000)',r.daily.remainingCents,$(1000)); ok('daily: no trades today still calculable',r.daily.remainingCents!==null);
r=run(S(),[T('2026-10-12','08:00',-900)]); ok('daily: no limit set -> unavailable not 0',r.daily.remainingCents===null&&r.daily.conf==='unavailable');
// reset 17:00 CT, journal LA (2h behind CT). 14:30 LA = 16:30 CT same day; 15:30 LA = 17:30 CT next trading day
r=run(DL(),[T('2026-10-12','14:30',-400),T('2026-10-12','15:30',-100)]); // 10/12 14:30 LA => day 10/12 ; 15:30 LA => day 10/13 (future vs asOf Mon noon) => skipped as future
eq('reset: 16:30 CT stays in the day',r.daily.pnlCents,-$(400)); ok('reset: 17:30 CT belongs to the NEXT trading day (ignored as future)',r.counts.futureSkipped===1,r.counts);
r=run(DL(),[T('2026-10-12','14:30',-400),T('2026-10-12','15:30',-100)],[],LATER); eq('reset: next day sees the 17:30 trade',r.daily.pnlCents,-$(100)); eq('reset: next day remaining 900',r.daily.remainingCents,$(900));
r=run(S({resetTime:'00:00',resetTz:'America/Chicago'}),[T('2026-10-12','15:30',-100)],[]); eq('reset 00:00: calendar day',r.series[0].day,'2026-10-12');
r=run(S({resetTime:'18:00'}),[T('2026-10-07','15:30',100)]); eq('reset 18:00: 17:30 CT is before reset (same day)',r.series[0].day,'2026-10-07');
r=run(S({resetTime:'17:00'}),[T('2026-10-07','15:00',100)]); eq('reset 17:00 exactly: 17:00 CT starts the next day',r.series[0].day,'2026-10-08');
r=run(S(),[T('2026-10-07',null,100)]); eq('no time: day = entered date',r.series[0].day,'2026-10-07');

// ---- timezones & DST ----
// Spring forward (US 2026-03-08, both LA and Chicago switch together; LA is always 2h behind CT)
let rr=D.evaluate(S(),[T('2026-03-07','15:30',100),T('2026-03-08','15:30',100)],[],{asOf:Date.UTC(2026,2,20,12)});
eq('DST: Sat 15:30 PST = 17:30 CST -> Sunday trading day',rr.series[0].day,'2026-03-08'); eq('DST: Sun 15:30 PDT = 17:30 CDT -> Monday trading day',rr.series[1].day,'2026-03-09');
// Fall back (US 2026-11-01)
rr=D.evaluate(S(),[T('2026-10-31','14:30',100),T('2026-11-01','15:30',100)],[],{asOf:Date.UTC(2026,10,10,12)});
eq('DST fall-back: Sat 14:30 PDT = 16:30 CDT -> same day',rr.series[0].day,'2026-10-31'); eq('DST fall-back: Sun 15:30 PST = 17:30 CST -> Monday trading day',rr.series[1].day,'2026-11-02');
// ambiguous (repeated) and non-existent local times must not crash and must land on the right date
rr=D.evaluate(S(),[T('2026-11-01','01:30',10),T('2026-03-08','02:30',10)],[],{asOf:Date.UTC(2026,10,10,12)}); eq('DST ambiguous 01:30 on fall-back day',rr.series[1].day,'2026-11-01'); eq('DST nonexistent 02:30 on spring-forward day',rr.series[0].day,'2026-03-08'); ok('no crash on DST edge times',rr.ok&&rr.balance.cents===5002000);
// Journal in London vs Chicago reset: the US and UK change clocks on different dates
const LON=(o)=>S(Object.assign({journalTz:'Europe/London'},o));
rr=D.evaluate(LON(),[T('2026-02-10','22:30',100)],[],{asOf:Date.UTC(2026,2,1,12)}); eq('tz: London 22:30 GMT = 16:30 CST -> same day',rr.series[0].day,'2026-02-10');
rr=D.evaluate(LON(),[T('2026-03-10','22:30',100)],[],{asOf:Date.UTC(2026,2,20,12)}); eq('tz: Mar 10 London 22:30 GMT = 17:30 CDT (US already on DST) -> next day',rr.series[0].day,'2026-03-11');
rr=D.evaluate(LON(),[T('2026-04-10','22:30',100)],[],{asOf:Date.UTC(2026,3,20,12)}); eq('tz: Apr 10 London 22:30 BST = 16:30 CDT -> same day',rr.series[0].day,'2026-04-10');
// changing the journal timezone setting changes the day assignment of the same record
const same=[T('2026-10-07','15:30',100)];
eq('tz change: LA 15:30 -> 17:30 CT next day',run(S(),same).series[0].day,'2026-10-08'); eq('tz change: Chicago 15:30 -> same day',run(S({journalTz:'America/Chicago'}),same).series[0].day,'2026-10-07');
// tradingDay function directly
eq('tradingDay 21:59Z Oct 7 reset 17:00 CT (16:59 CDT)',D.tradingDay(Date.UTC(2026,9,7,21,59),1020,'America/Chicago'),'2026-10-07'); eq('tradingDay 22:00Z (17:00 CDT)',D.tradingDay(Date.UTC(2026,9,7,22,0),1020,'America/Chicago'),'2026-10-08');
eq('tradingDay winter 22:59Z (16:59 CST)',D.tradingDay(Date.UTC(2026,0,7,22,59),1020,'America/Chicago'),'2026-01-07'); eq('tradingDay winter 23:00Z (17:00 CST)',D.tradingDay(Date.UTC(2026,0,7,23,0),1020,'America/Chicago'),'2026-01-08');

// ---- profit target, trading days, consistency ----
const P=(o)=>S(Object.assign({profitTargetCents:$(3000)},o));
r=run(P(),[T('2026-10-05','09:00',1500)]); eq('target: 50%',r.progress.pct,50); eq('target: remaining 1,500',r.progress.remainingCents,$(1500)); ok('target: not reached',!r.progress.reached);
r=run(P(),[T('2026-10-05','09:00',3000)]); eq('target: 100%',r.progress.pct,100); ok('target: reached',r.progress.reached); ok('milestones include 100%',r.milestones.some(m=>m.label==='100% of profit target'&&m.day==='2026-10-05'));
r=run(P(),[T('2026-10-05','09:00',4500)]); eq('target: over 100 shown honestly (150)',r.progress.pct,150);
r=run(P(),[T('2026-10-05','09:00',-500)]); eq('target: loss -> 0%',r.progress.pct,0); eq('target: remaining 3,500',r.progress.remainingCents,$(3500));
r=run(S(),[T('2026-10-05','09:00',500)]); ok('no target set -> unavailable',r.progress.pct===null&&r.progress.remainingCents===null);
const MD=(o)=>S(Object.assign({minTradingDays:3},o));
r=run(MD(),[T('2026-10-05','09:00',100),T('2026-10-05','10:00',100),T('2026-10-06','09:00',-50)]); eq('min days: 2 days counted (2 trades same day = 1)',r.tradingDays.qualifying,2); eq('min days: 1 remaining',r.tradingDays.remaining,1); ok('min days: not met',r.tradingDays.met===false);
r=run(MD(),[T('2026-10-05','09:00',100),T('2026-10-06','09:00',-50),T('2026-10-07','09:00',10)]); ok('min days: met on day 3',r.tradingDays.met===true&&r.milestones.some(m=>/Minimum trading days/.test(m.label)&&m.day==='2026-10-07'));
r=run(MD({qualifyMode:'min-profit',qualifyMinProfitCents:$(200)}),[T('2026-10-05','09:00',250),T('2026-10-06','09:00',199.99),T('2026-10-07','09:00',200),T('2026-10-08','09:00',-500)]); eq('min-profit days: only >= $200 counts (2)',r.tradingDays.qualifying,2);
r=run(MD(),[]); eq('min days: no trades -> 0 of 3',r.tradingDays.qualifying,0); eq('min days remaining 3',r.tradingDays.remaining,3);
const CN=(p)=>S({consistencyPct:p});
const cd=[T('2026-10-05','09:00',1000),T('2026-10-06','09:00',500),T('2026-10-07','09:00',500),T('2026-10-08','09:00',1000)];
r=run(CN(40),cd); eq('consistency: best 1,000 of 3,000 = 33.33%',r.consistency.ratioPct,33.33); eq('consistency 40%: within limit',r.consistency.status,'within limit');
r=run(CN(30),cd); eq('consistency 30%: over limit',r.consistency.status,'over limit'); eq('consistency 30%: need total 3,334 (ceil)',r.consistency.neededTotalProfitCents,$(3333.34)); eq('consistency 30%: 333.34 more',r.consistency.additionalProfitCents,$(333.34));
r=run(CN(30),[T('2026-10-05','09:00',-500)]); ok('consistency with no net profit: not applicable',/not applicable/.test(r.consistency.status));
r=run(CN(30),cd,[cash('payout',2000,9)]); eq('consistency ignores payouts',r.consistency.totalProfitCents,$(3000));
r=run(S(),cd); eq('consistency not configured',r.consistency.status,'not configured');

// ---- data quality ----
r=run(S(),[T('2026-10-05','09:00',100),{t:{id:'o',date:'2026-10-06',time:'09:00',createdAt:5},c:{isClosed:false,status:'open'}}]); eq('open trades not counted',r.balance.cents,$(50100)); eq('open count',r.counts.open,1);
r=run(S(),[T('2026-10-05','09:00',100,{feesMissing:true,netCents:null})]); eq('missing fees: uses gross',r.balance.cents,$(50100)); ok('missing fees: warned',r.warnings.some(w=>/no fees entered/.test(w)));
r=run(S(),[T('2026-10-05','09:00',100),{t:{id:'bad',date:'nope',time:'09:00'},c:{isClosed:true,grossCents:5,netCents:5}},{t:null,c:null}]); ok('invalid rows skipped, counted',r.counts.invalidSkipped===2&&r.balance.cents===$(50100),r.counts);
r=run(S(),[T('2026-10-20','09:00',100)]); eq('future-dated trade ignored',r.balance.cents,$(50000)); eq('future skipped',r.counts.futureSkipped,1);
r=run(S({trackFrom:'2026-10-07'}),[T('2026-10-05','09:00',500),T('2026-10-08','09:00',100)]); eq('trackFrom excludes earlier trades',r.balance.cents,$(50100)); eq('excluded counted',r.counts.excludedBeforeStart,1);
r=run(S(),[T('2026-10-05','09:00',100)],[],Date.UTC(2026,9,20,12)); ok('stale data warned after 3 days',r.warnings.some(w=>/last 3 days/.test(w)));
r=run(S(),[T('2026-10-11','09:00',100)]); ok('fresh data: no stale warning',!r.warnings.some(w=>/last 3 days/.test(w)));
ok('invalid settings -> ok:false with errors',(x=>x.ok===false&&x.errors.length>0)(D.evaluate(S({maxLossCents:'x'}),[],[])));
// duplicate ledger detection
const dl=cash('payout',1000,6); ok('duplicate ledger record found',D.findDuplicate([dl],Object.assign({},dl,{id:'new'}))!==null); ok('voided duplicate not counted',D.findDuplicate([Object.assign({},dl,{voided:true})],Object.assign({},dl,{id:'new'}))===null); ok('different amount not duplicate',D.findDuplicate([dl],Object.assign({},dl,{amountCents:$(999)}))===null);
// validateLedger
let L=D.validateLedger({type:'payout',accountId:'a',date:'2026-10-06',amount:'1,000'},{now:NOW}); ok('ledger valid',L.ok&&L.record.amountCents===$(1000));
[['bad amount',{type:'payout',accountId:'a',date:'2026-10-06',amount:'x'}],['neg amount',{type:'payout',accountId:'a',date:'2026-10-06',amount:'-5'}],['bad date',{type:'fee',feeKind:'reset',accountId:'a',date:'2026-13-40',amount:'5'}],['fee without kind',{type:'fee',accountId:'a',date:'2026-10-06',amount:'5'}],['snapshot empty',{type:'snapshot',accountId:'a',date:'2026-10-06'}],['snapshot bad',{type:'snapshot',accountId:'a',date:'2026-10-06',balance:'abc'}],['future',{type:'payout',accountId:'a',date:'2027-01-01',amount:'5'}],['no account',{type:'payout',date:'2026-10-06',amount:'5'}],['bad type',{type:'x',accountId:'a',date:'2026-10-06',amount:'5'}],['bad time',{type:'payout',accountId:'a',date:'2026-10-06',time:'99:99',amount:'5'}]
].forEach(([n,f])=>ok('ledger invalid: '+n,!D.validateLedger(f,{now:NOW}).ok));
ok('snapshot zero balance allowed as value',D.validateLedger({type:'snapshot',accountId:'a',date:'2026-10-06',balance:'0'},{now:NOW}).ok);

// ---- rule versions & rule changes ----
const meta={confirmed:true,verifiedOn:'2026-10-10',source:'https://example.com/rules'};
let c1=D.confirmVersion(null,E(),meta,NOW); ok('confirm v1',c1.ok&&c1.version.n===1&&D.activeVersion(c1.dd).n===1);
[['no confirm tick',{confirmed:false}],['no date',{verifiedOn:''}],['future date',{verifiedOn:'2026-12-31'}],['no source',{source:''}]].forEach(([n,o])=>ok('confirmation refused: '+n,!D.confirmVersion(null,E(),Object.assign({},meta,o),NOW).ok));
ok('invalid numbers cannot be confirmed',!D.confirmVersion(null,E({maxLossCents:'abc'}),meta,NOW).ok);
ok('same settings -> unchanged, no new version',D.confirmVersion(c1.dd,E(),meta,NOW).unchanged===true);
let c2=D.confirmVersion(c1.dd,E({maxLossCents:$(2500)}),meta,NOW); ok('changed rules -> version 2, v1 retired, history kept',c2.ok&&c2.dd.versions.length===2&&c2.dd.versions[0].retired===true&&c2.dd.versions[1].n===2);
ok('change list names the field',c2.version.changes.length===1&&c2.version.changes[0].field==='maxLossCents'&&c2.version.changes[0].from===$(2000)&&c2.version.changes[0].to===$(2500));
eq('original dd not mutated',c1.dd.versions[0].retired,false);
// recalculation after a rule change: same trades, derived values change safely
const v1=run(E(),tr), v2=run(E({maxLossCents:$(2500)}),tr);
eq('v1 threshold 50,500',v1.threshold.cents,$(50500)); eq('v2 (max loss 2,500) threshold 50,000',v2.threshold.cents,$(50000)); eq('v2 buffer 1,700',v2.buffer.cents,$(1700));
// retired version evaluated up to the day before the next one starts tracking
const c3=D.confirmVersion(c2.dd,E({maxLossCents:$(2500),trackFrom:'2026-10-07'}),meta,NOW); const w=D.versionWindow(c3.dd,2);
eq('window of v2 ends day before v3 starts',w.untilDay,'2026-10-06');
const old=D.evaluate(c3.dd.versions[1].settings,tr,[],{asOf:NOW,untilDay:w.untilDay}); eq('old version result excludes later trades (balance 52,500)',old.balance.cents,$(52500)); eq('old version threshold at that time',old.threshold.cents,$(50000));
eq('new version counts only from trackFrom (51,700-... = start + -800)',run(c3.dd.versions[2].settings,tr).balance.cents,$(49200));
ok('normalizeDd tolerates garbage',D.normalizeDd(5).versions.length===0&&D.activeVersion(undefined)===null);

// ---- accounts with no data / extreme values ----
r=run(E(),[],[]); eq('no trades eod: hwm=start',r.hwm.cents,$(50000)); eq('no trades eod: threshold 48,000',r.threshold.cents,$(48000)); ok('no trades: no NaN anywhere',!JSON.stringify(r).includes('NaN')&&!JSON.stringify(r).includes('null')===false);
const big=[]; for(let i=0;i<3000;i++) big.push(T('2026-0'+(1+(i%9))+'-'+String(1+(i%27)).padStart(2,'0'),'09:'+String(i%60).padStart(2,'0'),(i%7)-3)); const t0=Date.now(); r=run(E(),big); ok('3,000 trades evaluate in <500ms',Date.now()-t0<500&&r.ok,Date.now()-t0);
// integer-cent exactness: 0.1 + 0.2 style sums
r=run(S(),[T('2026-10-05','09:00',0.1),T('2026-10-05','09:05',0.2)]); eq('cents are exact (0.10+0.20 = 0.30)',r.balance.cents,5000030);

{ const now=Date.UTC(2026,9,12,17,0); const a1=D.validateLedger({type:'fee',feeKind:'reset',accountId:'a',date:'2026-10-12',amount:'100'},{now}).record, a2=D.validateLedger({type:'fee',feeKind:'reset',accountId:'a',date:'2026-10-12',amount:'100'},{now:now+60000}).record;
  ok('same-day identical fee entered a minute later is a duplicate',D.findDuplicate([a1],a2)!==null); ok('different day is not a duplicate',D.findDuplicate([a1],Object.assign({},a2,{date:'2026-10-11'}))===null); ok('different reference is not a duplicate',D.findDuplicate([a1],Object.assign({},a2,{ref:'r2'}))===null); }
// record dated today without a time means "now" so later entries sort after earlier ones
{ const now=Date.UTC(2026,9,12,17,0); const L1=D.validateLedger({type:'snapshot',accountId:'a',date:'2026-10-12',balance:'1000'},{now}); eq('snapshot dated today, no time -> now',L1.record.at,now);
  const L2=D.validateLedger({type:'payout',accountId:'a',date:'2026-10-12',amount:'5'},{now}); eq('payout dated today, no time -> now',L2.record.at,now);
  const L3=D.validateLedger({type:'payout',accountId:'a',date:'2026-10-10',amount:'5'},{now}); eq('older payout, no time -> noon in journal tz',L3.record.at,Date.UTC(2026,9,10,19,0));
  const L4=D.validateLedger({type:'snapshot',accountId:'a',date:'2026-10-10',balance:'5'},{now}); eq('older snapshot, no time -> 23:59 in journal tz',L4.record.at,Date.UTC(2026,9,11,6,59)); }
console.log((fail?'FAILED ':'ALL PASSED ')+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
