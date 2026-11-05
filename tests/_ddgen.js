// Synthetic Tradovate-style reports for the duplicate tests (no real account data). Used by dd1core.js and dd2e2e.js.
/* ---------- synthetic market activity: 35 round trips in October 2026 (week 1: 20 trades, weeks 2-3: 15) ---------- */
const p2 = n => String(n).padStart(2, '0');
function mkTrades(acct, idBase) {
  const out = []; let id = idBase;
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
  for (let i = 0; i < 20; i++) out.push({ day: days[Math.floor(i / 4)], slot: i % 4 });
  const later = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
  later.forEach(d => out.push({ day: d, slot: 0 }));
  return out.map((x, i) => {
    const long = i % 3 !== 1, qty = 1 + (i % 2), con = i % 5 === 4 ? 'MESZ6' : 'MNQZ6', base = con === 'MESZ6' ? 6800 : 21000;
    const entry = base + (i * 7.25) % 40, move = ((i * 13) % 11 - 5) * 1.25 || 2.5, exit = long ? entry + move : entry - move;
    const h = 9 + x.slot, m = 31 + (i % 20), s = (i * 7) % 60;
    const t0 = x.day + ' ' + p2(h) + ':' + p2(m) + ':' + p2(s), t1 = x.day + ' ' + p2(h) + ':' + p2(m + 5) + ':' + p2((s + 11) % 60);
    const inF = { id: String(id++), side: long ? 'Buy' : 'Sell', at: t0 }, outF = { id: String(id++), side: long ? 'Sell' : 'Buy', at: t1 };
    return { acct, con, qty, long, entry: +entry.toFixed(2), exit: +exit.toFixed(2), inF, outF, fee: 0.74 * qty };
  });
}
const usDate = s => { const [d, t] = s.split(' '); const [y, mo, da] = d.split('-'); return mo + '/' + da + '/' + y + ' ' + t; };
const toUtc = s => { const [d, t] = s.split(' '); const ms = Date.parse(d + 'T' + t + 'Z') + 4 * 3600000; const x = new Date(ms).toISOString(); return x.slice(0, 10) + ' ' + x.slice(11, 19); };
// Tradovate Performance report (fill ids, no account column, no fees)
function perfCsv(trades, o) {
  o = o || {}; const rows = trades.map(t => { const b = t.long ? t.inF : t.outF, s = t.long ? t.outF : t.inF, bp = t.long ? t.entry : t.exit, sp = t.long ? t.exit : t.entry, pv = t.con === 'MESZ6' ? 5 : 2;
    return [t.con, b.id, s.id, t.qty, bp.toFixed(2), sp.toFixed(2), '$' + ((sp - bp) * pv * t.qty).toFixed(2), usDate(b.at), usDate(s.at)]; });
  if (o.shuffle) rows.reverse();
  return ['symbol,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp'].concat(rows.map(r => r.join(','))).join('\n');
}
// A fills / executions list. o.ids: include Fill ID; o.fees: include commission; o.utc: times written in UTC; o.ms: milliseconds; o.cols: reorder
function fillsCsv(trades, o) {
  o = o || {}; const head = ['Account', 'B/S', 'Contract', 'Quantity', 'Price', 'Timestamp'].concat(o.ids ? ['Fill ID'] : []).concat(o.fees ? ['Commission'] : []);
  const rows = []; trades.forEach(t => [[t.inF, t.entry], [t.outF, t.exit]].forEach(([f, px]) => {
    let at = o.utc ? toUtc(f.at) : f.at; at = usDate(at) + (o.ms ? '.' + String(Number(f.id) % 1000).padStart(3, '0') : '');
    const r = { Account: t.acct, 'B/S': f.side, Contract: o.symFmt ? t.con.replace('Z6', ' DEC26') : t.con, Quantity: t.qty, Price: px.toFixed(2), Timestamp: at, 'Fill ID': f.id, Commission: (t.fee / 2).toFixed(2) };
    rows.push(head.map(h => r[h]));
  }));
  if (o.shuffle) rows.sort((a, b) => (a[4] + a[5]).localeCompare(b[4] + b[5]) * -1);
  let hdr = head;
  if (o.cols) { const order = head.map((_, i) => i).reverse(); hdr = order.map(i => head[i]); return [hdr.join(',')].concat(rows.map(r => order.map(i => r[i]).join(','))).join('\n'); }
  return [hdr.join(',')].concat(rows.map(r => r.join(','))).join('\n');
}

module.exports = { mkTrades, perfCsv, fillsCsv };
