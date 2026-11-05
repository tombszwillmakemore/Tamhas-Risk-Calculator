// TRC login + cloud sync, end to end in real browsers (Chromium), two "devices" (separate browser profiles) and a third person.
// The backend is tests/cloud/mini-supabase.js: a Supabase-shaped sign-in service + the REAL cloud/supabase.sql on real PostgreSQL.
// Follows the acceptance steps in the account-system specification. Skips (does not pass) when PostgreSQL is not installed.
const { chromium } = require('./_pw'); const path = require('path'), fs = require('fs');
const MS = require('./cloud/mini-supabase'), ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
let fail = 0, pass = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 500)); } };
const until = async (pg, fn, arg, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await pg.evaluate(fn, arg)) return true; } catch (e) { /* page reloading */ } await pg.waitForTimeout(80); } return false; };
const PW = 'correct horse battery', PW2 = 'new staple horse 42';
(async () => {
  const srv = await MS.start(ROOT); if (!srv) { console.log('SKIPPED: PostgreSQL server binaries not found (cloud end-to-end not verified here)'); process.exit(0); }
  const api = async (p, opts) => (await fetch(srv.base + p, opts)).json();
  const sqlq = async q => (await api('/__test/sql', { method: 'POST', body: q })).out;
  const rows = async (email) => +(await sqlq("select count(*) from public.trc_records r join auth.users u on u.id = r.owner where u.email = '" + email + "' and not r.deleted;"));
  const browser = await chromium.launch();
  const device = async (name, w) => { const ctx = await browser.newContext({ viewport: { width: w || 390, height: 844 }, acceptDownloads: true }); await ctx.addInitScript(cfg => { window.TT_CLOUD = cfg; }, { url: srv.base, anonKey: srv.anon }); const p = await ctx.newPage(); p.__errors = []; p.on('pageerror', e => p.__errors.push(e.message)); await p.goto(srv.base + '/index.html'); await p.evaluate(() => TTDB.ready()); return { ctx, p, name }; };
  const state = p => p.evaluate(() => document.getElementById('syncChip') && document.getElementById('syncChip').getAttribute('data-state'));
  const waitState = (p, st, ms) => until(p, s => { const c = document.getElementById('syncChip'); return c && (Array.isArray(s) ? s.indexOf(c.getAttribute('data-state')) >= 0 : c.getAttribute('data-state') === s); }, st, ms || 15000);
  const trades = p => p.evaluate(async () => (await TTDB.getAll('trades')).map(t => t.id).sort());
  const syncWait = async p => { await p.evaluate(() => TTCloud.syncNow()); return waitState(p, 'saved', 15000); };
  const addTrade = (p, id, extra) => p.evaluate(async ([id, extra]) => { await TTDB.put('trades', Object.assign({ id, date: '2026-10-21', time: '10:00', contract: 'MNQ', side: 'long', contracts: 1, entry: 21000, exits: [{ qty: 1, price: 21010 }], feesCents: 124, accountId: 'acct-default', createdAt: Date.now() }, extra || {})); window.dispatchEvent(new Event('tt:journal-changed')); }, [id, extra || null]);
  const goAcct = async p => { await p.evaluate(() => TTNav.go('account')); await p.waitForSelector('#cloudRoot .panel'); };
  const signInUI = async (p, email, pw) => { await goAcct(p); if (await p.$('[data-cform=signin]')) await p.click('[data-cform=signin]'); await p.fill('#clEmail', email); await p.fill('#clPass', pw); await Promise.all([p.waitForEvent('load', { timeout: 15000 }).catch(() => null), p.click('#clForm [type=submit]')]); await p.waitForTimeout(300); await p.evaluate(() => TTDB.ready()).catch(() => {}); };
  const gotoLink = async (p, url) => { await Promise.all([p.waitForEvent('load', { timeout: 15000 }).catch(() => null), p.goto(url)]); await p.waitForLoadState('load'); for (let i = 0; i < 20; i++) { try { await p.evaluate(() => TTDB.ready()); break; } catch (e) { await p.waitForTimeout(150); } } };
  const openMail = async (p, to, type) => { const r = await api('/__test/open?to=' + encodeURIComponent(to) + '&type=' + type); await gotoLink(p, r.url); return r.url; };
  const T = 'cloud: ';
  try {
    // ---- 0. not configured: honest message, everything local
    { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(srv.base + '/index.html'); await p.evaluate(() => TTDB.ready()); await p.evaluate(() => TTNav.go('account')); await p.waitForSelector('#cloudRoot .panel');
      ok(T + 'not configured: says cloud saving is not switched on, no sign-in form', /not switched on/.test(await p.innerText('#cloudRoot')) && !(await p.$('#clForm')));
      ok(T + 'not configured: chip says on this device', (await state(p)) === 'off'); ok(T + 'not configured: no cloud calls', !(await api('/__test/calls')).length); await ctx.close(); }

    // ---- 1. guest data on device 1
    const d1 = await device('phone'), p1 = d1.p;
    await addTrade(p1, 'g1'); await addTrade(p1, 'g2', { exits: [{ qty: 1, price: 20990 }] }); await p1.evaluate(async () => { await TTDB.put('ledger', { id: 'pay1', accountId: 'acct-default', type: 'payout', amountCents: 50000, date: '2026-10-20' }); });
    ok(T + 'guest: chip says on this device', (await state(p1)) === 'guest');
    await goAcct(p1); const intro = await p1.innerText('#cloudRoot');
    ok(T + 'sign-in screen explains login vs trading account, benefits, guest limits, screenshots', /separate from your Tradovate/.test(intro) && /this device only/.test(intro) && /Screenshots stay on the device/.test(intro));

    // ---- 2. sign up A: validation, check-email, unconfirmed sign-in, resend
    await p1.fill('#clEmail', 'typing@trc.test'); await p1.focus('#clEmail'); await p1.evaluate(() => { TTCloud.state.msg = { text: 'redraw while typing', bad: false }; TTCloud.render(); });
    ok(T + 'a redraw keeps what was typed and the focus (open sections stay open too)', (await p1.inputValue('#clEmail')) === 'typing@trc.test' && await p1.evaluate(() => document.activeElement.id === 'clEmail'));
    await p1.click('[data-cform=signup]'); await p1.fill('#clEmail', 'not-an-email'); await p1.fill('#clPass', PW); await p1.click('#clForm [type=submit]');
    ok(T + 'invalid email rejected before sending', /does not look right/.test(await p1.innerText('#cloudRoot')));
    await p1.fill('#clEmail', 'a@trc.test'); await p1.fill('#clPass', 'short'); await p1.click('#clForm [type=submit]'); ok(T + 'short password rejected', /at least 8/.test(await p1.innerText('#cloudRoot')));
    await p1.fill('#clName', 'Alice'); await p1.fill('#clEmail', 'A@TRC.test'); await p1.fill('#clPass', PW);
    ok(T + 'password field has a show/hide toggle', !!(await p1.$('[data-ca=showpw][data-for=clPass]'))); await p1.click('[data-ca=showpw]'); ok(T + 'show password works', (await p1.getAttribute('#clPass', 'type')) === 'text');
    await p1.click('#clForm [type=submit]'); await until(p1, () => /Check your inbox/.test(document.getElementById('cloudRoot').innerText));
    ok(T + 'sign-up asks to confirm the email', /Check your inbox/.test(await p1.innerText('#cloudRoot')));
    const dupe = await (await fetch(srv.base + '/auth/v1/signup', { method: 'POST', headers: { apikey: srv.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@trc.test', password: PW }) })).status; ok(T + 'second sign-up with the same email answers the same way (no enumeration)', dupe === 200);
    ok(T + 'still guest until confirmed', (await state(p1)) === 'guest');
    await p1.click('[data-cform=signin]'); await p1.fill('#clEmail', 'a@trc.test'); await p1.fill('#clPass', PW); await p1.click('#clForm [type=submit]'); await until(p1, () => /confirm your email/.test(document.getElementById('cloudRoot').innerText));
    ok(T + 'unconfirmed sign-in: clear message + resend button', /confirm your email/.test(await p1.innerText('#cloudRoot')) && !!(await p1.$('[data-ca=resend]')));
    await p1.click('[data-ca=resend]'); await until(p1, () => /Sent again/.test(document.getElementById('cloudRoot').innerText)); ok(T + 'resend works', (await api('/__test/mail?to=a@trc.test')).length === 2);

    // ---- 3. open the confirmation link -> signed in as A, tokens removed from the address, migration offered
    await openMail(p1, 'a@trc.test', 'signup');
    ok(T + 'email link: signed in, tokens gone from the address bar', await until(p1, () => location.hash === '#account' && !/access_token/.test(location.href) && TTCloud.active()));
    ok(T + 'no tokens left in history state', !(await p1.evaluate(() => /access_token/.test(JSON.stringify(history.state) + location.href))));
    ok(T + 'signed in as A: own empty database, guest trades not mixed in', JSON.stringify(await trades(p1)) === '[]');
    await until(p1, () => !!document.getElementById('cloudMigrate'), null, 15000);
    let mt = await p1.innerText('#cloudMigrate'); ok(T + 'migration offered with counts', /Trades: 2 new/.test(mt) && /Money entries: 1 new/.test(mt), mt); ok(T + 'migration says which login it copies into', /signed in as a@trc\.test/i.test(mt), mt);
    const [dl] = await Promise.all([p1.waitForEvent('download'), p1.click('[data-ca=mig-backup]')]); const bk = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok(T + 'backup before migration contains the guest data', bk.kind === 'journal-backup' && bk.trades.length === 2 && bk.ledger.length === 1);
    await p1.click('[data-ca=mig-go]'); await until(p1, () => /server confirmed/.test(document.getElementById('cloudRoot').innerText), null, 20000);
    ok(T + 'migration verified by the server', /server confirmed/.test(await p1.innerText('#cloudRoot')), await p1.innerText('#cloudRoot'));
    ok(T + 'A now has the guest trades', JSON.stringify(await trades(p1)) === '["g1","g2"]'); ok(T + 'server has 2 trades + 1 payout + default account (+settings)', (await rows('a@trc.test')) >= 4, await rows('a@trc.test'));
    ok(T + 'chip: saved to cloud only after confirmation', await waitState(p1, 'saved'));
    // guest copy still intact
    ok(T + 'guest copy untouched by migration', await p1.evaluate(() => new Promise(r => { const q = indexedDB.open('tt-platform'); q.onsuccess = () => { const db = q.result, t = db.transaction('trades').objectStore('trades').count(); t.onsuccess = () => { db.close(); r(t.result === 2); }; }; })));

    // ---- 4. second device: sign in with password, data appears
    const d2 = await device('laptop', 1280), p2 = d2.p;
    await signInUI(p2, 'a@trc.test', PW); ok(T + 'device 2: signed in', await until(p2, () => TTCloud.active() !== null));
    ok(T + 'device 2: same trades after sync', await until(p2, async () => (await TTDB.getAll('trades')).length === 2, null, 15000) && await waitState(p2, 'saved'));
    ok(T + 'device 2: payout came across too', (await p2.evaluate(async () => (await TTDB.getAll('ledger')).length)) === 1);
    ok(T + 'device 2: journal screen shows them', await (async () => { await p2.evaluate(() => TTNav.go('journal')); return until(p2, () => /MNQ/.test(document.getElementById('jRoot').innerText)); })());
    await goAcct(p2); const prof = await p2.innerText('#cloudRoot'); ok(T + 'account screen: email, confirmed, display name, created', /a@trc\.test/.test(prof) && /Email confirmed\s*yes/.test(prof) && /Alice/.test(prof), prof.slice(0, 600));

    // ---- 5. edit on device 2 -> device 1
    await addTrade(p2, 'g1', { notes: 'edited on laptop' }); await syncWait(p2);
    await p1.evaluate(() => TTCloud.syncNow()); ok(T + 'edit reaches device 1', await until(p1, async () => ((await TTDB.get('trades', 'g1')) || {}).notes === 'edited on laptop'));

    // ---- 6. offline edits on device 1, reconnect
    await d1.ctx.setOffline(true); await p1.evaluate(() => window.dispatchEvent(new Event('offline')));
    await addTrade(p1, 'off1'); await addTrade(p1, 'off2');
    ok(T + 'offline: chip says offline', await waitState(p1, 'offline')); await goAcct(p1); ok(T + 'offline: the waiting changes are counted and shown', await until(p1, () => { const m = document.getElementById('cloudRoot').innerText.match(/Waiting to upload\s*(\d+)/); return m && +m[1] >= 2; }), await p1.innerText('#cloudRoot'));
    await d1.ctx.setOffline(false); await p1.evaluate(() => window.dispatchEvent(new Event('online')));
    ok(T + 'back online: uploads and confirms', await waitState(p1, 'saved', 20000)); await p2.evaluate(() => TTCloud.syncNow());
    ok(T + 'no duplicates after reconnect', await until(p2, async () => (await TTDB.getAll('trades')).length === 4) && (await rows('a@trc.test')) >= 6);
    ok(T + 'server has exactly 4 trades for A', +(await sqlq("select count(*) from public.trc_records r join auth.users u on u.id=r.owner where u.email='a@trc.test' and kind='trade' and not deleted;")) === 4);

    // ---- 7. both devices edit the same trade -> conflict, both versions kept, decision
    await d1.ctx.setOffline(true); await addTrade(p1, 'off1', { notes: 'phone version' }); await addTrade(p2, 'off1', { notes: 'laptop version' }); await syncWait(p2);
    await d1.ctx.setOffline(false); await p1.evaluate(() => TTCloud.syncNow());
    ok(T + 'conflict detected: needs attention', await waitState(p1, 'attention', 15000));
    await goAcct(p1); const ct = await p1.innerText('#cloudConflicts'); ok(T + 'conflict shows both versions', /phone version/.test(ct) && /laptop version/.test(ct), ct);
    ok(T + 'nothing overwritten: phone keeps its version until decided', (await p1.evaluate(async () => (await TTDB.get('trades', 'off1')).notes)) === 'phone version');
    await p1.click('[data-ca=keep-both]'); ok(T + 'keep both -> resolved and synced', await waitState(p1, 'saved', 15000));
    const ids1 = await trades(p1); ok(T + 'keep both: the other version is in off1, mine saved as a copy', ids1.length === 5 && (await p1.evaluate(async () => (await TTDB.get('trades', 'off1')).notes)) === 'laptop version' && await p1.evaluate(async () => (await TTDB.getAll('trades')).some(t => t.notes === 'phone version' && t.id !== 'off1')), ids1);

    // ---- 8. delete travels and never comes back
    await p2.evaluate(() => TTCloud.syncNow()); await p2.evaluate(async () => { await TTDB.del('trades', 'off2'); window.dispatchEvent(new Event('tt:journal-changed')); }); await syncWait(p2);
    await p1.evaluate(() => TTCloud.syncNow()); ok(T + 'delete reaches the other device', await until(p1, async () => !(await TTDB.get('trades', 'off2'))));
    await p1.evaluate(() => TTCloud.syncNow()); await p2.evaluate(() => TTCloud.syncNow()); await p1.waitForTimeout(500); ok(T + 'deleted trade does not reappear', !(await p1.evaluate(async () => !!(await TTDB.get('trades', 'off2')))) && !(await p2.evaluate(async () => !!(await TTDB.get('trades', 'off2')))));

    // ---- 9. session renewal: short-lived tokens refresh silently
    await api('/__test/ttl?s=2'); await p2.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt.auth.v1')); s.expires_at = Date.now() - 1; localStorage.setItem('tt.auth.v1', JSON.stringify(s)); }); await p2.waitForTimeout(100);
    await addTrade(p2, 'ttl1'); ok(T + 'expired access token is renewed automatically', await syncWait(p2) && +(await sqlq("select count(*) from public.trc_records where id='ttl1';")) === 1); await api('/__test/ttl?s=3600');

    // ---- 10. export everything (device 2) and check it
    await goAcct(p2); const [ex] = await Promise.all([p2.waitForEvent('download'), p2.click('[data-ca=export]')]); const exj = JSON.parse(fs.readFileSync(await ex.path(), 'utf8'));
    ok(T + 'cloud export is a restorable backup with every trade', exj.kind === 'journal-backup' && exj.trades.length === (await p2.evaluate(async () => (await TTDB.getAll('trades')).length)), exj.trades.length);
    const parsedBk = await p2.evaluate(t => TTJournalCore.parseBackup(t), JSON.stringify(exj)); ok(T + 'export passes the backup integrity check', parsedBk && parsedBk.ok !== false && (parsedBk.trades || []).length === exj.trades.length, parsedBk && parsedBk.error);

    // ---- 10b. safety brake: one device deleting most of the cloud stops and asks
    await p2.evaluate(async () => { const ops = []; for (let i = 0; i < 40; i++) ops.push({ store: 'trades', type: 'put', value: { id: 'bulk' + i, date: '2026-10-22', contract: 'MES', side: 'short', contracts: 1, entry: 6000, exits: [{ qty: 1, price: 5999 }], accountId: 'acct-default', createdAt: Date.now() } }); await TTDB.batch(ops); });
    await syncWait(p2); const before = await rows('a@trc.test');
    await p2.evaluate(async () => { await TTDB.clear('trades'); window.dispatchEvent(new Event('tt:journal-changed')); }); await p2.evaluate(() => TTCloud.syncNow());
    ok(T + 'mass delete: sync pauses and asks', await waitState(p2, 'attention', 10000)); await goAcct(p2); ok(T + 'mass delete: explained', /about to delete \d+ of \d+ items/.test(await p2.innerText('#cloudRoot')));
    ok(T + 'mass delete: nothing deleted in the cloud yet', (await rows('a@trc.test')) === before, [before, await rows('a@trc.test')]);
    await p2.click('[data-ca=md-restore]'); { const okb = await until(p2, async () => (await TTDB.getAll('trades')).length >= 44, null, 15000); ok(T + 'bring back from the cloud: every trade restored on this device', okb && await waitState(p2, 'saved', 15000)); }
    await p2.evaluate(async () => { for (let i = 0; i < 5; i++) await TTDB.del('trades', 'bulk' + i); window.dispatchEvent(new Event('tt:journal-changed')); }); ok(T + 'small deletes still sync normally', await syncWait(p2) && (await rows('a@trc.test')) === before - 5);

    // ---- 11. sign out on device 1 -> guest; A's data not visible; guest data back
    await goAcct(p1); await p1.click('[data-ca=signout]'); await Promise.all([p1.waitForEvent('load'), p1.click('.ui-dlg [data-r=ok]')]); await p1.evaluate(() => TTDB.ready());
    ok(T + 'after sign-out: guest mode', (await p1.evaluate(() => TTCloud.active())) === null && await waitState(p1, 'guest'));
    ok(T + 'after sign-out: only the guest trades, none of A\'s', JSON.stringify(await trades(p1)) === '["g1","g2"]', await trades(p1));
    ok(T + 'personal settings switched back to the guest\'s', (await p1.evaluate(() => localStorage.getItem('tt.ls.owner'))) === 'guest');

    // ---- 12. person B signs up and in on the same phone: sees nothing of A
    await goAcct(p1); await p1.click('[data-cform=signup]'); await p1.fill('#clEmail', 'b@trc.test'); await p1.fill('#clPass', PW); await p1.click('#clForm [type=submit]'); await until(p1, () => /Check your inbox/.test(document.getElementById('cloudRoot').innerText));
    await openMail(p1, 'b@trc.test', 'signup'); await until(p1, () => TTCloud.active() !== null);
    ok(T + 'B on the same phone: no trades from A', await until(p1, async () => (await TTDB.getAll('trades')).length === 0) && JSON.stringify(await trades(p1)) === '[]');
    ok(T + 'B: nothing of A on the journal screen', await (async () => { await p1.evaluate(() => TTNav.go('journal')); await p1.waitForTimeout(400); return !/edited on laptop|phone version|laptop version/.test(await p1.innerText('#jRoot')); })());
    await goAcct(p1); if (await p1.$('[data-ca=mig-skip]')) await p1.click('[data-ca=mig-skip]');
    ok(T + 'B has 0 trades in the cloud', +(await sqlq("select count(*) from public.trc_records r join auth.users u on u.id=r.owner where u.email='b@trc.test' and kind='trade';")) === 0);
    const bTok = await p1.evaluate(() => JSON.parse(localStorage.getItem('tt.auth.v1')).access_token);
    const steal = await (await fetch(srv.base + '/rest/v1/rpc/trc_pull', { method: 'POST', headers: { apikey: srv.anon, authorization: 'Bearer ' + bTok, 'content-type': 'application/json' }, body: '{"since_tx":0,"since_rev":0,"lim":1000}' })).json();
    ok(T + 'B\'s token cannot pull A\'s records', Array.isArray(steal) && !steal.some(r => /^(g1|g2|off1)$/.test(r.id)), steal.length);
    const anonPull = await fetch(srv.base + '/rest/v1/rpc/trc_pull', { method: 'POST', headers: { apikey: srv.anon, 'content-type': 'application/json' }, body: '{}' }); ok(T + 'no token: refused', anonPull.status === 401);
    const forged = await fetch(srv.base + '/rest/v1/rpc/trc_pull', { method: 'POST', headers: { apikey: srv.anon, authorization: 'Bearer ' + bTok.slice(0, -4) + 'AAAA', 'content-type': 'application/json' }, body: '{}' }); ok(T + 'tampered token: refused', forged.status === 401);

    // ---- 13. wrong password, throttling, password reset, magic link (device 2 after signing out)
    await goAcct(p2); await p2.click('[data-ca=signout]'); await Promise.all([p2.waitForEvent('load'), p2.click('.ui-dlg [data-r=ok]')]); await p2.evaluate(() => TTDB.ready());
    await goAcct(p2); await p2.fill('#clEmail', 'a@trc.test'); await p2.fill('#clPass', 'wrong password'); await p2.click('#clForm [type=submit]'); await until(p2, () => /not correct/.test(document.getElementById('cloudRoot').innerText));
    ok(T + 'wrong password: plain message', /Email or password is not correct/.test(await p2.innerText('#cloudRoot')));
    await p2.fill('#clEmail', 'nobody@trc.test'); await p2.fill('#clPass', 'whatever123'); await p2.click('#clForm [type=submit]'); await p2.waitForTimeout(400);
    ok(T + 'unknown email gets the same message (no enumeration)', /Email or password is not correct/.test(await p2.innerText('#cloudRoot')));
    for (let i = 0; i < 5; i++) { await p2.fill('#clEmail', 'a@trc.test'); await p2.fill('#clPass', 'wrong ' + i); await p2.click('#clForm [type=submit]'); await p2.waitForTimeout(250); }
    ok(T + 'repeated wrong passwords are throttled', /Too many attempts/.test(await p2.innerText('#cloudRoot')));
    await p2.click('[data-cform=forgot]'); await p2.fill('#clEmail', 'a@trc.test'); await p2.click('#clForm [type=submit]'); await until(p2, () => /reset link is on its way/.test(document.getElementById('cloudRoot').innerText));
    ok(T + 'reset request: neutral message', /If there is a TRC login/.test(await p2.innerText('#cloudRoot')));
    await openMail(p2, 'a@trc.test', 'recovery'); await p2.waitForSelector('#clForm[data-mode=newpass]', { timeout: 10000 });
    ok(T + 'reset link opens "choose a new password"', !!(await p2.$('#clForm[data-mode=newpass]')));
    await p2.fill('#clPass', PW2); await p2.click('#clForm [type=submit]'); ok(T + 'new password saved', await until(p2, () => !document.querySelector('#clForm[data-mode=newpass]')), await p2.innerText('#cloudRoot').then(t => t.slice(0, 300)));
    const reused = await api('/__test/open?to=a@trc.test&type=recovery'); await gotoLink(p2, reused.url); await goAcct(p2);
    ok(T + 'reused reset link: "expired or already used"', /expired or was already used/.test(await p2.innerText('#cloudRoot')));
    await goAcct(p2); if (await p2.$('[data-ca=signout]')) { await p2.click('[data-ca=signout]'); await Promise.all([p2.waitForEvent('load'), p2.click('.ui-dlg [data-r=ok]')]); await p2.evaluate(() => TTDB.ready()); }
    await api('/__test/sql', { method: 'POST', body: 'select 1' }); srv.ctl.fails = {};
    await signInUI(p2, 'a@trc.test', PW); ok(T + 'old password no longer works', (await p2.evaluate(() => TTCloud.active())) === null);
    await signInUI(p2, 'a@trc.test', PW2); ok(T + 'new password works', await until(p2, () => TTCloud.active() !== null));
    await goAcct(p2); await p2.click('[data-ca=signout]'); await Promise.all([p2.waitForEvent('load'), p2.click('.ui-dlg [data-r=ok]')]); await p2.evaluate(() => TTDB.ready());
    await goAcct(p2); await p2.click('[data-cform=magic]'); await p2.fill('#clEmail', 'a@trc.test'); await p2.click('#clForm [type=submit]'); await until(p2, () => /sign-in link is on its way/.test(document.getElementById('cloudRoot').innerText));
    await openMail(p2, 'a@trc.test', 'magiclink'); ok(T + 'magic link signs in', await until(p2, () => TTCloud.active() !== null) && await until(p2, async () => (await TTDB.getAll('trades')).length >= 4, null, 15000));

    // ---- 14. two tabs: sign out in one -> the other follows
    const tab2 = await d2.ctx.newPage(); await tab2.goto(srv.base + '/index.html#home'); await tab2.evaluate(() => TTDB.ready()); ok(T + 'second tab shows the same person', (await tab2.evaluate(() => TTCloud.active())) === (await p2.evaluate(() => TTCloud.active())));
    await goAcct(p2); await p2.click('[data-ca=signout]'); await Promise.all([p2.waitForEvent('load'), p2.click('.ui-dlg [data-r=ok]')]);
    ok(T + 'other tab switched to guest by itself (no stale data shown)', await until(tab2, () => window.TTCloud && TTCloud.active() === null, null, 8000)); await tab2.close();

    // ---- 15. sign out everywhere revokes other sessions; data on device stays
    const d3 = await device('tablet'), p3 = d3.p; await signInUI(p3, 'a@trc.test', PW2); await waitState(p3, 'saved');
    const d4 = await device('desk', 1280), p4 = d4.p; await signInUI(p4, 'a@trc.test', PW2); await waitState(p4, 'saved');
    await goAcct(p4); await p4.click('[data-ca=signout-all]'); await Promise.all([p4.waitForEvent('load'), p4.click('.ui-dlg [data-r=ok]')]);
    await api('/__test/ttl?s=1'); await p3.waitForTimeout(100); await p3.evaluate(() => { const s = JSON.parse(localStorage.getItem('tt.auth.v1')); s.expires_at = Date.now() - 1; localStorage.setItem('tt.auth.v1', JSON.stringify(s)); }); await api('/__test/ttl?s=3600');
    await p3.evaluate(() => TTCloud.syncNow()); ok(T + 'after "sign out on all devices": other device asks to sign in again', await waitState(p3, 'expired', 10000));
    ok(T + '...and keeps its data', (await p3.evaluate(async () => (await TTDB.getAll('trades')).length)) >= 4);

    // ---- 16. account deletion with a disposable login
    const d5 = await device('spare'), p5 = d5.p; await goAcct(p5); await p5.click('[data-cform=signup]'); await p5.fill('#clEmail', 'c@trc.test'); await p5.fill('#clPass', PW); await p5.click('#clForm [type=submit]'); await until(p5, () => /Check your inbox/.test(document.getElementById('cloudRoot').innerText));
    await openMail(p5, 'c@trc.test', 'signup'); await until(p5, () => TTCloud.active() !== null); await addTrade(p5, 'c1'); await waitState(p5, 'saved', 15000);
    ok(T + 'C has data in the cloud', (await rows('c@trc.test')) >= 1);
    await goAcct(p5); await p5.click('summary:has-text("Delete cloud data")'); await p5.click('[data-ca=delete]'); await p5.fill('.ui-dlg input', 'wrong password!'); await p5.click('.ui-dlg [data-r=ok]'); await p5.waitForTimeout(600);
    ok(T + 'delete with the wrong password is refused', (await sqlq("select count(*) from auth.users where email='c@trc.test';")) === '1');
    await p5.click('[data-ca=delete]'); await p5.fill('.ui-dlg input', PW); await p5.click('.ui-dlg [data-r=ok]'); await p5.waitForSelector('.ui-dlg:has-text("Login deleted")', { timeout: 10000 }); await Promise.all([p5.waitForEvent('load'), p5.click('.ui-dlg [data-r=ok]')]); await p5.evaluate(() => TTDB.ready());
    ok(T + 'login and all its cloud data deleted', (await sqlq("select count(*) from auth.users where email='c@trc.test';")) === '0' && (await sqlq("select count(*) from public.trc_records where owner not in (select id from auth.users);")) === '0');
    ok(T + 'A and B untouched by C\'s deletion', (await rows('a@trc.test')) >= 6 && (await sqlq("select count(*) from auth.users where email='b@trc.test';")) === '1');
    ok(T + 'device back in guest mode, C\'s local copy removed', (await p5.evaluate(() => TTCloud.active())) === null && await p5.evaluate(async () => !(indexedDB.databases ? (await indexedDB.databases()).some(d => /~u-/.test(d.name)) : false)));

    // ---- 17. expired link from the start screen
    await gotoLink(p5, srv.base + '/index.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'); await goAcct(p5);
    ok(T + 'expired link: clear message, address cleaned', /expired or was already used/.test(await p5.innerText('#cloudRoot')) && (await p5.evaluate(() => location.hash)) === '#account');

    // ---- 18. registry, layout, errors
    for (const [d, w] of [[p1, 390], [p2, 1280]]) { await goAcct(d); ok(T + 'account screen: no horizontal scroll at ' + w, await d.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await d.screenshot({ path: path.join(OUT, 'shots', 'cloud-' + w + '.png'), fullPage: true }); }
    ok(T + 'sync chip is a named button', await p1.evaluate(() => { const c = document.getElementById('syncChip'); return c && c.tagName === 'BUTTON' && /Cloud:/.test(c.getAttribute('aria-label')); }));
    for (const d of [p1, p2, p3, p4, p5]) ok(T + d.__name + ' no page errors', !d.__errors.filter(e => !/Failed to fetch|NetworkError|net::/.test(e)).length, d.__errors);
  } catch (e) { ok('cloud e2e crashed: ' + e.message, false, e.stack); }
  finally { await browser.close(); srv.stop(); }
  console.log(fail ? 'FAILED ' + fail + ' / passed ' + pass : 'ALL PASSED ' + pass); process.exit(fail ? 1 : 0);
})();
