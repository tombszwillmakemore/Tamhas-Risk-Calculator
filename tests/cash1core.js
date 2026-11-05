// Cash accounting engine - pure-logic tests (Parts 2-7, 17-19 of the Cashflow brief). All files synthetic (tests/_cashgen.js).
const path = require('path'), R = path.join(__dirname, '..', 'assets') + '/';
global.TTSessions = require(R + 'sessions.js'); global.TTInstruments = require(R + 'instruments.js');
const J = require(R + 'journal-core.js'); global.TTDedupe = require(R + 'dedupe-core.js'); global.TTImport = require(R + 'import-core.js'); const I = global.TTImport;
const C = require(R + 'cash-core.js'), A = require(R + 'accounts-core.js');
const { cashCsv, regressionRows } = require('./_cashgen.js');
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 600)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const NOW = Date.parse('2026-11-07T12:00:00Z');
const acct = (o) => A.normalizeAccount(Object.assign(A.newAccount({ id: 'acct-l', name: 'Tradovate live', category: 'live', startingBalance: '100', startedOn: '2026-11-01' }, Date.parse('2026-11-01T00:00:00Z')).account, o || {}));
let bn = 0;
// imports a Cash History text into `ledger` (array). Returns {plan, added}.
function importCash(ledger, text, o) {
  o = Object.assign({ accountMap: { 'DEMO-L1': 'acct-l', 'DEMO-L2': 'acct-2' }, fileTz: 'as-is', targetTz: 'America/New_York' }, o || {});
  const parsed = I.parseCsv(text); const det = C.detect(parsed); if (!det) return { det: null };
  const interp = C.interpret(parsed, det.cols, o.choice || null); const batch = 'cb' + (bn++);
  const rd = C.read(parsed, det, Object.assign({}, o, { interp, file: o.file || 'cash.csv', batchId: batch }));
  if (rd.blocked) return { det, interp, rd };
  const cl = C.classify(rd.entries, ledger);
  if (o.replaceConflicts) cl.conflict.forEach(x => { const i = ledger.findIndex(l => l.id === x.existing.id); ledger[i] = C.toLedger(x.e, batch, 1); });
  cl.add.forEach(e => ledger.push(C.toLedger(e, batch, 1)));
  return { det, interp, rd, cl, added: cl.add.length };
}
const sum = (a, l, o) => C.summarize(a, l, o && o.rows || [], Object.assign({ now: NOW }, o || {}));

/* ---------- regression from the brief ---------- */
let L = [], r = importCash(L, cashCsv(regressionRows(), { opening: 100 }));
ok('detected as Tradovate Cash History', r.det && r.det.report === 'cash' && r.det.verified === 'documented-fields', r.det);
eq('reading proven from the file: Delta = change, Amount = balance after', r.interp.mode, 'delta+balance');
eq('20 records read, none held or invalid', [r.rd.entries.length, r.rd.held.length, r.rd.invalid.length], [20, 0, 0]);
let s = sum(acct(), L);
eq('regression: gross +103.30, commissions 24.96, exchange 22.40, clearing 12.16, NFA 0.64', [s.totals.grossCents, -s.totals.byCat.commission, -s.totals.byCat.exchange_fee, -s.totals.byCat.clearing_fee, -s.totals.byCat.regulatory_fee], [10330, 2496, 2240, 1216, 64]);
eq('regression: total fees 60.16, net trading +43.14', [s.totals.feesCents, s.totals.netTradingCents], [6016, 4314]);
eq('regression: ending balance EXACTLY $143.14', s.balanceCents, 14314);
eq('regression: reconciled against the broker running balance, difference 0', [s.status, s.checkpoints.length, s.checkpoints.every(c => c.diffCents === 0)], ['reconciled', 20, true]);
eq('formatting', [C.fmt(s.balanceCents), C.fmt(s.totals.netTradingCents, 'USD', true), C.fmt(-6016)], ['$143.14', '+$43.14', '−$60.16']);
ok('every figure has a source trail', s.trail.cash.length === 20 && L.every(l => l.source.file === 'cash.csv' && l.source.line >= 2 && l.source.raw.length > 5));
// re-import: nothing changes
r = importCash(L, cashCsv(regressionRows(), { opening: 100 }), { file: 'cash (copy).csv' });
eq('re-importing the same file (other name) adds nothing', [r.added, r.cl.dup.length, L.length, sum(acct(), L).balanceCents], [0, 20, 20, 14314]);
r = importCash(L, cashCsv(regressionRows(), { opening: 100, reverse: true }));
eq('newest-first file: same records recognised', [r.added, sum(acct(), L).balanceCents], [0, 14314]);
// Performance / journal trades for the same days do NOT add P&L again
const jt = [41.50, -12.00, 30.80, 43.00].map((p, i) => J.normalizeTrade({ id: 'pf' + i, date: '2026-11-0' + (3 + i), time: '09:30', contract: 'MNQ', side: 'long', contracts: 1, entry: 21000, exits: [{ qty: 1, price: 21000 + p / 2 }], accountId: 'acct-l' }).trade);
s = sum(acct(), L, { rows: J.analyze(jt) });
eq('overlapping Performance trades do not double-count: balance still $143.14', [s.balanceCents, s.excluded.trades.length, s.crossCheck.journalGrossCents, s.crossCheck.diffCents], [14314, 4, 10330, 0]);
// changing the opening balance recalculates and changes the status
s = sum(acct({ startingBalanceCents: 9000 }), L);
eq('opening balance changed to $90 -> $133.14 and a discrepancy of +$10 against the broker', [s.balanceCents, s.status, s.checkpoints[0].diffCents], [13314, 'discrepancy', 1000]);
// no opening balance entered: taken from the broker, labelled
s = sum(acct({ startingBalanceCents: null }), L);
eq('unknown opening + broker running balance -> opening derived from the broker and labelled', [s.opening.cents, s.opening.source, s.balanceCents, s.status], [10000, 'broker', 14314, 'reconciled']);
// deleting the import (undo) removes only its records
const other = { id: 'm1', type: 'deposit', accountId: 'acct-l', amountCents: 5000, date: '2026-11-20', at: Date.parse('2026-11-20T15:00:00Z'), voided: false };
let L2 = L.concat([other]).filter(l => !(l.source && l.source.batchId === 'cb0'));
eq('deleting the imported source removes its records and keeps unrelated ones', [L2.length, L2[0].id], [1, 'm1']);
eq('...and the balance is rebuilt from what is left', sum(acct(), L2).balanceCents, 15000);

/* ---------- authority rule: hand-entered records inside the Cash History period ---------- */
let L3 = []; const L3r = r = importCash(L3, cashCsv([{ t: '2026-11-03 08:00:00', type: 'FundTransaction', delta: 50, id: 4001 }, { t: '2026-11-04 10:00:00', type: 'FundTransaction', delta: -10, id: 4002 }].concat(regressionRows()).sort((a, b) => a.t.localeCompare(b.t) || a.id - b.id), { opening: 100 }));
eq('a file in time order is read without asking', L3r.interp.mode, 'delta+balance');
s = sum(acct(), L3);
eq('Fund transactions split by sign into deposit +50 / withdrawal 10 (marked by sign)', [s.totals.depositsCents, s.totals.withdrawalsCents, L3.filter(l => l.bySign).length], [5000, 1000, 2]);
eq('deposits are not trading P&L', [s.totals.netTradingCents, s.balanceCents, s.status], [4314, 18314, 'reconciled']);
const dupManual = { id: 'm2', type: 'deposit', accountId: 'acct-l', amountCents: 5000, date: '2026-11-03', at: Date.parse('2026-11-03T13:00:00Z'), voided: false };
s = sum(acct(), L3.concat([dupManual]));
eq('the same deposit typed by hand is NOT counted twice (Cash History is the source)', [s.balanceCents, s.excluded.manual.length, s.excluded.manual[0].matched != null], [18314, 1, true]);
const strayManual = { id: 'm3', type: 'deposit', accountId: 'acct-l', amountCents: 2500, date: '2026-11-05', at: Date.parse('2026-11-05T13:00:00Z'), voided: false };
s = sum(acct(), L3.concat([strayManual]));
ok('a hand-entered deposit missing from the Cash History is reported as a discrepancy', s.status === 'discrepancy' && s.discrepancies.some(d => d.kind === 'missing-deposit' && d.cents === 2500), s.discrepancies);
const later = { id: 'm4', type: 'deposit', accountId: 'acct-l', amountCents: 2500, date: '2026-11-08', at: Date.parse('2026-11-08T13:00:00Z'), voided: false };
s = sum(acct(), L3.concat([later]), { now: Date.parse('2026-11-09T00:00:00Z') });
eq('activity after the last broker balance -> partially reconciled, still counted', [s.balanceCents, s.status], [20814, 'partial']);
s = sum(acct(), L3, { now: Date.parse('2027-01-20T00:00:00Z') });
eq('last broker balance older than 30 days -> outdated', s.status, 'outdated');

/* ---------- reconciliation problems ---------- */
const gap = regressionRows(); gap.splice(5, 1);                                   // a missing row: the broker balance jumps
let L4 = []; const txt = cashCsv(gap, { opening: 100 }).split('\n'); const g2 = cashCsv(regressionRows(), { opening: 100 }).split('\n');
importCash(L4, [g2[0]].concat(g2.slice(1).filter((_, i) => i !== 5)).join('\n'));
s = sum(acct(), L4);
ok('a row missing from the export -> discrepancy with the exact jump located', s.status === 'discrepancy' && s.discrepancies.some(d => d.kind === 'statement'), s.discrepancies);
const incons = regressionRows(); incons[3].badBal = 999.99;
let L5 = []; importCash(L5, cashCsv(incons, { opening: 100 })); s = sum(acct(), L5);
ok('a statement whose balance does not match its own transactions is flagged, never "corrected"', s.status === 'discrepancy' && s.balanceCents === 14314, [s.status, s.balanceCents]);
s = sum(acct({ startingBalanceCents: null }), []);
eq('no data and no opening balance -> insufficient data, balance unknown (not $0)', [s.status, s.balanceCents], ['insufficient', null]);
s = sum(acct(), []);
eq('opening only, no broker balance -> estimated', [s.status, s.balanceCents], ['estimated', 10000]);
eq('zero opening balance is a real balance', sum(acct({ startingBalanceCents: 0 }), []).balanceCents, 0);
s = sum(acct(), [{ id: 's1', type: 'snapshot', accountId: 'acct-l', balanceCents: 10000, date: '2026-11-02', at: Date.parse('2026-11-02T20:00:00Z') }]);
eq('a broker balance you enter is a checkpoint too', [s.status, s.checkpoints[0].diffCents, s.checkpoints[0].source], ['reconciled', 0, 'you entered']);

/* ---------- unknown types, interpretation, signs, decimals ---------- */
let L6 = []; r = importCash(L6, cashCsv([{ t: '2026-11-03 08:00:00', type: 'MysteryCredit', delta: 5 }, { t: '2026-11-03 09:00:00', type: 'Commission', delta: -1.24 }]));
eq('an unknown broker type is held for your decision, not guessed', [r.rd.entries.length, r.rd.held.length], [1, 1]);
r = importCash([], cashCsv([{ t: '2026-11-03 08:00:00', type: 'MysteryCredit', delta: 5 }, { t: '2026-11-03 09:00:00', type: 'Commission', delta: -1.24 }]), { typeMap: { MysteryCredit: 'rebate' } });
eq('...and imported once you choose a category (broker type kept)', [r.added, r.rd.entries[0].category, r.rd.entries[0].brokerType], [2, 'rebate', 'MysteryCredit']);
const oneCol = 'timestamp,cashChangeType,amount\n2026-11-03 09:00:00,Commission,1.24\n2026-11-03 09:00:01,TradePaired,10.00';
r = importCash([], oneCol, { defaultAccountId: 'acct-l' });
ok('fees written as positive numbers -> TRC asks instead of guessing the sign', r.interp.needsChoice && r.rd.blocked === 'interpretation', r.interp);
r = importCash([], oneCol, { defaultAccountId: 'acct-l', choice: { mode: 'fees-positive' } });
eq('...after you confirm "fees are charges", the fee is negative', r.rd.entries.map(e => e.amountCents), [-124, 1000]);
const neg = 'timestamp,cashChangeType,amount\n2026-11-03 09:00:00,Commission,(1.24)\n2026-11-03 09:00:01,TradePaired,"1,010.00"';
r = importCash([], neg, { defaultAccountId: 'acct-l' });
eq('parentheses negatives and thousands separators', [r.interp.needsChoice, r.rd.entries.map(e => e.amountCents)], [false, [-124, 101000]]);
const commaDec = 'timestamp;cashChangeType;amount\n2026-11-03 09:00:00;Commission;-1,24\n2026-11-03 09:00:01;TradePaired;1.010,50';
r = importCash([], commaDec, { defaultAccountId: 'acct-l' });
eq('decimal commas (European export) read exactly', [r.interp.decimal, r.rd.entries.map(e => e.amountCents)], ['comma', [-124, 101050]]);
const ambig = 'timestamp,cashChangeType,amount\n2026-11-03 09:00:00,TradePaired,"1,234"';
r = importCash([], ambig, { defaultAccountId: 'acct-l' }); eq('"1,234" alone is ambiguous: flagged for you to choose', C.interpret(I.parseCsv(ambig), C.detect(I.parseCsv(ambig)).cols).decimalIssue, 'ambiguous');
const bothBad = 'id,timestamp,cashChangeType,amount,delta\n1,2026-11-03 09:00:00,TradePaired,10.00,4.00\n2,2026-11-03 09:01:00,Commission,3.00,-1.00';
ok('Amount and Delta that do not form a running balance -> you choose the reading', C.interpret(I.parseCsv(bothBad), C.detect(I.parseCsv(bothBad)).cols).needsChoice);
const quoted = 'timestamp,cashChangeType,amount,comment\n2026-11-03 09:00:00,ManualAdjustment,-2.00,"fee, refunded ""later""\nsecond line"';
r = importCash([], quoted, { defaultAccountId: 'acct-l' }); eq('quoted commas, escaped quotes and newlines inside a field', [r.rd.entries.length, r.rd.entries[0].comment], [1, 'fee, refunded "later"\nsecond line']);
r = importCash([], 'timestamp,cashChangeType,amount\nnot a date,Commission,-1\n2026-11-03 09:00:00,Commission,abc\n2026-11-03 09:00:00,Commission,-1.00', { defaultAccountId: 'acct-l' });
eq('invalid rows are quarantined with their line numbers', [r.rd.invalid.map(x => x.line), r.added], [[2, 3], 1]);
ok('summary / trade reports are not mistaken for a Cash History', !C.detect(I.parseCsv('symbol,qty,buyPrice,sellPrice\nMNQZ6,1,1,2')) && !C.detect(I.parseCsv('Account,Net Liq,Cash Balance\nX,1,1')));
ok('an empty file is refused by the parser', !I.parseCsv('').ok && !I.parseCsv('timestamp,cashChangeType,amount').ok);

/* ---------- duplicates / identical legitimate records / accounts ---------- */
const twins = [{ t: '2026-11-03 09:00:00', type: 'Commission', delta: -1.24, id: '' }, { t: '2026-11-03 09:00:00', type: 'Commission', delta: -1.24, id: '' }];
let L7 = []; r = importCash(L7, cashCsv(twins, { cols: ['accountId', 'timestamp', 'cashChangeType', 'amount', 'delta'] }));
eq('two legitimate identical fees in the same second (no ids) are both kept', r.added, 2);
r = importCash(L7, cashCsv(twins, { cols: ['accountId', 'timestamp', 'cashChangeType', 'amount', 'delta'] })); eq('...and re-importing them adds nothing', r.added, 0);
const twoAcct = cashCsv([{ t: '2026-11-03 09:00:00', type: 'Commission', delta: -1.24, id: 77 }, { t: '2026-11-03 09:00:00', type: 'Commission', delta: -1.24, id: 77, acct: 'DEMO-L2' }]);
ok('one row per account cannot prove the running balance: you are asked', C.interpret(I.parseCsv(twoAcct), C.detect(I.parseCsv(twoAcct)).cols).needsChoice);
let L8 = []; r = importCash(L8, twoAcct, { choice: { mode: 'delta-only' } }); eq('the same broker id in two accounts stays two records, one per account', [r.added, L8.map(l => l.accountId).sort()], [2, ['acct-2', 'acct-l']]);
const corrected = regressionRows().map(x => x.type === 'Commission' && x.id === 5004 ? Object.assign({}, x, { delta: -6.00 }) : x);
let L9 = []; importCash(L9, cashCsv(regressionRows(), { opening: 100 })); r = importCash(L9, cashCsv(corrected, { opening: 100 }));
eq('a corrected statement (same id, new amount) is a conflict, never applied silently', [r.added, r.cl.conflict.length], [0, 1]);
importCash(L9, cashCsv(corrected, { opening: 100 }), { replaceConflicts: true }); eq('...and replaces the old value when you choose it', L9.filter(l => l.brokerId === '5004')[0].amountCents, -600);
r = importCash([], cashCsv(regressionRows()), { accountMap: {} }); ok('an unrecognised account is reported, not assigned', Object.keys(r.rd.unmapped).length === 1 && r.rd.entries.every(e => e.accountId === null));

/* ---------- currencies, combined view, fee share, return ---------- */
let LC = []; importCash(LC, cashCsv([{ t: '2026-11-03 09:00:00', type: 'Commission', delta: -1.24, cur: 'EUR' }].concat(regressionRows()), { opening: 100 }));
s = sum(acct(), LC); ok('a record in another currency is not mixed in and is flagged', s.discrepancies.some(d => d.kind === 'currency') && s.totals.feesCents === 6016, s.discrepancies);
eq('JPY has no minor unit', [C.digitsOf('JPY'), C.fmt(1200, 'JPY')], [0, '¥1,200']);
const s1 = sum(acct(), L3), s2 = sum(acct({ id: 'acct-e', currency: 'EUR' }), []);
ok('accounts in different currencies are never combined', !C.combine([s1, s2], L3).ok);
const tr = [{ id: 'x1', type: 'cash', accountId: 'acct-l', category: 'withdrawal', amountCents: -2000, fundId: 'F9', date: '2026-11-05', at: 1, currency: 'USD' }, { id: 'x2', type: 'cash', accountId: 'acct-2', category: 'deposit', amountCents: 2000, fundId: 'F9', date: '2026-11-05', at: 1, currency: 'USD' }];
const cb = C.combine([sum(acct(), tr), sum(acct({ id: 'acct-2' }), tr)], tr); eq('combined view nets out a transfer between your own accounts', [cb.internalTransfersCents, cb.totals.depositsCents, cb.totals.withdrawalsCents], [2000, 0, 0]);
eq('fee share of gross profit', C.feeShare({ grossCents: 10330, feesCents: 6016 }).value.toFixed(4), '0.5824');
ok('fee share in a losing period is not shown, with the reason', C.feeShare({ grossCents: -500, feesCents: 120 }).value === null && /negative/.test(C.feeShare({ grossCents: -500, feesCents: 120 }).text));
s = sum(acct(), L3); ok('time-weighted return excludes the $50 deposit', s.twr.value != null && Math.abs(s.twr.value - 0.284) < 0.02, s.twr);
ok('return unavailable when not confirmed by the broker', sum(acct(), []).twr.value === null);
eq('monthly and weekly buckets', [C.buckets(L3, 'acct-l', 'month').map(b => [b.key, b.totals.netTradingCents]), C.buckets(L3, 'acct-l', 'week').length], [[['2026-11', 4314]], 1]);
ok('an account with fees but no trades', sum(acct(), [{ id: 'f', type: 'cash', accountId: 'acct-l', category: 'data_fee', amountCents: -1500, date: '2026-11-03', at: Date.parse('2026-11-03T10:00:00Z'), balanceAfterCents: 8500, currency: 'USD' }]).balanceCents === 8500);

/* ---------- exports are safe in spreadsheets ---------- */
eq('formula injection neutralised; numbers kept', [C.csvCell('=HYPERLINK("x")'), C.csvCell('@SUM(1)'), C.csvCell('-12.50'), C.csvCell('+cmd|calc')], ['"\'=HYPERLINK(""x"")"', "'@SUM(1)", '-12.50', "'+cmd|calc"]);
ok('export lists source file and line', /cash\.csv,2/.test(C.exportCsv(L.slice(0, 1), () => 'A')));

/* ---------- property tests: exact arithmetic, order independence, idempotency ---------- */
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const types = ['TradePaired', 'Commission', 'ExchangeFee', 'ClearingFee', 'NfaFee', 'FundTransaction'];
for (let k = 0; k < 25; k++) {
  const rows = []; let expect = 10000;
  for (let i = 0; i < 400; i++) { const ty = types[Math.floor(rnd() * types.length)], cents = ty === 'TradePaired' || ty === 'FundTransaction' ? Math.round((rnd() - 0.45) * 20000) : -Math.round(rnd() * 300) - 1;
    rows.push({ t: '2026-11-' + String(3 + (i % 20)).padStart(2, '0') + ' 10:' + String(Math.floor(i / 20)).padStart(2, '0') + ':00', type: ty, delta: cents / 100, id: 9000 + i }); }
  rows.sort((a, b) => a.t.localeCompare(b.t) || a.id - b.id); rows.forEach(x => { expect += Math.round(x.delta * 100); });
  const Lp = []; importCash(Lp, cashCsv(rows, { opening: 100 })); const sp = sum(acct(), Lp, { now: Date.parse('2026-11-25T00:00:00Z') });
  if (sp.balanceCents !== expect || sp.status !== 'reconciled') { ok('property: exact balance over 400 random records (run ' + k + ')', false, [sp.balanceCents, expect, sp.status, sp.discrepancies.slice(0, 2)]); break; }
  const shuffled = Lp.slice().sort(() => rnd() - 0.5), ss = sum(acct(), shuffled, { now: Date.parse('2026-11-25T00:00:00Z') });
  if (ss.balanceCents !== expect || JSON.stringify(ss.totals) !== JSON.stringify(sp.totals)) { ok('property: storage order does not matter (run ' + k + ')', false); break; }
  const again = importCash(Lp, cashCsv(rows, { opening: 100 })); if (again.added !== 0) { ok('property: re-import is idempotent (run ' + k + ')', false); break; }
  if (k === 24) ok('property: 25 random ledgers x 400 records: exact to the cent, order-independent, idempotent', true);
}
let t0 = Date.now(); const big = []; for (let i = 0; i < 20000; i++) big.push({ id: 'b' + i, type: 'cash', accountId: 'acct-l', category: i % 2 ? 'commission' : 'trade_pnl', amountCents: i % 2 ? -37 : 101, date: '2026-11-0' + (3 + i % 5), at: Date.parse('2026-11-03T00:00:00Z') + i * 1000, balanceAfterCents: null, currency: 'USD' });
s = sum(acct(), big); ok('20,000 records summarised in under 1.5 s', Date.now() - t0 < 1500 && s.balanceCents === 10000 + 10000 * 101 - 10000 * 37, [Date.now() - t0, s.balanceCents]);

console.log(fail ? 'FAILED ' + pass + ' passed, ' + fail + ' failed' : 'ALL PASSED ' + pass + ' passed, 0 failed'); process.exit(fail ? 1 : 0);
