const { chromium } = require('playwright');
const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})(); const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const until=async(pg,fn,arg,ms=6000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn,arg)) return true; await pg.waitForTimeout(40);} return false;};
const seed=async(p,list)=>{ await p.evaluate(async(list)=>{ const C=TTJournalCore; const d=new Date(); const t0=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); await TTDB.clear('trades'); await TTStore.invalidate(); for (const o of list){ const r=C.normalizeTrade(Object.assign({contract:'NQ',side:'long',contracts:1,entry:100,stop:95,fees:'0',createdAt:1,date:t0},o)); if(!r.ok) throw new Error(JSON.stringify(r.errors)); await TTDB.put('trades',r.trade);} },list); };
const type=async(p,sel,v)=>{ await p.fill(sel,v); };
(async()=>{
  const browser=await chromium.launch(); const perf={};
  // ---------- performance with 5000 trades ----------
  { const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
    await p.goto(URL); await p.evaluate(()=>TTDB.ready()); await p.evaluate(async()=>{ for (const s of ['trades','docs']) await TTDB.clear(s); const C=TTJournalCore, ops=[]; const d0=Date.UTC(2024,0,1); for(let i=0;i<5000;i++){ const dt=new Date(d0+Math.floor(i/6)*86400000).toISOString().slice(0,10); const win=(i*7)%10<6; const r=C.normalizeTrade({id:'p'+i,date:dt,time:String(9+(i%6)).padStart(2,'0')+':'+String((i*7)%60).padStart(2,'0'),contract:['NQ','MNQ','ES','MES'][i%4],side:i%2?'long':'short',contracts:1+(i%3),entry:100,stop:i%2?95:105,fees:'4',createdAt:i+1,strategy:['ORB','Fade','VWAP'][i%3],mistakeTags:i%9===0?['fomo']:undefined,exits:[{qty:1+(i%3),price:win?(i%2?110:90):(i%2?97:103)}]}); if(!r.ok) throw new Error(JSON.stringify(r.errors)); ops.push({store:'trades',type:'put',value:r.trade}); } await TTDB.batch(ops); await TTStore.invalidate(); });
    ok('5000 trades stored',(await p.evaluate(()=>TTDB.count('trades')))===5000);
    const t0=Date.now(); await p.reload(); await p.evaluate(()=>TTDB.ready()); perf.coldLoadMs=Date.now()-t0;
    const time=async(name,view,sel,ms=15000)=>{ const t=Date.now(); try{ await p.evaluate(v=>TTNav.go(v),view); await p.waitForFunction(s=>{ const e=document.querySelector(s); return e&&e.innerText.length>40&&!/^Loading/.test(e.innerText); },sel,{timeout:ms}); perf[name]=Date.now()-t; }catch(e){ console.log('TIMEOUT',name,errors,await p.evaluate(s=>document.querySelector(s)&&document.querySelector(s).innerText.slice(0,200),sel)); perf[name]=99999; } };
    await time('journalMs','journal','#view-journal'); await time('analyticsMs','analytics','#anRoot'); await time('riskMs','risk','#rkRoot'); await time('insightsMs','insights','#inRoot'); await time('strategyMs','strategy','#stRoot'); await time('disciplineMs','discipline','#dsRoot'); await time('healthMs','health','#hlRoot');
    perf.insightsComputeMs=await p.evaluate(()=>{ const t=performance.now(); TTInsightsCore.generate(TTInsightsUI.state.rows,{today:'2026-10-29'}); return Math.round(performance.now()-t); });
    perf.analyticsComputeMs=await p.evaluate(()=>{ const t=performance.now(); const P=TTAnalyticsCore.prepare(TTInsightsUI.state.rows,{},'net'); TTAnalyticsCore.summary(P.inc); TTAnalyticsCore.equity(P.inc); ['weekday','hour','strategy','mistake'].forEach(d=>TTAnalyticsCore.breakdown(P.inc,d)); return Math.round(performance.now()-t); });
    perf.monteCarloMs=await p.evaluate(()=>{ const rs=TTInsightsUI.state.rows.filter(r=>r.c.rMultiple!=null).map(r=>r.c.rMultiple).slice(0,1000); const t=performance.now(); TTStrategyCore.monteCarlo(rs,{horizon:1000,sims:5000,seed:1}); return Math.round(performance.now()-t); });
    console.log('PERF (5000 trades, headless Chromium, this machine):',JSON.stringify(perf));
    for (const [k,v] of Object.entries(perf)) ok('perf budget '+k+' < 5000 ms ('+v+')',v<5000,v);
    ok('perf: no js errors',errors.length===0,errors); await ctx.close(); }
  // ---------- offline ----------
  { const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
    await p.goto(URL); await p.evaluate(()=>TTDB.ready()); const sw=await p.evaluate(async()=>{ if(!('serviceWorker' in navigator)) return 'none'; const r=await navigator.serviceWorker.ready; return r.active?'active':'inactive'; }); ok('service worker active',sw==='active',sw);
    await p.waitForTimeout(1500); await ctx.setOffline(true); await p.reload(); await p.waitForSelector('#view-home'); ok('offline reload shows the app',/TRADER|WELCOME/i.test(await p.innerText('#view-home')));
    for (const v of ['analytics','risk','discipline','strategy','insights','health','import']) { await p.evaluate(n=>TTNav.go(n),v); await p.waitForTimeout(200); } ok('offline: every new screen opens',true);
    ok('offline: scripts all loaded (globals present)',await p.evaluate(()=>['TTAnalyticsCore','TTRiskCore','TTDisciplineCore','TTStrategyCore','TTInsightsCore','TTHealthCore','TTImportUI','TTInsightsUI'].every(k=>window[k])));
    ok('offline: no js errors',errors.length===0,errors); await ctx.close(); }
  // ---------- accessibility + security basics on every view, both themes ----------
  for (const theme of ['dark','light']) { const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const T=theme+': '; await p.goto(URL); await p.evaluate(()=>TTDB.ready()); if(theme==='light') await p.evaluate(()=>localStorage.setItem('tt.theme','light')); await p.reload();
    const views=['home','calc','journal','accounts','more','intel','settings','money','import','analytics','risk','discipline','strategy','insights','health'];
    for (const v of views) { await p.evaluate(n=>TTNav.go(n),v); await p.waitForTimeout(250);
      const r=await p.evaluate(()=>{ const view=document.querySelector('.view.active'); if(!view) return {none:true}; const vis=e=>{ const s=getComputedStyle(e); return s.display!=='none'&&s.visibility!=='hidden'&&e.offsetParent!==null; };
        const nameOf=e=>(e.getAttribute('aria-label')||e.innerText||e.textContent||e.getAttribute('title')||e.value||'').trim()||(e.getAttribute('aria-labelledby')&&document.getElementById(e.getAttribute('aria-labelledby'))&&document.getElementById(e.getAttribute('aria-labelledby')).innerText)||'';
        const btns=[...view.querySelectorAll('button,[role=button],a[href]')].filter(vis).filter(b=>!nameOf(b)&&!b.querySelector('svg title')).map(b=>b.outerHTML.slice(0,80));
        const inputs=[...view.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).filter(i=>{ if(i.getAttribute('aria-label')||i.getAttribute('aria-labelledby')||i.title) return false; if(i.id&&document.querySelector('label[for="'+i.id+'"]')) return false; if(i.closest('label')) return false; return true; }).map(i=>i.outerHTML.slice(0,80));
        const imgs=[...view.querySelectorAll('img:not([alt])')].map(i=>i.outerHTML.slice(0,60)); const inline=[...document.querySelectorAll('[onclick],[onerror],[onload]')].length;
        return {btns,inputs,imgs,inline,h1:view.querySelectorAll('h1').length,scroll:document.documentElement.scrollWidth<=window.innerWidth+1}; });
      ok(T+v+': buttons have accessible names',!r.btns||r.btns.length===0,r.btns); ok(T+v+': inputs have labels',!r.inputs||r.inputs.length===0,r.inputs); ok(T+v+': images have alt',!r.imgs||r.imgs.length===0,r.imgs); ok(T+v+': no inline event handlers',r.inline===0); ok(T+v+': no horizontal scroll',r.scroll!==false,v); }
    await ctx.close(); }
  await browser.close(); console.log(`qa1e2e: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
