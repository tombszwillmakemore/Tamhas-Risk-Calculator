/* Tamhas Trading - money core (pure logic: no DOM, no storage, no network). Whole cents everywhere.
   Costs come from TWO places that never overlap, so nothing is counted twice:
     - account-linked fees live ONLY in the account ledger (type 'fee'),
     - everything else (data feed, platform, education...) lives ONLY as 'expense' items.
   A recurring cost posts into one of those two places with a unique reference, so posting twice is impossible.
   Payouts live in the ledger. The amount you RECEIVED after the firm's split is optional: when it is missing, the
   gross amount is used and the result is labelled as gross - the split is never guessed. */
(function (root) {
  'use strict';
  var D = root.TTDD || (typeof require !== 'undefined' ? require('./dd-core.js') : null);
  var FEE_KINDS = ['evaluation', 'activation', 'reset', 'data', 'platform', 'other'];
  var EXP_CATS = ['evaluation', 'activation', 'reset', 'data', 'platform', 'subscription', 'education', 'hardware', 'other'];
  var CADENCES = ['weekly', 'monthly', 'yearly'];

  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dim(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }       // m is 0-based
  function ymd(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function inRange(date, from, to) { return (!from || date >= from) && (!to || date <= to); }
  function monthKey(date) { return date.slice(0, 7); }
  function money(x, o) { return D.parseMoney(x, o); }

  /* ---------- unified cost list ---------- */
  function costEntries(ledger, expenses) {
    var out = [];
    (ledger || []).forEach(function (l) {
      if (!l || l.voided || l.type !== 'fee' || !Number.isInteger(l.amountCents) || l.amountCents <= 0 || !isDate(l.date)) return;
      out.push({ id: l.id, source: 'ledger', date: l.date, amountCents: l.amountCents, category: l.feeKind || 'other', accountId: l.accountId || null, note: l.note || '', ref: l.ref || '' });
    });
    (expenses || []).forEach(function (e) {
      if (!e || e.voided || !Number.isInteger(e.amountCents) || e.amountCents <= 0 || !isDate(e.date)) return;
      out.push({ id: e.id, source: 'expense', date: e.date, amountCents: e.amountCents, category: e.category || 'other', accountId: e.accountId || null, note: e.note || '', vendor: e.vendor || '', ref: e.ref || '' });
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1); });
    return out;
  }
  function summarizeCosts(entries, f) {
    f = f || {}; var by = {}, acc = {}, mon = {}, total = 0, n = 0;
    entries.forEach(function (e) {
      if (!inRange(e.date, f.from, f.to)) return; if (f.accountId && e.accountId !== f.accountId) return;
      total += e.amountCents; n++; by[e.category] = (by[e.category] || 0) + e.amountCents;
      var ak = e.accountId || 'general'; acc[ak] = (acc[ak] || 0) + e.amountCents; var mk = monthKey(e.date); mon[mk] = (mon[mk] || 0) + e.amountCents;
    });
    return { totalCents: n ? total : null, count: n, byCategory: by, byAccount: acc, byMonth: mon };
  }

  /* ---------- payouts ---------- */
  function payoutEntries(ledger) {
    var out = [];
    (ledger || []).forEach(function (l) {
      if (!l || l.voided || l.type !== 'payout' || !Number.isInteger(l.amountCents) || l.amountCents <= 0 || !isDate(l.date)) return;
      out.push({ id: l.id, accountId: l.accountId, date: l.date, at: l.at, grossCents: l.amountCents, receivedCents: Number.isInteger(l.receivedCents) && l.receivedCents >= 0 ? l.receivedCents : null, note: l.note || '' });
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return out;
  }
  function summarizePayouts(entries, f) {
    f = f || {}; var list = entries.filter(function (p) { return inRange(p.date, f.from, f.to) && (!f.accountId || p.accountId === f.accountId); });
    var gross = 0, recv = 0, recvKnown = 0, by = {}, mon = {}, largest = null;
    list.forEach(function (p) {
      gross += p.grossCents; if (p.receivedCents != null) { recv += p.receivedCents; recvKnown++; }
      by[p.accountId] = (by[p.accountId] || 0) + p.grossCents; mon[monthKey(p.date)] = (mon[monthKey(p.date)] || 0) + p.grossCents;
      if (!largest || p.grossCents > largest.grossCents) largest = p;
    });
    var dates = list.map(function (p) { return p.date; }).sort(), gaps = [];
    for (var i = 1; i < dates.length; i++) gaps.push(Math.round((Date.parse(dates[i] + 'T00:00:00Z') - Date.parse(dates[i - 1] + 'T00:00:00Z')) / 86400000));
    return { count: list.length, grossCents: list.length ? gross : null, receivedCents: recvKnown ? recv : null, receivedKnown: recvKnown, receivedMissing: list.length - recvKnown,
      avgGrossCents: list.length ? Math.round(gross / list.length) : null, largest: largest, byAccount: by, byMonth: mon, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null,
      avgDaysBetween: gaps.length ? Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null };
  }
  /* ---------- per-account / per-firm economics ---------- */
  function economics(accounts, ledger, expenses, f) {
    f = f || {}; var costs = costEntries(ledger, expenses), pays = payoutEntries(ledger), rows = [], firms = {};
    var ids = {}; accounts.forEach(function (a) { ids[a.id] = a; });
    function one(key, name, acct) {
      var c = summarizeCosts(costs, { from: f.from, to: f.to, accountId: key === 'general' ? null : key });
      if (key === 'general') c = summarizeCosts(costs.filter(function (e) { return !e.accountId || !ids[e.accountId]; }), { from: f.from, to: f.to });
      var plist = key === 'general' ? [] : pays.filter(function (p) { return p.accountId === key; });
      var p = summarizePayouts(plist, { from: f.from, to: f.to });
      var cost = c.totalCents || 0, cash = 0, assumes = 0;
      plist.filter(function (x) { return inRange(x.date, f.from, f.to); }).forEach(function (x) { if (x.receivedCents != null) cash += x.receivedCents; else { cash += x.grossCents; assumes++; } });
      var hasAny = c.count > 0 || p.count > 0;
      return { id: key, name: name, category: acct ? acct.category : null, status: acct ? acct.status : null, firmSlug: acct ? (acct.firmSlug || null) : null,
        costCents: c.count ? cost : null, costCount: c.count, payoutGrossCents: p.grossCents, payoutCount: p.count, cashInCents: p.count ? cash : null, assumesGross: assumes,
        netCents: hasAny ? cash - cost : null, roi: cost > 0 && p.count ? (cash - cost) / cost : null, costByCategory: c.byCategory };
    }
    accounts.forEach(function (a) { rows.push(one(a.id, a.name, a)); });
    rows.push(one('general', 'General (not tied to an account)', null));
    rows.forEach(function (r) {
      if (r.id === 'general' || r.costCents == null && r.payoutCount === 0) return;
      var k = r.firmSlug || 'none', g = firms[k] || (firms[k] = { firmSlug: r.firmSlug, accounts: 0, failed: 0, funded: 0, costCents: 0, cashInCents: 0, payoutCount: 0, assumesGross: 0 });
      g.accounts++; g.costCents += r.costCents || 0; g.cashInCents += r.cashInCents || 0; g.payoutCount += r.payoutCount; g.assumesGross += r.assumesGross;
      if (r.status === 'failed') g.failed++; if (r.status === 'funded') g.funded++;
    });
    Object.keys(firms).forEach(function (k) { var g = firms[k]; g.netCents = g.cashInCents - g.costCents; g.roi = g.costCents > 0 && g.payoutCount ? g.netCents / g.costCents : null; g.costPerPayoutCents = g.payoutCount ? Math.round(g.costCents / g.payoutCount) : null; });
    var tc = summarizeCosts(costs, f), tp = summarizePayouts(pays, f), cashAll = 0, assumesAll = 0;
    pays.filter(function (x) { return inRange(x.date, f.from, f.to); }).forEach(function (x) { if (x.receivedCents != null) cashAll += x.receivedCents; else { cashAll += x.grossCents; assumesAll++; } });
    return { accounts: rows, firms: firms, totals: { costCents: tc.totalCents, costCount: tc.count, payoutGrossCents: tp.grossCents, payoutCount: tp.count, cashInCents: tp.count ? cashAll : null, assumesGross: assumesAll,
      netCents: (tc.count || tp.count) ? cashAll - (tc.totalCents || 0) : null, roi: (tc.totalCents || 0) > 0 && tp.count ? (cashAll - tc.totalCents) / tc.totalCents : null, byCategory: tc.byCategory, byMonth: tc.byMonth, payoutByMonth: tp.byMonth } };
  }
  // Month-by-month cash flow: costs out, payouts in (received when known, else gross).
  function monthlyFlow(ledger, expenses, f) {
    f = f || {}; var m = {};
    costEntries(ledger, expenses).forEach(function (e) { if (!inRange(e.date, f.from, f.to)) return; var k = monthKey(e.date); (m[k] || (m[k] = { cost: 0, cash: 0 })).cost += e.amountCents; });
    payoutEntries(ledger).forEach(function (p) { if (!inRange(p.date, f.from, f.to)) return; var k = monthKey(p.date); (m[k] || (m[k] = { cost: 0, cash: 0 })).cash += p.receivedCents != null ? p.receivedCents : p.grossCents; });
    var keys = Object.keys(m).sort(), cum = 0;
    return keys.map(function (k) { cum += m[k].cash - m[k].cost; return { month: k, costCents: m[k].cost, cashInCents: m[k].cash, netCents: m[k].cash - m[k].cost, cumulativeCents: cum }; });
  }

  /* ---------- validation ---------- */
  function validateExpense(i, ctx) {
    i = i || {}; ctx = ctx || {}; var e = [], r = {}, now = ctx.now == null ? Date.now() : ctx.now;
    r.date = isDate(i.date) ? i.date : (e.push('Enter a real date.'), null);
    if (r.date && Date.parse(r.date + 'T00:00:00Z') > now + 36 * 3600000) e.push('That date is in the future.');
    var amt = money(i.amount); if (amt == null) e.push('Amount must be a positive dollar amount.'); r.amountCents = amt;
    var linked = !!i.accountId; var cats = linked ? FEE_KINDS : EXP_CATS;
    r.category = cats.indexOf(i.category) >= 0 ? i.category : (e.push('Choose a category' + (linked ? ' (account costs use the fee types)' : '') + '.'), null);
    r.accountId = i.accountId || null; r.vendor = String(i.vendor || '').trim().slice(0, 80); r.note = String(i.note || '').trim().slice(0, 200);
    return { ok: e.length === 0, errors: e, record: r };
  }
  function validateRecurring(i, ctx) {
    i = i || {}; var e = [], r = {};
    r.title = String(i.title || '').trim().slice(0, 80); if (!r.title) e.push('Give the cost a name.');
    var amt = money(i.amount); if (amt == null) e.push('Amount must be a positive dollar amount.'); r.amountCents = amt;
    r.cadence = CADENCES.indexOf(i.cadence) >= 0 ? i.cadence : (e.push('Choose how often it repeats.'), null);
    r.startDate = isDate(i.startDate) ? i.startDate : (e.push('Enter a real start date.'), null);
    r.endDate = i.endDate ? (isDate(i.endDate) ? i.endDate : (e.push('End date must be a real date.'), null)) : null;
    if (r.startDate && r.endDate && r.endDate < r.startDate) e.push('The end date is before the start date.');
    r.accountId = i.accountId || null; var cats = r.accountId ? FEE_KINDS : EXP_CATS;
    r.category = cats.indexOf(i.category) >= 0 ? i.category : (e.push('Choose a category.'), null);
    r.active = i.active !== false;
    return { ok: e.length === 0, errors: e, record: r };
  }

  /* ---------- recurring costs ---------- */
  // Every date this cost falls due from startDate up to `upTo` (inclusive, capped by endDate). Month-end safe (31st -> last day).
  function occurrences(rec, upTo) {
    if (!rec || !isDate(rec.startDate) || !isDate(upTo) || CADENCES.indexOf(rec.cadence) < 0) return [];
    var end = rec.endDate && rec.endDate < upTo ? rec.endDate : upTo, out = [], y = +rec.startDate.slice(0, 4), m = +rec.startDate.slice(5, 7) - 1, d = +rec.startDate.slice(8, 10);
    if (rec.cadence === 'weekly') {
      var t = Date.parse(rec.startDate + 'T00:00:00Z'), last = Date.parse(end + 'T00:00:00Z');
      for (var k = 0; t + k * 7 * 86400000 <= last && out.length < 600; k++) out.push(new Date(t + k * 7 * 86400000).toISOString().slice(0, 10));
      return out;
    }
    for (var n = 0; out.length < 600; n++) {
      var yy = rec.cadence === 'yearly' ? y + n : y + Math.floor((m + n) / 12), mm = rec.cadence === 'yearly' ? m : (m + n) % 12;
      var day = ymd(yy, mm, Math.min(d, dim(yy, mm)));
      if (day > end) break; out.push(day);
    }
    return out;
  }
  function recRef(rec, date) { return 'rec:' + rec.id + ':' + date; }
  function pendingPostings(rec, existingRefs, upTo) {
    if (!rec || rec.active === false) return [];
    var have = {}; (existingRefs || []).forEach(function (r) { have[r] = 1; });
    return occurrences(rec, upTo).filter(function (d) { return !have[recRef(rec, d)]; }).map(function (d) { return { date: d, ref: recRef(rec, d) }; });
  }
  // Monthly-equivalent run-rate of active recurring costs (weekly = 52/12, yearly = 1/12). Informational.
  function monthlyRunRate(recs) {
    var c = 0, n = 0; (recs || []).forEach(function (r) { if (r.active === false || !Number.isInteger(r.amountCents)) return; n++; c += r.cadence === 'weekly' ? r.amountCents * 52 / 12 : r.cadence === 'yearly' ? r.amountCents / 12 : r.amountCents; });
    return n ? Math.round(c) : null;
  }

  /* ---------- funded accounts: payout readiness (ONLY from numbers you entered) ----------
     rules (all optional, cents unless noted): minProfitCents, minWinningDays, winningDayMinCents, minPayoutCents, maxPayoutCents,
     bufferCents (balance must be at least this far above the drawdown threshold), consistencyPct, splitPct (your share, 0-100).
     ctx: { days:[{day,pnlCents,trades}], lastPayoutDay, bufferCents (current), balanceCents } where days comes from TTDD.evaluate().series. */
  var RULE_KEYS = [['minProfitCents', 'Minimum profit since last payout', 1], ['minWinningDays', 'Minimum winning days', 0], ['winningDayMinCents', 'A winning day is at least', 1], ['minPayoutCents', 'Minimum payout', 1], ['maxPayoutCents', 'Maximum payout per request', 1], ['bufferCents', 'Required buffer above the drawdown line', 1], ['consistencyPct', 'Best day may be at most (% of profit)', 2], ['splitPct', 'Your profit split (%)', 2]];
  function validatePayoutRules(i) {
    i = i || {}; var e = [], c = {};
    RULE_KEYS.forEach(function (k) {
      var raw = i[k[0]]; if (raw == null || String(raw).trim() === '') { c[k[0]] = null; return; }
      if (k[2] === 1) { var v = money(raw, { allowZero: true }); if (v == null) e.push(k[1] + ' must be a dollar amount.'); else c[k[0]] = v; }
      else if (k[2] === 0) { var n = Number(String(raw).trim()); if (!Number.isInteger(n) || n < 0 || n > 1000) e.push(k[1] + ' must be a whole number.'); else c[k[0]] = n; }
      else { var p = Number(String(raw).replace('%', '').trim()); if (!isFinite(p) || p <= 0 || p > 100) e.push(k[1] + ' must be between 0 and 100.'); else c[k[0]] = Math.round(p * 100) / 100; }
    });
    return { ok: e.length === 0, errors: e, clean: c };
  }
  function readiness(rules, ctx) {
    rules = rules || {}; ctx = ctx || {}; var items = [], days = (ctx.days || []).filter(function (d) { return d.trades > 0 && (!ctx.lastPayoutDay || d.day > ctx.lastPayoutDay); });
    var profit = days.reduce(function (a, d) { return a + d.pnlCents; }, 0), anyRule = RULE_KEYS.some(function (k) { return rules[k[0]] != null; });
    var winMin = rules.winningDayMinCents != null ? rules.winningDayMinCents : 1;
    var winning = days.filter(function (d) { return d.pnlCents >= winMin; }).length;
    function item(key, label, status, detail) { items.push({ key: key, label: label, status: status, detail: detail }); }
    if (rules.minProfitCents != null) item('profit', 'Profit since last payout', profit >= rules.minProfitCents ? 'met' : 'not met', 'You have ' + D.fmt(profit) + ' of ' + D.fmt(rules.minProfitCents) + ' needed.');
    if (rules.minWinningDays != null) item('winning', 'Winning days since last payout', winning >= rules.minWinningDays ? 'met' : 'not met', winning + ' of ' + rules.minWinningDays + ' needed' + (rules.winningDayMinCents != null ? ' (days of at least ' + D.fmt(rules.winningDayMinCents) + ').' : ' (any profitable day).'));
    if (rules.bufferCents != null) item('buffer', 'Buffer above the drawdown line', ctx.bufferCents == null ? 'unknown' : (ctx.bufferCents >= rules.bufferCents ? 'met' : 'not met'), ctx.bufferCents == null ? 'Your current buffer is unavailable (enter the account rules and a balance).' : 'Buffer ' + D.fmt(ctx.bufferCents) + ' vs ' + D.fmt(rules.bufferCents) + ' required.');
    if (rules.consistencyPct != null) {
      var best = days.reduce(function (a, d) { return d.pnlCents > a ? d.pnlCents : a; }, 0);
      if (profit <= 0 || best <= 0) item('consistency', 'Consistency (best day)', 'unknown', 'Not measurable until there is net profit since the last payout.');
      else item('consistency', 'Consistency (best day)', best * 100 <= rules.consistencyPct * profit ? 'met' : 'not met', 'Best day is ' + (best * 100 / profit).toFixed(1) + '% of profit; limit ' + rules.consistencyPct + '%.');
    }
    var requestable = null, requestNote = '';
    if (ctx.balanceCents != null && ctx.bufferCents != null) {
      // the most that could leave the account while keeping the required buffer; never more than profit since last payout
      var keep = rules.bufferCents != null ? rules.bufferCents : 0, room = ctx.bufferCents - keep; requestable = Math.max(0, Math.min(profit, room));
      if (rules.maxPayoutCents != null) requestable = Math.min(requestable, rules.maxPayoutCents);
      requestNote = 'Upper bound from the numbers you entered: profit since the last payout, limited by your required buffer' + (rules.maxPayoutCents != null ? ' and maximum payout' : '') + '. Your firm decides what is actually approved.';
    } else requestNote = 'Unavailable until the drawdown rules are confirmed on this account.';
    if (rules.minPayoutCents != null) item('minpayout', 'Reaches the minimum payout', requestable == null ? 'unknown' : (requestable >= rules.minPayoutCents ? 'met' : 'not met'), requestable == null ? 'Needs a computed buffer.' : 'Up to ' + D.fmt(requestable) + ' vs minimum ' + D.fmt(rules.minPayoutCents) + '.');
    var overall = !anyRule ? 'no-rules' : items.some(function (x) { return x.status === 'not met'; }) ? 'not-yet' : items.some(function (x) { return x.status === 'unknown'; }) ? 'incomplete' : 'eligible';
    var yourShare = requestable != null && rules.splitPct != null ? Math.floor(requestable * Math.round(rules.splitPct * 100) / 10000) : null;
    return { overall: overall, items: items, profitSinceCents: profit, winningDays: winning, daysCounted: days.length, requestableCents: requestable, requestNote: requestNote, yourShareCents: yourShare,
      label: { 'no-rules': 'Enter your payout rules to see readiness', 'not-yet': 'Not yet - by the rules you entered', 'incomplete': 'Cannot be fully checked', 'eligible': 'Meets every rule you entered' }[overall] };
  }

  var api = { FEE_KINDS: FEE_KINDS, EXP_CATS: EXP_CATS, CADENCES: CADENCES, RULE_KEYS: RULE_KEYS, isDate: isDate, costEntries: costEntries, summarizeCosts: summarizeCosts, payoutEntries: payoutEntries, summarizePayouts: summarizePayouts,
    economics: economics, monthlyFlow: monthlyFlow, validateExpense: validateExpense, validateRecurring: validateRecurring, occurrences: occurrences, recRef: recRef, pendingPostings: pendingPostings,
    monthlyRunRate: monthlyRunRate, validatePayoutRules: validatePayoutRules, readiness: readiness };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTMoney = api;
})(typeof window !== 'undefined' ? window : globalThis);
