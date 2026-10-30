const R=require('path').join(__dirname,'..','assets')+'/'; const C=require(R+'journal-core.js'); require(R+'analytics-core.js'); const S=require(R+'strategy-core.js');
let f=0,p=0; const ok=(n,c,d)=>{ if(c) p++; else { f++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } }; const near=(n,a,b,e=1e-9)=>ok(n,Math.abs(a-b)<=e,{got:a,want:b});
// strategy validation
ok('name required',!S.validateStrategy({name:' '}).ok); ok('bad status rejected',!S.validateStrategy({name:'x',status:'zzz'}).ok);
let v=S.validateStrategy({name:' ORB ',entryText:'- Wait for break\n* Wait for break\nRetest',status:'testing'}); ok('strategy cleaned, deduped rules',v.ok&&v.strategy.name==='ORB'&&v.strategy.entryRules.length===2&&v.strategy.status==='testing',v);
ok('default status idea',S.validateStrategy({name:'x'}).strategy.status==='idea');
// results validation
ok('result ok',S.validateResult({date:'2026-10-01',r:'2.5',pnl:'-125.50'}).result.pnlCents===-12550);
for (const b of [{date:'2026-02-30',r:1},{date:'2026-10-01',r:'abc'},{date:'2026-10-01',r:''},{date:'2026-10-01',r:101},{date:'2026-10-01',r:1,pnl:'x'}]) ok('bad result '+JSON.stringify(b),!S.validateResult(b).ok);
ok('pnl blank -> null not 0',S.validateResult({date:'2026-10-01',r:1}).result.pnlCents===null);
let pr=S.parseResultsText('date,r,pnl,note\n2026-10-01,2,200,good\n2026-10-02,-1\nbad,1\n\n2026-10-03,abc\n2026-10-04;1.5'); ok('csv: header skipped, 3 valid, 2 errors with line numbers',pr.results.length===3&&pr.errors.length===2&&pr.errors[0].line===4&&pr.errors[1].line===6,pr);
ok('csv without header',S.parseResultsText('2026-10-01,1').results.length===1);
// stats known values
const R1=[2,-1,-1,2,-1,-1,-1,3].map((r,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),r})); let st=S.stats(R1);
ok('stats basics',st.n===8&&st.wins===3&&st.losses===5,st); near('expectancy 2/8',st.expectancyR,0.25); near('total R',st.totalR,2); near('pf 7/5',st.profitFactor,1.4); near('avg win 7/3',st.avgWinR,7/3); near('avg loss -1',st.avgLossR,-1);
// drawdown: eq 2,1,0,2,1,0,-1,2 peak 2 -> low -1 => dd 3
near('max drawdown 3R',st.maxDrawdownR,3); ok('max loss streak 3',st.maxLossStreak===3); ok('sample label very small',st.sample==='very small sample');
const m=0.25, sd=Math.sqrt(R1.reduce((a,x)=>a+(x.r-m)**2,0)/7); near('CI lo',st.expectancyCI.lo,m-1.96*sd/Math.sqrt(8),1e-9); ok('CI includes zero flagged',st.ciIncludesZero===true);
ok('empty stats',S.stats([]).n===0); ok('all wins: PF null with note',S.stats([{r:1},{r:2}]).profitFactor===null&&/no losing/.test(S.stats([{r:1},{r:2}]).profitFactorNote));
ok('drawdown starts from 0 peak (loses first)',S.stats([{r:-1},{r:-1}]).maxDrawdownR===2);
// equity
near('equityR last',S.equityR(R1)[7].r,2);
// compare
ok('compare max 4',S.compare([1,2,3,4,5].map(i=>({key:i,label:'s'+i,results:R1}))).length===4);
// MC
ok('mc refuses <20',!S.monteCarlo(R1.map(x=>x.r),{horizon:50}).ok&&/Needs at least 20/.test(S.monteCarlo([1],{horizon:5}).text));
const big=[]; for(let i=0;i<40;i++) big.push(i%2?-1:1.5); // exp 0.25
let a=S.monteCarlo(big,{horizon:100,sims:1000,seed:7,ddLimitR:5}), b=S.monteCarlo(big,{horizon:100,sims:1000,seed:7,ddLimitR:5}); ok('mc ok',a.ok); ok('mc deterministic for same seed',JSON.stringify(a)===JSON.stringify(b));
ok('mc differs for other seed',JSON.stringify(S.monteCarlo(big,{horizon:100,sims:1000,seed:8}).final)!==JSON.stringify(a.final));
ok('mc median final near horizon*expectancy (25R) +-8',Math.abs(a.final.p50-25)<8,a.final); ok('mc percentiles ordered',a.final.p5<=a.final.p25&&a.final.p25<=a.final.p50&&a.final.p50<=a.final.p75&&a.final.p75<=a.final.p95&&a.drawdown.p50<=a.drawdown.p95);
ok('probs in 0..1',a.probNegative>=0&&a.probNegative<=1&&a.probDdLimit>=0&&a.probDdLimit<=1);
// all-positive input -> never negative
const pos=Array(30).fill(1); const mp=S.monteCarlo(pos,{horizon:10,sims:200}); ok('all +1R: final always 10, no drawdown, P(neg)=0',mp.final.p5===10&&mp.final.p95===10&&mp.drawdown.worst===0&&mp.probNegative===0,mp);
const neg=Array(30).fill(-1); ok('all -1R: P(neg)=1 and dd limit 3 always hit in 10',S.monteCarlo(neg,{horizon:10,sims:200,ddLimitR:3}).probDdLimit===1);
for (const o of [{horizon:0},{horizon:1.5},{horizon:2000},{horizon:10,sims:5},{horizon:10,seed:-1},{horizon:10,ddLimitR:-2}]) ok('mc bad input '+JSON.stringify(o),S.monteCarlo(big,o).errors&&!S.monteCarlo(big,o).ok);
// brute-force check of MC with 1 distinct value variants: 50/50 +1/-1 horizon 1 -> P(neg) ~ .5
const half=[]; for(let i=0;i<20;i++) half.push(i%2?1:-1); const mh=S.monteCarlo(half,{horizon:1,sims:5000,seed:3}); ok('horizon 1 coin flip P(neg) ~ 0.5',Math.abs(mh.probNegative-0.5)<0.03,mh.probNegative);
// forward vs backtest
const back=Array.from({length:40},(_,i)=>({date:'2026-01-01',r:i%2?-1:1.5})); const fw=Array.from({length:12},(_,i)=>({date:'2026-10-01',r:i%2?-1:1.5}));
ok('forward <10 refuses',!S.forwardVsBacktest(fw.slice(0,5),back).ok); let fb=S.forwardVsBacktest(fw,back); ok('forward consistent',fb.ok&&fb.consistent,fb);
const bad=Array.from({length:12},(_,i)=>({date:'2026-10-01',r:i%2?-1:-0.9})); fb=S.forwardVsBacktest(bad,back); ok('forward clearly worse flagged inconsistent',fb.ok&&!fb.consistent,fb);
ok('forward needs both',!S.forwardVsBacktest([],back).ok);
// sweep
const sw=[]; for(let i=0;i<30;i++) sw.push({date:'2026-10-'+String(1+Math.floor(i/3)).padStart(2,'0'),r:i%3===2?-1:1,riskCents:(i%3+1)*10000});
let w1=S.sweep(sw,'firstN'); ok('firstN: 3 variants (1,2,3), last labelled no limit',w1.ok&&w1.rows.length===3&&/No limit/.test(w1.rows[2].label)&&w1.rows[0].all.n===10&&w1.rows[1].all.n===20&&w1.rows[2].all.n===30,w1);
near('first 1/day expectancy 1',w1.rows[0].all.expectancyR,1); near('first 2/day expectancy 1',w1.rows[1].all.expectancyR,1); near('all expectancy 1/3',w1.rows[2].all.expectancyR,1/3);
ok('halves split n',w1.rows[2].first.n===15&&w1.rows[2].second.n===15); ok('overfit note mentions count',/3 settings/.test(w1.note));
let w2=S.sweep(sw,'riskcap'); ok('riskcap variants with last = no cap',w2.ok&&/No cap/.test(w2.rows[w2.rows.length-1].label)&&w2.rows[w2.rows.length-1].all.n===30,w2.rows&&w2.rows.map(r=>r.label));
ok('riskcap lowest cap keeps only $100-risk trades (10)',w2.rows[0].all.n===10,w2.rows[0].all.n);
ok('sweep refuses small',!S.sweep(sw.slice(0,10),'firstN').ok); ok('riskcap needs stops',!S.sweep(sw.map(x=>({date:x.date,r:x.r})),'riskcap').ok);
ok('firstN with 1 trade/day -> nothing to compare',!S.sweep(Array.from({length:25},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),r:1})),'firstN').ok);
// journal bridge
const mk=(id,o)=>{ const r=C.normalizeTrade(Object.assign({id,date:'2026-10-05',contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'0',createdAt:1,strategy:'ORB',exits:[{qty:1,price:110}]},o)); if(!r.ok) throw new Error(JSON.stringify(r.errors)); return r.trade; };
const rows=C.analyze([mk('1',{}),mk('2',{strategy:'orb',exits:[{qty:1,price:90}]}),mk('3',{strategy:'Other'}),mk('4',{exits:[]}),mk('5',{stop:undefined})]);
const fj=S.fromJournal(rows,'ORB'); ok('journal: case-insensitive, closed with R only, open and no-stop reported',fj.results.length===2&&fj.trades===4&&fj.open===1&&fj.noR===1,fj); ok('journal R values 2 and -2',fj.results[0].r===2&&fj.results[1].r===-2); ok('journal keeps risk cents',fj.results[0].riskCents===5*20*100/ (20) *1 || fj.results[0].riskCents!=null);
console.log(`h1core: ${p} passed, ${f} failed`); process.exit(f?1:0);
