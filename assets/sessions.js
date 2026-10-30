/* Tamhas Trading - Session clock (Asia / London / New York).
   Each session is defined as a LOCAL window in its own market timezone (IANA), so daylight
   saving is handled automatically. Windows are approximate and user-editable; sessions are
   treated as Monday-Friday in the session's own timezone. All times come from the device clock. */
(function (root) {
  var KEY = 'tt.sessions.v1';

  var DEFAULTS = [
    { id: 'asia',    name: 'Asia',     city: 'Tokyo',    tz: 'Asia/Tokyo',       start: '09:00', end: '18:00' },
    { id: 'london',  name: 'London',   city: 'London',   tz: 'Europe/London',    start: '08:00', end: '16:30' },
    { id: 'newyork', name: 'New York', city: 'New York', tz: 'America/New_York', start: '09:30', end: '16:00' }
  ];

  /* ---------- Time-zone math (Intl only, no libraries) ---------- */
  var fmtCache = {};
  function dtf(tz) {
    return fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    }));
  }
  function parts(ts, tz) {
    var o = {}, p = dtf(tz).formatToParts(new Date(ts));
    for (var i = 0; i < p.length; i++) if (p[i].type !== 'literal') o[p[i].type] = parseInt(p[i].value, 10);
    return o;
  }
  // Offset of tz from UTC in minutes at instant ts (e.g. New York EDT = -240).
  function offsetMin(ts, tz) {
    var p = parts(ts, tz);
    var asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUTC - Math.floor(ts / 1000) * 1000) / 60000);
  }
  // Instant (ms) for a wall-clock date/time in tz. y/m/d may overflow (day+1 etc.).
  function wallToInstant(y, m, d, h, mi, tz) {
    var guess = Date.UTC(y, m - 1, d, h, mi);
    var off = offsetMin(guess, tz);
    var t = guess - off * 60000;
    var off2 = offsetMin(t, tz);
    if (off2 !== off) t = guess - off2 * 60000;
    return t;
  }
  function hm(s) { var a = s.split(':'); return { h: parseInt(a[0], 10), m: parseInt(a[1], 10) }; }
  function validHM(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

  /* ---------- Session state ---------- */
  // Returns {open:boolean, at:ms} where `at` is the next close (if open) or next open (if closed).
  function sessionState(now, cfg) {
    var s = hm(cfg.start), e = hm(cfg.end);
    var overnight = (e.h * 60 + e.m) <= (s.h * 60 + s.m);
    var t = parts(now, cfg.tz);
    var next = null;
    for (var n = -1; n <= 9; n++) {
      var base = new Date(Date.UTC(t.year, t.month - 1, t.day + n));
      var y = base.getUTCFullYear(), m = base.getUTCMonth() + 1, d = base.getUTCDate(), dow = base.getUTCDay();
      if (dow === 0 || dow === 6) continue;                       // Mon-Fri only
      var open = wallToInstant(y, m, d, s.h, s.m, cfg.tz);
      var close = wallToInstant(y, m, d + (overnight ? 1 : 0), e.h, e.m, cfg.tz);
      if (now >= open && now < close) return { open: true, at: close };
      if (open > now && next === null) next = open;
    }
    return { open: false, at: next };
  }

  function countdown(ms) {
    if (ms == null || ms < 0) return '—';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    function z(x) { return (x < 10 ? '0' : '') + x; }
    return (d ? d + 'd ' : '') + z(h) + ':' + z(m) + ':' + z(s);
  }
  function clock(ts, tz) {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ts));
  }
  function tzAbbr(ts, tz) {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ts));
    for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value;
    return tz;
  }

  var api = { DEFAULTS: DEFAULTS, sessionState: sessionState, countdown: countdown, offsetMin: offsetMin, wallToInstant: wallToInstant, validHM: validHM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTSessions = api;

  /* ---------- UI (browser only) ---------- */
  if (typeof document === 'undefined' || !document.getElementById('sessionList')) return;

  function loadCfg() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    return DEFAULTS.map(function (d) {
      var o = saved[d.id] || {};
      return { id: d.id, name: d.name, city: d.city, tz: d.tz,
        start: validHM(o.start) ? o.start : d.start, end: validHM(o.end) ? o.end : d.end };
    });
  }
  var cfg = loadCfg();

  var list = document.getElementById('sessionList');
  var localEl = document.getElementById('localClock');
  list.innerHTML = cfg.map(function (c) {
    return '<div class="session" id="s-' + c.id + '">' +
      '<div class="s-top"><div><b>' + c.name + '</b><span class="s-city">' + c.city + '</span></div><span class="pill" data-k="pill">—</span></div>' +
      '<div class="s-mid"><span class="s-time" data-k="time">--:--:--</span><span class="s-count" data-k="count"></span></div>' +
      '<div class="s-win" data-k="win"></div></div>';
  }).join('');

  function tick() {
    var now = Date.now();
    var localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    if (localEl) localEl.textContent = clock(now, localTz) + ' · ' + tzAbbr(now, localTz);
    cfg.forEach(function (c) {
      var el = document.getElementById('s-' + c.id); if (!el) return;
      var st = sessionState(now, c);
      var q = function (k) { return el.querySelector('[data-k=' + k + ']'); };
      q('time').textContent = clock(now, c.tz) + ' ' + tzAbbr(now, c.tz);
      q('pill').textContent = st.open ? 'OPEN' : 'CLOSED';
      q('pill').className = 'pill ' + (st.open ? 'on' : 'off');
      el.classList.toggle('is-open', st.open);
      q('count').textContent = st.at == null ? '' : (st.open ? 'Closes in ' : 'Opens in ') + countdown(st.at - now);
      q('win').textContent = 'Approx. window ' + c.start + '–' + c.end + ' local · Mon–Fri';
    });
  }

  /* Settings editor */
  var editor = document.getElementById('sessionEditor');
  function renderEditor() {
    if (!editor) return;
    editor.innerHTML = cfg.map(function (c) {
      return '<div class="field"><label>' + c.name + ' (' + c.city + ' time)</label>' +
        '<div class="row-inline"><input type="time" id="ss-' + c.id + '-start" value="' + c.start + '" aria-label="' + c.name + ' start">' +
        '<input type="time" id="ss-' + c.id + '-end" value="' + c.end + '" aria-label="' + c.name + ' end"></div></div>';
    }).join('');
  }
  var msg = document.getElementById('sessionMsg');
  function say(t, bad) { if (msg) { msg.textContent = t; msg.style.color = bad ? 'var(--bad)' : 'var(--good)'; setTimeout(function () { msg.textContent = ''; }, 3500); } }
  var saveBtn = document.getElementById('saveSessions'), resetBtn = document.getElementById('resetSessions');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    var next = {}, out = [];
    for (var i = 0; i < cfg.length; i++) {
      var c = cfg[i], s = document.getElementById('ss-' + c.id + '-start').value, e = document.getElementById('ss-' + c.id + '-end').value;
      if (!validHM(s) || !validHM(e)) return say('Enter a valid start and end time for ' + c.name + '.', true);
      if (s === e) return say(c.name + ': start and end cannot be the same.', true);
      next[c.id] = { start: s, end: e };
    }
    var stored = true; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e2) { stored = false; }
    if (!stored) {   // storage blocked (private mode / full): apply for this visit, and say so instead of claiming it was saved
      cfg = cfg.map(function (c) { return Object.assign({}, c, next[c.id]); }); tick();
      return say('Applied for this visit only: this browser would not save it.', true);
    }
    cfg = loadCfg(); tick(); say('Session windows saved.');
  });
  if (resetBtn) resetBtn.addEventListener('click', function () {
    if (!window.confirm('Reset all three session windows to the default times?')) return;
    try { localStorage.removeItem(KEY); } catch (e) {}
    cfg = loadCfg(); renderEditor(); tick(); say('Reset to defaults.');
  });

  renderEditor(); tick();
  setInterval(function () { if (!document.hidden) tick(); }, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
})(typeof window !== 'undefined' ? window : globalThis);
