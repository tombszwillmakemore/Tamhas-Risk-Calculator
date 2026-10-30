/* Applies the saved theme before the page paints (no flash). Preference lives in localStorage as a per-device convenience;
   the full preference is also stored in the database and included in backups. */
(function () {
  var t = 'dark'; try { t = localStorage.getItem('tt.theme') || 'dark'; } catch (e) {}
  var eff = t === 'system' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark') : (t === 'light' ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', eff);
  document.documentElement.setAttribute('data-theme-pref', t);
  var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', eff === 'light' ? '#eef3fb' : '#03050c');
})();
