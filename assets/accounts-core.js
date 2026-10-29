/* Tamhas Trading - accounts & prop-firm profiles (pure logic, no DOM, no storage).
   A prop profile is an EDITABLE COPY of a researched template. Nothing here claims an official rule:
   every rule keeps where it came from (source + type) and when it was last verified, and every edit is kept in a history. */
(function (root) {
  'use strict';
  var CATEGORIES = ['prop', 'live', 'sim', 'other'];
  var STATUSES = { prop: ['evaluation', 'funded', 'passed', 'failed', 'closed'], live: ['active', 'closed'], sim: ['active', 'closed'], other: ['active', 'closed'] };
  // The rule fields a profile tracks, in display order. Values are free text the person confirms; numbers are parsed in later batches only after they confirm them.
  var RULE_FIELDS = [
    ['price', 'Price'], ['priceType', 'Billing'], ['activationFee', 'Activation fee'], ['resetFee', 'Reset fee'], ['dataFee', 'Data fee'],
    ['profitTarget', 'Profit target'], ['maxLossAmount', 'Max loss / drawdown'], ['drawdownMethod', 'Drawdown method'], ['drawdownStopsAt', 'Drawdown stops trailing at'],
    ['dailyLossLimit', 'Daily loss limit'], ['minTradingDays', 'Minimum trading days'], ['maxContracts', 'Max contracts'], ['allowedInstruments', 'Allowed instruments'],
    ['consistencyRule', 'Consistency rule'], ['minPayout', 'Minimum payout'], ['maxPayoutPerRequest', 'Max payout per request'], ['payoutFrequency', 'Payout frequency'],
    ['payoutBuffer', 'Payout buffer / minimum balance'], ['profitSplit', 'Profit split'], ['newsTrading', 'News trading'], ['overnightHolding', 'Overnight holding'],
    ['scalingPlan', 'Scaling plan'], ['platforms', 'Platforms']
  ];
  var FIELD_LABEL = {}; RULE_FIELDS.forEach(function (f) { FIELD_LABEL[f[0]] = f[1]; });
  var STALE_DAYS = 30;

  function str(x) { return x == null ? '' : String(x); }
  function valText(v) { if (v == null) return ''; if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return ''; } } return String(v); }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysBetween(a, b) { var A = Date.parse(a + 'T00:00:00Z'), B = Date.parse(b + 'T00:00:00Z'); return isNaN(A) || isNaN(B) ? null : Math.round((B - A) / 86400000); }
  function isHttp(u) { return /^https?:\/\//i.test(str(u)); }

  // Pulls the rules for one product from a researched template. Firm-wide facts fill gaps; product facts win.
  function templateRules(firm, product) {
    var out = {}, add = function (k, f, scope) {
      if (!Object.prototype.hasOwnProperty.call(FIELD_LABEL, k) || !f || f.v == null || f.v === '') return;
      out[k] = { value: valText(f.v).slice(0, 400), source: isHttp(f.src) ? f.src : '', sourceType: f.st === 'official' ? 'official' : 'third-party', verifiedOn: null, origin: 'template', scope: scope };
    };
    Object.keys(firm.firmWide || {}).forEach(function (k) { add(k, firm.firmWide[k], 'firm'); });
    if (product) Object.keys(product.facts || {}).forEach(function (k) { add(k, product.facts[k], 'product'); });
    return out;
  }

  function cleanName(n) { return str(n).replace(/\s+/g, ' ').trim().slice(0, 60); }

  // Builds a new account record. Returns {ok, account} or {ok:false, errors}.
  function newAccount(input, now) {
    input = input || {}; var e = [], name = cleanName(input.name);
    if (!name) e.push('Give the account a name.');
    var cat = CATEGORIES.indexOf(input.category) >= 0 ? input.category : null; if (!cat) e.push('Choose an account type.');
    var bal = null;
    if (str(input.startingBalance).trim() !== '') {
      var n = Number(str(input.startingBalance).replace(/[$,\s]/g, ''));
      if (!(n > 0) || !isFinite(n) || Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) e.push('Starting balance must be a positive dollar amount.'); else bal = Math.round(n * 100);
    }
    if (e.length) return { ok: false, errors: e };
    var statuses = STATUSES[cat], status = statuses.indexOf(input.status) >= 0 ? input.status : statuses[0];
    var t = now == null ? Date.now() : now;
    return { ok: true, account: {
      id: input.id || ('acct-' + t.toString(36) + Math.random().toString(36).slice(2, 7)), name: name, category: cat, status: status, archived: false,
      createdAt: t, startedOn: /^\d{4}-\d{2}-\d{2}$/.test(str(input.startedOn)) ? input.startedOn : ymd(t), startingBalanceCents: bal, note: str(input.note).slice(0, 500),
      firmSlug: input.firmSlug || null, productName: input.productName || null,
      template: input.template ? { slug: input.template.slug, product: input.template.product, researchedOn: input.template.researchedOn } : null,
      rules: input.rules || {}, ruleHistory: [], statusHistory: [{ at: t, status: status, note: 'Created' }]
    } };
  }

  // Edits one rule. Never mutates; returns {ok, account}. Every change is appended to ruleHistory, including clearing a value.
  function editRule(acct, field, value, opts, now) {
    opts = opts || {}; var t = now == null ? Date.now() : now;
    if (!Object.prototype.hasOwnProperty.call(FIELD_LABEL, field)) return { ok: false, error: 'Unknown rule.' };
    var v = str(value).trim().slice(0, 400), old = acct.rules[field] || null, oldV = old ? old.value : '';
    var srcIn = str(opts.source).trim();
    if (srcIn && !isHttp(srcIn)) srcIn = '';
    var rules = Object.assign({}, acct.rules);
    if (v === '') delete rules[field];
    else rules[field] = { value: v, source: srcIn || (old && v === oldV ? old.source : ''), sourceType: opts.sourceType || (old && v === oldV ? old.sourceType : 'user'),
      verifiedOn: opts.verifiedOn || (old && v === oldV ? old.verifiedOn : null), origin: old && v === oldV ? old.origin : 'edited', scope: old ? old.scope : 'user' };
    var meta = (old ? (old.source || '') : '') !== (rules[field] ? rules[field].source : '') || (old ? old.verifiedOn : null) !== (rules[field] ? rules[field].verifiedOn : null);
    if (v === oldV && !meta) return { ok: true, account: acct, unchanged: true };
    var hist = acct.ruleHistory.concat([{ at: t, field: field, from: oldV, to: v, note: str(opts.note).slice(0, 200), verifiedOn: opts.verifiedOn || null }]);
    return { ok: true, account: Object.assign({}, acct, { rules: rules, ruleHistory: hist }) };
  }

  function setStatus(acct, status, note, now) {
    var allowed = STATUSES[acct.category] || []; if (allowed.indexOf(status) < 0) return { ok: false, error: 'That status does not apply to this account type.' };
    if (acct.status === status) return { ok: true, account: acct, unchanged: true };
    return { ok: true, account: Object.assign({}, acct, { status: status, statusHistory: acct.statusHistory.concat([{ at: now == null ? Date.now() : now, status: status, note: str(note).slice(0, 200) }]) }) };
  }

  // Age of a rule's information, so stale numbers are visible. Returns {days, stale, basis}.
  function ruleAge(rule, templateResearchedOn, today) {
    var basis = rule && rule.verifiedOn ? rule.verifiedOn : (rule && rule.origin === 'template' ? templateResearchedOn : null);
    if (!basis) return { days: null, stale: true, basis: 'never verified' };
    var d = daysBetween(basis, today); return { days: d, stale: d == null || d > STALE_DAYS, basis: rule.verifiedOn ? 'verified by you' : 'template research date' };
  }

  // Per-account totals from analyzed rows. Money is null (shown "—") when nothing is closed; never 0 for "unknown".
  function accountStats(rows, accountId, defaultId) {
    var mine = rows.filter(function (r) { return (r.t.accountId || defaultId) === accountId; });
    var closed = mine.filter(function (r) { return r.c.isClosed; });
    var gross = closed.length ? closed.reduce(function (s, r) { return s + r.c.grossCents; }, 0) : null;
    var withFees = closed.filter(function (r) { return !r.c.feesMissing; });
    var net = withFees.length ? withFees.reduce(function (s, r) { return s + r.c.netCents; }, 0) : null;
    return { trades: mine.length, closed: closed.length, open: mine.length - closed.length, grossCents: gross, netCents: net, netTrades: withFees.length };
  }

  // Accounts saved by earlier versions (e.g. the default account) lack newer fields. Fill them in without losing anything.
  function normalizeAccount(a) {
    var cat = CATEGORIES.indexOf(a.category) >= 0 ? a.category : 'other', allowed = STATUSES[cat];
    return Object.assign({ note: '', startingBalanceCents: null, firmSlug: null, productName: null, template: null, startedOn: ymd(a.createdAt || Date.now()) }, a, {
      category: cat, status: allowed.indexOf(a.status) >= 0 ? a.status : allowed[0], archived: !!a.archived,
      rules: a.rules && typeof a.rules === 'object' ? a.rules : {}, ruleHistory: Array.isArray(a.ruleHistory) ? a.ruleHistory : [], statusHistory: Array.isArray(a.statusHistory) ? a.statusHistory : [] });
  }

  var api = { normalizeAccount: normalizeAccount, CATEGORIES: CATEGORIES, STATUSES: STATUSES, RULE_FIELDS: RULE_FIELDS, FIELD_LABEL: FIELD_LABEL, STALE_DAYS: STALE_DAYS,
    templateRules: templateRules, newAccount: newAccount, editRule: editRule, setStatus: setStatus, ruleAge: ruleAge, accountStats: accountStats, daysBetween: daysBetween, ymd: ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTAccountsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
