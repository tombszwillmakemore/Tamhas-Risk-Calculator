/* Tamhas Trading - CSV import screen: choose file -> map columns -> preview -> import, plus history and rollback.
   The preview shows exactly what will be added, what is skipped and why. Nothing is written until you confirm, the write is
   atomic, and every import can be rolled back (only trades you have not edited since are removed). */
(function () {
  'use strict';
  var root = document.getElementById('iRoot'); if (!root) return;
  var I = window.TTImport, J = window.TTJournalCore, U = window.TTUI, DB = window.TTDB, ST = window.TTStore, AC = window.TTAccountsCore;
  var esc = U.esc, $ = function (s, r) { return (r || root).querySelector(s); };
  var BROWSER_TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();
  var TZS = [['as-is', 'No conversion (times are already in my journal time zone)'], ['UTC', 'UTC'], ['America/New_York', 'US Eastern (New York)'], ['America/Chicago', 'US Central (Chicago)'], ['America/Denver', 'US Mountain (Denver)'], ['America/Los_Angeles', 'US Pacific (Los Angeles)'], ['Europe/London', 'London'], ['Europe/Berlin', 'Central Europe (Berlin)'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney']];
  var S = { step: 'file', loaded: false, err: null, accounts: [], history: [], templates: [], fileName: '', fileSize: 0, parsed: null, mode: 'fills', mapping: {}, opts: { dateOrder: 'mdy', fileTz: 'as-is', feesPerContract: false }, accountId: 'acct-default', accountMap: {}, plan: null, tplName: '', usedTemplate: null, busy: false, msg: '' };

  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('accounts'), ST.list('import'), ST.list('template')]); }).then(function (r) {
      S.accounts = r[0].map(AC.normalizeAccount).filter(function (a) { return !a.archived; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
      S.history = r[1].sort(function (a, b) { return b.at - a.at; }); S.templates = r[2].filter(function (t) { return t.type === 'import-mapping'; }); S.loaded = true; S.err = null;
      if (!S.accounts.some(function (a) { return a.id === S.accountId; }) && S.accounts.length) S.accountId = S.accounts[0].id;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function acctName(id) { var a = S.accounts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }

  /* ---------- step 1: file + history ---------- */
  function fileStep() {
    var h = '<div class="panel"><h2>Import trades from a CSV file</h2><p class="note" style="margin-top:0">Export your trades or fills from your broker or platform as CSV, then choose the file here. You map the columns once (and can save the mapping). Nothing leaves your device.</p>' +
      '<label for="im-file">CSV file</label><input id="im-file" type="file" accept=".csv,.txt,.tsv,text/csv,text/plain">' + (S.msg ? '<p class="note bad" role="alert">' + esc(S.msg) + '</p>' : '') +
      '<details class="io"><summary>Which kind of file?</summary><p class="note"><b>Fills</b> (one row per buy or sell): the importer pairs them into trades, first-in-first-out, flat to flat. Extra buys in the direction of your position become scale-ins and partial sells become partial exits.<br><br><b>Trades</b> (one row per finished trade, with entry and exit prices): each row becomes one trade.<br><br>Supported contracts: ' + J.INST_LIST_TEXT + '. Rows for other contracts are skipped and listed. Prices must have at most 2 decimals.</p></details></div>';
    return h + historyPanel();
  }
  function historyPanel() {
    if (!S.history.length) return '';
    return '<div class="panel"><h2>Import history</h2><ul class="ui-list">' + S.history.map(function (h) {
      var rb = h.rolledBack;
      return '<li class="m-row"><div><b>' + esc(h.fileName || 'file') + '</b> <span class="ui-badge ' + (rb ? 'warn' : 'good') + '">' + (rb ? 'rolled back' : 'imported') + '</span><div class="note" style="margin:2px 0 0">' + esc(new Date(h.at).toLocaleString()) + ' · ' + esc(h.mode) + ' · ' + U.plural(h.counts.trades, 'trade') + ' · ' + esc(acctName(h.accountId)) +
        (rb ? '<br>Rolled back ' + esc(new Date(rb.at).toLocaleString()) + ': ' + rb.removed + ' removed' + (rb.kept ? ', ' + rb.kept + ' kept (edited or have screenshots)' : '') : '') + '</div></div>' +
        (rb ? '' : '<button class="btn ghost sm" data-act="im-rollback" data-id="' + esc(h.id) + '">ROLL BACK</button>') + '</li>'; }).join('') + '</ul></div>';
  }

  /* ---------- step 2: mapping ---------- */
  function sampleOf(i) { for (var r = 0; r < S.parsed.rows.length && r < 50; r++) { var v = S.parsed.rows[r][i]; if (v != null && String(v).trim() !== '') return String(v).slice(0, 40); } return ''; }
  function mapStep() {
    var fields = I.FIELDS[S.mode], hs = S.parsed.headers, h = '<div class="ui-sec"><h2>Map the columns</h2><button class="btn ghost sm" data-act="im-restart">‹ CHOOSE ANOTHER FILE</button></div>';
    h += '<div class="panel ui-form"><p class="note" style="margin-top:0"><b>' + esc(S.fileName) + '</b> · ' + U.plural(S.parsed.rows.length, 'row') + ' · ' + esc(S.parsed.delimiter === '\t' ? 'tab' : S.parsed.delimiter) + '-separated' + (S.usedTemplate ? ' · using your saved settings "' + esc(S.usedTemplate) + '"' : '') + '</p>' +
      '<label for="im-mode">What does each row contain?</label><select id="im-mode"><option value="fills"' + (S.mode === 'fills' ? ' selected' : '') + '>One fill (a single buy or sell)</option><option value="trades"' + (S.mode === 'trades' ? ' selected' : '') + '>One finished trade (entry and exit prices)</option></select>';
    fields.forEach(function (f) {
      var cur = S.mapping[f[0]]; h += '<label for="im-map-' + f[0] + '">' + esc(f[1]) + (f[2] ? ' *' : '') + '</label><select id="im-map-' + f[0] + '" data-map="' + f[0] + '"><option value="">— not in my file —</option>' + hs.map(function (x, i) { return '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + esc(x || '(column ' + (i + 1) + ')') + '</option>'; }).join('') + '</select>' +
        (cur != null && cur >= 0 ? '<small class="ui-hint">e.g. ' + esc(sampleOf(cur)) + '</small>' : '');
    });
    h += '<label for="im-order">Date order in slash dates (10/21/2026)</label><select id="im-order"><option value="mdy"' + (S.opts.dateOrder === 'mdy' ? ' selected' : '') + '>Month / Day / Year</option><option value="dmy"' + (S.opts.dateOrder === 'dmy' ? ' selected' : '') + '>Day / Month / Year</option></select>' +
      '<label for="im-tz">Time zone of the times in the file</label><select id="im-tz">' + TZS.map(function (z) { return '<option value="' + z[0] + '"' + (S.opts.fileTz === z[0] ? ' selected' : '') + '>' + esc(z[1]) + '</option>'; }).join('') + '</select>' +
      '<small class="ui-hint">' + (S.opts.fileTz === 'as-is' ? 'Times are kept exactly as written.' : 'Times are converted to your device time zone (' + esc(BROWSER_TZ) + '). Times that include their own offset (…Z, …+02:00) are always converted exactly.') + '</small>' +
      '<label class="ui-chk"><input type="checkbox" id="im-fpc"' + (S.opts.feesPerContract ? ' checked' : '') + '><span>The fee column is per contract (multiply by quantity)</span></label>';
    // accounts
    var acctCol = S.mapping.account, distinct = [];
    if (acctCol != null && acctCol >= 0) { var seen = {}; S.parsed.rows.forEach(function (r) { var v = String(r[acctCol] == null ? '' : r[acctCol]).trim(); if (v && !seen[v]) { seen[v] = 1; distinct.push(v); } }); }
    var accOpts = S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>'; }).join('');
    h += '<label for="im-acct">Import into account' + (distinct.length > 1 ? ' (for rows with no match)' : '') + '</label><select id="im-acct">' + S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (S.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>';
    if (distinct.length > 1 && distinct.length <= 20) { h += '<p class="note">The file contains ' + distinct.length + ' account names. Match each to one of yours:</p>'; distinct.forEach(function (d, i) { h += '<label for="im-am-' + i + '">' + esc(d.slice(0, 40)) + '</label><select id="im-am-' + i + '" data-am="' + esc(d) + '">' + accOpts.replace('value="' + esc(S.accountMap[d] || S.accountId) + '"', 'value="' + esc(S.accountMap[d] || S.accountId) + '" selected') + '</select>'; }); }
    else if (distinct.length > 20) h += '<p class="note warnline">The account column has more than 20 different values, so it is ignored. Everything goes into the account above.</p>';
    h += '<label for="im-tpl">Save these settings as (optional)</label><input id="im-tpl" type="text" maxlength="60" placeholder="e.g. My broker fills" value="' + esc(S.tplName) + '"><div class="ui-hint">Next time a file with the same column headings is chosen, the settings are filled in for you.</div>';
    return h + '<div class="ui-row" style="margin-top:14px"><button class="btn" data-act="im-preview">PREVIEW IMPORT</button></div>' + (S.msg ? '<p class="note bad" role="alert">' + esc(S.msg) + '</p>' : '') + '</div>';
  }

  /* ---------- step 3: preview ---------- */
  function previewStep() {
    var p = S.plan, m = J.fmtMoney, h = '<div class="ui-sec"><h2>Preview</h2><button class="btn ghost sm" data-act="im-back">‹ BACK TO MAPPING</button></div>';
    h += '<div class="ui-grid g2">' + U.stat('Will be imported', String(p.trades.length), U.plural(p.trades.length, 'new trade'), p.trades.length ? 'pos' : 'dim') + U.stat('Already imported', String(p.duplicates), 'skipped as duplicates') +
      U.stat('Rows in file', String(p.rows), p.fills != null ? p.fills + ' readable fills' : '') + U.stat('Need attention', String(Object.keys(p.problems).reduce(function (a, k) { return a + p.problems[k].n; }, 0) + p.invalid.length + p.partial.length + p.tooBig), 'rows or trades left out') + '</div>';
    if (p.openAtEnd) h += '<div class="ui-banner warn">' + U.plural(p.openAtEnd, 'position') + ' still open at the end of the file. ' + (p.openAtEnd === 1 ? 'It is' : 'They are') + ' imported as open trades (no exit yet). If your exits are in a later export, import that file after rolling this one back, or edit the trade.</div>';
    if (p.partial.length) h += '<div class="ui-banner warn"><b>' + U.plural(p.partial.length, 'trade') + ' partly imported before.</b> Some of their fills are already in your journal and some are new (overlapping exports). They are skipped so nothing is half-imported or doubled. Roll back the earlier import and re-import the larger file to include them.</div>';
    if (p.tooBig) h += '<div class="ui-banner warn">' + U.plural(p.tooBig, 'trade') + ' would have more than ' + I.LIMITS.fillsPerTrade + ' fills and were left out.</div>';
    var us = Object.keys(p.unsupported); if (us.length) h += '<div class="ui-banner warn"><b>Contracts not supported yet (skipped):</b> ' + us.slice(0, 12).map(function (k) { return esc(k) + ' × ' + p.unsupported[k]; }).join(', ') + (us.length > 12 ? ', …' : '') + '. Only contracts with verified point values can be imported (' + esc(J.INST_LIST_TEXT) + ').</div>';
    var pk = Object.keys(p.problems); if (pk.length) h += '<div class="ui-banner bad"><b>Rows that could not be read</b><ul class="ui-list">' + pk.map(function (k) { return '<li><span>' + esc(k) + '<div class="note" style="margin:2px 0 0">first at file line ' + p.problems[k].rows.join(', ') + '</div></span><b>' + p.problems[k].n + '</b></li>'; }).join('') + '</ul></div>';
    if (p.invalid.length) h += '<div class="ui-banner bad"><b>' + U.plural(p.invalid.length, 'trade') + ' failed the journal checks:</b> ' + p.invalid.slice(0, 5).map(function (x) { return 'line ' + x.line + ': ' + esc(x.reason); }).join(' · ') + '</div>';
    if (p.reconcile.checked) h += '<p class="note">P&amp;L check: ' + p.reconcile.matched + ' of ' + p.reconcile.checked + ' trades match the P&amp;L column in your file (to the cent, before or after fees).' + (p.reconcile.mismatched.length ? ' <span class="warnline">' + p.reconcile.mismatched.length + ' differ; the journal always calculates from prices, so check the mapping or fees.</span>' : '') + '</p>';
    if (p.trades.length) {
      h += '<div class="panel"><h2>First ' + Math.min(12, p.trades.length) + ' of ' + p.trades.length + '</h2><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Date</th><th>Contract</th><th>Qty</th><th>Entry</th><th>Exits</th><th>Gross</th><th>Fees</th></tr></thead><tbody>' + p.trades.slice(0, 12).map(function (x) {
        var t = x.trade, c = x.c; return '<tr><td>' + esc(t.date + (t.time ? ' ' + t.time : '')) + '</td><td>' + esc(t.contract) + ' ' + esc(t.side) + '</td><td>' + t.contracts + (t.entries ? ' <small class="note">' + t.entries.length + ' fills</small>' : '') + '</td><td>' + esc(String(t.entry)) + '</td><td>' + (t.exits.length ? t.exits.length : '—') + (c.status !== 'closed' ? ' <small class="note">' + esc(c.status) + '</small>' : '') + '</td><td class="' + U.cls(c.grossCents) + '">' + (c.grossCents == null ? '—' : esc(m(c.grossCents, true))) + '</td><td>' + (c.feesCents == null ? '<small class="note">not entered</small>' : esc(m(c.feesCents))) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
      h += '<div class="panel"><p class="note" style="margin-top:0">Trades go into <b>' + esc(acctName(S.accountId)) + '</b>' + (Object.keys(S.accountMap).length ? ' (or the account you matched for each name)' : '') + '. You can roll this import back afterwards from the import history. Take a backup first if you like (Journal › Backup).</p>' +
        '<button class="btn wide" data-act="im-commit"' + (S.busy ? ' disabled' : '') + '>IMPORT ' + U.plural(p.trades.length, 'TRADE') + '</button></div>';
    } else h += U.empty('Nothing new to import', 'Every readable trade in this file is already in your journal, or the rows could not be read. Check the notes above.');
    return h;
  }

  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; }
    if (S.err) { root.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    root.innerHTML = S.step === 'map' ? mapStep() : S.step === 'preview' ? previewStep() : fileStep();
  }

  /* ---------- actions ---------- */
  function readOpts(batchId) {
    var o = { mode: S.mode, mapping: S.mapping, dateOrder: S.opts.dateOrder, fileTz: S.opts.fileTz, targetTz: BROWSER_TZ, feesPerContract: !!S.opts.feesPerContract, defaultAccountId: S.accountId, accountMap: S.accountMap };
    if (batchId) o.batchId = batchId; return o;
  }
  function existingKeys() { return DB.getAll('trades').then(function (list) { var set = new Set(); list.forEach(function (t) { (t.srcKeys || []).forEach(function (k) { set.add(k); }); }); return set; }); }
  function validateMapping() {
    var miss = I.FIELDS[S.mode].filter(function (f) { return f[2] && (S.mapping[f[0]] == null || S.mapping[f[0]] < 0); }).map(function (f) { return f[1]; });
    return miss.length ? 'Choose a column for: ' + miss.join(', ') + '.' : null;
  }
  function chooseFile(file) {
    S.msg = '';
    if (!file) return; if (file.size > I.LIMITS.chars) { S.msg = 'That file is larger than ' + (I.LIMITS.chars / 1e6) + ' MB.'; render(); return; }
    var rd = new FileReader(); rd.onerror = function () { S.msg = 'Could not read that file.'; render(); };
    rd.onload = function () {
      var parsed = I.parseCsv(String(rd.result)); if (!parsed.ok) { S.msg = parsed.error; render(); return; }
      S.parsed = parsed; S.fileName = file.name.slice(0, 120); S.fileSize = file.size; S.mode = I.detectMode(parsed.headers); S.mapping = I.suggestMapping(parsed.headers, S.mode); S.usedTemplate = null; S.tplName = ''; S.accountMap = {};
      var sig = I.headerSignature(parsed.headers), tpl = S.templates.filter(function (t) { return t.signature === sig; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; })[0];
      if (tpl) { S.mode = tpl.mode; S.mapping = Object.assign({}, tpl.mapping); S.opts = Object.assign({ dateOrder: 'mdy', fileTz: 'as-is', feesPerContract: false }, tpl.options); S.usedTemplate = tpl.name; S.tplName = tpl.name; }
      S.step = 'map'; render();
    };
    rd.readAsText(file);
  }
  function collect() {
    S.mode = $('#im-mode').value; var m = {}; root.querySelectorAll('[data-map]').forEach(function (e) { if (e.value !== '') m[e.getAttribute('data-map')] = parseInt(e.value, 10); }); S.mapping = m;
    S.opts.dateOrder = $('#im-order').value; S.opts.fileTz = $('#im-tz').value; S.opts.feesPerContract = $('#im-fpc').checked; S.accountId = $('#im-acct').value; S.tplName = $('#im-tpl').value.trim();
    S.accountMap = {}; root.querySelectorAll('[data-am]').forEach(function (e) { S.accountMap[e.getAttribute('data-am')] = e.value; });
  }
  function preview() {
    collect(); var bad = validateMapping(); if (bad) { S.msg = bad; render(); return; } S.msg = ''; S.busy = true; root.querySelector('[data-act=im-preview]').textContent = 'WORKING…';
    var tpl = S.tplName ? ST.save({ id: (S.templates.filter(function (t) { return t.name === S.tplName && t.type === 'import-mapping'; })[0] || {}).id, kind: 'template', type: 'import-mapping', name: S.tplName, signature: I.headerSignature(S.parsed.headers), mode: S.mode, mapping: S.mapping, options: S.opts }).then(function () { ST.invalidate(); return ST.list('template'); }).then(function (l) { S.templates = l.filter(function (t) { return t.type === 'import-mapping'; }); }) : Promise.resolve();
    tpl.then(existingKeys).then(function (keys) { setTimeout(function () { S.plan = I.plan(S.parsed, readOpts('preview'), keys, J); S.step = 'preview'; S.busy = false; render(); window.scrollTo(0, 0); }, 20); }).catch(function () { S.busy = false; S.msg = 'Could not read your existing trades to check for duplicates. Nothing was imported.'; render(); });
  }
  function commit() {
    if (S.busy) return; S.busy = true; render();
    var batchId = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    existingKeys().then(function (keys) {
      var p = I.plan(S.parsed, readOpts(batchId), keys, J), now = Date.now(), ops = [], hashes = {}, ids = [];
      if (!p.trades.length) throw new Error('nothing');
      p.trades.forEach(function (x) { var t = x.trade; t.createdAt = now; ops.push({ store: 'trades', type: 'put', value: t }); hashes[t.id] = I.tradeHash(t); ids.push(t.id); });
      var doc = { id: batchId, kind: 'import', at: now, createdAt: now, updatedAt: now, fileName: S.fileName, fileSize: S.fileSize, mode: S.mode, accountId: S.accountId, mapping: S.mapping, options: S.opts, rolledBack: null,
        counts: { rows: p.rows, trades: p.trades.length, duplicates: p.duplicates, partial: p.partial.length, problems: Object.keys(p.problems).reduce(function (a, k) { return a + p.problems[k].n; }, 0), unsupported: Object.keys(p.unsupported).length }, tradeIds: ids, hashes: hashes };
      ops.push({ store: 'docs', type: 'put', value: doc }); ops.push({ store: 'audit', type: 'put', value: { id: DB.uid('au'), at: now, type: 'import', details: { batchId: batchId, trades: ids.length, file: S.fileName } } });
      return DB.batch(ops).then(function () { return p.trades.length; });
    }).then(function (n) {
      ST.invalidate(); S.busy = false; U.toast('Imported ' + U.plural(n, 'trade') + '.'); try { window.dispatchEvent(new Event('tt:journal-changed')); } catch (e) {} if (window.TTJournal) window.TTJournal.reload();
      S.step = 'file'; S.parsed = null; S.plan = null; return load();
    }).then(render).catch(function (e) { S.busy = false; U.toast(e && e.message === 'nothing' ? 'Nothing new to import.' : 'Could not save the import. Nothing was changed.', true); render(); });
  }
  function rollback(id) {
    var h = S.history.filter(function (x) { return x.id === id; })[0]; if (!h || h.rolledBack) return;
    U.confirm('Roll back this import?', 'Removes the trades this import added (' + h.counts.trades + '). Trades you have edited since, or that have screenshots, are kept. Your other trades are not touched.', 'ROLL BACK', true).then(function (yes) {
      if (!yes) return;
      DB.getAll('trades').then(function (all) {
        var byId = {}; all.forEach(function (t) { byId[t.id] = t; });
        var chk = h.tradeIds.map(function (tid) {
          var t = byId[tid]; if (!t) return Promise.resolve({ id: tid, state: 'missing' });
          if (I.tradeHash(t) !== h.hashes[tid]) return Promise.resolve({ id: tid, state: 'edited' });
          return (window.TTJournal && window.TTJournal.hasShots ? window.TTJournal.hasShots(tid) : Promise.resolve(false)).then(function (has) { return { id: tid, state: has ? 'edited' : 'ok' }; });
        });
        return Promise.all(chk);
      }).then(function (res) {
        var del = res.filter(function (r) { return r.state === 'ok'; }).map(function (r) { return r.id; }), kept = res.filter(function (r) { return r.state === 'edited'; }).length, gone = res.filter(function (r) { return r.state === 'missing'; }).length, now = Date.now();
        var ops = del.map(function (tid) { return { store: 'trades', type: 'del', key: tid }; });
        var nd = Object.assign({}, h, { rolledBack: { at: now, removed: del.length, kept: kept, missing: gone }, updatedAt: now });
        ops.push({ store: 'docs', type: 'put', value: nd }); ops.push({ store: 'audit', type: 'put', value: { id: DB.uid('au'), at: now, type: 'import-rollback', details: { batchId: id, removed: del.length, kept: kept, missing: gone } } });
        return DB.batch(ops).then(function () { return { removed: del.length, kept: kept }; });
      }).then(function (r) { ST.invalidate(); U.toast('Rolled back: ' + r.removed + ' removed' + (r.kept ? ', ' + r.kept + ' kept' : '') + '.'); try { window.dispatchEvent(new Event('tt:journal-changed')); } catch (e) {} if (window.TTJournal) window.TTJournal.reload(); return load(); }).then(render)
        .catch(function () { U.toast('Could not roll back. Nothing was changed.', true); });
    });
  }

  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'im-file') { chooseFile(t.files && t.files[0]); return; }
    if (S.step === 'map' && (t.id === 'im-mode' || t.getAttribute('data-map') !== null || t.id === 'im-tz' || t.id === 'im-acct')) {
      var wasMode = S.mode; collect(); if (S.mode !== wasMode) { S.mapping = I.suggestMapping(S.parsed.headers, S.mode); } render();
    }
  });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'im-restart') { S.step = 'file'; S.parsed = null; S.msg = ''; render(); }
    else if (a === 'im-preview') preview(); else if (a === 'im-back') { S.step = 'map'; render(); } else if (a === 'im-commit') commit(); else if (a === 'im-rollback') rollback(b.getAttribute('data-id'));
  });
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'import' && S.step === 'file') load().then(render); });
  if (window.TTNav) window.TTNav.addHub({ id: 'import', title: 'Import', text: 'Bring trades in from a CSV file, with preview and rollback.', icon: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>' });
  window.TTImportUI = { state: S, reload: function () { return load().then(render); } };
})();
