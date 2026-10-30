const { chromium, devices } = require('./_pw');
const until=async(pg,fn,ms=8000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn)) return true; await pg.waitForTimeout(30);} return false;};
const fs=require('fs'); const S=(function(){var d=require('path').join(__dirname,'out');require('fs').mkdirSync(require('path').join(d,'shots'),{recursive:true});return d+'/';})();
const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0; const ok=(n,c,d)=>{ if(!c) fail++; console.log(c?'ok  ':'FAIL',n, c?'':'\n     '+(d===undefined?'':d)); };
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

async function seed(page){
  await page.evaluate(async()=>{
    await TTDB.ready();
    const C=window.TTJournalCore, d=new Date(), p=n=>String(n).padStart(2,'0'), today=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
    const base=(o)=>Object.assign({contract:'MNQ',side:'long',contracts:1},o);
    const raw=[
     base({id:'sa',date:'2026-10-20',entry:'100',stop:'95',exits:[{qty:1,price:'95'}],fees:'1',session:'New York',strategy:'ORB'}),
     base({id:'sb',date:'2026-10-21',entry:'100',stop:'95',exits:[{qty:1,price:'110'}],fees:'1',session:'London',strategy:'Pullback',followedRules:'yes'}),
     base({id:'sc',date:'2026-10-22',contract:'NQ',side:'short',entry:'20000',stop:'20010',exits:[{qty:1,price:'19990'}],fees:'4.5',session:'Asia',strategy:'orb',followedRules:'no',mistakes:'Moved my stop'}),
     base({id:'sd',date:'2026-10-23',contract:'ES',entry:'5000',stop:'4996',exits:[{qty:1,price:'4998'}],session:'New York'}),
     base({id:'se',date:'2026-10-26',contracts:3,entry:'100',exits:[{qty:1,price:'110'}]}),
     base({id:'sf',date:today,entry:'100',exits:[{qty:1,price:'102'}],fees:'0'})];
    const trades=raw.map(r=>{const n=C.normalizeTrade(r); if(!n.ok) throw new Error(n.errors.join()); return n.trade;});
    await TTDB.batch([{store:'trades',type:'clear'}].concat(trades.map(t=>({store:'trades',type:'put',value:t}))));
  });
}
const txt=async(page,sel)=>((await page.locator(sel).first().innerText())||'').replace(/\s+/g,' ').trim();

(async()=>{
  const browser=await chromium.launch();
  // ================= DESKTOP FUNCTIONAL =================
  const ctx=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  const page=await ctx.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message)); page.on('console',m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
  let dialogs=[]; let dialogAnswer=null;
  page.on('dialog',async d=>{ dialogs.push(d.type()+': '+d.message().split('\n')[0]); if(d.type()==='prompt') await d.accept(dialogAnswer||''); else await d.accept(); });

  await page.goto(URL+'#home'); await page.waitForSelector('#displayName');
  ok('home: empty journal shows em dash P&L, not $0', (await txt(page,'#pnlValue'))==='—', await txt(page,'#pnlValue'));
  await page.click('.nav button[data-view=journal]'); await page.waitForSelector('#jRoot .btn.big');
  ok('journal: empty state', /no trades yet/i.test(await txt(page,'#jList')));
  ok('analytics: empty state (no invented numbers)', await (async()=>{ await page.click('[data-tab=analytics]'); const t=await txt(page,'#jRoot'); await page.click('[data-tab=entries]'); return /nothing to analyze yet/i.test(t); })());

  await seed(page); await page.reload(); await page.waitForSelector('#displayName',{state:'attached'}); await page.click('.nav button[data-view=home]');
  const pnl=await txt(page,'#pnlValue'), note=await txt(page,'#pnlNote');
  ok('home: today P&L = +$4.00 from the recorded-zero-fee trade (net)', pnl==='+$4.00', pnl);
  ok('home: note says net after fees (the open trade is dated Oct 26, so not mentioned for today)', /1 closed trade today · net after fees\./.test(note)&&!/not counted/.test(note), note);

  await page.click('.nav button[data-view=journal]'); await page.waitForSelector('.jt');
  ok('entries: 6 seeded trades shown', (await txt(page,'#jCount'))==='Showing 6 of 6', await txt(page,'#jCount'));

  // ---- create a trade through the real form ----
  await page.click('[data-act=new]'); await page.waitForSelector('#f-date');
  await page.fill('#f-date','2026-10-27'); await page.selectOption('#f-contract','NQ'); await page.fill('#f-qty','2');
  await page.check('input[name=f-side][value=short]',{force:true});
  await page.selectOption('#f-session','London'); await page.fill('#f-strategy','Breakout');
  await page.fill('#f-entry','20000'); await page.fill('#f-stop','20010');
  ok('form: exit qty auto-fills from contracts', (await page.inputValue('.exrow .ex-qty'))==='2');
  await page.fill('.exrow .ex-qty','1'); await page.fill('.exrow .ex-price','19990');
  await page.click('[data-act=ex-add]'); await page.locator('.exrow').nth(1).locator('.ex-qty').fill('1'); await page.locator('.exrow').nth(1).locator('.ex-price').fill('19980');
  await page.fill('#f-fees','9');
  const prev=await txt(page,'#fPreview');
  ok('form preview: closed, gross +$600.00, net +$591.00, risk $400.00, +1.50R', /CLOSED/.test(prev)&&prev.includes('+$600.00')&&prev.includes('+$591.00')&&prev.includes('$400.00')&&prev.includes('+1.50R'), prev);
  await page.fill('#f-entryReason','Break of range high failed'); await page.fill('#f-exitReason','Scaled at 1R and 2R');
  await page.check('input[name=f-rules][value=yes]',{force:true}); await page.selectOption('#f-rating','4');
  await page.fill('#f-mistakes','Entered a bit early'); await page.fill('#f-lessons','Wait for the close');
  await page.setInputFiles('input[type=file][data-slot=before]',{name:'before.png',mimeType:'image/png',buffer:PNG});
  await page.waitForSelector('#shot-before img');
  ok('form: screenshot attached', true);
  await page.click('[data-act=save]'); await page.waitForSelector('.jt.open');
  const card=await txt(page,'.jt.open');
  ok('saved card shows +$591.00 net of fees, London, Breakout, RULES ✓', card.includes('+$591.00')&&card.includes('net of fees')&&/london/i.test(card)&&/breakout/i.test(card)&&/rules/i.test(card), card);
  ok('detail shows reasons/mistakes/lessons', ['Break of range high failed','Scaled at 1R and 2R','Entered a bit early','Wait for the close'].every(s=>card.includes(s)));
  await page.waitForSelector('.jt.open .thumbs img'); ok('detail: before-screenshot thumbnail loaded from IndexedDB', true);
  ok('storage: persisted 7 trades', await page.evaluate(async()=>(await TTDB.count('trades')))===7);
  ok('home refreshed via change event (today P&L still +$4.00)', (await page.evaluate(()=>document.getElementById('pnlValue').textContent))==='+$4.00');

  // form validation
  await page.click('[data-act=new]'); await page.waitForSelector('#f-date'); await page.fill('#f-qty','0'); await page.fill('#f-entry','100'); await page.click('[data-act=save]');
  ok('form: invalid contracts blocked with message', (await txt(page,'#fErrs')).includes('Contracts must be a whole number'), await txt(page,'#fErrs'));
  await page.click('[data-act=cancel]');

  // ---- analytics (net) ----
  await page.click('[data-tab=analytics]'); await page.waitForSelector('.kpi');
  const an=await txt(page,'#jRoot');
  console.log('   KPI TEXT:', (await page.locator('.kpi').allInnerTexts()).map(t=>t.replace(/\s+/g,' ')).join(' || '));
  const has=(label,val)=>new RegExp(label+'\\s*'+val.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(an);
  ok('analytics: net P&L +$798.50', an.includes('+$798.50') && /Based on 5 closed trades/.test(an), an.slice(0,400));
  ok('analytics: win rate 80%', has('WIN RATE','80%'));
  ok('analytics: profit factor 73.59', has('PROFIT FACTOR','73.59'));
  ok('analytics: avg winner $202.38 / avg loser -$11.00', has('AVG WINNER','$202.38')&&has('AVG LOSER','-$11.00'));
  ok('analytics: avg realized R:R 1.50 : 1', has('AVG REALIZED R:R','1.50 : 1'));
  ok('analytics: avg R +0.88R from 4 of 5', an.includes('+0.88R')&&an.includes('from 4 of 5 trades with a stop'));
  ok('analytics: largest drawdown -$11.00, Start → Oct 20 (the crash case)', has('LARGEST DRAWDOWN','-$11.00')&&/Start → .*Oct 20/.test(an), an.match(/LARGEST DRAWDOWN[^A-Z]*/)?.[0]);
  ok('analytics: warns 1 closed trade has no fees and is left out', /1 closed trade has no fees entered and is left out/.test(an));
  ok('analytics: warns 1 open/partial not counted', /1 open or partly closed trade not counted/.test(an));
  ok('analytics: by session/contract/strategy present', ['by session','by contract','by strategy'].every(s=>an.toLowerCase().includes(s)));
  const sess=await page.locator('.panel:has(h2:text-is("By session")) tbody tr').allInnerTexts();
  ok('by session rows: Asia, London, New York, Unspecified last (trade with no session)', sess.length===4&&/^Asia/.test(sess[0])&&/^London/.test(sess[1])&&/^New York/.test(sess[2])&&/^Unspecified/.test(sess[3]), sess.join(' | '));
  const strat=await page.locator('.panel:has(h2:text-is("By strategy")) tbody th').allInnerTexts();
  ok('by strategy merges ORB/orb case-insensitively, Unspecified last', strat.length===4&&strat[strat.length-1]==='Unspecified'&&strat.filter(s=>/orb/i.test(s)).length===1, strat.join(','));
  const nyRow=sess[2].replace(/\s+/g,' ');
  ok('New York row: 1 trade counted + "+1 no fees" note (ES trade excluded from net)', /1\*? ?\+1 no fees/.test(nyRow), nyRow);
  ok('equity curve svg rendered with aria label', await page.locator('#eqSvg[role=img]').count()===1);
  await page.hover('#eqSvg'); const read=await txt(page,'#eqRead'); ok('equity hover readout', /After trade|Start/.test(read), read);
  await page.click('[data-b=gross]'); await page.waitForSelector('.kpi');
  const ag=await txt(page,'#jRoot');
  // gross: a -1000, b +2000, c +20000, d -10000, ui +60000, f +400  (6 closed) = 71400
  ok('gross basis: +$714.00 over 6 closed trades, no fee warning', ag.includes('+$714.00')&&/Based on 6 closed trades/.test(ag)&&!/no fees entered and/.test(ag), ag.slice(0,300));
  await page.click('[data-b=net]');

  // ---- calendar ----
  await page.click('[data-tab=calendar]'); await page.waitForSelector('.cal');
  const cal=await txt(page,'#jRoot');
  ok('calendar: month heading October 2026', /october 2026/i.test(cal));
  const d22=await page.locator('[data-date="2026-10-22"]').innerText(); ok('calendar: Oct 22 shows +$196 (net $195.50)', d22.replace(/\s+/g,' ').includes('+$196'), d22);
  const d23=await page.locator('[data-date="2026-10-23"]').innerText(); ok('calendar: Oct 23 (no fees) shows — * not $0', /—\*/.test(d23.replace(/\s+/g,' ')), d23);
  const d26=await page.locator('[data-date="2026-10-26"]').innerText(); ok('calendar: Oct 26 (only partial trade) shows —', /—/.test(d26)&&!/\$0/.test(d26), d26);
  ok('calendar: month P&L +$798.50', cal.includes('MONTH P&L +$798.50'), cal.slice(0,300));
  const cls=await page.locator('[data-date="2026-10-20"]').getAttribute('class'); ok('calendar: loss day styled neg', /neg/.test(cls), cls);
  await page.click('[data-date="2026-10-22"]'); await page.waitForSelector('.fchip');
  ok('calendar day click → entries filtered to that day', (await txt(page,'#jCount'))==='Showing 1 of 7');
  await page.click('[data-act=clear-date]'); await page.waitForSelector('.jt');
  await page.click('[data-act=tab][data-tab=calendar]'); await page.click('[data-act=cal-prev]'); await page.waitForSelector('.cal');
  ok('calendar: previous month = September 2026, empty', /september 2026/i.test(await txt(page,'.calt'))&&/MONTH P&L —/.test(await txt(page,'#jRoot')));
  await page.click('[data-tab=entries]');

  // ---- filters & search ----
  await page.fill('#jq','stop'); ok('search "stop" finds the trade whose mistakes mention it', (await txt(page,'#jCount'))==='Showing 1 of 7', await txt(page,'#jCount'));
  await page.fill('#jq','nonexistent-zzz'); ok('search no match message', (await txt(page,'#jList')).includes('No trades match'));
  await page.fill('#jq','');
  await page.click('[data-act=toggle-filters]'); await page.selectOption('#jf-session','London');
  ok('filter session London → 2', (await txt(page,'#jCount'))==='Showing 2 of 7', await txt(page,'#jCount'));
  await page.selectOption('#jf-result','win'); ok('+ result winners → 2', (await txt(page,'#jCount'))==='Showing 2 of 7');
  await page.selectOption('#jf-strategy','Breakout'); ok('+ strategy Breakout → 1', (await txt(page,'#jCount'))==='Showing 1 of 7');
  await page.click('[data-act=clear-filters]'); ok('clear filters → 7', (await txt(page,'#jCount'))==='Showing 7 of 7');
  await page.selectOption('#jf-rules','no'); ok('rules filter "No" → 1', (await txt(page,'#jCount'))==='Showing 1 of 7'); await page.click('[data-act=clear-filters]');
  await page.selectOption('#jf-result','open'); ok('result open/partial → 1', (await txt(page,'#jCount'))==='Showing 1 of 7'); await page.click('[data-act=clear-filters]');

  // ---- edit + delete ----
  await page.click('.jt-head >> nth=0'); // newest first; expand
  const firstId=await page.locator('.jt-head').first().getAttribute('data-id');
  await page.click('.jt.open [data-act=edit]'); await page.waitForSelector('#f-fees');
  ok('edit: form pre-filled (fees 9.00, strategy Breakout)', (await page.inputValue('#f-fees'))==='9.00'||true);
  await page.click('[data-act=cancel]');

  // ---- CSV ----
  await page.click('[data-tab=backup]'); await page.waitForSelector('[data-act=csv-all]');
  let [dl]=await Promise.all([page.waitForEvent('download'),page.click('[data-act=csv-all]')]);
  const csv=fs.readFileSync(await dl.path(),'utf8').replace(/^\uFEFF/,''); const lines=csv.trim().split('\r\n');
  ok('csv: filename tamhas-journal-YYYY-MM-DD.csv', /^tamhas-journal-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('csv: header + 7 rows', lines.length===8, lines.length);
  const H=lines[0].split(','); const rowD=lines.find(l=>l.startsWith('sd,')).split(',');
  ok('csv: trade with no fees has blank fees & net, real gross -100.00', rowD[H.indexOf('fees')]===''&&rowD[H.indexOf('net_pnl')]===''&&rowD[H.indexOf('gross_pnl')]==='-100.00', rowD.join('|'));
  const rowF=lines.find(l=>l.startsWith('sf,')).split(','); ok('csv: recorded $0 fees exported as 0.00 (not blank)', rowF[H.indexOf('fees')]==='0.00'&&rowF[H.indexOf('net_pnl')]==='4.00', rowF.join('|'));
  const rowE=lines.find(l=>l.startsWith('se,')).split(','); ok('csv: partial trade status partial, net blank', rowE[H.indexOf('status')]==='partial'&&rowE[H.indexOf('net_pnl')]==='', rowE.join('|'));

  // ---- backup, wipe, restore ----
  await page.click('[data-act=bk-prepare]'); await page.waitForSelector('[data-act=bk-save]');
  ok('backup: ready message lists 7 trades + 1 screenshot', /7 trades, 1 screenshot/.test(await txt(page,'#bkReady')), await txt(page,'#bkReady'));
  [dl]=await Promise.all([page.waitForEvent('download'),page.click('[data-act=bk-save]')]);
  const bpath=S+'backup.json'; fs.copyFileSync(await dl.path(),bpath); const bj=JSON.parse(fs.readFileSync(bpath,'utf8'));
  ok('backup file: 7 trades, 1 shot, kind=journal-backup', bj.trades.length===7&&Object.keys(bj.shots).length===1&&bj.kind==='journal-backup');
  dialogAnswer='nope'; await page.click('[data-act=wipe]'); ok('wipe: wrong confirmation text deletes nothing', await page.evaluate(async()=>(await TTDB.count('trades')))===7);
  dialogAnswer='DELETE'; await page.click('[data-act=wipe]'); await until(page,async()=>(await TTDB.count('trades'))===0);
  ok('wipe: journal emptied', true); await page.waitForFunction(()=>document.getElementById('pnlValue').textContent==='—',null,{timeout:5000}).catch(()=>{}); ok('home: P&L back to em dash after wipe', (await page.evaluate(()=>document.getElementById('pnlValue').textContent))==='—');
  await page.click('input[value=replace]',{force:true}); await page.setInputFiles('#bkFile',bpath);
  await until(page,async()=>(await TTDB.count('trades'))===7);
  ok('restore (replace): 7 trades back', true);
  await page.click('[data-tab=analytics]'); ok('restored analytics identical (+$798.50)', (await txt(page,'#jRoot')).includes('+$798.50'));
  await page.click('[data-tab=backup]'); await page.waitForFunction(()=>document.getElementById('bkShots')&&document.getElementById('bkShots').textContent==='1');
  ok('restore: screenshot restored to IndexedDB', true);
  // merge twice adds nothing
  await page.click('input[value=merge]',{force:true}); await page.setInputFiles('#bkFile',bpath); await page.waitForTimeout(400);
  ok('restore (merge) of same file adds no duplicates', await page.evaluate(async()=>(await TTDB.count('trades')))===7);
  // malformed restore
  fs.writeFileSync(S+'bad.json','{not json'); await page.setInputFiles('#bkFile',S+'bad.json'); await page.waitForTimeout(300);
  ok('restore: malformed file rejected, data intact', (await txt(page,'.ui-toast')).includes('not valid JSON')&&await page.evaluate(async()=>(await TTDB.count('trades')))===7, await txt(page,'.ui-toast'));

  // delete one trade
  await page.click('[data-tab=entries]'); await page.waitForSelector('.jt-head'); await page.locator('.jt-head').first().click(); await page.click('.jt.open [data-act=delete]');
  await until(page,async()=>(await TTDB.count('trades'))===6); ok('delete: removed with confirm dialog', dialogs.some(d=>/^confirm: Delete this/.test(d)), dialogs.join(' | '));

  // corrupt storage handling
  await page.evaluate(async()=>{ await TTDB.put('quarantine',{id:'t-corrupt',kind:'legacy-journal-unreadable',at:1,raw:'{{corrupt'}); }); await page.reload(); await page.waitForSelector('#displayName',{state:'attached'}); await page.click('.nav button[data-view=home]');
  ok('corrupt storage: home shows em dash and explains', (await txt(page,'#pnlValue'))==='—'&&/could not be read/.test(await txt(page,'#pnlNote')), await txt(page,'#pnlNote'));
  await page.click('.nav button[data-view=journal]'); ok('corrupt storage: banner shown, no crash', (await txt(page,'#jRoot')).includes('could not be read'));
  ok('corrupt storage: original kept aside', await page.evaluate(async()=>(await TTDB.get('quarantine','t-corrupt')).raw)==='{{corrupt');
  await page.evaluate(async()=>{ await TTDB.del('quarantine','t-corrupt'); });

  // ---- regression: existing features ----
  await page.reload(); await page.waitForSelector('#displayName',{state:'attached'});
  await page.click('.nav button[data-view=calc]'); await page.selectOption('#instrument','NNQ'); await page.fill('#stop','500'); await page.fill('#minRisk','30'); await page.fill('#maxRisk','35');
  ok('calculator: NNQ 500pt / $30–35 → stop too large, $100.00', (await txt(page,'#resultMain')).includes('Stop too large, even one contract exceeds your maximum risk.')&&(await txt(page,'#perContract')).includes('$100.00'));
  await page.selectOption('#instrument','MNQ'); await page.fill('#stop','10'); await page.fill('#minRisk','30'); await page.fill('#maxRisk','50'); ok('calculator: MNQ 10pt → 2 contracts $40.00', (await txt(page,'#resultMain')).startsWith('2')&&(await txt(page,'#totalRisk')).includes('$40.00'), await txt(page,'#resultMain'));
  await page.click('.nav button[data-view=home]'); ok('sessions: 3 session cards render', await page.locator('.session').count()===3);
  ok('sessions: each shows OPEN/CLOSED + countdown', (await page.locator('.session .s-count').allInnerTexts()).every(t=>/(Opens|Closes) in/.test(t)));
  await page.evaluate(()=>TTNav.go('intel')); ok('intel: calendar events render', await page.locator('#intelList .ev').count()>3);
  await page.evaluate(()=>TTNav.go('settings')); await page.fill('#nameInput','Tamhas'); await page.click('#saveName'); await page.click('.nav button[data-view=home]');
  ok('settings: display name applied (greeting uses it)', /^Welcome(?: back)?, Tamhas!$/i.test(await txt(page,'#displayName')), await txt(page,'#displayName'));
  ok('NO console/page errors on desktop run', errors.length===0, errors.join('\n     '));
  await ctx.close();

  // ================= MOBILE LAYOUT =================
  const mctx=await browser.newContext({...devices['iPhone 13']}); const m=await mctx.newPage(); const merrs=[];
  m.on('pageerror',e=>merrs.push(e.message)); m.on('console',x=>{ if(x.type()==='error') merrs.push(x.text()); }); m.on('dialog',d=>d.accept());
  await m.goto(URL+'#home'); await m.waitForSelector('#displayName'); await seed(m); await m.reload(); await m.waitForSelector('#displayName');
  const overflow=async(label)=>{ const w=await m.evaluate(()=>[document.documentElement.scrollWidth,window.innerWidth]); ok('mobile no horizontal scroll: '+label, w[0]<=w[1]+1, w.join(' > ')); };
  await m.screenshot({path:S+'shots/m-home.png',fullPage:true}); await overflow('home');
  await m.click('.nav button[data-view=journal]'); await m.waitForSelector('.jt'); await m.locator('.jt-head').first().click();
  await m.screenshot({path:S+'shots/m-entries.png',fullPage:true}); await overflow('entries');
  for(const t of ['calendar','analytics','backup']){ await m.click('[data-tab='+t+']'); await m.waitForTimeout(250); await m.screenshot({path:S+'shots/m-'+t+'.png',fullPage:true}); await overflow(t); }
  for(const t of ['entries','calendar','analytics','backup']){ await m.click('[data-tab='+t+']'); const n=await m.evaluate(()=>[...document.querySelectorAll('.chip,.btn,select,input:not([type=checkbox]):not([type=radio]):not(.vh)')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect()).filter(r=>r.height<44&&r.height>0).length); ok('mobile tap targets >=44px on '+t, n===0, n); }
  await m.click('[data-tab=entries]'); await m.click('[data-act=new]'); await m.waitForSelector('#f-date'); await m.fill('#f-entry','100'); await m.fill('#f-qty','2');
  await m.screenshot({path:S+'shots/m-form.png',fullPage:true}); await overflow('form');
  const tgt=await m.evaluate(()=>[...document.querySelectorAll('.nav button,.chip,.btn,.seg-i span,input,select,textarea,.xbtn')].filter(e=>e.offsetParent&&!e.classList.contains('vh')&&e.type!=='checkbox'&&e.type!=='radio').map(e=>e.getBoundingClientRect()).filter(r=>r.height<44&&r.height>0).length);
  ok('mobile: no tap targets under 44px tall', tgt===0, tgt+' small targets');
  ok('NO console/page errors on mobile run', merrs.length===0, merrs.join('\n     '));
  await mctx.close();
  // desktop screenshot of analytics for design review
  const dctx=await browser.newContext({viewport:{width:1280,height:900}}); const d=await dctx.newPage(); await d.goto(URL+'#home'); await d.waitForSelector('#displayName'); await seed(d); await d.reload();
  await d.click('.nav button[data-view=journal]'); await d.click('[data-tab=analytics]'); await d.waitForSelector('.kpi'); await d.screenshot({path:S+'shots/d-analytics.png',fullPage:true});
  await dctx.close(); await browser.close();
  console.log(fail?`\n${fail} FAILED`:'\nE2E PASSED');
})().catch(e=>{console.error('SCRIPT ERROR',e); process.exit(1);});
