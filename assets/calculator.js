/* Tamhas Trading - Risk Calculator
   The calculation is unchanged from the original calculator (see calculator-classic.html):
   risk per contract = stop points x point value, whole contracts only, never above your maximum.
   The only difference is that the point value now comes from the selected contract
   (NNQ, the original $0.20 per point, is the default). Values are in assets/instruments.js. */
(function () {
  // Point value in whole cents (NNQ default = $0.20 = 20 cents).
  // All math is done in whole cents to avoid floating-point rounding errors.
  var INST = window.TTInstruments;
  var INST_KEY = 'tt.calc.instrument.v1';
  var CENTS_PER_POINT = INST.byId[INST.defaultId].centsPerPoint;
  var instEl = document.getElementById('instrument');

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

  /* ---------- Contract selector ---------- */
  var noteEl = document.getElementById('instNote');
  var footEl = document.getElementById('calcFoot');
  function applyInstrument(id) {
    var i = INST.byId[id] || INST.byId[INST.defaultId];
    CENTS_PER_POINT = i.centsPerPoint;
    if (noteEl) noteEl.innerHTML = '<b>' + i.label + '</b> per point per contract · <a href="' + i.url + '" target="_blank" rel="noopener noreferrer">CME spec</a>';
    if (footEl) footEl.textContent = i.id + ' · ' + i.label + ' per point per contract · Calculated on your device · Not financial advice';
    return i.id;
  }
  if (instEl) {
    instEl.innerHTML = INST.list.map(function (i) {
      return '<option value="' + i.id + '">' + i.id + ' — ' + i.name + ' (' + i.label + '/pt)</option>';
    }).join('');
    var saved = INST.defaultId;
    try { saved = localStorage.getItem(INST_KEY) || saved; } catch (e) {}
    instEl.value = applyInstrument(saved);
    instEl.addEventListener('change', function () {
      var id = applyInstrument(instEl.value);
      try { localStorage.setItem(INST_KEY, id); } catch (e) {}
      calculate();
    });
  }

  ['input', 'change', 'keyup'].forEach(function (ev) {
    stopEl.addEventListener(ev, calculate);
    minEl.addEventListener(ev, calculate);
    maxEl.addEventListener(ev, calculate);
  });
  calculate();
})();
