const { chromium } = require('./_pw'); const fs=require('fs');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})();
const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html'); let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[];
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push('console:'+m.text()); });
  await p.goto(URL); await p.evaluate(()=>TTDB.ready());
  // --- schema v3 + store
  ok('db schema v3', await p.evaluate(async()=>{const d=await TTDB.open(); return d.version===3&&d.objectStoreNames.contains('docs');}));
  const st=await p.evaluate(async()=>{
    const a=await TTStore.save({kind:'goal',title:'G1'}); const l1=await TTStore.list('goal'); await TTStore.save(Object.assign({},a,{title:'G1b'})); const l2=await TTStore.list('goal');
    let bad=null; try{ await TTStore.save({kind:'nonsense'}); }catch(e){ bad=e.message; }
    await TTStore.remove(a.id,'goal'); const l3=await TTStore.list('goal');
    return {id:a.id,n1:l1.length,t2:l2[0].title,n2:l2.length,bad,n3:l3.length,created:!!a.createdAt};
  });
  ok('store: create/update/delete', st.n1===1&&st.t2==='G1b'&&st.n2===1&&st.n3===0&&st.created&&/^goa-/.test(st.id), st);
  ok('store: unknown kind rejected', /Unknown item kind/.test(st.bad||''), st.bad);
  // --- prefs
  const pr=await p.evaluate(async()=>{ await TTStore.setPref('x',{a:1}); TTStore.invalidate(); return await TTStore.getPref('x',null); });
  ok('pref roundtrip', pr&&pr.a===1, pr);
  // --- backup v3 includes docs and restores them (merge never overwrites, unknown kinds skipped)
  const bk=await p.evaluate(async()=>{ await TTStore.save({id:'exp-1',kind:'expense',amountCents:1234}); const docs=await TTDB.getAll('docs'); const j=TTJournalCore.serializeBackup([],{}, {accounts:[],ledger:[],docs});
    const o=JSON.parse(j); o.docs.push({id:'bad1',kind:'weird'}); o.docs.push({kind:'expense'}); const r=TTJournalCore.parseBackup(JSON.stringify(o)); return {v:o.version,n:docs.length,parsed:r.docs.length,hasDocs:r.hasDocs,sk:r.skipped}; });
  ok('backup v3 carries docs, rejects unknown/id-less', bk.v===3&&bk.parsed===bk.n&&bk.hasDocs&&bk.sk.some(s=>/saved item/.test(s)), bk);
  const v2=await p.evaluate(()=>{ const r=TTJournalCore.parseBackup(JSON.stringify({app:'tamhas-trading',version:2,trades:[],accounts:[],ledger:[]})); return {hasDocs:r.hasDocs,n:r.docs.length}; });
  ok('older backup has no docs and never clears saved items', v2.hasDocs===false&&v2.n===0, v2);
  // --- navigation
  await p.reload(); await p.waitForSelector('.nav button');
  const names=await p.$$eval('.nav button',b=>b.map(x=>x.dataset.view)); ok('nav = home,calc,journal,accounts,more', names.join()==='home,calc,journal,accounts,more', names);
  await p.click('.nav button[data-view=more]'); await p.waitForSelector('#hubRoot .tile');
  const hub=await p.$$eval('#hubRoot .tile',t=>t.map(x=>x.dataset.go)); ok('hub lists intel + settings', hub.includes('intel')&&hub.includes('settings'), hub);
  await p.click('#hubRoot [data-go=intel]'); ok('hub -> intel view active', await p.evaluate(()=>document.getElementById('view-intel').classList.contains('active')));
  ok('More tab stays highlighted for hub sections', await p.evaluate(()=>document.querySelector('.nav button[data-view=more]').classList.contains('active')));
  ok('hash deep link updated', (await p.evaluate(()=>location.hash))==='#intel');
  await p.goBack(); ok('browser Back returns to More', await p.evaluate(()=>document.getElementById('view-more').classList.contains('active')));
  await p.goto(URL+'#settings'); ok('deep link opens settings', await p.evaluate(()=>document.getElementById('view-settings').classList.contains('active')));
  ok('unknown hash falls back to home', await (async()=>{ await p.goto(URL+'#nonsense'); return p.evaluate(()=>document.getElementById('view-home').classList.contains('active')); })());
  // --- theme
  await p.goto(URL+'#settings'); await p.click('[data-theme-set=light]');
  ok('light theme applied', await p.evaluate(()=>document.documentElement.getAttribute('data-theme')==='light'&&localStorage.getItem('tt.theme')==='light'));
  const bg=await p.evaluate(()=>getComputedStyle(document.body).backgroundColor); const fg=await p.evaluate(()=>getComputedStyle(document.body).color);
  ok('light theme: dark text on light page', (()=>{const n=s=>s.match(/\d+/g).map(Number); const L=c=>0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; return L(n(fg))<100;})(), [bg,fg]);
  await p.reload(); ok('theme persists across reload (no flash script)', await p.evaluate(()=>document.documentElement.getAttribute('data-theme')==='light'));
  ok('theme pref saved to database', await p.evaluate(async()=>{ TTStore.invalidate(); return (await TTStore.getPref('theme',null))==='light'; }));
  ok('theme-color meta follows theme', await p.evaluate(()=>document.querySelector('meta[name=theme-color]').content==='#eef3fb'));
  // screenshots both themes
  for (const th of ['dark','light']) {
    await p.evaluate(t=>{ localStorage.setItem('tt.theme',t); }, th); await p.goto(URL+'#home'); await p.reload();
    for (const v of ['home','journal','accounts','more','settings','calc']) { await p.evaluate(n=>TTNav.go(n),v); await p.waitForTimeout(700); await p.screenshot({path:S+`shots/A-${th}-${v}.png`}); }
  }
  await p.evaluate(()=>localStorage.setItem('tt.theme','dark'));
  // --- chart helpers (browser)
  const ch=await p.evaluate(()=>{ const U=TTUI; const l=U.lineChart({series:[{pts:[{x:0,y:-5,tip:'a'},{x:1,y:10,tip:'b'},{x:2,y:3,tip:'c'}]}],alt:'t'}); const b=U.barChart({bars:[{label:'x',value:-3},{label:'y',value:null}]}); const h=U.heatmap({rows:['a'],cols:['1','2'],cell:(r,c)=>c?null:{v:5,tip:'t'}});
    const big=[];for(let i=0;i<5000;i++)big.push({x:i,y:Math.sin(i/50)*100,tip:'p'+i}); const lb=U.lineChart({series:[{pts:big}]});
    return {l:/<svg/.test(l)&&/role="img"/.test(l),hits:(l.match(/ch-hit/g)||[]).length,b:/ch-bar neg/.test(b)&&/none/.test(b),h:/hm-cell pos/.test(h)&&/hm-empty/.test(h),bigHits:(lb.match(/ch-hit/g)||[]).length,bigLen:lb.length}; });
  ok('charts: line/bar/heatmap render with a11y labels', ch.l&&ch.b&&ch.h, ch);
  ok('charts: 5000-point line stays small (downsampled, <=170 hover targets)', ch.bigHits<=170&&ch.bigLen<200000, ch);
  const dl=await p.evaluate(async()=>{ const pr=TTUI.dialog({title:'T',fields:[{name:'n',label:'N',value:'7'}],validate:v=>v.n==='bad'?'nope':null}); await new Promise(r=>setTimeout(r,50)); const f=document.querySelector('.ui-dlg input'); f.value='bad'; document.querySelector('[data-r=ok]').click(); await new Promise(r=>setTimeout(r,30)); const err=document.querySelector('.ui-dlg-err').textContent; f.value='9'; document.querySelector('[data-r=ok]').click(); const v=await pr; return {err,v,gone:!document.querySelector('.ui-dlg')}; });
  ok('dialog: validation blocks, then returns values and closes', dl.err==='nope'&&dl.v&&dl.v.n==='9'&&dl.gone, dl);
  const esc=await p.evaluate(()=>TTUI.esc('<img src=x onerror=alert(1)>"\''));
  ok('esc neutralises markup', !/[<>]/.test(esc)&&!/"/.test(esc), esc);
  ok('no page errors', errors.length===0, errors);
  console.log(fail?'FAILED':'ALL PASSED', pass,'passed,',fail,'failed'); await browser.close(); process.exit(fail?1:0);
})();
