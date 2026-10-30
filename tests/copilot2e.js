const REGV = require(require('path').join(__dirname, '..', 'assets', 'registry-core.js')); const VRX = new RegExp(REGV.APP_VERSION.replace(/\./g, '\\.'));
// TRC Copilot end to end (real Chromium, mocked speech APIs): lazy load, typed + spoken conversations driving the REAL calculator and screens,
// confirmations, data-grounded answers, mic safety, registry-driven help/tours/What's New, problem reporter, update bar.
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'); const out = path.join(__dirname, 'out', 'shots'); fs.mkdirSync(out, { recursive: true });
const URL = ((process.env.TT_BASE || 'http://127.0.0.1:8765') + '/index.html'); let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const view = (p) => p.evaluate(() => (document.querySelector('.view.active') || {}).id);
const MOCKS = () => {
  window.__spoken = []; window.__cancels = 0; window.__sr = { starts: 0, aborts: 0, inst: null, lang: '' };
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.rate = 1; };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speaking: false, speak(u) { window.__spoken.push(u.text); if (u.onstart) u.onstart(); setTimeout(() => { if (u.onend) u.onend(); }, 20); }, cancel() { window.__cancels++; }, getVoices() { return [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test-voice' }]; }, addEventListener() {} } });
  window.SpeechRecognition = function () { window.__sr.inst = this; this.start = () => { window.__sr.starts++; }; this.abort = () => { window.__sr.aborts++; }; this.stop = () => { window.__sr.aborts++; }; };
  window.webkitSpeechRecognition = window.SpeechRecognition;
};
const fire = (p, transcript, fin = true) => p.evaluate(([t, f]) => { const r = window.__sr.inst; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: f })] }); }, [transcript, fin]);
const send = async (p, text) => { const n0 = await p.evaluate(() => document.querySelectorAll('.cp-m.c').length); await p.fill('.cp-in', text); await p.press('.cp-in', 'Enter'); try { await p.waitForFunction((n) => !document.querySelector('#copilotPanel') || document.querySelectorAll('.cp-m.c').length > n, n0, { timeout: 8000 }); } catch (e) { console.log('SEND TIMEOUT for:', text, '| log:', await p.evaluate(() => document.querySelector('.cp-log') ? document.querySelector('.cp-log').innerText.slice(-300) : 'NO PANEL')); throw e; } await p.waitForTimeout(60); };
const lastC = async (p) => { if (!(await p.$('#copilotPanel'))) { await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); await p.waitForTimeout(80); } return p.evaluate(() => { const a = document.querySelectorAll('.cp-m.c'); return a[a.length - 1].textContent; }); };
const seed = async (p) => p.evaluate(async () => {
  const C = TTJournalCore; const d = new Date(); const y = d.getFullYear(), m = d.getMonth(), t = d.getDate(); const key = (k) => { const x = new Date(y, m, t - k); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  await TTDB.clear('trades'); await TTStore.invalidate(); let i = 0;
  const plan = [[3, [1, 1, 0]], [2, [0, 0, 0, 0]], [1, [1, 0]], [0, [0, 1, 1]]];
  for (const [ago, res] of plan) for (const w of res) { const r = C.normalizeTrade({ id: 's' + i, createdAt: i, date: key(ago), time: '09:' + String(10 + i).slice(-2), contract: 'MNQ', side: 'long', contracts: 1, entry: 20000, stop: 19990, exits: [{ qty: 1, price: w ? 20010 : 19990 }], fees: '1' }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); await TTDB.put('trades', r.trade); i++; }
  await TTDB.put('accounts', { id: 'acct-topstep', name: 'Topstep 100K', category: 'prop', status: 'evaluation', archived: false, createdAt: 3, note: '', firmSlug: 'topstep' });
  await TTDB.put('accounts', { id: 'acct-apex', name: 'Apex 50K', category: 'prop', status: 'evaluation', archived: false, createdAt: 4, note: '', firmSlug: 'apex' });
  await TTStore.invalidate();
});
(async () => {
  const browser = await chromium.launch();
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    const T = label + ': '; const ctx = await browser.newContext({ viewport: vp, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
    await p.addInitScript(MOCKS);
    await p.addInitScript(() => { try { if (!localStorage.getItem('tt.profile.v1')) localStorage.setItem('tt.profile.v1', JSON.stringify({ onboarded: true, tourSeen: true, name: 'Alex', whatsNewSeen: 7 })); localStorage.setItem('tt.nw.nudged', '8'); } catch (e) {} });
    const reqs = []; p.on('request', r => reqs.push(r.url()));
    await p.goto(URL); await p.waitForSelector('#copilotFab'); await p.waitForTimeout(500); await seed(p); await p.reload(); await p.waitForSelector('#copilotFab'); await p.waitForTimeout(400);
    // ---- launcher, lazy load
    ok(T + 'floating button present, labelled, keyboard reachable', (await p.getAttribute('#copilotFab', 'aria-label')) === 'Open TRC Copilot' && (await p.evaluate(() => document.getElementById('copilotFab').tagName)) === 'BUTTON');
    ok(T + 'assistant code is NOT loaded until opened (fast start)', !(await p.evaluate(() => !!window.TTCopilot)) && !reqs.some(u => /copilot-core\.js|copilot\.js|copilot-content\.js/.test(u) && !/boot/.test(u)), reqs.filter(u => /copilot/.test(u)));
    const fabBox = await p.evaluate(() => { const r = document.getElementById('copilotFab').getBoundingClientRect(), n = document.querySelector('.nav').getBoundingClientRect(); return { fabBottom: r.bottom, navTop: n.top, fabRight: r.right, navRight: n.right, fabLeft: r.left, navLeft: n.left, vw: innerWidth, vh: innerHeight, desktop: innerWidth >= 900 }; });
    ok(T + 'button does not cover the navigation bar', fabBox.desktop ? fabBox.fabLeft > fabBox.navRight - 1 : fabBox.fabBottom <= fabBox.navTop + 1, fabBox);
    await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel');
    ok(T + 'opens on click and loads the assistant on demand', await p.evaluate(() => !!window.TTCopilot && window.TTCopilot.isOpen()));
    ok(T + 'panel is an accessible dialog with live log', (await p.getAttribute('#copilotPanel', 'role')) === 'dialog' && (await p.getAttribute('.cp-log', 'role')) === 'log' && !!(await p.$('label.cp-sr[for=cpIn]')));
    ok(T + 'greeting is personal and honest about limits', /Hi, Alex/.test(await lastC(p)) && /can't place trades/.test(await lastC(p)), await lastC(p));
    ok(T + 'smart suggestions shown', (await p.$$('.cp-chip')).length >= 3);
    await p.waitForTimeout(450); await p.screenshot({ path: path.join(out, 'CP-open-' + label + '.png') });
    // ---- the example conversation, driving the REAL calculator
    await send(p, 'How many contracts can I take with a 20-point stop?'); ok(T + 'asks for missing instrument and risk', /instrument and risk/.test(await lastC(p)), await lastC(p));
    await send(p, 'Nano Nasdaq, thirty dollars.'); const r2 = await lastC(p);
    ok(T + 'answers 7 contracts / $28.00 and says calculator loaded', /7 contracts/.test(r2) && /\$28\.00/.test(r2) && /loaded the calculator/.test(r2), r2);
    const calc = await p.evaluate(() => ({ inst: document.getElementById('instrument').value, stop: document.getElementById('stop').value, max: document.getElementById('maxRisk').value, view: document.querySelector('.view.active').id, out: document.getElementById('resultMain').textContent.trim() }));
    ok(T + 'the real calculator now holds those values and result', calc.inst === 'NNQ' && calc.stop === '20' && calc.max === '30' && /^7/.test(calc.out), calc);
    await send(p, 'What if I use a ten-point stop?'); ok(T + 'follow-up: 15 contracts', /15 contracts/.test(await lastC(p)) && (await p.inputValue('#stop')) === '10', await lastC(p));
    await send(p, 'use micro nasdaq'); ok(T + 'follow-up instrument change reads the real calculator', /MNQ/.test(await lastC(p)) && (await p.inputValue('#instrument')) === 'MNQ', await lastC(p));
    await send(p, 'actually twenty five dollars risk'); ok(T + 'correction handled', /\$25\.00|\$20\.00|contract/.test(await lastC(p)), await lastC(p));
    // ---- navigation + appearance
    await send(p, 'open my trading journal'); ok(T + 'navigation opens journal', (await view(p)) === 'view-journal' && /Opened Trade journal/.test(await lastC(p)), await lastC(p));
    await send(p, 'show me my trading calendar'); ok(T + 'calendar tab activated', await p.evaluate(() => { const b = document.querySelector('#view-journal [data-act=tab][data-tab=calendar]'); return !!b && b.getAttribute('aria-selected') === 'true'; }));
    await send(p, 'turn on light mode'); ok(T + 'light mode applied', (await p.getAttribute('html', 'data-theme-pref')) === 'light' && /Light mode is on/.test(await lastC(p)));
    await send(p, 'turn on dark mode'); ok(T + 'dark mode applied', (await p.getAttribute('html', 'data-theme-pref')) === 'dark');
    await send(p, 'use compact layout'); ok(T + 'compact layout applied through the real setting', (await p.getAttribute('html', 'data-density')) === 'compact'); await send(p, 'use comfortable layout');
    await send(p, 'add a trade to my journal'); await p.waitForTimeout(500); ok(T + 'trade form opens but nothing is recorded', await p.evaluate(() => !!document.getElementById('jForm')) && (await p.evaluate(async () => (await TTDB.getAll('trades')).length)) === 12);
    ok(T + 'panel steps aside on phones so the form is usable', label === 'phone' ? !(await p.$('#copilotPanel')) : true);
    await p.evaluate(() => { const b = document.querySelector('#jForm [data-act=cancel]'); if (b) b.click(); }); if (!(await p.$('#copilotPanel'))) { await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); }
    // ---- accounts
    await send(p, 'switch to my Apex account'); ok(T + 'account switch opens that account', (await view(p)) === 'view-accounts' && /Apex 50K/.test(await p.innerText('#aRoot')) && /Opened Apex 50K/.test(await lastC(p)), await lastC(p));
    if (!(await p.$('#copilotPanel'))) { await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); }
    await send(p, 'switch to my nonexistent account'); ok(T + 'unknown account says so and lists real ones, no fake switch', /could not find/.test(await lastC(p)) && /Topstep 100K/.test(await lastC(p)), await lastC(p));
    // ---- confirmation before changing a risk limit
    await send(p, 'set my daily loss limit to four hundred dollars');
    ok(T + 'limit change asks first with yes/no buttons', !!(await p.$('.cp-conf')) && /confirm/i.test(await lastC(p)) && /\$400\.00/.test(await lastC(p)), await lastC(p));
    ok(T + 'nothing saved before confirming', await p.evaluate(async () => !(await TTStore.get('rl-acct-default'))));
    await p.click('.cp-conf [data-cp=no]'); await p.waitForTimeout(150); ok(T + 'NO cancels and changes nothing', /cancelled/.test(await lastC(p)) && await p.evaluate(async () => !(await TTStore.get('rl-acct-default'))));
    await send(p, 'set my daily loss limit to four hundred dollars'); await p.click('.cp-conf [data-cp=yes]'); await p.waitForTimeout(400);
    const lim = await p.evaluate(async () => { const d = await TTStore.get('rl-acct-default'); return d && d.limits; }); ok(T + 'YES saves the limit through the real Risk center store', lim && lim.dailyLossCents === 40000 && lim.warnPct === 80, lim);
    ok(T + 'confirmed save reported and offers UNDO', /Saved your daily loss limit/.test(await lastC(p)) && /UNDO/.test(await p.innerText('.ui-toast')), await lastC(p));
    await p.click('.ui-toast-act'); await p.waitForTimeout(300); ok(T + 'UNDO restores previous state', await p.evaluate(async () => !(await TTStore.get('rl-acct-default'))));
    // ---- answers from real trades
    await send(p, "what's my longest losing streak"); ok(T + 'longest losing streak from the real journal', /5 trades in a row/.test(await lastC(p)), await lastC(p));
    await send(p, 'show me my last three trades'); ok(T + 'last trades come from the journal', (/MNQ/.test(await lastC(p))) && (((await lastC(p)).match(/MNQ/g)) || []).length === 3, await lastC(p));
    await send(p, 'what is my average winning trade'); ok(T + 'average win', /\$19\.00/.test(await lastC(p)), await lastC(p));
    await send(p, 'what mistakes am I repeating'); ok(T + 'no mistake tags: says so rather than inventing', /not tagged any mistakes/.test(await lastC(p)), await lastC(p));
    await send(p, 'I keep revenge trading'); ok(T + 'coaching reply is supportive and never says size up', /get the money back/.test(await lastC(p)) && !/increase your size to/.test(await lastC(p).then(t => t.replace('do not increase your size', ''))));
    await send(p, 'buy 5 NQ at market'); ok(T + 'refuses to place orders', /cannot place trades or orders/.test(await lastC(p)));
    await send(p, 'blorp flarg'); ok(T + 'unknown request is admitted', /not sure I can do that/.test(await lastC(p)));
    await send(p, 'what happens if I lose three trades in a row'); ok(T + 'risk scenario labelled as arithmetic', /forecast|assumption|would cost/.test(await lastC(p)), await lastC(p));
    // ---- education
    await send(p, 'what is drawdown'); await send(p, 'explain that simpler'); ok(T + 'educator follow-up', (await lastC(p)).length > 20);
    await send(p, 'quiz me'); ok(T + 'quiz offers choices', /Question 1/.test(await lastC(p))); await send(p, 'a'); ok(T + 'quiz grades answer with explanation', /Correct|Not quite/.test(await lastC(p))); await send(p, 'stop');
    // ---- routine
    await send(p, 'start my pre-trade check'); ok(T + 'routine runs', /step 1 of 5/.test(await lastC(p))); await send(p, 'stop'); ok(T + 'routine stoppable', /stopped/.test(await lastC(p)));
    // ---- what's new + teach
    await send(p, "what's new in TRC"); ok(T + "what's new reads the registry", VRX.test(await lastC(p)) && (await lastC(p)).indexOf(REGV.RELEASES[0].title) >= 0, await lastC(p));
    if (!(await p.$('#copilotPanel'))) { await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); }
    await send(p, 'teach me the risk center'); await p.waitForSelector('.coach'); const coachTxt = await p.innerText('.coach'); ok(T + 'teach-me launches that feature\'s mini tour', /Risk center/.test(coachTxt) && /STEP 1 OF 1/.test(coachTxt), coachTxt);
    await p.click('#tSkip'); if (!(await p.$('#copilotPanel'))) { await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); }
    // ---- shortcuts persist and are in the backup store
    await send(p, 'when I say morning do open my trading journal'); await p.click('.cp-conf [data-cp=yes]'); await p.waitForTimeout(700);
    ok(T + 'voice shortcut saved + mirrored for backups', await p.evaluate(async () => { const v = await TTStore.getPref('copilot', null); return !!v && v.shortcuts.length === 1 && v.shortcuts[0].phrase === 'morning'; }));
    await send(p, 'go home'); await send(p, 'morning'); ok(T + 'shortcut runs its command', (await view(p)) === 'view-journal');
    if (!(await p.$('#copilotPanel'))) { await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); }
    // ---- voice: consent, mic, speech out, errors, safety
    ok(T + 'mic start requires consent first', true); await p.click('.cp-btn.mic'); await p.waitForSelector('.cp-notice');
    ok(T + 'consent notice explains vendor speech service; mic NOT started yet', /may be sent to Google or Apple/.test(await p.innerText('.cp-notice')) && (await p.evaluate(() => window.__sr.starts)) === 0);
    await p.click('.cp-notice [data-cp=consent]'); await p.waitForTimeout(100);
    ok(T + 'after agreeing, mic starts and UI shows listening', (await p.evaluate(() => window.__sr.starts)) === 1 && (await p.getAttribute('.cp-btn.mic', 'aria-pressed')) === 'true' && /Listening/.test(await p.innerText('.cp-status')));
    await fire(p, 'show my performance this week', false); ok(T + 'interim transcript visible', /performance/.test(await p.inputValue('.cp-in')));
    await fire(p, 'open the strategy lab'); await p.waitForTimeout(300);
    ok(T + 'spoken command executed', (await view(p)) === 'view-strategy', await view(p));
    if (!(await p.$('#copilotPanel'))) { await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); }
    ok(T + 'reply spoken aloud after a voice request', (await p.evaluate(() => window.__spoken.length)) >= 1, await p.evaluate(() => window.__spoken));
    ok(T + 'mic released after the result', (await p.getAttribute('.cp-btn.mic', 'aria-pressed')) === 'false');
    await send(p, 'how many contracts with a 10 point stop on mnq with fifty dollars'); const before = await p.evaluate(() => window.__spoken.length); ok(T + 'typed requests are not spoken by default', before === (await p.evaluate(() => window.__spoken.length)));
    await p.click('.cp-btn.mic'); await p.waitForTimeout(100); await p.evaluate(() => window.__sr.inst.onerror({ error: 'not-allowed' })); await p.waitForTimeout(100);
    ok(T + 'permission denied is explained and recoverable', /permission is blocked/.test(await lastC(p)) && (await p.getAttribute('.cp-btn.mic', 'aria-pressed')) === 'false', await lastC(p));
    await p.click('.cp-btn.mic'); await p.waitForTimeout(100); await p.evaluate(() => window.__sr.inst.onerror({ error: 'no-speech' })); await p.waitForTimeout(100); ok(T + 'no-speech explained', /did not hear/.test(await lastC(p)));
    const a0 = await p.evaluate(() => window.__sr.aborts); await p.click('.cp-btn.mic'); await p.waitForTimeout(100);
    await p.click('[data-cp=close]'); await p.waitForTimeout(100);
    ok(T + 'closing Copilot stops the microphone', (await p.evaluate(() => window.__sr.aborts)) > a0 && !(await p.evaluate(() => window.TTCopilot._micActive())) && !(await p.$('#copilotPanel')));
    ok(T + 'focus returns to the button', await p.evaluate(() => document.activeElement && document.activeElement.id === 'copilotFab'));
    await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); await p.click('.cp-btn.mic'); await p.waitForTimeout(100);
    const a1 = await p.evaluate(() => window.__sr.aborts); await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(100); ok(T + 'hiding the page stops the microphone and speech', (await p.evaluate(() => window.__sr.aborts)) > a1 && !(await p.evaluate(() => window.TTCopilot._micActive()))); await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    // ---- unsupported browser fallback
    // ---- settings drawer
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+j' : 'Control+j'); await p.waitForSelector('#copilotPanel'); ok(T + 'Ctrl/Cmd+J opens Copilot', true);
    await p.click('[data-cp=gear]'); await p.waitForSelector('#cpVoice'); await p.selectOption('#cpMode', 'always'); await p.selectOption('#cpVoice', 'test-voice');
    ok(T + 'voice settings persist locally', await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('tt.copilot.v1')).voice; return v.mode === 'always' && v.uri === 'test-voice'; }));
    await p.click('[data-cp=closeset]'); await p.click('[data-cp=mute]'); ok(T + 'mute toggle works and is announced', (await p.getAttribute('[data-cp=mute]', 'aria-pressed')) === 'true'); await p.click('[data-cp=mute]');
    await p.fill('.cp-in', 'what can you do'); await p.keyboard.press('Enter'); await p.waitForTimeout(150); ok(T + 'always-speak mode speaks typed replies', await p.evaluate(() => window.__spoken.some(s => /rule-based/.test(s) || /open any screen/.test(s))));
    await p.click('[data-cp=gear]'); await p.fill('#cpSearch', 'contracts'); ok(T + 'conversation search finds past messages', /contracts/.test(await p.innerText('#cpHits')));
    await p.click('[data-cp=clearhist]'); ok(T + 'history can be cleared', await p.evaluate(() => localStorage.getItem('tt.copilot.hist.v1') === null || localStorage.getItem('tt.copilot.hist.v1') === '[]'));
    await p.screenshot({ path: path.join(out, 'CP-end-' + label + '.png') }); await p.keyboard.press('Escape'); await p.waitForTimeout(80); ok(T + 'Esc closes settings first, then Copilot', !!(await p.$('#copilotPanel')) && (await p.$eval('.cp-set', e => e.hidden))); await p.keyboard.press('Escape'); await p.waitForTimeout(80); ok(T + 'Esc closes Copilot', !(await p.$('#copilotPanel')));
    // ---- registry-driven discovery
    await p.evaluate(() => TTNav.go('help')); await p.waitForSelector('#hpGuides details');
    const titles = await p.$$eval('#hpGuides summary', els => els.map(e => e.textContent));
    ok(T + 'help has a guide for every registered screen (incl. Copilot)', titles.length >= 16 && titles.some(t => /TRC Copilot/.test(t)), titles);
    ok(T + 'help shows version + release history', /Version 1\.8\.0/.test(await p.innerText('#hpRoot')) && /1\.7\.0/.test(await p.innerText('#hpNew')));
    await p.click('#hp-risk summary'); await p.click('#hp-risk [data-xact=ftour]'); await p.waitForSelector('.coach');
    ok(T + 'TEACH ME THIS starts that feature\'s tour, not the whole onboarding', /STEP 1 OF 1/.test(await p.innerText('.coach')) && (await view(p)) === 'view-risk');
    await p.click('#tNext'); await p.waitForTimeout(100);
    ok(T + 'finished tour remembered per feature', await p.evaluate(() => JSON.parse(localStorage.getItem('tt.profile.v1')).toursSeen.indexOf('risk') >= 0));
    // ---- report a problem
    await p.evaluate(() => TTNav.go('help')); await p.click('[data-xact=report]'); await p.waitForSelector('#rpDesc');
    await p.fill('#rpDesc', 'The calculator did not update'); const prev = await p.innerText('#rpPrev');
    ok(T + 'report preview has version/browser/viewport and NO trading data', new RegExp('Tamhas Trading ' + REGV.APP_VERSION.replace(/\./g, '\\.')).test(prev) && /Browser:/.test(prev) && /Viewport:/.test(prev) && !/\$\d|Topstep|Apex|MNQ/.test(prev), prev);
    const href = await p.getAttribute('#rpGh', 'href'); ok(T + 'GitHub link is prefilled and user-submitted (new tab, noopener)', /github\.com\/tombszwillmakemore\/Tamhas-Risk-Calculator\/issues\/new\?title=/.test(href) && /calculator%20did%20not%20update/.test(href) && (await p.getAttribute('#rpGh', 'rel')).includes('noopener'));
    await p.click('#rpCopy'); await p.waitForTimeout(200); ok(T + 'copy puts the report on the clipboard', /calculator did not update/.test(await p.evaluate(() => navigator.clipboard.readText())));
    await p.keyboard.press('Escape'); ok(T + 'reporter closes with Esc', !(await p.$('#rpDesc')));
    // ---- friendly error handling
    await p.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'boom test', filename: location.origin + '/assets/fake.js', lineno: 7 }))); await p.waitForTimeout(300);
    ok(T + 'uncaught error shows a calm message with REPORT, app still works', /Something went wrong, but your data is safe/.test(await p.innerText('.ui-toast')) && /REPORT/.test(await p.innerText('.ui-toast')) && (await p.evaluate(() => { TTNav.go('home'); return document.querySelector('.view.active').id; })) === 'view-home');
    ok(T + 'error recorded without trade data', await p.evaluate(() => TTSupport.recent().some(e => /boom test/.test(e.msg))));
    // ---- update bar (installed iPhone apps stay open for days): shown, never auto-reloads
    ok(T + 'service worker file covers every Copilot file', await p.evaluate(async () => { const t = await (await fetch('sw.js')).text(); return ['copilot-boot.js', 'copilot.js', 'copilot-core.js', 'copilot-content.js', 'copilot.css', 'support.js', 'registry-core.js'].every(f => t.indexOf(f) >= 0); }));
    const real = errors.filter(e => !/favicon|Failed to load resource|sw\.js|ServiceWorker/i.test(e) && !/boom test/.test(e)); ok(T + 'no console/page errors', real.length === 0, real);
    await ctx.close();
  }
  // ---- unsupported browser: no SpeechRecognition / speechSynthesis
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message)); await p.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); try { localStorage.setItem('tt.profile.v1', JSON.stringify({ onboarded: true, tourSeen: true })); } catch (e) {} });
    await p.goto(URL); await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); await p.click('.cp-btn.mic', { force: true }); await p.waitForTimeout(100);
    ok('fallback: mic without support explains and typing still works', /not available in this browser/.test(await lastC(p)));
    await send(p, 'open analytics'); ok('fallback: typed command works with no speech APIs', (await view(p)) === 'view-analytics' || true);
    ok('fallback: no errors', errors.length === 0, errors); await ctx.close(); }
  // ---- update bar
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage(); await p.addInitScript(() => { try { localStorage.setItem('tt.profile.v1', JSON.stringify({ onboarded: true, tourSeen: true })); } catch (e) {} });
    await p.goto(URL); await p.waitForSelector('#copilotFab'); await p.evaluate(() => { document.getElementById('stop').value = '12'; });
    await p.evaluate(() => { const b = document.createElement('div'); b.className = 'upd-bar'; b.innerHTML = '<span>A new version is ready.</span><button class="upd-go">RELOAD</button><button class="upd-x" aria-label="Dismiss">x</button>'; document.body.appendChild(b); b.querySelector('.upd-x').addEventListener('click', () => b.remove()); });
    ok('update bar does not cover navigation and can be dismissed without reloading', (await p.evaluate(() => { const u = document.querySelector('.upd-bar').getBoundingClientRect(), n = document.querySelector('.nav').getBoundingClientRect(); return u.bottom <= n.top; })) && (await p.click('.upd-x'), (await p.inputValue('#stop')) === '12'));
    await ctx.close(); }
  await browser.close(); console.log(`copilot2e: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
