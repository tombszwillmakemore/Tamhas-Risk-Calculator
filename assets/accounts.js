/* Tamhas Trading - Accounts view: your accounts, editable prop-firm rule profiles, and the researched firm directory.
   Rules are editable copies of researched templates. They are never presented as official or live. */
(function () {
  'use strict';
  var A = window.TTAccountsCore, DB = window.TTDB, P = window.TTPropData, JC = window.TTJournalCore, L = window.TTLiveCore, DDc = window.TTDD, root = document.getElementById('aRoot');
  if (!root || !A || !DB || !P) return;
  var DEF = DB.DEFAULT_ACCOUNT_ID;
  var S = { tab: 'accounts', accounts: [], ledger: [], rows: [], adding: false, form: {}, open: null, editing: null, firm: null, errors: [], loaded: false, err: null };
  var LABEL = { prop: 'PROP FIRM', live: 'PERSONAL LIVE', sim: 'DEMO / PAPER', other: 'OTHER' };
  function tagFor(a) { return a.category === 'prop' ? (a.status === 'funded' || a.status === 'passed' ? 'PROP · FUNDED' : 'PROP · EVALUATION') : LABEL[a.category]; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || root).querySelector(s); }
  function today() { return A.ymd(Date.now()); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function money(c) { return c == null ? '—' : JC.fmtMoney(c, true); }
  function firmBySlug(s) { return P.firms.filter(function (f) { return f.slug === s; })[0] || null; }
  function productOf(f, name) { return f && f.products.filter(function (p) { return p.name === name; })[0] || null; }
  function toast(msg, bad) { if (window.TTUI) { window.TTUI.toast(msg, bad); return; } var t = document.createElement('div'); t.className = 'toast show' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3000); }

  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('accounts'), DB.getAll('trades'), DB.getAll('ledger')]); }).then(function (r) {
      S.ledger = r[2];
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
      '<div><b>' + esc(a.name) + '</b><div class="a-sub"><span class="a-tag">' + esc(tagFor(a)) + '</span>' + (a.broker ? ' <span class="a-tag">' + esc(a.broker.toUpperCase()) + '</span>' : '') + ' <span class="a-tag st-' + esc(a.status) + '">' + esc(a.status.toUpperCase()) + '</span>' + (a.archived ? ' <span class="a-tag">ARCHIVED</span>' : '') + (window.TTTracker ? ' ' + TTTracker.chip(a) : '') + '</div></div>' +
      '<div class="a-pnl"><small>' + (st.netCents != null ? 'NET' : st.grossCents != null ? 'GROSS' : 'P&amp;L') + '</small><b class="' + ((st.netCents != null ? st.netCents : st.grossCents) > 0 ? 'pos' : (st.netCents != null ? st.netCents : st.grossCents) < 0 ? 'neg' : 'none') + '">' + money(st.netCents != null ? st.netCents : st.grossCents) + '</b></div></button>';
    if (open) h += detail(a, st, ruleKeys, stale);
    return h + '</div>';
  }
  function detail(a, st, ruleKeys, stale) {
    var h = '<div class="a-body"><p class="note">' + st.trades + ' trade' + (st.trades === 1 ? '' : 's') + ' logged · ' + st.closed + ' closed' + (st.open ? ' · ' + st.open + ' open' : '') +
      (a.startingBalanceCents != null ? ' · starting balance ' + JC.fmtMoney(a.startingBalanceCents) : '') + (st.closed && st.netTrades < st.closed ? ' · net counts only ' + st.netTrades + ' trade(s) with fees entered' : '') + '</p>';
    if (a.template) h += '<p class="note">Started from the <b>' + esc((firmBySlug(a.template.slug) || {}).name || a.template.slug) + ' · ' + esc(a.template.product || 'custom') + '</b> template, researched ' + esc(a.template.researchedOn) + '. These are your editable copies, not live rules.</p>';
    h += '<div class="field"><label for="a-st-' + esc(a.id) + '">Status</label><select id="a-st-' + esc(a.id) + '" data-act="a-status" data-id="' + esc(a.id) + '">' +
      A.STATUSES[a.category].map(function (s) { return '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>';
    if (L && L.isPersonal(a)) h += livePanel(a); else if (window.TTTracker) h += TTTracker.html(a);
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
    var f = S.form, type = f.type || 'personal-live', personal = type === 'personal-live' || type === 'personal-demo', isProp = type === 'prop-eval' || type === 'prop-funded', firm = isProp ? firmBySlug(f.firm) : null, prod = firm && productOf(firm, f.product);
    var fld = function (id, label, val, attrs, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="text" value="' + esc(val || '') + '" autocomplete="off" ' + (attrs || '') + '>' + (hint ? '<p class="note" style="margin:4px 0 0">' + hint + '</p>' : '') + '</div>'; };
    var h = '<div class="panel"><h2>New account</h2>' + (S.errors.length ? '<div class="banner bad" role="alert">' + S.errors.map(esc).join('<br>') + '</div>' : '') +
      '<div class="field"><label for="n-type">Account type</label><select id="n-type" data-act="n-type">' + L.TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (type === t[0] ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</select>' +
      '<p class="note" style="margin:4px 0 0">' + esc((L.TYPES.filter(function (t) { return t[0] === type; })[0] || [])[2] || '') + '</p></div>' +
      fld('n-name', 'Account nickname', f.name, 'maxlength="60" placeholder="' + (personal ? 'e.g. My Tradovate' : 'e.g. Topstep 50K #1') + '"');
    if (personal) {
      h += '<div class="field"><label for="n-broker">Broker</label><select id="n-broker">' + L.BROKERS.map(function (b) { return '<option' + ((f.broker || 'Tradovate') === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="n-cur">Account currency</label><select id="n-cur">' + A.CURRENCIES.map(function (c) { return '<option' + ((f.currency || 'USD') === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>' +
        fld('n-bal', 'Starting balance, $', f.bal, 'inputmode="decimal" placeholder="e.g. 100"', '0 is allowed. Deposits and withdrawals are entered separately so they never count as profit or loss.') +
        '<div class="field"><label for="n-start">Starting date</label><input id="n-start" type="date" value="' + esc(f.startedOn || today()) + '"></div>' +
        fld('n-alias', 'Account alias (optional)', f.alias, 'maxlength="40" placeholder="e.g. ...4821"', 'A nickname or the last 4 digits. Never your full account number or password.') +
        fld('n-com', 'Commission per contract per side, $ (optional)', f.com, 'inputmode="decimal" placeholder="e.g. 0.39"') +
        fld('n-exf', 'Exchange + regulatory fees per contract per side, $ (optional)', f.exf, 'inputmode="decimal" placeholder="e.g. 0.37"', 'Used only to estimate fees for imported reports that have none (marked as estimated).') +
        fld('n-alert', 'Personal daily loss alert, $ (optional)', f.alert, 'inputmode="decimal" placeholder="e.g. 25"', 'Your own reminder. It is not a broker rule and never blocks anything.') +
        '<p class="note">No prop-firm rules apply: no profit target, evaluation deadline, trailing drawdown, payout or consistency rules.</p>';
    } else {
      h += fld('n-bal', 'Starting balance, $ (optional)', f.bal, 'inputmode="decimal" placeholder="e.g. 50000"');
    }
    if (isProp) {
      h += '<div class="field"><label for="n-firm">Start from a researched firm (optional)</label><select id="n-firm" data-act="n-firm"><option value="">Custom / not listed</option>' +
        P.firms.map(function (x) { return '<option value="' + x.slug + '"' + (f.firm === x.slug ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>';
      if (firm) h += '<div class="field"><label for="n-prod">Product</label><select id="n-prod" data-act="n-prod"><option value="">Firm-wide rules only</option>' + firm.products.map(function (p) { return '<option' + (f.product === p.name ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div>' +
        '<p class="note">Researched ' + esc(firm.researchedOn) + '. ' + (prod ? Object.keys(A.templateRules(firm, prod)).length : Object.keys(A.templateRules(firm, null)).length) + ' rules will be copied. You can edit or delete every one, and unknown ones stay blank. Facts marked third-party are unconfirmed.</p>';
    }
    return h + '<div class="row2"><button type="button" class="btn" data-act="n-save">CREATE</button><button type="button" class="btn" data-act="n-cancel">CANCEL</button></div></div>';
  }

  /* ---------- personal live / demo accounts: balance and cash flow (no prop rules) ---------- */
  var LKIND = { deposit: 'Deposit', withdrawal: 'Withdrawal', adjustment: 'Adjustment', fee: 'Account fee', snapshot: 'Broker balance', payout: 'Withdrawal (payout)', 'transfer-in': 'Transfer in', 'transfer-out': 'Transfer out' };
  function plain(c) { return c == null ? '—' : JC.fmtMoney(Math.abs(c)); }
  function signed(c) { return c == null ? '—' : (c < 0 ? '−' : c > 0 ? '+' : '') + JC.fmtMoney(Math.abs(c)); }
  function ledgerOf(id) { return S.ledger.filter(function (l) { return l.accountId === id; }).sort(function (a, b) { return b.at - a.at; }); }
  function livePanel(a) {
    var id = a.id, b = L.balance(a, S.rows, S.ledger), rc = L.reconcile(a, S.rows, S.ledger), al = L.dailyAlert(a, S.rows, today()), form = S.lform && S.lform.id === id ? S.lform : null;
    var row = function (label, v, cls, sub) { return '<li><span>' + label + (sub ? '<div class="note" style="margin:2px 0 0">' + sub + '</div>' : '') + '</span><b class="' + (cls || '') + '">' + v + '</b></li>'; };
    var pc = function (c) { return c > 0 ? 'pos' : c < 0 ? 'neg' : ''; };
    var h = '<div class="lv-wrap"><h3 class="a-h">Balance and cash flow</h3><div class="lv-hero" role="group" aria-label="Account balance"><small>CALCULATED BALANCE' + (b.exact ? '' : ' · NEEDS VERIFICATION') + '</small><b class="lv-bal' + (b.balanceCents == null ? ' none' : '') + '">' + esc(b.balanceCents == null ? '—' : (b.balanceCents < 0 ? '−' : '') + plain(b.balanceCents)) + '</b>' +
      '<span class="note">' + esc(a.currency || 'USD') + ' · calculated by TRC from your entries, not reported by ' + esc(a.broker || 'your broker') + '</span></div>';
    h += '<ul class="ui-list lv-break">' + row('Starting balance' + (a.startedOn ? ' (' + esc(a.startedOn) + ')' : ''), esc(b.openingCents == null ? '—' : plain(b.openingCents))) +
      row('Realized trading P&amp;L (gross)', esc(signed(b.grossCents)), pc(b.grossCents), b.closed + ' closed trade' + (b.closed === 1 ? '' : 's')) +
      row('Trading fees', esc(b.tradeFeesCents ? '−' + plain(b.tradeFeesCents) : '$0.00'), '', b.feesUnknown ? '<span class="warnline">' + b.feesUnknown + ' trade(s) without fees</span>' : 'commissions, exchange and regulatory fees on trades') +
      row('<b>Net trading P&amp;L</b>', esc(signed(b.netTradingCents)) + (b.netTradingExact ? '' : ' *'), pc(b.netTradingCents), 'your performance: deposits and withdrawals are not included') +
      row('Deposits', esc(b.depositsCents ? '+' + plain(b.depositsCents) : '$0.00')) + row('Withdrawals', esc(b.withdrawalsCents ? '−' + plain(b.withdrawalsCents) : '$0.00')) +
      (b.adjustmentsCents ? row('Adjustments', esc(signed(b.adjustmentsCents))) : '') + (b.accountFeesCents ? row('Account fees (data, platform…)', esc('−' + plain(b.accountFeesCents))) : '') +
      (b.transfersInCents || b.transfersOutCents ? row('Transfers in / out', esc(signed(b.transfersInCents - b.transfersOutCents))) : '') +
      row('Unrealized P&amp;L', b.open ? 'unavailable' : '—', '', b.open ? b.open + ' open position(s); TRC has no live prices' : 'no open positions') + '</ul>';
    if (b.reasons.length) h += '<div class="ui-banner warn" role="note">' + b.reasons.map(esc).join('<br>') + (b.netTradingExact ? '' : '<br>* Net is higher than reality until the missing fees are entered.') + '</div>';
    if (rc) h += '<div class="ui-banner ' + (rc.matches ? 'good' : 'warn') + '"><b>Broker balance ' + esc(plain(rc.brokerCents)) + '</b> on ' + esc(rc.date || new Date(rc.at).toLocaleDateString()) + ' · TRC calculated ' + esc(rc.calculatedCents == null ? '—' : plain(rc.calculatedCents)) + (rc.differenceCents ? ' · difference ' + esc(signed(rc.differenceCents)) : '') + '. ' + esc(rc.hint) + '</div>';
    if (al) h += '<p class="note' + (al.reached ? ' warnline' : '') + '">Daily loss alert ' + esc(signed(-al.limitCents)) + ' · today ' + esc(signed(al.todayCents)) + (al.reached ? ' · <b>reached</b>' : '') + ' · ' + esc(al.label) + '.</p>';
    h += '<div class="t-addrow" role="group" aria-label="Add a cash-flow entry">' + ['deposit', 'withdrawal', 'adjustment', 'fee', 'snapshot'].map(function (k) { return '<button type="button" class="btn small" data-act="lv-open" data-id="' + esc(id) + '" data-kind="' + k + '">+ ' + LKIND[k].toUpperCase() + '</button>'; }).join('') + '</div>';
    if (form) h += liveForm(a, form);
    var list = ledgerOf(id);
    if (list.length) h += '<details class="t-adv"' + (S.lopen === id ? ' open' : '') + ' data-lv="' + esc(id) + '"><summary>Entries (' + list.length + ')</summary><div class="t-advbody">' + list.map(function (l) {
      var amt = l.type === 'snapshot' ? 'balance ' + plain(l.balanceCents) : (L.signOf(l) < 0 || l.type === 'fee' ? '−' : '+') + plain(l.amountCents);
      return '<div class="t-rec' + (l.voided ? ' void' : '') + '"><div><b>' + esc(LKIND[l.type] || l.type) + '</b> · ' + esc(l.date || new Date(l.at).toLocaleDateString()) + '<div class="note">' + esc(amt) + (l.note ? ' · ' + esc(l.note) : '') + (l.voided ? ' · VOIDED' : '') + '</div></div>' +
        '<button type="button" class="linkbtn" data-act="lv-void" data-id="' + esc(l.id) + '">' + (l.voided ? 'Restore' : 'Void') + '</button></div>'; }).join('') + '<p class="note">Voiding keeps the entry in the history but removes it from the balance. Nothing is deleted.</p></div></details>';
    h += detailsEditor(a);
    return h + '</div>';
  }
  function liveForm(a, f) {
    var k = f.kind, d = f.draft || {}, err = f.errors || [];
    var h = '<div class="panel lv-form"><h3 class="a-h" style="margin-top:0">' + esc(LKIND[k]) + '</h3>' + (err.length ? '<div class="banner bad" role="alert">' + err.map(esc).join('<br>') + '</div>' : '') +
      '<div class="field"><label for="lf-date">Date</label><input id="lf-date" type="date" value="' + esc(d.date || today()) + '"></div>';
    if (k === 'snapshot') h += '<div class="field"><label for="lf-balance">Balance shown by ' + esc(a.broker || 'your broker') + ', $</label><input id="lf-balance" type="text" inputmode="decimal" value="' + esc(d.balance || '') + '"></div><p class="note">Used to check TRC\'s calculation. It never changes your balance by itself.</p>';
    else h += '<div class="field"><label for="lf-amount">Amount, $</label><input id="lf-amount" type="text" inputmode="decimal" value="' + esc(d.amount || '') + '" placeholder="e.g. 50"></div>';
    if (k === 'adjustment') h += '<fieldset class="field lv-dir"><legend>Direction</legend><label class="a-chk"><input type="radio" name="lf-dir" value="up"' + (d.dir === 'up' ? ' checked' : '') + '> Adds to the balance</label><label class="a-chk"><input type="radio" name="lf-dir" value="down"' + (d.dir === 'down' ? ' checked' : '') + '> Takes from the balance</label></fieldset>';
    if (k === 'fee') h += '<div class="field"><label for="lf-feeKind">Fee type</label><select id="lf-feeKind">' + ['data', 'platform', 'other'].map(function (x) { return '<option' + (d.feeKind === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div><p class="note">For monthly data or platform fees. Commissions on trades belong on the trades.</p>';
    if (k === 'deposit' || k === 'withdrawal') h += '<p class="note">' + (k === 'deposit' ? 'Money you added. It raises the balance but is never counted as trading profit.' : 'Money you took out. It lowers the balance but is never counted as a trading loss.') + '</p>';
    h += '<div class="field"><label for="lf-note">' + (k === 'adjustment' ? 'Reason (required)' : 'Note (optional)') + '</label><input id="lf-note" type="text" maxlength="200" value="' + esc(d.note || '') + '"></div>';
    return h + '<div class="row2"><button type="button" class="btn small" data-act="lv-save" data-id="' + esc(a.id) + '"' + (S.lbusy ? ' disabled' : '') + '>SAVE</button><button type="button" class="btn small" data-act="lv-cancel">CANCEL</button></div></div>';
  }
  function detailsEditor(a) {
    var e = S.dedit && S.dedit.id === a.id ? S.dedit : null, m2 = function (c) { return c == null ? '' : (c / 100).toFixed(2); };
    var fmtLog = function (x, v) { return v == null ? '(empty)' : /Cents$/.test(x.field) ? plain(v) : typeof v === 'object' ? plain(v.dailyLossCents) : String(v); };
    return '<details class="t-adv"' + (e ? ' open' : '') + ' data-ded="' + esc(a.id) + '"><summary>Account details</summary><div class="t-advbody">' + (e && e.errors && e.errors.length ? '<div class="banner bad" role="alert">' + e.errors.map(esc).join('<br>') + '</div>' : '') +
      '<div class="field"><label for="de-bal">Starting balance, $</label><input id="de-bal" type="text" inputmode="decimal" value="' + esc(m2(a.startingBalanceCents)) + '"></div>' +
      '<div class="field"><label for="de-start">Starting date</label><input id="de-start" type="date" value="' + esc(a.startedOn || '') + '"></div>' +
      '<div class="field"><label for="de-broker">Broker</label><select id="de-broker">' + L.BROKERS.map(function (b) { return '<option' + ((a.broker || '') === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="de-cur">Currency</label><select id="de-cur">' + A.CURRENCIES.map(function (c) { return '<option' + ((a.currency || 'USD') === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="de-alias">Account alias</label><input id="de-alias" type="text" maxlength="40" value="' + esc(a.accountAlias || '') + '"></div>' +
      '<div class="field"><label for="de-com">Commission per contract per side, $</label><input id="de-com" type="text" inputmode="decimal" value="' + esc(m2(a.commissionCents)) + '"></div>' +
      '<div class="field"><label for="de-exf">Exchange + regulatory fees per contract per side, $</label><input id="de-exf" type="text" inputmode="decimal" value="' + esc(m2(a.exchangeFeeCents)) + '"></div>' +
      '<div class="field"><label for="de-alert">Personal daily loss alert, $</label><input id="de-alert" type="text" inputmode="decimal" value="' + esc(a.riskAlert ? m2(a.riskAlert.dailyLossCents) : '') + '"></div>' +
      '<div class="field"><label for="de-note">Why are you changing this? (kept in the history)</label><input id="de-note" type="text" maxlength="200"></div>' +
      '<button type="button" class="btn small" data-act="de-save" data-id="' + esc(a.id) + '">SAVE DETAILS</button>' +
      ((a.changeLog || []).length ? '<details class="a-hist"><summary>Change history (' + a.changeLog.length + ')</summary>' + a.changeLog.slice().reverse().map(function (x) { return '<p class="note">' + esc(new Date(x.at).toLocaleString()) + ' · <b>' + esc(x.label) + '</b>: ' + esc(fmtLog(x, x.from)) + ' → ' + esc(fmtLog(x, x.to)) + (x.note ? ' · ' + esc(x.note) : '') + '</p>'; }).join('') + '</details>' : '') +
      '</div></details>';
  }
  function saveLive(id) {
    var f = S.lform, g = function (n) { var e = $('#lf-' + n); return e ? e.value : ''; }, dirEl = root.querySelector('input[name="lf-dir"]:checked');
    if (!f || S.lbusy) return;
    var d = { date: g('date'), amount: g('amount'), balance: g('balance'), note: g('note'), feeKind: g('feeKind'), dir: dirEl ? dirEl.value : '' }; f.draft = d;
    var tz = 'UTC'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* default */ }
    var v = DDc.validateLedger({ type: f.kind, accountId: id, date: d.date, amount: d.amount, balance: d.balance, note: d.note, feeKind: d.feeKind, dir: d.dir, source: 'my-own' }, { journalTz: tz });
    if (!v.ok) { f.errors = v.errors; render(); return; }
    var rec = v.record; if (f.kind === 'snapshot') rec.source = 'broker';
    var dup = DDc.findDuplicate(S.ledger, rec);
    var go = function () {
      if (S.lbusy) return; S.lbusy = true; var now = Date.now(); rec.id = 'lg-' + now.toString(36) + Math.random().toString(36).slice(2, 6); rec.createdAt = now; rec.voided = false;
      DB.batch([{ store: 'ledger', type: 'put', value: rec }, { store: 'audit', type: 'put', value: { id: DB.uid('au'), at: now, type: 'ledger-add', details: { kind: f.kind, accountId: id, id: rec.id } } }])
        .then(function () { S.ledger.push(rec); S.lform = null; S.lbusy = false; toast('Saved.'); render(); window.dispatchEvent(new Event('tt:ledger-changed')); })
        .catch(function () { S.lbusy = false; f.errors = ['Could not save (browser storage blocked or full). Nothing was changed.']; render(); });
    };
    if (dup && window.TTUI) window.TTUI.confirm('Add it again?', 'An entry with the same date, amount and note already exists. Adding it again counts it twice.', 'ADD AGAIN', false).then(function (y) { if (y) go(); }); else go();
  }
  function voidLive(lid) {
    var l = S.ledger.filter(function (x) { return x.id === lid; })[0]; if (!l) return; var n = Object.assign({}, l, { voided: !l.voided, updatedAt: Date.now() });
    DB.batch([{ store: 'ledger', type: 'put', value: n }, { store: 'audit', type: 'put', value: { id: DB.uid('au'), at: Date.now(), type: n.voided ? 'ledger-void' : 'ledger-restore', details: { id: lid } } }])
      .then(function () { S.ledger = S.ledger.map(function (x) { return x.id === lid ? n : x; }); S.lopen = l.accountId; toast(n.voided ? 'Entry voided (kept in history).' : 'Entry restored.'); render(); window.dispatchEvent(new Event('tt:ledger-changed')); }).catch(function () { toast('Could not save.', true); });
  }
  function saveDetails(id) {
    var a = acctById(id), g = function (n) { var e = $('#de-' + n); return e ? e.value : undefined; };
    var r = A.editDetails(a, { startingBalance: g('bal'), startedOn: g('start'), broker: g('broker'), currency: g('cur'), accountAlias: g('alias'), commission: g('com'), exchangeFee: g('exf'), dailyLossAlert: g('alert') }, g('note'));
    if (!r.ok) { S.dedit = { id: id, errors: r.errors }; render(); return; }
    if (r.unchanged) { S.dedit = null; toast('Nothing changed.'); render(); return; }
    save(r.account).then(function (ok) { if (ok) { S.dedit = null; toast('Details saved. The change is kept in the history.'); render(); } });
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
    S.form = { type: g('n-type') || S.form.type, name: g('n-name'), bal: g('n-bal'), firm: $('#n-firm') ? g('n-firm') : S.form.firm, product: $('#n-prod') ? g('n-prod') : S.form.product,
      broker: $('#n-broker') ? g('n-broker') : S.form.broker, currency: $('#n-cur') ? g('n-cur') : S.form.currency, startedOn: $('#n-start') ? g('n-start') : S.form.startedOn, alias: g('n-alias'), com: g('n-com'), exf: g('n-exf'), alert: g('n-alert') };
    var map = L.fromType(S.form.type || 'personal-live'); S.form.category = map.category; S.form.status = map.status;
  }
  function create() {
    readNew(); var f = S.form, firm = f.category === 'prop' ? firmBySlug(f.firm) : null, prod = firm && productOf(firm, f.product);
    var personal = f.category === 'live' || f.category === 'sim';
    var r = A.newAccount({ name: f.name, category: f.category, status: f.status, startingBalance: f.bal, firmSlug: firm ? firm.slug : null, productName: prod ? prod.name : null, startedOn: personal ? f.startedOn : undefined,
      broker: personal ? f.broker : null, currency: personal ? f.currency : 'USD', accountAlias: personal ? f.alias : '', commission: personal ? f.com : '', exchangeFee: personal ? f.exf : '', dailyLossAlert: personal ? f.alert : '',
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
      default: if (act && act.indexOf('t-') === 0 && window.TTTracker) TTTracker.click(el); break;
      case 'a-tab': S.tab = el.getAttribute('data-tab'); render(); break;
      case 'a-new': S.adding = true; S.form = { type: 'personal-live', category: 'live' }; S.errors = []; render(); var nt = $('#n-type'); if (nt) nt.focus(); break;
      case 'lv-open': S.lform = { id: id, kind: el.getAttribute('data-kind'), draft: {}, errors: [] }; render(); var fi = $('#lf-amount') || $('#lf-balance'); if (fi) fi.focus(); break;
      case 'lv-cancel': S.lform = null; render(); break;
      case 'lv-save': saveLive(id); break;
      case 'lv-void': voidLive(id); break;
      case 'de-save': saveDetails(id); break;
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
    var el = ev.target; if (window.TTTracker && el.getAttribute && TTTracker.change(el)) return; var act = el.getAttribute && el.getAttribute('data-act'); if (!act) return;
    if (act === 'n-type') { readNew(); S.form.firm = ''; S.form.product = ''; render(); var t = $('#n-type'); if (t) t.focus(); }
    else if (act === 'n-firm') { readNew(); S.form.product = ''; render(); }
    else if (act === 'n-prod') { readNew(); render(); }
    else if (act === 'a-addrule') { var f = el.value; if (f) { S.editing = { id: el.getAttribute('data-id'), field: f }; render(); var i = $('#rv-' + f); if (i) i.focus(); } }
    else if (act === 'a-status') { var a = acctById(el.getAttribute('data-id')), r = a && A.setStatus(a, el.value, ''); if (r && r.ok && !r.unchanged) save(r.account).then(function () { render(); toast('Status updated.'); }); }
  });
  window.addEventListener('tt:journal-changed', function () { if (!S.loaded) return; load().then(function () { if (!S.editing && !S.adding) render(); }); });
  if (window.TTTracker) TTTracker.init({ getLedger: function () { return S.ledger; }, getRows: function () { return S.rows; }, getAccounts: function () { return S.accounts; }, getOpenAccount: function () { return acctById(S.open); }, save: save, rerender: function () { render(); }, toast: toast });
  window.TTAccounts = { reload: function () { return load().then(render); },
    // Used by TRC Copilot: expand one account by id. Returns true only if that account exists and is now open.
    open: function (id) { if (!acctById(id)) return false; S.tab = 'accounts'; S.open = id; S.editing = null; render(); return S.open === id; }, list: function () { return S.accounts.slice(); } };
  render(); load().then(render);
})();
