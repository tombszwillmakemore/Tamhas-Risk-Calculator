const S=require(require('path').join(__dirname,'..','assets/sessions.js'));
const D=Object.fromEntries(S.DEFAULTS.map(d=>[d.id,d]));
let fail=0;
function eq(name,got,want){const ok=got===want;if(!ok)fail++;console.log(ok?'ok  ':'FAIL',name,ok?'':`got ${got} want ${want}`);}
const T=s=>Date.parse(s);
// offsets
eq('NY EDT offset',S.offsetMin(T('2026-10-28T12:00:00Z'),'America/New_York'),-240);
eq('NY EST offset',S.offsetMin(T('2026-11-02T12:00:00Z'),'America/New_York'),-300);
eq('London GMT offset (after Oct 25 2026)',S.offsetMin(T('2026-10-28T12:00:00Z'),'Europe/London'),0);
eq('London BST offset (Oct 20)',S.offsetMin(T('2026-10-20T12:00:00Z'),'Europe/London'),60);
eq('Tokyo offset',S.offsetMin(T('2026-10-28T12:00:00Z'),'Asia/Tokyo'),540);
// Wed Oct 28 2026 18:42 PDT = 01:42Z Oct 29
const now=T('2026-10-29T01:42:00Z');
let a=S.sessionState(now,D.asia);   eq('Asia open (Thu 10:42 JST)',a.open,true);  eq('Asia closes 09:00Z',a.at,T('2026-10-29T09:00:00Z'));
let l=S.sessionState(now,D.london); eq('London closed',l.open,false); eq('London opens 08:00Z Thu',l.at,T('2026-10-29T08:00:00Z'));
let n=S.sessionState(now,D.newyork);eq('NY closed',n.open,false); eq('NY opens 13:30Z Thu (EDT)',n.at,T('2026-10-29T13:30:00Z'));
// Friday after NY close -> Monday open across DST end (Nov 1 2026): Mon 09:30 EST = 14:30Z
const fri=T('2026-10-30T22:00:00Z');
n=S.sessionState(fri,D.newyork); eq('NY Fri night -> Mon open 14:30Z (EST)',n.at,T('2026-11-02T14:30:00Z'));
// Weekend: Saturday Tokyo
a=S.sessionState(T('2026-10-31T03:00:00Z'),D.asia); eq('Asia Sat closed',a.open,false); eq('Asia next open Mon 00:00Z',a.at,T('2026-11-02T00:00:00Z'));
// open mid-session NY
n=S.sessionState(T('2026-10-28T17:00:00Z'),D.newyork); eq('NY open Wed 13:00 EDT',n.open,true); eq('NY closes 20:00Z',n.at,T('2026-10-28T20:00:00Z'));
// boundaries
n=S.sessionState(T('2026-10-28T13:30:00Z'),D.newyork); eq('NY exactly at open = open',n.open,true);
n=S.sessionState(T('2026-10-28T20:00:00Z'),D.newyork); eq('NY exactly at close = closed',n.open,false);
// overnight window 22:00-06:00 London
const ov={tz:'Europe/London',start:'22:00',end:'06:00'};
let o=S.sessionState(T('2026-10-29T02:00:00Z'),ov); eq('overnight open at 02:00 (started Wed)',o.open,true); eq('overnight closes 06:00Z',o.at,T('2026-10-29T06:00:00Z'));
o=S.sessionState(T('2026-10-30T23:00:00Z'),ov); eq('overnight Fri 23:00 open',o.open,true); eq('closes Sat 06:00Z (Fri-start window)',o.at,T('2026-10-31T06:00:00Z'));
o=S.sessionState(T('2026-10-31T12:00:00Z'),ov); eq('overnight Sat noon closed',o.open,false); eq('next open Mon 22:00Z',o.at,T('2026-11-02T22:00:00Z'));
// spring-forward gap sanity: US DST starts Mar 8 2026; NY open Mon Mar 9 09:30 EDT = 13:30Z
n=S.sessionState(T('2026-03-07T20:00:00Z'),D.newyork); eq('NY Sat before DST start -> Mon 13:30Z',n.at,T('2026-03-09T13:30:00Z'));
// countdown fmt
eq('countdown 1d',S.countdown(86400000+3725000),'1d 01:02:05');
eq('countdown short',S.countdown(59000),'00:00:59');
eq('validHM',[S.validHM('09:30'),S.validHM('9:30'),S.validHM('24:00')].join(),'true,false,false');
console.log(fail?`${fail} FAILED`:'ALL PASSED');
