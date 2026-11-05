/* Tamhas Trading - cloud sync engine (pure logic: no DOM, no network, no storage). Used by cloud.js; unit-tested in Node.

   How changes are found: for every synced record the device remembers the cloud version and a content hash it last agreed on
   ("base"). A record whose current hash differs from its base was changed here; a base without a record was deleted here. Nothing
   has to be logged at write time, so changes made by any screen, while offline, or before a crash are all found the same way.

   Rules (never last-write-wins):
   - push sends each change with the version it was based on. The server applies it only if the cloud still has that version.
   - if the cloud moved on, the server returns its copy as a CONFLICT. The device keeps its own copy and stores the cloud copy for
     the person to review. Nothing is overwritten or dropped silently.
   - pull applies cloud changes only to records that were NOT changed here since the last agreement; otherwise it is a conflict.
   - deletes travel as tombstones, so a deleted record cannot come back from another device.
   - a retry of a change that already reached the server is recognised (same hash) and acknowledged, never duplicated. */
(function (root) {
  'use strict';
  var FORMAT = 1;                                   // record format this app writes; bump when the shape of stored records changes
  var STORES = { trades: 'trade', accounts: 'account', ledger: 'ledger', docs: 'doc' };
  var KIND_STORE = { trade: 'trades', account: 'accounts', ledger: 'ledger', doc: 'docs' };
  var MAX_BYTES = 250000;                           // the server refuses records over 256 KB
  var ID_RX = /^[A-Za-z0-9_.:-]{1,80}$/;

  function stable(o) { return Array.isArray(o) ? '[' + o.map(stable).join(',') + ']' : (o && typeof o === 'object' ? '{' + Object.keys(o).filter(function (k) { return o[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}' : (o === undefined ? 'null' : JSON.stringify(o))); }
  function hash(str) {   // two independent 32-bit FNV-1a variants -> 16 hex characters
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef;
    for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193); h2 = Math.imul(h2 ^ c, 0x85ebca6b); h2 ^= h2 >>> 13; }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }
  // What is sent for a record: JSON only, minus things that stay on this device (saved copies of whole import files).
  function prepare(kind, rec) {
    if (!rec || typeof rec !== 'object') return null;
    var o = JSON.parse(JSON.stringify(rec));
    if (kind === 'doc' && o.kind === 'import' && o.copies) delete o.copies;
    return o;
  }
  // The same imported trade saved on two devices differs only in WHEN and in WHICH import added it (deterministic ids from the
  // execution keys make the id identical). That is the same trade, not a conflict: the cloud copy is kept.
  var IMPORT_META = ['createdAt', 'importBatch', 'updatedAt'];
  function sameRecord(kind, a, b) {
    if (kind !== 'trade' || !a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    var x = JSON.parse(JSON.stringify(a)), y = JSON.parse(JSON.stringify(b)); IMPORT_META.forEach(function (k) { delete x[k]; delete y[k]; });
    return stable(x) === stable(y);
  }
  function hashOf(kind, rec) { var p = prepare(kind, rec); return p ? hash(stable(p)) : null; }
  function keyOf(kind, id) { return kind + ':' + id; }
  function emptyState() { return { cursor: { tx: 0, rev: 0 }, base: {}, conflicts: [], skipped: {}, lastSync: null, lastError: null, format: FORMAT }; }
  function cleanState(s) {
    var e = emptyState(); if (!s || typeof s !== 'object') return e;
    return { cursor: s.cursor && isFinite(s.cursor.tx) && isFinite(s.cursor.rev) ? { tx: +s.cursor.tx, rev: +s.cursor.rev } : e.cursor, base: s.base && typeof s.base === 'object' ? s.base : {},
      conflicts: Array.isArray(s.conflicts) ? s.conflicts : [], skipped: s.skipped && typeof s.skipped === 'object' ? s.skipped : {}, lastSync: s.lastSync || null, lastError: s.lastError || null, format: FORMAT,
      massDelete: s.massDelete && Array.isArray(s.massDelete.keys) ? s.massDelete : undefined, allowDeletes: isFinite(s.allowDeletes) ? +s.allowDeletes : undefined };
  }

  /* local: {trades:[...], accounts:[...], ledger:[...], docs:[...]}  ->  list of changes to push and records that cannot be sent */
  function diff(local, state) {
    var base = state.base, seen = {}, changes = [], skipped = {};
    Object.keys(STORES).forEach(function (store) {
      var kind = STORES[store];
      (local[store] || []).forEach(function (rec) {
        if (!rec || typeof rec.id !== 'string') return;
        var k = keyOf(kind, rec.id); seen[k] = 1;
        if (!ID_RX.test(rec.id)) { skipped[k] = 'id'; return; }
        var data = prepare(kind, rec), h = hash(stable(data)), b = base[k];
        if (b && !b.d && b.h === h) return;                                 // unchanged since the last agreement
        if (state.conflicts.some(function (c) { return c.key === k; })) return;   // waiting for the person to decide
        if (JSON.stringify(data).length > MAX_BYTES) { skipped[k] = 'size'; return; }
        changes.push({ kind: kind, id: rec.id, base: b ? b.v : null, hash: h, deleted: false, data: data });
      });
    });
    Object.keys(base).forEach(function (k) {
      if (seen[k] || base[k].d) return;
      if (state.conflicts.some(function (c) { return c.key === k; })) return;
      var i = k.indexOf(':'); changes.push({ kind: k.slice(0, i), id: k.slice(i + 1), base: base[k].v, hash: hash('deleted:' + k + ':' + base[k].v), deleted: true });
    });
    return { changes: changes, skipped: skipped };
  }
  function pendingCount(local, state) { var d = diff(local, state); return d.changes.length; }

  /* results from trc_push -> new state + conflicts + problems. Never marks a change as saved unless the server said applied/same. */
  function applyPush(state, sent, results) {
    var s = cleanState(JSON.parse(JSON.stringify(state))), byKey = {}, out = { saved: 0, conflicts: 0, problems: [], tooOld: false, adopt: [], duplicates: [] };
    sent.forEach(function (c) { byKey[keyOf(c.kind, c.id)] = c; });
    (results || []).forEach(function (r) {
      var k = keyOf(r.kind, r.id), c = byKey[k]; if (!c) return;
      if (r.status === 'applied' || r.status === 'same') { s.base[k] = { v: r.version, h: c.deleted ? null : c.hash, d: !!c.deleted }; delete s.skipped[k]; out.saved++; }
      else if (r.status === 'conflict' && r.server && isPref(c.kind, c.data)) { s.base[k] = { v: r.server.version, h: r.server.deleted ? null : hashOf(c.kind, r.server.data), d: !!r.server.deleted }; out.retry = true; }   // preferences: this device's newer choice goes over on the next pass
      else if (r.status === 'conflict' && r.server && !c.deleted && !r.server.deleted && sameRecord(c.kind, c.data, r.server.data)) { s.base[k] = { v: r.server.version, h: hashOf(c.kind, r.server.data), d: false }; out.adopt.push({ store: KIND_STORE[c.kind], value: r.server.data }); out.saved++; }
      else if (r.status === 'conflict' && r.server) { addConflict(s, k, c, r.server); out.conflicts++; }
      else if (r.status === 'duplicate') { s.skipped[k] = 'duplicate'; out.duplicates.push({ key: k, id: c.id, of: r.of || null }); }
      else if (r.status === 'too_old') { out.tooOld = true; out.problems.push({ key: k, reason: 'too_old' }); }
      else { s.skipped[k] = r.status; out.problems.push({ key: k, reason: r.status }); }
    });
    return { state: s, result: out };
  }
  function addConflict(s, k, local, server) {
    s.conflicts = s.conflicts.filter(function (x) { return x.key !== k; });
    s.conflicts.push({ key: k, kind: k.slice(0, k.indexOf(':')), id: k.slice(k.indexOf(':') + 1), at: Date.now(), local: local.deleted ? { deleted: true } : { deleted: false, data: local.data },
      server: { version: server.version, deleted: !!server.deleted, data: server.deleted ? null : server.data, hash: server.hash, updated_at: server.updated_at || null, device: server.device || null } });
  }

  /* Things every device creates by itself on first start (the untouched "Main account", app preferences). If such a record was never
     synced from this device, the cloud copy is taken instead of raising a conflict. Anything a person edited is never treated this way. */
  function autoDefault(kind, rec) {
    if (!rec) return false;
    if (kind === 'account') return rec.id === 'acct-default' && rec.category === 'unassigned' && rec.name === 'Main account' && !rec.note;
    if (kind === 'doc') return rec.kind === 'pref';
    return false;
  }
  // Display preferences (theme, layout, recently used tools) are not financial records: when two devices change them, the device
  // that saves last wins. Trades, accounts, money entries and all other saved items always go to the person for a decision.
  function isPref(kind, rec) { return kind === 'doc' && rec && rec.kind === 'pref'; }
  /* rows from trc_pull + the current local records -> operations to write locally (all in one transaction with the new state). */
  function applyPull(state, rows, localByKey) {
    var s = cleanState(JSON.parse(JSON.stringify(state))), ops = [], conflicts = 0, applied = 0;
    (rows || []).forEach(function (row) {
      var k = keyOf(row.kind, row.id), b = s.base[k], loc = localByKey[k], store = KIND_STORE[row.kind];
      if (!store) return;
      if (isFinite(row.tx) && isFinite(row.rev)) s.cursor = { tx: +row.tx, rev: +row.rev };
      if (b && b.v === row.version && !!b.d === !!row.deleted) return;     // we already agree on this version
      var remoteHash = row.deleted ? null : hashOf(row.kind, row.data);
      var localHash = loc ? hashOf(row.kind, loc) : null;
      var changedHere = b ? (loc ? (b.d || localHash !== b.h) : !b.d) : (!!loc && !autoDefault(row.kind, loc));
      if (s.conflicts.some(function (c) { return c.key === k; })) changedHere = true;
      if (!changedHere) {
        if (row.deleted) { if (loc) ops.push({ store: store, type: 'del', key: row.id }); }
        else ops.push({ store: store, type: 'put', value: row.data });
        s.base[k] = { v: row.version, h: remoteHash, d: !!row.deleted }; applied++;
      } else if ((row.deleted && !loc) || (!row.deleted && loc && localHash === remoteHash)) {
        s.base[k] = { v: row.version, h: remoteHash, d: !!row.deleted };   // both sides ended up the same
      } else if (loc && !row.deleted && sameRecord(row.kind, loc, row.data)) {
        ops.push({ store: store, type: 'put', value: row.data }); s.base[k] = { v: row.version, h: remoteHash, d: false }; applied++;   // same imported trade from another device
      } else if (loc && isPref(row.kind, loc)) {
        s.base[k] = { v: row.version, h: remoteHash, d: !!row.deleted };    // preferences: keep this device's change; it is pushed over the cloud copy
      } else {
        addConflict(s, k, loc ? { deleted: false, data: prepare(row.kind, loc) } : { deleted: true }, row); conflicts++;
      }
    });
    return { state: s, ops: ops, applied: applied, conflicts: conflicts };
  }

  /* The person's decision on a conflict: 'device' keeps this device's copy (it will be pushed over the cloud version), 'cloud' takes the
     cloud copy, 'both' keeps both (this device's copy is saved under a new id; only for trades, money entries and saved items). */
  function resolve(state, key, choice, newId) {
    var s = cleanState(JSON.parse(JSON.stringify(state))), c = s.conflicts.filter(function (x) { return x.key === key; })[0], ops = [];
    if (!c) return { state: s, ops: ops };
    var store = KIND_STORE[c.kind], sv = c.server;
    s.conflicts = s.conflicts.filter(function (x) { return x.key !== key; });
    if (choice === 'device') {
      s.base[key] = { v: sv.version, h: sv.deleted ? null : hashOf(c.kind, sv.data), d: sv.deleted };
      if (c.local.deleted) ops.push({ store: store, type: 'del', key: c.id });   // stays deleted; diff() sends the delete
    } else if (choice === 'cloud' || choice === 'both') {
      if (choice === 'both' && !c.local.deleted && c.kind !== 'account') { var copy = JSON.parse(JSON.stringify(c.local.data)); copy.id = newId || (c.id + '-copy'); ops.push({ store: store, type: 'put', value: copy }); }
      if (sv.deleted) ops.push({ store: store, type: 'del', key: c.id }); else ops.push({ store: store, type: 'put', value: sv.data });
      s.base[key] = { v: sv.version, h: sv.deleted ? null : hashOf(c.kind, sv.data), d: sv.deleted };
    }
    return { state: s, ops: ops };
  }

  /* Linking this device's guest data to a login: compare guest records with what the login already has. */
  function migrationPlan(guest, account, fingerprint) {
    var plan = { add: [], same: [], differ: [], lookalike: [], bad: [] }, accFp = {};
    if (fingerprint) (account.trades || []).forEach(function (t) { var f = fingerprint(t); if (f) accFp[f] = t.id; });
    Object.keys(STORES).forEach(function (store) {
      var kind = STORES[store], have = {}; (account[store] || []).forEach(function (r) { if (r && r.id) have[r.id] = r; });
      (guest[store] || []).forEach(function (r) {
        if (!r || typeof r.id !== 'string' || !ID_RX.test(r.id)) { plan.bad.push({ store: store, rec: r }); return; }
        var ex = have[r.id], item = { store: store, kind: kind, rec: r };
        if (kind === 'account' && r.id === 'acct-default' && ex) { plan.same.push(item); return; }   // every login has its own "Main account"
        if (ex) { if (hashOf(kind, ex) === hashOf(kind, r)) plan.same.push(item); else plan.differ.push(Object.assign({ existing: ex }, item)); return; }
        if (kind === 'trade' && fingerprint) { var f = fingerprint(r); if (f && accFp[f]) { plan.lookalike.push(Object.assign({ existingId: accFp[f] }, item)); return; } }
        plan.add.push(item);
      });
    });
    return plan;
  }

  var api = { FORMAT: FORMAT, STORES: STORES, KIND_STORE: KIND_STORE, MAX_BYTES: MAX_BYTES, stable: stable, hash: hash, hashOf: hashOf, prepare: prepare, keyOf: keyOf,
    emptyState: emptyState, cleanState: cleanState, autoDefault: autoDefault, sameRecord: sameRecord, isPref: isPref, diff: diff, pendingCount: pendingCount, applyPush: applyPush, applyPull: applyPull, resolve: resolve, migrationPlan: migrationPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
