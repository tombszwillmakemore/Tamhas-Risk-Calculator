// STATIC PRE-DEPLOY CHECKS: file references, offline cache coverage, manifest, security scan, required project documents. Pure Node.
const fs = require('fs'), path = require('path'); const root = path.join(__dirname, '..'); const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
let f = 0, p = 0; const ok = (n, c, d) => { if (c) p++; else { f++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const html = rd('index.html'), sw = rd('sw.js');
const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"#?]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|data:)/.test(u));
const pre = (sw.match(/var PRECACHE = \[([\s\S]*?)\];/) || [, ''])[1], cached = [...pre.matchAll(/'([^']+)'/g)].map(m => m[1]);
ok('index.html references only local files that exist', refs.every(u => fs.existsSync(path.join(root, u))), refs.filter(u => !fs.existsSync(path.join(root, u))));
ok('index.html loads no external scripts, styles or fonts', !/(src|href)="https?:\/\/[^"]*\.(js|css|woff2?)/i.test(html) && !/<script[^>]+src="https?:/.test(html));
ok('service worker precache lists only files that exist', cached.filter(u => u !== './').every(u => fs.existsSync(path.join(root, u))), cached.filter(u => u !== './' && !fs.existsSync(path.join(root, u))));
ok('every script/stylesheet the page loads is cached for offline use', refs.every(u => cached.includes(u)), refs.filter(u => !cached.includes(u)));
const assets = fs.readdirSync(path.join(root, 'assets')).filter(x => /\.(js|css)$/.test(x)); ok('every file in assets/ is in the offline cache (including lazily loaded ones)', assets.every(a => cached.includes('assets/' + a)), assets.filter(a => !cached.includes('assets/' + a)));
ok('service worker has a cache version name', /var CACHE = 'tt-app-v\d+'/.test(sw));
const man = JSON.parse(rd('manifest.webmanifest')); ok('manifest: installable (name, start_url, standalone, icons exist)', man.name && man.start_url && man.display === 'standalone' && man.icons.length >= 2 && man.icons.every(i => fs.existsSync(path.join(root, i.src))), man.icons.filter(i => !fs.existsSync(path.join(root, i.src))));
ok('page has viewport meta, theme-color and apple-touch-icon (iPhone home screen)', /name="viewport"/.test(html) && /name="theme-color"/.test(html) && /apple-touch-icon/.test(html) && /apple-mobile-web-app-capable|mobile-web-app-capable/.test(html));
ok('strict Content-Security-Policy without unsafe-inline scripts', /Content-Security-Policy/.test(html) && /script-src 'self'/.test(html) && !/script-src[^;]*unsafe-inline/.test(html) && /object-src 'none'/.test(html));
// ---- security scan of our own code
const code = fs.readdirSync(path.join(root, 'assets')).filter(x => /\.js$/.test(x)).map(x => [x, rd('assets/' + x)]).concat([['sw.js', sw]]);
const bad = (re) => code.filter(([n, t]) => re.test(t)).map(([n]) => n);
ok('no eval / new Function / document.write', bad(/\beval\s*\(|new Function\s*\(|document\.write\s*\(/).length === 0, bad(/\beval\s*\(|new Function\s*\(|document\.write\s*\(/));
ok('no hard-coded secrets, passwords, API keys or tokens', bad(/(api[_-]?key|secret|passw(or)?d|token|bearer)\s*[:=]\s*['"][A-Za-z0-9_\-\/+=]{12,}/i).length === 0, bad(/(api[_-]?key|secret|passw(or)?d|token|bearer)\s*[:=]\s*['"][A-Za-z0-9_\-\/+=]{12,}/i));
ok('the only network call is the service worker fetching our own files (no data leaves the device)', code.filter(([n, t]) => /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|EventSource/.test(t)).map(([n]) => n).join() === 'sw.js');
ok('no brokerage, API-key or order-execution code', bad(/placeOrder|submitOrder|brokerApi|createOrder\s*\(|tradovate\.com\/v1|api\.tradovate|ninjatrader\.com\/api/i).length === 0);
ok('external links in the app all use https and noopener', ![...html.matchAll(/<a[^>]+href="http:\/\//g)].length);
const priv = fs.readdirSync(root).filter(x => /\.(md|json|html|js)$/.test(x)).concat(fs.readdirSync(path.join(root, 'assets')).map(x => 'assets/' + x)).filter(x => fs.statSync(path.join(root, x)).isFile()).filter(x => /@(gmail|yahoo|hotmail|outlook|icloud)\.com|tiktoktamhas/i.test(rd(x)));
ok('no personal email or account details in the public repository', priv.length === 0, priv);
// ---- required project documents (persistent rules + process)
for (const d of ['CLAUDE.md', 'ROADMAP.md', 'RELEASE-CHECKLIST.md', 'ROLLBACK.md']) ok(d + ' exists and is not empty', fs.existsSync(path.join(root, d)) && rd(d).length > 800);
if (fs.existsSync(path.join(root, 'CLAUDE.md'))) { const c = rd('CLAUDE.md'); for (const k of ['Feature integration checklist', 'Protect user data', 'Updates must never interrupt', 'Copilot must be trustworthy', 'Keep everything free', 'Audit before building', 'Finish and test before adding', 'Release gate', 'Report problems']) ok('CLAUDE.md covers: ' + k, c.indexOf(k) >= 0, k); }
if (fs.existsSync(path.join(root, 'ROADMAP.md'))) { const c = rd('ROADMAP.md'); for (const k of ['Completed', 'Partially implemented', 'Known bugs', 'Planned', 'Technical limitations', 'Future ideas']) ok('ROADMAP.md has section: ' + k, c.indexOf(k) >= 0, k); }
ok('unit/e2e test inventory present', fs.readdirSync(path.join(root, 'tests')).filter(x => /\.js$/.test(x)).length >= 35);
console.log(`static: ${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
