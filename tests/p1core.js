// Platform rules (pure): backup reminder and install-guide choice; plus Smart Import registration in the feature registry.
const path = require('path'), R = path.join(__dirname, '..', 'assets') + '/';
const P = require(R + 'platform-core.js'), REG = require(R + 'registry-core.js');
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const now = Date.UTC(2026, 9, 30);
eq('backup: no trades -> not due', P.backupDue({ trades: 0, now }).due, false); eq('backup: never -> due', P.backupDue({ trades: 3, now }), { due: true, reason: 'never' });
eq('backup: 8 days old -> due with days', P.backupDue({ trades: 3, now, lastBackup: now - 8 * 864e5 }).days, 8); eq('backup: 2 days -> not due', P.backupDue({ trades: 3, now, lastBackup: now - 2 * 864e5 }).due, false);
eq('backup: old but nothing new since -> not due', P.backupDue({ trades: 3, now, lastBackup: now - 9 * 864e5, changedSince: false }).due, false); eq('backup: snoozed', P.backupDue({ trades: 3, now, snoozeUntil: now + 1 }).due, false);
eq('install tab: iPhone', P.installTab('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5), 'ios'); eq('install tab: iPad (desktop UA)', P.installTab('Mozilla/5.0 (Macintosh)', 'MacIntel', 5), 'ios');
eq('install tab: Samsung', P.installTab('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/26.0', 'Linux', 5), 'samsung'); eq('install tab: Pixel Chrome', P.installTab('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130', 'Linux', 5), 'android');
const imp = REG.byId('import'); ok('registry: import mentions Tradovate and screenshots', /Tradovate/.test(imp.help.summary) && /screenshot/i.test(imp.help.summary)); ok('registry: import tour targets the drop zone', imp.tour[0].target === '#im-drop');
ok('registry: install screen registered', REG.byId('install') && REG.byId('install').view === 'install'); eq('registry: APP_VERSION is the newest release', REG.APP_VERSION, REG.RELEASES[0].version); ok('registry: release 2.0.0 (Smart Import) is in the history', REG.RELEASES.some(r => r.version === '2.0.0' && r.features.indexOf('import') >= 0));
console.log((fail ? 'FAILED ' : 'ALL PASSED ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
