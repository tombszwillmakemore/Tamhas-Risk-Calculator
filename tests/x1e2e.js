const REGV = require(require('path').join(__dirname, '..', 'assets', 'registry-core.js')); const VRX = new RegExp(REGV.APP_VERSION.replace(/\./g, '\\.'));
/* Experience layer: welcome, tour, search, personal dashboard, favorites, settings, help, shortcuts. Uses the real playwright
   module (no pre-seeded profile) so the first-run flow is genuinely first-run. */
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'); const out = path.join(__dirname, 'out', 'shots'); fs.mkdirSync(out, { recursive: true });
const URL = ((process.env.TT_BASE || 'http://127.0.0.1:8765') + '/index.html'); let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const until = async (pg, fn, arg, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
const seed = async (p, list) => { await p.evaluate(async (list) => { const C = TTJournalCore; const d = new Date(); const t0 = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); await TTDB.clear('trades'); await TTStore.invalidate(); for (const o of list) { const r = C.normalizeTrade(Object.assign({ contract: 'NQ', side: 'long', contracts: 1, entry: 100, stop: 95, fees: '0', createdAt: 1, date: t0 }, o)); if (!r.ok) throw new Error(JSON.stringify(r.errors)); await TTDB.put('trades', r.trade); } }, list); };
const prof = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tt.profile.v1') || 'null'));
const view = (p) => p.evaluate(() => (document.querySelector('.view.active') || {}).id);
(async () => {
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) {
    const T = theme + ': '; const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
    await p.addInitScript((th) => { try { if (th === 'light' && !localStorage.getItem('tt.theme')) localStorage.setItem('tt.theme', 'light'); } catch (e) {} }, theme);
    await p.goto(URL); await p.waitForSelector('.xo .xcard');
    // ---- welcome
    ok(T + 'first visit shows welcome dialog', (await p.getAttribute('.xcard', 'role')) === 'dialog' && /Tamhas Trading/.test(await p.innerText('.xcard')) && /No account needed/.test(await p.innerText('.xcard')));
    ok(T + 'name field focused', await p.evaluate(() => document.activeElement && document.activeElement.id === 'obName'));
    await p.screenshot({ path: path.join(out, 'X-welcome-' + theme + '.png') });
    // focus trap: tab many times, focus never leaves the dialog
    let trapped = true; for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); if (!(await p.evaluate(() => !!document.activeElement.closest('.xcard')))) trapped = false; } ok(T + 'focus stays inside the welcome dialog', trapped);
    await p.fill('#obName', '<i onclick=1>Alex</i>'); await p.keyboard.press('Enter'); await p.waitForSelector('.xlist');
    ok(T + 'intro step explains what it does', /What you can do here/.test(await p.innerText('.xcard')) && /stays on your device|on your device/.test(await p.innerText('.xcard')));
    await p.click('#obNext'); await p.waitForSelector('[data-pick]'); await p.click('[data-pick=risk]'); await p.click('[data-pick=prop]'); ok(T + 'interests toggle with aria-pressed', (await p.getAttribute('[data-pick=risk]', 'aria-pressed')) === 'true');
    await p.click('#obNext'); await p.waitForSelector('#obTour'); ok(T + 'last step offers tour or explore, greets by name', /1-minute tour/.test(await p.innerText('.xcard')) && /ALEX/i.test(await p.innerText('.xcard')));
    await p.click('#obTour'); await p.waitForSelector('.coach');
    let pr = await prof(p); ok(T + 'profile saved locally: sanitized name, interests, onboarded', pr && pr.onboarded === true && !/[<>]/.test(pr.name) && /Alex/.test(pr.name) && pr.interests.join() === 'risk,prop', pr);
    ok(T + 'name stored as plain text', pr.name === 'Alex', pr.name);
    // ---- tour
    ok(T + 'tour step 1 on dashboard', /STEP 1 OF 6/.test(await p.innerText('.coach')) && (await view(p)) === 'view-home');
    await p.click('#tNext'); ok(T + 'tour step 2 opens the calculator and highlights nav', (await view(p)) === 'view-calc' && (await p.evaluate(() => !!document.querySelector('.nav [data-view=calc].tour-ring'))));
    await p.click('#tNext'); await p.click('#tBack'); ok(T + 'tour back works', /STEP 2/.test(await p.innerText('.coach')));
    await p.click('#tSkip'); ok(T + 'skip closes the tour and remembers it', (await p.$('.coach')) === null && (await prof(p)).tourSeen === true);
    await p.evaluate(() => TTNav.go('home')); await p.waitForTimeout(200);
    ok(T + 'dashboard greets by name (first visit wording)', /^Welcome, Alex!$/.test(await p.innerText('#displayName')), await p.innerText('#displayName'));
    await p.reload(); await p.waitForSelector('#homeWidgets'); await p.waitForTimeout(500);
    ok(T + 'no welcome again; "Welcome back, Alex!"', (await p.$('.xo')) === null && /^Welcome back, Alex!$/.test(await p.innerText('#displayName')), await p.innerText('#displayName'));
    // ---- real data only
    let dash = await p.innerText('#homeWidgets'); ok(T + 'empty dashboard invents nothing: no P&L number, empty states', /No closed trades this week yet/.test(dash) && /No trades yet/.test(dash) && !/\$\d/.test(await p.innerText('[data-widget=week]')));
    await seed(p, [{ id: 'a', exits: [{ qty: 1, price: 110 }] }, { id: 'b', exits: [{ qty: 1, price: 95 }] }, { id: 'c' }]); await p.evaluate(() => { TTNav.go('journal'); TTNav.go('home'); }); await p.waitForTimeout(400);
    dash = await p.innerText('[data-widget=week]'); ok(T + 'week widget shows real figures (2 closed, $0.00 net of +$200 and -$100? gross +$100)', /CLOSED\s*2/i.test(dash) && /\+\$100\.00/.test(dash) && /50%/.test(dash), dash);
    ok(T + 'recent trades lists 3 incl. open', (await p.$$eval('[data-widget=recentTrades] li', l => l.length)) === 3 && /Open/.test(await p.innerText('[data-widget=recentTrades]')));
    ok(T + 'today widget counts 3 trades', /TRADES\s*3/i.test(await p.innerText('[data-widget=today]')));
    // focus note
    await p.fill('#focusIn', 'Only A setups'); await p.dispatchEvent('#focusIn', 'change'); pr = await prof(p); ok(T + "today's focus saved with today's date", pr.goalNote === 'Only A setups' && /^\d{4}-\d\d-\d\d$/.test(pr.goalDate));
    // quick risk
    await p.selectOption('#qrInst', 'NQ'); await p.fill('#qrStop', '10'); await p.fill('#qrRisk', '500'); let qr = await p.innerText('#qrOut'); ok(T + 'quick risk: NQ 10pt, $500 -> 2 contracts, $400', /2 contracts/.test(qr) && /\$400\.00/.test(qr) && /\$200\.00 per contract/.test(qr), qr);
    await p.fill('#qrRisk', '100'); ok(T + 'quick risk explains when nothing fits', /No contracts fit/.test(await p.innerText('#qrOut'))); await p.fill('#qrRisk', '500'); await p.fill('#qrStop', 'abc'); ok(T + 'quick risk bad input message', /plain numbers/.test(await p.innerText('#qrOut'))); await p.fill('#qrStop', '10');
    await p.click('[data-copy]'); ok(T + 'copy result puts text on the clipboard', (await p.evaluate(() => navigator.clipboard.readText())) === '2 NQ · stop 10 pts · risk $400.00', await p.evaluate(() => navigator.clipboard.readText()));
    pr = await prof(p); ok(T + 'quick risk remembers last settings', pr.recentCalc && pr.recentCalc.inst === 'NQ' && pr.recentCalc.stop === '10' && pr.recentCalc.risk === '500');
    await p.screenshot({ path: path.join(out, 'X-home-' + theme + '.png'), fullPage: true });
    // ---- search
    await p.keyboard.press('Control+k'); await p.waitForSelector('.xs'); ok(T + 'Ctrl+K opens search with suggestions', (await p.$$('.xs li')).length >= 5 && (await p.getAttribute('#xsIn', 'role')) === 'combobox' && await p.evaluate(() => document.activeElement.id === 'xsIn'));
    await p.keyboard.type('risk'); ok(T + 'search "risk" ranks calculator or risk center first', /Risk (calculator|center)/.test(await p.innerText('.xs li[aria-selected=true]')));
    await p.keyboard.press('ArrowDown'); const sel2 = await p.innerText('.xs li[aria-selected=true]'); ok(T + 'arrow moves selection', /Risk (calculator|center)/.test(sel2));
    await p.keyboard.press('Enter'); await p.waitForTimeout(150); ok(T + 'Enter opens it and closes search', ['view-calc', 'view-risk'].includes(await view(p)) && (await p.$('.xs')) === null);
    await p.keyboard.press('Control+k'); await p.keyboard.type('change name'); await p.keyboard.press('Enter'); await p.waitForTimeout(300); ok(T + '"change name" goes to Settings and focuses the name box', (await view(p)) === 'view-settings' && await p.evaluate(() => document.activeElement.id === 'nameInput'));
    await p.keyboard.press('Control+k'); await p.keyboard.type('qqqzzz'); ok(T + 'no match explains instead of blank', /Nothing matches/.test(await p.innerText('.xs')));
    await p.keyboard.press('Escape'); ok(T + 'Esc closes search', (await p.$('.xs')) === null);
    await p.evaluate(() => { TTNav.go('home'); document.activeElement.blur(); }); await p.keyboard.press('/'); await p.waitForSelector('.xs'); await p.keyboard.press('Escape'); ok(T + '"/" opens search when not typing', true);
    await p.click('#searchBtn'); await p.waitForSelector('.xs'); await p.keyboard.type('backtest'); await p.keyboard.press('Enter'); await p.waitForTimeout(200); ok(T + 'search button + "backtest" -> Strategy lab', (await view(p)) === 'view-strategy');
    await p.keyboard.press('Control+k'); await p.keyboard.type('new trade'); await p.keyboard.press('Enter'); await p.waitForTimeout(500); await p.waitForSelector('#view-journal #f-entry, #view-journal [id^=f-]', { timeout: 4000 }).catch(() => {}); ok(T + '"new trade" action opens the trade form', (await view(p)) === 'view-journal' && (await p.$$('#view-journal [id^=f-]')).length > 3);
    await p.keyboard.press('Escape'); await p.evaluate(() => TTNav.go('home'));
    // ---- hub, favorites, back bar
    await p.evaluate(() => TTNav.go('more')); await p.waitForSelector('.cat-h'); const hub = await p.innerText('#hubRoot'); ok(T + 'More hub grouped with search entry', /Search everything/.test(hub) && /TRADE/i.test(hub) && /REVIEW AND IMPROVE/i.test(hub) && /MONEY/i.test(hub));
    ok(T + 'every tool still reachable from More', await p.evaluate(() => ['analytics', 'risk', 'discipline', 'strategy', 'insights', 'health', 'import', 'money', 'intel', 'settings', 'help'].every(id => document.querySelector('#hubRoot [data-go=' + id + ']'))));
    await p.click('#hubRoot [data-fav=analytics]'); await p.waitForFunction(() => /Pinned Analytics/.test(document.querySelector('.ui-toast').innerText)); ok(T + 'star pins with a toast and UNDO', /UNDO/.test(await p.innerText('.ui-toast')) && (await prof(p)).favorites.join() === 'analytics');
    await p.click('.ui-toast-act'); ok(T + 'UNDO unpins', (await prof(p)).favorites.length === 0); await p.click('#hubRoot [data-fav=analytics]'); await p.click('#hubRoot [data-fav=strategy]');
    await p.evaluate(() => TTNav.go('home')); await p.waitForTimeout(300); ok(T + 'favorites show on dashboard', await p.evaluate(() => ['analytics', 'strategy'].every(id => document.querySelector('[data-widget=favorites] [data-go=' + id + ']'))));
    await p.evaluate(() => TTNav.go('risk')); ok(T + 'every tool screen has Dashboard back link + pin', await p.evaluate(() => !!document.querySelector('#view-risk .backbar [data-go=home]') && !!document.querySelector('#view-risk .starbtn')));
    await p.click('#view-risk .starbtn'); ok(T + 'pin from screen header', (await prof(p)).favorites.includes('risk') && (await p.getAttribute('#view-risk .starbtn', 'aria-pressed')) === 'true'); await p.click('#view-risk .backbar [data-go=home]'); ok(T + 'Back to Dashboard', (await view(p)) === 'view-home');
    // limit of 8
    await p.evaluate(() => { const P = TTExperience.prefs(); }); for (const id of ['journal', 'import', 'insights', 'discipline', 'accounts', 'money']) { await p.evaluate(i => TTNav.go('more'), id); await p.click('#hubRoot [data-fav=' + id + ']'); } await p.evaluate(() => TTNav.go('more')); await p.click('#hubRoot [data-fav=intel]'); ok(T + '9th pin refused with message', (await prof(p)).favorites.length === 8 && /up to 8/.test(await p.innerText('.ui-toast')));
    // recents + continue
    await p.evaluate(() => { TTNav.go('analytics'); TTNav.go('health'); TTNav.go('home'); }); await p.waitForTimeout(300); ok(T + 'recents newest first', (await prof(p)).recents.slice(0, 2).join() === 'health,analytics', (await prof(p)).recents); ok(T + 'continue where you left off -> Health', /System health/.test(await p.innerText('[data-widget=continue]'))); ok(T + 'recently used chips shown', /SYSTEM HEALTH/i.test(await p.innerText('[data-widget=recents]')));
    // ---- customize
    await p.click('#customizeBtn'); await p.waitForSelector('#customPanel:not([hidden])'); ok(T + 'customize lists all sections', (await p.$$('[data-wvis]')).length === 13);
    await p.uncheck('[data-wvis=week]'); await p.click('[data-wmove=favorites][data-d="-1"]'); ok(T + 'hidden section disappears from dashboard', await p.evaluate(() => document.querySelector('[data-widget=week]').hidden === true));
    pr = await prof(p); ok(T + 'layout saved (week hidden, favorites moved up)', pr.widgets.find(w => w.id === 'week').visible === false && pr.widgets.findIndex(w => w.id === 'favorites') < 4, pr.widgets.map(w => w.id + (w.visible ? '' : '-')).join());
    await p.click('[data-xact=reset-layout]'); ok(T + 'reset to default restores', (await prof(p)).widgets.every(w => w.visible)); await p.click('.ui-toast-act'); ok(T + 'UNDO brings my layout back', (await prof(p)).widgets.find(w => w.id === 'week').visible === false);
    await p.click('#customPanel [data-xact=customize]'); ok(T + 'DONE closes panel', await p.evaluate(() => document.getElementById('customPanel').hidden)); await p.reload(); await p.waitForSelector('#homeWidgets'); await p.waitForTimeout(400); ok(T + 'layout survives reload', await p.evaluate(() => document.querySelector('[data-widget=week]').hidden === true));
    // ---- settings
    await p.evaluate(() => TTNav.go('settings')); await p.waitForSelector('#personalizePanel .chip'); ok(T + 'settings has Personalize panel with local-only note', /on this device only/i.test(await p.innerText('#personalizePanel')) && /No account/.test(await p.innerText('#personalizePanel')));
    ok(T + 'name box prefilled', (await p.inputValue('#nameInput')) === (await prof(p)).name); await p.fill('#nameInput', 'Sam'); await p.click('#saveName'); await p.evaluate(() => TTNav.go('home')); ok(T + 'rename updates greeting', /Sam!$/.test(await p.innerText('#displayName')));
    await p.evaluate(() => TTNav.go('settings')); await p.click('[data-dens=compact]'); ok(T + 'compact mode applied + remembered', (await p.getAttribute('html', 'data-density')) === 'compact' && (await prof(p)).density === 'compact'); await p.reload(); ok(T + 'compact survives reload before paint', (await p.getAttribute('html', 'data-density')) === 'compact');
    await p.evaluate(() => TTNav.go('settings')); await p.click('[data-dens=comfortable]'); await p.selectOption('#startSel', 'journal'); await p.goto(URL); await p.waitForTimeout(700); ok(T + 'start page respected', (await view(p)) === 'view-journal', await view(p));
    await p.goto(URL + '#analytics'); await p.waitForTimeout(500); ok(T + 'deep link beats start page', (await view(p)) === 'view-analytics');
    await p.evaluate(() => TTNav.go('settings')); await p.selectOption('#startSel', 'home');
    await p.click('[data-int=news]'); ok(T + 'interests editable in settings', (await prof(p)).interests.includes('news'));
    const beforeReset = await prof(p); await p.click('[data-xact=reset-all]'); await p.click('[data-r=ok]'); await until(p, () => JSON.parse(localStorage.getItem('tt.profile.v1')).name === ''); ok(T + 'reset clears name/favorites but keeps onboarded', (await prof(p)).favorites.length === 0 && (await prof(p)).onboarded === true); await p.click('.ui-toast-act'); await until(p, () => JSON.parse(localStorage.getItem('tt.profile.v1')).name !== ''); ok(T + 'UNDO restores personalization', (await prof(p)).name === beforeReset.name && (await prof(p)).favorites.length === 8);
    ok(T + 'trades untouched by all personalization', (await p.evaluate(() => TTDB.count('trades'))) === 3);
    // mirrored for backup
    await p.waitForTimeout(700); ok(T + 'profile mirrored into the database (backups)', (await p.evaluate(() => TTStore.getPref('profile', null))) && (await p.evaluate(() => TTStore.getPref('profile', null))).name === (await prof(p)).name);
    // ---- help
    await p.evaluate(() => TTNav.go('help')); await p.waitForSelector('.gl details'); ok(T + 'help: glossary, shortcuts, what is new', (await p.$$('.gl details')).length >= 10 && /Ctrl/.test(await p.innerText('#hpKeys')) && /A more personal dashboard/.test(await p.innerText('#hpNew')));
    await p.click('.gl summary >> nth=0'); ok(T + 'glossary entry opens', await p.evaluate(() => document.querySelector('.gl details').open)); await p.screenshot({ path: path.join(out, 'X-help-' + theme + '.png'), fullPage: false });
    await p.waitForTimeout(1800); ok(T + 'opening help marks what\'s new as seen', (await prof(p)).whatsNewSeen === REGV.LATEST);
    // ---- keyboard shortcuts
    await p.evaluate(() => { TTNav.go('home'); document.activeElement.blur(); }); await p.keyboard.press('g'); await p.keyboard.press('j'); ok(T + 'g then j -> journal', (await view(p)) === 'view-journal'); await p.keyboard.press('g'); await p.keyboard.press('h'); ok(T + 'g then h -> dashboard', (await view(p)) === 'view-home'); await p.keyboard.press('?'); ok(T + '? -> help', (await view(p)) === 'view-help');
    await p.evaluate(() => TTNav.go('settings')); await p.focus('#nameInput'); await p.keyboard.type('gj'); ok(T + 'shortcuts ignored while typing', (await view(p)) === 'view-settings');
    // ---- calculator niceties
    await p.evaluate(() => TTNav.go('calc')); await p.fill('#stop', '20'); await p.fill('#minRisk', '30'); await p.fill('#maxRisk', '35'); await p.waitForTimeout(100); await p.click('#calcCopy'); ok(T + 'calculator copy button copies the result', /stop 20 pts/.test(await p.evaluate(() => navigator.clipboard.readText())), await p.evaluate(() => navigator.clipboard.readText()));
    await p.reload(); await p.waitForTimeout(300); await p.evaluate(() => TTNav.go('calc')); ok(T + 'calculator remembers last inputs', (await p.inputValue('#stop')) === '20' && (await p.inputValue('#maxRisk')) === '35');
    await p.click('#calcReset'); ok(T + 'clear inputs', (await p.inputValue('#stop')) === ''); await p.click('.ui-toast-act'); ok(T + 'clear can be undone', (await p.inputValue('#stop')) === '20'); ok(T + 'calculator help hints exist', (await p.$$('#view-calc [data-tip]')).length === 3);
    ok(T + 'no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); ok(T + 'skip link exists and targets main', await p.evaluate(() => document.querySelector('.skip-link').getAttribute('href') === '#main' && !!document.getElementById('main')));
    ok(T + 'no js errors', errors.length === 0, errors); await ctx.close();
  }
  // ---- escape = skip, existing user, desktop
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message)); await p.goto(URL); await p.waitForSelector('.xo .xcard'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok('Esc skips welcome, marks onboarded, no name -> "Welcome!"', (await p.$('.xo')) === null && (await prof(p)).onboarded === true && /^Welcome!$/.test(await p.innerText('#displayName')));
    await p.evaluate(() => TTNav.go('more')); await p.waitForSelector('.cat-h'); await p.screenshot({ path: path.join(out, 'X-more-desktop.png') }); await p.evaluate(() => TTNav.go('home')); await p.waitForTimeout(300); await p.screenshot({ path: path.join(out, 'X-home-desktop.png'), fullPage: true });
    ok('desktop: no overflow', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); ok('desktop: no errors', errors.length === 0, errors); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); await p.goto(URL); await p.evaluate(() => TTDB.ready()); await seed(p, [{ id: 'q', exits: [{ qty: 1, price: 105 }] }]); await p.evaluate(() => localStorage.removeItem('tt.profile.v1')); await p.reload(); await p.waitForTimeout(900);
    ok('existing user with trades: no welcome modal, tour offered by toast', (await p.$('.xo')) === null && /1-minute tour/.test(await p.innerText('.ui-toast')) && (await prof(p)).onboarded === true); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); await p.addInitScript(() => { try { localStorage.setItem('tt.settings.v1', JSON.stringify({ displayName: 'Jordan' })); } catch (e) {} }); await p.goto(URL); await p.waitForTimeout(900);
    ok('existing saved name is kept and used', (await p.$('.xo')) === null && /Jordan/.test(await p.innerText('#displayName'))); await ctx.close(); }
  await browser.close(); console.log(`x1e2e: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
