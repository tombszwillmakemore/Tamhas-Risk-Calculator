const { chromium } = require('./_pw');
const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html');
let fail=0; const ok=(n,c,d)=>{ if(!c) fail++; console.log(c?'ok  ':'FAIL',n, c?'':JSON.stringify(d)); };
const txt=async(p,s)=>((await p.locator(s).first().innerText())||'').replace(/\s+/g,' ').trim();
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage(); const errors=[];
  p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
  p.on('dialog',d=>d.accept());
  await p.goto(URL); await p.evaluate(()=>TTDB.ready()); 
  await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('#aRoot .a-card');
  ok('default account listed',(await txt(p,'#aRoot')).includes('Main account'));
  // nav fits on phone
  const nb=await p.$$eval('.nav button',b=>b.map(x=>{const r=x.getBoundingClientRect();return [r.width,r.height]})); ok('5 nav buttons (Home, Risk, Journal, Accounts, More) all >=44px tall and visible',nb.length===5&&nb.every(x=>x[1]>=44&&x[0]>=48),nb);
  const sw=await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth); ok('no horizontal scroll on accounts',sw);
  // create from template
  await p.click('[data-act=a-new]'); await p.fill('#n-name','Topstep 50K #1'); await p.fill('#n-bal','50000');
  await p.selectOption('#n-firm','topstep'); await p.waitForSelector('#n-prod');
  const prods=await p.$$eval('#n-prod option',o=>o.map(x=>x.textContent)); ok('products offered for Topstep',prods.length>=3,prods);
  await p.selectOption('#n-prod',{index:1}); ok('note explains template + third-party caveat',/Researched 2026-10-29/.test(await txt(p,'#aRoot')));
  await p.click('[data-act=n-save]'); await p.waitForSelector('.a-body');
  let body=await txt(p,'#aRoot'); ok('account created with rules copied',/Topstep 50K #1/.test(body)&&/OFFICIAL PAGE/.test(body)&&/source ↗/.test(body),body.slice(0,300));
  ok('copied rules are marked as needing re-check?/age shown',/Researched (today|\d+ days ago)/.test(body));
  ok('states these are not live rules',/not live rules/.test(body));
  const nrules=await p.$$eval('.a-rule',r=>r.length); ok('rules shown ('+nrules+')',nrules>3);
  // edit a rule with verification
  const first=await p.$('[data-act=a-edit]'); const field=await first.getAttribute('data-field'); await first.click();
  await p.fill('#rv-'+field,'$9,999'); await p.fill('#rs-'+field,'https://www.topstep.com/'); await p.check('#rc-'+field); await p.fill('#rn-'+field,'checked site');
  await p.click('[data-act=a-rule-save]'); await p.waitForSelector('.a-hist');
  body=await txt(p,'#aRoot'); ok('edited value shown as YOUR ENTRY, checked today',/\$9,999/.test(body)&&/YOUR ENTRY/.test(body)&&/You checked it today/.test(body));
  ok('history recorded',/Rule history \(1\)/.test(body));
  // persists across reload
  await p.reload(); await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('#aRoot .a-card'); await p.click('.a-head:has-text("Topstep 50K")');
  ok('rule edit + history survive reload',/\$9,999/.test(await txt(p,'#aRoot'))&&/Rule history \(1\)/.test(await txt(p,'#aRoot')));
  // javascript: source rejected
  await p.click('[data-act=a-edit] >> nth=1'); const f2=await p.$eval('.a-ed input[type=text]',e=>e.id.replace('rv-','')); await p.fill('#rs-'+f2,'javascript:alert(1)'); await p.click('[data-act=a-rule-save]');
  ok('no javascript: link rendered',await p.$$eval('#aRoot a',a=>a.every(x=>/^https?:/.test(x.href))));
  // XSS in name
  await p.click('[data-act=a-new]'); await p.fill('#n-name','<img src=x onerror=window.__x=1>'); await p.selectOption('#n-cat','live'); await p.click('[data-act=n-save]'); await p.waitForSelector('.a-card:has-text("<img")');
  ok('account name is escaped, not executed',await p.evaluate(()=>!window.__x&&!document.querySelector('#aRoot img')));
  // journal: add trade to Topstep account
  await p.click('.nav button[data-view=journal]'); await p.waitForSelector('[data-act=new]'); await p.click('[data-act=new]');
  const opts=await p.$$eval('#f-account option',o=>o.map(x=>x.textContent)); ok('trade form offers accounts',opts.length===3&&opts.includes('Topstep 50K #1'),opts);
  await p.selectOption('#f-account',{label:'Topstep 50K #1'}); await p.fill('#f-date','2026-10-27'); await p.fill('#f-qty','1'); await p.fill('#f-entry','100'); await p.fill('.ex-price','110'); await p.click('[data-act=save]');
  await p.waitForSelector('#jList .jcard, #jList [data-act=toggle-card]');
  await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('#aRoot .a-card');
  const card=await txt(p,'.a-card:has-text("Topstep 50K")'); ok('account shows its own P&L (gross, no fees)',/GROSS/.test(card)&&/\+\$2\.00/.test(card),card.slice(0,160));
  const main=await txt(p,'.a-card:has-text("Main account")'); ok('other account shows — not $0',/—/.test(main)&&!/\$0\.00/.test(main),main);
  // can't delete account with trades
  await p.click('.a-head:has-text("Topstep 50K")'); ok('no delete button when trades exist',(await p.$('[data-act=a-delete]'))===null);
  // filter by account in journal
  await p.click('.nav button[data-view=journal]'); await p.click('[data-act=toggle-filters]'); await p.selectOption('#jf-account',{label:'Main account'});
  ok('filter by account hides trade',/Showing 0 of 1/.test(await txt(p,'#jCount')),await txt(p,'#jCount'));
  // archive
  await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('#aRoot .a-card'); if(!(await p.$('[data-act=a-archive]'))) await p.click('.a-head:has-text("Topstep 50K")'); await p.click('[data-act=a-archive]'); await p.waitForSelector('details summary:has-text("Archived")');
  {const t=await txt(p,'#aRoot'); ok('archived moves to Archived list',/Archived \(1\)/.test(t),t.slice(-300));}
  // firm research tab
  await p.click('[data-act=a-tab][data-tab=firms]'); const ft=await txt(p,'#aRoot');
  {const n=(await p.$$('[data-act=f-toggle]')).length; if(n!==17) console.log('firms',n, ft.slice(0,300));}
  ok('firm research: disclaimers + 17 firms + names-only list',/not connected to, endorsed by, or affiliated/.test(ft)&&(await p.$$('[data-act=f-toggle]')).length===17&&/names only/i.test(ft));
  await p.click('[data-slug=apex-trader-funding]'); const ap=await txt(p,'#aRoot'); ok('Apex shows third-party/unconfirmed badges, no official badge',/THIRD-PARTY/.test(ap)&&!/OFFICIAL PAGE/.test(ap));
  ok('sources disagree banner shown',/Sources disagree/.test(ap));
  ok('external links open safely',await p.$$eval('#aRoot a[target=_blank]',a=>a.every(x=>/noopener/.test(x.rel))));
  // no horizontal overflow in firm tab, journal still ok
  ok('no horizontal scroll on firm tab',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  // desktop layout
  await p.setViewportSize({width:1280,height:900}); await p.screenshot({path:'shots/b1-desktop.png'}); await p.setViewportSize({width:390,height:844});
  await p.click('[data-act=a-tab][data-tab=accounts]'); await p.screenshot({path:'shots/b1-mobile.png',fullPage:true});
  ok('no page errors',errors.length===0,errors);
  await browser.close(); console.log(fail?('FAILED '+fail):'ALL PASSED'); process.exit(fail?1:0);
})();
