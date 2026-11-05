// Duplicate engine - pure-logic tests (Part 3 / Part 17 / Part 19 A, B, F, G). Every report is SYNTHETIC, generated here.
// Each scenario runs the real pipeline: TTTradovate.read -> TTImport.plan (with the duplicate engine) -> "commit" into an in-memory journal.
const path = require('path'), R = path.join(__dirname, '..', 'assets') + '/';
global.TTSessions = require(R + 'sessions.js'); global.TTInstruments = require(R + 'instruments.js');
const J = require(R + 'journal-core.js'); global.TTDedupe = require(R + 'dedupe-core.js'); const D = global.TTDedupe;
global.TTImport = require(R + 'import-core.js'); const I = global.TTImport; const T = require(R + 'tradovate-core.js');
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });

const { mkTrades, perfCsv, fillsCsv } = require('./_ddgen.js'); const p2 = n => String(n).padStart(2, '0');

const BASE = { fileTz: 'as-is', targetTz: 'America/New_York', defaultAccountId: 'acct-a', accountMap: { 'DEMO-A': 'acct-a', 'DEMO-B': 'acct-b' } };
let srcN = 0;
// Runs one import into `journal` (an array of saved trades). opts.apply: apply offered updates. Returns the plan.
function imp(journal, text, o) {
  o = Object.assign({}, BASE, o || {}); const parsed = I.parseCsv(text); ok('parsed ' + (o.label || ''), parsed.ok, parsed.error);
  const det = T.detect(parsed.headers); o.report = det.report;
  const rd = T.read(parsed, det.report, o), ix = D.index(journal, t => J.compute(t));
  const p = I.plan(parsed, Object.assign({}, o, { mode: 'fills', preRead: rd, pnlByKey: rd.pnlByKey, ambiguousKeys: rd.ambiguousKeys, enrich: T.enricher(rd, o), dedupe: { ix, src: 's' + (srcN++) } }), new Set(), J);
  p.trades.forEach(x => journal.push(JSON.parse(JSON.stringify(x.trade))));
  if (o.apply) p.updates.forEach(x => { const i = journal.findIndex(t => t.id === x.d.existingId); journal[i] = D.applyUpdate(journal[i], x.trade, x.d.mode); });
  return p;
}
const net = jr => J.analyze(jr).reduce((a, r) => a + (r.c.isClosed ? r.c.grossCents : 0), 0);
const A = mkTrades('DEMO-A', 7000), week = A.slice(0, 20), month = A;

/* ---------- Scenario A: same weekly report twice, and ten times ---------- */
let jr = [];
let p = imp(jr, perfCsv(week), { label: 'A1' });
eq('A: first weekly import adds 20', [p.trades.length, jr.length], [20, 20]);
const pnl20 = net(jr);
p = imp(jr, perfCsv(week), { label: 'A2' });
eq('A: same weekly CSV again -> 0 new, 20 exact duplicates', [p.trades.length, p.exact.length, jr.length], [0, 20, 20]);
ok('A: exact duplicates are certain (same execution ids)', p.exact.every(x => x.d.why === 'same-ids' && x.d.conf === 'certain'), p.exact.map(x => x.d.why));
for (let k = 0; k < 8; k++) imp(jr, perfCsv(week), { label: 'A' + (k + 3) });
eq('A: imported ten times -> still 20 trades, P&L unchanged', [jr.length, net(jr)], [20, pnl20]);

/* ---------- Scenario B: weekly then monthly; monthly then weekly ---------- */
p = imp(jr, perfCsv(month), { label: 'B1' });
eq('B: monthly after weekly -> 15 new, 20 duplicates, 35 unique', [p.trades.length, p.exact.length, jr.length], [15, 20, 35]);
let jr2 = []; imp(jr2, perfCsv(month), { label: 'B2' }); p = imp(jr2, perfCsv(week), { label: 'B3' });
eq('B: weekly after monthly -> 0 new, 35 unique', [p.trades.length, p.exact.length, jr2.length], [0, 20, 35]);
eq('B: order of imports does not change the result', [net(jr), jr.map(t => t.id).sort()], [net(jr2), jr2.map(t => t.id).sort()]);

/* ---------- same trades: row order, column order, other symbol spelling, file name, precision ---------- */
p = imp(jr, perfCsv(month, { shuffle: true }), { label: 'rows' }); eq('rows in reverse order -> nothing new', [p.trades.length, jr.length], [0, 35]);
let jr3 = []; imp(jr3, fillsCsv(month), { label: 'f0' });
eq('fills list without ids imports 35', jr3.length, 35);
p = imp(jr3, fillsCsv(month, { cols: true }), { label: 'cols' }); eq('fills list with columns reversed -> nothing new', [p.trades.length, p.exact.length], [0, 35]);
p = imp(jr3, fillsCsv(month, { shuffle: true }), { label: 'shuf' }); eq('fills list rows shuffled (no ids) -> nothing new', [p.trades.length, p.exact.length], [0, 35]);
ok('no-id duplicates found by execution keys, not row numbers', p.exact.every(x => x.d.why === 'same-ids'), p.exact.map(x => x.d.why).slice(0, 3));
p = imp(jr3, fillsCsv(month, { ms: true }), { label: 'ms' }); eq('same report with millisecond timestamps -> nothing new', [p.trades.length, p.exact.length], [0, 35]);
p = imp(jr3, fillsCsv(month, { symFmt: true }), { label: 'sym' }); eq('contract written "MNQ DEC26" instead of "MNQZ6" -> nothing new', [p.trades.length, p.exact.length], [0, 35]);
p = imp(jr3, fillsCsv(month.slice(0, 20)), { label: 'wk-noid' }); eq('no-id weekly after no-id monthly -> nothing new', [p.trades.length, p.exact.length], [0, 20]);

/* ---------- different report types for the same trades; updated fees ---------- */
p = imp(jr, fillsCsv(month, { fees: true }), { label: 'fees' });
eq('fills list WITH commissions after a Performance report (no fees) -> 0 new, 35 fee updates offered', [p.trades.length, p.updates.length, p.exact.length], [0, 35, 0]);
ok('fee updates say why', p.updates.every(x => x.d.why === 'fees-added' && x.d.mode === 'fees'), p.updates.map(x => x.d.why).slice(0, 2));
ok('without consent nothing changed', jr.every(t => t.feesCents == null));
const notes0 = jr[3].notes; jr[3].notes = 'my note'; jr[3].tags = ['A+'];
p = imp(jr, fillsCsv(month, { fees: true }), { label: 'fees2', apply: true });
eq('updates applied when you accept them: fees known on all 35', jr.filter(t => t.feesCents != null).length, 35);
ok('update keeps your notes and tags', jr[3].notes === 'my note' && jr[3].tags[0] === 'A+', jr[3]);
jr[3].notes = notes0;
p = imp(jr, fillsCsv(month, { fees: true }), { label: 'fees3' }); eq('same fees again -> exact duplicates', [p.trades.length, p.updates.length, p.exact.length], [0, 0, 35]);
p = imp(jr, fillsCsv(month, { fees: true, ids: true }), { label: 'ids' }); eq('fills list with fill ids matches Performance fill ids', [p.trades.length, p.exact.length], [0, 35]);
ok('...as certain (shared Tradovate fill ids)', p.exact.every(x => x.d.why === 'same-ids'), p.exact.map(x => x.d.why).slice(0, 3));
let jrF = []; imp(jrF, fillsCsv(month, { fees: true }), { label: 'feeA' });
const changedFees = month.map(t => Object.assign({}, t, { fee: t.fee + 0.1 }));
p = imp(jrF, fillsCsv(changedFees, { fees: true }), { label: 'feeB' });
ok('different fees for the same executions -> a fee change offered for review (never applied silently)', p.updates.length === 35 && p.trades.length === 0 && p.updates.every(x => x.d.why === 'fees-changed'), p.updates.map(x => x.d.why).slice(0, 3));

/* ---------- time zones ---------- */
let jrT = []; imp(jrT, fillsCsv(month), { label: 'et' });
p = imp(jrT, fillsCsv(month, { utc: true }), { label: 'utc-asis' });
eq('same report exported in UTC, read without conversion -> nothing added, all held as possible duplicates', [p.trades.length, p.possible.length], [0, 35]);
ok('...explained as a whole-hours time shift', p.possible.every(x => x.d.why === 'time-shift' && x.d.hours === 4), p.possible.map(x => [x.d.why, x.d.hours]).slice(0, 3));
p = imp(jrT, fillsCsv(month, { utc: true }), { label: 'utc-conv', fileTz: 'UTC' });
eq('same report with the file time zone set to UTC -> exact duplicates', [p.trades.length, p.exact.length], [0, 35]);

/* ---------- Scenario F: two accounts ---------- */
const B = mkTrades('DEMO-B', 9000).map((t, i) => Object.assign({}, t, { inF: Object.assign({}, A[i].inF, { id: String(9000 + 2 * i) }), outF: Object.assign({}, A[i].outF, { id: String(9001 + 2 * i) }) }));
let jrM = []; imp(jrM, fillsCsv(month), { label: 'acctA' });
p = imp(jrM, fillsCsv(B), { label: 'acctB' });
eq('F: identical trading in account B (copy trading) is NOT a duplicate of account A', [p.trades.length, jrM.length], [35, 70]);
ok('F: no cross-account mixing', jrM.filter(t => t.accountId === 'acct-a').length === 35 && jrM.filter(t => t.accountId === 'acct-b').length === 35);
p = imp(jrM, fillsCsv(month) + '\n' + fillsCsv(B).split('\n').slice(1).join('\n'), { label: 'both' });
eq('F: a combined two-account report adds nothing', [p.trades.length, p.exact.length], [0, 70]);
let jrW = []; imp(jrW, perfCsv(week), { label: 'wrong1', defaultAccountId: 'acct-a' });
p = imp(jrW, perfCsv(week), { label: 'wrong2', defaultAccountId: 'acct-b' });
eq('same fill ids imported into another account -> conflict (wrong account?), nothing added', [p.trades.length, p.conflicts.length], [0, 20]);
ok('...with the reason', p.conflicts.every(x => x.d.why === 'account'), p.conflicts[0] && p.conflicts[0].d);

/* ---------- identical P&L / identical time ---------- */
const twins = [A[0], Object.assign({}, A[0], { inF: { id: '1', side: A[0].inF.side, at: A[0].inF.at }, outF: { id: '2', side: A[0].outF.side, at: A[0].outF.at } })];
let jrX = []; p = imp(jrX, fillsCsv(twins), { label: 'twins' });
eq('two real trades at the same second with the same prices (no ids) -> both kept', [p.trades.length], [1]);
// FIFO pairs two identical round trips that overlap in time into one 2-lot trade? No: entries both before exits -> one trade with 2 entries.
ok('...counted with both contracts', jrX[0] && jrX[0].entries && jrX[0].entries.length === 2, jrX[0]);
p = imp(jrX, fillsCsv(twins), { label: 'twins2' }); eq('...and re-importing them adds nothing', p.trades.length, 0);
const samePnl = [A[5], Object.assign({}, A[5], { inF: Object.assign({}, A[5].inF, { at: '2026-10-06 13:01:00', id: '3' }), outF: Object.assign({}, A[5].outF, { at: '2026-10-06 13:06:30', id: '4' }) })];
let jrY = []; p = imp(jrY, fillsCsv(samePnl), { label: 'samepnl' }); eq('two trades with identical P&L at different times -> 2 trades', [p.trades.length, jrY.length], [2, 2]);
// Two complete round trips inside the same minute, same prices (flat in between): two trades with identical fingerprints.
const rt = (a, b, c, d) => Object.assign({}, A[7], { inF: Object.assign({}, A[7].inF, { at: '2026-10-07 10:00:' + a, id: c }), outF: Object.assign({}, A[7].outF, { at: '2026-10-07 10:00:' + b, id: d }) });
const sep2 = [rt('05', '20', '5', '6'), rt('40', '55', '7', '8')];
let jrZ = []; p = imp(jrZ, perfCsv(sep2), { label: 'sameMinute' });
eq('two separate round trips opened in the same minute (ids) -> 2 trades', [p.trades.length], [2]);
p = imp(jrZ, fillsCsv(sep2), { label: 'sameMinute-noid' });
eq('...and the same two from a report without ids -> both recognised (multiset), nothing added', [p.trades.length, p.exact.length], [0, 2]);

/* ---------- partial fills / a trade open at the end of a report ---------- */
const spl = A.slice(20, 23);
const part1 = fillsCsv(spl).split('\n'); const firstHalf = part1.slice(0, 2).join('\n');   // header + the first trade's entry only
let jrP = []; p = imp(jrP, firstHalf, { label: 'open' });
eq('a report that ends while the trade is open -> 1 open trade', [jrP.length, J.compute(jrP[0]).isClosed], [1, false]);
p = imp(jrP, fillsCsv(spl), { label: 'later' });
eq('the later report with the exit -> updated (more fills), not a second trade', [p.trades.length, p.updates.length, p.updates[0] && p.updates[0].d.why], [2, 1, 'more-fills']);
imp(jrP, fillsCsv(spl), { label: 'apply', apply: true });
eq('after accepting: 3 trades, the first now closed with its exit', [jrP.length, J.compute(jrP.filter(t => t.date === spl[0].inF.at.slice(0, 10))[0]).isClosed], [3, true]);
const exitOnly = [fillsCsv(spl).split('\n')[0], fillsCsv(spl).split('\n')[2]].join('\n');
let jrQ = []; imp(jrQ, firstHalf, { label: 'open2' }); p = imp(jrQ, exitOnly, { label: 'exitonly' });
eq('a report that starts with the exit of your open position -> possible, never a new opposite trade', [p.trades.length, p.possible.length, p.possible[0] && p.possible[0].d.why], [0, 1, 'open-continue']);
let jrR = []; imp(jrR, fillsCsv(month), { label: 'm' });
p = imp(jrR, firstHalf, { label: 'partOf' }); eq('a short report holding part of a known trade -> exact (part of existing)', [p.trades.length, p.exact[0] && p.exact[0].d.why], [0, 'part-of-existing']);

/* ---------- conflicts ---------- */
let jrC = []; imp(jrC, perfCsv(week), { label: 'c1' });
const moved = week.map((t, i) => i === 2 ? Object.assign({}, t, { exit: t.exit + 1 }) : t);
p = imp(jrC, perfCsv(moved), { label: 'c2' });
eq('same fill ids but a different price -> conflict, nothing changed', [p.trades.length, p.conflicts.length, p.conflicts[0] && p.conflicts[0].d.why, jrC.length], [0, 1, 'changed', 20]);

/* ---------- manual entries ---------- */
let jrH = []; const man = J.normalizeTrade({ date: '2026-10-05', time: jrForTime(), contract: 'MNQ', side: 'long', contracts: 1, entry: A[0].entry, exits: [{ qty: 1, price: A[0].exit }], accountId: 'acct-a', notes: 'typed by me' });
function jrForTime() { return A[0].inF.at.slice(11, 16); }
ok('manual trade built', man.ok, man.errors); jrH.push(man.trade);
p = imp(jrH, fillsCsv([A[0]]), { label: 'manual' });
eq('an import that matches a trade typed by hand -> possible (merge offered), not added', [p.trades.length, p.possible.length, p.possible[0] && p.possible[0].d.why, p.possible[0] && p.possible[0].d.mode], [0, 1, 'matches-manual', 'merge']);
const merged = D.applyUpdate(jrH[0], p.possible[0].trade, 'merge');
ok('merge keeps the hand-entered note and adds source keys', merged.notes === 'typed by me' && merged.srcKeys.length === 2 && merged.id === jrH[0].id, merged);

/* ---------- Scenario G: restart (journal saved and read back), interrupted import, two devices ---------- */
let jrG = []; imp(jrG, perfCsv(week), { label: 'g1' });
const stored = J.parseStored(J.serializeStored(jrG)).trades;
p = imp(stored, perfCsv(month), { label: 'g2' }); eq('G: after a restart (journal reloaded from storage) the monthly report adds only 15', [p.trades.length, stored.length], [15, 35]);
let dev1 = [], dev2 = []; imp(dev1, perfCsv(week), { label: 'dev1' }); imp(dev2, perfCsv(week), { label: 'dev2' });
eq('two devices importing the same report create the same trade ids (the cloud keeps one copy)', dev1.map(t => t.id).sort(), dev2.map(t => t.id).sort());
ok('trade ids are valid journal ids', dev1.every(t => /^[A-Za-z0-9_-]{1,40}$/.test(t.id)), dev1[0].id);
let crash = []; const parsedC = I.parseCsv(perfCsv(week)); // plan built, never committed (crash) -> retry from scratch
imp([], perfCsv(week), { label: 'crash' }); p = imp(crash, perfCsv(week), { label: 'retry' }); eq('G: a plan that was never saved leaves nothing behind; the retry imports 20', [p.trades.length, crash.length], [20, 20]);

/* ---------- earlier versions' keys ---------- */
const legacy = JSON.parse(JSON.stringify(jr.slice(0, 20))).map(t => Object.assign(t, { id: 'old' + t.id.slice(1, 12), srcKeys: t.srcKeys.map(k => k.replace(/^tv:F:/, 'tv:pf::')) }));
p = imp(legacy, perfCsv(week), { label: 'legacy' }); eq('trades imported by the previous version (old key format) are still recognised', [p.trades.length, p.exact.length], [0, 20]);

/* ---------- archive helpers ---------- */
const sepT = D.asSeparate(p.exact[0].trade, 'restored1');
ok('restored-as-separate gets its own keys', sepT.id === 'restored1' && sepT.srcKeys.every(k => /^sep:/.test(k)), sepT.srcKeys);
const withSep = legacy.concat([sepT]); p = imp(withSep, perfCsv(week), { label: 'afterSep' }); eq('re-importing after a restore still adds nothing', [p.trades.length, p.exact.length], [0, 20]);
const im = D.impact(J.analyze(jr.slice(0, 3)).map(r => ({ trade: r.t, c: r.c })));
ok('impact: gross and net of 3 trades with fees', im.closed === 3 && im.netCents != null && im.grossCents === J.analyze(jr.slice(0, 3)).reduce((a, r) => a + r.c.grossCents, 0), im);
const im2 = D.impact(J.analyze(jr2.slice(0, 2)).map(r => ({ trade: r.t, c: r.c })));
eq('impact: fees unknown -> net unknown (not $0)', [im2.netCents, im2.feesUnknown], [null, 2]);
eq('tally', D.tally([{ cls: 'new' }, { cls: 'exact' }, { cls: 'exact' }]), { new: 1, exact: 2, updated: 0, possible: 0, conflict: 0, invalid: 0 });

/* ---------- scanning the active journal (after a restore or a sync) ---------- */
const dupCopy = Object.assign(JSON.parse(JSON.stringify(jr[0])), { id: 'copy1', importBatch: 'other' });
let g = D.scan(jr.concat([dupCopy]));
eq('scan: the same execution in two trades -> one certain group', g.map(x => [x.level, x.ids.length]), [['certain', 2]]);
g = D.scan(jr.concat([dupCopy]), { [D.pairKey(jr[0].id, 'copy1')]: 1 }); eq('scan: a pair you marked as separate is not reported again', g.length, 0);
const noKeys = Object.assign(JSON.parse(JSON.stringify(jr[1])), { id: 'hand1' }); delete noKeys.srcKeys; delete noKeys.importBatch;
g = D.scan(jr.concat([noKeys])); eq('scan: an imported trade and an identical hand-entered one -> possible', g.map(x => x.level), ['possible']);
const sameBatch = jrX.concat([Object.assign(JSON.parse(JSON.stringify(jrX[0])), { id: 'b2', srcKeys: ['zz#1'] })]);
g = D.scan(sameBatch); eq('scan: identical trades from the SAME report are separate trades, not reported', g.length, 0);
eq('scan: an empty journal', D.scan([]), []);

/* ---------- keys ---------- */
eq('contract keys ignore spelling', ['MNQZ6', 'MNQ Z26', '/MNQZ2026', 'MNQ 12-26', 'MNQ DEC26'].map(s => D.contractKey(s)), ['MNQ:Z6', 'MNQ:Z6', 'MNQ:Z6', 'MNQ:Z6', 'MNQ:Z6']);
ok('different expiry -> different key', D.contractKey('MNQH7') !== D.contractKey('MNQZ6'));
eq('instant keys ignore sub-second precision', D.instantKey({ ms: 1760000000999 }), D.instantKey({ ms: 1760000000000 }));

/* ---------- large journal ---------- */
const big = []; for (let i = 0; i < 3000; i++) big.push(J.normalizeTrade({ id: 'b' + i, date: '2026-01-02', time: '10:' + p2(i % 60), contract: 'MNQ', side: 'long', contracts: 1, entry: 20000 + i * 0.25, exits: [{ qty: 1, price: 20001 + i * 0.25 }], srcKeys: ['k' + i] }).trade);
let t0 = Date.now(); const bix = D.index(big, t => J.compute(t)); g = D.scan(big); const ms = Date.now() - t0;
ok('3,000 trades indexed and scanned in under 2 s', ms < 2000 && g.length === 0, ms);

/* ---------- commit + undo (what the Import screen saves in one transaction) ---------- */
function db() { return { trades: {}, docs: {} }; }
function applyOps(st, ops) { ops.forEach(o => { if (o.type === 'put') st[o.store][o.value.id] = JSON.parse(JSON.stringify(o.value)); else if (o.type === 'del') delete st[o.store][o.key]; }); }
let bn = 0;
function commitImport(st, text, o, choices) {
  o = Object.assign({}, BASE, o || {}); const parsed = I.parseCsv(text), det = T.detect(parsed.headers); o.report = det.report;
  const list = Object.values(st.trades), rd = T.read(parsed, det.report, o), ix = D.index(list, t => J.compute(t)), batchId = 'imp-t' + (bn++);
  const plan = I.plan(parsed, Object.assign({}, o, { batchId, mode: 'fills', preRead: rd, pnlByKey: rd.pnlByKey, ambiguousKeys: rd.ambiguousKeys, enrich: T.enricher(rd, o), dedupe: { ix, src: 'f' } }), new Set(), J);
  const cur = {}; list.forEach(t => cur[t.id] = t);
  const out = D.buildCommit([{ file: o.file || 'report.csv', plan }], choices || {}, { batchId, now: Date.now() + bn, current: cur });
  const doc = { id: batchId, kind: 'import', at: Date.now() + bn, tradeIds: out.tradeIds, hashes: out.hashes, updates: out.updates, counts: out.counts };
  applyOps(st, out.puts.map(t => ({ store: 'trades', type: 'put', value: t })).concat(out.dupes.map(d => ({ store: 'docs', type: 'put', value: d }))).concat([{ store: 'docs', type: 'put', value: doc }]));
  return { doc, out, plan };
}
function undo(st, doc) { const dupes = Object.values(st.docs).filter(d => d.kind === 'dupe' && d.batchId === doc.id); const r = D.buildRollback(st.docs[doc.id], st.trades, dupes, {}, Date.now() + 999); applyOps(st, r.ops); return r.result; }
const nT = st => Object.keys(st.trades).length, gross = st => J.analyze(Object.values(st.trades)).reduce((a, r) => a + (r.c.isClosed ? r.c.grossCents : 0), 0);
let S1 = db(); const w = commitImport(S1, perfCsv(week)); const g20 = gross(S1);
eq('commit: weekly -> 20 trades, import history counts', [nT(S1), w.doc.counts.trades, w.doc.counts.rows], [20, 20, 20]);
const w2 = commitImport(S1, perfCsv(week));
eq('commit: same report again -> 0 added, 20 duplicates recorded in the archive', [nT(S1), w2.doc.counts.trades, w2.doc.counts.duplicates, Object.values(S1.docs).filter(d => d.kind === 'dupe' && d.cls === 'exact').reduce((a, d) => a + d.items.length, 0)], [20, 0, 20, 20]);
ok('archived duplicates never reach the trade list', Object.values(S1.trades).length === 20 && gross(S1) === g20);
const mth = commitImport(S1, perfCsv(month));
eq('commit: monthly -> 35', [nT(S1), mth.doc.counts.trades, mth.doc.counts.duplicates], [35, 15, 20]);
const edited = mth.doc.tradeIds[0]; S1.trades[edited] = Object.assign({}, S1.trades[edited], { notes: 'reviewed' });
let rr = undo(S1, mth.doc);
eq('undo the monthly import: removes its 14 untouched trades, keeps the one you edited, never touches the weekly 20', [rr.removed, rr.kept, nT(S1)], [14, 1, 21]);
ok('undo marks the import as rolled back and deletes its untouched archive records', S1.docs[mth.doc.id].rolledBack && !Object.values(S1.docs).some(d => d.kind === 'dupe' && d.batchId === mth.doc.id && !d.voided));
let S2 = db(); commitImport(S2, perfCsv(week)); const feeImp = commitImport(S2, fillsCsv(week, { fees: true }));
eq('commit: fee updates applied by default (fees were missing) and recorded', [feeImp.doc.counts.updated, Object.values(S2.trades).filter(t => t.feesCents != null).length], [20, 20]);
const keepId = feeImp.doc.updates[1].id; S2.trades[keepId] = Object.assign({}, S2.trades[keepId], { notes: 'edited after' });
rr = undo(S2, feeImp.doc);
eq('undo a fee update: 19 reverted to "fees unknown", the one you edited since is kept', [rr.reverted, rr.keptUpdates, Object.values(S2.trades).filter(t => t.feesCents != null).length], [19, 1, 1]);
let S3 = db(); commitImport(S3, fillsCsv(week, { fees: true })); const fc = commitImport(S3, fillsCsv(week.map(t => Object.assign({}, t, { fee: t.fee * 2 })), { fees: true }));
eq('commit: changed fees are NOT applied without your OK (kept for review)', [fc.doc.counts.updated, fc.doc.counts.review, Object.values(S3.docs).filter(d => d.status === 'review').length], [0, 20, 20]);
const k0 = D.updKey(fc.plan.updates[0]); const fc2 = commitImport(S3, fillsCsv(week.map(t => Object.assign({}, t, { fee: t.fee * 2 })), { fees: true }), {}, { upd: { [D.updKey(fc.plan.updates[0]).split(':')[0] + ':' + fc.plan.updates[0].fp]: true } });
eq('...and applied when you tick it', fc2.doc.counts.updated, 1);
let S4 = db(); commitImport(S4, perfCsv(week)); const off = commitImport(S4, perfCsv(month), {}, { off: { [mth.plan.trades[0].fp]: 1 } });
eq('unticked new trades are not imported and are counted as deselected', [off.doc.counts.trades, off.doc.counts.deselected], [14, 1]);

console.log(fail ? 'FAILED ' + pass + ' passed, ' + fail + ' failed' : 'ALL PASSED ' + pass + ' passed, 0 failed'); process.exit(fail ? 1 : 0);
