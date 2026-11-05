// Safe file intake: ZIP limits (bombs, traversal, nested archives), encodings. Archives are built here in memory.
const path = require('path'), zlib = require('zlib'), Z = require(path.join(__dirname, '..', 'assets', 'zip-core.js'));
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
// minimal ZIP writer. files: [{name, data(Buffer), store?, fakeSize?, encrypt?}]
function zip(files) {
  const locals = [], central = []; let off = 0;
  files.forEach(f => {
    const name = Buffer.from(f.name), comp = f.store ? f.data : zlib.deflateRawSync(f.data), usize = f.fakeSize != null ? f.fakeSize : f.data.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(f.encrypt ? 1 : 0, 6); lh.writeUInt16LE(f.store ? 0 : 8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(f.encrypt ? 1 : 0, 8); ch.writeUInt16LE(f.store ? 0 : 8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); central.push(ch, name); off += 30 + name.length + comp.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat(locals.concat([cd, end])));
}
const nodeInflate = (data, max) => new Promise((res, rej) => { try { const out = zlib.inflateRawSync(Buffer.from(data), { maxOutputLength: max }); res(new Uint8Array(out)); } catch (e) { rej(e); } });
(async () => {
  const csv = Buffer.from('timestamp,cashChangeType,amount\n2026-11-03 09:00:00,Commission,-1.24\n');
  let z = zip([{ name: 'cash.csv', data: csv }, { name: 'stored.txt', data: csv, store: true }]);
  ok('ZIP recognised', Z.isZip(z));
  let r = await Z.extract(z, nodeInflate); eq('CSV and text files extracted (deflate and stored)', r.files.map(f => [f.name, Buffer.from(f.bytes).toString() === csv.toString()]), [['cash.csv', true], ['stored.txt', true]]);
  r = await Z.extract(zip([{ name: '../../etc/evil.csv', data: csv }, { name: '/abs.csv', data: csv }, { name: 'C:\\x.csv', data: csv }, { name: 'ok/inner.csv', data: csv }]), nodeInflate);
  eq('path traversal and absolute names refused; folder paths are fine', [r.files.map(f => f.name), r.skipped.map(s => s.why)], [['inner.csv'], ['unsafe file name', 'unsafe file name', 'unsafe file name']]);
  r = await Z.extract(zip([{ name: 'run.exe', data: Buffer.from('MZ') }, { name: 'book.xlsx', data: csv }, { name: 'inner.zip', data: csv }, { name: '__MACOSX/._cash.csv', data: csv }]), nodeInflate);
  eq('executables, spreadsheets, nested archives and system files are skipped with a reason', r.skipped.map(s => s.why), ['not a CSV or text file', 'spreadsheet: save it as CSV first', 'archive inside an archive', 'system file']);
  const bomb = Buffer.alloc(30 * 1024 * 1024, 48);                                   // 30 MB of zeros compresses ~1000:1
  r = await Z.extract(zip([{ name: 'bomb.csv', data: bomb }]), nodeInflate); ok('ZIP bomb (real size in header) refused', !r.files.length && /larger than|ratio/.test(r.skipped[0].why), r.skipped);
  r = await Z.extract(zip([{ name: 'liar.csv', data: Buffer.alloc(8 * 1024 * 1024, 48), fakeSize: 1000 }]), nodeInflate);
  ok('ZIP bomb with a forged small size refused while inflating', !r.files.length && r.skipped.length === 1, r.skipped);
  r = await Z.extract(zip(Array.from({ length: 25 }, (_, i) => ({ name: 'f' + i + '.csv', data: csv }))), nodeInflate); eq('at most 20 files', [r.files.length, r.skipped.length], [20, 5]);
  r = await Z.extract(zip([{ name: 'secret.csv', data: csv, encrypt: true }]), nodeInflate); eq('password-protected entries skipped', r.skipped[0].why, 'password-protected');
  ok('damaged archive rejected safely', await Z.extract(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]), nodeInflate).then(() => false, e => /small|damaged/.test(e.message)));
  // encodings
  eq('UTF-8 with BOM', Z.decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xc3, 0xa9])), { text: 'aé', encoding: 'UTF-8 (BOM)' });
  eq('UTF-16 LE (Excel "Unicode text")', Z.decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0, 0x2c, 0]))['text'], 'a,');
  eq('Windows-1252 fallback for non-UTF-8 bytes', Z.decodeText(new Uint8Array([0x80, 0x31])), { text: '€1', encoding: 'Windows-1252' });
  console.log(fail ? 'FAILED ' + pass + ' passed, ' + fail + ' failed' : 'ALL PASSED ' + pass + ' passed, 0 failed'); process.exit(fail ? 1 : 0);
})();
