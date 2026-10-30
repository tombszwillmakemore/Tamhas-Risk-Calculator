/* Tamhas Trading - Strategy lab: define strategies, link them to journal trades (by the trade's Strategy field), enter backtest
   results by hand or paste them, compare, resample (Monte Carlo) and sweep settings. Only your own data is used. */
(function () {
  'use strict';
  var root = document.getElementById('stRoot'); if (!root) return;
  var Y = window.TTStrategyCore, A = window.TTAnalyticsCore, C = window.TTJournalCore, U = window.TTUI, DB = window.TTDB, ST = window.TTStore, esc = U.esc;
  var S = { loaded: false, err: null, rows: [], strats: [], tests: {}, sel: null, dtab: 'rules', form: null, formErr: null, cmp: [], showCmp: false, src: 'journal', mc: { horizon: '100', sims: '2000', seed: '12345', dd: '' }, mcOut: null, swOut: null, rForm: { date: '', r: '', pnl: '', note: '' }, rErr: null, paste: '', pasteOut: null, hidden: [] };
  var TABS = [['rules', 'RULES'], ['live', 'JOURNAL'], ['backtest', 'BACKTEST'], ['sim', 'SIMULATE']], SECS = [['stats', 'Statistics'], ['equity', 'Equity curve'], ['recent', 'Recent results']];
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), ST.list('strategy'), ST.list('backtest'), ST.getPref('strategy.hidden', [])]); }).then(function (r) {
      var ok = []; r[0].forEach(function (raw) { var n = C.normalizeTrade(raw); if (n.ok) ok.push(n.trade); }); S.rows = C.analyze(ok);
      S.strats = r[1].filter(function (x) { return x.name; }).sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }); S.tests = {}; r[2].forEach(function (b) { if (b.strategyId) S.tests[b.strategyId] = b; });
      S.hidden = Array.isArray(r[3]) ? r[3] : []; S.loaded = true; S.err = null;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function save(doc) { return ST.save(doc).catch(function (e) { U.toast('Could not save. Nothing was changed.', true); throw e; }); }
  function cur() { return S.strats.filter(function (x) { return x.id === S.sel; })[0] || null; }
  function jr(s) { return Y.fromJournal(S.rows, s.name); }
  function bt(s) { var t = S.tests[s.id]; return t ? Y.sortResults(t.results || []) : []; }
  function fR(v, d) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + 'R'; }
  function fP(v) { return v == null ? '—' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%'; }
  function errBox(l) { return l && l.length ? '<div class="ui-banner bad" role="alert">' + l.map(esc).join('<br>') + '</div>' : ''; }
  function field(id, label, val, ph, area, mode) { return '<label for="' + id + '">' + label + '</label>' + (area ? '<textarea id="' + id + '" rows="' + area + '" placeholder="' + esc(ph || '') + '">' + esc(val) + '</textarea>' : '<input id="' + id + '" type="text" inputmode="' + (mode || 'text') + '" autocomplete="off" placeholder="' + esc(ph || '') + '" value="' + esc(val) + '">'); }
  var STL = { idea: 'Idea', testing: 'Testing', live: 'Live', retired: 'Retired' };
  function statGrid(s, extra) {
    if (!s.n) return '<p class="note" style="margin:0">No results yet.</p>';
    return '<div class="ui-grid">' + U.stat('Results', String(s.n), s.sample) + U.stat('Win rate', fP(s.winRate), s.winCI ? '95% range ' + fP(s.winCI.lo) + '–' + fP(s.winCI.hi) : '') + U.stat('Expectancy', fR(s.expectancyR), s.expectancyCI ? '95% range ' + fR(s.expectancyCI.lo) + ' to ' + fR(s.expectancyCI.hi) : 'needs 2+ results', s.expectancyR > 0 ? 'pos' : s.expectancyR < 0 ? 'neg' : '') + U.stat('Total', fR(s.totalR), '', s.totalR > 0 ? 'pos' : s.totalR < 0 ? 'neg' : '') +
      U.stat('Profit factor', s.profitFactor == null ? '—' : s.profitFactor.toFixed(2), s.profitFactorNote) + U.stat('Max drawdown', s.maxDrawdownR ? '-' + s.maxDrawdownR.toFixed(2) + 'R' : '0R', 'from running peak') + U.stat('Avg win / loss', fR(s.avgWinR, 1) + ' / ' + fR(s.avgLossR, 1), '') + U.stat('Worst streak', s.maxLossStreak + ' losses', '') + '</div>' +
      (s.ciIncludesZero ? '<p class="note">The 95% range for expectancy includes 0R, so these results cannot yet tell a real edge from luck.</p>' : '') + (extra || '');
  }
  function equity(rs) { if (rs.length < 2) return ''; var pts = Y.equityR(rs).map(function (p) { return { x: p.i + 1, y: p.r, tip: p.date + ': ' + fR(p.r) }; }); pts.unshift({ x: 0, y: 0, tip: 'Start' }); return U.lineChart({ series: [{ name: 'Cumulative R', cls: 'c1', pts: pts, area: true }], baseline: 0, xLabels: [{ x: 0, label: '0' }, { x: rs.length, label: String(rs.length) }], yFormat: function (v) { return v.toFixed(1) + 'R'; }, alt: 'Cumulative R after each result' }); }
  function sec(id) { return S.hidden.indexOf(id) < 0; }
  function resultsBlock(rs, label) {
    var h = '', s = Y.stats(rs);
    if (sec('stats')) h += '<div class="panel"><h2>' + esc(label) + '</h2>' + statGrid(s) + '</div>';
    if (sec('equity') && rs.length > 1) h += '<div class="panel"><h2>Equity curve</h2>' + equity(rs) + '<p class="note">Each point is one result, in date order, measured in R. Not a P&amp;L curve.</p></div>';
    return h;
  }
  function custBar() { return '<div class="chips" aria-label="Show or hide sections">' + SECS.map(function (x) { return '<button type="button" class="chip' + (sec(x[0]) ? ' on' : '') + '" data-act="st-sec" data-s="' + x[0] + '" aria-pressed="' + sec(x[0]) + '">' + esc(x[1].toUpperCase()) + '</button>'; }).join('') + '</div>'; }

  /* ---------- list ---------- */
  function listHtml() {
    var h = '';
    if (S.cmp.length) h += '<div class="panel"><b>' + S.cmp.length + ' selected to compare</b> <small class="note">(up to 4)</small><div class="ui-row" style="margin-top:8px"><button type="button" class="btn" data-act="st-compare"' + (S.cmp.length < 2 ? ' disabled' : '') + '>COMPARE</button><button type="button" class="btn ghost" data-act="st-cmp-clear">CLEAR</button></div></div>';
    h += '<div class="panel"><div class="ui-sec" style="margin:0 0 8px"><h2 style="margin:0">Strategies</h2><button type="button" class="btn sm" data-act="st-new">+ NEW</button></div>' + (S.strats.length ? S.strats.map(function (s) {
      var j = Y.stats(jr(s).results), b = Y.stats(bt(s)), jk = 'j:' + s.id, bk = 'b:' + s.id;
      return '<div class="panel" style="margin:8px 0"><div class="ui-sec" style="margin:0 0 4px"><button type="button" class="linkbtn" data-act="st-open" data-id="' + esc(s.id) + '"><b>' + esc(s.name) + '</b></button><span class="ui-badge">' + esc(STL[s.status]) + '</span></div><div class="note" style="margin:0 0 8px">Journal: ' + (j.n ? U.plural(j.n, 'trade') + ', ' + fR(j.expectancyR) + ' avg' : 'no trades with this strategy name') + ' · Backtest: ' + (b.n ? U.plural(b.n, 'result') + ', ' + fR(b.expectancyR) + ' avg' : 'none') + '</div>' +
        '<div class="chips"><button type="button" class="chip' + (S.cmp.indexOf(jk) >= 0 ? ' on' : '') + '" data-act="st-cmp" data-k="' + jk + '"' + (j.n ? '' : ' disabled') + '>COMPARE JOURNAL</button><button type="button" class="chip' + (S.cmp.indexOf(bk) >= 0 ? ' on' : '') + '" data-act="st-cmp" data-k="' + bk + '"' + (b.n ? '' : ' disabled') + '>COMPARE BACKTEST</button></div></div>'; }).join('') : U.empty('No strategies yet', 'Describe a strategy, then link it to journal trades by using the same name in each trade\'s Strategy field.', '<button type="button" class="btn" data-act="st-new">NEW STRATEGY</button>')) + '</div>';
    var known = {}; S.strats.forEach(function (s) { known[s.name.toLowerCase()] = 1; });
    var unlinked = {}; S.rows.forEach(function (r) { var n = r.t.strategy; if (n && !known[n.toLowerCase()]) { unlinked[n.toLowerCase()] = unlinked[n.toLowerCase()] || { name: n, n: 0 }; unlinked[n.toLowerCase()].n++; } });
    var ul = Object.keys(unlinked).map(function (k) { return unlinked[k]; });
    if (ul.length) h += '<div class="panel"><h2>Names used in your journal</h2><p class="note" style="margin-top:0">These strategy names appear on trades but have no strategy here yet.</p><div class="chips">' + ul.map(function (x) { return '<button type="button" class="chip" data-act="st-adopt" data-name="' + esc(x.name) + '">+ ' + esc(x.name) + ' (' + x.n + ')</button>'; }).join('') + '</div></div>';
    return h;
  }
  function formHtml() {
    var f = S.form, e = f.id ? cur() : null;
    return '<div class="panel ui-form"><h2>' + (f.id ? 'Edit strategy' : 'New strategy') + '</h2>' + field('sf-name', 'Name', f.name, 'e.g. Opening range breakout') + (f.id ? '<p class="note">Journal trades are linked by this name. If you rename it, update the Strategy field on those trades too.</p>' : '<p class="note">Use this exact name in the Strategy field when you log trades to link them.</p>') +
      '<label for="sf-status">Status</label><select id="sf-status">' + Y.STATUSES.map(function (k) { return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + STL[k] + '</option>'; }).join('') + '</select>' +
      field('sf-markets', 'Markets', f.markets, 'e.g. NQ, MNQ') + field('sf-tf', 'Timeframe', f.timeframe, 'e.g. 5 minute') + field('sf-desc', 'Idea in a sentence or two', f.description, '', 3) +
      field('sf-entry', 'Entry rules (one per line)', f.entryText, 'Break of opening range high\nRetest holds', 4) + field('sf-exit', 'Exit rules', f.exitText, 'Half off at 1R\nStop under retest low', 4) + field('sf-risk', 'Risk rules', f.riskText, 'Max 1% per trade', 3) + field('sf-filters', 'Filters / when NOT to trade', f.filtersText, 'Skip FOMC days', 3) + field('sf-notes', 'Notes', f.notes, '', 3) + errBox(S.formErr) +
      '<div class="ui-row" style="margin-top:12px"><button type="button" class="btn" data-act="st-save">SAVE</button><button type="button" class="btn ghost" data-act="st-form-cancel">CANCEL</button></div></div>';
  }
  function readForm() {
    var g = function (id) { return document.getElementById(id).value; };
    S.form = Object.assign({}, S.form, { name: g('sf-name'), status: g('sf-status'), markets: g('sf-markets'), timeframe: g('sf-tf'), description: g('sf-desc'), entryText: g('sf-entry'), exitText: g('sf-exit'), riskText: g('sf-risk'), filtersText: g('sf-filters'), notes: g('sf-notes') });
  }
  function toForm(s) { return { id: s.id, name: s.name, status: s.status, markets: s.markets, timeframe: s.timeframe, description: s.description, entryText: (s.entryRules || []).join('\n'), exitText: (s.exitRules || []).join('\n'), riskText: (s.riskRules || []).join('\n'), filtersText: (s.filters || []).join('\n'), notes: s.notes }; }

  /* ---------- detail ---------- */
  function detailHtml() {
    var s = cur(); if (!s) { S.sel = null; return listHtml(); }
    var h = '<div class="ui-sec" style="margin:0 0 8px"><button type="button" class="linkbtn" data-act="st-back">‹ All strategies</button><span class="ui-badge">' + esc(STL[s.status]) + '</span></div><h2 style="margin:0 0 8px">' + esc(s.name) + '</h2>' +
      '<div class="chips jtabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (S.dtab === t[0]) + '" class="chip' + (S.dtab === t[0] ? ' on' : '') + '" data-act="st-dtab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (S.dtab === 'rules') h += rulesHtml(s); else if (S.dtab === 'live') h += liveHtml(s); else if (S.dtab === 'backtest') h += backtestHtml(s); else h += simHtml(s);
    return h;
  }
  function ruleList(t, a) { return a && a.length ? '<h3 class="sub">' + t + '</h3><ul class="ui-list">' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }
  function rulesHtml(s) {
    return '<div class="panel">' + (s.description ? '<p style="margin-top:0">' + esc(s.description) + '</p>' : '') + (s.markets || s.timeframe ? '<p class="note">' + esc([s.markets, s.timeframe].filter(Boolean).join(' · ')) + '</p>' : '') + ruleList('Entry', s.entryRules) + ruleList('Exit', s.exitRules) + ruleList('Risk', s.riskRules) + ruleList('Filters', s.filters) + (s.notes ? '<h3 class="sub">Notes</h3><p>' + esc(s.notes) + '</p>' : '') +
      (!(s.entryRules || []).length && !(s.exitRules || []).length ? '<p class="note">No rules written yet. Tap EDIT to define them.</p>' : '') + '<div class="ui-row"><button type="button" class="btn" data-act="st-edit">EDIT</button><button type="button" class="btn ghost" data-act="st-del">DELETE</button></div></div>';
  }
  function liveHtml(s) {
    var j = jr(s), h = custBar(), rs = j.results, b = bt(s);
    h += '<div class="panel"><p class="note" style="margin:0">Closed trades whose Strategy field is “' + esc(s.name) + '” (any capitalisation). ' + U.plural(j.trades, 'trade') + ' found' + (j.open ? ', ' + j.open + ' still open' : '') + (j.noR ? ', ' + j.noR + ' closed without a stop (R unknown)' : '') + '. Left-out trades are never counted as 0.</p></div>';
    h += resultsBlock(rs, 'Journal results');
    if (s.status === 'testing' || b.length) { var fb = Y.forwardVsBacktest(rs, b); h += '<div class="panel"><h2>Forward test vs backtest</h2><p style="margin-top:0">' + esc(fb.text) + '</p><p class="note">Forward = your journal trades under this name. Backtest = results you entered. Sampling noise only; it cannot tell you why they differ.</p></div>'; }
    return h;
  }
  function backtestHtml(s) {
    var rs = bt(s), h = '<div class="panel"><p class="note" style="margin:0"><b>Only results you enter appear here.</b> This app does not download market data or replay history. Work out each trade\'s result yourself (from a chart, a spreadsheet or another tool) and record it as R, the profit divided by the amount risked.</p></div>' + custBar();
    h += resultsBlock(rs, 'Backtest results');
    var f = S.rForm;
    h += '<div class="panel ui-form"><h2>Add a result</h2><div class="fgrid"><div>' + field('bf-date', 'Date', f.date, 'YYYY-MM-DD') + '</div><div>' + field('bf-r', 'Result in R', f.r, 'e.g. 2 or -1', 0, 'decimal') + '</div></div><div class="fgrid"><div>' + field('bf-pnl', 'Dollars (optional)', f.pnl, '', 0, 'decimal') + '</div><div>' + field('bf-note', 'Note (optional)', f.note, '') + '</div></div>' + errBox(S.rErr) + '<button type="button" class="btn wide" data-act="st-add" style="margin-top:10px">ADD RESULT</button></div>';
    h += '<div class="panel ui-form"><h2>Paste many results</h2><p class="note" style="margin-top:0">One per line: <code>date,R</code> with optional <code>,dollars,note</code>. A header line is fine. Up to ' + Y.MAX_RESULTS + ' rows.</p>' + field('bp-text', 'Results', S.paste, '2026-03-02,1.5\n2026-03-03,-1', 6);
    if (S.pasteOut) h += '<p><b>' + S.pasteOut.results.length + ' valid</b>, ' + S.pasteOut.errors.length + ' rejected.</p>' + (S.pasteOut.errors.length ? '<div class="ui-banner warn">' + S.pasteOut.errors.slice(0, 8).map(function (x) { return 'Line ' + x.line + ': ' + esc(x.msg); }).join('<br>') + (S.pasteOut.errors.length > 8 ? '<br>…and ' + (S.pasteOut.errors.length - 8) + ' more' : '') + '</div>' : '');
    h += '<div class="ui-row" style="margin-top:10px"><button type="button" class="btn ghost" data-act="st-preview">PREVIEW</button><button type="button" class="btn" data-act="st-import"' + (S.pasteOut && S.pasteOut.results.length ? '' : ' disabled') + '>ADD ' + (S.pasteOut ? S.pasteOut.results.length : 0) + ' RESULTS</button></div><p class="note">Nothing is saved until you press ADD. Existing results are kept.</p></div>';
    if (rs.length && sec('recent')) { var t = S.tests[s.id], all = t.results.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) { return a.x.date < b.x.date ? 1 : a.x.date > b.x.date ? -1 : b.i - a.i; }).slice(0, 12);
      h += '<div class="panel"><h2>Most recent entries</h2><ul class="ui-list">' + all.map(function (o) { return '<li><span>' + esc(o.x.date) + ' <b class="' + (o.x.r > 0 ? 'pos' : o.x.r < 0 ? 'neg' : '') + '">' + fR(o.x.r) + '</b>' + (o.x.pnlCents != null ? ' <small class="note" style="margin:0">' + C.fmtMoney(o.x.pnlCents, true) + '</small>' : '') + (o.x.note ? ' <small class="note" style="margin:0">' + esc(o.x.note) + '</small>' : '') + '</span><button type="button" class="btn ghost sm" data-act="st-rdel" data-i="' + o.i + '">REMOVE</button></li>'; }).join('') + '</ul><button type="button" class="btn ghost" data-act="st-rclear">REMOVE ALL BACKTEST RESULTS</button></div>'; }
    return h;
  }
  function srcResults(s) { return S.src === 'backtest' ? bt(s) : jr(s).results; }
  function simHtml(s) {
    var rs = srcResults(s), m = S.mc, h = '<div class="chips">' + [['journal', 'MY JOURNAL TRADES'], ['backtest', 'MY BACKTEST']].map(function (x) { return '<button type="button" class="chip' + (S.src === x[0] ? ' on' : '') + '" data-act="st-src" data-s="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div><p class="note">Using ' + U.plural(rs.length, 'result') + '. Both tools below only rearrange or filter these results. They do not predict anything.</p>';
    h += '<div class="panel ui-form"><h2>Monte Carlo</h2><p class="note" style="margin-top:0">Draws your results at random, many times, to show how much luck alone can move the outcome.</p><div class="fgrid"><div>' + field('mc-h', 'Trades ahead', m.horizon, '', 0, 'numeric') + '</div><div>' + field('mc-n', 'Simulations', m.sims, '', 0, 'numeric') + '</div></div><div class="fgrid"><div>' + field('mc-seed', 'Seed', m.seed, '', 0, 'numeric') + '</div><div>' + field('mc-dd', 'Drawdown limit (R, optional)', m.dd, 'e.g. 5', 0, 'decimal') + '</div></div><button type="button" class="btn wide" data-act="st-mc" style="margin-top:10px">RUN SIMULATION</button>';
    var o = S.mcOut; if (o) { if (!o.ok) h += o.errors ? errBox(o.errors) : '<div class="ui-banner warn">' + esc(o.text) + '</div>'; else h += '<div class="ui-grid" style="margin-top:12px">' + U.stat('Typical (median)', fR(o.final.p50), 'after ' + o.horizon + ' trades') + U.stat('Unlucky 1 in 20', fR(o.final.p5), '5th percentile', 'neg') + U.stat('Lucky 1 in 20', fR(o.final.p95), '95th percentile', 'pos') + U.stat('Finish below 0R', fP(o.probNegative), 'of ' + o.sims + ' runs') + U.stat('Typical worst drawdown', '-' + o.drawdown.p50.toFixed(1) + 'R', 'median') + U.stat('Bad-case drawdown', '-' + o.drawdown.p95.toFixed(1) + 'R', '1 in 20 runs is worse') + (o.probDdLimit != null ? U.stat('Hit -' + o.ddLimitR + 'R drawdown', fP(o.probDdLimit), 'at some point') : '') + '</div><p class="note">' + esc(o.note) + ' Seed ' + o.seed + ': the same seed and inputs give the same answer.</p>'; }
    h += '</div><div class="panel"><h2>Compare settings</h2><p class="note" style="margin-top:0">See how your results would have looked under a different rule. Each row is split into an earlier half and a later half.</p><div class="ui-row"><button type="button" class="btn ghost" data-act="st-sw" data-k="firstN">TRADES PER DAY</button><button type="button" class="btn ghost" data-act="st-sw" data-k="riskcap">RISK CAP</button></div>';
    var w = S.swOut; if (w) { if (!w.ok) h += '<div class="ui-banner warn">' + esc(w.text) + '</div>'; else h += '<div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Setting</th><th>n</th><th>Avg R</th><th>Earlier</th><th>Later</th></tr></thead><tbody>' + w.rows.map(function (r) { return '<tr><td style="text-align:left">' + esc(r.label) + '</td><td>' + r.all.n + '</td><td>' + fR(r.all.expectancyR) + '</td><td>' + fR(r.first.expectancyR) + '</td><td>' + fR(r.second.expectancyR) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="note">' + esc(w.note) + '</p>'; }
    return h + '</div>';
  }
  /* ---------- compare ---------- */
  function sets() {
    return S.cmp.map(function (k) { var s = S.strats.filter(function (x) { return x.id === k.slice(2); })[0]; if (!s) return null; return { key: k, label: s.name + (k[0] === 'j' ? ' (journal)' : ' (backtest)'), results: k[0] === 'j' ? jr(s).results : bt(s) }; }).filter(Boolean);
  }
  function compareHtml() {
    var c = Y.compare(sets()), h = '<div class="ui-sec" style="margin:0 0 8px"><button type="button" class="linkbtn" data-act="st-back">‹ All strategies</button></div><div class="panel"><h2>Comparison</h2>';
    if (c.length < 2) return h + '<p class="note">Pick at least two sets to compare.</p></div>';
    var rows = [['Results', function (s) { return s.n ? String(s.n) : '—'; }], ['Sample', function (s) { return s.n ? s.sample : '—'; }], ['Win rate', function (s) { return s.n ? fP(s.winRate) : '—'; }], ['Win rate 95% range', function (s) { return s.winCI ? fP(s.winCI.lo) + '–' + fP(s.winCI.hi) : '—'; }], ['Expectancy', function (s) { return fR(s.expectancyR); }], ['Expectancy 95% range', function (s) { return s.expectancyCI ? fR(s.expectancyCI.lo) + ' to ' + fR(s.expectancyCI.hi) : '—'; }], ['Total', function (s) { return fR(s.totalR); }], ['Profit factor', function (s) { return s.profitFactor == null ? '—' : s.profitFactor.toFixed(2); }], ['Max drawdown', function (s) { return s.n ? '-' + s.maxDrawdownR.toFixed(2) + 'R' : '—'; }], ['Worst loss streak', function (s) { return s.n ? String(s.maxLossStreak) : '—'; }]];
    h += '<div class="ui-table-wrap"><table class="ui-table"><thead><tr><th></th>' + c.map(function (x) { return '<th>' + esc(x.label) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr><td style="text-align:left">' + r[0] + '</td>' + c.map(function (x) { return '<td>' + esc(r[1](x.stats)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    var small = c.filter(function (x) { return x.stats.n < 30; }); h += '<p class="note">' + (small.length ? 'Sets with fewer than 30 results (' + small.map(function (x) { return esc(x.label); }).join(', ') + ') are too small to rank confidently. ' : '') + 'A higher number is only meaningful when the 95% ranges barely overlap.</p></div>';
    return h;
  }

  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; } if (S.err) { root.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    var y = window.scrollY; root.innerHTML = S.form ? formHtml() : S.showCmp ? compareHtml() : S.sel ? detailHtml() : listHtml(); window.scrollTo(0, y);
  }
  function saveTest(s, results) { return save({ id: 'bt-' + s.id, kind: 'backtest', strategyId: s.id, results: results }).then(load); }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return; var a = b.getAttribute('data-act'), s = cur();
    if (a === 'st-new') { S.form = { name: '', status: 'idea' }; S.formErr = null; render(); window.scrollTo(0, 0); }
    else if (a === 'st-adopt') { S.form = { name: b.getAttribute('data-name'), status: 'testing' }; S.formErr = null; render(); window.scrollTo(0, 0); }
    else if (a === 'st-edit') { S.form = toForm(s); S.formErr = null; render(); window.scrollTo(0, 0); }
    else if (a === 'st-form-cancel') { S.form = null; render(); }
    else if (a === 'st-save') { readForm(); var v = Y.validateStrategy(S.form); if (!v.ok) { S.formErr = v.errors; render(); return; } var dup = S.strats.some(function (x) { return x.id !== S.form.id && x.name.toLowerCase() === v.strategy.name.toLowerCase(); }); if (dup) { S.formErr = ['A strategy with this name already exists.']; render(); return; } S.formErr = null;
      save(Object.assign({ id: S.form.id, kind: 'strategy' }, S.form.id ? { createdAt: (cur() || {}).createdAt } : {}, v.strategy)).then(function (d) { S.form = null; S.sel = d.id; S.dtab = S.dtab || 'rules'; return load(); }).then(function () { U.toast('Strategy saved.'); render(); window.scrollTo(0, 0); }).catch(function () {}); }
    else if (a === 'st-open') { S.sel = b.getAttribute('data-id'); S.dtab = 'rules'; S.mcOut = null; S.swOut = null; render(); window.scrollTo(0, 0); }
    else if (a === 'st-back') { S.sel = null; S.showCmp = false; render(); }
    else if (a === 'st-dtab') { S.dtab = b.getAttribute('data-t'); S.mcOut = null; S.swOut = null; render(); }
    else if (a === 'st-del') U.confirm('Delete “' + s.name + '”?', 'Its backtest results are deleted too. Journal trades are not touched.', 'DELETE', true).then(function (y) { if (!y) return; ST.remove(s.id, 'strategy').then(function () { return ST.remove('bt-' + s.id, 'backtest'); }).then(function () { S.sel = null; S.cmp = S.cmp.filter(function (k) { return k.slice(2) !== s.id; }); return load(); }).then(function () { U.toast('Strategy deleted.'); render(); }); });
    else if (a === 'st-cmp') { var k = b.getAttribute('data-k'), i = S.cmp.indexOf(k); if (i >= 0) S.cmp.splice(i, 1); else if (S.cmp.length >= 4) { U.toast('You can compare up to 4.', true); return; } else S.cmp.push(k); render(); }
    else if (a === 'st-cmp-clear') { S.cmp = []; render(); }
    else if (a === 'st-compare') { S.showCmp = true; render(); window.scrollTo(0, 0); }
    else if (a === 'st-sec') { var id = b.getAttribute('data-s'), h = S.hidden.slice(), j = h.indexOf(id); if (j >= 0) h.splice(j, 1); else h.push(id); S.hidden = h; ST.setPref('strategy.hidden', h); render(); }
    else if (a === 'st-add') { var g = function (x) { return document.getElementById(x).value; }; S.rForm = { date: g('bf-date'), r: g('bf-r'), pnl: g('bf-pnl'), note: g('bf-note') }; var rv = Y.validateResult(S.rForm); if (!rv.ok) { S.rErr = rv.errors; render(); return; } S.rErr = null; var old = (S.tests[s.id] || {}).results || [];
      if (old.length >= Y.MAX_RESULTS) { S.rErr = ['Limit of ' + Y.MAX_RESULTS + ' results reached.']; render(); return; } saveTest(s, old.concat([rv.result])).then(function () { S.rForm = { date: S.rForm.date, r: '', pnl: '', note: '' }; U.toast('Result added.'); render(); }).catch(function () {}); }
    else if (a === 'st-preview') { S.paste = document.getElementById('bp-text').value; S.pasteOut = Y.parseResultsText(S.paste); render(); }
    else if (a === 'st-import') { var po = S.pasteOut; if (!po || !po.results.length) return; var old2 = (S.tests[s.id] || {}).results || []; if (old2.length + po.results.length > Y.MAX_RESULTS) { U.toast('That would pass the ' + Y.MAX_RESULTS + ' result limit.', true); return; } saveTest(s, old2.concat(po.results)).then(function () { S.paste = ''; S.pasteOut = null; U.toast(po.results.length + ' results added.'); render(); }).catch(function () {}); }
    else if (a === 'st-rdel') { var ix = +b.getAttribute('data-i'), cp = ((S.tests[s.id] || {}).results || []).slice(); cp.splice(ix, 1); saveTest(s, cp).then(function () { render(); }).catch(function () {}); }
    else if (a === 'st-rclear') U.confirm('Remove all backtest results?', 'This cannot be undone. Export a backup first if you might want them.', 'REMOVE ALL', true).then(function (y) { if (y) saveTest(s, []).then(render); });
    else if (a === 'st-src') { S.src = b.getAttribute('data-s'); S.mcOut = null; S.swOut = null; render(); }
    else if (a === 'st-mc') { var g2 = function (x) { return document.getElementById(x).value; }; S.mc = { horizon: g2('mc-h'), sims: g2('mc-n'), seed: g2('mc-seed'), dd: g2('mc-dd') }; S.mcOut = Y.monteCarlo(srcResults(s).map(function (x) { return x.r; }), { horizon: S.mc.horizon === '' ? NaN : +S.mc.horizon, sims: S.mc.sims === '' ? NaN : +S.mc.sims, seed: S.mc.seed, ddLimitR: S.mc.dd }); render(); }
    else if (a === 'st-sw') { S.swOut = Y.sweep(srcResults(s), b.getAttribute('data-k')); render(); }
  });
  function refresh() { return load().then(render); }
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'strategy') refresh(); });
  window.addEventListener('tt:journal-changed', function () { if (S.loaded && document.getElementById('view-strategy').classList.contains('active')) refresh(); });
  if (window.TTNav) window.TTNav.addHub({ id: 'strategy', title: 'Strategy lab', text: 'Define strategies, enter backtests, compare, simulate and test settings on your own results.', icon: '<path d="M9 3v6L4 19a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 19l-5-10V3"/><path d="M8 3h8M7 15h10"/>' });
  window.TTStrategyUI = { state: S, reload: refresh };
})();
