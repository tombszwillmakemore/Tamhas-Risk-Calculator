const R=require('path').join(__dirname,'..','assets')+'/';
global.TTInstruments=require(R+'instruments.js'); const C=require(R+'journal-core.js');
let pass=0,fail=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } }; const eq=(n,a,b)=>ok(n,JSON.stringify(a)===JSON.stringify(b),{got:a,want:b});
const T=(o)=>C.normalizeTrade(Object.assign({date:'2026-10-20',contract:'MNQ',side:'long'},o));
const cc=(o)=>{ const r=T(o); if(!r.ok) throw new Error(r.errors.join()); return C.analyze([r.trade])[0].c; };
// 1. long scale-in with partial exits, FIFO
let r=T({entries:[{qty:2,price:100},{qty:1,price:103}],exits:[{qty:1,price:105},{qty:2,price:101}],stop:95});
ok('scale-in ok',r.ok,r.errors); eq('contracts = total',r.trade.contracts,3); eq('entry = weighted average',r.trade.entry,101);
let c=C.analyze([r.trade])[0].c; eq('FIFO gross: +5 +1 -2 pts = +4 pts x $2 = $8',c.grossCents,800); eq('closed',c.status,'closed');
eq('risk: (2x5 + 1x8)=18 pts x $2 = $36',c.plannedRiskCents,3600); eq('R = 8/36 -> 0.22',c.rMultiple,0.22);
// 2. short scale-in
c=cc({side:'short',entries:[{qty:1,price:100},{qty:1,price:102}],exits:[{qty:2,price:98}],stop:105}); eq('short: +2 +4 = 6 pts = $12',c.grossCents,1200); eq('short risk (5+3) x $2 = $16',c.plannedRiskCents,1600);
// 3. partial
c=cc({entries:[{qty:2,price:100},{qty:2,price:110}],exits:[{qty:1,price:120}]}); eq('partial status',c.status,'partial'); eq('partial gross only exited: (120-100)x$2',c.grossCents,4000); eq('remaining 3',c.remainingQty,3); ok('not closed -> no net/R',c.netCents===null&&c.rMultiple===null);
// 4. FIFO matters: exits at same price, different lots
c=cc({entries:[{qty:1,price:100},{qty:1,price:90}],exits:[{qty:1,price:95}]}); eq('first exit matches oldest lot (100): -5pts = -$10',c.grossCents,-1000);
// 5. identical to legacy when only one entry
const a=cc({contracts:2,entry:100,exits:[{qty:2,price:101}],stop:99}), b=cc({entries:[{qty:2,price:100}],contracts:2,entry:100,exits:[{qty:2,price:101}],stop:99});
eq('single entries row behaves as legacy',[a.grossCents,a.plannedRiskCents],[b.grossCents,b.plannedRiskCents]); ok('single entries row not stored as multi',!T({entries:[{qty:2,price:100}],contracts:2,entry:100}).trade.entries);
// 6. validation
ok('long stop above lowest entry rejected',!T({entries:[{qty:1,price:100},{qty:1,price:90}],stop:95}).ok&&/below every entry/.test(T({entries:[{qty:1,price:100},{qty:1,price:90}],stop:95}).errors.join()));
ok('short stop below highest entry rejected',!T({side:'short',entries:[{qty:1,price:100},{qty:1,price:110}],stop:105}).ok);
ok('stop equal to any entry rejected',!T({entries:[{qty:1,price:100},{qty:1,price:90}],stop:90}).ok);
ok('bad qty/price/time in entries rejected',[{qty:0,price:100},{qty:1,price:100.123},{qty:1,price:100,time:'25:00'},{qty:1.5,price:100},{qty:1,price:100,date:'2026-02-30'}].every(x=>!T({entries:[{qty:1,price:100},x]}).ok));
ok('total over 500 rejected',!T({entries:[{qty:300,price:100},{qty:300,price:101}]}).ok);
ok('exits over total rejected',!T({entries:[{qty:1,price:100},{qty:1,price:101}],exits:[{qty:3,price:102}]}).ok);
ok('empty entry rows ignored',T({entries:[{qty:1,price:100},{qty:'',price:''},{qty:1,price:101}]}).trade.contracts===2);
// 7. exit times
r=T({contracts:2,entry:100,exits:[{qty:1,price:101,time:'09:45'},{qty:1,price:102,time:'10:05',date:'2026-10-21'}]}); ok('exit time/date stored',r.ok&&r.trade.exits[0].time==='09:45'&&r.trade.exits[1].date==='2026-10-21',r);
ok('bad exit time rejected',!T({contracts:1,entry:100,exits:[{qty:1,price:101,time:'9:5'}]}).ok); ok('exit without time has no time key',!('time' in T({contracts:1,entry:100,exits:[{qty:1,price:101}]}).trade.exits[0]));
// 8. provenance
r=T({contracts:1,entry:100,srcKeys:['a','b'],importBatch:'imp-1'}); eq('srcKeys kept',r.trade.srcKeys,['a','b']); eq('importBatch kept',r.trade.importBatch,'imp-1');
r=T({contracts:1,entry:100,srcKeys:[1,2],importBatch:'bad id!'}); ok('malformed provenance dropped silently',r.ok&&!r.trade.srcKeys&&!r.trade.importBatch);
// 9. idempotent round trip
r=T({entries:[{qty:2,price:100,time:'09:30'},{qty:1,price:103}],exits:[{qty:3,price:101,time:'10:00'}],stop:95,fees:'3.5',srcKeys:['k']}).trade;
const r2=C.normalizeTrade(JSON.parse(JSON.stringify(r))); ok('normalize(normalize(x)) is stable',r2.ok&&JSON.stringify(r2.trade)===JSON.stringify(r),[r,r2.trade]);
// 10. CSV
const rows=C.analyze([r,T({contracts:1,entry:100,exits:[{qty:1,price:101}]}).trade]); const lines=C.toCsv(rows,{}).trim().split('\r\n'); const hdr=lines[0].split(',');
ok('csv: old 27 columns keep positions, entries stays at 27, v2 columns appended',hdr.length===32&&hdr.slice(28).join()==='tags,emotions,mistake_tags,grade'&&hdr[25]==='account'&&hdr[26]==='account_id'&&hdr[27]==='entries',hdr);
ok('csv: multi shows each fill, single shows its entry',lines.some(l=>l.includes('2@100 | 1@103'))&&lines.some(l=>/1@100,,,,$/.test(l)),lines);
// 11. unaffected legacy numbers
eq('legacy: long 2 MNQ 100->101 = $4',cc({contracts:2,entry:100,exits:[{qty:2,price:101}]}).grossCents,400);
eq('legacy: partial exits',cc({contracts:3,entry:100,exits:[{qty:1,price:102},{qty:2,price:99}]}).grossCents,(200+(-100)*2));
console.log(fail?'FAILED':'ALL PASSED',pass,'passed,',fail,'failed'); process.exit(fail?1:0);
