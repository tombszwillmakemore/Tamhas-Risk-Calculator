/* Tamhas Trading - Risk Center: position size, reward:risk, fee impact, break-even, open exposure against YOUR limits,
   scenarios (assumptions in, arithmetic out) and risk history. Limits are only what you enter; nothing is invented. */
(function () {
  'use strict';
  var root = document.getElementById('rkRoot'); if (!root) return;
  var K = window.TTRiskCore, A = window.TTAnalyticsCore, C = window.TTJournalCore, U = window.TTUI, DB = window.TTDB, ST = window.TTStore, AC = window.TTAccountsCore, INST = window.TTInstruments;
  var esc = U.esc, m = function (c, plus) { return c == null ? '—' : C.fmtMoney(c, plus); };
  var S = { loaded: false, err: null, tab: 'calc', rows: [], accounts: [], limits: {}, acct: '', form: { instId: INST.defaultId, entry: '', stop: '', target: '', risk: '', fee: '', contracts: '' }, scen: { win: '', rr: '', risk: '', n: '50', limit: '', seq: '' }, limErr: null, limDraft: null };
  var TABS = [['calc', 'CALCULATE'], ['exposure', 'EXPOSURE'], ['limits', 'LIMITS'], ['scen', 'SCENARIOS'], ['hist', 'HISTORY']];

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function load() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), DB.getAll('accounts'), ST.list('risklimit')]); }).then(function (r) {
      var ok = []; r[0].forEach(function (raw) { var n = C.normalizeTrade(raw); if (n.ok) ok.push(n.trade); }); S.rows = C.analyze(ok);
      S.accounts = r[1].map(AC.normalizeAccount).filter(function (a) { return !a.archived; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
      S.limits = {}; r[2].forEach(function (d) { if (d.accountId) S.limits[d.accountId] = d; });
      if (S.acct && !S.accounts.some(function (a) { return a.id === S.acct; })) S.acct = ''; if (!S.acct && S.accounts.length === 1) S.acct = S.accounts[0].id; /* with one account its limits apply automatically */ S.loaded = true; S.err = null;
    }).catch(function (e) { S.err = (e && e.message) || 'Could not open the local database.'; S.loaded = true; });
  }
  function price(v) { var s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (s === '') return null; return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN; }
  function field(id, label, val, ph, mode) { return '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="text" inputmode="' + (mode || 'decimal') + '" autocomplete="off" placeholder="' + esc(ph || '') + '" value="' + esc(val) + '">'; }
  function stat(l, v, sub, k, help) { return U.stat(l, v, sub, k, help); }

  /* ---------- calculate ---------- */
  function calcResults() {
    var f = S.form, e = price(f.entry), s = price(f.stop), t = price(f.target), risk = K.parseMoney(f.risk), fee = K.parseMoney(f.fee), con = f.contracts === '' ? null : Number(f.contracts), out = '';
    if (f.entry === '' || f.stop === '') return '<p class="note">Enter an entry and a stop to see your size.</p>';
    if (isNaN(e) || isNaN(s) || (f.target !== '' && isNaN(t))) return '<p class="note warnline">Prices need at most 2 decimals.</p>';
    if (f.fee !== '' && (fee == null || isNaN(fee))) return '<p class="note warnline">Fees must be a dollar amount.</p>';
    var feeC = fee == null ? 0 : fee;
    if (f.risk !== '') {
      if (risk == null || isNaN(risk) || risk <= 0) return '<p class="note warnline">Risk must be a dollar amount above $0.</p>';
      var p = K.positionSize({ instId: f.instId, entry: e, stop: s, riskCents: risk, feePerContractCents: feeC });
      if (!p.ok) return '<p class="note warnline">' + esc(p.error) + '</p>';
      out += '<div class="ui-grid">' + stat('Contracts', String(p.contracts), p.side.toUpperCase() + ' · ' + p.stopPoints + ' pt stop', p.contracts ? 'pos' : 'neg') + stat('Risk at stop', m(p.stopRiskCents), (p.feeCents ? '+ ' + m(p.feeCents) + ' fees = ' + m(p.totalRiskCents) : 'per contract ' + m(p.perContractCents))) + '</div>' +
        '<p class="note">' + (p.contracts ? 'Leftover ' + m(p.leftoverCents) + ' of your ' + m(risk) + '.' : esc(p.note)) + (p.capped ? ' Capped at ' + K.MAX_CONTRACTS + ' contracts.' : '') + '</p>';
      var lim = S.acct && S.limits[S.acct] && S.limits[S.acct].limits; if (lim && lim.maxContracts && p.contracts > lim.maxContracts) out += '<div class="ui-banner warn">That is above your own max of ' + lim.maxContracts + ' contracts for this account.</div>';
      if (lim && lim.maxRiskPerTradeCents && p.totalRiskCents > lim.maxRiskPerTradeCents) out += '<div class="ui-banner warn">That risks ' + m(p.totalRiskCents) + ', above your own max of ' + m(lim.maxRiskPerTradeCents) + ' per trade.</div>';
    } else out += '<p class="note">Add a dollar risk to see how many contracts fit.</p>';
    var n = con != null && Number.isInteger(con) ? con : (out.indexOf('Contracts') >= 0 ? null : 1);
    if (f.target !== '') {
      var cN = f.contracts !== '' ? con : (f.risk !== '' && K.positionSize({ instId: f.instId, entry: e, stop: s, riskCents: risk || 1, feePerContractCents: feeC }).contracts) || 1;
      var rr = K.rewardRisk({ instId: f.instId, entry: e, stop: s, target: t, contracts: cN, feesCents: feeC * cN });
      if (!rr.ok) out += '<p class="note warnline">' + esc(rr.error) + '</p>';
      else out += '<h3 class="sub">Reward : risk (' + cN + (cN === 1 ? ' contract' : ' contracts') + ')</h3><div class="ui-grid">' + stat('Reward : risk', '1 : ' + rr.rr.toFixed(2), m(rr.rewardCents) + ' vs ' + m(rr.riskCents)) + stat('Win rate to break even', U.fmtPct(rr.breakEvenWinRate, 1), 'before fees') +
        (feeC ? stat('After fees', '1 : ' + rr.netRR.toFixed(2), 'win rate needed ' + U.fmtPct(rr.netBreakEvenWinRate, 1)) + stat('Fees vs risk', U.fmtPct(rr.feePctOfRisk, 1), m(rr.feesCents) + ' round trip') : '') + '</div>' +
        '<p class="note">Break-even win rate is the share of trades you must win, at this reward:risk, to neither gain nor lose. It says nothing about how likely a winner is.</p>';
    }
    if (f.fee !== '' && feeC > 0) { var cc = f.contracts !== '' ? con : (K.positionSize({ instId: f.instId, entry: e, stop: s, riskCents: risk || 1, feePerContractCents: feeC }).contracts || 1), be = K.breakEven({ instId: f.instId, entry: e, side: s < e ? 'long' : 'short', contracts: cc, feesCents: feeC * cc }); if (be.ok) out += '<p class="note">Fees on ' + cc + ' contract' + (cc === 1 ? '' : 's') + ' are covered at <b>' + be.price + '</b> (' + be.points + ' pt from entry).</p>'; }
    return out;
  }
  function calcHtml() {
    var f = S.form, lim = S.acct && S.limits[S.acct] && S.limits[S.acct].limits;
    return '<div class="panel ui-form"><h2>Position size &amp; reward : risk</h2><label for="rk-inst">Contract</label><select id="rk-inst" data-k="instId">' + INST.list.map(function (i) { return '<option value="' + i.id + '"' + (f.instId === i.id ? ' selected' : '') + '>' + i.id + ' · ' + i.label + '/pt</option>'; }).join('') + '</select>' +
      (S.accounts.length > 1 ? '<label for="rk-acct">Check against account limits</label><select id="rk-acct" data-acct="1"><option value="">None</option>' + S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (S.acct === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>' : '') +
      '<div class="fgrid">' + '<div>' + field('rk-entry', 'Entry price', f.entry, 'e.g. 21050.25') + '</div><div>' + field('rk-stop', 'Stop price', f.stop, 'e.g. 21040') + '</div></div>' +
      field('rk-target', 'Target price (optional)', f.target, 'for reward : risk') +
      '<div class="fgrid"><div>' + field('rk-risk', 'Risk in $', f.risk, 'e.g. 250') + (lim && lim.maxRiskPerTradeCents ? '<button type="button" class="chip" data-act="rk-usemax" style="margin-top:6px">USE MY MAX (' + esc(m(lim.maxRiskPerTradeCents)) + ')</button>' : '') + '</div><div>' + field('rk-fee', 'Round-trip fees per contract, $ (optional)', f.fee, 'blank = not counted') + '</div></div>' +
      field('rk-con', 'Contracts for reward : risk (optional)', f.contracts, 'blank = use the size above', 'numeric') + '</div>' +
      '<div class="panel" id="rkOut" aria-live="polite">' + calcResults() + '</div><p class="note">Calculated on your device from CME point values. Not financial advice.</p>';
  }

  /* ---------- exposure ---------- */
  function statusBadge(s) { return '<span class="ui-badge ' + (s === 'breach' ? 'bad' : s === 'warn' ? 'warn' : s === 'ok' ? 'good' : '') + '">' + (s === 'breach' ? 'OVER LIMIT' : s === 'warn' ? 'CLOSE' : s === 'ok' ? 'OK' : 'UNKNOWN') + '</span>'; }
  function fmtLim(r) { var money = r.key.slice(-5) === 'Cents'; return money ? m(r.used) + ' of ' + m(r.limit) : (r.used == null ? '—' : r.used) + ' of ' + r.limit; }
  function accountCard(a) {
    var rec = S.limits[a.id], lim = rec && rec.limits, rows = S.rows, ctx = K.accountContext(rows, a.id, today()), ev = lim ? K.evaluate(lim, ctx) : [];
    var worst = ev.some(function (x) { return x.status === 'breach'; }) ? 'breach' : ev.some(function (x) { return x.status === 'warn'; }) ? 'warn' : ev.length ? 'ok' : '';
    var h = '<div class="panel"><div class="ui-sec" style="margin:0 0 8px"><h2 style="margin:0">' + esc(a.name) + '</h2>' + (worst ? statusBadge(worst) : '') + '</div>' +
      '<div class="ui-grid">' + stat('Today', m(ctx.dayPnlCents, true), U.plural(ctx.trades, 'trade'), U.cls(ctx.dayPnlCents), 'Realized so far today: net when fees are entered, otherwise gross.') + stat('This week', m(ctx.weekPnlCents, true), 'Mon to Sun', U.cls(ctx.weekPnlCents)) +
      stat('Open risk', ctx.openRiskUnknown ? '—' : m(ctx.openRiskCents), ctx.openRiskUnknown ? U.plural(ctx.openUnknownCount, 'open trade') + ' with no stop' : 'at initial stops', '', 'Contracts still open × distance to the stop you entered. If a stop moved, update the trade.') + '</div>';
    if (!lim) return h + '<p class="note">No limits set for this account. <button type="button" class="linkbtn" data-act="rk-go-limits" data-id="' + esc(a.id) + '">Set your limits</button></p></div>';
    h += '<ul class="ui-list">' + ev.map(function (r) { return '<li style="flex-wrap:wrap"><span>' + esc(r.label) + (r.note ? '<div class="note" style="margin:2px 0 0">' + esc(r.note) + '</div>' : '') + '</span><span>' + (r.status === 'unknown' ? '—' : esc(fmtLim(r))) + ' ' + statusBadge(r.status) + '</span>' +
      (r.pct != null ? '<div style="flex-basis:100%">' + U.meter(Math.min(100, r.pct), r.status === 'breach' ? 'bad' : r.status === 'warn' ? 'warn' : '') + '</div>' : '') + '</li>'; }).join('') + '</ul>';
    return h + '<p class="note">Compared with limits <b>you</b> set (warning at ' + lim.warnPct + '%). Firm rules are checked in Accounts.</p></div>';
  }
  function exposureHtml() {
    if (!S.accounts.length) return U.empty('No accounts yet', 'Add an account in Accounts to track exposure against your limits.');
    var all = S.accounts.map(accountCard).join(''), breach = 0, warn = 0;
    S.accounts.forEach(function (a) { var l = S.limits[a.id]; if (!l) return; K.evaluate(l.limits, K.accountContext(S.rows, a.id, today())).forEach(function (x) { if (x.status === 'breach') breach++; else if (x.status === 'warn') warn++; }); });
    var top = breach ? '<div class="ui-banner bad" role="alert"><b>' + U.plural(breach, 'limit') + ' exceeded today.</b> These are your own rules, so review before taking another trade.</div>' : warn ? '<div class="ui-banner warn">' + U.plural(warn, 'limit') + ' close to your warning level.</div>' : '';
    return top + all;
  }

  /* ---------- limits ---------- */
  function limitsHtml() {
    var a = S.accounts.filter(function (x) { return x.id === S.limAcct; })[0] || S.accounts[0]; if (!a) return U.empty('No accounts yet', 'Add an account first.');
    var rec = S.limits[a.id], cur = S.limDraft || (rec && rec.limits) || {}, rulesHint = ['dailyLossLimit', 'maxLossAmount', 'maxContracts'].filter(function (k) { return a.rules && a.rules[k]; }).map(function (k) { return k.replace(/([A-Z])/g, ' $1').toLowerCase() + ': ' + a.rules[k].value; });
    function val(L) { var v = cur[L.key]; if (v == null) return ''; return L.kind === 'money' ? (typeof v === 'number' ? (v / 100).toFixed(2).replace(/\.00$/, '') : v) : v; }
    return '<div class="panel ui-form"><h2>Your limits</h2>' + (S.accounts.length > 1 ? '<label for="rk-lacct">Account</label><select id="rk-lacct">' + S.accounts.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === a.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' : '<p class="note" style="margin-top:0"><b>' + esc(a.name) + '</b></p>') +
      '<p class="note">Personal guard-rails. Leave a box empty to turn that limit off. They are not your firm\'s rules' + (rulesHint.length ? ' (your recorded rules for reference: ' + esc(rulesHint.join('; ')) + ')' : '') + '.</p>' +
      K.LIMITS.map(function (L) { return field('rl-' + L.key, L.label + (L.kind === 'money' ? ' ($)' : ''), val(L), L.kind === 'money' ? 'e.g. 500' : 'e.g. 3', L.kind === 'money' ? 'decimal' : 'numeric'); }).join('') +
      field('rl-warnPct', 'Warn me at (% of a limit)', cur.warnPct == null ? 80 : cur.warnPct, '80', 'numeric') +
      (S.limErr ? '<div class="ui-banner bad" role="alert">' + S.limErr.map(esc).join('<br>') + '</div>' : '') +
      '<div class="ui-row" style="margin-top:12px"><button type="button" class="btn" data-act="rk-save-limits" data-id="' + esc(a.id) + '">SAVE LIMITS</button>' + (rec ? '<button type="button" class="btn ghost" data-act="rk-clear-limits" data-id="' + esc(a.id) + '">REMOVE ALL</button>' : '') + '</div></div>';
  }
  function saveLimits(id) {
    var raw = {}; K.LIMITS.forEach(function (L) { var e = document.getElementById('rl-' + L.key); raw[L.key] = e ? e.value : ''; }); raw.warnPct = document.getElementById('rl-warnPct').value;
    var v = K.validateLimits(raw); S.limDraft = raw;
    if (!v.ok) { S.limErr = v.errors; render(); return; } S.limErr = null; S.limDraft = null;
    ST.save({ id: 'rl-' + id, kind: 'risklimit', accountId: id, limits: v.limits, createdAt: S.limits[id] && S.limits[id].createdAt }).then(function () { return load(); }).then(function () { U.toast('Limits saved.'); render(); }).catch(function () { U.toast('Could not save the limits.', true); });
  }

  /* ---------- scenarios ---------- */
  function pct(v) { var s = String(v == null ? '' : v).replace(/[%\s]/g, ''); if (s === '') return null; var n = Number(s); return isFinite(n) ? n : NaN; }
  function scenHtml() {
    var c = S.scen, h = '<div class="panel ui-form"><h2>What if…</h2><p class="note" style="margin-top:0">You choose the assumptions; this shows the arithmetic. It does not predict your results. Real trades are not independent coin flips.</p>' +
      '<div class="fgrid"><div>' + field('sc-win', 'Win rate (%)', c.win, 'e.g. 45') + '</div><div>' + field('sc-rr', 'Average reward : risk', c.rr, 'e.g. 1.5') + '</div><div>' + field('sc-risk', 'Risk per trade ($)', c.risk, 'e.g. 200') + '</div><div>' + field('sc-n', 'Number of trades', c.n, '50', 'numeric') + '</div></div>' + field('sc-limit', 'Loss limit to test, $ (optional)', c.limit, 'e.g. 1000') +
      '<div class="ui-row" style="margin-top:10px"><button type="button" class="chip" data-act="sc-mine">USE MY JOURNAL STATS</button></div></div><div class="panel" id="scOut">' + scenResults() + '</div>' +
      '<div class="panel ui-form"><h2>Try a sequence</h2><p class="note" style="margin-top:0">Type results in R, separated by commas, to see the path at your risk per trade. Example: -1, -1, 2, -1, 3</p>' + field('sc-seq', 'Results in R', c.seq, '-1, -1, 2', 'text') + '<div id="scSeq">' + seqResults() + '</div></div>';
    return h;
  }
  function scenResults() {
    var c = S.scen, p = pct(c.win), rr = Number(c.rr), risk = K.parseMoney(c.risk), n = Number(c.n), lim = K.parseMoney(c.limit);
    if (c.win === '' || c.rr === '' || c.risk === '') return '<p class="note">Fill in win rate, reward : risk and risk per trade.</p>';
    if (p == null || isNaN(p) || p < 0 || p > 100) return '<p class="note warnline">Win rate must be between 0 and 100.</p>'; if (!(rr > 0)) return '<p class="note warnline">Reward : risk must be above 0.</p>';
    if (risk == null || isNaN(risk) || risk <= 0) return '<p class="note warnline">Risk must be a dollar amount above $0.</p>'; if (!(Number.isInteger(n) && n >= 1 && n <= 2000)) return '<p class="note warnline">Number of trades must be a whole number from 1 to 2000.</p>';
    var ev = K.expectedValue(p / 100, rr, risk), be = K.breakEvenWinRate(rr);
    var h = '<div class="ui-grid">' + stat('Break-even win rate', U.fmtPct(be, 1), 'at 1 : ' + rr, p / 100 >= be ? 'pos' : 'neg') + stat('Average per trade', m(Math.round(ev), true), 'if the assumptions held', ev > 0 ? 'pos' : ev < 0 ? 'neg' : '', 'An average over many trades. Any single run can differ a lot.') + stat('Over ' + n + ' trades', m(Math.round(ev * n), true), 'average outcome', ev > 0 ? 'pos' : ev < 0 ? 'neg' : '') + '</div>';
    var rowsT = K.streakTable(p / 100, n, [2, 3, 4, 5, 6, 8, 10]);
    h += '<h3 class="sub">Chance of a losing streak inside ' + n + ' trades</h3><div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>Losses in a row</th><th>Chance at least once</th><th>Cost at ' + esc(m(risk)) + '</th></tr></thead><tbody>' + rowsT.map(function (r) { return '<tr><td style="text-align:left">' + r.k + '</td><td>' + (r.prob == null ? '—' : U.fmtPct(r.prob, r.prob < 0.01 ? 2 : 1)) + '</td><td class="neg">' + m(-r.k * risk) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="note">Assumes every trade is independent with the win rate you typed. Streak cost is the number of full-size losses (no fees or slippage).</p>';
    if (lim != null && !isNaN(lim) && lim > 0) { var k = K.lossesToLimit(lim, risk), pr = K.probLossRun(p / 100, n, k); h += '<div class="ui-banner">It takes <b>' + k + '</b> full losses in a row (' + m(k * risk) + ') to reach a ' + m(lim) + ' limit' + (pr != null ? '. Under these assumptions that happens at least once in ' + n + ' trades with chance ' + U.fmtPct(pr, pr < 0.01 ? 2 : 1) : '') + '.</div>'; }
    return h;
  }
  function seqResults() {
    var c = S.scen, risk = K.parseMoney(c.risk); if (c.seq.trim() === '') return ''; if (risk == null || isNaN(risk) || risk <= 0) return '<p class="note warnline">Enter a risk per trade above first.</p>';
    var parts = c.seq.split(',').map(function (x) { return x.trim(); }).filter(Boolean), rs = parts.map(Number); if (!rs.length || rs.some(function (x) { return !isFinite(x); }) || rs.length > 500) return '<p class="note warnline">Use numbers separated by commas (up to 500).</p>';
    var q = K.sequenceR(risk, rs); return '<div class="ui-grid">' + stat('Total', m(q.totalCents, true), U.plural(rs.length, 'trade'), U.cls(q.totalCents)) + stat('Deepest drawdown', m(q.maxDrawdownCents), 'from the running peak', q.maxDrawdownCents ? 'neg' : '') + '</div>';
  }
  function useMine() {
    var P = A.prepare(S.rows, {}, S.rows.some(function (r) { return r.c.isClosed && !r.c.feesMissing; }) ? 'net' : 'gross'), s = A.summary(P.inc);
    if (s.n < 5) { U.toast('Needs at least 5 closed trades in your journal.', true); return; }
    S.scen.win = (s.winRate * 100).toFixed(1).replace(/\.0$/, ''); if (s.payoff != null) S.scen.rr = s.payoff.toFixed(2); var rk = S.rows.filter(function (r) { return r.c.plannedRiskCents != null; }).map(function (r) { return r.c.plannedRiskCents; }); if (rk.length) S.scen.risk = String(Math.round(rk.reduce(function (a, b) { return a + b; }, 0) / rk.length / 100));
    U.toast('Filled from your ' + s.n + ' closed trades (' + s.sample + ').'); render();
  }

  /* ---------- history ---------- */
  function histHtml() {
    var acc = S.acct, rows = S.rows.filter(function (r) { return !acc || (r.t.accountId || 'acct-default') === acc; }), h0 = K.riskHistory(rows);
    var sel = S.accounts.length > 1 ? '<div class="panel"><label for="rk-hacct" style="margin-top:0">Account</label><select id="rk-hacct" data-hacct="1"><option value="">All accounts</option>' + S.accounts.map(function (a) { return '<option value="' + esc(a.id) + '"' + (acc === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select></div>' : '';
    if (!h0.trades) return sel + U.empty('No trades yet', 'Your risk history builds from the trades you log.');
    var h = sel + '<div class="ui-grid">' + stat('Average risk', m(h0.avgRiskCents), h0.withStop ? 'across ' + U.plural(h0.withStop, 'trade') + ' with a stop' : 'no stops entered') + stat('Median / max', m(h0.medianRiskCents), 'max ' + m(h0.maxRiskCents)) +
      stat('Risk consistency', h0.riskSpread == null ? '—' : U.fmtPct(h0.riskSpread, 0), 'spread vs average (lower = steadier)', '', 'Standard deviation of planned risk divided by its average. Needs 2+ trades with stops.') + stat('No stop entered', String(h0.noStop), 'of ' + h0.trades + ' trades', h0.noStop ? 'neg' : '') +
      stat('Losses beyond plan', h0.closedWithStop ? h0.lossesBeyondRisk + ' / ' + h0.closedWithStop : '—', 'lost more than planned risk', h0.lossesBeyondRisk ? 'neg' : '') + stat('Worst day', h0.worstDay ? m(h0.worstDay.cents, true) : '—', h0.worstDay ? h0.worstDay.date : '', h0.worstDay && h0.worstDay.cents < 0 ? 'neg' : '') +
      stat('Most trades in a day', h0.maxTradesInDay == null ? '—' : String(h0.maxTradesInDay), h0.avgTradesPerDay == null ? '' : 'average ' + h0.avgTradesPerDay.toFixed(1)) + stat('Losing days', String(h0.bigLossDays), 'of ' + U.plural(h0.tradingDays, 'day')) + '</div>';
    if (h0.noStop) h += '<div class="ui-banner warn">' + U.plural(h0.noStop, 'trade') + ' have no stop recorded, so their risk is unknown and left out of the averages.</div>';
    if (h0.lossesBeyondRisk) h += '<div class="ui-banner">' + U.plural(h0.lossesBeyondRisk, 'closed trade') + ' lost more than the risk at your initial stop (slippage, a moved or removed stop, or a data entry error). Worth reviewing in the Journal.</div>';
    return h + '<p class="note">Planned risk uses the initial stop you entered. Realized losses are compared on gross P&amp;L.</p>';
  }

  function render() {
    if (!S.loaded) { root.innerHTML = '<p class="note">Loading…</p>'; return; } if (S.err) { root.innerHTML = '<div class="ui-banner bad">' + esc(S.err) + '</div>'; return; }
    var body = S.tab === 'exposure' ? exposureHtml() : S.tab === 'limits' ? limitsHtml() : S.tab === 'scen' ? scenHtml() : S.tab === 'hist' ? histHtml() : calcHtml();
    var y = window.scrollY; root.innerHTML = '<div class="chips jtabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" class="chip' + (S.tab === t[0] ? ' on' : '') + '" data-act="rk-tab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' + body; window.scrollTo(0, y);
  }
  function live() { var o = document.getElementById('rkOut'); if (o) o.innerHTML = calcResults(); var so = document.getElementById('scOut'); if (so) so.innerHTML = scenResults(); var sq = document.getElementById('scSeq'); if (sq) sq.innerHTML = seqResults(); }
  root.addEventListener('input', function (e) {
    var id = e.target.id, M = { 'rk-entry': 'entry', 'rk-stop': 'stop', 'rk-target': 'target', 'rk-risk': 'risk', 'rk-fee': 'fee', 'rk-con': 'contracts' }, N = { 'sc-win': 'win', 'sc-rr': 'rr', 'sc-risk': 'risk', 'sc-n': 'n', 'sc-limit': 'limit', 'sc-seq': 'seq' };
    if (M[id]) { S.form[M[id]] = e.target.value; live(); } else if (N[id]) { S.scen[N[id]] = e.target.value; live(); }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'rk-inst') { S.form.instId = t.value; live(); } else if (t.getAttribute('data-acct')) { S.acct = t.value; render(); } else if (t.getAttribute('data-hacct')) { S.acct = t.value; render(); } else if (t.id === 'rk-lacct') { S.limAcct = t.value; S.limDraft = null; S.limErr = null; render(); }
  });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return; var a = b.getAttribute('data-act');
    if (a === 'rk-tab') { S.tab = b.getAttribute('data-t'); render(); window.scrollTo(0, 0); }
    else if (a === 'rk-usemax') { var l = S.limits[S.acct]; if (l && l.limits.maxRiskPerTradeCents) { S.form.risk = String(l.limits.maxRiskPerTradeCents / 100); render(); } }
    else if (a === 'rk-go-limits') { S.limAcct = b.getAttribute('data-id'); S.tab = 'limits'; render(); }
    else if (a === 'rk-save-limits') saveLimits(b.getAttribute('data-id'));
    else if (a === 'rk-clear-limits') { var id = b.getAttribute('data-id'); U.confirm('Remove all limits for this account?', 'Your trades are not affected.', 'REMOVE', true).then(function (y) { if (y) ST.remove('rl-' + id, 'risklimit').then(load).then(function () { S.limDraft = null; U.toast('Limits removed.'); render(); }); }); }
    else if (a === 'sc-mine') useMine();
  });
  function refresh() { return load().then(render); }
  window.addEventListener('tt:view', function (e) { if (e.detail.name === 'risk') refresh(); });
  window.addEventListener('tt:journal-changed', function () { if (S.loaded && document.getElementById('view-risk').classList.contains('active')) refresh(); });
  if (window.TTNav) window.TTNav.addHub({ id: 'risk', title: 'Risk center', text: 'Position size, reward : risk, your limits, open exposure and scenarios.', icon: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>' });
  window.TTRiskUI = { state: S, reload: refresh };
})();
