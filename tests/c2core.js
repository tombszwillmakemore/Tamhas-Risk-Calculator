const R=require('path').join(__dirname,'..','assets')+'/';
global.TTSessions=require(R+'sessions.js'); global.TTInstruments=require(R+'instruments.js'); const J=require(R+'journal-core.js'); const I=require(R+'import-core.js');
let pass=0,fail=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } }; const eq=(n,a,b)=>ok(n,JSON.stringify(a)===JSON.stringify(b),{got:a,want:b});
// ---- CSV parsing
let p=I.parseCsv('﻿a,b,c\r\n1,"x,y",3\r\n"multi\nline","q""uote",z\r\n\r\n4,5,6\r\n'); ok('csv ok',p.ok,p); eq('BOM stripped, headers',p.headers,['a','b','c']); eq('quoted comma/newline/escaped quote',p.rows,[['1','x,y','3'],['multi\nline','q"uote','z'],['4','5','6']]);
eq('semicolon delimiter detected',I.parseCsv('a;b\n1;2\n').rows,[['1','2']]); eq('tab delimiter detected',I.parseCsv('a\tb\n1\t2\n').delimiter,'\t'); eq('delimiter inside quotes ignored in detection',I.parseCsv('"a,b";c\n1;2\n').delimiter,';');
ok('unterminated quote -> error',!I.parseCsv('a,b\n"1,2\n').ok&&/quote/.test(I.parseCsv('a,b\n"1,2\n').error)); ok('empty file -> error',!I.parseCsv('').ok); ok('header only -> error',!I.parseCsv('a,b\n').ok);
eq('no trailing newline still read',I.parseCsv('a,b\n1,2').rows,[['1','2']]); eq('last row with empty trailing cell kept',I.parseCsv('a,b\n1,\n').rows,[['1','']]);
// ---- numbers, sides
eq('numbers',['1,234.50','$(25.50)','(25.50)','-3','+2','.5','1e3','abc','','1,23','12.'].map(I.parseNumber),[1234.5,-25.5,-25.5,-3,2,0.5,null,null,null,null,null]);
eq('fill sides',['Buy','SELL','b','S','BOT','sld','Short','long','x',''].map(s=>I.parseSide(s,'fills')),['buy','sell','buy','sell','buy','sell','sell','buy',null,null]);
eq('trade sides',['Long','SHORT','buy','Sell','s','x'].map(s=>I.parseSide(s,'trades')),['long','short','long','short','short',null]);
// ---- timestamps
const LA={targetTz:'America/Los_Angeles'};
eq('ISO Z -> LA PDT',(({date,time})=>[date,time])(I.parseTimestamp('2026-10-21T13:30:00Z',LA)),['2026-10-21','06:30']);
eq('offset +02:00 -> LA',(({date,time})=>[date,time])(I.parseTimestamp('2026-10-21 18:00:00+02:00',LA)),['2026-10-21','09:00']);
eq('NY wall time EDT -> LA',(({date,time})=>[date,time])(I.parseTimestamp('2026-10-21 09:30:00',Object.assign({fileTz:'America/New_York'},LA))),['2026-10-21','06:30']);
eq('NY wall time EST (winter) -> LA',(({date,time})=>[date,time])(I.parseTimestamp('2026-12-01 09:30:00',Object.assign({fileTz:'America/New_York'},LA))),['2026-12-01','06:30']);
eq('UTC file tz crosses midnight backwards',(({date,time})=>[date,time])(I.parseTimestamp('2026-10-21 03:15:00',Object.assign({fileTz:'UTC'},LA))),['2026-10-20','20:15']);
eq('as-is keeps wall time untouched',(({date,time})=>[date,time])(I.parseTimestamp('10/21/2026 9:30:15 PM',{fileTz:'as-is',targetTz:'America/Los_Angeles'})),['2026-10-21','21:30']);
eq('12h AM/PM: 12:05 AM and 12:05 PM',[I.parseTimestamp('1/2/2026 12:05 AM',{}).time,I.parseTimestamp('1/2/2026 12:05 PM',{}).time],['00:05','12:05']);
eq('dmy order',I.parseTimestamp('25/12/2026 10:00',{dateOrder:'dmy'}).date,'2026-12-25'); eq('mdy order',I.parseTimestamp('12/25/2026 10:00',{dateOrder:'mdy'}).date,'2026-12-25');
ok('mdy with 25 as month rejected',I.parseTimestamp('25/12/2026 10:00',{dateOrder:'mdy'})===null); ok('impossible date rejected',I.parseTimestamp('02/30/2026 10:00',{})===null&&I.parseTimestamp('2026-13-01',{})===null);
eq('two-digit year',I.parseTimestamp('10/21/26 10:00',{}).date,'2026-10-21'); eq('yyyymmdd',I.parseTimestamp('20261021',{}).date,'2026-10-21'); eq('date only has no time',I.parseTimestamp('2026-10-21',{}).hasTime,false);
ok('garbage / time only rejected',I.parseTimestamp('hello',{})===null&&I.parseTimestamp('10:30',{})===null&&I.parseTimestamp('',{})===null); ok('bad tz rejected',I.parseTimestamp('2026-10-21 09:30',{fileTz:'Nope/Zone',targetTz:'UTC'})===null);
eq('fractional seconds ok',I.parseTimestamp('2026-10-21 09:30:15.250',{}).time,'09:30'); ok('hour 24 rejected',I.parseTimestamp('2026-10-21 24:00',{})===null);
// ---- symbols
eq('symbols',['MNQZ6','mnq z26','/MES','ES 12-26','NQ DEC26','MNQ1!','NNQH7','ESM2026','CLZ6','XYZ','','MNQ.CME'].map(I.normalizeSymbol),['MNQ','MNQ','MES','ES','NQ','MNQ','NNQ','ES',null,null,null,'MNQ']);
// ---- reading + pairing
const OPT={mode:'fills',mapping:{time:0,symbol:1,side:2,qty:3,price:4,fees:5,account:6},fileTz:'as-is',targetTz:'America/Los_Angeles',defaultAccountId:'acct-x'};
const csv=(rows)=>I.parseCsv('time,symbol,side,qty,price,fees,account\n'+rows.map(r=>r.join(',')).join('\n')+'\n');
const run=(rows,o)=>I.plan(csv(rows),Object.assign({},OPT,o||{}),new Set(),J);
let r=run([['2026-10-21 09:30:00','MNQZ6','Buy',1,100,'0.50',''],['2026-10-21 09:35:00','MNQZ6','Sell',1,101,'0.50','']]); eq('simple long: 1 trade',r.trades.length,1); let t=r.trades[0].trade;
ok('simple long fields',t.contract==='MNQ'&&t.side==='long'&&t.contracts===1&&t.entry===100&&t.exits.length===1&&t.exits[0].time==='09:35'&&t.feesCents===100&&t.date==='2026-10-21'&&t.time==='09:30'&&t.accountId==='acct-x',t);
eq('simple long gross = $2 (1pt x $2)',r.trades[0].c.grossCents,200);
r=run([['2026-10-21 09:30:00','MNQ','Buy',2,100,'',''],['2026-10-21 09:31:00','MNQ','Buy',1,103,'',''],['2026-10-21 09:40:00','MNQ','Sell',3,101,'','']]); t=r.trades[0].trade;
ok('scale-in detected: entries 2@100,1@103',r.trades.length===1&&t.entries&&t.entries.length===2&&t.contracts===3,t); eq('FIFO gross: +2 +2? (101-100)x2 + (101-103)x1 = 0 pts',r.trades[0].c.grossCents,0); ok('no fees column data -> not entered',t.feesCents===null);
r=run([['2026-10-21 09:30:00','MNQ','Buy',3,100,'',''],['2026-10-21 09:31:00','MNQ','Sell',1,102,'',''],['2026-10-21 09:32:00','MNQ','Sell',2,101,'','']]); eq('partial exits -> one trade, two exits, closed',[r.trades.length,r.trades[0].trade.exits.length,r.trades[0].c.status],[1,2,'closed']); eq('gross (2 + 1x2) pts = 4pts=$8',r.trades[0].c.grossCents,800);
// flip with fee split
r=run([['2026-10-21 09:30:00','MNQ','Buy',2,100,'1.00',''],['2026-10-21 09:40:00','MNQ','Sell',3,101,'1.50','']]);
ok('flip: closes long and opens short remainder',r.trades.length===2&&r.trades[0].trade.side==='long'&&r.trades[1].trade.side==='short'&&r.trades[1].trade.contracts===1,r.trades.map(x=>x.trade.side)); eq('flip: remainder is OPEN at end',r.openAtEnd,1);
eq('flip fee split preserves the total: 1.50 = 1.00 on the long close + 0.50 on the short remainder',[r.trades[0].trade.feesCents,r.trades[1].trade.feesCents],[200,50]);
r=run([['2026-10-21 09:30:00','MNQ','Buy',2,100,'1.00',''],['2026-10-21 09:40:00','MNQ','Sell',3,101,'1.50',''],['2026-10-21 09:50:00','MNQ','Buy',1,100,'0.25','']]); eq('flip then cover: short closed, fees = 0.50 + 0.25',[r.trades[1].trade.feesCents,r.trades[1].c.status],[75,'closed']);
// short, open, sorting, same-time order
r=run([['2026-10-21 09:40:00','MNQ','Buy',1,99,'',''],['2026-10-21 09:30:00','MNQ','Sell',1,100,'','']]); eq('unsorted file is ordered by time -> short trade closed',[r.trades[0].trade.side,r.trades[0].c.grossCents],['short',200]);
r=run([['2026-10-21 09:30:00','MNQ','Sell',1,100,'',''],['2026-10-21 09:30:00','MNQ','Buy',1,99,'','']]); eq('same timestamp keeps file order',r.trades[0].trade.side,'short');
r=run([['2026-10-21 09:30:00','MNQ','Buy',1,100,'','']]); eq('never closed -> open trade flagged',[r.trades[0].c.status,r.openAtEnd],['open',1]);
// separation
r=run([['2026-10-21 09:30:00','MNQ','Buy',1,100,'',''],['2026-10-21 09:31:00','ES','Sell',1,5000,'',''],['2026-10-21 09:32:00','MNQ','Sell',1,101,'',''],['2026-10-21 09:33:00','ES','Buy',1,4999,'','']]); eq('two contracts never mix',r.trades.map(x=>x.trade.contract+':'+x.trade.side).sort(),['ES:short','MNQ:long']);
r=run([['2026-10-21 09:30:00','MNQ','Buy',1,100,'','A1'],['2026-10-21 09:31:00','MNQ','Sell',1,101,'','A2']],{accountMap:{A1:'acct-1',A2:'acct-2'}}); eq('two accounts never mix (each leaves an open leg)',r.trades.map(x=>x.trade.accountId+':'+x.trade.side).sort(),['acct-1:long','acct-2:short']);
// problems
r=run([['2026-10-21 09:30:00','MNQ','Buy',1,100.123,'',''],['2026-10-21 09:30:00','MNQ','Hold',1,100,'',''],['2026-10-21 09:30:00','MNQ','Buy',0,100,'',''],['bad','MNQ','Buy',1,100,'',''],['2026-10-21 09:30:00','MNQ','Buy',1,100,'abc',''],['2026-10-21 09:30:00','CLZ6','Buy',1,2000,'',''],['2026-10-21 09:30:00','','Buy',1,2000,'','']]);
eq('7 bad rows -> 0 trades',r.trades.length,0); eq('problem reasons counted',Object.keys(r.problems).length,5); eq('unsupported contracts listed, not guessed',r.unsupported,{CLZ6:1,'(blank)':1});
ok('problem rows reference file line numbers',Object.values(r.problems).every(x=>x.rows.length&&x.rows[0]>=2));
// ---- duplicates / partial / identical fills in one file
const rowsA=[['2026-10-21 09:30:00','MNQ','Buy',1,100,'',''],['2026-10-21 09:35:00','MNQ','Sell',1,101,'','']]; r=run(rowsA); const keys=new Set(r.trades.flatMap(x=>x.trade.srcKeys));
let r2=I.plan(csv(rowsA),OPT,keys,J); eq('re-import same file -> all duplicates, none new',[r2.trades.length,r2.duplicates],[0,1]);
const rowsB=rowsA.concat([['2026-10-21 10:00:00','MNQ','Buy',1,102,'',''],['2026-10-21 10:10:00','MNQ','Sell',1,103,'','']]); r2=I.plan(csv(rowsB),OPT,keys,J); eq('overlapping file: only the new trade is imported',[r2.trades.length,r2.duplicates,r2.partial.length],[1,1,0]);
// partially known trade: first file ended with only the entry; second file has entry+exit
const keysOpen=new Set(run([rowsA[0]]).trades.flatMap(x=>x.trade.srcKeys)); r2=I.plan(csv(rowsA),OPT,keysOpen,J); eq('half-known trade is NOT imported, it is reported',[r2.trades.length,r2.partial.length,r2.partial[0].known,r2.partial[0].of],[0,1,1,2]);
r=run([['2026-10-21 09:30:00','MNQ','Buy',1,100,'',''],['2026-10-21 09:30:00','MNQ','Buy',1,100,'',''],['2026-10-21 09:40:00','MNQ','Sell',2,101,'','']]); ok('two identical fills in one file are both kept (distinct keys)',r.trades.length===1&&r.trades[0].trade.contracts===2&&new Set(r.trades[0].trade.srcKeys).size===3,r.trades[0].trade.srcKeys);
// invalid after pairing: stop none; contracts > 500
r=run([['2026-10-21 09:30:00','MNQ','Buy',600,100,'',''],['2026-10-21 09:31:00','MNQ','Sell',600,101,'','']]); eq('over 500 contracts -> reported invalid, not imported',[r.trades.length,r.invalid.length],[0,1]);
// too many fills in a trade
const many=[]; for(let i=0;i<150;i++){ many.push(['2026-10-21 09:'+String(Math.floor(i/60)+30).padStart(2,'0')+':'+String(i%60).padStart(2,'0'),'MNQ','Buy',1,100,'','']); } for(let i=0;i<60;i++) many.push(['2026-10-21 12:00:'+String(i).padStart(2,'0'),'MNQ','Sell',1,101,'','']); r=run(many); eq('>200 fills in one trade -> reported (tooBig), not silently split',[r.trades.length,r.tooBig],[0,1]);
// fees per contract option
r=run([['2026-10-21 09:30:00','MNQ','Buy',2,100,'0.50',''],['2026-10-21 09:35:00','MNQ','Sell',2,101,'0.50','']],{feesPerContract:true}); eq('fees per contract multiply by qty (0.5x2 + 0.5x2)',r.trades[0].trade.feesCents,200);
r=run([['2026-10-21 09:30:00','MNQ','Buy',1,100,'-0.50',''],['2026-10-21 09:35:00','MNQ','Sell',1,101,'(0.50)','']]); eq('negative fee numbers read as costs',r.trades[0].trade.feesCents,100);
r=run([['2026-10-21 09:30:00','MNQ','Buy',1,100,'0.50',''],['2026-10-21 09:35:00','MNQ','Sell',1,101,'','']]); ok('one fill missing fee -> trade fees stay not entered (never partial sums)',r.trades[0].trade.feesCents===null);
// ---- trades mode
const T=(rows)=>I.parseCsv('entry,exit,symbol,side,qty,ep,xp,fee,pnl\n'+rows.map(r=>r.join(',')).join('\n')+'\n'); const TO={mode:'trades',mapping:{entryTime:0,exitTime:1,symbol:2,side:3,qty:4,entryPrice:5,exitPrice:6,fees:7,pnl:8},fileTz:'as-is',targetTz:'America/Los_Angeles',defaultAccountId:'acct-x'};
r=I.plan(T([['2026-10-21 09:30:00','2026-10-21 09:40:00','MNQZ6','Long',2,100,101.5,'1.00','5.00'],['2026-10-21 10:30:00','2026-10-22 09:40:00','MNQZ6','Short',1,100,99,'','1.00'],['2026-10-21 11:00:00','','MNQZ6','Long',1,100,'','','']]),TO,new Set(),J);
eq('trades mode: 3 trades',r.trades.length,3); eq('exit on next day carries its date',r.trades[1].trade.exits[0].date,'2026-10-22'); eq('no exit price -> open trade',r.trades[2].c.status,'open');
ok('reconciliation: file P&L $5.00 matches net (gross $6 - fees $1)',r.reconcile.matched===1&&r.reconcile.checked===2,r.reconcile); eq('second trade: file $1.00 vs gross $4 mismatch reported',r.reconcile.mismatched.length,1);
ok('trade keys present for duplicate detection',r.trades.every(x=>x.trade.srcKeys&&x.trade.srcKeys.length===1&&/^t1:/.test(x.trade.srcKeys[0])));
// auto-detection
const hdr=['Time','Symbol','Side','Qty','Price','Commission','Account']; eq('mode detect: fills',I.detectMode(hdr),'fills'); eq('mode detect: trades',I.detectMode(['Entry price','Exit price','Instrument']),'trades');
eq('suggestMapping fills',I.suggestMapping(hdr,'fills'),{time:0,symbol:1,side:2,qty:3,price:4,fees:5,account:6}); eq('suggest never reuses a column',Object.values(I.suggestMapping(['Time','Time'],'fills')).length,1);
// ---- hashing
const th={a:1,b:[1,2],c:{x:1,y:2},createdAt:5}, th2={c:{y:2,x:1},b:[1,2],a:1,createdAt:99}; eq('tradeHash ignores key order and createdAt',I.tradeHash(th),I.tradeHash(th2)); ok('tradeHash changes on edit',I.tradeHash(th)!==I.tradeHash(Object.assign({},th,{a:2})));
ok('hash is 16 hex',/^[0-9a-f]{16}$/.test(I.hash('x')));
// ---- performance sanity: 20k fills
const big=[]; for(let i=0;i<20000;i++){ const m=Math.floor(i/2); const d=new Date(Date.UTC(2026,0,1,14,0,0)+m*60000); const ts=d.toISOString().slice(0,19).replace('T',' '); big.push([ts,'MNQ',i%2?'Sell':'Buy',1,100+(i%7),'0.5','']); }
const t0=Date.now(); r=run(big); const ms=Date.now()-t0; eq('20,000 fills -> 10,000 trades',r.trades.length,10000); ok('20k fills planned in < 4s (took '+ms+'ms)',ms<4000,ms);
console.log(fail?'FAILED':'ALL PASSED',pass,'passed,',fail,'failed'); process.exit(fail?1:0);
