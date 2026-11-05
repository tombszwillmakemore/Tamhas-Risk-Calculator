// Journal calendar containment: every date, value, indicator and trade count stays inside its own cell, never overlaps, and the
// seven columns stay aligned. Widths 320/375/390/430/768/1280, portrait and landscape, dark and light, larger text (zoom 1.5).
// SYNTHETIC trades are built so each day has exactly one of the required amounts (net of fees).
const { chromium } = require('./_pw'); const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const URL = (process.env.TT_BASE || 'http://127.0.0.1:8765') + '/index.html';
let fail = 0, pass = 0, quiet = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; if (quiet++ < 60) console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } };
const until = async (pg, fn, arg, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
// [day, net cents, contract, gross points (2-decimal), fee cents, trades]
const Y = 2026, M = 9;   // October 2026 (month index 9)
const DAYS = [
  [1, 1, 'MNQ', 0.25, 49], [2, -60, 'MNQ', 0, 60], [5, 6990, 'MNQ', 35, 10], [6, -5350, 'MNQ', -26.75, 0], [7, 99999, 'MNQ', 500, 1],
  [8, 125075, 'MNQ', 625.5, 25], [9, -1250000, 'NQ', -625, 0], [12, 100000000, 'NQ', 50000, 0], [13, 0, 'MNQ', 0, 0], [14, -123456789, 'NQ', -61728, 789],
  [19, null, 'open'], [20, 'n', 1], [21, 'n', 10], [22, 'n', 100], [23, 'n', 1000], [26, 6995, 'MNQ', 35, 5], [27, -125000, 'MNQ', -625, 0]
];
function build() {
  const t = []; let id = 0; const P = c => (c === 'NQ' ? 70000 : 20000);
  for (const d of DAYS) {
    const date = Y + '-' + String(M + 1).padStart(2, '0') + '-' + String(d[0]).padStart(2, '0');
    if (d[1] === null) { t.push({ id: 'cal' + id++, date, time: '10:00', contract: 'MNQ', side: 'long', contracts: 1, entry: 20000, exits: [], feesCents: 0, accountId: 'acct-default' }); continue; }
    if (d[1] === 'n') { for (let i = 0; i < d[2]; i++) t.push({ id: 'cal' + id++, date, time: '09:' + String(i % 60).padStart(2, '0'), contract: 'MNQ', side: 'long', contracts: 1, entry: 20000, exits: [{ qty: 1, price: 20000.5 }], feesCents: 0, accountId: 'acct-default' }); continue; }
    const [, , c, pts, fee] = d, e = P(c);
    t.push({ id: 'cal' + id++, date, time: '10:00', contract: c, side: 'long', contracts: 1, entry: e, exits: [{ qty: 1, price: Math.round((e + pts) * 100) / 100 }], feesCents: fee, accountId: 'acct-default' });
  }
  return t;
}
const EXPECT = { 1: '+$0.01', 2: '-$0.60', 5: '+$69.90', 6: '-$53.50', 7: '+$999.99', 8: '+$1,250.75', 9: '-$12,500.00', 12: '+$1,000,000.00', 13: '$0.00', 14: '-$1,234,567.89', 26: '+$69.95', 27: '-$1,250.00' };
(async () => {
  const browser = await chromium.launch();
  const trades = build();
  const configs = [];
  for (const w of [320, 375, 390, 430]) configs.push({ w, h: 780, theme: w % 2 ? 'light' : 'dark', mobile: true });
  configs.push({ w: 390, h: 844, theme: 'light', mobile: true }, { w: 844, h: 390, theme: 'dark', mobile: true, label: 'landscape' }, { w: 768, h: 1024, theme: 'light', mobile: true }, { w: 1280, h: 800, theme: 'dark', mobile: false }, { w: 1600, h: 1000, theme: 'light', mobile: false });
  configs.push({ w: 320, h: 780, theme: 'dark', mobile: true, zoom: 1.5, label: 'large text' }, { w: 390, h: 844, theme: 'light', mobile: true, zoom: 1.3, label: 'large text' });
  for (const cf of configs) {
    const T = (cf.label ? cf.label + ' ' : '') + cf.w + 'x' + cf.h + ' ' + cf.theme + (cf.zoom ? ' zoom ' + cf.zoom : '') + ': ';
    const ctx = await browser.newContext({ viewport: { width: cf.w, height: cf.h }, isMobile: cf.mobile, hasTouch: cf.mobile, deviceScaleFactor: 2 });
    await ctx.addInitScript(t => { try { localStorage.setItem('tt.theme', t); } catch (e) {} }, cf.theme);
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.evaluate(() => TTDB.ready());
    await p.evaluate(async ts => { const now = Date.now(); await TTDB.batch(ts.map(t => ({ store: 'trades', type: 'put', value: Object.assign({ createdAt: now }, t) }))); }, trades);
    await p.reload(); await p.evaluate(() => TTDB.ready());
    if (cf.zoom) await p.evaluate(z => { document.documentElement.style.zoom = z; }, cf.zoom);
    await p.evaluate(() => TTNav.go('journal')); await p.waitForSelector('#jRoot [data-tab=calendar]');
    await p.click('#jRoot [data-tab=calendar]'); await p.waitForSelector('.cal');
    // go to October 2026
    for (let i = 0; i < 40 && !(await p.evaluate(() => /October 2026/.test(document.querySelector('.calt').textContent))); i++) await p.click(await p.evaluate(() => { const t = document.querySelector('.calt').textContent; const d = new Date(t + ' 1'); return d < new Date(2026, 9, 1) ? '[data-act=cal-next]' : '[data-act=cal-prev]'; }));
    await p.waitForTimeout(200);
    const r = await p.evaluate(() => {
      const box = e => e.getBoundingClientRect(); const ink = el => { const rg = document.createRange(); rg.selectNodeContents(el); const rs = Array.from(rg.getClientRects()); if (!rs.length) return null; return rs.reduce((a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }), { left: 1e9, right: -1e9, top: 1e9, bottom: -1e9 }); };
      const cells = Array.from(document.querySelectorAll('.cal .cal-d:not(.blank)')), heads = Array.from(document.querySelectorAll('.cal .cal-h'));
      const out = { cells: [], heads: heads.map(h => { const b = box(h); return { l: b.left, r: b.right }; }) };
      cells.forEach(c => {
        const cb = box(c), parts = Array.from(c.querySelectorAll('.cn, .cs, .cp, .ct')).map(s => ({ cls: s.className.split(' ')[0], text: s.textContent, ink: ink(s), sw: s.scrollWidth, cw: s.clientWidth, fs: parseFloat(getComputedStyle(s).fontSize), list: s.getAttribute('data-fit'), exactFits: (() => { if (!s.classList.contains('cp') || s.getAttribute('data-shown') !== 'approx') return false; const L = JSON.parse(s.getAttribute('data-fit')), keepT = s.textContent, keepC = s.className; let any = false; const far = L.find(x => x[0] === keepT)[1] === 2; s.className = far ? 'cp tighter' : 'cp tight'; for (const x of L) if (!x[1]) { s.textContent = x[0]; if (s.scrollWidth <= s.clientWidth) any = true; } s.textContent = keepT; s.className = keepC; return any; })() }));
        out.cells.push({ date: c.getAttribute('data-date'), label: c.getAttribute('aria-label') || '', l: cb.left, r: cb.right, t: cb.top, b: cb.bottom, parts });
      });
      out.scrollX = document.documentElement.scrollWidth > innerWidth + 1; out.narrow = document.querySelector('.cal').classList.contains('cal-narrow'); out.list = out.narrow ? document.querySelector('.cal-days').textContent : '';
      const k = document.querySelector('.cal-k .kpi-v'); out.kpi = k ? { sw: k.scrollWidth, cw: k.clientWidth, text: k.textContent } : null;
      return out;
    });
    let inside = 0, overl = 0, small = 0, cut = 0, approxBad = 0;
    for (const c of r.cells) {
      for (const s of c.parts) {
        if (!s.ink) continue;
        if (s.ink.left < c.l - 0.5 || s.ink.right > c.r + 0.5 || s.ink.top < c.t - 0.5 || s.ink.bottom > c.b + 0.5) { inside++; if (inside < 4) ok(T + 'inside cell ' + c.date + ' ' + s.cls + ' "' + s.text + '"', false, { ink: s.ink, cell: [c.l, c.r, c.t, c.b] }); }
        if (s.sw > s.cw + 0.5 && s.cls !== 'cs') { cut++; if (cut < 4) ok(T + 'not cut off ' + c.date + ' "' + s.text + '"', false, s); }
        if (s.fs < 8) small++;
        if (s.cls === 'cp' && s.list) { const L = JSON.parse(s.list); if (L.length) { const hit = L.find(x => x[0] === s.text); if (!hit) approxBad++; else if (hit[1] && !/[KM]$/.test(s.text) && s.text.indexOf('~') < 0) approxBad++; else if (hit[1] && s.exactFits) approxBad++; } }
      }
      const ps = c.parts.filter(s => s.ink);
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const a = ps[i].ink, b = ps[j].ink; if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) { overl++; if (overl < 4) ok(T + 'no overlap in ' + c.date + ': ' + ps[i].text + ' / ' + ps[j].text, false); } }
    }
    ok(T + 'every value inside its own cell (' + r.cells.length + ' cells)', inside === 0, inside); ok(T + 'nothing overlaps inside a cell', overl === 0, overl); ok(T + 'nothing cut off halfway', cut === 0, cut); ok(T + 'no text below 8px', small === 0, small);
    ok(T + 'every shown value is one of its exact/compact forms', approxBad === 0, approxBad);
    // columns: 7 equal widths, every cell aligned to its column
    const widths = r.heads.map(h => h.r - h.l); ok(T + 'seven equal columns', widths.length === 7 && Math.max(...widths) - Math.min(...widths) <= 1, widths);
    const misaligned = r.cells.filter(c => !r.heads.some(h => Math.abs(h.l - c.l) <= 1 && Math.abs(h.r - c.r) <= 1)).length; ok(T + 'every cell aligned to a column', misaligned === 0, misaligned);
    // consistent positions: date number top-left, count at the bottom, values in the middle
    const dOff = r.cells.map(c => { const d = c.parts.find(s => s.cls === 'cn'); return d && d.ink ? [Math.round(d.ink.left - c.l), Math.round(d.ink.top - c.t), Math.round((d.ink.left + d.ink.right) / 2 - (c.l + c.r) / 2)] : null; }).filter(Boolean);
    ok(T + 'date numbers in the same spot in every cell', new Set(dOff.map(x => x[1])).size <= 1 && (r.narrow ? dOff.every(x => Math.abs(x[2]) <= 1) : dOff.every(x => x[0] >= 0 && x[0] <= 6)), dOff.slice(0, 8));
    const cOff = r.cells.map(c => { const d = c.parts.find(s => s.cls === 'ct'); return d && d.ink ? Math.round(c.b - d.ink.bottom) : null; }).filter(x => x != null); ok(T + 'trade counts at the same height', new Set(cOff).size <= 2, cOff);
    // exact values are always available: label, and every required example appears exactly in the label
    for (const d of Object.keys(EXPECT)) { const c = r.cells.find(x => x.date === '2026-10-' + String(d).padStart(2, '0')); ok(T + 'day ' + d + ' label has the exact ' + EXPECT[d], c && c.label.indexOf(EXPECT[d]) >= 0, c && c.label); }
    if (r.narrow) { for (const v of Object.values(EXPECT)) ok(T + 'narrow mode lists the exact ' + v, r.list.indexOf(v) >= 0); ok(T + 'narrow mode lists 1,000 trades', /1,000 trades/.test(r.list)); }
    else for (const [d, n] of [[20, 1], [21, 10], [22, 100], [23, 1000]]) { const c = r.cells.find(x => x.date === '2026-10-' + d); ok(T + n + ' trades: count shown and contained', c && c.parts.some(s => s.cls === 'ct' && s.text.replace(/,/g, '').indexOf(String(n >= 1000 && s.text.indexOf('k') >= 0 ? 1 : n)) >= 0), c && c.parts.map(s => s.text)); }
    const open = r.cells.find(x => x.date === '2026-10-19'); ok(T + 'missing value shows a dash and the * marker', r.narrow ? /\*/.test(r.list) : open && open.parts.some(s => s.cls === 'cp' && s.text === '—') && open.parts.some(s => s.cls === 'cs'));
    ok(T + (r.narrow ? 'narrow mode used only where needed' : 'values shown in the cells'), !r.narrow || (cf.zoom && cf.w / cf.zoom < 320), { narrow: r.narrow });
    ok(T + 'month total fits its box', r.kpi && r.kpi.sw <= r.kpi.cw + 1, r.kpi); ok(T + 'no horizontal page scroll', !r.scrollX);
    // tap a day: exact amount in the day view
    await p.click('[data-date="2026-10-08"]'); await p.waitForSelector('#dayChip'); ok(T + 'tapping a day shows the exact amount', /\+\$1,250\.75/.test(await p.innerText('#dayChip')) && /1 trade/.test(await p.innerText('#dayChip')));
    await p.click('[data-act=clear-date]');
    await p.click('#jRoot [data-tab=calendar]'); await p.waitForSelector('.cal');
    for (let i = 0; i < 40 && !(await p.evaluate(() => /October 2026/.test(document.querySelector('.calt').textContent))); i++) await p.click(await p.evaluate(() => { const d = new Date(document.querySelector('.calt').textContent + ' 1'); return d < new Date(2026, 9, 1) ? '[data-act=cal-next]' : '[data-act=cal-prev]'; }));
    await p.waitForTimeout(150); const el = await p.$('.cal'); if (el) await el.screenshot({ path: path.join(OUT, 'cal-' + (cf.label ? cf.label.replace(/ /g, '-') + '-' : '') + cf.w + 'x' + cf.h + '-' + cf.theme + '.png') });
    // other cards with huge values: nothing spills out of its box
    const spill = await p.evaluate(async () => {
      const bad = []; for (const v of ['home', 'analytics', 'accounts', 'money', 'insights']) { TTNav.go(v); await new Promise(r => setTimeout(r, 450));
        document.querySelectorAll('.view.active .kpi-v, .view.active .ui-stat b, .view.active .pnl-value, .view.active .stat b').forEach(e => { if (!e.offsetParent) return; const b = e.getBoundingClientRect(), pb = e.parentElement.getBoundingClientRect(); if (e.scrollWidth > e.clientWidth + 1 || b.right > pb.right + 1 || b.left < pb.left - 1) bad.push(v + ': ' + e.textContent.slice(0, 30)); }); }
      TTNav.go('journal'); const t = document.querySelector('#jRoot [data-tab=analytics]'); if (t) { t.click(); await new Promise(r => setTimeout(r, 300)); document.querySelectorAll('#jRoot .kpi-v').forEach(e => { if (e.offsetParent && e.scrollWidth > e.clientWidth + 1) bad.push('journal analytics: ' + e.textContent.slice(0, 30)); }); }
      return bad; });
    ok(T + 'dashboard, analytics, accounts, money, insights: big values stay inside their cards', !spill.length, spill);
    ok(T + 'no page errors', !errors.length, errors);
    await ctx.close();
  }
  // top safe area and fixed nav rules present
  { const p = await browser.newPage(); await p.goto(URL); const r = await p.evaluate(() => { const css = Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(x => x.cssText).join('\n'); } catch (e) { return ''; } }).join('\n'); return { top: /\.main\s*\{[^}]*safe-area-inset-top/.test(css), nav: /\.nav\s*\{[^}]*position: fixed/.test(css) }; }); ok('top safe-area padding and fixed bottom nav rules present', r.top && r.nav, r); await p.close(); }
  await browser.close();
  console.log(fail ? 'FAILED ' + fail + ' / passed ' + pass : 'ALL PASSED ' + pass); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
