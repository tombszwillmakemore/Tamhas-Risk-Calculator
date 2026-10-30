// APP-WIDE INTEGRATION CHECK (real Chromium): every registered screen at phone/tablet/desktop sizes - no console errors, no sideways scrolling,
// every control has an accessible name; every tour step finds its target; every link target is valid; damaged or blocked storage never crashes
// the app; backups carry Copilot + personal settings; Copilot starts lazily, cleans up after itself and respects reduced motion.
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'); const root = path.join(__dirname, '..');
const URL = ((process.env.TT_BASE || 'http://127.0.0.1:8765') + '/index.html'); let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const R = require(path.join(root, 'assets', 'registry-core.js'));
const prime = () => { try { if (!localStorage.getItem('tt.profile.v1')) localStorage.setItem('tt.profile.v1', JSON.stringify({ onboarded: true, tourSeen: true, whatsNewSeen: 99 })); localStorage.setItem('tt.nw.nudged', '99'); } catch (e) {} };
const SIZES = [['phone-small', 360, 740], ['phone', 390, 844], ['tablet', 768, 1024], ['desktop', 1280, 800]];
(async () => {
  const browser = await chromium.launch();
  // ---------- every screen, every size
  for (const [label, w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.addInitScript(prime); await p.goto(URL); await p.waitForSelector('#copilotFab'); await p.waitForTimeout(400);
    const views = await p.evaluate(() => [...document.querySelectorAll('.view')].map(v => v.id.replace('view-', '')));
    for (const v of views) {
      await p.evaluate((v) => TTNav.go(v), v); await p.waitForTimeout(250);
      const r = await p.evaluate(() => {
        const vw = innerWidth, over = document.documentElement.scrollWidth - vw; const bad = [];
        const named = (el) => { const l = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label') || (el.textContent || '').trim() || el.getAttribute('placeholder') || el.getAttribute('alt') || (el.querySelector && el.querySelector('img[alt]:not([alt=""]),svg title')); return !!l; };
        document.querySelectorAll('.view.active button, .view.active input:not([type=hidden]), .view.active select, .view.active textarea, .view.active a[href]').forEach(el => { if (el.offsetParent !== null && !named(el)) bad.push((el.tagName + '#' + el.id + '.' + (el.className || '')).slice(0, 60)); });
        const imgs = [...document.querySelectorAll('.view.active img')].filter(i => !i.hasAttribute('alt')).length;
        return { over, bad, imgs, h1: document.querySelectorAll('.view.active h1').length };
      });
      ok(label + ' ' + v + ': no sideways page scroll', r.over <= 1, r.over);
      ok(label + ' ' + v + ': every control has an accessible name', r.bad.length === 0, r.bad.slice(0, 5)); ok(label + ' ' + v + ': images have alt text', r.imgs === 0);
    }
    ok(label + ': no console or page errors across all screens', errors.filter(e => !/favicon|sw\.js|ServiceWorker/i.test(e)).length === 0, errors.slice(0, 4));
    // links and navigation targets
    if (label === 'phone') {
      const bad = await p.evaluate(() => { const ids = new Set([...document.querySelectorAll('.view')].map(v => v.id.replace('view-', ''))); const out = []; document.querySelectorAll('[data-go]').forEach(b => { if (!ids.has(b.getAttribute('data-go'))) out.push(b.getAttribute('data-go')); }); document.querySelectorAll('.nav [data-view]').forEach(b => { if (!ids.has(b.getAttribute('data-view'))) out.push('nav:' + b.getAttribute('data-view')); }); return out; });
      ok('every data-go / nav target is a real screen', bad.length === 0, bad);
      await p.evaluate(() => TTNav.go('more')); await p.waitForTimeout(200);
      const hubHas = await p.evaluate(() => [...document.querySelectorAll('#hubRoot [data-go]')].map(b => b.getAttribute('data-go')));
      for (const s of R.screens().filter(s => !s.virtual && !['home', 'calc', 'journal', 'accounts', 'more'].includes(s.id))) ok('More menu lists "' + s.title + '"', hubHas.includes(s.view), hubHas);
      const links = await p.evaluate(() => [...document.querySelectorAll('a[target=_blank]')].filter(a => !/noopener/.test(a.rel)).map(a => a.href));
      ok('external links open safely (noopener)', links.length === 0, links);
    }
    // tour targets (registry-driven, so a moved or renamed control is caught)
    if (label === 'phone' || label === 'desktop') for (const f of R.screens()) for (const s of f.tour) {
      await p.evaluate((v) => TTNav.go(v), f.virtual ? 'home' : f.view); const found = await p.waitForSelector(s.target, { state: 'attached', timeout: 3500 }).then(() => true).catch(() => false);
      ok(label + ': tour "' + f.id + '" target ' + s.target + ' exists on screen', found);
    }
    if (label === 'phone' || label === 'desktop') for (const t of R.MAIN_TOUR.filter(t => t.ring)) { await p.evaluate(() => TTNav.go('home')); const found = await p.waitForSelector(t.ring, { state: 'attached', timeout: 3000 }).then(() => true).catch(() => false); ok(label + ': main tour ring ' + t.ring, found); }
    await ctx.close();
  }
  // ---------- damaged storage must never crash the app
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem('tt.profile.v1', '{{{not json'); localStorage.setItem('tt.copilot.v1', '[1,2,'); localStorage.setItem('tt.copilot.hist.v1', '"x"'); localStorage.setItem('tt.calc.last.v1', 'zzz'); localStorage.setItem('tt.theme', '<b>'); } catch (e) {} });
    await p.goto(URL); await p.waitForSelector('#copilotFab'); await p.waitForTimeout(500);
    ok('corrupt personal settings: app still loads (welcome shown, no crash)', errors.length === 0 && !!(await p.$('.xo, #homeWidgets')), errors);
    await p.evaluate(() => { const x = document.querySelector('.xo'); if (x) x.remove(); }); await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); await p.fill('.cp-in', 'open analytics'); await p.press('.cp-in', 'Enter'); await p.waitForTimeout(400);
    ok('corrupt Copilot settings/history: Copilot works with defaults', errors.length === 0 && (await p.evaluate(() => document.querySelector('.view.active').id)) === 'view-analytics', errors); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => { const boom = () => { throw new DOMException('blocked', 'SecurityError'); }; Storage.prototype.setItem = boom; Storage.prototype.getItem = boom; Storage.prototype.removeItem = boom; });
    await p.goto(URL); await p.waitForSelector('#copilotFab'); await p.waitForTimeout(600);
    ok('storage blocked (private mode): app loads without uncaught errors', errors.length === 0, errors);
    await p.evaluate(() => { const x = document.querySelector('.xo'); if (x) x.remove(); }); await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); await p.fill('.cp-in', 'how many contracts with a 10 point stop on mnq with 50 dollars'); await p.press('.cp-in', 'Enter'); await p.waitForTimeout(500);
    ok('storage blocked: Copilot still answers', /contracts/.test(await p.innerText('.cp-log')) && errors.length === 0, errors); await ctx.close(); }
  // ---------- backups carry personal + Copilot settings; Copilot lifecycle; performance
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message)); await p.addInitScript(prime);
    const reqs = []; p.on('request', r => reqs.push(r.url())); const t0 = Date.now(); await p.goto(URL); await p.waitForSelector('#copilotFab'); const load = Date.now() - t0; await p.waitForTimeout(500);
    const sizes = await p.evaluate(() => performance.getEntriesByType('resource').filter(r => /\.js$/.test(r.name.split('?')[0])).map(r => [r.name.split('/').pop(), r.encodedBodySize || r.decodedBodySize || 0]));
    const total = sizes.reduce((a, s) => a + s[1], 0); console.log('info: initial JS ' + sizes.length + ' files, ' + Math.round(total / 1024) + ' KB (uncompressed transfer on localhost), page ready in ' + load + ' ms');
    ok('Copilot (~100KB) is not part of the initial load', !sizes.some(s => /^copilot(-core|-content)?\.js$/.test(s[0])) && sizes.some(s => s[0] === 'copilot-boot.js'));
    ok('initial script payload is reasonable (< 1.2 MB uncompressed)', total < 1.2 * 1024 * 1024, total); ok('page becomes usable quickly on a fast machine (< 4s)', load < 4000, load);
    await p.evaluate(async () => { await TTStore.setPref('copilot', { shortcuts: [{ phrase: 'morning', command: 'open my journal' }], memory: { defaultInstrument: 'MNQ' }, v: 1 }); await TTStore.setPref('profile', { name: 'Zed', onboarded: true }); });
    const bk = await p.evaluate(async () => { const C = TTJournalCore; const docs = await TTDB.getAll('docs'); const json = C.serializeBackup([], {}, { accounts: await TTDB.getAll('accounts'), ledger: [], docs }); const r = C.parseBackup(json); return { ok: r.ok, ids: (r.docs || []).map(d => d.id) }; });
    ok('backup file includes Copilot settings and personal profile', bk.ok && bk.ids.includes('pref-copilot') && bk.ids.includes('pref-profile'), bk);
    // open/close 25 times: nothing accumulates
    await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    const n0 = await p.evaluate(() => document.querySelectorAll('*').length); const heap0 = await p.evaluate(() => (performance.memory || {}).usedJSHeapSize || 0);
    for (let i = 0; i < 25; i++) { await p.evaluate(() => window.TTCopilot.open()); await p.evaluate(() => window.TTCopilot.close()); }
    const n1 = await p.evaluate(() => document.querySelectorAll('*').length), heap1 = await p.evaluate(() => (performance.memory || {}).usedJSHeapSize || 0);
    ok('opening/closing Copilot 25 times leaves no stray elements', n1 === n0 && !(await p.$('#copilotPanel')), [n0, n1]); if (heap0) ok('no runaway memory growth over 25 open/close cycles (< 3 MB)', heap1 - heap0 < 3 * 1024 * 1024, [heap0, heap1]);
    ok('no page errors in lifecycle', errors.length === 0, errors); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }), p = await ctx.newPage(); await p.addInitScript(prime); await p.goto(URL); await p.click('#copilotFab'); await p.waitForSelector('#copilotPanel');
    const an = await p.evaluate(() => ({ panel: getComputedStyle(document.querySelector('.cp-panel')).animationName, fab: getComputedStyle(document.getElementById('copilotFab')).transitionDuration })); ok('reduced-motion users get no Copilot animations', an.panel === 'none' && /^0s/.test(an.fab), an); await ctx.close(); }
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage(); await p.addInitScript(prime); await p.goto(URL); await p.waitForSelector('#copilotFab');
    await p.focus('#copilotFab'); await p.keyboard.press('Enter'); await p.waitForSelector('#copilotPanel'); ok('keyboard: Enter on the button opens Copilot', true); await p.keyboard.press('Escape'); await p.waitForTimeout(80);
    ok('keyboard: Escape closes and returns focus to the button', !(await p.$('#copilotPanel')) && (await p.evaluate(() => document.activeElement.id)) === 'copilotFab'); await ctx.close(); }
  await browser.close(); console.log(`integration: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
