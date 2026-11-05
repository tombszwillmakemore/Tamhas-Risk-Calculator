// Synthetic Tradovate-style Cash History files for the cash tests (no real account data).
// rows: [{t:'2026-11-03 09:35:10', type:'Commission', delta:-1.24, id:1}], opening balance is the balance before the first row.
function cashCsv(rows, o) {
  o = o || {}; let bal = o.opening == null ? 100 : o.opening;
  const cols = o.cols || ['id', 'accountId', 'timestamp', 'tradeDate', 'currency', 'cashChangeType', 'amount', 'delta', 'fundTransactionId', 'comment'];
  const out = rows.map((r, i) => {
    bal = Math.round((bal + r.delta) * 100) / 100;
    const v = { id: r.id == null ? 1000 + i : r.id, accountId: r.acct || o.acct || 'DEMO-L1', timestamp: r.t, tradeDate: r.t.slice(0, 10), currency: r.cur || 'USD', cashChangeType: r.type,
      amount: (r.badBal != null ? r.badBal : bal).toFixed(2), delta: r.delta.toFixed(2), fundTransactionId: r.fund || '', comment: r.comment || '' };
    return cols.map(c => { const s = String(v[c]); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
  });
  if (o.reverse) out.reverse();
  return [cols.join(',')].concat(out).join('\n');
}
// The brief's regression: opening $100.00, gross +$103.30, commissions $24.96, exchange $22.40, clearing $12.16, NFA $0.64 -> $143.14.
function regressionRows() {
  const pnl = [41.50, -12.00, 30.80, 43.00];          // = 103.30
  const rows = []; let n = 0;
  pnl.forEach((p, i) => {
    const t = '2026-11-0' + (3 + i) + ' 0' + (9 + (i % 1)) + ':3' + i + ':0' + i;
    rows.push({ t, type: 'TradePaired', delta: p, id: 5000 + n++ });
  });
  // fees: 24.96 = 4 x 6.24 ; 22.40 = 4 x 5.60 ; 12.16 = 4 x 3.04 ; 0.64 = 4 x 0.16
  for (let i = 0; i < 4; i++) {
    const t = '2026-11-0' + (3 + i) + ' 09:3' + i + ':0' + i;
    rows.push({ t, type: 'Commission', delta: -6.24, id: 5000 + n++ }, { t, type: 'ExchangeFee', delta: -5.60, id: 5000 + n++ }, { t, type: 'ClearingFee', delta: -3.04, id: 5000 + n++ }, { t, type: 'NfaFee', delta: -0.16, id: 5000 + n++ });
  }
  return rows.sort((a, b) => a.t.localeCompare(b.t) || a.id - b.id);
}
module.exports = { cashCsv, regressionRows };
