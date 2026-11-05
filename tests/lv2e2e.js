// Personal live accounts (Part 19 D, E) and journal protection (Part 12) in a real browser, at 390 px and 1280 px. Synthetic data only.
const { chromium } = require('./_pw'); const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const BASE = process.env.TT_BASE || 'http://127.0.0.1:8765', URL = BASE + '/index.html';
let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 500)); } };
const until = async (pg, fn, arg, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(40); } return false; };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
(async () => {
  const browser = await chromium.launch();
  for (const width of [390, 1280]) {
    const W = width + 'px: ', ctx = await browser.newContext({ viewport: { width, height: 900 } }), p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console:' + m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto(URL); await p.evaluate(() => TTDB.ready());

    // ---- Scenario D: create a Tradovate personal live account with $100 through the form
    await p.evaluate(() => TTNav.go('accounts')); await p.click('[data-act=a-new]'); await p.waitForSelector('#n-type');
    ok(W + 'D: personal live is the default type', await p.inputValue('#n-type') === 'personal-live');
    const types = await p.$$eval('#n-type option', o => o.map(x => x.textContent));
    ok(W + 'D: five account types offered', types.length === 5 && /Personal live/.test(types[0]) && /demo \/ paper/i.test(types[1]) && /evaluation/.test(types[2]) && /funded/.test(types[3]) && /Other/.test(types[4]), types);
    ok(W + 'D: Tradovate is a broker option', (await p.$$eval('#n-broker option', o => o.map(x => x.textContent))).includes('Tradovate'));
    ok(W + 'D: no prop-firm fields for a personal account', !(await p.$('#n-firm')) && /No prop-firm rules apply/.test(await p.innerText('#aRoot')));
    await p.fill('#n-name', 'My Tradovate'); await p.fill('#n-bal', '100'); await p.fill('#n-start', '2026-11-01'); await p.fill('#n-com', '0.39');
    await p.click('[data-act=n-save]'); await p.waitForSelector('.lv-hero');
    let t = await p.innerText('#aRoot');
    ok(W + 'D: card says PERSONAL LIVE and TRADOVATE', /PERSONAL LIVE/.test(t) && /TRADOVATE/.test(t), t.slice(0, 300));
    ok(W + 'D: balance $100.00, no drawdown/evaluation/payout/profit target', /\$100\.00/.test(await p.innerText('.lv-hero')) && !/Drawdown & evaluation|evaluation tracker|Payout readiness|Profit target|RULES NOT CONFIRMED/i.test(t), t.slice(0, 900));
    const acctId = await p.evaluate(() => TTAccounts.list().filter(a => a.name === 'My Tradovate')[0].id);

    // ---- Scenario E: deposit, withdrawal, a winning trade and its fee
    const addEntry = async (kind, amount, extra) => {
      await p.click('[data-act=lv-open][data-kind=' + kind + ']'); await p.waitForSelector('.lv-form');
      if (kind === 'snapshot') await p.fill('#lf-balance', amount); else await p.fill('#lf-amount', amount);
      if (extra && extra.dir) await p.check('input[name=lf-dir][value=' + extra.dir + ']'); if (extra && extra.note != null) await p.fill('#lf-note', extra.note);
      await p.click('[data-act=lv-save]'); await p.waitForTimeout(250);
    };
    await addEntry('deposit', '50'); await addEntry('withdrawal', '10');
    await p.evaluate(id => TTDB.put('trades', TTJournalCore.normalizeTrade({ id: 'lvT1', date: '2026-11-03', time: '09:31', contract: 'MNQ', side: 'long', contracts: 1, entry: 21000, exits: [{ qty: 1, price: 21015 }], feesCents: 500, accountId: id }).trade), acctId);
    await p.evaluate(() => { window.dispatchEvent(new Event('tt:journal-changed')); }); await until(p, () => /\$165\.00/.test((document.querySelector('.lv-hero') || {}).innerText || ''));
    t = await p.innerText('#aRoot');
    ok(W + 'E: balance $165.00 = 100 + 30 - 5 + 50 - 10', /\$165\.00/.test(await p.innerText('.lv-hero')), await p.innerText('.lv-hero'));
    ok(W + 'E: net trading P&L +$25.00, deposit and withdrawal shown separately', /Net trading P&L[\s\S]{0,120}\+\$25\.00/.test(t) && /Deposits[\s\S]{0,40}\+\$50\.00/.test(t) && /Withdrawals[\s\S]{0,40}−\$10\.00/.test(t), t.slice(0, 1200));
    // adjustments need a reason; voiding keeps history
    await addEntry('adjustment', '2.50', { dir: 'down', note: '' });
    ok(W + 'adjustment without a reason is refused', /reason/i.test(await p.innerText('.lv-form')));
    await p.fill('#lf-note', 'broker data fee correction'); await p.click('[data-act=lv-save]'); await until(p, () => /\$162\.50/.test(document.querySelector('.lv-hero').innerText));
    ok(W + 'adjustment down 2.50 -> $162.50', /\$162\.50/.test(await p.innerText('.lv-hero')));
    await p.click('[data-lv] summary'); await p.click('[data-lv] .t-rec:first-child [data-act=lv-void]'); await until(p, () => /\$165\.00/.test(document.querySelector('.lv-hero').innerText));
    ok(W + 'void the adjustment -> $165.00 again, entry kept as VOIDED', /\$165\.00/.test(await p.innerText('.lv-hero')) && /VOIDED/.test(await p.innerText('#aRoot')));
    await addEntry('snapshot', '160');
    t = await p.innerText('#aRoot'); ok(W + 'broker balance 160 vs calculated 165 -> unexplained difference flagged', /Broker balance \$160\.00/.test(t) && /difference −\$5\.00/.test(t) && /Unexplained difference/.test(t), t.slice(0, 1500));
    if (width === 390) await p.screenshot({ path: path.join(OUT, 'shots', 'lv-account-390.png'), fullPage: true }); else await p.screenshot({ path: path.join(OUT, 'shots', 'lv-account-1280.png'), fullPage: false });
    ok(W + 'accounts: no horizontal overflow', await p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1));
    // starting balance edit is logged
    await p.click('[data-ded] > summary'); await p.fill('#de-bal', '150'); await p.fill('#de-note', 'statement correction'); await p.click('[data-act=de-save]');
    await until(p, () => /\$215\.00/.test(document.querySelector('.lv-hero').innerText));
    ok(W + 'starting balance edit recalculates ($215.00) and is kept in the change history', /\$215\.00/.test(await p.innerText('.lv-hero')) && await p.evaluate(() => TTAccounts.list().some(a => (a.changeLog || []).some(x => x.field === 'startingBalanceCents' && x.from === 10000 && x.to === 15000 && x.note === 'statement correction'))));

    // ---- journal protection
    await p.evaluate(() => TTNav.go('journal')); ok(W + 'journal shows what is saved now when opened', await until(p, () => window.TTJournalExt && TTJournalExt.ctx.state.trades.some(x => x.id === 'lvT1')));
    // a stale screen never overwrites a newer saved version
    await p.evaluate(() => TTJournalExt.ctx.openTrade('lvT1')); await p.waitForTimeout(300);
    await p.click('[data-act=edit][data-id=lvT1]'); await p.waitForSelector('#f-notes');
    await p.evaluate(() => TTDB.get('trades', 'lvT1').then(x => { x.notes = 'changed in another tab'; return TTDB.put('trades', x); }));
    await p.fill('#f-notes', 'typed here'); await p.click('[data-act=save]'); await until(p, () => !document.getElementById('fErrs').hidden);
    ok(W + 'stale edit: not saved, explained, form stays open', /changed somewhere else/.test(await p.innerText('#fErrs')) && await p.isVisible('#f-notes'));
    ok(W + 'stale edit: the other change was not overwritten', (await p.evaluate(() => TTDB.get('trades', 'lvT1'))).notes === 'changed in another tab');
    await p.click('[data-act=save]'); await until(p, () => !document.getElementById('f-notes'));
    ok(W + 'saving again after the reload works', (await p.evaluate(() => TTDB.get('trades', 'lvT1'))).notes === 'typed here');
    // a new trade identical to an existing one asks first
    await p.evaluate(() => { const S = TTJournalExt.ctx.state, tr = JSON.parse(JSON.stringify(S.trades.filter(x => x.id === 'lvT1')[0])); delete tr.id; S.editing = { id: null, trade: tr, shots: { before: { dataUrl: null, changed: false, removed: false, had: false }, after: { dataUrl: null, changed: false, removed: false, had: false } } }; TTJournalExt.ctx.render(); });
    await p.waitForSelector('#f-notes'); await p.click('[data-act=save]'); await p.waitForSelector('[data-r=ok]');
    ok(W + 'duplicate manual trade: warned before saving', /may already be in your journal/.test(await p.innerText('[role=dialog], .ui-dlg')));
    await p.click('[data-r=cancel]'); await p.waitForTimeout(200);
    ok(W + '...and not saved when cancelled', (await p.evaluate(() => TTDB.getAll('trades'))).length === 1);
    // double tap on SAVE saves once
    await p.evaluate(() => { const S = TTJournalExt.ctx.state; S.editing = null; TTJournalExt.ctx.render(); }); await p.click('[data-act=new]'); await p.waitForSelector('#f-entry');
    await p.fill('#f-qty', '1'); await p.fill('#f-entry', '6800'); await p.fill('#f-stop', '6790');
    await p.evaluate(() => { const b = document.querySelector('[data-act=save]'); b.click(); b.click(); });
    await until(p, () => TTDB.getAll('trades').then(l => l.length === 2)); await p.waitForTimeout(400);
    ok(W + 'double tap on SAVE -> exactly one new trade', (await p.evaluate(() => TTDB.getAll('trades'))).length === 2);
    // delete with UNDO
    const newId = await p.evaluate(() => TTDB.getAll('trades').then(l => l.filter(x => x.id !== 'lvT1')[0].id));
    await p.evaluate(id => { TTJournalExt.ctx.state.expanded = id; TTJournalExt.ctx.render(); }, newId); await p.click('[data-act=delete][data-id="' + newId + '"]');
    await until(p, () => !!document.querySelector('[data-act=undo-del]')); ok(W + 'delete offers UNDO', (await p.evaluate(() => TTDB.getAll('trades'))).length === 1);
    await p.click('[data-act=undo-del]'); await until(p, () => TTDB.getAll('trades').then(l => l.length === 2));
    ok(W + 'UNDO DELETE puts the trade back', (await p.evaluate(id => TTDB.get('trades', id), newId)) != null);
    ok(W + 'no script errors', errors.length === 0, errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? 'FAILED ' + pass + ' passed, ' + fail + ' failed' : 'ALL PASSED ' + pass + ' passed, 0 failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message.split('\n').slice(0, 4).join(' | '), 'after', pass, 'passed'); process.exit(1); });
