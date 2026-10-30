const fs=require('fs'),vm=require('vm');
const R=require('path').join(__dirname,'..')+'/';
const INST=require(R+'assets/instruments.js');
function mkEnv(saved){
  const els={},store={}; if(saved) store['tt.calc.instrument.v1']=saved;
  const get=id=>{ if(els[id]) return els[id]; const e={id,value:'',className:'',textContent:'',_h:{},addEventListener(ev,f){(this._h[ev]=this._h[ev]||[]).push(f)},fire(ev){(this._h[ev]||[]).forEach(f=>f())}};
    let h='';Object.defineProperty(e,'innerHTML',{set(v){h=v;e.textContent=v.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()},get(){return h}}); return els[id]=e; };
  const ctx={document:{getElementById:get},window:{TTInstruments:INST},localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}}}; ctx.window.window=ctx.window; vm.createContext(ctx);
  return {els,get,store,ctx};
}
function out(get){return get('resultMain').textContent+'|'+get('perContract').textContent+'|'+get('totalRisk').textContent+'|'+get('resultCard').className.replace('panel ','card ');}
const classic=fs.readFileSync(R+'calculator-classic.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const calc=fs.readFileSync(R+'assets/calculator.js','utf8');
let fail=0; const ok=(n,c,d)=>{if(!c)fail++;console.log(c?'ok  ':'FAIL',n,c?'':d)};

// 1) NNQ default must match ORIGINAL calculator exactly
const cases=[['500','30','35'],['30','30','35'],['100','10','50'],['75','1','5'],['50','30','35'],['10','5','3'],['','',''],['7','12','13'],['1','0','0.5'],['0','1','2'],['35','30','35'],['2.5','10','12'],['.5','1','2'],['abc','1','2']];
let mism=0;
for(const c of cases){
  const a=mkEnv(), b=mkEnv();
  a.get('stop').value=c[0];a.get('minRisk').value=c[1];a.get('maxRisk').value=c[2]; vm.runInContext(classic,a.ctx);
  b.get('stop').value=c[0];b.get('minRisk').value=c[1];b.get('maxRisk').value=c[2]; vm.runInContext(calc,b.ctx);
  if(out(a.get)!==out(b.get)){mism++;console.log('MISMATCH',c,out(a.get),'vs',out(b.get));}
}
ok('NNQ default identical to original on '+cases.length+' cases',mism===0);

// 2) every instrument vs independent reference (exact integer-cent math)
function ref(stop,min,max,cpp){ const per=Math.round(stop*cpp),mn=Math.round(min*100),mx=Math.round(max*100);
  if(per>mx) return 'TOOBIG'; const n=Math.floor(mx/per); const t=n*per; if(n<1||t<mn) return 'NOFIT'; return n+':'+t; }
const grid=[]; for(const s of [0.5,1,2,5,10,25,30,50,75,100,150,500]) for(const [mn,mx] of [[30,35],[10,50],[100,150],[200,260],[1,2]]) grid.push([s,mn,mx]);
let bad=0,n=0;
for(const i of INST.list){
  for(const [s,mn,mx] of grid){
    const e=mkEnv(i.id); e.get('stop').value=String(s);e.get('minRisk').value=String(mn);e.get('maxRisk').value=String(mx); vm.runInContext(calc,e.ctx);
    const txt=out(e.get), r=ref(s,mn,mx,i.centsPerPoint); n++;
    let got; if(/Stop too large/.test(txt)) got='TOOBIG'; else if(/No contract size/.test(txt)) got='NOFIT'; else { const m=txt.match(/^(\d+) contract/); const tot=txt.split('|')[2].replace(/[$,]/g,''); got=m[1]+':'+Math.round(parseFloat(tot)*100); }
    if(got!==r){bad++; if(bad<6)console.log('  mismatch',i.id,s,mn,mx,'got',got,'ref',r);}
    // never exceed max
    if(got.includes(':')){ const tot=parseInt(got.split(':')[1]); if(tot>Math.round(mx*100)||tot<Math.round(mn*100)){bad++;console.log('  OUT OF RANGE',i.id,s,mn,mx,got);} }
  }
}
ok(`all 6 instruments x ${grid.length} scenarios match independent reference (${n} checks, none exceed max)`,bad===0);

// 3) specific examples
let e=mkEnv('NNQ'); e.get('stop').value='500';e.get('minRisk').value='30';e.get('maxRisk').value='35'; vm.runInContext(calc,e.ctx);
ok('NNQ 500pt/$30-35 => stop too large, $100.00/contract',/Stop too large, even one contract exceeds your maximum risk\./.test(out(e.get))&&out(e.get).includes('$100.00'),out(e.get));
e=mkEnv('MNQ'); e.get('stop').value='10';e.get('minRisk').value='30';e.get('maxRisk').value='50'; vm.runInContext(calc,e.ctx);
ok('MNQ 10pt => $20/contract, 2 contracts $40',out(e.get).startsWith('2 contracts|$20.00|$40.00'),out(e.get));
e=mkEnv('ES'); e.get('stop').value='1';e.get('minRisk').value='40';e.get('maxRisk').value='55'; vm.runInContext(calc,e.ctx);
ok('ES 1pt => $50/contract, 1 contract',out(e.get).startsWith('1 contract|$50.00|$50.00'),out(e.get));
e=mkEnv('ES'); e.get('stop').value='2';e.get('minRisk').value='40';e.get('maxRisk').value='55'; vm.runInContext(calc,e.ctx);
ok('ES 2pt => $100 > $55 max => too large',/Stop too large/.test(out(e.get)),out(e.get));
e=mkEnv('MES'); e.get('stop').value='7';e.get('minRisk').value='30';e.get('maxRisk').value='36'; vm.runInContext(calc,e.ctx);
ok('MES 7pt => $35/contract, 1 contract',out(e.get).startsWith('1 contract|$35.00|$35.00'),out(e.get));

// 4) selector behaviour: change instrument recalcs + persists; bad saved value falls back
e=mkEnv(); e.get('stop').value='10';e.get('minRisk').value='30';e.get('maxRisk').value='50'; vm.runInContext(calc,e.ctx);
const before=out(e.get); e.get('instrument').value='MNQ'; e.get('instrument').fire('change');
ok('NNQ->MNQ recalculates',before!==out(e.get)&&out(e.get).startsWith('2 contracts|$20.00'),before+' => '+out(e.get));
ok('selection persisted',e.store['tt.calc.instrument.v1']==='MNQ');
ok('footer updates',/^MNQ · \$2 per point/.test(e.get('calcFoot').textContent),e.get('calcFoot').textContent);
e=mkEnv('HACK<script>'); vm.runInContext(calc,e.ctx); ok('invalid saved value falls back to NNQ',e.get('instrument').value==='NNQ',e.get('instrument').value);
e=mkEnv('NES'); vm.runInContext(calc,e.ctx); ok('saved NES restored',e.get('instrument').value==='NES');
// 5) data sanity
ok('6 instruments, ids as requested',INST.list.map(i=>i.id).join()==='NNQ,NES,MNQ,NQ,MES,MGC,GC,ES');
ok('cents/pt = 20,50,200,2000,500,1000(MGC),10000(GC),5000',INST.list.map(i=>i.centsPerPoint).join()==='20,50,200,2000,500,1000,10000,5000');
console.log(fail?fail+' FAILED':'ALL PASSED');
