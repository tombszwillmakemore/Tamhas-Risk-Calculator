/* Tamhas Trading - Tradovate Smart Import (pure logic: no DOM, no storage, no network).
   Turns a Tradovate report into fills for the existing import engine (TTImport), which pairs them into trades first-in-first-out,
   checks duplicates and writes atomically with rollback.

   Report layouts and where they come from (nothing here was taken from a real account file, so every import is previewed first):
     orders      - Tradovate "Orders" CSV. Header list published by two independent journal vendors (TradeZella, Edgewonk), checked 2026-10-30.
                   One row per order: Filled Qty at Avg Fill Price, Fill Time. No commissions in the file.
     performance - Tradovate "Performance" report CSV (symbol, qty, buyPrice, sellPrice, pnl, boughtTimestamp, soldTimestamp, ...).
                   One row per matched buy/sell pair, with fill ids and Tradovate's gross P&L. No commissions in the file.
     fills       - a fills / executions list recognised only by its column names (not checked against a published header).
     summary     - balances or totals without individual executions (Account Summary, Cash History...). Kept as a reference, never turned into trades.
   Fees that are not in the file stay unknown ("Unavailable") unless YOU saved a per-contract fee for that contract and chose to apply it. */
(function (root) {
  'use strict';
  var I = root.TTImport || (typeof require !== 'undefined' ? require('./import-core.js') : null);
  var SES = root.TTSessions || (typeof require !== 'undefined' ? require('./sessions.js') : null);

  function L(h) { return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9&]/g, ''); }
  function col(headers, names) { var hs = headers.map(L); for (var n = 0; n < names.length; n++) { var i = hs.indexOf(L(names[n])); if (i >= 0) return i; } return -1; }

  var LAYOUTS = {
    orders: { title: 'Tradovate Orders report', basis: 'Matches the Orders export header published by TradeZella and Edgewonk (not tested on a real account file).', verified: 'published',
      need: { side: ['B/S'], contract: ['Contract'], status: ['Status'], time: ['Fill Time'], qty: ['Filled Qty', 'filledQty'], price: ['Avg Fill Price', 'avgPrice'] },
      opt: { account: ['Account'], id: ['orderId', 'Order ID'], product: ['Product'], spread: ['spreadDefinitionId'], type: ['Type'] }, fees: false },
    performance: { title: 'Tradovate Performance report', basis: 'Matches the Performance export columns described by several journal tools (not tested on a real account file).', verified: 'published',
      need: { symbol: ['symbol'], qty: ['qty'], buyPrice: ['buyPrice'], sellPrice: ['sellPrice'], bought: ['boughtTimestamp'], sold: ['soldTimestamp'] },
      opt: { pnl: ['pnl'], buyId: ['buyFillId'], sellId: ['sellFillId'], duration: ['duration'], account: ['account', 'Account'] }, fees: false },
    fills: { title: 'Fills / executions list', basis: 'Recognised by its column names only. This layout has not been checked against a published Tradovate header, so check the preview.', verified: 'names',
      need: { side: ['B/S'], contract: ['Contract'], qty: ['Quantity', 'Qty', 'Filled Qty', 'Fill Qty'], price: ['Price', 'Fill Price', 'Exec Price'], time: ['Timestamp', 'Fill Time', 'Time', 'Date/Time', 'Exec Time'] },
      opt: { account: ['Account'], id: ['Fill ID', 'fillId', 'id', 'Execution ID', 'Exec ID'], order: ['Order ID', 'orderId'], fee: ['Commission', 'Commissions', 'Fees', 'Fee', 'Total Fees'] }, fees: true }
  };
  var SUMMARY_WORDS = ['netliq', 'netliquidation', 'cashbalance', 'accountbalance', 'balance', 'totalpnl', 'realizedpnl', 'openpnl', 'totalamount', 'cashchange', 'endofdaybalance', 'margin', 'buyingpower', 'availablefunds', 'grossprofit', 'grossloss', 'totalpl', 'wintrades', 'losstrades', 'totaltrades'];

  function findCols(headers, spec) { var out = {}, miss = []; Object.keys(spec.need).forEach(function (k) { var i = col(headers, spec.need[k]); if (i < 0) miss.push(spec.need[k][0]); out[k] = i; }); Object.keys(spec.opt).forEach(function (k) { out[k] = col(headers, spec.opt[k]); }); return { cols: out, missing: miss }; }

  /* ---------- 1. what kind of report is this? ---------- */
  function detect(headers) {
    var order = ['performance', 'orders', 'fills'];
    for (var i = 0; i < order.length; i++) { var f = findCols(headers, LAYOUTS[order[i]]); if (!f.missing.length) return { report: order[i], title: LAYOUTS[order[i]].title, basis: LAYOUTS[order[i]].basis, verified: LAYOUTS[order[i]].verified, cols: f.cols }; }
    var hs = headers.map(L), sumHits = hs.filter(function (h) { return SUMMARY_WORDS.indexOf(h) >= 0; }).length;
    var tradeish = col(headers, ['B/S', 'Side', 'Buy/Sell', 'buyPrice', 'Price', 'Avg Fill Price', 'Entry Price']) >= 0;
    if (sumHits && !tradeish) return { report: 'summary', title: 'Account summary or balance report', basis: 'Contains balances or totals but no individual executions, so no trades can be built from it.', verified: 'names', cols: {} };
    // close to a Tradovate layout? say which columns are missing
    var near = ['performance', 'orders'].map(function (k) { var f = findCols(headers, LAYOUTS[k]); return { k: k, miss: f.missing, have: Object.keys(LAYOUTS[k].need).length - f.missing.length }; }).sort(function (a, b) { return b.have - a.have; })[0];
    return { report: null, near: near.have >= 3 ? { report: near.k, title: LAYOUTS[near.k].title, missing: near.miss } : null };
  }

  /* ---------- small readers ---------- */
  function cellAt(row, i) { return i == null || i < 0 ? '' : String(row[i] == null ? '' : row[i]).trim(); }
  function money(v) { var n = I.parseNumber(v); return n == null ? null : Math.round(n * 100); }
  function bump(o, k, line) { var c = o[k] || (o[k] = { n: 0, rows: [] }); c.n++; if (c.rows.length < 5) c.rows.push(line); }
  function idOrder(id) { return /^\d{1,15}$/.test(id) ? +id : null; }

  /* ---------- 2. rows -> fills ----------
     opts: same as TTImport (dateOrder, fileTz, targetTz, accountMap, defaultAccountId) plus feeTemplate {contract: cents per contract per side}
     and applyFeeTemplate (true = use your saved fee where the file has none). Returns everything the preview needs. */
  function read(parsed, report, opts) {
    opts = opts || {}; var spec = LAYOUTS[report]; if (!spec) throw new Error('unknown report');
    var c = findCols(parsed.headers, spec).cols, fills = [], problems = {}, unsupported = {}, warn = {}, pnlByKey = {}, amb = new Set(), skipped = {}, tplKeys = {};
    var info = { rows: parsed.rows.length, accounts: {}, from: null, to: null, reportedPnlCents: null, reportedRows: 0, feesInFile: false, contracts: {} };
    function seenDate(d) { if (!info.from || d < info.from) info.from = d; if (!info.to || d > info.to) info.to = d; }
    function acctOf(raw) { if (raw) info.accounts[raw] = (info.accounts[raw] || 0) + 1; var m = opts.accountMap || {}; return raw && m[raw] ? m[raw] : (raw ? null : (opts.defaultAccountId || null)); }
    function feeFor(contract, qty, fileCents) {
      if (fileCents != null) return { cents: fileCents, tpl: false };
      var t = opts.applyFeeTemplate && opts.feeTemplate ? opts.feeTemplate[contract] : null;
      return t != null && isFinite(t) && t >= 0 ? { cents: Math.round(t * qty), tpl: true } : { cents: null, tpl: false };
    }
    function push(f) { fills.push(f); seenDate(f.ts.date); info.contracts[f.contract] = (info.contracts[f.contract] || 0) + 1; if (f.tpl) tplKeys[f.key] = 1; }

    if (report === 'performance') {
      // Each row is one matched quantity: a buy fill and a sell fill. The same fill can appear on several rows (scale-outs), so fills are
      // rebuilt by id with their total quantity; the engine then pairs them again. Tradovate's own pnl per row is kept to check our maths.
      var byId = {}, totalPnl = 0, anyPnl = false;
      parsed.rows.forEach(function (row, i) {
        var line = i + 2, sym = cellAt(row, c.symbol), con = I.normalizeSymbol(sym);
        if (!con) { unsupported[sym || '(blank)'] = (unsupported[sym || '(blank)'] || 0) + 1; return; }
        var q = I.parseNumber(cellAt(row, c.qty)); if (q == null || !Number.isInteger(q) || q < 1) { bump(problems, 'quantity is not a whole number of 1 or more', line); return; }
        var bp = I.parseNumber(cellAt(row, c.buyPrice)), sp = I.parseNumber(cellAt(row, c.sellPrice));
        if (!(bp > 0) || !(sp > 0)) { bump(problems, 'buy or sell price is missing', line); return; }
        var bt = I.parseTimestamp(cellAt(row, c.bought), opts), st = I.parseTimestamp(cellAt(row, c.sold), opts);
        if (!bt || !st) { bump(problems, 'bought or sold time could not be read (check date order and time zone)', line); return; }
        var acctRaw = cellAt(row, c.account), acct = acctOf(acctRaw), pnl = c.pnl >= 0 ? money(cellAt(row, c.pnl)) : null;
        if (pnl != null) { anyPnl = true; totalPnl += pnl; } info.reportedRows++;
        var bid = cellAt(row, c.buyId), sid = cellAt(row, c.sellId);
        var sides = [['buy', bid, bp, bt], ['sell', sid, sp, st]], keysThisRow = [];
        sides.forEach(function (sd) {
          var id = sd[1], key = id ? 'tv:pf:' + (acctRaw || '') + ':' + id : 'tv:pr:' + I.hash([acctRaw, sym, sd[0], sd[2], cellAt(row, sd[0] === 'buy' ? c.bought : c.sold), line].join('|'));
          var ex = byId[key];
          if (ex) {
            if (ex.price !== sd[2] || ex.rawTime !== cellAt(row, sd[0] === 'buy' ? c.bought : c.sold) || ex.side !== sd[0]) { bump(problems, 'the same fill id appears with different prices or times (fill ' + id + ')', line); ex.conflict = true; return; }
            ex.qty += q; ex.lines.push(line);
          } else byId[key] = { key: key, side: sd[0], price: sd[2], ts: sd[3], rawTime: cellAt(row, sd[0] === 'buy' ? c.bought : c.sold), qty: q, account: acct, accountRaw: acctRaw, contract: con, lines: [line], order: idOrder(id), line: line, file: i };
          keysThisRow.push(key);
        });
        if (pnl != null && keysThisRow.length === 2) pnlByKey[keysThisRow[0]] = (pnlByKey[keysThisRow[0]] || 0) + pnl;   // counted once per row, on its buy fill
      });
      info.reportedPnlCents = anyPnl ? totalPnl : null;
      Object.keys(byId).forEach(function (k) {
        var f = byId[k]; if (f.conflict) return;
        if (!I.parseNumber || Math.abs(f.price * 100 - Math.round(f.price * 100)) > 1e-7) { bump(problems, 'price has more than 2 decimals (the journal stores 2)', f.line); return; }
        var fee = feeFor(f.contract, f.qty, null);
        push({ line: f.line, order: f.order != null ? f.order : f.file, contract: f.contract, side: f.side, qty: f.qty, price: f.price, feeCents: fee.cents, tpl: fee.tpl, ts: f.ts, account: f.account, accountRaw: f.accountRaw, key: f.key });
      });
    } else {
      var feeCol = c.fee != null ? c.fee : -1;
      parsed.rows.forEach(function (row, i) {
        var line = i + 2;
        if (report === 'orders') {
          var stv = cellAt(row, c.status).toLowerCase(), fq = I.parseNumber(cellAt(row, c.qty));
          if (!(fq > 0)) { skipped[stv || 'no status'] = (skipped[stv || 'no status'] || 0) + 1; return; }
          if (stv !== 'filled') bump(warn, 'orders with status "' + stv + '" that still filled some contracts are included', line);
          if (cellAt(row, c.spread)) { bump(problems, 'spread orders are not supported', line); return; }
        }
        var sym = cellAt(row, c.contract) || cellAt(row, c.product), con = I.normalizeSymbol(sym);
        if (!con && report === 'orders') con = I.normalizeSymbol(cellAt(row, c.product));
        if (!con) { unsupported[sym || '(blank)'] = (unsupported[sym || '(blank)'] || 0) + 1; return; }
        var side = I.parseSide(cellAt(row, c.side), 'fills'); if (!side) { bump(problems, 'Buy/Sell value not recognised', line); return; }
        var q = I.parseNumber(cellAt(row, c.qty)); if (q == null || !Number.isInteger(q) || q < 1) { bump(problems, 'quantity is not a whole number of 1 or more', line); return; }
        var pr = I.parseNumber(cellAt(row, c.price)); if (!(pr > 0)) { bump(problems, 'price is missing or not a positive number', line); return; }
        if (Math.abs(pr * 100 - Math.round(pr * 100)) > 1e-7) { bump(problems, report === 'orders' ? 'average fill price has more than 2 decimals: the order filled at several prices. Import the Performance report for these, or enter them by hand' : 'price has more than 2 decimals (the journal stores 2)', line); return; }
        var ts = I.parseTimestamp(cellAt(row, c.time), opts); if (!ts) { bump(problems, 'time could not be read (check date order and time zone)', line); return; }
        var fileFee = null; if (feeCol >= 0 && cellAt(row, feeCol) !== '') { var fn = I.parseNumber(cellAt(row, feeCol)); if (fn == null) { bump(problems, 'commission is not a number', line); return; } fileFee = Math.round(Math.abs(fn) * 100); info.feesInFile = true; }
        var acctRaw = cellAt(row, c.account), acct = acctOf(acctRaw), id = cellAt(row, c.id);
        var key = id ? 'tv:' + (report === 'orders' ? 'o' : 'f') + ':' + (acctRaw || '') + ':' + id : 'tv:h:' + I.hash([acctRaw, sym, side, q, pr, cellAt(row, c.time), line].join('|'));
        var fee = feeFor(con, q, fileFee);
        push({ line: line, order: idOrder(id) != null ? idOrder(id) : i, contract: con, side: side, qty: q, price: pr, feeCents: fee.cents, tpl: fee.tpl, ts: ts, account: acct, accountRaw: acctRaw, key: key });
        info.reportedRows++;
      });
      // repeated ids (the same report pasted twice into one file) are dropped, keeping the first
      var seen = {}; fills = fills.filter(function (f) { if (seen[f.key]) { bump(warn, 'repeated rows with the same id were counted once', f.line); return false; } seen[f.key] = 1; return true; });
    }
    // ambiguity: an opposite-side fill in the same second on the same account+contract cannot be ordered from time alone
    var bySec = {}; fills.forEach(function (f) { if (!f.ts.hasTime) { amb.add(f.key); return; } var k = (f.accountRaw || f.account || '') + '|' + f.contract + '|' + f.ts.date + ' ' + f.ts.time + ':' + f.ts.sec; (bySec[k] || (bySec[k] = [])).push(f); });
    Object.keys(bySec).forEach(function (k) { var g = bySec[k]; if (g.length > 1 && g.some(function (x) { return x.side === 'buy'; }) && g.some(function (x) { return x.side === 'sell'; }) && !g.every(function (x) { return typeof x.order === 'number' && x.key.indexOf(':h:') < 0 && x.key.indexOf(':pr:') < 0; })) g.forEach(function (x) { amb.add(x.key); }); });
    var unmatched = Object.keys(info.accounts).filter(function (a) { return !(opts.accountMap && opts.accountMap[a]); });
    return { fills: fills, problems: problems, unsupported: unsupported, warnings: warn, skipped: skipped, pnlByKey: pnlByKey, ambiguousKeys: amb, tplKeys: tplKeys, info: info, unmatchedAccounts: unmatched, feesInFile: info.feesInFile || false };
  }

  /* ---------- 3. extra journal fields filled in automatically (only what can be calculated) ---------- */
  // Session from entry time in YOUR journal time zone, only when exactly one of your session windows was open. Overlaps stay blank.
  function sessionAt(date, time, tz, cfgs) {
    if (!date || !time || !SES || !cfgs || !cfgs.length) return '';
    var d = date.split('-').map(Number), t = time.split(':').map(Number), ms;
    try { ms = SES.wallToInstant(d[0], d[1], d[2], t[0], t[1], tz || 'UTC'); } catch (e) { return ''; }
    var open = cfgs.filter(function (c) { try { return SES.sessionState(ms, c).open; } catch (e) { return false; } });
    if (open.length !== 1) return '';
    var nm = open[0].name; return nm === 'Asia' || nm === 'London' || nm === 'New York' ? nm : '';
  }
  function enricher(read, opts) {
    return function (raw, keys) {
      raw.srcInfo = { broker: 'tradovate', report: opts.report || '', account: '' };
      var acc = read.fills.filter(function (f) { return f.key === keys[0]; })[0]; if (acc && acc.accountRaw) raw.srcInfo.account = acc.accountRaw;
      if (raw.feesCents != null) raw.feeSource = keys.some(function (k) { return read.tplKeys[k]; }) ? 'template' : 'file';
      if (opts.autoSession && !raw.session) { var s = sessionAt(raw.date, raw.time, opts.targetTz, opts.sessions); if (s) raw.session = s; }
      if (opts.defaults) { if (opts.defaults.strategy && !raw.strategy) raw.strategy = opts.defaults.strategy; if (opts.defaults.tags && opts.defaults.tags.length) raw.tags = opts.defaults.tags.slice(0, 12); }
    };
  }

  /* ---------- 4. reconciliation against the file's own numbers ----------
     Compares what the journal will calculate with what Tradovate reported, before anything is saved. */
  function reconcile(plan, read, userTotalCents) {
    var inc = plan.trades.concat(plan.possible || [], plan.ambiguous || []);
    var r = { items: [], level: 'good' };
    function add(level, text) { r.items.push({ level: level, text: text }); if (level === 'bad' || (level === 'warn' && r.level === 'good')) r.level = level; }
    var closed = plan.trades.filter(function (x) { return x.c.isClosed; }), gross = closed.reduce(function (a, x) { return a + x.c.grossCents; }, 0);
    var withFile = plan.trades.filter(function (x) { return x.filePnlCents != null && x.c.isClosed; });
    if (withFile.length) {
      var bad = withFile.filter(function (x) { return Math.abs(x.c.grossCents - x.filePnlCents) > 1; });
      if (bad.length) add('bad', bad.length + ' of ' + withFile.length + ' trades do not match the P&L Tradovate reported (differences up to ' + (Math.max.apply(null, bad.map(function (x) { return Math.abs(x.c.grossCents - x.filePnlCents); })) / 100).toFixed(2) + '). Check the contract and prices before importing.');
      else add('good', 'All ' + withFile.length + ' closed trades match the P&L Tradovate reported, to the cent.');
    }
    if (read.info.reportedPnlCents != null) {
      var fileTotalIncluded = 0, missing = 0; Object.keys(read.pnlByKey).forEach(function (k) { fileTotalIncluded += read.pnlByKey[k]; });
      var shown = plan.trades.reduce(function (a, x) { return a + (x.filePnlCents || 0); }, 0);
      missing = fileTotalIncluded - shown;
      add(missing === 0 ? 'good' : 'warn', 'File total P&L ' + (fileTotalIncluded / 100).toFixed(2) + '; trades being imported now account for ' + (shown / 100).toFixed(2) + (missing ? ' (the difference belongs to rows that are skipped, duplicates or held for review)' : '') + '.');
    }
    if (userTotalCents != null && isFinite(userTotalCents)) {
      var d = gross - userTotalCents;
      add(Math.abs(d) <= 1 ? 'good' : 'warn', 'You entered ' + (userTotalCents / 100).toFixed(2) + ' from Tradovate; the closed trades here add up to ' + (gross / 100).toFixed(2) + ' gross' + (Math.abs(d) > 1 ? ' (difference ' + (d / 100).toFixed(2) + '; Tradovate figures may be net of fees or include other days or accounts)' : '') + '.');
    }
    var feeKnown = plan.trades.filter(function (x) { return x.trade.feesCents != null; }).length;
    if (!read.feesInFile) add('warn', 'This report has no commissions. ' + (feeKnown ? feeKnown + ' trades use your saved per-contract fees; ' : '') + (plan.trades.length - feeKnown) + ' trades will show fees as Unavailable (net P&L unknown) until you add them.');
    var accts = Object.keys(read.info.accounts); if (accts.length) add(read.unmatchedAccounts.length ? 'bad' : 'good', 'Accounts in the file: ' + accts.map(function (a) { return a + ' (' + read.info.accounts[a] + ' rows)'; }).join(', ') + (read.unmatchedAccounts.length ? '. Choose a journal account for each before importing.' : '.'));
    add('good', 'Rows in file: ' + read.info.rows + ' · fills used: ' + read.fills.length + ' · trades built: ' + (inc.length + plan.duplicates + plan.partial.length) + '.');
    return r;
  }

  /* ---------- 5. text that came from a screenshot (OCR) or a loose paste -> a table ----------
     words: [{text, conf}] lines. A header line with known column names fixes the column order; each later line must produce exactly
     that many values, otherwise it is kept as an unreadable line for you to fix. Values read with low confidence are marked. */
  var HEAD_WORDS = { 'b/s': 'B/S', bs: 'B/S', bis: 'B/S', 'b/5': 'B/S', '8/s': 'B/S', 'bls': 'B/S', 'b|s': 'B/S', filledqty: 'Filled Qty', avgfillprice: 'Avg Fill Price', avgprice: 'Avg Fill Price', filltime: 'Fill Time', productdescription: 'Product Description', product: 'Product', orderid: 'orderId', fillid: 'Fill ID', commission: 'Commission', commissions: 'Commission', fees: 'Fees', side: 'B/S', contract: 'Contract', symbol: 'symbol', qty: 'qty', quantity: 'Quantity', 'filled': 'Filled Qty', price: 'Price', 'avg': 'Avg Fill Price', 'fill': 'Fill Time', time: 'Timestamp', status: 'Status', account: 'Account', pnl: 'pnl', 'p&l': 'pnl', buyprice: 'buyPrice', sellprice: 'sellPrice', boughttimestamp: 'boughtTimestamp', soldtimestamp: 'soldTimestamp', bought: 'boughtTimestamp', sold: 'soldTimestamp' };
  function joinTimes(tokens) {
    var out = []; for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{4}-\d{2}-\d{2}$/.test(t.text) && tokens[i + 1] && /^\d{1,2}:\d{2}(:\d{2})?$/.test(tokens[i + 1].text)) {
        var ap = tokens[i + 2] && /^(am|pm)$/i.test(tokens[i + 2].text) ? tokens[i + 2] : null;
        out.push({ text: t.text + ' ' + tokens[i + 1].text + (ap ? ' ' + ap.text.toUpperCase() : ''), conf: Math.min(t.conf, tokens[i + 1].conf, ap ? ap.conf : 100) }); i += ap ? 2 : 1;
      } else out.push(t);
    } return out;
  }
  function headerFromLine(tokens) {
    var raw = tokens.map(function (t) { return t.text.toLowerCase().replace(/[^a-z0-9&\/|]/g, ''); }), h = [];
    for (var i = 0; i < raw.length; i++) {
      var a = raw[i], b = raw[i + 1] || '';
      if ((a === 'filled' && (b === 'qty' || b === 'quantity')) || (a === 'fill' && b === 'time') || (a === 'avg' && (b === 'fill' || b === 'price'))) {
        h.push(a === 'filled' ? 'Filled Qty' : a === 'fill' ? 'Fill Time' : 'Avg Fill Price'); i += (a === 'avg' && b === 'fill' && raw[i + 2] === 'price') ? 2 : 1; continue;
      }
      if ((a === 'buy' || a === 'sell') && b === 'price') { h.push(a === 'buy' ? 'buyPrice' : 'sellPrice'); i++; continue; }
      if (HEAD_WORDS[a]) h.push(HEAD_WORDS[a]); else if (a) h.push(tokens[i].text);
    }
    return h;
  }
  // Same as headerFromLine, but keeps where each heading sits (x from..to) so values can be placed under the right heading.
  function headerSpans(tokens) {
    var raw = tokens.map(function (t) { return t.text.toLowerCase().replace(/[^a-z0-9&\/|]/g, ''); }), out = [];
    function span(a, b, name) { out.push({ name: name, x0: tokens[a].x, x1: tokens[b].x + tokens[b].w }); }
    for (var i = 0; i < raw.length; i++) {
      var a = raw[i], b = raw[i + 1] || '';
      if ((a === 'filled' && (b === 'qty' || b === 'quantity')) || (a === 'fill' && b === 'time') || (a === 'avg' && (b === 'fill' || b === 'price'))) {
        var j = i + ((a === 'avg' && b === 'fill' && raw[i + 2] === 'price') ? 2 : 1); span(i, j, a === 'filled' ? 'Filled Qty' : a === 'fill' ? 'Fill Time' : 'Avg Fill Price'); i = j; continue;
      }
      if ((a === 'buy' || a === 'sell') && b === 'price') { span(i, i + 1, a === 'buy' ? 'buyPrice' : 'sellPrice'); i++; continue; }
      if (HEAD_WORDS[a]) span(i, i, HEAD_WORDS[a]); else if (a) span(i, i, tokens[i].text);
    }
    return out;
  }
  // Words with positions (from the text reader) -> lines (by vertical position) -> a table using the heading positions as columns.
  function toLines(words) {
    var ws = words.filter(function (w) { return w.text && w.h > 0 && /[A-Za-z0-9]/.test(w.text); })   // borders and rules come out as dashes and marks.slice().sort(function (a, b) { return (a.y + a.h / 2) - (b.y + b.h / 2); });
    if (!ws.length) return [];
    var hs = ws.map(function (w) { return w.h; }).sort(function (a, b) { return a - b; }), mh = hs[Math.floor(hs.length / 2)], lines = [], cur = null;
    ws.forEach(function (w) { var cy = w.y + w.h / 2; if (cur && Math.abs(cy - cur.cy) <= mh * 0.6) { cur.w.push(w); cur.cy = (cur.cy * (cur.w.length - 1) + cy) / cur.w.length; } else { cur = { cy: cy, w: [w] }; lines.push(cur); } });
    return lines.map(function (l) { return l.w.sort(function (a, b) { return a.x - b.x; }); });
  }
  function canonHead(text) {
    var k = String(text).toLowerCase().replace(/[^a-z0-9&\/|]/g, ''); if (HEAD_WORDS[k]) return HEAD_WORDS[k];
    var m = { filledquantity: 'Filled Qty', buyfillid: 'buyFillId', sellfillid: 'sellFillId', boughttimestamp: 'boughtTimestamp', soldtimestamp: 'soldTimestamp', datetime: 'Timestamp', 'date/time': 'Timestamp' }; return m[k] || String(text).trim();
  }
  // Rows of a table: a new row starts on a line that has text at the table's left edge; lines without it are the 2nd line of a wrapped cell.
  function toBands(lines, mh) {
    // Wrapped cells are centred vertically, so a continuation line can sit above or below its row: attach it to the nearest row.
    var left = Math.min.apply(null, lines.map(function (l) { return l[0].x; })), cy = function (l) { return l.reduce(function (a, w) { return a + w.y + w.h / 2; }, 0) / l.length; };
    var anchors = [], rest = [];
    lines.forEach(function (l) { (l[0].x <= left + mh * 1.2 ? anchors : rest).push(l); });
    var bands = anchors.map(function (l) { return { cy: cy(l), w: l.slice() }; });
    rest.forEach(function (l) { var c = cy(l), best = null; bands.forEach(function (b) { if (!best || Math.abs(b.cy - c) < Math.abs(best.cy - c)) best = b; }); if (best) best.w = best.w.concat(l); });
    return bands.map(function (b) { return b.w; });
  }
  // Heading words that overlap or nearly touch horizontally belong to one column ("Avg Fill" over "Price").
  function headColumns(band, mh) {
    var ws = band.slice().sort(function (a, b) { return a.x - b.x; }), cols = [];
    ws.forEach(function (w) { var c = cols[cols.length - 1]; if (c && w.x <= c.x1 + mh * 0.9) { c.w.push(w); c.x1 = Math.max(c.x1, w.x + w.w); } else cols.push({ x0: w.x, x1: w.x + w.w, w: [w] }); });
    return cols.map(function (c) { var t = c.w.slice().sort(function (a, b) { return (Math.abs(a.y - b.y) > mh * 0.6 ? a.y - b.y : a.x - b.x); }).map(function (w) { return w.text; }).join(' '); return { name: canonHead(t), raw: t, x0: c.x0, x1: c.x1 }; });
  }
  function fromWords(words, minConf) {
    minConf = minConf == null ? 80 : minConf;
    var lines = toLines(words); if (!lines.length) return { ok: false, error: 'No text was found in the picture.' };
    var hs = [].concat.apply([], lines).map(function (w) { return w.h; }).sort(function (a, b) { return a - b; }), mh = hs[Math.floor(hs.length / 2)];
    var bands = toBands(lines, mh), hi = -1, spans = null;
    for (var i = 0; i < bands.length && hi < 0; i++) { var sp = headColumns(bands[i], mh), d = detect(sp.map(function (x) { return x.name; })); if (d.report && d.report !== 'summary') { hi = i; spans = sp; } }
    if (hi < 0) return { ok: false, error: 'No table heading was recognised in the screenshot. Make sure the column titles (for example B/S, Contract, Fill Time) are visible, crop out other panels, or paste the report as text instead.', lines: lines.length };
    var cuts = []; for (var k = 0; k < spans.length - 1; k++) cuts.push((spans[k].x1 + spans[k + 1].x0) / 2);
    var rows = [], low = [], bad = [], confs = [];
    bands.slice(hi + 1).forEach(function (band, j) {
      var cells = spans.map(function () { return []; }), conf = spans.map(function () { return 100; });
      band.forEach(function (w) { var cx = w.x + w.w / 2, c = 0; while (c < cuts.length && cx > cuts[c]) c++; cells[c].push(w); conf[c] = Math.min(conf[c], w.conf); });
      var vals = cells.map(function (c) { return c.sort(function (a, b) { return Math.abs(a.y - b.y) > mh * 0.6 ? a.y - b.y : a.x - b.x; }).map(function (w) { return w.text; }).join(' ').trim(); }), filled = vals.filter(Boolean).length;
      if (filled < Math.min(3, spans.length)) { if (filled) bad.push({ line: j + 1, text: vals.join(' ').trim() }); return; }
      rows.push(vals); low.push(conf.map(function (c, ci) { return !!vals[ci] && c < minConf; })); confs.push(conf);
    });
    return { ok: rows.length > 0, error: rows.length ? null : 'The heading was found but no rows could be read.', headers: spans.map(function (x) { return x.name; }), rows: rows, lowConf: low, conf: confs, unreadable: bad, delimiter: 'ocr' };
  }
  /* Does a cell look right for its column? Used to pick between reading passes and to highlight cells for you to check. */
  var QTY = ['Filled Qty', 'qty', 'Quantity'], PRICE = ['Avg Fill Price', 'Price', 'buyPrice', 'sellPrice', 'avgPrice'], CON = ['Contract', 'symbol'], TIME = ['Fill Time', 'Timestamp', 'boughtTimestamp', 'soldTimestamp'];
  function cellValid(head, v) {
    v = String(v == null ? '' : v).trim(); if (!v) return null;
    if (QTY.indexOf(head) >= 0) { var q = I.parseNumber(v); return q != null && Number.isInteger(q) && q >= 0; }
    if (PRICE.indexOf(head) >= 0) { var p = I.parseNumber(v); return p != null && p > 0; }
    if (CON.indexOf(head) >= 0) return !!I.normalizeSymbol(v);
    if (TIME.indexOf(head) >= 0) return !!I.parseTimestamp(v, {});
    if (head === 'B/S') return !!I.parseSide(v, 'fills');
    if (head === 'pnl') return I.parseNumber(v) != null;
    return true;
  }
  function scoreTable(t) { if (!t || !t.ok) return -1; var sc = 0; t.rows.forEach(function (r, i) { r.forEach(function (v, j) { var ok = cellValid(t.headers[j], v); if (ok === true) sc += t.lowConf[i][j] ? 1 : 2; else if (ok === false) sc -= 2; }); }); return sc; }
  function isClean(t) { return t && t.ok && t.rows.every(function (r, i) { return r.every(function (v, j) { return cellValid(t.headers[j], v) !== false && !t.lowConf[i][j]; }); }); }
  // Several readings of the same picture with the same shape: keep, per cell, the valid value read with the most confidence.
  function mergeTables(list, minConf) {
    minConf = minConf == null ? 80 : minConf; var ok = list.filter(function (t) { return t && t.ok; }); if (!ok.length) return list[0];
    ok.sort(function (a, b) { return scoreTable(b) - scoreTable(a); }); var base = ok[0];
    var same = ok.filter(function (t) { return t.headers.join('|') === base.headers.join('|') && t.rows.length === base.rows.length; });
    var out = { ok: true, headers: base.headers, rows: [], lowConf: [], conf: [], unreadable: base.unreadable, delimiter: 'ocr', passes: same.length };
    base.rows.forEach(function (r, i) {
      var row = [], lo = [], cf = [];
      r.forEach(function (v, j) {
        var best = null; same.forEach(function (t) { var val = t.rows[i][j], c = t.conf ? t.conf[i][j] : (t.lowConf[i][j] ? 0 : 100), good = cellValid(base.headers[j], val); var rank = (good === true ? 2 : good === null ? 1 : 0) * 1000 + c; if (!best || rank > best.rank) best = { v: val, c: c, rank: rank, good: good }; });
        row.push(best.v); cf.push(best.c); lo.push(!!best.v && (best.c < minConf || best.good === false));
      });
      out.rows.push(row); out.lowConf.push(lo); out.conf.push(cf);
    });
    return out;
  }
  function fromLines(lines, minConf) {
    minConf = minConf == null ? 80 : minConf; var hi = -1, headers = null;
    for (var i = 0; i < lines.length && hi < 0; i++) { var h = headerFromLine(lines[i]); var d = detect(h); if (d.report && d.report !== 'summary') { hi = i; headers = h; } }
    if (hi < 0) return { ok: false, error: 'No table heading was recognised. Make sure the column titles (for example B/S, Contract, Fill Time) are in the screenshot, or paste the report as text instead.' };
    var rows = [], low = [], bad = [];
    lines.slice(hi + 1).forEach(function (ln, j) {
      var toks = joinTimes(ln.filter(function (t) { return t.text.trim(); })); if (!toks.length) return;
      if (toks.length !== headers.length) { bad.push({ line: j + 1, text: toks.map(function (t) { return t.text; }).join(' '), want: headers.length, got: toks.length }); return; }
      rows.push(toks.map(function (t) { return t.text; })); low.push(toks.map(function (t) { return t.conf < minConf; }));
    });
    return { ok: rows.length > 0, error: rows.length ? null : 'The heading was found but no rows could be read.', headers: headers, rows: rows, lowConf: low, unreadable: bad, delimiter: 'ocr' };
  }
  // Plain pasted text with no tabs or commas (e.g. copied from a web page as spaces): split on 2+ spaces.
  function parsePasted(text) {
    var t = String(text || '').replace(/ /g, ' ');
    if (/\t/.test(t) || /,/.test(t.split(/\r?\n/)[0] || '')) return I.parseCsv(t);
    var lines = t.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) return { ok: false, error: 'Paste at least a heading row and one row of trades.' };
    var multi = lines.every(function (l) { return / {2,}/.test(l) || l.split(' ').length === 1; });
    if (multi) return I.parseCsv(lines.map(function (l) { return l.split(/ {2,}/).join('\t'); }).join('\n'), '\t');
    var r = fromLines(lines.map(function (l) { return l.split(/\s+/).map(function (w) { return { text: w, conf: 100 }; }); }));
    return r.ok ? { ok: true, delimiter: 'space', headers: r.headers, rows: r.rows, unreadable: r.unreadable } : { ok: false, error: r.error };
  }

  /* ---------- 6. summary-only reports: keep the numbers as a reference ---------- */
  function summaryOf(parsed) { return { headers: parsed.headers.slice(0, 40), rows: parsed.rows.slice(0, 200).map(function (r) { return r.slice(0, 40).map(function (v) { return String(v).slice(0, 60); }); }) }; }

  var api = { LAYOUTS: LAYOUTS, detect: detect, read: read, enricher: enricher, reconcile: reconcile, sessionAt: sessionAt, fromLines: fromLines, fromWords: fromWords, mergeTables: mergeTables, scoreTable: scoreTable, isClean: isClean, cellValid: cellValid, toLines: toLines, parsePasted: parsePasted, headerFromLine: headerFromLine, summaryOf: summaryOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTTradovate = api;
})(typeof window !== 'undefined' ? window : globalThis);
