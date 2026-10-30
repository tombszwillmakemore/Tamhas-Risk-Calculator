/* Tamhas Trading - Analytics center. Every number comes from the trades you entered (fully closed trades only; the basis
   toggle chooses net or gross). Widgets can be hidden and re-ordered; your layout is saved on this device. */
(function () {
  'use strict';
  var root = document.getElementById('anRoot'); if (!root) return;
  var A = window.TTAnalyticsCore, C = window.TTJournalCore, J2 = window.TTJournal2Core, U = window.TTUI, DB = window.TTDB, ST = window.TTStore, AC = window.TTAccountsCore, INST = window.TTInstruments;
  var esc = U.esc, m = function (c, plus) { return c == null ? '—' : C.fmtMoney(c, plus); };
  var TITLES = { summary: 'Summary', equity: 'Equity curve', drawdown: 'Drawdown', distribution: 'Distribution', breakdown: 'Breakdowns', heatmap: 'Weekday × hour heatmap', rolling: 'Rolling statistics', monthly: 'Monthly results', streaks: 'Streaks' };
  var S = { loaded: false, err: null, rows: [], accounts: [], names: {}, range: 'all', f: {}, basis: null, dim: 'hour', roll: 20, rollMetric: 'expectancyCents', layout: A.cleanLayout(null), custom: false, tabRefresh: 0 };

  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), DB.getAll('accounts'), ST.list('dashboard')]); }).then(function (r) {
      var ok = []; r[0].forEach(function (raw) { var n = C.normalizeTrade(raw); if (n.ok) ok.push(n.trade); });
      S.rows = C.analyze(ok); S.accounts = r[1].map(AC.normalizeAccount); S.names = {}; S.accounts.forEach(function (a) { S.names[a.id] = a.name; });
      var d = r[2].filter(function (x) { return x.id === 'dash-analytics'; })[0]; S.layout = A.cleanLayout(d && d.layout); S.loaded = true; S.err = null;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function filterObj() {
    var f = Object.assign({}, S.f), t = today();
    if (S.range === '30d' || S.range === '90d') { f.from = J2.addDays(t, S.range === '30d' ? -29 : -89); f.to = t; }
    else if (S.range === 'ytd') { f.from = t.slice(0, 4) + '-01-01'; f.to = t; }
    else if (S.range === 'all') { delete f.from; delete f.to; }
    return f;
  }
  function basis() {
    if (S.basis) return S.basis;
    return S.rows.some(function (r) { return r.c.isClosed && !r.c.feesMissing; }) ? 'net' : 'gross';
  }
  function distinct(fn) { var s = {}; S.rows.forEach(function (r) { var v = fn(r.t); if (v) s[v.toLowerCase()] = s[v.toLowerCase()] || v; }); return Object.keys(s).sort().map(function (k) { return s[k]; }); }

  function filtersHtml(b) {
    function sel(k, label, opts) { return '<div class="field"><label for="af-' + k + '">' + label + '</label><select id="af-' + k + '" data-af="' + k + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + ((S.f[k] || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>'; }
    var h = '<div class="panel"><div class="ui-row an-top"><div class="seg" role="radiogroup" aria-label="P&L basis">' + [['net', 'NET'], ['gross', 'GROSS']].map(function (x) { return '<label class="seg-i"><input type="radio" name="an-basis" value="' + x[0] + '"' + (b === x[0] ? ' checked' : '') + '><span>' + x[1] + '</span></label>'; }).join('') + '</div>' +
      '<button type="button" class="chip" data-act="an-custom">CUSTOMIZE</button></div>' +
      '<div class="chips" style="margin:12px 0 4px">' + [['all', 'ALL TIME'], ['30d', '30 DAYS'], ['90d', '90 DAYS'], ['ytd', 'YEAR TO DATE'], ['custom', 'CUSTOM']].map(function (r) { return '<button type="button" class="chip' + (S.range === r[0] ? ' on' : '') + '" data-act="an-range" data-r="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>';
    if (S.range === 'custom') h += '<div class="fgrid"><div class="field"><label for="af-from">From</label><input id="af-from" type="date" data-af="from" value="' + esc(S.f.from || '') + '"></div><div class="field"><label for="af-to">To</label><input id="af-to" type="date" data-af="to" value="' + esc(S.f.to || '') + '"></div></div>';
    h += '<details class="io"' + (Object.keys(S.f).some(function (k) { return k !== 'from' && k !== 'to'; }) ? ' open' : '') + '><summary>More filters</summary><div class="fgrid">' +
      (S.accounts.length > 1 ? sel('account', 'Account', [['', 'All']].concat(S.accounts.map(function (a) { return [a.id, a.name]; }))) : '') +
      sel('contract', 'Contract', [['', 'All']].concat(INST.list.map(function (i) { return [i.id, i.id]; }))) + sel('session', 'Session', [['', 'All']].concat(C.SESSIONS.map(function (s) { return [s, s]; }))) +
      sel('side', 'Direction', [['', 'All'], ['long', 'Long'], ['short', 'Short']]) + sel('strategy', 'Strategy', [['', 'All']].concat(distinct(function (t) { return t.strategy; }).map(function (x) { return [x, x]; }))) +
      sel('tag', 'Tag', [['', 'All']].concat(allLabels('tags').map(function (x) { return [x, x]; }))) +
      sel('grade', 'Grade', [['', 'All']].concat(C.GRADES.map(function (g) { return [g, g]; }))) + '</div></details></div>';
    return h;
  }
  function allLabels(field) { var s = {}; S.rows.forEach(function (r) { (r.t[field] || []).forEach(function (x) { s[x.toLowerCase()] = s[x.toLowerCase()] || x; }); }); return Object.keys(s).sort().map(function (k) { return s[k]; }); }

  function xLabels(pts) { if (!pts.length) return []; var idx = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter(function (v, i, a) { return a.indexOf(v) === i; }); return idx.map(function (i) { return { x: pts[i].x, label: pts[i].date.slice(2) }; }); }

  var W = {
    summary: function (P, s) {
      var h = '<div class="ui-grid">' + U.stat('P&L (' + P.basis + ')', m(s.totalCents, true), U.plural(s.n, 'trade'), s.totalCents > 0 ? 'pos' : s.totalCents < 0 ? 'neg' : '', P.basis === 'net' ? 'After fees. Only closed trades with fees entered count.' : 'Before fees. Every closed trade counts.') +
        U.stat('Win rate', U.fmtPct(s.winRate), s.wins + 'W · ' + s.losses + 'L' + (s.breakeven ? ' · ' + s.breakeven + 'BE' : ''), '', '95% range ' + U.fmtPct(s.winCI.lo, 0) + ' to ' + U.fmtPct(s.winCI.hi, 0) + ' given only ' + s.n + ' trades. It shows sampling uncertainty, not a forecast.') +
        U.stat('Profit factor', s.profitFactor == null ? '—' : s.profitFactor.toFixed(2), s.profitFactor == null ? s.profitFactorNote : 'gross profit ÷ gross loss') +
        U.stat('Expectancy', m(s.expectancyCents, true), 'average per trade', s.expectancyCents > 0 ? 'pos' : s.expectancyCents < 0 ? 'neg' : '') + U.stat('Average winner', m(s.avgWinCents, true), s.wins ? U.plural(s.wins, 'winner') : 'none', s.avgWinCents ? 'pos' : '') + U.stat('Average loser', m(s.avgLossCents, true), s.losses ? U.plural(s.losses, 'loser') : 'none', s.avgLossCents ? 'neg' : '') +
        U.stat('Payoff ratio', s.payoff == null ? '—' : s.payoff.toFixed(2), 'avg winner ÷ avg loser') + U.stat('Average R', s.avgR == null ? '—' : (s.avgR > 0 ? '+' : '') + s.avgR.toFixed(2) + 'R', s.rCount ? s.rCount + ' trades with a stop' : 'needs stops entered') +
        U.stat('Best / worst', m(s.bestCents, true), 'worst ' + m(s.worstCents, true)) + '</div>';
      return h + '<p class="note">' + esc(s.sample.charAt(0).toUpperCase() + s.sample.slice(1)) + ' (' + s.n + ' trades): the fewer trades, the less weight any percentage deserves.</p>';
    },
    equity: function (P, s, eq) {
      var pts = eq.curve.map(function (p) { return { x: p.i, y: p.cents / 100, date: p.date, tip: p.date + ' · cumulative ' + m(p.cents, true) }; });
      return U.lineChart({ series: [{ name: 'Cumulative P&L', cls: 'c1', pts: pts, area: true }], xLabels: xLabels(pts), baseline: 0, yFormat: function (v) { return U.fmtMoneyShort(v * 100); }, alt: 'Cumulative profit and loss after each trade' }) + '<p class="note">Each point is one closed trade, in date and time order. Trades with no entry time sort first within their day.</p>';
    },
    drawdown: function (P, s, eq) {
      var pts = eq.drawdown.map(function (p) { return { x: p.i, y: p.cents / 100, date: p.date, tip: p.date + ' · ' + m(p.cents) + ' below peak' }; });
      return U.lineChart({ series: [{ name: 'Drawdown', cls: 'c4', pts: pts, area: true, step: true }], xLabels: xLabels(pts), baseline: 0, yFormat: function (v) { return U.fmtMoneyShort(v * 100); }, alt: 'Drawdown from the running peak after each trade' }) +
        '<p class="note">Max drawdown <b>' + m(eq.maxDrawdownCents) + '</b>' + (eq.ddTo ? ' (' + (eq.ddFrom ? esc(eq.ddFrom) : 'start') + ' → ' + esc(eq.ddTo) + ')' : '') + ' · now <b>' + m(Math.abs(eq.currentDrawdownCents)) + '</b> below peak. Measured on your closed-trade P&amp;L; account balances and prop-firm drawdown rules are in Accounts.</p>';
    },
    distribution: function (P, s) {
      var H = A.histogram(P.inc.map(function (x) { return x.v / 100; }), 12), h = '';
      function bars(H, fmt, alt) { return U.barChart({ bars: H.bins.map(function (b) { return { label: fmt(b.from), value: b.n, cls: b.to <= 0 || b.from < 0 ? 'neg' : 'pos', tip: fmt(b.from) + (b.single ? '' : ' to ' + fmt(b.to)) + ': ' + b.n + ' trades' }; }), yFormat: function (v) { return String(Math.round(v)); }, alt: alt }); }
      h += '<h3 class="sub">P&amp;L per trade ($)</h3>' + bars(H, function (v) { return (v < 0 ? '-' : '') + '$' + Math.abs(v); }, 'Histogram of profit and loss per trade');
      var rs = P.inc.filter(function (x) { return x.c.rMultiple != null; }).map(function (x) { return x.c.rMultiple; });
      if (rs.length >= 2) { var HR = A.histogram(rs, 10); h += '<h3 class="sub">R multiples (' + rs.length + ' trades with a stop)</h3>' + bars(HR, function (v) { return (v > 0 ? '+' : '') + v + 'R'; }, 'Histogram of R multiples'); }
      return h;
    },
    breakdown: function (P) {
      var dims = A.dimensions(), rowsB = A.breakdown(P.inc, S.dim, S.names);
      var h = '<div class="chips an-dims">' + dims.map(function (d) { return '<button type="button" class="chip' + (S.dim === d.id ? ' on' : '') + '" data-act="an-dim" data-d="' + d.id + '">' + esc(d.label.toUpperCase()) + '</button>'; }).join('') + '</div>';
      if (!rowsB.length) return h + '<p class="note">Nothing to show.</p>';
      h += U.barChart({ bars: rowsB.slice(0, 24).map(function (r) { return { label: r.label.slice(0, 8), value: r.totalCents / 100, tip: r.label + ': ' + m(r.totalCents, true) + ' (' + r.n + ' trades)' }; }), yFormat: function (v) { return U.fmtMoneyShort(v * 100); }, alt: 'Total P&L by ' + S.dim, tall: rowsB.length > 6 });
      h += '<div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>' + esc(dims.filter(function (d) { return d.id === S.dim; })[0].label) + '</th><th>Trades</th><th>Win %</th><th>Total</th><th>Avg</th><th>PF</th><th>Avg R</th></tr></thead><tbody>' + rowsB.map(function (r) {
        return '<tr><td style="text-align:left">' + esc(r.label) + (r.n < 10 ? ' <small class="note">small sample</small>' : '') + '</td><td>' + r.n + '</td><td>' + U.fmtPct(r.winRate, 0) + '</td><td class="' + U.cls(r.totalCents) + '">' + m(r.totalCents, true) + '</td><td class="' + U.cls(r.expectancyCents) + '">' + m(Math.round(r.expectancyCents), true) + '</td><td>' + (r.profitFactor == null ? '—' : r.profitFactor.toFixed(2)) + '</td><td>' + (r.avgR == null ? '—' : r.avgR.toFixed(2)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      if (dims.filter(function (d) { return d.id === S.dim; })[0].multi) h += '<p class="note">A trade with several labels is counted under each of them, so rows add up to more than your total.</p>';
      return h + '<p class="note">Groups with fewer than 10 trades are marked. Do not read much into them.</p>';
    },
    heatmap: function (P) {
      var hm = A.heatmap(P.inc); if (!hm.used) return '<p class="note">Needs trades with an entry time. Add the time in the trade form to see this.</p>';
      return U.heatmap({ rows: hm.days, cols: hm.hours.map(function (h) { return h; }), alt: 'Total P&L by weekday and entry hour', cell: function (r, c) { var k = hm.cell(r, hm.hours[c]); return k ? { v: k.cents, n: k.n, tip: hm.days[r] + ' ' + hm.hours[c] + ':00 · ' + m(k.cents, true) + ' (' + k.n + ' trades)', label: String(k.n) } : null; } }) +
        '<p class="note">Uses entry time. ' + (hm.noTime ? U.plural(hm.noTime, 'trade') + ' without an entry time ' + (hm.noTime === 1 ? 'is' : 'are') + ' not shown here. ' : '') + 'Number = trades in that cell; colour = total P&amp;L.</p>';
    },
    rolling: function (P) {
      var ro = A.rolling(P.inc, S.roll), metrics = [['expectancyCents', 'EXPECTANCY'], ['winRate', 'WIN RATE'], ['profitFactor', 'PROFIT FACTOR'], ['avgR', 'AVG R']];
      var h = '<div class="ui-row an-top"><div class="chips">' + metrics.map(function (x) { return '<button type="button" class="chip' + (S.rollMetric === x[0] ? ' on' : '') + '" data-act="an-rm" data-m="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<select id="an-roll" aria-label="Window size">' + [10, 20, 50, 100].map(function (n) { return '<option value="' + n + '"' + (S.roll === n ? ' selected' : '') + '>Last ' + n + ' trades</option>'; }).join('') + '</select></div>';
      if (!ro.points.length) return h + '<p class="note">Needs at least ' + ro.window + ' trades for this window (you have ' + P.inc.length + ').</p>';
      var fmt = S.rollMetric === 'expectancyCents' ? function (v) { return m(v, true); } : S.rollMetric === 'winRate' ? function (v) { return U.fmtPct(v, 0); } : function (v) { return v.toFixed(2); };
      var pts = ro.points.filter(function (p) { return p[S.rollMetric] != null; }).map(function (p) { var y = S.rollMetric === 'expectancyCents' ? p.expectancyCents / 100 : S.rollMetric === 'winRate' ? p.winRate * 100 : p[S.rollMetric]; return { x: p.i, y: y, date: p.date, tip: p.date + ' · ' + fmt(p[S.rollMetric]) }; });
      if (!pts.length) return h + '<p class="note">This metric is not defined in any window yet (for example profit factor needs a losing trade).</p>';
      return h + U.lineChart({ series: [{ name: 'Rolling', cls: 'c2', pts: pts }], xLabels: xLabels(pts), baseline: S.rollMetric === 'winRate' ? null : 0, yFormat: function (v) { return S.rollMetric === 'expectancyCents' ? U.fmtMoneyShort(v * 100) : S.rollMetric === 'winRate' ? v.toFixed(0) + '%' : v.toFixed(1); }, alt: 'Rolling statistic over the last ' + ro.window + ' trades' }) +
        '<p class="note">Each point uses only the previous ' + ro.window + ' trades up to that trade.</p>';
    },
    monthly: function (P) {
      var mo = A.byMonth(P.inc); return U.barChart({ bars: mo.map(function (x) { return { label: x.month.slice(2), value: x.cents / 100, tip: x.month + ': ' + m(x.cents, true) + ' (' + x.n + ' trades)' }; }), yFormat: function (v) { return U.fmtMoneyShort(v * 100); }, alt: 'Total P&L by month' }) +
        '<div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Month</th><th>Trades</th><th>P&amp;L</th></tr></thead><tbody>' + mo.slice().reverse().map(function (x) { return '<tr><td style="text-align:left">' + esc(x.month) + '</td><td>' + x.n + '</td><td class="' + U.cls(x.cents) + '">' + m(x.cents, true) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    },
    streaks: function (P, s) {
      return '<div class="ui-grid">' + U.stat('Longest win streak', String(s.maxWinStreak), 'trades in a row', 'pos') + U.stat('Longest loss streak', String(s.maxLossStreak), 'trades in a row', 'neg') +
        U.stat('Current', s.currentStreak ? s.currentStreak.n + ' ' + s.currentStreak.type + (s.currentStreak.n === 1 ? '' : 's') : '—', s.currentStreak ? 'in a row' : 'last trade was breakeven') + '</div>';
    }
  };

  function customHtml() {
    return '<div class="panel"><h2>Customize dashboard</h2><p class="note" style="margin-top:0">Show, hide and re-order the sections. Saved on this device.</p><ul class="ui-list">' + S.layout.map(function (w, i) {
      return '<li><label class="ui-chk" style="flex:1"><input type="checkbox" data-wid="' + w.id + '"' + (w.on ? ' checked' : '') + '><span>' + esc(TITLES[w.id]) + '</span></label><span><button type="button" class="chip" data-act="an-up" data-i="' + i + '" aria-label="Move up"' + (i ? '' : ' disabled') + '>↑</button> <button type="button" class="chip" data-act="an-down" data-i="' + i + '" aria-label="Move down"' + (i < S.layout.length - 1 ? '' : ' disabled') + '>↓</button></span></li>'; }).join('') + '</ul>' +
      '<div class="ui-row"><button type="button" class="btn" data-act="an-custom">DONE</button><button type="button" class="btn ghost" data-act="an-reset">RESET</button></div></div>';
  }
  function saveLayout() { return ST.save({ id: 'dash-analytics', kind: 'dashboard', layout: S.layout }).catch(function () { U.toast('Could not save your layout.', true); }); }

  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; }
    if (S.err) { root.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    var b = basis(), P = A.prepare(S.rows, filterObj(), b), h = filtersHtml(b);
    if (S.custom) h += customHtml();
    if (!S.rows.length) { root.innerHTML = h + U.empty('No trades yet', 'Log trades in the Journal (or import a CSV) and your analytics appear here. Everything is calculated from your own trades.'); return; }
    if (b === 'net' && P.excludedNoFees) h += '<div class="ui-banner warn">' + U.plural(P.excludedNoFees, 'closed trade') + ' ' + (P.excludedNoFees === 1 ? 'has' : 'have') + ' no fees entered, so ' + (P.excludedNoFees === 1 ? 'it is' : 'they are') + ' left out of net figures (not counted as $0 fees). Switch to GROSS to include ' + (P.excludedNoFees === 1 ? 'it' : 'them') + '.</div>';
    if (P.open) h += '<div class="ui-banner">' + U.plural(P.open, 'open or partly closed trade') + ' not counted until fully exited.</div>';
    if (!P.inc.length) { root.innerHTML = h + U.empty('Nothing to analyze in this view', 'No fully closed trades match these filters and this basis. Widen the date range or clear filters.'); return; }
    var s = A.summary(P.inc), eq = A.equity(P.inc);
    S.layout.forEach(function (w) { if (!w.on) return; h += '<div class="panel an-w" data-w="' + w.id + '"><h2>' + esc(TITLES[w.id]) + '</h2>' + W[w.id](P, s, eq) + '</div>'; });
    var y = window.scrollY; root.innerHTML = h; window.scrollTo(0, y);
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'an-range') { S.range = b.getAttribute('data-r'); if (S.range !== 'custom') { delete S.f.from; delete S.f.to; } render(); }
    else if (a === 'an-dim') { S.dim = b.getAttribute('data-d'); render(); }
    else if (a === 'an-rm') { S.rollMetric = b.getAttribute('data-m'); render(); }
    else if (a === 'an-custom') { S.custom = !S.custom; render(); }
    else if (a === 'an-up' || a === 'an-down') { var i = +b.getAttribute('data-i'), j = a === 'an-up' ? i - 1 : i + 1; if (S.layout[j]) { var t = S.layout[i]; S.layout[i] = S.layout[j]; S.layout[j] = t; saveLayout(); render(); } }
    else if (a === 'an-reset') { S.layout = A.cleanLayout(null); saveLayout(); render(); }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'an-basis') { S.basis = t.value; render(); }
    else if (t.getAttribute('data-af')) { var k = t.getAttribute('data-af'); if (t.value) S.f[k] = t.value; else delete S.f[k]; render(); }
    else if (t.id === 'an-roll') { S.roll = +t.value; render(); }
    else if (t.getAttribute('data-wid')) { S.layout.forEach(function (w) { if (w.id === t.getAttribute('data-wid')) w.on = t.checked; }); saveLayout(); render(); }
  });
  function refresh() { return load().then(render); }
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'analytics') refresh(); });
  window.addEventListener('tt:journal-changed', function () { if (S.loaded && document.getElementById('view-analytics').classList.contains('active')) refresh(); });
  if (window.TTNav) window.TTNav.addHub({ id: 'analytics', title: 'Analytics', text: 'Equity, drawdown, breakdowns by hour, weekday, strategy and more.', icon: '<path d="M4 19V5M4 19h16"/><path d="M8 15l4-5 3 3 4-6"/>' });
  window.TTAnalyticsUI = { state: S, reload: refresh };
})();
