/* Tamhas Trading - duplicate engine (pure logic: no DOM, no storage, no network). Node-testable.

   Every incoming trade (from a CSV, a pasted table, a screenshot, a backup, the cloud or the trade form) is compared with what the
   journal already holds and gets exactly ONE class:
     new        - not seen before
     exact      - already in the journal: same source ids, or (when a report has no ids) the same account, contract, side, time and
                  every fill's size and price. Skipped automatically and recorded in the Duplicate Archive.
     updated    - the same trade with more or better information: fees that were missing or estimated, or more fills (a trade that
                  was still open at the end of an earlier report). Never applied silently: shown in the preview with a choice.
     possible   - similar, but not enough evidence to decide: matches a trade you typed by hand, the time differs by whole hours
                  (a report exported in another time zone), or it may close a position that is still open in your journal.
     conflict   - the same source ids but different prices or sizes, a different account, or ids spread over several trades.
     invalid    - cannot be read reliably (reported by the import engine with the reason).

   Identity, strongest first:
     1. source keys (srcKeys): one per execution. Tradovate fill and order ids are used when the report has them; otherwise a key made
        from the normalised account, contract (with expiry), side, size, price and the time to the second, plus a counter for identical
        executions in the same second. No file name, row number or import date is ever part of a key, so row order, column order,
        file name and timestamp precision (milliseconds vs seconds) do not matter.
     2. fingerprint: account + contract + side + date + time (minute) + every entry and exit size@price. Counted as a multiset, so two
        real trades that look identical are both kept when the report really has two of them.
     3. near matches (time shifted by whole hours) are only ever "possible", never merged.
   Trades in different accounts are never duplicates of each other. */
(function (root) {
  'use strict';
  var DEF = 'acct-default';
  var MONTH = 'FGHJKMNQUVXZ', MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function hash(str) {   // two independent 32-bit FNV-1a variants -> 16 hex characters (same function as import-core and sync-core)
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef;
    for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193); h2 = Math.imul(h2 ^ c, 0x85ebca6b); h2 ^= h2 >>> 13; }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }
  function stable(o) { return Array.isArray(o) ? '[' + o.map(stable).join(',') + ']' : (o && typeof o === 'object' ? '{' + Object.keys(o).filter(function (k) { return o[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}' : JSON.stringify(o)); }

  /* ---------- normalising raw values for keys ---------- */
  // "MNQZ6", "MNQ Z26", "/MNQZ2026", "MNQ 12-26", "MNQ DEC26" -> "MNQ:Z6". A symbol without a readable expiry keeps just its root.
  function contractKey(raw, rootSym) {
    var s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/^\//, '').replace(/\s+/g, ' ').replace(/\.[A-Z]{3,5}$/, ''), m;
    if ((m = s.match(/^([A-Z]{2,3})\s?([FGHJKMNQUVXZ])(\d{1,4})$/))) return m[1] + ':' + m[2] + m[3].slice(-1);
    if ((m = s.match(/^([A-Z]{2,3})[ -]?(\d{1,2})[-\/ ]?(\d{2})$/)) && +m[2] >= 1 && +m[2] <= 12) return m[1] + ':' + MONTH[+m[2] - 1] + m[3].slice(-1);
    if ((m = s.match(/^([A-Z]{2,3})[ -]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ -]?(\d{2,4})$/))) return m[1] + ':' + MONTH[MON3.indexOf(m[2])] + m[3].slice(-1);
    return rootSym || s.replace(/[0-9]!$/, '');
  }
  function acctKey(raw) { return String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, ' '); }
  // A parsed timestamp {date, time, ms, sec, hasTime} -> whole seconds (precision beyond seconds is ignored on purpose).
  function instantKey(ts) {
    if (!ts) return '';
    if (ts.ms != null && isFinite(ts.ms)) return String(Math.floor(ts.ms / 1000));
    return ts.date + (ts.hasTime ? ' ' + ts.time + ':' + (ts.sec || 0) : '');
  }
  function priceKey(p) { return Number(p).toFixed(2); }
  /* A key for one execution that has no id in the report. `occ` is a {} shared by one file, so identical executions in the same
     second get #0, #1... in whatever order the file lists them (they are indistinguishable anyway). */
  function contentKey(prefix, parts, occ) { var base = hash(parts.join('\u001f')), n = occ[base] || 0; occ[base] = n + 1; return prefix + base + '#' + n; }

  /* ---------- describing a trade ---------- */
  function legs(t) {
    var en = t.entries && t.entries.length ? t.entries : [{ qty: t.contracts, price: t.entry }];
    return { en: en.map(function (x) { return x.qty + '@' + priceKey(x.price); }).join(','), ex: (t.exits || []).map(function (x) { return x.qty + '@' + priceKey(x.price); }).join(',') };
  }
  function acctOf(t) { return t.accountId || DEF; }
  function fingerprint(t) { var l = legs(t); return hash([acctOf(t) === DEF ? '' : acctOf(t), t.contract, t.side, t.date, t.time || '', l.en, l.ex].join('|')); }
  // Same as fingerprint but without date and time: used only to spot reports exported in a different time zone.
  function shape(t) { var l = legs(t); return hash([acctOf(t), t.contract, t.side, l.en, l.ex].join('|')); }
  function minutes(t) { if (!t.date || !t.time) return null; var d = Date.parse(t.date + 'T' + t.time + ':00Z'); return isNaN(d) ? null : d / 60000; }
  function material(a, b) {   // which trading facts differ (fees and journal notes are not trading facts)
    var out = [], la = legs(a), lb = legs(b);
    if (a.contract !== b.contract) out.push('contract'); if (a.side !== b.side) out.push('side');
    if (la.en !== lb.en) out.push('entry fills'); if (la.ex !== lb.ex) out.push('exit fills');
    return out;
  }
  function feeChange(ex, inc) {
    if (inc.feesCents == null) return null;                                   // the report has no fees: nothing new
    if (ex.feesCents == null) return 'fees-added';
    if (ex.feesCents === inc.feesCents) return null;
    if (ex.feeSource === 'template' && inc.feeSource === 'file') return 'fees-better';
    return 'fees-changed';
  }
  // Stable trade id from its source keys: the same report imported on two devices gives the same id, so the cloud keeps one copy.
  function tradeId(keys, accountId) { if (!keys || !keys.length) return null; return 'x' + hash((accountId || DEF) + '|' + keys.slice().sort().join('|')).slice(0, 16) + hash(keys.slice().sort().join('|') + '|' + (accountId || DEF)).slice(0, 8); }

  var REASON = {
    'same-ids': 'Already imported: the same execution ids are in your journal.',
    'part-of-existing': 'Already imported as part of a larger trade (an earlier or longer report had all of its fills).',
    'same-content': 'Already imported from another report: same account, contract, side, time and every fill size and price.',
    'fees-added': 'Same trade; this report adds fees that were missing.',
    'fees-better': 'Same trade; this report has the real fees where your journal has fees estimated from your settings.',
    'fees-changed': 'Same trade, but the fees differ from what your journal has.',
    'more-fills': 'Same trade with more fills: it was still open (or incomplete) in an earlier report.',
    'matches-manual': 'Looks the same as a trade you entered by hand (same account, contract, side, time, sizes and prices).',
    'time-shift': 'Same account, contract, side, sizes and prices, but the time differs by whole hours: the report may use another time zone.',
    'open-continue': 'You have an open position in this account and contract from an earlier report. This may be its exit, not a new trade.',
    'changed': 'Same execution ids as a trade in your journal, but different prices or sizes.',
    'account': 'These executions are already in your journal under a different account.',
    'overlap': 'Some of these executions are already in your journal, split across different trades.'
  };
  var CONF = { 'same-ids': 'certain', 'part-of-existing': 'certain', 'same-content': 'high', 'fees-added': 'certain', 'fees-better': 'certain', 'fees-changed': 'certain', 'more-fills': 'certain',
    'matches-manual': 'medium', 'time-shift': 'low', 'open-continue': 'low', 'changed': 'certain', 'account': 'certain', 'overlap': 'certain' };

  /* ---------- index of what the journal already holds ---------- */
  // trades: saved trade objects (normalised). computeFn(t) -> {isClosed} (TTJournalCore.compute) is optional (used for open positions).
  function index(trades, computeFn) {
    var ix = { byKey: new Map(), trades: new Map(), byFp: new Map(), byShape: new Map(), open: [], claimed: new Set() };
    (trades || []).forEach(function (t) { add(ix, t, { computeFn: computeFn }); });
    return ix;
  }
  function push(map, k, v) { var a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(v); }
  function add(ix, t, o) {
    o = o || {}; if (!t || !t.id) return;
    var e = { t: t, keys: new Set(t.srcKeys || []), fp: fingerprint(t), shape: shape(t), min: minutes(t), src: o.src || null, planned: !!o.planned, imported: !!(t.srcKeys && t.srcKeys.length) };
    ix.trades.set(t.id, e);
    e.keys.forEach(function (k) { if (!ix.byKey.has(k)) ix.byKey.set(k, t.id); });
    push(ix.byFp, e.fp, t.id); push(ix.byShape, e.shape, t.id);
    var closed = o.closed != null ? o.closed : (o.computeFn ? !!o.computeFn(t).isClosed : (t.exits || []).reduce(function (a, x) { return a + x.qty; }, 0) >= (t.contracts || 0));
    if (!closed && e.imported) ix.open.push(t.id);
    return e;
  }
  function addKeys(ix, id, keys) { var e = ix.trades.get(id); if (!e) return; keys.forEach(function (k) { e.keys.add(k); if (!ix.byKey.has(k)) ix.byKey.set(k, id); }); }

  /* ---------- classify one incoming trade ----------
     item: {trade, keys:[...], alts:[...] (older key formats for the same executions), src (which file in this import)} */
  function result(cls, why, ex, extra) { return Object.assign({ cls: cls, why: why, reason: REASON[why] || why, conf: CONF[why] || 'medium', existingId: ex ? ex.t.id : null }, extra || {}); }
  function classify(ix, item) {
    var t = item.trade, keys = item.keys || [], alts = item.alts || [], acct = acctOf(t);
    // 1. execution ids / keys
    var owners = {}, n = keys.length, known = 0;
    for (var i = 0; i < n; i++) {
      var id = ix.byKey.get(keys[i]) || (alts[i] ? ix.byKey.get(alts[i]) : null);
      if (id) { owners[id] = 1; known++; }
    }
    var ownIds = Object.keys(owners);
    if (ownIds.length > 1) return result('conflict', 'overlap', ix.trades.get(ownIds[0]), { others: ownIds.slice(1) });
    if (ownIds.length === 1) {
      var ex = ix.trades.get(ownIds[0]); ix.claimed.add(ex.t.id);
      if (acctOf(ex.t) !== acct) return result('conflict', 'account', ex);
      var mine = new Set(keys.concat(alts.filter(Boolean))), covered = 0; ex.keys.forEach(function (k) { if (mine.has(k)) covered++; });
      if (known === n) {
        // Every execution is already in that trade. Same trading facts -> the same trade (maybe with new fees). The saved trade has
        // MORE executions -> this is a piece of it. (A saved trade can hold keys in several formats, so key counts alone are not used.)
        var diff = material(ex.t, t);
        if (!diff.length) { var fc = feeChange(ex.t, t); return fc ? result('updated', fc, ex, { mode: 'fees' }) : result('exact', 'same-ids', ex); }
        if (covered < ex.keys.size) return result('exact', 'part-of-existing', ex);
        return result('conflict', 'changed', ex, { fields: diff });
      }
      if (covered >= ex.keys.size && t.contract === ex.t.contract && t.side === ex.t.side) return result('updated', 'more-fills', ex, { mode: 'fills' });
      return result('conflict', 'overlap', ex);
    }
    // 2. fingerprint (multiset: each saved trade can absorb only one incoming trade)
    var cands = (ix.byFp.get(fingerprint(t)) || []).map(function (id) { return ix.trades.get(id); })
      .filter(function (e) { return e && !ix.claimed.has(e.t.id) && !(item.src && e.src === item.src); });
    if (cands.length) {
      var imp = cands.filter(function (e) { return e.imported; })[0], ex2 = imp || cands[0]; ix.claimed.add(ex2.t.id);
      if (!imp) return result('possible', 'matches-manual', ex2, { mode: 'merge' });
      var fc2 = feeChange(ex2.t, t); return fc2 ? result('updated', fc2, ex2, { mode: 'fees' }) : result('exact', 'same-content', ex2);
    }
    // 3. same trade, clock shifted by whole hours (time zone of the export)
    var m = minutes(t);
    if (m != null) {
      var near = (ix.byShape.get(shape(t)) || []).map(function (id) { return ix.trades.get(id); }).filter(function (e) {
        if (!e || ix.claimed.has(e.t.id) || (item.src && e.src === item.src) || e.min == null) return false;
        var d = Math.abs(e.min - m); return d > 0 && d <= 14 * 60 && d % 60 === 0;
      })[0];
      if (near) { ix.claimed.add(near.t.id); return result('possible', 'time-shift', near, { hours: Math.abs(near.min - m) / 60 }); }
    }
    // 4. may close a position that is still open in the journal (a report that starts in the middle of a trade)
    var op = ix.open.map(function (id) { return ix.trades.get(id); }).filter(function (e) {
      return e && !ix.claimed.has(e.t.id) && !(item.src && e.src === item.src) && acctOf(e.t) === acct && e.t.contract === t.contract && e.t.side !== t.side && (e.t.date < t.date || (e.t.date === t.date && (e.t.time || '') <= (t.time || '')));
    })[0];
    if (op) return result('possible', 'open-continue', op);
    return result('new', 'new', null, { reason: 'Not in your journal yet.', conf: 'certain' });
  }

  /* ---------- applying an update (fees, more fills, or merging an import into a hand-entered trade) ----------
     Only trading facts change. Notes, tags, ratings, screenshots, strategy and every other journal field you wrote are kept. */
  var FILL_FIELDS = ['date', 'time', 'contracts', 'entry', 'entries', 'exits'];
  function applyUpdate(ex, inc, mode) {
    var out = JSON.parse(JSON.stringify(ex)), keys = new Set((ex.srcKeys || []).concat(inc.srcKeys || []));
    if (mode === 'fills') {
      FILL_FIELDS.forEach(function (k) { if (inc[k] === undefined) delete out[k]; else out[k] = JSON.parse(JSON.stringify(inc[k])); });
      if (inc.feesCents != null) { out.feesCents = inc.feesCents; if (inc.feeSource) out.feeSource = inc.feeSource; }
    } else if (mode === 'fees') {
      out.feesCents = inc.feesCents; if (inc.feeSource) out.feeSource = inc.feeSource; else delete out.feeSource;
    } else if (mode === 'merge') {
      if (out.feesCents == null && inc.feesCents != null) { out.feesCents = inc.feesCents; if (inc.feeSource) out.feeSource = inc.feeSource; }
      if (!out.srcInfo && inc.srcInfo) out.srcInfo = JSON.parse(JSON.stringify(inc.srcInfo));
    }
    if (keys.size) out.srcKeys = Array.from(keys).slice(0, 400);
    return out;
  }
  // A trade restored as a separate trade must not share source keys with the trade it resembles, or later imports could not tell
  // them apart. Its keys are prefixed, so re-importing the same report still finds the original and adds nothing.
  function asSeparate(inc, newId) {
    var out = JSON.parse(JSON.stringify(inc)); out.id = newId;
    if (out.srcKeys) out.srcKeys = out.srcKeys.map(function (k) { return k.indexOf('sep:') === 0 ? k : ('sep:' + newId.slice(-8) + ':' + k).slice(0, 160); });
    return out;
  }

  /* ---------- duplicates already inside the active journal (after a restore, a sync, or older versions) ----------
     certain:  two trades share a source key (the same execution counted twice).
     possible: same fingerprint, from different imports or one typed by hand (two trades from the SAME report are separate trades).
     separate: pairs you already marked as genuinely separate ("a|b" with a<b) are not reported again. */
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function scan(trades, separate) {
    var sep = separate || {}, byKey = new Map(), byFp = new Map(), groups = [], seen = {};
    (trades || []).forEach(function (t) {
      (t.srcKeys || []).forEach(function (k) { push(byKey, k, t); });
      push(byFp, fingerprint(t), t);
    });
    function grp(level, why, list) {
      var ids = []; list.forEach(function (t) { if (ids.indexOf(t.id) < 0) ids.push(t.id); }); if (ids.length < 2) return;
      ids.sort(); var real = ids.filter(function (id, i) { return ids.some(function (o, j) { return j !== i && !sep[pairKey(id, o)]; }); }); if (real.length < 2) return;
      var k = real.join(','); if (seen[k]) return; seen[k] = 1;
      groups.push({ level: level, why: why, reason: level === 'certain' ? 'The same execution is counted in more than one trade.' : 'These trades look identical but came from different imports or were typed by hand.', ids: real });
    }
    byKey.forEach(function (list) { if (list.length > 1) grp('certain', 'shared-key', list); });
    byFp.forEach(function (list) {
      if (list.length < 2) return;
      var batches = {}; list.forEach(function (t) { batches[t.importBatch || (t.srcKeys && t.srcKeys.length ? 'imported' : 'manual:' + t.id)] = 1; });
      if (Object.keys(batches).length > 1) grp('possible', 'same-content', list);
    });
    var certainIds = {}; groups.forEach(function (g) { if (g.level === 'certain') g.ids.forEach(function (id) { certainIds[id] = 1; }); });
    return groups.filter(function (g) { return g.level === 'certain' || !g.ids.every(function (id) { return certainIds[id]; }); });
  }

  /* ---------- what an import (or a restore) would do to your totals ---------- */
  // rows: [{trade, c}] where c = TTJournalCore.compute(trade). Confirmed = closed trades; net only when every fee is known.
  function impact(rows) {
    var r = { trades: rows.length, closed: 0, open: 0, grossCents: 0, netCents: 0, netKnown: 0, feesUnknown: 0 };
    rows.forEach(function (x) {
      var c = x.c; if (!c || !c.isClosed) { r.open++; return; }
      r.closed++; r.grossCents += c.grossCents;
      if (c.netCents == null || c.feesMissing) r.feesUnknown++; else { r.netKnown++; r.netCents += c.netCents; }
    });
    if (!r.closed) { r.grossCents = null; r.netCents = null; } else if (r.feesUnknown) r.netCents = null;
    return r;
  }
  function tally(list) { var c = { new: 0, exact: 0, updated: 0, possible: 0, conflict: 0, invalid: 0 }; (list || []).forEach(function (x) { if (c[x.cls] != null) c[x.cls]++; }); return c; }

  // Compact copy of a trade for the archive (everything needed to show it and to restore it; no screenshots).
  function snap(t) { return t ? JSON.parse(JSON.stringify(t)) : null; }
  function tradeHash(t) { var c = {}; Object.keys(t).forEach(function (k) { if (k !== 'createdAt') c[k] = t[k]; }); return hash(stable(c)); }

  /* ---------- turning a classified import into one atomic write ----------
     plans:   [{file, report, plan}] where plan comes from TTImport.plan(..., {dedupe}).
     choices: {off: {fp: 1} (new trades you unticked), upd: {key: true|false} (updates you accept), allow: {fp: 1} (already applied by plan)}
     ctx:     {batchId, now, current: {id: trade} (saved trades, to apply updates on the latest copy)}
     Returns everything to save; nothing is written here. Every record that is NOT added is kept in the archive with its reason. */
  var AUTO_APPLY = { 'fees-added': 1, 'fees-better': 1, 'more-fills': 1 };
  function updKey(x) { return (x.d && x.d.existingId || '') + ':' + x.fp; }
  function wantsUpdate(x, upd) { var k = updKey(x); return upd && Object.prototype.hasOwnProperty.call(upd, k) ? !!upd[k] : !!AUTO_APPLY[x.d && x.d.why]; }
  var EXACT_CHUNK = 150;
  function buildCommit(plans, choices, ctx) {
    choices = choices || {}; var off = choices.off || {}, upd = choices.upd || {}, now = ctx.now, bid = ctx.batchId, cur = {}, n = 0;
    Object.keys(ctx.current || {}).forEach(function (id) { cur[id] = ctx.current[id]; });
    var out = { puts: [], updates: [], dupes: [], tradeIds: [], hashes: {}, counts: { rows: 0, detected: 0, trades: 0, duplicates: 0, updated: 0, review: 0, possible: 0, conflicts: 0, ambiguous: 0, invalid: 0, unsupported: 0, deselected: 0 } }, exact = [], c = out.counts;
    function dupeId() { n++; return ('dp-' + bid + '-' + n).slice(0, 80); }
    function review(x, file, status, extra) {
      var ex = x.d && x.d.existingId ? cur[x.d.existingId] : null;
      out.dupes.push(Object.assign({ id: dupeId(), kind: 'dupe', at: now, createdAt: now, updatedAt: now, batchId: bid, file: file, cls: x.d ? x.d.cls : 'possible', why: x.d ? x.d.why : 'possible', reason: x.d ? x.d.reason : '', conf: x.d ? x.d.conf : 'low',
        status: status, existingId: ex ? ex.id : null, existing: snap(ex), incoming: snap(x.trade), hours: x.d && x.d.hours || null, fields: x.d && x.d.fields || null, mode: x.d && x.d.mode || null, history: [] }, extra || {}));
    }
    plans.forEach(function (pp) {
      var p = pp.plan, file = String(pp.file || '').slice(0, 120);
      c.rows += p.rows || 0; c.invalid += Object.keys(p.problems || {}).reduce(function (a, k) { return a + p.problems[k].n; }, 0) + (p.invalid || []).length + (p.tooBig || 0);
      c.unsupported += Object.keys(p.unsupported || {}).reduce(function (a, k) { return a + p.unsupported[k]; }, 0);
      c.detected += p.trades.length + p.exact.length + p.updates.length + p.possible.length + p.ambiguous.length + p.conflicts.length;
      p.trades.forEach(function (x) {
        if (off[x.fp]) { c.deselected++; return; }
        var t = JSON.parse(JSON.stringify(x.trade)); t.createdAt = now; out.puts.push(t); out.tradeIds.push(t.id); out.hashes[t.id] = tradeHash(t); cur[t.id] = t; c.trades++;
        if (x.d && x.d.cls === 'possible') review(x, file, 'restored', { restoredId: t.id, history: [{ at: now, action: 'imported as a separate trade (ticked in the preview)' }] });
      });
      p.exact.forEach(function (x) { exact.push({ existingId: x.d.existingId, incoming: snap(x.trade), why: x.d.why, conf: x.d.conf, file: file }); c.duplicates++; });
      p.updates.forEach(function (x) {
        var ex = cur[x.d.existingId];
        if (!ex || !wantsUpdate(x, upd)) { review(x, file, 'review'); c.review++; return; }
        var after = applyUpdate(ex, x.trade, x.d.mode);
        out.updates.push({ id: ex.id, before: snap(ex), afterHash: tradeHash(after) }); out.puts.push(after);
        review(x, file, 'updated', { history: [{ at: now, action: 'update accepted in the preview', before: snap(ex), afterHash: tradeHash(after) }] });
        cur[ex.id] = after; c.updated++;
      });
      p.possible.forEach(function (x) { review(x, file, 'review'); c.review++; c.possible++; });
      p.ambiguous.forEach(function (x) { review(x, file, 'review'); c.review++; c.ambiguous++; });
      p.conflicts.forEach(function (x) { review(x, file, 'review'); c.review++; c.conflicts++; });
    });
    for (var i = 0; i < exact.length; i += EXACT_CHUNK) out.dupes.push({ id: ('dpx-' + bid + '-' + (i / EXACT_CHUNK)).slice(0, 80), kind: 'dupe', at: now, createdAt: now, updatedAt: now, batchId: bid, cls: 'exact', status: 'skipped', items: exact.slice(i, i + EXACT_CHUNK), history: [] });
    // updates replace earlier puts of the same trade in this write (an update on a trade added by this same import is folded in)
    var last = {}; out.puts.forEach(function (t, k) { last[t.id] = k; }); out.puts = out.puts.filter(function (t, k) { return last[t.id] === k; });
    out.tradeIds.forEach(function (id) { if (cur[id]) out.hashes[id] = tradeHash(cur[id]); });
    return out;
  }

  /* ---------- undoing one import ----------
     Removes the trades it added and reverses the updates it applied, but only where nothing changed since: a trade you edited (or gave
     screenshots) after the import is kept, and a decision you made later in the archive (e.g. a restored trade) is kept too.
     trades: {id: trade} as saved now; dupes: archive docs of this import; shots: {id: true} for trades with screenshots. */
  function buildRollback(doc, trades, dupes, shots, now) {
    var ops = [], r = { removed: 0, kept: 0, missing: 0, reverted: 0, keptUpdates: 0 };
    (doc.tradeIds || []).forEach(function (id) {
      var t = trades[id]; if (!t) { r.missing++; return; }
      if (tradeHash(t) !== (doc.hashes || {})[id] || (shots && shots[id])) { r.kept++; return; }
      ops.push({ store: 'trades', type: 'del', key: id }); r.removed++;
    });
    (doc.updates || []).forEach(function (u) {
      var t = trades[u.id]; if (!t || tradeHash(t) !== u.afterHash) { r.keptUpdates++; return; }
      ops.push({ store: 'trades', type: 'put', value: u.before }); r.reverted++;
    });
    (dupes || []).forEach(function (d) {
      var touched = (d.history || []).some(function (h) { return h.at > doc.at; }) || (d.items || []).some(function (it) { return it.restoredId; }) || (d.status !== 'skipped' && d.status !== 'review' && d.status !== 'updated' && d.status !== 'restored');
      if (touched) ops.push({ store: 'docs', type: 'put', value: Object.assign({}, d, { voided: { at: now, why: 'import rolled back' }, updatedAt: now }) });
      else ops.push({ store: 'docs', type: 'del', key: d.id });
    });
    ops.push({ store: 'docs', type: 'put', value: Object.assign({}, doc, { rolledBack: { at: now, removed: r.removed, kept: r.kept, missing: r.missing, reverted: r.reverted, keptUpdates: r.keptUpdates }, updatedAt: now }) });
    return { ops: ops, result: r };
  }

  var api = { hash: hash, stable: stable, buildCommit: buildCommit, buildRollback: buildRollback, updKey: updKey, wantsUpdate: wantsUpdate, AUTO_APPLY: AUTO_APPLY, contractKey: contractKey, acctKey: acctKey, instantKey: instantKey, priceKey: priceKey, contentKey: contentKey,
    fingerprint: fingerprint, shape: shape, legs: legs, material: material, feeChange: feeChange, tradeId: tradeId, REASON: REASON, CONF: CONF,
    index: index, add: add, addKeys: addKeys, classify: classify, applyUpdate: applyUpdate, asSeparate: asSeparate, scan: scan, pairKey: pairKey,
    impact: impact, tally: tally, snap: snap, tradeHash: tradeHash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTDedupe = api;
})(typeof window !== 'undefined' ? window : globalThis);
