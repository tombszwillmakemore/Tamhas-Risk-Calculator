// Search, voice grammar, feedback text, backup reminder, feature registry integrity.
const path = require('path'), fs = require('fs'), R = path.join(__dirname, '..', 'assets') + '/';
global.TTInstruments = require(R + 'instruments.js'); global.TTHelpData = require(R + 'help-data.js'); const H = require(R + 'help-core.js'), D = global.TTHelpData;
let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } }; const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const top = q => (H.search(q)[0] || {}).id;
ok('search: tradovate -> import in top 2', H.search('tradovate').slice(0, 2).some(x => x.id === 'import')); eq('search: screenshot -> import', top('screenshot'), 'import');
eq('search: export csv -> tradovate guide', top('export tradovate report'), 'tradovate-guide'); eq('search: commission -> import settings', top('commission'), 'import-settings');
eq('search: install iphone -> install', top('install iphone'), 'install'); eq('search: backup', top('backup'), 'backup'); eq('search: drawdown -> learn first', H.search('drawdown')[0].kind, 'learn');
eq('search: dark mode -> settings', top('dark theme'), 'settings'); eq('search: nonsense -> nothing', H.search('zzqx').length, 0); eq('search: stop words only', H.search('show me the').length, 0);
eq('search: prefix "anal" -> analytics', top('anal'), 'analytics');
// voice
eq('voice: open journal', H.parseVoice('Open journal').id, 'journal'); eq('voice: import trades', H.parseVoice('import trades').id, 'import');
eq('voice: go to risk calculator', H.parseVoice('go to the risk calculator').id, 'calc');
eq('voice: calc with range', H.parseVoice('risk MNQ stop 20 points risk 100 to 200'), { type: 'calc', instrument: 'MNQ', stop: 20, min: 100, max: 200 });
eq('voice: calc spoken numbers + micro gold', H.parseVoice('calculate micro gold stop ten risk fifty to hundred'), { type: 'calc', instrument: 'MGC', stop: 10, min: 50, max: 100 });
eq('voice: calc single risk', H.parseVoice('position size NQ stop 15 risking 300 dollars'), { type: 'calc', instrument: 'NQ', stop: 15, min: 300, max: 300 });
eq('voice: calc swapped range', H.parseVoice('risk ES stop 4 between 400 and 200').min, 200);
eq('voice: explain drawdown', H.parseVoice('explain drawdown').id, 'drawdown'); eq('voice: what is fomo', H.parseVoice("what's FOMO").id, 'fomo');
eq('voice: search', H.parseVoice('search for fees'), { type: 'search', q: 'fees' }); eq('voice: stop', H.parseVoice('stop').type, 'stop');
eq('voice: unknown', H.parseVoice('blorp the snargle').type, 'unknown'); eq('voice: empty', H.parseVoice('').type, 'unknown');
// feedback
const fb = H.feedbackText({ type: 'bug', title: 'Import fails', body: 'It shows an error on my file', steps: '1. drop file' }, { version: '1.2.0', ua: 'X', screen: '390x844', standalone: true, online: true, theme: 'dark', counts: '12 trades', errors: '' });
ok('feedback has summary and steps', /Summary: Import fails/.test(fb) && /Steps to reproduce/.test(fb)); ok('feedback diag present and says no trades', /no trades, no account names/.test(fb) && /Version: 1.2.0/.test(fb));
ok('feedback without diag has no app details', !/App details/.test(H.feedbackText({ type: 'feature', title: 't', body: 'long enough text' }, null)));
eq('feedback validation', [H.feedbackValid({ title: '', body: 'xxxxxxxxxxxx' }), H.feedbackValid({ title: 'a', body: 'short' }), H.feedbackValid({ title: 'a', body: 'long enough body' })], ['Give it a short summary.', 'Describe it in a sentence or two.', null]);
// backup reminder
const now = Date.UTC(2026, 9, 30);
eq('backup: no trades -> not due', H.backupDue({ trades: 0, now }).due, false); eq('backup: never -> due', H.backupDue({ trades: 3, now }), { due: true, reason: 'never' });
eq('backup: 8 days old -> due', H.backupDue({ trades: 3, now, lastBackup: now - 8 * 864e5 }).days, 8); eq('backup: 2 days -> not due', H.backupDue({ trades: 3, now, lastBackup: now - 2 * 864e5 }).due, false);
eq('backup: snoozed', H.backupDue({ trades: 3, now, snoozeUntil: now + 1 }).due, false);
// registry integrity: every feature points to a real section, and listed tests exist
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
D.features.forEach(f => { ok('section exists for ' + f.id, html.indexOf('id="view-' + f.view + '"') >= 0, f.view); (f.tests || []).forEach(t => ok('test file exists ' + t + ' (' + f.id + ')', fs.existsSync(path.join(__dirname, t)))); ok('has how-to ' + f.id, f.how && f.how.length > 30); });
eq('feature ids unique', new Set(D.features.map(f => f.id)).size, D.features.length);
console.log((fail ? 'FAILED ' : 'ALL PASSED ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
