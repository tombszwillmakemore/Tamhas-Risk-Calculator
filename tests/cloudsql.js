// Runs cloud/supabase.sql on a throwaway local PostgreSQL and attacks it as two different people and as an anonymous visitor.
// Needs the PostgreSQL server binaries (initdb). If they are not installed the suite prints SKIPPED (it does not claim a pass).
'use strict';
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : String(d).slice(0, 400)); } };
function findBin() { try { const v = fs.readdirSync('/usr/lib/postgresql').sort().pop(); const b = '/usr/lib/postgresql/' + v + '/bin'; if (fs.existsSync(b + '/initdb')) return b; } catch (e) {} try { const p = cp.execSync('pg_config --bindir', { encoding: 'utf8' }).trim(); if (fs.existsSync(p + '/initdb')) return p; } catch (e) {} return null; }
const BIN = findBin(); if (!BIN) { console.log('SKIPPED: PostgreSQL server binaries not found (cloud SQL not verified here)'); process.exit(0); }
const root = process.getuid && process.getuid() === 0, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trcpg-')), port = 55000 + Math.floor(Math.random() * 4000);
const asPg = c => root ? cp.execSync('su postgres -c ' + JSON.stringify(c), { encoding: 'utf8', stdio: 'pipe' }) : cp.execSync(c, { encoding: 'utf8', stdio: 'pipe' });
if (root) { fs.chmodSync(dir, 0o777); }
asPg(BIN + '/initdb -D ' + dir + '/d -A trust -U postgres >/dev/null');
asPg(BIN + "/pg_ctl -D " + dir + "/d -o '-p " + port + " -k " + dir + " -c listen_addresses=' -l " + dir + "/log -w start >/dev/null");
const PSQL = 'psql -X -q -At -v ON_ERROR_STOP=1 -h ' + dir + ' -p ' + port + ' -U postgres -d postgres';
function sql(q) { try { return { ok: true, out: cp.execSync(PSQL, { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }; } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() }; } }
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', now = () => Math.floor(Date.now() / 1000);
const as = (u, q, amrAge) => "begin; set local role authenticated; set local request.jwt.claims = '" + JSON.stringify({ sub: u, role: 'authenticated', amr: [{ method: 'password', timestamp: now() - (amrAge || 0) }] }) + "';\n" + q + "\ncommit;";
const anon = q => "begin; set local role anon; set local request.jwt.claims = '{\"role\":\"anon\"}';\n" + q + "\ncommit;";
const J = s => JSON.parse(s.split('\n').pop());
try {
  let r = sql(fs.readFileSync(path.join(__dirname, 'cloud', 'pg-shim.sql'), 'utf8')); ok('shim loads', r.ok, r.out);
  r = sql(fs.readFileSync(path.join(ROOT, 'cloud', 'supabase.sql'), 'utf8')); ok('cloud/supabase.sql runs', r.ok, r.out);
  r = sql(fs.readFileSync(path.join(ROOT, 'cloud', 'supabase.sql'), 'utf8')); ok('cloud/supabase.sql can run a second time (idempotent)', r.ok, r.out);
  sql("insert into auth.users values ('" + A + "','a@example.test'),('" + B + "','b@example.test');");
  const item = (id, base, data, extra) => Object.assign({ kind: 'trade', id, base, hash: (require('crypto').createHash('sha1').update(JSON.stringify(data || 'x')).digest('hex').slice(0, 16)), data }, extra || {});
  const push = (u, items, fmt) => { const q = sql(as(u, "select public.trc_push('" + JSON.stringify(items).replace(/'/g, "''") + "'::jsonb, " + (fmt || 1) + ", 'test');")); return q.ok ? J(q.out) : q; };
  // ---- create, idempotent retry, compare-and-swap, conflict
  let p = push(A, [item('t1', null, { pnl: 100 }), item('t2', null, { pnl: -50 })]);
  ok('A inserts 2 records (version 1)', Array.isArray(p) && p.every(x => x.status === 'applied' && x.version === 1), JSON.stringify(p));
  p = push(A, [item('t1', null, { pnl: 100 })]); ok('same push again is acknowledged, not duplicated', p[0].status === 'same', JSON.stringify(p));
  p = push(A, [item('t1', 1, { pnl: 120 })]); ok('edit based on version 1 applies -> version 2', p[0].status === 'applied' && p[0].version === 2, JSON.stringify(p));
  p = push(A, [item('t1', 1, { pnl: 999 })]); ok('stale edit (based on v1, cloud has v2) -> conflict with the cloud copy', p[0].status === 'conflict' && p[0].server.version === 2 && p[0].server.data.pnl === 120 && !p[0].server.owner, JSON.stringify(p));
  p = push(A, [item('t1', 2, { pnl: 120 }, { deleted: true, data: undefined })]); ok('delete based on latest version -> tombstone', p[0].status === 'applied' && p[0].version === 3, JSON.stringify(p));
  r = sql(as(A, "select deleted, data is null from public.trc_records where id='t1';")); ok('tombstone kept (deleted, no data)', r.out.split('\n').pop() === 't|t', r.out);
  p = push(A, [item('bad id!', null, { a: 1 }), Object.assign(item('t9', null, { a: 1 }), { kind: 'secret' }), Object.assign(item('t8', null, { a: 1 }), { hash: 'XYZ' }), Object.assign(item('t7', null, null), { data: [1, 2] })]);
  ok('invalid ids, kinds, hashes and non-object data are refused', p.every(x => x.status === 'invalid'), JSON.stringify(p));
  p = push(A, [item('t3', null, { a: 1 })], 3); p = push(A, [item('t3', 1, { a: 2 })], 1); ok('older app format cannot overwrite a newer one', p[0].status === 'too_old', JSON.stringify(p));
  const big = { blob: 'x'.repeat(300000) }; p = push(A, [item('t4', null, big)]); ok('oversized record refused', p[0].status === 'too_large', JSON.stringify(p));
  r = sql(as(A, "select public.trc_push((select jsonb_agg(jsonb_build_object('kind','trade','id','x'||g,'hash','aaaaaaaaaaaaaaaa','data','{}'::jsonb)) from generate_series(1,501) g), 1, 'x');")); ok('batch over 500 refused', !r.ok && /batch too large/.test(r.out), r.out);
  // ---- isolation
  r = sql(as(B, "select count(*) from public.trc_records;")); ok('B sees none of A\'s rows', r.out.split('\n').pop() === '0', r.out);
  r = sql(as(B, "select count(*) from public.trc_pull(0,0,1000);")); ok('B pull returns none of A\'s rows', r.out.split('\n').pop() === '0', r.out);
  p = push(B, [item('t2', 1, { pnl: 1e6 })]); ok('B pushing A\'s record id creates B\'s own row (A\'s untouched)', p[0].status === 'applied', JSON.stringify(p));
  r = sql(as(A, "select data->>'pnl' from public.trc_records where id='t2';")); ok('A\'s t2 unchanged', r.out.split('\n').pop() === '-50', r.out);
  r = sql(as(B, "update public.trc_records set data='{\"pnl\":0}' where id='t2';")); ok('direct UPDATE refused', !r.ok && /permission denied/.test(r.out), r.out);
  r = sql(as(B, "delete from public.trc_records;")); ok('direct DELETE refused', !r.ok && /permission denied/.test(r.out), r.out);
  r = sql(as(B, "insert into public.trc_records(owner,kind,id,hash,data) values ('" + A + "','trade','evil','aaaaaaaaaaaaaaaa','{}');")); ok('direct INSERT (even naming A as owner) refused', !r.ok && /permission denied/.test(r.out), r.out);
  r = sql(as(B, "select count(*) from public.trc_records where owner='" + A + "';")); ok('B asking for A\'s owner id gets nothing', r.out.split('\n').pop() === '0', r.out);
  // ---- anonymous
  r = sql(anon("select count(*) from public.trc_records;")); ok('anonymous: no table access', !r.ok && /permission denied/.test(r.out), r.out);
  r = sql(anon("select public.trc_push('[]'::jsonb,1,null);")); ok('anonymous: cannot call push', !r.ok && /permission denied/.test(r.out), r.out);
  r = sql(anon("select count(*) from public.trc_pull(0,0,10);")); ok('anonymous: cannot call pull', !r.ok && /permission denied/.test(r.out), r.out);
  r = sql(anon("select public.trc_delete_account();")); ok('anonymous: cannot delete accounts', !r.ok && /permission denied/.test(r.out), r.out);
  r = sql("begin; set local role authenticated; select public.trc_push('[]'::jsonb,1,null); commit;"); ok('authenticated role without a user id is refused', !r.ok && /not signed in/.test(r.out), r.out);
  // ---- pull: order, cursor, never skips a late commit
  r = sql(as(A, "select string_agg(x->>'id', ',' order by (x->>'tx')::bigint, (x->>'rev')::bigint) from public.trc_pull(0,0,1000) x;")); ok('A pull returns A\'s rows in commit order', /t2/.test(r.out) && /t1/.test(r.out) && !/evil/.test(r.out), r.out);
  const rows = sql(as(A, "select json_agg(x) from public.trc_pull(0,0,1000) x;")).out.split('\n').pop(), list = JSON.parse(rows), last = list[list.length - 1];
  r = sql(as(A, "select count(*) from public.trc_pull(" + last.tx + "," + last.rev + ",1000);")); ok('pull after the last cursor returns nothing new', r.out.split('\n').pop() === '0', r.out);
  // late commit: transaction 1 starts and writes but does not commit; transaction 2 writes and commits; a pull now must not move
  // its cursor past transaction 1's change.
  const slowFile = path.join(dir, 'slow.sql'); fs.writeFileSync(slowFile, as(A, "select public.trc_push('" + JSON.stringify([item('late', null, { n: 1 })]) + "'::jsonb,1,'slow'); select pg_sleep(2);")); fs.chmodSync(slowFile, 0o644);
  cp.execSync('(' + PSQL + ' -f ' + slowFile + ' >/dev/null 2>&1 &)');
  cp.execSync('sleep 0.7');
  push(A, [item('quick', null, { n: 2 })]);
  const mid = JSON.parse(sql(as(A, "select coalesce(json_agg(x),'[]') from public.trc_pull(" + last.tx + "," + last.rev + ",1000) x;")).out.split('\n').pop());
  ok('while an older transaction is still open, newer changes are held back (no cursor jump)', !mid.some(x => x.id === 'quick'), JSON.stringify(mid.map(x => x.id)));
  cp.execSync('sleep 2.5');
  const after = JSON.parse(sql(as(A, "select coalesce(json_agg(x),'[]') from public.trc_pull(" + last.tx + "," + last.rev + ",1000) x;")).out.split('\n').pop());
  ok('after it commits, both changes arrive, the late one first', after.map(x => x.id).join() === 'late,quick', JSON.stringify(after.map(x => x.id)));
  // ---- quota
  r = sql("create or replace function public.trc_limits() returns jsonb language sql immutable as $$ select '{\"max_records\": 6, \"max_bytes\": 52428800, \"max_batch\": 500}'::jsonb $$;");
  p = push(A, [item('q1', null, { a: 1 }), item('q2', null, { a: 2 })]); ok('per-person record limit enforced', p.some(x => x.status === 'quota'), JSON.stringify(p));
  sql(fs.readFileSync(path.join(ROOT, 'cloud', 'supabase.sql'), 'utf8'));
  // ---- usage, wipe and delete need a recent sign-in
  r = sql(as(A, "select public.trc_usage();")); const u = J(r.out); ok('usage reports records and bytes', u.records >= 3 && u.bytes > 0 && u.limits.max_records === 50000, r.out);
  r = sql(as(B, "select public.trc_wipe();", 3600)); ok('wipe refused without a recent sign-in', !r.ok && /sign in again/.test(r.out), r.out);
  r = sql(as(B, "select public.trc_delete_account();", 3600)); ok('account deletion refused without a recent sign-in', !r.ok && /sign in again/.test(r.out), r.out);
  r = sql(as(B, "select public.trc_delete_account();")); ok('B deletes own account', r.ok, r.out);
  r = sql("select (select count(*) from auth.users where id='" + B + "') || ',' || (select count(*) from public.trc_records where owner='" + B + "') || ',' || (select count(*) from public.trc_records where owner='" + A + "');");
  const [ub, rb, ra] = r.out.split(','); ok('B login and B records gone; A untouched', ub === '0' && rb === '0' && +ra >= 3, r.out);
  r = sql(as(A, "select public.trc_wipe();")); ok('A wipes own cloud records (recent sign-in)', r.ok, r.out);
  r = sql("select count(*) from public.trc_records where owner='" + A + "';"); ok('A has no cloud records after wipe; login kept', r.out === '0' && sql("select count(*) from auth.users where id='" + A + "';").out === '1', r.out);
  // ---- policies really exist and RLS is forced
  r = sql("select relrowsecurity::text || relforcerowsecurity::text from pg_class where relname='trc_records';"); ok('row-level security enabled and forced', r.out === 'truetrue', r.out);
  r = sql("select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_name='trc_records' and grantee in ('anon','authenticated');"); ok('only SELECT granted to app roles', r.out === 'SELECT', r.out);
  r = sql("select bool_and(prosecdef) and bool_and(proconfig::text like '%search_path=%') from pg_proc where proname in ('trc_push','trc_pull','trc_usage','trc_wipe','trc_delete_account');"); ok('write functions are security-definer with a fixed search_path', r.out === 't', r.out);
} finally { try { asPg(BIN + '/pg_ctl -D ' + dir + '/d -m immediate stop >/dev/null'); } catch (e) {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
console.log((fail ? 'FAILED ' : 'ALL PASSED ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
