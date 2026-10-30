/* Tamhas Intel - economic calendar.
   Official events come from assets/intel-data.js (verified from the Fed, BLS and BEA); you can add your own.
   Nothing here is live market data: no forecasts, no "actual" values, no invented times. */
(function (root) {
  var USER_KEY = 'tt.intel.user.v1';
  var ET = 'America/New_York';
  var S = root.TTSessions || (typeof require !== 'undefined' ? require('./sessions.js') : null);
  var OFFICIAL = (root.TT_INTEL_OFFICIAL) || { categories: {}, events: [], asOf: '' };
  var CATS = OFFICIAL.categories;

  /* ---------- Pure helpers (unit-tested) ---------- */
  function instant(ev) {
    var p = ev.date.split('-'), t = ev.time.split(':');
    if (ev.tz === 'local') return new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1]).getTime();
    return S.wallToInstant(+p[0], +p[1], +p[2], +t[0], +t[1], ET);
  }
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function cleanUser(o, cats) {
    if (!o || typeof o !== 'object') return null;
    var title = String(o.title == null ? '' : o.title).replace(/\s+/g, ' ').trim().slice(0, 80);
    var note = String(o.note == null ? '' : o.note).trim().slice(0, 300);
    var tz = o.tz === 'local' ? 'local' : 'et';
    if (!title || !validDate(String(o.date)) || !S.validHM(String(o.time)) || !cats[o.cat]) return null;
    return { id: 'u' + (o.id ? String(o.id).replace(/\W/g, '').slice(0, 24) : Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      title: title, date: o.date, time: o.time, cat: o.cat, tz: tz, note: note, user: true, src: 'You' };
  }
  function parseImport(text, cats) {
    var arr;
    try { arr = JSON.parse(text); } catch (e) { return { ok: false, error: 'That is not valid JSON.' }; }
    if (!Array.isArray(arr)) return { ok: false, error: 'Expected a list of events.' };
    var out = [], bad = 0;
    arr.slice(0, 500).forEach(function (o) { var c = cleanUser(o, cats); if (c) out.push(c); else bad++; });
    return { ok: true, events: out, skipped: bad };
  }
  function withTs(list) { return list.map(function (e) { var c = Object.assign({}, e); c.ts = instant(e); return c; }).sort(function (a, b) { return a.ts - b.ts; }); }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function startOfToday(now) { var d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function nextEvent(list, now) { for (var i = 0; i < list.length; i++) if (list[i].ts > now) return list[i]; return null; }

  var api = { instant: instant, cleanUser: cleanUser, parseImport: parseImport, withTs: withTs, nextEvent: nextEvent, dayKey: dayKey, validDate: validDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTIntel = api;

  /* ---------- UI (browser only) ---------- */
  if (typeof document === 'undefined' || !document.getElementById('intelList')) return;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function loadUser() {
    var raw = []; try { raw = JSON.parse(localStorage.getItem(USER_KEY) || '[]') || []; } catch (e) {}
    return raw.map(function (o) { return cleanUser(Object.assign({}, o, { id: o.id && String(o.id).slice(1) }), CATS); }).filter(Boolean);
  }
  var user = loadUser();
  function saveUser() { try { localStorage.setItem(USER_KEY, JSON.stringify(user)); return true; } catch (e) { return false; } }

  var all = [];
  function rebuild() { all = withTs(OFFICIAL.events.concat(user)); }
  rebuild();

  var state = { cat: 'ALL', past: false, limit: 25, open: null };
  var tzLocal = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  function fmtTime(ts, tz) { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ts)); }
  function abbr(ts, tz) { var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ts)); for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') return p[i].value; return tz; }
  function dayLabel(key, now) {
    var t = dayKey(now), tm = dayKey(now + 86400000);
    var d = new Date(key + 'T12:00:00');
    var base = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(d);
    return key === t ? 'TODAY · ' + base : key === tm ? 'TOMORROW · ' + base : base;
  }
  function badge(cat) { var c = (CATS[cat] || {}).color || '#8ea3cc'; return '<span class="cat" style="--c:' + c + '">' + esc(cat) + '</span>'; }

  var listEl = document.getElementById('intelList'), chipsEl = document.getElementById('intelChips'),
      nextEl = document.getElementById('intelNext'), legendEl = document.getElementById('intelLegend'),
      homeNext = document.getElementById('homeNext');

  chipsEl.innerHTML = ['ALL'].concat(Object.keys(CATS)).map(function (k) { return '<button type="button" class="chip' + (k === 'ALL' ? ' on' : '') + '" data-cat="' + k + '">' + k + '</button>'; }).join('') +
    '<button type="button" class="chip" id="pastToggle">PAST</button>';
  legendEl.innerHTML = Object.keys(CATS).map(function (k) { return '<p class="note">' + badge(k) + ' ' + esc(CATS[k].desc) + '</p>'; }).join('');

  function render() {
    var now = Date.now(), from = state.past ? startOfToday(now) - 7 * 86400000 : startOfToday(now);
    var rows = all.filter(function (e) { return e.ts >= from && (state.cat === 'ALL' || e.cat === state.cat); });
    var shown = rows.slice(0, state.limit), html = '', last = '';
    shown.forEach(function (e) {
      var k = dayKey(e.ts);
      if (k !== last) { html += '<div class="day">' + esc(dayLabel(k, now)) + '</div>'; last = k; }
      var flags = (e.flags || []).map(function (f) { return f === 'tentative' ? 'Date tentative' : f === 'derived' ? 'Date calculated from Fed rule' : f === 'typical-time' ? 'Time is typical, confirm at source' : f; });
      var det = '';
      if (state.open === e.id) {
        det = '<div class="ev-det">' + (e.note ? '<p>' + esc(e.note) + '</p>' : '') +
          '<p class="note">' + esc(fmtTime(e.ts, ET)) + ' ' + esc(abbr(e.ts, ET)) + ' · ' + esc(e.src || '') + '</p>' +
          (flags.length ? '<p class="note" style="color:var(--warn)">' + esc(flags.join(' · ')) + '</p>' : '') +
          (e.url ? '<p class="note"><a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">Verify at source</a></p>' : '') +
          (e.user ? '<button type="button" class="btn danger" data-del="' + esc(e.id) + '">DELETE</button>' : '') + '</div>';
      }
      html += '<div class="ev' + (e.ts < now ? ' done' : '') + '" data-id="' + esc(e.id) + '" role="button" tabindex="0">' +
        '<div class="ev-t">' + esc(fmtTime(e.ts, tzLocal)) + '<small>' + esc(abbr(e.ts, tzLocal)) + '</small></div>' +
        '<div class="ev-b"><div class="ev-title">' + esc(e.title) + '</div><div class="ev-meta">' + badge(e.cat) + (e.ts < now ? '<span class="note"> Released</span>' : '') + '</div></div></div>' + det;
    });
    if (!shown.length) html = '<p class="note">No events in this view.</p>';
    if (rows.length > shown.length) html += '<button type="button" class="btn" id="moreBtn" style="width:100%;margin-top:10px">SHOW MORE (' + (rows.length - shown.length) + ')</button>';
    listEl.innerHTML = html;
  }

  function renderNext() {
    var now = Date.now(), n = nextEvent(all, now);
    var others = n ? all.filter(function (e) { return e.ts === n.ts && e !== n; }) : [], same = others.length,
        sameTitles = others.map(function (e) { return e.title; }).join(', ');
    var inner = !n ? '<span class="note">No upcoming events in the calendar. Add your own, or check back after the next update.</span>' :
      badge(n.cat) + '<div class="nx-title">' + esc(n.title) + '</div><div class="nx-time">' + esc(new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(n.ts))) + ' · ' + esc(fmtTime(n.ts, tzLocal)) + ' ' + esc(abbr(n.ts, tzLocal)) +
      '</div>' + (same > 0 ? '<div class="note" style="margin-top:2px">+ ' + same + ' more at the same time: ' + esc(sameTitles) + '</div>' : '') +
      '<div class="nx-count">' + esc('In ' + S.countdown(n.ts - now)) + '</div>';
    nextEl.innerHTML = inner;
    if (homeNext) homeNext.innerHTML = inner;
  }

  chipsEl.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'pastToggle') { state.past = !state.past; b.classList.toggle('on', state.past); }
    else if (b.dataset.cat) { state.cat = b.dataset.cat; chipsEl.querySelectorAll('[data-cat]').forEach(function (x) { x.classList.toggle('on', x === b); }); }
    state.limit = 25; render();
  });
  listEl.addEventListener('click', function (ev) {
    var del = ev.target.closest('[data-del]');
    if (del) { user = user.filter(function (u) { return u.id !== del.dataset.del; }); saveUser(); rebuild(); state.open = null; render(); renderNext(); return; }
    if (ev.target.closest('a')) return;
    if (ev.target.id === 'moreBtn') { state.limit += 25; render(); return; }
    var row = ev.target.closest('.ev'); if (row) { state.open = state.open === row.dataset.id ? null : row.dataset.id; render(); }
  });
  listEl.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('ev')) { ev.preventDefault(); ev.target.click(); } });

  /* Add / export / import */
  var catSel = document.getElementById('evCat');
  catSel.innerHTML = Object.keys(CATS).map(function (k) { return '<option value="' + k + '">' + k + '</option>'; }).join('');
  if (CATS.BRIEFING) catSel.value = 'BRIEFING';   // the category meant for your own notes
  var addMsg = document.getElementById('evMsg');
  function say(t, bad) { addMsg.textContent = t; addMsg.style.color = bad ? 'var(--bad)' : 'var(--good)'; setTimeout(function () { addMsg.textContent = ''; }, 4000); }
  document.getElementById('evAdd').addEventListener('click', function () {
    var o = { title: document.getElementById('evTitle').value, date: document.getElementById('evDate').value, time: document.getElementById('evTime').value,
      cat: catSel.value, tz: document.getElementById('evTz').value, note: document.getElementById('evNote').value };
    var c = cleanUser(o, CATS);
    if (!c) return say('Add a title, a valid date and a valid time.', true);
    user.push(c); var ok = saveUser(); rebuild(); render(); renderNext();
    ['evTitle', 'evNote'].forEach(function (id) { document.getElementById(id).value = ''; });
    say(ok ? 'Event added.' : 'Added for this visit only (browser storage unavailable).', !ok);
  });
  document.getElementById('evExport').addEventListener('click', function () {
    var txt = JSON.stringify(user.map(function (u) { return { title: u.title, date: u.date, time: u.time, cat: u.cat, tz: u.tz, note: u.note }; }), null, 1);
    var box = document.getElementById('evIO'); box.value = txt; box.select();
    try { if (navigator.clipboard) navigator.clipboard.writeText(txt); } catch (e) {}
    say(user.length ? 'Your events are in the box below (copied if allowed).' : 'You have no events of your own yet.');
  });
  document.getElementById('evImport').addEventListener('click', function () {
    var r = parseImport(document.getElementById('evIO').value, CATS);
    if (!r.ok) return say(r.error, true);
    user = user.concat(r.events).slice(0, 500); saveUser(); rebuild(); render(); renderNext();
    say('Imported ' + r.events.length + (r.skipped ? ' (skipped ' + r.skipped + ' invalid)' : '') + '.', false);
  });
  var dEl = document.getElementById('evDate'); if (dEl && !dEl.value) dEl.value = dayKey(Date.now());

  var asOf = document.getElementById('intelAsOf'); if (asOf) asOf.textContent = 'Official dates verified from the Fed, BLS and BEA on ' + OFFICIAL.asOf + '. Schedules can change, so confirm at the source link before relying on a date.';

  render(); renderNext();
  setInterval(function () { if (!document.hidden) renderNext(); }, 1000);
  setInterval(function () { if (!document.hidden) render(); }, 60000);
})(typeof window !== 'undefined' ? window : globalThis);
