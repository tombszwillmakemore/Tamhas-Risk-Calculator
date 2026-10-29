/* Tamhas Trading - Journal v2 logic (pure functions, no DOM): review periods and summaries, trade comparison, bulk edits,
   and validation of custom fields, templates and saved filters. Everything is computed from the trades you entered. */
(function (root) {
  'use strict';
  var C = root.TTJournalCore || (typeof require !== 'undefined' ? require('./journal-core.js') : null);
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function utc(date) { var p = date.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function key(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(date, n) { var d = utc(date); d.setUTCDate(d.getUTCDate() + n); return key(d); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && key(utc(s)) === s; }
  function weekStart(date) { var d = utc(date), dow = (d.getUTCDay() + 6) % 7; return addDays(date, -dow); }   // Monday
  var KINDS = ['day', 'week', 'month'];

  /* ---------- review periods ---------- */
  // Period key: day 'YYYY-MM-DD', week = the Monday 'YYYY-MM-DD', month 'YYYY-MM'. Stored review docs use id-free lookups by kind+key.
  function periodOf(kind, date) {
    if (KINDS.indexOf(kind) < 0 || !isDate(date)) return null;
    if (kind === 'day') return { kind: kind, key: date, from: date, to: date };
    if (kind === 'week') { var m = weekStart(date); return { kind: kind, key: m, from: m, to: addDays(m, 6) }; }
    var y = +date.slice(0, 4), mo = +date.slice(5, 7), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { kind: kind, key: date.slice(0, 7), from: date.slice(0, 7) + '-01', to: date.slice(0, 7) + '-' + pad(last) };
  }
  function shiftPeriod(p, delta) {
    if (p.kind === 'day') return periodOf('day', addDays(p.key, delta));
    if (p.kind === 'week') return periodOf('week', addDays(p.key, 7 * delta));
    var y = +p.key.slice(0, 4), mo = +p.key.slice(5, 7) - 1 + delta, d = new Date(Date.UTC(y, mo, 1));
    return periodOf('month', key(d));
  }
  function countLabels(rows, field) {
    var m = {}; rows.forEach(function (r) { (r.t[field] || []).forEach(function (x) { var k = x.toLowerCase(); (m[k] = m[k] || { label: x, n: 0 }).n++; }); });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); });
  }
  // Summary for one period. Only fully closed trades with a known P&L under the basis count towards money statistics;
  // everything excluded is counted and reported (never hidden).
  function reviewStats(rows, period, basis) {
    basis = basis === 'gross' ? 'gross' : 'net';
    var inP = rows.filter(function (r) { return r.t.date >= period.from && r.t.date <= period.to; });
    var closed = inP.filter(function (r) { return r.c.isClosed; });
    var counted = closed.filter(function (r) { return (basis === 'net' ? r.c.netCents : r.c.grossCents) != null; });
    var pl = function (r) { return basis === 'net' ? r.c.netCents : r.c.grossCents; };
    var wins = counted.filter(function (r) { return pl(r) > 0; }), losses = counted.filter(function (r) { return pl(r) < 0; });
    var total = counted.reduce(function (s, r) { return s + pl(r); }, 0);
    var withR = counted.filter(function (r) { return r.c.rMultiple != null; });
    var byDay = {}; counted.forEach(function (r) { byDay[r.t.date] = (byDay[r.t.date] || 0) + pl(r); });
    var days = Object.keys(byDay).sort().map(function (d) { return { date: d, cents: byDay[d] }; });
    var rules = { yes: 0, no: 0, unknown: 0 }; inP.forEach(function (r) { rules[r.t.followedRules === true ? 'yes' : r.t.followedRules === false ? 'no' : 'unknown']++; });
    var graded = inP.filter(function (r) { return r.t.grade; }), gp = { A: 4, B: 3, C: 2, D: 1, F: 0 };
    return {
      period: period, basis: basis, trades: inP.length, closed: closed.length, counted: counted.length, openOrPartial: inP.length - closed.length,
      excludedNoFees: basis === 'net' ? closed.length - counted.length : 0,
      wins: wins.length, losses: losses.length, breakeven: counted.length - wins.length - losses.length,
      winRate: counted.length ? wins.length / counted.length : null, totalCents: counted.length ? total : null,
      avgWinCents: wins.length ? Math.round(wins.reduce(function (s, r) { return s + pl(r); }, 0) / wins.length) : null,
      avgLossCents: losses.length ? Math.round(losses.reduce(function (s, r) { return s + pl(r); }, 0) / losses.length) : null,
      avgR: withR.length ? Math.round(withR.reduce(function (s, r) { return s + r.c.rMultiple; }, 0) / withR.length * 100) / 100 : null, rCount: withR.length,
      bestDay: days.length ? days.reduce(function (a, b) { return b.cents > a.cents ? b : a; }) : null,
      worstDay: days.length ? days.reduce(function (a, b) { return b.cents < a.cents ? b : a; }) : null,
      tradingDays: days.length, days: days, rules: rules,
      avgGrade: graded.length ? Math.round(graded.reduce(function (s, r) { return s + gp[r.t.grade]; }, 0) / graded.length * 100) / 100 : null, gradedCount: graded.length,
      tags: countLabels(inP, 'tags'), emotions: countLabels(inP, 'emotions'), mistakes: countLabels(inP, 'mistakeTags')
    };
  }

  /* ---------- comparison ---------- */
  var MAXCOMP = 4;
  function compare(rows) {
    return rows.slice(0, MAXCOMP).map(function (r) {
      var t = r.t, c = r.c, fills = t.entries || [{ qty: t.contracts, price: t.entry }];
      return { id: t.id, date: t.date, time: t.time || null, contract: t.contract, side: t.side, contracts: t.contracts, entryAvg: t.entry, fills: fills.length, stop: t.stop == null ? null : t.stop,
        avgExit: c.avgExit, status: c.status, grossCents: c.grossCents, feesCents: c.feesCents, netCents: c.netCents, riskCents: c.plannedRiskCents, r: c.rMultiple,
        strategy: t.strategy || null, session: t.session || null, grade: t.grade || null, followedRules: t.followedRules, rating: t.rating,
        tags: t.tags || [], emotions: t.emotions || [], mistakeTags: t.mistakeTags || [] };
    });
  }

  /* ---------- bulk edit ---------- */
  // op: {type:'addTag'|'removeTag'|'addMistake'|'setStrategy'|'setAccount'|'setGrade'|'setSession', value}
  // Returns {trades: [updated, ...], changed: n, failed: [{id, reason}]}. Every result passes through normalizeTrade; nothing is mutated in place.
  function bulkApply(trades, ids, op) {
    var set = {}; ids.forEach(function (i) { set[i] = 1; });
    var out = [], changed = 0, failed = [];
    trades.forEach(function (t) {
      if (!set[t.id]) { out.push(t); return; }
      var raw = JSON.parse(JSON.stringify(t)), v = op.value;
      switch (op.type) {
        case 'addTag': raw.tags = (raw.tags || []).concat([v]); break;
        case 'removeTag': raw.tags = (raw.tags || []).filter(function (x) { return x.toLowerCase() !== String(v).toLowerCase(); }); break;
        case 'addMistake': raw.mistakeTags = (raw.mistakeTags || []).concat([v]); break;
        case 'setStrategy': raw.strategy = v; break;
        case 'setSession': raw.session = v; break;
        case 'setAccount': raw.accountId = v; break;
        case 'setGrade': raw.grade = v; break;
        default: failed.push({ id: t.id, reason: 'Unknown action' }); out.push(t); return;
      }
      var r = C.normalizeTrade(raw);
      if (!r.ok) { failed.push({ id: t.id, reason: r.errors[0] }); out.push(t); return; }
      if (JSON.stringify(r.trade) !== JSON.stringify(t)) changed++;
      out.push(r.trade);
    });
    return { trades: out, changed: changed, failed: failed };
  }

  /* ---------- label manager: rename / merge / remove a tag, emotion or mistake tag across all trades ---------- */
  var LABEL_FIELDS = ['tags', 'emotions', 'mistakeTags'];
  function renameLabel(trades, field, from, to) {
    if (LABEL_FIELDS.indexOf(field) < 0) return { trades: trades, changed: 0, failed: [{ id: '', reason: 'Unknown label type' }] };
    var f = String(from).toLowerCase(), out = [], changed = 0, failed = [];
    trades.forEach(function (t) {
      if (!(t[field] || []).some(function (x) { return x.toLowerCase() === f; })) { out.push(t); return; }
      var raw = JSON.parse(JSON.stringify(t)), seen = false, next = [];
      raw[field].forEach(function (x) { if (x.toLowerCase() === f) { if (to) next.push(to); } else next.push(x); });
      raw[field] = next;                                   // normalizeTrade de-duplicates, so renaming onto an existing label merges them
      var r = C.normalizeTrade(raw);
      if (!r.ok) { failed.push({ id: t.id, reason: r.errors[0] }); out.push(t); return; }
      changed++; out.push(r.trade);
    });
    return { trades: out, changed: changed, failed: failed };
  }

  /* ---------- custom fields, templates, saved filters ---------- */
  var FIELD_TYPES = ['text', 'number', 'choice', 'yesno'];
  function validateFieldDef(raw, existing) {
    var e = [], label = String(raw && raw.label || '').trim().slice(0, 40), type = raw && raw.type, choices = [];
    if (!label) e.push('Give the field a name.');
    if (FIELD_TYPES.indexOf(type) < 0) e.push('Choose a field type.');
    if (type === 'choice') {
      choices = C.cleanLabels(String(raw.choices || '').split(/[,\n]/), 12);
      if (choices.length < 2) e.push('A choice field needs at least two options (separate them with commas).');
    }
    (existing || []).forEach(function (f) { if (f.id !== (raw && raw.id) && f.label.toLowerCase() === label.toLowerCase()) e.push('A field with that name already exists.'); });
    if ((existing || []).filter(function (f) { return f.id !== (raw && raw.id); }).length >= 15) e.push('You can have up to 15 custom fields.');
    return e.length ? { ok: false, errors: e } : { ok: true, def: { label: label, type: type, choices: choices } };
  }
  // Clean a value typed for a field. Returns {ok, value} where value undefined means "empty / not recorded".
  function cleanFieldValue(def, v) {
    if (v == null || String(v).trim() === '') return { ok: true, value: undefined };
    if (def.type === 'number') { var n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? { ok: true, value: n } : { ok: false, error: def.label + ' must be a number.' }; }
    if (def.type === 'yesno') return v === true || v === 'yes' ? { ok: true, value: true } : v === false || v === 'no' ? { ok: true, value: false } : { ok: false, error: def.label + ': choose yes or no.' };
    if (def.type === 'choice') return def.choices.indexOf(String(v)) >= 0 ? { ok: true, value: String(v) } : { ok: false, error: def.label + ': pick one of the options.' };
    return { ok: true, value: String(v).trim().slice(0, 200) };
  }
  var TEMPLATE_KEYS = ['contract', 'side', 'session', 'strategy', 'tags', 'emotions', 'entryReason', 'exitReason', 'notes', 'followedRules', 'custom'];
  // A trade template pre-fills the New Trade form. It never contains prices, quantities or dates.
  function cleanTemplate(raw) {
    var out = {}; raw = raw || {};
    ['session', 'strategy', 'entryReason', 'exitReason', 'notes'].forEach(function (k) { if (raw[k]) out[k] = String(raw[k]).trim().slice(0, k === 'strategy' ? 60 : 500); });
    if (raw.contract && C && raw.contract !== '') out.contract = String(raw.contract).slice(0, 12);
    if (raw.side === 'long' || raw.side === 'short') out.side = raw.side;
    var tg = C.cleanLabels(raw.tags, 12); if (tg.length) out.tags = tg;
    var em = C.cleanLabels(raw.emotions, 8); if (em.length) out.emotions = em;
    if (raw.followedRules === true || raw.followedRules === false) out.followedRules = raw.followedRules;
    var cu = C.cleanCustom(raw.custom); if (cu) out.custom = cu;
    return out;
  }
  var FILTER_KEYS = ['q', 'contract', 'side', 'session', 'strategy', 'account', 'result', 'rules', 'tag', 'emotion', 'mistake', 'grade', 'from', 'to', 'minR', 'maxR'];
  function cleanFilter(f) {
    var out = {}; f = f || {};
    FILTER_KEYS.forEach(function (k) { if (f[k] != null && String(f[k]).trim() !== '') out[k] = String(f[k]).slice(0, 80); });
    if (out.from && !isDate(out.from)) delete out.from; if (out.to && !isDate(out.to)) delete out.to;
    ['minR', 'maxR'].forEach(function (k) { if (out[k] != null && !isFinite(Number(out[k]))) delete out[k]; });
    return out;
  }
  // Relative date presets for filters/ranges, computed from a given 'today'.
  function rangePreset(name, today) {
    if (name === 'today') return { from: today, to: today };
    if (name === 'week') { var m = weekStart(today); return { from: m, to: addDays(m, 6) }; }
    if (name === 'month') { var p = periodOf('month', today); return { from: p.from, to: p.to }; }
    if (name === '30d') return { from: addDays(today, -29), to: today };
    return null;
  }

  var api = { KINDS: KINDS, MAXCOMP: MAXCOMP, FIELD_TYPES: FIELD_TYPES, TEMPLATE_KEYS: TEMPLATE_KEYS, FILTER_KEYS: FILTER_KEYS, isDate: isDate, addDays: addDays, weekStart: weekStart, periodOf: periodOf, shiftPeriod: shiftPeriod,
    reviewStats: reviewStats, renameLabel: renameLabel, LABEL_FIELDS: LABEL_FIELDS, compare: compare, bulkApply: bulkApply, validateFieldDef: validateFieldDef, cleanFieldValue: cleanFieldValue, cleanTemplate: cleanTemplate, cleanFilter: cleanFilter, rangePreset: rangePreset, countLabels: countLabels };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTJournal2Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
