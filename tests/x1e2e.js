// Completeness features in a real browser: TRC install naming, startup screen, animation settings, search, voice grammar,
// help centre, tour, feedback, diagnostics, update safety, offline start, backup reminder, keyboard and reduced motion.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const BASE = process.env.TT_BASE || 'http://127.0.0.1:8765', URL = BASE + '/index.html';
let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } };
const until = async (pg, fn, arg, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
(async () => {
  const browser = await chromium.launch();
  // ---- naming (TRC on the Home Screen, Tamhas Trading on the site)
  {
    const p = await browser.newPage(); await p.goto(URL);
    const man = await (await p.request.get(BASE + '/manifest.webmanifest')).json();
    ok('manifest name and short_name are TRC', man.name === 'TRC' && man.short_name === 'TRC', man);
    ok('icons preserved in manifest', man.icons.length === 3 && man.icons.some(i => i.purpose === 'maskable'));
    ok('apple home-screen title is TRC', await p.evaluate(() => document.querySelector('meta[name=apple-mobile-web-app-title]').content === 'TRC'));
    ok('website title stays Tamhas Trading', /Tamhas Trading/.test(await p.title())); ok('brand in header stays TAMHAS TRADING', /TAMHAS/.test(await p.innerText('.brand')));
    await p.close();
  }
  for (const [theme, width] of [['dark', 390], ['light', 1280]]) {
    const T = theme + '@' + width + ': ';
    const ctx = await browser.newContext({ viewport: { width, height: 860 } }); const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
    if (theme === 'light') await ctx.addInitScript(() => localStorage.setItem('tt.theme', 'light'));
    const t0 = Date.now(); await p.goto(URL);
    // startup screen: gone as soon as the app is ready, never an artificial wait
    await until(p, () => !document.getElementById('splash'), null, 6000); const gone = Date.now() - t0;
    ok(T + 'startup screen removed once ready (' + gone + ' ms, no forced delay)', gone < 3000, gone);
    ok(T + 'startup screen follows theme', await p.evaluate(t => document.documentElement.getAttribute('data-theme') === t, theme));
    ok(T + 'no false "new version" banner on first visit', !(await p.$('#updBanner')));
    await p.evaluate(() => TTDB.ready());
    // install guide
    await p.evaluate(() => TTNav.go('install')); await p.waitForSelector('#installRoot [data-inst]');
    let t = await p.innerText('#installRoot');
    ok(T + 'install guide: TRC name and icon preview', /TRC/.test(t) && await p.isVisible('#installRoot img[alt="TRC app icon"]'));
    for (const k of ['ios', 'android', 'samsung']) { await p.click('[data-inst=' + k + ']'); const s = await p.innerText('#installRoot'); ok(T + 'install tab ' + k + ' tells to name it TRC', /name|Name/.test(s) && /TRC/.test(s) && /(Add to Home Screen|Install app|Add page to)/.test(s)); }
    ok(T + 'install guide explains who controls the label', /final label/.test(t) && /could not be tested on real phones/.test(t));
    // onboarding: install is the first, optional step
    await p.evaluate(() => TTNav.go('home')); await p.waitForSelector('#homeStart .panel');
    t = await p.innerText('#homeStart'); ok(T + 'onboarding: install first (optional), import second', t.indexOf('Home Screen') >= 0 && t.indexOf('Home Screen') < t.indexOf('Import your trades'), t);
    // search: keyboard
    await p.keyboard.press('/'); await p.waitForSelector('#srchQ'); ok(T + '/ opens search with focus', await p.evaluate(() => document.activeElement.id === 'srchQ'));
    await p.fill('#srchQ', 'commission'); await p.waitForTimeout(50); ok(T + 'search finds import settings', /commissions/i.test(await p.innerText('#srchList')));
    await p.keyboard.press('Enter'); await until(p, () => location.hash === '#import' && document.getElementById('im-settings') && document.getElementById('im-settings').open); ok(T + 'Enter opens the result (import settings opened)', await p.evaluate(() => location.hash === '#import' && document.getElementById('im-settings').open));
    await p.keyboard.press('Control+k'); await p.waitForSelector('#srchQ'); await p.keyboard.press('Escape'); ok(T + 'Ctrl+K opens, Esc closes', !(await p.$('.srch-back')));
    await p.click('#searchBtn'); await p.fill('#srchQ', 'drawdown'); await p.waitForTimeout(50); ok(T + 'search also finds education', /What is drawdown/.test(await p.innerText('#srchList'))); await p.click('#srchClose');
    // voice (the command grammar the microphone feeds; microphones are not available in automated browsers)
    await p.evaluate(() => TTVoice.act('open journal')); await until(p, () => location.hash === '#journal', null, 3000); ok(T + 'voice: "open journal" navigates', await p.evaluate(() => location.hash === '#journal'));
    await p.evaluate(() => TTVoice.act('risk MNQ stop 20 points risk 100 to 200')); await until(p, () => location.hash === '#calc');
    await p.waitForTimeout(200); const calc = await p.evaluate(() => ({ i: document.getElementById('instrument').value, s: document.getElementById('stop').value, a: document.getElementById('minRisk').value, b: document.getElementById('maxRisk').value }));
    ok(T + 'voice: fills the risk calculator', calc.i === 'MNQ' && calc.s === '20' && calc.a === '100' && calc.b === '200', calc);
    await p.evaluate(() => TTNav.go('settings')); await p.waitForSelector('#voiceSettings h2');
    ok(T + 'voice settings: off by default, privacy notice shown', /Google or Apple/.test(await p.innerText('#voiceSettings')) && await p.evaluate(() => !localStorage.getItem('tt.voice')));
    // animation preferences
    await p.click('[data-anim-set=reduced]'); ok(T + 'reduced animations applied and saved', await p.evaluate(() => document.documentElement.getAttribute('data-anim') === 'reduced' && localStorage.getItem('tt.anim') === 'reduced'));
    await p.click('[data-anim-set=off]'); await p.reload(); ok(T + 'startup screen off: hidden immediately', await p.evaluate(() => { const s = document.getElementById('splash'); return !s || getComputedStyle(s).display === 'none'; }));
    await p.click('[data-anim-set=standard]').catch(() => {}); await p.evaluate(() => { localStorage.setItem('tt.anim', 'standard'); });
    // help centre + tour
    await p.evaluate(() => TTNav.go('help')); await p.waitForSelector('#helpRoot [data-hgo]');
    t = await p.innerText('#helpRoot'); ok(T + 'help covers import, install, backup, psychology', /Import trades/.test(t) && /Install TRC/.test(t) && /Backup/.test(t) && /Revenge trading/.test(t));
    ok(T + 'help lists limits honestly', /Limits:/.test(t)); await p.click('[data-hgo=backup]'); await until(p, () => location.hash === '#journal'); ok(T + 'help OPEN goes to the feature', await p.evaluate(() => location.hash === '#journal'));
    await p.evaluate(() => TTNav.go('help')); await p.click('[data-hact=tour]'); await p.waitForSelector('.tour-pop'); ok(T + 'tour starts on Import Trades', /Import trades/.test(await p.innerText('.tour-pop')) && !!(await p.$('.tour-hl')));
    for (let i = 0; i < 8 && await p.$('#tourNext'); i++) await p.click('#tourNext'); ok(T + 'tour finishes and cleans up', !(await p.$('.tour-pop')) && !(await p.$('.tour-hl')));
    // feedback: nothing personal, prefilled issue link
    await p.evaluate(async () => { await TTDB.put('trades', { id: 'secret1', date: '2026-10-21', contract: 'MNQ', side: 'long', contracts: 1, entry: 100, exits: [], accountId: 'acct-default', notes: 'MY SECRET NOTE', createdAt: Date.now() }); });
    await p.evaluate(() => TTNav.go('feedback')); await p.waitForSelector('#fbTitle'); await p.click('[data-fb=preview]'); ok(T + 'feedback validation message', /short summary/.test(await p.innerText('#fbOut')));
    await p.fill('#fbTitle', 'Import button'); await p.fill('#fbBody', 'It did something unexpected on my phone'); await p.click('[data-fb=preview]'); await p.waitForSelector('#fbText');
    const fb = await p.inputValue('#fbText'); ok(T + 'feedback has app details but no trade data', /Version: 2\./.test(fb) && /1 trades/.test(fb) && !/SECRET/.test(fb) && !/acct-default/.test(fb), fb);
    ok(T + 'GitHub issue link prefilled', /issues\/new\?title=%5BBug%5D%20Import%20button&body=/.test(await p.getAttribute('#fbGh', 'href')));
    // diagnostics
    await p.evaluate(() => TTNav.go('health')); await p.waitForSelector('#diagRoot h2');
    t = await p.innerText('#diagRoot'); ok(T + 'diagnostics: version, offline support, last backup, storage note, repair', /App version\s*2\./.test(t) && /Offline support/.test(t) && /Last backup/.test(t) && /does not sync/.test(t) && /REPAIR APP FILES/i.test(t), t);
    // backup reminder (we added a trade and never backed up)
    await p.evaluate(() => TTNav.go('home')); await p.waitForSelector('#backupNag'); ok(T + 'backup reminder shows when trades exist and no backup', /not downloaded a backup/.test(await p.innerText('#backupNag')));
    await p.click('#backupNag [data-hact=backup-snooze]'); ok(T + 'backup reminder can be snoozed', !(await p.$('#backupNag')));
    ok(T + 'no horizontal scroll (help/install/feedback)', await p.evaluate(async () => { for (const v of ['help', 'install', 'feedback', 'settings']) { TTNav.go(v); await new Promise(r => setTimeout(r, 60)); if (document.documentElement.scrollWidth > innerWidth + 1) return v; } return true; }) === true);
    ok(T + 'every visible button has a name', await p.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent).every(b => (b.innerText || b.getAttribute('aria-label') || '').trim())));
    await p.screenshot({ path: path.join(OUT, 'shots', 'x1-' + theme + '-' + width + '.png') });
    ok(T + 'no page errors', !errors.length, errors);
    await ctx.close();
  }
  // ---- slow start: database never answers -> startup screen still goes away, no infinite loader
  {
    const ctx = await browser.newContext(); await ctx.addInitScript(() => { const o = indexedDB.open.bind(indexedDB); indexedDB.open = function () { return { set onsuccess(f) {}, set onerror(f) {}, set onupgradeneeded(f) {}, set onblocked(f) {}, addEventListener() {} }; }; });
    const p = await ctx.newPage(); await p.goto(URL); const gone = await until(p, () => !document.getElementById('splash'), null, 7000);
    ok('stuck database: startup screen still removed (failsafe)', gone); await ctx.close();
  }
  // ---- reduced motion from the operating system
  {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' }); const p = await ctx.newPage(); await p.goto(URL); await p.evaluate(() => TTDB.ready());
    ok('OS reduced motion: no long animations', await p.evaluate(() => { const v = document.querySelector('.view.active'); const d = parseFloat(getComputedStyle(v).animationDuration) || 0; return d <= 0.01; }));
    await ctx.close();
  }
  // ---- offline start after first visit (service worker) and update safety
  {
    const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(URL);
    await until(p, async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }, null, 10000);
    await p.reload(); await until(p, () => !!navigator.serviceWorker.controller, null, 5000);
    const ver = await p.evaluate(() => new Promise(res => { navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'version') res(e.data); }); navigator.serviceWorker.controller.postMessage({ type: 'version' }); setTimeout(() => res(null), 3000); }));
    ok('service worker reports the app version and versioned cache', ver && ver.version === (await p.evaluate(() => TT_VERSION)) && ver.cache === 'tt-app-' + ver.version, ver);
    ok('new modules are precached', await p.evaluate(async () => { const c = await caches.open('tt-app-' + TT_VERSION); return !!(await c.match('assets/tradovate-core.js')) && !!(await c.match('assets/help.js')) && !!(await c.match('assets/version.js')); }));
    await ctx.setOffline(true); await p.reload(); await p.evaluate(() => TTDB.ready());
    ok('offline: app starts from cache', await p.evaluate(() => typeof TTTradovate === 'object' && typeof TTHelp === 'object'));
    ok('offline: connection chip says offline', /OFFLINE/.test(await p.innerText('#netChip')));
    await p.evaluate(() => TTNav.go('import')); await p.waitForSelector('#im-drop'); ok('offline: import screen works', true);
    await ctx.setOffline(false);
    // simulate an older version having been used: the update toast appears once and data stays
    await p.evaluate(() => localStorage.setItem('tt.version', '1.0.0')); await p.reload(); await until(p, () => /Updated to version/.test(document.body.innerText), null, 4000);
    ok('after an update the user is told and data is kept', /Updated to version/.test(await p.innerText('body')));
    ok('version is recorded after update', await p.evaluate(() => localStorage.getItem('tt.version') === TT_VERSION));
    await ctx.close();
  }
  await browser.close();
  console.log((fail ? 'FAILED ' + fail + ' / passed ' + pass : 'ALL PASSED ' + pass)); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
