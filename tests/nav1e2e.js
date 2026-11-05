// Bottom navigation stays on the visible bottom of the screen: every main page, long Journal and Accounts lists, phone and desktop,
// dark and light, content never hidden under the bar, no ancestor that breaks position:fixed, toolbar/keyboard handling (simulated
// visualViewport - real address-bar and keyboard behaviour needs a real phone), and nothing else broken.
const { chromium } = require('./_pw'); const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const URL = (process.env.TT_BASE || 'http://127.0.0.1:8765') + '/index.html';
let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } };
const until = async (pg, fn, arg, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
const navBox = p => p.evaluate(() => { const n = document.querySelector('.nav'), r = n.getBoundingClientRect(), cs = getComputedStyle(n); return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, h: innerHeight, w: innerWidth, vis: cs.visibility, disp: cs.display, pos: cs.position }; });
const PAGES = ['home', 'calc', 'journal', 'accounts', 'more', 'import', 'analytics', 'settings', 'risk', 'money', 'help'];
async function seed(p) {
  await p.evaluate(async () => {
    await TTDB.ready(); const ops = [];
    for (let i = 0; i < 80; i++) { const d = new Date(Date.UTC(2026, 8, 1 + (i % 28))).toISOString().slice(0, 10); ops.push({ store: 'trades', type: 'put', value: { id: 'nv' + i, date: d, time: '10:' + String(i % 60).padStart(2, '0'), contract: 'MNQ', side: i % 2 ? 'long' : 'short', contracts: 1, entry: 21000, exits: [{ qty: 1, price: i % 3 ? 21005 : 20995 }], feesCents: 124, accountId: 'acct-default', notes: 'Synthetic trade ' + i, createdAt: Date.now() - i } }); }
    for (let i = 0; i < 12; i++) ops.push({ store: 'accounts', type: 'put', value: { id: 'nva' + i, name: 'Synthetic account ' + (i + 1), category: i % 3 ? 'prop' : 'sim', status: i % 3 ? 'evaluation' : 'active', archived: false, createdAt: Date.now() - i * 1000, rules: {}, ruleHistory: [], statusHistory: [] } });
    await TTDB.batch(ops);
  });
  await p.reload(); await p.evaluate(() => TTDB.ready()); await p.waitForTimeout(300);
}
(async () => {
  const browser = await chromium.launch();
  for (const [theme, vp, mobile] of [['dark', { width: 390, height: 844 }, true], ['light', { width: 390, height: 664 }, true], ['dark', { width: 412, height: 915 }, true], ['light', { width: 1280, height: 800 }, false]]) {
    const T = theme + '@' + vp.width + 'x' + vp.height + ': ';
    const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
    await ctx.addInitScript(t => { try { localStorage.setItem('tt.theme', t); } catch (e) {} }, theme);
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.evaluate(() => TTDB.ready()); await seed(p);
    ok(T + 'theme applied', await p.evaluate(t => document.documentElement.getAttribute('data-theme') === t, theme));
    // nothing above the nav may create a containing block for fixed elements
    const anc = await p.evaluate(() => { const bad = []; for (let e = document.querySelector('.nav').parentElement; e; e = e.parentElement) { const c = getComputedStyle(e); ['transform', 'filter', 'perspective', 'backdropFilter'].forEach(k => { if (c[k] && c[k] !== 'none') bad.push(e.tagName + ' ' + k + '=' + c[k]); }); if (c.contain && c.contain !== 'none') bad.push(e.tagName + ' contain'); if (/transform|filter|perspective/.test(c.willChange)) bad.push(e.tagName + ' will-change'); } return bad; });
    ok(T + 'no ancestor breaks fixed positioning', !anc.length, anc);
    for (const v of PAGES) {
      await p.evaluate(v => TTNav.go(v), v); await p.waitForTimeout(250);
      const sh = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      for (const frac of [0, 0.37, 0.71, 1]) {
        await p.evaluate(f => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * f)), frac); await p.waitForTimeout(80);
        const b = await navBox(p);
        if (mobile) ok(T + v + ' scrolled ' + Math.round(frac * 100) + '%: bar on the visible bottom', b.pos === 'fixed' && Math.abs(b.bottom - b.h) <= 1 && b.vis === 'visible' && b.disp !== 'none' && b.left === 0 && Math.abs(b.width - b.w) <= 1, b);
        else ok(T + v + ' scrolled ' + Math.round(frac * 100) + '%: side rail fixed full height', b.pos === 'fixed' && Math.abs(b.top) <= 1 && Math.abs(b.bottom - b.h) <= 1, b);
      }
      if (v === 'journal' || v === 'accounts') ok(T + v + ' is long enough to really scroll (' + sh + ' px)', sh > 600, sh);
      // nothing in the page ends up hidden under the bar: at full scroll the last control is above it
      if (mobile) {
        const last = await p.evaluate(() => { const n = document.querySelector('.nav').getBoundingClientRect(); const els = Array.from(document.querySelectorAll('.view.active button, .view.active input, .view.active select, .view.active textarea, .view.active a')).filter(e => e.offsetParent && e.getBoundingClientRect().height > 0 && !(e.closest('details') && !e.closest('details').open && !e.closest('summary'))); if (!els.length) return { ok: true }; const l = els.map(e => e.getBoundingClientRect()).sort((a, b) => b.bottom - a.bottom)[0]; const le = els.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]; return { ok: l.bottom <= n.top + 0.5, last: l.bottom, navTop: n.top, el: le.outerHTML.slice(0, 140), sh: document.documentElement.scrollHeight, sy: scrollY }; });
        ok(T + v + ': last control can scroll clear of the bar', last.ok, last);
        const hit = await p.evaluate(() => { const r = document.querySelector('.nav').getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(e && e.closest('.nav')); });
        ok(T + v + ': bar is on top and tappable', hit);
      }
    }
    // navigation still works from a scrolled position, on every tab
    await p.evaluate(() => { TTNav.go('journal'); window.scrollTo(0, 99999); });
    for (const tab of ['home', 'calc', 'journal', 'accounts', 'more']) { await p.click('.nav button[data-view=' + tab + ']'); ok(T + 'tap ' + tab + ' from a scrolled page works', await until(p, t => location.hash === '#' + t, tab, 2000)); }
    // a field near the bottom of a long page is not covered by the bar when focused
    if (mobile) {
      await p.evaluate(() => { TTNav.go('settings'); window.scrollTo(0, 0); }); await p.waitForTimeout(150);
      const covered = await p.evaluate(() => { const ins = Array.from(document.querySelectorAll('#view-settings input')).filter(e => e.offsetParent); const el = ins[ins.length - 1]; el.focus(); return new Promise(r => setTimeout(() => { const a = el.getBoundingClientRect(), n = document.querySelector('.nav').getBoundingClientRect(); r({ bottom: a.bottom, navTop: n.top }); }, 250)); });
      ok(T + 'focused field near the bottom is above the bar', covered.bottom <= covered.navTop + 0.5, covered);
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
    }
    await p.screenshot({ path: path.join(OUT, 'shots', 'nav-' + theme + '-' + vp.width + '.png') });
    ok(T + 'no page errors', !errors.length, errors);
    await ctx.close();
  }
  // simulated visual viewport (address bar / toolbar and on-screen keyboard), phone size
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      const et = new EventTarget(); const fake = { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1, addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et) };
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
      window.__vv = (o) => { Object.assign(fake, o); et.dispatchEvent(new Event('resize')); };
    });
    const p = await ctx.newPage(); await p.goto(URL); await p.evaluate(() => TTDB.ready()); await p.evaluate(() => TTNav.go('journal'));
    const T = 'viewport: ';
    await p.evaluate(() => __vv({ height: innerHeight - 50 })); await p.waitForTimeout(100);
    let b = await navBox(p); ok(T + 'toolbar strip of 50 px: bar moves onto the visible bottom', Math.abs(b.bottom - (b.h - 50)) <= 1 && b.vis === 'visible', b);
    await p.evaluate(() => __vv({ height: innerHeight })); await p.waitForTimeout(100);
    b = await navBox(p); ok(T + 'toolbar gone again: bar back at the bottom', Math.abs(b.bottom - b.h) <= 1, b);
    await p.evaluate(() => TTNav.go('calc')); await p.focus('#stop'); await p.evaluate(() => __vv({ height: 480 })); await p.waitForTimeout(120);
    b = await navBox(p); ok(T + 'keyboard open while typing: bar steps aside', b.vis === 'hidden', b);
    ok(T + 'the field being typed in stays usable', await p.evaluate(() => document.activeElement && document.activeElement.id === 'stop'));
    await p.evaluate(() => { document.activeElement.blur(); __vv({ height: innerHeight }); }); await p.waitForTimeout(150);
    b = await navBox(p); ok(T + 'keyboard closed: bar visible again at the bottom', b.vis === 'visible' && Math.abs(b.bottom - b.h) <= 1, b);
    await p.evaluate(() => __vv({ height: 600, scale: 1.8 })); await p.waitForTimeout(100);
    b = await navBox(p); ok(T + 'pinch-zoom: bar is not shifted around', Math.abs(b.bottom - b.h) <= 1, b);
    await ctx.close();
  }
  // reduced motion and installed-app style viewport (safe area padding present in the rule)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true });
    const p = await ctx.newPage(); await p.goto(URL); await p.evaluate(() => TTDB.ready());
    const r = await p.evaluate(() => { const css = Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(x => x.cssText).join('\n'); } catch (e) { return ''; } }).join('\n'); return { safe: /\.nav\s*\{[^}]*safe-area-inset-bottom/.test(css), pad: /\.main\s*\{[^}]*safe-area-inset-bottom/.test(css), dvh: /100dvh/.test(css), fit: /viewport-fit=cover/.test(document.querySelector('meta[name=viewport]').content) }; });
    ok('safe-area: nav and page padding use env(safe-area-inset-bottom), viewport-fit=cover set', r.safe && r.pad && r.fit, r); ok('dynamic viewport units used', r.dvh);
    const b = await navBox(p); ok('reduced motion: bar still pinned', Math.abs(b.bottom - b.h) <= 1);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' / passed ' + pass : 'ALL PASSED ' + pass); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
