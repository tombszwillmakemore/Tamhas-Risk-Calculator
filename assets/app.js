/* Tamhas Trading - app shell: navigation, settings, home dashboard.
   All data stays on this device (localStorage). Nothing here is fabricated:
   P&L is computed only from trades the user logs in the journal (built in a later stage). */
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

  /* ---------- Today's P&L (real data only) ---------- */
  function todayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function renderPnl() {
    var trades = load(JOURNAL_KEY, []);
    var el = document.getElementById('pnlValue'), note = document.getElementById('pnlNote');
    var today = todayKey(new Date());
    var todays = trades.filter(function (t) { return t && typeof t.pnlCents === 'number' && t.date === today; });
    if (!todays.length) {
      el.className = 'pnl-value none'; el.textContent = '—';
      note.textContent = 'No trades logged today. P&L appears here from your own journal entries (and later your Tradovate sync). Nothing is simulated.';
      return;
    }
    var cents = todays.reduce(function (a, t) { return a + t.pnlCents; }, 0);
    el.className = 'pnl-value ' + (cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'none');
    el.textContent = (cents < 0 ? '-' : cents > 0 ? '+' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    note.textContent = todays.length + ' trade' + (todays.length === 1 ? '' : 's') + ' logged today.';
  }

  renderName();
  renderPnl();
  go((location.hash || '#home').slice(1));
})();
