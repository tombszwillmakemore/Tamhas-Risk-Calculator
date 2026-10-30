// Calendar value formats (pure): exact first, compact only when marked or suffixed, never a misleading rounded figure.
const path = require('path'), R = path.join(__dirname, '..', 'assets') + '/'; global.TTInstruments = require(R + 'instruments.js'); const C = require(R + 'journal-core.js');
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const first = c => C.moneyCandidates(c)[0].t;
eq('exact first', [1, -60, 6990, -5350, 99999, 125075, -1250000, 100000000, 0, -123456789].map(first), ['+$0.01', '-$0.60', '+$69.90', '-$53.50', '+$999.99', '+$1,250.75', '-$12,500', '+$1,000,000', '$0', '-$1,234,567.89']);
// every candidate: either numerically exact, or flagged approx; approx without K/M starts with ~
const val = t => { const neg = /-/.test(t), m = t.replace(/[~+\-$,]/g, ''), mult = /K$/.test(m) ? 1e3 : /M$/.test(m) ? 1e6 : 1; return Math.round(parseFloat(m) * mult * 100) * (neg ? -1 : 1); };
for (const c of [1, -60, 6990, -5350, 99999, 125075, -1250000, 100000000, -123456789, 6995, 10000, 95000, 12345678]) for (const x of C.moneyCandidates(c)) {
  const exact = Math.abs(val(x.t) - c) === 0 || (val(x.t) === -c && !/[+-]/.test(x.t));   // a positive shown without "+" is still exact
  ok(c + ' "' + x.t + '" exact or flagged', exact ? !x.approx : x.approx, x);
  if (x.approx) ok(c + ' "' + x.t + '" rounding is visible (~ or K/M)', /~/.test(x.t) || /[KM]$/.test(x.t), x);
  ok(c + ' "' + x.t + '" error recorded', typeof x.err === 'number' && (x.approx ? x.err > 0 : x.err === 0), x);
  if (c < 0) ok(c + ' "' + x.t + '" keeps the minus sign', /-/.test(x.t), x);
}
eq('$100 never shown as K', C.moneyCandidates(10000).some(x => /K/.test(x.t)), false);
eq('candidates exact before rounded', C.moneyCandidates(125075).findIndex(x => x.approx) > C.moneyCandidates(125075).filter(x => !x.approx).length - 1, true);
eq('counts', [1, 10, 100, 1000].map(n => C.countCandidates(n)[0]), ['1 trade', '10 trades', '100 trades', '1,000 trades']);
ok('every count candidate contains the number or a k form', [1, 10, 100, 1000, 12345].every(n => C.countCandidates(n).every(t => /\d/.test(t))));
console.log((fail ? 'FAILED ' : 'ALL PASSED ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
