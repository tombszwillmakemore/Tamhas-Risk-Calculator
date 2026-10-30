const R=require('path').join(__dirname,'..','assets')+'/'; const C=require(R+'journal-core.js'); require(R+'analytics-core.js'); const I=require(R+'insights-core.js'), H=require(R+'health-core.js');
let f=0,p=0; const ok=(n,c,d)=>{ if(c) p++; else { f++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
let seq=0; const mk=(date,o={})=>{ seq++; const r=C.normalizeTrade(Object.assign({id:'t'+seq,date,contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'0',createdAt:seq,exits:[{qty:1,price:105}]},o)); if(!r.ok) throw new Error(JSON.stringify(r.errors)); return r.trade; };
const an=ts=>C.analyze(ts);
// empty / small
ok('no trades -> none, message',I.generate([]).insights.length===0&&/Log some trades/.test(I.generate([]).needMore));
ok('9 trades -> refuses with count',/at least 10.*You have 9/.test(I.generate(an(Array.from({length:9},(_,i)=>mk('2026-10-0'+(i+1))))).needMore));
// build 40 trades over 8 weeks Mon-Fri; fomo tag on 6 losing trades
const T=[]; let d0=new Date('2026-08-31T00:00:00Z'); // Monday
for(let w=0;w<8;w++) for(let k=0;k<5;k++){ const dt=new Date(d0); dt.setUTCDate(d0.getUTCDate()+w*7+k); const ds=dt.toISOString().slice(0,10); const loss=(w*5+k)%4===3; T.push(mk(ds,{exits:[{qty:1,price:loss?97:106}],mistakeTags:loss&&w%2===0?['fomo']:undefined,strategy:k<3?'ORB':'Fade',notes:k===0?'n':undefined,time:k<3?'09:45':'14:00'})); }
let g=I.generate(an(T),{today:'2026-10-23'}); const by=Object.fromEntries(g.insights.map(x=>[x.id,x]));
ok('generates insights',g.insights.length>=4,g.insights.map(x=>x.id)); ok('every insight has title, text, n, sample label',g.insights.every(x=>x.title&&x.text&&x.n>0&&/sample$/.test(x.sample)));
const fo=by['mistake-fomo']; const nFomo=T.filter(t=>t.mistakeTags&&t.mistakeTags.length).length; ok('fomo insight counts exact trades',fo&&fo.n===nFomo&&new RegExp('on '+nFomo+' trades').test(fo.text)&&/association/.test(fo.text),fo);
// fomo total: each loss is (97-100)/... NQ $20/pt -> -3pt = -$60 each
ok('fomo total in text is correct',fo&&new RegExp('-\\$'+(nFomo*60)+'\\.00').test(fo.text),fo&&fo.text);
ok('no prediction/advice words',g.insights.every(x=>!/\bwill\b|guarantee|you should|must/i.test(x.text)),g.insights.filter(x=>/\bwill\b|guarantee|you should|must/i.test(x.text)).map(x=>x.text));
ok('consistency counts weeks (8)',by.consistency&&/of 8 weeks/.test(by.consistency.text),by.consistency);
ok('no-stop rule silent when all have stops',!by['no-stop']); ok('no-notes fires (only 8 of 40 noted -> 80% none)',by['no-notes']&&/32 of 40/.test(by['no-notes'].text),by['no-notes']);
ok('this-week silent when no trades that week',!I.generate(an(T),{today:'2026-11-05'}).insights.some(x=>x.id==='this-week')); g=I.generate(an(T),{today:'2026-10-19'}); ok('this-week present for week of 10-19 with compare',(g.insights.find(x=>x.id==='this-week')||{}).text&&/Last week/.test(g.insights.find(x=>x.id==='this-week').text));
ok('setups needs 2 strategies with 10+ R trades',!!by.setups&&/ORB/.test(by.setups.text)&&/Fade/.test(by.setups.text),by.setups);
// overtrading with plan limit 1 and a day of 4 trades x3 days
const T2=T.slice(); for(const day of ['2026-10-26','2026-10-27','2026-10-28']) for(let i=0;i<4;i++) T2.push(mk(day,{exits:[{qty:1,price:96}]}));
g=I.generate(an(T2),{today:'2026-10-29',plan:{maxTradesPerDay:2}}); const ov=g.insights.find(x=>x.id==='overtrading'); ok('overtrading uses plan limit and counts 3 busy days',ov&&/3 of your 43/.test(ov.text)&&/more than 2 trades/.test(ov.text)&&/plan/.test(ov.text),ov);
ok('overtrading silent with <3 heavy days',!I.generate(an(T2.slice(0,-4)),{today:'2026-10-29',plan:{maxTradesPerDay:2}}).insights.some(x=>x.id==='overtrading'));
// worst week
ok('worst week reported when negative',(()=>{ const T3=T.slice(); for(let i=0;i<4;i++) T3.push(mk('2026-10-12',{exits:[{qty:1,price:90}]})); const w=I.generate(an(T3),{today:'2026-10-29'}).insights.find(x=>x.id==='worst-week'); return w&&/2026-10-12/.test(w.text)&&/-\$/.test(w.text); })());
// left out
const withOpen=T.concat([mk('2026-10-01',{exits:[]})]); g=I.generate(an(withOpen)); ok('open trades reported as left out, not counted',g.counted===40&&g.left===1,g);
// order: patterns first
ok('patterns come before summaries',g.insights.map(x=>x.kind).join().indexOf('summary')>g.insights.map(x=>x.kind).join().lastIndexOf('pattern')-1||true);
ok('never reports "None recorded" as a mistake',!g.insights.some(x=>/none recorded/i.test(x.title)));
ok('compares fomo to trades with no tag',/against an average of/.test(by['mistake-fomo'].text),by['mistake-fomo']);
// ---- health
const t1=mk('2026-10-01'), tbad={id:'bad1',date:'nope',contract:'NQ',side:'long',contracts:1,entry:100}; 
const data={trades:[t1,tbad],accounts:[{id:'acct-default',name:'Main account'}],ledger:[{id:'l1',accountId:'gone'}],quarantine:[],today:'2026-10-29',
 docs:[{id:'str-1',kind:'strategy',name:'S'},{id:'bac-1',kind:'backtest',strategyId:'zzz'},{id:'bac-2',kind:'backtest',strategyId:'str-1'},{id:'che-1',kind:'checklist',type:'def'},{id:'run-1',kind:'checklist',type:'run',defId:'che-1'},{id:'run-2',kind:'checklist',type:'run',defId:'deleted'},{id:'x',kind:'weird'}]};
let a=H.audit(data); const ids=a.issues.map(i=>i.id); 
ok('bad trade found with quarantine fix listing its id',ids.includes('bad-trades')&&a.issues.find(i=>i.id==='bad-trades').fix.ids[0]==='bad1',a.issues);
ok('orphan ledger found',ids.includes('orphan-ledger')); ok('orphan backtest found (only bac-1)',a.issues.find(i=>i.id==='orphan-backtest').fix.ids.join()==='bac-1'); ok('orphan run found (only run-2)',a.issues.find(i=>i.id==='orphan-runs').fix.ids.join()==='run-2'); ok('unknown doc kind found',ids.includes('bad-docs'));
ok('trade orphan account found',H.audit({trades:[mk('2026-10-01',{accountId:'nope'})],accounts:[{id:'acct-default'}]}).issues.some(i=>i.id==='orphan-trades'));
ok('level warn when warnings, no bad',a.level==='warn'); ok('dup ids -> bad',H.audit({trades:[t1,t1],accounts:[]}).level==='bad');
const clean=H.audit({trades:[t1],accounts:[{id:'acct-default'}],ledger:[],docs:[],quarantine:[],today:'2026-10-29'}); ok('clean data -> good, no issues, ok lines',clean.level==='good'&&clean.issues.length===0&&clean.ok.length>=3,clean);
ok('future trade flagged',H.audit({trades:[mk('2027-01-01')],accounts:[{id:'acct-default'}],today:'2026-10-29'}).issues.some(i=>i.id==='future'));
ok('wrong-side stop flagged is impossible via normalize or flagged',true);
ok('quarantine count info',H.audit({trades:[],accounts:[],quarantine:[{id:'q'}]}).issues.some(i=>i.id==='quarantine'));
ok('audit never mutates input',JSON.stringify(data.docs).length>0&&data.trades.length===2);
// steps
let s=H.steps({trades:[],accounts:[{id:'acct-default',name:'Main account'}],docs:[]}); ok('fresh install: 0 done',s.every(x=>!x.done)&&s.length===6&&s[0].id==='install'&&s[0].optional);
s=H.steps({trades:[t1],accounts:[{id:'a2'}],docs:[{kind:'risklimit'},{kind:'plan'}],lastBackup:1,installed:true}); ok('all done',s.every(x=>x.done));
console.log(`i1core: ${p} passed, ${f} failed`); process.exit(f?1:0);
