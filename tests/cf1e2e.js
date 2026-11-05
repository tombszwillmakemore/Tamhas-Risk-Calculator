// Cashflow end to end in a real browser (390 px and 1280 px): Cash History import, preview, duplicates, Performance overlap, reconciliation,
// explorer, export, undo, ZIP, spreadsheets refused, account panel, dashboard card, Risk Center estimate. Synthetic files only.
const { chromium } = require('./_pw'); const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { cashCsv, regressionRows } = require('./_cashgen.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const BASE = process.env.TT_BASE || 'http://127.0.0.1:8765', URL = BASE + '/index.html';
let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 500)); } };
const until = async (pg, fn, arg, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
const CASH = cashCsv(regressionRows(), { opening: 100 });
const PERF = ['symbol,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp'].concat([41.50, -12.00, 30.80, 43.00].map((p, i) => ['MNQZ6', 61 + i * 2, 62 + i * 2, 1, '21000.00', (21000 + p / 2).toFixed(2), p.toFixed(2), '11/0' + (3 + i) + '/2026 09:30:00', '11/0' + (3 + i) + '/2026 09:3' + i + ':00'].join(','))).join('\n');
function zip(name, data) { const n = Buffer.from(name), c = zlib.deflateRawSync(data), lh = Buffer.alloc(30), ch = Buffer.alloc(46), end = Buffer.alloc(22);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28);
  const cd = Buffer.concat([ch, n]); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + n.length + c.length, 16);
  return Buffer.concat([lh, n, c, cd, end]); }
(async () => {
  const browser = await chromium.launch();
  for (const width of [390, 1280]) {
    const W = width + 'px: ', ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true }), p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console:' + m.text()); });
    await p.goto(URL); await p.evaluate(() => TTDB.ready());
    await p.evaluate(() => TTDB.put('accounts', TTAccountsCore.newAccount({ id: 'acct-l', name: 'Tradovate live', category: 'live', startingBalance: '100', startedOn: '2026-11-01', broker: 'Tradovate', commission: '0.39', exchangeFee: '0.37' }, Date.parse('2026-11-01T00:00:00Z')).account));
    await p.evaluate(() => TTImportUI.reload());
    // ---- first run
    await p.evaluate(() => TTNav.go('cashflow')); await p.waitForSelector('#cfRoot .cf-first');
    ok(W + 'first run explains the steps and offers the import', /Export your Cash History/.test(await p.innerText('#cfRoot')));
    // ---- import the Cash History
    const drop = async (text, name) => { await p.evaluate(() => TTNav.go('import')); await p.evaluate(() => TTImportUI.reset()); await p.evaluate(([t, n]) => TTImportUI.intake([{ text: t, name: n }]), [text, name]); };
    await drop(CASH, 'cash-history.csv'); await p.waitForSelector('[data-cash-acct]');
    let t = await p.innerText('#iRoot');
    ok(W + 'recognised as a Tradovate Cash History, honestly labelled as not tested on a real file', /Tradovate Cash History/.test(t) && /Not yet tested on a real Cash History export/.test(t), t.slice(0, 400));
    ok(W + 'shows how the amounts are read and why', /Delta is the change and Amount is the cash balance after it/.test(t));
    ok(W + 'cannot import before the account is chosen', await p.isDisabled('[data-act=im-cash-commit]'));
    await p.selectOption('[data-cash-acct]', 'acct-l'); await until(p, () => !document.querySelector('[data-act=im-cash-commit][disabled]'));
    t = await p.innerText('#iRoot');
    ok(W + 'preview: 20 new records, fees −$60.16, change to cash +$43.14', /New records\s*20/.test(t) && /Fees\s*−\$60\.16/.test(t) && /Change to cash\s*\+\$43\.14/.test(t), t.slice(0, 1500));
    if (width === 390) await p.screenshot({ path: path.join(OUT, 'shots', 'cf-preview-390.png') });
    await p.click('[data-act=im-cash-commit]'); await until(p, () => TTImportUI.state.step === 'cashdone');
    ok(W + 'import finished: 20 cash records', /Added\s*20/i.test(await p.innerText('#iRoot')));
    // ---- Cashflow overview
    await p.click('[data-act=im-goto-cash]'); await p.waitForSelector('#cfRoot .cf-status');
    t = await p.innerText('#cfRoot');
    ok(W + 'status Reconciled, balance $143.14', /Reconciled/i.test(t) && /\$143\.14/.test(t), t.slice(0, 600));
    ok(W + 'net +$43.14, gross +$103.30, fees $60.16, starting $100.00', /\+\$43\.14/.test(t) && /\+\$103\.30/.test(t) && /\$60\.16/.test(t) && /\$100\.00/.test(t));
    ok(W + 'labelled as a historical snapshot, not live', /historical snapshot, not a live balance/.test(t));
    ok(W + 'fee breakdown by type', /Commissions[\s\S]*\$24\.96/.test(t) && /Exchange fees[\s\S]*\$22\.40/.test(t) && /Clearing fees[\s\S]*\$12\.16/.test(t) && /NFA\) fees[\s\S]*\$0\.64/.test(t));
    ok(W + 'explains profit vs balance line by line', /Why your profit differs from your balance/i.test(t));
    if (width === 390) await p.screenshot({ path: path.join(OUT, 'shots', 'cf-overview-390.png'), fullPage: true }); else await p.screenshot({ path: path.join(OUT, 'shots', 'cf-overview-1280.png') });
    // ---- same file again: nothing changes
    await drop(CASH, 'cash-history (2).csv'); await p.waitForSelector('[data-act=im-cash-commit]');
    t = await p.innerText('#iRoot'); ok(W + 're-import: 0 new, 20 already imported', /New records\s*0/.test(t) && /Already imported \(skipped\)\s*20/.test(t), t.slice(0, 800));
    await p.click('[data-act=im-cash-commit]'); await until(p, () => TTImportUI.state.step === 'cashdone');
    // ---- the Performance report for the same trades: no double counting
    await drop(PERF, 'performance.csv'); await p.waitForSelector('select[data-noacct]'); await p.selectOption('select[data-noacct]', 'acct-l'); await p.waitForTimeout(300);
    await p.click('[data-act=im-tv-commit]'); await until(p, () => TTImportUI.state.step === 'done');
    await p.evaluate(() => TTNav.go('cashflow')); await p.waitForSelector('#cfRoot .cf-status'); t = await p.innerText('#cfRoot');
    ok(W + 'after importing the Performance report too: still $143.14, the 4 trades listed as not counted', /\$143\.14/.test(t) && /4 journal trades inside the Cash History period/.test(t), t.slice(0, 2000));
    // ---- explorer
    await p.click('[data-act=cf-tab][data-tab=tx]'); await p.waitForSelector('.cf-tx');
    ok(W + 'explorer lists 20 records', /20 records/.test(await p.innerText('#cfRoot')));
    await p.selectOption('#cf-cat', 'commission'); await p.waitForTimeout(150); ok(W + 'filter by type: 4 commissions', /4 records/.test(await p.innerText('#cfRoot')));
    await p.click('.cf-tx [data-act=cf-src]'); ok(W + 'source row shown with file and line', /cash-history\.csv line \d+/.test(await p.innerText('.cf-src')));
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=cf-export]')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(W + 'export: CSV with header, 4 rows, source file and line', /^﻿date,time,account,category/.test(csv) && csv.trim().split('\r\n').length === 5 && /cash-history\.csv/.test(csv), csv.slice(0, 300));
    await p.click('[data-act=cf-clear]'); await p.fill('#cf-q', 'nfa'); await p.waitForTimeout(400); ok(W + 'search', /4 records/.test(await p.innerText('#cfRoot')));
    ok(W + 'cashflow: no horizontal overflow', await p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1));
    // ---- the account panel and the dashboard use the same engine
    await p.evaluate(() => TTNav.go('accounts')); await p.evaluate(() => TTAccounts.open('acct-l')); await p.waitForSelector('.lv-hero');
    t = await p.innerText('.lv-hero'); ok(W + 'account panel: same $143.14 and status', /\$143\.14/.test(t) && /Reconciled/i.test(t), t);
    await p.evaluate(() => TTNav.go('home')); ok(W + 'dashboard card shows the balance', await until(p, () => /Account balances[\s\S]*\$143\.14/i.test((document.querySelector('[data-widget=cash]') || {}).innerText || '')));
    // ---- Risk Center: estimate from account settings, only when tapped
    await p.evaluate(() => TTNav.go('risk')); await p.waitForSelector('#rk-fee');
    ok(W + 'risk: fee field not filled silently', (await p.inputValue('#rk-fee')) === '' && !(await p.$('[data-act=rk-acctfee]')));
    await p.selectOption('#rk-acct', 'acct-l'); await p.waitForSelector('[data-act=rk-acctfee]');
    await p.click('[data-act=rk-acctfee]'); ok(W + 'risk: account fee estimate (0.39+0.37)x2 = 1.52, labelled as an estimate', (await p.inputValue('#rk-fee')) === '1.52' && /Estimate from your account settings/.test(await p.innerText('#view-risk')));
    // ---- undo the Cash History import
    await p.evaluate(() => TTNav.go('import')); await p.evaluate(() => TTImportUI.reset()); await p.waitForSelector('#im-history');
    const cashId = await p.evaluate(() => TTImportUI.state.history.filter(h => h.mode === 'cash' && h.counts.records)[0].id);
    await p.click('[data-act=im-rollback][data-id="' + cashId + '"]'); await p.click('[data-r=ok]'); await until(p, () => TTDB.getAll('ledger').then(l => !l.some(x => x.type === 'cash')));
    await p.evaluate(() => TTNav.go('cashflow')); await p.waitForSelector('[data-act=cf-tab][data-tab=overview]'); await p.click('[data-act=cf-tab][data-tab=overview]'); await p.waitForSelector('#cfRoot .cf-status'); t = await p.innerText('#cfRoot');
    ok(W + 'undo: cash records gone; balance rebuilt from the journal trades ($100 + 103.30 gross − estimated fees), not confirmed', !/Reconciled\b/.test(t.split('\n').slice(0, 8).join(' ')) && /Partially reconciled|Estimated/i.test(t), t.slice(0, 500));
    // ---- ZIP, spreadsheets, interpretation questions
    await p.evaluate(() => TTNav.go('import')); await p.evaluate(() => TTImportUI.reset());
    await p.setInputFiles('#im-file', { name: 'statements.zip', mimeType: 'application/zip', buffer: zip('cash-history.csv', Buffer.from(CASH)) });
    ok(W + 'ZIP archive opened safely and recognised', await until(p, () => TTImportUI.state.step === 'cash'));
    await p.evaluate(() => TTImportUI.reset()); await p.setInputFiles('#im-file', { name: 'statement.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004') });
    ok(W + 'spreadsheet refused with a clear request to save as CSV', await until(p, () => /save it as CSV/.test(document.getElementById('iRoot').innerText)));
    await p.evaluate(() => TTImportUI.reset()); await p.evaluate(() => TTImportUI.intake([{ text: 'timestamp,cashChangeType,amount\n2026-11-03 09:00:00,Commission,1.24\n2026-11-03 09:00:01,TradePaired,10.00', name: 'positive-fees.csv' }]));
    await p.waitForSelector('[data-cash-mode]'); ok(W + 'ambiguous signs: TRC asks, import blocked until you choose', await p.isDisabled('[data-act=im-cash-commit]') && /cannot tell whether they are charges/.test(await p.innerText('#iRoot')));
    ok(W + 'no script errors', errors.length === 0, errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? 'FAILED ' + pass + ' passed, ' + fail + ' failed' : 'ALL PASSED ' + pass + ' passed, 0 failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message.split('\n').slice(0, 4).join(' | '), 'after', pass, 'passed'); process.exit(1); });
