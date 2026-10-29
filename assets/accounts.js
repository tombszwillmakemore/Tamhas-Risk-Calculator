/* Tamhas Trading - Accounts view: your accounts, editable prop-firm rule profiles, and the researched firm directory.
   Rules are editable copies of researched templates. They are never presented as official or live. */
(function () {
  'use strict';
  var A = window.TTAccountsCore, DB = window.TTDB, P = window.TTPropData, JC = window.TTJournalCore, root = document.getElementById('aRoot');
  if (!root || !A || !DB || !P) return;
  var DEF = DB.DEFAULT_ACCOUNT_ID;
  var S = { tab: 'accounts', accounts: [], rows: [], adding: false, form: {}, open: null, editing: null, firm: null, errors: [], loaded: false, err: null };
  var LABEL = { prop: 'PROP FIRM', live: 'LIVE', sim: 'SIM', other: 'OTHER' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || root).querySelector(s); }
  function today() { return A.ymd(Date.now()); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function money(c) { return c == null ? '—' : JC.fmtMoney(c, true); }
  function firmBySlug(s) { return P.firms.filter(function (f) { return f.slug === s; })[0] || null; }
  function productOf(f, name) { return f && f.products.filter(function (p) { return p.name === name; })[0] || null; }
  function toast(msg, bad) { var t = document.createElement('div'); t.className = 'toast show' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000); }

  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('accounts'), DB.getAll('trades')]); }).then(function (r) {
      S.accounts = r[0].map(A.normalizeAccount).sort(function (a, b) { return a.createdAt - b.createdAt; });
      var ok = []; r[1].forEach(function (t) { var n = JC.normalizeTrade(t); if (n.ok) ok.push(n.trade); }); S.rows = JC.analyze(ok); S.loaded = true; S.err = null;
    }).catch(function (e) { S.err = e && e.message || 'Could not open the local database.'; S.loaded = true; });
  }
  function save(acct) {
    return DB.put('accounts', acct).then(function () { return DB.audit('account-saved', { id: acct.id }); }).then(function () {
      var i = S.accounts.findIndex(function (a) { return a.id === acct.id; }); if (i >= 0) S.accounts[i] = acct; else S.accounts.push(acct);
      window.dispatchEvent(new Event('tt:accounts-changed')); return true;
    }).catch(function () { toast('Could not save (browser storage blocked or full).', true); return false; });
  }

  /* ---------- badges ---------- */
  function badge(rule) {
    if (rule.sourceType === 'official') return '<span class="a-b off">OFFICIAL PAGE</span>';
    if (rule.sourceType === 'third-party') return '<span class="a-b tp">THIRD-PARTY · UNCONFIRMED</span>';
    return '<span class="a-b you">YOUR ENTRY</span>';
  }
  function ageText(rule, acct) {
    var g = A.ruleAge(rule, acct.template && acct.template.researchedOn, today());
    if (g.days == null) return '<span class="a-age stale">Never verified</span>';
    return '<span class="a-age' + (g.stale ? ' stale' : '') + '">' + (rule.verifiedOn ? 'You checked it ' : 'Researched ') + (g.days === 0 ? 'today' : g.days + ' days ago') + (g.stale ? ' · re-check' : '') + '</span>';
  }

  /* ---------- views ---------- */
  function accountCard(a) {
    var st = A.accountStats(S.rows, a.id, DEF), ruleKeys = Object.keys(a.rules), stale = ruleKeys.filter(function (k) { return A.ruleAge(a.rules[k], a.template && a.template.researchedOn, today()).stale; }).length;
    var open = S.open === a.id;
    var h = '<div class="panel a-card' + (a.archived ? ' arch' : '') + '"><button type="button" class="a-head" data-act="a-toggle" data-id="' + esc(a.id) + '" aria-expanded="' + open + '">' +
      '<div><b>' + esc(a.name) + '</b><div class="a-sub"><span class="a-tag">' + LABEL[a.category] + '</span> <span class="a-tag st-' + esc(a.status) + '">' + esc(a.status.toUpperCase()) + '</span>' + (a.archived ? ' <span class="a-tag">ARCHIVED</span>' : '') + '</div></div>' +
      '<div class="a-pnl"><small>' + (st.netCents != null ? 'NET' : st.grossCents != null ? 'GROSS' : 'P&amp;L') + '</small><b class="' + ((st.netCents != null ? st.netCents : st.grossCents) > 0 ? 'pos' : (st.netCents != null ? st.netCents : st.grossCents) < 0 ? 'neg' : 'none') + '">' + money(st.netCents != null ? st.netCents : st.grossCents) + '</b></div></button>';
    if (open) h += detail(a, st, ruleKeys, stale);
    return h + '</div>';
  }
  function detail(a, st, ruleKeys, stale) {
    var h = '<div class="a-body"><p class="note">' + st.trades + ' trade' + (st.trades === 1 ? '' : 's') + ' logged · ' + st.closed + ' closed' + (st.open ? ' · ' + st.open + ' open' : '') +
      (a.startingBalanceCents != null ? ' · starting balance ' + money(a.startingBalanceCents) : '') + (st.closed && st.netTrades < st.closed ? ' · net counts only ' + st.netTrades + ' trade(s) with fees entered' : '') + '</p>';
    if (a.template) h += '<p class="note">Started from the <b>' + esc((firmBySlug(a.template.slug) || {}).name || a.template.slug) + ' · ' + esc(a.template.product || 'custom') + '</b> template, researched ' + esc(a.template.researchedOn) + '. These are your editable copies, not live rules.</p>';
    h += '<div class="field"><label for="a-st-' + esc(a.id) + '">Status</label><select id="a-st-' + esc(a.id) + '" data-act="a-status" data-id="' + esc(a.id) + '">' +
      A.STATUSES[a.category].map(function (s) { return '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>';
    if (a.category === 'prop') {
      h += '<h3 class="a-h">Rules' + (stale ? ' <span class="a-age stale">' + stale + ' need re-checking</span>' : '') + '</h3>';
      if (!ruleKeys.length) h += '<p class="note">No rules saved yet. Add the ones you care about below. Leave blank anything you have not checked.</p>';
      A.RULE_FIELDS.forEach(function (f) {
        var r = a.rules[f[0]], ed = S.editing && S.editing.id === a.id && S.editing.field === f[0];
        if (!r && !ed) return;
        h += '<div class="a-rule"><div class="a-rl">' + esc(f[1]) + '</div>';
        if (ed) h += ruleEditor(a, f, r);
        else h += '<div class="a-rv">' + esc(r.value) + '</div><div class="a-rm">' + badge(r) + ' ' + ageText(r, a) + (safeUrl(r.source) ? ' <a href="' + esc(r.source) + '" target="_blank" rel="noopener noreferrer">source ↗</a>' : ' <span class="a-age stale">no source</span>') +
          ' <button type="button" class="linkbtn" data-act="a-edit" data-id="' + esc(a.id) + '" data-field="' + f[0] + '">Edit</button></div>';
        h += '</div>';
      });
      var missing = A.RULE_FIELDS.filter(function (f) { return !a.rules[f[0]]; });
      if (missing.length) h += '<div class="field"><label for="a-addrule">Add a rule</label><select id="a-addrule" data-act="a-addrule" data-id="' + esc(a.id) + '"><option value="">Choose…</option>' + missing.map(function (f) { return '<option value="' + f[0] + '">' + esc(f[1]) + '</option>'; }).join('') + '</select></div>';
      if (a.ruleHistory.length) h += '<details class="a-hist"><summary>Rule history (' + a.ruleHistory.length + ')</summary>' + a.ruleHistory.slice().reverse().map(function (x) {
        return '<p class="note">' + esc(new Date(x.at).toLocaleString()) + ' · <b>' + esc(A.FIELD_LABEL[x.field] || x.field) + '</b>: ' + esc(x.from || '(empty)') + ' → ' + esc(x.to || '(empty)') + (x.note ? ' · ' + esc(x.note) : '') + (x.verifiedOn ? ' · checked ' + esc(x.verifiedOn) : '') + '</p>'; }).join('') + '</details>';
    }
    h += '<div class="row2"><button type="button" class="btn small" data-act="a-archive" data-id="' + esc(a.id) + '">' + (a.archived ? 'UNARCHIVE' : 'ARCHIVE') + '</button>' +
      (a.id !== DEF && st.trades === 0 ? '<button type="button" class="btn small danger" data-act="a-delete" data-id="' + esc(a.id) + '">DELETE</button>' : '') + '</div>';
    if (a.id !== DEF && st.trades > 0) h += '<p class="note">An account with trades can only be archived, so no trades are ever orphaned.</p>';
    return h + '</div>';
  }
  function ruleEditor(a, f, r) {
    var id = 'rv-' + f[0];
    return '<div class="a-ed"><label for="' + id + '">' + esc(f[1]) + '</label><input id="' + id + '" type="text" maxlength="400" value="' + esc(r ? r.value : '') + '" autocomplete="off">' +
      '<label for="rs-' + f[0] + '">Source link (optional)</label><input id="rs-' + f[0] + '" type="url" inputmode="url" placeholder="https://…" value="' + esc(r ? r.source : '') + '" autocomplete="off">' +
      '<label class="a-chk"><input type="checkbox" id="rc-' + f[0] + '"> I checked this on the firm\'s own site today</label>' +
      '<label for="rn-' + f[0] + '">Note (optional)</label><input id="rn-' + f[0] + '" type="text" maxlength="200" autocomplete="off">' +
      '<div class="row2"><button type="button" class="btn small" data-act="a-rule-save">SAVE</button><button type="button" class="btn small" data-act="a-rule-cancel">CANCEL</button></div>' +
      '<p class="note">Clearing the value removes this rule. The change is kept in history.</p></div>';
  }
  function addForm() {
    var f = S.form, firm = firmBySlug(f.firm), prod = firm && productOf(firm, f.product);
    var h = '<div class="panel"><h2>New account</h2>' + (S.errors.length ? '<div class="banner bad" role="alert">' + S.errors.map(esc).join('<br>') + '</div>' : '') +
      '<div class="field"><label for="n-name">Name</label><input id="n-name" type="text" maxlength="60" placeholder="e.g. Topstep 50K #1" value="' + esc(f.name || '') + '" autocomplete="off"></div>' +
      '<div class="field"><label for="n-cat">Type</label><select id="n-cat" data-act="n-cat">' + A.CATEGORIES.map(function (c) { return '<option value="' + c + '"' + (f.category === c ? ' selected' : '') + '>' + LABEL[c] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="n-bal">Starting balance, $ (optional)</label><input id="n-bal" type="text" inputmode="decimal" placeholder="e.g. 50000" value="' + esc(f.bal || '') + '" autocomplete="off"></div>';
    if (f.category === 'prop') {
      h += '<div class="field"><label for="n-firm">Start from a researched firm (optional)</label><select id="n-firm" data-act="n-firm"><option value="">Custom / not listed</option>' +
        P.firms.map(function (x) { return '<option value="' + x.slug + '"' + (f.firm === x.slug ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>';
      if (firm) h += '<div class="field"><label for="n-prod">Product</label><select id="n-prod" data-act="n-prod"><option value="">Firm-wide rules only</option>' + firm.products.map(function (p) { return '<option' + (f.product === p.name ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div>' +
        '<p class="note">Researched ' + esc(firm.researchedOn) + '. ' + (prod ? Object.keys(A.templateRules(firm, prod)).length : Object.keys(A.templateRules(firm, null)).length) + ' rules will be copied. You can edit or delete every one, and unknown ones stay blank. Facts marked third-party are unconfirmed.</p>';
    }
    return h + '<div class="row2"><button type="button" class="btn" data-act="n-save">CREATE</button><button type="button" class="btn" data-act="n-cancel">CANCEL</button></div></div>';
  }
  function accountsTab() {
    var act = S.accounts.filter(function (a) { return !a.archived; }), arc = S.accounts.filter(function (a) { return a.archived; });
    var h = S.adding ? addForm() : '<button type="button" class="btn wide" data-act="a-new">+ ADD ACCOUNT</button>';
    h += act.map(accountCard).join('');
    if (arc.length) h += '<details class="panel"><summary>Archived (' + arc.length + ')</summary>' + arc.map(accountCard).join('') + '</details>';
    return h;
  }
  function factRow(k, x) {
    return '<div class="a-rule"><div class="a-rl">' + esc(A.FIELD_LABEL[k] || k) + '</div><div class="a-rv">' + esc(typeof x.v === 'object' ? JSON.stringify(x.v) : x.v) + '</div><div class="a-rm">' + badge({ sourceType: x.st }) +
      (safeUrl(x.src) ? ' <a href="' + esc(x.src) + '" target="_blank" rel="noopener noreferrer">source ↗</a>' : '') + (x.pu ? ' <span class="a-age">page dated ' + esc(x.pu) + '</span>' : '') + '</div></div>';
  }
  function firmsTab() {
    var h = '<div class="panel"><p class="note" style="margin-top:0"><b>Researched ' + esc(P.asOf) + '.</b> ' + esc(P.caveat) + ' Tamhas Trading is not connected to, endorsed by, or affiliated with any firm, and takes no position on any firm\'s reliability.</p></div>';
    P.firms.forEach(function (f) {
      var open = S.firm === f.slug;
      h += '<div class="panel a-card"><button type="button" class="a-head" data-act="f-toggle" data-slug="' + f.slug + '" aria-expanded="' + open + '"><div><b>' + esc(f.name) + '</b><div class="a-sub"><span class="a-tag">' + f.products.length + ' product' + (f.products.length === 1 ? '' : 's') + '</span></div></div><span class="a-chev">' + (open ? '−' : '+') + '</span></button>';
      if (open) {
        h += '<div class="a-body">' + (safeUrl(f.site) ? '<p class="note"><a href="' + esc(f.site) + '" target="_blank" rel="noopener noreferrer">' + esc(f.site) + ' ↗</a></p>' : '');
        if (f.status) h += '<p class="note"><b>Status noted:</b> ' + esc(f.status.v) + ' ' + badge({ sourceType: f.status.st }) + '</p>';
        if (f.conflicts.length) h += '<div class="banner warn"><b>Sources disagree</b><br>' + f.conflicts.map(esc).join('<br>') + '</div>';
        Object.keys(f.firmWide).forEach(function (k) { h += factRow(k, f.firmWide[k]); });
        f.products.forEach(function (p) { h += '<h3 class="a-h">' + esc(p.name) + ' <span class="a-tag">' + esc(p.type) + '</span></h3>' + Object.keys(p.facts).map(function (k) { return factRow(k, p.facts[k]); }).join('') || '<p class="note">No sourced facts.</p>'; });
        if (f.unknown.length) h += '<details class="a-hist"><summary>Not found / unknown (' + f.unknown.length + ')</summary>' + f.unknown.map(function (u) { return '<p class="note">' + esc(u) + '</p>'; }).join('') + '</details>';
        h += '</div>';
      }
      h += '</div>';
    });
    h += '<div class="panel"><h2>Other futures firms (names only)</h2><p class="note" style="margin-top:0">Found in public lists but not researched, so no rules are shown. Check each firm yourself.</p>' +
      P.listedOnly.map(function (o) { return '<p class="note">' + esc(o.name) + (safeUrl(o.site) ? ' · <a href="' + esc(o.site) + '" target="_blank" rel="noopener noreferrer">site ↗</a>' : '') + '</p>'; }).join('') + '</div>';
    return h;
  }
  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; }
    if (S.err) { root.innerHTML = '<div class="banner bad" role="alert">' + esc(S.err) + '</div>'; return; }
    var tabs = [['accounts', 'ACCOUNTS'], ['firms', 'FIRM RESEARCH']];
    root.innerHTML = '<div class="chips jtabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" class="chip' + (S.tab === t[0] ? ' on' : '') + '" data-act="a-tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      (S.tab === 'firms' ? firmsTab() : accountsTab());
  }

  /* ---------- actions ---------- */
  function readNew() {
    var g = function (id) { var e = $('#' + id); return e ? e.value : ''; };
    S.form = { name: g('n-name'), category: g('n-cat') || S.form.category, bal: g('n-bal'), firm: $('#n-firm') ? g('n-firm') : S.form.firm, product: $('#n-prod') ? g('n-prod') : S.form.product };
  }
  function create() {
    readNew(); var f = S.form, firm = f.category === 'prop' ? firmBySlug(f.firm) : null, prod = firm && productOf(firm, f.product);
    var r = A.newAccount({ name: f.name, category: f.category, startingBalance: f.bal, firmSlug: firm ? firm.slug : null, productName: prod ? prod.name : null,
      template: firm ? { slug: firm.slug, product: prod ? prod.name : null, researchedOn: firm.researchedOn } : null, rules: firm ? A.templateRules(firm, prod) : {} });
    if (!r.ok) { S.errors = r.errors; render(); return; }
    save(r.account).then(function (ok) { if (ok) { S.adding = false; S.errors = []; S.open = r.account.id; toast('Account created.'); render(); } });
  }
  function acctById(id) { return S.accounts.filter(function (a) { return a.id === id; })[0]; }
  function saveRule() {
    var E = S.editing, a = acctById(E.id); if (!a) return;
    var v = $('#rv-' + E.field).value, src = $('#rs-' + E.field).value, chk = $('#rc-' + E.field).checked, note = $('#rn-' + E.field).value;
    var cur = a.rules[E.field], srcNew = src.trim();
    var r = A.editRule(a, E.field, v, { source: srcNew, sourceType: srcNew || chk ? (cur && cur.sourceType !== 'user' && cur.value === v.trim() ? cur.sourceType : 'user') : 'user', verifiedOn: chk ? today() : null, note: note });
    if (!r.ok) { toast(r.error, true); return; }
    if (r.unchanged) { S.editing = null; render(); return; }
    save(r.account).then(function (ok) { if (ok) { S.editing = null; toast('Rule saved.'); render(); } });
  }

  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return; var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    switch (act) {
      case 'a-tab': S.tab = el.getAttribute('data-tab'); render(); break;
      case 'a-new': S.adding = true; S.form = { category: 'prop' }; S.errors = []; render(); break;
      case 'n-cancel': S.adding = false; S.errors = []; render(); break;
      case 'n-save': create(); break;
      case 'a-toggle': S.open = S.open === id ? null : id; S.editing = null; render(); break;
      case 'f-toggle': S.firm = S.firm === el.getAttribute('data-slug') ? null : el.getAttribute('data-slug'); render(); break;
      case 'a-edit': S.editing = { id: id, field: el.getAttribute('data-field') }; render(); var i = $('#rv-' + S.editing.field); if (i) i.focus(); break;
      case 'a-rule-cancel': S.editing = null; render(); break;
      case 'a-rule-save': saveRule(); break;
      case 'a-archive': var a = acctById(id); if (a) save(Object.assign({}, a, { archived: !a.archived })).then(function () { render(); }); break;
      case 'a-delete': var d = acctById(id); if (!d) break;
        if (A.accountStats(S.rows, id, DEF).trades) { toast('This account has trades. Archive it instead.', true); break; }
        if (!window.confirm('Delete account "' + d.name + '"? This cannot be undone.')) break;
        DB.del('accounts', id).then(function () { S.accounts = S.accounts.filter(function (x) { return x.id !== id; }); S.open = null; window.dispatchEvent(new Event('tt:accounts-changed')); render(); toast('Account deleted.'); }).catch(function () { toast('Could not delete.', true); }); break;
    }
  });
  root.addEventListener('change', function (ev) {
    var el = ev.target, act = el.getAttribute && el.getAttribute('data-act'); if (!act) return;
    if (act === 'n-cat') { readNew(); S.form.firm = ''; S.form.product = ''; render(); }
    else if (act === 'n-firm') { readNew(); S.form.product = ''; render(); }
    else if (act === 'n-prod') { readNew(); render(); }
    else if (act === 'a-addrule') { var f = el.value; if (f) { S.editing = { id: el.getAttribute('data-id'), field: f }; render(); var i = $('#rv-' + f); if (i) i.focus(); } }
    else if (act === 'a-status') { var a = acctById(el.getAttribute('data-id')), r = a && A.setStatus(a, el.value, ''); if (r && r.ok && !r.unchanged) save(r.account).then(function () { render(); toast('Status updated.'); }); }
  });
  window.addEventListener('tt:journal-changed', function () { if (!S.loaded) return; load().then(function () { if (!S.editing && !S.adding) render(); }); });
  window.TTAccounts = { reload: function () { return load().then(render); } };
  render(); load().then(render);
})();
