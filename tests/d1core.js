const R=require('path').join(__dirname,'..','assets')+'/'; const C=require(R+'journal-core.js'), J=require(R+'journal2-core.js');
let f=0,p=0; const ok=(n,c,d)=>{ if(c) p++; else { f++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } }; const eq=(n,a,b)=>ok(n,JSON.stringify(a)===JSON.stringify(b),{got:a,want:b});
const mk=(o)=>{ const r=C.normalizeTrade(Object.assign({date:'2026-10-20',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,exits:[{qty:1,price:110}],fees:'4',id:'t'+Math.random()},o)); if(!r.ok) throw new Error(JSON.stringify(r.errors)); return r.trade; };
// --- normalize
let t=mk({tags:' ORB , orb,Trend ,, ',emotions:['Calm','calm','FOMO'],mistakeTags:'Moved stop',grade:'b',custom:{x:5,y:'hi',z:true,'bad key':1,e:'',n:NaN}});
eq('tags dedupe ignoring case, keep first',t.tags,['ORB','Trend']); eq('emotions dedupe',t.emotions,['Calm','FOMO']); eq('mistake tags from comma string',t.mistakeTags,['Moved stop']); ok('grade uppercased',t.grade==='B');
eq('custom keeps valid only',t.custom,{x:5,y:'hi',z:true});
t=mk({}); ok('legacy trade has no new fields',!('tags' in t)&&!('emotions' in t)&&!('grade' in t)&&!('custom' in t)&&!('mistakeTags' in t));
ok('bad grade rejected',!C.normalizeTrade({date:'2026-10-20',contract:'NQ',side:'long',contracts:1,entry:100,grade:'Z'}).ok);
t=mk({tags:Array.from({length:30},(_,i)=>'t'+i)}); ok('max 12 tags',t.tags.length===12);
t=mk({tags:['x'.repeat(80)]}); ok('label capped at 30',t.tags[0].length===30);
t=mk({tags:['a\u0000b\nc']}); ok('control chars stripped',t.tags[0]==='a b c',t.tags);
const again=C.normalizeTrade(JSON.parse(JSON.stringify(mk({tags:'a,b',grade:'A',custom:{k:1}})))); ok('idempotent round trip',again.ok&&again.trade.tags.length===2&&again.trade.grade==='A'&&again.trade.custom.k===1);
// --- filters
const T=[mk({id:'1',tags:'ORB',emotions:'Calm',grade:'A'}),mk({id:'2',tags:'orb,Trend',mistakeTags:'Oversized',grade:'C',exits:[{qty:1,price:95}]}),mk({id:'3',date:'2026-10-21'}),mk({id:'4',tags:'Trend',emotions:'FOMO',grade:'A',date:'2026-10-22'})];
const rows=C.analyze(T), ids=(f)=>C.filterRows(rows,f).map(r=>r.t.id).sort().join(',');
ok('tag filter case-insensitive',ids({tag:'ORB'})==='1,2'); ok('tag none',ids({tag:'__none'})==='3'); ok('emotion',ids({emotion:'fomo'})==='4'); ok('mistake',ids({mistake:'Oversized'})==='2');
ok('grade A',ids({grade:'A'})==='1,4'); ok('grade none',ids({grade:'__none'})==='3'); ok('grade+tag combine',ids({grade:'A',tag:'Trend'})==='4');
ok('minR: trade1 R=2 (10 vs 5 risk)',ids({minR:'1.5'})==='1,3,4'); ok('maxR: trade2 R=-1',ids({maxR:'0'})==='2'); ok('search finds tag text',ids({q:'trend'})==='2,4'); ok('search finds mistake tag',ids({q:'oversized'})==='2');
// --- CSV
const csv=C.toCsv(rows,{}); const head=csv.split('\r\n')[0].split(','); ok('csv 32 cols, first 28 unchanged',head.length===32&&head[27]==='entries'&&head[28]==='tags'&&head[31]==='grade',head.length);
const l1=csv.split('\r\n').filter(l=>l.includes(',ORB,')||l.includes('ORB')); ok('csv has tags joined by |',csv.includes('orb | Trend')||csv.includes('ORB | Trend')||csv.includes('orb | Trend')); 
// --- periods
eq('week starts Monday',J.periodOf('week','2026-10-29'),{kind:'week',key:'2026-10-26',from:'2026-10-26',to:'2026-11-01'}); eq('sunday belongs to prior Monday',J.periodOf('week','2026-11-01').key,'2026-10-26'); eq('monday is own start',J.periodOf('week','2026-10-26').key,'2026-10-26');
eq('leap Feb',J.periodOf('month','2028-02-10').to,'2028-02-29'); eq('non-leap Feb',J.periodOf('month','2027-02-10').to,'2027-02-28'); eq('prev month crosses year',J.shiftPeriod(J.periodOf('month','2026-01-15'),-1).key,'2025-12'); eq('next week crosses month',J.shiftPeriod(J.periodOf('week','2026-10-26'),1).key,'2026-11-02'); ok('bad date null',J.periodOf('day','2026-02-30')===null&&J.periodOf('year','2026-01-01')===null);
// --- review stats hand-computed (NQ $20/pt; exits: t1 +10pt=$200 -4 fees=196; t2 -5pt=-$100-4=-104; t3 +10 => 196; t4 196)
let rs=J.reviewStats(rows,J.periodOf('week','2026-10-20'),'net'); ok('week trades 4',rs.trades===4&&rs.counted===4&&rs.wins===3&&rs.losses===1,rs);
// recompute exactly via compute
const exp=rows.reduce((s,r)=>s+r.c.netCents,0); ok('total equals sum of net cents',rs.totalCents===exp,[rs.totalCents,exp]); ok('winRate 3/4',rs.winRate===0.75); ok('avg R (2,-1,2,2)=1.25',rs.avgR===1.25,rs.avgR);
ok('days: 10-20 = 196-104 = $0.92? net by day; best/worst correct',rs.days.length===3&&rs.bestDay.cents>=rs.worstDay.cents&&rs.days.reduce((a,d)=>a+d.cents,0)===rs.totalCents);
eq('tag counts sorted',rs.tags.map(x=>x.label+':'+x.n),['ORB:2','Trend:2']); ok('grade avg A,C,A =(4+2+4)/3',rs.avgGrade===3.33,rs.avgGrade); ok('graded count 3',rs.gradedCount===3);
rs=J.reviewStats(rows,J.periodOf('day','2026-10-21'),'net'); ok('one-trade day',rs.trades===1&&rs.winRate===1);
rs=J.reviewStats(rows,J.periodOf('day','2026-12-01'),'net'); ok('empty period: nulls not zeros',rs.trades===0&&rs.totalCents===null&&rs.winRate===null&&rs.avgR===null&&rs.bestDay===null);
const noFee=C.analyze([mk({id:'n1',fees:undefined,feesCents:undefined}),mk({id:'n2'})]); const nf=noFee.map(r=>r); noFee[0]=C.analyze([C.normalizeTrade({date:'2026-10-20',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,exits:[{qty:1,price:110}],id:'n1'}).trade])[0];
rs=J.reviewStats(noFee,J.periodOf('day','2026-10-20'),'net'); ok('net basis excludes trade without fees and reports it',rs.counted===1&&rs.excludedNoFees===1,rs);
rs=J.reviewStats(noFee,J.periodOf('day','2026-10-20'),'gross'); ok('gross counts both',rs.counted===2&&rs.totalCents===40000,rs);
const op=C.analyze([C.normalizeTrade({date:'2026-10-20',contract:'NQ',side:'long',contracts:2,entry:100,stop:95,exits:[{qty:1,price:110}],id:'o1'}).trade]); rs=J.reviewStats(op,J.periodOf('day','2026-10-20'),'gross'); ok('partial trade not counted but reported',rs.counted===0&&rs.openOrPartial===1&&rs.totalCents===null);
// --- compare
const cp=J.compare(rows); ok('compare shape',cp.length===4&&cp[0].r===2&&cp[1].netCents<0&&Array.isArray(cp[0].tags)); ok('compare caps at 4',J.compare(rows.concat(rows)).length===4);
// --- bulk
let b=J.bulkApply(T,['1','2'],{type:'addTag',value:'Reviewed'}); ok('bulk addTag',b.changed===2&&b.trades.find(x=>x.id==='1').tags.includes('Reviewed')&&!b.trades.find(x=>x.id==='3').tags,b.failed);
ok('original not mutated',!T[0].tags.includes('Reviewed'));
b=J.bulkApply(b.trades,['1'],{type:'addTag',value:'reviewed'}); ok('adding same tag is a no-op',b.changed===0);
b=J.bulkApply(T,['2'],{type:'removeTag',value:'ORB'}); eq('removeTag ignores case',b.trades.find(x=>x.id==='2').tags,['Trend']);
b=J.bulkApply(T,['3'],{type:'removeTag',value:'zzz'}); ok('remove tag absent = unchanged, no fields added',b.changed===0&&!('tags' in b.trades.find(x=>x.id==='3')));
b=J.bulkApply(T,['3'],{type:'setGrade',value:'z'}); ok('invalid bulk value reported, trade untouched',b.failed.length===1&&b.changed===0&&b.trades.find(x=>x.id==='3').grade===undefined);
b=J.bulkApply(T,['1','3'],{type:'setStrategy',value:'Breakout'}); ok('bulk strategy',b.trades.filter(x=>x.strategy==='Breakout').length===2);
b=J.bulkApply(T,['1'],{type:'setAccount',value:'acct-x'}); ok('bulk account',b.trades[0].accountId==='acct-x'); b=J.bulkApply(T,['1'],{type:'nope',value:1}); ok('unknown op fails safely',b.failed.length===1);
// --- field defs
let v=J.validateFieldDef({label:' Market bias ',type:'choice',choices:'Bull, Bear, bull,Neutral'},[]); ok('choice def',v.ok&&v.def.choices.length===3&&v.def.label==='Market bias',v);
ok('choice needs 2',!J.validateFieldDef({label:'x',type:'choice',choices:'a'},[]).ok); ok('needs name',!J.validateFieldDef({label:' ',type:'text'},[]).ok); ok('bad type',!J.validateFieldDef({label:'x',type:'zzz'},[]).ok);
ok('duplicate name rejected',!J.validateFieldDef({label:'MARKET BIAS',type:'text'},[{id:'a',label:'Market bias'}]).ok); ok('rename same field allowed',J.validateFieldDef({id:'a',label:'Market bias',type:'text'},[{id:'a',label:'Market bias'}]).ok);
ok('max 15 fields',!J.validateFieldDef({label:'new',type:'text'},Array.from({length:15},(_,i)=>({id:'f'+i,label:'f'+i}))).ok);
const nd={label:'Pts',type:'number'}, cd={label:'Bias',type:'choice',choices:['Bull','Bear']}, yd={label:'News',type:'yesno'};
ok('number value',J.cleanFieldValue(nd,'1,250.5').value===1250.5); ok('bad number',!J.cleanFieldValue(nd,'abc').ok); ok('0 is recorded not empty',J.cleanFieldValue(nd,'0').value===0); ok('blank = not recorded',J.cleanFieldValue(nd,'').value===undefined);
ok('choice validated',J.cleanFieldValue(cd,'Bull').ok&&!J.cleanFieldValue(cd,'Flat').ok); ok('yesno',J.cleanFieldValue(yd,'no').value===false&&J.cleanFieldValue(yd,'yes').value===true);
// --- templates / filters
eq('template drops prices and unknown keys',J.cleanTemplate({strategy:'ORB',entry:100,contracts:3,date:'2026-01-01',tags:'a,b',side:'sideways',followedRules:true,evil:'x'}),{strategy:'ORB',tags:['a','b'],followedRules:true});
eq('filter whitelist + bad dates dropped',J.cleanFilter({tag:'x',from:'2026-13-01',to:'2026-10-02',zzz:1,minR:'abc',maxR:'2'}),{tag:'x',to:'2026-10-02',maxR:'2'});
eq('preset week',J.rangePreset('week','2026-10-29'),{from:'2026-10-26',to:'2026-11-01'}); eq('preset 30d',J.rangePreset('30d','2026-10-29'),{from:'2026-09-30',to:'2026-10-29'}); eq('preset month',J.rangePreset('month','2026-10-29'),{from:'2026-10-01',to:'2026-10-31'}); ok('unknown preset null',J.rangePreset('x','2026-10-29')===null);
console.log(f?('FAILED '+f+' / passed '+p):('ALL PASSED '+p+' passed, 0 failed')); process.exit(f?1:0);
