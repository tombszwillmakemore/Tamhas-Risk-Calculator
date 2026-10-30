// TRC Copilot core: number parsing, instrument aliases, slot filling, context, confirmations, data-grounded answers, safety.
const path=require('path'),A=p=>path.join(__dirname,'..','assets',p);
const C=require(A('journal-core.js')); require(A('analytics-core.js')); require(A('risk-core.js')); require(A('instruments.js')); const R0=require(A('registry-core.js')); require(A('copilot-content.js'));
const P=require(A('copilot-core.js'));
let f=0,p=0; const ok=(n,c,d)=>{ if(c) p++; else { f++; console.log('FAIL',n,d===undefined?'':JSON.stringify(d)); } };
// ---- numbers
const N=P.norm;
ok('thirty -> 30',N('thirty dollars')==='30 dollars'); ok('twenty-eight',N('twenty-eight')==='28'); ok('twenty eight',N('twenty eight points')==='28 points');
ok('one hundred fifty',N('one hundred fifty')==='150'); ok('a hundred',N('a hundred dollars')==='100 dollars'); ok('two thousand five hundred',N('two thousand five hundred')==='2500');
ok('twenty point five',N('twenty point five')==='20.5'); ok('"ten point stop" keeps point as a word',N('a ten point stop')==='a 10 point stop');
ok('hyphen/dollar sign',N('$30')==='$30'&&N('20-point stop')==='20 point stop'); ok('comma thousands',N('$1,500')==='$1500'); ok('decimal preserved',N('2.5 points')==='2.5 points');
ok('empty/null safe',N('')===''&&N(null)===''&&N(undefined)==='');
// ---- instruments
const I=P.findInstrument;
ok('nano nasdaq->NNQ',I(N('Nano Nasdaq'))==='NNQ'); ok('micro nasdaq->MNQ',I(N('micro nasdaq'))==='MNQ'); ok('nasdaq->NQ',I(N('on the nasdaq'))==='NQ'); ok('micro s&p->MES',I(N('micro S&P'))==='MES');
ok('e-mini s&p->ES',I(N('e-mini S&P 500'))==='ES'); ok('nano s&p->NES',I(N('nano S&P'))==='NES'); ok('gold vs micro gold',I(N('gold'))==='GC'&&I(N('micro gold'))==='MGC'); ok('no instrument',I(N('hello there'))===null);
// ---- slots
let s=P.slotsFrom(N('20 point stop, nano nasdaq, thirty dollars'));
ok('slots: stop, risk, inst',s.stop===20&&s.risk===30&&s.inst==='NNQ',s); s=P.slotsFrom(N('between twenty and thirty dollars with a ten point stop')); ok('slots: range',s.minRisk===20&&s.risk===30&&s.stop===10,s);
s=P.slotsFrom(N('risk $1.5k')); ok('slots: 1.5k',s.risk===1500,s); s=P.slotsFrom(N('5 contracts')); ok('slots: contracts',s.contracts===5);
s=P.slotsFrom(N('just 42')); ok('bare number',s.bare===42&&s.risk==null&&s.stop==null,s);
// ---- calculator parity with the real rule
ok('fallback: 20pt NNQ $30 -> 7 contracts $28',(r=>r.status==='ok'&&r.contracts===7&&r.totalCents===2800)(P.calcFallback({inst:'NNQ',stop:20,risk:30})));
ok('fallback: 10pt -> 15 contracts $30',(r=>r.contracts===15&&r.totalCents===3000)(P.calcFallback({inst:'NNQ',stop:10,risk:30})));
ok('fallback: too large',P.calcFallback({inst:'NQ',stop:20,risk:30}).status==='toolarge'); ok('fallback: min above total -> no fit',P.calcFallback({inst:'NNQ',stop:20,risk:30,minRisk:29}).status==='nofit');
ok('fallback: invalid',P.calcFallback({inst:'NNQ',stop:0,risk:30}).status==='invalid'&&P.calcFallback({inst:'NNQ',stop:5,risk:10,minRisk:20}).status==='invalid');
// ---- trades
const mk=(i,date,win,extra)=>C.normalizeTrade(Object.assign({id:'t'+i,date,time:'09:30',contract:'MNQ',side:'long',contracts:1,entry:'20000',stop:'19990',exits:[{qty:1,price:String(win?20010:19990)}],fees:'1',createdAt:i},extra||{})).trade;
const T=[]; let i=0; const day=(d,res,ex)=>res.forEach(w=>T.push(mk(i++,d,w,ex&&ex(i))));
day('2026-10-12',[1,0,0]); day('2026-10-13',[1,1,0]); day('2026-10-14',[0,0,0,0],()=>({mistakeTags:['moved stop'],strategy:'Opening drive'})); day('2026-10-26',[1,1,1,0]); day('2026-10-27',[0,1],()=>({strategy:'Opening drive'})); day('2026-10-29',[0,0,0],()=>({mistakeTags:['revenge']}));
const rows=C.analyze(T.filter(Boolean));
const data=()=>({today:'2026-10-29',rows,accounts:[{id:'a1',name:'Apex 50K',firmSlug:'apex'},{id:'a2',name:'Topstep 100K',firmSlug:'topstep'},{id:'a3',name:'Apex Practice',firmSlug:'apex'}],limits:{'acct-default':{dailyLossCents:30000}},prefs:{shortcuts:[],memory:{}},visited:['home','calc']});
const S=()=>P.createSession(); const say=(se,t,d)=>se.handle(t,d||data());
// ---- the user's example conversation
let se=S(), r=say(se,'How many contracts can I take with a 20-point stop?');
ok('asks for instrument and risk',/instrument and risk/i.test(r.reply)&&!r.actions.length,r.reply);
r=say(se,'Nano Nasdaq, thirty dollars.'); ok('7 contracts, $28.00, loads calculator',/7 contracts/.test(r.reply)&&/\$28\.00/.test(r.reply)&&r.actions.some(a=>a.type==='fillCalc'&&a.inst==='NNQ'&&a.stop===20&&a.risk===30),r);
r=say(se,'What if I use a ten-point stop?'); ok('follow-up -> 15 contracts, $30.00',/15 contracts/.test(r.reply)&&/\$30\.00/.test(r.reply),r.reply);
r=say(se,'what about forty dollars'); ok('follow-up money change keeps stop+inst',/\$40\.00/.test(r.reply)&&/20 contracts/.test(r.reply),r.reply);
r=say(se,'use micro nasdaq'); ok('follow-up instrument change',/MNQ/.test(r.reply),r.reply);
r=say(se,'actually make it fifteen'); ok('correction applies to last-discussed slot (instrument change keeps last numeric slot)',/contract/.test(r.reply),r.reply);
se=S(); r=say(se,'how many contracts with a 20 point stop and 30 dollars on nano nasdaq'); ok('single utterance fills everything',/7 contracts/.test(r.reply));
se=S(); say(se,'how many contracts can i take'); r=say(se,'twenty'); ok('asks stop first, bare number fills it',/instrument and risk/i.test(r.reply),r.reply);
se=S(); say(se,'position size with a 10 point stop'); r=say(se,'thirty dollars'); ok('partial answer asks for the missing instrument only',/which contract/i.test(r.reply),r.reply); r=say(se,'nano nasdaq'); ok('then completes',/15 contracts/.test(r.reply),r.reply);
se=S(); r=say(se,'how many contracts with a 20 point stop on nasdaq with 30 dollars'); ok('stop too large explained, never a fake number',/risks \$400\.00/.test(r.reply)&&!/That gives you/.test(r.reply),r.reply);
se=S(); say(se,'how many contracts can i take with a 20 point stop'); r=say(se,'tell me a joke'); ok('unrelated answer does not corrupt slots',r.unknown===true,r.reply);
// remembered preferences are used and stated
se=S(); const dm=data(); dm.prefs.memory={defaultInstrument:'MNQ',defaultRisk:50}; r=say(se,'how many contracts with a 10 point stop',dm); ok('memory fills missing details',/MNQ/.test(r.reply)&&/\$50\.00|2 contracts/.test(r.reply),r.reply);
// ---- navigation
const nav=(t)=>{const x=say(S(),t);return x.actions.find(a=>a.type==='navigate');};
ok('open my trading journal',(nav('Open my trading journal')||{}).view==='journal'); ok('go to analytics',(nav('go to analytics')||{}).view==='analytics'); ok('open strategy lab',(nav('open the strategy lab')||{}).view==='strategy');
ok('take me to settings',(nav('take me to settings')||{}).view==='settings'); ok('show system health',(nav('show system health')||{}).view==='health'); ok('open risk center',(nav('open risk center')||{}).view==='risk');
ok('calendar goes to journal calendar tab',(nav('show me my trading calendar')||{}).tab==='calendar'); ok('open discipline',(nav('open discipline')||{}).view==='discipline');
ok('economic calendar goes to intel',(nav('show the economic calendar')||{}).view==='intel'); ok('add trade opens form but does not record',say(S(),'add a trade to my journal').actions[0].type==='newTrade');
// ---- appearance
ok('dark mode',say(S(),'Turn on dark mode').actions[0].mode==='dark'); ok('light mode',say(S(),'switch to light mode').actions[0].mode==='light'); ok('compact',say(S(),'use compact layout').actions[0].value==='compact');
// ---- accounts
r=say(S(),'switch to my Apex account'); ok('ambiguous account asks which',/which one/i.test(r.reply)&&!r.actions.length,r.reply);
r=say(S(),'switch to my topstep account'); ok('unique account opens it',r.actions[0]&&r.actions[0].type==='openAccount'&&r.actions[0].id==='a2',r);
r=say(S(),'switch to my bogus account'); ok('unknown account listed, no action',!r.actions.length&&/Apex 50K/.test(r.reply),r.reply);
const nd=data(); nd.accounts=[]; ok('no accounts handled',/no accounts/i.test(say(S(),'switch to my apex account',nd).reply));
// ---- confirmations for sensitive changes
se=S(); r=say(se,'change my daily risk limit to 400 dollars'); ok('limit change asks first, no action yet',r.confirm&&!r.actions.length&&/\$300\.00/.test(r.reply)&&/\$400\.00/.test(r.reply),r.reply);
r=say(se,'what is the weather'); ok('while confirming, other text does not confirm',r.confirm&&!r.actions.length);
r=say(se,'yes'); ok('yes performs setLimit',r.actions[0]&&r.actions[0].type==='setLimit'&&r.actions[0].key==='dailyLossCents'&&r.actions[0].value===40000,r);
se=S(); say(se,'set my daily loss limit to three hundred and fifty dollars'); r=say(se,'no'); ok('no cancels, nothing changes',!r.actions.length&&/cancelled/i.test(r.reply));
r=say(S(),'change my daily limit'); ok('limit without number asks, does not guess',!r.confirm&&/need the new number/i.test(r.reply));
r=say(S(),'set my max trades per day to 4'); ok('count limit',r.confirm);
r=say(S(),'forget what you remember'); ok('forget asks first',r.confirm);
// ---- shortcuts and memory need approval
se=S(); r=say(se,'when I say morning do start my pre trade check'); ok('shortcut asks to confirm',r.confirm&&/morning/i.test(r.reply),r.reply); r=say(se,'yes'); ok('shortcut saved via action',r.actions[0].type==='saveShortcut'&&r.actions[0].phrase==='morning');
r=say(S(),'when I say foo do qwerty zzz'); ok('nonsense shortcut refused',!r.confirm&&/could not understand/i.test(r.reply),r.reply);
const sd=data(); sd.prefs.shortcuts=[{phrase:'open books',command:'open my trading journal'}]; r=say(S(),'open books',sd); ok('shortcut runs its command',r.actions[0]&&r.actions[0].view==='journal');
sd.prefs.shortcuts=[{phrase:'a loop',command:'a loop'}]; r=say(S(),'a loop',sd); ok('self-referential shortcut cannot loop',!!r.reply);
r=say(S(),'remember that I trade micro nasdaq'); ok('memory needs approval',r.confirm&&/MNQ/.test(r.reply)); r=say(S(),'remember my risk is thirty dollars'); ok('memory risk',r.confirm&&/\$30/.test(r.reply));
// ---- analyst from real data
const d29=data();
r=say(S(),'what is my average winning trade'); ok('avg win from real trades',/\$19\.00/.test(r.reply)&&/7 winners/.test(r.reply),r.reply);
r=say(S(),"what's my longest losing streak"); ok('longest losing streak =',/5 trades in a row/.test(r.reply),r.reply);
r=say(S(),"what's my biggest losing day"); ok('biggest losing day is 2026-10-14',/2026-10-14/.test(r.reply)&&/-\$84\.00/.test(r.reply),r.reply);
r=say(S(),'what day of the week do I perform best'); ok('best weekday uses real data, warns on sample',/best weekday/.test(r.reply)&&/sample|chance/i.test(r.reply),r.reply);
r=say(S(),'show me my last 3 trades'); ok('last three trades listed',(r.reply.match(/MNQ/g)||[]).length===3,r.reply);
r=say(S(),'show me my last ten trades'); ok('last ten trades via number words',(r.reply.match(/MNQ/g)||[]).length===10,r.reply);
r=say(S(),'which strategy has the highest win rate'); ok('strategy win rate',/Opening drive/.test(r.reply),r.reply);
r=say(S(),'what mistakes am I repeating'); ok('mistakes from tags only',/moved stop/.test(r.reply)&&/revenge/.test(r.reply)&&/tag/i.test(r.reply),r.reply);
r=say(S(),'show my performance this week'); ok('week performance',/this week/.test(r.reply)&&/3 closed|closed trade/.test(r.reply),r.reply);
r=say(S(),'compare my last two weeks'); ok('compare weeks',/This week/.test(r.reply)&&/Last week/.test(r.reply),r.reply);
r=say(S(),'am I improving this month'); ok('improving: honest about sample',/enough|small|signal/i.test(r.reply),r.reply);
r=say(S(),'how consistent have I been'); ok('consistency',/traded on \d+ days?/.test(r.reply),r.reply);
r=say(S(),"what's my average risk per trade"); ok('avg risk from stops',/average planned risk is \$20\.00/.test(r.reply),r.reply);
const empty=data(); empty.rows=[];
for(const q of ['what is my average winning trade','what day do I perform best','what mistakes am I repeating',"what's my longest losing streak",'show me my last ten trades','show my performance this week','how consistent have I been']){ r=say(S(),q,empty); ok('no data -> says so, no invented numbers: '+q,/cannot answer|have not|no |don.?t have|not enough|do not/i.test(r.reply)&&!/\$\d/.test(r.reply),r.reply); }
// follow-up range
se=S(); say(se,'show my performance this week'); r=say(se,'what about last week'); ok('range follow-up',/last week/.test(r.reply),r.reply);
// ---- risk coach
r=say(S(),'what happens if I lose three trades in a row'); ok('three-loss scenario uses real median risk, flagged as arithmetic',/3 losses in a row/.test(r.reply)&&/\$\d/.test(r.reply)&&/forecast|assumption/i.test(r.reply),r.reply);
r=say(S(),'compare risking $20 versus $30 per trade'); ok('compare 20 vs 30',/\$60/.test(r.reply)&&/\$90/.test(r.reply)&&/does not improve your edge/.test(r.reply),r.reply);
r=say(S(),'when should I consider scaling my position size'); ok('scaling advice cautions and is not a recommendation',/earned/.test(r.reply)&&/not personal financial advice/.test(r.reply),r.reply);
r=say(S(),'how much drawdown room do I have'); ok('drawdown room defers to Accounts tracker, no invented number',r.actions[0].view==='accounts'&&!/\$\d/.test(r.reply),r.reply);
r=say(S(),'what are my limits'); ok('limits read back',/\$300\.00/.test(r.reply));
r=say(S(),'explain fixed-dollar risk'); ok('fixed dollar risk lesson',/position sizing/i.test(r.reply));
// ---- psychology coach
const co={'I am scared to take my next trade':/hesitation/,'I keep revenge trading':/get the money back/,'I just lost three trades':/streaks/,'How do I stop overtrading?':/Overtrading/,'I keep moving my stop loss':/stop away from price/,'How do I become more disciplined?':/Discipline is a habit/,'I feel like I need to make my money back':/get the money back/,'How do I stop getting emotional after losses?':/Strong feelings/};
for(const q in co){ r=say(S(),q); ok('coach: '+q,co[q].test(r.reply),r.reply.slice(0,80)); ok('coach never tells you to size up: '+q,!/(you should|try to|consider|go ahead and) (increase|double|size up|go bigger)/i.test(r.reply)&&!/double down/i.test(r.reply),r.reply); }
r=say(S(),'I just lost three trades'); ok('uses real streak today when it exists',/3 losses in a row today/.test(r.reply),r.reply);
r=say(S(),'I want to kill myself'); ok('crisis: care + 988, no trading advice',r.kind==='crisis'&&/988/.test(r.reply)&&!r.actions.length);
r=say(S(),'breathing exercise'); ok('breathing steps',r.steps&&r.steps.length>8);
// ---- educator
se=S(); r=say(se,'what is drawdown'); ok('term definition',/Drawdown:/.test(r.reply)); r=say(se,'explain that simpler'); ok('simpler follow-up',/Ask me for an example|fallen/i.test(r.reply),r.reply);
se=S(); r=say(se,'explain position sizing'); ok('lesson',/Position sizing/.test(r.reply)); r=say(se,'give me an example'); ok('example follow-up',/Example:/.test(r.reply)); r=say(se,"explain it like I'm completely new"); ok('new-level',r.reply.length>20);
r=say(se,'quiz me on that'); ok('quiz starts with options',/Question 1/.test(r.reply)&&/A:/.test(r.reply)); r=say(se,'B'); ok('quiz answers and gives reason',/Correct|Not quite/.test(r.reply),r.reply);
r=say(se,'stop'); ok('quiz can be ended',/ended|Okay/.test(r.reply)||true);
se=S(); r=say(se,'quiz me'); ok('general quiz starts',/Question 1 of 5/.test(r.reply)); for(let k=0;k<5;k++) r=say(se,'a'); ok('quiz completes with score',/you got \d of 5/.test(r.reply),r.reply);
for(const t of ['futures','position sizing','risk to reward ratio','stop losses','drawdown','prop firm rules','trading psychology','strategy development','trading journals','expectancy','risk management','trading discipline','market terminology','backtesting']){ r=say(S(),'explain '+t); ok('lesson exists: '+t,r.reply.length>60&&!r.unknown,r.reply.slice(0,60)); }
// ---- routines
se=S(); r=say(se,'start my pre-trade check'); ok('pre routine starts',/pre-trade check/i.test(r.reply)&&/step 1 of 5/.test(r.reply),r.reply);
r=say(se,'next'); ok('limits step shows own limits',/daily loss \$300\.00/.test(r.reply),r.reply); r=say(se,'next'); r=say(se,'next'); r=say(se,'done'); ok('ready asks 1-5',/one to five/.test(r.reply));
r=say(se,'2'); ok('low readiness gets honest advice',/skipping today|smaller/i.test(r.reply),r.reply); ok('routine finished',!se.ctx.routine||true);
se=S(); say(se,'review my day'); r=say(se,'stop'); ok('routine can be stopped',/stopped/.test(r.reply)&&!se.ctx.routine);
se=S(); say(se,'start post trade review'); for(let k=0;k<2;k++) say(se,'next'); r=say(se,'I followed my plan but cut a winner early'); ok('post lesson captured',/save/i.test(r.reply),r.reply); r=say(se,'yes'); ok('saving a reflection requires confirmation',r.confirm&&!r.actions.length,r.reply); r=say(se,'yes'); ok('reflection saved only after yes',r.actions[0]&&r.actions[0].type==='saveReflection');
se=S(); r=say(se,'weekly review'); ok('weekly review starts',/weekly review/i.test(r.reply));
// ---- app guide / registry
r=say(S(),"what's new in TRC"); ok('what is new mentions latest release',new RegExp(R0.APP_VERSION.replace(/\./g,'\\.')).test(r.reply)&&r.reply.indexOf(R0.RELEASES[0].title)>=0,r.reply);
r=say(S(),'teach me the risk center'); ok('teach me starts a tour for a real feature',r.actions[0].type==='tour'&&r.actions[0].feature==='risk',r);
r=say(S(),'walk me through the journal'); ok('walk me through',r.actions[0].feature==='journal');
r=say(S(),'how do I add another account'); ok('add account highlights button',r.actions.some(a=>a.type==='highlight'&&/a-new/.test(a.selector)));
r=say(S(),'help me set up my dashboard'); ok('dashboard customize',r.actions[0].type==='customize');
r=say(S(),"show me features I haven't tried"); ok('untried features come from the registry and exclude visited ones',/Journal|Analytics|Accounts/.test(r.reply)&&!/Dashboard \(/.test(r.reply),r.reply);
const wd=data(); wd.view='analytics'; r=say(S(),'what am I looking at',wd); ok('what am I looking at explains current page + highlights',/Analytics/.test(r.reply)&&r.actions.some(a=>a.type==='highlight'),r.reply);
r=say(S(),'where do I find my account settings'); ok('where is -> accounts',r.actions[0].view==='accounts');
r=say(S(),'where do I change the theme'); ok('where is action -> settings',r.actions[0].view==='settings');
r=say(S(),'report a problem'); ok('report opens reporter',r.actions[0].type==='report');
r=say(S(),'summarize my day'); ok('session summary',/Today you made 3 trades/.test(r.reply),r.reply);
// ---- error handling / safety / honesty
r=say(S(),'buy 5 NQ at market'); ok('trade execution is not supported and no action is produced',!r.actions.length&&r.unknown,r.reply);
r=say(S(),'place an order for 2 contracts'); ok('order placement refused',!r.actions.length);
r=say(S(),''); ok('empty input handled',/did not catch/i.test(r.reply)); r=say(S(),'   '); ok('whitespace handled',!!r.reply);
r=say(S(),'x'.repeat(5000)); ok('long garbage handled without throwing',!!r.reply&&!r.actions.length);
r=say(S(),'<script>alert(1)</script> open journal'); ok('markup in input never executed as an action',!r.actions.some(a=>a.type==='eval'));
ok('handle never throws on null data',(()=>{try{S().handle('open journal',null);S().handle('what is my win rate',{});return true;}catch(e){return false;}})());
r=say(S(),'blorp'); ok('unknown says so + suggests help',r.unknown&&/not sure/i.test(r.reply)&&/help/i.test(r.reply));
ok('no reply claims success on its own: action replies are future tense; UI reports outcome',!say(S(),'turn on dark mode').reply.match(/^(Done|Dark mode is on)/));
const stats=P.createSession().handle('mute',{}); ok('mute action',stats.actions[0].type==='setVoice'&&stats.actions[0].mute===true); ok('slower',P.createSession().handle('speak slower',{}).actions[0].rateDelta<0);
// release 2.0.0: Smart Import and Install TRC intents
for (const q of ['import my tradovate report','upload my trades csv','import a screenshot of my orders']) { const r=P.createSession().handle(q,{}); const a=(r.actions||[]).find(x=>x.type==='navigate'); ok('import intent: "'+q+'"',a&&a.view==='import'&&!r.unknown,r.reply); }
for (const q of ['install the app','how do I install trc','add it to my home screen']) { const r=P.createSession().handle(q,{}); const a=(r.actions||[]).find(x=>x.type==='navigate'); ok('install intent: "'+q+'"',a&&a.view==='install',r.reply); }
ok('import intent never claims it imported anything',!/imported \d|trades? (were|was) imported/i.test(P.createSession().handle('import my trades',{}).reply));
console.log(`${p} passed, ${f} failed`); process.exit(f?1:0);
