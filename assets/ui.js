/* Tamhas Trading - shared UI kit (TTUI): escaping, money formatting, toast, dialogs, tooltips, empty states and SVG charts.
   Charts are plain SVG strings: no libraries, no network. Every chart has a text alternative and keyboard/tap tooltips. */
(function (root) {
  'use strict';
  var doc = root.document;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtMoney(cents, signed) {
    if (cents == null || !isFinite(cents)) return '—';
    var neg = cents < 0, abs = Math.abs(Math.round(cents)), d = Math.floor(abs / 100), c = abs % 100;
    var s = '$' + String(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (c < 10 ? '0' : '') + c;
    return neg ? '-' + s : (signed && cents > 0 ? '+' + s : s);
  }
  function fmtMoneyShort(cents) {
    if (cents == null || !isFinite(cents)) return '—';
    var a = Math.abs(cents) / 100, sign = cents < 0 ? '-' : '';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return sign + '$' + Math.round(a / 1e3) + 'k';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'k';
    return sign + '$' + Math.round(a);
  }
  function fmtPct(x, d) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%'; }
  function fmtNum(x, d) { return x == null || !isFinite(x) ? '—' : Number(x).toFixed(d == null ? 2 : d); }
  function cls(cents) { return cents > 0 ? 'pos' : cents < 0 ? 'neg' : ''; }
  function plural(n, w, pl) { return n + ' ' + (n === 1 ? w : (pl || w + 's')); }

  /* ---------- toast ---------- */
  var toastEl = null, toastT = null;
  // Optional third argument: {label, fn} adds an action button (used for UNDO). The toast stays longer so it can be used.
  function toast(msg, isErr, action) {
    if (!doc) return;
    if (!toastEl) { toastEl = doc.createElement('div'); toastEl.className = 'ui-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); doc.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.className = 'ui-toast show' + (isErr ? ' err' : '') + (action ? ' has-act' : '');
    if (action && action.fn) { var b = doc.createElement('button'); b.type = 'button'; b.className = 'ui-toast-act'; b.textContent = action.label || 'UNDO'; b.addEventListener('click', function () { clearTimeout(toastT); toastEl.className = 'ui-toast'; try { action.fn(); } catch (e) { /* the action reports its own errors */ } }); toastEl.appendChild(b); }
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.className = 'ui-toast'; }, action ? 8000 : isErr ? 6000 : 3200);
  }

  /* ---------- dialogs (replace window.confirm/prompt: focus-trapped, keyboard friendly) ---------- */
  function dialog(opts) {
    return new Promise(function (resolve) {
      var prev = doc.activeElement;
      var wrap = doc.createElement('div'); wrap.className = 'ui-dlg-back';
      var fields = (opts.fields || []).map(function (f, i) {
        var id = 'uidf' + i;
        var ctl = f.type === 'textarea' ? '<textarea id="' + id + '" rows="3" maxlength="' + (f.max || 2000) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>' + esc(f.value || '') + '</textarea>'
          : f.type === 'select' ? '<select id="' + id + '">' + f.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(f.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>'
          : '<input id="' + id + '" type="' + (f.type || 'text') + '" value="' + esc(f.value == null ? '' : f.value) + '"' + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + ' autocomplete="off">';
        return '<label for="' + id + '">' + esc(f.label) + '</label>' + ctl + (f.hint ? '<small class="ui-hint">' + esc(f.hint) + '</small>' : '');
      }).join('');
      wrap.innerHTML = '<div class="ui-dlg" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || 'Dialog') + '"><h3>' + esc(opts.title || '') + '</h3>' +
        (opts.body ? '<p class="note">' + esc(opts.body) + '</p>' : '') + fields + '<div class="ui-dlg-err" aria-live="assertive"></div>' +
        '<div class="ui-dlg-btns"><button type="button" class="btn ghost" data-r="cancel">' + esc(opts.cancel || 'CANCEL') + '</button><button type="button" class="btn' + (opts.danger ? ' danger' : '') + '" data-r="ok">' + esc(opts.ok || 'OK') + '</button></div></div>';
      doc.body.appendChild(wrap);
      var box = wrap.firstChild, errEl = wrap.querySelector('.ui-dlg-err');
      function close(v) { wrap.remove(); doc.removeEventListener('keydown', onKey, true); if (prev && prev.focus) try { prev.focus(); } catch (e) {} resolve(v); }
      function collect() {
        var out = {}; (opts.fields || []).forEach(function (f, i) { out[f.name] = wrap.querySelector('#uidf' + i).value; });
        if (opts.validate) { var msg = opts.validate(out); if (msg) { errEl.textContent = msg; return null; } }
        return out;
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); var v = collect(); if (v) close(v); }
        else if (e.key === 'Tab') {
          var f = box.querySelectorAll('input,select,textarea,button'); if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      doc.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', function (e) {
        var r = e.target.getAttribute && e.target.getAttribute('data-r');
        if (e.target === wrap || r === 'cancel') close(null);
        else if (r === 'ok') { var v = collect(); if (v) close(v); }
      });
      var firstCtl = box.querySelector('input,select,textarea'); (firstCtl || box.querySelector('[data-r=ok]')).focus();
    });
  }
  function confirmDlg(title, body, okLabel, danger) { return dialog({ title: title, body: body, ok: okLabel || 'CONFIRM', danger: danger }).then(function (v) { return !!v; }); }

  /* ---------- tooltips for [data-tip] (hover, focus and tap) ---------- */
  var tipEl = null;
  function showTip(target) {
    var t = target.getAttribute('data-tip'); if (!t) return;
    if (!tipEl) { tipEl = doc.createElement('div'); tipEl.className = 'ui-tip'; tipEl.setAttribute('role', 'tooltip'); doc.body.appendChild(tipEl); }
    tipEl.textContent = t; tipEl.style.display = 'block';
    var r = target.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), root.innerWidth - w - 8), y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
  if (doc) {
    doc.addEventListener('pointerover', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); });
    doc.addEventListener('pointerout', function (e) { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
    doc.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); });
    doc.addEventListener('focusout', hideTip);
    doc.addEventListener('scroll', hideTip, true);
    doc.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t); else hideTip(); });
  }

  /* ---------- small building blocks ---------- */
  function empty(title, text, actionHtml) {
    return '<div class="ui-empty"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="9" width="34" height="30" rx="6"/><path d="M14 30l7-8 6 5 7-10"/></svg><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' + (actionHtml || '') + '</div>';
  }
  function stat(label, value, sub, klass, help) {
    return '<div class="ui-stat' + (klass ? ' ' + klass : '') + '"' + (help ? ' data-tip="' + esc(help) + '" tabindex="0"' : '') + '><small>' + esc(label) + '</small><b>' + value + '</b>' + (sub ? '<em>' + esc(sub) + '</em>' : '') + '</div>';
  }
  function tabs(items, active, attr) {
    return '<div class="ui-tabs" role="tablist">' + items.map(function (t) { return '<button type="button" role="tab" aria-selected="' + (t.id === active) + '" class="' + (t.id === active ? 'on' : '') + '" data-' + (attr || 'tab') + '="' + esc(t.id) + '">' + esc(t.label) + '</button>'; }).join('') + '</div>';
  }

  /* ---------- charts ---------- */
  function nice(min, max, n) {            // "nice" axis ticks
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
    if (min === max) { var p = Math.abs(min) * .1 || 1; min -= p; max += p; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
    return { min: lo, max: hi, ticks: ticks };
  }
  function downsample(pts, max) {         // keeps each bucket's min and max so peaks/troughs are never hidden
    if (pts.length <= max) return pts;
    var out = [pts[0]], b = Math.ceil((pts.length - 2) / (max / 2));
    for (var i = 1; i < pts.length - 1; i += b) {
      var lo = pts[i], hi = pts[i];
      for (var j = i; j < Math.min(i + b, pts.length - 1); j++) { if (pts[j].y < lo.y) lo = pts[j]; if (pts[j].y > hi.y) hi = pts[j]; }
      if (lo.x <= hi.x) { out.push(lo); if (hi !== lo) out.push(hi); } else { out.push(hi); out.push(lo); }
    }
    out.push(pts[pts.length - 1]); return out;
  }
  /* opts: {series:[{name, cls:'c1', pts:[{x,y,tip}], area, step}], xLabels:[{x,label}], height, yFormat, alt, baseline(number|null), band:{from,to}} */
  function lineChart(o) {
    var W = 640, H = o.height || 200, L = 54, R = 12, T = 12, B = 26, series = o.series.filter(function (s) { return s.pts && s.pts.length; });
    if (!series.length) return '';
    var xs = [], ys = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { xs.push(p.x); ys.push(p.y); }); });
    if (o.baseline != null) ys.push(o.baseline);
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), yr = nice(Math.min.apply(null, ys), Math.max.apply(null, ys), 4);
    var sx = function (x) { return x1 === x0 ? (L + (W - L - R) / 2) : L + (x - x0) / (x1 - x0) * (W - L - R); };
    var sy = function (y) { return T + (1 - (y - yr.min) / (yr.max - yr.min)) * (H - T - B); };
    var yf = o.yFormat || function (v) { return String(v); };
    var g = '<g class="ch-grid">' + yr.ticks.map(function (t) { var y = sy(t).toFixed(1); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"' + (t === 0 ? ' class="zero"' : '') + '/><text x="' + (L - 6) + '" y="' + (+y + 3.5) + '" text-anchor="end">' + esc(yf(t)) + '</text>'; }).join('') + '</g>';
    var xl = '<g class="ch-xl">' + (o.xLabels || []).map(function (l) { return '<text x="' + sx(l.x).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(l.label) + '</text>'; }).join('') + '</g>';
    var band = o.band ? '<rect class="ch-band" x="' + L + '" width="' + (W - L - R) + '" y="' + Math.min(sy(o.band.from), sy(o.band.to)).toFixed(1) + '" height="' + Math.abs(sy(o.band.from) - sy(o.band.to)).toFixed(1) + '"/>' : '';
    var base = o.baseline != null ? '<line class="ch-base" x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(o.baseline).toFixed(1) + '" y2="' + sy(o.baseline).toFixed(1) + '"/>' : '';
    var paths = series.map(function (s) {
      var pts = downsample(s.pts, 700), d = '';
      pts.forEach(function (p, i) {
        var X = sx(p.x).toFixed(1), Y = sy(p.y).toFixed(1);
        if (i === 0) d += 'M' + X + ' ' + Y; else if (s.step) d += 'H' + X + 'V' + Y; else d += 'L' + X + ' ' + Y;
      });
      var area = s.area ? '<path class="ch-area ' + (s.cls || 'c1') + '" d="' + d + 'L' + sx(pts[pts.length - 1].x).toFixed(1) + ' ' + sy(Math.max(yr.min, Math.min(yr.max, 0))).toFixed(1) + 'L' + sx(pts[0].x).toFixed(1) + ' ' + sy(Math.max(yr.min, Math.min(yr.max, 0))).toFixed(1) + 'Z"/>' : '';
      return area + '<path class="ch-line ' + (s.cls || 'c1') + '" d="' + d + '"/>';
    }).join('');
    var hits = '';
    series.forEach(function (s) {
      var step = Math.max(1, Math.ceil(s.pts.length / 160));
      s.pts.forEach(function (p, i) { if (p.tip && (i % step === 0 || i === s.pts.length - 1)) hits += '<circle class="ch-hit" cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) + '" r="9" tabindex="0" data-tip="' + esc(p.tip) + '"/>'; });
    });
    var legend = series.length > 1 ? '<div class="ch-legend">' + series.map(function (s) { return '<span><i class="' + (s.cls || 'c1') + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>' : '';
    return '<figure class="ch"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.alt || 'Line chart') + '" preserveAspectRatio="xMidYMid meet">' + band + g + base + paths + xl + hits + '</svg>' + legend + '</figure>';
  }
  /* opts: {bars:[{label, value, tip, cls?}], height, yFormat, alt, sub} - positive/negative coloured, zero baseline always shown */
  function barChart(o) {
    var bars = o.bars; if (!bars.length) return '';
    var W = 640, H = o.height || 190, L = 54, R = 8, T = 10, B = o.tall ? 44 : 28;
    var vs = bars.map(function (b) { return b.value == null ? 0 : b.value; }), yr = nice(Math.min.apply(null, vs.concat([0])), Math.max.apply(null, vs.concat([0])), 4);
    var sy = function (y) { return T + (1 - (y - yr.min) / (yr.max - yr.min)) * (H - T - B); }, yf = o.yFormat || String;
    var bw = (W - L - R) / bars.length, gap = Math.min(6, bw * .2);
    var g = '<g class="ch-grid">' + yr.ticks.map(function (t) { var y = sy(t).toFixed(1); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"' + (t === 0 ? ' class="zero"' : '') + '/><text x="' + (L - 6) + '" y="' + (+y + 3.5) + '" text-anchor="end">' + esc(yf(t)) + '</text>'; }).join('') + '</g>';
    var skip = Math.ceil(bars.length / 14);
    var rects = bars.map(function (b, i) {
      var v = b.value == null ? 0 : b.value, y0 = sy(0), y1 = sy(v), x = L + i * bw + gap / 2;
      var hgt = Math.max(Math.abs(y1 - y0), v === 0 ? 0 : 1);
      return '<rect class="ch-bar ' + (b.cls || (v >= 0 ? 'pos' : 'neg')) + (b.value == null ? ' none' : '') + '" x="' + x.toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + Math.max(1, bw - gap).toFixed(1) + '" height="' + hgt.toFixed(1) + '" tabindex="0" data-tip="' + esc(b.tip || b.label) + '"/>' +
        (i % skip === 0 ? '<text class="ch-xl-t" x="' + (x + (bw - gap) / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(b.label) + '</text>' : '');
    }).join('');
    return '<figure class="ch"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.alt || 'Bar chart') + '">' + g + rects + '</svg></figure>';
  }
  /* opts: {rows:[label], cols:[label], cell:(r,c)=>({v, n, tip})|null, alt, fmt}. Colour = sign of v, intensity = |v| / max|v|. */
  function heatmap(o) {
    var rs = o.rows.length, cs = o.cols.length, L = 58, T = 22, cw = Math.max(18, Math.min(44, (620 - L) / cs)), ch = 26, W = L + cs * cw + 6, H = T + rs * ch + 6, max = 0, cells = [];
    for (var r = 0; r < rs; r++) for (var c = 0; c < cs; c++) { var k = o.cell(r, c); cells.push(k); if (k && k.v != null) max = Math.max(max, Math.abs(k.v)); }
    var body = '', i = 0;
    for (r = 0; r < rs; r++) {
      body += '<text class="ch-xl-t" x="' + (L - 6) + '" y="' + (T + r * ch + ch / 2 + 4) + '" text-anchor="end">' + esc(o.rows[r]) + '</text>';
      for (c = 0; c < cs; c++, i++) {
        var k2 = cells[i], x = L + c * cw, y = T + r * ch;
        if (!k2 || k2.v == null) { body += '<rect class="hm-empty" x="' + (x + 1) + '" y="' + (y + 1) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" rx="4"/>'; continue; }
        var a = max ? Math.max(.12, Math.abs(k2.v) / max) : .12;
        body += '<rect class="hm-cell ' + (k2.v > 0 ? 'pos' : k2.v < 0 ? 'neg' : 'flat') + '" fill-opacity="' + a.toFixed(2) + '" x="' + (x + 1) + '" y="' + (y + 1) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" rx="4" tabindex="0" data-tip="' + esc(k2.tip || '') + '"/>';
      }
    }
    var head = o.cols.map(function (cl, ci) { return '<text class="ch-xl-t" x="' + (L + ci * cw + cw / 2) + '" y="14" text-anchor="middle">' + esc(cl) + '</text>'; }).join('');
    return '<figure class="ch"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.alt || 'Heatmap') + '">' + head + body + '</svg></figure>';
  }
  function meter(pct, klass) { var p = Math.max(0, Math.min(100, pct || 0)); return '<div class="ui-meter ' + (klass || '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(p) + '"><i style="width:' + p.toFixed(1) + '%"></i></div>'; }

  root.TTUI = { esc: esc, fmtMoney: fmtMoney, fmtMoneyShort: fmtMoneyShort, fmtPct: fmtPct, fmtNum: fmtNum, cls: cls, plural: plural, toast: toast, dialog: dialog, confirm: confirmDlg,
    empty: empty, stat: stat, tabs: tabs, lineChart: lineChart, barChart: barChart, heatmap: heatmap, meter: meter, nice: nice, downsample: downsample };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TTUI;
})(typeof window !== 'undefined' ? window : globalThis);
