const R=require('path').join(__dirname,'..','assets')+'/';
global.window=global; require(R+'sessions.js'); require(R+'intel-data.js');
const I=require(R+'intel.js'); const D=window.TT_INTEL_OFFICIAL, C=D.categories;
let fail=0; const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w); if(!ok)fail++; console.log(ok?'ok  ':'FAIL',n,ok?'':`got ${JSON.stringify(g)} want ${JSON.stringify(w)}`)};
const T=s=>Date.parse(s);
const find=(t,d)=>D.events.find(e=>e.title.startsWith(t)&&e.date===d);
eq('NFP Nov 6 08:30 EST = 13:30Z',I.instant(find('US Jobs','2026-11-06')),T('2026-11-06T13:30:00Z'));
eq('GDP Oct 29 08:30 EDT = 12:30Z',I.instant(find('US GDP: Q3 Adv','2026-10-29')),T('2026-10-29T12:30:00Z'));
eq('FOMC Dec 9 14:00 EST = 19:00Z',I.instant(find('Fed Rate','2026-12-09')),T('2026-12-09T19:00:00Z'));
eq('FOMC Oct 28 14:00 EDT = 18:00Z',I.instant(find('Fed Rate','2026-10-28')),T('2026-10-28T18:00:00Z'));
eq('CPI Mar 10 2027 08:30 EDT? (DST starts Mar 14 2027 -> still EST) =13:30Z',I.instant(find('US Inflation','2027-03-10')),T('2027-03-10T13:30:00Z'));
eq('CPI Apr 13 2027 (EDT)=12:30Z',I.instant(find('US Inflation','2027-04-13')),T('2027-04-13T12:30:00Z'));
// data integrity
const all=I.withTs(D.events);
eq('events sorted',all.every((e,i)=>i===0||all[i-1].ts<=e.ts),true);
eq('all categories valid',D.events.every(e=>C[e.cat]),true);
eq('all have source url',D.events.every(e=>/^https:\/\/(www\.)?(federalreserve|bls|bea)\.gov\//.test(e.url)),true);
eq('unique ids',new Set(D.events.map(e=>e.id)).size,D.events.length);
eq('no weekend events',D.events.every(e=>{const w=new Date(e.date+'T12:00:00Z').getUTCDay();return w!==0&&w!==6}),true);
eq('count by cat',Object.keys(C).map(k=>k+':'+D.events.filter(e=>e.cat===k).length).join(','),'TITAN:26,SURGE:4,PULSE:4,BRIEFING:6');
// next event at 2026-10-29 01:42Z (Wed 18:42 PDT): FOMC passed -> GDP/PCE Oct 29
const nx=I.nextEvent(all,T('2026-10-29T01:42:00Z')); eq('next event after FOMC',nx.date+' '+nx.cat,'2026-10-29 SURGE');
// user event validation
const ok=I.cleanUser({title:'  Fed   speaker ',date:'2026-11-12',time:'10:00',cat:'BRIEFING',tz:'local',note:'x'},C);
eq('cleanUser ok',[ok.title,ok.tz,ok.user,ok.cat],['Fed speaker','local',true,'BRIEFING']);
eq('bad date',I.cleanUser({title:'a',date:'2026-02-30',time:'10:00',cat:'PULSE'},C),null);
eq('bad time',I.cleanUser({title:'a',date:'2026-02-20',time:'25:00',cat:'PULSE'},C),null);
eq('bad cat',I.cleanUser({title:'a',date:'2026-02-20',time:'10:00',cat:'NOPE'},C),null);
eq('empty title',I.cleanUser({title:'   ',date:'2026-02-20',time:'10:00',cat:'PULSE'},C),null);
eq('local tz instant',I.instant({date:'2026-11-12',time:'10:00',tz:'local'}),new Date(2026,10,12,10,0).getTime());
const imp=I.parseImport(JSON.stringify([{title:'ok',date:'2026-11-12',time:'09:00',cat:'PULSE'},{title:'bad'},'x']),C);
eq('import counts',[imp.ok,imp.events.length,imp.skipped],[true,1,2]);
eq('import bad json',I.parseImport('{oops',C).ok,false);
eq('import non-array',I.parseImport('{"a":1}',C).ok,false);
// XSS-ish title is kept as data (UI escapes on render)
const x=I.cleanUser({title:'<img src=x onerror=alert(1)>',date:'2026-11-12',time:'09:00',cat:'PULSE'},C); eq('title kept as plain data',x.title.startsWith('<img'),true);
console.log(fail?fail+' FAILED':'LOGIC TESTS PASSED');

// ---- UI smoke with stub DOM ----
const els={}; const mk=id=>els[id]||(els[id]={id,value:'',innerHTML:'',textContent:'',classList:{toggle(){},add(){}},dataset:{},style:{},_h:{},
  addEventListener(e,f){(this._h[e]=this._h[e]||[]).push(f)},querySelectorAll:()=>[],closest:()=>null,select(){} ,
  fire(e,ev){(this._h[e]||[]).forEach(f=>f(ev))}});
global.document={hidden:false,getElementById:mk}; 
const store={}; global.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}};
global.setInterval=()=>0;
delete require.cache[require.resolve(R+'intel.js')];
const realNow=Date.now; Date.now=()=>T('2026-10-29T01:42:00Z');
require(R+'intel.js');
const L=els.intelList.innerHTML;
console.log('list rendered:',L.length>500, '| has TITAN badge:',L.includes('>TITAN<'), '| has GDP title:',L.includes('US GDP: Q3 Advance Estimate'), '| day label:',(L.match(/<div class="day">([^<]*)/)||[])[1]);
console.log('next:',els.intelNext.innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
console.log('home next matches:',els.homeNext.innerHTML===els.intelNext.innerHTML);
// add event via UI path
['evTitle','evDate','evTime','evCat','evTz','evNote'].forEach(mk); els.evTitle.value='My <b>test</b>'; els.evDate.value='2026-10-30'; els.evTime.value='09:00'; els.evCat.value='BRIEFING'; els.evTz.value='et'; els.evNote.value='n';
els.evAdd.fire('click',{});
console.log('saved to storage:',/My <b>test<\/b>/.test(store['tt.intel.user.v1']||''),'| rendered escaped:',els.intelList.innerHTML.includes('My &lt;b&gt;test&lt;/b&gt;') && !els.intelList.innerHTML.includes('<b>test'));
Date.now=realNow;
