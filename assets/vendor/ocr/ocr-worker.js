/* Tamhas Trading - on-device text recognition worker.
   Runs Tesseract (tesseract.js-core v5.1.1, Apache-2.0, see LICENSE-tesseract.js-core.txt) with the English "fast" LSTM model
   (tesseract-ocr/tessdata_fast, Apache-2.0). Everything is loaded from this site; the image never leaves the device.
   Message in:  {id, png: ArrayBuffer}
   Message out: {id, ok, words:[{text, conf, x, y, w, h}], ms} or {id, ok:false, error} ; progress messages {id, stage}. */
'use strict';
var ready = null;
function simd() { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } }
function boot(id) {
  if (ready) return ready;
  ready = new Promise(function (res, rej) {
    try { self.postMessage({ id: id, stage: 'Loading the reader (first time only, about 8 MB)…' }); importScripts(simd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'); } catch (e) { rej(new Error('The text reader could not be loaded in this browser.')); return; }
    self.TesseractCore().then(function (M) {
      return fetch('eng.traineddata').then(function (r) { if (!r.ok) throw new Error('The English language file could not be loaded.'); return r.arrayBuffer(); }).then(function (buf) {
        M.FS.writeFile('eng.traineddata', new Uint8Array(buf));
        var api = new M.TessBaseAPI(); if (api.Init(null, 'eng') !== 0) throw new Error('The text reader did not start.');
        api.SetPageSegMode(6);                       // one uniform block: keeps table rows together
        api.SetVariable('preserve_interword_spaces', '1');
        res({ M: M, api: api });
      });
    }).catch(rej);
  });
  ready.catch(function () { ready = null; });
  return ready;
}
self.onmessage = function (ev) {
  var d = ev.data || {}, id = d.id, t0 = Date.now();
  boot(id).then(function (o) {
    self.postMessage({ id: id, stage: 'Reading the screenshot…' });
    o.api.SetPageSegMode(d.psm || 11); o.M.FS.writeFile('/input', new Uint8Array(d.png)); o.api.SetImageFile();
    var tsv = o.api.GetTSVText(0) || '', words = [];
    tsv.split('\n').forEach(function (line) {
      var c = line.split('\t'); if (c.length < 12 || c[0] !== '5') return;   // level 5 = word
      var text = c.slice(11).join('\t').trim(); if (!text) return;
      words.push({ text: text, conf: +c[10], x: +c[6], y: +c[7], w: +c[8], h: +c[9] });
    });
    o.api.Clear();
    self.postMessage({ id: id, ok: true, words: words, ms: Date.now() - t0 });
  }).catch(function (e) { self.postMessage({ id: id, ok: false, error: (e && e.message) || 'Text recognition failed.' }); });
};
