// Duplicate-proof import in a real browser (Part 19 scenarios A, B, C, G, H + two tabs + journal scan), at 390 px and 1280 px.
// Every report is synthetic (tests/_ddgen.js).
const { chromium } = require('./_pw'); const fs = require('fs'), path = require('path');
const { mkTrades, perfCsv, fillsCsv } = require('./_ddgen.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const BASE = process.env.TT_BASE || 'http://127.0.0.1:8765', URL = BASE + '/index.html';
let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 500)); } };
const until = async (pg, fn, arg, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
const A = mkTrades('DEMO-A', 7000), week = perfCsv(A.slice(0, 20)), month = perfCsv(A);
const nTrades = p => p.evaluate(() => TTDB.getAll('trades').then(l => l.length));
const grossAll = p => p.evaluate(() => TTDB.getAll('trades').then(l => TTJournalCore.analyze(l.map(t => TTJournalCore.normalizeTrade(t).trade)).reduce((a, r) => a + (r.c.isClosed ? r.c.grossCents : 0), 0)));
async function start(p) {
  await p.goto(URL); await p.evaluate(() => TTDB.ready());
  await p.evaluate(() => { const a = TTAccountsCore.newAccount({ id: 'acct-a', name: 'Tradovate Live', category: 'live', startingBalance: '100' }, 1).account; return TTDB.put('accounts', a); });
  await p.evaluate(() => TTImportUI.reload());
}
// Drop a report, choose the account for a file without an account column, and wait for the preview.
async function drop(p, text, name, acct) {
  await p.evaluate(() => TTNav.go('import')); await p.evaluate(() => TTImportUI.reset());
  await p.evaluate(([t, n]) => TTImportUI.intake([{ text: t, name: n }]), [text, name]);
  await until(p, () => TTImportUI.state.step === 'tv' && !!document.querySelector('.im-sum'));
  const sel = await p.$('select[data-noacct]'); if (sel) { await sel.selectOption(acct || 'acct-a'); await until(p, () => !document.querySelector('[data-act=im-tv-commit][disabled]') || !!document.querySelector('.ui-banner[role=alert]'), null, 4000); await p.waitForTimeout(150); }
  const raw = await p.$$('select[data-rawacct]'); for (const s of raw) { await s.selectOption(acct || 'acct-a'); await p.waitForTimeout(150); }
}
async function commit(p) { await p.click('[data-act=im-tv-commit]'); await until(p, () => TTImportUI.state.step === 'done'); }
async function confirmDialog(p) { await p.waitForSelector('[data-r=ok]'); await p.click('[data-r=ok]'); }
(async () => {
  const browser = await chromium.launch();
  for (const width of [390, 1280]) {
    const W = width + 'px: ';
    const ctx = await browser.newContext({ viewport: { width, height: 860 } }), p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console:' + m.text()); });
    await start(p);

    // ---- Scenario A: the same weekly report twice
    await drop(p, week, 'week-1.csv');
    let txt = await p.innerText('.im-sum');
    ok(W + 'A: preview lists the classes and how many will be added', /New trades\s*20/.test(txt) && /Exact duplicates \(skipped\)\s*0/.test(txt) && /Will be added: 20 trades/.test(txt), txt);
    ok(W + 'A: preview shows the estimated P&L change (net unknown without fees)', /gross/.test(txt) && /net unknown/.test(txt), txt);
    if (width === 390) await p.screenshot({ path: path.join(OUT, 'shots', 'dd-preview-390.png'), fullPage: false });
    await commit(p); ok(W + 'A: first import -> 20 trades', await nTrades(p) === 20);
    const g20 = await grossAll(p);
    await drop(p, week, 'week-1 (copy).csv');
    txt = await p.innerText('.im-sum');
    ok(W + 'A: same file again (other name) -> 0 new, 20 exact duplicates', /New trades\s*0/.test(txt) && /Exact duplicates \(skipped\)\s*20/.test(txt) && /Will be added: 0 trades/.test(txt), txt);
    ok(W + 'A: offers to record the skipped duplicates, never to import them', /SKIP DUPLICATES AND FINISH/.test(await p.innerText('#iRoot')));
    await commit(p); ok(W + 'A: still 20 trades, P&L unchanged', await nTrades(p) === 20 && await grossAll(p) === g20);
    ok(W + 'A: history records the import with its counts', /20 duplicates skipped/.test(await p.innerText('#im-history')));

    // ---- Scenario B: the monthly report (20 old + 15 new)
    await drop(p, month, 'october.csv');
    txt = await p.innerText('.im-sum'); ok(W + 'B: monthly -> 15 new, 20 duplicates', /New trades\s*15/.test(txt) && /Exact duplicates \(skipped\)\s*20/.test(txt), txt);
    await commit(p); ok(W + 'B: 35 unique trades', await nTrades(p) === 35);

    // ---- Scenario H: every screen shows the same totals
    await p.evaluate(() => TTNav.go('journal')); await until(p, () => window.TTJournalExt && TTJournalExt.ctx && TTJournalExt.ctx.state.trades.length === 35);
    ok(W + 'H: journal holds the same 35 trades', await p.evaluate(() => TTJournalExt.ctx.state.trades.length) === 35);
    const g35 = await grossAll(p);
    await p.evaluate(() => TTNav.go('accounts')); await until(p, () => /Tradovate Live/.test(document.getElementById('aRoot').innerText));
    const acctTxt = await p.innerText('#aRoot'); const money = await p.evaluate(c => TTJournalCore.fmtMoney(c, true), g35);
    ok(W + 'H: account card shows the same gross P&L as the journal', acctTxt.indexOf(money.replace('+', '')) >= 0, [money, acctTxt.slice(0, 300)]);

    // ---- Scenario C: a possible duplicate, reviewed in Import Review
    const shifted = fillsCsv([A[2]], { utc: true });   // same trade written in UTC, read without conversion -> whole-hours shift
    await drop(p, shifted, 'utc-export.csv');
    txt = await p.innerText('.im-sum'); ok(W + 'C: a time-shifted copy is held as a possible duplicate', /Possible duplicates \(held\)\s*1/.test(txt) && /Will be added: 0 trades/.test(txt), txt);
    await commit(p);
    await p.evaluate(() => TTNav.go('review')); await p.waitForSelector('#rvRoot .rv-card');
    txt = await p.innerText('#rvRoot'); ok(W + 'C: Import Review lists it with the reason and certainty', /Possible duplicate/i.test(txt) && /whole hours/.test(txt) && /Certainty: low/.test(txt), txt.slice(0, 600));
    ok(W + 'C: side-by-side comparison shown', await p.isVisible('#rvRoot .rv-cmp'));
    if (width === 390) await p.screenshot({ path: path.join(OUT, 'shots', 'dd-review-390.png'), fullPage: false }); else await p.screenshot({ path: path.join(OUT, 'shots', 'dd-review-1280.png'), fullPage: false });
    const before = await grossAll(p);
    await p.click('#rvRoot [data-act=rv-restore]');
    const dlg = await p.innerText('.ui-dlg, [role=dialog]'); ok(W + 'C: restoring explains the impact on your totals first', /overstated/.test(dlg) && /gross/.test(dlg), dlg);
    await confirmDialog(p); await until(p, () => TTDB.getAll('trades').then(l => l.length === 36));
    ok(W + 'C: restored as a separate trade -> 36 trades and P&L includes it', await nTrades(p) === 36 && await grossAll(p) !== before);
    await p.click('[data-act=rv-tab][data-tab=decided]'); await p.waitForSelector('#rvRoot [data-act=rv-undo]');
    await p.click('#rvRoot [data-act=rv-undo]'); await until(p, () => TTDB.getAll('trades').then(l => l.length === 35));
    ok(W + 'C: undo decision -> back to 35 trades and the original P&L', await nTrades(p) === 35 && await grossAll(p) === before);
    await p.click('[data-act=rv-tab][data-tab=todo]'); await p.waitForSelector('#rvRoot [data-act=rv-confirm]');
    await p.click('#rvRoot [data-act=rv-confirm]'); await until(p, () => !document.querySelector('#rvRoot [data-act=rv-confirm]'));
    await p.reload(); await p.evaluate(() => TTDB.ready()); await p.evaluate(() => TTNav.go('review')); await p.waitForSelector('#rvRoot .ui-tabs');
    await p.click('[data-act=rv-tab][data-tab=decided]'); await p.waitForTimeout(200);
    ok(W + 'C: the decision is kept after a reload, and the duplicate never counts', /confirmed duplicate/i.test(await p.innerText('#rvRoot')) && await nTrades(p) === 35 && await grossAll(p) === before);

    // ---- duplicates already inside the journal (e.g. an old backup restored with different ids)
    await p.evaluate(() => TTDB.getAll('trades').then(l => { const c = JSON.parse(JSON.stringify(l[0])); c.id = 'restoredcopy1'; c.importBatch = 'imp-old'; return TTDB.put('trades', c); }));
    await p.evaluate(() => TTReview.reload()); await p.click('[data-act=rv-tab][data-tab=todo]'); await p.waitForSelector('#rvRoot [data-group]');
    ok(W + 'scan: the same trade counted twice is reported', /counted 2 times/.test(await p.innerText('#rvRoot')));
    await p.click('#rvRoot [data-group] tr:last-child [data-act=rv-archive-copy]'); await confirmDialog(p);
    await until(p, () => TTDB.getAll('trades').then(l => l.length === 35)); ok(W + 'scan: archiving the extra copy -> 35 trades again', await nTrades(p) === 35 && await grossAll(p) === before);

    // ---- Scenario G: interrupted import (page closed during the preview) and retry
    await drop(p, perfCsv(A.slice(0, 25)), 'interrupted.csv');
    await p.reload(); await p.evaluate(() => TTDB.ready());
    ok(W + 'G: closing the page during the preview saved nothing', await nTrades(p) === 35);
    await drop(p, month, 'october-again.csv'); txt = await p.innerText('.im-sum');
    ok(W + 'G: retry after restart -> nothing new, nothing missing', /New trades\s*0/.test(txt) && /Exact duplicates \(skipped\)\s*35/.test(txt), txt);

    // ---- undo the monthly import: only its 15 trades go, the weekly 20 stay
    await p.evaluate(() => TTNav.go('import')); await p.evaluate(() => TTImportUI.reset()); await p.waitForSelector('#im-history');
    const rb = await p.$$('#im-history [data-act=im-rollback]'); // newest first: utc (nothing), A2 (nothing), october, week... find the october one
    const idx = await p.evaluate(() => TTImportUI.state.history.findIndex(h => h.fileName === 'october.csv'));
    const ids = await p.evaluate(() => TTImportUI.state.history.map(h => h.id)); await p.click('#im-history [data-act=im-rollback][data-id="' + ids[idx] + '"]'); await confirmDialog(p);
    await until(p, () => TTDB.getAll('trades').then(l => l.length === 20));
    ok(W + 'undo import: removes only what it added (20 left)', await nTrades(p) === 20 && await grossAll(p) === g20);

    // ---- layout: no horizontal overflow on these screens
    for (const v of ['import', 'review']) { await p.evaluate(x => TTNav.go(x), v); await p.waitForTimeout(200); ok(W + v + ': no horizontal overflow', await p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => [document.scrollingElement.scrollWidth, window.innerWidth])); }
    ok(W + 'no script errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ---- two tabs saving the same import at the same moment
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const a = await ctx.newPage(); await start(a); const b = await ctx.newPage(); await b.goto(URL); await b.evaluate(() => TTDB.ready());
    await drop(a, month, 'tab-a.csv'); await drop(b, month, 'tab-b.csv');
    await Promise.all([a.click('[data-act=im-tv-commit]'), b.click('[data-act=im-tv-commit]')]);
    await until(a, () => TTImportUI.state.step === 'done'); await until(b, () => TTImportUI.state.step === 'done');
    ok('two tabs: the same report saved from both at once -> 35 trades, not 70', await nTrades(a) === 35, await nTrades(a));
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? 'FAILED ' + pass + ' passed, ' + fail + ' failed' : 'ALL PASSED ' + pass + ' passed, 0 failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
