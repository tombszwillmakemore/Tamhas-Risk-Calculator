/* Tamhas Trading - safe file intake (pure logic, Node-testable): ZIP archives and text encodings. No dependencies.
   ZIP: only .csv/.tsv/.txt files are extracted; everything else (executables, spreadsheets, nested archives, folders) is listed and skipped.
   Limits protect against ZIP bombs: at most 20 files, 25 MB per file and 60 MB in total after decompression, and a compression ratio of at
   most 200:1 per file. The real decompressed size is counted while inflating, so a forged header cannot get around the limits. Names with
   "..", absolute paths or drive letters are refused (nothing is ever written to disk anyway; names are only shown).
   Text: UTF-8 (with or without BOM), UTF-16 LE/BE with BOM, and Windows-1252 as a fallback when the bytes are not valid UTF-8. */
(function (root) {
  'use strict';
  var LIMITS = { files: 20, fileBytes: 25 * 1024 * 1024, totalBytes: 60 * 1024 * 1024, ratio: 200, archiveBytes: 30 * 1024 * 1024 };
  var TEXT_EXT = /\.(csv|tsv|txt)$/i;
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function isZip(bytes) { return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; }
  function isXlsxName(n) { return /\.(xlsx|xlsm|xls|ods|numbers)$/i.test(n || ''); }
  function safeName(n) { return !!n && !/(^|[\\/])\.\.([\\/]|$)/.test(n) && !/^([\\/]|[A-Za-z]:)/.test(n) && n.length <= 255 && !/[\u0000-\u001f]/.test(n); }
  function decodeName(b) { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return Array.prototype.map.call(b, function (c) { return String.fromCharCode(c); }).join(''); } }
  // Reads the central directory. Returns {ok, entries:[{name, method, csize, usize, offset}], error}
  function list(bytes) {
    if (!bytes || bytes.length < 22) return { ok: false, error: 'This file is too small to be a ZIP archive.' };
    if (bytes.length > LIMITS.archiveBytes) return { ok: false, error: 'The ZIP archive is larger than ' + (LIMITS.archiveBytes >> 20) + ' MB.' };
    var e = -1; for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(bytes, i) === 0x06054b50) { e = i; break; }
    if (e < 0) return { ok: false, error: 'The ZIP archive is damaged (no directory found).' };
    var n = u16(bytes, e + 10), cdOff = u32(bytes, e + 16), out = [], p = cdOff;
    if (n > 1000) return { ok: false, error: 'The ZIP archive lists too many files.' };
    for (var k = 0; k < n; k++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) return { ok: false, error: 'The ZIP archive is damaged (bad directory entry).' };
      var method = u16(bytes, p + 10), csize = u32(bytes, p + 20), usize = u32(bytes, p + 24), nl = u16(bytes, p + 28), xl = u16(bytes, p + 30), cl = u16(bytes, p + 32), off = u32(bytes, p + 42), flags = u16(bytes, p + 8);
      var name = decodeName(bytes.subarray(p + 46, p + 46 + nl));
      out.push({ name: name, method: method, csize: csize, usize: usize, offset: off, encrypted: !!(flags & 1), dir: /\/$/.test(name) });
      p += 46 + nl + xl + cl;
    }
    return { ok: true, entries: out };
  }
  /* inflateRaw(Uint8Array, maxBytes) -> Promise<Uint8Array> (must reject when output exceeds maxBytes).
     Returns {files:[{name, bytes}], skipped:[{name, why}]}. */
  function extract(bytes, inflateRaw) {
    var l = list(bytes); if (!l.ok) return Promise.reject(new Error(l.error));
    var files = [], skipped = [], total = 0, chain = Promise.resolve();
    l.entries.forEach(function (en) {
      chain = chain.then(function () {
        if (en.dir) return;
        if (!safeName(en.name)) { skipped.push({ name: en.name, why: 'unsafe file name' }); return; }
        var base = en.name.split('/').pop();
        if (/^(__MACOSX|\.)/.test(en.name) || /^\./.test(base)) { skipped.push({ name: en.name, why: 'system file' }); return; }
        if (!TEXT_EXT.test(base)) { skipped.push({ name: en.name, why: isXlsxName(base) ? 'spreadsheet: save it as CSV first' : /\.zip$/i.test(base) ? 'archive inside an archive' : 'not a CSV or text file' }); return; }
        if (en.encrypted) { skipped.push({ name: en.name, why: 'password-protected' }); return; }
        if (files.length >= LIMITS.files) { skipped.push({ name: en.name, why: 'more than ' + LIMITS.files + ' files' }); return; }
        if (en.usize > LIMITS.fileBytes) { skipped.push({ name: en.name, why: 'larger than ' + (LIMITS.fileBytes >> 20) + ' MB' }); return; }
        if (en.csize && en.usize / en.csize > LIMITS.ratio) { skipped.push({ name: en.name, why: 'compression ratio too high (possible ZIP bomb)' }); return; }
        var h = en.offset; if (h + 30 > bytes.length || u32(bytes, h) !== 0x04034b50) { skipped.push({ name: en.name, why: 'damaged entry' }); return; }
        var start = h + 30 + u16(bytes, h + 26) + u16(bytes, h + 28), data = bytes.subarray(start, start + en.csize);
        var cap = Math.min(LIMITS.fileBytes, LIMITS.totalBytes - total, Math.max(en.usize, 1) + 1024);
        var done = function (out) {
          if (out.length > LIMITS.fileBytes || total + out.length > LIMITS.totalBytes) { skipped.push({ name: en.name, why: 'too large after decompression (possible ZIP bomb)' }); return; }
          total += out.length; files.push({ name: base, path: en.name, bytes: out });
        };
        if (en.method === 0) return done(data.slice());
        if (en.method !== 8) { skipped.push({ name: en.name, why: 'unsupported compression' }); return; }
        return inflateRaw(data, cap).then(done, function () { skipped.push({ name: en.name, why: 'could not be decompressed safely (damaged, or larger than it claims)' }); });
      });
    });
    return chain.then(function () { return { files: files, skipped: skipped }; });
  }
  // Browser inflater with a hard output cap counted while streaming.
  function browserInflate(data, maxBytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser cannot open ZIP files. Unzip it first and choose the CSV.'));
    var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(), rd = ds.readable.getReader(), parts = [], n = 0;
    w.write(data).catch(function () {}); w.close().catch(function () {});
    function pump() { return rd.read().then(function (r) { if (r.done) return; n += r.value.length; if (n > maxBytes) { rd.cancel().catch(function () {}); throw new Error('too large'); } parts.push(r.value); return pump(); }); }
    return pump().then(function () { var out = new Uint8Array(n), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out; });
  }
  // Bytes -> text with the right encoding. Returns {text, encoding}.
  function decodeText(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16 LE' };
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16 BE' };
    var bom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bom ? b.subarray(3) : b), encoding: bom ? 'UTF-8 (BOM)' : 'UTF-8' }; }
    catch (e) { return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252' }; }
  }
  var api = { LIMITS: LIMITS, isZip: isZip, isXlsxName: isXlsxName, safeName: safeName, list: list, extract: extract, browserInflate: browserInflate, decodeText: decodeText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
