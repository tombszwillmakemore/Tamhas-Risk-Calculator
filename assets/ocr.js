/* Tamhas Trading - screenshot reading on this device. Prepares the picture (bigger, grey, dark themes inverted) and hands it to the
   Tesseract worker in assets/vendor/ocr. Nothing is uploaded. Returns positioned words for TTTradovate.fromWords. */
(function () {
  'use strict';
  var worker = null, seq = 0, waiting = {};
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('assets/vendor/ocr/ocr-worker.js');
    worker.onmessage = function (e) { var d = e.data || {}, w = waiting[d.id]; if (!w) return; if (d.stage) { if (w.onStage) w.onStage(d.stage); return; } delete waiting[d.id]; if (d.ok) w.res(d); else w.rej(new Error(d.error)); };
    worker.onerror = function () { Object.keys(waiting).forEach(function (k) { waiting[k].rej(new Error('The text reader stopped. Try a smaller screenshot or paste the report as text.')); delete waiting[k]; }); worker = null; };
    return worker;
  }
  function loadImage(blob) {
    return new Promise(function (res, rej) { var u = URL.createObjectURL(blob), im = new Image(); im.onload = function () { URL.revokeObjectURL(u); res(im); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('That file is not a picture this browser can open (use PNG or JPG).')); }; im.src = u; });
  }
  // Scale so text is about 30 px tall for typical screenshots, convert to grey, and invert dark backgrounds (Tradovate's dark theme).
  function prepare(blob, mul) {
    return loadImage(blob).then(function (im) {
      var w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) throw new Error('The picture is empty.');
      var scale = w < 1400 ? Math.min(3, 1800 / w) : (w > 3200 ? 3200 / w : 1); scale *= (mul || 1); if (w * h * scale * scale > 24e6) scale = Math.sqrt(24e6 / (w * h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      var g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, cw, ch);
      var id = g.getImageData(0, 0, cw, ch), px = id.data, sum = 0, n = px.length / 4;
      for (var i = 0; i < px.length; i += 4) { var y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; px[i] = px[i + 1] = px[i + 2] = y; sum += y; }
      var dark = sum / n < 128; if (dark) for (var k = 0; k < px.length; k += 4) { px[k] = px[k + 1] = px[k + 2] = 255 - px[k]; }
      g.putImageData(id, 0, 0);
      return new Promise(function (res) { cv.toBlob(function (b) { res({ blob: b, scale: scale, dark: dark, width: cw, height: ch }); }, 'image/png'); });
    });
  }
  function recognize(blob, onStage, psm, mul) {
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return Promise.reject(new Error('This browser cannot run the on-device text reader. Paste the report as text or upload the CSV instead.'));
    if (blob.size > 25e6) return Promise.reject(new Error('That picture is larger than 25 MB.'));
    if (onStage) onStage('Preparing the picture…');
    return prepare(blob, mul).then(function (p) { return p.blob.arrayBuffer().then(function (buf) {
      return new Promise(function (res, rej) { var id = ++seq; waiting[id] = { res: res, rej: rej, onStage: onStage }; getWorker().postMessage({ id: id, png: buf, psm: psm }, [buf]); });
    }).then(function (r) { r.prep = { scale: p.scale, dark: p.dark, width: p.width, height: p.height }; return r; }); });
  }
  // Reads the picture up to three ways (layouts differ: wide desktop tables, phone screenshots with wrapped cells) and merges the results.
  var PASSES = [[6, 1], [11, 1], [11, 0.45]];
  function readTable(blob, onStage) {
    var T = window.TTTradovate, got = [], words = null, i = 0;
    function next() {
      if (i >= PASSES.length) return Promise.resolve();
      var ps = PASSES[i++]; if (onStage && i > 1) onStage('Checking the picture again (' + i + ' of ' + PASSES.length + ')…');
      return recognize(blob, i === 1 ? onStage : null, ps[0], ps[1]).then(function (r) { if (!words) words = r.words; var t = T.fromWords(r.words); got.push(t); if (T.isClean(t)) return; return next(); });
    }
    return next().then(function () { var m = T.mergeTables(got); if (!m || !m.ok) { var e = got.filter(function (t) { return t && t.error; })[0]; return { ok: false, error: e ? e.error : 'Nothing could be read.', words: words }; } m.words = words; return m; });
  }
  window.TTOcr = { readTable: readTable, recognize: recognize, available: typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' };
})();
