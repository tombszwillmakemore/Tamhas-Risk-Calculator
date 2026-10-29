/* Tamhas Trading - journal core: validation, P&L, statistics, calendar, CSV, backup.
   Pure functions, no DOM. Every number is derived from trades the user recorded.
   Missing data is kept as null (never silently turned into 0) and is reported alongside results. */
(function (root) {
  var INST = root.TTInstruments || (typeof require !== 'undefined' ? require('./instruments.js') : null);
  var SESSIONS = ['Asia', 'London', 'New York'];
  var LIMITS = { strategy: 60, reason: 500, long: 1000, maxContracts: 500 };

  /* ---------- parsing helpers ---------- */
  function str(v) { return v == null ? '' : String(v); }
  function clip(v, n) { return str(v).replace(/\r\n?/g, '\n').trim().slice(0, n); }
  function isBlank(v) { return v == null || str(v).trim() === ''; }
  function num(v) {                       // strict decimal; returns NaN when not a clean number
    var s = str(v).replace(/[$,\s]/g, '');
    return /^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s) ? parseFloat(s) : NaN;
  }
  function decimals(v) { var s = str(v).replace(/[$,\s]/g, ''), i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function validHM(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function genId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function triState(v) {
    if (v === true || v === false) return v;
    var s = str(v).trim().toLowerCase();
    if (s === 'yes' || s === 'true' || s === 'y') return true;
    if (s === 'no' || s === 'false' || s === 'n') return false;
    return null;                           // unknown / not recorded
  }

  /* ---------- trade validation ---------- */
  function normalizeTrade(raw) {
    var e = [];
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Not a trade.'] };
    var t = {};
    t.id = /^[A-Za-z0-9_-]{1,40}$/.test(str(raw.id)) ? str(raw.id) : genId();
    t.createdAt = typeof raw.createdAt === 'number' && isFinite(raw.createdAt) ? raw.createdAt : Date.now();

    t.date = str(raw.date).trim();
    if (!validDate(t.date)) e.push('Enter a valid trade date.');
    t.time = isBlank(raw.time) ? '' : str(raw.time).trim();
    if (t.time && !validHM(t.time)) e.push('Time must look like 09:30.');

    t.contract = str(raw.contract).trim();
    if (!Object.prototype.hasOwnProperty.call(INST.byId, t.contract)) e.push('Choose a contract.');   // own keys only ('constructor' etc. are not contracts)
    t.side = str(raw.side).trim().toLowerCase();
    if (t.side !== 'long' && t.side !== 'short') e.push('Choose long or short.');

    t.session = isBlank(raw.session) ? '' : str(raw.session).trim();
    if (t.session && SESSIONS.indexOf(t.session) < 0) e.push('Session must be Asia, London or New York.');
    t.strategy = clip(raw.strategy, LIMITS.strategy);

    var q = num(raw.contracts);
    if (!(Number.isInteger(q) && q >= 1 && q <= LIMITS.maxContracts)) e.push('Contracts must be a whole number from 1 to ' + LIMITS.maxContracts + '.');
    t.contracts = q;

    var entry = num(raw.entry);
    if (!(entry > 0) || decimals(raw.entry) > 2) e.push('Entry price must be a positive number (max 2 decimals).');
    t.entry = entry;

    if (isBlank(raw.stop)) t.stop = null;
    else {
      var stop = num(raw.stop);
      if (!(stop > 0) || decimals(raw.stop) > 2) e.push('Stop price must be a positive number (max 2 decimals), or left blank.');
      else if (stop === entry) e.push('Stop cannot equal entry.');
      else if (t.side === 'long' && stop > entry) e.push('For a long, the stop belongs below entry.');
      else if (t.side === 'short' && stop < entry) e.push('For a short, the stop belongs above entry.');
      t.stop = stop;
    }

    t.exits = []; var sum = 0, exits = Array.isArray(raw.exits) ? raw.exits : [];
    exits.forEach(function (x, i) {
      if (!x || (isBlank(x.qty) && isBlank(x.price))) return;       // empty row: ignore
      var xq = num(x.qty), xp = num(x.price);
      if (!(Number.isInteger(xq) && xq >= 1)) { e.push('Exit ' + (i + 1) + ': quantity must be a whole number of 1 or more.'); return; }
      if (!(xp > 0) || decimals(x.price) > 2) { e.push('Exit ' + (i + 1) + ': price must be a positive number (max 2 decimals).'); return; }
      sum += xq; t.exits.push({ qty: xq, price: xp });
    });
    if (Number.isInteger(q) && sum > q) e.push('Exit quantities (' + sum + ') add up to more than the position (' + q + ').');

    if (isBlank(raw.fees) && raw.feesCents == null) t.feesCents = null;
    else if (raw.feesCents != null && isBlank(raw.fees)) {
      var fc = num(raw.feesCents);
      if (!(Number.isInteger(fc) && fc >= 0)) { e.push('Fees must be zero or more.'); t.feesCents = null; } else t.feesCents = fc;
    } else {
      var f = num(raw.fees);
      if (!(f >= 0) || decimals(raw.fees) > 2 || f > 100000) { e.push('Fees must be zero or more (max 2 decimals).'); t.feesCents = null; }
      else t.feesCents = Math.round(f * 100);
    }

    t.entryReason = clip(raw.entryReason, LIMITS.reason);
    t.exitReason = clip(raw.exitReason, LIMITS.reason);
    t.followedRules = triState(raw.followedRules);
    t.mistakes = clip(raw.mistakes, LIMITS.long);
    t.lessons = clip(raw.lessons, LIMITS.long);
    t.notes = clip(raw.notes, LIMITS.long);
    if (isBlank(raw.rating)) t.rating = null;
    else { var r = num(raw.rating); if (Number.isInteger(r) && r >= 1 && r <= 5) t.rating = r; else { t.rating = null; e.push('Rating must be 1 to 5.'); } }

    t.accountId = (typeof raw.accountId === 'string' && raw.accountId.trim()) ? raw.accountId.trim().slice(0, 64) : 'acct-default';

    return e.length ? { ok: false, errors: e } : { ok: true, trade: t };
  }

  /* ---------- per-trade results ---------- */
  // Returns realized figures. Money is whole cents. null = not known / not applicable (never 0).
  function compute(t) {
    var cpp = INST.byId[t.contract].centsPerPoint, dir = t.side === 'long' ? 1 : -1;
    var exited = 0, hundredths = 0, notional = 0;
    t.exits.forEach(function (x) {
      exited += x.qty; notional += x.price * x.qty;
      hundredths += dir * Math.round((x.price - t.entry) * 100) * x.qty;   // integer, avoids float drift
    });
    var status = exited === 0 ? 'open' : exited < t.contracts ? 'partial' : 'closed';
    var gross = exited ? Math.round(hundredths * cpp / 100) : null;         // realized gross on exited contracts
    var feesKnown = t.feesCents != null;
    var closed = status === 'closed';
    // Net needs BOTH a closed trade and recorded fees. Missing fees are unknown, not zero, so net stays null.
    var net = closed && feesKnown ? gross - t.feesCents : null;
    var risk = t.stop != null ? Math.round(Math.abs(t.entry - t.stop) * 100 * cpp * t.contracts / 100) : null;
    var R = closed && risk ? Math.round((gross / risk) * 100) / 100 : null;     // realized R uses gross (before fees)
    // The figure shown on a trade: net when fees are known, otherwise gross (always labelled by shownKind).
    var shown = !closed ? gross : (net != null ? net : gross);
    var shownKind = !closed ? (exited ? 'realized' : null) : (net != null ? 'net' : 'gross');
    var result = !closed ? status : shown > 0 ? 'win' : shown < 0 ? 'loss' : 'be';
    return { status: status, isClosed: closed, exitedQty: exited, remainingQty: t.contracts - exited,
      avgExit: exited ? Math.round((notional / exited) * 10000) / 10000 : null,
      grossCents: gross, feesCents: feesKnown ? t.feesCents : null, feesMissing: !feesKnown,
      netCents: net, shownCents: shown, shownKind: shownKind,
      plannedRiskCents: risk, rMultiple: R, result: result };
  }
  // P&L used for statistics under a basis: 'net' (after fees, only trades with fees recorded) or 'gross' (before fees).
  function plOf(c, basis) { return !c.isClosed ? null : basis === 'net' ? c.netCents : c.grossCents; }
  function analyze(trades) { return trades.map(function (t) { return { t: t, c: compute(t) }; }); }
  function order(a, b) { return (a.t.date + (a.t.time || '00:00')).localeCompare(b.t.date + (b.t.time || '00:00')) || (a.t.createdAt - b.t.createdAt); }

  /* ---------- statistics (fully closed trades only) ----------
     basis 'net'   = after fees; only trades whose fees were recorded are counted (fees missing != $0).
     basis 'gross' = before fees; every closed trade is counted.
     Open and partially closed trades are never counted. Everything left out is reported, never hidden. */
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function sumOf(a, f) { return a.reduce(function (s, r) { return s + f(r); }, 0); }
  function stats(rows, basis) {
    basis = basis === 'gross' ? 'gross' : 'net';
    var closed = rows.filter(function (r) { return r.c.isClosed; }).sort(order);
    var inc = closed.filter(function (r) { return plOf(r.c, basis) != null; });
    var pl = function (r) { return plOf(r.c, basis); };
    var wins = inc.filter(function (r) { return pl(r) > 0; });
    var losses = inc.filter(function (r) { return pl(r) < 0; });
    var n = inc.length;
    var gp = sumOf(wins, pl), gl = sumOf(losses, pl);                      // gl is negative
    var withR = inc.filter(function (r) { return r.c.rMultiple != null; });
    var winR = withR.filter(function (r) { return r.c.rMultiple > 0; }).map(function (r) { return r.c.rMultiple; });
    var lossR = withR.filter(function (r) { return r.c.rMultiple < 0; }).map(function (r) { return r.c.rMultiple; });
    var avgWinR = mean(winR), avgLossR = mean(lossR);

    var eq = 0, peak = 0, peakDate = null, maxDd = 0, ddFrom = null, ddTo = null, curve = [], best = null, worst = null;
    inc.forEach(function (r) {
      var v = pl(r); eq += v; curve.push({ date: r.t.date, cents: eq, id: r.t.id });
      if (eq > peak) { peak = eq; peakDate = r.t.date; }
      if (peak - eq > maxDd) { maxDd = peak - eq; ddFrom = peakDate; ddTo = r.t.date; }
      if (best === null || v > best) best = v;
      if (worst === null || v < worst) worst = v;
    });
    var avgWin = wins.length ? gp / wins.length : null, avgLoss = losses.length ? gl / losses.length : null;
    return {
      basis: basis, n: n, wins: wins.length, losses: losses.length, breakeven: n - wins.length - losses.length,
      closedCount: closed.length, openCount: rows.length - closed.length,
      excludedNoFees: basis === 'net' ? closed.length - n : 0,              // closed trades left out of NET figures
      winRate: n ? wins.length / n : null,
      pnlCents: n ? gp + gl : null,
      avgWinCents: avgWin, avgLossCents: avgLoss,
      payoff: avgWin != null && avgLoss != null ? avgWin / Math.abs(avgLoss) : null,   // avg winner / avg loser, in dollars
      profitFactor: losses.length ? gp / Math.abs(gl) : null,
      profitFactorNote: !n ? 'no trades' : !losses.length ? (wins.length ? 'no losing trades yet' : 'no winners or losers') : '',
      bestCents: best, worstCents: worst,
      rCount: withR.length, avgR: mean(withR.map(function (r) { return r.c.rMultiple; })),
      avgWinR: avgWinR, avgLossR: avgLossR,
      realizedRR: avgWinR != null && avgLossR != null ? avgWinR / Math.abs(avgLossR) : null,   // avg winner R : avg loser R
      maxDrawdownCents: n ? maxDd : null, ddFrom: ddFrom, ddTo: ddTo, curve: curve,
      // basis-independent context
      grossAllCents: closed.length ? sumOf(closed, function (r) { return r.c.grossCents; }) : null,
      feesRecordedCents: sumOf(closed, function (r) { return r.c.feesCents || 0; }),
      feesRecordedCount: closed.filter(function (r) { return !r.c.feesMissing; }).length,
      feesMissingCount: closed.filter(function (r) { return r.c.feesMissing; }).length
    };
  }

  function breakdown(rows, keyFn, orderList, basis) {
    var groups = {};
    rows.forEach(function (r) { if (!r.c.isClosed) return; var k = keyFn(r); (groups[k] = groups[k] || []).push(r); });
    var out = Object.keys(groups).map(function (k) {
      var s = stats(groups[k], basis);
      return { key: k, n: s.n, closed: s.closedCount, excluded: s.excludedNoFees, wins: s.wins, losses: s.losses, winRate: s.winRate,
        pnlCents: s.pnlCents, avgR: s.avgR, rCount: s.rCount };
    });
    var UNS = ['Unspecified', 'Not recorded'];
    out.sort(function (a, b) {
      var ua = UNS.indexOf(a.key) >= 0, ub = UNS.indexOf(b.key) >= 0; if (ua !== ub) return ua ? 1 : -1;
      if (orderList) { var ia = orderList.indexOf(a.key), ib = orderList.indexOf(b.key); if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }
      if ((a.pnlCents == null) !== (b.pnlCents == null)) return a.pnlCents == null ? 1 : -1;
      return (b.pnlCents || 0) - (a.pnlCents || 0);
    });
    return out;
  }

  /* ---------- calendar ---------- */
  function dailyMap(rows, basis) {
    basis = basis === 'gross' ? 'gross' : 'net';
    var m = {};
    rows.forEach(function (r) {
      var d = m[r.t.date] || (m[r.t.date] = { pnlCents: null, trades: 0, counted: 0, open: 0, excluded: 0 });
      d.trades++;
      if (!r.c.isClosed) { d.open++; return; }
      var v = plOf(r.c, basis);
      if (v == null) d.excluded++; else { d.pnlCents = (d.pnlCents || 0) + v; d.counted++; }
    });
    return m;
  }
  function summaryForDate(rows, date, basis) { return dailyMap(rows, basis)[date] || { pnlCents: null, trades: 0, counted: 0, open: 0, excluded: 0 }; }

  // Home-screen "today": net when every closed trade today has fees recorded, otherwise gross with a flag.
  function todaySummary(rows, date) {
    var today = rows.filter(function (r) { return r.t.date === date; });
    var closed = today.filter(function (r) { return r.c.isClosed; });
    var missing = closed.filter(function (r) { return r.c.feesMissing; }).length;
    if (!closed.length) return { closed: 0, open: today.length, basis: null, cents: null, feesMissing: 0 };
    var basis = missing ? 'gross' : 'net';
    return { closed: closed.length, open: today.length - closed.length, basis: basis, feesMissing: missing,
      cents: sumOf(closed, function (r) { return plOf(r.c, basis); }) };
  }

  /* ---------- filters ---------- */
  function filterRows(rows, f) {
    f = f || {}; var q = str(f.q).trim().toLowerCase();
    return rows.filter(function (r) {
      var t = r.t, c = r.c;
      if (f.date && t.date !== f.date) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.contract && t.contract !== f.contract) return false;
      if (f.account && (t.accountId || 'acct-default') !== f.account) return false;
      if (f.side && t.side !== f.side) return false;
      if (f.session === '__none') { if (t.session) return false; } else if (f.session && t.session !== f.session) return false;
      if (f.strategy === '__none') { if (t.strategy) return false; } else if (f.strategy && t.strategy.toLowerCase() !== str(f.strategy).toLowerCase()) return false;   // strategy names match regardless of case
      if (f.result && c.result !== f.result && !(f.result === 'open' && c.status !== 'closed')) return false;
      if (f.rules === 'yes' && t.followedRules !== true) return false;
      if (f.rules === 'no' && t.followedRules !== false) return false;
      if (f.rules === 'unknown' && t.followedRules !== null) return false;
      if (q) {
        var hay = [t.strategy, t.notes, t.entryReason, t.exitReason, t.mistakes, t.lessons, t.contract, t.side, t.session, t.date].join(' \n ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  /* ---------- CSV ---------- */
  function money(c) { return c == null ? '' : (c / 100).toFixed(2); }
  function cell(v, isText) {
    var s = v == null ? '' : String(v);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;                  // block spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  var CSV_COLS = ['id', 'date', 'time', 'contract', 'side', 'session', 'strategy', 'contracts', 'entry', 'stop', 'exits', 'avg_exit', 'status',
    'gross_pnl', 'fees', 'net_pnl', 'planned_risk', 'r_multiple', 'rules_followed', 'rating', 'entry_reason', 'exit_reason', 'mistakes', 'lessons', 'notes'];
  function toCsv(rows) {
    var lines = [CSV_COLS.join(',')];
    rows.slice().sort(order).forEach(function (r) {
      var t = r.t, c = r.c;
      lines.push([
        cell(t.id, true), cell(t.date), cell(t.time), cell(t.contract), cell(t.side), cell(t.session, true), cell(t.strategy, true), cell(t.contracts),
        cell(t.entry), cell(t.stop == null ? '' : t.stop), cell(t.exits.map(function (x) { return x.qty + '@' + x.price; }).join(' | ')),
        cell(c.avgExit == null ? '' : c.avgExit), cell(c.status), cell(money(c.grossCents)), cell(money(c.feesCents)), cell(money(c.netCents)),
        cell(money(c.plannedRiskCents)), cell(c.rMultiple == null ? '' : c.rMultiple),
        cell(t.followedRules === true ? 'yes' : t.followedRules === false ? 'no' : ''), cell(t.rating == null ? '' : t.rating),
        cell(t.entryReason, true), cell(t.exitReason, true), cell(t.mistakes, true), cell(t.lessons, true), cell(t.notes, true)
      ].join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  /* ---------- backup ---------- */
  function serializeBackup(trades, shots) {
    return JSON.stringify({ app: 'tamhas-trading', kind: 'journal-backup', version: 1, exportedAt: new Date().toISOString(), trades: trades, shots: shots || {} });
  }
  function parseBackup(text) {
    var data; try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.trades) ? data.trades : null);
    if (!list) return { ok: false, error: 'No trades found in that file.' };
    var trades = [], skipped = [], seen = {};
    list.slice(0, 20000).forEach(function (raw, i) {
      var r = normalizeTrade(raw);
      if (!r.ok) { skipped.push('Row ' + (i + 1) + ': ' + r.errors[0]); return; }
      if (seen[r.trade.id]) { skipped.push('Row ' + (i + 1) + ': duplicate id'); return; }
      seen[r.trade.id] = 1; trades.push(r.trade);
    });
    var shots = {};
    if (data && data.shots && typeof data.shots === 'object' && !Array.isArray(data.shots)) {
      Object.keys(data.shots).forEach(function (k) {
        var v = data.shots[k], id = k.split(':')[0];
        if (/^[A-Za-z0-9_-]{1,40}:(before|after)$/.test(k) && seen[id] && typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(v) && v.length < 4000000) shots[k] = v;
      });
    }
    return { ok: true, trades: trades, skipped: skipped, shots: shots };
  }

  /* ---------- storage / merge / formatting ---------- */
  var STORE_KEY = 'tt.journal.v1';
  // Reads what was saved in localStorage. Never throws and never drops data silently: unreadable entries are returned in `rejected`.
  function parseStored(text) {
    if (text == null || text === '') return { trades: [], rejected: [], corrupt: false };
    var data; try { data = JSON.parse(text); } catch (e) { return { trades: [], rejected: [], corrupt: true }; }
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.trades) ? data.trades : null);
    if (!list) return { trades: [], rejected: [], corrupt: true };
    var trades = [], rejected = [], seen = {};
    list.forEach(function (raw) {
      var r = normalizeTrade(raw);
      if (!r.ok || seen[r.trade.id]) { rejected.push(raw); return; }
      seen[r.trade.id] = 1; trades.push(r.trade);
    });
    return { trades: trades, rejected: rejected, corrupt: false };
  }
  function serializeStored(trades) { return JSON.stringify({ v: 1, trades: trades }); }
  // mode 'merge' adds trades whose id is new; 'replace' swaps everything.
  function mergeTrades(existing, incoming, mode) {
    if (mode === 'replace') return { trades: incoming.slice(), added: incoming.length, skipped: 0 };
    var have = {}; existing.forEach(function (t) { have[t.id] = 1; });
    var add = incoming.filter(function (t) { return !have[t.id]; });
    return { trades: existing.concat(add), added: add.length, skipped: incoming.length - add.length };
  }
  function fmtMoney(cents, plus) {
    if (cents == null || isNaN(cents)) return '—';                  // em dash = not available (never "$0.00")
    var a = Math.round(Math.abs(cents)), neg = cents < 0 && a > 0;        // round the magnitude, so -412.5 and 412.5 round alike
    return (neg ? '-' : (plus && a > 0 ? '+' : '')) + '$' + (a / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCompact(cents) {
    if (cents == null || isNaN(cents)) return '';
    var r = Math.round(Math.abs(cents)), a = r / 100, sign = cents < 0 && r > 0 ? '-' : (r > 0 ? '+' : '');
    var body = a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : (a >= 100 || a % 1 === 0 ? String(Math.round(a)) : a.toFixed(2));
    return sign + '$' + body;
  }

  var api = { SESSIONS: SESSIONS, STORE_KEY: STORE_KEY, normalizeTrade: normalizeTrade, compute: compute, analyze: analyze, plOf: plOf,
    stats: stats, breakdown: breakdown, dailyMap: dailyMap, summaryForDate: summaryForDate, todaySummary: todaySummary,
    filterRows: filterRows, toCsv: toCsv, CSV_COLS: CSV_COLS, serializeBackup: serializeBackup, parseBackup: parseBackup,
    parseStored: parseStored, serializeStored: serializeStored, mergeTrades: mergeTrades, fmtMoney: fmtMoney, fmtCompact: fmtCompact,
    order: order, num: num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTJournalCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
