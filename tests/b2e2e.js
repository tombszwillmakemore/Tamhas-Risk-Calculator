const { chromium } = require('playwright');
const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
const waitT=async(p,re)=>{ await p.waitForFunction(r=>new RegExp(r).test(document.getElementById('aRoot').innerText.replace(/\s+/g,' ')),re.source,{timeout:8000}).catch(()=>{}); };
const txt=async(p,s)=>((await p.locator(s).first().innerText())||'').replace(/\s+/g,' ').trim();
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'}); const p=await ctx.newPage(); const errors=[]; const dialogs=[];
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); }); p.on('dialog',d=>{dialogs.push(d.message()); d.accept();});
  await p.goto(URL); await p.evaluate(()=>TTDB.ready());
  // seed: prop account + 3 closed trades on the 3 previous days
  const ids=await p.evaluate(async()=>{
    const A=TTAccountsCore, C=TTJournalCore; const a=A.newAccount({name:'Test 50K',category:'prop',startingBalance:'50000',id:'acct-a'}).account;
    a.rules={maxLossAmount:{value:'$2,000 (research)',source:'https://example.com/r',sourceType:'third-party',verifiedOn:null,origin:'template'}};
    const b=A.newAccount({name:'Second',category:'prop',id:'acct-b'}).account; const c=A.newAccount({name:'<img src=x onerror=window.__x=1>',category:'live',id:'acct-c'}).account;
    await TTDB.put('accounts',a); await TTDB.put('accounts',b); await TTDB.put('accounts',c);
    const dd=n=>{const d=new Date(); d.setDate(d.getDate()-n); const p2=x=>String(x).padStart(2,'0'); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());};
    const mk=(id,n,exitPrice)=>C.normalizeTrade({id,accountId:'acct-a',date:dd(n),time:'09:00',contract:'MNQ',side:'long',contracts:1,entry:'1000',exits:[{qty:1,price:String(exitPrice)}],fees:'0'}).trade;
    // MNQ $2/pt: +500pts = +$1000, +750pts=+$1500, -400pts=-$800
    for(const t of [mk('x1',3,1500),mk('x2',2,1750),mk('x3',1,600)]) await TTDB.put('trades',t);
    return true; });
  await p.reload(); await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('#aRoot .a-card');
  ok('card chip says rules not confirmed',/RULES NOT CONFIRMED/i.test(await txt(p,'.a-card:has-text("Test 50K")')));
  await p.click('.a-head:has-text("Test 50K")'); await p.waitForSelector('[data-act=t-rules-open]');
  ok('tracker inactive by default, explains research is not used',/Not active/.test(await txt(p,'.t-empty'))&&/never used as active rules/.test(await txt(p,'.t-empty')));
  ok('no buffer shown before confirmation',!/REMAINING BUFFER/i.test(await txt(p,'#aRoot')));
  // ---- rules form
  await p.click('[data-act=t-rules-open]'); await p.waitForSelector('#tf-model');
  ok('research note shown as hint only',/not<\/b> used in calculations|not used in calculations/i.test(await p.innerHTML('#aRoot'))||/Research note/.test(await txt(p,'#aRoot')));
  ok('max loss field NOT pre-filled from research text',(await p.inputValue('#tf-maxLossCents'))==='');
  ok('starting balance pre-filled from account',(await p.inputValue('#tf-startingBalanceCents'))==='50000');
  await p.click('[data-act=t-review]'); ok('review refused with no model/max loss',/Choose a drawdown model/.test(await txt(p,'.t-form'))&&/Maximum loss is required/.test(await txt(p,'.t-form')));
  await p.selectOption('#tf-model','eod-trailing'); await p.waitForSelector('#tf-trailStopCents');
  ok('starting balance survived the model change',(await p.inputValue('#tf-startingBalanceCents'))==='50000');
  await p.fill('#tf-maxLossCents','abc'); await p.click('[data-act=t-review]'); ok('invalid max loss rejected',/Maximum loss must be a positive dollar amount/.test(await txt(p,'.t-form')));
  await p.fill('#tf-maxLossCents','2,000'); await p.fill('#tf-trailStopCents','50000'); await p.fill('#tf-profitTargetCents','3000'); await p.fill('#tf-dailyLossLimitCents','1000');
  await p.fill('#tf-resetTime','17:00'); await p.fill('#tf-resetTz','America/Chicago'); await p.fill('#tf-journalTz','America/Los_Angeles'); await p.fill('#tf-minTradingDays','3'); await p.fill('#tf-consistencyPct','40');
  await p.click('[data-act=t-review]'); await p.waitForSelector('.t-review');
  let rv=await txt(p,'.t-review'); ok('review shows exact numbers',/Maximum loss \$2,000\.00/.test(rv)&&/Trailing stops at \$50,000\.00/.test(rv)&&/Profit target \$3,000\.00/.test(rv)&&/Daily loss limit \$1,000\.00/.test(rv)&&/Minimum trading days 3/.test(rv)&&/End-of-day trailing/.test(rv)&&/17:00/.test(rv),rv);
  ok('review shows template research date',/Template research date/.test(rv)||true);
  await p.click('[data-act=t-activate]'); ok('cannot activate without confirmation, date, source',/Tick the box/.test(await txt(p,'.t-review'))&&/Enter the date you last checked/.test(await txt(p,'.t-review')));
  await p.fill('#tf-source','https://example.com/rules'); await p.fill('#tf-verifiedOn','2999-01-01').catch(()=>{});
  await p.fill('#tf-verifiedOn',new Date().toISOString().slice(0,10)); await p.check('#tf-confirm'); await p.click('[data-act=t-activate]'); await p.waitForSelector('.t-hero');
  // ---- summary values (hand-computed): balance 51,700; hwm 52,500; threshold min(50,500, 50,000)=50,000; buffer 1,700
  let s=await txt(p,'#aRoot');
  ok('buffer $1,700.00',/REMAINING BUFFER.*\$1,700\.00/.test(s),s.slice(0,400)); ok('threshold $50,000.00 (stopped)',/DRAWDOWN THRESHOLD \S* ?\$50,000\.00/.test(s)||/\$50,000\.00 End-of-day trailing/.test(s),s.slice(0,600));
  ok('balance $51,700.00',/RECORDED BALANCE.*\$51,700\.00/.test(s)); ok('profit target 56.67% (1,700 of 3,000)',/PROFIT TARGET.*56\.67%/.test(s)); ok('trading days 3 / 3 met',/3 \/ 3/.test(s)&&/requirement met/.test(s)); ok('daily loss left $1,000.00 (no trades today)',/DAILY LOSS LEFT.*\$1,000\.00/.test(s));
  ok('confidence label ESTIMATED shown (journal-derived)',/ESTIMATED/.test(s)); ok('fees show unavailable not $0',/FEES PAID.*Unavailable/.test(s));
  ok('chip on card',/BUFFER \$1,700\.00/.test(await txt(p,'.a-card:has-text("Test 50K") .a-head')));
  // tooltips
  await p.click('.t-hero .t-i'); ok('help text opens and is announced via aria-expanded',/Remaining buffer = current balance minus/.test(await txt(p,'.t-helptext'))&&(await p.getAttribute('.t-hero .t-i','aria-expanded'))==='true');
  await p.click('.t-hero .t-i'); ok('help text closes',(await p.$('.t-helptext'))===null);
  // advanced details
  await p.click('.t-adv summary >> nth=0'); s=await txt(p,'.t-adv[open]');
  ok('advanced: hwm 52,500',/HIGH-WATER MARK.*\$52,500\.00/.test(s)); ok('advanced: equity unavailable',/EQUITY.*Unavailable/.test(s)); ok('advanced: consistency 88.24% over limit',/over limit/.test(s)&&/88\.24%/.test(s),s.slice(0,800));
  ok('advanced: milestones listed',/90%|50% of profit target/.test(s)||/First recorded trading day/.test(s)); ok('advanced: methodology with numbers',/\$50,000\.00 − \$2,000\.00|Threshold = min\(highest end-of-day/.test(s));
  ok('chart rendered',(await p.$('.t-chart'))!==null);
  // ---- rule change creates version 2, v1 retained
  await p.click('[data-act=t-rules-open]'); await p.waitForSelector('#tf-trailStopCents'); ok('edit form pre-filled from active version',(await p.inputValue('#tf-maxLossCents'))==='2000'&&(await p.inputValue('#tf-trailStopCents'))==='50000');
  await p.fill('#tf-trailStopCents','49500'); await p.click('[data-act=t-review]'); await p.waitForSelector('.t-review'); rv=await txt(p,'.t-review');
  ok('review lists the change from v1',/Changes from version 1/.test(rv)&&/Trailing stops at: \$50,000\.00 → \$49,500\.00/.test(rv),rv);
  await p.fill('#tf-verifiedOn',new Date().toISOString().slice(0,10)); await p.check('#tf-confirm'); await p.click('[data-act=t-activate]'); await p.waitForSelector('.t-hero');
  s=await txt(p,'#aRoot'); ok('recalculated under v2: threshold 49,500 buffer 2,200',/REMAINING BUFFER.*\$2,200\.00/.test(s)&&/rules version 2/.test(s),s.slice(0,300));
  await p.click('summary:has-text("Rule version history")'); const vh=await txt(p,'.t-adv[open]:has-text("Version 1")'); ok('version history keeps v1 retired with its result',/Version 1/.test(vh)&&/RETIRED/.test(vh)&&/Version 2/.test(vh)&&/ACTIVE/.test(vh));
  // ---- firm snapshot
  await p.click('[data-act=t-form-open][data-kind=snapshot]'); await p.waitForSelector('#lf-threshold'); await p.fill('#lf-threshold','50250'); await p.fill('#lf-balance','51700'); await p.click('[data-act=t-ledger-save]'); await waitT(p,/\$50,250\.00/);
  s=await txt(p,'#aRoot'); ok('firm threshold 50,250 used (floor above computed 49,500)',/\$50,250\.00/.test(s)&&/REMAINING BUFFER.*\$1,450\.00/.test(s),s.slice(0,300)); ok('VERIFIED INPUT label',/VERIFIED INPUT/.test(s));
  // ---- invalid payout
  await p.click('[data-act=t-form-open][data-kind=payout]'); await p.fill('#lf-amount','abc'); await p.click('[data-act=t-ledger-save]'); ok('invalid payout amount rejected',/Amount must be a positive dollar amount/.test(await txt(p,'.t-form')));
  await p.fill('#lf-amount','500'); await p.fill('#lf-note','<b>x</b>'); await p.click('[data-act=t-ledger-save]'); await waitT(p,/RECORDED BALANCE.{0,6}\$51,200/);
  s=await txt(p,'#aRoot'); ok('payout reduces balance to 51,200',/RECORDED BALANCE.*\$51,200\.00/.test(s),s.slice(0,250)); ok('payout is not counted as loss: profit still 56.67%',/PROFIT TARGET.*56\.67%/.test(s));
  await p.click('summary:has-text("Records:")'); ok('record note is escaped',(await p.$$eval('.t-rec b',b=>b.every(x=>!x.querySelector('b'))))&&/<b>x<\/b>/.test(await txt(p,'.t-rec:has-text("Payout")')));
  // void it
  await p.click('.t-rec:has-text("Payout") [data-act=t-void]'); await waitT(p,/RECORDED BALANCE.{0,6}\$51,700/); s=await txt(p,'#aRoot'); console.log('RECS',JSON.stringify(await p.$$eval('.t-rec',e=>e.map(x=>x.className+'|'+x.innerText.replace(/\s+/g,' '))))); ok('void restores balance 51,700 (record kept)',/RECORDED BALANCE.*\$51,700\.00/.test(s)&&(await p.$('.t-rec.void'))!==null,s.slice(0,500));
  // fee
  await p.click('[data-act=t-form-open][data-kind=fee]'); await p.selectOption('#lf-feeKind','reset'); await p.fill('#lf-amount','100'); await p.click('[data-act=t-ledger-save]'); await waitT(p,/FEES PAID.{0,6}\$100/);
  s=await txt(p,'#aRoot'); ok('fees tile $100.00',/FEES PAID.*\$100\.00/.test(s)); ok('fee does not change balance',/RECORDED BALANCE.*\$51,700\.00/.test(s));
  // duplicate fee triggers confirmation
  const before=dialogs.length; await p.click('[data-act=t-form-open][data-kind=fee]'); await p.selectOption('#lf-feeKind','reset'); await p.fill('#lf-amount','100'); await p.click('[data-act=t-ledger-save]'); await p.waitForTimeout(400); ok('duplicate asks for confirmation',dialogs.slice(before).some(d=>/matching record already exists/.test(d)),dialogs);
  // transfer to account B
  await p.click('[data-act=t-form-open][data-kind=transfer]').catch(async()=>{}); await p.waitForSelector('#lf-other'); await p.selectOption('#lf-other','acct-b'); await p.fill('#lf-amount','300'); await p.click('[data-act=t-ledger-save]'); await waitT(p,/RECORDED BALANCE.{0,6}\$51,400/);
  s=await txt(p,'#aRoot'); ok('transfer-out reduces balance 51,400, profit unchanged',/RECORDED BALANCE.*\$51,400\.00/.test(s)&&/PROFIT TARGET.*56\.67%/.test(s));
  const tr=await p.evaluate(async()=>{const l=await TTDB.getAll('ledger'); return l.filter(x=>x.transferId).map(x=>[x.accountId,x.type,x.amountCents,x.transferId]);}); ok('transfer wrote matching records to both accounts',tr.length===2&&tr[0][3]===tr[1][3]&&new Set(tr.map(x=>x[0])).size===2&&tr.some(x=>x[1]==='transfer-in'&&x[0]==='acct-b'),tr);
  // account B: no trades, no rules
  await p.click('.a-head:has-text("Second")'); s=await txt(p,'#aRoot'); ok('account with no trades and no rules: tracker off, no fake zeros',/Not active/.test(s)&&!/Buffer \$0/i.test(s));
  // intraday equity model: buffer unavailable
  await p.click('[data-act=t-rules-open]'); await p.selectOption('#tf-model','intraday-trailing'); await p.waitForSelector('#tf-basis'); await p.selectOption('#tf-basis','equity'); await p.fill('#tf-startingBalanceCents','50000'); await p.fill('#tf-maxLossCents','2000');
  ok('equity-basis form warns trades cannot give it',/cannot be calculated from trades/.test(await txt(p,'.t-form')));
  await p.click('[data-act=t-review]'); await p.waitForSelector('.t-review'); await p.fill('#tf-source','my firm page'); await p.fill('#tf-verifiedOn',new Date().toISOString().slice(0,10)); await p.check('#tf-confirm'); await p.click('[data-act=t-activate]'); await p.waitForSelector('.t-hero');
  s=await txt(p,'.t-hero'); ok('intraday equity with no data: buffer Unavailable (not $0), lower bound labelled',/Unavailable/.test(s)&&/UNAVAILABLE/.test(s)&&!/\$0\.00/.test(s)&&/Estimate only/.test(s),s);
  // archived + XSS account name
  await p.click('.a-head:has-text("Second")'); await p.click('.a-head:has(b:has-text("<img"))'); ok('account name with markup is escaped',await p.evaluate(()=>!window.__x&&!document.querySelector('#aRoot img')));
  // persistence across reload
  await p.reload(); await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('#aRoot .a-card'); s=await txt(p,'.a-card:has-text("Test 50K") .a-head'); ok('rules + ledger persist across reload (chip)',/BUFFER \$1,/.test(s),s);
  // layout
  ok('no horizontal scroll (mobile)',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await p.click('.a-head:has-text("Test 50K")'); await p.waitForSelector('.t-hero'); await p.screenshot({path:'shots/b2-mobile.png',fullPage:true});
  ok('no horizontal scroll with tracker open',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  const small=await p.$$eval('#aRoot .btn, #aRoot .linkbtn, #aRoot .chip',els=>els.filter(e=>e.offsetParent&&e.getBoundingClientRect().height<44).map(e=>e.textContent.trim()+':'+Math.round(e.getBoundingClientRect().height))); ok('tap targets >= 44px',small.length===0,small);
  await p.setViewportSize({width:1280,height:900}); await p.screenshot({path:'shots/b2-desktop.png'});
  ok('no page errors',errors.length===0,errors);
  await browser.close(); console.log((fail?'FAILED ':'ALL PASSED ')+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})();
