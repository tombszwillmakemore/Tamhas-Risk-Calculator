// Throwaway local PostgreSQL for tests (needs the server binaries; returns null if they are not installed).
'use strict';
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
function findBin() { try { const v = fs.readdirSync('/usr/lib/postgresql').sort().pop(); const b = '/usr/lib/postgresql/' + v + '/bin'; if (fs.existsSync(b + '/initdb')) return b; } catch (e) {} try { const p = cp.execSync('pg_config --bindir', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (fs.existsSync(p + '/initdb')) return p; } catch (e) {} return null; }
function start() {
  const BIN = findBin(); if (!BIN) return null;
  const root = process.getuid && process.getuid() === 0, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trcpg-')), port = 55000 + Math.floor(Math.random() * 4000);
  const asPg = c => root ? cp.execSync('su postgres -c ' + JSON.stringify(c), { encoding: 'utf8', stdio: 'pipe' }) : cp.execSync(c, { encoding: 'utf8', stdio: 'pipe' });
  if (root) fs.chmodSync(dir, 0o777);
  asPg(BIN + '/initdb -D ' + dir + '/d -A trust -U postgres >/dev/null');
  asPg(BIN + "/pg_ctl -D " + dir + "/d -o '-p " + port + " -k " + dir + " -c listen_addresses=' -l " + dir + "/log -w start >/dev/null");
  const PSQL = 'psql -X -q -At -v ON_ERROR_STOP=1 -h ' + dir + ' -p ' + port + ' -U postgres -d postgres';
  const sql = q => { try { return { ok: true, out: cp.execSync(PSQL, { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }; } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() }; } };
  // async version (does not block the event loop, so an HTTP server can keep serving)
  const sqlAsync = q => new Promise(res => { const c = cp.spawn('sh', ['-c', PSQL], { stdio: ['pipe', 'pipe', 'pipe'] }); let o = '', e = ''; c.stdout.on('data', d => o += d); c.stderr.on('data', d => e += d); c.on('close', code => res(code === 0 ? { ok: true, out: o.trim() } : { ok: false, out: e.trim() })); c.stdin.end(q); });
  const stop = () => { try { asPg(BIN + '/pg_ctl -D ' + dir + '/d -m immediate stop >/dev/null'); } catch (e) {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} };
  return { sql, sqlAsync, stop, dir, port, PSQL };
}
module.exports = { start, findBin };
