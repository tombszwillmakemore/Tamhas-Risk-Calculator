const { chromium } = require('./_pw'); const fs=require('fs');
const until=async(pg,fn,ms=8000)=>{const t=Date.now(); while(Date.now()-t<ms){ if(await pg.evaluate(fn)) return true; await pg.waitForTimeout(30);} return false;};
const URL=((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html'); let fail=0,pass=0; const ok=(n,c,d)=>{ if(c) pass++; else { fail++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
(async()=>{
  const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true}); const p=await ctx.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message)); p.on('dialog',d=>d.accept('DELETE'));
  await p.goto(URL); await p.evaluate(()=>TTDB.ready());
  await p.evaluate(async()=>{ const A=TTAccountsCore,C=TTJournalCore;
    const a=A.newAccount({name:'=cmd|calc',category:'prop',startingBalance:'50000',id:'acct-a'}).account; await TTDB.put('accounts',a);
    const t=C.normalizeTrade({id:'t1',accountId:'acct-a',date:'2026-10-20',time:'09:00',contract:'MNQ',side:'long',contracts:1,entry:'1000',exits:[{qty:1,price:'1500'}],fees:'1'}).trade; await TTDB.put('trades',t);
    const t2=C.normalizeTrade({id:'t2',date:'2026-10-21',contract:'MNQ',side:'long',contracts:1,entry:'1000',exits:[{qty:1,price:'1100'}]}).trade; await TTDB.put('trades',t2);
    await TTDB.put('ledger',{id:'l1',accountId:'acct-a',type:'fee',feeKind:'reset',amountCents:10000,at:Date.UTC(2026,9,20,19),date:'2026-10-20',createdAt:1,voided:false});
    await TTDB.put('ledger',{id:'l2',accountId:'acct-a',type:'payout',amountCents:50000,at:Date.UTC(2026,9,22,19),date:'2026-10-22',createdAt:2,voided:true}); });
  await p.reload();
  // ---- CSV
  const csv=await p.evaluate(async()=>{ await TTDB.ready(); const tr=await TTDB.getAll('trades'); const ac=await TTDB.getAll('accounts'); const names={}; ac.forEach(a=>names[a.id]=a.name); return {csv:TTJournalCore.toCsv(TTJournalCore.analyze(tr),names), cols:TTJournalCore.CSV_COLS}; });
  const lines=csv.csv.trim().split('\r\n'); const hdr=lines[0].split(',');
  ok('CSV: old 25 columns keep their exact positions',hdr.slice(0,25).join(',')==='id,date,time,contract,side,session,strategy,contracts,entry,stop,exits,avg_exit,status,gross_pnl,fees,net_pnl,planned_risk,r_multiple,rules_followed,rating,entry_reason,exit_reason,mistakes,lessons,notes',hdr);
  ok('CSV: account columns appended at the end',hdr.slice(25,27).join(',')==='account,account_id'&&hdr[27]==='entries'&&hdr.slice(28).join(',')==='tags,emotions,mistake_tags,grade'&&hdr.length===32);
  ok('CSV: account name is formula-injection safe',lines.some(l=>l.includes("'=cmd|calc")),lines);
  ok('CSV: default-account trade exported as acct-default with name Main account',lines.some(l=>l.includes(',Main account,acct-default,')),lines);
  // old exports (25 columns) are a prefix of the new header, so a position-based reader still works
  // ---- backup v2 contents
  const bk=await p.evaluate(async()=>{ const [a,l,t]=await Promise.all([TTDB.getAll('accounts'),TTDB.getAll('ledger'),TTDB.getAll('trades')]); return TTJournalCore.serializeBackup(t,{}, {accounts:a,ledger:l}); });
  const j=JSON.parse(bk); ok('backup: version 3 with accounts, ledger and docs',j.version===3&&Array.isArray(j.docs)&&j.accounts.length===2&&j.ledger.length===2&&j.trades.length===2,[j.version,j.accounts.length,j.ledger.length]);
  ok('backup: voided record preserved',j.ledger.some(l=>l.voided===true));
  const pb=await p.evaluate(b=>{const r=TTJournalCore.parseBackup(b); return {ok:r.ok,a:r.accounts.length,l:r.ledger.length,has:r.hasExtras,sk:r.skipped};},bk); ok('backup: parses back',pb.ok&&pb.a===2&&pb.l===2&&pb.has===true,pb);
  // v1 backup still parses, no extras
  const v1=JSON.stringify({app:'tamhas-trading',kind:'journal-backup',version:1,trades:j.trades,shots:{}}); const pv=await p.evaluate(b=>{const r=TTJournalCore.parseBackup(b); return {ok:r.ok,a:r.accounts.length,has:r.hasExtras,t:r.trades.length};},v1); ok('backup: old v1 file still restores trades',pv.ok&&pv.t===2&&pv.a===0&&pv.has===false,pv);
  // garbage rows skipped and counted
  const bad=JSON.stringify(Object.assign({},j,{accounts:j.accounts.concat([{id:'',name:'x'},null,{id:'q',name:'x',category:'bogus'}]),ledger:j.ledger.concat([{id:'z',accountId:'a',type:'fee',at:1,amountCents:-5},{id:'z2',accountId:'a',type:'nope',at:1}])}));
  const pbd=await p.evaluate(b=>{const r=TTJournalCore.parseBackup(b); return {a:r.accounts.length,l:r.ledger.length,sk:r.skipped};},bad); ok('backup: invalid account/ledger rows rejected and reported',pbd.a===2&&pbd.l===2&&pbd.sk.length>=2,pbd);
  // ---- real restore flow: wipe everything, then restore through the UI file chooser
  fs.writeFileSync('b2backup.json',bk);
  await p.evaluate(async()=>{ await TTDB.clear('ledger'); await TTDB.del('accounts','acct-a'); await TTDB.clear('trades'); });
  await p.reload(); await p.click('.nav button[data-view=journal]'); await p.waitForSelector('[data-act=tab][data-tab=backup]'); await p.click('[data-act=tab][data-tab=backup]'); await p.waitForSelector('#bkFile',{state:'attached'});
  const t0=Date.now(); await p.setInputFiles('#bkFile','b2backup.json'); await until(p,async()=>(await TTDB.count('trades'))===2&&(await TTDB.count('ledger'))===2&&(await TTDB.count('accounts'))===2);
  console.log('restore ms',Date.now()-t0, JSON.stringify(errors)); const after=await p.evaluate(async()=>({t:await TTDB.count('trades'),l:await TTDB.count('ledger'),a:await TTDB.count('accounts'),v:(await TTDB.get('ledger','l2')||{}).voided}));
  ok('restore (merge) brings back trades, accounts, ledger incl. voided flag',after.t===2&&after.l===2&&after.a===2&&after.v===true,after);
  // merge again: no duplicates
  await p.setInputFiles('#bkFile','b2backup.json'); await p.waitForTimeout(800); const again=await p.evaluate(async()=>({t:await TTDB.count('trades'),l:await TTDB.count('ledger'),a:await TTDB.count('accounts')})); ok('restoring the same file twice adds nothing',again.t===2&&again.l===2&&again.a===2,again);
  // v1 backup in REPLACE mode must not erase accounts or ledger
  fs.writeFileSync('b2v1.json',v1); await p.check('input[name=bkmode][value=replace]'); await p.setInputFiles('#bkFile','b2v1.json'); await p.waitForTimeout(1000);
  const keep=await p.evaluate(async()=>({l:await TTDB.count('ledger'),a:await TTDB.count('accounts')})); ok('replace with an OLD backup never erases accounts or account records',keep.l===2&&keep.a===2,keep);
  // v2 replace swaps ledger
  await p.evaluate(async()=>{ await TTDB.put('ledger',{id:'extra',accountId:'acct-a',type:'fee',feeKind:'other',amountCents:100,at:1,createdAt:1}); });
  await p.setInputFiles('#bkFile','b2backup.json'); await p.waitForTimeout(1000); const rep=await p.evaluate(async()=>({l:await TTDB.count('ledger'),e:await TTDB.get('ledger','extra')})); ok('replace with a NEW backup replaces the ledger',rep.l===2&&!rep.e,rep);
  // missing account placeholder
  const orph=JSON.stringify({app:'tamhas-trading',kind:'journal-backup',version:1,trades:[Object.assign({},j.trades[0],{id:'orph',accountId:'ghost'})],shots:{}}); fs.writeFileSync('b2orph.json',orph);
  await p.check('input[name=bkmode][value=merge]'); await p.setInputFiles('#bkFile','b2orph.json'); await p.waitForTimeout(1000); const gh=await p.evaluate(async()=>(await TTDB.get('accounts','ghost'))||null); ok('trade pointing at an unknown account gets a clearly named placeholder account',gh&&gh.name==='Restored account',gh);
  ok('no page errors',errors.length===0,errors);
  await browser.close(); console.log((fail?'FAILED ':'ALL PASSED ')+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})();
