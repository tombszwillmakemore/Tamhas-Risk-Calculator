/* Tamhas Trading - risk engine (pure functions, no DOM). All money is whole cents; prices are numbers with at most 2 decimals.
   Nothing here invents account rules: limits are only the numbers YOU enter. Simulations are labelled scenarios, not forecasts. */
(function (root) {
  'use strict';
  var INST = root.TTInstruments || (typeof require !== 'undefined' ? require('./instruments.js') : null);
  var C = root.TTJournalCore || (typeof require !== 'undefined' ? require('./journal-core.js') : null);
  var MAXC = 500;
  function hund(x) { return Math.round(x * 100); }                       // price -> hundredths of a point (exact for 2-decimal prices)
  function decs(v) { var s = String(v), i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function okPrice(v) { return typeof v === 'number' && isFinite(v) && v > 0 && decs(v) <= 2; }
  function err(msg) { return { ok: false, error: msg }; }
  function inst(id) { return INST.byId[id] || null; }
  function riskFor(n, h, cpp) { return Math.round(n * h * cpp / 100); }   // cents for n contracts moving h hundredths of a point

  /* ---------- position size ---------- */
  // How many contracts fit inside a dollar risk. feePerContractCents = round-trip fees per contract (optional); it is counted as part of the risk.
  function positionSize(o) {
    var I = inst(o.instId); if (!I) return err('Pick a contract.');
    if (!okPrice(o.entry) || !okPrice(o.stop)) return err('Entry and stop must be positive prices (max 2 decimals).');
    if (o.entry === o.stop) return err('Stop cannot equal entry.');
    if (!(Number.isInteger(o.riskCents) && o.riskCents > 0)) return err('Risk must be more than $0.');
    var fee = o.feePerContractCents == null ? 0 : o.feePerContractCents; if (!(Number.isInteger(fee) && fee >= 0)) return err('Fees must be zero or more.');
    var h = Math.abs(hund(o.entry) - hund(o.stop)), cpp = I.centsPerPoint, perStop = riskFor(1, h, cpp);
    var n = Math.floor(o.riskCents * 100 / (h * cpp + 100 * fee));
    while (n > 0 && riskFor(n, h, cpp) + n * fee > o.riskCents) n--;
    while (riskFor(n + 1, h, cpp) + (n + 1) * fee <= o.riskCents) n++;
    var capped = n > MAXC; if (capped) n = MAXC;
    var stopRisk = riskFor(n, h, cpp), feeTotal = n * fee;
    return { ok: true, side: o.stop < o.entry ? 'long' : 'short', contracts: n, capped: capped, stopPoints: h / 100, perContractCents: perStop, stopRiskCents: stopRisk, feeCents: feeTotal, totalRiskCents: stopRisk + feeTotal, leftoverCents: o.riskCents - stopRisk - feeTotal,
      needForOneCents: perStop + fee, note: n === 0 ? 'One contract risks ' + (perStop + fee) + ' cents at this stop, more than your limit.' : '' };
  }

  /* ---------- reward : risk ---------- */
  function rewardRisk(o) {
    var I = inst(o.instId); if (!I) return err('Pick a contract.');
    if (!okPrice(o.entry) || !okPrice(o.stop) || !okPrice(o.target)) return err('Entry, stop and target must be positive prices (max 2 decimals).');
    if (o.entry === o.stop) return err('Stop cannot equal entry.');
    var long = o.stop < o.entry; if (long ? !(o.target > o.entry) : !(o.target < o.entry)) return err('For a ' + (long ? 'long' : 'short') + ', the target must be ' + (long ? 'above' : 'below') + ' your entry.');
    var n = o.contracts == null ? 1 : o.contracts; if (!(Number.isInteger(n) && n >= 1 && n <= MAXC)) return err('Contracts must be a whole number from 1 to ' + MAXC + '.');
    var fees = o.feesCents == null ? 0 : o.feesCents; if (!(Number.isInteger(fees) && fees >= 0)) return err('Fees must be zero or more.');
    var hr = Math.abs(hund(o.entry) - hund(o.stop)), hw = Math.abs(hund(o.target) - hund(o.entry)), cpp = I.centsPerPoint;
    var risk = riskFor(n, hr, cpp), reward = riskFor(n, hw, cpp), rr = hw / hr, nrr = (reward - fees) / (risk + fees);
    return { ok: true, side: long ? 'long' : 'short', riskPoints: hr / 100, rewardPoints: hw / 100, riskCents: risk, rewardCents: reward, rr: rr, breakEvenWinRate: 1 / (1 + rr),
      feesCents: fees, netRiskCents: risk + fees, netRewardCents: reward - fees, netRR: nrr, netBreakEvenWinRate: (risk + fees) / ((risk + fees) + (reward - fees)), feePctOfRisk: risk ? fees / risk : null };
  }
  // Price needed just to cover fees (rounded up to the next cent of a point, on the profit side).
  function breakEven(o) {
    var I = inst(o.instId); if (!I) return err('Pick a contract.'); if (!okPrice(o.entry)) return err('Entry must be a positive price.');
    if (o.side !== 'long' && o.side !== 'short') return err('Pick long or short.');
    var n = o.contracts, fees = o.feesCents; if (!(Number.isInteger(n) && n >= 1 && n <= MAXC)) return err('Contracts must be a whole number from 1 to ' + MAXC + '.'); if (!(Number.isInteger(fees) && fees >= 0)) return err('Fees must be zero or more.');
    var hundredths = Math.ceil(fees * 100 / (n * I.centsPerPoint)), price = (hund(o.entry) + (o.side === 'long' ? 1 : -1) * hundredths) / 100;
    return { ok: true, points: hundredths / 100, price: price };
  }

  /* ---------- scenarios (assumptions in, arithmetic out; not predictions) ---------- */
  // Probability of at least one run of k consecutive losses somewhere in n trades, if every trade independently wins with probability p.
  function probLossRun(p, n, k) {
    if (!(p >= 0 && p <= 1) || !(Number.isInteger(n) && n >= 1) || !(Number.isInteger(k) && k >= 1)) return null;
    var q = 1 - p, s = new Array(k).fill(0); s[0] = 1; var hit = 0;
    for (var i = 0; i < n; i++) {
      var nx = new Array(k).fill(0);
      for (var j = 0; j < k; j++) { if (!s[j]) continue; nx[0] += s[j] * p; if (j + 1 === k) hit += s[j] * q; else nx[j + 1] += s[j] * q; }
      s = nx;
    }
    return hit;
  }
  function streakTable(p, n, ks) { return ks.map(function (k) { return { k: k, prob: probLossRun(p, n, k) }; }); }
  // Expected result per trade for assumed win rate and reward:risk, risking `riskCents` per trade. A long-run average, not a promise.
  function expectedValue(p, rr, riskCents) { if (!(p >= 0 && p <= 1) || !(rr > 0) || !(riskCents > 0)) return null; return p * rr * riskCents - (1 - p) * riskCents; }
  function lossesToLimit(limitCents, riskPerLossCents) { if (!(limitCents > 0) || !(riskPerLossCents > 0)) return null; return Math.ceil(limitCents / riskPerLossCents); }
  function breakEvenWinRate(rr) { return rr > 0 ? 1 / (1 + rr) : null; }
  // Fixed-risk path: balance-less P&L after a sequence of results expressed in R (e.g. [-1,-1,2]).
  function sequenceR(riskCents, rs) { var eq = 0, peak = 0, maxDd = 0, curve = []; rs.forEach(function (r) { eq += Math.round(r * riskCents); curve.push(eq); if (eq > peak) peak = eq; if (peak - eq > maxDd) maxDd = peak - eq; }); return { totalCents: eq, maxDrawdownCents: maxDd, curve: curve }; }

  /* ---------- open risk ---------- */
  // Risk still open on a trade at its initial stop: contracts not yet exited (oldest contracts exit first) x distance to the stop.
  function openRisk(t, c) {
    if (c.status === 'closed') return { cents: 0, contracts: 0 };
    var left = c.remainingQty, cpp = inst(t.contract).centsPerPoint; if (t.stop == null) return { cents: null, contracts: left, unknown: true };
    var lots = (t.entries && t.entries.length ? t.entries : [{ qty: t.contracts, price: t.entry }]).map(function (l) { return { qty: l.qty, price: l.price }; }), out = c.exitedQty, li = 0;
    while (out > 0 && li < lots.length) { var take = Math.min(out, lots[li].qty); lots[li].qty -= take; out -= take; if (lots[li].qty === 0) li++; }
    var h = 0; lots.forEach(function (l) { h += Math.abs(hund(l.price) - hund(t.stop)) * l.qty; });
    return { cents: Math.round(h * cpp / 100), contracts: left };
  }

  /* ---------- limits you set yourself ---------- */
  var LIMITS = [
    { key: 'dailyLossCents', label: 'Daily loss limit', kind: 'money' }, { key: 'weeklyLossCents', label: 'Weekly loss limit', kind: 'money' },
    { key: 'maxRiskPerTradeCents', label: 'Max risk per trade', kind: 'money' }, { key: 'maxOpenRiskCents', label: 'Max open risk (all open trades)', kind: 'money' },
    { key: 'maxTradesPerDay', label: 'Max trades per day', kind: 'count' }, { key: 'maxContracts', label: 'Max contracts in one trade', kind: 'count' }
  ];
  function parseMoney(v) { var s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (s === '') return null; if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN; return Math.round(parseFloat(s) * 100); }
  function validateLimits(raw) {
    var e = [], out = {}; raw = raw || {};
    LIMITS.forEach(function (L) {
      var v = raw[L.key]; if (v == null || String(v).trim() === '') return;
      if (L.kind === 'money') { var c = parseMoney(v); if (c == null || isNaN(c) || c <= 0 || c > 1e10) e.push(L.label + ' must be a dollar amount above $0.'); else out[L.key] = c; }
      else { var n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 100000) e.push(L.label + ' must be a whole number of 1 or more.'); else out[L.key] = n; }
    });
    var w = raw.warnPct == null || String(raw.warnPct).trim() === '' ? 80 : Number(raw.warnPct);
    if (!Number.isInteger(w) || w < 50 || w > 99) e.push('Warn me at must be a whole percent from 50 to 99.'); else out.warnPct = w;
    return e.length ? { ok: false, errors: e } : { ok: true, limits: out };
  }
  // ctx: {dayLossCents, weekLossCents, trades, maxTradeRiskCents, openRiskCents, openRiskUnknown, maxContractsInTrade} (loss amounts are positive when losing, 0 when flat/winning)
  function evaluate(limits, ctx) {
    var warn = (limits && limits.warnPct) || 80, out = [];
    function row(L, used, extra) {
      var lim = limits && limits[L.key]; if (lim == null) return;
      if (used == null) { out.push({ key: L.key, label: L.label, limit: lim, used: null, pct: null, status: 'unknown', note: extra || '' }); return; }
      var pct = used / lim * 100, st = used > lim ? 'breach' : used === lim && L.kind === 'money' && L.key.indexOf('Loss') > 0 ? 'breach' : pct >= warn ? 'warn' : 'ok';
      out.push({ key: L.key, label: L.label, limit: lim, used: used, pct: pct, status: st, note: extra || '' });
    }
    row(LIMITS[0], ctx.dayLossCents); row(LIMITS[1], ctx.weekLossCents); row(LIMITS[2], ctx.maxTradeRiskCents == null ? null : ctx.maxTradeRiskCents, 'largest planned risk today');
    row(LIMITS[3], ctx.openRiskUnknown ? null : ctx.openRiskCents, ctx.openRiskUnknown ? 'an open trade has no stop, so its risk is unknown' : ''); row(LIMITS[4], ctx.trades); row(LIMITS[5], ctx.maxContractsInTrade);
    return out;
  }
  function weekStart(date) { var p = date.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
  function addDays(date, n) { var p = date.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  // Builds the evaluation context for one account (or all accounts when accountId is null) as of `today` (YYYY-MM-DD).
  function accountContext(rows, accountId, today) {
    var mine = rows.filter(function (r) { return !accountId || (r.t.accountId || 'acct-default') === accountId; });
    var ws = weekStart(today), we = addDays(ws, 6), day = 0, week = 0, trades = 0, maxRisk = null, openC = 0, unknown = 0, maxCon = null, dayPl = 0;
    mine.forEach(function (r) {
      var t = r.t, c = r.c;
      if (t.date === today) { trades++; if (c.shownCents != null) dayPl += c.shownCents; if (c.plannedRiskCents != null && (maxRisk == null || c.plannedRiskCents > maxRisk)) maxRisk = c.plannedRiskCents; if (maxCon == null || t.contracts > maxCon) maxCon = t.contracts; }
      if (t.date >= ws && t.date <= we && c.shownCents != null) week += c.shownCents;
      if (c.status !== 'closed') { var o = openRisk(t, c); if (o.unknown) unknown++; else openC += o.cents; }
    });
    return { dayLossCents: dayPl < 0 ? -dayPl : 0, dayPnlCents: dayPl, weekLossCents: week < 0 ? -week : 0, weekPnlCents: week, trades: trades, maxTradeRiskCents: maxRisk, openRiskCents: openC, openRiskUnknown: unknown > 0, openUnknownCount: unknown, maxContractsInTrade: maxCon };
  }

  /* ---------- history ---------- */
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
  function riskHistory(rows) {
    var all = rows.filter(function (r) { return r.t; }), withStop = all.filter(function (r) { return r.c.plannedRiskCents != null; }), risks = withStop.map(function (r) { return r.c.plannedRiskCents; });
    var closed = all.filter(function (r) { return r.c.isClosed; }), beyond = closed.filter(function (r) { return r.c.plannedRiskCents != null && r.c.grossCents != null && -r.c.grossCents > r.c.plannedRiskCents; });
    var mean = risks.length ? risks.reduce(function (a, b) { return a + b; }, 0) / risks.length : null, sd = null;
    if (risks.length > 1) { sd = Math.sqrt(risks.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (risks.length - 1)); }
    var daily = {}; closed.forEach(function (r) { if (r.c.shownCents != null) daily[r.t.date] = (daily[r.t.date] || 0) + r.c.shownCents; });
    var days = Object.keys(daily).sort().map(function (d) { return { date: d, cents: daily[d] }; }), worst = days.length ? days.reduce(function (a, b) { return b.cents < a.cents ? b : a; }) : null;
    var perDay = {}; all.forEach(function (r) { perDay[r.t.date] = (perDay[r.t.date] || 0) + 1; }); var counts = Object.keys(perDay).map(function (d) { return perDay[d]; });
    return { trades: all.length, withStop: withStop.length, noStop: all.length - withStop.length, avgRiskCents: mean == null ? null : Math.round(mean), medianRiskCents: median(risks), maxRiskCents: risks.length ? Math.max.apply(null, risks) : null, minRiskCents: risks.length ? Math.min.apply(null, risks) : null,
      riskSpread: mean && sd != null ? sd / mean : null, lossesBeyondRisk: beyond.length, closedWithStop: closed.filter(function (r) { return r.c.plannedRiskCents != null && r.c.grossCents != null; }).length,
      worstDay: worst, tradingDays: days.length, maxTradesInDay: counts.length ? Math.max.apply(null, counts) : null, avgTradesPerDay: counts.length ? all.length / counts.length : null, bigLossDays: days.filter(function (d) { return d.cents < 0; }).length };
  }

  var api = { MAX_CONTRACTS: MAXC, LIMITS: LIMITS, positionSize: positionSize, rewardRisk: rewardRisk, breakEven: breakEven, probLossRun: probLossRun, streakTable: streakTable, expectedValue: expectedValue, lossesToLimit: lossesToLimit, breakEvenWinRate: breakEvenWinRate, sequenceR: sequenceR,
    openRisk: openRisk, validateLimits: validateLimits, evaluate: evaluate, accountContext: accountContext, riskHistory: riskHistory, parseMoney: parseMoney };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTRiskCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
