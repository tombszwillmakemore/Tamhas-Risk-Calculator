// TEST ONLY - a small stand-in for a Supabase project, served on the same origin as the app:
//   /auth/v1/*   sign-up, password and refresh-token sign-in, user, logout, recover, magic link, resend - following Supabase Auth's
//                request/response shapes and error codes. Emails are not sent; they are kept in /__test/mail for the tests to open.
//   /rest/v1/rpc/<fn>  runs the REAL functions from cloud/supabase.sql on a real PostgreSQL as role "authenticated" with the
//                caller's verified token claims (or as "anon" without a valid token), like PostgREST does.
// It is a stand-in: Supabase's own rate limits, email delivery and token formats are only approximated. Live tests: tests/cloudlive.js.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), PG = require('./pg');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.traineddata': 'application/octet-stream' };
const SECRET = crypto.randomBytes(32), ANON = 'test-anon-key';
const b64 = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function sign(claims) { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(claims)); return h + '.' + p + '.' + b64(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest()); }
function verify(t) { try { const [h, p, s] = String(t).split('.'); if (b64(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest()) !== s) return null; const c = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); return c.exp * 1000 > Date.now() ? c : null; } catch (e) { return null; } }
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
async function start(rootDir) {
  const pg = PG.start(); if (!pg) return null;
  let r = pg.sql(fs.readFileSync(path.join(__dirname, 'pg-shim.sql'), 'utf8')); if (!r.ok) throw new Error(r.out);
  r = pg.sql(fs.readFileSync(path.join(rootDir, 'cloud', 'supabase.sql'), 'utf8')); if (!r.ok) throw new Error(r.out);
  const users = {}, refresh = {}, mail = [], ctl = { offline: false, accessTtl: 3600, fails: {}, calls: [] };
  const pub = u => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.confirmed ? u.confirmedAt : null, confirmed_at: u.confirmed ? u.confirmedAt : null, created_at: u.created, last_sign_in_at: u.last || null, user_metadata: u.meta, app_metadata: { provider: 'email' } });
  function session(u, method, amrTs) {
    const now = Math.floor(Date.now() / 1000); u.last = new Date().toISOString();
    const amr = [{ method, timestamp: amrTs || now }], at = sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: now + ctl.accessTtl, iat: now, amr, session_id: u.sid });
    const rt = crypto.randomBytes(16).toString('hex'); refresh[rt] = { uid: u.id, amr: amr[0].timestamp, method, sid: u.sid };
    return { access_token: at, token_type: 'bearer', expires_in: ctl.accessTtl, expires_at: now + ctl.accessTtl, refresh_token: rt, user: pub(u) };
  }
  const byEmail = e => Object.values(users).find(u => u.email === String(e || '').toLowerCase());
  function link(u, type, redirect) { u.sid = crypto.randomUUID(); const s = session(u, type === 'recovery' ? 'recovery' : type === 'magiclink' ? 'otp' : 'password'); const url = (redirect || '') + '#access_token=' + s.access_token + '&expires_at=' + s.expires_at + '&expires_in=' + s.expires_in + '&refresh_token=' + s.refresh_token + '&token_type=bearer&type=' + type; mail.push({ to: u.email, type, url, at: Date.now() }); return url; }
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj == null ? '' : JSON.stringify(obj)); };
  const fail = (res, code, error_code, msg) => send(res, code, { code, error_code, msg });
  async function auth(req, res, url, body) {
    const p = url.pathname.replace('/auth/v1', ''), q = url.searchParams, redirect = q.get('redirect_to') || '';
    if (p === '/signup' && req.method === 'POST') {
      const email = String(body.email || '').toLowerCase().trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'email_address_invalid', 'Unable to validate email address: invalid format');
      if (String(body.password || '').length < 8) return fail(res, 422, 'weak_password', 'Password should be at least 8 characters.');
      const ex = byEmail(email); if (ex) return send(res, 200, { id: crypto.randomUUID(), email, user_metadata: {}, identities: [] });   // no enumeration: same answer
      const id = crypto.randomUUID(), salt = crypto.randomBytes(8).toString('hex'), u = { id, email, salt, pw: hashPw(body.password, salt), confirmed: false, created: new Date().toISOString(), meta: Object.assign({}, body.data || {}) };
      users[id] = u; const ins = await pg.sqlAsync("insert into auth.users(id,email) values ('" + id + "','" + email.replace(/'/g, "''") + "');"); if (!ins.ok) return fail(res, 500, 'unexpected_failure', ins.out);
      link(u, 'signup', redirect); return send(res, 200, pub(u));
    }
    if (p === '/token' && req.method === 'POST') {
      const g = q.get('grant_type');
      if (g === 'password') {
        const key = String(body.email || '').toLowerCase(); const f = ctl.fails[key] = (ctl.fails[key] || []).filter(t => Date.now() - t < 60000);
        if (f.length >= 5) return fail(res, 429, 'over_request_rate_limit', 'Request rate limit reached');
        const u = byEmail(body.email); if (!u || hashPw(String(body.password || ''), u.salt) !== u.pw) { f.push(Date.now()); return fail(res, 400, 'invalid_credentials', 'Invalid login credentials'); }
        if (!u.confirmed) return fail(res, 400, 'email_not_confirmed', 'Email not confirmed');
        u.sid = crypto.randomUUID(); return send(res, 200, session(u, 'password'));
      }
      if (g === 'refresh_token') {
        const t = refresh[body.refresh_token]; if (!t || t.used) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        const u = users[t.uid]; if (!u || u.revoked && u.revoked.indexOf(t.sid) >= 0) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        t.used = true; u.sid = t.sid; return send(res, 200, session(u, t.method, t.amr));
      }
      return fail(res, 400, 'validation_failed', 'unsupported grant_type');
    }
    if (p === '/recover' && req.method === 'POST') { const u = byEmail(body.email); if (u) link(u, 'recovery', redirect); return send(res, 200, {}); }
    if (p === '/otp' && req.method === 'POST') { const u = byEmail(body.email); if (u && u.confirmed) link(u, 'magiclink', redirect); return send(res, 200, {}); }
    if (p === '/resend' && req.method === 'POST') { const u = byEmail(body.email); if (u && !u.confirmed) link(u, 'signup', body.options && body.options.email_redirect_to); return send(res, 200, {}); }
    const c = verify((req.headers.authorization || '').replace(/^Bearer /, '')), u = c && users[c.sub];
    if (!u || (u.revoked && u.revoked.indexOf(c.session_id) >= 0)) return fail(res, 401, 'bad_jwt', 'invalid JWT');
    if (p === '/user' && req.method === 'GET') return send(res, 200, pub(u));
    if (p === '/user' && req.method === 'PUT') {
      if (body.data) u.meta = Object.assign({}, u.meta, body.data);
      if (body.password) { if (String(body.password).length < 8) return fail(res, 422, 'weak_password', 'Password should be at least 8 characters.'); if (hashPw(body.password, u.salt) === u.pw) return fail(res, 422, 'same_password', 'New password should be different from the old password.'); u.pw = hashPw(body.password, u.salt); }
      if (body.email) { u.newEmail = String(body.email).toLowerCase(); mail.push({ to: u.newEmail, type: 'email_change', url: redirect + '#type=email_change', at: Date.now() }); }
      return send(res, 200, pub(u));
    }
    if (p === '/logout' && req.method === 'POST') { u.revoked = u.revoked || []; if (q.get('scope') === 'global') { Object.values(refresh).forEach(t => { if (t.uid === u.id) t.used = true; }); u.revoked.push(c.session_id); u.globalOut = Date.now(); } else u.revoked.push(c.session_id); return send(res, 204, null); }
    return fail(res, 404, 'not_found', 'not found');
  }
  async function rpc(req, res, fn, body) {
    if (!/^trc_(push|pull|usage|wipe|delete_account)$/.test(fn)) return send(res, 404, { code: 'PGRST202', message: 'Could not find the function' });
    const tok = (req.headers.authorization || '').replace(/^Bearer /, ''), c = tok ? verify(tok) : null;
    if (tok && !c) return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });
    const u = c && users[c.sub]; if (c && (!u || (u.revoked && u.revoked.indexOf(c.session_id) >= 0))) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid' });
    const lit = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
    const args = fn === 'trc_push' ? lit(JSON.stringify(body.items || [])) + '::jsonb, ' + (+body.client_fmt || 1) + ', ' + lit(body.client_device) : fn === 'trc_pull' ? (+body.since_tx || 0) + ', ' + (+body.since_rev || 0) + ', ' + (+body.lim || 500) : '';
    const claims = c ? JSON.stringify({ sub: c.sub, role: 'authenticated', email: c.email, amr: c.amr }) : '{"role":"anon"}';
    const q = 'begin; set local role ' + (c ? 'authenticated' : 'anon') + "; set local request.jwt.claims = " + lit(claims) + ';\nselect public.' + fn + '(' + args + ')::text;\ncommit;';
    ctl.calls.push(fn);
    const out = await pg.sqlAsync(q);
    if (!out.ok) { const m = out.out.replace(/^.*ERROR:\s*/s, '').split('\n')[0]; return send(res, /permission denied|not signed in/.test(m) ? 401 : /sign in again/.test(m) ? 403 : 400, { code: /permission/.test(m) ? '42501' : 'P0001', message: m }); }
    if (fn === 'trc_delete_account' && u) { delete users[u.id]; Object.values(refresh).forEach(t => { if (t.uid === u.id) t.used = true; }); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(out.out.split('\n').pop());
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/__test/')) {
      const p = url.pathname.slice(8);
      if (p === 'mail') return send(res, 200, mail.filter(m => !url.searchParams.get('to') || m.to === url.searchParams.get('to')));
      if (p === 'offline') { ctl.offline = url.searchParams.get('on') === '1'; return send(res, 200, { offline: ctl.offline }); }
      if (p === 'ttl') { ctl.accessTtl = +url.searchParams.get('s') || 3600; return send(res, 200, {}); }
      if (p === 'open') {   // the person clicks the newest email link of this type: Supabase verifies it, then redirects to the app
        const to = url.searchParams.get('to'), type = url.searchParams.get('type'), m = mail.filter(x => x.to === to && (!type || x.type === type)).pop(); if (!m) return send(res, 404, { error: 'no mail' });
        if (m.used) return send(res, 200, { url: m.url.split('#')[0] + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
        m.used = true; if (m.type === 'signup') ctl.confirm(to);
        if (m.type === 'email_change') { const u = Object.values(users).find(x => x.newEmail === to); if (u) { u.email = to; delete u.newEmail; } }
        return send(res, 200, { url: m.url });
      }
      if (p === 'calls') return send(res, 200, ctl.calls);
      if (p === 'users') return send(res, 200, Object.values(users).map(u => ({ id: u.id, email: u.email, confirmed: u.confirmed, meta: u.meta })));
      if (p === 'sql') { let b = ''; req.on('data', d => b += d); req.on('end', async () => send(res, 200, await pg.sqlAsync(b))); return; }
      return send(res, 404, {});
    }
    if (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')) {
      if (ctl.offline) { req.socket.destroy(); return; }
      if (req.headers.apikey !== ANON) return send(res, 401, { message: 'Invalid API key' });
      let b = ''; req.on('data', d => { b += d; if (b.length > 5e6) req.destroy(); }); req.on('end', () => {
        let body = {}; try { body = b ? JSON.parse(b) : {}; } catch (e) { return send(res, 400, { message: 'bad json' }); }
        const p = url.pathname.startsWith('/auth/') ? auth(req, res, url, body) : rpc(req, res, url.pathname.replace('/rest/v1/rpc/', ''), body);
        p.catch(e => send(res, 500, { message: e.message }));
      });
      return;
    }
    let u = decodeURIComponent(url.pathname); if (u.endsWith('/')) u += 'index.html'; const f = path.join(rootDir, u);
    if (!f.startsWith(rootDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  // "Click" the confirmation link for a test: mark confirmed (Supabase does this when the link is opened).
  ctl.confirm = email => { const u = byEmail(email); if (u) { u.confirmed = true; u.confirmedAt = new Date().toISOString(); } };
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, anon: ANON, ctl, mail, users, pg, stop: () => { server.close(); pg.stop(); } };
}
module.exports = { start };
