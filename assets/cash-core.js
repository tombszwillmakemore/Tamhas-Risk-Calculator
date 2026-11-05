/* Tamhas Trading - cash accounting engine (pure logic: no DOM, no storage, no network). Node-testable. Exact integer minor units only.

   ONE engine for every money figure about an account: the account panel, the Cashflow screen, Copilot and exports all call summarize().

   Layers (nothing is ever merged silently):
     1. original records    - each imported row is kept with its file, line and raw cells (source.raw) so it can be re-processed
     2. normalised entries  - ledger records of type 'cash' {category, brokerType, amountCents (signed change), balanceAfterCents|null, ...}
     3. trades              - the journal (fills paired into trades) - analytics, and the P&L source only where no Cash History exists
     4. authoritative cash  - decided by the AUTHORITY RULE below
     5. derived figures     - totals, balances, checkpoints, status, return

   AUTHORITY RULE (prevents double counting between report types):
     Inside the period covered by an imported Cash History (first..last cash record of that account), the Cash History is the only source of
     cash: trading P&L (TradePaired), fees, deposits, withdrawals, adjustments. Journal trades and hand-entered money records in that period are
     NOT added again; they are listed as "not counted (Cash History is the source)" and cross-checked. Outside that period, journal trades
     (net of known fees) and hand-entered records are used, and the result is labelled estimated / partially reconciled.

   Nothing is inferred: an unknown opening balance stays unknown (never 0), unknown transaction types are held for your decision, estimated
   fees are labelled, and no balancing entry is ever created to make numbers match. */
(function (root) {
  'use strict';
  var DEF = 'acct-default';
  var MINOR = { USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, CHF: 2, JPY: 0 };
  function digitsOf(cur) { return Object.prototype.hasOwnProperty.call(MINOR, cur) ? MINOR[cur] : 2; }

  /* ---------- exact amounts ---------- */
  // Which decimal mark a column uses, from all of its values. 'ambiguous' (e.g. only "1,234") means TRC must ask - it never guesses.
  function detectDecimal(values) {
    var dot = 0, comma = 0, amb = 0;
    (values || []).forEach(function (v) {
      var s = String(v == null ? '' : v).replace(/[^0-9.,]/g, ''); if (!s) return;
      var li = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
      if (s.indexOf('.') >= 0 && s.indexOf(',') >= 0) { if (s[li] === '.') dot++; else comma++; return; }
      if (s.indexOf(',') >= 0) { if (/^\d{1,3}(,\d{3})+$/.test(s)) amb++; else comma++; return; }   // "1,234" could be either reading
      if (s.indexOf('.') >= 0) { if (/^\d{1,3}(\.\d{3})+$/.test(s) && !/\.\d{1,2}$/.test(s)) amb++; else dot++; }
    });
    if (dot && comma) return 'mixed'; if (comma) return 'comma'; if (dot) return 'dot'; return amb ? 'ambiguous' : 'dot';
  }
  /* "1,234.56", "(25.50)", "-$3", "$3-", "+4", "1.234,56" (decimal 'comma'), "USD 12" -> {ok, minor, rounded}. String maths, never floats. */
  function parseMinor(v, opts) {
    opts = opts || {}; var dig = opts.digits == null ? 2 : opts.digits, dec = opts.decimal || 'dot';
    var s = String(v == null ? '' : v).trim(); if (!s || /^(null|n\/a|na|-|—)$/i.test(s)) return { ok: false, empty: true };
    var neg = false;
    s = s.replace(/^(USD|EUR|GBP|CAD|AUD|CHF|JPY)\s*|\s*(USD|EUR|GBP|CAD|AUD|CHF|JPY)$/i, '').replace(/[$€£¥\s ']/g, '');
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).replace(/^[$€£¥]/, ''); }
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (s[0] === '-') { neg = !neg; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    s = s.replace(/^[$€£¥]/, '');
    var intp, frac;
    if (dec === 'comma') { if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return { ok: false }; var a = s.replace(/\./g, '').split(','); intp = a[0]; frac = a[1] || ''; }
    else { if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$|^\.\d+$/.test(s)) return { ok: false }; var b = s.replace(/,/g, '').split('.'); intp = b[0] || '0'; frac = b[1] || ''; }
    if (intp.length > 13) return { ok: false, tooLarge: true };
    var keep = (frac + '0'.repeat(dig)).slice(0, dig), rest = frac.slice(dig), minor = parseInt(intp + keep, 10) || 0, rounded = false;
    if (rest && /[1-9]/.test(rest)) { rounded = true; if (+rest[0] >= 5) minor += 1; }        // half away from zero on the absolute value
    return { ok: true, minor: neg && minor ? -minor : minor, rounded: rounded };
  }
  function fmt(minor, cur, sign) {
    if (minor == null) return '—'; var d = digitsOf(cur || 'USD'), a = Math.abs(minor), p = Math.pow(10, d), i = Math.floor(a / p), f = d ? '.' + String(a % p).padStart(d, '0') : '';
    var sym = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$', CHF: 'CHF ' }[cur || 'USD'] || ((cur || '') + ' ');
    return (minor < 0 ? '−' : sign && minor > 0 ? '+' : '') + sym + String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + f;
  }

  /* ---------- transaction categories ---------- */
  // group: trading | fee | cashflow | other. Original broker types are always kept next to the category.
  var CATS = {
    trade_pnl: ['Realized trading P&L', 'trading'], trade_reversal: ['Trade reversal (cancelled paired trade)', 'trading'], options_trade: ['Options trade', 'trading'], swap_trade: ['Swap trade', 'trading'],
    commission: ['Commissions', 'fee'], exchange_fee: ['Exchange fees', 'fee'], clearing_fee: ['Clearing fees', 'fee'], regulatory_fee: ['Regulatory (NFA) fees', 'fee'], routing_fee: ['Order routing fees', 'fee'],
    platform_fee: ['Platform fees', 'fee'], data_fee: ['Market data fees', 'fee'], inactivity_fee: ['Inactivity fees', 'fee'], funding_fee: ['Deposit / withdrawal fees', 'fee'], other_fee: ['Other fees', 'fee'],
    rebate: ['Rebates and credits', 'fee'], refund: ['Refunds', 'fee'],
    deposit: ['Deposits', 'cashflow'], withdrawal: ['Withdrawals', 'cashflow'], transfer_in: ['Transfers in', 'cashflow'], transfer_out: ['Transfers out', 'cashflow'], payout: ['Payouts', 'cashflow'],
    interest: ['Interest', 'other'], dividend: ['Dividends', 'other'], adjustment: ['Broker adjustments', 'other'], correction: ['Corrections', 'other'], reversal: ['Reversals', 'other'],
    conversion: ['Currency conversions', 'other'], settlement: ['Settlement adjustments', 'other'], funding_payment: ['Funding payments', 'other'], session: ['Session marker (no money)', 'other'], other: ['Other', 'other']
  };
  // Trading fees reduce net trading P&L. Account fees (data, platform, inactivity, funding, other) reduce the balance only.
  var TRADING_FEES = ['commission', 'exchange_fee', 'clearing_fee', 'regulatory_fee', 'routing_fee'];
  var FEE_CATS = ['commission', 'exchange_fee', 'clearing_fee', 'regulatory_fee', 'routing_fee', 'platform_fee', 'data_fee', 'inactivity_fee', 'funding_fee', 'other_fee'];
  function label(c) { return CATS[c] ? CATS[c][0] : c; }
  function group(c) { return CATS[c] ? CATS[c][1] : 'other'; }
  // Tradovate cashChangeType -> category. FundTransaction carries both deposits and withdrawals, so its direction comes from the sign
  // (marked 'bySign' so the preview says so). Source: Tradovate CashBalanceLog entity documentation (42 documented values).
  var TV_TYPES = {
    TradePaired: 'trade_pnl', CancelledPairedTrade: 'trade_reversal', OptionsTrade: 'options_trade', SwapTrade: 'swap_trade',
    Commission: 'commission', ExchangeFee: 'exchange_fee', ClearingFee: 'clearing_fee', NfaFee: 'regulatory_fee', OrderRoutingFee: 'routing_fee', BrokerageFee: 'other_fee',
    TradovateSubscription: 'platform_fee', MarketDataSubscription: 'data_fee', EntitlementSubscription: 'data_fee', InactivityFee: 'inactivity_fee', DormantFee: 'inactivity_fee',
    FundTransactionFee: 'funding_fee', DepositFee: 'funding_fee', NsfCheckFee: 'funding_fee', StopPaymentFee: 'funding_fee', CurrencyConversionFee: 'other_fee',
    AccountClosureFee: 'other_fee', AddUserFee: 'other_fee', DeskFee: 'other_fee', IPFee: 'other_fee', LiquidationFee: 'other_fee', LiquidationFee2: 'other_fee', RithmicFee: 'other_fee', SeatLeasePayment: 'other_fee', ThirdPartyFee: 'other_fee',
    Courtesy: 'rebate', GoodwillCredit: 'rebate', PROMO: 'rebate',
    FundTransaction: 'fund', ChallengePayout: 'payout', Escheatment: 'withdrawal',
    ManualAdjustment: 'adjustment', AutomaticReconciliation: 'adjustment', Debit: 'adjustment', CurrencyConversion: 'conversion', CashSettlement: 'settlement', FundingRate: 'funding_payment', NewSession: 'session'
  };
  var TV_KEY = {}; Object.keys(TV_TYPES).forEach(function (k) { TV_KEY[k.toLowerCase()] = k; });
  function tvType(raw) { var k = String(raw == null ? '' : raw).replace(/[\s_-]/g, '').toLowerCase(); return TV_KEY[k] || null; }
  function categorize(brokerType, amountMinor) {
    var t = tvType(brokerType); if (!t) return null; var c = TV_TYPES[t];
    if (c === 'fund') return { category: amountMinor < 0 ? 'withdrawal' : 'deposit', bySign: true, type: t };
    return { category: c, bySign: false, type: t };
  }

  /* ---------- Tradovate Cash History adapter (versioned) ---------- */
  var ADAPTER = 'tradovate-cash@1';
  function L(h) { return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var COLS = { type: ['cashChangeType', 'Cash Change Type', 'Change Type', 'Type'], delta: ['delta', 'Delta', 'Change', 'Cash Change'], amount: ['amount', 'Amount', 'Total Amount', 'Cash Balance', 'Balance'],
    time: ['timestamp', 'Timestamp', 'Time', 'Date/Time', 'Date Time'], date: ['tradeDate', 'Trade Date', 'Date'], account: ['account', 'Account', 'accountId', 'Account ID', 'Account Name', 'accountName'],
    id: ['id', 'ID', 'Id', 'Cash Balance Log ID', 'Transaction ID'], currency: ['currency', 'Currency', 'currencyId', 'Currency ID'], fund: ['fundTransactionId', 'Fund Transaction ID'], pair: ['fillPairId', 'Fill Pair ID'],
    fill: ['fillId', 'Fill ID'], comment: ['comment', 'Comment', 'Description', 'Text', 'Notes'], realized: ['realizedPnL', 'Realized P&L', 'Realized PnL'] };
  function findCols(headers) {
    var hs = headers.map(L), out = {}, used = {};
    Object.keys(COLS).forEach(function (k) { out[k] = -1; COLS[k].some(function (n) { var i = hs.indexOf(L(n)); if (i >= 0 && !used[i]) { out[k] = i; used[i] = 1; return true; } return false; }); });
    return out;
  }
  // Is this a Cash History? Needs a type column whose values are documented Tradovate cash types, an amount/delta column and a date.
  function detect(parsed) {
    if (!parsed || !parsed.headers) return null;
    var c = findCols(parsed.headers); if (c.type < 0 || (c.delta < 0 && c.amount < 0) || (c.time < 0 && c.date < 0)) return null;
    var sample = parsed.rows.slice(0, 200), known = sample.filter(function (r) { return tvType(r[c.type]); }).length;
    if (!sample.length || !known || known / sample.length < 0.5) return null;
    return { report: 'cash', title: 'Tradovate Cash History', adapter: ADAPTER, cols: c, verified: 'documented-fields',
      basis: 'Column names and types match Tradovate\'s documented cash balance log (CashBalanceLog). Not yet tested on a real Cash History export file, so check the preview.' };
  }

  function cell(row, i) { return i == null || i < 0 ? '' : String(row[i] == null ? '' : row[i]).trim(); }
  // How the money columns must be read. Never guessed: when the file does not prove one reading, the person chooses.
  function interpret(parsed, cols, choice) {
    var hasD = cols.delta >= 0, hasA = cols.amount >= 0, dec = detectDecimal(parsed.rows.map(function (r) { return cell(r, hasD ? cols.delta : cols.amount); }).concat(hasA ? parsed.rows.map(function (r) { return cell(r, cols.amount); }) : []));
    var out = { decimal: dec === 'comma' ? 'comma' : 'dot', decimalIssue: dec === 'ambiguous' || dec === 'mixed' ? dec : null, mode: null, needsChoice: false, evidence: '', choices: [] };
    if (choice && choice.decimal) { out.decimal = choice.decimal; out.decimalIssue = null; }
    var num = function (r, i) { var p = parseMinor(cell(r, i), { decimal: out.decimal }); return p.ok ? p.minor : null; };
    if (hasD && hasA) {
      // Sorted in time order per account, does amount(i) == amount(i-1) + delta(i)? Then amount is the balance after each change.
      var by = {}; parsed.rows.forEach(function (r, i) { var k = cell(r, cols.account); (by[k] || (by[k] = [])).push({ r: r, i: i, t: Date.parse(cell(r, cols.time) || cell(r, cols.date)) || 0, id: +cell(r, cols.id) || 0 }); });
      var pairs = 0, hit = 0, same = 0, n = 0;
      Object.keys(by).forEach(function (k) {
        var l = by[k].sort(function (a, b) { return a.t - b.t || a.id - b.id || a.i - b.i; });
        l.forEach(function (x, j) { var d = num(x.r, cols.delta), a = num(x.r, cols.amount); if (d != null && a != null) { n++; if (d === a) same++; } if (!j) return; var pa = num(l[j - 1].r, cols.amount); if (pa == null || a == null || d == null) return; pairs++; if (pa + d === a) hit++; });
      });
      if (pairs && hit / pairs >= 0.8) {   /* a few broken links are reported by the engine as statement discrepancies */ out.mode = 'delta+balance'; out.evidence = hit + ' of ' + pairs + ' rows: previous Amount + Delta = Amount, so Delta is the change and Amount is the cash balance after it.'; }
      else if (n && same === n) { out.mode = 'amount'; out.evidence = 'Amount and Delta are equal on every row; used as the change.'; }
      else { out.needsChoice = true; out.choices = ['delta+balance', 'delta-only', 'amount']; out.evidence = 'The file has both Amount and Delta, but they do not form a running balance on enough rows (' + hit + ' of ' + pairs + ').'; }
    } else {
      // One money column. Fees must be charges (negative changes); if they are written as positive numbers the reading is uncertain.
      var col = hasD ? cols.delta : cols.amount, fees = 0, posFees = 0;
      parsed.rows.forEach(function (r) { var cc = categorize(cell(r, cols.type), 0); if (!cc || group(cc.category) !== 'fee' || cc.category === 'rebate' || cc.category === 'refund') return; var v = num(r, col); if (v == null || !v) return; fees++; if (v > 0) posFees++; });
      if (!fees || posFees === 0) { out.mode = hasD ? 'delta-only' : 'amount'; out.evidence = fees ? 'All ' + fees + ' fee rows are negative, so amounts are read as changes to your cash.' : 'No fee rows to check the signs against; amounts are read as changes to your cash.'; if (!fees) out.signUnchecked = true; }
      else if (posFees === fees) { out.needsChoice = true; out.choices = ['amount', 'fees-positive']; out.evidence = 'Fees are written as positive numbers. TRC cannot tell whether they are charges or credits without you.'; }
      else { out.needsChoice = true; out.choices = ['amount', 'fees-positive']; out.evidence = 'Some fee rows are positive and some negative (' + posFees + ' of ' + fees + ' positive). Check the file before importing.'; }
    }
    if (choice && choice.mode && (!out.mode || out.needsChoice)) { out.mode = choice.mode; out.needsChoice = false; out.chosen = true; }
    return out;
  }
  function hash(str) { var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193); h2 = Math.imul(h2 ^ c, 0x85ebca6b); h2 ^= h2 >>> 13; } return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')); }
  function parseWhen(s, opts) {
    var IM = root.TTImport || (typeof require !== 'undefined' ? require('./import-core.js') : null);
    return s ? IM.parseTimestamp(s, opts) : null;
  }
  /* rows -> normalised entries + problems. opts: {interp, dateOrder, fileTz, targetTz, accountMap {raw: id}, defaultAccountId, typeMap {brokerType: category}, file, fileHash, batchId}
     Every entry keeps file, line and raw cells. Unknown broker types without a decision are HELD, never filed under a guessed category. */
  function read(parsed, det, opts) {
    opts = opts || {}; var c = det.cols, it = opts.interp || interpret(parsed, c, null), out = { entries: [], held: [], invalid: [], unmapped: {}, rounded: 0, types: {}, accounts: {}, from: null, to: null, currencies: {} };
    if (it.needsChoice) return Object.assign(out, { blocked: 'interpretation' });
    var occ = {};
    parsed.rows.forEach(function (row, i) {
      var line = i + 2, raw = row.slice(0, 40).map(function (v) { return String(v == null ? '' : v).slice(0, 200); });
      var bad = function (why) { out.invalid.push({ line: line, why: why, raw: raw }); };
      var tRaw = cell(row, c.time), dRaw = cell(row, c.date), ts = parseWhen(tRaw, opts), td = dRaw ? parseWhen(dRaw, Object.assign({}, opts, { fileTz: 'as-is' })) : null;
      if (tRaw && !ts) return bad('time could not be read'); if (dRaw && !td) return bad('trade date could not be read');
      if (!ts && !td) return bad('no date');
      var date = td ? td.date : ts.date, at = ts && ts.ms != null ? ts.ms : Date.parse(date + 'T12:00:00Z');
      var cur = (cell(row, c.currency) || opts.currency || 'USD').toUpperCase(); if (/^\d+$/.test(cur)) cur = cur === '1' ? 'USD' : 'ID' + cur;
      var dig = digitsOf(cur), colChange = it.mode === 'delta+balance' || it.mode === 'delta-only' ? c.delta : (c.amount >= 0 ? c.amount : c.delta);
      var ch = parseMinor(cell(row, colChange), { decimal: it.decimal, digits: dig });
      if (!ch.ok) return bad(ch.empty ? 'amount is missing' : ch.tooLarge ? 'amount is too large' : 'amount is not a number ("' + cell(row, colChange).slice(0, 20) + '")');
      if (ch.rounded) out.rounded++;
      var bal = null; if (it.mode === 'delta+balance') { var b = parseMinor(cell(row, c.amount), { decimal: it.decimal, digits: dig }); if (b.ok) bal = b.minor; }
      var typeRaw = cell(row, c.type), amt = ch.minor, cat = categorize(typeRaw, amt);
      if (it.mode === 'fees-positive' && cat && group(cat.category) === 'fee' && cat.category !== 'rebate' && cat.category !== 'refund') amt = -Math.abs(amt);
      var acctRaw = cell(row, c.account), acct = acctRaw ? (opts.accountMap && opts.accountMap[acctRaw]) || null : (opts.defaultAccountId || null);
      out.accounts[acctRaw || ''] = (out.accounts[acctRaw || ''] || 0) + 1; if (acctRaw && !acct) out.unmapped[acctRaw] = 1;
      var id = cell(row, c.id), key = id ? 'tvc:' + L(acctRaw || ('@' + (acct || ''))) + ':' + id : 'tvc2:' + hash([L(acctRaw || ('@' + (acct || ''))), ts && ts.ms != null ? Math.floor(ts.ms / 1000) : date, L(typeRaw), amt, bal == null ? '' : bal].join('|'));
      if (!id) { var n = occ[key] || 0; occ[key] = n + 1; key += '#' + n; }
      var e = { key: key, accountRaw: acctRaw, accountId: acct, at: at, date: date, time: ts && ts.hasTime ? ts.time : '', brokerType: typeRaw, currency: cur, amountCents: amt, balanceAfterCents: bal,
        brokerId: id || null, fundId: cell(row, c.fund) || null, fillPairId: cell(row, c.pair) || null, comment: cell(row, c.comment).slice(0, 120), source: { adapter: ADAPTER, file: opts.file || '', fileHash: opts.fileHash || '', line: line, raw: raw, batchId: opts.batchId || null } };
      out.types[typeRaw] = (out.types[typeRaw] || 0) + 1; out.currencies[cur] = 1;
      if (!out.from || date < out.from) out.from = date; if (!out.to || date > out.to) out.to = date;
      var decided = opts.typeMap && opts.typeMap[typeRaw];
      if (!cat && !decided) { out.held.push(Object.assign(e, { why: 'unknown type "' + typeRaw.slice(0, 40) + '"' })); return; }
      e.category = decided || cat.category; e.bySign = !decided && cat.bySign;
      out.entries.push(e);
    });
    return out;
  }
  /* Compare read entries with what is already saved (ledger records of type 'cash'). Same key + same amount -> duplicate (skipped).
     Same key, different amount -> conflict (a corrected statement): held until you choose to replace. */
  function classify(entries, existing) {
    var have = {}; (existing || []).forEach(function (l) { if (l && l.type === 'cash' && !l.voided && l.source && l.source.key) have[l.accountId + '|' + l.source.key] = l; });
    var res = { add: [], dup: [], conflict: [] }, seen = {};
    entries.forEach(function (e) {
      var k = e.accountId + '|' + e.key, ex = have[k];
      if (seen[k]) { res.dup.push({ e: e, why: 'repeated in this file' }); return; } seen[k] = 1;
      if (!ex) { res.add.push(e); return; }
      // The running balance after a record moves when an EARLIER record was corrected, so only the amount decides a conflict.
      if (ex.amountCents === e.amountCents) res.dup.push({ e: e, existing: ex, why: 'already imported', balanceMoved: ex.balanceAfterCents != null && e.balanceAfterCents != null && ex.balanceAfterCents !== e.balanceAfterCents });
      else res.conflict.push({ e: e, existing: ex, why: 'same broker record, different amount (corrected statement?)' });
    });
    return res;
  }
  function entryId(accountId, key) { return 'cx' + hash(accountId + '|' + key) + hash(key + '|' + accountId).slice(0, 6); }
  function toLedger(e, batchId, now) {
    return { id: entryId(e.accountId, e.key), type: 'cash', accountId: e.accountId, at: e.at, date: e.date, time: e.time, category: e.category, bySign: !!e.bySign, brokerType: e.brokerType, currency: e.currency, amountCents: e.amountCents,
      balanceAfterCents: e.balanceAfterCents, brokerId: e.brokerId, fundId: e.fundId, fillPairId: e.fillPairId, comment: e.comment, createdAt: now, voided: false, source: Object.assign({}, e.source, { key: e.key, batchId: batchId }) };
  }

  /* ---------- the engine ---------- */
  function isCash(l) { return l && l.type === 'cash' && !l.voided && Number.isInteger(l.amountCents); }
  var MANUAL_SIGN = { deposit: 1, withdrawal: -1, payout: -1, 'transfer-in': 1, 'transfer-out': -1 };
  function manualSign(l) { if (l.type === 'adjustment') return l.dir === 'down' ? -1 : 1; if (l.type === 'fee') return -1; return MANUAL_SIGN[l.type] || 0; }
  function manualCat(l) { return { deposit: 'deposit', withdrawal: 'withdrawal', payout: 'withdrawal', 'transfer-in': 'transfer_in', 'transfer-out': 'transfer_out', adjustment: 'adjustment', fee: 'other_fee' }[l.type] || 'other'; }
  function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function emptyTotals() { var t = { grossCents: 0, feesCents: 0, tradingFeesCents: 0, accountFeesCents: 0, creditsCents: 0, netTradingCents: 0, depositsCents: 0, withdrawalsCents: 0, transfersInCents: 0, transfersOutCents: 0, adjustmentsCents: 0, interestCents: 0, otherCents: 0, byCat: {} }; return t; }
  function addTo(t, cat, amt) {
    t.byCat[cat] = (t.byCat[cat] || 0) + amt;
    var g = group(cat);
    if (g === 'trading') t.grossCents += amt;
    else if (cat === 'rebate' || cat === 'refund') t.creditsCents += amt;
    else if (g === 'fee') { t.feesCents += -amt; if (TRADING_FEES.indexOf(cat) >= 0) t.tradingFeesCents += -amt; else t.accountFeesCents += -amt; }   // fees are positive costs in the totals
    else if (cat === 'deposit') t.depositsCents += amt; else if (cat === 'withdrawal' || cat === 'payout') t.withdrawalsCents += -amt;
    else if (cat === 'transfer_in') t.transfersInCents += amt; else if (cat === 'transfer_out') t.transfersOutCents += -amt;
    else if (cat === 'interest' || cat === 'dividend') t.interestCents += amt; else if (cat === 'adjustment' || cat === 'correction' || cat === 'reversal' || cat === 'settlement') t.adjustmentsCents += amt;
    else t.otherCents += amt;
  }
  /* account: saved account; ledger: ALL ledger records; rows: analyzed trades [{t, c}] (TTJournalCore.analyze), any accounts.
     opts: {now, imports: [import docs] (for freshness), from, to (reporting window for totals; balances always from the opening)} */
  function summarize(account, ledger, rows, opts) {
    opts = opts || {}; var id = account.id, cur = account.currency || 'USD', now = opts.now || Date.now();
    var cash = (ledger || []).filter(function (l) { return isCash(l) && l.accountId === id; }).sort(function (a, b) { return a.at - b.at || (a.source && b.source ? a.source.line - b.source.line : 0); });
    var manual = (ledger || []).filter(function (l) { return l && !l.voided && l.accountId === id && l.type !== 'cash' && typeof l.at === 'number'; });
    var trades = (rows || []).filter(function (r) { return (r.t.accountId || DEF) === id; });
    var out = { accountId: id, currency: cur, status: null, reasons: [], discrepancies: [], notes: [], opening: { cents: null, source: null, date: null }, coverage: null, totals: emptyTotals(), period: emptyTotals(),
      balanceCents: null, balanceExact: false, accountChangeCents: null, checkpoints: [], series: [], trail: { cash: [], trades: [], manual: [] }, excluded: { trades: [], manual: [] }, crossCheck: null,
      freshness: { latestTxAt: null, lastImportAt: null, from: null, to: null, source: null }, twr: { value: null, reason: '' }, estimatedFees: 0, unknownFees: 0, openPositions: 0, currencies: {}, held: 0 };
    // currencies: never mixed silently
    cash.forEach(function (l) { out.currencies[l.currency || cur] = 1; });
    var foreign = Object.keys(out.currencies).filter(function (c) { return c !== cur; });
    if (foreign.length) { out.discrepancies.push({ kind: 'currency', cents: null, text: 'Cash records in ' + foreign.join(', ') + ' are in a different currency than the account (' + cur + '). They are not added; TRC does not convert currencies.' }); cash = cash.filter(function (l) { return (l.currency || cur) === cur; }); }
    if (cash.length) out.coverage = { from: cash[0].date, to: cash[cash.length - 1].date, fromAt: cash[0].at, toAt: cash[cash.length - 1].at, n: cash.length };
    var cov = out.coverage, inCov = function (date) { return cov && date >= cov.from && date <= cov.to; };
    // opening balance: yours (labelled), or derived from the broker's first running balance; never assumed to be zero
    var manualOpen = account.startingBalanceCents == null ? null : account.startingBalanceCents, startDate = account.startedOn || null;
    var first = cash[0], derived = first && first.balanceAfterCents != null ? first.balanceAfterCents - first.amountCents : null;
    if (manualOpen != null) out.opening = { cents: manualOpen, source: 'you', date: startDate };
    else if (derived != null) { out.opening = { cents: derived, source: 'broker', date: first.date }; startDate = first.date; out.notes.push('Opening balance taken from the first Cash History row (' + fmt(derived, cur) + ' before ' + first.date + ').'); }
    // events in time order
    var ev = [];
    cash.forEach(function (l) { ev.push({ at: l.at, date: l.date, kind: 'cash', cat: l.category, amt: l.amountCents, bal: l.balanceAfterCents, id: l.id }); });
    var usdOnly = 0;
    trades.forEach(function (r) {
      var t = r.t, c = r.c; if (!c.isClosed) { out.openPositions++; return; }
      if (cur !== 'USD' && !inCov(t.date)) { usdOnly++; out.excluded.trades.push({ id: t.id, why: 'trade P&L is in US dollars; this account is in ' + cur }); return; }
      var ex = t.exits && t.exits.length ? t.exits[t.exits.length - 1] : null, d = ex && ex.date ? ex.date : t.date;
      if (startDate && d < startDate) { out.excluded.trades.push({ id: t.id, why: 'before the starting date' }); return; }
      if (inCov(d)) { out.excluded.trades.push({ id: t.id, why: 'Cash History is the source for this period', grossCents: c.grossCents }); return; }
      var tm = Date.parse(d + 'T' + (ex && ex.time ? ex.time : (t.time || '12:00')) + ':00Z'); if (isNaN(tm)) tm = Date.parse(d + 'T12:00:00Z');
      ev.push({ at: tm, date: d, kind: 'trade', cat: 'trade_pnl', amt: c.grossCents, id: t.id });
      if (c.feesCents == null || c.feesMissing) out.unknownFees++; else { if (t.feeSource === 'template') out.estimatedFees++; if (c.feesCents) ev.push({ at: tm, date: d, kind: 'tradefee', cat: 'commission', amt: -c.feesCents, id: t.id, estimated: t.feeSource === 'template' }); }
    });
    var snaps = [];
    manual.forEach(function (l) {
      var d = l.date || dayOf(l.at);
      if (l.type === 'snapshot') { if (Number.isInteger(l.balanceCents)) snaps.push({ at: l.at, date: d, broker: l.balanceCents, id: l.id, source: 'you entered' }); return; }
      if (!Number.isInteger(l.amountCents) || l.amountCents <= 0 || !manualSign(l)) return;
      if (startDate && d < startDate) { out.excluded.manual.push({ id: l.id, why: 'before the starting date' }); return; }
      if (inCov(d)) {
        var cat = manualCat(l), amt = manualSign(l) * l.amountCents;
        var twin = cash.filter(function (x) { return x.category === cat && x.amountCents === amt && Math.abs(Date.parse(x.date) - Date.parse(d)) <= 3 * 864e5; })[0];
        out.excluded.manual.push({ id: l.id, why: 'Cash History is the source for this period', matched: twin ? twin.id : null, cents: amt, type: l.type, date: d });
        if (!twin && (cat === 'deposit' || cat === 'withdrawal')) out.discrepancies.push({ kind: 'missing-' + cat, cents: amt, text: 'Your ' + cat + ' of ' + fmt(Math.abs(amt), cur) + ' on ' + d + ' is not in the imported Cash History. Check the date or whether the export is complete.' });
        return;
      }
      ev.push({ at: l.at, date: d, kind: 'manual', cat: manualCat(l), amt: manualSign(l) * l.amountCents, id: l.id });
    });
    ev.sort(function (a, b) { return a.at - b.at; });
    if (usdOnly) out.discrepancies.push({ kind: 'currency', cents: null, text: usdOnly + ' trade(s) are in US dollars and this account is in ' + cur + '. TRC does not convert currencies, so they are not added; enter or import the balances from your broker instead.' });
    // running balance + checkpoints (broker running balance on cash rows, and balances you entered)
    var known = out.opening.cents != null && !usdOnly, bal = known ? out.opening.cents : 0, last = null, inside = 0, outside = 0, prevBroker = null;
    ev.forEach(function (e) {
      bal += e.amt; addTo(out.totals, e.cat, e.amt);
      if (opts.from && e.date < opts.from || opts.to && e.date > opts.to) {} else addTo(out.period, e.cat, e.amt);
      out.trail[e.kind === 'cash' ? 'cash' : e.kind === 'manual' ? 'manual' : 'trades'].push(e.id);
      if (e.kind === 'cash') inside++; else outside++;
      if (e.bal != null) {
        if (prevBroker != null && prevBroker + e.amt !== e.bal) out.discrepancies.push({ kind: 'statement', cents: e.bal - (prevBroker + e.amt), text: 'The broker\'s running balance jumps by ' + fmt(e.bal - (prevBroker + e.amt), cur, true) + ' on ' + e.date + ': rows may be missing from the export, or the statement is internally inconsistent.' });
        prevBroker = e.bal;
        if (known) out.checkpoints.push({ at: e.at, date: e.date, brokerCents: e.bal, calcCents: bal, diffCents: e.bal - bal, source: 'Cash History' });
      }
      if (known) out.series.push({ date: e.date, cents: bal }); last = e;
    });
    snaps.forEach(function (s) {
      if (!known) return; var b = known ? out.opening.cents : 0; ev.forEach(function (e) { if (e.at <= s.at) b += e.amt; });
      out.checkpoints.push({ at: s.at, date: s.date, brokerCents: s.broker, calcCents: b, diffCents: s.broker - b, source: s.source, id: s.id });
    });
    out.checkpoints.sort(function (a, b) { return a.at - b.at; });
    var t = out.totals; t.netTradingCents = t.grossCents - t.tradingFeesCents;
    var pp = out.period; pp.netTradingCents = pp.grossCents - pp.tradingFeesCents;
    out.balanceCents = known ? bal : null; out.accountChangeCents = known ? bal - out.opening.cents : null;
    // cross-check: journal trades inside the Cash History period vs the broker's realized P&L there
    var jIn = out.excluded.trades.filter(function (x) { return x.grossCents != null; });
    if (cov) { var jSum = jIn.reduce(function (a, x) { return a + x.grossCents; }, 0), cSum = cash.filter(function (l) { return group(l.category) === 'trading'; }).reduce(function (a, l) { return a + l.amountCents; }, 0);
      out.crossCheck = { journalTrades: jIn.length, journalGrossCents: jSum, cashGrossCents: cSum, diffCents: jIn.length ? cSum - jSum : null };
      if (jIn.length && cSum !== jSum) out.notes.push('Your journal trades in ' + cov.from + ' to ' + cov.to + ' add up to ' + fmt(jSum, cur, true) + ' gross; the Cash History says ' + fmt(cSum, cur, true) + '. The balance uses the Cash History. The difference usually means trades missing from the journal or from a report.'); }
    // freshness
    var imps = (opts.imports || []).filter(function (d) { return d && d.mode === 'cash' && !d.rolledBack && (d.accountIds || []).indexOf(id) >= 0; }).sort(function (a, b) { return b.at - a.at; });
    out.freshness = { latestTxAt: last ? last.at : null, lastImportAt: imps.length ? imps[0].at : null, from: ev.length ? ev[0].date : null, to: last ? last.date : null, source: cov ? (outside ? 'Cash History + journal / your entries' : 'Cash History') : (ev.length ? 'Journal and your entries' : null) };
    out.held = imps.length ? (imps[0].counts && imps[0].counts.held) || 0 : 0;
    // status (financial-data state, not a performance rating)
    var lastCp = out.checkpoints[out.checkpoints.length - 1], badCp = out.checkpoints.filter(function (c) { return Math.abs(c.diffCents) > 0; });
    var r = out.reasons;
    if (out.held) { out.status = 'import-error'; r.push(out.held + ' row(s) of the latest Cash History import are held (unknown type or unreadable). Finish them in Import.'); }
    else if (!known) { out.status = 'insufficient'; r.push(usdOnly ? 'Trade P&L is in US dollars and this account is in ' + cur + '. TRC does not convert currencies, so the balance cannot be calculated from trades; enter or import broker balances.' : 'The opening balance is unknown. Enter the starting balance from your broker, or import a Cash History with balances.'); }
    else if (badCp.length || out.discrepancies.some(function (d) { return d.kind === 'statement' || /^missing-/.test(d.kind) || d.kind === 'currency'; })) {
      out.status = 'discrepancy'; var bc = badCp[badCp.length - 1];
      if (bc) r.push('Difference of ' + fmt(bc.diffCents, cur, true) + ' against the broker balance on ' + bc.date + ' (broker ' + fmt(bc.brokerCents, cur) + ', TRC ' + fmt(bc.calcCents, cur) + '). Possible causes: wrong starting balance, a missing deposit, withdrawal, fee or trade, a duplicate, or records in the wrong account.');
    } else if (!lastCp) { out.status = 'estimated'; r.push('No broker balance to compare with. Import a Cash History or add the balance your broker shows.'); }
    else {
      var after = ev.filter(function (e) { return e.at > lastCp.at; }).length;
      if (after || out.unknownFees || out.estimatedFees) { out.status = 'partial'; if (after) r.push(after + ' change(s) after the last broker balance (' + lastCp.date + ') are not confirmed yet.'); }
      else out.status = 'reconciled';
      if (now - lastCp.at > 30 * 864e5) { out.status = 'outdated'; r.push('The last broker balance is from ' + lastCp.date + '. Import a newer Cash History.'); }
    }
    if (out.unknownFees) r.push(out.unknownFees + ' trade(s) outside the Cash History have no fees entered, so net P&L there is too high.');
    if (out.estimatedFees) r.push(out.estimatedFees + ' trade(s) use fees estimated from your settings, not broker records.');
    if (out.openPositions) r.push(out.openPositions + ' open position(s): unrealized P&L is not included (no live prices).');
    if (out.status === 'reconciled' && lastCp) out.notes.push('A matching balance on ' + lastCp.date + ' does not prove that every single record is right; duplicates and account assignment are checked separately.');
    out.balanceExact = out.status === 'reconciled';
    out.twr = twr(out, ev);
    return out;
  }
  // Time-weighted return over the series: each day's return excludes that day's deposits/withdrawals/transfers (treated as at the start of
  // the day). Unavailable when the opening is unknown, a day starts at or below zero, or the data are not confirmed by the broker.
  function twr(s, ev) {
    if (s.opening.cents == null) return { value: null, reason: 'Opening balance unknown.' };
    if (s.status !== 'reconciled' && s.status !== 'partial' && s.status !== 'outdated') return { value: null, reason: 'Not calculated: the balance is not confirmed by your broker.' };
    var days = {}, order = []; ev.forEach(function (e) { if (!days[e.date]) { days[e.date] = { flow: 0, chg: 0 }; order.push(e.date); } var g = group(e.cat); if (g === 'cashflow') days[e.date].flow += e.amt; else days[e.date].chg += e.amt; });
    var start = s.opening.cents, f = 1;
    for (var i = 0; i < order.length; i++) { var d = days[order[i]], base = start + d.flow; if (base <= 0) return { value: null, reason: 'Not meaningful: the balance was zero or negative on ' + order[i] + '.' }; f *= 1 + d.chg / base; start = base + d.chg; }
    return { value: f - 1, reason: 'Time-weighted: deposits and withdrawals do not count as performance.' };
  }

  /* ---------- views over the ledger ---------- */
  function buckets(ledger, accountId, by) {
    var m = {}; (ledger || []).filter(function (l) { return isCash(l) && l.accountId === accountId; }).forEach(function (l) {
      var k = by === 'month' ? l.date.slice(0, 7) : by === 'week' ? weekOf(l.date) : l.date, b = m[k] || (m[k] = { key: k, totals: emptyTotals() }); addTo(b.totals, l.category, l.amountCents); });
    return Object.keys(m).sort().map(function (k) { var b = m[k], t = b.totals; t.netTradingCents = t.grossCents - t.tradingFeesCents; return b; });
  }
  function weekOf(date) { var d = new Date(date + 'T00:00:00Z'), w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); }
  // Fee share of gross profit is only meaningful when gross profit is positive.
  function feeShare(t) { if (!(t.grossCents > 0)) return { value: null, text: t.grossCents < 0 ? 'Not shown: gross trading P&L is negative, so a fee percentage would be misleading. Fees added ' + fmt(t.feesCents) + ' to the loss.' : 'Not shown: no gross profit in this period.' }; return { value: t.feesCents / t.grossCents, text: null }; }
  // Several accounts together only when they share one currency; transfers between them (same fund transaction id) are netted out.
  function combine(summaries, ledger) {
    var curs = {}; summaries.forEach(function (s) { curs[s.currency] = 1; }); if (Object.keys(curs).length > 1) return { ok: false, reason: 'Accounts use different currencies (' + Object.keys(curs).join(', ') + '). TRC does not combine them without exchange rates.' };
    var t = emptyTotals(), bal = 0, unknown = false, ids = summaries.map(function (s) { return s.accountId; }), fundSeen = {}, internal = 0;
    (ledger || []).filter(function (l) { return isCash(l) && ids.indexOf(l.accountId) >= 0 && l.fundId; }).forEach(function (l) { (fundSeen[l.fundId] || (fundSeen[l.fundId] = [])).push(l); });
    Object.keys(fundSeen).forEach(function (k) { var g = fundSeen[k]; if (g.length === 2 && g[0].accountId !== g[1].accountId && g[0].amountCents === -g[1].amountCents) internal += Math.abs(g[0].amountCents); });
    summaries.forEach(function (s) { Object.keys(s.totals.byCat).forEach(function (c) { addTo(t, c, s.totals.byCat[c]); }); if (s.balanceCents == null) unknown = true; else bal += s.balanceCents; });
    t.netTradingCents = t.grossCents - t.tradingFeesCents; t.depositsCents -= internal; t.withdrawalsCents -= internal;
    return { ok: true, currency: Object.keys(curs)[0] || 'USD', totals: t, balanceCents: unknown ? null : bal, internalTransfersCents: internal };
  }
  // CSV export of records: every text cell that a spreadsheet could run as a formula is neutralised.
  function csvCell(v) { var s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv(entries, accountName) {
    var head = ['date', 'time', 'account', 'category', 'broker_type', 'amount', 'balance_after', 'currency', 'broker_id', 'comment', 'source_file', 'source_line'];
    return [head.join(',')].concat(entries.map(function (l) { var d = digitsOf(l.currency || 'USD'), m = function (x) { return x == null ? '' : (x < 0 ? '-' : '') + (Math.abs(x) / Math.pow(10, d)).toFixed(d); };
      return [l.date, l.time || '', accountName(l.accountId), l.category, l.brokerType || l.type, m(l.amountCents), m(l.balanceAfterCents), l.currency || 'USD', l.brokerId || '', l.comment || l.note || '', l.source ? l.source.file : 'entered by you', l.source ? l.source.line : ''].map(csvCell).join(','); })).join('\r\n');
  }
  var STATUS = { reconciled: 'Reconciled', partial: 'Partially reconciled', estimated: 'Estimated', outdated: 'Outdated', discrepancy: 'Discrepancy detected', insufficient: 'Insufficient data', 'import-error': 'Import error' };

  var api = { TRADING_FEES: TRADING_FEES, ADAPTER: ADAPTER, CATS: CATS, FEE_CATS: FEE_CATS, TV_TYPES: TV_TYPES, STATUS: STATUS, MINOR: MINOR, digitsOf: digitsOf, label: label, group: group, tvType: tvType, categorize: categorize,
    detectDecimal: detectDecimal, parseMinor: parseMinor, fmt: fmt, detect: detect, findCols: findCols, interpret: interpret, read: read, classify: classify, entryId: entryId, toLedger: toLedger, hash: hash,
    summarize: summarize, buckets: buckets, weekOf: weekOf, feeShare: feeShare, combine: combine, csvCell: csvCell, exportCsv: exportCsv, isCash: isCash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTCash = api;
})(typeof window !== 'undefined' ? window : globalThis);
