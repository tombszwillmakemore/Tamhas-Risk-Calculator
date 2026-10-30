/* Registers the offline service worker and handles app updates safely.
   - The worker is network-first, so every normal launch already fetches the newest files when online.
   - When a new version is found while the app is open (common for an installed iPhone home-screen app, which can stay
     open for days), a small "Update ready" bar appears. The app NEVER reloads on its own, so nothing you are typing is lost.
   - Everything is optional: the app works with no service worker. Your data lives in IndexedDB/localStorage, which an update never touches. */
(function () {
  'use strict';
  function toast(m, err, act) { if (window.TTUI && window.TTUI.toast) window.TTUI.toast(m, err, act); }
  var bar = null;
  function updateBar() {
    if (bar || !document.body) return;
    bar = document.createElement('div'); bar.className = 'upd-bar'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>A new version is ready.</span><button type="button" class="upd-go">RELOAD</button><button type="button" class="upd-x" aria-label="Dismiss">&times;</button>';
    document.body.appendChild(bar);
    bar.querySelector('.upd-go').addEventListener('click', function () { location.reload(); });
    bar.querySelector('.upd-x').addEventListener('click', function () { bar.remove(); });
  }
  window.addEventListener('offline', function () { toast('You are offline. Everything still works and is saved on this device.'); });
  window.addEventListener('online', function () { toast('Back online.'); });
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', function () {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var w = reg.installing; if (!w) return;
        w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) updateBar(); });
      });
      function check() { try { reg.update().catch(function () {}); } catch (e) {} }
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });   // an installed iPhone app resumes instead of reloading
      setInterval(check, 30 * 60 * 1000);
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadController) updateBar(); });
    // Ask the browser to protect our storage from automatic clean-up. Safe if refused or unsupported.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  });
})();
