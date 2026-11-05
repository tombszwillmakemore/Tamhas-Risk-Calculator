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

  /* Balance of a personal account. Since 2.3.0 this is a thin view over TTCash.summarize, the ONE accounting engine used by the account panel,
     the Cashflow screen and Copilot (it adds Cash History authority, broker checkpoints and reconciliation states). The fields below are kept
     for older callers. opts.asOf limits the calculation to a moment (used for comparisons). */
  // looked up on use: cash-core.js may load after this file
  function eng() { return root.TTCash || (typeof require !== 'undefined' ? require('./cash-core.js') : null); }
  function balance(acct, rows, ledger, opts) {
    opts = opts || {}; var cut = opts.asOf || null;
    var led = cut ? (ledger || []).filter(function (l) { return !(typeof l.at === 'number' && l.at > cut.at); }) : ledger;
    var rws = cut ? (rows || []).filter(function (r) { return r.t.date <= cut.date; }) : rows;
    var s = eng().summarize(acct, led, rws, { now: opts.now });
    var t = s.totals, closedMine = (rws || []).filter(function (r) { return (r.t.accountId || DEF) === acct.id && r.c.isClosed; });
    var reasons = s.reasons.filter(function (x) { return !/No broker balance to compare with/.test(x); }).concat(s.discrepancies.filter(function (d) { return d.kind === 'currency'; }).map(function (d) { return d.text; }));
    if (s.opening.cents == null && !reasons.some(function (x) { return /opening balance is unknown/i.test(x); })) reasons.unshift('Enter the starting balance to calculate the account balance.');
    var before = s.excluded.trades.filter(function (x) { return /before the starting date/.test(x.why); }).length;
    if (before) reasons.push(before + ' trade' + (before === 1 ? ' is' : 's are') + ' dated before the account\'s starting date and ' + (before === 1 ? 'is' : 'are') + ' not counted in the balance.');
    var feesUnknown = s.unknownFees;
    if (feesUnknown && !reasons.some(function (x) { return /no fees entered/.test(x); })) reasons.push(feesUnknown + ' closed trade(s) have no fees entered, so net trading P&L is higher than the real figure.');
    return { currency: s.currency, openingCents: acct.startingBalanceCents == null ? (s.opening.source === 'broker' ? s.opening.cents : null) : s.opening.cents, trades: (rws || []).filter(function (r) { return (r.t.accountId || DEF) === acct.id; }).length,
      closed: closedMine.length - before, open: s.openPositions, beforeStart: before, grossCents: t.grossCents, tradeFeesCents: t.tradingFeesCents, feesUnknown: feesUnknown, netTradingCents: t.netTradingCents, netTradingExact: !feesUnknown,
      depositsCents: t.depositsCents, withdrawalsCents: t.withdrawalsCents, adjustmentsCents: t.adjustmentsCents, accountFeesCents: t.accountFeesCents, transfersInCents: t.transfersInCents, transfersOutCents: t.transfersOutCents,
      cashFlowCents: t.depositsCents - t.withdrawalsCents + t.transfersInCents - t.transfersOutCents, balanceCents: s.balanceCents,
      exact: s.balanceCents != null && !feesUnknown && !s.estimatedFees, reasons: reasons, unrealized: s.openPositions ? 'unavailable' : null, broker: null, summary: s };
  }

  // Latest broker balance vs TRC's calculation at the same moment. difference = broker - calculated.
  function reconcile(acct, rows, ledger) {
    var s = eng().summarize(acct, ledger, rows, {}), cp = s.checkpoints[s.checkpoints.length - 1];
    if (!cp) return null;
    var diff = cp.calcCents == null ? null : cp.brokerCents - cp.calcCents;
    return { at: cp.at, date: cp.date, brokerCents: cp.brokerCents, calculatedCents: cp.calcCents, differenceCents: diff, matches: diff != null && Math.abs(diff) <= 0, exact: s.balanceExact, id: cp.id || null, source: cp.source,
      hint: diff == null ? 'Enter a starting balance to compare.' : diff === 0 ? 'Matches your broker.' : 'Unexplained difference. Common causes: missing trades or fees, a deposit or withdrawal not entered, or trades in the wrong account.' };
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
