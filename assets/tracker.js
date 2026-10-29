/* Tamhas Trading - drawdown & evaluation tracker UI (renders inside each expanded account).
   Pure math lives in dd-core.js. Rules from the research templates are only HINTS here:
   nothing becomes an active financial rule until you type exact numbers and confirm them. */
(function () {
  'use strict';
  var D = window.TTDD, JC = window.TTJournalCore, DB = window.TTDB, AC = window.TTAccountsCore;
  if (!D || !JC || !DB) return;
  var ctx = null;
  var T = { help: {}, forms: {}, rf: {}, review: {}, showAll: {}, histOpen: {} };
  var BROWSER_TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'; } catch (e) { return 'America/Los_Angeles'; } })();
  var TZS = ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'America/Denver', 'UTC', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney'];

  var HELP = {
    buffer: 'Remaining buffer = current balance minus the drawdown threshold. It is how much more you can lose before the loss limit. At $0 or below, the account is at or past the limit.',
    threshold: 'The balance level your firm treats as the loss limit. A static threshold never moves. A trailing threshold rises with your high-water mark and (if your firm says so) stops rising at a set level.',
    hwm: 'High-water mark: the highest value your rule counts. End-of-day trailing uses the highest balance at the close of a finished trading day. Intraday trailing uses the highest value reached at any moment, which needs live equity data.',
    balance: 'Recorded balance = starting balance + your recorded closed-trade results, minus payouts and transfers out, plus deposits and transfers in. Fees paid to the firm are not part of the balance. Open trades are not included.',
    profit: 'Profit counts trading results only. Payouts, deposits and transfers move money but are never counted as profit or loss.',
    daily: 'Daily loss left = your daily loss limit + that trading day\'s net realized result. The trading day starts at the reset time and timezone you confirmed. Unrealized (open) results are not included.',
    days: 'A qualifying trading day is a trading day (by your reset time) with at least one closed trade, or with at least the minimum profit you configured.',
    consistency: 'Consistency compares your best single day with your total profit. The rule you confirm decides the maximum share one day may represent.',
    fees: 'Fees you paid to the firm (evaluation, activation, reset, data). They are tracked separately and do not change the account balance.',
    conf: 'Verified input = copied from your firm\'s dashboard and nothing newer recorded. User-entered = a number you typed with no later records. Estimated = calculated from your journal, so it is only as complete as your records. Unavailable = not enough data to calculate honestly.'
  };
  var HELP_LABEL = { buffer: 'remaining buffer', threshold: 'drawdown threshold', hwm: 'high-water mark', balance: 'recorded balance', profit: 'profit progress', daily: 'daily loss left', days: 'trading days', consistency: 'consistency', fees: 'fees paid', conf: 'confidence labels' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(c) { return c == null ? 'Unavailable' : D.fmt(c); }
  function moneyIn(c) { return c == null ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''); }
  function todayLocal() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dstr(ms) { return ms == null ? '—' : new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function $(s, r) { return (r || document).querySelector(s); }
  function confBadge(c) { return '<span class="t-conf c-' + c.replace(' ', '-') + '">' + esc(c.toUpperCase()) + '</span>'; }
  function helpBtn(aid, key) { var on = T.help[aid] === key; return '<button type="button" class="t-i" data-act="t-help" data-id="' + esc(aid) + '" data-key="' + key + '" aria-expanded="' + on + '" aria-label="What is ' + HELP_LABEL[key] + '?">i</button>'; }

  function ledgerFor(id) { return ctx.getLedger().filter(function (l) { return l.accountId === id; }); }
  function rowsFor(a) { return ctx.getRows().filter(function (r) { return (r.t.accountId || DB.DEFAULT_ACCOUNT_ID) === a.id; }); }
  function compute(a, ver, untilDay) { return D.evaluate(ver.settings, rowsFor(a), ledgerFor(a.id), { asOf: Date.now(), untilDay: untilDay || null }); }

  /* ---------- collapsed-card chip ---------- */
  function chip(a) {
    var ver = D.activeVersion(a.dd); if (!ver) return a.category === 'prop' ? '<span class="a-tag t-off">RULES NOT CONFIRMED</span>' : '';
    var r = compute(a, ver); if (!r.ok) return '<span class="a-tag t-off">CHECK RULES</span>';
    var b = r.buffer.cents;
    return '<span class="a-tag ' + (r.buffer.breached ? 'st-failed' : '') + '">BUFFER ' + (b == null ? 'UNAVAILABLE' : esc(D.fmt(b))) + '</span>';
  }

  /* ---------- summary ---------- */
  function meter(frac, cls) { var p = Math.max(0, Math.min(100, Math.round(frac * 100))); return '<div class="t-meter" role="img" aria-label="' + p + ' percent"><i class="' + cls + '" style="width:' + p + '%"></i></div>'; }
  function tile(aid, key, label, value, sub, conf, extra) {
    return '<div class="t-tile"><div class="t-tl">' + label + helpBtn(aid, key) + '</div><div class="t-tv">' + value + '</div>' + (extra || '') + '<div class="t-ts">' + (sub || '') + (conf ? ' ' + confBadge(conf) : '') + '</div></div>';
  }
  function summary(a, ver, r) {
    var s = r.settings, id = a.id, M = s.maxLossCents, h = '';
    if (r.breach || r.buffer.breached) h += '<div class="banner bad" role="alert"><b>At or past the loss limit.</b> The recorded balance is at or below the threshold' + (r.breach ? ' (first reached ' + esc(r.breach.day) + ')' : '') + '. Check your firm\'s dashboard for the official status.</div>';
    var fracBuf = r.buffer.cents == null ? 0 : (M ? r.buffer.cents / M : 0), cls = fracBuf > .5 ? 'ok' : fracBuf > .25 ? 'warn' : 'bad';
    h += '<div class="t-hero"><div class="t-tl">REMAINING BUFFER' + helpBtn(id, 'buffer') + '</div><div class="t-big ' + (r.buffer.cents == null ? 'none' : cls) + '">' + (r.buffer.cents == null ? 'Unavailable' : esc(D.fmt(r.buffer.cents))) + '</div>' +
      (r.buffer.cents != null ? meter(Math.min(1, Math.max(0, fracBuf)), cls) + '<div class="t-ts">of ' + esc(D.fmt(M)) + ' maximum loss · ' + confBadge(r.buffer.conf) + '</div>' :
        '<div class="t-ts">' + confBadge('unavailable') + (r.threshold.lowerBoundCents != null ? ' Estimate only: your threshold is at least ' + esc(D.fmt(r.threshold.lowerBoundCents)) + ', so your buffer is at most ' + esc(D.fmt(r.buffer.upperBoundCents)) + '. Enter the threshold your firm shows (Firm snapshot).' : '') + '</div>') + '</div>';
    h += '<div class="t-grid">';
    h += tile(id, 'balance', 'RECORDED BALANCE', esc(D.fmt(r.balance.cents)), 'start ' + esc(D.fmt(r.startingBalanceCents)), r.balance.conf);
    h += tile(id, 'threshold', 'DRAWDOWN THRESHOLD', esc(money(r.threshold.cents)), (r.threshold.source === 'manual' ? 'entered from your firm' + (r.threshold.asOf ? ' · ' + esc(dstr(r.threshold.asOf)) : '') : esc(D.MODEL_LABEL[s.model])), r.threshold.conf);
    if (r.progress.targetCents) h += tile(id, 'profit', 'PROFIT TARGET', esc(r.progress.pct + '%'), esc(D.fmt(r.progress.profitCents)) + ' of ' + esc(D.fmt(r.progress.targetCents)), 'estimated', meter(Math.min(1, r.progress.pct / 100), r.progress.reached ? 'ok' : 'cy'));
    else h += tile(id, 'profit', 'TRADING PROFIT', esc(D.fmt(r.progress.profitCents)), 'no target entered', 'estimated');
    if (s.dailyLossLimitCents != null) h += tile(id, 'daily', 'DAILY LOSS LEFT', esc(money(r.daily.remainingCents)), 'today ' + esc(D.fmt(r.daily.pnlCents)) + ' · limit ' + esc(D.fmt(s.dailyLossLimitCents)) + (r.daily.reached ? ' · REACHED' : ''), r.daily.conf);
    else h += tile(id, 'daily', 'DAILY LOSS LEFT', 'Unavailable', 'no daily limit entered', 'unavailable');
    if (r.tradingDays.required != null) h += tile(id, 'days', 'TRADING DAYS', esc(r.tradingDays.qualifying + ' / ' + r.tradingDays.required), r.tradingDays.met ? 'requirement met' : r.tradingDays.remaining + ' more needed', 'estimated');
    else h += tile(id, 'days', 'TRADING DAYS', esc(String(r.tradingDays.qualifying)), 'no minimum entered', 'estimated');
    h += tile(id, 'fees', 'FEES PAID', esc(money(r.fees.totalCents)), r.fees.count ? r.fees.count + ' record' + (r.fees.count === 1 ? '' : 's') : 'none recorded', null);
    h += '</div>';
    if (T.help[id]) h += '<div class="t-helptext" role="note"><b>' + esc(HELP_LABEL[T.help[id]]) + '.</b> ' + esc(HELP[T.help[id]]) + '</div>';
    var wr = r.warnings.concat(r.reasons);
    if (wr.length) h += '<div class="t-warns">' + wr.slice(0, 3).map(function (w) { return '<p class="note warnline">⚠ ' + esc(w) + '</p>'; }).join('') + (wr.length > 3 ? '<p class="note">+ ' + (wr.length - 3) + ' more in Advanced details.</p>' : '') + '</div>';
    h += '<p class="note">Last entry ' + esc(dstr(r.lastEntryAt)) + (r.lastSnapshotAt ? ' · last firm snapshot ' + esc(dstr(r.lastSnapshotAt)) : ' · no firm snapshot yet') + ' · ' + helpBtn(id, 'conf') + ' what the labels mean</p>';
    return h;
  }

  /* ---------- advanced details ---------- */
  function chart(r) {
    var pts = r.series; if (pts.length < 2) return '<p class="note">The chart appears after two trading days with closed trades.</p>';
    var W = 320, H = 130, pl = 8, pr = 8, pt = 10, pb = 18, vals = [r.startingBalanceCents];
    pts.forEach(function (p) { vals.push(p.endBalanceCents); if (p.thresholdCents != null) vals.push(p.thresholdCents); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals); if (hi === lo) { hi += 100; lo -= 100; }
    var x = function (i) { return pl + (W - pl - pr) * i / (pts.length - 1); }, y = function (v) { return pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo)); };
    var line = function (key, filter) { var seg = [], out = ''; pts.forEach(function (p, i) { var v = p[key]; if (v == null) { if (seg.length) { out += '<polyline points="' + seg.join(' ') + '" />'; seg = []; } return; } seg.push(x(i).toFixed(1) + ',' + y(v).toFixed(1)); }); if (seg.length) out += '<polyline points="' + seg.join(' ') + '" />'; return out; };
    return '<svg class="t-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="End-of-day balance (cyan) and drawdown threshold (amber) by trading day"><title>Balance and threshold by trading day</title>' +
      '<line class="g" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(r.startingBalanceCents).toFixed(1) + '" y2="' + y(r.startingBalanceCents).toFixed(1) + '"/>' +
      '<g class="bal">' + line('endBalanceCents') + '</g><g class="thr">' + line('thresholdCents') + '</g>' +
      '<text x="' + pl + '" y="' + (H - 4) + '">' + esc(pts[0].day) + '</text><text x="' + (W - pr) + '" y="' + (H - 4) + '" text-anchor="end">' + esc(pts[pts.length - 1].day) + '</text></svg>' +
      '<p class="note"><span class="lg c1"></span> end-of-day balance <span class="lg c2"></span> threshold (finished days) <span class="lg c3"></span> starting balance</p>';
  }
  function method(s, r) {
    var L = [], f = D.fmt, S0 = f(s.startingBalanceCents), M = f(s.maxLossCents);
    if (s.model === 'static') L.push('Threshold = starting balance − max loss = ' + S0 + ' − ' + M + ' = ' + f(s.startingBalanceCents - s.maxLossCents) + '. It never moves.');
    else if (s.model === 'eod-trailing') L.push('Threshold = min(highest end-of-day trading balance − ' + M + ', ' + (s.trailStopCents != null ? f(s.trailStopCents) : 'no stop level') + '). Today\'s trades only count once the trading day closes.');
    else if (s.basis === 'balance') L.push('Threshold = min(highest recorded balance after any trade − ' + M + ', ' + (s.trailStopCents != null ? f(s.trailStopCents) : 'no stop level') + '). Uses realized balance only.');
    else L.push('Threshold = min(highest intraday EQUITY − ' + M + ', ' + (s.trailStopCents != null ? f(s.trailStopCents) : 'no stop level') + '). Trades cannot show the intraday equity peak, so the figure must come from your firm.');
    L.push('Buffer = recorded balance − threshold. Balance = starting balance + closed-trade results ± payouts, deposits and transfers.');
    L.push('Trading day: starts at ' + s.resetTime + ' ' + s.resetTz + '. Trade times are read in ' + s.journalTz + '. Trades without a time use the date you entered.');
    L.push('Daily loss left = ' + (s.dailyLossLimitCents != null ? f(s.dailyLossLimitCents) : 'daily limit (not entered)') + ' + the trading day\'s net realized result.');
    L.push('Trades counted: ' + r.counts.closed + ' closed' + (r.counts.open ? ' (' + r.counts.open + ' open or partly closed are excluded)' : '') + '. Results use net of fees when fees were entered, otherwise gross.');
    return L;
  }
  function advanced(a, ver, r) {
    var s = r.settings, id = a.id, h = '<details class="t-adv"' + (T.showAll['adv:' + id] ? ' open' : '') + ' data-k="adv:' + esc(id) + '"><summary>Advanced details</summary><div class="t-advbody">';
    h += '<div class="t-grid">' + tile(id, 'hwm', 'HIGH-WATER MARK', esc(s.model === 'static' ? 'Not used' : money(r.hwm.cents)), s.model === 'static' ? 'static drawdown' : '', s.model === 'static' ? null : r.hwm.conf) +
      tile(id, 'balance', 'EQUITY', esc(money(r.equity.cents)), r.equity.cents == null ? 'enter it in a Firm snapshot' : (r.equity.stale ? 'older than your latest records' : esc(dstr(r.equity.at))), r.equity.conf) +
      tile(id, 'profit', 'TRADING BALANCE', esc(D.fmt(r.tradingBalanceCents)), 'excludes payouts, deposits and transfers', 'estimated') + tile(id, 'balance', 'NET CASH MOVED', esc(D.fmt(r.externalCashCents)), 'payouts, deposits, transfers', null) + '</div>';
    h += '<h4 class="t-h">Consistency</h4><p class="note">' + (s.consistencyPct == null ? 'No consistency rule entered.' : 'Rule: best day ≤ ' + esc(s.consistencyPct) + '% of total profit. Status: <b>' + esc(r.consistency.status) + '</b>' +
      (r.consistency.ratioPct != null ? '. Best day ' + esc(D.fmt(r.consistency.bestDayCents)) + ' (' + esc(r.consistency.bestDay) + ') is ' + esc(r.consistency.ratioPct) + '% of ' + esc(D.fmt(r.consistency.totalProfitCents)) + (r.consistency.additionalProfitCents > 0 ? '. About ' + esc(D.fmt(r.consistency.additionalProfitCents)) + ' more profit (without a bigger best day) would bring it within the limit.' : '.') : '.')) + ' ' + helpBtn(id, 'consistency') + '</p>';
    h += '<h4 class="t-h">Milestones</h4>' + (r.milestones.length ? '<ul class="t-list">' + r.milestones.map(function (m) { return '<li>' + esc(m.day) + ' · ' + esc(m.label) + '</li>'; }).join('') + '</ul>' : '<p class="note">None yet.</p>');
    h += '<h4 class="t-h">Progress by trading day</h4>' + chart(r);
    if (r.series.length) h += '<div class="t-tablewrap"><table class="t-table"><thead><tr><th>Day</th><th>Result</th><th>Balance</th><th>Threshold</th></tr></thead><tbody>' + r.series.slice(-10).reverse().map(function (p) {
      return '<tr><td>' + esc(p.day) + '</td><td class="' + (p.pnlCents > 0 ? 'pos' : p.pnlCents < 0 ? 'neg' : '') + '">' + esc(D.fmt(p.pnlCents)) + '</td><td>' + esc(D.fmt(p.endBalanceCents)) + '</td><td>' + (p.thresholdCents == null ? '—' : esc(D.fmt(p.thresholdCents))) + '</td></tr>'; }).join('') + '</tbody></table></div>' + (r.series.length > 10 ? '<p class="note">Latest 10 of ' + r.series.length + ' trading days.</p>' : '');
    if (r.reconciliation.length) h += '<h4 class="t-h">Reconciliation with your firm\'s balance</h4><ul class="t-list">' + r.reconciliation.map(function (x) { return '<li>' + esc(x.day) + ': journal ' + esc(D.fmt(x.journalCents)) + ', firm ' + esc(D.fmt(x.enteredCents)) + ', difference <b>' + esc(D.fmt(x.diffCents)) + '</b></li>'; }).join('') + '</ul>';
    var th = ledgerFor(id).filter(function (l) { return l.type === 'snapshot' && !l.voided && l.thresholdCents != null; }).sort(function (x, y) { return y.at - x.at; });
    if (th.length) h += '<h4 class="t-h">Threshold history (entered)</h4><ul class="t-list">' + th.map(function (l) { return '<li>' + esc(dstr(l.at)) + ': ' + esc(D.fmt(l.thresholdCents)) + ' · ' + (l.source === 'firm-dashboard' ? 'from firm dashboard' : 'my own figure') + (l.note ? ' · ' + esc(l.note) : '') + '</li>'; }).join('') + '</ul>';
    var wr = r.warnings.concat(r.reasons); if (wr.length > 3) h += '<h4 class="t-h">All notes</h4>' + wr.map(function (w) { return '<p class="note warnline">⚠ ' + esc(w) + '</p>'; }).join('');
    h += '<h4 class="t-h">How this is calculated</h4>' + method(s, r).map(function (l) { return '<p class="note">' + esc(l) + '</p>'; }).join('');
    return h + '</div></details>';
  }

  /* ---------- rules form / confirmation ---------- */
  var HINT_KEY = { maxLossCents: 'maxLossAmount', profitTargetCents: 'profitTarget', dailyLossLimitCents: 'dailyLossLimit', trailStopCents: 'drawdownStopsAt', minTradingDays: 'minTradingDays', consistencyPct: 'consistencyRule', model: 'drawdownMethod' };
  function hint(a, key) {
    var r = a.rules && a.rules[HINT_KEY[key]]; if (!r) return '';
    return '<p class="t-hint">Research note (<b>not</b> used in calculations): “' + esc(r.value) + '” · ' + (r.sourceType === 'official' ? 'official page' : r.sourceType === 'third-party' ? 'third-party, unconfirmed' : 'your entry') + (safeUrl(r.source) ? ' · <a href="' + esc(r.source) + '" target="_blank" rel="noopener noreferrer">source ↗</a>' : '') + '</p>';
  }
  function draftFor(a) {
    if (T.rf[a.id]) return T.rf[a.id];
    var ver = D.activeVersion(a.dd), s = ver ? ver.settings : null, d = a.dd && a.dd.draft;
    var src = d || (s ? { model: s.model, basis: s.basis, startingBalanceCents: moneyIn(s.startingBalanceCents), maxLossCents: moneyIn(s.maxLossCents), trailStopCents: moneyIn(s.trailStopCents), profitTargetCents: moneyIn(s.profitTargetCents), dailyLossLimitCents: moneyIn(s.dailyLossLimitCents),
      resetTime: s.resetTime, resetTz: s.resetTz, journalTz: s.journalTz, minTradingDays: s.minTradingDays == null ? '' : s.minTradingDays, qualifyMode: s.qualifyMode, qualifyMinProfitCents: moneyIn(s.qualifyMinProfitCents), consistencyPct: s.consistencyPct == null ? '' : s.consistencyPct, trackFrom: s.trackFrom || '' } : null);
    return (T.rf[a.id] = src || { model: '', basis: 'balance', startingBalanceCents: moneyIn(a.startingBalanceCents), maxLossCents: '', trailStopCents: '', profitTargetCents: '', dailyLossLimitCents: '', resetTime: '17:00', resetTz: 'America/Chicago', journalTz: BROWSER_TZ, minTradingDays: '', qualifyMode: 'any', qualifyMinProfitCents: '', consistencyPct: '', trackFrom: '' });
  }
  function readRules(a) {
    var d = draftFor(a), g = function (n) { var e = $('#tf-' + n); return e ? e.value : undefined; };
    ['model', 'basis', 'startingBalanceCents', 'maxLossCents', 'trailStopCents', 'profitTargetCents', 'dailyLossLimitCents', 'resetTime', 'resetTz', 'journalTz', 'minTradingDays', 'qualifyMinProfitCents', 'consistencyPct', 'trackFrom'].forEach(function (k) { var v = g(k); if (v !== undefined) d[k] = v; });
    var q = $('input[name="tf-qualify"]:checked'); if (q) d.qualifyMode = q.value; return d;
  }
  function fld(label, id, inner, help) { return '<div class="field"><label for="' + id + '">' + label + '</label>' + inner + (help || '') + '</div>'; }
  function rulesForm(a) {
    var d = draftFor(a), errs = (T.forms[a.id] && T.forms[a.id].errors) || [], trailing = d.model && d.model !== 'static';
    var sel = function (k, opts, cur) { return '<select id="tf-' + k + '"' + (k === 'model' ? ' data-act="t-model" data-id="' + esc(a.id) + '"' : '') + '>' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
    var m = function (k, ph) { return '<div class="input-wrap"><span class="prefix">$</span><input id="tf-' + k + '" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="' + (ph || '') + '" value="' + esc(d[k]) + '"></div>'; };
    var h = '<div class="t-form"><h3 class="a-h">Drawdown & evaluation rules</h3><p class="note">Type the exact numbers from your firm\'s rules for <b>this</b> account. Research notes are shown only as hints. Nothing is calculated until you confirm.</p>';
    if (errs.length) h += '<div class="banner bad" role="alert">' + errs.map(esc).join('<br>') + '</div>';
    h += fld('Drawdown model', 'tf-model', sel('model', [['', 'Choose…'], ['static', 'Static (threshold never moves)'], ['eod-trailing', 'End-of-day trailing'], ['intraday-trailing', 'Intraday trailing']], d.model), hint(a, 'model'));
    if (trailing) h += fld('Based on', 'tf-basis', sel('basis', [['balance', 'Balance (realized)'], ['equity', 'Equity (includes open P&L)']], d.basis), d.model === 'intraday-trailing' && d.basis === 'equity' ? '<p class="t-hint">Equity-based intraday trailing cannot be calculated from trades. You will enter the threshold your firm shows in a Firm snapshot.</p>' : '');
    h += fld('Starting balance', 'tf-startingBalanceCents', m('startingBalanceCents', 'e.g. 50000')) + fld('Maximum loss (drawdown amount)', 'tf-maxLossCents', m('maxLossCents', 'e.g. 2000'), hint(a, 'maxLossCents'));
    if (trailing) h += fld('Trailing stops at (threshold level, optional)', 'tf-trailStopCents', m('trailStopCents', 'blank = never stops'), '<p class="t-hint">The balance level where your threshold stops rising (for example your starting balance). Leave blank only if your firm says it keeps trailing.</p>' + hint(a, 'trailStopCents'));
    h += fld('Profit target (optional)', 'tf-profitTargetCents', m('profitTargetCents', 'e.g. 3000'), hint(a, 'profitTargetCents')) + fld('Daily loss limit (optional)', 'tf-dailyLossLimitCents', m('dailyLossLimitCents', 'e.g. 1000'), hint(a, 'dailyLossLimitCents'));
    h += '<div class="t-two">' + fld('Daily reset time', 'tf-resetTime', '<input id="tf-resetTime" type="text" inputmode="numeric" placeholder="17:00" value="' + esc(d.resetTime) + '" autocomplete="off">') +
      fld('Reset timezone', 'tf-resetTz', '<input id="tf-resetTz" type="text" list="tf-tzs" value="' + esc(d.resetTz) + '" autocomplete="off">') + '</div>' +
      fld('Timezone your trade times are entered in', 'tf-journalTz', '<input id="tf-journalTz" type="text" list="tf-tzs" value="' + esc(d.journalTz) + '" autocomplete="off">', '<p class="t-hint">Used to decide which trading day each trade belongs to, including daylight saving changes.</p>') +
      '<datalist id="tf-tzs">' + TZS.map(function (z) { return '<option value="' + z + '">'; }).join('') + '</datalist>';
    h += fld('Minimum trading days (optional)', 'tf-minTradingDays', '<input id="tf-minTradingDays" type="text" inputmode="numeric" placeholder="e.g. 5" value="' + esc(d.minTradingDays) + '" autocomplete="off">', hint(a, 'minTradingDays'));
    h += '<div class="field"><label id="tf-q-l">A day counts when</label><div class="seg" role="radiogroup" aria-labelledby="tf-q-l"><label class="seg-i"><input type="radio" name="tf-qualify" value="any"' + (d.qualifyMode !== 'min-profit' ? ' checked' : '') + '><span>ANY CLOSED TRADE</span></label><label class="seg-i"><input type="radio" name="tf-qualify" value="min-profit"' + (d.qualifyMode === 'min-profit' ? ' checked' : '') + '><span>MIN PROFIT</span></label></div></div>';
    if (d.qualifyMode === 'min-profit') h += fld('Minimum profit for a qualifying day', 'tf-qualifyMinProfitCents', m('qualifyMinProfitCents', 'e.g. 200'));
    h += fld('Consistency rule: best day may be at most … % of total profit (optional)', 'tf-consistencyPct', '<input id="tf-consistencyPct" type="text" inputmode="decimal" placeholder="e.g. 40" value="' + esc(d.consistencyPct) + '" autocomplete="off">', hint(a, 'consistencyPct'));
    h += fld('Start tracking from (optional date)', 'tf-trackFrom', '<input id="tf-trackFrom" type="date" value="' + esc(d.trackFrom) + '">', '<p class="t-hint">Use this when a new stage starts (for example a funded account). Earlier trades stay in your journal but are not counted here.</p>');
    return h + '<div class="row2"><button type="button" class="btn" data-act="t-review" data-id="' + esc(a.id) + '">REVIEW &amp; CONFIRM</button><button type="button" class="btn" data-act="t-rules-cancel" data-id="' + esc(a.id) + '">CANCEL</button></div></div>';
  }
  var LBL = { model: 'Model', basis: 'Based on', startingBalanceCents: 'Starting balance', maxLossCents: 'Maximum loss', trailStopCents: 'Trailing stops at', profitTargetCents: 'Profit target', dailyLossLimitCents: 'Daily loss limit', resetTime: 'Reset time', resetTz: 'Reset timezone', journalTz: 'Trade-time timezone', minTradingDays: 'Minimum trading days', qualifyMode: 'A day counts when', qualifyMinProfitCents: 'Minimum day profit', consistencyPct: 'Consistency (best day ≤ % of profit)', trackFrom: 'Tracking from' };
  function showVal(k, v) {
    if (v == null || v === '') return 'not set';
    if (/Cents$/.test(k)) return D.fmt(v);
    if (k === 'model') return D.MODEL_LABEL[v] || v; if (k === 'qualifyMode') return v === 'any' ? 'any day with a closed trade' : 'day profit at least the minimum';
    if (k === 'consistencyPct') return v + '%'; return String(v);
  }
  function reviewPanel(a, clean) {
    var cur = D.activeVersion(a.dd), rv = T.review[a.id] || {}, ch = cur ? D.diffSettings(cur.settings, clean) : [], rule = a.rules && (a.rules.maxLossAmount || a.rules.drawdownMethod || a.rules.profitTarget);
    var h = '<div class="t-form t-review"><h3 class="a-h">Confirm these rules</h3><p class="note">Check every number against your firm\'s own current rules page for this exact product. Only then activate.</p><dl class="t-dl">';
    Object.keys(LBL).forEach(function (k) { if (k === 'basis' && clean.model === 'static') return; if (k === 'trailStopCents' && clean.model === 'static') return; if (k === 'qualifyMinProfitCents' && clean.qualifyMode !== 'min-profit') return; h += '<dt>' + esc(LBL[k]) + '</dt><dd>' + esc(showVal(k, clean[k])) + '</dd>'; });
    h += '</dl>';
    if (cur) h += '<div class="banner info"><b>Changes from version ' + cur.n + '</b> (confirmed ' + esc(new Date(cur.confirmedAt).toLocaleDateString()) + ', checked ' + esc(cur.verifiedOn) + '):<br>' + (ch.length ? ch.map(function (c) { return esc(LBL[c.field] || c.field) + ': ' + esc(showVal(c.field, c.from)) + ' → ' + esc(showVal(c.field, c.to)); }).join('<br>') : 'none') + '<br>All figures are recalculated from your saved records. Version ' + cur.n + ' stays in the history.</div>';
    if (a.template) h += '<p class="note">Template research date: ' + esc(a.template.researchedOn) + '. Research values are unconfirmed until you confirm them here.</p>';
    var firstSrc = rule && safeUrl(rule.source) ? rule.source : '';
    h += fld('Where did you check these rules? (link or short description)', 'tf-source', '<input id="tf-source" type="text" maxlength="300" value="' + esc(rv.source != null ? rv.source : (cur ? cur.source : firstSrc)) + '" autocomplete="off">') +
      fld('Date you checked them', 'tf-verifiedOn', '<input id="tf-verifiedOn" type="date" value="' + esc(rv.verifiedOn || '') + '" max="' + todayLocal() + '">') +
      fld('Note (optional)', 'tf-vnote', '<input id="tf-vnote" type="text" maxlength="300" value="' + esc(rv.note || '') + '" autocomplete="off">') +
      '<label class="a-chk"><input type="checkbox" id="tf-confirm"> I confirm these numbers match my firm\'s current rules for this account.</label>';
    if (T.review[a.id] && T.review[a.id].errors) h += '<div class="banner bad" role="alert">' + T.review[a.id].errors.map(esc).join('<br>') + '</div>';
    return h + '<div class="row2"><button type="button" class="btn" data-act="t-activate" data-id="' + esc(a.id) + '">ACTIVATE RULES</button><button type="button" class="btn" data-act="t-back" data-id="' + esc(a.id) + '">BACK TO EDIT</button></div></div>';
  }
  function versionList(a) {
    var vs = (a.dd && a.dd.versions) || []; if (!vs.length) return '';
    return '<details class="t-adv"' + (T.showAll['ver:' + a.id] ? ' open' : '') + ' data-k="ver:' + esc(a.id) + '"><summary>Rule version history (' + vs.length + ')</summary><div class="t-advbody">' + vs.slice().reverse().map(function (v) {
      var res = '', w = v.retired ? D.versionWindow(a.dd, v.n) : null;
      if (v.retired) { var r = compute(a, v, w && w.untilDay); if (r.ok) res = '<p class="note">Result when it ended: balance ' + esc(D.fmt(r.balance.cents)) + ', buffer ' + esc(money(r.buffer.cents)) + ' (' + esc(r.buffer.conf) + ').</p>'; }
      return '<div class="t-ver"><b>Version ' + v.n + '</b> ' + (v.retired ? '<span class="a-tag">RETIRED</span>' : '<span class="a-tag st-funded">ACTIVE</span>') + '<p class="note">Confirmed ' + esc(new Date(v.confirmedAt).toLocaleString()) + ' · rules checked ' + esc(v.verifiedOn) + ' · source: ' + (safeUrl(v.source) ? '<a href="' + esc(v.source) + '" target="_blank" rel="noopener noreferrer">' + esc(v.source) + ' ↗</a>' : esc(v.source)) + '</p>' +
        (v.changes && v.changes.length ? '<p class="note">' + v.changes.map(function (c) { return esc(LBL[c.field] || c.field) + ': ' + esc(showVal(c.field, c.from)) + ' → ' + esc(showVal(c.field, c.to)); }).join('<br>') + '</p>' : '') + (v.note ? '<p class="note">' + esc(v.note) + '</p>' : '') + res + '</div>'; }).join('') + '</div></details>';
  }

  /* ---------- ledger forms and list ---------- */
  var KIND_LABEL = { snapshot: 'FIRM SNAPSHOT', fee: 'FEE', payout: 'PAYOUT', deposit: 'DEPOSIT', transfer: 'TRANSFER' };
  function ledgerForm(a, kind) {
    var id = a.id, f = (T.forms[id] && T.forms[id].draft) || {}, errs = (T.forms[id] && T.forms[id].errors) || [], inp = function (k, label, ph, type, extra) { return fld(label, 'lf-' + k, '<input id="lf-' + k + '" type="' + (type || 'text') + '"' + (type === 'date' ? ' max="' + todayLocal() + '"' : '') + ' ' + (extra || '') + ' placeholder="' + (ph || '') + '" value="' + esc(f[k] != null ? f[k] : '') + '" autocomplete="off">'); };
    var money$ = function (k, label, ph, help) { return fld(label, 'lf-' + k, '<div class="input-wrap"><span class="prefix">$</span><input id="lf-' + k + '" class="money" type="text" inputmode="decimal" placeholder="' + (ph || '') + '" value="' + esc(f[k] != null ? f[k] : '') + '" autocomplete="off"></div>', help || ''); };
    var h = '<div class="t-form"><h3 class="a-h">' + KIND_LABEL[kind] + '</h3>' + (errs.length ? '<div class="banner bad" role="alert">' + errs.map(esc).join('<br>') + '</div>' : '');
    h += '<div class="t-two">' + inp('date', 'Date', '', 'date') + inp('time', 'Time (optional)', '14:30', 'text', 'inputmode="numeric"') + '</div>';
    if (kind === 'snapshot') {
      h += '<p class="note">Copy the figures your firm\'s own dashboard shows right now. Fill only what you can see. This is the only way to get an exact intraday trailing threshold.</p>' + money$('balance', 'Account balance', 'blank if not shown') + money$('equity', 'Equity (balance + open P&L)', 'blank if not shown') + money$('threshold', 'Drawdown threshold shown by the firm', 'blank if not shown') + money$('hwm', 'High-water mark / peak shown by the firm', 'blank if not shown') +
        fld('Where did these come from?', 'lf-source', '<select id="lf-source"><option value="firm-dashboard"' + (f.source !== 'my-own' ? ' selected' : '') + '>Copied from my firm\'s dashboard</option><option value="my-own"' + (f.source === 'my-own' ? ' selected' : '') + '>My own figure</option></select>');
    } else if (kind === 'fee') {
      h += fld('Fee type', 'lf-feeKind', '<select id="lf-feeKind">' + D.FEE_KINDS.map(function (k) { return '<option value="' + k + '"' + (f.feeKind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select>') + money$('amount', 'Amount paid', 'e.g. 150', '<p class="t-hint">Fees are tracked separately. They do not change the account balance.</p>');
    } else if (kind === 'transfer') {
      var others = ctx.getAccounts().filter(function (x) { return x.id !== id; });
      h += '<div class="field"><label id="lf-dir-l">Direction</label><div class="seg" role="radiogroup" aria-labelledby="lf-dir-l"><label class="seg-i"><input type="radio" name="lf-dir" value="out"' + (f.dir !== 'in' ? ' checked' : '') + '><span>SEND OUT</span></label><label class="seg-i"><input type="radio" name="lf-dir" value="in"' + (f.dir === 'in' ? ' checked' : '') + '><span>RECEIVE</span></label></div></div>' +
        fld('Other account', 'lf-other', '<select id="lf-other">' + others.map(function (x) { return '<option value="' + esc(x.id) + '"' + (f.other === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>') + money$('amount', 'Amount', 'e.g. 500', '<p class="t-hint">Writes matching records to both accounts. Transfers move money and are never counted as profit or loss.</p>');
    } else h += money$('amount', kind === 'payout' ? 'Amount withdrawn' : 'Amount added', 'e.g. 1000', '<p class="t-hint">' + (kind === 'payout' ? 'Reduces the balance. Not a trading loss. The high-water mark is not lowered; if your firm treats payouts differently, enter a Firm snapshot.' : 'Raises the balance. Not trading profit.') + '</p>');
    h += inp('ref', 'Reference (optional)', 'receipt / payout id', 'text', 'maxlength="80"') + inp('note', 'Note (optional)', '', 'text', 'maxlength="200"');
    return h + '<div class="row2"><button type="button" class="btn" data-act="t-ledger-save" data-id="' + esc(id) + '" data-kind="' + kind + '">SAVE</button><button type="button" class="btn" data-act="t-form-cancel" data-id="' + esc(id) + '">CANCEL</button></div></div>';
  }
  function ledgerList(a) {
    var list = ledgerFor(a.id).slice().sort(function (x, y) { return y.at - x.at; }); if (!list.length) return '';
    var label = { fee: 'Fee', payout: 'Payout', deposit: 'Deposit', 'transfer-in': 'Transfer in', 'transfer-out': 'Transfer out', snapshot: 'Firm snapshot' };
    return '<details class="t-adv"' + (T.showAll['rec:' + a.id] ? ' open' : '') + ' data-k="rec:' + esc(a.id) + '"><summary>Records: fees, payouts, transfers, snapshots (' + list.length + ')</summary><div class="t-advbody">' + list.map(function (l) {
      var amt = l.type === 'snapshot' ? ['balance ' + (l.balanceCents != null ? D.fmt(l.balanceCents) : '—'), l.thresholdCents != null ? 'threshold ' + D.fmt(l.thresholdCents) : '', l.hwmCents != null ? 'peak ' + D.fmt(l.hwmCents) : '', l.equityCents != null ? 'equity ' + D.fmt(l.equityCents) : ''].filter(Boolean).join(' · ') : D.fmt(l.amountCents) + (l.feeKind ? ' · ' + l.feeKind : '');
      return '<div class="t-rec' + (l.voided ? ' void' : '') + '"><div><b>' + esc(label[l.type] || l.type) + '</b> · ' + esc(dstr(l.at)) + '<div class="note">' + esc(amt) + (l.note ? ' · ' + esc(l.note) : '') + (l.ref ? ' · ref ' + esc(l.ref) : '') + (l.voided ? ' · VOIDED' : '') + '</div></div>' +
        '<button type="button" class="linkbtn" data-act="t-void" data-id="' + esc(l.id) + '" data-acct="' + esc(a.id) + '">' + (l.voided ? 'Restore' : 'Void') + '</button></div>'; }).join('') + '<p class="note">Voiding keeps the record but removes it from calculations. Nothing is deleted.</p></div></details>';
  }

  /* ---------- main entry ---------- */
  function html(a) {
    var id = a.id, ver = D.activeVersion(a.dd), form = T.forms[id], h = '<div class="t-wrap"><h3 class="a-h">Drawdown &amp; evaluation tracker</h3>';
    if (form && form.mode === 'rules') {
      var d = form.step === 'review' ? form.clean : null;
      return h + '</div>' + (form.step === 'review' ? reviewPanel(a, d) : rulesForm(a));
    }
    if (!ver) {
      h += '<div class="t-empty"><p class="note" style="margin-top:0"><b>Not active.</b> Drawdown and evaluation figures need exact rules that you confirm. Research notes from the firm directory are never used as active rules.</p><button type="button" class="btn wide" data-act="t-rules-open" data-id="' + esc(id) + '">SET UP &amp; CONFIRM RULES</button></div>';
    } else {
      var r = compute(a, ver);
      if (!r.ok) h += '<div class="banner bad">The saved rules can no longer be read: ' + esc(r.errors.join(' ')) + ' Edit the rules to fix them.</div>';
      else h += '<p class="note" style="margin-top:0">' + esc(D.MODEL_LABEL[r.settings.model]) + (r.settings.model !== 'static' ? ' · ' + esc(r.settings.basis) + '-based' : '') + ' · rules version ' + ver.n + ', checked ' + esc(ver.verifiedOn) + '</p>' + summary(a, ver, r) + advanced(a, ver, r);
      h += '<div class="row2"><button type="button" class="btn small" data-act="t-rules-open" data-id="' + esc(id) + '">EDIT RULES</button></div>' + versionList(a);
    }
    h += '<div class="t-addrow" role="group" aria-label="Add a record">';
    ['snapshot', 'fee', 'payout', 'deposit'].forEach(function (k) { h += '<button type="button" class="btn small" data-act="t-form-open" data-id="' + esc(id) + '" data-kind="' + k + '">+ ' + KIND_LABEL[k] + '</button>'; });
    if (ctx.getAccounts().length > 1) h += '<button type="button" class="btn small" data-act="t-form-open" data-id="' + esc(id) + '" data-kind="transfer">+ TRANSFER</button>';
    h += '</div>';
    if (form && form.mode === 'ledger') h += ledgerForm(a, form.kind);
    return h + ledgerList(a) + '</div>';
  }

  /* ---------- actions ---------- */
  function acct(id) { return ctx.getAccounts().filter(function (x) { return x.id === id; })[0]; }
  function readLedgerDraft() {
    var g = function (n) { var e = $('#lf-' + n); return e ? e.value : ''; }, f = {};
    ['date', 'time', 'amount', 'balance', 'equity', 'threshold', 'hwm', 'ref', 'note', 'source', 'feeKind', 'other'].forEach(function (k) { f[k] = g(k); });
    var d = $('input[name="lf-dir"]:checked'); f.dir = d ? d.value : 'out'; return f;
  }
  function journalTz(a) { var v = D.activeVersion(a.dd); return v ? v.settings.journalTz : BROWSER_TZ; }
  function saveLedger(id, kind) {
    var a = acct(id), f = readLedgerDraft(); T.forms[id] = { mode: 'ledger', kind: kind, draft: f, errors: [] };
    var recs = [], tid = kind === 'transfer' ? 'tr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : null;
    var make = function (type, accountId) { return D.validateLedger({ type: type, accountId: accountId, date: f.date, time: f.time, amount: f.amount, feeKind: f.feeKind, balance: f.balance, equity: f.equity, threshold: f.threshold, hwm: f.hwm, source: f.source, note: f.note, ref: f.ref, transferId: tid }, { journalTz: journalTz(a) }); };
    var first = make(kind === 'transfer' ? (f.dir === 'in' ? 'transfer-in' : 'transfer-out') : kind, id);
    if (!first.ok) { T.forms[id].errors = first.errors; ctx.rerender(); return; }
    recs.push(first.record);
    if (kind === 'transfer') {
      if (!f.other) { T.forms[id].errors = ['Choose the other account.']; ctx.rerender(); return; }
      var second = make(f.dir === 'in' ? 'transfer-out' : 'transfer-in', f.other); if (!second.ok) { T.forms[id].errors = second.errors; ctx.rerender(); return; } recs.push(second.record);
    }
    var dup = D.findDuplicate(ctx.getLedger(), recs[0]);
    if (dup && !window.confirm('A matching record already exists (same date, amount and reference). Add it again anyway?')) return;
    var now = Date.now(), ops = recs.map(function (r, i) { r.id = 'lg-' + now.toString(36) + i + Math.random().toString(36).slice(2, 6); r.createdAt = now; r.voided = false; return { store: 'ledger', type: 'put', value: r }; });
    ops.push({ store: 'audit', type: 'put', value: { id: DB.uid('au'), at: now, type: 'ledger-add', details: { kind: kind, accountId: id, ids: recs.map(function (r) { return r.id; }) } } });
    DB.batch(ops).then(function () { recs.forEach(function (r) { ctx.getLedger().push(r); }); delete T.forms[id]; ctx.toast('Saved.'); ctx.rerender(); window.dispatchEvent(new Event('tt:ledger-changed')); })
      .catch(function () { T.forms[id].errors = ['Could not save (browser storage blocked or full). Nothing was changed.']; ctx.rerender(); });
  }
  function voidRecord(recId, acctId) {
    var rec = ctx.getLedger().filter(function (l) { return l.id === recId; })[0]; if (!rec) return;
    var nv = Object.assign({}, rec, { voided: !rec.voided, voidedAt: rec.voided ? null : Date.now() });
    DB.batch([{ store: 'ledger', type: 'put', value: nv }, { store: 'audit', type: 'put', value: { id: DB.uid('au'), at: Date.now(), type: nv.voided ? 'ledger-void' : 'ledger-restore', details: { id: recId, accountId: acctId } } }]).then(function () {
      var i = ctx.getLedger().indexOf(rec); ctx.getLedger()[i] = nv; ctx.toast(nv.voided ? 'Record voided. It is kept but no longer counted.' : 'Record restored.'); ctx.rerender();
    }).catch(function () { ctx.toast('Could not update the record.', true); });
  }
  function review(id) {
    var a = acct(id), d = readRules(a), v = D.validateSettings(d);
    if (!v.ok) { T.forms[id] = { mode: 'rules', step: 'edit', errors: v.errors }; ctx.rerender(); return; }
    T.forms[id] = { mode: 'rules', step: 'review', clean: v.clean }; T.review[id] = T.review[id] || {};
    ctx.save(Object.assign({}, a, { dd: Object.assign({}, a.dd, { draft: d }) })).then(function () { ctx.rerender(); });
  }
  function activate(id) {
    var a = acct(id), form = T.forms[id]; if (!form || !form.clean) return;
    var meta = { confirmed: !!($('#tf-confirm') || {}).checked, verifiedOn: ($('#tf-verifiedOn') || {}).value, source: ($('#tf-source') || {}).value, note: ($('#tf-vnote') || {}).value };
    T.review[id] = { source: meta.source, verifiedOn: meta.verifiedOn, note: meta.note };
    var r = D.confirmVersion(a.dd, form.clean, meta, Date.now());
    if (!r.ok) { T.review[id].errors = r.errors; ctx.rerender(); return; }
    var next = Object.assign({}, a, { dd: r.dd });
    ctx.save(next).then(function (ok) {
      if (!ok) return;
      DB.audit('rules-confirmed', { accountId: id, version: r.version ? r.version.n : null, unchanged: !!r.unchanged });
      delete T.forms[id]; delete T.review[id]; delete T.rf[id]; ctx.toast(r.unchanged ? 'Rules unchanged.' : 'Rules activated (version ' + r.version.n + ').'); ctx.rerender();
    });
  }

  function click(el) {
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    switch (act) {
      case 't-help': T.help[id] = T.help[id] === el.getAttribute('data-key') ? null : el.getAttribute('data-key'); ctx.rerender(); return true;
      case 't-rules-open': T.rf[id] = null; T.forms[id] = { mode: 'rules', step: 'edit', errors: [] }; ctx.rerender(); return true;
      case 't-rules-cancel': delete T.forms[id]; T.rf[id] = null; ctx.rerender(); return true;
      case 't-review': review(id); return true;
      case 't-back': T.forms[id] = { mode: 'rules', step: 'edit', errors: [] }; ctx.rerender(); return true;
      case 't-activate': activate(id); return true;
      case 't-form-open': T.forms[id] = { mode: 'ledger', kind: el.getAttribute('data-kind'), draft: { date: todayLocal(), source: 'firm-dashboard' }, errors: [] }; ctx.rerender(); return true;
      case 't-form-cancel': delete T.forms[id]; ctx.rerender(); return true;
      case 't-ledger-save': saveLedger(id, el.getAttribute('data-kind')); return true;
      case 't-void': voidRecord(id, el.getAttribute('data-acct')); return true;
    }
    return false;
  }
  function change(el) {
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    if (act === 't-model') { var a = acct(id); readRules(a); ctx.rerender(); return true; }
    if (el.name === 'tf-qualify') { var b = ctx.getOpenAccount(); if (b) { readRules(b); ctx.rerender(); } return true; }
    if (el.id === 'tf-basis') { var c = ctx.getOpenAccount(); if (c) { readRules(c); ctx.rerender(); } return true; }
    return false;
  }
  document.addEventListener('toggle', function (ev) { var d = ev.target; if (d && d.classList && d.classList.contains('t-adv') && d.getAttribute('data-k')) T.showAll[d.getAttribute('data-k')] = d.open; }, true);

  window.TTTracker = { init: function (c) { ctx = c; }, html: html, chip: chip, click: click, change: change, _state: T };
})();
