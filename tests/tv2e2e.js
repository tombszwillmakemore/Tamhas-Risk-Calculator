// Tradovate Smart Import - full user journeys in a real browser (Chromium), phone and desktop widths, dark and light themes.
// All report files are SYNTHETIC (tests/fixtures). The screenshot is a synthetic Orders-style table rendered by the test itself.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true }); const FX = path.join(__dirname, 'fixtures') + '/';
const URL = (process.env.TT_BASE || 'http://127.0.0.1:8765') + '/index.html';
let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } };
const until = async (pg, fn, arg, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
const txt = p => p.evaluate(() => document.getElementById('iRoot').textContent.replace(/\s+/g, ' '));
const W = (n, s) => { const f = path.join(OUT, n); fs.writeFileSync(f, s); return f; };
const H = 'orderId,Account,B/S,Contract,Product,avgPrice,filledQty,Fill Time,Status,Filled Qty,Avg Fill Price';
(async () => {
  const browser = await chromium.launch();
  for (const [theme, width] of [['dark', 390], ['light', 1280]]) {
    const T = theme + '@' + width + ': ';
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }); const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
    await p.goto(URL); await p.evaluate(() => TTDB.ready());
    if (theme === 'light') { await p.evaluate(() => localStorage.setItem('tt.theme', 'light')); await p.reload(); await p.evaluate(() => TTDB.ready()); }
    ok(T + 'theme applied', await p.evaluate(t => document.documentElement.getAttribute('data-theme') === t, theme));
    // entry points
    ok(T + 'Home has Import Trades button', await p.isVisible('#homeImport'));
    await p.click('#homeImport'); await p.waitForSelector('#im-drop'); ok(T + 'Home button opens Import', await p.evaluate(() => location.hash === '#import'));
    await p.evaluate(() => TTNav.go('journal')); await p.waitForSelector('#jRoot .import-cta');
    const jb = await p.evaluate(() => { const a = document.querySelector('#jRoot .j-actions'); return a && a.firstElementChild.classList.contains('import-cta') && !!a.querySelector('[data-act=new]'); });
    ok(T + 'Journal: Import Trades is the primary action, manual is secondary', jb);
    await p.click('#jRoot .import-cta'); await p.waitForSelector('#im-drop');
    await p.evaluate(() => TTNav.go('more')); ok(T + 'More hub lists Import trades', /Import trades/.test(await p.innerText('#hubRoot')));
    await p.evaluate(() => TTNav.go('import')); await p.waitForSelector('#im-drop');
    ok(T + 'drop zone is keyboard focusable', await p.evaluate(() => document.getElementById('im-drop').tabIndex === 0));
    ok(T + 'export guide present with honest note', /Performance/.test(await txt(p)) && /could not be checked here/.test(await txt(p)));
    ok(T + 'no horizontal scroll on Import', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

    // 1. Orders CSV: account must be chosen, then import
    await p.setInputFiles('#im-file', FX + 'tradovate-orders-synthetic.csv'); await p.waitForSelector('[data-rawacct]');
    let t = await txt(p);
    ok(T + 'orders: recognised as Tradovate Orders report', /Tradovate Orders report/.test(t), t.slice(0, 300));
    ok(T + 'orders: blocked until the account is chosen', /Choose a journal account for "DEMO1234"/.test(t) && await p.isDisabled('[data-act=im-tv-commit]'));
    ok(T + 'orders: commissions reported missing', /no commissions/.test(t)); ok(T + 'orders: fees shown as Unavailable', /Unavailable/.test(t));
    await p.selectOption('[data-rawacct="DEMO1234"]', 'acct-default'); await until(p, () => { const b = document.querySelector('[data-act=im-tv-commit]'); return b && !b.disabled; });
    ok(T + 'orders: 1 trade ready, $59.50 gross shown', /\+\$59\.50/.test(await txt(p)), (await txt(p)).slice(0, 500));
    await p.click('[data-act=im-tv-commit]'); await p.waitForSelector('.im-done');
    t = await txt(p); ok(T + 'orders: success summary shows 1 imported', /Import finished/.test(t) && /Imported\s*1/.test(t), t.slice(0, 300));
    let saved = await p.evaluate(async () => { const ts = await TTDB.getAll('trades'); return ts.map(x => ({ c: x.contract, s: x.side, q: x.contracts, ex: x.exits.length, f: x.feesCents, src: x.srcInfo, a: x.accountId })); });
    ok(T + 'orders: saved trade correct, fees unknown, provenance kept', saved.length === 1 && saved[0].c === 'MNQ' && saved[0].ex === 2 && saved[0].f === null && saved[0].src.broker === 'tradovate' && saved[0].a === 'acct-default', saved);
    await p.click('[data-act=im-goto-journal]'); await p.waitForSelector('#jRoot'); await until(p, () => /MNQ/.test(document.getElementById('jRoot').innerText));
    ok(T + 'journal shows the imported trade', /MNQ/.test(await p.innerText('#jRoot')));
    ok(T + 'home P&L/dashboard refresh event did not error', !errors.some(e => /TypeError|ReferenceError/.test(e)), errors);

    // 2. same report again: remembered account, everything a duplicate
    await p.evaluate(() => TTNav.go('import')); await p.waitForSelector('#im-file'); await p.setInputFiles('#im-file', FX + 'tradovate-orders-synthetic.csv'); await p.waitForSelector('[data-act=im-cancel]');
    t = await txt(p); ok(T + 're-import: account remembered (no blocker)', !/Choose a journal account/.test(t)); ok(T + 're-import: nothing new', /Nothing new to import/.test(t) && /Already in journal\s*1/.test(t), t.slice(0, 400));
    await p.click('[data-act=im-cancel]');

    // 3. Performance report: no account column -> must choose; reconciliation matches
    await p.setInputFiles('#im-file', FX + 'tradovate-performance-synthetic.csv'); await p.waitForSelector('[data-noacct]');
    ok(T + 'performance: asks which account (no account column)', /has no account column/.test(await txt(p)) && await p.isDisabled('[data-act=im-tv-commit]'));
    await p.selectOption('[data-noacct]', 'acct-default'); await until(p, () => /All 2 closed trades match/.test(document.getElementById('iRoot').innerText));
    ok(T + 'performance: every trade matches the report P&L', /All 2 closed trades match/.test(await txt(p)));
    await p.fill('#im-total', '0'); await p.click('[data-act=im-recheck]'); await until(p, () => /You entered 0.00/.test(document.getElementById('iRoot').innerText));
    ok(T + 'performance: typed total compared', /You entered 0\.00.*0\.00 gross/.test(await txt(p)));
    await p.click('[data-act=im-tv-commit]'); await p.waitForSelector('.im-done'); ok(T + 'performance: 2 imported', /Imported\s*2/.test(await txt(p)));

    // 4. wrong P&L in file -> must tick "I checked"
    const bad = fs.readFileSync(FX + 'tradovate-performance-synthetic.csv', 'utf8').replace(/5101/g, '6101').replace(/5102/g, '6102').replace(/5103/g, '6103').replace(/5201/g, '6201').replace(/5202/g, '6202').replace(/10\/22\/2026/g, '10/23/2026').replace('$21.00', '$25.00');
    await p.click('[data-act=im-cancel]'); await p.setInputFiles('#im-file', W('perf-bad.csv', bad)); await p.waitForSelector('[data-noacct]');
    await p.selectOption('[data-noacct]', 'acct-default'); await until(p, () => !!document.getElementById('im-okmis'));
    ok(T + 'mismatch: flagged and import blocked', /do not match/.test(await txt(p)) && await p.isDisabled('[data-act=im-tv-commit]'));
    await p.check('#im-okmis'); await until(p, () => !document.querySelector('[data-act=im-tv-commit]').disabled); ok(T + 'mismatch: allowed after confirming', !(await p.isDisabled('[data-act=im-tv-commit]')));
    await p.click('[data-act=im-cancel]');

    // 5. paste a copied table (tab separated)
    await p.click('[data-act=im-paste-toggle]'); await p.fill('#im-paste', [H, '7001,DEMO1234,Buy,MESZ6,MES,6000.25,1,10/24/2026 10:00:00,Filled,1,6000.25', '7002,DEMO1234,Sell,MESZ6,MES,6002.25,1,10/24/2026 10:05:00,Filled,1,6002.25'].join('\n').replace(/,/g, '\t'));
    await p.click('[data-act=im-paste-read]'); await p.waitForSelector('[data-act=im-tv-commit]');
    ok(T + 'paste: recognised and remembered account used', /Tradovate Orders report/.test(await txt(p)) && !(await p.isDisabled('[data-act=im-tv-commit]')));
    ok(T + 'paste: $10.00 trade', /\+\$10\.00/.test(await txt(p)));
    // untick it -> nothing to import
    await p.uncheck('[data-on]'); await until(p, () => !document.querySelector('[data-act=im-tv-commit]') || /IMPORT 0/.test(document.getElementById('iRoot').innerText) || /Nothing new/.test(document.getElementById('iRoot').innerText) || /Ready to import\s*0/.test(document.getElementById('iRoot').innerText));
    ok(T + 'paste: unticked trade is excluded', /Ready to import\s*0/.test(await txt(p)));
    await p.click('[data-act=im-cancel]');

    // 6. fee settings: your commission per contract is applied and labelled
    await p.evaluate(() => { document.getElementById('im-settings').open = true; }); await p.fill('#im-fee-MES', '0.35'); await p.click('[data-act=im-save-settings]'); await p.waitForTimeout(200);
    await p.setInputFiles('#im-file', W('mes.csv', [H, '7101,DEMO1234,Buy,MESZ6,MES,6000.25,2,10/24/2026 11:00:00,Filled,2,6000.25', '7102,DEMO1234,Sell,MESZ6,MES,6001.25,2,10/24/2026 11:05:00,Filled,2,6001.25'].join('\n'))); await p.waitForSelector('[data-act=im-tv-commit]');
    ok(T + 'fees: 4 sides x $0.35 = $1.40 from your settings', /\$1\.40/.test(await txt(p)) && /your settings/.test(await txt(p)), (await txt(p)).slice(0, 600));
    await p.click('[data-act=im-tv-commit]'); await p.waitForSelector('.im-done');
    const fee = await p.evaluate(async () => (await TTDB.getAll('trades')).filter(x => x.contract === 'MES')[0]);
    ok(T + 'fees: saved with feeSource template', fee && fee.feesCents === 140 && fee.feeSource === 'template', fee);

    // 7. rollback the MES import from history
    await p.click('[data-act=im-cancel]'); const before = await p.evaluate(async () => (await TTDB.getAll('trades')).length);
    await p.click('[data-act=im-rollback] >> nth=0'); await p.click('.ui-dlg [data-r=ok]'); await until(p, async () => (await TTDB.getAll('trades')).length < 999);
    await until(p, async () => (await TTDB.getAll('trades')).length === 3);
    ok(T + 'rollback removes only that import', (await p.evaluate(async () => (await TTDB.getAll('trades')).length)) === before - 1, before);
    ok(T + 'history shows rolled back + counts', /rolled back/.test(await txt(p)) && /found/.test(await txt(p)));

    // 8. summary-only report kept as reference, no trades
    await p.setInputFiles('#im-file', W('summary.csv', 'Account,Net Liq,Cash Balance,Total PnL\nDEMO1234,50120.50,50000.00,120.50\n')); await p.waitForSelector('[data-act=im-tv-commit]');
    ok(T + 'summary: recognised as no-trade report', /no individual trades/.test(await txt(p)) || /no trades can be built/.test(await txt(p)));
    const n0 = await p.evaluate(async () => (await TTDB.getAll('trades')).length); await p.click('[data-act=im-tv-commit]'); await p.waitForSelector('.im-done');
    ok(T + 'summary: saved as reference, no trades added', (await p.evaluate(async () => (await TTDB.getAll('trades')).length)) === n0 && /reference/.test(await txt(p)));

    // 9. generic CSV still goes to the column mapper
    await p.click('[data-act=im-cancel]'); await p.setInputFiles('#im-file', W('generic.csv', 'Time,Symbol,Side,Qty,Price\n2026-10-20 09:31:00,NQ,Buy,1,20000.00\n2026-10-20 09:35:00,NQ,Sell,1,20005.00\n')); await p.waitForSelector('#im-mode');
    ok(T + 'generic CSV -> column mapper', /Map the columns/.test(await txt(p)) && !/Tradovate/.test((await txt(p)).slice(0, 200)));
    await p.click('[data-act=im-restart]');

    // 10. large report: 2,000 trades
    const big = [H]; for (let i = 0; i < 2000; i++) { const s = 3600 + i * 10, f = x => [Math.floor(x / 3600), Math.floor(x / 60) % 60, x % 60].map(v => String(v).padStart(2, '0')).join(':'); big.push((90000 + 2 * i) + ',DEMO1234,Buy,MNQZ6,MNQ,21000.25,1,10/27/2026 ' + f(s) + ',Filled,1,21000.25'); big.push((90001 + 2 * i) + ',DEMO1234,Sell,MNQZ6,MNQ,21001.00,1,10/27/2026 ' + f(s + 5) + ',Filled,1,21001.00'); }
    let t0 = Date.now(); await p.setInputFiles('#im-file', W('big.csv', big.join('\n'))); await p.waitForSelector('[data-act=im-more]', { timeout: 30000 }); const prevMs = Date.now() - t0;
    ok(T + 'large: preview of 2,000 trades in under 10 s (' + prevMs + ' ms)', prevMs < 10000); ok(T + 'large: shows first 50 with SHOW MORE', /SHOW 50 MORE/.test(await txt(p)));
    ok(T + 'large: DOM stays small', await p.evaluate(() => document.getElementsByTagName('*').length < 8000));
    t0 = Date.now(); await p.click('[data-act=im-tv-commit]'); await p.waitForSelector('.im-done', { timeout: 30000 }); ok(T + 'large: commit 2,000 in under 10 s (' + (Date.now() - t0) + ' ms)', Date.now() - t0 < 10000);
    ok(T + 'large: all saved', (await p.evaluate(async () => (await TTDB.getAll('trades')).filter(x => x.contract === 'MNQ').length)) === 2002);
    ok(T + 'no horizontal scroll after import', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: path.join(OUT, 'shots', 'tv-' + theme + '-' + width + '.png'), fullPage: false });
    ok(T + 'no page errors', !errors.length, errors);
    await ctx.close();
  }

  // 11. screenshot import (on-device text reader), phone width, fresh database
  {
    const T = 'screenshot: '; const sp = await browser.newPage({ viewport: { width: 1100, height: 360 } });
    const rows = [['DEMO1234', 'Sell', 'MNQZ6', '1', '21020.00', '10/21/2026 09:47:12', 'Filled'], ['DEMO1234', 'Sell', 'MNQZ6', '1', '21010.25', '10/21/2026 09:41:03', 'Filled'], ['DEMO1234', 'Buy', 'MNQZ6', '2', '21000.25', '10/21/2026 09:31:07', 'Filled']];
    await sp.setContent('<body style="margin:0;background:#1b1f27;color:#d8dee9;font:13px Arial"><div style="padding:10px"><table style="border-collapse:collapse"><tr>' + ['Account', 'B/S', 'Contract', 'Filled Qty', 'Avg Fill Price', 'Fill Time', 'Status'].map(h => '<th style="text-align:left;padding:6px 14px">' + h + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map(c => '<td style="padding:6px 14px">' + c + '</td>').join('') + '</tr>').join('') + '</table></div></body>');
    fs.writeFileSync(path.join(OUT, 'orders-shot.png'), await sp.screenshot({ fullPage: true })); await sp.close();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    const ext = []; p.on('request', r => { const u = r.url(); if (!u.startsWith(URL.replace('/index.html', '')) && !u.startsWith('blob:') && !u.startsWith('data:')) ext.push(u); });
    await p.goto(URL); await p.evaluate(() => TTDB.ready()); await p.evaluate(() => TTNav.go('import')); await p.waitForSelector('#im-file');
    await p.setInputFiles('#im-file', path.join(OUT, 'orders-shot.png'));
    ok(T + 'progress shown with Cancel while reading', await until(p, () => !!document.querySelector('[data-act=im-ocr-cancel]') || !!document.querySelector('.im-grid'), null, 5000));
    await p.waitForSelector('.im-grid', { timeout: 60000 });
    const grid = await p.evaluate(() => Array.from(document.querySelectorAll('.im-grid tbody tr')).map(tr => Array.from(tr.querySelectorAll('input')).map(i => i.value)));
    ok(T + 'all 3 rows read', grid.length === 3, grid); ok(T + 'prices read exactly', grid.map(r => r[4]).join() === '21020.00,21010.25,21000.25', grid); ok(T + 'times read', grid[2][5] === '10/21/2026 09:31:07', grid);
    await p.click('[data-act=im-review-ok]'); await p.waitForSelector('[data-rawacct]'); await p.selectOption('[data-rawacct="DEMO1234"]', 'acct-default');
    await until(p, () => /\+\$59\.50/.test(document.getElementById('iRoot').innerText));
    ok(T + 'same $59.50 trade as the CSV', /\+\$59\.50/.test(await txt(p)));
    await p.click('[data-act=im-tv-commit]'); await p.waitForSelector('.im-done'); ok(T + 'imported', /Imported\s*1/.test(await txt(p)));
    // the same trades arriving from the CSV report are recognised as possible duplicates
    await p.click('[data-act=im-cancel]'); await p.setInputFiles('#im-file', FX + 'tradovate-orders-synthetic.csv'); await p.waitForSelector('[data-act=im-cancel]');
    ok(T + 'CSV of the same trades -> held as possible duplicate', /Needs your review \(1\)/.test(await txt(p)) && /Ready to import\s*0/.test(await txt(p)), (await txt(p)).slice(0, 500));
    ok(T + 'nothing was requested from other sites', !ext.length, ext); ok(T + 'no page errors', !errors.length, errors);
    await ctx.close();
  }
  await browser.close();
  console.log((fail ? 'FAILED ' + fail + ' / passed ' + pass : 'ALL PASSED ' + pass)); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
