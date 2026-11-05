/* Tamhas Trading - personal account ledger (pure logic: no DOM, no storage, no network). Whole cents everywhere. Node-testable.

   For accounts funded with YOUR money (personal live) and demo / paper accounts. No prop-firm rule is ever applied here: no profit
   target, no evaluation, no trailing drawdown, no payout conditions, no consistency rule.

   Accounting rules:
     balance       = opening balance + net trading P&L + deposits - withdrawals +/- adjustments - account fees + transfers in - transfers out
     net trading   = realized gross P&L of CLOSED trades - their trading fees (commissions, exchange and regulatory fees on the trades)
     A deposit is not profit. A withdrawal is not a loss. Unrealized P&L of open positions is never added (TRC has no live prices).
   Unknown stays unknown: a missing starting balance or a closed trade without fees makes the result "needs verification" (with a lower
   or partial figure clearly labelled), never a guess. Broker-reported balances (snapshots) are compared with the calculated balance at
   the same moment, and any difference is flagged - TRC never silently "corrects" one to match the other. */
(function (root) {
  'use strict';
  var DEF = 'acct-default';
  var CASH = { deposit: 1, withdrawal: -1, payout: -1, 'transfer-in': 1, 'transfer-out': -1 };
  var TYPES = [
    ['personal-live', 'Personal live account', 'Your own money with a broker. No prop-firm rules.'],
    ['personal-demo', 'Personal demo / paper account', 'Practice account with simulated money. No prop-firm rules.'],
    ['prop-eval', 'Prop firm evaluation', 'A challenge or evaluation with the firm\'s rules.'],
    ['prop-funded', 'Prop firm funded account', 'A funded account with the firm\'s payout rules.'],
    ['other', 'Other / custom', 'Anything else.']
  ];
  var BROKERS = ['Tradovate', 'NinjaTrader', 'TradeStation', 'Interactive Brokers', 'AMP Futures', 'Optimus Futures', 'Charles Schwab', 'Other'];
  var CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY'];
  // TRC stores the five account types on top of the existing categories, so older data needs no migration.
  function typeOf(a) {
    if (!a) return 'other';
    if (a.category === 'live') return 'personal-live';
    if (a.category === 'sim') return 'personal-demo';
    if (a.category === 'prop') return a.status === 'funded' || a.status === 'passed' ? 'prop-funded' : 'prop-eval';
    return 'other';
  }
  function fromType(type) { return { 'personal-live': { category: 'live' }, 'personal-demo': { category: 'sim' }, 'prop-eval': { category: 'prop', status: 'evaluation' }, 'prop-funded': { category: 'prop', status: 'funded' }, other: { category: 'other' } }[type] || null; }
  function isPersonal(a) { return !!a && (a.category === 'live' || a.category === 'sim'); }
  function typeLabel(a) { var t = typeOf(a); for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === t) return TYPES[i][1]; return 'Other'; }

  function usable(l) { return l && !l.voided && typeof l.at === 'number' && isFinite(l.at); }
  function signOf(l) { if (l.type === 'adjustment') return l.dir === 'down' ? -1 : 1; return CASH[l.type] || 0; }

  /* rows: analyzed trades [{t, c}] (TTJournalCore.analyze) of ANY accounts; ledger: all ledger records.
     opts: {asOf: {date:'YYYY-MM-DD', at: ms}} limits everything to that moment (used to compare with a broker snapshot). */
  function balance(acct, rows, ledger, opts) {
    opts = opts || {}; var id = acct.id, asOf = opts.asOf || null, start = acct.startedOn || null;
    var mine = (rows || []).filter(function (r) { return (r.t.accountId || DEF) === id; });
    var before = start ? mine.filter(function (r) { return r.t.date < start; }) : [];
    var counted = mine.filter(function (r) { return (!start || r.t.date >= start) && (!asOf || r.t.date <= asOf.date); });
    var closed = counted.filter(function (r) { return r.c.isClosed; }), open = counted.filter(function (r) { return !r.c.isClosed; });
    var out = { currency: acct.currency || 'USD', openingCents: acct.startingBalanceCents == null ? null : acct.startingBalanceCents, trades: counted.length, closed: closed.length, open: open.length, beforeStart: before.length,
      grossCents: 0, tradeFeesCents: 0, feesUnknown: 0, netTradingCents: null, netTradingExact: true, depositsCents: 0, withdrawalsCents: 0, adjustmentsCents: 0, accountFeesCents: 0, transfersInCents: 0, transfersOutCents: 0,
      cashFlowCents: 0, balanceCents: null, exact: true, reasons: [], unrealized: open.length ? 'unavailable' : null, broker: null };
    closed.forEach(function (r) { out.grossCents += r.c.grossCents; if (r.c.feesCents == null || r.c.feesMissing) out.feesUnknown++; else out.tradeFeesCents += r.c.feesCents; });
    out.netTradingCents = out.grossCents - out.tradeFeesCents; if (out.feesUnknown) { out.netTradingExact = false; out.exact = false; out.reasons.push(out.feesUnknown + ' closed trade' + (out.feesUnknown === 1 ? ' has' : 's have') + ' no fees entered, so net trading P&L is higher than the real figure.'); }
    if (!closed.length) out.netTradingCents = 0;
    (ledger || []).forEach(function (l) {
      if (!usable(l) || l.accountId !== id || l.type === 'snapshot') return; if (asOf && l.at > asOf.at) return; if (!Number.isInteger(l.amountCents) || l.amountCents <= 0) return;
      if (l.type === 'deposit') out.depositsCents += l.amountCents; else if (l.type === 'withdrawal' || l.type === 'payout') out.withdrawalsCents += l.amountCents;
      else if (l.type === 'adjustment') out.adjustmentsCents += signOf(l) * l.amountCents; else if (l.type === 'fee') out.accountFeesCents += l.amountCents;
      else if (l.type === 'transfer-in') out.transfersInCents += l.amountCents; else if (l.type === 'transfer-out') out.transfersOutCents += l.amountCents;
    });
    out.cashFlowCents = out.depositsCents - out.withdrawalsCents + out.transfersInCents - out.transfersOutCents;
    if (out.openingCents == null) { out.exact = false; out.reasons.unshift('Enter the starting balance to calculate the account balance.'); }
    else out.balanceCents = out.openingCents + out.netTradingCents + out.cashFlowCents + out.adjustmentsCents - out.accountFeesCents;
    if (out.currency !== 'USD') { out.exact = false; out.balanceCents = null; out.reasons.unshift('Trade P&L is calculated in US dollars and this account is in ' + out.currency + '. TRC does not convert currencies, so enter balances from your broker instead.'); }
    if (out.beforeStart) out.reasons.push(out.beforeStart + ' trade' + (out.beforeStart === 1 ? ' is' : 's are') + ' dated before the account\'s starting date and ' + (out.beforeStart === 1 ? 'is' : 'are') + ' not counted in the balance.');
    if (out.open) out.reasons.push(out.open + ' open position' + (out.open === 1 ? '' : 's') + ': unrealized P&L is not included (TRC has no live prices).');
    return out;
  }

  // Latest broker-reported balance vs TRC's calculation at the same moment. difference = broker - calculated.
  function reconcile(acct, rows, ledger) {
    var snaps = (ledger || []).filter(function (l) { return usable(l) && l.accountId === acct.id && l.type === 'snapshot' && Number.isInteger(l.balanceCents); }).sort(function (a, b) { return b.at - a.at; });
    if (!snaps.length) return null;
    var s = snaps[0], calc = balance(acct, rows, ledger, { asOf: { date: s.date || new Date(s.at).toISOString().slice(0, 10), at: s.at } });
    var diff = calc.balanceCents == null ? null : s.balanceCents - calc.balanceCents;
    return { at: s.at, date: s.date || null, brokerCents: s.balanceCents, calculatedCents: calc.balanceCents, differenceCents: diff, matches: diff != null && Math.abs(diff) <= 1, exact: calc.exact, id: s.id,
      hint: diff == null ? 'Enter a starting balance to compare.' : Math.abs(diff) <= 1 ? 'Matches your broker.' : 'Unexplained difference. Common causes: missing trades or fees, a deposit or withdrawal not entered, or trades in the wrong account.' };
  }

  // Your own alert (not a broker rule): today's net trading result vs the limit you set. Never blocks anything.
  function dailyAlert(acct, rows, today) {
    var lim = acct.riskAlert && Number.isInteger(acct.riskAlert.dailyLossCents) && acct.riskAlert.dailyLossCents > 0 ? acct.riskAlert.dailyLossCents : null; if (!lim) return null;
    var day = (rows || []).filter(function (r) { return (r.t.accountId || DEF) === acct.id && r.t.date === today && r.c.isClosed; });
    var gross = day.reduce(function (a, r) { return a + r.c.grossCents; }, 0), fees = day.reduce(function (a, r) { return a + (r.c.feesCents || 0); }, 0), net = gross - fees;
    return { limitCents: lim, todayCents: net, reached: net <= -lim, label: 'Your own alert, not a broker rule' };
  }

  // Estimated fees for a trade from the account's own per-contract costs (per side), used only when a report has no fees.
  function estimateFees(acct, trade) {
    var per = (acct && Number.isInteger(acct.commissionCents) ? acct.commissionCents : null), ex = acct && Number.isInteger(acct.exchangeFeeCents) ? acct.exchangeFeeCents : 0;
    if (per == null) return null;
    var en = trade.entries && trade.entries.length ? trade.entries : [{ qty: trade.contracts }], sides = en.reduce(function (a, x) { return a + x.qty; }, 0) + (trade.exits || []).reduce(function (a, x) { return a + x.qty; }, 0);
    return Math.round((per + ex) * sides);
  }

  var api = { TYPES: TYPES, BROKERS: BROKERS, CURRENCIES: CURRENCIES, typeOf: typeOf, fromType: fromType, isPersonal: isPersonal, typeLabel: typeLabel, balance: balance, reconcile: reconcile, dailyAlert: dailyAlert, estimateFees: estimateFees, signOf: signOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTLiveCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
