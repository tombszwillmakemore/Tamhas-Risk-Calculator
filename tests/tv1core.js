// Tradovate Smart Import - pure-logic tests. Every fixture is SYNTHETIC (see tests/fixtures/README.md); expected values are hand-computed.
const path = require('path'), fs = require('fs'), R = path.join(__dirname, '..', 'assets') + '/', F = path.join(__dirname, 'fixtures') + '/';
global.TTSessions = require(R + 'sessions.js'); global.TTInstruments = require(R + 'instruments.js'); const J = require(R + 'journal-core.js'); global.TTImport = require(R + 'import-core.js'); const I = global.TTImport; const T = require(R + 'tradovate-core.js');
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const csv = f => I.parseCsv(fs.readFileSync(F + f, 'utf8'));
function run(parsed, report, o, existing, fps) {
  o = Object.assign({ fileTz: 'as-is', targetTz: 'America/New_York', defaultAccountId: 'acct-default', accountMap: {}, report: report }, o || {});
  const rd = T.read(parsed, report, o);
  const p = I.plan(parsed, Object.assign({}, o, { mode: 'fills', preRead: rd, pnlByKey: rd.pnlByKey, ambiguousKeys: rd.ambiguousKeys, enrich: T.enricher(rd, o), fingerprints: fps }), existing || new Set(), J);
  return { rd, p, rec: T.reconcile(p, rd, o.userTotal) };
}
const mkCsv = rows => I.parseCsv(rows.join('\n'));

// ---- detection
const orders = csv('tradovate-orders-synthetic.csv'), perf = csv('tradovate-performance-synthetic.csv');
eq('orders detected', T.detect(orders.headers).report, 'orders'); eq('orders basis = published header', T.detect(orders.headers).verified, 'published');
eq('performance detected', T.detect(perf.headers).report, 'performance');
eq('fills detected by names only', [T.detect(['Fill ID', 'Timestamp', 'B/S', 'Quantity', 'Price', 'Contract', 'Commission']).report, T.detect(['Fill ID', 'Timestamp', 'B/S', 'Quantity', 'Price', 'Contract']).verified], ['fills', 'names']);
eq('summary detected (no trades)', T.detect(['Account', 'Net Liq', 'Cash Balance', 'Total PnL']).report, 'summary');
const near = T.detect(['B/S', 'Contract', 'Status', 'Filled Qty']); ok('near-miss names what is missing', near.report === null && near.near && near.near.missing.indexOf('Fill Time') >= 0, near);
eq('unknown file -> null', T.detect(['foo', 'bar']).report, null);

// ---- Orders: scale-out, canceled skipped, newest-first order
let r = run(orders, 'orders', { accountMap: { DEMO1234: 'acct-a' } });
eq('orders: one trade', r.p.trades.length, 1);
const t1 = r.p.trades[0];
eq('orders: entry/side/qty', [t1.trade.side, t1.trade.contracts, t1.trade.entry, t1.trade.date, t1.trade.time], ['long', 2, 21000.25, '2026-10-21', '09:31']);
eq('orders: two partial exits with times', t1.trade.exits, [{ qty: 1, price: 21010.25, time: '09:41' }, { qty: 1, price: 21020, time: '09:47' }]);
eq('orders: gross 29.75 pts x $2 = $59.50', t1.c.grossCents, 5950);
eq('orders: no fees in file -> unknown, not zero', [t1.trade.feesCents, t1.c.netCents], [null, null]);
eq('orders: account mapped', t1.trade.accountId, 'acct-a'); eq('orders: provenance', t1.trade.srcInfo, { broker: 'tradovate', report: 'orders', account: 'DEMO1234' });
eq('orders: canceled with 0 filled skipped and counted', r.rd.skipped, { canceled: 1 });
ok('orders: reconcile warns about missing commissions', r.rec.items.some(x => x.level === 'warn' && /no commissions/.test(x.text)), r.rec);
eq('orders: date range', [r.rd.info.from, r.rd.info.to], ['2026-10-21', '2026-10-21']);
ok('orders: stable keys use order ids', t1.keys.every(k => /^tv:o:DEMO1234:900[134]$/.test(k)), t1.keys);

// ---- re-import of the same report = all duplicates; overlapping report = partial skipped
const keys = new Set(t1.keys); r = run(orders, 'orders', { accountMap: { DEMO1234: 'acct-a' } }, keys);
eq('re-import -> duplicate, nothing new', [r.p.trades.length, r.p.duplicates], [0, 1]);
r = run(orders, 'orders', { accountMap: { DEMO1234: 'acct-a' } }, new Set(['tv:o:DEMO1234:9001']));
eq('overlap (entry known, exits new) -> held as partial, never half-imported', [r.p.trades.length, r.p.partial.length], [0, 1]);

// ---- unmapped account is reported, never silently assigned
r = run(orders, 'orders', {});
eq('unmapped account listed', r.rd.unmatchedAccounts, ['DEMO1234']); ok('reconcile flags unmatched account as a blocker', r.rec.level === 'bad');

// ---- multi-decimal average price: rejected with the reason
const H = 'orderId,Account,B/S,Contract,Product,avgPrice,filledQty,Fill Time,Status,Filled Qty,Avg Fill Price';
r = run(mkCsv([H, '1,A,Buy,MNQZ6,MNQ,21000.125,2,10/21/2026 09:31:07,Filled,2,21000.125']), 'orders', { accountMap: { A: 'a' } });
ok('avg fill price 21000.125 rejected with explanation', Object.keys(r.p.problems).some(k => /several prices/.test(k)), r.p.problems);
// canceled-but-partly-filled is included with a warning
r = run(mkCsv([H, '1,A,Buy,MNQZ6,MNQ,21000,1,10/21/2026 09:31:07,Canceled,1,21000', '2,A,Sell,MNQZ6,MNQ,21001,1,10/21/2026 09:32:07,Filled,1,21001']), 'orders', { accountMap: { A: 'a' } });
eq('partly filled canceled order included', [r.p.trades.length, r.p.trades[0].c.grossCents], [1, 200]); ok('...with a warning', Object.keys(r.rd.warnings).some(k => /canceled/.test(k)));
// spread orders refused
r = run(I.parseCsv('orderId,Account,B/S,Contract,Product,avgPrice,filledQty,Fill Time,Status,Filled Qty,Avg Fill Price,spreadDefinitionId\n1,A,Buy,MNQZ6,MNQ,21000,1,10/21/2026 09:31:07,Filled,1,21000,77\n'), 'orders', { accountMap: { A: 'a' } });
ok('spread order refused', Object.keys(r.p.problems).some(k => /spread/.test(k)));
// unsupported contract listed
r = run(mkCsv([H, '1,A,Buy,CLZ6,CL,70.10,1,10/21/2026 09:31:07,Filled,1,70.10']), 'orders', { accountMap: { A: 'a' } });
eq('unsupported contract skipped and listed', r.p.unsupported, { CLZ6: 1 });

// ---- reversal: sell 1, buy 2 (flip), sell 1
r = run(mkCsv([H, '1,A,Sell,MESZ6,MES,6000.00,1,10/21/2026 10:00:00,Filled,1,6000.00', '2,A,Buy,MESZ6,MES,5990.00,2,10/21/2026 10:05:00,Filled,2,5990.00', '3,A,Sell,MESZ6,MES,5995.00,1,10/21/2026 10:09:00,Filled,1,5995.00']), 'orders', { accountMap: { A: 'a' } });
eq('reversal -> short closed, long closed', r.p.trades.map(x => [x.trade.side, x.trade.contracts, x.c.grossCents]), [['short', 1, 5000], ['long', 1, 2500]]);

// ---- scale-in, two accounts in one file kept apart
r = run(mkCsv([H, '1,A,Buy,NQZ6,NQ,21000,1,10/21/2026 10:00:00,Filled,1,21000', '2,B,Buy,NQZ6,NQ,21000,1,10/21/2026 10:00:30,Filled,1,21000', '3,A,Buy,NQZ6,NQ,20990,1,10/21/2026 10:01:00,Filled,1,20990', '4,A,Sell,NQZ6,NQ,21005,2,10/21/2026 10:03:00,Filled,2,21005', '5,B,Sell,NQZ6,NQ,20995,1,10/21/2026 10:04:00,Filled,1,20995']), 'orders', { accountMap: { A: 'a', B: 'b' } });
const byAcct = {}; r.p.trades.forEach(x => byAcct[x.trade.accountId] = x);
eq('scale-in on A: 2 fills, gross (5+15) x $20 = $400', [byAcct.a.trade.entries.length, byAcct.a.c.grossCents], [2, 40000]); eq('B separate: -5 x $20', byAcct.b.c.grossCents, -10000);

// ---- Performance report: fills rebuilt by id (scale-out), Tradovate pnl matched to the cent
r = run(perf, 'performance', { defaultAccountId: 'acct-a' });
eq('perf: 2 trades', r.p.trades.length, 2);
const mgc = r.p.trades.filter(x => x.trade.contract === 'MGC')[0], mnq = r.p.trades.filter(x => x.trade.contract === 'MNQ')[0];
eq('perf: MGC long 2 @4144.1, exits 4146.1 and 4140.0', [mgc.trade.side, mgc.trade.contracts, mgc.trade.entry, mgc.trade.exits.map(x => x.price)], ['long', 2, 4144.1, [4146.1, 4140]]);
eq('perf: MGC gross (+2.0 -4.1) x $10 = -$21.00, file says the same', [mgc.c.grossCents, mgc.filePnlCents], [-2100, -2100]);
eq('perf: MNQ short (sold first) +10.50 x $2 = $21.00', [mnq.trade.side, mnq.c.grossCents, mnq.filePnlCents], ['short', 2100, 2100]);
eq('perf: reported file total', r.rd.info.reportedPnlCents, 0);
ok('perf: reconciliation all good on P&L', r.rec.items.some(x => /All 2 closed trades match/.test(x.text)), r.rec.items);
ok('perf: keys use fill ids', mgc.keys.indexOf('tv:pf::5101') >= 0, mgc.keys);
// a wrong pnl in the file is caught before import
const perfBad = I.parseCsv(fs.readFileSync(F + 'tradovate-performance-synthetic.csv', 'utf8').replace('$21.00', '$25.00'));
r = run(perfBad, 'performance', { defaultAccountId: 'a' }); ok('perf: mismatch flagged as a problem', r.rec.level === 'bad' && r.rec.items.some(x => /do not match/.test(x.text)), r.rec.items);
// conflicting fill id
r = run(I.parseCsv('symbol,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp\nMNQZ6,1,2,1,100,101,$2.00,10/22/2026 10:00:00,10/22/2026 10:01:00\nMNQZ6,1,3,1,99,101,$4.00,10/22/2026 10:00:00,10/22/2026 10:02:00\n'), 'performance', { defaultAccountId: 'a' });
ok('perf: same fill id with different price -> problem', Object.keys(r.p.problems).some(k => /same fill id/.test(k)), r.p.problems);

// ---- cross-report duplicate: same trades from Orders, then from a Performance-style file -> possible duplicate, held back
const o1 = run(mkCsv([H, '1,A,Buy,MNQZ6,MNQ,21000,1,10/21/2026 10:00:00,Filled,1,21000', '2,A,Sell,MNQZ6,MNQ,21004,1,10/21/2026 10:02:00,Filled,1,21004']), 'orders', { accountMap: { A: 'a' } });
const fps = new Set(o1.p.trades.map(x => x.fp));
const p1 = run(I.parseCsv('symbol,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp\nMNQZ6,71,72,1,21000,21004,$8.00,10/21/2026 10:00:00,10/21/2026 10:02:00\n'), 'performance', { defaultAccountId: 'a' }, new Set(), fps);
eq('same trade from another report -> possible duplicate, not added', [p1.p.trades.length, p1.p.possible.length], [0, 1]);

// ---- fee template (yours, opt-in) vs unknown
r = run(orders, 'orders', { accountMap: { DEMO1234: 'a' }, applyFeeTemplate: true, feeTemplate: { MNQ: 62 } });
eq('fee template: 4 contract-sides x $0.62 = $2.48, net 57.02, marked as template', [r.p.trades[0].trade.feesCents, r.p.trades[0].c.netCents, r.p.trades[0].trade.feeSource], [248, 5702, 'template']);
r = run(orders, 'orders', { accountMap: { DEMO1234: 'a' }, applyFeeTemplate: false, feeTemplate: { MNQ: 62 } });
eq('fee template off -> unknown', r.p.trades[0].trade.feesCents, null);
// fills list with commissions in the file
const FH = 'Fill ID,Order ID,Timestamp,B/S,Quantity,Price,Contract,Account,Commission';
r = run(mkCsv([FH, '11,1,10/21/2026 10:00:00,Buy,1,6000.25,MESZ6,A,0.35', '12,2,10/21/2026 10:01:00,Sell,1,6001.25,MESZ6,A,0.35']), 'fills', { accountMap: { A: 'a' } });
eq('fills: commission from file, gross $5, net $4.30', [r.p.trades[0].c.grossCents, r.p.trades[0].trade.feesCents, r.p.trades[0].c.netCents, r.p.trades[0].trade.feeSource], [500, 70, 430, 'file']);
// missing commission on one fill -> whole trade unknown
r = run(mkCsv([FH, '11,1,10/21/2026 10:00:00,Buy,1,6000.25,MESZ6,A,0.35', '12,2,10/21/2026 10:01:00,Sell,1,6001.25,MESZ6,A,']), 'fills', { accountMap: { A: 'a' } });
eq('fills: one fee missing -> trade fees unknown (not partial sum)', r.p.trades[0].trade.feesCents, null);

// ---- ambiguous same-second opposite fills without ids -> held for review
r = run(I.parseCsv('Timestamp,B/S,Quantity,Price,Contract\n10/21/2026 10:00:00,Buy,1,100,MNQZ6\n10/21/2026 10:00:00,Sell,1,101,MNQZ6\n'), 'fills', {});
eq('same-second buy+sell, no ids -> ambiguous, not imported', [r.p.trades.length, r.p.ambiguous.length], [0, 1]);
// with numeric ids the order is known
r = run(mkCsv([H, '1,A,Buy,MNQZ6,MNQ,100,1,10/21/2026 10:00:00,Filled,1,100', '2,A,Sell,MNQZ6,MNQ,101,1,10/21/2026 10:00:00,Filled,1,101']), 'orders', { accountMap: { A: 'a' } });
eq('same second but numeric order ids -> ordered by id, imported', [r.p.trades.length, r.p.trades[0].c.grossCents], [1, 200]);

// ---- time zones and daylight saving (file in Chicago time, journal in New York)
const tz = (s, f) => { const x = I.parseTimestamp(s, { fileTz: f, targetTz: 'America/New_York' }); return x.date + ' ' + x.time; };
eq('CT->ET before DST start', tz('03/06/2026 08:30:00', 'America/Chicago'), '2026-03-06 09:30');
eq('CT->ET after DST start', tz('03/09/2026 08:30:00', 'America/Chicago'), '2026-03-09 09:30');
eq('UTC->ET winter (EST)', tz('03/06/2026 14:30:00', 'UTC'), '2026-03-06 09:30');
eq('UTC->ET summer (EDT)', tz('03/09/2026 13:30:00', 'UTC'), '2026-03-09 09:30');
eq('UTC->ET across fall-back (Nov 2)', tz('11/02/2026 14:30:00', 'UTC'), '2026-11-02 09:30');
eq('UTC->ET late evening crosses date', tz('10/22/2026 02:15:00', 'UTC'), '2026-10-21 22:15');

// ---- sessions (only when exactly one window is open)
const S = TTSessions.DEFAULTS;
eq('13:00 ET -> New York', T.sessionAt('2026-10-21', '13:00', 'America/New_York', S), 'New York');
eq('10:00 ET -> London+NY overlap -> blank', T.sessionAt('2026-10-21', '10:00', 'America/New_York', S), '');
eq('04:00 ET -> Asia+London overlap -> blank', T.sessionAt('2026-10-21', '04:00', 'America/New_York', S), '');
eq('06:00 ET -> London only', T.sessionAt('2026-10-21', '06:00', 'America/New_York', S), 'London');
eq('no time -> blank', T.sessionAt('2026-10-21', '', 'America/New_York', S), '');
r = run(orders, 'orders', { accountMap: { DEMO1234: 'a' }, autoSession: true, sessions: S }); eq('auto session at 09:31 ET = overlap -> blank', r.p.trades[0].trade.session, '');

// ---- reconciliation with a total you type in
r = run(orders, 'orders', { accountMap: { DEMO1234: 'a' }, userTotal: 5950 }); ok('typed total matches', r.rec.items.some(x => x.level === 'good' && /You entered 59.50/.test(x.text)), r.rec.items);
r = run(orders, 'orders', { accountMap: { DEMO1234: 'a' }, userTotal: 5000 }); ok('typed total differs -> warn with difference', r.rec.items.some(x => x.level === 'warn' && /difference 9.50/.test(x.text)), r.rec.items);

// ---- OCR line parser and pasted text
const W = s => s.split(' ').map(w => ({ text: w, conf: 95 }));
let ol = T.fromLines([W('Orders 4 items'), W('Account B/S Contract Filled Qty Avg Fill Price Fill Time Status'), W('DEMO1234 Buy MNQZ6 2 21000.25 10/21/2026 09:31:07 Filled'), W('DEMO1234 Sell MNQZ6 1 21010.25 10/21/2026 09:41:03 Filled'), W('DEMO1234 Sell MNQZ6 1 21020.00 10/21/2026 09:47:12 Filled'), W('junk line')]);
eq('ocr: header found and columns named', ol.headers, ['Account', 'B/S', 'Contract', 'Filled Qty', 'Avg Fill Price', 'Fill Time', 'Status']);
eq('ocr: 3 rows, date+time joined, 1 unreadable line kept', [ol.rows.length, ol.rows[0][5], ol.unreadable.length], [3, '10/21/2026 09:31:07', 1]);
eq('ocr table detected as orders', T.detect(ol.headers).report, 'orders');
r = run(ol, 'orders', { accountMap: { DEMO1234: 'a' } }); eq('ocr rows -> same $59.50 trade', r.p.trades[0] && r.p.trades[0].c.grossCents, 5950);
const lowLine = W('DEMO1234 Buy MNQZ6 2 21000.25 10/21/2026 09:31:07 Filled'); lowLine[4].conf = 41;
ol = T.fromLines([W('Account B/S Contract Filled Qty Avg Fill Price Fill Time Status'), lowLine]); eq('ocr: low confidence cell marked', ol.lowConf[0], [false, false, false, false, true, false, false]);
ok('ocr: no heading -> clear error', !T.fromLines([W('hello world')]).ok);
let pp = T.parsePasted('B/S\tContract\tFilled Qty\tAvg Fill Price\tFill Time\tStatus\nBuy\tMNQZ6\t1\t100\t10/21/2026 10:00:00\tFilled\n'); eq('paste: tab table', [pp.ok, pp.rows.length], [true, 1]);
pp = T.parsePasted('B/S    Contract   Filled Qty   Avg Fill Price   Fill Time             Status\nBuy    MNQZ6      1            100              10/21/2026 10:00:00   Filled'); eq('paste: 2+ space columns', [pp.ok, pp.headers.length, pp.rows[0][4]], [true, 6, '10/21/2026 10:00:00']);
pp = T.parsePasted('B/S Contract Filled Qty Avg Fill Price Fill Time Status\nBuy MNQZ6 1 100 10/21/2026 10:00:00 Filled'); eq('paste: single spaces via header words', [pp.ok, T.detect(pp.headers).report], [true, 'orders']);
ok('paste: one line -> error', !T.parsePasted('hello').ok);

// ---- large import performance (10,000 orders = 5,000 round trips)
const big = [H]; const hms = x => [Math.floor(x / 3600), Math.floor(x / 60) % 60, x % 60].map(v => String(v).padStart(2, '0')).join(':');
for (let i = 0; i < 5000; i++) { big.push((2 * i + 1) + ',A,Buy,MNQZ6,MNQ,21000.25,1,10/21/2026 ' + hms(3600 + i * 10) + ',Filled,1,21000.25'); big.push((2 * i + 2) + ',A,Sell,MNQZ6,MNQ,21001.00,1,10/21/2026 ' + hms(3605 + i * 10) + ',Filled,1,21001.00'); }
let t0 = Date.now(); r = run(I.parseCsv(big.join('\n')), 'orders', { accountMap: { A: 'a' } }); const ms = Date.now() - t0;
eq('large: 5,000 trades each +$1.50', [r.p.trades.length, r.p.trades.every(x => x.c.grossCents === 150)], [5000, true]); ok('large: under 5 s (' + ms + ' ms)', ms < 5000);

console.log((fail ? 'FAILED ' : 'ALL PASSED ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
