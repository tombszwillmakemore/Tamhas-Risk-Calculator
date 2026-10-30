const R=require('path').join(__dirname,'..','assets')+'/'; const C=require(R+'journal-core.js'), A=require(R+'analytics-core.js');
let f=0,p=0; const ok=(n,c,d)=>{ if(c) p++; else { f++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } }; const near=(n,a,b,e=1e-6)=>ok(n,a!=null&&Math.abs(a-b)<e,{got:a,want:b});
const mk=(id,date,time,exit,o={})=>{ const r=C.normalizeTrade(Object.assign({id,date,time,contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'0',exits:[{qty:1,price:exit}],createdAt:1},o)); if(!r.ok) throw new Error(JSON.stringify(r.errors)); return r.trade; };
const T=[mk('1','2026-10-19','09:35',110,{tags:'ORB',strategy:'ORB',session:'New York',emotions:'Calm'}),mk('2','2026-10-19','10:20',95,{tags:'ORB, Trend',strategy:'orb',mistakeTags:'Moved stop'}),mk('3','2026-10-20','09:50',105,{strategy:'Fade',grade:'A'}),mk('4','2026-10-21','14:05',95,{emotions:'FOMO'}),mk('5','2026-10-21',undefined,115,{tags:'Trend'}),mk('6','2026-10-22','09:40',97.5,{side:'long'})];
const rows=C.analyze(T), P=A.prepare(rows,{},'gross'); ok('6 counted',P.inc.length===6&&P.excludedNoFees===0&&P.open===0);
const s=A.summary(P.inc); ok('n/wins/losses',s.n===6&&s.wins===3&&s.losses===3); ok('total 350.00',s.totalCents===35000); near('expectancy',s.expectancyCents,35000/6); near('PF 2.4',s.profitFactor,2.4); near('payoff 2.4',s.payoff,2.4); ok('avg win/loss',s.avgWinCents===20000&&Math.abs(s.avgLossCents+25000/3)<1e-6);
near('avgR 3.5/6',s.avgR,3.5/6); near('totalR 3.5',s.totalR,3.5); ok('streaks: order is date then time, no-time trade sorts first that day => W L W W L L',s.maxWinStreak===2&&s.maxLossStreak===2&&s.currentStreak.type==='loss'&&s.currentStreak.n===2,s); ok('best/worst',s.bestCents===30000&&s.worstCents===-10000);
near('wilson lo',s.winCI.lo,0.18762,1e-4); near('wilson hi',s.winCI.hi,0.8124,1e-3); ok('wilson empty null',A.wilson(0,0)===null); ok('wilson all wins hi=1',A.wilson(10,10).hi===1);
ok('sample labels',A.sampleLabel(5)==='very small sample'&&A.sampleLabel(29)==='small sample'&&A.sampleLabel(30)==='moderate sample'&&A.sampleLabel(100)==='larger sample');
const eq=A.equity(P.inc); ok('equity curve',JSON.stringify(eq.curve.map(x=>x.cents))==='[20000,10000,20000,50000,40000,35000]'); ok('drawdown series',JSON.stringify(eq.drawdown.map(x=>x.cents))==='[0,-10000,0,0,-10000,-15000]');
ok('max DD 15000 from the 50000 peak (10-21) to 10-22',eq.maxDrawdownCents===15000&&eq.ddFrom==='2026-10-21'&&eq.ddTo==='2026-10-22',eq); ok('current DD -15000, peak 50000',eq.currentDrawdownCents===-15000&&eq.peakCents===50000);
// drawdown from the very start (first trade loses)
const eq2=A.equity(A.prepare(C.analyze([mk('a','2026-10-19','09:00',95),mk('b','2026-10-20','09:00',90)]),{},'gross').inc); ok('losing start: DD measured from 0 peak',eq2.maxDrawdownCents===30000&&eq2.ddFrom===null);
// consistency with the journal's own stats()
const js=C.stats(rows,'gross'); ok('matches journal stats: pnl, winrate, PF, maxDD',js.pnlCents===s.totalCents&&js.winRate===s.winRate&&Math.abs(js.profitFactor-s.profitFactor)<1e-9&&js.maxDrawdownCents===eq.maxDrawdownCents,[js.pnlCents,js.maxDrawdownCents]);
// histogram
const H=A.histogram(P.inc.map(x=>x.v/100)); ok('hist step 50 and counts total 6',H.step===50&&H.bins.reduce((a,b)=>a+b.n,0)===6&&H.bins[0].from===-100&&H.bins[0].n===2,H); ok('hist covers max',H.bins[H.bins.length-1].to>=300);
ok('hist single value',A.histogram([5,5,5]).bins.length===1&&A.histogram([5,5,5]).bins[0].n===3); ok('hist empty',A.histogram([]).bins.length===0);
// breakdowns
const key=(arr)=>Object.fromEntries(arr.map(r=>[r.label,[r.n,r.totalCents]]));
ok('by hour',JSON.stringify(key(A.breakdown(P.inc,'hour')))===JSON.stringify({'09:00':[3,25000],'10:00':[1,-10000],'14:00':[1,-10000],'No time':[1,30000]}),key(A.breakdown(P.inc,'hour'))); ok('No time sorted last',A.breakdown(P.inc,'hour').pop().label==='No time');
ok('by weekday Mon..Thu in order',JSON.stringify(A.breakdown(P.inc,'weekday').map(r=>r.label))==='["Mon","Tue","Wed","Thu"]'&&JSON.stringify(key(A.breakdown(P.inc,'weekday')))===JSON.stringify({Mon:[2,10000],Tue:[1,10000],Wed:[2,20000],Thu:[1,-5000]}));
const st=A.breakdown(P.inc,'strategy'); ok('strategy merges ORB/orb, keeps first spelling',st.find(r=>r.label==='ORB').n===2&&st.length===3&&st[st.length-1].label==='No strategy',st.map(r=>r.label+r.n));
const tg=A.breakdown(P.inc,'tag'); ok('multi-tag: a trade counts in each of its tags (ORB 2, Trend 2, No tags 3)',tg.find(r=>r.label==='ORB').n===2&&tg.find(r=>r.label==='Trend').n===2&&tg.find(r=>r.label==='No tags').n===3,tg.map(r=>r.label+r.n)); ok('tag groups case-insensitive',A.breakdown(C.analyze([mk('x','2026-10-19','09:00',110,{tags:'Orb'})]).map(r=>({t:r.t,c:r.c,v:r.c.grossCents})),'tag').length===1);
ok('by session: Not set last',A.breakdown(P.inc,'session').pop().label==='Not set'); ok('grade order',A.breakdown(P.inc,'grade').map(r=>r.label).join()==='A,Not graded'); ok('by instrument',A.breakdown(P.inc,'instrument').length===1);
ok('account label from names map',A.breakdown(P.inc,'account',{'acct-default':'Main'})[0].label==='Main'); ok('unknown dimension -> empty',A.breakdown(P.inc,'zzz').length===0); ok('dimension list',A.dimensions().length===11);
// heatmap
const hm=A.heatmap(P.inc); ok('heatmap: no-time trade reported separately',hm.noTime===1&&hm.used===5); ok('cell Mon 09',hm.cell(0,'09').n===1&&hm.cell(0,'09').cents===20000); ok('cell Wed 14',hm.cell(2,'14').cents===-10000); ok('empty cell null',hm.cell(4,'09')===null); ok('hours listed sorted',hm.hours.join()==='09,10,14');
// rolling
const ro=A.rolling(P.inc,3); ok('rolling points start at N',ro.points.length===4&&ro.points[0].i===2); near('rolling winrate 2/3',ro.points[0].winRate,2/3); near('rolling PF 3',ro.points[0].profitFactor,3); near('rolling expectancy',ro.points[0].expectancyCents,20000/3); ok('rolling window larger than data -> no points',A.rolling(P.inc,50).points.length===0); ok('rolling N clamp',A.rolling(P.inc,0).window===20);
// daily/monthly
ok('by day',JSON.stringify(A.byDay(P.inc).map(d=>d.cents))==='[10000,10000,20000,-5000]'); ok('by month',JSON.stringify(A.byMonth(P.inc))==='[{"month":"2026-10","n":6,"cents":35000}]');
// net basis excludes no-fee; open reported
const nf=[mk('n1','2026-10-19','09:00',110,{fees:'4'}),C.normalizeTrade({id:'n2',date:'2026-10-19',time:'10:00',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,exits:[{qty:1,price:110}],createdAt:1}).trade,C.normalizeTrade({id:'n3',date:'2026-10-19',contract:'NQ',side:'long',contracts:2,entry:100,exits:[{qty:1,price:110}],createdAt:1}).trade];
const Pn=A.prepare(C.analyze(nf),{},'net'); ok('net: 1 counted, 1 no-fee excluded, 1 open',Pn.inc.length===1&&Pn.excludedNoFees===1&&Pn.open===1&&Pn.inc[0].v===19600,Pn); const Pg=A.prepare(C.analyze(nf),{},'gross'); ok('gross: 2 counted',Pg.inc.length===2);
// filters pass through
ok('filter by tag',A.prepare(rows,{tag:'trend'},'gross').inc.length===2); ok('filter by date range',A.prepare(rows,{from:'2026-10-21',to:'2026-10-22'},'gross').inc.length===3);
ok('empty summary has n=0 only (no zeros)',JSON.stringify(A.summary([]))==='{"n":0}'); const e0=A.equity([]); ok('empty equity nulls',e0.maxDrawdownCents===null&&e0.currentDrawdownCents===null);
ok('no-loss profit factor null with note',A.summary(A.prepare(C.analyze([mk('w','2026-10-19','09:00',110)]),{},'gross').inc).profitFactor===null&&/no losing/.test(A.summary(A.prepare(C.analyze([mk('w','2026-10-19','09:00',110)]),{},'gross').inc).profitFactorNote));
// layout
ok('layout: unknown dropped, missing appended, off preserved',JSON.stringify(A.cleanLayout([{id:'equity',on:false},{id:'bogus'},{id:'summary'},{id:'equity'}]).slice(0,2))==='[{"id":"equity","on":false},{"id":"summary","on":true}]'&&A.cleanLayout([]).length===A.WIDGETS.length&&A.cleanLayout('x').length===A.WIDGETS.length);
// scale: 5000 trades
const big=[]; for(let i=0;i<5000;i++){ const d=new Date(Date.UTC(2025,0,1+Math.floor(i/5))); big.push(mk('b'+i,d.toISOString().slice(0,10),String(9+i%5).padStart(2,'0')+':30',i%3?105:97)); } const t0=Date.now(); const Bp=A.prepare(C.analyze(big),{},'gross'); A.summary(Bp.inc); A.equity(Bp.inc); A.breakdown(Bp.inc,'hour'); A.heatmap(Bp.inc); A.rolling(Bp.inc,20); const ms=Date.now()-t0; ok('5000 trades analyzed in under 2s ('+ms+'ms)',ms<2000,ms);
console.log(f?('FAILED '+f+' / passed '+p):('ALL PASSED '+p+' passed, 0 failed')); process.exit(f?1:0);
