// Sync engine (pure) with two simulated devices and an in-memory server that follows the same rules as cloud/supabase.sql
// (compare-and-swap push, tombstones, ordered pull). The real SQL is tested separately in cloudsql.js and end to end in cloud1e2e.js.
const path = require('path'), S = require(path.join(__dirname, '..', 'assets', 'sync-core.js'));
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const clone = o => JSON.parse(JSON.stringify(o));
function Server() {
  let rev = 0; const rows = {};
  return {
    rows,
    push(items, fmt = 1) {
      return items.map(it => {
        const k = it.kind + ':' + it.id, r = rows[k];
        if (!r) { rows[k] = { kind: it.kind, id: it.id, version: (it.base || 0) + 1, deleted: !!it.deleted, hash: it.hash, data: it.deleted ? null : clone(it.data), fmt, tx: ++rev, rev }; return { kind: it.kind, id: it.id, status: 'applied', version: rows[k].version }; }
        if (r.hash === it.hash && r.deleted === !!it.deleted) return { kind: it.kind, id: it.id, status: 'same', version: r.version };
        if (r.fmt > fmt) return { kind: it.kind, id: it.id, status: 'too_old' };
        if (it.base != null && r.version === it.base) { Object.assign(r, { version: r.version + 1, deleted: !!it.deleted, hash: it.hash, data: it.deleted ? null : clone(it.data), fmt, tx: ++rev, rev }); return { kind: it.kind, id: it.id, status: 'applied', version: r.version }; }
        return { kind: it.kind, id: it.id, status: 'conflict', server: clone(r) };
      });
    },
    pull(cur) { return Object.values(rows).filter(r => r.tx > cur.tx || (r.tx === cur.tx && r.rev > cur.rev)).sort((a, b) => a.tx - b.tx || a.rev - b.rev).map(clone); }
  };
}
function Device(server, name) {
  const d = { name, db: { trades: [], accounts: [], ledger: [], docs: [] }, state: S.emptyState(), lostWrites: false };
  d.put = (store, rec) => { d.db[store] = d.db[store].filter(r => r.id !== rec.id).concat([clone(rec)]); };
  d.del = (store, id) => { d.db[store] = d.db[store].filter(r => r.id !== id); };
  d.get = (store, id) => d.db[store].find(r => r.id === id);
  d.byKey = () => { const m = {}; Object.keys(S.STORES).forEach(st => d.db[st].forEach(r => { m[S.keyOf(S.STORES[st], r.id)] = r; })); return m; };
  d.sync = (opts = {}) => {
    const p = S.applyPull(d.state, server.pull(d.state.cursor), d.byKey());
    p.ops.forEach(o => o.type === 'put' ? d.put(o.store, o.value) : d.del(o.store, o.key)); d.state = p.state;
    const df = S.diff(d.db, d.state); if (!df.changes.length) return { pulled: p.applied, pushed: 0, conflicts: p.conflicts };
    const res = server.push(df.changes, opts.fmt);
    if (opts.dropAck) return { lost: true };                      // the server saved it but the reply never arrived
    const a = S.applyPush(d.state, df.changes, res); d.state = a.state;
    return Object.assign({ pulled: p.applied, pushed: a.result.saved, conflicts: p.conflicts + a.result.conflicts }, a.result);
  };
  return d;
}
const T = (id, pnl, extra) => Object.assign({ id, date: '2026-10-21', contract: 'MNQ', side: 'long', contracts: 1, entry: 21000, exits: [{ qty: 1, price: 21000 + pnl / 2 }] }, extra || {});
// ---- basics
let srv = Server(), A = Device(srv, 'phone'), B = Device(srv, 'laptop');
A.put('trades', T('t1', 10)); A.put('trades', T('t2', -20)); A.put('ledger', { id: 'p1', type: 'payout', amountCents: 50000 });
let r = A.sync(); eq('first sync uploads 3, server confirmed', r.pushed, 3); eq('nothing pending after confirmation', S.pendingCount(A.db, A.state), 0);
r = B.sync(); eq('second device receives all 3', [B.db.trades.length, B.db.ledger.length], [2, 1]); eq('...and has nothing to upload', S.pendingCount(B.db, B.state), 0);
r = A.sync(); eq('sync again: no duplicates, no work', [r.pushed, srv.rows && Object.keys(srv.rows).length], [0, 3]);
// ---- edit on one device reaches the other
B.put('trades', T('t1', 40)); B.sync(); A.sync(); eq('edit on laptop shows on phone', A.get('trades', 't1').exits[0].price, 21020);
// ---- concurrent edits: conflict, both versions kept, nothing overwritten
A.put('trades', T('t2', 100)); B.put('trades', T('t2', -300));
A.sync(); r = B.sync();
ok('second editor gets a conflict, not an overwrite', r.conflicts === 1, r); eq('laptop keeps its own edit locally', B.get('trades', 't2').exits[0].price, 20850);
eq('cloud still has the phone edit', srv.rows['trade:t2'].data.exits[0].price, 21050); eq('conflict stored with both versions', [B.state.conflicts[0].local.data.exits[0].price, B.state.conflicts[0].server.data.exits[0].price], [20850, 21050]);
eq('conflicted record is not pushed again until decided', S.diff(B.db, B.state).changes.length, 0);
// resolve: keep both
let rs = S.resolve(B.state, 'trade:t2', 'both', 't2-mine'); rs.ops.forEach(o => o.type === 'put' ? B.put(o.store, o.value) : B.del(o.store, o.key)); B.state = rs.state;
B.sync(); A.sync(); eq('keep both: both trades exist on both devices', [A.db.trades.map(t => t.id).sort(), B.db.trades.map(t => t.id).sort()], [['t1', 't2', 't2-mine'], ['t1', 't2', 't2-mine']]);
eq('cloud version of t2 kept', A.get('trades', 't2').exits[0].price, 21050);
// resolve: keep this device
A.put('trades', T('t1', 2)); B.put('trades', T('t1', 4)); A.sync(); B.sync();
rs = S.resolve(B.state, 'trade:t1', 'device'); B.state = rs.state; B.sync(); A.sync(); eq('keep this device: laptop value wins everywhere after the decision', [A.get('trades', 't1').exits[0].price, srv.rows['trade:t1'].data.exits[0].price], [21002, 21002]);
// resolve: keep cloud
A.put('trades', T('t1', 6)); B.put('trades', T('t1', 8)); A.sync(); B.sync(); rs = S.resolve(B.state, 'trade:t1', 'cloud'); rs.ops.forEach(o => o.type === 'put' ? B.put(o.store, o.value) : B.del(o.store, o.key)); B.state = rs.state; B.sync();
eq('keep cloud: laptop takes the phone value', B.get('trades', 't1').exits[0].price, 21003);
// ---- deletes travel and never come back
A.sync(); A.del('trades', 't2-mine'); A.sync(); B.sync(); ok('delete on phone removes it on laptop', !B.get('trades', 't2-mine'));
B.sync(); A.sync(); ok('deleted record does not reappear after more syncs', !A.get('trades', 't2-mine') && !B.get('trades', 't2-mine')); ok('cloud keeps a tombstone', srv.rows['trade:t2-mine'].deleted);
// delete here vs edit there -> conflict, the edit is not lost
A.sync(); B.sync(); A.del('ledger', 'p1'); B.put('ledger', { id: 'p1', type: 'payout', amountCents: 60000 }); B.sync(); r = A.sync();
ok('delete vs edit -> conflict (no silent loss of the edit)', r.conflicts === 1 && A.state.conflicts[0].local.deleted && A.state.conflicts[0].server.data.amountCents === 60000, r);
rs = S.resolve(A.state, 'ledger:p1', 'cloud'); rs.ops.forEach(o => o.type === 'put' ? A.put(o.store, o.value) : A.del(o.store, o.key)); A.state = rs.state; eq('choosing cloud restores the edited payout', A.get('ledger', 'p1').amountCents, 60000);
// ---- offline edits on both devices, then reconnect
A.sync(); B.sync(); for (let i = 0; i < 20; i++) A.put('trades', T('off-a' + i, i)); for (let i = 0; i < 15; i++) B.put('trades', T('off-b' + i, i));
A.sync(); B.sync(); A.sync(); eq('offline edits from both devices merge, none lost', [A.db.trades.length, B.db.trades.length], [B.db.trades.length, A.db.trades.length]); ok('count is exact', A.db.trades.filter(t => /^off-/.test(t.id)).length === 35);
// ---- lost acknowledgement (saved on server, reply lost) -> retried without duplicate
A.put('ledger', { id: 'x1', type: 'fee', amountCents: 499 }); r = A.sync({ dropAck: true }); ok('reply lost: change still counted as pending', S.pendingCount(A.db, A.state) === 1);
r = A.sync(); ok('retry recognises the change already reached the cloud (no duplicate, no conflict, nothing pending)', r.conflicts === 0 && srv.rows['ledger:x1'].version === 1 && S.pendingCount(A.db, A.state) === 0 && Object.keys(srv.rows).filter(k => k === 'ledger:x1').length === 1, r);
// and when the reply is lost but nothing new is pulled first (push retried directly): the server answers 'same'
const lostItem = [{ kind: 'ledger', id: 'x1', base: null, hash: srv.rows['ledger:x1'].hash, deleted: false, data: srv.rows['ledger:x1'].data }]; eq('direct retry of the same change -> same', srv.push(lostItem)[0].status, 'same');
// ---- older app version cannot overwrite a newer format
srv.rows['trade:t1'].fmt = 2; A.sync(); A.put('trades', T('t1', 50)); r = A.sync({ fmt: 1 }); ok('newer cloud format -> too_old, nothing overwritten', r.tooOld && srv.rows['trade:t1'].data.exits[0].price !== 21025, r); srv.rows['trade:t1'].fmt = 1;
// ---- unchanged records are not re-uploaded; pending count is exact
const C = Device(srv, 'tablet'); C.sync(); eq('fresh device downloads everything, pending 0', S.pendingCount(C.db, C.state), 0);
C.put('trades', Object.assign(C.get('trades', 'off-a1'), { notes: 'reviewed' })); eq('one edit -> exactly 1 pending', S.pendingCount(C.db, C.state), 1);
// ---- local-only fields are not uploaded; oversize and bad ids reported, not sent
const imp = { id: 'imp-1', kind: 'import', at: 1, copies: [{ name: 'a.csv', text: 'x'.repeat(10) }], counts: { trades: 1 } };
eq('import file copies stay on the device', S.prepare('doc', imp).copies, undefined);
const d2 = S.diff({ docs: [{ id: 'big', kind: 'note', text: 'x'.repeat(300000) }, { id: 'bad id!', kind: 'note' }] }, S.emptyState()); eq('oversized and invalid-id records reported, not sent', [d2.changes.length, Object.values(d2.skipped).sort()], [0, ['id', 'size']]);
// ---- hashing is order-independent
eq('same content, different key order -> same hash', S.hashOf('trade', { a: 1, b: { c: 2, d: 3 } }), S.hashOf('trade', { b: { d: 3, c: 2 }, a: 1 }));
// ---- pull while a local change is waiting is not applied over it
srv = Server(); A = Device(srv); B = Device(srv); A.put('docs', { id: 'plan-main', kind: 'plan', text: 'v1' }); A.sync(); B.sync();
B.put('docs', { id: 'plan-main', kind: 'plan', text: 'laptop' }); A.put('docs', { id: 'plan-main', kind: 'plan', text: 'phone' }); A.sync();
const pl = S.applyPull(B.state, srv.pull(B.state.cursor), B.byKey()); ok('pull does not overwrite an unsynced local edit', pl.ops.length === 0 && pl.conflicts === 1, pl);
// ---- state survives garbage
eq('pending mass-delete decision survives saving and loading', S.cleanState({ massDelete: { count: 30, of: 40, keys: ['trade:a'] }, allowDeletes: 30 }).massDelete.count + S.cleanState({ allowDeletes: 30 }).allowDeletes, 60);
eq('garbage state -> fresh state', S.cleanState('x').cursor, { tx: 0, rev: 0 }); eq('format recorded', S.cleanState({}).format, S.FORMAT);
// ---- migration plan
const fp = t => t.contract + t.date + t.entry + JSON.stringify(t.exits);
const plan = S.migrationPlan({ trades: [T('g1', 10), T('g2', 20), T('g3', 30), { id: 'bad id', date: 'x' }], accounts: [{ id: 'acct-default', name: 'Main' }, { id: 'acct-x', name: 'Apex 1' }] },
  { trades: [T('g1', 10), T('g2', 99), T('other', 30)], accounts: [{ id: 'acct-default', name: 'Main account' }] }, fp);
eq('migration: new / identical / different / same trade under another id / unreadable', [plan.add.map(x => x.rec.id), plan.same.map(x => x.rec.id), plan.differ.map(x => x.rec.id), plan.lookalike.map(x => x.rec.id + '=' + x.existingId), plan.bad.length], [['acct-x'], ['g1', 'acct-default'], ['g2'], ['g3=other'], 1]);
// ---- 5,000 trades: diff speed
const big = { trades: [] }; for (let i = 0; i < 5000; i++) big.trades.push(T('b' + i, i % 50, { notes: 'note ' + i, tags: ['a', 'b'] }));
let t0 = Date.now(); const bd = S.diff(big, S.emptyState()); const ms = Date.now() - t0; ok('diff of 5,000 trades under 500 ms (' + ms + ' ms)', bd.changes.length === 5000 && ms < 500);
// ---- each device's own untouched defaults do not raise conflicts; edited ones do
srv = Server(); A = Device(srv); B = Device(srv);
A.put('accounts', { id: 'acct-default', name: 'Main account', category: 'unassigned', createdAt: 1, note: '' }); A.put('docs', { id: 'pref-theme', kind: 'pref', value: 'dark' }); A.sync();
B.put('accounts', { id: 'acct-default', name: 'Main account', category: 'unassigned', createdAt: 2, note: '' }); B.put('docs', { id: 'pref-theme', kind: 'pref', value: 'light' });
r = B.sync(); ok('fresh device: own untouched defaults give way to the cloud copy (no conflict)', r.conflicts === 0 && B.get('accounts', 'acct-default').createdAt === 1 && B.get('docs', 'pref-theme').value === 'dark', r);
srv = Server(); A = Device(srv); B = Device(srv); A.put('accounts', { id: 'acct-default', name: 'Main account', category: 'unassigned', createdAt: 1 }); A.sync();
B.put('accounts', { id: 'acct-default', name: 'My Apex', category: 'prop', createdAt: 2 }); r = B.sync(); ok('an edited default account is a real conflict', r.conflicts === 1, r);
// ---- preferences: last saved wins, never a conflict; financial records still conflict
srv = Server(); A = Device(srv); B = Device(srv); A.put('docs', { id: 'pref-profile', kind: 'pref', recents: ['a'] }); A.sync(); B.sync();
A.put('docs', { id: 'pref-profile', kind: 'pref', recents: ['journal'] }); B.put('docs', { id: 'pref-profile', kind: 'pref', recents: ['calc'] }); A.sync(); r = B.sync(); r = Object.assign(r, B.sync());
ok('preference edits on two devices: no conflict, last saver wins', B.state.conflicts.length === 0 && srv.rows['doc:pref-profile'].data.recents[0] === 'calc', [B.state.conflicts, srv.rows['doc:pref-profile'].data]);
A.sync(); eq('...and the other device follows', A.get('docs', 'pref-profile').recents, ['calc']);
console.log((fail ? 'FAILED ' : 'ALL PASSED ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
