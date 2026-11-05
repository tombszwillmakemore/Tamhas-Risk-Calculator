/* TRC cloud boot - runs before everything else (no DOM, no network).
   1. If this page was opened from a sign-in / verification / password-reset email, the tokens arrive in the address after "#".
      They are moved out of the address immediately (so they never stay in history or get shared) and handed to cloud.js.
   2. Chooses whose data this page shows: the signed-in TRC login, or "guest" (this device only). Each login gets its own local
      database and its own copy of personal settings, so after a sign-out and a different sign-in nobody sees the previous person's data.
   Device settings (theme, animation, install state) are shared by everyone on the device. */
(function (w) {
  'use strict';
  var AUTH = 'tt.auth.v1', OWNER = 'tt.ls.owner';
  // Personal settings that belong to one person. Swapped in and out when the person on this device changes.
  var PERSONAL = ['tt.profile.v1', 'tt.journal.prefs.v1', 'tt.settings.v1', 'tt.copilot.v1', 'tt.copilot.hist.v1', 'tt.intel.user.v1', 'tt.calc.last.v1', 'tt.calc.instrument.v1',
    'tt.journal.v1', 'tt.sessions.v1', 'tt.backup.snooze', 'tt.nw.nudged', 'tt.cloud.migrated'];
  var ls = null; try { ls = w.localStorage; ls.getItem('x'); } catch (e) { ls = null; }
  function b64json(s) { try { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } }

  // ---- 1. email-link callback
  var h = w.location.hash || '';
  if (/(^#|&)(access_token|error_description|error_code)=/.test(h)) {
    var q = {}; h.slice(1).split('&').forEach(function (p) { var i = p.indexOf('='); if (i > 0) q[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' ')); });
    try { w.history.replaceState(null, '', w.location.pathname + w.location.search + '#account'); } catch (e) { w.location.hash = '#account'; }
    var cb = { type: q.type || '', error: q.error_description || q.error || '', errorCode: q.error_code || '' };
    if (q.access_token && q.refresh_token && ls) {
      var claims = b64json(String(q.access_token).split('.')[1] || '');
      if (claims && claims.sub) {
        var sess = { access_token: q.access_token, refresh_token: q.refresh_token, expires_at: Date.now() + (+(q.expires_in) || 3600) * 1000, user: { id: claims.sub, email: claims.email || '' }, provisional: true };
        try { ls.setItem(AUTH, JSON.stringify(sess)); } catch (e) {}
      } else cb.error = cb.error || 'The link could not be read.';
    }
    try { w.sessionStorage.setItem('tt.auth.cb', JSON.stringify(cb)); } catch (e) { w.TT_AUTH_CALLBACK = cb; }
  }

  // ---- 2. whose data
  var uid = null;
  if (ls) { try { var s = JSON.parse(ls.getItem(AUTH) || 'null'); if (s && s.user && /^[0-9a-f-]{36}$/i.test(s.user.id)) uid = s.user.id.toLowerCase(); } catch (e) {} }
  var who = uid || 'guest';
  w.TT_ACTIVE_USER = uid; w.TT_DB_SUFFIX = uid ? '~u-' + uid : '';
  if (ls) {
    try {
      var owner = ls.getItem(OWNER) || 'guest';
      if (owner !== who) {
        var prevProfile = null; try { prevProfile = JSON.parse(ls.getItem('tt.profile.v1') || 'null'); } catch (e) {}
        PERSONAL.forEach(function (k) {   // put the previous person's settings away, then bring this person's back
          var v = ls.getItem(k); if (v != null) ls.setItem('tt.u.' + owner + '.' + k, v); else ls.removeItem('tt.u.' + owner + '.' + k);
          ls.removeItem(k);
          var mine = ls.getItem('tt.u.' + who + '.' + k); if (mine != null) { ls.setItem(k, mine); ls.removeItem('tt.u.' + who + '.' + k); }
        });
        // Someone who already went through the welcome on this device is not shown it again; nothing else carries over.
        if (ls.getItem('tt.profile.v1') == null && prevProfile && prevProfile.onboarded) ls.setItem('tt.profile.v1', JSON.stringify({ v: 1, onboarded: true, tourSeen: !!prevProfile.tourSeen }));
        ls.setItem(OWNER, who);
      }
    } catch (e) { /* storage full or blocked: settings simply stay as they are */ }
  }
  // An email link opened in a tab that already shows TRC only changes the "#" part (no reload): reload so step 1 above runs.
  w.addEventListener('hashchange', function () { if (/(^#|&)(access_token|error_description|error_code)=/.test(w.location.hash || '')) w.location.reload(); });
  w.TTCloudBoot = { PERSONAL: PERSONAL, AUTH: AUTH, OWNER: OWNER, dbName: function (base) { return base + w.TT_DB_SUFFIX; } };
})(window);
