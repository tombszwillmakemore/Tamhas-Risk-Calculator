const { chromium } = require('playwright'); let fail=0; const ok=(n,c,d)=>{ if(!c){fail++; console.log('FAIL',n,JSON.stringify(d));} else console.log('ok  ',n); };
(async()=>{ const b=await chromium.launch(); const p=await b.newPage(); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
 await p.goto(((process.env.TT_BASE||'http://127.0.0.1:8765')+'/calculator-classic.html'));
 // build a Batch 0/1 era database (version 1, no ledger store) with real-looking data
 await p.evaluate(()=>new Promise((res,rej)=>{ const rq=indexedDB.open('tt-platform',1); rq.onupgradeneeded=()=>{ const db=rq.result; db.createObjectStore('meta',{keyPath:'key'}); db.createObjectStore('accounts',{keyPath:'id'}); const t=db.createObjectStore('trades',{keyPath:'id'}); t.createIndex('accountId','accountId'); t.createIndex('date','date'); db.createObjectStore('quarantine',{keyPath:'id'}); db.createObjectStore('audit',{keyPath:'id'}); };
   rq.onsuccess=()=>{ const db=rq.result; const tx=db.transaction(['accounts','trades','meta','quarantine'],'readwrite');
     tx.objectStore('accounts').put({id:'acct-default',name:'Main account',category:'unassigned',archived:false,createdAt:1,note:''});
     tx.objectStore('accounts').put({id:'acct-x',name:'Old prop',category:'prop',status:'evaluation',archived:false,createdAt:2,rules:{profitTarget:{value:'$3,000',source:'https://e.com',sourceType:'official',verifiedOn:null,origin:'template'}},ruleHistory:[],statusHistory:[],template:null,note:''});
     tx.objectStore('trades').put({id:'k1',accountId:'acct-x',date:'2026-10-20',time:'09:00',contract:'MNQ',side:'long',contracts:1,entry:1000,stop:null,exits:[{qty:1,price:1500}],feesCents:100,session:'',strategy:'',entryReason:'',exitReason:'',followedRules:null,mistakes:'',lessons:'',notes:'',rating:null,createdAt:5});
     tx.objectStore('meta').put({key:'legacyMigrated',value:{at:1,trades:1,rejected:0,corrupt:false,hadLegacyData:true}});
     tx.objectStore('quarantine').put({id:'q1',kind:'legacy-journal-unreadable',at:1,raw:'{bad'});
     tx.oncomplete=()=>{ db.close(); res(); }; tx.onerror=()=>rej(tx.error); }; rq.onerror=()=>rej(rq.error); }));
 await p.goto(((process.env.TT_BASE||'http://127.0.0.1:8765')+'/index.html'));
 const r=await p.evaluate(async()=>{ await TTDB.ready(); const db=await TTDB.open(); return {ver:db.version, stores:[...db.objectStoreNames].sort(), trades:await TTDB.count('trades'), accounts:(await TTDB.getAll('accounts')).map(a=>a.id).sort(), q:await TTDB.count('quarantine'), meta:(await TTDB.getMeta('legacyMigrated')).trades, ledger:await TTDB.count('ledger'), acct:(await TTDB.get('accounts','acct-x')).rules.profitTarget.value}; });
 ok('upgraded to schema version 3',r.ver===3,r); ok('ledger store added, all old stores present',JSON.stringify(r.stores)===JSON.stringify(['accounts','audit','docs','ledger','meta','quarantine','trades']),r.stores);
 ok('existing trades, accounts, quarantine, migration flag untouched',r.trades===1&&r.accounts.join()==='acct-default,acct-x'&&r.q===1&&r.meta===1&&r.acct==='$3,000',r); ok('ledger starts empty',r.ledger===0);
 await p.click('.nav button[data-view=accounts]'); await p.waitForSelector('.a-card'); const t=await p.locator('#aRoot').innerText(); ok('old accounts render in the new UI with no errors',/Old prop/.test(t)&&/Main account/.test(t),t.slice(0,200));
 await p.click('.a-head:has-text("Old prop")'); await p.waitForSelector('[data-act=t-rules-open]'); ok('old account shows tracker as not active (rules never auto-activated)',/Not active/.test(await p.locator('.t-empty').innerText()));
 ok('no page errors',errors.length===0,errors); await b.close(); console.log(fail?'FAILED':'ALL PASSED'); process.exit(fail?1:0); })();
