/* Tamhas Trading - Cashflow: where the money went, per account, from the ONE accounting engine (TTCash.summarize).
   Every figure is traceable: the transaction explorer shows each record with its source file and line, and "counted / not counted" says why.
   Imported statements are historical snapshots: nothing here is called live. Nothing is sent anywhere. */
(function () {
  'use strict';
  var root = document.getElementById('cfRoot'); if (!root) return;
  var DB = window.TTDB, C = window.TTCash, J = window.TTJournalCore, U = window.TTUI, AC = window.TTAccountsCore, ST = window.TTStore;
  if (!DB || !C || !J || !U) return;
  var esc = U.esc, DEF = DB.DEFAULT_ACCOUNT_ID, PAGE = 50;
  var S = { loaded: false, err: null, acct: null, tab: 'overview', accounts: [], ledger: [], rows: [], imports: [], f: { q: '', from: '', to: '', cat: '', sort: 'date-desc', show: 'all', page: 0 }, open: {}, cache: {} };
  function pref(k, v) { try { if (v === undefined) return localStorage.getItem('tt.cf.' + k); localStorage.setItem('tt.cf.' + k, v); } catch (e) { return null; } }

  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('accounts'), DB.getAll('ledger'), DB.getAll('trades'), DB.getByIndex('docs', 'kind', 'import')]); }).then(function (r) {
      S.accounts = r[0].map(function (a) { return AC ? AC.normalizeAccount(a) : a; }).sort(function (a, b) { return (a.archived - b.archived) || a.createdAt - b.createdAt; });
      S.ledger = r[1]; var ok = []; r[2].forEach(function (t) { var n = J.normalizeTrade(t); if (n.ok) ok.push(n.trade); }); S.rows = J.analyze(ok); S.imports = r[3]; S.cache = {};
      var saved = pref('acct'); if (!S.acct || (S.acct !== 'all' && !S.accounts.some(function (a) { return a.id === S.acct; }))) S.acct = saved && (saved === 'all' || S.accounts.some(function (a) { return a.id === saved; })) ? saved : defaultAcct();
      S.loaded = true; S.err = null;
    }).catch(function (e) { S.loaded = true; S.err = (e && e.message) || 'Could not open the local database.'; });
  }
  // Prefer an account with cash records, then a personal account, then the first one.
  function defaultAcct() {
    var withCash = S.accounts.filter(function (a) { return !a.archived && S.ledger.some(function (l) { return l.type === 'cash' && l.accountId === a.id; }); })[0];
    var pers = S.accounts.filter(function (a) { return !a.archived && (a.category === 'live' || a.category === 'sim'); })[0];
    return (withCash || pers || S.accounts[0] || { id: DEF }).id;
  }
  function acct(id) { return S.accounts.filter(function (a) { return a.id === id; })[0] || null; }
  function name(id) { var a = acct(id); return a ? a.name : id; }
  // Summaries are cached per account and dropped whenever data change (load() clears the cache), so totals are never stale.
  function sumOf(id) { if (!S.cache[id]) { var a = acct(id); S.cache[id] = a ? C.summarize(a, S.ledger, S.rows, { imports: S.imports, from: S.f.from || null, to: S.f.to || null }) : null; } return S.cache[id]; }
  function m(c, cur, sign) { return C.fmt(c, cur || 'USD', sign); }
  function tile(label, value, sub, cls) { return U.stat(label, value, sub || '', cls || ''); }
  function cls(c) { return c > 0 ? 'pos' : c < 0 ? 'neg' : ''; }
  var BADGE = { reconciled: 'good', partial: 'warn', estimated: 'warn', outdated: 'warn', discrepancy: 'bad', insufficient: 'bad', 'import-error': 'bad' };

  /* ---------- views ---------- */
  function picker() {
    var opts = S.accounts.filter(function (a) { return !a.archived; }).map(function (a) { return '<option value="' + esc(a.id) + '"' + (S.acct === a.id ? ' selected' : '') + '>' + esc(a.name) + (a.currency && a.currency !== 'USD' ? ' (' + a.currency + ')' : '') + '</option>'; }).join('');
    return '<div class="cf-top"><label for="cf-acct">Account</label><select id="cf-acct">' + opts + (S.accounts.length > 1 ? '<option value="all"' + (S.acct === 'all' ? ' selected' : '') + '>All accounts (same currency only)</option>' : '') + '</select>' +
      '<button type="button" class="btn" data-act="cf-import">IMPORT CASH HISTORY</button></div>' +
      '<div class="ui-tabs" role="tablist" aria-label="Cashflow">' + [['overview', 'Overview'], ['flow', 'By period'], ['tx', 'Transactions']].map(function (t) { return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" class="' + (S.tab === t[0] ? 'on' : '') + '" data-act="cf-tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
  }
  function firstRun() {
    return '<div class="panel cf-first"><h2>See where your money went</h2><ol class="cf-steps"><li><b>Choose your broker:</b> Tradovate (others can be imported with the column mapper).</li>' +
      '<li><b>Export your Cash History</b> from Tradovate as CSV for the period you want (menu names differ between Tradovate versions: look for Reports › Cash History). Optionally also export the Performance report for trade details.</li>' +
      '<li><b>Import it here.</b> TRC previews every record, recognises anything already imported, and holds anything unclear for you.</li>' +
      '<li><b>Check the result:</b> the balance is compared with the balance Tradovate reports, and any difference is shown with possible causes.</li></ol>' +
      '<button type="button" class="btn wide" data-act="cf-import">IMPORT CASH HISTORY</button>' +
      '<p class="note">Everything stays on this device' + (window.TTCloud && window.TTCloud.signedIn && window.TTCloud.signedIn() ? ' and in your private TRC cloud space' : '') + '. Imported statements are snapshots of the past, not a live connection to your broker.</p></div>';
  }
  function freshness(s) {
    var f = s.freshness, d = function (ms) { return ms ? new Date(ms).toLocaleString() : '—'; };
    return '<p class="note cf-fresh">Latest record: <b>' + esc(f.latestTxAt ? d(f.latestTxAt) : '—') + '</b> · last Cash History import: <b>' + esc(d(f.lastImportAt)) + '</b> · period: ' + esc((f.from || '—') + ' to ' + (f.to || '—')) + ' · source: ' + esc(f.source || '—') + '. A historical snapshot, not a live balance.</p>';
  }
  function overview(id) {
    var a = acct(id), s = sumOf(id); if (!a || !s) return U.empty('No account', 'Create an account first in Accounts.');
    var cur = s.currency, t = s.totals, hasData = s.coverage || s.trail.trades.length || s.trail.manual.length;
    var h = '';
    if (!s.coverage && !S.ledger.some(function (l) { return l.type === 'cash'; })) h += firstRun();
    h += '<div class="panel cf-status"><div class="cf-st-row"><span class="ui-badge ' + (BADGE[s.status] || '') + '">' + esc(C.STATUS[s.status] || s.status) + '</span><span class="note">' + esc(a.name) + (a.broker ? ' · ' + esc(a.broker) : '') + ' · ' + esc(cur) + '</span></div>' +
      (s.reasons.length ? '<ul class="ui-list cf-reasons">' + s.reasons.map(function (x) { return '<li><span>' + esc(x) + '</span></li>'; }).join('') + '</ul>' : '') + freshness(s) + '</div>';
    var ret = s.twr.value == null ? 'unavailable' : ((s.twr.value >= 0 ? '+' : '') + (s.twr.value * 100).toFixed(2) + '%');
    h += '<div class="ui-grid g2 cf-tiles">' + tile(s.status === 'reconciled' ? 'Reconciled balance' : 'Calculated balance', m(s.balanceCents, cur), s.balanceCents == null ? 'unknown: see above' : s.status === 'reconciled' ? 'matches your broker' : 'not confirmed by your broker') +
      tile('Starting balance', m(s.opening.cents, cur), s.opening.source === 'broker' ? 'from the first Cash History row' : s.opening.source === 'you' ? 'entered by you' + (s.opening.date ? ' · ' + s.opening.date : '') : 'not entered') +
      tile('Net trading P&L', m(t.netTradingCents, cur, true), 'after trading fees', cls(t.netTradingCents)) + tile('Gross trading P&L', m(t.grossCents, cur, true), 'before fees', cls(t.grossCents)) +
      tile('Total fees', m(t.feesCents, cur), m(t.tradingFeesCents, cur) + ' trading · ' + m(t.accountFeesCents, cur) + ' account') + tile('Deposits', m(t.depositsCents, cur), 'not profit') +
      tile('Withdrawals', m(t.withdrawalsCents, cur), 'not losses') + tile('Total account change', m(s.accountChangeCents, cur, true), 'balance minus starting balance', cls(s.accountChangeCents || 0)) +
      tile('Trading return', ret, s.twr.reason) + '</div>';
    if (!hasData) return h;
    // why profit and balance differ (a plain-language bridge)
    h += '<div class="panel"><h2>Why your profit differs from your balance</h2><ul class="ui-list cf-bridge">' +
      [['Starting balance', s.opening.cents], ['+ Gross trading P&L', t.grossCents], ['− Trading fees', -t.tradingFeesCents], ['= Net trading P&L', t.netTradingCents, 1], ['+ Deposits', t.depositsCents], ['− Withdrawals', -t.withdrawalsCents], ['− Account fees (data, platform…)', -t.accountFeesCents],
        ['+ Credits and rebates', t.creditsCents], ['± Transfers', t.transfersInCents - t.transfersOutCents], ['± Adjustments, interest, other', t.adjustmentsCents + t.interestCents + t.otherCents], ['= Balance', s.balanceCents, 1]]
        .filter(function (r) { return r[2] || r[1]; }).map(function (r) { return '<li' + (r[2] ? ' class="cf-sum"' : '') + '><span>' + esc(r[0]) + '</span><b class="' + cls(r[1]) + '">' + esc(m(r[1], cur, !r[2] && r[0][0] !== 'S')) + '</b></li>'; }).join('') + '</ul></div>';
    // fees
    var fs = C.feeShare(t), cats = C.FEE_CATS.filter(function (c) { return t.byCat[c]; }), maxFee = Math.max.apply(null, [1].concat(cats.map(function (c) { return Math.abs(t.byCat[c]); })));
    h += '<div class="panel"><h2>Fees</h2>' + (cats.length ? '<ul class="ui-list cf-bars">' + cats.map(function (c) { var v = -t.byCat[c]; return '<li><span>' + esc(C.label(c)) + (C.TRADING_FEES.indexOf(c) < 0 ? ' <small class="note">account fee</small>' : '') + '<i class="cf-bar" style="width:' + Math.max(2, Math.round(Math.abs(v) / maxFee * 100)) + '%" aria-hidden="true"></i></span><b>' + esc(m(v, cur)) + '</b></li>'; }).join('') + '</ul>' : U.empty('No fees recorded', 'Fees come from your Cash History or the fees on your trades.')) +
      (t.creditsCents ? '<p class="note">Credits and rebates: ' + esc(m(t.creditsCents, cur, true)) + '.</p>' : '') +
      '<p class="note">' + (fs.value == null ? esc(fs.text) : 'Fees were <b>' + (fs.value * 100).toFixed(1) + '%</b> of gross trading profit; you kept <b>' + esc(m(t.netTradingCents, cur)) + '</b> of <b>' + esc(m(t.grossCents, cur)) + '</b>.') + '</p>' +
      (s.estimatedFees ? '<p class="note warnline">' + s.estimatedFees + ' trade(s) use fees estimated from your settings, not broker records.</p>' : '') + '</div>';
    // balance history
    if (s.series.length > 1 && U.lineChart) {
      var pts = s.series.map(function (p, i) { return { x: i, y: p.cents / 100, date: p.date, tip: p.date + ' · ' + m(p.cents, cur) }; }), lab = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter(function (v, i, arr) { return arr.indexOf(v) === i; }).map(function (i) { return { x: pts[i].x, label: pts[i].date.slice(5) }; });
      h += '<div class="panel"><h2>Balance history</h2>' + U.lineChart({ series: [{ name: 'Balance', cls: 'c1', pts: pts, area: true }], xLabels: lab, yFormat: function (v) { return U.fmtMoneyShort(v * 100); }, alt: 'Account balance after each record' }) + '</div>';
    }
    // problems and what was not counted
    if (s.discrepancies.length) h += '<div class="panel"><h2>Discrepancies</h2><ul class="ui-list">' + s.discrepancies.map(function (d) { return '<li><span>' + esc(d.text) + '</span>' + (d.cents != null ? '<b class="neg">' + esc(m(d.cents, cur, true)) + '</b>' : '') + '</li>'; }).join('') + '</ul><p class="note">TRC never adds a balancing entry to make numbers match.</p></div>';
    if (s.checkpoints.length) { var cps = s.checkpoints.slice(-5).reverse(); h += '<details class="panel"><summary>Broker balance checks (' + s.checkpoints.length + ')</summary><ul class="ui-list">' + cps.map(function (c) { return '<li><span>' + esc(c.date + ' · ' + c.source) + '<div class="note" style="margin:2px 0 0">broker ' + esc(m(c.brokerCents, cur)) + ' · TRC ' + esc(m(c.calcCents, cur)) + '</div></span><b class="' + (c.diffCents ? 'neg' : 'pos') + '">' + (c.diffCents ? esc(m(c.diffCents, cur, true)) : '✓') + '</b></li>'; }).join('') + '</ul></details>'; }
    var exT = s.excluded.trades.filter(function (x) { return /source/.test(x.why); }).length, exM = s.excluded.manual.length;
    if (exT || exM || s.notes.length) h += '<div class="panel"><h2>Not counted, and why</h2><ul class="ui-list">' + (exT ? '<li><span>' + U.plural(exT, 'journal trade') + ' inside the Cash History period: the Cash History already contains their P&amp;L and fees, so they are used for analytics only.</span></li>' : '') +
      (exM ? '<li><span>' + U.plural(exM, 'entry', 'entries') + ' you typed in (deposits, withdrawals, fees) inside the Cash History period: the Cash History is the source there.</span></li>' : '') + s.notes.map(function (n) { return '<li><span>' + esc(n) + '</span></li>'; }).join('') + '</ul></div>';
    return h;
  }
  function allView() {
    var list = S.accounts.filter(function (a) { return !a.archived; }).map(function (a) { return sumOf(a.id); }).filter(Boolean), cb = C.combine(list, S.ledger);
    if (!cb.ok) return '<div class="ui-banner warn">' + esc(cb.reason) + ' Choose one account above.</div>';
    var t = cb.totals, cur = cb.currency;
    return '<div class="panel"><p class="note" style="margin-top:0">All active accounts together. Transfers between your own accounts (' + esc(m(cb.internalTransfersCents, cur)) + ') are not counted as deposits or withdrawals. Each account keeps its own status:</p><ul class="ui-list">' +
      list.map(function (s) { return '<li><span>' + esc(name(s.accountId)) + ' <span class="ui-badge ' + (BADGE[s.status] || '') + '">' + esc(C.STATUS[s.status]) + '</span></span><b>' + esc(m(s.balanceCents, s.currency)) + '</b></li>'; }).join('') + '</ul></div>' +
      '<div class="ui-grid g2 cf-tiles">' + tile('Combined balance', m(cb.balanceCents, cur), cb.balanceCents == null ? 'unknown for at least one account' : 'sum of account balances') + tile('Net trading P&L', m(t.netTradingCents, cur, true), '', cls(t.netTradingCents)) + tile('Total fees', m(t.feesCents, cur)) + tile('Deposits', m(t.depositsCents, cur)) + tile('Withdrawals', m(t.withdrawalsCents, cur)) + '</div>';
  }
  function flow(id) {
    var a = acct(id); if (!a) return ''; var cur = a.currency || 'USD', by = S.flowBy || 'month', b = C.buckets(S.ledger, id, by);
    var h = '<div class="ui-row cf-by" role="group" aria-label="Group by">' + [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].map(function (x) { return '<button type="button" class="btn ghost sm' + (by === x[0] ? ' on' : '') + '" aria-pressed="' + (by === x[0]) + '" data-act="cf-by" data-by="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    if (!b.length) return h + U.empty('No Cash History yet', 'Daily, weekly and monthly cash flow comes from imported Cash History records.');
    var cum = 0;
    return h + '<div class="ui-table-wrap"><table class="ui-table cf-flow"><thead><tr><th scope="col">' + (by === 'week' ? 'Week of' : by === 'month' ? 'Month' : 'Day') + '</th><th scope="col">Gross</th><th scope="col">Trading fees</th><th scope="col">Net</th><th scope="col">Deposits</th><th scope="col">Withdrawals</th><th scope="col">Account fees</th><th scope="col">Fees to date</th></tr></thead><tbody>' +
      b.map(function (x) { var t = x.totals; cum += t.feesCents; return '<tr><th scope="row">' + esc(x.key) + '</th><td class="' + cls(t.grossCents) + '">' + esc(m(t.grossCents, cur, true)) + '</td><td>' + esc(m(t.tradingFeesCents, cur)) + '</td><td class="' + cls(t.netTradingCents) + '">' + esc(m(t.netTradingCents, cur, true)) + '</td><td>' + esc(m(t.depositsCents, cur)) + '</td><td>' + esc(m(t.withdrawalsCents, cur)) + '</td><td>' + esc(m(t.accountFeesCents, cur)) + '</td><td>' + esc(m(cum, cur)) + '</td></tr>'; }).reverse().join('') + '</tbody></table></div>' +
      '<p class="note">From imported Cash History records only. Periods without records are not shown.</p>';
  }
  // ---- transaction explorer
  function txList(id) {
    var s = sumOf(id), ex = {}; if (s) s.excluded.manual.forEach(function (x) { ex[x.id] = x.why; });
    var list = S.ledger.filter(function (l) { return l && l.accountId === id && (l.type === 'cash' || l.type !== 'snapshot'); }).map(function (l) {
      var isCash = l.type === 'cash', amt = isCash ? l.amountCents : (l.type === 'adjustment' ? (l.dir === 'down' ? -1 : 1) : l.type === 'fee' || l.type === 'withdrawal' || l.type === 'payout' || l.type === 'transfer-out' ? -1 : 1) * (l.amountCents || 0);
      return { l: l, date: l.date || new Date(l.at).toISOString().slice(0, 10), cat: isCash ? l.category : ({ deposit: 'deposit', withdrawal: 'withdrawal', payout: 'withdrawal', fee: 'other_fee', adjustment: 'adjustment', 'transfer-in': 'transfer_in', 'transfer-out': 'transfer_out' }[l.type] || 'other'),
        type: isCash ? l.brokerType : 'Entered by you: ' + l.type, amt: amt, voided: !!l.voided, counted: !l.voided && !ex[l.id], why: l.voided ? 'voided' : ex[l.id] || '', src: isCash ? (l.source && l.source.file ? l.source.file + ' line ' + l.source.line : 'import') : 'you' };
    });
    var f = S.f, q = f.q.trim().toLowerCase();
    list = list.filter(function (x) { return (!f.from || x.date >= f.from) && (!f.to || x.date <= f.to) && (!f.cat || x.cat === f.cat) && (!q || (x.type + ' ' + x.cat + ' ' + C.label(x.cat) + ' ' + (x.l.comment || x.l.note || '') + ' ' + (x.l.brokerId || '')).toLowerCase().indexOf(q) >= 0) &&
      (f.show === 'all' || (f.show === 'notcounted' && !x.counted) || (f.show === 'manual' && x.l.type !== 'cash')); });
    var srt = { 'date-desc': function (a, b) { return (b.l.at - a.l.at) || 0; }, 'date-asc': function (a, b) { return a.l.at - b.l.at; }, 'amt-desc': function (a, b) { return b.amt - a.amt; }, 'amt-asc': function (a, b) { return a.amt - b.amt; } }[f.sort];
    return list.sort(srt);
  }
  function explorer(id) {
    var a = acct(id); if (!a) return ''; var cur = a.currency || 'USD', list = txList(id), f = S.f, pages = Math.max(1, Math.ceil(list.length / PAGE)), pg = Math.min(f.page, pages - 1), rows = list.slice(pg * PAGE, pg * PAGE + PAGE);
    var cats = {}; S.ledger.forEach(function (l) { if (l.accountId === id && l.type === 'cash') cats[l.category] = 1; });
    var h = '<div class="panel ui-form cf-filters"><div class="cf-frow"><label for="cf-q">Search</label><input id="cf-q" type="search" value="' + esc(f.q) + '" placeholder="type, comment, id" autocomplete="off"></div>' +
      '<div class="cf-frow"><label for="cf-from">From</label><input id="cf-from" type="date" value="' + esc(f.from) + '"></div><div class="cf-frow"><label for="cf-to">To</label><input id="cf-to" type="date" value="' + esc(f.to) + '"></div>' +
      '<div class="cf-frow"><label for="cf-cat">Type</label><select id="cf-cat"><option value="">All types</option>' + Object.keys(C.CATS).filter(function (c) { return cats[c] || c === 'deposit' || c === 'withdrawal'; }).map(function (c) { return '<option value="' + c + '"' + (f.cat === c ? ' selected' : '') + '>' + esc(C.label(c)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="cf-frow"><label for="cf-show">Show</label><select id="cf-show"><option value="all"' + (f.show === 'all' ? ' selected' : '') + '>Everything</option><option value="notcounted"' + (f.show === 'notcounted' ? ' selected' : '') + '>Not counted (and why)</option><option value="manual"' + (f.show === 'manual' ? ' selected' : '') + '>Entered by you</option></select></div>' +
      '<div class="cf-frow"><label for="cf-sort">Sort</label><select id="cf-sort">' + [['date-desc', 'Newest first'], ['date-asc', 'Oldest first'], ['amt-desc', 'Largest amount'], ['amt-asc', 'Smallest amount']].map(function (o) { return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="ui-row"><button type="button" class="btn ghost sm" data-act="cf-clear">CLEAR FILTERS</button><button type="button" class="btn ghost sm" data-act="cf-export"' + (list.length ? '' : ' disabled') + '>EXPORT ' + list.length + ' AS CSV</button></div></div>';
    if (!list.length) return h + U.empty('No records', 'No cash records match. Import a Cash History, or change the filters.');
    h += '<p class="note" aria-live="polite">' + U.plural(list.length, 'record') + ' · page ' + (pg + 1) + ' of ' + pages + '</p><ul class="ui-list cf-tx">' + rows.map(function (x) {
      var k = x.l.id, op = S.open[k];
      return '<li class="' + (x.counted ? '' : 'cf-off') + '"><div class="cf-txm"><b>' + esc(x.date + (x.l.time ? ' ' + x.l.time : '')) + ' · ' + esc(C.label(x.cat)) + '</b><div class="note" style="margin:2px 0 0">' + esc(x.type) + (x.l.comment ? ' · ' + esc(x.l.comment) : '') + (x.counted ? '' : ' · <b>not counted:</b> ' + esc(x.why)) + '</div>' +
        '<button type="button" class="linkbtn" data-act="cf-src" data-id="' + esc(k) + '" aria-expanded="' + !!op + '">' + (op ? 'Hide source' : 'Source') + '</button>' +
        (op ? '<div class="cf-src"><p class="note">' + esc(x.src) + (x.l.balanceAfterCents != null ? ' · broker balance after: ' + m(x.l.balanceAfterCents, cur) : '') + (x.l.brokerId ? ' · broker id ' + x.l.brokerId : '') + (x.l.bySign ? ' · deposit/withdrawal decided by the sign' : '') + (x.l.replaced ? ' · corrected from ' + m(x.l.replaced.previousCents, cur) : '') + '</p>' +
          (x.l.source && x.l.source.raw ? '<code class="cf-raw">' + esc(x.l.source.raw.join(' | ')) + '</code>' : '') + '</div>' : '') + '</div><b class="' + cls(x.amt) + '">' + esc(m(x.amt, cur, true)) + '</b></li>'; }).join('') + '</ul>' +
      (pages > 1 ? '<div class="ui-row cf-pager"><button type="button" class="btn ghost sm" data-act="cf-page" data-d="-1"' + (pg ? '' : ' disabled') + '>‹ PREVIOUS</button><button type="button" class="btn ghost sm" data-act="cf-page" data-d="1"' + (pg < pages - 1 ? '' : ' disabled') + '>NEXT ›</button></div>' : '');
    return h;
  }
  function render() {
    if (!S.loaded) { root.innerHTML = '<div class="ui-skel" aria-hidden="true"><i></i><i></i><i></i></div>'; return; }
    if (S.err) { root.innerHTML = '<div class="ui-banner bad" role="alert">' + esc(S.err) + '</div>'; return; }
    if (!S.accounts.length) { root.innerHTML = firstRun(); return; }
    var body = S.acct === 'all' ? (S.tab === 'overview' ? allView() : '<p class="note">Choose one account to see its records.</p>') : S.tab === 'flow' ? flow(S.acct) : S.tab === 'tx' ? explorer(S.acct) : overview(S.acct);
    root.innerHTML = picker() + '<div id="cfBody">' + body + '</div>';
  }
  function exportNow() {
    var a = acct(S.acct), list = txList(S.acct).map(function (x) { return Object.assign({}, x.l, { amountCents: x.amt, category: x.cat, brokerType: x.type }); });
    var csv = C.exportCsv(list, name), blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), el = document.createElement('a');
    el.href = url; el.download = 'trc-cashflow-' + (a ? a.name.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 30) : 'account') + '-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(el); el.click(); el.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    U.toast('Exported ' + U.plural(list.length, 'record') + '. Text cells that a spreadsheet could run as formulas are neutralised.');
  }
  var qT = null;
  root.addEventListener('input', function (e) { if (e.target.id === 'cf-q') { clearTimeout(qT); var v = e.target.value; qT = setTimeout(function () { S.f.q = v; S.f.page = 0; var pos = e.target.selectionStart; render(); var i = document.getElementById('cf-q'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) {} } }, 250); } });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'cf-acct') { S.acct = t.value; pref('acct', t.value); S.f.page = 0; render(); var s = document.getElementById('cf-acct'); if (s) s.focus(); return; }
    var k = { 'cf-from': 'from', 'cf-to': 'to', 'cf-cat': 'cat', 'cf-sort': 'sort', 'cf-show': 'show' }[t.id]; if (k) { S.f[k] = t.value; S.f.page = 0; if (k === 'from' || k === 'to') S.cache = {}; render(); var n = document.getElementById(t.id); if (n) n.focus(); }
  });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'cf-tab') { S.tab = b.getAttribute('data-tab'); render(); var x = root.querySelector('[data-tab="' + S.tab + '"]'); if (x) x.focus(); }
    else if (a === 'cf-import') { if (window.TTNav) window.TTNav.go('import'); }
    else if (a === 'cf-by') { S.flowBy = b.getAttribute('data-by'); render(); }
    else if (a === 'cf-src') { var id = b.getAttribute('data-id'); S.open[id] = !S.open[id]; render(); var y = root.querySelector('[data-act=cf-src][data-id="' + id + '"]'); if (y) y.focus(); }
    else if (a === 'cf-page') { S.f.page = Math.max(0, S.f.page + +b.getAttribute('data-d')); render(); var l = root.querySelector('.cf-tx'); if (l) l.scrollIntoView({ block: 'start' }); }
    else if (a === 'cf-clear') { S.f = { q: '', from: '', to: '', cat: '', sort: 'date-desc', show: 'all', page: 0 }; S.cache = {}; render(); }
    else if (a === 'cf-export') exportNow();
  });
  function refresh() { return load().then(render); }
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'cashflow') refresh(); });
  ['tt:ledger-changed', 'tt:journal-changed', 'tt:accounts-changed'].forEach(function (ev) { window.addEventListener(ev, function () { S.cache = {}; if (S.loaded && document.getElementById('view-cashflow') && document.getElementById('view-cashflow').classList.contains('active')) refresh(); }); });
  // Copilot and other screens read figures through here, so they always match what this screen shows.
  window.TTCashflow = { reload: refresh, state: S, summary: function (id) { return load().then(function () { return id === 'all' ? null : sumOf(id || S.acct); }); }, open: function (id, tab) { S.acct = id || S.acct; S.tab = tab || 'overview'; if (window.TTNav) window.TTNav.go('cashflow'); } };
})();
