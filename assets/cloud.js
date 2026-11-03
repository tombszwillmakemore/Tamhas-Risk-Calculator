/* Tamhas Trading - TRC login, cloud saving and sync between devices (Supabase Auth + the rules in cloud/supabase.sql).
   - Talks to Supabase over HTTPS with the public project key only. Passwords go straight to Supabase and are never stored by TRC.
   - Your data stays in this device's database first (works offline); sync copies changes to your cloud account when online.
   - "Saved to cloud" is shown only after the server confirmed every change. Conflicts are kept for you to decide, never overwritten.
   - Signing in or out reloads the page so every screen shows only the current person's data (see cloud-boot.js).
   Screenshots stay on the device (not uploaded) - they are in your backup file. */
(function () {
  'use strict';
  var U = window.TTUI, DB = window.TTDB, SC = window.TTSyncCore, J = window.TTJournalCore, I = window.TTImport, BOOT = window.TTCloudBoot, esc = U.esc;
  var CFG = window.TT_CLOUD || {}, BASE = String(CFG.url || '').replace(/\/+$/, ''), KEY = String(CFG.anonKey || '');
  var ON = !!(BASE && KEY && /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE) && window.fetch);
  var AUTH = BOOT.AUTH, STATE_KEY = 'cloudSync', TIMEOUT = 20000, BATCH = 200;
  var root = document.getElementById('cloudRoot'), $ = function (s, r) { return (r || document).querySelector(s); };
  var ls = (function () { try { localStorage.getItem('x'); return localStorage; } catch (e) { return null; } })();
  var S = { status: 'guest', detail: '', pending: 0, conflicts: [], lastSync: null, usage: null, busy: false, form: 'signin', msg: null, user: null, expired: false, mig: null, cb: null, lastError: null, syncing: false };

  /* ---------------- session ---------------- */
  function readSession() { if (!ls) return null; try { var s = JSON.parse(ls.getItem(AUTH) || 'null'); return s && s.user && s.access_token ? s : null; } catch (e) { return null; } }
  function writeSession(s) { if (!ls) throw new Error('This browser is blocking storage (private mode?), so it cannot stay signed in. Use a normal window.'); ls.setItem(AUTH, JSON.stringify(s)); }
  function fromToken(t, prev) {   // expiry from "expires_in" (seconds from now), so a wrong device clock does not matter
    return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (+(t.expires_in) || 3600) * 1000,
      user: t.user ? { id: String(t.user.id).toLowerCase(), email: t.user.email || '', confirmed: !!(t.user.email_confirmed_at || t.user.confirmed_at), created_at: t.user.created_at || null, last_sign_in_at: t.user.last_sign_in_at || null, name: (t.user.user_metadata && t.user.user_metadata.display_name) || '' } : (prev && prev.user) };
  }
  var active = window.TT_ACTIVE_USER || null;    // whose data this page shows (fixed until reload)
  function sameUser(s) { return s && active && s.user.id === active; }

  /* ---------------- HTTP ---------------- */
  function http(method, path, body, token, opts) {
    opts = opts || {};
    if (!ON) return Promise.reject(err('off', 'Cloud saving is not set up for this copy of TRC.'));
    if (navigator.onLine === false && !opts.ignoreOffline) return Promise.reject(err('offline', 'You are offline. Your changes are saved on this device and will upload when you are back online.'));
    var ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || TIMEOUT);
    var headers = { apikey: KEY, 'Content-Type': 'application/json', Accept: 'application/json' }; if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(BASE + path, { method: method, headers: headers, body: body == null ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { clearTimeout(timer); return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = { message: t }; } if (!r.ok) throw httpErr(r.status, j); return j; }); },
        function (e) { clearTimeout(timer); throw err('network', e && e.name === 'AbortError' ? 'The cloud did not answer in time. Your changes are safe on this device; try again shortly.' : 'Could not reach the cloud. Check your connection; your changes are safe on this device.'); });
  }
  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  // Plain messages that never say whether an email address has an account.
  function httpErr(status, j) {
    var code = (j && (j.error_code || j.code || j.error)) || '', m = (j && (j.msg || j.message || j.error_description)) || '';
    var map = { invalid_credentials: 'Email or password is not correct.', invalid_grant: 'Email or password is not correct.', email_not_confirmed: 'Please confirm your email first. Use the link we sent you, or send it again below.',
      weak_password: 'Choose a longer password (at least 8 characters, ideally a phrase).', over_email_send_rate_limit: 'Too many emails were sent. Please wait a few minutes and try again.',
      over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.', refresh_token_not_found: 'expired', refresh_token_already_used: 'expired', session_not_found: 'expired', bad_jwt: 'expired',
      same_password: 'The new password must be different from the old one.', email_address_invalid: 'That email address does not look right.', validation_failed: 'Please check the email and password.', reauthentication_needed: 'Please sign in again first.' };
    var friendly = map[code] || (status === 429 ? map.over_request_rate_limit : status === 401 || status === 403 ? (/sign in again/i.test(m) ? 'Please sign in again first.' : 'expired') : status >= 500 ? 'The cloud service is having a problem right now. Your data is safe on this device; try again later.' : (/password/i.test(m) && /least|short|weak/i.test(m) ? map.weak_password : 'Something went wrong (' + status + '). Please try again.'));
    var e = err(friendly === 'expired' ? 'expired' : (code || 'http_' + status), friendly === 'expired' ? 'Your sign-in has expired. Please sign in again; your data on this device is safe.' : friendly); e.status = status; e.raw = m; return e;
  }

  /* refresh, one tab at a time (Web Locks), re-reading storage so tabs share the newest tokens */
  function withLock(name, fn) { if (navigator.locks && navigator.locks.request) return navigator.locks.request(name, fn); return fn(); }
  function token(force) {
    var s = readSession(); if (!s || !sameUser(s)) return Promise.reject(err('signed_out', 'Not signed in.'));
    if (!force && !s.provisional && s.expires_at - Date.now() > 60000) return Promise.resolve(s.access_token);
    return withLock('trc-auth-' + active, function () {
      var cur = readSession(); if (!cur || !sameUser(cur)) throw err('signed_out', 'Not signed in.');
      if (!force && !cur.provisional && cur.expires_at - Date.now() > 60000) return cur.access_token;
      return http('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: cur.refresh_token }).then(function (t) { var n = fromToken(t, cur); writeSession(n); S.expired = false; return n.access_token; })
        .catch(function (e) { if (e.code === 'expired' || e.status === 400) { S.expired = true; markExpired(); throw err('expired', 'Your sign-in has expired. Please sign in again; your data on this device is safe.'); } throw e; });
    });
  }
  function markExpired() { var s = readSession(); if (s && !s.expired) { s.expired = true; try { writeSession(s); } catch (e) {} } }
  function authed(method, path, body) {
    return token().then(function (t) { return http(method, path, body, t); }).catch(function (e) {
      if (e.code !== 'expired' || e.retried) throw e;
      return token(true).then(function (t) { return http(method, path, body, t); });
    });
  }
  function rpc(fn, args) { return authed('POST', '/rest/v1/rpc/' + fn, args || {}); }

  /* ---------------- sign up / in / out ---------------- */
  function redirectTo() { return location.origin + location.pathname; }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254; }
  function startSession(t) {
    var s = fromToken(t); if (!s.user || !s.user.id) throw err('bad', 'The sign-in response was incomplete. Please try again.');
    var was = active; writeSession(s);
    try { sessionStorage.setItem('tt.cloud.justSignedIn', '1'); } catch (e) {}
    if (was !== s.user.id) { location.hash = '#account'; location.reload(); return new Promise(function () {}); }
    return s;
  }
  function signUp(email, password, name) {
    return http('POST', '/auth/v1/signup?redirect_to=' + encodeURIComponent(redirectTo()), { email: email, password: password, data: { display_name: name || '' } })
      .then(function (r) { if (r && r.access_token) return startSession(r); return { checkEmail: true }; });   // with email confirmation on, no session until the link is opened
  }
  function signIn(email, password) { return http('POST', '/auth/v1/token?grant_type=password', { email: email, password: password }).then(startSession); }
  function magicLink(email) { return http('POST', '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectTo()), { email: email, create_user: false }).catch(function (e) { if (e.status === 400 || e.status === 422 || e.status === 404) return {}; throw e; }); }
  function recover(email) { return http('POST', '/auth/v1/recover?redirect_to=' + encodeURIComponent(redirectTo()), { email: email }).catch(function (e) { if (e.status === 400 || e.status === 404) return {}; throw e; }); }
  function resend(email) { return http('POST', '/auth/v1/resend', { type: 'signup', email: email, options: { email_redirect_to: redirectTo() } }); }
  // Fresh password check right before a sensitive action (change password, delete account, wipe cloud). The server also checks it.
  function reauth(password) {
    var s = readSession(); if (!s) return Promise.reject(err('signed_out', 'Not signed in.'));
    return http('POST', '/auth/v1/token?grant_type=password', { email: s.user.email, password: password }).then(function (t) { var n = fromToken(t, s); if (n.user.id !== active) throw err('bad', 'That is a different login.'); writeSession(n); return n.access_token; });
  }
  function refreshUser() { return authed('GET', '/auth/v1/user').then(function (u) { var s = readSession(); if (!s) return; s.user = fromToken({ user: u }).user; delete s.provisional; delete s.expired; writeSession(s); S.user = s.user; return s.user; }); }

  function wipeLocal(uid) {   // removes one login's copy from this device (never the guest data)
    var names = ['tt-platform~u-' + uid, 'tt-journal~u-' + uid];
    return Promise.all(names.map(function (n) { return new Promise(function (res) { try { var r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; } catch (e) { res(); } }); }))
      .then(function () { if (ls) BOOT.PERSONAL.forEach(function (k) { ls.removeItem('tt.u.' + uid + '.' + k); }); });
  }
  function signOut(opts) {
    opts = opts || {}; var s = readSession(), uid = active;
    var server = s && ON && navigator.onLine !== false ? http('POST', '/auth/v1/logout?scope=' + (opts.everywhere ? 'global' : 'local'), {}, s.access_token).catch(function () {}) : Promise.resolve();
    return server.then(function () {
      if (opts.everywhere && server && navigator.onLine === false) throw err('offline', 'Signing out of every device needs a connection.');
      if (ls) ls.removeItem(AUTH);
      return opts.removeLocal && uid ? DB.open().then(function (db) { db.close(); }).catch(function () {}).then(function () { return wipeLocal(uid); }) : null;
    }).then(function () { location.hash = '#account'; location.reload(); });
  }

  /* ---------------- sync ---------------- */
  // Changes to the sync state outside a sync (decisions on conflicts or deletions) wait for any running sync and hold the same lock,
  // so a sync that was already under way cannot save an older state over the decision.
  function mutateState(fn) {
    var wait = syncP ? syncP.catch(function () {}) : Promise.resolve();
    return wait.then(function () { return withLock('trc-sync-' + active, function () { return loadState().then(function (st) { return Promise.resolve(fn(st)).then(function (extraOps) { return DB.batch((extraOps || []).concat([{ store: 'meta', type: 'put', value: { key: STATE_KEY, value: st } }])); }); }); }); });
  }
  function loadState() { return DB.getMeta(STATE_KEY).then(function (s) { return SC.cleanState(s); }); }
  function readLocal() { return Promise.all(['trades', 'accounts', 'ledger', 'docs'].map(function (st) { return DB.getAll(st); })).then(function (r) { return { trades: r[0], accounts: r[1], ledger: r[2], docs: r[3] }; }); }
  function byKey(local) { var m = {}; Object.keys(SC.STORES).forEach(function (st) { (local[st] || []).forEach(function (r) { if (r && r.id) m[SC.keyOf(SC.STORES[st], r.id)] = r; }); }); return m; }
  var syncP = null, again = false;
  function syncNow(reason) {
    if (!ON || !active) return Promise.resolve(null);
    if (syncP) { again = true; return syncP; }
    var s = readSession(); if (!s || !sameUser(s) || s.expired) { setStatus(s && s.expired ? 'expired' : 'guest'); return Promise.resolve(null); }
    if (navigator.onLine === false) { return refreshPending().then(function () { setStatus('offline'); return null; }); }
    S.syncing = true; setStatus('syncing');
    syncP = withLock('trc-sync-' + active, function () { return runSync(); }).then(function (r) {
      syncP = null; S.syncing = false; if (again) { again = false; return syncNow('again'); } return r;
    }, function (e) {
      syncP = null; S.syncing = false; again = false; S.lastError = e.message;
      return loadState().then(function (st) { st.lastError = { at: Date.now(), msg: e.message }; return DB.setMeta(STATE_KEY, st); }).catch(function () {}).then(function () {
        return refreshPending().then(function () { setStatus(e.code === 'offline' || e.code === 'network' ? 'offline' : e.code === 'expired' ? 'expired' : 'failed', e.message); });
      });
    });
    return syncP;
  }
  function runSync() {
    var me = active, out = { pulled: 0, pushed: 0, conflicts: 0, problems: [], tooOld: false };
    function guard() { var s = readSession(); if (!s || s.user.id !== me) throw err('switched', 'The signed-in person changed; sync stopped.'); }
    function pullLoop(st) {
      guard();
      return rpc('trc_pull', { since_tx: st.cursor.tx, since_rev: st.cursor.rev, lim: 500 }).then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        if (!rows.length) return st;
        return readLocal().then(function (local) {
          guard(); var p = SC.applyPull(st, rows, byKey(local)); out.pulled += p.applied; out.conflicts += p.conflicts;
          var ops = p.ops.concat([{ store: 'meta', type: 'put', value: { key: STATE_KEY, value: p.state } }]);
          return DB.batch(ops).then(function () { return rows.length >= 500 ? pullLoop(p.state) : p.state; });   // local writes and the new cursor are saved together
        });
      });
    }
    function pushLoop(st) {
      guard();
      return readLocal().then(function (local) {
        var d = SC.diff(local, st);
        st.skipped = Object.assign({}, st.skipped, d.skipped);
        // Safety brake: a device about to delete a large share of the cloud (restore in replace mode, cleared or damaged local data, a bug)
        // stops and asks first. Small deletes go through normally.
        var dels = d.changes.filter(function (c) { return c.deleted; }), synced = Object.keys(st.base).filter(function (k) { return !st.base[k].d; }).length;
        if (dels.length > 25 && dels.length > synced * 0.5 && st.allowDeletes !== dels.length) { st.massDelete = { count: dels.length, of: synced, keys: dels.map(function (c) { return SC.keyOf(c.kind, c.id); }) }; out.massDelete = true; return DB.setMeta(STATE_KEY, st).then(function () { return st; }); }
        delete st.massDelete; delete st.allowDeletes;
        var batch = d.changes.slice(0, BATCH);
        if (!batch.length) return st;
        return rpc('trc_push', { items: batch, client_fmt: SC.FORMAT, client_device: deviceLabel() }).then(function (res) {
          guard(); var a = SC.applyPush(st, batch, res); out.pushed += a.result.saved; out.conflicts += a.result.conflicts; out.problems = out.problems.concat(a.result.problems); if (a.result.tooOld) out.tooOld = true;
          return DB.setMeta(STATE_KEY, a.state).then(function () { return (a.result.saved && d.changes.length > BATCH) || (a.result.retry && !st.prefRetried) ? (a.state.prefRetried = true, pushLoop(a.state)) : (delete a.state.prefRetried, a.state); });
        });
      });
    }
    return loadState().then(pullLoop).then(pushLoop).then(function (st) {
      return readLocal().then(function (local) {
        var pending = SC.diff(local, st).changes.length;
        if (!out.problems.length && !st.conflicts.length && !pending) { st.lastSync = Date.now(); st.lastError = null; }
        return DB.setMeta(STATE_KEY, st).then(function () {
          S.pending = pending; S.conflicts = st.conflicts; S.lastSync = st.lastSync; S.skipped = st.skipped; S.massDelete = st.massDelete || null;
          if (out.pulled) { try { window.dispatchEvent(new Event('tt:journal-changed')); } catch (e) {} if (window.TTJournal && window.TTJournal.reload) window.TTJournal.reload(); }
          // Changes made while this sync ran are not a failure: they upload on the next pass.
          if (pending && !out.problems.length && !st.conflicts.length && !st.massDelete && !out.tooOld && !out.massDelete) scheduleSync(1500);
          setStatus(out.tooOld ? 'old' : (st.conflicts.length || st.massDelete) ? 'attention' : out.problems.length ? 'failed' : pending ? 'pending' : 'saved', out.problems.length ? out.problems.length + ' item(s) could not be saved to the cloud (' + uniq(out.problems.map(function (p) { return p.reason; })).join(', ') + ').' : '');
          return out;
        });
      });
    });
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function deviceLabel() { var u = navigator.userAgent; return (/iPhone/.test(u) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : 'Browser') + (standalone() ? ' app' : ''); }
  function standalone() { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } }
  function refreshPending() { if (!active) return Promise.resolve(); return Promise.all([readLocal(), loadState()]).then(function (r) { S.pending = SC.diff(r[0], r[1]).changes.length; S.conflicts = r[1].conflicts; S.massDelete = r[1].massDelete || null; S.lastSync = r[1].lastSync; S.skipped = r[1].skipped; S.lastError = r[1].lastError && r[1].lastError.msg; }); }

  /* ---------------- status chip ---------------- */
  var LABEL = { off: 'ON THIS DEVICE', guest: 'ON THIS DEVICE', pending: 'SAVED ON DEVICE', syncing: 'SYNCING…', saved: 'SAVED TO CLOUD', offline: 'OFFLINE', attention: 'NEEDS ATTENTION', failed: 'SYNC FAILED', expired: 'SIGN IN AGAIN', old: 'UPDATE TRC' };
  function setStatus(st, detail) {
    if (st === 'saved' && S.pending) st = 'pending';
    S.status = st; S.detail = detail || '';
    var c = document.getElementById('syncChip');
    if (c) { c.setAttribute('data-state', st); c.querySelector('span').textContent = LABEL[st] || st; c.setAttribute('aria-label', 'Cloud: ' + (LABEL[st] || st).toLowerCase() + (S.pending ? ', ' + S.pending + ' change' + (S.pending === 1 ? '' : 's') + ' waiting' : '') + '. Open account.'); }
    if (root && isViewOpen()) {
      // Only the status panel changes on a status update; the rest of the screen (forms, decisions) is redrawn only when its content
      // changed, so taps and typing are never lost to a redraw.
      var key = S.conflicts.length + '|' + (S.massDelete ? S.massDelete.count : 0) + '|' + (S.mig ? S.mig.step : '') + '|' + !!readSession();
      var st0 = document.getElementById('clStatus');
      if (key === lastKey && st0) st0.innerHTML = statusPanel(); else render();
    }
  }
  var lastKey = null;
  function isViewOpen() { var v = document.getElementById('view-account'); return v && v.classList.contains('active'); }
  function chip() {
    var bar = document.querySelector('.topbar-r'); if (!bar || document.getElementById('syncChip')) return;
    var b = document.createElement('button'); b.type = 'button'; b.id = 'syncChip'; b.className = 'sync-chip'; b.setAttribute('data-go', 'account');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 00.6-7.95A6 6 0 006.1 9.2 4.5 4.5 0 007 18z"/></svg><span></span>';
    bar.insertBefore(b, bar.firstChild);
  }

  /* ---------------- migration of guest data ---------------- */
  function openGuest() {   // read-only look at this device's guest database; never creates or changes it
    return new Promise(function (res) {
      var r; try { r = indexedDB.open('tt-platform'); } catch (e) { res(null); return; }
      r.onupgradeneeded = function () { try { r.transaction.abort(); } catch (e) {} };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); }; r.onblocked = function () { res(null); };
    });
  }
  function guestData() {
    return openGuest().then(function (db) {
      if (!db) return null;
      var names = ['trades', 'accounts', 'ledger', 'docs'].filter(function (n) { return db.objectStoreNames.contains(n); });
      if (!names.length) { db.close(); return null; }
      return new Promise(function (res) {
        var tx = db.transaction(names, 'readonly'), out = { trades: [], accounts: [], ledger: [], docs: [] };
        names.forEach(function (n) { var q = tx.objectStore(n).getAll(); q.onsuccess = function () { out[n] = q.result || []; }; });
        tx.oncomplete = function () { db.close(); res(out); }; tx.onerror = function () { db.close(); res(null); };
      });
    });
  }
  function hasGuestData(g) { return g && (g.trades.length || g.ledger.length || g.docs.filter(function (d) { return d.kind !== 'pref'; }).length || g.accounts.filter(function (a) { return a.id !== 'acct-default'; }).length); }
  function prepareMigration() {
    return Promise.all([guestData(), readLocal()]).then(function (r) {
      var g = r[0]; if (!hasGuestData(g)) { S.mig = null; return null; }
      var plan = SC.migrationPlan(g, r[1], I && I.fingerprint ? function (t) { var n = J.normalizeTrade(t); return n.ok ? I.fingerprint(n.trade) : null; } : null);
      S.mig = { guest: g, plan: plan, pick: { trades: true, accounts: true, ledger: true, docs: true }, differ: {}, step: 'intro' };
      return S.mig;
    });
  }
  function runMigration() {
    var m = S.mig, ops = [], n = 0, keys = [];
    function put(store, kind, rec) { ops.push({ store: store, type: 'put', value: rec }); keys.push([kind, rec]); n++; }
    m.plan.add.forEach(function (x) { if (m.pick[x.store]) put(x.store, x.kind, x.rec); });
    m.plan.differ.forEach(function (x) { var ch = m.differ[x.kind + ':' + x.rec.id] || 'cloud'; if (!m.pick[x.store]) return;
      if (ch === 'device') put(x.store, x.kind, x.rec); else if (ch === 'both' && x.kind !== 'account') { var c = JSON.parse(JSON.stringify(x.rec)); c.id = (x.rec.id + '-g').slice(0, 80); put(x.store, x.kind, c); } });
    var info = { at: Date.now(), copied: n, same: m.plan.same.length, lookalike: m.plan.lookalike.length, unreadable: m.plan.bad.length };
    ops.push({ store: 'meta', type: 'put', value: { key: 'guestMigration', value: info } });
    return DB.batch(ops).then(function () { m.step = 'uploading'; m.info = info; render(); return syncNow('migration'); }).then(function () {
      // Verified = every copied item has a cloud version the server confirmed with exactly this content.
      return loadState().then(function (st) { var left = keys.filter(function (kr) { var b = st.base[SC.keyOf(kr[0], kr[1].id)]; return !b || b.d || b.h !== SC.hashOf(kr[0], kr[1]); }).length; m.verified = !left; m.left = left; m.step = 'done'; render(); });
    });
  }
  function removeGuestCopy() {
    return U.confirm('Remove the guest copy from this device?', 'Your data is now in your TRC login and in the cloud. This removes the separate guest copy on this device only. Download a backup first if you want an extra copy.', 'REMOVE GUEST COPY', true).then(function (y) {
      if (!y) return; return Promise.all(['tt-platform', 'tt-journal'].map(function (n) { return new Promise(function (res) { var r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; }); }))
        .then(function () { if (ls) BOOT.PERSONAL.forEach(function (k) { ls.removeItem('tt.u.guest.' + k); }); S.mig = null; U.toast('Guest copy removed from this device.'); render(); });
    });
  }
  function downloadGuestBackup() {
    return guestData().then(function (g) { if (!g) return; var json = J.serializeBackup(g.trades, {}, { accounts: g.accounts, ledger: g.ledger, docs: g.docs }); save('trc-guest-backup-' + new Date().toISOString().slice(0, 10) + '.json', json); if (S.mig) S.mig.backedUp = true; render(); });
  }
  function save(name, text) { var b = new Blob([text], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 2000); }

  /* ---------------- export, usage, delete ---------------- */
  function exportCloud() {
    var all = [], cur = { tx: 0, rev: 0 };
    function page() { return rpc('trc_pull', { since_tx: cur.tx, since_rev: cur.rev, lim: 1000 }).then(function (rows) { rows = rows || []; all = all.concat(rows); if (rows.length) cur = { tx: rows[rows.length - 1].tx, rev: rows[rows.length - 1].rev }; return rows.length >= 1000 ? page() : all; }); }
    return page().then(function (rows) {
      var by = { trade: [], account: [], ledger: [], doc: [] }; rows.forEach(function (r) { if (!r.deleted && by[r.kind]) by[r.kind].push(r.data); });
      var json = J.serializeBackup(by.trade, {}, { accounts: by.account, ledger: by.ledger, docs: by.doc });
      var check = J.parseBackup ? J.parseBackup(json) : null;
      if (check && check.ok === false) throw err('bad', 'The export did not pass its own check, so it was not saved. Please report this.');
      save('trc-cloud-export-' + new Date().toISOString().slice(0, 10) + '.json', json); return by.trade.length;
    });
  }
  function askPassword(title, body, okLabel, danger) {
    return U.dialog({ title: title, body: body, ok: okLabel, danger: danger, fields: [{ name: 'v', label: 'Your TRC password', type: 'password', placeholder: 'Password' }], validate: function (o) { return o.v ? null : 'Enter your password.'; } })
      .then(valueOf);
  }

  /* ---------------- screen ---------------- */
  function when(t) { return t ? new Date(t).toLocaleString() : 'never'; }
  function statusPanel() {
    var st = S.status, explain = { saved: 'Every change on this device is saved in the cloud (confirmed by the server).', pending: S.pending + ' change' + (S.pending === 1 ? ' is' : 's are') + ' saved on this device and waiting to upload.',
      syncing: 'Uploading and downloading changes…', offline: 'You are offline. Everything is saved on this device and will upload when you are back online.' + (S.pending ? ' ' + S.pending + ' change' + (S.pending === 1 ? '' : 's') + ' waiting.' : ''),
      attention: S.massDelete ? 'Sync is paused: this device would delete many items from the cloud. Choose below.' : S.conflicts.length + ' item' + (S.conflicts.length === 1 ? ' was' : 's were') + ' changed on two devices. Choose which version to keep below; nothing has been overwritten.',
      failed: 'The last sync did not finish. ' + (S.detail || S.lastError || '') + ' Your data is safe on this device.', expired: 'Your sign-in expired. Your data on this device is safe; sign in again to keep syncing.',
      old: 'Some items in the cloud were saved by a newer version of TRC. Reload to update the app before syncing those.' };
    return '<div class="panel"><div class="ui-sec" style="margin:0 0 6px"><h2 style="margin:0">Cloud sync</h2><span class="ui-badge ' + (st === 'saved' ? 'good' : st === 'attention' || st === 'failed' || st === 'expired' || st === 'old' ? 'bad' : 'warn') + '">' + esc(LABEL[st] || st) + '</span></div>' +
      '<p class="note" style="margin-top:0" role="status" aria-live="polite">' + esc(explain[st] || '') + '</p><ul class="ui-list"><li><span>Last successful sync</span><b>' + esc(when(S.lastSync)) + '</b></li><li><span>Waiting to upload</span><b>' + S.pending + '</b></li><li><span>This device</span><b>' + esc(deviceLabel()) + '</b></li></ul>' +
      (st === 'expired' ? '<button type="button" class="btn wide" data-ca="reauth">SIGN IN AGAIN</button>' : '<button type="button" class="btn wide" data-ca="sync"' + (S.syncing || navigator.onLine === false ? ' disabled' : '') + '>' + (S.syncing ? '<span class="ui-spin" aria-hidden="true"></span>SYNCING…' : 'SYNC NOW') + '</button>') +
      (S.skipped && Object.keys(S.skipped).length ? '<p class="note warnline">' + Object.keys(S.skipped).length + ' item(s) stay on this device only (too large or unreadable for the cloud).</p>' : '') + '</div>';
  }
  function massDeletePanel() {
    var m = S.massDelete; if (!m) return '';
    return '<div class="panel" id="cloudMassDelete"><div class="ui-banner bad" role="alert"><b>This device is about to delete ' + m.count + ' of ' + m.of + ' items from the cloud.</b> That would remove them from all your devices. This can happen after restoring a backup in replace mode, or if this device lost its data. Sync is paused until you choose.</div>' +
      '<div class="ui-row" style="flex-wrap:wrap"><button type="button" class="btn" data-ca="md-restore">BRING THEM BACK FROM THE CLOUD</button><button type="button" class="btn ghost danger" data-ca="md-allow">YES, DELETE THEM EVERYWHERE</button></div></div>';
  }
  function conflictsPanel() {
    if (!S.conflicts.length) return '';
    return '<div class="panel" id="cloudConflicts"><h2>Needs your decision (' + S.conflicts.length + ')</h2><p class="note" style="margin-top:0">These were changed on this device and on another device before they could sync. Both versions are kept until you choose.</p><ul class="ui-list">' +
      S.conflicts.map(function (c) { var lab = { trade: 'Trade', account: 'Trading account', ledger: 'Money entry', doc: 'Saved item' }[c.kind] || c.kind;
        return '<li style="display:block"><b>' + esc(lab + ' ' + c.id) + '</b>' + diffSummary(c) + '<div class="ui-row" style="margin-top:6px;flex-wrap:wrap"><button type="button" class="btn sm" data-ca="keep-device" data-k="' + esc(c.key) + '">KEEP THIS DEVICE\'S</button><button type="button" class="btn ghost sm" data-ca="keep-cloud" data-k="' + esc(c.key) + '">KEEP OTHER DEVICE\'S</button>' + (c.kind !== 'account' && !c.local.deleted ? '<button type="button" class="btn ghost sm" data-ca="keep-both" data-k="' + esc(c.key) + '">KEEP BOTH</button>' : '') + '</div></li>'; }).join('') + '</ul></div>';
  }
  function describe(kind, d) {
    if (!d) return 'deleted';
    if (kind === 'trade') { var n = J.normalizeTrade(d), c = n.ok ? J.analyze([n.trade])[0].c : null; return esc(d.date + ' ' + (d.time || '') + ' ' + d.contract + ' ' + d.side + ' ' + (d.contracts || (d.entries ? d.entries.length + ' fills' : ''))) + (c && c.grossCents != null ? ' · ' + esc(J.fmtMoney(c.grossCents, true)) : '') + (d.notes ? ' · notes: "' + esc(String(d.notes).slice(0, 40)) + '"' : ''); }
    if (kind === 'ledger') return esc((d.type || '') + ' ' + (d.amountCents != null ? J.fmtMoney(d.amountCents) : '') + ' ' + (d.date || ''));
    if (kind === 'account') return esc((d.name || '') + ' · ' + (d.status || ''));
    return esc((d.kind || 'item') + (d.name || d.title ? ' "' + String(d.name || d.title).slice(0, 40) + '"' : ''));
  }
  function diffSummary(c) { return '<div class="note" style="margin:2px 0 0">This device: ' + describe(c.kind, c.local.deleted ? null : c.local.data) + '<br>Other device (' + esc(c.server.device || 'cloud') + (c.server.updated_at ? ', ' + esc(when(c.server.updated_at)) : '') + '): ' + describe(c.kind, c.server.deleted ? null : c.server.data) + '</div>'; }
  function migrationPanel() {
    var m = S.mig; if (!m) return '';
    var p = m.plan, cnt = function (st) { return p.add.filter(function (x) { return x.store === st; }).length; };
    if (m.step === 'done') return '<div class="panel"><h2>Your guest data</h2>' + (m.verified ? '<div class="ui-banner good">' + m.info.copied + ' items were added to your login and the server confirmed they are saved in the cloud.</div><p class="note">The separate guest copy is still on this device. You can keep it or remove it.</p><div class="ui-row" style="flex-wrap:wrap"><button type="button" class="btn ghost" data-ca="mig-keep">KEEP GUEST COPY</button><button type="button" class="btn ghost" data-ca="mig-remove">REMOVE GUEST COPY</button></div>' : '<div class="ui-banner warn">' + m.info.copied + ' items were added to your login on this device. ' + (m.left ? m.left + ' are still waiting to upload' : 'Some need your decision above') + '; they will finish on the next sync. The guest copy was not touched.</div>') + '</div>';
    if (m.step === 'uploading') return '<div class="panel"><h2>Linking your data</h2>' + U.progress(null, 'Uploading to your cloud account…') + '</div>';
    return '<div class="panel" id="cloudMigrate"><h2>Bring your existing data into this login?</h2><p class="note" style="margin-top:0">You are signed in as <b>' + esc(((S.user || (readSession() || {}).user) || {}).email || '') + '</b>. Only copy if this is your own login. This device has data from before you signed in (guest data). You can copy it into your TRC login so it syncs to your other devices. The guest copy is not changed or removed.</p>' +
      '<ul class="ui-list">' + [['trades', 'Trades'], ['accounts', 'Trading accounts'], ['ledger', 'Money entries'], ['docs', 'Plans, strategies, notes and settings']].map(function (x) { return '<li><label class="ui-chk" style="margin:0"><input type="checkbox" data-mpick="' + x[0] + '"' + (m.pick[x[0]] ? ' checked' : '') + '><span>' + x[1] + ': <b>' + cnt(x[0]) + '</b> new</span></label></li>'; }).join('') + '</ul>' +
      (p.same.length ? '<p class="note">' + p.same.length + ' already in your login (identical) - skipped.</p>' : '') +
      (p.lookalike.length ? '<p class="note">' + p.lookalike.length + ' trade(s) look identical to trades already in your login (same account, contract, time, size and prices) - skipped to avoid duplicates.</p>' : '') +
      (p.bad.length ? '<p class="note warnline">' + p.bad.length + ' unreadable item(s) stay in the guest data only.</p>' : '') +
      (p.differ.length ? '<h3 class="im-h3">Different in your login (' + p.differ.length + ')</h3><p class="note" style="margin-top:0">Same item, different content. Choose for each (default: keep what is in your login).</p><ul class="ui-list">' + p.differ.slice(0, 50).map(function (x) { var k = x.kind + ':' + x.rec.id, v = m.differ[k] || 'cloud'; return '<li style="display:block"><b>' + esc(x.rec.id) + '</b><div class="note" style="margin:2px 0">Guest: ' + describe(x.kind, x.rec) + '<br>Login: ' + describe(x.kind, x.existing) + '</div><select data-mdiff="' + esc(k) + '" aria-label="Choice for ' + esc(x.rec.id) + '"><option value="cloud"' + (v === 'cloud' ? ' selected' : '') + '>Keep the login version</option><option value="device"' + (v === 'device' ? ' selected' : '') + '>Use the guest version</option>' + (x.kind !== 'account' ? '<option value="both"' + (v === 'both' ? ' selected' : '') + '>Keep both</option>' : '') + '</select></li>'; }).join('') + '</ul>' : '') +
      '<div class="ui-row" style="margin-top:10px;flex-wrap:wrap"><button type="button" class="btn ghost" data-ca="mig-backup">' + (m.backedUp ? 'BACKUP DOWNLOADED ✓' : 'DOWNLOAD A BACKUP FIRST') + '</button><button type="button" class="btn" data-ca="mig-go">COPY INTO MY LOGIN</button><button type="button" class="btn ghost" data-ca="mig-skip">NOT NOW</button></div></div>';
  }
  function cbErrorHtml() { var cb = S.cb; return cb && cb.error ? '<div class="ui-banner bad" role="alert">' + esc(/expired|invalid/i.test(cb.error + cb.errorCode) ? 'That email link has expired or was already used. Ask for a new one' + (readSession() ? ' (sign out first, or use Change password).' : ' below.') : 'That email link did not work: ' + cb.error) + '</div>' : ''; }
  function signedOutHtml() {
    var f = S.form, cb = S.cb;
    var head = '<div class="panel"><p class="note" style="margin-top:0"><b>A TRC login is separate from your Tradovate or prop-firm trading accounts.</b> It lets you use the same journal on your phone, tablet and computer: changes are saved on the device first, then copied to your private cloud space when you are online.</p>' +
      '<ul class="note cl-why"><li>Your trades, accounts, money entries, plans and settings on every device</li><li>Works offline; nothing is lost if the connection drops</li><li>Only you can read your data (enforced by the database, not just the app)</li><li>Screenshots stay on the device (they are in your backup file)</li></ul>' +
      '<p class="note">Without a login TRC keeps working as a guest: everything stays in this browser on this device only.</p></div>';
    if (!ON) return head + '<div class="panel"><div class="ui-banner warn"><b>Cloud saving is not switched on for this copy of TRC yet.</b> The owner needs to connect a free Supabase project (see CLOUD-SETUP.md in the project). Until then everything stays on this device, exactly as before.</div></div>';
    var cbHtml = cbErrorHtml();
    var tabs = '<div class="ui-tabs" role="tablist" aria-label="Sign in or create a login"><button type="button" role="tab" aria-selected="' + (f === 'signin') + '" class="' + (f === 'signin' ? 'on' : '') + '" data-cform="signin">Sign in</button><button type="button" role="tab" aria-selected="' + (f === 'signup') + '" class="' + (f === 'signup' ? 'on' : '') + '" data-cform="signup">Create login</button></div>';
    var msg = S.msg ? '<div class="ui-banner ' + (S.msg.bad ? 'bad' : 'good') + '" role="' + (S.msg.bad ? 'alert' : 'status') + '">' + esc(S.msg.text) + (S.msg.resend ? ' <button type="button" class="btn ghost sm" data-ca="resend">SEND THE EMAIL AGAIN</button>' : '') + '</div>' : '';
    var pw = function (id, ac) { return '<div class="cl-pw"><input id="' + id + '" type="password" autocomplete="' + ac + '" minlength="8" maxlength="128" required><button type="button" class="btn ghost sm" data-ca="showpw" data-for="' + id + '" aria-pressed="false" aria-label="Show password">SHOW</button></div>'; };
    var form;
    if (f === 'signup') form = '<form class="ui-form" id="clForm" data-mode="signup" novalidate><label for="clName">Display name (optional)</label><input id="clName" type="text" maxlength="40" autocomplete="nickname"><label for="clEmail">Email</label><input id="clEmail" type="email" autocomplete="email" inputmode="email" required><label for="clPass">Password (8+ characters)</label>' + pw('clPass', 'new-password') + '<button type="submit" class="btn wide" style="margin-top:12px">CREATE MY LOGIN</button><p class="note">We email you a link to confirm the address. TRC never sees or stores your password; it goes straight to the sign-in service.</p></form>';
    else if (f === 'forgot') form = '<form class="ui-form" id="clForm" data-mode="forgot" novalidate><label for="clEmail">Email</label><input id="clEmail" type="email" autocomplete="email" inputmode="email" required><button type="submit" class="btn wide" style="margin-top:12px">EMAIL ME A RESET LINK</button><button type="button" class="btn ghost wide" data-cform="signin" style="margin-top:8px">BACK TO SIGN IN</button></form>';
    else if (f === 'magic') form = '<form class="ui-form" id="clForm" data-mode="magic" novalidate><label for="clEmail">Email</label><input id="clEmail" type="email" autocomplete="email" inputmode="email" required><button type="submit" class="btn wide" style="margin-top:12px">EMAIL ME A SIGN-IN LINK</button><p class="note">Open the link on this device. On a phone, if the link opens in the browser instead of the installed TRC app, sign in there once, or use your password in the app.</p><button type="button" class="btn ghost wide" data-cform="signin">USE MY PASSWORD</button></form>';
    else form = '<form class="ui-form" id="clForm" data-mode="signin" novalidate><label for="clEmail">Email</label><input id="clEmail" type="email" autocomplete="username" inputmode="email" required><label for="clPass">Password</label>' + pw('clPass', 'current-password') + '<button type="submit" class="btn wide" style="margin-top:12px">SIGN IN</button><div class="ui-row" style="margin-top:8px;flex-wrap:wrap"><button type="button" class="btn ghost sm" data-cform="forgot">FORGOT PASSWORD?</button><button type="button" class="btn ghost sm" data-cform="magic">EMAIL ME A SIGN-IN LINK</button></div></form>';
    return head + '<div class="panel">' + cbHtml + (f === 'signin' || f === 'signup' ? tabs : '') + msg + form + '</div>';
  }
  function recoveryHtml() {
    return '<div class="panel"><h2>Choose a new password</h2><form class="ui-form" id="clForm" data-mode="newpass" novalidate><label for="clPass">New password (8+ characters)</label><div class="cl-pw"><input id="clPass" type="password" autocomplete="new-password" minlength="8" maxlength="128" required><button type="button" class="btn ghost sm" data-ca="showpw" data-for="clPass" aria-pressed="false" aria-label="Show password">SHOW</button></div>' + (S.msg ? '<div class="ui-banner ' + (S.msg.bad ? 'bad' : 'good') + '" role="alert">' + esc(S.msg.text) + '</div>' : '') + '<button type="submit" class="btn wide" style="margin-top:12px">SAVE NEW PASSWORD</button></form></div>';
  }
  function signedInHtml() {
    var u = S.user || (readSession() || {}).user || {};
    var us = S.usage, lim = us && us.limits;
    return cbErrorHtml() + (S.cb && S.cb.type === 'recovery' && !S.cb.error ? recoveryHtml() : '') + '<div id="clStatus">' + statusPanel() + '</div>' + massDeletePanel() + conflictsPanel() + migrationPanel() +
      '<div class="panel"><h2>Your TRC login</h2><p class="note" style="margin-top:0">This is your TRC login, not a trading account.</p><ul class="ui-list"><li><span>Email</span><b>' + esc(u.email || '—') + '</b></li><li><span>Email confirmed</span><b>' + (u.confirmed ? 'yes' : 'not yet') + '</b></li><li><span>Display name</span><b>' + esc(u.name || '—') + '</b></li><li><span>Created</span><b>' + esc(u.created_at ? new Date(u.created_at).toLocaleDateString() : '—') + '</b></li><li><span>Last sign-in</span><b>' + esc(u.last_sign_in_at ? when(u.last_sign_in_at) : '—') + '</b></li></ul>' +
      '<div class="ui-row" style="margin-top:8px;flex-wrap:wrap"><button type="button" class="btn ghost sm" data-ca="name">CHANGE NAME</button><button type="button" class="btn ghost sm" data-ca="email">CHANGE EMAIL</button><button type="button" class="btn ghost sm" data-ca="password">CHANGE PASSWORD</button></div></div>' +
      '<div class="panel"><h2>Cloud storage</h2>' + (us ? '<ul class="ui-list"><li><span>Items in the cloud</span><b>' + us.records + (lim ? ' of ' + lim.max_records.toLocaleString() : '') + '</b></li><li><span>Space used</span><b>' + fmtBytes(us.bytes) + (lim ? ' of ' + fmtBytes(lim.max_bytes) : '') + '</b></li></ul>' + (lim && (us.records > lim.max_records * 0.8 || us.bytes > lim.max_bytes * 0.8) ? '<div class="ui-banner warn">You are close to your cloud space limit. New items will stay on this device until there is room.</div>' : '') : '<button type="button" class="btn ghost sm" data-ca="usage">SHOW USAGE</button>') + '<p class="note">Screenshots stay on this device and are not uploaded. The free cloud plan has no automatic server backups, so keep downloading backups.</p></div>' +
      '<div class="panel"><h2>Your data</h2><div class="ui-row" style="flex-wrap:wrap"><button type="button" class="btn ghost" data-ca="export">DOWNLOAD EVERYTHING IN THE CLOUD</button><button type="button" class="btn ghost" data-ca="backup">DOWNLOAD BACKUP OF THIS DEVICE</button></div><p class="note">Both files can be restored in Journal › Backup.</p></div>' +
      '<div class="panel"><h2>Sign out</h2><label class="ui-chk"><input type="checkbox" id="clRemove"><span>Also remove my data from this device (for a shared or borrowed device). Your cloud copy is kept.</span></label><div class="ui-row" style="flex-wrap:wrap;margin-top:8px"><button type="button" class="btn" data-ca="signout">SIGN OUT</button><button type="button" class="btn ghost" data-ca="signout-all">SIGN OUT ON ALL DEVICES</button></div></div>' +
      '<details class="panel io" id="clDanger"><summary>Delete cloud data or the whole login</summary><p class="note">Deleting cloud data removes every item from the cloud but keeps your login and the data on this device. Deleting the login removes the login and all cloud data. Both ask for your password. The free plan keeps no backups, so this cannot be undone - download everything first.</p><div class="ui-row" style="flex-wrap:wrap"><button type="button" class="btn ghost danger" data-ca="wipe">DELETE MY CLOUD DATA</button><button type="button" class="btn danger" data-ca="delete">DELETE MY TRC LOGIN</button></div></details>';
  }
  function fmtBytes(b) { return b == null ? '—' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  var lastHtml = null;
  function render() {
    if (!root) return;
    var s = readSession(), html = s && sameUser(s) ? signedInHtml() : signedOutHtml();
    lastKey = S.conflicts.length + '|' + (S.massDelete ? S.massDelete.count : 0) + '|' + (S.mig ? S.mig.step : '') + '|' + !!s;
    if (html === lastHtml && root.firstChild) return;   // nothing changed: keep the current elements (and focus)
    // Keep what the person has typed (and where the cursor is) across a redraw.
    var keep = {}, act = document.activeElement, actId = act && root.contains(act) ? act.id : null, sel = null;
    root.querySelectorAll('input[id], textarea[id], select[id]').forEach(function (el) { keep[el.id] = el.type === 'checkbox' ? { c: el.checked } : { v: el.value, t: el.type }; });
    try { if (actId && act.selectionStart != null) sel = [act.selectionStart, act.selectionEnd]; } catch (e) {}
    var openD = {}; root.querySelectorAll('details[id]').forEach(function (d) { openD[d.id] = d.open; });
    lastHtml = html; root.innerHTML = html;
    Object.keys(keep).forEach(function (id) { var el = document.getElementById(id); if (!el || !root.contains(el)) return; if ('c' in keep[id]) el.checked = keep[id].c; else if (keep[id].v && !el.value) { el.value = keep[id].v; if (keep[id].t === 'text' && el.getAttribute('autocomplete') && /password/.test(el.getAttribute('autocomplete'))) el.type = 'text'; } });
    Object.keys(openD).forEach(function (id) { var d = document.getElementById(id); if (d && root.contains(d)) d.open = openD[id]; });
    if (actId) { var f = document.getElementById(actId); if (f && root.contains(f)) { try { f.focus({ preventScroll: true }); if (sel && f.setSelectionRange) f.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  }

  /* ---------------- actions ---------------- */
  function say(text, bad, extra) { S.msg = Object.assign({ text: text, bad: !!bad }, extra || {}); render(); var b = root.querySelector('[role=alert],[role=status]'); if (b && b.focus) { b.setAttribute('tabindex', '-1'); b.focus(); } }
  function busy(btn, p, label) { return U.busy(btn, p, label); }
  root && root.addEventListener('submit', function (e) {
    var f = e.target; if (f.id !== 'clForm') return; e.preventDefault();
    var mode = f.getAttribute('data-mode'), email = ($('#clEmail', f) || {}).value, pass = ($('#clPass', f) || {}).value, name = ($('#clName', f) || {}).value, btn = f.querySelector('[type=submit]');
    email = (email || '').trim().toLowerCase(); S.lastEmail = email || S.lastEmail;
    if (mode !== 'newpass' && !validEmail(email)) { say('That email address does not look right.', true); return; }
    if ((mode === 'signin' || mode === 'signup' || mode === 'newpass') && (!pass || pass.length < (mode === 'signin' ? 1 : 8))) { say(mode === 'signin' ? 'Enter your password.' : 'Choose a password of at least 8 characters.', true); return; }
    var p = mode === 'signup' ? signUp(email, pass, (name || '').trim().slice(0, 40)).then(function (r) { if (r && r.checkEmail) say('Check your inbox: we sent a link to ' + email + ' to confirm it. After confirming, sign in here. (If you already had a login, use Sign in or Forgot password.)', false, { resend: true }); })
      : mode === 'signin' ? signIn(email, pass)
      : mode === 'forgot' ? recover(email).then(function () { say('If there is a TRC login for ' + email + ', a reset link is on its way. It works once and expires after a while.'); })
      : mode === 'magic' ? magicLink(email).then(function () { say('If there is a TRC login for ' + email + ', a sign-in link is on its way.'); })
      : authed('PUT', '/auth/v1/user', { password: pass }).then(function () { S.cb = null; try { sessionStorage.removeItem('tt.auth.cb'); } catch (x) {} U.toast('New password saved.'); return refreshUser().then(render); });
    busy(btn, p.catch(function (x) { say(x.message, true, x.code === 'email_not_confirmed' ? { resend: true } : null); }), 'PLEASE WAIT…');
  });
  root && root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cform],[data-ca]'); if (!t) return;
    var f = t.getAttribute('data-cform'); if (f) { S.form = f; S.msg = null; render(); var i = $('#clEmail'); if (i) i.focus(); return; }
    var a = t.getAttribute('data-ca'), k = t.getAttribute('data-k');
    if (a === 'showpw') { var inp = document.getElementById(t.getAttribute('data-for')), show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; t.textContent = show ? 'HIDE' : 'SHOW'; t.setAttribute('aria-pressed', String(show)); t.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); return; }
    if (a === 'resend') { busy(t, resend(S.lastEmail || '').then(function () { say('Sent again. It can take a minute; check spam too.'); }, function (x) { say(x.message, true); }), 'SENDING…'); return; }
    if (a === 'sync') { busy(t, syncNow('button'), 'SYNCING…'); return; }
    if (a === 'reauth') { var s0 = readSession(); askPassword('Sign in again', 'Your sign-in expired. Enter your password to continue syncing.', 'SIGN IN').then(function (pw) { if (!pw) return; return signIn(s0.user.email, pw).then(function () { var s = readSession(); delete s.expired; writeSession(s); S.expired = false; return syncNow('reauth'); }); }).catch(function (x) { U.toast(x.message, true); }); return; }
    if (a === 'keep-device' || a === 'keep-cloud' || a === 'keep-both') {
      mutateState(function (st) { var r = SC.resolve(st, k, a === 'keep-device' ? 'device' : a === 'keep-cloud' ? 'cloud' : 'both', (k.split(':').slice(1).join(':') + '-' + Date.now().toString(36)).slice(0, 80));
        Object.keys(st).forEach(function (x) { delete st[x]; }); Object.assign(st, r.state); return r.ops; })
        .then(function () { try { window.dispatchEvent(new Event('tt:journal-changed')); } catch (x) {} if (window.TTJournal) window.TTJournal.reload(); U.toast('Decision saved.'); return syncNow('resolve'); }).catch(function (x) { U.toast(x.message || 'Could not save that decision.', true); });
      return;
    }
    if (a === 'md-allow') { U.confirm('Delete ' + S.massDelete.count + ' items from the cloud?', 'They will be removed from every device you sign in on. The free plan keeps no server backups.', 'DELETE EVERYWHERE', true).then(function (y) { if (!y) return; return mutateState(function (st) { st.allowDeletes = (st.massDelete || {}).count; delete st.massDelete; }).then(function () { return syncNow('allow-deletes'); }); }).catch(function (x) { U.toast((x && x.message) || 'Could not save that decision.', true); }); return; }
    if (a === 'md-restore') { mutateState(function (st) { (st.massDelete ? st.massDelete.keys : []).forEach(function (k) { delete st.base[k]; }); delete st.massDelete; st.cursor = { tx: 0, rev: 0 }; }).then(function () { return syncNow('restore-deleted'); }).then(function () { U.toast('Brought back from the cloud.'); try { window.dispatchEvent(new Event('tt:journal-changed')); } catch (x) {} }).catch(function (x) { console.error('trc restore', x); U.toast((x && x.message) || 'Could not bring them back. Nothing was deleted.', true); }); return; }
    if (a === 'usage') { busy(t, rpc('trc_usage').then(function (u) { S.usage = u; render(); }, function (x) { U.toast(x.message, true); })); return; }
    if (a === 'export') { busy(t, exportCloud().then(function (n) { U.toast('Downloaded ' + n + ' trades and everything else in your cloud.'); }, function (x) { U.toast(x.message, true); }), 'PREPARING…'); return; }
    if (a === 'backup') { if (window.TTNav) window.TTNav.go('journal'); setTimeout(function () { var b = document.querySelector('#view-journal [data-act=tab][data-tab=backup]'); if (b) b.click(); }, 120); return; }
    if (a === 'name') { U.dialog({ title: 'Display name', fields: [{ name: 'v', label: 'Name', value: (S.user || {}).name || '' }], ok: 'SAVE' }).then(function (v) { var nm = valueOf(v); if (nm == null) return; return authed('PUT', '/auth/v1/user', { data: { display_name: String(nm).trim().slice(0, 40) } }).then(refreshUser).then(function () { U.toast('Name saved.'); render(); }); }).catch(function (x) { U.toast(x.message, true); }); return; }
    if (a === 'email') { U.dialog({ title: 'Change email', body: 'We email a confirmation link to the new address (and, depending on settings, the old one). The change only happens after you confirm.', fields: [{ name: 'v', label: 'New email', type: 'email' }], ok: 'SEND LINK' }).then(function (v) { var em = valueOf(v); if (em == null) return; em = String(em).trim().toLowerCase(); if (!validEmail(em)) throw err('bad', 'That email address does not look right.'); return authed('PUT', '/auth/v1/user?redirect_to=' + encodeURIComponent(redirectTo()), { email: em }).then(function () { U.toast('Check ' + em + ' for the confirmation link.'); }); }).catch(function (x) { U.toast(x.message, true); }); return; }
    if (a === 'password') { askPassword('Change password', 'First, your current password.', 'CONTINUE').then(function (pw) { if (!pw) return; return reauth(pw).then(function () { return U.dialog({ title: 'New password', fields: [{ name: 'v', label: 'New password (8+ characters)', type: 'password' }], ok: 'SAVE' }); }).then(function (v) { var np = valueOf(v); if (!np) return; if (String(np).length < 8) throw err('weak', 'Choose a password of at least 8 characters.'); return authed('PUT', '/auth/v1/user', { password: np }).then(function () { U.toast('Password changed.'); }); }); }).catch(function (x) { U.toast(x.message, true); }); return; }
    if (a === 'signout' || a === 'signout-all') { signOutFlow(a === 'signout-all', !!($('#clRemove') || {}).checked); return; }
    if (a === 'wipe' || a === 'delete') { dangerFlow(a); return; }
    if (a === 'mig-backup') { downloadGuestBackup(); return; }
    if (a === 'mig-go') { root.querySelectorAll('[data-mpick]').forEach(function (c) { S.mig.pick[c.getAttribute('data-mpick')] = c.checked; }); root.querySelectorAll('[data-mdiff]').forEach(function (c) { S.mig.differ[c.getAttribute('data-mdiff')] = c.value; }); busy(t, runMigration().catch(function (x) { S.mig.step = 'intro'; U.toast(x.message || 'Could not finish. Nothing in the guest data was changed.', true); render(); }), 'COPYING…'); return; }
    if (a === 'mig-skip') { DB.setMeta('guestMigration', { at: Date.now(), skipped: true }).then(function () { S.mig = null; render(); U.toast('Skipped. You can do it later from this screen.'); }); return; }
    if (a === 'mig-keep') { S.mig = null; render(); return; }
    if (a === 'mig-remove') { removeGuestCopy(); return; }
    if (a === 'mig-again') { prepareMigration().then(render); return; }
  });
  function valueOf(o) { return o && typeof o === 'object' ? (o.v == null ? null : o.v) : null; }
  function signOutFlow(everywhere, removeLocal) {
    refreshPending().then(function () {
      var waiting = S.pending + S.conflicts.length;
      if (removeLocal && waiting) return U.confirm('Changes have not reached the cloud yet', waiting + ' change(s) are only on this device. Removing this device\'s copy now would lose them. Sync first (when online), then sign out.', 'SYNC NOW', false).then(function (y) { if (y) return syncNow('signout'); });
      var body = (navigator.onLine === false ? 'You are offline: this signs out this device only; the session on the server ends when it expires (use Sign out on all devices later to end it now). ' : '') + (waiting ? waiting + ' change(s) have not reached the cloud yet. They stay safely in your copy on this device and upload the next time you sign in here. ' : '') + (removeLocal ? 'Your data will be removed from this device; it stays in the cloud. ' : 'Your copy stays on this device for the next time you sign in. ') + 'This device then goes back to guest mode.';
      return U.confirm(everywhere ? 'Sign out on all devices?' : 'Sign out?', body, 'SIGN OUT', false).then(function (y) { if (y) return signOut({ everywhere: everywhere, removeLocal: removeLocal }); });
    }).catch(function (x) { U.toast(x.message, true); });
  }
  function dangerFlow(a) {
    var del = a === 'delete';
    askPassword(del ? 'Delete your TRC login?' : 'Delete your cloud data?', del ? 'This deletes your login and every item in the cloud. Data on this device stays until you remove it. This cannot be undone.' : 'This deletes every item in the cloud. Your login and this device\'s data stay; the next sync uploads this device\'s data again.', del ? 'DELETE LOGIN' : 'DELETE CLOUD DATA', true)
      .then(function (pw) { if (!pw) return; return reauth(pw).then(function () { return rpc(del ? 'trc_delete_account' : 'trc_wipe'); }).then(function (r) {
        if (!del) { return mutateState(function (st) { var e = SC.emptyState(); Object.keys(st).forEach(function (x) { delete st[x]; }); Object.assign(st, e); }).then(function () { U.toast('Cloud data deleted (' + (r && r.deleted) + ' items).'); return refreshPending(); }).then(render); }
        var uid = active; if (ls) ls.removeItem(AUTH);
        return U.confirm('Login deleted', 'Your TRC login and its cloud data were deleted. Also remove its copy from this device?', 'REMOVE FROM THIS DEVICE', true).then(function (y) { return y ? wipeLocal(uid) : null; }).then(function () { location.hash = '#account'; location.reload(); });
      }); }).catch(function (x) { U.toast(x.message, true); });
  }

  /* ---------------- wiring ---------------- */
  var debounce = null;
  function scheduleSync(ms) { if (!ON || !active) return; clearTimeout(debounce); debounce = setTimeout(function () { syncNow('change'); }, ms == null ? 2500 : ms); }
  function init() {
    chip();
    try { var raw = sessionStorage.getItem('tt.auth.cb'); if (raw) { S.cb = JSON.parse(raw); sessionStorage.removeItem('tt.auth.cb'); } } catch (e) {}
    if (!S.cb && window.TT_AUTH_CALLBACK) S.cb = window.TT_AUTH_CALLBACK;
    if (S.cb && S.cb.type === 'recovery') { try { sessionStorage.setItem('tt.auth.cb', JSON.stringify(S.cb)); } catch (e) {} }
    if (!ON) { setStatus('off'); return; }
    var s = readSession();
    if (!s || !sameUser(s)) { setStatus('guest'); return; }
    S.user = s.user;
    if (s.expired) { setStatus('expired'); refreshPending().then(function () { setStatus('expired'); }); return; }
    var first = (s.provisional ? refreshUser().catch(function (e) { if (e.code === 'expired') { if (ls) ls.removeItem(AUTH); location.reload(); } throw e; }) : Promise.resolve());
    first.then(function () { return refreshPending(); }).then(function () { setStatus(S.pending ? 'pending' : 'saved'); return syncNow('start'); })
      .then(function () { return DB.getMeta('guestMigration'); }).then(function (done) { if (!done) return prepareMigration(); })
      .then(function () { render(); if (S.mig && (sessionStorage.getItem('tt.cloud.justSignedIn') || S.cb)) { try { sessionStorage.removeItem('tt.cloud.justSignedIn'); } catch (e) {} if (window.TTNav) window.TTNav.go('account'); } })
      .catch(function (e) { setStatus(e.code === 'offline' || e.code === 'network' ? 'offline' : e.code === 'expired' ? 'expired' : 'failed', e.message); });
    if (S.cb && S.cb.type === 'signup') U.toast('Email confirmed. You are signed in.');
  }
  window.addEventListener('tt:journal-changed', function () { if (!S.syncing) { refreshPending().then(function () { if (S.status === 'saved' && S.pending) setStatus('pending'); }); scheduleSync(); } });
  window.addEventListener('online', function () { scheduleSync(300); });
  window.addEventListener('offline', function () { if (active) setStatus('offline'); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') scheduleSync(400); });
  window.addEventListener('storage', function (e) {   // another tab signed in, out, or as someone else: show the right person's data
    if (e.key !== AUTH) return; var s = readSession(), id = s && s.user ? s.user.id : null; if (id !== active) location.reload(); else if (s && !s.expired && S.status === 'expired') { setStatus('pending'); scheduleSync(100); }
  });
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'account') { if (active && ON && !S.usage && navigator.onLine !== false) rpc('trc_usage').then(function (u) { S.usage = u; render(); }).catch(function () {}); render(); } });
  if (window.TTNav) window.TTNav.addHub({ id: 'account', title: 'TRC login & sync', text: 'Sign in to use your journal on every device.', icon: '<path d="M7 18h10a4 4 0 00.6-7.95A6 6 0 006.1 9.2 4.5 4.5 0 007 18z"/>' });
  window.TTCloud = { on: ON, active: function () { return active; }, state: S, syncNow: syncNow, render: render, readSession: readSession, _sc: SC };
  init(); render();
})();
