/* Tamhas Trading - app shell: navigation, settings, home dashboard.
   All data stays on this device (localStorage). Nothing here is fabricated:
   P&L is computed only from closed trades the user logs in the journal. */
(function () {
  var KEY = 'tt.settings.v1';
  var JOURNAL_KEY = 'tt.journal.v1';

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  var settings = load(KEY, { displayName: 'Trader' });
  if (!settings.displayName) settings.displayName = 'Trader';

  /* ---------- Navigation ----------
     Sections that live under the "More" hub keep that tab highlighted. Every section has a deep link (#name) and the
     browser Back button works. Modules listen for 'tt:view' to (re)render when their section opens. */
  var views = document.querySelectorAll('.view');
  var navBtns = document.querySelectorAll('.nav button');
  var HUB_PARENT = { intel: 'more', settings: 'more' };   // sections that are reached through the More hub (extended as sections are added)
  window.TTNav = { parents: HUB_PARENT };
  function go(name, noHash) {
    var found = false;
    views.forEach(function (v) { var on = v.id === 'view-' + name; v.classList.toggle('active', on); if (on) found = true; });
    if (!found) { name = 'home'; document.getElementById('view-home').classList.add('active'); }
    var tab = HUB_PARENT[name] || name;
    navBtns.forEach(function (b) {
      var on = b.dataset.view === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (!noHash) { try { if (location.hash !== '#' + name) history.pushState(null, '', '#' + name); } catch (e) {} }
    window.scrollTo(0, 0);
    try { window.dispatchEvent(new CustomEvent('tt:view', { detail: { name: name } })); } catch (e) {}
    document.title = (name === 'home' ? '' : name.charAt(0).toUpperCase() + name.slice(1) + ' · ') + 'Tamhas Trading';
  }
  window.TTNav.go = go;
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.nav button[data-view]'); if (b) { go(b.dataset.view); return; }
    var g = e.target.closest && e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); }
  });
  window.addEventListener('popstate', function () { go((location.hash || '#home').slice(1), true); });

  /* ---------- More hub ---------- */
  var HUB = [
    { id: 'intel', title: 'Intel', text: 'Economic calendar and market events.', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    { id: 'settings', title: 'Settings', text: 'Theme, profile, session windows, privacy.', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>' }
  ];
  window.TTNav.addHub = function (item, tabParent) { if (!HUB.some(function (h) { return h.id === item.id; })) HUB.splice(HUB.length - 1, 0, item); if (tabParent !== false) HUB_PARENT[item.id] = 'more'; renderHub(); };
  function renderHub() {
    var el = document.getElementById('hubRoot'); if (!el) return;
    el.innerHTML = HUB.filter(function (h) { return document.getElementById('view-' + h.id); }).map(function (h) {
      return '<button type="button" class="tile" data-go="' + h.id + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + h.icon + '</svg><b>' + h.title + '</b><span>' + h.text + '</span></button>';
    }).join('');
  }

  /* ---------- Theme ---------- */
  function applyTheme(pref) {
    var eff = pref === 'system' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark') : (pref === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', eff); document.documentElement.setAttribute('data-theme-pref', pref);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', eff === 'light' ? '#eef3fb' : '#03050c');
    document.querySelectorAll('[data-theme-set]').forEach(function (b) { var on = b.dataset.themeSet === pref; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    window.dispatchEvent(new CustomEvent('tt:theme', { detail: { theme: eff } }));
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-set]'); if (!b) return;
    var v = b.dataset.themeSet; try { localStorage.setItem('tt.theme', v); } catch (x) {}
    applyTheme(v);
    if (window.TTStore) window.TTStore.setPref('theme', v).catch(function () {});
  });
  if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (document.documentElement.getAttribute('data-theme-pref') === 'system') applyTheme('system'); }); } catch (e) {} }
  applyTheme(document.documentElement.getAttribute('data-theme-pref') || 'dark');

  /* ---------- Display name ---------- */
  var nameOut = document.getElementById('displayName');
  var nameIn = document.getElementById('nameInput');
  var saved = document.getElementById('nameSaved');
  function renderName() {
    nameOut.textContent = settings.displayName.toUpperCase();
    nameIn.value = settings.displayName;
  }
  document.getElementById('saveName').addEventListener('click', function () {
    var v = nameIn.value.replace(/\s+/g, ' ').trim().slice(0, 24);
    settings.displayName = v || 'Trader';
    var ok = save(KEY, settings);
    renderName();
    saved.textContent = ok ? 'Saved on this device.' : 'Could not save (private browsing?). Name applies until you close the page.';
    setTimeout(function () { saved.textContent = ''; }, 3000);
  });
  nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('saveName').click(); });

  /* ---------- Today's P&L (real data only) ----------
     Comes only from fully closed trades in the journal dated today. Net (after fees) when every one of
     them has fees recorded; otherwise gross, and it says so. Open / partly closed trades are never counted. */
  function todayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  // Reads trades from the on-device database; falls back to the old localStorage journal only if the database is unusable.
  function readTrades() {
    var C = window.TTJournalCore;
    var legacy = function () { var raw = null; try { raw = localStorage.getItem(JOURNAL_KEY); } catch (e) {} return C ? C.parseStored(raw) : { trades: [], corrupt: false }; };
    if (!window.TTDB || !window.indexedDB || !C) return Promise.resolve(legacy());
    return window.TTDB.ready().then(function () { return window.TTDB.getAll('trades'); })
      .then(function (list) { return window.TTDB.getAll('quarantine').then(function (q) { var ok = []; list.forEach(function (r) { var n = C.normalizeTrade(r); if (n.ok) ok.push(n.trade); }); return { trades: ok, corrupt: q.some(function (x) { return x.kind === 'legacy-journal-unreadable'; }) }; }); })
      .catch(function () { return legacy(); });
  }
  function renderPnl() { readTrades().then(drawPnl); }
  function drawPnl(res) {
    var C = window.TTJournalCore, el = document.getElementById('pnlValue'), note = document.getElementById('pnlNote');
    var s = C ? C.todaySummary(C.analyze(res.trades), todayKey(new Date())) : { closed: 0, open: 0, basis: null, cents: null, feesMissing: 0 };
    var openNote = s.open ? ' ' + plural(s.open, 'open or partly closed trade') + ' not counted until fully exited.' : '';
    if (res.corrupt) {
      el.className = 'pnl-value none'; el.textContent = '—';
      note.textContent = 'Your saved journal could not be read, so no P&L is shown. Open Journal › Backup for options.';
      return;
    }
    if (!s.closed) {
      el.className = 'pnl-value none'; el.textContent = '—';
      note.textContent = (s.open ? '' : 'No trades logged today. ') + 'P&L comes only from closed trades you log in your Journal. Nothing is simulated.' + openNote;
      return;
    }
    el.className = 'pnl-value ' + (s.cents > 0 ? 'pos' : s.cents < 0 ? 'neg' : 'none');
    el.textContent = C.fmtMoney(s.cents, true);
    note.textContent = plural(s.closed, 'closed trade') + ' today · ' +
      (s.basis === 'net' ? 'net after fees.' : 'before fees (fees not entered on ' + s.feesMissing + ').') + openNote;
  }
  window.addEventListener('tt:journal-changed', renderPnl);

  try { if (!localStorage.getItem('tt.theme') && window.TTStore) window.TTStore.getPref('theme', null).then(function (v) { if (v) { try { localStorage.setItem('tt.theme', v); } catch (e) {} applyTheme(v); } }).catch(function () {}); } catch (e) {}
  renderName();
  renderPnl();
  renderHub();
  window.addEventListener('tt:hub', renderHub);
  go((location.hash || '#home').slice(1), true);
})();
