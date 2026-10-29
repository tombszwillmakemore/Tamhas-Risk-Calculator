/* Tamhas Trading - local database (IndexedDB), versioned, Promise-based.
   Stores: meta, accounts, trades, quarantine, audit, ledger (v2).
   Screenshots stay in the separate 'tt-journal' database (unchanged), so nothing there needs migrating.
   Everything lives on this device. Nothing is sent anywhere.

   Migration policy: your earlier journal in localStorage ('tt.journal.v1') is COPIED into this database and the
   original is left untouched. Unreadable data is quarantined (kept), never deleted. */
(function (root) {
  'use strict';
  var DB_NAME = 'tt-platform', SCHEMA_VERSION = 2, LEGACY_KEY = 'tt.journal.v1', DEFAULT_ACCOUNT_ID = 'acct-default';
  var dbp = null, readyp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var idb = root.indexedDB; if (!idb) { rej(new Error('IndexedDB is not available in this browser.')); return; }
      var rq; try { rq = idb.open(DB_NAME, SCHEMA_VERSION); } catch (e) { rej(e); return; }
      rq.onupgradeneeded = function (ev) { upgrade(rq.result, ev.oldVersion); };
      rq.onsuccess = function () { var db = rq.result; db.onversionchange = function () { db.close(); dbp = null; readyp = null; }; res(db); };
      rq.onerror = function () { rej(rq.error || new Error('Could not open the local database.')); };
      rq.onblocked = function () { rej(new Error('The database upgrade is blocked by another open Tamhas tab. Close other tabs and reload.')); };
    });
    dbp.catch(function () { dbp = null; });                 // allow a retry after a failure
    return dbp;
  }

  // Each step is additive, so an interrupted upgrade can safely run again. Add future versions below as `if (oldV < 2) {...}`.
  function upgrade(db, oldV) {
    if (oldV < 1) {
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('accounts', { keyPath: 'id' });
      var t = db.createObjectStore('trades', { keyPath: 'id' }); t.createIndex('accountId', 'accountId'); t.createIndex('date', 'date');
      db.createObjectStore('quarantine', { keyPath: 'id' });
      db.createObjectStore('audit', { keyPath: 'id' });
    }
    if (oldV < 2) {   // Batch 2: fees, payouts, deposits, transfers and firm-reported snapshots. Additive: no existing store is touched.
      var l = db.createObjectStore('ledger', { keyPath: 'id' }); l.createIndex('accountId', 'accountId');
    }
  }

  // Runs fn(tx) in one transaction. Resolves when the transaction COMMITS (so a resolved promise means the data is saved).
  function run(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var tx; try { tx = db.transaction(stores, mode); } catch (e) { rej(e); return; }
        var out; try { out = fn(tx); } catch (e) { try { tx.abort(); } catch (e2) { /* already aborted */ } rej(e); return; }
        tx.oncomplete = function () { res(out && typeof out === 'object' && 'result' in out ? out.result : out); };
        tx.onerror = function () { rej(tx.error || new Error('Write failed.')); };
        tx.onabort = function () { rej(tx.error || new Error('Write was cancelled.')); };
      });
    });
  }

  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var api = {
    DB_NAME: DB_NAME, SCHEMA_VERSION: SCHEMA_VERSION, LEGACY_KEY: LEGACY_KEY, DEFAULT_ACCOUNT_ID: DEFAULT_ACCOUNT_ID,
    open: open,
    getAll: function (store) { return run(store, 'readonly', function (tx) { return tx.objectStore(store).getAll(); }); },
    get: function (store, key) { return run(store, 'readonly', function (tx) { return tx.objectStore(store).get(key); }); },
    count: function (store) { return run(store, 'readonly', function (tx) { return tx.objectStore(store).count(); }); },
    put: function (store, value) { return run(store, 'readwrite', function (tx) { tx.objectStore(store).put(value); }); },
    del: function (store, key) { return run(store, 'readwrite', function (tx) { tx.objectStore(store).delete(key); }); },
    clear: function (store) { return run(store, 'readwrite', function (tx) { tx.objectStore(store).clear(); }); },
    // ops: [{store, type:'put'|'del'|'clear', value|key}], applied atomically: all succeed or none do.
    batch: function (ops) {
      var names = []; ops.forEach(function (o) { if (names.indexOf(o.store) < 0) names.push(o.store); });
      if (!names.length) return Promise.resolve();
      return run(names, 'readwrite', function (tx) {
        ops.forEach(function (o) {
          var s = tx.objectStore(o.store);
          if (o.type === 'put') s.put(o.value); else if (o.type === 'del') s.delete(o.key); else if (o.type === 'clear') s.clear(); else throw new Error('Unknown operation ' + o.type);
        });
      });
    },
    getMeta: function (key) { return api.get('meta', key).then(function (r) { return r ? r.value : undefined; }); },
    setMeta: function (key, value) { return api.put('meta', { key: key, value: value }); },
    audit: function (type, details) { return api.put('audit', { id: uid('au'), at: Date.now(), type: type, details: details || null }); },
    uid: uid,
    ready: ready
  };

  function defaultAccount() { return { id: DEFAULT_ACCOUNT_ID, name: 'Main account', category: 'unassigned', archived: false, createdAt: Date.now(), note: '' }; }

  function ensureDefaults() {
    return api.count('accounts').then(function (n) { if (!n) return api.put('accounts', defaultAccount()); });
  }

  // Copies the pre-database journal into IndexedDB once. Never modifies or deletes the original localStorage entry.
  function migrateLegacy() {
    return api.getMeta('legacyMigrated').then(function (done) {
      if (done) return { migrated: false, info: done };
      var raw = null; try { raw = root.localStorage.getItem(LEGACY_KEY); } catch (e) { /* storage blocked: treat as no legacy data */ }
      var C = root.TTJournalCore;
      var parsed = raw && C ? C.parseStored(raw) : { trades: [], rejected: [], corrupt: false };
      var now = Date.now(), ops = [];
      parsed.trades.forEach(function (t) { ops.push({ store: 'trades', type: 'put', value: t }); });
      if (parsed.corrupt) ops.push({ store: 'quarantine', type: 'put', value: { id: 'legacy-corrupt-' + now, kind: 'legacy-journal-unreadable', at: now, raw: raw } });
      parsed.rejected.forEach(function (r, i) { ops.push({ store: 'quarantine', type: 'put', value: { id: 'legacy-rejected-' + now + '-' + i, kind: 'legacy-trade-rejected', at: now, record: r } }); });
      // Step 1: write the data. Step 2: verify it landed. Step 3: only then record that migration is done.
      // If anything fails or the tab closes before step 3, the next load simply repeats the (idempotent) copy.
      return api.batch(ops).then(function () { return api.count('trades'); }).then(function (n) {
        if (n < parsed.trades.length) throw new Error('Migration check failed: expected at least ' + parsed.trades.length + ' trades, found ' + n + '.');
        var info = { at: now, trades: parsed.trades.length, rejected: parsed.rejected.length, corrupt: !!parsed.corrupt, hadLegacyData: !!raw };
        return api.setMeta('legacyMigrated', info).then(function () { return api.audit('legacy-migration', info); }).then(function () { return { migrated: true, info: info }; });
      });
    });
  }

  function ready() {
    if (readyp) return readyp;
    readyp = open().then(ensureDefaults).then(migrateLegacy);
    readyp.catch(function () { readyp = null; });
    return readyp;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTDB = api;
})(typeof window !== 'undefined' ? window : globalThis);
