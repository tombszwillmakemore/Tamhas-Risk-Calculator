/* Tamhas Trading - TTStore: thin, safe wrapper over the generic `docs` object store (schema v3).
   Every saved item is {id, kind, createdAt, updatedAt, ...fields}. Kinds are validated against the same list the backup
   reader uses, so anything saved here is also backed up and restored. Nothing is ever sent anywhere. */
(function (root) {
  'use strict';
  var KINDS = (root.TTJournalCore && root.TTJournalCore.DOC_KINDS) || [];
  var cache = {};                       // kind -> array (invalidated on write)
  function db() { return root.TTDB; }
  function ready() { return db().ready(); }
  function idFor(kind) { return kind.slice(0, 3) + '-' + db().uid(''); }
  function check(kind) { if (KINDS.indexOf(kind) < 0) throw new Error('Unknown item kind: ' + kind); }

  function list(kind) {
    check(kind);
    if (cache[kind]) return Promise.resolve(cache[kind].slice());
    return ready().then(function () { return db().getByIndex('docs', 'kind', kind); }).then(function (rows) { cache[kind] = rows; return rows.slice(); });
  }
  function get(id) { return ready().then(function () { return db().get('docs', id); }); }
  function save(doc) {
    try { check(doc.kind); } catch (e) { return Promise.reject(e); }
    var now = Date.now(); var d = JSON.parse(JSON.stringify(doc));
    if (!d.id) { d.id = idFor(d.kind); d.createdAt = now; }
    d.updatedAt = now;
    return ready().then(function () { return db().put('docs', d); }).then(function () { delete cache[d.kind]; return d; });
  }
  function saveMany(docs) {
    var now = Date.now(), ops = [], kinds = {};
    var out = docs.map(function (doc) { check(doc.kind); var d = JSON.parse(JSON.stringify(doc)); if (!d.id) { d.id = idFor(d.kind); d.createdAt = now; } d.updatedAt = now; kinds[d.kind] = 1; ops.push({ store: 'docs', type: 'put', value: d }); return d; });
    return ready().then(function () { return db().batch(ops); }).then(function () { Object.keys(kinds).forEach(function (k) { delete cache[k]; }); return out; });
  }
  function remove(id, kind) {
    return ready().then(function () { return db().del('docs', id); }).then(function () { if (kind) delete cache[kind]; else cache = {}; });
  }
  function invalidate() { cache = {}; }

  /* Preferences: one doc per key (kind 'pref', id 'pref-<key>'). */
  var prefs = null;
  function loadPrefs() {
    if (prefs) return Promise.resolve(prefs);
    return list('pref').then(function (rows) { prefs = {}; rows.forEach(function (r) { prefs[r.key] = r.value; }); return prefs; });
  }
  function getPref(key, fallback) { return loadPrefs().then(function (p) { return Object.prototype.hasOwnProperty.call(p, key) ? p[key] : fallback; }); }
  function setPref(key, value) {
    return loadPrefs().then(function (p) { p[key] = value; return save({ id: 'pref-' + key, kind: 'pref', key: key, value: value }); }).then(function (d) { return d.value; });
  }

  root.TTStore = { list: list, get: get, save: save, saveMany: saveMany, remove: remove, invalidate: invalidate, getPref: getPref, setPref: setPref, KINDS: KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TTStore;
})(typeof window !== 'undefined' ? window : globalThis);
