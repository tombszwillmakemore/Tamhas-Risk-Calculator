// Platform features in a real browser: TRC install naming, startup screen, animation settings, install guide, onboarding step,
// diagnostics + repair, backup reminder, offline start, stuck-database failsafe, reduced motion. (Search, help, tours, Copilot: main's own suites.)
const { chromium } = require('./_pw'); const fs = require('fs'), path = require('path');
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
    ok(T + 'no update bar on first visit', !(await p.$('.upd-bar')));
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
    // animation preferences
    await p.evaluate(() => TTNav.go('settings')); await p.waitForSelector('[data-anim-set=reduced]');
    await p.click('[data-anim-set=reduced]'); ok(T + 'reduced animations applied and saved', await p.evaluate(() => document.documentElement.getAttribute('data-anim') === 'reduced' && localStorage.getItem('tt.anim') === 'reduced'));
    await p.click('[data-anim-set=off]'); await p.reload(); ok(T + 'startup screen off: hidden immediately', await p.evaluate(() => { const s = document.getElementById('splash'); return !s || getComputedStyle(s).display === 'none'; }));
    await p.click('[data-anim-set=standard]').catch(() => {}); await p.evaluate(() => { localStorage.setItem('tt.anim', 'standard'); });
    // a trade exists, never backed up -> reminder later
    await p.evaluate(async () => { await TTDB.put('trades', { id: 'secret1', date: '2026-10-21', contract: 'MNQ', side: 'long', contracts: 1, entry: 100, exits: [], accountId: 'acct-default', createdAt: Date.now() }); });
    // diagnostics
    await p.evaluate(() => TTNav.go('health')); await p.waitForSelector('#diagRoot h2');
    t = await p.innerText('#diagRoot'); ok(T + 'diagnostics: version, offline support, last backup, storage note, repair', /App version\s*2\./.test(t) && /Offline support/.test(t) && /Last backup/.test(t) && /does not sync/.test(t) && /REPAIR APP FILES/i.test(t), t);
    await p.click('#diagRepair'); ok(T + 'repair asks for confirmation first', await p.isVisible('.ui-dlg')); await p.click('.ui-dlg [data-r=cancel]');
    // backup reminder (we added a trade and never backed up)
    await p.evaluate(() => TTNav.go('home')); await p.waitForSelector('#backupNag'); ok(T + 'backup reminder shows when trades exist and no backup', /not downloaded a backup/.test(await p.innerText('#backupNag')));
    await p.click('#nagSnooze'); ok(T + 'backup reminder can be snoozed', !(await p.$('#backupNag')));
    ok(T + 'no horizontal scroll (install/settings/health/import)', await p.evaluate(async () => { for (const v of ['install', 'settings', 'health', 'import']) { TTNav.go(v); await new Promise(r => setTimeout(r, 60)); if (document.documentElement.scrollWidth > innerWidth + 1) return v; } return true; }) === true);
    const unnamed = await p.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent && !(b.textContent || b.getAttribute('aria-label') || b.title || '').trim()).map(b => b.outerHTML.slice(0, 120))); ok(T + 'every visible button has a name', !unnamed.length, unnamed);
    await p.screenshot({ path: path.join(OUT, 'shots', 'x1-' + theme + '-' + width + '.png') });
    ok(T + 'no page errors', !errors.length, errors);
    await ctx.close();
  }
  // ---- welcome: Tradovate import mentioned, installing is an optional step that opens the guide
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await ctx.addInitScript(() => { if (!sessionStorage.getItem('fresh')) { sessionStorage.setItem('fresh', '1'); localStorage.removeItem('tt.profile.v1'); } });
    const p = await ctx.newPage(); await p.goto(URL); await p.waitForSelector('.xcard', { timeout: 8000 });
    for (let i = 0; i < 3 && !(await p.$('#obInstall')); i++) { const n = await p.$('#obNext'); if (!n) break; if (i === 1) ok('welcome intro mentions Tradovate import', /Tradovate/.test(await p.innerText('.xcard'))); await n.click(); }
    ok('welcome final step offers optional install', !!(await p.$('#obInstall'))); await p.click('#obInstall');
    ok('install button opens Install TRC', await until(p, () => location.hash === '#install' && !document.querySelector('.xcard'), null, 4000));
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
    ok('new modules are precached', await p.evaluate(async () => { const ks = await caches.keys(), c = await caches.open(ks.filter(k => k.indexOf('tt-app-') === 0)[0]); return !!(await c.match('assets/tradovate-core.js')) && !!(await c.match('assets/platform.js')) && !!(await c.match('assets/ocr.js')); }));
    await ctx.setOffline(true); await p.reload(); await p.evaluate(() => TTDB.ready());
    ok('offline: app starts from cache', await p.evaluate(() => typeof TTTradovate === 'object' && typeof TTPlatform === 'object'));
    ok('offline: connection chip says offline', /OFFLINE/.test(await p.innerText('#netChip')));
    await p.evaluate(() => TTNav.go('import')); await p.waitForSelector('#im-drop'); ok('offline: import screen works', true);
    await ctx.setOffline(false);
    await ctx.close();
  }
  await browser.close();
  console.log((fail ? 'FAILED ' + fail + ' / passed ' + pass : 'ALL PASSED ' + pass)); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
