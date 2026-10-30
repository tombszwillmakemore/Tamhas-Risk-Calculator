/* Tamhas Trading - system health / integrity audit (pure functions, no DOM). Looks for problems in your saved data and
   reports them in plain words. It never changes anything by itself: every repair is a separate, confirmed action that
   only ever ADDS or MOVES data to quarantine, never deletes your trades. */
(function (root) {
  'use strict';
  var C = root.TTJournalCore || (typeof require !== 'undefined' ? require('./journal-core.js') : null);
  function s(v) { return v == null ? '' : String(v); }
  function dupes(list, f) { var seen = {}, d = []; list.forEach(function (x) { var k = f(x); if (seen[k]) d.push(k); seen[k] = 1; }); return d; }
  // data: {trades:[raw], accounts:[], ledger:[], quarantine:[], docs:[], meta:[]}
  function audit(data) {
    var issues = [], ok = [], add = function (id, level, title, text, fix) { issues.push({ id: id, level: level, title: title, text: text, fix: fix || null }); };
    var trades = data.trades || [], accts = data.accounts || [], ledger = data.ledger || [], docs = data.docs || [], q = data.quarantine || [];
    var invalid = [], valid = []; trades.forEach(function (raw) { var r = C.normalizeTrade(raw); if (r.ok) valid.push(r.trade); else invalid.push({ id: raw && raw.id, errors: r.errors }); });
    if (invalid.length) add('bad-trades', 'warn', invalid.length + ' ' + (invalid.length === 1 ? 'trade' : 'trades') + ' could not be read', 'These saved trades fail validation and are skipped by every screen: ' + invalid.slice(0, 5).map(function (x) { return s(x.id) || '(no id)'; }).join(', ') + (invalid.length > 5 ? ' and more' : '') + '. They are still in your database and in backups. You can move them to the quarantine list, which keeps them.', { id: 'quarantine-bad-trades', label: 'Move to quarantine (kept)', ids: invalid.map(function (x) { return x.id; }).filter(Boolean) });
    else ok.push('All ' + trades.length + ' saved trades pass validation.');
    var aIds = {}; accts.forEach(function (a) { aIds[a.id] = 1; });
    var orphanT = valid.filter(function (t) { return t.accountId && !aIds[t.accountId]; });
    if (orphanT.length) add('orphan-trades', 'warn', orphanT.length + ' trades belong to an account that no longer exists', 'They still count in the journal. Re-create the account or reassign them from the journal.', null); else ok.push('Every trade belongs to an existing account.');
    var orphanL = ledger.filter(function (l) { return l.accountId && !aIds[l.accountId]; }); if (orphanL.length) add('orphan-ledger', 'warn', orphanL.length + ' money entries belong to a missing account', 'Fees, payouts or deposits point to an account that is gone. They are kept and not deleted.', null); else ok.push('Every money entry belongs to an existing account.');
    var dupT = dupes(trades, function (t) { return s(t && t.id); }); if (dupT.length) add('dup-ids', 'bad', 'Duplicate trade ids', 'Two trades share an id, which should be impossible. Export a backup and report this.', null);
    var sIds = {}, cIds = {}; docs.forEach(function (d) { if (d.kind === 'strategy') sIds[d.id] = 1; if (d.kind === 'checklist' && d.type === 'def') cIds[d.id] = 1; if (d.kind === 'routine' && d.type === 'def') cIds[d.id] = 1; });
    var orphanB = docs.filter(function (d) { return d.kind === 'backtest' && !sIds[d.strategyId]; }); if (orphanB.length) add('orphan-backtest', 'info', orphanB.length + ' backtest ' + (orphanB.length === 1 ? 'set belongs' : 'sets belong') + ' to a deleted strategy', 'They are hidden but still stored and in backups. You can move them to quarantine.', { id: 'quarantine-docs', label: 'Move to quarantine (kept)', ids: orphanB.map(function (d) { return d.id; }) }); else ok.push('Every backtest belongs to a strategy.');
    var orphanR = docs.filter(function (d) { return ((d.kind === 'checklist' || d.kind === 'routine') && d.type === 'run' && !cIds[d.defId]); }); if (orphanR.length) add('orphan-runs', 'info', orphanR.length + ' checklist runs belong to a deleted list', 'They are hidden but stored. They no longer count toward your discipline score.', { id: 'quarantine-docs', label: 'Move to quarantine (kept)', ids: orphanR.map(function (d) { return d.id; }) });
    var badDocs = docs.filter(function (d) { return !d || typeof d.id !== 'string' || typeof d.kind !== 'string' || C.DOC_KINDS.indexOf(d.kind) < 0; }); if (badDocs.length) add('bad-docs', 'warn', badDocs.length + ' saved items have an unknown type', 'They are ignored by the app and kept in backups.', null);
    var future = valid.filter(function (t) { return t.date > (data.today || '9999-99-99'); }); if (data.today && future.length) add('future', 'info', future.length + ' trades are dated in the future', 'Check the dates. Future trades are counted in the journal.', null);
    var inv = valid.filter(function (t) { return t.entry != null && t.stop != null && ((t.side === 'long' && t.stop >= t.entry) || (t.side === 'short' && t.stop <= t.entry)); }); if (inv.length) add('stop-side', 'info', inv.length + ' trades have a stop on the wrong side of entry', 'A long stop should be below entry (a short stop above). Their risk is shown as unknown.', null);
    if (q.length) add('quarantine', 'info', U_(q.length) + ' in quarantine', 'Kept safely, not used by any screen. Included in the full backup.', null);
    var level = issues.some(function (i) { return i.level === 'bad'; }) ? 'bad' : issues.some(function (i) { return i.level === 'warn'; }) ? 'warn' : 'good';
    return { level: level, issues: issues, ok: ok, counts: { trades: trades.length, valid: valid.length, accounts: accts.length, ledger: ledger.length, docs: docs.length, quarantine: q.length } };
  }
  function U_(n) { return n + ' ' + (n === 1 ? 'item' : 'items'); }
  // Getting-started steps, ticked from what actually exists.
  function steps(data) {
    var docs = data.docs || [], has = function (k) { return docs.some(function (d) { return d.kind === k; }); };
    return [
      { id: 'install', label: 'Optional: add TRC to your Home Screen', done: !!data.installed, go: 'install', optional: true },
      { id: 'trade', label: 'Import your trades (or add one by hand)', done: (data.trades || []).length > 0, go: 'import' },
      { id: 'account', label: 'Add the account you trade', done: (data.accounts || []).filter(function (a) { return a.id !== 'acct-default'; }).length > 0 || (data.accounts || []).some(function (a) { return a.id === 'acct-default' && a.name !== 'Main account'; }), go: 'accounts' },
      { id: 'limits', label: 'Set your own risk limits', done: has('risklimit'), go: 'risk' },
      { id: 'plan', label: 'Write your trading plan', done: docs.some(function (d) { return d.kind === 'plan'; }), go: 'discipline' },
      { id: 'backup', label: 'Download a backup', done: !!data.lastBackup, go: 'journal' }
    ];
  }
  var api = { audit: audit, steps: steps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTHealthCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
