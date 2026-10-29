/* Tamhas Trading - Money: payout center, expense tracker, recurring costs and account cost analysis.
   Calculations live in money-core.js (tested). Account-linked fees are written to the account ledger (single source of truth);
   everything else is stored as expense items. Nothing is sent anywhere. */
(function () {
  'use strict';
  var root = document.getElementById('mRoot'); if (!root) return;
  var M = window.TTMoney, D = window.TTDD, U = window.TTUI, DB = window.TTDB, ST = window.TTStore, AC = window.TTAccountsCore, P = window.TTPropData;
  var esc = U.esc, $ = function (s, r) { return (r || root).querySelector(s); };
  var S = { tab: 'overview', range: 'all', from: '', to: '', loaded: false, stale: true, accounts: [], ledger: [], expenses: [], recurring: [], err: null };
  var TABS = [{ id: 'overview', label: 'Overview' }, { id: 'payouts', label: 'Payouts' }, { id: 'expenses', label: 'Expenses' }, { id: 'recurring', label: 'Recurring' }, { id: 'analysis', label: 'Cost analysis' }];

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function bounds() {
    var t = todayStr(), y = t.slice(0, 4), m = t.slice(5, 7);
    if (S.range === 'month') return { from: y + '-' + m + '-01', to: null };
    if (S.range === '30d') { var d = new Date(); d.setDate(d.getDate() - 30); return { from: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), to: null }; }
    if (S.range === 'year') return { from: y + '-01-01', to: null };
    if (S.range === 'custom') return { from: M.isDate(S.from) ? S.from : null, to: M.isDate(S.to) ? S.to : null };
    return { from: null, to: null };
  }
  function acctName(id) { var a = S.accounts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : (id ? 'Unknown account' : 'General'); }
  function firmName(slug) { if (!slug) return 'No firm set'; var f = P && P.firms.filter(function (x) { return x.slug === slug; })[0]; return f ? f.name : slug; }

  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('accounts'), DB.getAll('ledger'), ST.list('expense'), ST.list('recurring')]); }).then(function (r) {
      S.accounts = r[0].map(AC.normalizeAccount).sort(function (a, b) { return a.createdAt - b.createdAt; }); S.ledger = r[1]; S.expenses = r[2]; S.recurring = r[3]; S.loaded = true; S.err = null; S.stale = false;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function reload() { return load().then(render); }

  /* ---------- views ---------- */
  function rangeBar() {
    var o = [['all', 'All time'], ['month', 'This month'], ['30d', 'Last 30 days'], ['year', 'This year'], ['custom', 'Custom']];
    return '<div class="ui-row m-range"><select id="m-range" aria-label="Date range">' + o.map(function (x) { return '<option value="' + x[0] + '"' + (S.range === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
      (S.range === 'custom' ? '<input type="date" id="m-from" aria-label="From" value="' + esc(S.from) + '"><input type="date" id="m-to" aria-label="To" value="' + esc(S.to) + '">' : '') + '</div>';
  }
  function econ() { var b = bounds(); return M.economics(S.accounts, S.ledger, S.expenses, b); }

  function overview() {
    var E = econ(), t = E.totals, b = bounds();
    if (t.costCount === 0 && t.payoutCount === 0 && !S.recurring.length) {
      return rangeBar() + U.empty('Nothing recorded yet', 'Log what you spend on evaluations, resets and data, and the payouts you receive. Your net result and return on cost appear here.',
        '<div class="ui-row" style="justify-content:center"><button class="btn" data-act="m-add-exp">+ ADD EXPENSE</button><button class="btn ghost" data-act="m-add-pay">+ ADD PAYOUT</button></div>');
    }
    var h = rangeBar() + '<div class="ui-grid g2">' +
      U.stat('Costs', t.costCents == null ? '—' : esc(U.fmtMoney(t.costCents)), t.costCount + ' item' + (t.costCount === 1 ? '' : 's')) +
      U.stat('Payouts (withdrawn)', t.payoutGrossCents == null ? '—' : esc(U.fmtMoney(t.payoutGrossCents)), U.plural(t.payoutCount, 'payout')) +
      U.stat('Cash received', t.cashInCents == null ? '—' : esc(U.fmtMoney(t.cashInCents)), t.assumesGross ? t.assumesGross + ' use the withdrawn amount' : (t.payoutCount ? 'as entered' : ''), '', 'Amount you actually received after the firm\'s split. Where you did not enter it, the withdrawn amount is used and this is flagged.') +
      U.stat('Net result', t.netCents == null ? '—' : esc(U.fmtMoney(t.netCents, true)), 'cash received minus costs', U.cls(t.netCents), 'Cash received (or withdrawn when the received amount is missing) minus every cost in the range. It is cash only: it does not include open trading profit.') + '</div>';
    h += '<div class="ui-grid g2" style="margin-top:10px">' + U.stat('Return on cost', t.roi == null ? '—' : esc((t.roi * 100).toFixed(0) + '%'), t.roi == null ? 'needs costs and a payout' : 'net ÷ costs', U.cls(t.roi), 'Net result divided by total costs. Unavailable until there is at least one cost and one payout.') +
      U.stat('Recurring costs', M.monthlyRunRate(S.recurring) == null ? '—' : esc(U.fmtMoney(M.monthlyRunRate(S.recurring))) + '/mo', U.plural(S.recurring.filter(function (r) { return r.active !== false; }).length, 'active subscription'), 'dim') + '</div>';
    if (t.assumesGross) h += '<p class="note warnline">' + U.plural(t.assumesGross, 'payout') + ' ha' + (t.assumesGross === 1 ? 's' : 've') + ' no "received" amount, so the withdrawn amount is used. Add it under Payouts for exact figures.</p>';
    var flow = M.monthlyFlow(S.ledger, S.expenses, b);
    if (flow.length) {
      h += '<div class="panel"><h2>Cash flow by month</h2>' + U.barChart({ bars: flow.map(function (m) { return { label: m.month.slice(2), value: m.netCents, tip: m.month + '\nIn ' + U.fmtMoney(m.cashInCents) + '\nOut ' + U.fmtMoney(m.costCents) + '\nNet ' + U.fmtMoney(m.netCents, true) }; }), yFormat: U.fmtMoneyShort, alt: 'Net cash flow per month' }) +
        (flow.length > 1 ? '<h2 style="margin-top:6px">Cumulative net</h2>' + U.lineChart({ series: [{ name: 'Cumulative', cls: 'c1', area: true, pts: flow.map(function (m, i) { return { x: i, y: m.cumulativeCents, tip: m.month + ': ' + U.fmtMoney(m.cumulativeCents, true) }; }) }], xLabels: flow.length <= 8 ? flow.map(function (m, i) { return { x: i, label: m.month.slice(2) }; }) : [], yFormat: U.fmtMoneyShort, alt: 'Cumulative net cash flow', height: 160 }) : '') + '</div>';
    }
    var cats = Object.keys(t.byCategory || {}).sort(function (a, b) { return t.byCategory[b] - t.byCategory[a]; });
    if (cats.length) h += '<div class="panel"><h2>Where the money went</h2><ul class="ui-list">' + cats.map(function (c) { var pct = t.costCents ? t.byCategory[c] * 100 / t.costCents : 0; return '<li><span>' + esc(c) + '</span><span><b>' + esc(U.fmtMoney(t.byCategory[c])) + '</b> <small class="note">' + pct.toFixed(0) + '%</small></span></li>'; }).join('') + '</ul></div>';
    return h;
  }

  function payoutRow(p) {
    var l = S.ledger.filter(function (x) { return x.id === p.id; })[0];
    return '<li class="m-row"><div><b>' + esc(U.fmtMoney(p.grossCents)) + '</b> <small class="note">withdrawn · ' + esc(p.date) + ' · ' + esc(acctName(p.accountId)) + '</small><div class="note" style="margin:2px 0 0">' +
      (p.receivedCents != null ? 'Received ' + esc(U.fmtMoney(p.receivedCents)) : '<span class="warnline">Received amount not entered</span>') + (l && l.note ? ' · ' + esc(l.note) : '') + '</div></div>' +
      '<div class="ui-row"><button class="btn ghost sm" data-act="m-recv" data-id="' + esc(p.id) + '">' + (p.receivedCents != null ? 'EDIT' : 'ADD RECEIVED') + '</button><button class="btn ghost sm" data-act="m-void" data-id="' + esc(p.id) + '" data-src="ledger">VOID</button></div></li>';
  }
  function payouts() {
    var b = bounds(), list = M.payoutEntries(S.ledger).filter(function (p) { return (!b.from || p.date >= b.from) && (!b.to || p.date <= b.to); }), s = M.summarizePayouts(list);
    var h = rangeBar() + '<div class="ui-sec"><h2>Payout center</h2><button class="btn sm" data-act="m-add-pay">+ ADD PAYOUT</button></div>';
    if (!list.length) return h + U.empty('No payouts in this range', 'Record each withdrawal from a funded account. Optionally add what you actually received after the firm\'s split.');
    h += '<div class="ui-grid g2">' + U.stat('Withdrawn', esc(U.fmtMoney(s.grossCents)), U.plural(s.count, 'payout')) + U.stat('Received', s.receivedCents == null ? '—' : esc(U.fmtMoney(s.receivedCents)), s.receivedMissing ? s.receivedMissing + ' not entered' : 'all entered') +
      U.stat('Average payout', esc(U.fmtMoney(s.avgGrossCents)), 'withdrawn') + U.stat('Average gap', s.avgDaysBetween == null ? '—' : s.avgDaysBetween + ' days', s.avgDaysBetween == null ? 'needs 2 payouts' : 'between payouts') + '</div>';
    var byAcct = Object.keys(s.byAccount); if (byAcct.length > 1) h += '<div class="panel" style="margin-top:12px"><h2>By account</h2><ul class="ui-list">' + byAcct.sort(function (a, c) { return s.byAccount[c] - s.byAccount[a]; }).map(function (k) { return '<li><span>' + esc(acctName(k)) + '</span><b>' + esc(U.fmtMoney(s.byAccount[k])) + '</b></li>'; }).join('') + '</ul></div>';
    return h + '<div class="panel" style="margin-top:12px"><ul class="ui-list">' + list.map(payoutRow).join('') + '</ul><p class="note">Voiding keeps the record but removes it from every total. You can restore it from Accounts › Records.</p></div>';
  }

  function expenseRow(e) {
    var src = e.source === 'ledger' ? 'Account fee' : 'Expense';
    return '<li class="m-row"><div><b>' + esc(U.fmtMoney(e.amountCents)) + '</b> <small class="note">' + esc(e.category) + ' · ' + esc(e.date) + ' · ' + esc(acctName(e.accountId)) + '</small><div class="note" style="margin:2px 0 0"><span class="ui-badge ' + (e.source === 'ledger' ? 'info' : '') + '">' + src + '</span>' + (e.vendor ? ' ' + esc(e.vendor) : '') + (e.note ? ' · ' + esc(e.note) : '') + (/^rec:/.test(e.ref || '') ? ' · recurring' : '') + '</div></div>' +
      '<button class="btn ghost sm" data-act="m-void" data-id="' + esc(e.id) + '" data-src="' + e.source + '">VOID</button></li>';
  }
  function expenses() {
    var b = bounds(), all = M.costEntries(S.ledger, S.expenses), list = all.filter(function (e) { return (!b.from || e.date >= b.from) && (!b.to || e.date <= b.to); }), s = M.summarizeCosts(list);
    var h = rangeBar() + '<div class="ui-sec"><h2>Expense tracker</h2><button class="btn sm" data-act="m-add-exp">+ ADD EXPENSE</button></div>';
    if (!list.length) return h + U.empty('No expenses in this range', 'Add evaluation fees, resets, data feeds and other costs. Costs tied to an account are saved in that account\'s records, so nothing is counted twice.');
    var cats = Object.keys(s.byCategory).sort(function (a, c) { return s.byCategory[c] - s.byCategory[a]; });
    h += '<div class="ui-grid g2">' + U.stat('Total', esc(U.fmtMoney(s.totalCents)), U.plural(s.count, 'item')) + U.stat('Largest category', cats.length ? esc(cats[0]) : '—', cats.length ? U.fmtMoney(s.byCategory[cats[0]]) : '') + '</div>';
    return h + '<div class="panel" style="margin-top:12px"><ul class="ui-list">' + list.slice(0, 200).map(expenseRow).join('') + '</ul>' + (list.length > 200 ? '<p class="note">Showing the newest 200 of ' + list.length + '.</p>' : '') +
      '<p class="note">Voided items stay on file but are excluded from every total.</p></div>';
  }

  function recurring() {
    var today = todayStr(), refs = [];
    S.ledger.forEach(function (l) { if (l.type === 'fee' && l.ref) refs.push(l.ref); }); S.expenses.forEach(function (e) { if (e.ref) refs.push(e.ref); });
    var pend = []; S.recurring.forEach(function (r) { M.pendingPostings(r, refs, today).forEach(function (p) { pend.push({ rec: r, date: p.date, ref: p.ref }); }); });
    var h = '<div class="ui-sec"><h2>Recurring costs</h2><button class="btn sm" data-act="m-add-rec">+ ADD RECURRING</button></div>';
    if (pend.length) { var tot = pend.reduce(function (a, p) { return a + p.rec.amountCents; }, 0); h += '<div class="ui-banner warn"><b>' + U.plural(pend.length, 'payment') + ' not posted yet (' + esc(U.fmtMoney(tot)) + ').</b> Posting adds them to your expenses with the original due dates. Each can only be posted once.<div style="margin-top:8px"><button class="btn sm" data-act="m-post">REVIEW &amp; POST</button></div></div>'; }
    if (!S.recurring.length) return h + U.empty('No recurring costs', 'Add a monthly data feed, a platform subscription or a yearly fee. Nothing is posted automatically: you confirm each batch.');
    h += '<div class="panel"><ul class="ui-list">' + S.recurring.slice().sort(function (a, b) { return a.title < b.title ? -1 : 1; }).map(function (r) {
      var occ = M.occurrences(r, today), next = null; if (r.active !== false) { var d = new Date(); d.setFullYear(d.getFullYear() + 2); var f = M.occurrences(r, d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())).filter(function (x) { return x > today; }); next = f[0] || null; }
      return '<li class="m-row"><div><b>' + esc(r.title) + '</b> <span class="ui-badge ' + (r.active === false ? '' : 'good') + '">' + (r.active === false ? 'stopped' : 'active') + '</span><div class="note" style="margin:2px 0 0">' + esc(U.fmtMoney(r.amountCents)) + ' ' + esc(r.cadence) + ' · ' + esc(r.category) + ' · ' + esc(acctName(r.accountId)) + ' · since ' + esc(r.startDate) + (r.endDate ? ' until ' + esc(r.endDate) : '') + (next ? ' · next ' + esc(next) : '') + ' · ' + occ.length + ' due so far</div></div>' +
        '<button class="btn ghost sm" data-act="m-rec-toggle" data-id="' + esc(r.id) + '">' + (r.active === false ? 'RESUME' : 'STOP') + '</button></li>'; }).join('') + '</ul><p class="note">Stopping keeps the history; already-posted items are not changed.</p></div>';
    return h;
  }

  function analysis() {
    var E = econ(), rows = E.accounts.filter(function (r) { return r.costCents != null || r.payoutCount; }).sort(function (a, b) { return (b.netCents == null ? -Infinity : b.netCents) - (a.netCents == null ? -Infinity : a.netCents); });
    var h = rangeBar() + '<div class="ui-sec"><h2>Cost analysis</h2></div>';
    if (!rows.length) return h + U.empty('Not enough data', 'Record costs and payouts against your accounts to compare what each one cost and returned.');
    h += '<div class="panel"><h2>By account</h2>' + U.barChart({ bars: rows.map(function (r) { return { label: r.name.slice(0, 8), value: r.netCents, tip: r.name + '\nNet ' + U.fmtMoney(r.netCents, true) + '\nCosts ' + U.fmtMoney(r.costCents || 0) + '\nCash in ' + U.fmtMoney(r.cashInCents || 0) }; }), yFormat: U.fmtMoneyShort, alt: 'Net result per account', tall: true }) +
      '<div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Account</th><th>Costs</th><th>Cash in</th><th>Net</th><th>ROI</th></tr></thead><tbody>' + rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + (r.status ? ' <small class="note">' + esc(r.status) + '</small>' : '') + '</td><td>' + esc(U.fmtMoney(r.costCents)) + '</td><td>' + esc(U.fmtMoney(r.cashInCents)) + (r.assumesGross ? '*' : '') + '</td><td class="' + U.cls(r.netCents) + '">' + esc(U.fmtMoney(r.netCents, true)) + '</td><td>' + (r.roi == null ? '—' : (r.roi * 100).toFixed(0) + '%') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (rows.some(function (r) { return r.assumesGross; }) ? '<p class="note">* includes payouts where the received amount was not entered (withdrawn amount used).</p>' : '') + '</div>';
    var fk = Object.keys(E.firms);
    if (fk.length) h += '<div class="panel"><h2>By firm</h2><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Firm</th><th>Accts</th><th>Failed</th><th>Costs</th><th>Cash in</th><th>Net</th><th>Cost / payout</th></tr></thead><tbody>' + fk.sort(function (a, b) { return E.firms[b].netCents - E.firms[a].netCents; }).map(function (k) { var g = E.firms[k];
      return '<tr><td>' + esc(firmName(g.firmSlug)) + '</td><td>' + g.accounts + '</td><td>' + g.failed + '</td><td>' + esc(U.fmtMoney(g.costCents)) + '</td><td>' + esc(U.fmtMoney(g.cashInCents)) + '</td><td class="' + U.cls(g.netCents) + '">' + esc(U.fmtMoney(g.netCents, true)) + '</td><td>' + (g.costPerPayoutCents == null ? '—' : esc(U.fmtMoney(g.costPerPayoutCents))) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="note">Only accounts with a firm set (Accounts › edit) are grouped by firm. Figures come only from what you recorded. This is your history, not a forecast.</p></div>';
    return h;
  }

  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; }
    if (S.err) { root.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    var body = S.tab === 'payouts' ? payouts() : S.tab === 'expenses' ? expenses() : S.tab === 'recurring' ? recurring() : S.tab === 'analysis' ? analysis() : overview();
    root.innerHTML = U.tabs(TABS, S.tab, 'mtab') + body;
  }

  /* ---------- writing ---------- */
  function newId(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function writeLedger(recs, kind) {
    var now = Date.now(), ops = recs.map(function (r) { r.id = r.id || newId('lg'); r.createdAt = now; r.voided = false; return { store: 'ledger', type: 'put', value: r }; });
    ops.push({ store: 'audit', type: 'put', value: { id: DB.uid('au'), at: now, type: 'ledger-add', details: { kind: kind, via: 'money', ids: recs.map(function (r) { return r.id; }) } } });
    return DB.batch(ops).then(function () { recs.forEach(function (r) { S.ledger.push(r); }); window.dispatchEvent(new Event('tt:ledger-changed')); });
  }
  function acctOptions(withGeneral, sel) {
    var o = S.accounts.filter(function (a) { return !a.archived || a.id === sel; }).map(function (a) { return { value: a.id, label: a.name }; });
    return withGeneral ? [{ value: '', label: 'None (general cost)' }].concat(o) : o;
  }
  function addPayout() {
    var accs = acctOptions(false); if (!accs.length) { U.toast('Add an account first.', true); return; }
    var pre = ST_pref.acct && accs.some(function (a) { return a.value === ST_pref.acct; }) ? ST_pref.acct : accs[0].value;
    U.dialog({ title: 'Add payout', ok: 'SAVE', fields: [
      { name: 'accountId', label: 'Account', type: 'select', options: accs, value: pre }, { name: 'date', label: 'Date', type: 'date', value: todayStr() },
      { name: 'amount', label: 'Amount withdrawn ($)', type: 'text', inputmode: 'decimal', placeholder: 'e.g. 1500' },
      { name: 'received', label: 'Amount you received ($, optional)', type: 'text', inputmode: 'decimal', hint: 'After the firm\'s split. Leave blank if unknown; it is never guessed.' },
      { name: 'note', label: 'Note (optional)', type: 'text' }],
      validate: function (v) { var r = D.validateLedger({ type: 'payout', accountId: v.accountId, date: v.date, amount: v.amount, received: v.received, note: v.note }); return r.ok ? null : r.errors[0]; } }).then(function (v) {
      if (!v) return; var r = D.validateLedger({ type: 'payout', accountId: v.accountId, date: v.date, amount: v.amount, received: v.received, note: v.note }); if (!r.ok) return;
      ST_pref.acct = v.accountId;
      var dup = D.findDuplicate(S.ledger, r.record), go = dup ? U.confirm('Possible duplicate', 'A payout with the same account, date and amount already exists. Add it again?', 'ADD AGAIN') : Promise.resolve(true);
      go.then(function (yes) { if (!yes) return; writeLedger([r.record], 'payout').then(function () { U.toast('Payout saved.'); render(); }).catch(function () { U.toast('Could not save (browser storage blocked or full).', true); }); });
    });
  }
  var ST_pref = {};
  function editReceived(id) {
    var l = S.ledger.filter(function (x) { return x.id === id; })[0]; if (!l) return;
    U.dialog({ title: 'Amount received', body: 'Withdrawn: ' + U.fmtMoney(l.amountCents) + '. Enter what reached you after the firm\'s split, or clear it if unknown.', ok: 'SAVE', fields: [{ name: 'received', label: 'Amount received ($)', type: 'text', inputmode: 'decimal', value: l.receivedCents != null ? (l.receivedCents / 100).toFixed(2) : '' }],
      validate: function (v) { var r = D.validateLedger({ type: 'payout', accountId: l.accountId, date: l.date, amount: (l.amountCents / 100).toFixed(2), received: v.received }); return r.ok ? null : r.errors[0]; } }).then(function (v) {
      if (!v) return; var rc = String(v.received).trim() === '' ? null : D.parseMoney(v.received, { allowZero: true });
      var nv = Object.assign({}, l); if (rc == null) delete nv.receivedCents; else nv.receivedCents = rc;
      DB.batch([{ store: 'ledger', type: 'put', value: nv }, { store: 'audit', type: 'put', value: { id: DB.uid('au'), at: Date.now(), type: 'ledger-edit', details: { id: id, field: 'receivedCents', from: l.receivedCents == null ? null : l.receivedCents, to: rc } } }])
        .then(function () { S.ledger = S.ledger.map(function (x) { return x.id === id ? nv : x; }); window.dispatchEvent(new Event('tt:ledger-changed')); U.toast('Saved.'); render(); }).catch(function () { U.toast('Could not save.', true); });
    });
  }
  function catOptions(linked, sel) { return (linked ? M.FEE_KINDS : M.EXP_CATS).map(function (c) { return { value: c, label: c }; }); }
  function addExpense() {
    U.dialog({ title: 'Add expense', ok: 'SAVE', fields: [
      { name: 'date', label: 'Date', type: 'date', value: todayStr() }, { name: 'amount', label: 'Amount ($)', type: 'text', inputmode: 'decimal', placeholder: 'e.g. 150' },
      { name: 'accountId', label: 'Account (optional)', type: 'select', options: acctOptions(true), value: '', hint: 'Choosing an account saves it as that account\'s fee (account costs use the fee types below).' },
      { name: 'category', label: 'Category', type: 'select', options: catOptions(false), value: 'evaluation', hint: 'General costs may also be subscription, education or hardware.' },
      { name: 'vendor', label: 'Vendor (optional)', type: 'text' }, { name: 'note', label: 'Note (optional)', type: 'text' }],
      validate: function (v) { var r = v.accountId ? D.validateLedger({ type: 'fee', accountId: v.accountId, date: v.date, amount: v.amount, feeKind: v.category }) : M.validateExpense(v); return r.ok ? null : r.errors[0]; } }).then(function (v) {
      if (!v) return; var linked = !!v.accountId, r = linked ? D.validateLedger({ type: 'fee', accountId: v.accountId, date: v.date, amount: v.amount, feeKind: v.category, note: ((v.vendor ? v.vendor + ': ' : '') + v.note).slice(0, 200) }) : M.validateExpense(v);
      if (!r.ok) return; var rec = r.record;
      var dupe = M.costEntries(S.ledger, S.expenses).some(function (e) { return e.date === rec.date && e.amountCents === rec.amountCents && e.category === (rec.feeKind || rec.category) && (e.accountId || '') === (rec.accountId || ''); });
      var go = dupe ? U.confirm('Possible duplicate', 'An expense with the same date, amount, category and account already exists. Add it again?', 'ADD AGAIN') : Promise.resolve(true);
      go.then(function (yes) {
        if (!yes) return;
        var p = linked ? writeLedger([rec], 'fee') : ST.save({ kind: 'expense', date: rec.date, amountCents: rec.amountCents, category: rec.category, accountId: null, vendor: rec.vendor, note: rec.note, voided: false }).then(function (d) { S.expenses.push(d); });
        p.then(function () { U.toast('Expense saved.'); render(); }).catch(function () { U.toast('Could not save (browser storage blocked or full).', true); });
      });
    });
  }
  function voidItem(id, src) {
    U.confirm('Void this record?', 'It stays on file but is excluded from all totals.', 'VOID', true).then(function (yes) {
      if (!yes) return;
      if (src === 'ledger') {
        var l = S.ledger.filter(function (x) { return x.id === id; })[0]; if (!l) return; var nv = Object.assign({}, l, { voided: true, voidedAt: Date.now() });
        DB.batch([{ store: 'ledger', type: 'put', value: nv }, { store: 'audit', type: 'put', value: { id: DB.uid('au'), at: Date.now(), type: 'ledger-void', details: { id: id, via: 'money' } } }]).then(function () { S.ledger = S.ledger.map(function (x) { return x.id === id ? nv : x; }); window.dispatchEvent(new Event('tt:ledger-changed')); render(); U.toast('Voided.'); });
      } else {
        var e = S.expenses.filter(function (x) { return x.id === id; })[0]; if (!e) return;
        ST.save(Object.assign({}, e, { voided: true, voidedAt: Date.now() })).then(function (d) { S.expenses = S.expenses.map(function (x) { return x.id === id ? d : x; }); render(); U.toast('Voided.'); });
      }
    });
  }
  function addRecurring() {
    U.dialog({ title: 'Add recurring cost', ok: 'SAVE', fields: [
      { name: 'title', label: 'Name', type: 'text', placeholder: 'e.g. Data feed' }, { name: 'amount', label: 'Amount ($)', type: 'text', inputmode: 'decimal' },
      { name: 'cadence', label: 'Repeats', type: 'select', options: M.CADENCES.map(function (c) { return { value: c, label: c }; }), value: 'monthly' },
      { name: 'startDate', label: 'First due date', type: 'date', value: todayStr() }, { name: 'endDate', label: 'Last due date (optional)', type: 'date', value: '' },
      { name: 'accountId', label: 'Account (optional)', type: 'select', options: acctOptions(true), value: '' },
      { name: 'category', label: 'Category', type: 'select', options: catOptions(false), value: 'data', hint: 'With an account chosen, use a fee type (evaluation, activation, reset, data, platform, other).' }],
      validate: function (v) { var r = M.validateRecurring(v); return r.ok ? null : r.errors[0]; } }).then(function (v) {
      if (!v) return; var r = M.validateRecurring(v); if (!r.ok) return;
      ST.save(Object.assign({ kind: 'recurring' }, r.record)).then(function (d) { S.recurring.push(d); U.toast('Saved. Nothing is posted until you review it.'); render(); }).catch(function () { U.toast('Could not save.', true); });
    });
  }
  function postDue() {
    var today = todayStr(), refs = [];
    S.ledger.forEach(function (l) { if (l.type === 'fee' && l.ref) refs.push(l.ref); }); S.expenses.forEach(function (e) { if (e.ref) refs.push(e.ref); });
    var pend = []; S.recurring.forEach(function (r) { M.pendingPostings(r, refs, today).forEach(function (p) { pend.push({ rec: r, date: p.date, ref: p.ref }); }); });
    if (!pend.length) { U.toast('Nothing to post.'); return; }
    var tot = pend.reduce(function (a, p) { return a + p.rec.amountCents; }, 0);
    U.confirm('Post ' + U.plural(pend.length, 'payment') + '?', 'Adds ' + pend.length + ' items totalling ' + U.fmtMoney(tot) + ' to your expenses, dated on their due dates. Items can only be posted once.', 'POST').then(function (yes) {
      if (!yes) return; var now = Date.now(), ops = [], newL = [], newE = [];
      pend.forEach(function (p, i) {
        var r = p.rec;
        if (r.accountId) { var v = D.validateLedger({ type: 'fee', accountId: r.accountId, date: p.date, amount: (r.amountCents / 100).toFixed(2), feeKind: r.category, ref: p.ref, note: r.title }); if (!v.ok) return; var rec = Object.assign(v.record, { id: newId('lg') + i, createdAt: now, voided: false }); newL.push(rec); ops.push({ store: 'ledger', type: 'put', value: rec }); }
        else { var d = { id: 'exp-' + newId('x') + i, kind: 'expense', date: p.date, amountCents: r.amountCents, category: r.category, accountId: null, vendor: r.title, note: 'Recurring', ref: p.ref, recurringId: r.id, voided: false, createdAt: now, updatedAt: now }; newE.push(d); ops.push({ store: 'docs', type: 'put', value: d }); }
      });
      ops.push({ store: 'audit', type: 'put', value: { id: DB.uid('au'), at: now, type: 'recurring-posted', details: { count: ops.length } } });
      DB.batch(ops).then(function () { S.ledger = S.ledger.concat(newL); S.expenses = S.expenses.concat(newE); ST.invalidate(); window.dispatchEvent(new Event('tt:ledger-changed')); U.toast('Posted ' + U.plural(newL.length + newE.length, 'item') + '.'); render(); }).catch(function () { U.toast('Could not post. Nothing was changed.', true); });
    });
  }
  function toggleRec(id) {
    var r = S.recurring.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    ST.save(Object.assign({}, r, { active: r.active === false })).then(function (d) { S.recurring = S.recurring.map(function (x) { return x.id === id ? d : x; }); render(); });
  }

  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-mtab]'); if (t) { S.tab = t.getAttribute('data-mtab'); render(); return; }
    var b = e.target.closest('[data-act]'); if (!b) return; var id = b.getAttribute('data-id');
    switch (b.getAttribute('data-act')) {
      case 'm-add-pay': addPayout(); break; case 'm-add-exp': addExpense(); break; case 'm-add-rec': addRecurring(); break; case 'm-post': postDue(); break;
      case 'm-recv': editReceived(id); break; case 'm-void': voidItem(id, b.getAttribute('data-src')); break; case 'm-rec-toggle': toggleRec(id); break;
    }
  });
  root.addEventListener('change', function (e) {
    if (e.target.id === 'm-range') { S.range = e.target.value; render(); }
    else if (e.target.id === 'm-from') { S.from = e.target.value; render(); } else if (e.target.id === 'm-to') { S.to = e.target.value; render(); }
  });
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'money') { load().then(render); } });
  ['tt:ledger-changed', 'tt:accounts-changed'].forEach(function (n) { window.addEventListener(n, function () { S.stale = true; }); });
  if (window.TTNav) window.TTNav.addHub({ id: 'money', title: 'Money', text: 'Payouts, expenses, subscriptions and what each account cost.', icon: '<rect x="3" y="6" width="18" height="13" rx="3"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 6V5a2 2 0 012-2h8a2 2 0 012 2v1"/>' });
  window.TTMoneyUI = { reload: reload, state: S };
})();
