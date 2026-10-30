/* Tamhas Trading - strategy lab logic (pure functions, no DOM). Strategies, manual backtests, journal-based results,
   comparisons, Monte Carlo resampling and parameter sweeps. Everything is computed ONLY from results you entered or
   trades you journaled. Nothing is fetched or invented. Resampling and sweeps describe your own past results; they are
   not forecasts and cannot promise future performance. */
(function (root) {
  'use strict';
  var C = root.TTJournalCore || (typeof require !== 'undefined' ? require('./journal-core.js') : null);
  var A = root.TTAnalyticsCore || (typeof require !== 'undefined' ? require('./analytics-core.js') : null);
  var K = root.TTRiskCore || (typeof require !== 'undefined' ? require('./risk-core.js') : null);
  function str(v) { return v == null ? '' : String(v); }
  function clip(v, n) { return str(v).replace(/\r\n?/g, '\n').trim().slice(0, n); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  var STATUSES = ['idea', 'testing', 'live', 'retired'], MAX_RESULTS = 5000, MIN_MC = 20;

  /* ---------- strategies ---------- */
  function lines(text, maxN) { var seen = {}, out = []; str(text).split('\n').forEach(function (l) { var t = clip(l.replace(/^\s*[-*•]\s*/, ''), 200); if (t && !seen[t.toLowerCase()] && out.length < (maxN || 20)) { seen[t.toLowerCase()] = 1; out.push(t); } }); return out; }
  function validateStrategy(raw) {
    var e = [], name = clip(raw.name, 60); if (!name) e.push('Give the strategy a name.');
    var status = STATUSES.indexOf(raw.status) >= 0 ? raw.status : 'idea';
    if (raw.status && STATUSES.indexOf(raw.status) < 0) e.push('Pick a status.');
    if (e.length) return { ok: false, errors: e };
    return { ok: true, strategy: { name: name, status: status, markets: clip(raw.markets, 120), timeframe: clip(raw.timeframe, 60), description: clip(raw.description, 1000),
      entryRules: lines(raw.entryText), exitRules: lines(raw.exitText), riskRules: lines(raw.riskText), filters: lines(raw.filtersText), notes: clip(raw.notes, 1000) } };
  }

  /* ---------- manual backtest results ---------- */
  // One result: date (YYYY-MM-DD), r (R multiple, a plain number), optional pnl (dollars), optional note.
  function validateResult(raw) {
    var e = [], date = str(raw.date).trim(); if (!isDate(date)) e.push('Date must be YYYY-MM-DD.');
    var rs = str(raw.r).trim(), r = Number(rs); if (rs === '' || !isFinite(r)) e.push('R must be a number, for example 2 or -1.'); else if (Math.abs(r) > 100) e.push('R must be between -100 and 100.');
    var pnl = null; if (str(raw.pnl).trim() !== '') { var s = str(raw.pnl).replace(/[$,\s]/g, ''), neg = /^-/.test(s); var m = K.parseMoney(s.replace(/^-/, '')); if (m == null || isNaN(m) || m > 1e10) e.push('Dollar result must look like 250 or -125.50.'); else pnl = neg ? -m : m; }
    if (e.length) return { ok: false, errors: e };
    return { ok: true, result: { date: date, r: Math.round(r * 1e4) / 1e4, pnlCents: pnl, note: clip(raw.note, 200) } };
  }
  // Pasted/CSV text: "date,r[,pnl[,note]]" per line, optional header line. Returns valid results and every rejected line.
  function parseResultsText(text) {
    var out = [], errs = [], n = 0;
    str(text).split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return; var p = line.split(/[,\t;]/).map(function (x) { return x.trim(); });
      if (i === 0 || n === 0) { if (!isDate(p[0]) && /^[a-z]/i.test(p[0])) { n++; return; } } n++;
      if (out.length >= MAX_RESULTS) { if (!errs.some(function (x) { return x.cap; })) errs.push({ line: i + 1, msg: 'More than ' + MAX_RESULTS + ' rows; the rest were ignored.', cap: true }); return; }
      var v = validateResult({ date: p[0], r: p[1], pnl: p[2], note: p.slice(3).join(',') }); if (v.ok) out.push(v.result); else errs.push({ line: i + 1, msg: v.errors.join(' ') });
    });
    return { results: out, errors: errs };
  }
  function sortResults(rs) { return rs.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }); }   // stable for same-date entries

  /* ---------- journal -> results ---------- */
  // Closed trades with the given strategy name and a known R. Reports what was left out.
  function fromJournal(rows, name, f) {
    var sel = C.filterRows(rows, Object.assign({}, f || {}, { strategy: name })), closed = sel.filter(function (r) { return r.c.isClosed; });
    var use = closed.filter(function (r) { return r.c.rMultiple != null; }).sort(function (a, b) { return (a.t.date + (a.t.time || '')).localeCompare(b.t.date + (b.t.time || '')) || (a.t.createdAt - b.t.createdAt); });
    return { results: use.map(function (r) { return { date: r.t.date, r: r.c.rMultiple, pnlCents: r.c.netCents != null ? r.c.netCents : r.c.grossCents, riskCents: r.c.plannedRiskCents, id: r.t.id }; }),
      trades: sel.length, open: sel.length - closed.length, noR: closed.length - use.length };
  }

  /* ---------- statistics on a list of {r} ---------- */
  function mean(a) { var s = 0; a.forEach(function (x) { s += x; }); return a.length ? s / a.length : null; }
  function stats(results) {
    var n = results.length; if (!n) return { n: 0 };
    var rs = results.map(function (x) { return x.r; }), w = rs.filter(function (x) { return x > 0; }), l = rs.filter(function (x) { return x < 0; });
    var gp = w.reduce(function (a, b) { return a + b; }, 0), gl = l.reduce(function (a, b) { return a + b; }, 0), m = mean(rs), sd = null, ci = null;
    if (n >= 2) { var v = 0; rs.forEach(function (x) { v += (x - m) * (x - m); }); sd = Math.sqrt(v / (n - 1)); ci = { lo: m - 1.96 * sd / Math.sqrt(n), hi: m + 1.96 * sd / Math.sqrt(n) }; }
    var eq = 0, peak = 0, dd = 0, cl = 0, ml = 0; rs.forEach(function (x) { eq += x; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq; if (x < 0) { cl++; if (cl > ml) ml = cl; } else cl = 0; });
    return { n: n, wins: w.length, losses: l.length, winRate: w.length / n, winCI: A.wilson(w.length, n), avgWinR: w.length ? gp / w.length : null, avgLossR: l.length ? gl / l.length : null,
      expectancyR: m, expectancyCI: ci, totalR: eq, profitFactor: l.length ? gp / Math.abs(gl) : null, profitFactorNote: l.length ? '' : (w.length ? 'no losing trades yet' : ''),
      maxDrawdownR: dd, maxLossStreak: ml, sample: A.sampleLabel(n), ciIncludesZero: ci ? (ci.lo <= 0 && ci.hi >= 0) : null };
  }
  function equityR(results) { var eq = 0; return results.map(function (x, i) { eq += x.r; return { i: i, date: x.date, r: eq }; }); }

  /* ---------- compare (up to 4 named result sets) ---------- */
  function compare(sets) { return sets.slice(0, 4).map(function (s) { return { key: s.key, label: s.label, stats: stats(s.results) }; }); }

  /* ---------- forward test vs backtest ---------- */
  function forwardVsBacktest(forward, back) {
    var f = stats(forward), b = stats(back);
    if (!f.n || !b.n) return { ok: false, text: 'Needs results in both the backtest and the forward test.' };
    if (f.n < 10) return { ok: false, text: 'Only ' + f.n + ' forward ' + (f.n === 1 ? 'trade' : 'trades') + ' so far. Keep going: with fewer than 10, this comparison would mostly be noise.', f: f, b: b };
    var inside = f.expectancyCI && b.expectancyR >= f.expectancyCI.lo && b.expectancyR <= f.expectancyCI.hi;
    return { ok: true, f: f, b: b, consistent: !!inside, text: inside ? 'Your forward results are statistically consistent with the backtest average (the backtest average sits inside the forward 95% range).' : 'Your forward results differ from the backtest average by more than sampling noise would usually explain. Review whether the backtest rules match what you actually trade.' };
  }

  /* ---------- Monte Carlo: resample your own R results ---------- */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function pct(sorted, p) { var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
  function monteCarlo(rs, o) {
    o = o || {}; var errs = [], horizon = Number(o.horizon), sims = Number(o.sims || 2000), seed = o.seed == null || o.seed === '' ? 12345 : Number(o.seed), ddLimit = o.ddLimitR == null || o.ddLimitR === '' ? null : Number(o.ddLimitR);
    if (rs.length < MIN_MC) return { ok: false, text: 'Needs at least ' + MIN_MC + ' results to resample (you have ' + rs.length + '). With fewer, the simulation would only echo a handful of trades.' };
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 1000) errs.push('Number of trades must be a whole number from 1 to 1000.');
    if (!Number.isInteger(sims) || sims < 100 || sims > 5000) errs.push('Simulations must be from 100 to 5000.');
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) errs.push('Seed must be a whole number of 0 or more.');
    if (ddLimit != null && (!isFinite(ddLimit) || ddLimit <= 0)) errs.push('Drawdown limit must be a number of R above 0.');
    if (errs.length) return { ok: false, errors: errs };
    var rand = rng(seed), finals = [], dds = [], hit = 0, neg = 0, n = rs.length;
    for (var s = 0; s < sims; s++) {
      var eq = 0, peak = 0, dd = 0, h = false;
      for (var i = 0; i < horizon; i++) { eq += rs[Math.floor(rand() * n)]; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq; if (ddLimit != null && dd >= ddLimit) h = true; }
      finals.push(eq); dds.push(dd); if (h) hit++; if (eq < 0) neg++;
    }
    finals.sort(function (a, b) { return a - b; }); dds.sort(function (a, b) { return a - b; });
    return { ok: true, sims: sims, horizon: horizon, seed: seed, basedOn: n, final: { p5: pct(finals, .05), p25: pct(finals, .25), p50: pct(finals, .5), p75: pct(finals, .75), p95: pct(finals, .95) },
      drawdown: { p50: pct(dds, .5), p95: pct(dds, .95), worst: dds[dds.length - 1] }, probNegative: neg / sims, probDdLimit: ddLimit != null ? hit / sims : null, ddLimitR: ddLimit,
      note: 'Resamples your own ' + n + ' results with replacement, in random order. It assumes future trades look like past ones and are independent. It is arithmetic on your history, not a forecast.' };
  }

  /* ---------- parameter sweeps on your own results ---------- */
  // kind 'riskcap': skip trades whose planned risk is above a cap (caps taken from your own risk quartiles).
  // kind 'firstN': take only the first N trades of each day.
  // Every row is also split chronologically (first half = in-sample, second half = out-of-sample) so a setting that only
  // looks good in one half is visible. The more settings you try, the more likely the best one is luck.
  function sweep(results, kind) {
    if (results.length < 20) return { ok: false, text: 'Needs at least 20 results to compare settings (you have ' + results.length + ').' };
    var variants = [], base = results;
    if (kind === 'riskcap') {
      var known = results.filter(function (x) { return x.riskCents != null; }); if (known.length < 20) return { ok: false, text: 'Needs at least 20 results with a recorded stop (planned risk). You have ' + known.length + '.' };
      var rk = known.map(function (x) { return x.riskCents; }).sort(function (a, b) { return a - b; }), caps = [], seen = {};
      [.25, .5, .75, 1].forEach(function (q) { var c = rk[Math.min(rk.length - 1, Math.ceil(rk.length * q) - 1)]; if (!seen[c]) { seen[c] = 1; caps.push(c); } });
      base = known; caps.forEach(function (c) { variants.push({ label: c === rk[rk.length - 1] ? 'No cap (all trades)' : 'Skip risk above ' + C.fmtMoney(c), keep: base.filter(function (x) { return x.riskCents <= c; }) }); });
    } else {
      var maxPer = {}, cnt = {}, dayIdx = results.map(function (x) { cnt[x.date] = (cnt[x.date] || 0) + 1; return cnt[x.date]; }), top = Math.max.apply(null, dayIdx);
      for (var N = 1; N <= Math.min(top, 5); N++) (function (N) { variants.push({ label: N >= top ? 'No limit (all trades)' : 'First ' + N + (N === 1 ? ' trade' : ' trades') + ' per day', keep: results.filter(function (x, i) { return dayIdx[i] <= N; }) }); })(N);
      if (variants.length < 2) return { ok: false, text: 'You never took more than one trade in a day, so there is nothing to compare.' };
    }
    var rows = variants.map(function (v) { var h = Math.floor(v.keep.length / 2); return { label: v.label, all: stats(v.keep), first: stats(v.keep.slice(0, h)), second: stats(v.keep.slice(h)) }; });
    return { ok: true, rows: rows, tried: rows.length, usable: base.length, note: 'You are looking at ' + rows.length + ' settings on the same ' + base.length + ' results. Picking the best one after seeing the numbers tends to overstate how well it works going forward. Treat a setting as interesting only if both halves agree and the sample is not small.' };
  }

  var api = { STATUSES: STATUSES, MAX_RESULTS: MAX_RESULTS, MIN_MC: MIN_MC, validateStrategy: validateStrategy, validateResult: validateResult, parseResultsText: parseResultsText, sortResults: sortResults, fromJournal: fromJournal, stats: stats, equityR: equityR, compare: compare, forwardVsBacktest: forwardVsBacktest, monteCarlo: monteCarlo, sweep: sweep, rng: rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTStrategyCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
