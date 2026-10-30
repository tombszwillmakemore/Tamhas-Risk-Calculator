/* Tamhas Trading - Insights (rule-based observations), System health (integrity audit) and the Home "getting started" card.
   No AI and no network: every insight is a fixed rule over your own trades. Repairs are separate, confirmed actions that
   move data to quarantine (kept) and never delete trades outright. */
(function () {
  'use strict';
  var inRoot = document.getElementById('inRoot'), hlRoot = document.getElementById('hlRoot'), homeStart = document.getElementById('homeStart');
  var I = window.TTInsightsCore, H = window.TTHealthCore, C = window.TTJournalCore, U = window.TTUI, DB = window.TTDB, ST = window.TTStore, esc = U.esc;
  var S = { rows: [], data: null, plan: null, health: null, est: null, persisted: null, msg: null, loaded: false, err: null };
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function lastBackup() { try { return (JSON.parse(localStorage.getItem('tt.journal.prefs.v1') || '{}') || {}).lastBackup || null; } catch (e) { return null; } }
  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), DB.getAll('accounts'), DB.getAll('ledger'), DB.getAll('quarantine'), DB.getAll('docs')]); }).then(function (r) {
      S.data = { trades: r[0], accounts: r[1], ledger: r[2], quarantine: r[3], docs: r[4], today: today(), lastBackup: lastBackup() };
      var ok = []; r[0].forEach(function (raw) { var n = C.normalizeTrade(raw); if (n.ok) ok.push(n.trade); }); S.rows = C.analyze(ok);
      S.plan = r[4].filter(function (d) { return d.id === 'plan-main'; })[0] || null; S.health = H.audit(S.data); S.loaded = true; S.err = null;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function basis() { return S.rows.some(function (r) { return r.c.isClosed && !r.c.feesMissing; }) ? 'net' : 'gross'; }
  var KL = { pattern: 'PATTERN', review: 'WORTH REVIEWING', summary: 'SUMMARY' };
  function stepsHtml(compact) {
    var st = H.steps(S.data), done = st.filter(function (x) { return x.done; }).length; if (done === st.length) return '';
    return '<div class="panel"><div class="ui-sec" style="margin:0 0 6px"><h2 style="margin:0">Getting started</h2><span class="ui-badge">' + done + '/' + st.length + '</span></div>' + U.meter(done / st.length * 100) + '<ul class="ui-list" style="margin-top:8px">' + st.map(function (x) { return '<li><span>' + (x.done ? '✓ ' : '○ ') + '<span' + (x.done ? ' style="opacity:.6;text-decoration:line-through"' : '') + '>' + esc(x.label) + '</span></span>' + (x.done ? '' : '<button type="button" class="btn ghost sm" data-go="' + x.go + '">OPEN</button>') + '</li>'; }).join('') + '</ul>' + (compact ? '' : '<p class="note">Everything stays on this device. Nothing is required.</p>') + '</div>';
  }
  function renderInsights() {
    if (!inRoot) return; if (!S.loaded) { inRoot.innerHTML = '<p class="note">Loading…</p>'; return; } if (S.err) { inRoot.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    var g = I.generate(S.rows, { plan: S.plan, today: today(), basis: basis() }), h = stepsHtml(false);
    h += '<div class="panel"><p class="note" style="margin:0"><b>How this works.</b> Fixed rules look through the trades you logged and report what they find, with the numbers. There is no AI here and nothing is sent anywhere. These are observations about the past, not advice or predictions, and a rule stays quiet when there is too little data.</p></div>';
    if (g.needMore) h += U.empty('Not enough data yet', g.needMore); else if (!g.insights.length) h += U.empty('Nothing stands out', 'None of the rules found a pattern in ' + g.counted + ' trades.');
    else h += g.insights.map(function (x) { return '<div class="panel"><div class="ui-sec" style="margin:0 0 6px"><span class="ui-badge ' + (x.kind === 'pattern' ? 'warn' : '') + '">' + KL[x.kind] + '</span><small class="note" style="margin:0">' + esc(x.sample) + ' · n=' + x.n + '</small></div><h3 style="margin:0 0 6px">' + esc(x.title) + '</h3><p style="margin:0">' + esc(x.text) + '</p></div>'; }).join('');
    if (g.counted) h += '<p class="note">Based on ' + U.plural(g.counted, 'closed trade') + ' with a known ' + (g.basis === 'net' ? 'net' : 'gross') + ' result' + (g.left ? '; ' + g.left + ' open or unknown ' + (g.left === 1 ? 'trade was' : 'trades were') + ' left out' : '') + '.</p>';
    inRoot.innerHTML = h;
  }
  function renderHome() { if (!homeStart) return; homeStart.innerHTML = S.loaded && !S.err && S.data ? stepsHtml(true) : ''; }
  function fmtBytes(b) { return b == null ? '—' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function renderHealth() {
    if (!hlRoot) return; if (!S.loaded) { hlRoot.innerHTML = '<p class="note">Loading…</p>'; return; } if (S.err) { hlRoot.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    var a = S.health, c = a.counts, lv = { good: ['good', 'ALL GOOD'], warn: ['warn', 'NEEDS ATTENTION'], bad: ['bad', 'PROBLEM'] }[a.level];
    var h = '<div class="panel" style="text-align:center"><span class="ui-badge ' + lv[0] + '">' + lv[1] + '</span><p class="note">' + (a.issues.length ? U.plural(a.issues.length, 'finding') : 'No problems found.') + ' The check only reads your data. Nothing changes unless you press a repair button.</p></div>';
    if (S.msg) h += '<div class="ui-banner good" role="status">' + esc(S.msg) + '</div>';
    h += a.issues.map(function (i, ix) { return '<div class="panel"><div class="ui-sec" style="margin:0 0 6px"><b>' + esc(i.title) + '</b><span class="ui-badge ' + (i.level === 'bad' ? 'bad' : i.level === 'warn' ? 'warn' : '') + '">' + i.level.toUpperCase() + '</span></div><p class="note" style="margin:0 0 8px">' + esc(i.text) + '</p>' + (i.fix ? '<button type="button" class="btn ghost" data-act="hl-fix" data-i="' + ix + '">' + esc(i.fix.label.toUpperCase()) + '</button>' : '') + '</div>'; }).join('');
    if (a.ok.length) h += '<div class="panel"><h2>Checked and fine</h2><ul class="ui-list">' + a.ok.map(function (x) { return '<li>✓ ' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="panel"><h2>Storage</h2><ul class="ui-list"><li><span>Trades</span><b>' + c.trades + '</b></li><li><span>Accounts</span><b>' + c.accounts + '</b></li><li><span>Money entries</span><b>' + c.ledger + '</b></li><li><span>Saved items (plans, notes, strategies…)</span><b>' + c.docs + '</b></li><li><span>Quarantine</span><b>' + c.quarantine + '</b></li><li><span>Database version</span><b>' + DB.SCHEMA_VERSION + '</b></li><li><span>Space used by this app</span><b>' + (S.est ? fmtBytes(S.est.usage) : '—') + '</b></li><li><span>Last backup</span><b>' + (S.data.lastBackup ? new Date(S.data.lastBackup).toLocaleDateString() : 'never') + '</b></li></ul>' +
      '<p class="note">Your data lives only in this browser. Clearing site data or switching browser removes it, so download a backup now and then.' + (S.persisted === true ? ' The browser has agreed to keep this data.' : '') + '</p><div class="ui-row">' + (navigator.storage && navigator.storage.persist && S.persisted !== true ? '<button type="button" class="btn ghost" data-act="hl-persist">ASK BROWSER TO KEEP MY DATA</button>' : '') + '<button type="button" class="btn ghost" data-act="hl-recheck">CHECK AGAIN</button><button type="button" class="btn ghost" data-go="journal">BACKUP…</button></div></div>';
    hlRoot.innerHTML = h;
  }
  function fix(issue) {
    var f = issue.fix, ops = [], now = Date.now(), byId = {};
    if (f.id === 'quarantine-bad-trades') { S.data.trades.forEach(function (t) { byId[t.id] = t; }); f.ids.forEach(function (id) { ops.push({ store: 'quarantine', type: 'put', value: { id: 'hm-' + id + '-' + now, kind: 'health-moved-trade', at: now, record: byId[id] } }); ops.push({ store: 'trades', type: 'del', key: id }); }); }
    else if (f.id === 'quarantine-docs') { S.data.docs.forEach(function (d) { byId[d.id] = d; }); f.ids.forEach(function (id) { ops.push({ store: 'quarantine', type: 'put', value: { id: 'hm-' + id + '-' + now, kind: 'health-moved-doc', at: now, record: byId[id] } }); ops.push({ store: 'docs', type: 'del', key: id }); }); }
    if (!ops.length) return;
    U.confirm('Move ' + U.plural(f.ids.length, 'item') + ' to quarantine?', 'They are copied to the quarantine list first, in one step, so nothing is lost, and the quarantine is included in backups. Download a backup first if you want extra safety.', 'MOVE', false).then(function (y) {
      if (!y) return; DB.batch(ops).then(function () { return DB.audit('health-quarantine', { fix: f.id, count: f.ids.length }); }).then(function () { ST.invalidate(); S.msg = U.plural(f.ids.length, 'item') + ' moved to quarantine.'; return load(); }).then(function () { renderHealth(); window.dispatchEvent(new CustomEvent('tt:journal-changed')); }).catch(function () { U.toast('Could not complete the repair. Nothing was changed.', true); });
    });
  }
  function estimate() { if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) { S.est = e; renderHealth(); }).catch(function () {}); if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(function (p) { S.persisted = p; renderHealth(); }).catch(function () {}); }
  function refresh() { return load().then(function () { renderInsights(); renderHealth(); renderHome(); }); }
  if (hlRoot) hlRoot.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'hl-fix') fix(S.health.issues[+b.getAttribute('data-i')]);
    else if (a === 'hl-recheck') { S.msg = null; refresh().then(estimate); }
    else if (a === 'hl-persist') navigator.storage.persist().then(function (p) { S.persisted = p; U.toast(p ? 'The browser will keep your data.' : 'The browser declined. Back up regularly.', !p); renderHealth(); });
  });
  window.addEventListener('tt:view', function (e) { var n = e.detail.name; if (n === 'insights' || n === 'health' || n === 'home') { if (n === 'health') S.msg = null; refresh().then(function () { if (n === 'health') estimate(); }); } });
  window.addEventListener('tt:journal-changed', function () { if (S.loaded) refresh(); });
  if (window.TTNav) { window.TTNav.addHub({ id: 'insights', title: 'Insights', text: 'Rule-based observations from your own trades. No AI, no predictions.', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>' });
    window.TTNav.addHub({ id: 'health', title: 'System health', text: 'Check your saved data for problems, storage and backups.', icon: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>' }); }
  refresh();
  window.TTInsightsUI = { state: S, reload: refresh };
})();
