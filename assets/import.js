/* Tamhas Trading - Import trades (Smart Import).
   Drop, choose or paste a Tradovate report (CSV, copied table text or a screenshot). The report type is recognised from its columns;
   anything else goes to the column-mapping importer. Nothing is written until you confirm, the write is one atomic step, and every import
   can be rolled back (only trades you have not edited since, and that have no screenshots, are removed). Screenshots are read on this
   device by the bundled text reader; nothing is uploaded. */
(function () {
  'use strict';
  var root = document.getElementById('iRoot'); if (!root) return;
  var I = window.TTImport, TV = window.TTTradovate, J = window.TTJournalCore, U = window.TTUI, DB = window.TTDB, ST = window.TTStore, AC = window.TTAccountsCore, INST = window.TTInstruments;
  var esc = U.esc, $ = function (s, r) { return (r || root).querySelector(s); };
  var BROWSER_TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();
  var TZS = [['as-is', 'No conversion (times are already in my journal time zone)'], ['UTC', 'UTC'], ['America/New_York', 'US Eastern (New York)'], ['America/Chicago', 'US Central (Chicago)'], ['America/Denver', 'US Mountain (Denver)'], ['America/Los_Angeles', 'US Pacific (Los Angeles)'], ['Europe/London', 'London'], ['Europe/Berlin', 'Central Europe (Berlin)'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney']];
  var REPORT_NAME = { orders: 'Orders', performance: 'Performance', fills: 'Fills list', summary: 'Account summary' };
  var DEF_PREF = { fileTz: 'as-is', dateOrder: 'mdy', accountMap: {}, noAcct: '', feeTemplate: {}, applyFees: true, autoSession: true, defaults: { strategy: '', tags: '' }, keepCopy: false, remember: true };
  var COPY_LIMIT = 1500000;
  var S = { step: 'file', loaded: false, err: null, accounts: [], history: [], templates: [], fileName: '', fileSize: 0, parsed: null, mode: 'fills', mapping: {}, opts: { dateOrder: 'mdy', fileTz: 'as-is', feesPerContract: false }, accountId: 'acct-default', accountMap: {}, plan: null, tplName: '', usedTemplate: null, busy: false, msg: '',
    pref: JSON.parse(JSON.stringify(DEF_PREF)), sources: [], queue: [], review: null, tv: null, pick: {}, noAcct: {}, allow: {}, off: {}, userTotal: '', okMismatch: false, showN: 50, stage: '', done: null, pasteOpen: false, settingsOpen: false, nearMiss: null };

  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('accounts'), ST.list('import'), ST.list('template'), ST.getPref('tvImport', null)]); }).then(function (r) {
      S.accounts = r[0].map(AC.normalizeAccount).filter(function (a) { return !a.archived; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
      S.history = r[1].sort(function (a, b) { return b.at - a.at; }); S.templates = r[2].filter(function (t) { return t.type === 'import-mapping'; }); S.loaded = true; S.err = null;
      if (r[3] && typeof r[3] === 'object') S.pref = Object.assign(JSON.parse(JSON.stringify(DEF_PREF)), r[3], { defaults: Object.assign({}, DEF_PREF.defaults, r[3].defaults || {}) });
      if (!S.accounts.some(function (a) { return a.id === S.accountId; }) && S.accounts.length) S.accountId = S.accounts[0].id;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function savePref() { return ST.setPref('tvImport', S.pref).catch(function () {}); }
  function acctName(id) { var a = S.accounts.filter(function (x) { return x.id === id; })[0]; return a ? a.name : (id || '—'); }
  function acctLabel(a) { return a.name + ' · ' + (a.category === 'prop' ? (a.status === 'funded' ? 'funded' : a.status === 'evaluation' ? 'evaluation' : 'prop') : a.category === 'sim' ? 'simulation' : a.category); }
  function sessionsCfg() { try { var v = JSON.parse(localStorage.getItem('tt.sessions.v1') || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) {} return window.TTSessions ? window.TTSessions.DEFAULTS : []; }
  function money(c) { return c == null ? 'Unavailable' : J.fmtMoney(c); }

  /* =================== start screen =================== */
  function fileStep() {
    var h = '<div class="panel im-hero"><h2>Import trades</h2><p class="note" style="margin-top:0"><b>1</b> Export or screenshot your Tradovate report &nbsp; <b>2</b> Drop it here &nbsp; <b>3</b> Check the preview and import. Everything is processed on this device; nothing is uploaded.</p>' +
      '<label class="dropzone" id="im-drop" for="im-file" tabindex="0"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/></svg><b>Drop files here or tap to choose</b><span>Tradovate CSV (Orders or Performance), any trades or fills CSV, or screenshots (PNG, JPG). Several at once is fine.</span></label>' +
      '<input id="im-file" class="vh" type="file" multiple accept=".csv,.txt,.tsv,text/csv,text/plain,image/png,image/jpeg,image/webp">' +
      '<div class="ui-row im-actions"><button type="button" class="btn" data-act="im-clip">PASTE FROM CLIPBOARD</button><button type="button" class="btn ghost" data-act="im-paste-toggle" aria-expanded="' + S.pasteOpen + '">PASTE TEXT</button><button type="button" class="btn ghost" data-act="im-guide">HOW TO EXPORT FROM TRADOVATE</button></div>' +
      '<p class="note">Tip: on a computer you can also press ' + (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl') + '+V on this page to paste a copied table or screenshot.</p>' +
      (S.pasteOpen ? '<label for="im-paste">Paste your report or table</label><textarea id="im-paste" rows="7" placeholder="Copy the rows from Tradovate (including the column titles) and paste them here"></textarea><div class="ui-row" style="margin-top:8px"><button type="button" class="btn" data-act="im-paste-read">READ PASTED TEXT</button></div>' : '') +
      (S.stage ? '<div class="im-busy">' + U.progress(null, S.stage) + '<button type="button" class="btn ghost sm" data-act="im-ocr-cancel">CANCEL</button></div>' : '<p class="vh" role="status" aria-live="polite"></p>') +
      (S.retry ? '<div class="ui-row"><button type="button" class="btn" data-act="im-ocr-retry">TRY AGAIN</button></div>' : '') +
      (S.msg ? '<div class="ui-banner bad" role="alert">' + esc(S.msg) + '</div>' : '') +
      (S.nearMiss ? '<div class="ui-banner warn">' + esc(S.nearMiss) + '</div>' : '') + '</div>';
    h += settingsPanel() + guidePanel(false) + historyPanel();
    return h;
  }
  function settingsPanel() {
    var p = S.pref, h = '<details class="panel io" id="im-settings"' + (S.settingsOpen ? ' open' : '') + '><summary>Import settings (remembered)</summary><div class="ui-form">' +
      '<label for="im-s-tz">Time zone of the times in your Tradovate reports</label><select id="im-s-tz" data-pref="fileTz">' + TZS.map(function (z) { return '<option value="' + z[0] + '"' + (p.fileTz === z[0] ? ' selected' : '') + '>' + esc(z[1]) + '</option>'; }).join('') + '</select>' +
      '<small class="ui-hint">Tradovate writes times in the time zone your platform is set to. If that is the same as this device (' + esc(BROWSER_TZ) + '), keep "No conversion".</small>' +
      '<label for="im-s-order">Date order</label><select id="im-s-order" data-pref="dateOrder"><option value="mdy"' + (p.dateOrder === 'mdy' ? ' selected' : '') + '>Month / Day / Year (10/21/2026)</option><option value="dmy"' + (p.dateOrder === 'dmy' ? ' selected' : '') + '>Day / Month / Year (21/10/2026)</option></select>' +
      '<label class="ui-chk"><input type="checkbox" data-pref="autoSession"' + (p.autoSession ? ' checked' : '') + '><span>Fill in the session (Asia, London, New York) from the entry time when only one of my session windows was open</span></label>' +
      '<h3 class="im-h3">Your commissions per contract</h3><p class="note" style="margin-top:0">Tradovate\'s Orders and Performance reports do not include commissions. Enter what you pay <b>per contract, per side</b> (each buy or sell), and it is used only for reports without fees. Leave blank to keep fees Unavailable.</p><div class="im-fees">' +
      INST.list.map(function (x) { var v = p.feeTemplate[x.id]; return '<label for="im-fee-' + x.id + '">' + x.id + '</label><input id="im-fee-' + x.id + '" data-fee="' + x.id + '" type="text" inputmode="decimal" placeholder="e.g. 0.62" value="' + (v == null ? '' : (v / 100).toFixed(2)) + '">'; }).join('') + '</div>' +
      '<label class="ui-chk"><input type="checkbox" data-pref="applyFees"' + (p.applyFees ? ' checked' : '') + '><span>Use these fees when a report has none (trades are marked "fees from your settings")</span></label>' +
      '<h3 class="im-h3">Optional defaults for imported trades</h3><label for="im-s-strat">Strategy</label><input id="im-s-strat" data-def="strategy" type="text" maxlength="60" placeholder="leave blank to skip" value="' + esc(p.defaults.strategy || '') + '">' +
      '<label for="im-s-tags">Tags (comma separated)</label><input id="im-s-tags" data-def="tags" type="text" maxlength="200" placeholder="leave blank to skip" value="' + esc(p.defaults.tags || '') + '">' +
      '<label class="ui-chk"><input type="checkbox" data-pref="keepCopy"' + (p.keepCopy ? ' checked' : '') + '><span>Keep a copy of each imported report on this device (up to 1.5 MB each) so it can be re-opened from the history</span></label>';
    var maps = Object.keys(p.accountMap || {});
    if (maps.length) h += '<h3 class="im-h3">Remembered accounts</h3><ul class="ui-list">' + maps.map(function (k) { return '<li><span>' + esc(k) + ' → ' + esc(acctName(p.accountMap[k])) + '</span><button type="button" class="btn ghost sm" data-act="im-forget" data-raw="' + esc(k) + '">FORGET</button></li>'; }).join('') + '</ul>';
    return h + '<div class="ui-row" style="margin-top:12px"><button type="button" class="btn" data-act="im-save-settings">SAVE SETTINGS</button></div></div></details>';
  }
  function guidePanel(open) {
    return '<details class="panel io" id="im-guide"' + (open ? ' open' : '') + '><summary>How to get your trades out of Tradovate</summary>' +
      '<p class="note"><b>Which report?</b> <b>Performance</b> is the best choice: one row per matched buy and sell, with fill ids and Tradovate\'s own P&amp;L, which is used to check every trade to the cent. <b>Orders</b> also works; an order that filled at several prices only shows an average price, and those orders are listed so you can enter them by hand or use Performance instead. Neither report includes commissions, so set your fees in Import settings. <b>Account Summary</b>, <b>Cash History</b> and balance reports have no individual trades; they are kept as a reference only.</p>' +
      '<ol class="im-steps"><li>Open Tradovate on a computer (desktop app or web) and sign in.</li><li>Open your account\'s reports. Published guides describe this as the <b>settings (gear) icon next to your account name</b> at the top of the desktop app, or the <b>Reports</b> tab in the web app.</li><li>Pick the <b>Orders</b> tab or the <b>Performance</b> report and set the start and end dates.</li><li>Press <b>Go</b>, then the download button (guides call it <b>Download CSV</b> or <b>Download Report</b>).</li><li>Drop the downloaded file on this page. Trading several accounts? Export each one and drop them together.</li></ol>' +
      '<p class="note"><b>On a phone:</b> if you cannot download a CSV, take a screenshot of the Orders or Performance table with the column titles visible, then tap <b>Drop files here</b> and choose the screenshot (or paste it). You will check every value before anything is saved.</p>' +
      '<p class="note"><b>Troubleshooting.</b> "No table heading was recognised": include the column titles in the screenshot or paste. Times off by some hours: set the time zone in Import settings. Trades shown as "partly imported before": your new export overlaps an older one; roll the older import back and import the larger file. Contracts listed as not supported: only ' + esc(J.INST_LIST_TEXT) + ' have verified point values so far.</p>' +
      '<p class="note warnline">These steps come from instructions published by Edgewonk, Tradesyncer, TradeZella and SniperJournal (checked 30 Oct 2026). Tradovate needs a login, so the screens could not be checked here, and button names may differ slightly in your version. Live sync with Tradovate is not available: its API needs a funded live account and a paid API subscription.</p></details>';
  }
  function historyPanel() {
    if (!S.history.length) return '';
    return '<div class="panel"><h2>Import history</h2><ul class="ui-list">' + S.history.map(function (h) {
      var rb = h.rolledBack, c = h.counts || {}, nr = (c.possible || 0) + (c.ambiguous || 0) + (c.problems || 0) + (c.partial || 0);
      var badge = h.mode === 'summary' ? '<span class="ui-badge">reference</span>' : rb ? '<span class="ui-badge warn">rolled back</span>' : nr ? '<span class="ui-badge warn">imported · ' + nr + ' to review</span>' : '<span class="ui-badge good">imported</span>';
      return '<li class="m-row"><div><b>' + esc(h.fileName || 'file') + '</b> ' + badge + '<div class="note" style="margin:2px 0 0">' + esc(new Date(h.at).toLocaleString()) + ' · ' + esc(h.report ? h.report.map(function (r) { return REPORT_NAME[r] || r; }).join(' + ') : h.mode) +
        (h.from ? ' · trades ' + esc(h.from) + (h.to && h.to !== h.from ? ' to ' + esc(h.to) : '') : '') + ' · ' + esc((h.accountIds || [h.accountId]).filter(Boolean).map(acctName).join(', ')) +
        (h.mode === 'summary' ? '' : '<br>' + (c.detected != null ? c.detected + ' found · ' : '') + U.plural(c.trades || 0, 'imported', 'imported') + ' · ' + ((c.duplicates || 0) + (c.deselected || 0)) + ' skipped' + (nr ? ' · ' + nr + ' need review' : '')) +
        (rb ? '<br>Rolled back ' + esc(new Date(rb.at).toLocaleString()) + ': ' + rb.removed + ' removed' + (rb.kept ? ', ' + rb.kept + ' kept (edited or have screenshots)' : '') : '') + '</div></div><div class="ui-row">' +
        (h.copies && h.copies.length ? '<button class="btn ghost sm" data-act="im-reopen" data-id="' + esc(h.id) + '">RE-OPEN</button>' : '') +
        (h.mode === 'summary' ? '<button class="btn ghost sm" data-act="im-view-sum" data-id="' + esc(h.id) + '">VIEW</button>' : rb ? '' : '<button class="btn ghost sm" data-act="im-rollback" data-id="' + esc(h.id) + '">ROLL BACK</button>') + '</div></li>'; }).join('') + '</ul>' +
      '<p class="note">Trades that needed review were not imported. To finish them, re-open the saved copy (if kept) or drop the same report again: trades already imported are recognised and skipped, and the rest appear for review.</p></div>';
  }

  /* =================== reading what you give it =================== */
  function readText(file) { return new Promise(function (res, rej) { var rd = new FileReader(); rd.onerror = function () { rej(new Error('Could not read ' + file.name + '.')); }; rd.onload = function () { res(String(rd.result)); }; rd.readAsText(file); }); }
  function isImage(f) { return /^image\//.test(f.type || '') || /\.(png|jpe?g|webp)$/i.test(f.name || ''); }
  function intake(items) {
    // items: [{file}|{text, name}|{image: blob, name}]
    S.msg = ''; S.nearMiss = null; S.sources = []; S.queue = []; S.done = null; S.tv = null; S.pick = {}; S.noAcct = {}; S.allow = {}; S.off = {}; S.userTotal = ''; S.okMismatch = false; S.showN = 50;
    var jobs = items.map(function (it) {
      if (it.image || (it.file && isImage(it.file))) { S.queue.push({ name: it.name || (it.file && it.file.name) || 'screenshot.png', blob: it.image || it.file }); return Promise.resolve(); }
      if (it.file && it.file.size > I.LIMITS.chars) return Promise.reject(new Error(it.file.name + ' is larger than ' + (I.LIMITS.chars / 1e6) + ' MB.'));
      return (it.file ? readText(it.file) : Promise.resolve(it.text)).then(function (text) { addText(it.name || (it.file && it.file.name) || 'pasted text', text, it.file ? it.file.size : text.length); });
    });
    Promise.all(jobs).then(route).catch(function (e) { S.msg = e.message; S.step = 'file'; render(); });
  }
  function addText(name, text, size) {
    var parsed = /\.csv$|\.tsv$/i.test(name) ? I.parseCsv(text) : TV.parsePasted(text);
    if (!parsed.ok) throw new Error((name ? name + ': ' : '') + parsed.error);
    S.sources.push({ id: 's' + S.sources.length, name: name.slice(0, 120), size: size, text: text, parsed: parsed, det: TV.detect(parsed.headers), kind: 'text' });
  }
  function route() {
    if (S.queue.length) { readNextImage(); return; }
    var tv = S.sources.filter(function (s) { return s.det.report && s.det.report !== 'summary'; }), sums = S.sources.filter(function (s) { return s.det.report === 'summary'; }), other = S.sources.filter(function (s) { return !s.det.report; });
    if (tv.length) { S.sources = tv.concat(sums); if (other.length) S.nearMiss = U.plural(other.length, 'file') + ' did not look like a Tradovate report (' + other.map(function (o) { return o.name; }).join(', ') + '). Import ' + (other.length === 1 ? 'it' : 'them') + ' separately with the column mapper.'; buildTv(null).then(function () { S.step = 'tv'; render(); window.scrollTo(0, 0); }); return; }
    if (sums.length) { S.step = 'summary'; S.sources = sums; render(); return; }
    if (other.length) {
      var src = other[0], near = src.det.near;
      if (src.kind === 'image') { S.msg = 'The screenshot table was not recognised as a Tradovate report.'; S.step = 'file'; render(); return; }
      S.nearMiss = near ? 'This looks like a ' + near.title + ' but these columns are missing: ' + near.missing.join(', ') + '. Map the columns below, or export the report again with all columns.' : null;
      startMapping(src); return;
    }
    S.step = 'file'; render();
  }
  function startMapping(src) {
    var parsed = src.parsed; S.parsed = parsed; S.fileName = src.name; S.fileSize = src.size; S.mode = I.detectMode(parsed.headers); S.mapping = I.suggestMapping(parsed.headers, S.mode); S.usedTemplate = null; S.tplName = ''; S.accountMap = {};
    var sig = I.headerSignature(parsed.headers), tpl = S.templates.filter(function (t) { return t.signature === sig; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; })[0];
    if (tpl) { S.mode = tpl.mode; S.mapping = Object.assign({}, tpl.mapping); S.opts = Object.assign({ dateOrder: 'mdy', fileTz: 'as-is', feesPerContract: false }, tpl.options); S.usedTemplate = tpl.name; S.tplName = tpl.name; }
    S.step = 'map'; render();
  }

  /* ---------- screenshots ---------- */
  function readNextImage() {
    var job = S.queue.shift(); S.step = 'file'; S.stage = 'Reading ' + job.name + ' on this device…'; S.retry = null; S.msg = ''; render(); S.curJob = job;
    var slow = U.later(function () { if (S.stage) { S.stage += ' Still working - large or busy screenshots take longer on phones.'; var t = $('.ui-prog-t'); if (t) t.textContent = S.stage; } }, 8000);
    if (!window.TTOcr || !window.TTOcr.available) { S.stage = ''; S.msg = 'This browser cannot run the on-device text reader. Paste the report as text or upload the CSV instead.'; render(); return; }
    var url = URL.createObjectURL(job.blob);
    U.timeout(window.TTOcr.readTable(job.blob, function (st) { S.stage = job.name + ': ' + st; var el = $('.ui-prog-t'); if (el) el.textContent = S.stage; }), 90000, 'Reading the screenshot took longer than 90 seconds and was stopped. Try a smaller or cropped screenshot, or paste the report as text.').then(function (t) {
      slow(); S.stage = '';
      if (!t.ok) { URL.revokeObjectURL(url); S.msg = job.name + ': ' + t.error; if (S.queue.length) readNextImage(); else route(); return; }
      S.review = { name: job.name, url: url, headers: t.headers, rows: t.rows.map(function (r) { return r.slice(); }), low: t.lowConf, unreadable: t.unreadable || [] };
      S.step = 'review'; render(); window.scrollTo(0, 0);
    }).catch(function (e) { slow(); URL.revokeObjectURL(url); S.stage = ''; if (/90 seconds/.test(e.message)) window.TTOcr.cancel(); if (e.message === 'cancelled') { S.msg = 'Screenshot reading cancelled.'; S.queue = []; } else { S.msg = job.name + ': ' + e.message; S.retry = job; } render(); });
  }
  function reviewStep() {
    var r = S.review, det = TV.detect(r.headers), nLow = 0, nBad = 0;
    r.rows.forEach(function (row, i) { row.forEach(function (v, j) { if (TV.cellValid(r.headers[j], v) === false) nBad++; else if (r.low[i] && r.low[i][j]) nLow++; }); });
    var h = '<div class="ui-sec"><h2>Check what was read</h2><button class="btn ghost sm" data-act="im-cancel">‹ CANCEL</button></div>' +
      '<div class="panel"><p class="note" style="margin-top:0"><b>' + esc(r.name) + '</b> · read on this device as a <b>' + esc(det.title || 'table') + '</b> · ' + U.plural(r.rows.length, 'row') + '.' +
      (nBad || nLow ? ' <span class="warnline">' + (nBad ? nBad + ' value' + (nBad === 1 ? '' : 's') + ' do not look right (red)' : '') + (nBad && nLow ? ' and ' : '') + (nLow ? nLow + ' were hard to read (amber)' : '') + '. Compare them with the picture and correct them.</span>' : ' Every value passed the checks; still compare a few with the picture.') + '</p>' +
      '<details class="io"><summary>Show the screenshot</summary><img class="im-shot" src="' + esc(r.url) + '" alt="The screenshot being imported"></details>' +
      '<div class="ui-table-wrap"><table class="ui-table im-grid"><thead><tr>' + r.headers.map(function (x) { return '<th scope="col">' + esc(x) + '</th>'; }).join('') + '<th><span class="vh">Remove</span></th></tr></thead><tbody>' +
      r.rows.map(function (row, i) { return '<tr>' + row.map(function (v, j) { var ok = TV.cellValid(r.headers[j], v), cl = ok === false ? 'badc' : (r.low[i] && r.low[i][j] ? 'lowc' : ''); return '<td><input class="' + cl + '" data-cell="' + i + ':' + j + '" value="' + esc(v) + '" aria-label="' + esc(r.headers[j]) + ', row ' + (i + 1) + (cl === 'badc' ? ', looks wrong' : cl === 'lowc' ? ', hard to read' : '') + '"></td>'; }).join('') + '<td><button type="button" class="btn ghost sm" data-act="im-row-del" data-i="' + i + '" aria-label="Remove row ' + (i + 1) + '">✕</button></td></tr>'; }).join('') + '</tbody></table></div>' +
      (r.unreadable.length ? '<p class="note warnline">' + U.plural(r.unreadable.length, 'line') + ' could not be placed in the table and were left out: ' + r.unreadable.slice(0, 4).map(function (x) { return '"' + esc(x.text.slice(0, 60)) + '"'; }).join(', ') + '</p>' : '') +
      '<div class="ui-row" style="margin-top:12px"><button class="btn" data-act="im-review-ok">CONTINUE TO PREVIEW</button></div></div>';
    return h;
  }
  function reviewCollect() { root.querySelectorAll('[data-cell]').forEach(function (e) { var p = e.getAttribute('data-cell').split(':'); S.review.rows[+p[0]][+p[1]] = e.value.trim(); }); }

  /* =================== Tradovate preview =================== */
  function existingIndex() {
    return DB.getAll('trades').then(function (list) { var keys = new Set(), fps = new Set(); list.forEach(function (t) { (t.srcKeys || []).forEach(function (k) { keys.add(k); }); var n = J.normalizeTrade(t); if (n.ok) fps.add(I.fingerprint(n.trade)); }); return { keys: keys, fps: fps }; });
  }
  function accountMapNow() { var m = Object.assign({}, S.pref.accountMap || {}); Object.keys(S.pick).forEach(function (k) { if (S.pick[k]) m[k] = S.pick[k]; }); return m; }
  function feeTpl() { return S.pref.feeTemplate || {}; }
  function buildTv(batchId) {
    return existingIndex().then(function (ix) {
      var out = [], keys = ix.keys, fps = ix.fps, map = accountMapNow(), tv = S.sources.filter(function (s) { return s.det.report !== 'summary'; });
      var defaults = { strategy: (S.pref.defaults.strategy || '').trim(), tags: (S.pref.defaults.tags || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean) };
      tv.forEach(function (src) {
        var o = { report: src.det.report, fileTz: S.pref.fileTz, dateOrder: S.pref.dateOrder, targetTz: BROWSER_TZ, accountMap: map, defaultAccountId: S.noAcct[src.id] || null, feeTemplate: feeTpl(), applyFeeTemplate: !!S.pref.applyFees,
          autoSession: !!S.pref.autoSession, sessions: sessionsCfg(), defaults: defaults.strategy || defaults.tags.length ? defaults : null, allowFp: S.allow };
        if (batchId) o.batchId = batchId;
        var rd = TV.read(src.parsed, src.det.report, o);
        var p = I.plan(src.parsed, Object.assign({}, o, { mode: 'fills', preRead: rd, pnlByKey: rd.pnlByKey, ambiguousKeys: rd.ambiguousKeys, enrich: TV.enricher(rd, o), fingerprints: fps }), keys, J);
        p.trades.forEach(function (x) { x.keys.forEach(function (k) { keys.add(k); }); fps.add(x.fp); });
        var ut = tv.length === 1 && S.userTotal.trim() !== '' ? I.parseNumber(S.userTotal) : null;
        out.push({ src: src, rd: rd, plan: p, rec: TV.reconcile(p, rd, ut == null ? null : Math.round(ut * 100)), noAcctCol: !Object.keys(rd.info.accounts).length });
      });
      S.tv = out;
    });
  }
  function rawAccounts() { var m = {}; (S.tv || []).forEach(function (x) { Object.keys(x.rd.info.accounts).forEach(function (a) { m[a] = (m[a] || 0) + x.rd.info.accounts[a]; }); }); return Object.keys(m).map(function (k) { return { raw: k, n: m[k] }; }); }
  function blockers() {
    var b = [], map = accountMapNow();
    rawAccounts().forEach(function (a) { if (!map[a.raw] || !S.accounts.some(function (x) { return x.id === map[a.raw]; })) b.push('Choose a journal account for "' + a.raw + '".'); });
    (S.tv || []).forEach(function (x) { if (x.noAcctCol && !S.noAcct[x.src.id]) b.push('Choose which account ' + x.src.name + ' belongs to.'); });
    var mism = (S.tv || []).some(function (x) { return x.rec.items.some(function (i) { return i.level === 'bad' && /do not match/.test(i.text); }); });
    if (mism && !S.okMismatch) b.push('Some trades do not match the P&L in the report. Look at them, then tick "I checked the differences".');
    return b;
  }
  function included() { var all = []; (S.tv || []).forEach(function (x) { x.plan.trades.forEach(function (t) { if (!S.off[t.fp]) all.push(t); }); }); return all; }
  function acctOptions(sel, withNew) {
    return '<option value="">— choose —</option>' + S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (sel === a.id ? ' selected' : '') + '>' + esc(acctLabel(a)) + '</option>'; }).join('') +
      (withNew ? '<optgroup label="Create a new account"><option value="__new:evaluation">New prop evaluation account</option><option value="__new:funded">New prop funded account</option><option value="__new:live">New live account</option><option value="__new:sim">New simulation account</option></optgroup>' : '');
  }
  function tvStep() {
    var m = J.fmtMoney, tv = S.tv, inc = included(), map = accountMapNow(), bl = blockers();
    var tot = { dup: 0, poss: 0, amb: 0, partial: 0, prob: 0, uns: 0, open: 0, rows: 0 };
    tv.forEach(function (x) { var p = x.plan; tot.dup += p.duplicates; tot.poss += p.possible.length; tot.amb += p.ambiguous.length; tot.partial += p.partial.length; tot.prob += Object.keys(p.problems).reduce(function (a, k) { return a + p.problems[k].n; }, 0) + p.invalid.length + p.tooBig; tot.uns += Object.keys(p.unsupported).reduce(function (a, k) { return a + p.unsupported[k]; }, 0); tot.open += p.openAtEnd; tot.rows += p.rows; });
    var h = '<div class="ui-sec"><h2>Preview</h2><button class="btn ghost sm" data-act="im-cancel">‹ START AGAIN</button></div>';
    h += '<div class="panel"><ul class="ui-list">' + tv.map(function (x) { return '<li><span><b>' + esc(x.src.name) + '</b><div class="note" style="margin:2px 0 0">' + esc(x.src.det.title) + ' · ' + esc(x.src.det.basis) + (x.rd.info.from ? ' · trades ' + esc(x.rd.info.from) + (x.rd.info.to !== x.rd.info.from ? ' to ' + esc(x.rd.info.to) : '') : '') + '</div></span><span class="ui-badge' + (x.src.det.verified === 'published' ? ' good' : ' warn') + '">' + esc(REPORT_NAME[x.src.det.report]) + '</span></li>'; }).join('') + '</ul>' +
      S.sources.filter(function (s) { return s.det.report === 'summary'; }).map(function (s) { return '<p class="note">' + esc(s.name) + ' is a summary report with no individual trades. It will be saved as a reference next to this import.</p>'; }).join('') + (S.nearMiss ? '<p class="note warnline">' + esc(S.nearMiss) + '</p>' : '') + '</div>';
    h += '<div class="ui-grid g2">' + U.stat('Ready to import', String(inc.length), U.plural(inc.length, 'new trade'), inc.length ? 'pos' : 'dim') + U.stat('Already in journal', String(tot.dup), 'skipped as duplicates') +
      U.stat('Need your review', String(tot.poss + tot.amb + tot.partial), 'not imported unless you include them') + U.stat('Could not be read', String(tot.prob + tot.uns), 'rows left out, reasons below') + '</div>';
    // accounts
    var ra = rawAccounts(), na = tv.filter(function (x) { return x.noAcctCol; });
    if (ra.length || na.length) {
      h += '<div class="panel ui-form"><h2>Accounts</h2>';
      ra.forEach(function (a, i) { h += '<label for="im-acc-' + i + '">Tradovate account <b>' + esc(a.raw) + '</b> (' + a.n + ' rows) goes into</label><select id="im-acc-' + i + '" data-rawacct="' + esc(a.raw) + '">' + acctOptions(map[a.raw], true) + '</select>'; });
      na.forEach(function (x) { var sel = S.noAcct[x.src.id] || ''; h += '<label for="im-na-' + x.src.id + '">' + esc(x.src.name) + ' has no account column. Which account is it from?</label><select id="im-na-' + x.src.id + '" data-noacct="' + x.src.id + '">' + acctOptions(sel, true) + '</select>'; });
      h += '<label class="ui-chk"><input type="checkbox" id="im-remember"' + (S.pref.remember ? ' checked' : '') + '><span>Remember these choices for next time</span></label></div>';
    }
    // reconciliation
    h += '<div class="panel"><h2>Check against the report</h2>' + tv.map(function (x) { return (tv.length > 1 ? '<p class="note" style="margin-top:0"><b>' + esc(x.src.name) + '</b></p>' : '') + '<ul class="ui-list im-rec">' + x.rec.items.map(function (i) { return '<li class="' + i.level + '"><span aria-hidden="true">' + (i.level === 'good' ? '✓' : i.level === 'bad' ? '✕' : '!') + '</span><span>' + esc(i.text) + '</span></li>'; }).join('') + '</ul>'; }).join('') +
      (tv.length === 1 ? '<label for="im-total">Optional: the total P&amp;L Tradovate shows for this period and account</label><div class="row-inline"><input id="im-total" type="text" inputmode="decimal" placeholder="e.g. 59.50 or -120" value="' + esc(S.userTotal) + '"><button type="button" class="btn ghost" data-act="im-recheck">COMPARE</button></div>' : '') +
      (tv.some(function (x) { return x.rec.items.some(function (i) { return i.level === 'bad' && /do not match/.test(i.text); }); }) ? '<label class="ui-chk"><input type="checkbox" id="im-okmis"' + (S.okMismatch ? ' checked' : '') + '><span>I checked the differences and still want to import these trades (the journal always calculates from the prices)</span></label>' : '') + '</div>';
    // banners
    var probs = {}, uns = {}; tv.forEach(function (x) { Object.keys(x.plan.problems).forEach(function (k) { probs[k] = (probs[k] || 0) + x.plan.problems[k].n; }); Object.keys(x.plan.unsupported).forEach(function (k) { uns[k] = (uns[k] || 0) + x.plan.unsupported[k]; }); Object.keys(x.rd.warnings).forEach(function (k) { h += '<div class="ui-banner warn">' + esc(k) + ' (' + x.rd.warnings[k].n + ').</div>'; }); });
    if (Object.keys(probs).length) h += '<div class="ui-banner bad"><b>Rows that could not be read</b><ul class="ui-list">' + Object.keys(probs).map(function (k) { return '<li><span>' + esc(k) + '</span><b>' + probs[k] + '</b></li>'; }).join('') + '</ul></div>';
    if (Object.keys(uns).length) h += '<div class="ui-banner warn"><b>Contracts not supported yet (skipped):</b> ' + Object.keys(uns).slice(0, 12).map(function (k) { return esc(k) + ' × ' + uns[k]; }).join(', ') + '. Supported: ' + esc(J.INST_LIST_TEXT) + '.</div>';
    if (tot.open) h += '<div class="ui-banner warn">' + U.plural(tot.open, 'position') + ' still open at the end of the report ' + (tot.open === 1 ? 'is' : 'are') + ' imported as open trades. Add the exit later or import a report that includes it.</div>';
    if (tot.partial) h += '<div class="ui-banner warn"><b>' + U.plural(tot.partial, 'trade') + ' partly imported before</b> (this report overlaps an earlier one). They are skipped so nothing is doubled. Roll back the earlier import and import the larger report to include them.</div>';
    // review list
    var rev = []; tv.forEach(function (x) { x.plan.possible.forEach(function (t) { rev.push({ t: t, why: 'Looks the same as a trade already in your journal (same account, contract, time, size and prices) - maybe from another report or entered by hand.' }); }); x.plan.ambiguous.forEach(function (t) { rev.push({ t: t, why: 'Buy and sell in the same second without ids, so the order of fills is uncertain. Check the entry and exit.' }); }); });
    if (rev.length) h += '<div class="panel"><h2>Needs your review (' + rev.length + ')</h2><p class="note" style="margin-top:0">These are not imported unless you tick them.</p><ul class="ui-list">' + rev.map(function (r, i) { var t = r.t; return '<li><label class="ui-chk" style="margin:0"><input type="checkbox" data-allow="' + esc(t.fp) + '"' + (S.allow[t.fp] ? ' checked' : '') + '><span><b>' + esc(t.trade.date + ' ' + (t.trade.time || '') + ' ' + t.trade.contract + ' ' + t.trade.side + ' ' + t.trade.contracts) + '</b> · ' + esc(t.c.grossCents == null ? 'open' : m(t.c.grossCents, true)) + '<div class="note" style="margin:2px 0 0">' + esc(r.why) + '</div></span></label></li>'; }).join('') + '</ul><button type="button" class="btn ghost sm" data-act="im-recheck">UPDATE PREVIEW</button></div>';
    // table
    var all = []; tv.forEach(function (x) { x.plan.trades.forEach(function (t) { all.push(t); }); });
    if (all.length) {
      h += '<div class="panel"><div class="ui-sec" style="margin:0 0 8px"><h2 style="margin:0">Trades (' + all.length + ')</h2><span class="ui-row"><button type="button" class="btn ghost sm" data-act="im-all-on">SELECT ALL</button><button type="button" class="btn ghost sm" data-act="im-all-off">NONE</button></span></div><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th><span class="vh">Import</span></th><th>Date</th><th>Account</th><th>Contract</th><th>Qty</th><th>Entry</th><th>Exits</th><th>Gross</th><th>Fees</th><th>Report P&amp;L</th></tr></thead><tbody>' +
        all.slice(0, S.showN).map(function (x) { var t = x.trade, c = x.c, chk = x.filePnlCents == null || !c.isClosed ? '' : (Math.abs(c.grossCents - x.filePnlCents) <= 1 ? '<span class="pos" title="matches">✓ ' : '<span class="neg" title="differs">✕ ') + esc(m(x.filePnlCents, true)) + '</span>';
          return '<tr><td><input type="checkbox" data-on="' + esc(x.fp) + '"' + (S.off[x.fp] ? '' : ' checked') + ' aria-label="Import ' + esc(t.date + ' ' + t.contract) + '"></td><td>' + esc(t.date + (t.time ? ' ' + t.time : '')) + (t.session ? '<br><small class="note">' + esc(t.session) + '</small>' : '') + '</td><td>' + esc(acctName(t.accountId)) + '</td><td>' + esc(t.contract) + ' ' + esc(t.side) + '</td><td>' + t.contracts + (t.entries ? ' <small class="note">' + t.entries.length + ' fills</small>' : '') + '</td><td>' + esc(String(t.entry)) + '</td><td>' + (t.exits.length ? t.exits.map(function (e) { return e.qty + '@' + e.price; }).join(', ') : '—') + (c.status !== 'closed' ? ' <small class="note">' + esc(c.status) + '</small>' : '') + '</td><td class="' + U.cls(c.grossCents) + '">' + (c.grossCents == null ? '—' : esc(m(c.grossCents, true))) + '</td><td>' + (c.feesCents == null ? '<small class="note">Unavailable</small>' : esc(m(c.feesCents)) + (t.feeSource === 'template' ? '<br><small class="note">your settings</small>' : '')) + '</td><td>' + chk + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        (all.length > S.showN ? '<button type="button" class="btn ghost wide" data-act="im-more">SHOW ' + Math.min(50, all.length - S.showN) + ' MORE (' + (all.length - S.showN) + ' hidden)</button>' : '') + '</div>';
    }
    h += '<div class="panel">' + (bl.length ? '<div class="ui-banner warn" role="alert"><b>Before importing:</b><ul class="ui-list">' + bl.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>' : '') +
      (inc.length ? '<p class="note" style="margin-top:0">One step, all or nothing. You can roll it back from the import history afterwards.</p><button class="btn wide" data-act="im-tv-commit"' + (S.busy || bl.length ? ' disabled' : '') + '>IMPORT ' + U.plural(inc.length, 'TRADE') + '</button>' : (S.sources.some(function (s) { return s.det.report === 'summary'; }) ? '<button class="btn wide" data-act="im-tv-commit"' + (S.busy ? ' disabled' : '') + '>SAVE SUMMARY AS REFERENCE</button>' : U.empty('Nothing new to import', 'Every trade in this report is already in your journal, needs review, or could not be read. See the notes above.'))) + '</div>';
    return h;
  }
  function tvCommit() {
    if (S.busy) return; var bl = blockers(); if (bl.length) { render(); return; }
    S.busy = true; render();
    var batchId = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), offBefore = Object.assign({}, S.off);
    buildTv(batchId).then(function () {
      var now = Date.now(), ops = [], hashes = {}, ids = [], inc = [], accts = {}, from = null, to = null, c = { rows: 0, detected: 0, trades: 0, duplicates: 0, possible: 0, ambiguous: 0, partial: 0, problems: 0, unsupported: 0, deselected: 0 };
      S.off = offBefore;
      S.tv.forEach(function (x) { var p = x.plan; c.rows += p.rows; c.duplicates += p.duplicates; c.possible += p.possible.length; c.ambiguous += p.ambiguous.length; c.partial += p.partial.length; c.problems += Object.keys(p.problems).reduce(function (a, k) { return a + p.problems[k].n; }, 0) + p.invalid.length + p.tooBig; c.unsupported += Object.keys(p.unsupported).length;
        c.detected += p.trades.length + p.duplicates + p.possible.length + p.ambiguous.length + p.partial.length;
        p.trades.forEach(function (t) { if (S.off[t.fp]) { c.deselected++; return; } inc.push(t); }); if (x.rd.info.from && (!from || x.rd.info.from < from)) from = x.rd.info.from; if (x.rd.info.to && (!to || x.rd.info.to > to)) to = x.rd.info.to; });
      inc.forEach(function (x) { var t = x.trade; t.createdAt = now; ops.push({ store: 'trades', type: 'put', value: t }); hashes[t.id] = I.tradeHash(t); ids.push(t.id); accts[t.accountId] = 1; });
      c.trades = ids.length;
      var sums = S.sources.filter(function (s) { return s.det.report === 'summary'; }).map(function (s) { return { name: s.name, data: TV.summaryOf(s.parsed) }; });
      var copies = S.pref.keepCopy ? S.sources.filter(function (s) { return s.text && s.text.length <= COPY_LIMIT; }).map(function (s) { return { name: s.name, text: s.text }; }) : [];
      var doc = { id: batchId, kind: 'import', at: now, createdAt: now, updatedAt: now, mode: ids.length ? 'tradovate' : 'summary', broker: 'tradovate', report: S.sources.map(function (s) { return s.det.report; }), fileName: S.sources.map(function (s) { return s.name; }).join(', ').slice(0, 200),
        files: S.sources.map(function (s) { return { name: s.name, report: s.det.report, size: s.size, kind: s.kind }; }), fileSize: S.sources.reduce(function (a, s) { return a + (s.size || 0); }, 0), accountId: Object.keys(accts)[0] || null, accountIds: Object.keys(accts), from: from, to: to,
        options: { fileTz: S.pref.fileTz, dateOrder: S.pref.dateOrder, applyFees: !!S.pref.applyFees }, counts: c, tradeIds: ids, hashes: hashes, rolledBack: null, summaries: sums, copies: copies,
        reconcile: S.tv.map(function (x) { return { file: x.src.name, level: x.rec.level, items: x.rec.items.map(function (i) { return i.level + ': ' + i.text; }) }; }) };
      if (!ids.length && !sums.length) throw new Error('nothing');
      ops.push({ store: 'docs', type: 'put', value: doc }); ops.push({ store: 'audit', type: 'put', value: { id: DB.uid('au'), at: now, type: 'import', details: { batchId: batchId, trades: ids.length, file: doc.fileName, broker: 'tradovate' } } });
      if (S.pref.remember) { var m = accountMapNow(); S.pref.accountMap = m; }
      return DB.batch(ops).then(function () { return savePref(); }).then(function () { return { c: c, ids: ids, sums: sums.length }; });
    }).then(function (r) {
      ST.invalidate(); S.busy = false; try { window.dispatchEvent(new Event('tt:journal-changed')); } catch (e) {} if (window.TTJournal) window.TTJournal.reload();
      U.toast(r.ids.length ? 'Imported ' + U.plural(r.ids.length, 'trade') + '.' : 'Summary saved.');
      S.done = r; S.step = 'done'; S.tv = null; return load();
    }).then(function () { render(); window.scrollTo(0, 0); }).catch(function (e) { S.busy = false; U.toast(e && e.message === 'nothing' ? 'Nothing new to import.' : 'Could not save the import. Nothing was changed.', true); render(); });
  }
  function doneStep() {
    var c = S.done.c, nr = c.possible + c.ambiguous + c.partial;
    return '<div class="panel im-done" role="status"><h2>Import finished</h2><div class="ui-grid g2">' + U.stat('Imported', String(c.trades), 'trades added to your journal', c.trades ? 'pos' : 'dim') + U.stat('Skipped', String(c.duplicates + c.deselected), 'already in journal or unticked') + U.stat('Needed review', String(nr), 'not imported') + U.stat('Unreadable', String(c.problems), 'rows left out') + '</div>' +
      (S.done.sums ? '<p class="note">' + U.plural(S.done.sums, 'summary report') + ' saved as reference in the import history.</p>' : '') +
      (c.trades ? '<p class="note">Your journal, calendar, dashboard, analytics and account trackers now include these trades. Notes, tags, emotions and screenshots are optional: add them any time from the journal.</p>' : '') +
      '<div class="ui-row" style="margin-top:12px">' + (c.trades ? '<button class="btn" data-act="im-goto-journal">VIEW IN JOURNAL</button>' : '') + '<button class="btn ghost" data-act="im-cancel">IMPORT ANOTHER</button></div></div>' + historyPanel();
  }
  function summaryStep() {
    return '<div class="ui-sec"><h2>Summary report</h2><button class="btn ghost sm" data-act="im-cancel">‹ CANCEL</button></div>' + S.sources.map(function (s) { var d = TV.summaryOf(s.parsed); return '<div class="panel"><p class="note" style="margin-top:0"><b>' + esc(s.name) + '</b>: ' + esc(s.det.basis) + ' It can be saved as a reference, and no trades are created from it.</p><div class="ui-table-wrap"><table class="ui-table"><thead><tr>' + d.headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + d.rows.slice(0, 20).map(function (r) { return '<tr>' + r.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>'; }).join('') +
      '<div class="panel"><button class="btn wide" data-act="im-tv-commit"' + (S.busy ? ' disabled' : '') + '>SAVE AS REFERENCE</button><p class="note">To import trades, export the <b>Performance</b> or <b>Orders</b> report instead (see "How to get your trades out of Tradovate").</p></div>';
  }
  function viewSummary(id) { S.viewSum = S.history.filter(function (x) { return x.id === id; })[0] || null; if (S.viewSum) { S.step = 'viewsum'; render(); window.scrollTo(0, 0); } }
  function viewSumStep() {
    var h = S.viewSum; return '<div class="ui-sec"><h2>Saved report</h2><button class="btn ghost sm" data-act="im-cancel">‹ BACK</button></div><p class="note">' + esc(new Date(h.at).toLocaleString()) + ' · reference only, no trades.</p>' + (h.summaries || []).map(function (s) { return '<div class="panel"><p class="note" style="margin-top:0"><b>' + esc(s.name) + '</b></p><div class="ui-table-wrap"><table class="ui-table"><thead><tr>' + s.data.headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + s.data.rows.slice(0, 200).map(function (r) { return '<tr>' + r.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>'; }).join('');
  }

  /* =================== column-mapping importer (any CSV) =================== */
  function sampleOf(i) { for (var r = 0; r < S.parsed.rows.length && r < 50; r++) { var v = S.parsed.rows[r][i]; if (v != null && String(v).trim() !== '') return String(v).slice(0, 40); } return ''; }
  function mapStep() {
    var fields = I.FIELDS[S.mode], hs = S.parsed.headers, h = '<div class="ui-sec"><h2>Map the columns</h2><button class="btn ghost sm" data-act="im-restart">‹ CHOOSE ANOTHER FILE</button></div>';
    if (S.nearMiss) h += '<div class="ui-banner warn">' + esc(S.nearMiss) + '</div>';
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
    var acctCol = S.mapping.account, distinct = [];
    if (acctCol != null && acctCol >= 0) { var seen = {}; S.parsed.rows.forEach(function (r) { var v = String(r[acctCol] == null ? '' : r[acctCol]).trim(); if (v && !seen[v]) { seen[v] = 1; distinct.push(v); } }); }
    var accOpts = S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>'; }).join('');
    h += '<label for="im-acct">Import into account' + (distinct.length > 1 ? ' (for rows with no match)' : '') + '</label><select id="im-acct">' + S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (S.accountId === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>';
    if (distinct.length > 1 && distinct.length <= 20) { h += '<p class="note">The file contains ' + distinct.length + ' account names. Match each to one of yours:</p>'; distinct.forEach(function (d, i) { h += '<label for="im-am-' + i + '">' + esc(d.slice(0, 40)) + '</label><select id="im-am-' + i + '" data-am="' + esc(d) + '">' + accOpts.replace('value="' + esc(S.accountMap[d] || S.accountId) + '"', 'value="' + esc(S.accountMap[d] || S.accountId) + '" selected') + '</select>'; }); }
    else if (distinct.length > 20) h += '<p class="note warnline">The account column has more than 20 different values, so it is ignored. Everything goes into the account above.</p>';
    h += '<label for="im-tpl">Save these settings as (optional)</label><input id="im-tpl" type="text" maxlength="60" placeholder="e.g. My broker fills" value="' + esc(S.tplName) + '"><div class="ui-hint">Next time a file with the same column headings is chosen, the settings are filled in for you.</div>';
    return h + '<div class="ui-row" style="margin-top:14px"><button class="btn" data-act="im-preview">PREVIEW IMPORT</button></div>' + (S.msg ? '<p class="note bad" role="alert">' + esc(S.msg) + '</p>' : '') + '</div>';
  }
  function previewStep() {
    var p = S.plan, m = J.fmtMoney, h = '<div class="ui-sec"><h2>Preview</h2><button class="btn ghost sm" data-act="im-back">‹ BACK TO MAPPING</button></div>';
    h += '<div class="ui-grid g2">' + U.stat('Will be imported', String(p.trades.length), U.plural(p.trades.length, 'new trade'), p.trades.length ? 'pos' : 'dim') + U.stat('Already imported', String(p.duplicates + p.possible.length), 'skipped as duplicates') +
      U.stat('Rows in file', String(p.rows), p.fills != null ? p.fills + ' readable fills' : '') + U.stat('Need attention', String(Object.keys(p.problems).reduce(function (a, k) { return a + p.problems[k].n; }, 0) + p.invalid.length + p.partial.length + p.tooBig), 'rows or trades left out') + '</div>';
    if (p.possible.length) h += '<div class="ui-banner warn">' + U.plural(p.possible.length, 'trade') + ' look the same as trades already in your journal (same account, contract, time, size and prices) and are skipped.</div>';
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
  function readOpts(batchId, fps) {
    var o = { mode: S.mode, mapping: S.mapping, dateOrder: S.opts.dateOrder, fileTz: S.opts.fileTz, targetTz: BROWSER_TZ, feesPerContract: !!S.opts.feesPerContract, defaultAccountId: S.accountId, accountMap: S.accountMap, fingerprints: fps };
    if (batchId) o.batchId = batchId; return o;
  }
  function validateMapping() {
    var miss = I.FIELDS[S.mode].filter(function (f) { return f[2] && (S.mapping[f[0]] == null || S.mapping[f[0]] < 0); }).map(function (f) { return f[1]; });
    return miss.length ? 'Choose a column for: ' + miss.join(', ') + '.' : null;
  }
  function collect() {
    S.mode = $('#im-mode').value; var m = {}; root.querySelectorAll('[data-map]').forEach(function (e) { if (e.value !== '') m[e.getAttribute('data-map')] = parseInt(e.value, 10); }); S.mapping = m;
    S.opts.dateOrder = $('#im-order').value; S.opts.fileTz = $('#im-tz').value; S.opts.feesPerContract = $('#im-fpc').checked; S.accountId = $('#im-acct').value; S.tplName = $('#im-tpl').value.trim();
    S.accountMap = {}; root.querySelectorAll('[data-am]').forEach(function (e) { S.accountMap[e.getAttribute('data-am')] = e.value; });
  }
  function preview() {
    collect(); var bad = validateMapping(); if (bad) { S.msg = bad; render(); return; } S.msg = ''; S.busy = true; root.querySelector('[data-act=im-preview]').textContent = 'WORKING…';
    var tpl = S.tplName ? ST.save({ id: (S.templates.filter(function (t) { return t.name === S.tplName && t.type === 'import-mapping'; })[0] || {}).id, kind: 'template', type: 'import-mapping', name: S.tplName, signature: I.headerSignature(S.parsed.headers), mode: S.mode, mapping: S.mapping, options: S.opts }).then(function () { ST.invalidate(); return ST.list('template'); }).then(function (l) { S.templates = l.filter(function (t) { return t.type === 'import-mapping'; }); }) : Promise.resolve();
    tpl.then(existingIndex).then(function (ix) { setTimeout(function () { S.plan = I.plan(S.parsed, readOpts('preview', ix.fps), ix.keys, J); S.step = 'preview'; S.busy = false; render(); window.scrollTo(0, 0); }, 20); }).catch(function () { S.busy = false; S.msg = 'Could not read your existing trades to check for duplicates. Nothing was imported.'; render(); });
  }
  function commit() {
    if (S.busy) return; S.busy = true; render();
    var batchId = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    existingIndex().then(function (ix) {
      var p = I.plan(S.parsed, readOpts(batchId, ix.fps), ix.keys, J), now = Date.now(), ops = [], hashes = {}, ids = [];
      if (!p.trades.length) throw new Error('nothing');
      p.trades.forEach(function (x) { var t = x.trade; t.createdAt = now; ops.push({ store: 'trades', type: 'put', value: t }); hashes[t.id] = I.tradeHash(t); ids.push(t.id); });
      var dates = p.trades.map(function (x) { return x.trade.date; }).sort();
      var doc = { id: batchId, kind: 'import', at: now, createdAt: now, updatedAt: now, fileName: S.fileName, fileSize: S.fileSize, mode: S.mode, accountId: S.accountId, mapping: S.mapping, options: S.opts, rolledBack: null, from: dates[0], to: dates[dates.length - 1],
        counts: { rows: p.rows, detected: p.trades.length + p.duplicates + p.possible.length + p.partial.length, trades: p.trades.length, duplicates: p.duplicates + p.possible.length, partial: p.partial.length, problems: Object.keys(p.problems).reduce(function (a, k) { return a + p.problems[k].n; }, 0), unsupported: Object.keys(p.unsupported).length }, tradeIds: ids, hashes: hashes };
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
        return Promise.all(h.tradeIds.map(function (tid) {
          var t = byId[tid]; if (!t) return Promise.resolve({ id: tid, state: 'missing' });
          if (I.tradeHash(t) !== h.hashes[tid]) return Promise.resolve({ id: tid, state: 'edited' });
          return (window.TTJournal && window.TTJournal.hasShots ? window.TTJournal.hasShots(tid) : Promise.resolve(false)).then(function (has) { return { id: tid, state: has ? 'edited' : 'ok' }; });
        }));
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

  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; }
    if (S.err) { root.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    root.innerHTML = S.step === 'map' ? mapStep() : S.step === 'preview' ? previewStep() : S.step === 'review' ? reviewStep() : S.step === 'tv' ? tvStep() : S.step === 'summary' ? summaryStep() : S.step === 'done' ? doneStep() : S.step === 'viewsum' ? viewSumStep() : fileStep();
  }
  function reset() { if (S.review && S.review.url) URL.revokeObjectURL(S.review.url); S.step = 'file'; S.parsed = null; S.plan = null; S.tv = null; S.review = null; S.sources = []; S.queue = []; S.msg = ''; S.nearMiss = null; S.stage = ''; S.done = null; render(); }
  function rebuild() { buildTv(null).then(render); }
  function createAccount(kind, raw) {
    var cat = kind === 'evaluation' || kind === 'funded' ? 'prop' : kind, made = AC.newAccount({ name: raw || 'Tradovate account', category: cat, status: kind === 'funded' ? 'funded' : undefined, note: 'Created while importing a Tradovate report.' });
    if (!made.ok) { U.toast(made.errors[0], true); return Promise.resolve(null); }
    return DB.put('accounts', made.account).then(function () { return load(); }).then(function () { U.toast('Account "' + made.account.name + '" created.'); return made.account.id; });
  }

  /* =================== events =================== */
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'im-file') { var fs = Array.prototype.slice.call(t.files || []); if (fs.length) intake(fs.map(function (f) { return { file: f }; })); return; }
    if (S.step === 'map' && (t.id === 'im-mode' || t.getAttribute('data-map') !== null || t.id === 'im-tz' || t.id === 'im-acct')) { var wasMode = S.mode; collect(); if (S.mode !== wasMode) S.mapping = I.suggestMapping(S.parsed.headers, S.mode); render(); return; }
    if (S.step === 'tv') {
      var raw = t.getAttribute('data-rawacct'), na = t.getAttribute('data-noacct');
      if (raw != null || na != null) {
        var v = t.value, set = function (id) { if (raw != null) S.pick[raw] = id; else S.noAcct[na] = id; rebuild(); };
        if (/^__new:/.test(v)) { var nm = raw != null ? raw : (S.sources.filter(function (s) { return s.id === na; })[0] || {}).name; createAccount(v.slice(6), raw != null ? raw : 'Tradovate ' + String(nm || '').replace(/\.[a-z]+$/i, '').slice(0, 30)).then(function (id) { set(id || ''); }); } else set(v);
        return;
      }
      if (t.id === 'im-remember') { S.pref.remember = t.checked; return; }
      if (t.id === 'im-okmis') { S.okMismatch = t.checked; render(); return; }
      if (t.hasAttribute('data-on')) { var fp = t.getAttribute('data-on'); if (t.checked) delete S.off[fp]; else S.off[fp] = 1; render(); return; }
      if (t.hasAttribute('data-allow')) { var f2 = t.getAttribute('data-allow'); if (t.checked) S.allow[f2] = 1; else delete S.allow[f2]; return; }
    }
    if (S.step === 'review' && t.hasAttribute('data-cell')) { reviewCollect(); var p = t.getAttribute('data-cell').split(':'), ok = TV.cellValid(S.review.headers[+p[1]], t.value); t.classList.toggle('badc', ok === false); if (ok !== false) t.classList.remove('lowc'); }
  });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'im-restart' || a === 'im-cancel') reset();
    else if (a === 'im-preview') preview(); else if (a === 'im-back') { S.step = 'map'; render(); } else if (a === 'im-commit') commit(); else if (a === 'im-rollback') rollback(b.getAttribute('data-id'));
    else if (a === 'im-paste-toggle') { S.pasteOpen = !S.pasteOpen; render(); if (S.pasteOpen) { var ta = $('#im-paste'); if (ta) ta.focus(); } }
    else if (a === 'im-paste-read') { var txt = ($('#im-paste') || {}).value || ''; if (!txt.trim()) { S.msg = 'Paste something first.'; render(); return; } intake([{ text: txt, name: 'pasted text' }]); }
    else if (a === 'im-clip') clipboard();
    else if (a === 'im-guide') { var g = $('#im-guide'); if (g) { g.open = true; g.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
    else if (a === 'im-save-settings') saveSettings();
    else if (a === 'im-forget') { delete S.pref.accountMap[b.getAttribute('data-raw')]; savePref().then(function () { S.settingsOpen = true; render(); }); }
    else if (a === 'im-review-ok') { reviewCollect(); var r = S.review, parsed = { ok: true, headers: r.headers, rows: r.rows.filter(function (x) { return x.some(function (v) { return v; }); }), delimiter: 'ocr' }; S.sources.push({ id: 's' + S.sources.length, name: r.name, size: 0, text: null, parsed: parsed, det: TV.detect(r.headers), kind: 'image' }); URL.revokeObjectURL(r.url); S.review = null; route(); }
    else if (a === 'im-row-del') { reviewCollect(); var i = +b.getAttribute('data-i'); S.review.rows.splice(i, 1); S.review.low.splice(i, 1); render(); }
    else if (a === 'im-recheck') { var ti = $('#im-total'); if (ti) S.userTotal = ti.value; rebuild(); }
    else if (a === 'im-more') { S.showN += 50; render(); }
    else if (a === 'im-all-on') { S.off = {}; render(); } else if (a === 'im-all-off') { (S.tv || []).forEach(function (x) { x.plan.trades.forEach(function (t) { S.off[t.fp] = 1; }); }); render(); }
    else if (a === 'im-tv-commit') tvCommit();
    else if (a === 'im-ocr-cancel') { window.TTOcr.cancel(); }
    else if (a === 'im-ocr-retry') { var j = S.retry; S.retry = null; if (j) { S.queue.unshift(j); readNextImage(); } }
    else if (a === 'im-goto-journal') { reset(); if (window.TTNav) window.TTNav.go('journal'); }
    else if (a === 'im-reopen') reopen(b.getAttribute('data-id'));
    else if (a === 'im-view-sum') viewSummary(b.getAttribute('data-id'));
  });
  root.addEventListener('keydown', function (e) { if (e.target.id === 'im-drop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#im-file').click(); } });
  function saveSettings() {
    var p = S.pref, bad = null;
    root.querySelectorAll('[data-pref]').forEach(function (el) { var k = el.getAttribute('data-pref'); p[k] = el.type === 'checkbox' ? el.checked : el.value; });
    root.querySelectorAll('[data-def]').forEach(function (el) { p.defaults[el.getAttribute('data-def')] = el.value.trim(); });
    var ft = {}; root.querySelectorAll('[data-fee]').forEach(function (el) { var v = el.value.trim(); if (!v) return; var n = I.parseNumber(v); if (n == null || n < 0 || n > 100) { bad = 'Fee for ' + el.getAttribute('data-fee') + ' must be a dollar amount from 0 to 100.'; return; } ft[el.getAttribute('data-fee')] = Math.round(n * 100); });
    if (bad) { U.toast(bad, true); return; } p.feeTemplate = ft; S.settingsOpen = true;
    savePref().then(function () { U.toast('Import settings saved.'); render(); });
  }
  function clipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) { S.pasteOpen = true; S.msg = 'This browser does not let pages read the clipboard directly. Paste into the box below (long-press › Paste on a phone, Ctrl+V on a computer).'; render(); return; }
    navigator.clipboard.read().then(function (items) {
      var jobs = [];
      items.forEach(function (it) { var img = it.types.filter(function (t) { return /^image\//.test(t); })[0]; if (img) jobs.push(it.getType(img).then(function (b) { return { image: b, name: 'pasted screenshot.png' }; })); else if (it.types.indexOf('text/plain') >= 0) jobs.push(it.getType('text/plain').then(function (b) { return b.text(); }).then(function (t) { return { text: t, name: 'pasted text' }; })); });
      return Promise.all(jobs);
    }).then(function (got) { if (!got.length) { S.msg = 'The clipboard is empty or holds something that cannot be imported.'; render(); return; } intake(got); })
      .catch(function () { S.pasteOpen = true; S.msg = 'Clipboard access was not allowed. Paste into the box below instead.'; render(); });
  }
  function reopen(id) {
    var h = S.history.filter(function (x) { return x.id === id; })[0]; if (!h || !h.copies) return;
    intake(h.copies.map(function (c) { return { text: c.text, name: c.name }; }));
  }
  // paste a copied table or screenshot anywhere on the Import screen
  document.addEventListener('paste', function (e) {
    var v = document.getElementById('view-import'); if (!v || !v.classList.contains('active') || S.step !== 'file') return;
    var tg = e.target; if (tg && (tg.id === 'im-paste' || (tg.tagName === 'INPUT') || tg.tagName === 'TEXTAREA')) return;
    var cd = e.clipboardData; if (!cd) return; var files = Array.prototype.slice.call(cd.files || []).filter(isImage);
    if (files.length) { e.preventDefault(); intake(files.map(function (f) { return { image: f, name: f.name || 'pasted screenshot.png' }; })); return; }
    var txt = cd.getData('text/plain'); if (txt && txt.split(/\r?\n/).filter(Boolean).length >= 2) { e.preventDefault(); intake([{ text: txt, name: 'pasted text' }]); }
  });
  ['dragenter', 'dragover'].forEach(function (ev) { root.addEventListener(ev, function (e) { var d = e.target.closest && e.target.closest('#im-drop'); if (!d) return; e.preventDefault(); d.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { root.addEventListener(ev, function (e) { var d = e.target.closest && e.target.closest('#im-drop'); if (!d) return; e.preventDefault(); d.classList.remove('over'); if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files.length) intake(Array.prototype.slice.call(e.dataTransfer.files).map(function (f) { return { file: f }; })); }); });
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'import' && (S.step === 'file' || S.step === 'done')) load().then(render); });
  if (window.TTNav) window.TTNav.addHub({ id: 'import', title: 'Import trades', text: 'Tradovate reports, screenshots, pasted tables or any CSV, with preview and rollback.', icon: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>' });
  window.TTImportUI = { state: S, reload: function () { return load().then(render); }, intake: intake, reset: reset };
})();
