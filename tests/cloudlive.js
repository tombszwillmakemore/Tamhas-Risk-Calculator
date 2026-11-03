// LIVE checks against the real Supabase project. Runs only when these environment variables are set (e.g. GitHub Actions secrets):
//   TRC_LIVE_URL, TRC_LIVE_ANON              the project URL and public anon/publishable key
//   TRC_LIVE_A_EMAIL, TRC_LIVE_A_PASSWORD    a confirmed TEST login (its cloud records are wiped by this test)
//   TRC_LIVE_B_EMAIL, TRC_LIVE_B_PASSWORD    a second confirmed TEST login
// Never use real people's logins here. Without the variables it prints SKIPPED - it never reports a pass it did not run.
'use strict';
const E = process.env, need = ['TRC_LIVE_URL', 'TRC_LIVE_ANON', 'TRC_LIVE_A_EMAIL', 'TRC_LIVE_A_PASSWORD', 'TRC_LIVE_B_EMAIL', 'TRC_LIVE_B_PASSWORD'];
if (need.some(k => !E[k])) { console.log('SKIPPED: live Supabase secrets not set (real-project checks not verified)'); process.exit(0); }
const S = require('../assets/sync-core.js'); const BASE = E.TRC_LIVE_URL.replace(/\/+$/, ''), KEY = E.TRC_LIVE_ANON;
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } };
async function call(method, path, body, tok) { const r = await fetch(BASE + path, { method, headers: Object.assign({ apikey: KEY, 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}), body: body == null ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; } return { status: r.status, body: j }; }
const signIn = (e, p) => call('POST', '/auth/v1/token?grant_type=password', { email: e, password: p });
const item = (id, base, data, del) => ({ kind: 'trade', id, base, hash: S.hash(S.stable(del ? 'deleted:' + id : data)), deleted: !!del, data: del ? undefined : data });
(async () => {
  const a = await signIn(E.TRC_LIVE_A_EMAIL, E.TRC_LIVE_A_PASSWORD), b = await signIn(E.TRC_LIVE_B_EMAIL, E.TRC_LIVE_B_PASSWORD);
  ok('A signs in (password)', a.status === 200 && a.body.access_token, a.status); ok('B signs in', b.status === 200 && b.body.access_token, b.status);
  if (!a.body || !a.body.access_token || !b.body || !b.body.access_token) { console.log('FAILED ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
  const A = a.body.access_token, B = b.body.access_token;
  ok('token has a recent sign-in time (amr) for sensitive actions', Array.isArray(JSON.parse(Buffer.from(A.split('.')[1], 'base64').toString()).amr));
  let r = await call('POST', '/auth/v1/token?grant_type=password', { email: E.TRC_LIVE_A_EMAIL, password: 'definitely wrong ' + Date.now() }); ok('wrong password refused', r.status === 400, r);
  r = await call('POST', '/rest/v1/rpc/trc_wipe', {}, A); ok('A: wipe own test records (recent sign-in)', r.status === 200, r);
  const id = 'live' + Date.now();
  r = await call('POST', '/rest/v1/rpc/trc_push', { items: [item(id, null, { id, n: 1 })], client_fmt: 1, client_device: 'ci' }, A); ok('A: push applied', r.status === 200 && r.body[0].status === 'applied' && r.body[0].version === 1, r);
  r = await call('POST', '/rest/v1/rpc/trc_push', { items: [item(id, null, { id, n: 1 })], client_fmt: 1, client_device: 'ci' }, A); ok('A: retry is "same" (no duplicate)', r.body[0].status === 'same', r);
  r = await call('POST', '/rest/v1/rpc/trc_push', { items: [item(id, 1, { id, n: 2 })] }, A); ok('A: edit on latest version applied (v2)', r.body[0].status === 'applied' && r.body[0].version === 2, r);
  r = await call('POST', '/rest/v1/rpc/trc_push', { items: [item(id, 1, { id, n: 3 })] }, A); ok('A: stale edit -> conflict with cloud copy', r.body[0].status === 'conflict' && r.body[0].server.data.n === 2, r);
  r = await call('POST', '/rest/v1/rpc/trc_pull', { since_tx: 0, since_rev: 0, lim: 1000 }, A); ok('A: pull returns the record (second device view)', Array.isArray(r.body) && r.body.some(x => x.id === id && x.data.n === 2), r.status);
  r = await call('POST', '/rest/v1/rpc/trc_pull', { since_tx: 0, since_rev: 0, lim: 1000 }, B); ok('B: cannot see A\'s record', Array.isArray(r.body) && !r.body.some(x => x.id === id), r.status);
  r = await call('GET', '/rest/v1/trc_records?select=id,owner&id=eq.' + id, null, B); ok('B: direct table read returns nothing of A', r.status === 200 && Array.isArray(r.body) && r.body.length === 0, r);
  r = await call('PATCH', '/rest/v1/trc_records?id=eq.' + id, { data: { hacked: true } }, B); ok('B: direct update refused', r.status === 401 || r.status === 403 || (r.status >= 400), r);
  r = await call('DELETE', '/rest/v1/trc_records?id=eq.' + id, null, A); ok('A: even the owner cannot bypass push with a direct delete', r.status >= 400, r);
  r = await call('POST', '/rest/v1/rpc/trc_pull', {}, null); ok('anonymous: pull refused', r.status === 401 || r.status === 403 || r.status === 404, r);
  r = await call('GET', '/rest/v1/trc_records?select=*', null, null); ok('anonymous: table read refused or empty', r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), r);
  r = await call('POST', '/rest/v1/rpc/trc_push', { items: [item(id, 2, null, true)] }, A); ok('A: delete -> tombstone', r.body[0].status === 'applied', r);
  r = await call('POST', '/rest/v1/rpc/trc_usage', {}, A); ok('A: usage works', r.status === 200 && r.body.limits && r.body.limits.max_records === 50000, r);
  r = await call('POST', '/rest/v1/rpc/trc_wipe', {}, A); ok('A: clean up', r.status === 200, r);
  r = await call('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: a.body.refresh_token }); ok('refresh token renews the session', r.status === 200 && r.body.access_token, r.status);
  r = await call('POST', '/auth/v1/logout?scope=local', {}, r.body && r.body.access_token); ok('logout works', r.status === 204 || r.status === 200, r.status);
  console.log((fail ? 'FAILED ' : 'ALL PASSED ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
