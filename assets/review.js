/* Tamhas Trading - Import Review / Duplicate Archive.
   A review history, never a source of P&L: archived records live in the `docs` store (kind 'dupe'), not in your trades, so they are
   never counted in the journal, calendar, dashboard, analytics or account balances unless YOU restore one as a separate trade.
   Every decision is one atomic write with an audit entry, and every decision can be undone (only if the trade it changed has not been
   edited since - otherwise TRC says so and changes nothing). Also lists duplicates found INSIDE the active journal (for example after
   restoring an old backup or syncing two devices), with "archive this copy" or "they are separate trades". */
(function () {
  'use strict';
  var root = document.getElementById('rvRoot'); if (!root) return;
  var DB = window.TTDB, DD = window.TTDedupe, J = window.TTJournalCore, U = window.TTUI, AC = window.TTAccountsCore;
  if (!DB || !DD || !J || !U) return;
  var esc = U.esc, DEF = DB.DEFAULT_ACCOUNT_ID;
  var S = { loaded: false, err: null, tab: 'todo', dupes: [], trades: {}, accounts: {}, groups: [], busy: false, open: {}, limit: 40 };

  /* ---------- data ---------- */
  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getByIndex('docs', 'kind', 'dupe'), DB.getAll('trades'), DB.getAll('accounts')]); }).then(function (r) {
      S.dupes = r[0].filter(function (d) { return d && !d.voided; }).sort(function (a, b) { return b.at - a.at; });
      S.trades = {}; var list = []; r[1].forEach(function (t) { var n = J.normalizeTrade(t); if (n.ok) { S.trades[n.trade.id] = n.trade; list.push(n.trade); } });
      S.accounts = {}; r[2].forEach(function (a) { S.accounts[a.id] = AC ? AC.normalizeAccount(a) : a; });
      S.groups = DD.scan(list, separatePairs()); S.loaded = true; S.err = null;
    }).catch(function (e) { S.loaded = true; S.err = (e && e.message) || 'Could not open the local database.'; });
  }
  // Pairs you already decided are separate trades (restored, or "they are separate") are not reported by the journal scan again.
  function separatePairs() {
    var m = {}; S.dupes.forEach(function (d) {
      if (d.status === 'restored' && d.restoredId && d.existingId) m[DD.pairKey(d.restoredId, d.existingId)] = 1;
      if (d.status === 'separate' && Array.isArray(d.pair)) for (var i = 0; i < d.pair.length; i++) for (var j = i + 1; j < d.pair.length; j++) m[DD.pairKey(d.pair[i], d.pair[j])] = 1;
      (d.items || []).forEach(function (it) { if (it.restoredId && it.existingId) m[DD.pairKey(it.restoredId, it.existingId)] = 1; });
    });
    return m;
  }
  function acctName(id) { var a = S.accounts[id || DEF]; return a ? a.name : (id || '—'); }
  function money(c, sign) { return c == null ? '—' : J.fmtMoney(c, sign); }

  /* ---------- what needs a decision ---------- */
  // Flattens archive docs into rows: one per review record, one per skipped exact duplicate.
  function rows() {
    var out = [];
    S.dupes.forEach(function (d) {
      if (d.cls === 'exact' && Array.isArray(d.items)) d.items.forEach(function (it, i) { out.push({ doc: d, i: i, item: it, cls: 'exact', status: it.restoredId ? 'restored' : 'skipped', at: d.at, existingId: it.existingId, incoming: it.incoming, why: it.why, reason: DD.REASON[it.why] || '', conf: it.conf, file: it.file }); });
      else out.push({ doc: d, cls: d.cls, status: d.status, at: d.updatedAt || d.at, existingId: d.existingId, incoming: d.incoming, why: d.why, reason: d.reason, conf: d.conf, file: d.file });
    });
    return out;
  }
  function pending() { return rows().filter(function (r) { return r.status === 'review' || r.status === 'later'; }); }
  function counts() { var rs = rows(); return { todo: rs.filter(function (r) { return r.status === 'review' || r.status === 'later'; }).length + S.groups.length, skipped: rs.filter(function (r) { return r.status === 'skipped'; }).length, decided: rs.filter(function (r) { return r.status !== 'review' && r.status !== 'later' && r.status !== 'skipped'; }).length }; }

  /* ---------- rendering ---------- */
  var CLS_LABEL = { exact: 'Exact duplicate', updated: 'Updated trade', possible: 'Possible duplicate', conflict: 'Conflicting record', scan: 'Duplicate in journal' };
  var CLS_BADGE = { exact: '', updated: 'warn', possible: 'warn', conflict: 'bad', scan: 'bad' };
  var STATUS_LABEL = { review: 'needs decision', later: 'review later', skipped: 'skipped', kept: 'kept existing', confirmed: 'confirmed duplicate', updated: 'update accepted', restored: 'restored as separate trade', archived: 'copy archived', separate: 'marked separate' };
  function legsText(t) { if (!t) return '—'; var en = t.entries && t.entries.length ? t.entries : [{ qty: t.contracts, price: t.entry }]; return en.map(function (x) { return x.qty + ' @ ' + x.price; }).join(', '); }
  function exitsText(t) { return t && t.exits && t.exits.length ? t.exits.map(function (x) { return x.qty + ' @ ' + x.price + (x.time ? ' (' + x.time + ')' : ''); }).join(', ') : 'open'; }
  function compareTable(ex, inc, row) {
    var ce = ex ? J.compute(ex) : null, ci = inc ? J.compute(inc) : null;
    var f = [['Account', ex && acctName(ex.accountId), inc && acctName(inc.accountId)], ['Instrument', ex && ex.contract, inc && inc.contract], ['Side', ex && ex.side, inc && inc.side],
      ['Entry', ex && (ex.date + ' ' + (ex.time || '') + ' · ' + legsText(ex)), inc && (inc.date + ' ' + (inc.time || '') + ' · ' + legsText(inc))], ['Exit', ex && exitsText(ex), inc && exitsText(inc)],
      ['Quantity', ex && String(ex.contracts), inc && String(inc.contracts)], ['Gross P&L', ce && money(ce.grossCents, true), ci && money(ci.grossCents, true)],
      ['Fees', ex && (ex.feesCents == null ? 'unknown' : J.fmtMoney(ex.feesCents)), inc && (inc.feesCents == null ? 'unknown' : J.fmtMoney(inc.feesCents))], ['Net P&L', ce && (ce.netCents == null ? 'unknown' : money(ce.netCents, true)), ci && (ci.netCents == null ? 'unknown' : money(ci.netCents, true))],
      ['Source', ex && (ex.srcInfo ? (ex.srcInfo.broker || '') + ' ' + (ex.srcInfo.report || '') : (ex.srcKeys ? 'import' : 'typed by hand')), row && (row.file || 'import')]];
    return '<div class="ui-table-wrap"><table class="ui-table rv-cmp"><thead><tr><th scope="col">Field</th><th scope="col">In your journal</th><th scope="col">Incoming record</th></tr></thead><tbody>' +
      f.map(function (x) { var diff = ex && inc && x[1] !== x[2]; return '<tr' + (diff ? ' class="rv-diff"' : '') + '><th scope="row">' + esc(x[0]) + '</th><td data-l="In your journal">' + esc(x[1] == null ? (ex ? '—' : 'no longer in journal') : x[1]) + '</td><td data-l="Incoming">' + esc(x[2] == null ? '—' : x[2]) + (diff ? ' <span class="vh">(differs)</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function actionsFor(r) {
    var b = function (act, label, cls) { return '<button type="button" class="btn ' + (cls || 'ghost') + ' sm" data-act="' + act + '">' + label + '</button>'; }, h = '';
    if (r.status === 'review' || r.status === 'later') {
      if (r.cls === 'updated') h += b('rv-accept', 'ACCEPT UPDATE', '') + b('rv-keep', 'KEEP EXISTING');
      else if (r.cls === 'possible') h += (r.why === 'matches-manual' ? b('rv-merge', 'MERGE INTO MY TRADE', '') : '') + b('rv-confirm', 'CONFIRM DUPLICATE', r.why === 'matches-manual' ? '' : '') + b('rv-restore', 'RESTORE AS SEPARATE TRADE');
      else if (r.cls === 'conflict') h += b('rv-keep', 'KEEP EXISTING', '') + (r.why === 'changed' && r.existingId && S.trades[r.existingId] ? b('rv-accept', 'USE INCOMING PRICES') : '') + b('rv-restore', 'RESTORE AS SEPARATE TRADE');
      if (r.status !== 'later') h += b('rv-later', 'REVIEW LATER');
    } else if (r.status === 'skipped') h += b('rv-restore', 'RESTORE AS SEPARATE TRADE');
    else h += b('rv-undo', 'UNDO DECISION');
    return h;
  }
  function isOpen(r) { var id = rowId(r); return S.open[id] != null ? S.open[id] : r.status === 'review'; }
  function rowId(r) { return r.doc.id + (r.i != null ? '#' + r.i : ''); }
  function card(r) {
    var id = rowId(r), ex = r.existingId ? S.trades[r.existingId] : null, inc = r.incoming, open = isOpen(r);
    var ci = inc ? J.compute(inc) : null;
    return '<div class="panel rv-card" data-row="' + esc(id) + '"><div class="rv-head"><div><b>' + esc(inc ? inc.date + ' ' + (inc.time || '') + ' · ' + inc.contract + ' ' + inc.side + ' ' + inc.contracts : 'record') + '</b>' +
      '<div class="note" style="margin:2px 0 0"><span class="ui-badge ' + (CLS_BADGE[r.cls] || '') + '">' + esc(CLS_LABEL[r.cls] || r.cls) + '</span> <span class="ui-badge">' + esc(STATUS_LABEL[r.status] || r.status) + '</span> · ' + esc(acctName(inc && inc.accountId)) + ' · ' + esc(ci && ci.isClosed ? money(ci.grossCents, true) + ' gross' : 'open') + '</div></div>' +
      '<button type="button" class="btn ghost sm" data-act="rv-toggle" aria-expanded="' + open + '">' + (open ? 'HIDE' : 'COMPARE') + '</button></div>' +
      '<p class="note">' + esc(r.reason || '') + (r.conf ? ' Certainty: <b>' + esc(r.conf) + '</b>.' : '') + (r.doc.hours ? ' Difference: ' + r.doc.hours + ' hours.' : '') + (r.doc.fields ? ' Differs in: ' + esc(r.doc.fields.join(', ')) + '.' : '') +
      ' Found ' + esc(new Date(r.doc.at).toLocaleString()) + (r.file ? ' in ' + esc(r.file) : '') + '.</p>' +
      (open ? compareTable(ex, inc, r) + (r.existingId && !ex && r.status !== 'restored' ? '<p class="note warnline">The trade it matched is no longer in your journal.</p>' : '') : '') +
      '<div class="ui-row rv-acts">' + actionsFor(r) + '</div>' + histText(r) + '</div>';
  }
  function histText(r) { var h = (r.i != null ? (r.item.history || []) : (r.doc.history || [])); if (!h.length) return ''; return '<details class="rv-hist"><summary>History (' + h.length + ')</summary>' + h.map(function (x) { return '<p class="note">' + esc(new Date(x.at).toLocaleString()) + ' · ' + esc(x.action) + '</p>'; }).join('') + '</details>'; }
  function groupCard(g, gi) {
    return '<div class="panel rv-card" data-group="' + gi + '"><div class="rv-head"><div><b>' + (g.level === 'certain' ? 'Same trade counted ' + g.ids.length + ' times' : 'Possible duplicate in your journal') + '</b><div class="note" style="margin:2px 0 0"><span class="ui-badge ' + (g.level === 'certain' ? 'bad' : 'warn') + '">' + esc(CLS_LABEL.scan) + '</span> · certainty ' + (g.level === 'certain' ? 'certain' : 'medium') + '</div></div></div>' +
      '<p class="note">' + esc(g.reason) + ' Until you decide, ' + (g.level === 'certain' ? 'your P&amp;L counts this trade more than once.' : 'both are counted.') + '</p>' +
      '<div class="ui-table-wrap"><table class="ui-table rv-cmp"><thead><tr><th scope="col">Trade</th><th scope="col">Account</th><th scope="col">Fills</th><th scope="col">Gross</th><th scope="col">Notes</th><th scope="col"><span class="vh">Action</span></th></tr></thead><tbody>' +
      g.ids.map(function (id) { var t = S.trades[id]; if (!t) return ''; var c = J.compute(t); return '<tr class="rv-g"><th scope="row">' + esc(t.date + ' ' + (t.time || '') + ' ' + t.contract + ' ' + t.side + ' ' + t.contracts) + '</th><td data-l="Account">' + esc(acctName(t.accountId)) + '</td><td data-l="Fills">' + esc(legsText(t) + ' → ' + exitsText(t)) + '</td><td data-l="Gross">' + esc(c.isClosed ? money(c.grossCents, true) : 'open') + '</td><td data-l="Notes">' + esc((t.notes || '').slice(0, 40) || (t.srcKeys ? 'imported' : 'typed')) + '</td><td><button type="button" class="btn ghost sm" data-act="rv-archive-copy" data-id="' + esc(id) + '">ARCHIVE THIS COPY</button></td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="ui-row rv-acts"><button type="button" class="btn ghost sm" data-act="rv-separate">THEY ARE SEPARATE TRADES</button></div></div>';
  }
  function render() {
    if (!S.loaded) { root.innerHTML = '<div class="ui-skel" aria-hidden="true"><i></i><i></i><i></i></div>'; return; }
    if (S.err) { root.innerHTML = '<div class="ui-banner bad" role="alert">' + esc(S.err) + '</div>'; return; }
    var n = counts(), rs = rows(), h = '<div class="panel"><p class="note" style="margin-top:0">Every trade TRC did not add during an import is kept here with the reason. <b>Nothing on this screen counts in your P&amp;L, statistics or balances</b> unless you restore it as a separate trade.</p>' +
      '<div class="ui-tabs" role="tablist" aria-label="Import Review">' + [['todo', 'Needs decision', n.todo], ['skipped', 'Skipped duplicates', n.skipped], ['decided', 'Decided', n.decided]].map(function (t) { return '<button type="button" role="tab" class="ui-tab' + (S.tab === t[0] ? ' on' : '') + '" aria-selected="' + (S.tab === t[0]) + '" data-act="rv-tab" data-tab="' + t[0] + '">' + t[1] + ' <span class="ui-badge">' + t[2] + '</span></button>'; }).join('') + '</div></div>';
    h += '<div id="rvList" aria-live="polite">';
    if (S.tab === 'todo') {
      var todo = rs.filter(function (r) { return r.status === 'review' || r.status === 'later'; }).sort(function (a, b) { return (a.status === 'later') - (b.status === 'later') || b.at - a.at; });
      if (!todo.length && !S.groups.length) h += U.empty('Nothing to decide', 'Imports found no uncertain records, and your journal has no duplicate trades.');
      h += S.groups.map(groupCard).join('') + todo.slice(0, S.limit).map(card).join('');
      if (todo.length > S.limit) h += '<button type="button" class="btn ghost wide" data-act="rv-more">SHOW MORE (' + (todo.length - S.limit) + ')</button>';
    } else {
      var list = rs.filter(function (r) { return S.tab === 'skipped' ? r.status === 'skipped' : (r.status !== 'review' && r.status !== 'later' && r.status !== 'skipped'); });
      if (!list.length) h += U.empty(S.tab === 'skipped' ? 'No skipped duplicates' : 'No decisions yet', S.tab === 'skipped' ? 'When an import finds trades already in your journal, they are listed here.' : 'Decisions you make on this screen are listed here, and each can be undone.');
      h += list.slice(0, S.limit).map(card).join(''); if (list.length > S.limit) h += '<button type="button" class="btn ghost wide" data-act="rv-more">SHOW MORE (' + (list.length - S.limit) + ')</button>';
    }
    root.innerHTML = h + '</div>';
  }

  /* ---------- decisions (each one atomic, audited and undoable) ---------- */
  function findRow(id) { return rows().filter(function (r) { return rowId(r) === id; })[0] || null; }
  function hist(action, extra) { return Object.assign({ at: Date.now(), action: action }, extra || {}); }
  function withDoc(r, status, entry) {
    var d = JSON.parse(JSON.stringify(r.doc)), now = Date.now();
    if (r.i != null) { var it = d.items[r.i]; it.history = (it.history || []).concat([entry]); if (entry.restoredId !== undefined) it.restoredId = entry.restoredId || undefined; if (!it.restoredId) delete it.restoredId; }
    else { d.history = (d.history || []).concat([entry]); d.status = status; if (entry.restoredId !== undefined) { if (entry.restoredId) d.restoredId = entry.restoredId; else delete d.restoredId; } }
    d.updatedAt = now; return d;
  }
  function save(ops, msg, auditType, details) {
    S.busy = true; ops.push({ store: 'audit', type: 'put', value: { id: DB.uid('au'), at: Date.now(), type: auditType, details: details || null } });
    return DB.batch(ops).then(function () {
      if (window.TTStore) window.TTStore.invalidate(); try { window.dispatchEvent(new Event('tt:journal-changed')); window.dispatchEvent(new Event('tt:dupes-changed')); } catch (e) {} if (window.TTJournal) window.TTJournal.reload();
      U.toast(msg); return load();
    }).then(function () { S.busy = false; render(); }).catch(function () { S.busy = false; U.toast('Could not save that decision (browser storage blocked or full). Nothing was changed.', true); });
  }
  function freshTrade(id) { return DB.get('trades', id).then(function (t) { if (!t) return null; var n = J.normalizeTrade(t); return n.ok ? n.trade : null; }); }
  function impactText(t) {
    var c = J.compute(t); return 'Restoring adds 1 trade to ' + acctName(t.accountId) + ' on ' + t.date + ': ' + (c.isClosed ? money(c.grossCents, true) + ' gross, net ' + (c.netCents == null ? 'unknown (fees not known)' : money(c.netCents, true)) : 'an open position (no P&L yet)') +
      '. Your trade count, win rate, calendar, dashboard and account balance will include it. If it is really the same trade as one already in your journal, those numbers will be overstated by this amount.';
  }
  function act(a, r) {
    if (S.busy || !r) return;
    var inc = r.incoming;
    if (a === 'rv-later') return save([{ store: 'docs', type: 'put', value: withDoc(r, 'later', hist('marked review later', { prev: r.status })) }], 'Kept for later.', 'dupe-later', { id: r.doc.id });
    if (a === 'rv-keep' || a === 'rv-confirm') return save([{ store: 'docs', type: 'put', value: withDoc(r, a === 'rv-keep' ? 'kept' : 'confirmed', hist(a === 'rv-keep' ? 'kept the existing trade' : 'confirmed as a duplicate', { prev: r.status })) }], a === 'rv-keep' ? 'Kept your existing trade.' : 'Confirmed as a duplicate. Nothing was added.', 'dupe-' + (a === 'rv-keep' ? 'keep' : 'confirm'), { id: r.doc.id });
    if (a === 'rv-accept' || a === 'rv-merge') {
      return freshTrade(r.existingId).then(function (ex) {
        if (!ex) { U.toast('The matching trade is no longer in your journal. Use Restore as separate trade instead.', true); return; }
        var mode = a === 'rv-merge' ? 'merge' : (r.doc.mode || (r.why === 'changed' ? 'fills' : 'fees')), after = DD.applyUpdate(ex, inc, r.why === 'changed' ? 'fills' : mode);
        var e = hist(a === 'rv-merge' ? 'merged the import into your trade' : 'accepted the updated information', { prev: r.status, before: DD.snap(ex), afterHash: DD.tradeHash(after), tradeId: ex.id });
        return save([{ store: 'trades', type: 'put', value: after }, { store: 'docs', type: 'put', value: withDoc(r, 'updated', e) }], a === 'rv-merge' ? 'Merged. Your notes were kept.' : 'Trade updated. Your notes were kept.', 'dupe-accept', { id: r.doc.id, trade: ex.id });
      });
    }
    if (a === 'rv-restore') {
      return U.confirm('Restore as a separate trade?', impactText(inc), 'RESTORE', false).then(function (yes) {
        if (!yes) return;
        var nt = DD.asSeparate(inc, 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)); nt.createdAt = Date.now(); delete nt.importBatch;
        var e = hist('restored as a separate trade', { prev: r.status, restoredId: nt.id, restoredHash: DD.tradeHash(nt) });
        return save([{ store: 'trades', type: 'put', value: nt }, { store: 'docs', type: 'put', value: withDoc(r, 'restored', e) }], 'Restored as a separate trade. It now counts in your P&L.', 'dupe-restore', { id: r.doc.id, trade: nt.id });
      });
    }
    if (a === 'rv-undo') return undo(r);
  }
  function lastEntry(r) { var h = r.i != null ? (r.item.history || []) : (r.doc.history || []); return h[h.length - 1] || null; }
  function undo(r) {
    var e = lastEntry(r); if (!e) { U.toast('This was decided by the import itself. Undo the whole import from Import history instead.', true); return; }
    var prev = e.prev || 'review', ops = [];
    var finish = function () { ops.push({ store: 'docs', type: 'put', value: withDoc(r, prev, hist('undid: ' + e.action, { prev: r.status, restoredId: e.restoredId ? null : undefined })) }); return save(ops, 'Decision undone.', 'dupe-undo', { id: r.doc.id }); };
    if (e.restoredId) {
      return Promise.all([freshTrade(e.restoredId), window.TTJournal && window.TTJournal.hasShots ? window.TTJournal.hasShots(e.restoredId) : Promise.resolve(false)]).then(function (x) {
        var t = x[0]; if (t && (DD.tradeHash(t) !== e.restoredHash || x[1])) { U.toast('The restored trade was edited (or has screenshots) since, so it was not removed. Delete it from the journal if you want.', true); return; }
        if (t) ops.push({ store: 'trades', type: 'del', key: e.restoredId }); return finish();
      });
    }
    if (e.before && e.tradeId) {
      return freshTrade(e.tradeId).then(function (t) {
        if (!t || DD.tradeHash(t) !== e.afterHash) { U.toast('That trade was edited since the update, so it was not changed back.', true); return; }
        ops.push({ store: 'trades', type: 'put', value: e.before }); return finish();
      });
    }
    if (e.archived) {   // a copy archived from the journal scan: put it back
      return freshTrade(e.archived.id).then(function (t) { if (t) { U.toast('A trade with that id is already in your journal.', true); return; } ops.push({ store: 'trades', type: 'put', value: e.archived }); ops.push({ store: 'docs', type: 'del', key: r.doc.id }); return save(ops, 'Trade put back in your journal.', 'dupe-undo', { id: r.doc.id }); });
    }
    if (r.doc.status === 'separate') { ops.push({ store: 'docs', type: 'del', key: r.doc.id }); return save(ops, 'Undone. TRC will point these out again.', 'dupe-undo', { id: r.doc.id }); }
    return finish();
  }
  // Journal scan decisions
  function archiveCopy(gi, id) {
    var g = S.groups[gi]; if (!g) return; var keep = g.ids.filter(function (x) { return x !== id; })[0];
    Promise.all([freshTrade(id), window.TTJournal && window.TTJournal.hasShots ? window.TTJournal.hasShots(id) : Promise.resolve(false)]).then(function (x) {
      var t = x[0]; if (!t) return; if (x[1]) { U.toast('This copy has screenshots. Archive the other copy, or move the screenshots first.', true); return; }
      var c = J.compute(t);
      return U.confirm('Archive this copy?', 'It leaves your journal (' + (c.isClosed ? money(c.grossCents, true) + ' gross' : 'open position') + ' is no longer counted) and is kept in Import Review, where you can put it back.', 'ARCHIVE', true).then(function (yes) {
        if (!yes) return; var now = Date.now();
        var doc = { id: ('dps-' + now.toString(36) + Math.random().toString(36).slice(2, 6)), kind: 'dupe', at: now, createdAt: now, updatedAt: now, cls: 'scan', why: g.why, reason: g.reason, conf: g.level === 'certain' ? 'certain' : 'medium', status: 'archived', existingId: keep, incoming: DD.snap(t), history: [hist('archived this copy from the journal', { prev: 'review', archived: DD.snap(t) })] };
        return save([{ store: 'trades', type: 'del', key: id }, { store: 'docs', type: 'put', value: doc }], 'Copy archived. It no longer counts in your P&L.', 'dupe-archive-copy', { trade: id, kept: keep });
      });
    });
  }
  function markSeparate(gi) {
    var g = S.groups[gi]; if (!g) return; var now = Date.now();
    save([{ store: 'docs', type: 'put', value: { id: 'dps-' + now.toString(36) + Math.random().toString(36).slice(2, 6), kind: 'dupe', at: now, createdAt: now, updatedAt: now, cls: 'scan', why: g.why, reason: g.reason, conf: 'medium', status: 'separate', pair: g.ids.slice(), incoming: DD.snap(S.trades[g.ids[0]]), existingId: g.ids[1], history: [] } }], 'Marked as separate trades.', 'dupe-separate', { ids: g.ids });
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'rv-tab') { S.tab = b.getAttribute('data-tab'); S.limit = 40; render(); var t = root.querySelector('[data-tab="' + S.tab + '"]'); if (t) t.focus(); return; }
    if (a === 'rv-more') { S.limit += 40; render(); return; }
    var gEl = b.closest('[data-group]'); if (gEl) { var gi = +gEl.getAttribute('data-group'); if (a === 'rv-archive-copy') archiveCopy(gi, b.getAttribute('data-id')); else if (a === 'rv-separate') markSeparate(gi); return; }
    var rEl = b.closest('[data-row]'); if (!rEl) return; var id = rEl.getAttribute('data-row');
    if (a === 'rv-toggle') { S.open[id] = !isOpen(findRow(id)); render(); var nb = root.querySelector('[data-row="' + id + '"] [data-act=rv-toggle]'); if (nb) nb.focus(); return; }
    act(a, findRow(id));
  });
  function refresh() { return load().then(render); }
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'review') refresh(); });
  ['tt:dupes-changed', 'tt:journal-changed'].forEach(function (ev) { window.addEventListener(ev, function () { if (S.loaded && document.getElementById('view-review') && document.getElementById('view-review').classList.contains('active') && !S.busy) refresh(); }); });
  // Small count for other screens (Import start screen, dashboard): records that need a decision + duplicate groups in the journal.
  window.TTReview = { state: S, reload: refresh, pendingCount: function () { return load().then(function () { return counts().todo; }); } };
})();
