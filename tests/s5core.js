const R=require('path').join(__dirname,'..','assets')+'/';
global.window=global; require(R+'instruments.js'); const C=require(R+'journal-core.js');
let fail=0; const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++; console.log(ok?'ok  ':'FAIL',n,ok?'':`\n     got  ${JSON.stringify(g)}\n     want ${JSON.stringify(w)}`)};
let id=0;
function T(o){const r=C.normalizeTrade(Object.assign({id:'t'+(++id),date:'2026-10-26',contract:'NNQ',side:'long',contracts:1,entry:'100',exits:[]},o));
  if(!r.ok) throw new Error('invalid test trade: '+r.errors.join('; ')); return r.trade;}
const A=(...ts)=>C.analyze(ts);
const c1=t=>C.compute(t);

// ---- per-trade P&L (hand-calculated) ----
eq('NNQ long 2x, 21000->21010.50 = $4.20',c1(T({contracts:2,entry:'21000',exits:[{qty:2,price:'21010.50'}]})).grossCents,420);
eq('ES short 1x, 5000->4990.25 = +$487.50',c1(T({contract:'ES',side:'short',entry:'5000',exits:[{qty:1,price:'4990.25'}]})).grossCents,48750);
eq('ES short loses when price rises',c1(T({contract:'ES',side:'short',entry:'5000',exits:[{qty:1,price:'5002'}]})).grossCents,-10000);
eq('NQ long 1x 20000->19990 = -$200',c1(T({contract:'NQ',entry:'20000',exits:[{qty:1,price:'19990'}]})).grossCents,-20000);
eq('MES 0.25 tick = $1.25',c1(T({contract:'MES',entry:'5000',exits:[{qty:1,price:'5000.25'}]})).grossCents,125);
// partial exits
let p=c1(T({contract:'MNQ',contracts:3,entry:'100',exits:[{qty:1,price:'110'},{qty:1,price:'105'}]}));
eq('partial: 2 of 3 exited => (10+5)pts*$2 = $30 realized so far',[p.status,p.grossCents,p.netCents,p.remainingQty,p.isClosed],['partial',3000,null,1,false]);
p=c1(T({contract:'MNQ',contracts:3,entry:'100',exits:[{qty:1,price:'110'},{qty:2,price:'95'}]}));
eq('closed scale-out nets to exactly $0 => result be, gross 0 (not null)',[p.status,p.grossCents,p.result],['closed',0,'be']);
eq('avg exit is qty-weighted',c1(T({contract:'MNQ',contracts:3,entry:'100',exits:[{qty:1,price:'110'},{qty:2,price:'95'}]})).avgExit,100);
p=c1(T({})); eq('no exits => open, gross null (not 0)',[p.status,p.grossCents,p.shownCents,p.result],['open',null,null,'open']);
// fees: missing vs zero vs value
p=c1(T({exits:[{qty:1,price:'110'}]})); eq('fees blank => feesCents null, net null (NOT gross)',[p.feesCents,p.feesMissing,p.netCents,p.shownKind],[null,true,null,'gross']);
p=c1(T({exits:[{qty:1,price:'110'}],fees:'0'})); eq('fees "0" is recorded zero => net = gross',[p.feesCents,p.feesMissing,p.netCents,p.grossCents],[0,false,200,200]);
p=c1(T({exits:[{qty:1,price:'110'}],fees:'0.50'})); eq('fees 0.50 => net = 200-50',[p.netCents,p.shownKind],[150,'net']);
p=c1(T({contracts:2,exits:[{qty:1,price:'110'}],fees:'1'})); eq('partial + fees: net stays null until closed',[p.status,p.netCents,p.shownKind],['partial',null,'realized']);
p=c1(T({exits:[{qty:1,price:'95'}],fees:'3'})); eq('fees make small win a net loss',[p.grossCents,p.netCents,p.result],[-100,-400,'loss']);
p=c1(T({exits:[{qty:1,price:'100.50'}],fees:'3'})); eq('gross win 10c but net loss => result uses net',[p.grossCents,p.netCents,p.result],[10,-290,'loss']);
// R multiple
p=c1(T({contract:'NQ',entry:'20000',stop:'19990',exits:[{qty:1,price:'20020'}]})); eq('R: risk $200, gross $400 => 2.00R',[p.plannedRiskCents,p.rMultiple],[20000,2]);
p=c1(T({contract:'NQ',entry:'20000',stop:'19990',exits:[{qty:1,price:'19990'}]})); eq('R: -1.00R at stop',p.rMultiple,-1);
p=c1(T({contract:'NQ',contracts:2,entry:'20000',stop:'19990',exits:[{qty:1,price:'20020'},{qty:1,price:'20000'}]})); eq('R scale-out: risk $400, gross $400 => 1R',[p.plannedRiskCents,p.rMultiple],[40000,1]);
p=c1(T({entry:'100',exits:[{qty:1,price:'110'}]})); eq('no stop => R null (not 0)',[p.plannedRiskCents,p.rMultiple],[null,null]);
p=c1(T({contract:'NQ',entry:'20000',stop:'19990',exits:[]})); eq('open trade => R null',p.rMultiple,null);
// short side R
p=c1(T({contract:'ES',side:'short',entry:'5000',stop:'5004',exits:[{qty:1,price:'4992'}]})); eq('short R: risk $200, gain $400 => 2R',p.rMultiple,2);

// ---- validation ----
const bad=(n,o)=>eq('rejects: '+n,C.normalizeTrade(Object.assign({date:'2026-10-26',contract:'NNQ',side:'long',contracts:1,entry:'100',exits:[]},o)).ok,false);
bad('bad date',{date:'2026-02-30'}); bad('unknown contract',{contract:'XYZ'}); bad('prototype key contract',{contract:'constructor'}); bad('side',{side:'flat'});
bad('0 contracts',{contracts:0}); bad('fractional contracts',{contracts:1.5}); bad('entry 0',{entry:'0'}); bad('3 decimals',{entry:'100.123'});
bad('long stop above entry',{stop:'101'}); bad('short stop below entry',{side:'short',stop:'99'}); bad('stop = entry',{stop:'100'});
bad('exits exceed position',{contracts:1,exits:[{qty:2,price:'101'}]}); bad('exit qty w/o price',{exits:[{qty:1,price:''}]}); bad('negative fees',{fees:'-1'});
bad('session',{session:'Mars'}); bad('rating 6',{rating:'6'}); bad('time 25:00',{time:'25:00'});
eq('blank exit row ignored',C.normalizeTrade({date:'2026-10-26',contract:'NNQ',side:'long',contracts:1,entry:'100',exits:[{qty:'',price:''}]}).ok,true);
eq('rules tri-state',['yes','no','',null,true,false].map(v=>T({followedRules:v}).followedRules),[true,false,null,null,true,false]);

// ---- statistics vs independent oracle ----
function mk(d,side,entry,exit,fees,extra){return T(Object.assign({date:d,contract:'MNQ',side,contracts:1,entry:String(entry),exits:[{qty:1,price:String(exit)}],fees:fees},extra||{}));}
// MNQ $2/pt. net: +20-1, -10-1, +30-1, -40-1, +5-1
const trades=[mk('2026-10-20','long',100,110,'1',{stop:'95',session:'New York',strategy:'ORB'}),
 mk('2026-10-21','long',100,95,'1',{stop:'95',session:'New York',strategy:'orb'}),
 mk('2026-10-22','long',100,115,'1',{stop:'95',session:'London',strategy:'Pullback'}),
 mk('2026-10-23','long',100,80,'1',{stop:'95',session:'Asia'}),
 mk('2026-10-24','long',100,102.5,'1',{session:'London',strategy:'Pullback'})];
const net=[1900,-1100,5900,-4100,400-100+0].map((x,i)=>i===4?400:x); // last: gross 5pt*2=$10? recompute below
// recompute by hand: gross = (exit-entry)*200c: 10*200=2000, -5*200=-1000, 15*200=3000, -20*200=-4000, 2.5*200=500
const gross=[2000,-1000,3000,-4000,500], fee=100, netv=gross.map(g=>g-fee);
let s=C.stats(A(...trades),'net');
eq('n/wins/losses',[s.n,s.wins,s.losses],[5,3,2]);
eq('net pnl = sum(gross)-5*fee',s.pnlCents,gross.reduce((a,b)=>a+b)-5*fee);
eq('win rate 3/5',s.winRate,0.6);
const gp=netv.filter(v=>v>0).reduce((a,b)=>a+b,0), gl=netv.filter(v=>v<0).reduce((a,b)=>a+b,0);
eq('profit factor',s.profitFactor,gp/Math.abs(gl)); eq('avg winner',s.avgWinCents,gp/3); eq('avg loser',s.avgLossCents,gl/2);
// drawdown on net equity curve: 1900,800,3700,-400... peak 3700 -> trough -400-? compute
let eq_=0,pk=0,dd=0; netv.forEach(v=>{eq_+=v;pk=Math.max(pk,eq_);dd=Math.max(dd,pk-eq_)}); eq('max drawdown',s.maxDrawdownCents,dd);
// R (gross): trades with stop => rows 0..3: +2,-1,+3,-4 (risk 5pts*$2=$10=1000c ; gross/1000)
eq('R values only from trades with a stop',s.rCount,4);
eq('avg win R / avg loss R',[s.avgWinR,s.avgLossR,s.realizedRR],[2.5,-2.5,1]);
eq('avg R',s.avgR,(2-1+3-4)/4);
// gross basis includes everything
s=C.stats(A(...trades),'gross'); eq('gross pnl',s.pnlCents,gross.reduce((a,b)=>a+b));
// missing fees excluded from NET, not zeroed
const withMissing=trades.concat([mk('2026-10-25','long',100,150,'' )]);
s=C.stats(A(...withMissing),'net'); eq('closed trade w/o fees is EXCLUDED from net (n stays 5) and counted in excludedNoFees',[s.n,s.excludedNoFees,s.closedCount,s.feesMissingCount],[5,1,6,1]);
eq('...and net pnl unchanged by the excluded trade',s.pnlCents,gross.reduce((a,b)=>a+b)-5*fee);
s=C.stats(A(...withMissing),'gross'); eq('gross counts it (n=6)',[s.n,s.pnlCents],[6,gross.reduce((a,b)=>a+b)+10000]);
// open/partial never counted
const openT=T({date:'2026-10-27'}), partT=T({date:'2026-10-27',contracts:2,exits:[{qty:1,price:'200'}]});
s=C.stats(A(...trades,openT,partT),'net'); eq('open+partial excluded and reported',[s.n,s.openCount],[5,2]);
// empty / one-sided
s=C.stats([],'net'); eq('empty => nulls not zeros',[s.n,s.winRate,s.pnlCents,s.profitFactor,s.avgWinCents,s.maxDrawdownCents,s.realizedRR],[0,null,null,null,null,null,null]);
s=C.stats(A(mk('2026-10-20','long',100,110,'1')),'net'); eq('only winners: profit factor null with note, avg loser null',[s.profitFactor,s.profitFactorNote,s.avgLossCents],[null,'no losing trades yet',null]);
s=C.stats(A(mk('2026-10-20','long',100,110,'1')),'net'); eq('no losers => drawdown is 0',s.maxDrawdownCents,0);
// drawdown starting with a loss (the suspected crash path)
s=C.stats(A(mk('2026-10-20','long',100,95,'1'),mk('2026-10-21','long',100,110,'1')),'net');
eq('first-trade loss: drawdown computed',s.maxDrawdownCents,1100);
console.log('   ddFrom/ddTo when first trade is a loss ->',JSON.stringify([s.ddFrom,s.ddTo]));
eq('ddFrom is null when the drawdown starts at the very beginning (UI renders "Start")',[s.ddFrom,s.ddTo],[null,'2026-10-20']);
// breakdown
const bs=C.breakdown(A(...trades),r=>r.t.session||'Unspecified',C.SESSIONS,'net');
eq('by session: order Asia, London, New York; pnl',bs.map(g=>g.key+':'+g.pnlCents).join(),'Asia:-4100,London:'+(2900+400)+',New York:'+(1900-1100));
const bst=C.breakdown(A(...trades),r=>r.t.strategy?r.t.strategy.toLowerCase():'Unspecified',null,'net');
eq('strategy groups merge ORB/orb; Unspecified last',bst.map(g=>g.key+':'+g.n).join(),'pullback:2,orb:2,Unspecified:1');
// calendar / today
const dm=C.dailyMap(A(...trades,openT),'net'); eq('daily net',dm['2026-10-22'].pnlCents,2900);
eq('day with only an open trade: pnl null (not 0), open=1',[dm['2026-10-27'].pnlCents,dm['2026-10-27'].open],[null,1]);
const ts=C.todaySummary(A(mk('2026-10-30','long',100,110,'1'),mk('2026-10-30','long',100,105,'')),'2026-10-30');
eq('today: missing fees on one => gross basis, flagged',[ts.basis,ts.cents,ts.feesMissing,ts.closed],['gross',3000,1,2]);
eq('today: nothing closed => null',C.todaySummary(A(openT),'2026-10-27').cents,null);
// filters
const rows=A(...trades,openT);
eq('filter session',C.filterRows(rows,{session:'London'}).length,2); eq('filter strategy case-insens',C.filterRows(rows,{strategy:'ORB'}).length,2);
eq('filter result loss',C.filterRows(rows,{result:'loss'}).length,2); eq('filter open',C.filterRows(rows,{result:'open'}).length,1);
eq('filter date range',C.filterRows(rows,{from:'2026-10-21',to:'2026-10-23'}).length,3);
const note=T({notes:'Chased the move',mistakes:'moved my STOP'}); eq('search is case-insensitive across text fields',[C.filterRows(A(note),{q:'chased'}).length,C.filterRows(A(note),{q:'stop'}).length,C.filterRows(A(note),{q:'zzz'}).length],[1,1,0]);
eq('rules filter unknown',C.filterRows(A(T({}),T({followedRules:true})),{rules:'unknown'}).length,1);
// CSV
const csvT=T({notes:'=HYPERLINK("x")',strategy:'a,b',entryReason:'say "hi"\nline2',exits:[{qty:1,price:'110'}]});
const csv=C.toCsv(A(csvT)); const lines=csv.split('\r\n');
eq('csv header',lines[0].split(',').length,C.CSV_COLS.length);
eq('csv: formula injection neutralised',csv.includes("'=HYPERLINK"),true); eq('csv: comma quoted',csv.includes('"a,b"'),true); eq('csv: quotes doubled',csv.includes('"say ""hi""'),true);
eq('csv: missing fees/net/stop are blank, not 0',(()=>{const row=C.toCsv(A(T({exits:[{qty:1,price:'110'}]}))).split('\r\n')[1].split(','); const h=C.CSV_COLS; return [row[h.indexOf('fees')],row[h.indexOf('net_pnl')],row[h.indexOf('stop')],row[h.indexOf('r_multiple')]]})(),['','','','']);
eq('csv: recorded zero fees is "0.00"',(()=>{const row=C.toCsv(A(T({exits:[{qty:1,price:'110'}],fees:'0'}))).split('\r\n')[1].split(','); return row[C.CSV_COLS.indexOf('fees')]})(),'0.00');
// backup round trip + hostile input
const back=C.parseBackup(C.serializeBackup(trades,{[trades[0].id+':before']:'data:image/jpeg;base64,AAAA','evil:before':'data:image/jpeg;base64,AAAA',[trades[1].id+':after']:'javascript:alert(1)'}));
eq('backup round-trips all trades',back.trades.length,5); eq('backup keeps valid shot only',Object.keys(back.shots),[trades[0].id+':before']);
eq('backup preserves a trade exactly',JSON.stringify(back.trades[0]),JSON.stringify(trades[0]));
eq('bad json',C.parseBackup('{{').ok,false); eq('no trades key',C.parseBackup('{"a":1}').ok,false);
eq('skips invalid rows & dup ids',C.parseBackup(JSON.stringify({trades:[trades[0],trades[0],{date:'x'}]})).skipped.length,2);
eq('merge adds only new ids',C.mergeTrades([trades[0]],[trades[0],trades[1]],'merge').added,1);
eq('replace swaps',C.mergeTrades([trades[0]],[trades[1]],'replace').trades.length,1);
// stored data resilience
eq('corrupt storage flagged, not thrown',C.parseStored('{{{').corrupt,true); eq('empty storage ok',C.parseStored(null).trades.length,0);
eq('invalid entries set aside',C.parseStored(JSON.stringify({v:1,trades:[trades[0],{bad:1}]})).rejected.length,1);
// formatting
eq('fmtMoney null => em dash',C.fmtMoney(null),'—'); eq('fmtMoney 0 => $0.00 (a real zero)',C.fmtMoney(0),'$0.00'); eq('fmtMoney plus',C.fmtMoney(12345,true),'+$123.45'); eq('fmtMoney neg',C.fmtMoney(-5),'-$0.05');
console.log(fail?`\n${fail} FAILED`:'\nCORE TESTS PASSED');
