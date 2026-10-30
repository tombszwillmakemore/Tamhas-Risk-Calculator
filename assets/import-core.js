/* Tamhas Trading - CSV import engine (pure logic: no DOM, no storage, no network).
   Two kinds of file are understood, chosen by YOU in the mapping step (nothing is guessed silently):
     fills   - one row per execution (buy or sell). Fills are paired into trades, first-in-first-out, flat to flat:
               extra buys in the direction of the position are scale-ins, opposite fills are exits, a fill that
               crosses zero closes the trade and opens the next one.
     trades  - one row per finished trade (entry price + exit price on the same row).
   Rows that cannot be read are reported with the reason and left out - never repaired by guessing. Contracts that are not
   in the verified instrument list are left out and listed. Fees that are missing stay "not entered" (never $0). */
(function (root) {
  'use strict';
  var INST = root.TTInstruments || (typeof require !== 'undefined' ? require('./instruments.js') : null);
  var SES = root.TTSessions || (typeof require !== 'undefined' ? require('./sessions.js') : null);
  var LIMITS = { rows: 250000, chars: 40000000, fillsPerTrade: 200 };

  /* ---------- CSV parsing (RFC 4180: quoted fields, escaped quotes, newlines inside quotes) ---------- */
  function detectDelimiter(text) {
    var line = text.slice(0, 4000).split(/\r\n|\n|\r/)[0] || '', best = ',', n = -1;
    [',', ';', '\t', '|'].forEach(function (d) { var c = 0, q = false; for (var i = 0; i < line.length; i++) { if (line[i] === '"') q = !q; else if (!q && line[i] === d) c++; } if (c > n) { n = c; best = d; } });
    return best;
  }
  function parseCsv(text, delimiter) {
    text = String(text == null ? '' : text); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.length > LIMITS.chars) return { ok: false, error: 'That file is larger than ' + (LIMITS.chars / 1e6) + ' MB.' };
    var d = delimiter || detectDelimiter(text), rows = [], row = [], f = '', q = false, i = 0, n = text.length, started = false;
    for (; i < n; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"' && f === '') { q = true; started = true; continue; }
      if (ch === d) { row.push(f); f = ''; started = true; continue; }
      if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (started || row.length > 1 || row[0] !== '') rows.push(row); row = []; started = false; if (rows.length > LIMITS.rows + 1) return { ok: false, error: 'More than ' + LIMITS.rows + ' rows. Split the file and import it in parts.' }; continue; }
      f += ch; started = true;
    }
    if (q) return { ok: false, error: 'The file ends inside a quoted value (a quote is not closed). It may be cut off or damaged.' };
    if (started || f !== '' || row.length) { row.push(f); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (rows.length < 2) return { ok: false, error: rows.length ? 'The file has a header row but no data rows.' : 'The file is empty.' };
    var headers = rows[0].map(function (h) { return String(h).trim(); }), data = rows.slice(1);
    return { ok: true, delimiter: d, headers: headers, rows: data };
  }

  /* ---------- column detection ---------- */
  var FIELDS = {
    fills: [['time', 'Time', true], ['symbol', 'Contract / symbol', true], ['side', 'Buy / Sell', true], ['qty', 'Quantity', true], ['price', 'Price', true], ['fees', 'Fees / commission', false], ['account', 'Account', false], ['id', 'Fill / order id', false]],
    trades: [['entryTime', 'Entry time', true], ['exitTime', 'Exit time', false], ['symbol', 'Contract / symbol', true], ['side', 'Long / Short', true], ['qty', 'Quantity', true], ['entryPrice', 'Entry price', true], ['exitPrice', 'Exit price', true], ['fees', 'Fees / commission', false], ['pnl', 'P&L (for checking)', false], ['account', 'Account', false], ['id', 'Trade id', false]]
  };
  var ALIAS = {
    time: ['time', 'timestamp', 'datetime', 'date/time', 'fill time', 'filled time', 'execution time', 'exec time', 'date', 'filltime', 'executiontime', 'tradetime'],
    symbol: ['symbol', 'contract', 'instrument', 'product', 'market', 'ticker', 'description'],
    side: ['side', 'b/s', 'buy/sell', 'action', 'buysell', 'type', 'direction', 'market pos.', 'marketposition'],
    qty: ['qty', 'quantity', 'size', 'contracts', 'filled qty', 'filled quantity', 'fillqty', 'lots', 'amount'],
    price: ['price', 'fill price', 'avg price', 'average price', 'avgprice', 'fillprice', 'executionprice', 'exec price'],
    fees: ['fees', 'fee', 'commission', 'commissions', 'comm', 'commission & fees', 'total fees', 'commissionandfees'],
    account: ['account', 'account name', 'acct', 'accountid', 'account id'],
    id: ['id', 'fill id', 'order id', 'execution id', 'trade id', 'fillid', 'orderid', 'tradeid', 'trade number', 'exec id'],
    entryTime: ['entry time', 'entrytime', 'opened', 'open time', 'opentime', 'entry date', 'entered', 'time in'],
    exitTime: ['exit time', 'exittime', 'closed', 'close time', 'closetime', 'exit date', 'exited', 'time out'],
    entryPrice: ['entry price', 'entryprice', 'open price', 'openprice', 'avg entry', 'entry'],
    exitPrice: ['exit price', 'exitprice', 'close price', 'closeprice', 'avg exit', 'exit'],
    pnl: ['pnl', 'p&l', 'profit', 'net p&l', 'realized pnl', 'profit/loss', 'net profit', 'gross p&l', 'profit loss', 'netpnl', 'gross pnl']
  };
  function norm(h) { return String(h).toLowerCase().replace(/[^a-z0-9&\/. ]/g, '').replace(/\s+/g, ' ').trim(); }
  function normLoose(h) { return norm(h).replace(/[^a-z0-9&]/g, ''); }
  function detectMode(headers) {
    var h = headers.map(normLoose), has = function (k) { return ALIAS[k].some(function (a) { return h.indexOf(normLoose(a)) >= 0; }); };
    return has('entryPrice') && has('exitPrice') ? 'trades' : 'fills';
  }
  function suggestMapping(headers, mode) {
    var map = {}, used = {};
    FIELDS[mode].forEach(function (f) {
      var key = f[0], names = ALIAS[key].map(normLoose), idx = -1;
      for (var i = 0; i < headers.length && idx < 0; i++) if (!used[i] && names.indexOf(normLoose(headers[i])) >= 0) idx = i;
      if (idx >= 0) { map[key] = idx; used[idx] = 1; }
    });
    return map;
  }
  function headerSignature(headers) { return headers.map(normLoose).join('|'); }

  /* ---------- value parsers ---------- */
  function parseNumber(v) {
    var s = String(v == null ? '' : v).trim(); if (s === '') return null;
    s = s.replace(/[$€£\s]/g, '');                                      // currency signs first, so "$(25.50)" and "($25.50)" both work
    var neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } if (s[0] === '-') { neg = !neg; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
    var n = parseFloat(s); return neg ? -n : n;
  }
  function twoDecimals(x) { return isFinite(x) && Math.abs(x * 100 - Math.round(x * 100)) < 1e-7; }
  function parseSide(v, mode) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (mode === 'fills') { if (/^(b|buy|bot|bought|long|buy to open|buy to close|buy_to_cover|cover)$/.test(s)) return 'buy'; if (/^(s|sell|sld|sold|short|sell to open|sell to close|sell short)$/.test(s)) return 'sell'; return null; }
    if (/^(l|long|buy|b|bot|bought)$/.test(s)) return 'long'; if (/^(s|short|sell|sld|sold|sell short)$/.test(s)) return 'short'; return null;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function wallParts(ms, tz) {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, time: o.hour + ':' + o.minute, sec: +o.second };
  }
  function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } }
  /* Timestamp -> {date:'YYYY-MM-DD', time:'HH:MM'|'' , ms}. opts: {dateOrder:'mdy'|'dmy'|'ymd', fileTz:'as-is'|'UTC'|IANA, targetTz}.
     A string with its own offset (Z, +02:00) is converted exactly. Otherwise the wall time is read in `fileTz` and converted to `targetTz`;
     'as-is' keeps the time exactly as written (no conversion). */
  function parseTimestamp(v, opts) {
    opts = opts || {}; var s = String(v == null ? '' : v).trim(); if (!s) return null;
    var m, y, mo, d, h = 0, mi = 0, sec = 0, hasTime = false, offMin = null, order = opts.dateOrder || 'mdy';
    var rest = s;
    var oz = rest.match(/(?:\s*)(Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i);
    if (oz && /\d/.test(rest.slice(0, rest.length - oz[0].length).slice(-1))) { var t0 = oz[1].toUpperCase(); offMin = (t0 === 'Z' || t0 === 'UTC' || t0 === 'GMT') ? 0 : (t0[0] === '-' ? -1 : 1) * (parseInt(t0.slice(1, 3), 10) * 60 + parseInt(t0.slice(-2), 10)); rest = rest.slice(0, rest.length - oz[0].length).trim(); }
    var tm = rest.match(/[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*([AaPp][Mm])?$/);
    var datePart = rest;
    if (tm) { h = +tm[1]; mi = +tm[2]; sec = tm[3] ? +tm[3] : 0; hasTime = true; if (tm[4]) { var pm = /p/i.test(tm[4]); if (h < 1 || h > 12) return null; h = (h % 12) + (pm ? 12 : 0); } datePart = rest.slice(0, rest.length - tm[0].length).trim(); if (h > 23 || mi > 59 || sec > 59) return null; }
    if ((m = datePart.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = datePart.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))) {
      var a = +m[1], b = +m[2]; y = +m[3]; if (m[3].length === 2) y += 2000;
      if (order === 'dmy') { d = a; mo = b; } else { mo = a; d = b; }
    } else if ((m = datePart.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    var chk = new Date(Date.UTC(y, mo - 1, d)); if (chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
    var date = y + '-' + p2(mo) + '-' + p2(d);
    if (!hasTime) return { date: date, time: '', ms: null, sec: 0, hasTime: false };
    var tz = opts.targetTz, ftz = opts.fileTz || 'as-is', ms;
    if (offMin != null) ms = Date.UTC(y, mo - 1, d, h, mi, sec) - offMin * 60000;
    else if (ftz === 'as-is' || !tz) return { date: date, time: p2(h) + ':' + p2(mi), ms: Date.UTC(y, mo - 1, d, h, mi, sec), sec: sec, hasTime: true, converted: false };
    else if (ftz === 'UTC') ms = Date.UTC(y, mo - 1, d, h, mi, sec);
    else { if (!validTz(ftz)) return null; ms = SES.wallToInstant(y, mo, d, h, mi, ftz) + sec * 1000; }
    if (!tz) tz = 'UTC';
    var w = wallParts(ms, tz); return { date: w.date, time: w.time, ms: ms, sec: w.sec, hasTime: true, converted: true };
  }

  /* ---------- symbols ---------- */
  var MONTH = 'FGHJKMNQUVXZ';
  function normalizeSymbol(raw) {
    var s = String(raw == null ? '' : raw).trim().toUpperCase().replace(/^\//, '').replace(/\s+/g, ' ');
    if (!s) return null;
    s = s.replace(/[0-9]!$/, '').replace(/\.[A-Z]{3,5}$/, '');                 // MNQ1! (TradingView continuous), MNQ.CME
    if (INST.byId[s]) return s;
    var m = s.match(/^([A-Z]{2,3})\s?([FGHJKMNQUVXZ])(\d{1,4})$/);               // MNQZ6, MNQ Z26, MNQZ2026
    if (m && INST.byId[m[1]]) return m[1];
    m = s.match(/^([A-Z]{2,3})[ -]?(\d{1,2})[-\/ ]?(\d{2})$/);                     // MNQ 12-26
    if (m && INST.byId[m[1]] && +m[2] >= 1 && +m[2] <= 12) return m[1];
    m = s.match(/^([A-Z]{2,3})[ -]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ -]?(\d{2,4})$/);   // MNQ DEC26
    if (m && INST.byId[m[1]]) return m[1];
    return null;
  }

  /* ---------- hashing for duplicate keys (two independent 32-bit FNV-1a variants -> 16 hex chars) ---------- */
  function hash(str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef;
    for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193); h2 = Math.imul(h2 ^ c, 0x85ebca6b); h2 ^= h2 >>> 13; }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }
  function stable(o) { return Array.isArray(o) ? '[' + o.map(stable).join(',') + ']' : (o && typeof o === 'object' ? '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}' : JSON.stringify(o)); }
  // Content hash of a saved trade (everything but createdAt). Used so rollback removes only trades you have not edited since import.
  function tradeHash(t) { var c = {}; Object.keys(t).forEach(function (k) { if (k !== 'createdAt') c[k] = t[k]; }); return hash(stable(c)); }

  /* ---------- reading rows ---------- */
  function cell(row, map, key) { var i = map[key]; return i == null || i < 0 ? '' : (row[i] == null ? '' : String(row[i]).trim()); }
  function feeCents(raw, perContractQty, opts) {
    if (raw === '' || raw == null) return { cents: null };
    var n = parseNumber(raw); if (n == null) return { error: 'fees are not a number ("' + String(raw).slice(0, 20) + '")' };
    n = Math.abs(n); if (opts.feesPerContract && perContractQty) n *= perContractQty;
    return { cents: Math.round(n * 100) };
  }
  function bump(counter, key, row, max) { var c = counter[key] || (counter[key] = { n: 0, rows: [] }); c.n++; if (c.rows.length < (max || 5)) c.rows.push(row); }

  // opts: {mode, mapping, dateOrder, fileTz, targetTz, defaultAccountId, accountMap:{fileName->id}, feesPerContract}
  function readFills(parsed, opts) {
    var map = opts.mapping, fills = [], problems = {}, unsupported = {}, occ = {};
    parsed.rows.forEach(function (row, i) {
      var line = i + 2;
      var sym = cell(row, map, 'symbol'), c = normalizeSymbol(sym);
      if (!c) { var k = sym || '(blank)'; unsupported[k] = (unsupported[k] || 0) + 1; return; }
      var side = parseSide(cell(row, map, 'side'), 'fills'); if (!side) { bump(problems, 'Buy/Sell value not recognised', line); return; }
      var q = parseNumber(cell(row, map, 'qty')); if (q == null || !Number.isInteger(q) || q < 1) { bump(problems, 'quantity is not a whole number of 1 or more', line); return; }
      var pr = parseNumber(cell(row, map, 'price')); if (pr == null || !(pr > 0)) { bump(problems, 'price is missing or not a positive number', line); return; }
      if (!twoDecimals(pr)) { bump(problems, 'price has more than 2 decimals (the journal stores 2)', line); return; }
      var ts = parseTimestamp(cell(row, map, 'time'), opts); if (!ts) { bump(problems, 'time could not be read (check the date order and time zone settings)', line); return; }
      var fee = feeCents(cell(row, map, 'fees'), q, opts); if (fee.error) { bump(problems, fee.error, line); return; }
      var acctRaw = cell(row, map, 'account'), acct = acctRaw && opts.accountMap && opts.accountMap[acctRaw] ? opts.accountMap[acctRaw] : opts.defaultAccountId;
      var rawKey = [acctRaw, sym.toUpperCase(), side, q, pr, cell(row, map, 'time'), cell(row, map, 'id')].join('\u001f'), base = hash(rawKey), n = occ[base] || 0; occ[base] = n + 1;
      fills.push({ line: line, order: i, contract: c, side: side, qty: q, price: pr, feeCents: fee.cents, ts: ts, account: acct, accountRaw: acctRaw, key: 'f1:' + base + '#' + n });
    });
    return { fills: fills, problems: problems, unsupported: unsupported };
  }
  function sortKey(f) { return f.ts.ms != null ? f.ts.ms : Date.parse(f.ts.date + 'T00:00:00Z'); }

  /* ---------- pairing fills into trades (first-in-first-out, flat to flat) ---------- */
  function pairFills(fills) {
    var groups = {}, out = [], warnings = [];
    fills.forEach(function (f) { var k = (f.account || '') + '\u001f' + f.contract; (groups[k] || (groups[k] = [])).push(f); });
    Object.keys(groups).forEach(function (k) {
      var list = groups[k].slice().sort(function (a, b) { return (sortKey(a) - sortKey(b)) || (a.ts.sec - b.ts.sec) || (a.order - b.order); }), pos = 0, cur = null;
      function start(f, qty, feePart, side) { cur = { account: f.account, contract: f.contract, side: side, entries: [{ qty: qty, price: f.price, ts: f.ts }], exits: [], fees: feePart, feesKnown: feePart != null, keys: [f.key], lines: [f.line] }; }
      function addFee(feePart) { if (feePart == null) cur.feesKnown = false; else if (cur.feesKnown) cur.fees = (cur.fees || 0) + feePart; }
      list.forEach(function (f) {
        var sq = f.side === 'buy' ? f.qty : -f.qty;
        if (pos === 0) { start(f, f.qty, f.feeCents, sq > 0 ? 'long' : 'short'); pos = sq; return; }
        if ((pos > 0) === (sq > 0)) { cur.entries.push({ qty: f.qty, price: f.price, ts: f.ts }); addFee(f.feeCents); cur.keys.push(f.key); cur.lines.push(f.line); pos += sq; return; }
        var close = Math.min(Math.abs(sq), Math.abs(pos)), rest = Math.abs(sq) - close;
        var feeClose = f.feeCents == null ? null : (rest ? Math.round(f.feeCents * close / f.qty) : f.feeCents), feeRest = f.feeCents == null ? null : f.feeCents - (feeClose || 0);
        cur.exits.push({ qty: close, price: f.price, ts: f.ts }); addFee(feeClose); cur.keys.push(f.key); cur.lines.push(f.line);
        pos += sq > 0 ? close : -close;
        if (pos === 0) { out.push(cur); cur = null; }
        if (rest > 0) { start(f, rest, feeRest, sq > 0 ? 'long' : 'short'); cur.keys = [f.key]; cur.lines = [f.line]; pos = sq > 0 ? rest : -rest; }
      });
      if (cur) { cur.openAtEnd = true; out.push(cur); }
    });
    out.sort(function (a, b) { return sortKey({ ts: a.entries[0].ts }) - sortKey({ ts: b.entries[0].ts }); });
    return out;
  }

  // Builds the raw trade object that TTJournalCore.normalizeTrade accepts.
  function toRawTrade(p, o) {
    var e0 = p.entries[0], total = p.entries.reduce(function (a, x) { return a + x.qty; }, 0), raw = { date: e0.ts.date, time: e0.ts.hasTime ? e0.ts.time : '', contract: p.contract, side: p.side, accountId: p.account || undefined,
      exits: p.exits.map(function (x) { var r = { qty: x.qty, price: x.price }; if (x.ts.hasTime) r.time = x.ts.time; if (x.ts.date !== e0.ts.date) r.date = x.ts.date; return r; }) };
    if (p.entries.length > 1) raw.entries = p.entries.map(function (x, i) { var r = { qty: x.qty, price: x.price }; if (x.ts.hasTime) r.time = x.ts.time; if (i > 0 && x.ts.date !== e0.ts.date) r.date = x.ts.date; return r; });
    else { raw.contracts = total; raw.entry = e0.price; }
    if (p.feesKnown && p.fees != null) raw.feesCents = p.fees;
    raw.srcKeys = p.keys; if (o && o.batchId) raw.importBatch = o.batchId;
    return raw;
  }

  function readTrades(parsed, opts) {
    var map = opts.mapping, trades = [], problems = {}, unsupported = {}, occ = {};
    parsed.rows.forEach(function (row, i) {
      var line = i + 2, sym = cell(row, map, 'symbol'), c = normalizeSymbol(sym);
      if (!c) { var k = sym || '(blank)'; unsupported[k] = (unsupported[k] || 0) + 1; return; }
      var side = parseSide(cell(row, map, 'side'), 'trades'); if (!side) { bump(problems, 'Long/Short value not recognised', line); return; }
      var q = parseNumber(cell(row, map, 'qty')); if (q == null || !Number.isInteger(q) || q < 1) { bump(problems, 'quantity is not a whole number of 1 or more', line); return; }
      var ep = parseNumber(cell(row, map, 'entryPrice')), xp = parseNumber(cell(row, map, 'exitPrice'));
      if (ep == null || !(ep > 0)) { bump(problems, 'entry price is missing or not a positive number', line); return; }
      if (xp != null && !(xp > 0)) { bump(problems, 'exit price is not a positive number', line); return; }
      if (!twoDecimals(ep) || (xp != null && !twoDecimals(xp))) { bump(problems, 'price has more than 2 decimals (the journal stores 2)', line); return; }
      var et = parseTimestamp(cell(row, map, 'entryTime'), opts); if (!et) { bump(problems, 'entry time could not be read (check the date order and time zone settings)', line); return; }
      var xt = null, xRaw = cell(row, map, 'exitTime'); if (xRaw) { xt = parseTimestamp(xRaw, opts); if (!xt) { bump(problems, 'exit time could not be read', line); return; } }
      var fee = feeCents(cell(row, map, 'fees'), q, opts); if (fee.error) { bump(problems, fee.error, line); return; }
      var pnlRaw = cell(row, map, 'pnl'), pnl = pnlRaw === '' ? null : parseNumber(pnlRaw);
      var acctRaw = cell(row, map, 'account'), acct = acctRaw && opts.accountMap && opts.accountMap[acctRaw] ? opts.accountMap[acctRaw] : opts.defaultAccountId;
      var base = hash([acctRaw, sym.toUpperCase(), side, q, ep, xp == null ? '' : xp, cell(row, map, 'entryTime'), xRaw, cell(row, map, 'id')].join('\u001f')), n = occ[base] || 0; occ[base] = n + 1;
      var raw = { date: et.date, time: et.hasTime ? et.time : '', contract: c, side: side, contracts: q, entry: ep, accountId: acct || undefined, exits: [], srcKeys: ['t1:' + base + '#' + n] };
      if (xp != null) { var ex = { qty: q, price: xp }; if (xt && xt.hasTime) ex.time = xt.time; if (xt && xt.date !== et.date) ex.date = xt.date; raw.exits.push(ex); }
      if (fee.cents != null) raw.feesCents = fee.cents;
      if (opts.batchId) raw.importBatch = opts.batchId;
      trades.push({ raw: raw, line: line, filePnlCents: pnl == null ? null : Math.round(pnl * 100), key: raw.srcKeys[0] });
    });
    return { trades: trades, problems: problems, unsupported: unsupported };
  }

  /* ---------- the whole plan: parse -> trades -> classify against what you already have ----------
     existingKeys: a Set (or object) of srcKeys already in your journal. A trade whose every fill is already known is a duplicate and is
     skipped. A trade that is only PARTLY known (e.g. overlapping exports) is skipped and reported - it is never half-imported. */
  function plan(parsed, opts, existingKeys, journal) {
    var has = function (k) { return existingKeys && (existingKeys.has ? existingKeys.has(k) : Object.prototype.hasOwnProperty.call(existingKeys, k)); };
    var res = { mode: opts.mode, rows: parsed.rows.length, trades: [], duplicates: 0, partial: [], problems: {}, unsupported: {}, openAtEnd: 0, invalid: [], reconcile: { checked: 0, matched: 0, mismatched: [] }, tooBig: 0 };
    var items;
    if (opts.mode === 'trades') {
      var rt = readTrades(parsed, opts); res.problems = rt.problems; res.unsupported = rt.unsupported;
      items = rt.trades.map(function (t) { return { raw: t.raw, keys: [t.key], line: t.line, filePnlCents: t.filePnlCents }; });
    } else {
      var rf = readFills(parsed, opts); res.problems = rf.problems; res.unsupported = rf.unsupported; res.fills = rf.fills.length;
      items = pairFills(rf.fills).map(function (p) {
        if (p.entries.length + p.exits.length > LIMITS.fillsPerTrade) { res.tooBig++; return null; }
        if (p.openAtEnd) res.openAtEnd++;
        return { raw: toRawTrade(p, opts), keys: p.keys, line: p.lines[0] };
      }).filter(Boolean);
    }
    items.forEach(function (it) {
      var known = it.keys.filter(has).length;
      if (known === it.keys.length) { res.duplicates++; return; }
      if (known > 0) { res.partial.push({ line: it.line, known: known, of: it.keys.length }); return; }
      var n = journal.normalizeTrade(it.raw);
      if (!n.ok) { res.invalid.push({ line: it.line, reason: n.errors[0] }); return; }
      var c = journal.analyze([n.trade])[0].c;
      if (it.filePnlCents != null && c.isClosed) {
        res.reconcile.checked++;
        var ok = Math.abs(c.grossCents - it.filePnlCents) <= 1 || (c.netCents != null && Math.abs(c.netCents - it.filePnlCents) <= 1);
        if (ok) res.reconcile.matched++; else if (res.reconcile.mismatched.length < 20) res.reconcile.mismatched.push({ line: it.line, file: it.filePnlCents, gross: c.grossCents, net: c.netCents });
      }
      res.trades.push({ trade: n.trade, c: c, line: it.line });
    });
    return res;
  }

  var api = { LIMITS: LIMITS, FIELDS: FIELDS, parseCsv: parseCsv, detectDelimiter: detectDelimiter, detectMode: detectMode, suggestMapping: suggestMapping, headerSignature: headerSignature,
    parseNumber: parseNumber, parseSide: parseSide, parseTimestamp: parseTimestamp, normalizeSymbol: normalizeSymbol, readFills: readFills, readTrades: readTrades, pairFills: pairFills,
    toRawTrade: toRawTrade, plan: plan, hash: hash, tradeHash: tradeHash, validTz: validTz };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
