/* Tamhas Trading - deterministic insights (pure functions, no DOM, no AI, no network).
   Every insight is a fixed rule applied to YOUR logged trades, with the numbers that triggered it and a sample-size
   label. A rule stays silent when there is not enough data. These are observations about the past, not advice and not
   predictions. */
(function (root) {
  'use strict';
  var C = root.TTJournalCore || (typeof require !== 'undefined' ? require('./journal-core.js') : null);
  var A = root.TTAnalyticsCore || (typeof require !== 'undefined' ? require('./analytics-core.js') : null);
  function $(c, s) { return C.fmtMoney(Math.round(c), !!s); }
  function pct(v) { return (v * 100).toFixed(0) + '%'; }
  function weekStart(date) { var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
  function addDays(date, n) { var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  var MIN = { trades: 10, mistake: 3, heavyDays: 3, weeks: 4, setup: 10, bucket: 10, process: 10 };

  // opts: {plan:{maxTradesPerDay}, today:'YYYY-MM-DD', basis:'net'|'gross'}
  function generate(rows, opts) {
    opts = opts || {}; var out = [], P = A.prepare(rows, {}, opts.basis || 'gross'), inc = P.inc, n = inc.length, today = opts.today || (inc.length ? inc[inc.length - 1].t.date : null);
    var tag = function (id, kind, title, text, ev) { out.push({ id: id, kind: kind, title: title, text: text, n: ev.n, sample: A.sampleLabel(ev.n), evidence: ev.items || [] }); };
    if (!rows.length) return { insights: [], needMore: 'Log some trades and this page fills in.', counted: 0, left: 0 };
    if (n < MIN.trades) return { insights: [], needMore: 'Observations need at least ' + MIN.trades + ' closed trades with a known result. You have ' + n + '.', counted: n, left: rows.length - n };

    // 1. recurring mistakes
    var isNone = function (r) { return r.key.toLowerCase() === 'none recorded'; }, mk = A.breakdown(inc, 'mistake').filter(function (r) { return !isNone(r) && r.n >= MIN.mistake; }).sort(function (a, b) { return b.n - a.n; }), none = A.breakdown(inc, 'mistake').filter(isNone)[0];
    mk.slice(0, 3).forEach(function (r) { tag('mistake-' + r.key, 'pattern', 'Recurring mistake: ' + r.label, 'You tagged “' + r.label + '” on ' + r.n + ' trades, which totalled ' + $(r.totalCents, true) + ' (average ' + $(r.expectancyCents, true) + ' per trade)' + (none && none.n >= 3 ? ', against an average of ' + $(none.expectancyCents, true) + ' on trades with no mistake tag' : '') + '. This shows an association in your data, not proof of cause.', { n: r.n, items: [r.n + ' trades', $(r.totalCents, true)] }); });

    // 2. overtrading
    var byDay = {}; inc.forEach(function (x) { (byDay[x.t.date] = byDay[x.t.date] || []).push(x); }); var days = Object.keys(byDay), counts = days.map(function (d) { return byDay[d].length; });
    var lim = opts.plan && opts.plan.maxTradesPerDay ? opts.plan.maxTradesPerDay : Math.max(4, Math.ceil(median(counts) * 2)), heavy = days.filter(function (d) { return byDay[d].length > lim; }), rest = days.filter(function (d) { return byDay[d].length <= lim; });
    if (heavy.length >= MIN.heavyDays && rest.length >= 3) { var avg = function (ds) { var s = 0; ds.forEach(function (d) { byDay[d].forEach(function (x) { s += x.v; }); }); return s / ds.length; };
      tag('overtrading', 'pattern', 'Busy days', heavy.length + ' of your ' + days.length + ' trading days had more than ' + lim + ' trades' + (opts.plan && opts.plan.maxTradesPerDay ? ' (your plan\'s limit)' : ' (about twice your usual)') + '. Those days averaged ' + $(avg(heavy), true) + ' per day versus ' + $(avg(rest), true) + ' on other days.', { n: heavy.length, items: [heavy.length + ' busy days'] }); }

    // 3. poor period: worst week
    var wk = {}; inc.forEach(function (x) { var w = weekStart(x.t.date); (wk[w] = wk[w] || { from: w, n: 0, c: 0 }); wk[w].n++; wk[w].c += x.v; }); var weeks = Object.keys(wk).map(function (k) { return wk[k]; }).filter(function (w) { return w.n >= 3; });
    if (weeks.length >= MIN.weeks) { var worst = weeks.slice().sort(function (a, b) { return a.c - b.c; })[0]; if (worst.c < 0) tag('worst-week', 'pattern', 'Hardest week', 'The week of ' + worst.from + ' was your weakest: ' + $(worst.c, true) + ' over ' + worst.n + ' trades. Reviewing those trades is a good place to look for what was different.', { n: worst.n, items: [worst.from] }); }

    // 4. consistency
    if (weeks.length >= MIN.weeks) { var pw = weeks.filter(function (w) { return w.c > 0; }).length; tag('consistency', 'summary', 'Consistency', pw + ' of ' + weeks.length + ' weeks with 3+ trades were profitable (' + pct(pw / weeks.length) + ').', { n: weeks.length }); }
    if (days.length >= 10) { var tot = 0, best = -Infinity; days.forEach(function (d) { var s = 0; byDay[d].forEach(function (x) { s += x.v; }); tot += s; if (s > best) best = s; }); if (tot > 0 && best / tot > 0.5) tag('one-day', 'pattern', 'Results rest on one day', 'Your single best day made ' + $(best, false) + ', which is ' + pct(best / tot) + ' of your total profit of ' + $(tot, false) + '. Without it, results look quite different.', { n: days.length }); }

    // 5. setups
    var st = A.breakdown(inc, 'strategy').filter(function (r) { return r.key !== 'no strategy' && r.key !== 'No strategy' && r.rCount >= MIN.setup && r.avgR != null; }).sort(function (a, b) { return b.avgR - a.avgR; });
    if (st.length >= 2) { var b0 = st[0], w0 = st[st.length - 1]; tag('setups', 'pattern', 'Stronger and weaker setups', '“' + b0.label + '” averaged ' + b0.avgR.toFixed(2) + 'R over ' + b0.rCount + ' trades; “' + w0.label + '” averaged ' + w0.avgR.toFixed(2) + 'R over ' + w0.rCount + '. Differences between small samples are often noise, so check the Strategy lab before acting.', { n: Math.min(b0.rCount, w0.rCount) }); }

    // 6. time buckets
    ['weekday', 'session', 'hour'].forEach(function (dim) {
      var g = A.breakdown(inc, dim).filter(function (r) { return r.n >= MIN.bucket && r.expectancyCents < 0 && ['Not set', 'No time'].indexOf(r.key) < 0; }).sort(function (a, b) { return a.totalCents - b.totalCents; })[0];
      if (g) tag('bucket-' + dim, 'review', 'Weaker ' + dim + ': ' + g.label, g.label + ' trades totalled ' + $(g.totalCents, true) + ' over ' + g.n + ' trades (average ' + $(g.expectancyCents, true) + '). ' + (dim === 'hour' ? 'Compare with your other hours' : 'Compare with your other ' + dim + 's') + ' before concluding anything.', { n: g.n });
    });

    // 7. process gaps
    var all = rows.filter(function (r) { return r.c.isClosed; }), nostop = all.filter(function (r) { return r.t.stop == null; }).length, nonote = all.filter(function (r) { return !(r.t.notes || r.t.entryReason || r.t.exitReason || r.t.lessons); }).length;
    if (all.length >= MIN.process && nostop / all.length >= 0.2) tag('no-stop', 'review', 'Trades without a stop', nostop + ' of ' + all.length + ' closed trades (' + pct(nostop / all.length) + ') have no stop recorded, so their R multiple and planned risk are unknown.', { n: all.length });
    if (all.length >= MIN.process && nonote / all.length >= 0.5) tag('no-notes', 'review', 'Few notes', nonote + ' of ' + all.length + ' closed trades (' + pct(nonote / all.length) + ') have no reason, lesson or note, which makes reviewing them harder.', { n: all.length });

    // 8. this week vs last week
    if (today) { var w1 = weekStart(today), w0s = addDays(w1, -7), cur = inc.filter(function (x) { return x.t.date >= w1 && x.t.date <= addDays(w1, 6); }), prev = inc.filter(function (x) { return x.t.date >= w0s && x.t.date < w1; });
      if (cur.length) { var s1 = A.summary(cur), s0 = prev.length ? A.summary(prev) : null; tag('this-week', 'summary', 'This week so far', cur.length + ' closed ' + (cur.length === 1 ? 'trade' : 'trades') + ', ' + $(s1.totalCents, true) + ', win rate ' + pct(s1.winRate) + (s0 ? '. Last week: ' + prev.length + ' trades, ' + $(s0.totalCents, true) + ', win rate ' + pct(s0.winRate) + '.' : '. No closed trades last week to compare.'), { n: cur.length }); } }
    var order = { pattern: 0, review: 1, summary: 2 }; out.sort(function (a, b) { return (order[a.kind] - order[b.kind]); });
    return { insights: out, needMore: null, counted: n, left: rows.length - n, basis: P.basis };
  }
  var api = { MIN: MIN, generate: generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTInsightsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
