/* Tamhas Trading - drawdown & evaluation engine (pure logic: no DOM, no storage, no network).
   All money is whole cents. Nothing here assumes a firm's formula: every number comes from rules YOU confirmed.

   EXACT FORMULAS (S = starting balance, M = max loss, B = balance, P = "trading balance" = B minus net external cash,
   i.e. S + realized trading P&L, never counting payouts/deposits/transfers; Stop = optional threshold ceiling)
     static            T = S - M
     eod-trailing      HWM = max(S, P at the close of every COMPLETED trading day);  T = min(HWM - M, Stop)
                       (today's trades do not move T until that trading day closes)
     intraday-trailing (balance basis)  HWM = max(S, P after every recorded trade);  T = min(HWM - M, Stop)
     intraday-trailing (equity basis)   needs the real intraday EQUITY peak. Trades alone cannot give it, so T is
                       UNAVAILABLE unless you enter the firm's threshold (or peak equity). A realized-only estimate is
                       shown only as a labelled lower bound.
     remaining buffer  = B - T            breach flag when B <= T
     profit            = P - S            progress = profit / profit target
     daily loss left   = DailyLimit + (that trading day's net realized trading P&L)
     trading day       = calendar date in the reset timezone of (instant + (1440 - resetMinutes) minutes)
   A firm-entered threshold REPLACES the computed one for the static model and acts as a FLOOR for trailing models. */
(function (root) {
  'use strict';
  var S = root.TTSessions || (typeof require !== 'undefined' ? require('./sessions.js') : null);
  var MODELS = ['static', 'eod-trailing', 'intraday-trailing'], BASES = ['balance', 'equity'];
  var MODEL_LABEL = { 'static': 'Static', 'eod-trailing': 'End-of-day trailing', 'intraday-trailing': 'Intraday trailing' };
  var CONF = ['verified input', 'user-entered', 'estimated', 'unavailable'];
  var FEE_KINDS = ['evaluation', 'activation', 'reset', 'data', 'platform', 'other'];
  var LEDGER_TYPES = ['fee', 'payout', 'deposit', 'transfer-in', 'transfer-out', 'snapshot'];
  var SIGN = { payout: -1, deposit: 1, 'transfer-in': 1, 'transfer-out': -1 };

  function worst(a, b) { return CONF[Math.max(CONF.indexOf(a), CONF.indexOf(b))]; }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function isHM(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function hmMin(s) { return +s.slice(0, 2) * 60 + +s.slice(3); }
  function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length > 0; } catch (e) { return false; } }
  function fmt(c) { if (c == null) return 'unavailable'; var a = Math.abs(c), s = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(a % 100).padStart(2, '0'); return (c < 0 ? '-$' : '$') + s; }

  // Strict dollars -> cents. Accepts "$1,234.56", "1234", "0.5". Rejects blanks, letters, 3+ decimals, negatives (unless allowed), absurd sizes.
  function parseMoney(x, o) {
    o = o || {}; if (x == null) return null; var t = String(x).trim().replace(/[$,\s]/g, ''); if (t === '') return null;
    if (!/^-?\d+(\.\d{1,2})?$/.test(t) && !/^-?\.\d{1,2}$/.test(t)) return null;
    var n = Number(t); if (!isFinite(n) || Math.abs(n) > 1e9) return null;
    if (n < 0 && !o.allowNegative) return null; if (n === 0 && !o.allowZero) return null;
    return Math.round(n * 100);
  }

  /* ---------- time ---------- */
  var dtfCache = {};
  function civilDate(ms, tz) {
    var f = dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
    var o = {}; f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day;
  }
  function tradingDay(ms, resetMin, tz) { return civilDate(ms + ((1440 - resetMin) % 1440) * 60000, tz); }
  function wall(date, hm, tz) { var d = date.split('-'); return S.wallToInstant(+d[0], +d[1], +d[2], +hm.slice(0, 2), +hm.slice(3), tz); }

  /* ---------- settings ---------- */
  function validateSettings(i) {
    i = i || {}; var e = [], c = {};
    c.model = MODELS.indexOf(i.model) >= 0 ? i.model : (e.push('Choose a drawdown model.'), null);
    c.basis = BASES.indexOf(i.basis) >= 0 ? i.basis : (c.model === 'static' ? 'balance' : (e.push('Choose balance-based or equity-based.'), null));
    function money(k, label, req, o) {
      var v = i[k];
      if (v == null || v === '') { if (req) e.push(label + ' is required.'); c[k] = null; return; }
      if (typeof v === 'number') { if (!Number.isInteger(v) || (v <= 0 && !(o && o.allowZero))) { e.push(label + ' must be a positive dollar amount.'); c[k] = null; return; } c[k] = v; return; }
      var p = parseMoney(v, o); if (p == null) e.push(label + ' must be a positive dollar amount (e.g. 2500 or 2,500.50).'); c[k] = p;
    }
    money('startingBalanceCents', 'Starting balance', true); money('maxLossCents', 'Maximum loss', true);
    money('trailStopCents', 'Trailing stop level', false); money('profitTargetCents', 'Profit target', false); money('dailyLossLimitCents', 'Daily loss limit', false);
    money('qualifyMinProfitCents', 'Minimum profit for a qualifying day', false);
    if (c.model === 'static') c.trailStopCents = null;
    if (c.startingBalanceCents && c.maxLossCents && c.maxLossCents >= c.startingBalanceCents) e.push('Maximum loss must be smaller than the starting balance.');
    if (c.trailStopCents != null && c.startingBalanceCents && c.maxLossCents && c.trailStopCents < c.startingBalanceCents - c.maxLossCents) e.push('The trailing stop level cannot be below the starting threshold (' + fmt(c.startingBalanceCents - c.maxLossCents) + ').');
    c.resetTime = isHM(i.resetTime) ? i.resetTime : (i.resetTime == null || i.resetTime === '' ? '00:00' : (e.push('Daily reset time must look like 17:00.'), null));
    c.resetTz = validTz(i.resetTz) ? i.resetTz : (i.resetTz == null || i.resetTz === '' ? 'America/Chicago' : (e.push('Daily reset timezone is not a valid timezone name.'), null));
    c.journalTz = validTz(i.journalTz) ? i.journalTz : (i.journalTz == null || i.journalTz === '' ? 'America/Los_Angeles' : (e.push('Journal timezone is not a valid timezone name.'), null));
    if (i.minTradingDays == null || i.minTradingDays === '') c.minTradingDays = null;
    else { var n = Number(i.minTradingDays); if (!Number.isInteger(n) || n < 1 || n > 365) e.push('Minimum trading days must be a whole number from 1 to 365.'); c.minTradingDays = Number.isInteger(n) && n >= 1 && n <= 365 ? n : null; }
    c.qualifyMode = i.qualifyMode === 'min-profit' ? 'min-profit' : 'any';
    if (c.qualifyMode === 'min-profit' && c.qualifyMinProfitCents == null) e.push('Enter the minimum profit a day needs to count, or choose "any day with a closed trade".');
    if (c.qualifyMode === 'any') c.qualifyMinProfitCents = null;
    if (i.consistencyPct == null || i.consistencyPct === '') c.consistencyPct = null;
    else { var p2 = Number(i.consistencyPct); if (!(p2 > 0 && p2 <= 100) || !isFinite(p2)) e.push('Consistency percentage must be above 0 and at most 100.'); c.consistencyPct = p2 > 0 && p2 <= 100 ? p2 : null; }
    c.trackFrom = i.trackFrom == null || i.trackFrom === '' ? null : (isDate(i.trackFrom) ? i.trackFrom : (e.push('Start-tracking date must be a real date.'), null));
    return { ok: e.length === 0, errors: e, clean: c };
  }

  /* ---------- ledger records (fees, payouts, deposits, transfers, firm snapshots) ---------- */
  // form: {type, accountId, date, time, amount, feeKind, balance, equity, threshold, hwm, source, note, ref, transferId}
  function validateLedger(f, ctx) {
    f = f || {}; ctx = ctx || {}; var e = [], r = {}, tz = ctx.journalTz || 'America/Los_Angeles', now = ctx.now == null ? Date.now() : ctx.now;
    if (LEDGER_TYPES.indexOf(f.type) < 0) e.push('Choose a record type.'); r.type = f.type;
    if (!f.accountId) e.push('Choose an account.'); r.accountId = f.accountId;
    var date = f.date, time = f.time || '';
    if (!isDate(date)) e.push('Enter a real date.');
    if (time && !isHM(time)) e.push('Time must look like 14:30.');
    var at = null;
    if (isDate(date)) {
      // No time given: a record dated TODAY means "right now" (so it sorts after what you entered earlier today); older dates use end of day for snapshots and noon for money records.
      if (time && isHM(time)) at = wall(date, time, tz);
      else if (date === civilDate(now, tz)) at = now;
      else at = wall(date, f.type === 'snapshot' ? '23:59' : '12:00', tz);
      if (at > now + 36 * 3600000) e.push('That date is in the future.');
    }
    r.at = at; r.date = isDate(date) ? date : null;
    if (f.type === 'snapshot') {
      var any = false;
      [['balance', 'balanceCents', 'Balance', false], ['equity', 'equityCents', 'Equity', false], ['threshold', 'thresholdCents', 'Drawdown threshold', false], ['hwm', 'hwmCents', 'High-water mark', false]].forEach(function (k) {
        var raw = f[k[0]]; if (raw == null || String(raw).trim() === '') { r[k[1]] = null; return; }
        var p = parseMoney(raw, { allowZero: true }); if (p == null) e.push(k[2] + ' must be a dollar amount.'); else { r[k[1]] = p; any = true; }
      });
      if (!any && !e.length) e.push('Enter at least one value from the firm: balance, equity, threshold or high-water mark.');
      r.source = f.source === 'firm-dashboard' ? 'firm-dashboard' : 'my-own';
    } else if (LEDGER_TYPES.indexOf(f.type) >= 0) {
      var amt = parseMoney(f.amount); if (amt == null) e.push('Amount must be a positive dollar amount.'); r.amountCents = amt;
      if (f.type === 'fee') r.feeKind = FEE_KINDS.indexOf(f.feeKind) >= 0 ? f.feeKind : (e.push('Choose a fee type.'), null);
    }
    r.note = String(f.note || '').trim().slice(0, 200); r.ref = String(f.ref || '').trim().slice(0, 80);
    if (f.transferId) r.transferId = String(f.transferId).slice(0, 60);
    return { ok: e.length === 0, errors: e, record: r };
  }
  function dupKey(r) { return [r.accountId, r.type, r.date || r.at, r.amountCents == null ? '' : r.amountCents, r.feeKind || '', r.ref || '', r.balanceCents == null ? '' : r.balanceCents, r.thresholdCents == null ? '' : r.thresholdCents].join('|'); }
  function findDuplicate(list, rec) { var k = dupKey(rec); return list.filter(function (x) { return !x.voided && x.accountId === rec.accountId && dupKey(x) === k; })[0] || null; }
  function usable(l) { return l && !l.voided && LEDGER_TYPES.indexOf(l.type) >= 0 && typeof l.at === 'number' && isFinite(l.at); }

  /* ---------- the engine ---------- */
  function sumFees(ledger) {
    var by = {}, total = 0, n = 0;
    ledger.forEach(function (l) { if (usable(l) && l.type === 'fee' && Number.isInteger(l.amountCents) && l.amountCents > 0) { by[l.feeKind || 'other'] = (by[l.feeKind || 'other'] || 0) + l.amountCents; total += l.amountCents; n++; } });
    return { totalCents: n ? total : null, byKind: by, count: n };
  }

  // rows: analyzed trades [{t:{id,date,time,createdAt}, c:{isClosed,status,grossCents,netCents,feesMissing}}] for ONE account.
  function evaluate(settingsIn, rows, ledger, opts) {
    opts = opts || {}; ledger = ledger || [];
    var asOf = opts.asOf == null ? Date.now() : opts.asOf;
    var v = validateSettings(settingsIn); if (!v.ok) return { ok: false, errors: v.errors };
    var s = v.clean, M = s.maxLossCents, start = s.startingBalanceCents, resetMin = hmMin(s.resetTime);
    var dayOf = function (ms) { return tradingDay(ms, resetMin, s.resetTz); }, asOfDay = dayOf(asOf), until = opts.untilDay || null;
    var complete = function (d) { return d < asOfDay || (until != null && d <= until); };
    var warnings = [], reasons = [], counts = { trades: 0, closed: 0, open: 0, feesMissing: 0, excludedBeforeStart: 0, futureSkipped: 0, invalidSkipped: 0, noTime: 0 };
    var ev = [];

    (rows || []).forEach(function (r) {
      if (!r || !r.t || !r.c) { counts.invalidSkipped++; return; }
      var t = r.t, c = r.c; counts.trades++;
      if (!c.isClosed) { counts.open++; return; }
      counts.closed++;
      var pnl = c.netCents != null ? c.netCents : c.grossCents;
      if (!Number.isInteger(pnl)) { counts.invalidSkipped++; return; }
      if (c.feesMissing) counts.feesMissing++;
      var inst = null, day = t.date;
      if (isDate(t.date) && isHM(t.time || '')) { inst = wall(t.date, t.time, s.journalTz); day = dayOf(inst); } else if (!isDate(t.date)) { counts.invalidSkipped++; return; } else counts.noTime++;
      ev.push({ k: 'trade', day: day, inst: inst, pnl: pnl, id: t.id, c: t.createdAt || 0 });
    });
    ledger.forEach(function (l) {
      if (!usable(l)) return;
      if (l.type === 'fee') return;
      var day = dayOf(l.at);
      if (l.type === 'snapshot') ev.push({ k: 'snap', day: day, inst: l.at, rec: l, c: l.createdAt || l.at, id: l.id });
      else if (Number.isInteger(l.amountCents) && l.amountCents > 0) ev.push({ k: 'cash', day: day, inst: l.at, amt: SIGN[l.type] * l.amountCents, type: l.type, c: l.createdAt || l.at, id: l.id });
      else counts.invalidSkipped++;
    });
    ev = ev.filter(function (e) {
      if (s.trackFrom && e.day < s.trackFrom) { counts.excludedBeforeStart++; return false; }
      if (until && e.day > until) return false;
      if (e.day > asOfDay) { counts.futureSkipped++; return false; }
      return true;
    });
    ev.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : ((a.inst == null ? Infinity : a.inst) - (b.inst == null ? Infinity : b.inst)) || (a.c - b.c) || (String(a.id) < String(b.id) ? -1 : 1); });
    // days with >=2 trades where some have no time: the order of wins/losses inside the day is unknown
    var perDay = {}, uncertain = {};
    ev.forEach(function (e) { if (e.k === 'trade') { var p = perDay[e.day] || (perDay[e.day] = { n: 0, untimed: 0 }); p.n++; if (e.inst == null) p.untimed++; } });
    Object.keys(perDay).forEach(function (d) { if (perDay[d].n >= 2 && perDay[d].untimed > 0) uncertain[d] = 1; });

    var bal = start, offset = 0, hwmEod = start, hwmIntra = start, snapHwm = null, peakPerf = start, peakAfterSnap = null;
    var override = null, balSnap = null, hwmSnap = null, evCount = 0, equity = null, recon = [], breach = null, days = [], cur = null, lastEntry = 0, lastTradeDay = null, lastSnapAt = null;
    function stopped(x) { return s.trailStopCents != null ? Math.min(x, s.trailStopCents) : x; }
    function thr() {
      var raw = null, kind = 'computed';
      if (s.model === 'static') raw = start - M;
      else if (s.model === 'eod-trailing') raw = stopped(hwmEod - M);
      else if (s.basis === 'balance') raw = stopped(hwmIntra - M);
      else if (snapHwm != null) raw = stopped(Math.max(snapHwm, peakAfterSnap == null ? snapHwm : peakAfterSnap) - M);
      if (override) {
        if (s.model === 'static' || raw == null || override.value >= raw) return { value: override.value, kind: 'manual' };
      }
      return { value: raw, kind: kind };
    }
    function checkBreach(e) { var T = thr().value; if (T != null && !breach && bal <= T) breach = { day: e.day, at: e.inst, balanceCents: bal, thresholdCents: T }; }
    function closeDay() {
      if (!cur) return;
      if (complete(cur.day)) { hwmEod = Math.max(hwmEod, bal - offset); cur.completed = true; } else cur.completed = false;
      cur.endBalance = bal; cur.endPerf = bal - offset; cur.thresholdEnd = thr().value; days.push(cur); cur = null;
    }
    ev.forEach(function (e) {
      if (!cur || cur.day !== e.day) { closeDay(); cur = { day: e.day, pnl: 0, trades: 0, startBalance: bal }; }
      if (e.k === 'trade') {
        bal += e.pnl; cur.pnl += e.pnl; cur.trades++; evCount++; peakPerf = Math.max(peakPerf, bal - offset);
        if (s.basis === 'balance') hwmIntra = Math.max(hwmIntra, bal - offset);
        if (peakAfterSnap != null) peakAfterSnap = Math.max(peakAfterSnap, bal - offset);
        lastTradeDay = e.day; lastEntry = Math.max(lastEntry, e.c, e.inst != null ? e.inst : Date.parse(e.day + 'T12:00:00Z')); checkBreach(e);
      } else if (e.k === 'cash') {
        bal += e.amt; offset += e.amt; evCount++; lastEntry = Math.max(lastEntry, e.c); checkBreach(e);
      } else {
        var r = e.rec; lastSnapAt = Math.max(lastSnapAt || 0, r.at); lastEntry = Math.max(lastEntry, e.c);
        if (r.balanceCents != null) { recon.push({ at: r.at, day: e.day, journalCents: bal, enteredCents: r.balanceCents, diffCents: r.balanceCents - bal }); bal = r.balanceCents; offset = 0; balSnap = { source: r.source, idx: evCount, at: r.at }; peakPerf = Math.max(peakPerf, bal); if (s.basis === 'balance') hwmIntra = Math.max(hwmIntra, bal); }
        if (r.hwmCents != null) { hwmSnap = { source: r.source, idx: evCount }; snapHwm = r.hwmCents; hwmEod = r.hwmCents; hwmIntra = r.hwmCents; peakAfterSnap = bal - offset; }
        if (r.thresholdCents != null) override = { value: r.thresholdCents, source: r.source, idx: evCount, at: r.at };
        if (r.equityCents != null) equity = { cents: r.equityCents, at: r.at, source: r.source, idx: evCount };
        checkBreach(e);
      }
    });
    closeDay();

    // ----- results -----
    var T = thr(), perf = bal - offset, lowerBound = null;
    if (T.value == null && s.model === 'intraday-trailing' && s.basis === 'equity') {
      lowerBound = stopped(peakPerf - M);
      reasons.push('Intraday equity trailing needs the real intraday equity peak, which completed trades cannot show. Enter the threshold shown by your firm.');
    }
    var hasEvents = evCount > 0;
    var balConf = balSnap && evCount === balSnap.idx ? (balSnap.source === 'firm-dashboard' ? 'verified input' : 'user-entered') : (hasEvents ? 'estimated' : 'user-entered');
    var thrConf;
    if (T.value == null) thrConf = 'unavailable';
    else if (T.kind === 'manual') thrConf = evCount === override.idx ? (override.source === 'firm-dashboard' ? 'verified input' : 'user-entered') : 'estimated';
    else if (hwmSnap && snapHwm != null && s.model !== 'static' && evCount === hwmSnap.idx) thrConf = hwmSnap.source === 'firm-dashboard' ? 'verified input' : 'user-entered';
    else thrConf = hasEvents ? 'estimated' : 'user-entered';
    var buffer = T.value == null ? null : bal - T.value, bufConf = T.value == null ? 'unavailable' : worst(balConf, thrConf);
    var hwmVal = s.model === 'static' ? null : s.model === 'eod-trailing' ? hwmEod : (s.basis === 'balance' ? hwmIntra : snapHwm);
    var hwmConf = hwmVal == null ? 'unavailable' : (snapHwm != null && hwmVal === snapHwm && evCount === 0) ? 'user-entered' : (hasEvents ? 'estimated' : 'user-entered');

    var today = days.filter(function (d) { return d.day === asOfDay; })[0] || null;
    var dayPnl = today ? today.pnl : 0, daily = { dayKey: asOfDay, pnlCents: dayPnl, limitCents: s.dailyLossLimitCents, remainingCents: null, reached: false, conf: 'unavailable', trades: today ? today.trades : 0 };
    if (s.dailyLossLimitCents != null) {
      daily.remainingCents = s.dailyLossLimitCents + dayPnl; daily.reached = daily.remainingCents <= 0;
      daily.conf = counts.open || counts.noTime ? 'estimated' : (hasEvents ? 'estimated' : 'user-entered');
      if (counts.open) reasons.push(counts.open + ' open/partly closed trade(s) are not counted in balance or daily loss. Unrealized losses are not included.');
    }

    var profit = perf - start, target = s.profitTargetCents;
    var progress = { profitCents: profit, targetCents: target, pct: target ? Math.max(0, Math.round(profit * 10000 / target) / 100) : null, remainingCents: target ? Math.max(0, target - profit) : null, reached: target ? profit >= target : false };

    var qualifying = 0, bestDay = null, tradingTotal = 0;
    days.forEach(function (d) {
      if (d.trades > 0) { tradingTotal += d.pnl; if (bestDay == null || d.pnl > bestDay.pnl) bestDay = d; }
      if (d.trades > 0 && (s.qualifyMode === 'any' || d.pnl >= s.qualifyMinProfitCents)) qualifying++;
    });
    var tdays = { qualifying: qualifying, required: s.minTradingDays, remaining: s.minTradingDays == null ? null : Math.max(0, s.minTradingDays - qualifying), met: s.minTradingDays == null ? null : qualifying >= s.minTradingDays };
    var cons = { pct: s.consistencyPct, status: 'not configured', bestDayCents: bestDay ? bestDay.pnl : null, bestDay: bestDay ? bestDay.day : null, totalProfitCents: tradingTotal, ratioPct: null, neededTotalProfitCents: null, additionalProfitCents: null };
    if (s.consistencyPct != null) {
      if (!bestDay || tradingTotal <= 0 || bestDay.pnl <= 0) cons.status = 'not applicable yet (no net profit)';
      else {
        cons.ratioPct = Math.round(bestDay.pnl * 10000 / tradingTotal) / 100;
        var ok = bestDay.pnl * 100 <= s.consistencyPct * tradingTotal; cons.status = ok ? 'within limit' : 'over limit';
        cons.neededTotalProfitCents = Math.ceil(bestDay.pnl * 100 / s.consistencyPct); cons.additionalProfitCents = ok ? 0 : cons.neededTotalProfitCents - tradingTotal;
      }
    }

    var series = days.map(function (d) { return { day: d.day, pnlCents: d.pnl, trades: d.trades, endBalanceCents: d.endBalance, profitCents: d.endPerf - start, thresholdCents: d.completed ? d.thresholdEnd : null, completed: d.completed }; });
    var ms = [], mark = function (label, day) { ms.push({ label: label, day: day }); };
    if (series.length) mark('First recorded trading day', series[0].day);
    if (target) [25, 50, 75, 100].forEach(function (p) { var hit = series.filter(function (x) { return x.profitCents * 100 >= p * target; })[0]; if (hit) mark(p + '% of profit target', hit.day); });
    if (s.minTradingDays != null) { var q = 0; for (var i = 0; i < days.length; i++) { if (days[i].trades > 0 && (s.qualifyMode === 'any' || days[i].pnl >= s.qualifyMinProfitCents)) q++; if (q === s.minTradingDays) { mark('Minimum trading days reached', days[i].day); break; } } }
    if (breach) mark('Balance at or below threshold', breach.day);

    var staleBase = Math.max(lastEntry || 0, lastSnapAt || 0);
    if (!hasEvents && !balSnap && !override && !counts.open) reasons.push('No trades or records yet. Figures come only from your confirmed rules.');
    if (staleBase && asOf - staleBase > 3 * 86400000) warnings.push('No new trades or records were entered in the last 3 days. Check these figures against your firm before relying on them.');
    if (counts.feesMissing) warnings.push(counts.feesMissing + ' closed trade(s) have no fees entered, so the balance is before those fees and may be too high.');
    if (counts.noTime) warnings.push(counts.noTime + ' trade(s) have no entry time. Their trading day is the date you entered, and the order within a day is unknown.');
    if (Object.keys(uncertain).length) warnings.push('On ' + Object.keys(uncertain).length + ' day(s) several trades have no time, so win/loss order is unknown. Intraday breach checks there are uncertain.');
    if (counts.excludedBeforeStart) warnings.push(counts.excludedBeforeStart + ' earlier record(s) before the start-tracking date are not counted.');
    if (counts.futureSkipped) warnings.push(counts.futureSkipped + ' record(s) dated after today were ignored.');
    if (counts.invalidSkipped) warnings.push(counts.invalidSkipped + ' record(s) could not be read and were skipped.');
    if (s.basis === 'equity' && s.model !== 'intraday-trailing') reasons.push('Equity basis: assumes you were flat (no open profit or loss) at each daily close.');
    if (recon.some(function (r) { return r.diffCents !== 0; })) warnings.push('Your journal balance differed from a balance you entered. The entered balance was used from that moment (see Reconciliation).');
    if (breach) warnings.push('Recorded balance reached or crossed the threshold on ' + breach.day + '.');

    return { ok: true, settings: s, asOf: asOf, asOfDay: asOfDay,
      startingBalanceCents: start,
      balance: { cents: bal, conf: balConf },
      equity: equity ? { cents: equity.cents, at: equity.at, conf: equity.idx === evCount ? (equity.source === 'firm-dashboard' ? 'verified input' : 'user-entered') : 'estimated', stale: equity.idx !== evCount } : { cents: null, at: null, conf: 'unavailable' },
      hwm: { cents: hwmVal, conf: hwmConf },
      threshold: { cents: T.value, conf: thrConf, source: T.kind, asOf: T.kind === 'manual' ? override.at : null, lowerBoundCents: lowerBound },
      buffer: { cents: buffer, conf: bufConf, upperBoundCents: lowerBound != null ? bal - lowerBound : null, breached: buffer != null ? buffer <= 0 : null },
      tradingBalanceCents: perf, externalCashCents: offset,
      progress: progress, daily: daily, tradingDays: tdays, consistency: cons, fees: sumFees(ledger),
      breach: breach, series: series, milestones: ms, reconciliation: recon, counts: counts, warnings: warnings, reasons: reasons,
      lastEntryAt: lastEntry || null, lastSnapshotAt: lastSnapAt, lastTradeDay: lastTradeDay,
      confidence: worst(balConf, bufConf === 'unavailable' ? 'unavailable' : bufConf) };
  }

  /* ---------- rule versions ---------- */
  function normalizeDd(dd) { dd = dd && typeof dd === 'object' ? dd : {}; return { draft: dd.draft && typeof dd.draft === 'object' ? dd.draft : null, versions: Array.isArray(dd.versions) ? dd.versions : [] }; }
  function activeVersion(dd) { var v = normalizeDd(dd).versions; for (var i = v.length - 1; i >= 0; i--) if (!v[i].retired) return v[i]; return null; }
  function sameSettings(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function diffSettings(a, b) {
    var keys = {}, out = []; Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) { if ((a || {})[k] !== (b || {})[k]) out.push({ field: k, from: (a || {})[k] == null ? null : a[k], to: (b || {})[k] == null ? null : b[k] }); }); return out;
  }
  // Creates a new CONFIRMED version. Requires explicit confirmation, a real verification date (not in the future) and valid numbers.
  function confirmVersion(dd, settingsIn, meta, now) {
    meta = meta || {}; now = now == null ? Date.now() : now; dd = normalizeDd(dd);
    var v = validateSettings(settingsIn); if (!v.ok) return { ok: false, errors: v.errors };
    var errs = [];
    if (meta.confirmed !== true) errs.push('Tick the box to confirm these numbers match your firm.');
    if (!isDate(meta.verifiedOn)) errs.push('Enter the date you last checked these rules.'); else if (Date.parse(meta.verifiedOn + 'T00:00:00Z') > now + 36 * 3600000) errs.push('The verification date cannot be in the future.');
    var src = String(meta.source || '').trim(); if (src && !/^https?:\/\//i.test(src)) src = src.slice(0, 200);
    if (!src) errs.push('Add where you checked these rules (a link or a short description).');
    if (errs.length) return { ok: false, errors: errs };
    var cur = activeVersion(dd);
    if (cur && sameSettings(cur.settings, v.clean)) return { ok: true, dd: dd, unchanged: true };
    var versions = dd.versions.map(function (x) { return x === cur ? Object.assign({}, x, { retired: true, retiredAt: now }) : x; });
    var nv = { n: dd.versions.length + 1, settings: v.clean, confirmedAt: now, verifiedOn: meta.verifiedOn, source: src.slice(0, 300), note: String(meta.note || '').slice(0, 300), retired: false, changes: cur ? diffSettings(cur.settings, v.clean) : [] };
    return { ok: true, dd: { draft: null, versions: versions.concat([nv]) }, version: nv };
  }
  // The window a retired version applied to: up to the day before its replacement starts tracking (or its confirmation day).
  function versionWindow(dd, n, resetTz) {
    var vs = normalizeDd(dd).versions, i = vs.findIndex(function (x) { return x.n === n; }); if (i < 0 || !vs[i + 1]) return null;
    var nx = vs[i + 1], day = nx.settings.trackFrom;
    if (!day) { day = civilDate(nx.confirmedAt, resetTz || vs[i].settings.resetTz); return { untilDay: day }; }
    return { untilDay: civilDate(Date.parse(day + 'T12:00:00Z') - 86400000, 'UTC') };
  }

  var api = { MODELS: MODELS, BASES: BASES, MODEL_LABEL: MODEL_LABEL, CONF: CONF, FEE_KINDS: FEE_KINDS, LEDGER_TYPES: LEDGER_TYPES,
    parseMoney: parseMoney, validateSettings: validateSettings, validateLedger: validateLedger, findDuplicate: findDuplicate, dupKey: dupKey, evaluate: evaluate,
    tradingDay: tradingDay, civilDate: civilDate, sumFees: sumFees, normalizeDd: normalizeDd, activeVersion: activeVersion, confirmVersion: confirmVersion,
    diffSettings: diffSettings, versionWindow: versionWindow, fmt: fmt, isDate: isDate, isHM: isHM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTDD = api;
})(typeof window !== 'undefined' ? window : globalThis);
