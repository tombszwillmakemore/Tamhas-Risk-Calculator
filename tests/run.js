#!/usr/bin/env node
/* Runs every test in this folder. No dependencies except Playwright (npm i -D playwright) for the browser suites.
   Usage: node tests/run.js            (all)      node tests/run.js core      (pure-logic suites only, no browser)
          node tests/run.js e2e                    node tests/run.js h1 i1     (name filters)
   It starts its own static server for the browser suites and prints one line per suite. Exit code is non-zero if any fail. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0].split('#')[0]); if (u.endsWith('/')) u += 'index.html'; const f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('not found'); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const args = process.argv.slice(2), all = fs.readdirSync(__dirname).filter(f => /\.js$/.test(f) && f !== 'run.js').sort();
const isBrowser = f => /require\(['"]playwright['"]\)/.test(fs.readFileSync(path.join(__dirname, f), 'utf8'));
let list = all.filter(f => !args.length || args.some(a => a === 'core' ? !isBrowser(f) : a === 'e2e' ? isBrowser(f) : f.startsWith(a)));
function run(f, base) { return new Promise(res => { const c = cp.spawn(process.execPath, [path.join(__dirname, f)], { env: Object.assign({}, process.env, { TT_BASE: base }) }); let out = ''; const k = setTimeout(() => c.kill(), 600000); c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d); c.on('close', code => { clearTimeout(k); res({ status: code, out: out }); }); }); }
srv.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port; let bad = 0; const t0 = Date.now();
  for (const f of list) { const t = Date.now(), r = await run(f, base), out = r.out, fails = (out.match(/^FAIL/gm) || []).length, last = out.trim().split('\n').filter(l => /passed|PASSED|FAILED/.test(l)).pop() || '';
    const ok = r.status === 0 && !fails; if (!ok) { bad++; console.log(out.split('\n').filter(l => /^FAIL|Error/.test(l)).slice(0, 8).join('\n')); }
    console.log((ok ? 'PASS ' : 'FAIL ') + f.padEnd(14) + String(Math.round((Date.now() - t) / 100) / 10).padStart(6) + 's  ' + last.slice(0, 80)); }
  console.log('\n' + (list.length - bad) + ' of ' + list.length + ' suites passed in ' + Math.round((Date.now() - t0) / 1000) + 's' + (bad ? ' - ' + bad + ' FAILED' : '')); srv.close(); process.exit(bad ? 1 : 0);
});
