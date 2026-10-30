/* Tamhas Trading - service worker (offline support and safe updates).
   Network-first for this site's own files: you get the newest version when online and the last cached copy when offline.
   The cache name comes from assets/version.js, so every release gets a fresh cache and the old one is removed once the new
   worker takes over. It ignores non-GET and cross-origin requests and never sees your trading data (that lives in IndexedDB).
   The text-reader files (assets/vendor/ocr) are large, so they are cached the first time you read a screenshot, not up front. */
importScripts('assets/version.js');
var CACHE = 'tt-app-' + (self.TT_VERSION || 'dev');
var PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'calculator-classic.html', 'assets/accounts-core.js','assets/accounts.css','assets/accounts.js','assets/analytics-core.js','assets/analytics.js','assets/app.css','assets/app.js','assets/calculator.js','assets/db.js','assets/dd-core.js','assets/discipline-core.js','assets/discipline.js','assets/health-core.js','assets/help-core.js','assets/help-data.js','assets/import-core.js','assets/import.js','assets/insights-core.js','assets/insights.js','assets/instruments.js','assets/intel-data.js','assets/intel.js','assets/journal-core.js','assets/journal.css','assets/journal.js','assets/journal2-core.js','assets/journal2.js','assets/money-core.js','assets/money.css','assets/money.js','assets/ocr.js','assets/propfirm-data.js','assets/pwa.js','assets/risk-core.js','assets/risk.js','assets/sessions.js','assets/store.js','assets/strategy-core.js','assets/strategy.js','assets/theme-boot.js','assets/tracker.css','assets/tracker.js','assets/tradovate-core.js','assets/ui.css','assets/ui.js','assets/version.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // each file separately so one missing file cannot block the whole install
    return Promise.all(PRECACHE.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* skip */ }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('tt-app-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'version' && e.source) e.source.postMessage({ type: 'version', version: self.TT_VERSION, cache: CACHE });
  if (d.type === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok && res.type === 'basic') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
      });
    })
  );
});
