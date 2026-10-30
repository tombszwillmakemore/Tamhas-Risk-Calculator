/* Applies the saved theme and layout density before the page paints (no flash). Preferences live in localStorage as a
   per-device convenience; the full preferences are also stored in the database and included in backups. */
(function () {
  var t = 'dark'; try { t = localStorage.getItem('tt.theme') || 'dark'; } catch (e) {}
  var eff = t === 'system' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark') : (t === 'light' ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', eff);
  document.documentElement.setAttribute('data-theme-pref', t);
  var a = 'standard'; try { a = localStorage.getItem('tt.anim') || 'standard'; } catch (e) {} document.documentElement.setAttribute('data-anim', a === 'reduced' || a === 'off' ? a : 'standard');
  var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', eff === 'light' ? '#eef3fb' : '#03050c');
  try { var pr = JSON.parse(localStorage.getItem('tt.profile.v1') || '{}'); if (pr && pr.density === 'compact') document.documentElement.setAttribute('data-density', 'compact'); } catch (e) { /* storage blocked: default density */ }
})();
