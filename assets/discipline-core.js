/* Tamhas Trading - discipline logic (pure functions, no DOM): plans, checklists, routines, reflections, goals and a transparent
   discipline score. The score measures HOW you trade (rules, stops, consistency, process), never how much you made.
   Everything is computed from what you entered; components without data are left out and reported, never counted as 0. */
(function (root) {
  'use strict';
  var C = root.TTJournalCore || (typeof require !== 'undefined' ? require('./journal-core.js') : null);
  var A = root.TTAnalyticsCore || (typeof require !== 'undefined' ? require('./analytics-core.js') : null);
  var K = root.TTRiskCore || (typeof require !== 'undefined' ? require('./risk-core.js') : null);
  function str(v) { return v == null ? '' : String(v); }
  function clip(v, n) { return str(v).replace(/\r\n?/g, '\n').trim().slice(0, n); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function addDays(date, n) { var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekStart(date) { var d = new Date(date + 'T00:00:00Z'); return addDays(date, -((d.getUTCDay() + 6) % 7)); }
  function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- items (one per line) ---------- */
  // Turns text (one item per line; a leading "*" marks it required) into items, re-using the id of an existing item with the same text.
  function parseItems(text, existing) {
    var byText = {}; (existing || []).forEach(function (x) { byText[x.text.toLowerCase()] = x; });
    var out = [], seen = {};
    str(text).split(/\n/).forEach(function (line) {
      var req = /^\s*\*/.test(line), t = clip(line.replace(/^\s*\*/, ''), 160); if (!t || seen[t.toLowerCase()] || out.length >= 30) return; seen[t.toLowerCase()] = 1;
      var old = byText[t.toLowerCase()]; out.push({ id: old ? old.id : uid(), text: t, required: req });
    });
    return out;
  }
  function itemsToText(items) { return (items || []).map(function (x) { return (x.required ? '*' : '') + x.text; }).join('\n'); }

  var LIST_TYPES = ['pre', 'post'];
  function validateList(raw, existingItems) {
    var e = [], name = clip(raw && raw.name, 60), items = parseItems(raw && raw.itemsText, existingItems);
    if (!name) e.push('Give the list a name.'); if (!items.length) e.push('Add at least one item (one per line).');
    return e.length ? { ok: false, errors: e } : { ok: true, name: name, items: items };
  }
  function runStats(def, answers) {
    var total = def.items.length, done = 0, rt = 0, rd = 0; answers = answers || {};
    def.items.forEach(function (it) { var a = answers[it.id] === true; if (a) done++; if (it.required) { rt++; if (a) rd++; } });
    return { total: total, done: done, requiredTotal: rt, requiredDone: rd, complete: total > 0 && done === total, ready: rd === rt };
  }
  function cleanAnswers(def, answers) { var out = {}; def.items.forEach(function (it) { if (answers && answers[it.id] === true) out[it.id] = true; }); return out; }

  /* ---------- plan ---------- */
  function validatePlan(raw) {
    var e = [], o = { name: clip(raw.name, 60) || 'My trading plan' };
    o.markets = clip(raw.markets, 200); o.sessions = clip(raw.sessions, 200); o.setups = clip(raw.setups, 400); o.notes = clip(raw.notes, 1500);
    ['entryRules', 'exitRules', 'dontRules'].forEach(function (k) { o[k] = parseItems(raw[k + 'Text'], raw[k]); });
    var mt = str(raw.maxTradesPerDay).trim(); if (mt === '') o.maxTradesPerDay = null; else { var n = Number(mt); if (!Number.isInteger(n) || n < 1 || n > 1000) e.push('Max trades per day must be a whole number of 1 or more.'); else o.maxTradesPerDay = n; }
    var mr = K.parseMoney(raw.maxRisk); if (str(raw.maxRisk).trim() === '') o.maxRiskCents = null; else if (mr == null || isNaN(mr) || mr <= 0) e.push('Max risk per trade must be a dollar amount above $0.'); else o.maxRiskCents = mr;
    return e.length ? { ok: false, errors: e } : { ok: true, plan: o };
  }

  /* ---------- reflection ---------- */
  function validateReflection(raw) {
    var e = []; if (!isDate(raw.date)) e.push('Pick a valid date.');
    function scale(k, label) { var v = str(raw[k]).trim(); if (v === '') return null; var n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) { e.push(label + ' must be 1 to 5.'); return null; } return n; }
    var o = { date: raw.date, mood: scale('mood', 'Mood'), focus: scale('focus', 'Focus'), planFollowed: scale('planFollowed', 'Plan followed'), wentWell: clip(raw.wentWell, 1500), struggled: clip(raw.struggled, 1500), lesson: clip(raw.lesson, 1500), tomorrow: clip(raw.tomorrow, 1500) };
    if (!e.length && o.mood == null && o.focus == null && o.planFollowed == null && !o.wentWell && !o.struggled && !o.lesson && !o.tomorrow) e.push('Fill in at least one thing.');
    return e.length ? { ok: false, errors: e } : { ok: true, reflection: o };
  }

  /* ---------- discipline score ---------- */
  var COMPONENTS = [
    { id: 'rules', label: 'Followed your rules', help: 'Share of trades where you recorded "followed rules" that you marked YES.' },
    { id: 'stops', label: 'Used a stop', help: 'Share of trades with an initial stop recorded.' },
    { id: 'size', label: 'Consistent risk', help: 'Share of trades whose planned risk is within 25% of your median planned risk (needs 3+ trades with stops).' },
    { id: 'limit', label: 'Stayed within trades per day', help: 'Share of trading days with no more trades than your plan allows (needs a max set in your plan).' },
    { id: 'journal', label: 'Journaled the trade', help: 'Share of trades with an entry reason, exit reason, lessons or notes.' },
    { id: 'pre', label: 'Pre-trade checklist', help: 'Share of trading days with at least one completed-as-ready pre-trade checklist (needs a pre-trade list).' },
    { id: 'reflect', label: 'Daily reflection', help: 'Share of trading days with a saved reflection (counted once you have saved at least one reflection).' }
  ];
  // ctx: {plan, preDefIds:[...], preRuns:[{date, ready}], reflections:[{date}]}; period {from,to}. Returns components with value 0..1 or null.
  function score(rows, ctx, period) {
    ctx = ctx || {};
    var inP = rows.filter(function (r) { return r.t.date >= period.from && r.t.date <= period.to; }), n = inP.length;
    var dates = {}; inP.forEach(function (r) { dates[r.t.date] = (dates[r.t.date] || 0) + 1; }); var days = Object.keys(dates);
    var val = {}, cnt = {};
    var rec = inP.filter(function (r) { return r.t.followedRules != null; }); if (rec.length) { val.rules = rec.filter(function (r) { return r.t.followedRules === true; }).length / rec.length; cnt.rules = rec.length; }
    if (n) { val.stops = inP.filter(function (r) { return r.t.stop != null; }).length / n; cnt.stops = n; }
    var risks = inP.filter(function (r) { return r.c.plannedRiskCents != null; }).map(function (r) { return r.c.plannedRiskCents; });
    if (risks.length >= 3) { var s = risks.slice().sort(function (a, b) { return a - b; }), mid = s.length >> 1, med = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; val.size = risks.filter(function (x) { return Math.abs(x - med) <= med * 0.25 + 1e-9; }).length / risks.length; cnt.size = risks.length; }
    if (ctx.plan && ctx.plan.maxTradesPerDay && days.length) { val.limit = days.filter(function (d) { return dates[d] <= ctx.plan.maxTradesPerDay; }).length / days.length; cnt.limit = days.length; }
    if (n) { val.journal = inP.filter(function (r) { var t = r.t; return t.entryReason || t.exitReason || t.lessons || t.notes; }).length / n; cnt.journal = n; }
    if (ctx.hasPreList && days.length) { var ready = {}; (ctx.preRuns || []).forEach(function (r) { if (r.ready) ready[r.date] = 1; }); val.pre = days.filter(function (d) { return ready[d]; }).length / days.length; cnt.pre = days.length; }
    if (days.length && (ctx.reflections || []).length) { var rf = {}; (ctx.reflections || []).forEach(function (r) { rf[r.date] = 1; }); val.reflect = days.filter(function (d) { return rf[d]; }).length / days.length; cnt.reflect = days.length; }
    var comps = COMPONENTS.map(function (c) { return { id: c.id, label: c.label, help: c.help, value: val[c.id] == null ? null : val[c.id], n: cnt[c.id] || 0 }; });
    var have = comps.filter(function (c) { return c.value != null; });
    return { trades: n, days: days.length, components: comps, used: have.length, total: COMPONENTS.length, score: have.length >= 2 ? Math.round(have.reduce(function (a, c) { return a + c.value; }, 0) / have.length * 100) : null,
      note: have.length < 2 ? 'Needs at least two measurable habits in this period.' : '' };
  }
  function band(s) { return s == null ? null : s >= 85 ? 'strong' : s >= 65 ? 'steady' : s >= 40 ? 'inconsistent' : 'needs attention'; }
  // Score for each of the last `weeks` weeks ending at the week containing `today`.
  function weekly(rows, ctx, today, weeks) {
    var out = [], ws = weekStart(today);
    for (var i = weeks - 1; i >= 0; i--) { var from = addDays(ws, -7 * i), to = addDays(from, 6), sc = score(rows, ctx, { from: from, to: to }); out.push({ from: from, to: to, trades: sc.trades, score: sc.score, used: sc.used }); }
    return out;
  }
  // What each recorded mistake tag is associated with. Association, not proof of cause.
  function mistakeCosts(inc) {
    var g = A.breakdown(inc, 'mistake'), none = g.filter(function (x) { return x.key === 'None recorded'; })[0];
    return { rows: g.filter(function (x) { return x.key !== 'None recorded'; }).sort(function (a, b) { return b.n - a.n || a.totalCents - b.totalCents; }), without: none || null };
  }

  /* ---------- goals ---------- */
  var METRICS = [
    { id: 'pnl', label: 'Profit in the period', dir: 'min', unit: 'money' }, { id: 'winRate', label: 'Win rate', dir: 'min', unit: 'pct' }, { id: 'rulesFollowed', label: 'Rules followed (of recorded trades)', dir: 'min', unit: 'pct' },
    { id: 'disciplineScore', label: 'Discipline score', dir: 'min', unit: 'count' }, { id: 'reflectionDays', label: 'Days with a reflection', dir: 'min', unit: 'count' },
    { id: 'maxTradesPerDay', label: 'Never more than N trades in a day', dir: 'max', unit: 'count' }, { id: 'maxDailyLoss', label: 'No day losing more than', dir: 'max', unit: 'money' }
  ];
  var PERIODS = ['week', 'month', '30d'];
  function periodRange(kind, today) {
    if (kind === 'week') { var w = weekStart(today); return { from: w, to: addDays(w, 6) }; }
    if (kind === 'month') { var y = +today.slice(0, 4), m = +today.slice(5, 7), last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: today.slice(0, 8) + '01', to: today.slice(0, 8) + String(last).padStart(2, '0') }; }
    return { from: addDays(today, -29), to: today };
  }
  function validateGoal(raw) {
    var e = [], M = METRICS.filter(function (m) { return m.id === raw.metric; })[0], title = clip(raw.title, 80);
    if (!M) e.push('Pick what to measure.'); if (PERIODS.indexOf(raw.period) < 0) e.push('Pick a period.');
    var target = null;
    if (M) { if (M.unit === 'money') { target = K.parseMoney(raw.target); if (target == null || isNaN(target) || target <= 0) e.push('Target must be a dollar amount above $0.'); }
      else if (M.unit === 'pct') { var p = Number(str(raw.target).replace('%', '')); if (str(raw.target).trim() === '' || !isFinite(p) || p <= 0 || p > 100) e.push('Target must be a percent from 1 to 100.'); else target = p; }
      else { var n = Number(raw.target); if (str(raw.target).trim() === '' || !Number.isInteger(n) || n < 1 || n > 100000) e.push('Target must be a whole number of 1 or more.'); else target = n; } }
    return e.length ? { ok: false, errors: e } : { ok: true, goal: { title: title || M.label, metric: M.id, period: raw.period, target: target } };
  }
  // Returns {status:'ahead'|'on'|'met'|'missed'|'nodata', value, target, pct (0..100 progress), text}. Never invents data.
  function goalProgress(goal, rows, ctx, today, basis) {
    var M = METRICS.filter(function (m) { return m.id === goal.metric; })[0], rg = periodRange(goal.period, today); if (!M) return { status: 'nodata', text: 'Unknown goal type' };
    var P = A.prepare(rows, { from: rg.from, to: rg.to }, basis || 'gross'), s = A.summary(P.inc), inP = rows.filter(function (r) { return r.t.date >= rg.from && r.t.date <= rg.to; });
    var v = null, res;
    if (goal.metric === 'pnl') { v = s.n ? s.totalCents : null; }
    else if (goal.metric === 'winRate') { v = s.n >= 5 ? s.winRate * 100 : null; if (s.n && s.n < 5) return { status: 'nodata', value: null, target: goal.target, pct: null, text: 'Needs 5+ closed trades (you have ' + s.n + ')', range: rg }; }
    else if (goal.metric === 'rulesFollowed') { var rec = inP.filter(function (r) { return r.t.followedRules != null; }); v = rec.length ? rec.filter(function (r) { return r.t.followedRules === true; }).length / rec.length * 100 : null; }
    else if (goal.metric === 'disciplineScore') { v = score(rows, ctx, rg).score; }
    else if (goal.metric === 'reflectionDays') { v = (ctx.reflections || []).filter(function (r) { return r.date >= rg.from && r.date <= rg.to; }).length; }
    else if (goal.metric === 'maxTradesPerDay') { var d = {}; inP.forEach(function (r) { d[r.t.date] = (d[r.t.date] || 0) + 1; }); var keys = Object.keys(d); v = keys.length ? Math.max.apply(null, keys.map(function (k) { return d[k]; })) : null; }
    else if (goal.metric === 'maxDailyLoss') { var pd = {}; P.inc.forEach(function (x) { pd[x.t.date] = (pd[x.t.date] || 0) + x.v; }); var ks = Object.keys(pd); v = ks.length ? -Math.min.apply(null, ks.map(function (k) { return pd[k]; })) : null; if (v != null && v < 0) v = 0; }
    if (v == null) return { status: 'nodata', value: null, target: goal.target, pct: null, text: 'No data in this period yet', range: rg };
    var over = rg.to < today, done = today > rg.to;
    if (M.dir === 'min') { var pct = Math.max(0, Math.min(100, v / goal.target * 100)); res = { status: v >= goal.target ? 'met' : (done ? 'missed' : 'on'), value: v, target: goal.target, pct: pct }; }
    else { res = { status: v > goal.target ? 'missed' : (done ? 'met' : 'on'), value: v, target: goal.target, pct: Math.max(0, Math.min(100, v / goal.target * 100)) }; }
    res.range = rg; res.dir = M.dir; return res;
  }

  var api = { LIST_TYPES: LIST_TYPES, COMPONENTS: COMPONENTS, METRICS: METRICS, PERIODS: PERIODS, isDate: isDate, addDays: addDays, weekStart: weekStart, parseItems: parseItems, itemsToText: itemsToText, validateList: validateList, runStats: runStats, cleanAnswers: cleanAnswers,
    validatePlan: validatePlan, validateReflection: validateReflection, score: score, band: band, weekly: weekly, mistakeCosts: mistakeCosts, validateGoal: validateGoal, goalProgress: goalProgress, periodRange: periodRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTDisciplineCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
