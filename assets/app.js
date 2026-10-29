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

  /* ---------- Navigation ---------- */
  var views = document.querySelectorAll('.view');
  var navBtns = document.querySelectorAll('.nav button');
  function go(name) {
    var found = false;
    views.forEach(function (v) { var on = v.id === 'view-' + name; v.classList.toggle('active', on); if (on) found = true; });
    if (!found) { name = 'home'; document.getElementById('view-home').classList.add('active'); }
    navBtns.forEach(function (b) {
      var on = b.dataset.view === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
    window.scrollTo(0, 0);
  }
  navBtns.forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.view); }); });
  document.querySelectorAll('[data-go]').forEach(function (el) { el.addEventListener('click', function () { go(el.dataset.go); }); });

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
  function renderPnl() {
    var C = window.TTJournalCore, el = document.getElementById('pnlValue'), note = document.getElementById('pnlNote');
    var raw = null; try { raw = localStorage.getItem(JOURNAL_KEY); } catch (e) {}
    var res = C ? C.parseStored(raw) : { trades: [], corrupt: false };
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

  renderName();
  renderPnl();
  go((location.hash || '#home').slice(1));
})();
