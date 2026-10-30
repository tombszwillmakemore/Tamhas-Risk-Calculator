/* Tamhas Trading - service worker (offline support).
   Network-first for this site's own files: you always get the newest version when online, and the last
   cached copy when offline. It ignores non-GET and cross-origin requests and never sees your trading data
   (that lives in IndexedDB / localStorage, not in the network layer). */
var CACHE = 'tt-app-v3';
var PRECACHE = ['./', 'index.html', 'manifest.webmanifest',
  'assets/app.css', 'assets/journal.css', 'assets/ui.css', 'assets/money.css', 'assets/money.js', 'assets/import-core.js', 'assets/analytics-core.js', 'assets/risk-core.js', 'assets/discipline-core.js', 'assets/discipline.js', 'assets/strategy-core.js', 'assets/strategy.js', 'assets/insights-core.js', 'assets/health-core.js', 'assets/insights.js', 'assets/experience-core.js', 'assets/experience.js', 'assets/experience.css', 'assets/risk.js', 'assets/analytics.js', 'assets/import.js', 'assets/money-core.js', 'assets/ui.js', 'assets/store.js', 'assets/theme-boot.js', 'assets/accounts.css', 'assets/app.js', 'assets/calculator.js', 'assets/instruments.js', 'assets/sessions.js',
  'assets/intel-data.js', 'assets/intel.js', 'assets/journal-core.js', 'assets/journal2-core.js', 'assets/journal2.js', 'assets/db.js', 'assets/accounts-core.js', 'assets/propfirm-data.js', 'assets/dd-core.js', 'assets/tracker.js', 'assets/tracker.css', 'assets/accounts.js', 'assets/pwa.js', 'assets/journal.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // add each file separately so one missing file cannot block the whole install
    return Promise.all(PRECACHE.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* skip */ }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
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
      return caches.match(req).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
      });
    })
  );
});
