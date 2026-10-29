/* Tamhas Trading - Risk Calculator
   CALCULATION LOGIC IS UNCHANGED from the original calculator (see calculator-classic.html).
   Only the element ids' surrounding markup/styling changed. */
(function () {
  // Fixed contract value: $0.20 per point per contract = 20 cents.
  // All math is done in whole cents to avoid floating-point rounding errors.
  var CENTS_PER_POINT = 20;

  var stopEl = document.getElementById('stop');
  var minEl = document.getElementById('minRisk');
  var maxEl = document.getElementById('maxRisk');
  var card = document.getElementById('resultCard');
  var label = document.getElementById('resultLabel');
  var main = document.getElementById('resultMain');
  var perEl = document.getElementById('perContract');
  var totEl = document.getElementById('totalRisk');

  function parse(el) {
    var s = el.value.replace(/[$,\s]/g, '');
    if (s === '' || !/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    return parseFloat(s);
  }
  function fmt(cents) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function show(kind, labelText, html, per, tot) {
    card.className = 'panel result ' + kind;
    label.textContent = labelText;
    main.innerHTML = html;
    perEl.textContent = per;
    totEl.textContent = tot;
  }
  function msg(t) { return '<div class="msg">' + t + '</div>'; }

  function calculate() {
    var stop = parse(stopEl), min = parse(minEl), max = parse(maxEl);

    if (isNaN(stop) || isNaN(min) || isNaN(max)) {
      show('idle', 'Result', msg('Enter your stop distance and risk range.'), '—', '—');
      return;
    }
    if (stop <= 0 || max <= 0) {
      show('idle', 'Result', msg('Stop distance and maximum risk must be greater than zero.'), '—', '—');
      return;
    }
    if (min > max) {
      show('idle', 'Result', msg('Minimum risk cannot be greater than maximum risk.'), '—', '—');
      return;
    }

    var perCents = Math.round(stop * CENTS_PER_POINT);   // risk per contract in cents
    var minCents = Math.round(min * 100);
    var maxCents = Math.round(max * 100);

    if (perCents > maxCents) {
      show('warn', 'Warning',
        msg('Stop too large, even one contract exceeds your maximum risk.'),
        fmt(perCents), '—');
      return;
    }

    var contracts = Math.floor(maxCents / perCents);      // largest whole number within max (never rounds up)
    var totalCents = contracts * perCents;

    if (contracts < 1 || totalCents < minCents || totalCents > maxCents) {
      show('info', 'Warning',
        msg('No contract size fits your risk range.'),
        fmt(perCents), '—');
      return;
    }

    show('', 'Recommended contracts',
      '<div class="value">' + contracts + '<small>contract' + (contracts === 1 ? '' : 's') + '</small></div>',
      fmt(perCents), fmt(totalCents));
  }

  ['input', 'change', 'keyup'].forEach(function (ev) {
    stopEl.addEventListener(ev, calculate);
    minEl.addEventListener(ev, calculate);
    maxEl.addEventListener(ev, calculate);
  });
  calculate();
})();
