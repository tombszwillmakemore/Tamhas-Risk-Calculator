/* Tamhas Trading - platform extras that sit alongside the experience layer (search, help, tours), Copilot and support:
   - startup screen hand-off (removed the moment the app can be used; never an artificial wait) and animation settings
   - Install TRC guide (iPhone/iPad, Android/Pixel, Samsung) and the onboarding install step
   - diagnostics under System health (version, offline support, connection, last import/backup, recent errors, repair app files)
   - backup reminder on the dashboard, and the online/offline status chip
   No network calls. Everything is read from this device. */
(function () {
  'use strict';
  var U = window.TTUI, DB = window.TTDB, REG = window.TTRegistry, PC = window.TTPlatformCore, esc = U.esc;
  var VER = REG ? REG.APP_VERSION : 'dev';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function standalone() { try { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; } }
  function lastBackup() { try { return (JSON.parse(ls('tt.journal.prefs.v1') || '{}') || {}).lastBackup || null; } catch (e) { return null; } }

  /* ---------- startup screen ---------- */
  var splash = document.getElementById('splash');
  function splashDone() { if (!splash || splash.classList.contains('out')) return; splash.classList.add('out'); setTimeout(function () { if (splash && splash.parentNode) splash.parentNode.removeChild(splash); }, 320); }
  (DB && DB.ready ? DB.ready() : Promise.resolve()).then(function () { requestAnimationFrame(splashDone); }, function () { splashDone(); });
  setTimeout(splashDone, 5000);   // whatever happens, it never stays up (the CSS also hides it after 6 s if scripts fail)
  function applyAnim(v) { document.documentElement.setAttribute('data-anim', v); document.querySelectorAll('[data-anim-set]').forEach(function (b) { var on = b.getAttribute('data-anim-set') === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-anim-set]'); if (!b) return; var v = b.getAttribute('data-anim-set'); ls('tt.anim', v); applyAnim(v); U.toast(v === 'off' ? 'Startup screen turned off.' : v === 'reduced' ? 'Animations reduced.' : 'Standard animations.'); });
  applyAnim(document.documentElement.getAttribute('data-anim') || 'standard');

  /* ---------- Install TRC ---------- */
  var INSTALL = {
    ios: { name: 'iPhone / iPad (Safari)', steps: ['Open this site in <b>Safari</b>.', 'Tap the <b>⋯</b> (more) button next to the address bar, then <b>Share</b>. On older iOS versions the <b>Share</b> button (square with an arrow) is in the toolbar.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Keep <b>Open as Web App</b> switched on if you see it.', 'Change the name to <b>TRC</b> if it shows anything else, then tap <b>Add</b>.'], note: 'iOS 16.4 and later can also add sites from other browsers through their Share menu. On iPad the Share option can be at the top right.' },
    android: { name: 'Android (Chrome, Pixel and most phones)', steps: ['Open this site in <b>Chrome</b>.', 'Tap the <b>⋮</b> menu at the top right.', 'Tap <b>Install app</b>. If you only see <b>Add to home screen</b>, tap that.', 'Confirm with <b>Install</b> (or <b>Add</b>). If Chrome lets you edit the name, use <b>TRC</b>.'], note: 'Chrome may also show an install banner or an install icon in the address bar. On a computer, Chrome and Edge show an install icon in the address bar.' },
    samsung: { name: 'Samsung Internet', steps: ['Open this site in <b>Samsung Internet</b>.', 'Tap the <b>☰</b> menu (three lines).', 'Tap <b>+ Add page to</b>, then <b>Home screen</b>.', 'Make the name <b>TRC</b> if needed, then tap <b>Add</b>.'], note: 'On some versions the menu may also offer <b>Install</b> or an install icon in the address bar.' }
  };
  var instTab = PC.installTab(navigator.userAgent, navigator.platform, navigator.maxTouchPoints), deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; renderInstall(); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; ls('tt.installed', '1'); U.toast('TRC was added to your Home Screen.'); renderInstall(); window.dispatchEvent(new Event('tt:journal-changed')); });
  function renderInstall() {
    var el = document.getElementById('installRoot'); if (!el) return; var t = INSTALL[instTab];
    el.innerHTML = (standalone() ? '<div class="ui-banner good">You are using the installed TRC app. Nothing else to do.</div>' : '') +
      '<div class="panel"><div class="inst-preview"><div><img src="icons/icon-192.png" alt="TRC app icon"><b>TRC</b></div><p class="note" style="margin:0">Installed, the app opens full screen like a normal app, works offline and appears on your Home Screen as <b>TRC</b>. The website itself stays <b>Tamhas Trading</b>. Your data stays in this browser on this device; installing does not copy it to other devices.</p></div>' +
      (deferredPrompt ? '<button type="button" class="btn wide" id="instNow">INSTALL TRC NOW</button>' : '') + '</div>' +
      '<div class="panel"><div class="ui-tabs inst-tabs" role="tablist" aria-label="Device">' + Object.keys(INSTALL).map(function (k) { return '<button type="button" role="tab" aria-selected="' + (k === instTab) + '" class="' + (k === instTab ? 'on' : '') + '" data-inst="' + k + '">' + esc(INSTALL[k].name) + '</button>'; }).join('') + '</div>' +
      '<ol class="im-steps" id="instSteps">' + t.steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol><p class="note">' + t.note + '</p></div>' +
      '<div class="panel"><h2>About the name</h2><p class="note" style="margin-top:0">This site tells browsers the app is called <b>TRC</b> (in its app manifest and in Apple\'s home-screen title setting). Android Chrome normally uses that name. On iPhone and iPad, and in Samsung Internet, the name is shown in an editable box before you add it; it should already say TRC, but the final label is whatever is in that box. Opening from the icon you may first see your phone\'s own brief splash before TRC\'s startup screen.</p>' +
      '<p class="note warnline">These steps follow current published guides (checked 30 Oct 2026) and could not be tested on real phones from here; wording can differ slightly between versions.</p>' +
      (!standalone() && !ls('tt.install.skip') ? '<button type="button" class="btn ghost sm" id="instSkip">NOT NOW (HIDE FROM GETTING STARTED)</button>' : '') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-inst]'); if (b) { instTab = b.getAttribute('data-inst'); renderInstall(); return; }
    if (e.target.id === 'instNow' && deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; renderInstall(); }); }
    if (e.target.id === 'instSkip') { ls('tt.install.skip', '1'); U.toast('Hidden from the getting-started list.'); renderInstall(); window.dispatchEvent(new Event('tt:journal-changed')); }
  });

  /* ---------- diagnostics (added under System health) ---------- */
  var swState = 'checking';
  if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(function (reg) { swState = reg && reg.active ? 'ready' : (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'starting' : 'not available here'); }).catch(function () { swState = 'unavailable'; });
  else swState = 'not supported by this browser';
  function renderDiag() {
    var el = document.getElementById('diagRoot'); if (!el) return; var er = window.TTSupport && window.TTSupport.recent ? window.TTSupport.recent() : [], lb = lastBackup();
    DB.ready().then(function () { return DB.getAll('docs'); }).catch(function () { return []; }).then(function (docs) {
      var li = docs.filter(function (d) { return d.kind === 'import'; }).sort(function (a, b) { return b.at - a.at; })[0];
      el.innerHTML = '<div class="panel"><h2>App and device</h2><ul class="ui-list"><li><span>App version</span><b>' + esc(VER) + '</b></li><li><span>Offline support</span><b>' + esc(swState) + '</b></li><li><span>Connection</span><b>' + (navigator.onLine ? 'online' : 'offline (everything still works)') + '</b></li><li><span>Opened as</span><b>' + (standalone() ? 'installed TRC app' : 'website') + '</b></li>' +
        '<li><span>Last import</span><b>' + (li ? esc(new Date(li.at).toLocaleString()) + ' · ' + ((li.counts && li.counts.trades) || 0) + ' trades' + (li.rolledBack ? ' (rolled back)' : '') : 'none') + '</b></li><li><span>Last backup</span><b>' + (lb ? esc(new Date(lb).toLocaleString()) : 'never') + '</b></li></ul>' +
        '<h3 class="im-h3">Recent errors in this session</h3>' + (er.length ? '<ul class="ui-list">' + er.map(function (x) { return '<li><span>' + esc(x.msg) + '</span><small class="note">' + esc(x.at || x.kind) + '</small></li>'; }).join('') + '</ul>' : '<p class="note" style="margin-top:0">None.</p>') +
        '<h3 class="im-h3">Repair app files</h3><p class="note" style="margin-top:0">If the app looks out of date or broken after an update, this removes the cached app files (not your data) and reloads the latest version. Your trades, accounts and settings stay in place.</p><button type="button" class="btn ghost" id="diagRepair">REPAIR APP FILES</button>' +
        '<h3 class="im-h3">About local storage</h3><p class="note" style="margin-top:0">Your data is stored only in this browser on this device and does not sync to other devices. Clearing browsing data, removing the browser or installed app, private browsing, or the phone freeing space can remove it. Download a backup regularly (Journal › Backup).</p></div>';
    });
  }
  function repair() {
    U.confirm('Repair app files?', 'Removes the cached copy of the app (not your trades or settings) and reloads. Needs a connection to download the app again.', 'REPAIR', false).then(function (y) {
      if (!y) return;
      var jobs = []; if ('caches' in window) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('tt-app-') === 0; }).map(function (k) { return caches.delete(k); })); }));
      if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
      Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
    });
  }
  document.addEventListener('click', function (e) { if (e.target.id === 'diagRepair') repair(); });

  /* ---------- connection chip ---------- */
  function net() { var c = document.getElementById('netChip'); if (c) c.innerHTML = '<i></i>' + (navigator.onLine ? 'LOCAL MODE' : 'OFFLINE · LOCAL'); }
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  /* ---------- backup reminder on the dashboard ---------- */
  function renderBackupNag() {
    var host = document.getElementById('homeStart'); if (!host) return; var old = document.getElementById('backupNag'); if (old) old.remove();
    var lb = lastBackup();
    DB.ready().then(function () { return DB.getAll('trades'); }).then(function (ts) {
      var newest = ts.reduce(function (a, t) { return Math.max(a, t.createdAt || 0); }, 0);
      var due = PC.backupDue({ trades: ts.length, now: Date.now(), lastBackup: lb, snoozeUntil: +(ls('tt.backup.snooze') || 0), changedSince: !lb || newest > lb });
      if (!due.due || document.getElementById('backupNag')) return; var d = document.createElement('div'); d.id = 'backupNag'; d.className = 'ui-banner warn';
      d.innerHTML = '<b>' + (due.reason === 'never' ? 'You have not downloaded a backup yet.' : 'Your last backup is ' + due.days + ' days old.') + '</b> Your ' + U.plural(ts.length, 'trade') + ' live only in this browser. <div class="ui-row" style="margin-top:8px"><button type="button" class="btn sm" id="nagBackup">BACK UP NOW</button><button type="button" class="btn ghost sm" id="nagSnooze">REMIND ME IN 3 DAYS</button></div>';
      host.parentNode.insertBefore(d, host);
    }).catch(function () {});
  }
  document.addEventListener('click', function (e) {
    if (e.target.id === 'nagSnooze') { ls('tt.backup.snooze', String(Date.now() + 3 * 864e5)); renderBackupNag(); }
    if (e.target.id === 'nagBackup') { window.TTNav.go('journal'); var n = 0, iv = setInterval(function () { var t = document.querySelector('#view-journal [data-act=tab][data-tab=backup]'); if (t || ++n > 30) { clearInterval(iv); if (t) t.click(); } }, 50); }
  });

  /* ---------- wiring ---------- */
  function renderFor(name) { if (name === 'install') renderInstall(); else if (name === 'health') renderDiag(); else if (name === 'home') renderBackupNag(); }
  window.addEventListener('tt:view', function (e) { renderFor(e.detail.name); });
  window.addEventListener('tt:journal-changed', renderBackupNag);
  renderBackupNag(); renderFor((location.hash || '#home').slice(1));
  window.TTPlatform = { renderInstall: renderInstall, renderDiag: renderDiag };
})();
