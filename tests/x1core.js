const X=require(require('path').join(__dirname,'..','assets','experience-core.js'));
let f=0,p=0; const ok=(n,c,d)=>{ if(c) p++; else { f++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
// defaults + cleaning
const d=X.defaults(); ok('defaults not onboarded, comfortable, home',!d.onboarded&&d.density==='comfortable'&&d.startPage==='home'&&d.name==='');
ok('widgets default: all present and visible',d.widgets.length===X.WIDGETS.length&&d.widgets.every(w=>w.visible));
ok('daily focus keeps its date only when text exists',X.cleanPrefs({goalNote:'Stick to plan',goalDate:'2026-10-29'}).goalDate==='2026-10-29'&&X.cleanPrefs({goalNote:'',goalDate:'2026-10-29'}).goalDate===''&&X.cleanPrefs({goalNote:'x',goalDate:'bad'}).goalDate==='');
ok('cleanPrefs(garbage) is safe',JSON.stringify(X.cleanPrefs(null))===JSON.stringify(X.cleanPrefs(undefined))&&X.cleanPrefs('x').name===''&&X.cleanPrefs([1]).density==='comfortable');
ok('name: tags removed, control chars stripped, clipped to 24, spaces collapsed',X.cleanName('  Al<b>ex</b>\n  Smith ')==='Alex Smith'&&X.cleanName('<script>x</script>')==='x'&&!/[<>]/.test(X.cleanName('a < b > c'))&&X.cleanName('a'.repeat(50)).length===24&&X.cleanName('  Alex   B ')==='Alex B'&&X.cleanName('<img src=x onerror=1>Alex')==='Alex');
ok('name null -> empty',X.cleanName(null)===''&&X.cleanName(undefined)==='');
let c=X.cleanPrefs({name:'Alex',interests:['risk','zzz','risk','news'],density:'tiny',startPage:'nope',favorites:['calc','calc','home','bogus','journal'],recents:['risk','home','x'],onboarded:'yes',whatsNewSeen:-3,lastView:'zzz',lastSeen:'a'});
ok('interests filtered and unique',c.interests.join()==='risk,news'); ok('bad density/startPage fall back',c.density==='comfortable'&&c.startPage==='home'); ok('favorites: unique, valid, no home',c.favorites.join()==='calc,journal'); ok('recents valid',c.recents.join()==='risk');
ok('onboarded only true when boolean true',c.onboarded===false); ok('numbers sanitized',c.whatsNewSeen===0&&c.lastSeen===0&&c.lastView==='home');
ok('startPage "last" allowed',X.cleanPrefs({startPage:'last'}).startPage==='last'&&X.cleanPrefs({startPage:'journal'}).startPage==='journal');
ok('favorites capped at 8',X.cleanPrefs({favorites:X.CATALOG.filter(c=>c.id!=='home').map(c=>c.id)}).favorites.length===8);
// widgets: missing ones re-added, unknown dropped, order kept
let w=X.cleanWidgets([{id:'pnl',visible:false},{id:'bogus'},{id:'today'},{id:'pnl'}]); ok('widgets: order kept, unknown dropped, dup dropped, missing appended',w[0].id==='pnl'&&w[0].visible===false&&w[1].id==='today'&&w.length===X.WIDGETS.length&&!w.some(x=>x.id==='bogus')&&new Set(w.map(x=>x.id)).size===w.length);
ok('widgets: nothing disappears when saved list is old/short',X.cleanWidgets([{id:'pnl',visible:true}]).length===X.WIDGETS.length);
let mv=X.moveWidget(d.widgets,'today',-1); ok('moveWidget up swaps',mv[1].id==='today'&&mv.length===d.widgets.length); ok('moveWidget at edge no-op',X.moveWidget(d.widgets,d.widgets[0].id,-1)[0].id===d.widgets[0].id&&X.moveWidget(d.widgets,'nope',1).length===d.widgets.length);
// recents
let r=[]; for(const i of ['calc','journal','risk','analytics','insights','strategy','health']) r=X.pushRecent(r,i); ok('recents newest first, capped at 6',r[0]==='health'&&r.length===6&&!r.includes('calc'),r); r=X.pushRecent(r,'risk'); ok('re-opening moves to front without duplicate',r[0]==='risk'&&r.filter(x=>x==='risk').length===1&&r.length===6); ok('home and unknown never recorded',X.pushRecent(r,'home').join()===r.join()&&X.pushRecent(r,'zzz').join()===r.join());
// favorites
let fv=X.toggleFavorite([],'calc'); ok('favorite added',fv.added&&fv.list.join()==='calc'); fv=X.toggleFavorite(fv.list,'calc'); ok('favorite removed',fv.added===false&&fv.list.length===0);
let full=[]; for(const i of ['calc','journal','risk','analytics','insights','strategy','health','money']) full=X.toggleFavorite(full,i).list; ok('8 favorites ok',full.length===8); const over=X.toggleFavorite(full,'accounts'); ok('9th refused with full flag, list unchanged',over.full&&over.list.length===8&&!over.changed); ok('removing when full still works',X.toggleFavorite(full,'calc').list.length===7);
ok('cannot favorite home/unknown',!X.toggleFavorite([],'home').changed&&!X.toggleFavorite([],'zz').changed);
// prioritize
let pr=X.prioritize(Object.assign(X.defaults(),{favorites:['strategy'],interests:['risk','prop']})); ok('favorites first, then interest tools, then rest',pr[0]==='strategy'&&pr[1]==='calc'&&pr[2]==='risk'&&pr[3]==='accounts'&&pr[4]==='money',pr.slice(0,6));
ok('prioritize includes every tool exactly once, none dropped',new Set(pr).size===pr.length&&X.CATALOG.filter(c=>!['home','settings','help'].includes(c.id)).every(c=>pr.includes(c.id)));
ok('no interests -> still all tools',X.prioritize(X.defaults()).length===X.CATALOG.length-3);
// search
const top=(q)=>X.search(q).map(i=>i.id);
ok('"risk" finds calculator and risk center first',['calc','risk'].includes(top('risk')[0])&&top('risk').includes('calc')&&top('risk').includes('risk'),top('risk'));
ok('"journal" -> Trade journal first',top('journal')[0]==='journal'); ok('"analytics" first',top('analytics')[0]==='analytics'); ok('prefix "anal"',top('anal')[0]==='analytics');
ok('synonym via keywords: "csv" -> import',top('csv').includes('import')); ok('"prop firm" -> accounts',top('prop firm')[0]==='accounts',top('prop firm')); ok('"drawdown" finds accounts/analytics',top('drawdown').includes('accounts')&&top('drawdown').includes('analytics'));
ok('"change name" -> settings action',top('change name')[0]==='x-name',top('change name')); ok('"dark mode" -> theme action',top('dark mode')[0]==='x-theme',top('dark mode')); ok('"new trade" -> log trade action first',top('new trade')[0]==='x-newtrade',top('new trade'));
ok('"backtest" -> strategy lab',top('backtest')[0]==='strategy'); ok('"fomc" -> intel',top('fomc')[0]==='intel'); ok('"shortcuts" -> help action',top('shortcuts').some(i=>/x-shortcuts|help/.test(i)));
ok('all words must match: "risk zebra" -> nothing',top('risk zebra').length===0); ok('gibberish -> nothing',top('qqqxxz').length===0); ok('case/space/punct insensitive',top('  RISK!! ')[0]===top('risk')[0]);
ok('empty query -> suggestions, favorites first',X.search('',8,['strategy'])[0].id==='strategy'&&X.search('',8,[]).length===8&&X.search('',8,[]).every(i=>i.kind==='screen'));
ok('results capped',X.search('a',5).length<=5); ok('screens carry view, actions carry act',X.search('change name')[0].act==='focus-name'&&X.search('journal')[0].view==='journal');
ok('every extra points at a real screen',X.EXTRAS.every(e=>X.CATALOG.some(c=>c.id===e.view))); ok('catalog ids unique',new Set(X.CATALOG.map(c=>c.id)).size===X.CATALOG.length);
ok('every catalog category is in CATS',X.CATALOG.every(c=>X.CATS.some(k=>k[0]===c.cat)));
ok('search with HTML is just text, never throws',Array.isArray(X.search('<img onerror=1>')));
// greeting
const at=(h)=>new Date(2026,9,29,h,0); let g=X.greeting('Alex',at(9),0); ok('first visit: Welcome, Alex!',g.line==='Welcome, Alex!'&&/Good morning/.test(g.sub)&&/stays on this device/.test(g.sub),g);
g=X.greeting('Alex',at(14),123); ok('returning: Welcome back, Alex!',g.line==='Welcome back, Alex!'&&/Good afternoon/.test(g.sub)); ok('evening',/Good evening/.test(X.greeting('A',at(19),1).sub)); ok('late night',/Late night/.test(X.greeting('A',at(2),1).sub)&&/Late night/.test(X.greeting('A',at(23),1).sub));
ok('no name -> no dangling comma',X.greeting('',at(9),1).line==='Welcome back!'&&X.greeting(null,at(9),0).line==='Welcome!'); ok('name sanitized in greeting',!/[<>]/.test(X.greeting('<b>x',at(9),1).line));
// content
ok('what\'s new has ids descending and non-empty',X.WHATS_NEW.every((w,i,a)=>w.title&&w.items.length&&(i===0||a[i-1].id>w.id))); ok('glossary entries complete',X.GLOSSARY.length>=10&&X.GLOSSARY.every(g=>g.term&&g.text.length>20)); ok('tour steps point at real views',X.TOUR.every(t=>t.view==='more'||X.CATALOG.some(c=>c.id===t.view))&&X.TOUR.length>=4);
ok('shortcuts listed',X.SHORTCUTS.some(s=>/Ctrl/.test(s[0])));
console.log(`x1core: ${p} passed, ${f} failed`); process.exit(f?1:0);
