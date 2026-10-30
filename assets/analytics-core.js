/* Tamhas Trading - analytics engine (pure functions, no DOM). Everything is computed from the trades you entered.
   Only fully closed trades with a known P&L under the chosen basis are counted ('net' = after fees, needs fees entered;
   'gross' = before fees). Anything left out is counted and reported. Unknown stays null, never 0. */
(function (root) {
  'use strict';
  var C = root.TTJournalCore || (typeof require !== 'undefined' ? require('./journal-core.js') : null);
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function ord(a, b) { return (a.t.date + (a.t.time || '00:00')).localeCompare(b.t.date + (b.t.time || '00:00')) || (a.t.createdAt - b.t.createdAt) || (a.t.id < b.t.id ? -1 : 1); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function weekday(date) { var p = date.split('-'); return (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7; }   // 0 = Monday

  /* Select the trades to analyze. f is a journal filter object (date range, contract, account, strategy, tag, ...). */
  function prepare(rows, f, basis) {
    basis = basis === 'gross' ? 'gross' : 'net';
    var sel = C.filterRows(rows, f || {}), closed = sel.filter(function (r) { return r.c.isClosed; });
    var inc = closed.filter(function (r) { return (basis === 'net' ? r.c.netCents : r.c.grossCents) != null; }).sort(ord)
      .map(function (r) { return { t: r.t, c: r.c, v: basis === 'net' ? r.c.netCents : r.c.grossCents }; });
    return { basis: basis, inc: inc, selected: sel.length, closed: closed.length, open: sel.length - closed.length, excludedNoFees: basis === 'net' ? closed.length - inc.length : 0 };
  }

  /* Wilson 95% interval for a proportion (e.g. win rate). Describes sampling uncertainty only; it is not a prediction. */
  function wilson(k, n) {
    if (!n) return null; var z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
  }
  // Plain-language sample size label. A guide for how much weight to give a statistic, not a statistical guarantee.
  function sampleLabel(n) { return n < 10 ? 'very small sample' : n < 30 ? 'small sample' : n < 100 ? 'moderate sample' : 'larger sample'; }

  function summary(inc) {
    var n = inc.length; if (!n) return { n: 0 };
    var wins = inc.filter(function (x) { return x.v > 0; }), losses = inc.filter(function (x) { return x.v < 0; });
    var gp = sum(wins.map(function (x) { return x.v; })), gl = sum(losses.map(function (x) { return x.v; })), total = gp + gl;
    var withR = inc.filter(function (x) { return x.c.rMultiple != null; }), rs = withR.map(function (x) { return x.c.rMultiple; });
    var avgWin = wins.length ? gp / wins.length : null, avgLoss = losses.length ? gl / losses.length : null;
    var mw = 0, ml = 0, cw = 0, cl = 0;
    inc.forEach(function (x) { if (x.v > 0) { cw++; cl = 0; } else if (x.v < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; } if (cw > mw) mw = cw; if (cl > ml) ml = cl; });
    var cur = cw ? { type: 'win', n: cw } : cl ? { type: 'loss', n: cl } : null;
    return { n: n, wins: wins.length, losses: losses.length, breakeven: n - wins.length - losses.length, winRate: wins.length / n, winCI: wilson(wins.length, n),
      totalCents: total, expectancyCents: total / n, avgWinCents: avgWin, avgLossCents: avgLoss, grossProfitCents: gp, grossLossCents: gl,
      payoff: avgWin != null && avgLoss != null ? avgWin / Math.abs(avgLoss) : null,
      profitFactor: losses.length ? gp / Math.abs(gl) : null, profitFactorNote: !losses.length ? (wins.length ? 'no losing trades yet' : 'no winners or losers') : '',
      bestCents: Math.max.apply(null, inc.map(function (x) { return x.v; })), worstCents: Math.min.apply(null, inc.map(function (x) { return x.v; })),
      rCount: rs.length, avgR: rs.length ? sum(rs) / rs.length : null, totalR: rs.length ? sum(rs) : null,
      maxWinStreak: mw, maxLossStreak: ml, currentStreak: cur, sample: sampleLabel(n) };
  }

  /* Cumulative P&L and drawdown from the running peak. The peak starts at 0 (before the first trade). No percentages are
     given because the starting balance is not known to this engine. */
  function equity(inc) {
    var eq = 0, peak = 0, peakI = -1, maxDd = 0, ddFrom = null, ddTo = null, curve = [], dd = [];
    inc.forEach(function (x, i) {
      eq += x.v; curve.push({ i: i, date: x.t.date, id: x.t.id, cents: eq });
      if (eq > peak) { peak = eq; peakI = i; }
      var d = eq - peak; dd.push({ i: i, date: x.t.date, id: x.t.id, cents: d });
      if (-d > maxDd) { maxDd = -d; ddFrom = peakI < 0 ? null : inc[peakI].t.date; ddTo = x.t.date; }
    });
    return { curve: curve, drawdown: dd, maxDrawdownCents: inc.length ? maxDd : null, ddFrom: ddFrom, ddTo: ddTo, currentDrawdownCents: dd.length ? dd[dd.length - 1].cents : null, peakCents: inc.length ? peak : null };
  }

  /* Histogram with "nice" bin widths. values are plain numbers; returns bins [{from,to,n}] covering min..max. */
  function niceStep(range, target) {
    var raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  function histogram(values, target) {
    if (!values.length) return { bins: [], step: null };
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (lo === hi) return { bins: [{ from: lo, to: lo, n: values.length, single: true }], step: 0 };
    var step = niceStep(hi - lo, target || 12), start = Math.floor(lo / step) * step, bins = [];
    for (var s = start; s <= hi + 1e-9; s += step) bins.push({ from: Math.round(s * 1e6) / 1e6, to: Math.round((s + step) * 1e6) / 1e6, n: 0 });
    values.forEach(function (v) { var i = Math.min(bins.length - 1, Math.floor((v - start) / step + 1e-9)); bins[i].n++; });
    return { bins: bins, step: step };
  }

  /* Grouped statistics. keys(x) returns an array of group keys (a trade can sit in several groups, e.g. tags). */
  function group(inc, keys, order) {
    var g = {};
    inc.forEach(function (x) { (keys(x) || []).forEach(function (k) { (g[k] = g[k] || []).push(x); }); });
    var out = Object.keys(g).map(function (k) { var s = summary(g[k]); return { key: k, n: s.n, wins: s.wins, losses: s.losses, winRate: s.winRate, totalCents: s.totalCents, expectancyCents: s.expectancyCents, profitFactor: s.profitFactor, avgR: s.avgR, rCount: s.rCount, sample: s.sample }; });
    var UNS = ['Not set', 'No time', 'No strategy', 'Not recorded', 'No tags', 'Not graded'];
    out.sort(function (a, b) {
      var ua = UNS.indexOf(a.key) >= 0, ub = UNS.indexOf(b.key) >= 0; if (ua !== ub) return ua ? 1 : -1;
      if (order) { var ia = order.indexOf(a.key), ib = order.indexOf(b.key); if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }
      return b.totalCents - a.totalCents || (a.key < b.key ? -1 : 1);
    });
    return out;
  }
  function hourOf(x) { return x.t.time ? x.t.time.slice(0, 2) : null; }
  var DIMS = {
    hour: { label: 'Hour', keys: function (x) { var h = hourOf(x); return [h == null ? 'No time' : h + ':00']; }, order: (function () { var a = []; for (var h = 0; h < 24; h++) a.push((h < 10 ? '0' : '') + h + ':00'); return a; })() },
    weekday: { label: 'Weekday', keys: function (x) { return [DAYS[weekday(x.t.date)]]; }, order: DAYS },
    session: { label: 'Session', keys: function (x) { return [x.t.session || 'Not set']; }, order: C.SESSIONS },
    strategy: { label: 'Strategy', keys: function (x) { return [x.t.strategy ? x.t.strategy.toLowerCase() === x.t.strategy ? x.t.strategy : x.t.strategy : 'No strategy']; } },
    instrument: { label: 'Instrument', keys: function (x) { return [x.t.contract]; } },
    account: { label: 'Account', keys: function (x) { return [x.t.accountId || 'acct-default']; } },
    side: { label: 'Direction', keys: function (x) { return [x.t.side === 'long' ? 'Long' : 'Short']; } },
    tag: { label: 'Tag', multi: true, keys: function (x) { return x.t.tags && x.t.tags.length ? x.t.tags : ['No tags']; } },
    emotion: { label: 'Emotion', multi: true, keys: function (x) { return x.t.emotions && x.t.emotions.length ? x.t.emotions : ['Not recorded']; } },
    mistake: { label: 'Mistake', multi: true, keys: function (x) { return x.t.mistakeTags && x.t.mistakeTags.length ? x.t.mistakeTags : ['None recorded']; } },
    grade: { label: 'Grade', keys: function (x) { return [x.t.grade || 'Not graded']; }, order: ['A', 'B', 'C', 'D', 'F'] }
  };
  // Strategy names match regardless of case, like the journal filter: group on the lower-cased name, show the first spelling seen.
  function breakdown(inc, dim, names) {
    var d = DIMS[dim]; if (!d) return [];
    var keys = d.keys, firstSpelling = {};
    if (dim === 'strategy') { inc.forEach(function (x) { if (x.t.strategy) { var l = x.t.strategy.toLowerCase(); if (!firstSpelling[l]) firstSpelling[l] = x.t.strategy; } }); keys = function (x) { return [x.t.strategy ? x.t.strategy.toLowerCase() : 'No strategy']; }; }
    if (dim === 'tag' || dim === 'emotion' || dim === 'mistake') {
      var field = dim === 'tag' ? 'tags' : dim === 'emotion' ? 'emotions' : 'mistakeTags', none = dim === 'tag' ? 'No tags' : dim === 'emotion' ? 'Not recorded' : 'None recorded';
      inc.forEach(function (x) { (x.t[field] || []).forEach(function (l) { var k = l.toLowerCase(); if (!firstSpelling[k]) firstSpelling[k] = l; }); });
      keys = function (x) { var a = x.t[field]; return a && a.length ? a.map(function (l) { return l.toLowerCase(); }) : [none]; };
    }
    var out = group(inc, keys, d.order);
    out.forEach(function (r) { r.id = r.key; r.label = firstSpelling[r.key] || (dim === 'account' && names && names[r.key]) || r.key; });
    return out;
  }
  function dimensions() { return Object.keys(DIMS).map(function (k) { return { id: k, label: DIMS[k].label, multi: !!DIMS[k].multi }; }); }

  /* Weekday x hour heatmap (entry time). Trades with no entry time are counted separately, not placed in a cell. */
  function heatmap(inc) {
    var cells = {}, noTime = 0, hours = {};
    inc.forEach(function (x) {
      var h = hourOf(x); if (h == null) { noTime++; return; }
      var k = weekday(x.t.date) + '|' + h; (cells[k] = cells[k] || { n: 0, cents: 0 }); cells[k].n++; cells[k].cents += x.v; hours[h] = 1;
    });
    var hs = Object.keys(hours).sort();
    return { hours: hs, days: DAYS, cell: function (d, h) { return cells[d + '|' + h] || null; }, noTime: noTime, used: inc.length - noTime };
  }

  /* Rolling statistics over the last N trades. Points exist only once N trades have happened. */
  function rolling(inc, N) {
    N = Math.max(2, Math.min(200, N | 0 || 20)); var out = [];
    for (var i = N - 1; i < inc.length; i++) {
      var w = inc.slice(i - N + 1, i + 1), s = summary(w);
      out.push({ i: i, date: inc[i].t.date, winRate: s.winRate, expectancyCents: s.expectancyCents, profitFactor: s.profitFactor, avgR: s.avgR, totalCents: s.totalCents });
    }
    return { window: N, points: out };
  }

  function byDay(inc) { var m = {}; inc.forEach(function (x) { m[x.t.date] = (m[x.t.date] || 0) + x.v; }); return Object.keys(m).sort().map(function (d) { return { date: d, cents: m[d] }; }); }
  function byMonth(inc) { var m = {}; inc.forEach(function (x) { var k = x.t.date.slice(0, 7); (m[k] = m[k] || { n: 0, cents: 0 }); m[k].n++; m[k].cents += x.v; }); return Object.keys(m).sort().map(function (k) { return { month: k, n: m[k].n, cents: m[k].cents }; }); }

  /* Dashboard layout: validates a saved layout against the known widget ids (unknown ids dropped, missing ones appended). */
  var WIDGETS = ['summary', 'equity', 'drawdown', 'distribution', 'breakdown', 'heatmap', 'rolling', 'monthly', 'streaks'];
  function cleanLayout(saved) {
    var out = [], seen = {};
    (Array.isArray(saved) ? saved : []).forEach(function (w) { if (w && WIDGETS.indexOf(w.id) >= 0 && !seen[w.id]) { seen[w.id] = 1; out.push({ id: w.id, on: w.on !== false }); } });
    WIDGETS.forEach(function (id) { if (!seen[id]) out.push({ id: id, on: true }); });
    return out;
  }

  var api = { DAYS: DAYS, WIDGETS: WIDGETS, prepare: prepare, summary: summary, equity: equity, histogram: histogram, group: group, breakdown: breakdown, dimensions: dimensions, heatmap: heatmap, rolling: rolling, byDay: byDay, byMonth: byMonth, wilson: wilson, sampleLabel: sampleLabel, cleanLayout: cleanLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTAnalyticsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
