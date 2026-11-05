// Personal live / demo accounts and the cash-flow ledger - pure-logic tests (Part 6, 7, 17; Part 19 D and E). All data synthetic.
const path = require('path'), R = path.join(__dirname, '..', 'assets') + '/';
global.TTSessions = require(R + 'sessions.js'); global.TTInstruments = require(R + 'instruments.js');
const J = require(R + 'journal-core.js'), A = require(R + 'accounts-core.js'), L = require(R + 'live-core.js'), D = require(R + 'dd-core.js');
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const tr = (o) => J.normalizeTrade(Object.assign({ date: '2026-11-03', time: '09:31', contract: 'MNQ', side: 'long', contracts: 1, entry: 21000, exits: [{ qty: 1, price: 21000 }], accountId: 'acct-live' }, o)).trade;
const rowsOf = ts => J.analyze(ts);
const led = (type, cents, o) => Object.assign({ id: 'l' + Math.random().toString(36).slice(2), accountId: 'acct-live', type, amountCents: cents, date: '2026-11-03', at: Date.parse('2026-11-03T20:00:00Z'), voided: false }, o || {});

// ---- Scenario D: a Tradovate personal live account with $100
const made = A.newAccount({ id: 'acct-live', name: 'My Tradovate', category: L.fromType('personal-live').category, startingBalance: '100', broker: 'Tradovate', startedOn: '2026-11-01' }, Date.parse('2026-11-01T12:00:00Z'));
ok('D: created', made.ok, made.errors); const live = A.normalizeAccount(made.account);
eq('D: type is personal live (not prop)', [L.typeOf(live), L.typeLabel(live), L.isPersonal(live)], ['personal-live', 'Personal live account', true]);
eq('D: no prop rules, no profit target, no evaluation, no payout rules', [Object.keys(live.rules).length, live.status, Object.keys(live.payoutRules).length, live.firmSlug, live.template], [0, 'active', 0, null, null]);
ok('D: only active/closed statuses (no evaluation states)', A.STATUSES.live.join() === 'active,closed');
let b = L.balance(live, [], []);
eq('D: starting balance $100, nothing else', [b.openingCents, b.balanceCents, b.netTradingCents, b.exact], [10000, 10000, 0, true]);

// ---- Scenario E: deposit, withdrawal, trading gain and trading fee
// MNQ = $2/point. +15 points = +$30.00 gross; fees $5.00 -> net trading +$25.00
const trades = [tr({ exits: [{ qty: 1, price: 21015 }], feesCents: 500 })];
const ledger = [led('deposit', 5000), led('withdrawal', 1000)];
b = L.balance(live, rowsOf(trades), ledger);
eq('E: gross +30, fees 5, net trading +25', [b.grossCents, b.tradeFeesCents, b.netTradingCents], [3000, 500, 2500]);
eq('E: deposit and withdrawal are cash flow, not trading', [b.depositsCents, b.withdrawalsCents, b.cashFlowCents], [5000, 1000, 4000]);
eq('E: balance = 100 + 25 + 50 - 10 = 165', b.balanceCents, 16500);
ok('E: the deposit is never trading profit', b.netTradingCents === 2500 && b.exact);

// ---- more ledger cases
eq('zero starting balance is allowed', [A.newAccount({ name: 'Zero', category: 'live', startingBalance: '0' }).ok, A.newAccount({ name: 'Zero', category: 'live', startingBalance: '0' }).account.startingBalanceCents], [true, 0]);
ok('negative starting balance refused', !A.newAccount({ name: 'N', category: 'live', startingBalance: '-1' }).ok);
ok('3 decimals refused', !A.newAccount({ name: 'N', category: 'live', startingBalance: '1.005' }).ok);
const zero = A.normalizeAccount(Object.assign(A.newAccount({ id: 'acct-live', name: 'Z', category: 'live', startingBalance: '0', startedOn: '2026-11-01' }).account));
eq('zero balance + deposit 100 + loss 40 (fees 2) = 58', L.balance(zero, rowsOf([tr({ exits: [{ qty: 1, price: 20980 }], feesCents: 200 })]), [led('deposit', 10000)]).balanceCents, 10000 - 4000 - 200);
const adj = [led('adjustment', 250, { dir: 'down', note: 'broker data fee' }), led('adjustment', 100, { dir: 'up', note: 'rebate' })];
eq('adjustments carry their own direction', L.balance(live, [], adj).adjustmentsCents, -150);
eq('account fees (data, platform) reduce the balance but not trading P&L', (() => { const x = L.balance(live, [], [led('fee', 1500, { feeKind: 'data' })]); return [x.balanceCents, x.netTradingCents]; })(), [8500, 0]);
eq('voided entries are ignored', L.balance(live, [], [led('deposit', 5000, { voided: true })]).balanceCents, 10000);
eq('entries of other accounts are ignored', L.balance(live, rowsOf([tr({ accountId: 'other', exits: [{ qty: 1, price: 21100 }] })]), [led('deposit', 5000, { accountId: 'other' })]).balanceCents, 10000);
b = L.balance(live, rowsOf([tr({ exits: [{ qty: 1, price: 21015 }] })]), []);
eq('fees unknown -> balance shown but marked needs verification, never treated as $0 fees silently', [b.balanceCents, b.exact, b.feesUnknown, /no fees/.test(b.reasons.join(' '))], [13000, false, 1, true]);
b = L.balance(live, rowsOf([tr({ exits: [] })]), []);
eq('open position: not realized, unrealized unavailable', [b.open, b.closed, b.balanceCents, b.unrealized], [1, 0, 10000, 'unavailable']);
b = L.balance(Object.assign({}, live, { startingBalanceCents: null }), rowsOf(trades), []);
eq('missing starting balance -> balance unknown, with the reason', [b.balanceCents, /starting balance/.test(b.reasons[0])], [null, true]);
b = L.balance(Object.assign({}, live, { currency: 'EUR' }), rowsOf(trades), []);
eq('non-USD account: no silent currency conversion', [b.balanceCents, /does not convert/.test(b.reasons[0])], [null, true]);
b = L.balance(live, rowsOf([tr({ date: '2026-10-20', exits: [{ qty: 1, price: 21050 }], feesCents: 0 })]), []);
eq('trades before the starting date are not counted (and are reported)', [b.balanceCents, b.beforeStart], [10000, 1]);
const multi = [tr({ contract: 'MES', entry: 6800, exits: [{ qty: 1, price: 6802 }], feesCents: 100 }), tr({ contract: 'NQ', entry: 21000, exits: [{ qty: 1, price: 21001 }], feesCents: 300 }), tr({ contract: 'MNQ', entry: 21000, exits: [{ qty: 1, price: 21001 }], feesCents: 100 })];
eq('multiple instruments use their own point values (MES $5, NQ $20, MNQ $2)', L.balance(live, rowsOf(multi), []).grossCents, 1000 + 2000 + 200);
const many = []; for (let i = 0; i < 999; i++) many.push(tr({ id: 'm' + i, exits: [{ qty: 1, price: 21000.25 }], feesCents: 1 }));
eq('decimal precision over 999 trades: 0.25 pt x $2 - $0.01 = $0.49 each', L.balance(live, rowsOf(many), []).netTradingCents, 999 * 49);
const big = A.newAccount({ name: 'Big', category: 'live', startingBalance: '2500000.55' }); eq('large balances keep cents', big.account.startingBalanceCents, 250000055);

// ---- reconciliation against the broker's balance
const snapAt = Date.parse('2026-11-03T23:00:00Z');
let rc = L.reconcile(live, rowsOf(trades), ledger.concat([led('snapshot', undefined, { amountCents: undefined, balanceCents: 16500, at: snapAt })]));
eq('broker balance matches the calculation', [rc.brokerCents, rc.calculatedCents, rc.differenceCents, rc.matches], [16500, 16500, 0, true]);
rc = L.reconcile(live, rowsOf(trades), ledger.concat([led('snapshot', undefined, { amountCents: undefined, balanceCents: 16200, at: snapAt })]));
eq('an unexplained difference is flagged, not corrected', [rc.differenceCents, rc.matches, /Unexplained/.test(rc.hint)], [-300, false, true]);
rc = L.reconcile(live, rowsOf(trades.concat([tr({ id: 'later', date: '2026-11-04', exits: [{ qty: 1, price: 21100 }], feesCents: 0 })])), ledger.concat([led('snapshot', undefined, { amountCents: undefined, balanceCents: 16500, at: snapAt })]));
ok('the comparison uses the balance at the snapshot time (later trades excluded)', rc.matches, rc);
eq('no snapshot -> nothing to compare', L.reconcile(live, [], []), null);

// ---- personal alerts and fee estimates
const al = A.normalizeAccount(A.newAccount({ id: 'acct-live', name: 'A', category: 'live', startingBalance: '100', dailyLossAlert: '20' }).account);
const da = L.dailyAlert(al, rowsOf([tr({ exits: [{ qty: 1, price: 20989 }], feesCents: 100 })]), '2026-11-03');
eq('daily loss alert is yours, labelled as not a broker rule', [da.limitCents, da.todayCents, da.reached, da.label], [2000, -2300, true, 'Your own alert, not a broker rule']);
eq('no alert set -> none', L.dailyAlert(live, [], '2026-11-03'), null);
const cm = A.normalizeAccount(A.newAccount({ name: 'C', category: 'live', commission: '0.39', exchangeFee: '0.35' }).account);
eq('fee estimate: (0.39 + 0.35) x 2 sides x 2 contracts = $2.96', L.estimateFees(cm, tr({ contracts: 2, exits: [{ qty: 2, price: 21001 }] })), 296);
eq('no commission saved -> no estimate', L.estimateFees(live, tr({})), null);

// ---- types map onto stored categories (no migration of older data)
eq('five account types', L.TYPES.map(t => t[0]), ['personal-live', 'personal-demo', 'prop-eval', 'prop-funded', 'other']);
eq('type round trip', L.TYPES.map(t => L.typeOf(A.normalizeAccount(Object.assign({ id: 'x', name: 'x', createdAt: 1 }, L.fromType(t[0]))))), ['personal-live', 'personal-demo', 'prop-eval', 'prop-funded', 'other']);
ok('Tradovate is a broker option', L.BROKERS.indexOf('Tradovate') >= 0);

// ---- audited edits (starting balance changes are kept in history)
const ed = A.editDetails(live, { startingBalance: '150' }, 'broker statement', 5);
eq('editing the starting balance is logged with old and new value', [ed.ok, ed.account.startingBalanceCents, ed.account.changeLog[0].from, ed.account.changeLog[0].to, ed.account.changeLog[0].note], [true, 15000, 10000, 15000, 'broker statement']);
ok('account alias refuses full account numbers', !A.editDetails(live, { accountAlias: 'DU12345678' }).ok);

// ---- ledger validation (shared with the prop tracker)
const v = D.validateLedger({ type: 'adjustment', accountId: 'acct-live', date: '2026-11-03', amount: '2.50', dir: 'down', note: '' }, { now: Date.parse('2026-11-04T00:00:00Z') });
ok('adjustment needs a reason', !v.ok && /reason/.test(v.errors.join(' ')), v.errors);
const v2 = D.validateLedger({ type: 'withdrawal', accountId: 'acct-live', date: '2026-11-03', amount: '10' }, { now: Date.parse('2026-11-04T00:00:00Z') });
ok('withdrawal is a valid record type', v2.ok && v2.record.amountCents === 1000, v2);
ok('backup reader keeps withdrawals and adjustments', J.cleanLedger([Object.assign(led('withdrawal', 100), {}), led('adjustment', 100, { dir: 'up' }), led('adjustment', 100)]).list.length === 2);
const dd = D.evaluate ? true : true; ok('dd-core signs: withdrawal -1, adjustment by direction', D.signOf({ type: 'withdrawal' }) === -1 && D.signOf({ type: 'adjustment', dir: 'down' }) === -1 && D.signOf({ type: 'adjustment', dir: 'up' }) === 1);

console.log(fail ? 'FAILED ' + pass + ' passed, ' + fail + ' failed' : 'ALL PASSED ' + pass + ' passed, 0 failed'); process.exit(fail ? 1 : 0);
