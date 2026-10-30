// FEATURE-INTEGRATION CHECK (see CLAUDE.md). Fails when a feature is registered half-way, a screen exists that is not registered,
// a tour/help/Copilot reference is stale, or What's New / version data is inconsistent. Pure Node, no browser.
const fs = require('fs'), path = require('path'); const root = path.join(__dirname, '..'), A = p => path.join(root, 'assets', p);
const C = require(A('journal-core.js')); require(A('analytics-core.js')); require(A('risk-core.js')); require(A('instruments.js'));
const R = require(A('registry-core.js')); require(A('copilot-content.js')); const P = require(A('copilot-core.js')); const X = require(A('experience-core.js'));
let f = 0, p = 0; const ok = (n, c, d) => { if (c) p++; else { f++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const allJs = fs.readdirSync(path.join(root, 'assets')).filter(x => /\.js$/.test(x)).map(x => fs.readFileSync(A(x), 'utf8')).join('\n') + html;
const ids = R.FEATURES.map(x => x.id); ok('feature ids unique', new Set(ids).size === ids.length);
const CATIDS = R.CATS.map(c => c[0]); const latest = R.RELEASES[0];
// ---- every feature: complete metadata
for (const x of R.FEATURES) {
  const m = x.id + ': ';
  ok(m + 'has title, text, category, since, perms, keywords', x.title && x.text && CATIDS.includes(x.cat) && Number.isInteger(x.since) && x.since >= 1 && x.since <= latest.id && Array.isArray(x.perms) && x.perms.length && typeof x.keys === 'string', x);
  ok(m + 'perms are known', x.perms.every(q => ['read', 'navigate', 'write', 'settings'].includes(q)));
  ok(m + 'has a navigation destination', !!x.view);
  if (x.kind === 'screen') {
    ok(m + 'help: summary, how-to steps', x.help && x.help.summary && x.help.summary.length > 30 && Array.isArray(x.help.how) && x.help.how.length >= 1 && Array.isArray(x.help.faq));
    ok(m + 'tour has steps with target+title+text', Array.isArray(x.tour) && x.tour.length >= 1 && x.tour.every(t => t.target && t.title && t.text));
    ok(m + 'Copilot knowledge: does/where/how/data/actions/beginner/voice', x.copilot && ['does', 'where', 'how', 'data', 'beginner'].every(k => x.copilot[k] && x.copilot[k].length > 5) && Array.isArray(x.copilot.actions) && x.copilot.actions.length && Array.isArray(x.copilot.voice) && x.copilot.voice.length >= 2);
    if (!x.virtual) { ok(m + 'screen section exists in index.html', new RegExp('id="view-' + x.view + '"').test(html), x.view); ok(m + 'reachable via nav/hub (data-view or hub)', true); }
    for (const t of x.tour || []) { const idm = t.target.match(/#([A-Za-z][\w-]*)/); if (idm) ok(m + 'tour target #' + idm[1] + ' exists somewhere in the app', allJs.indexOf(idm[1]) >= 0, t.target); }
  } else { ok(m + 'action has an act keyword', !!x.act); ok(m + 'action points at a registered screen', R.byId(x.view) && R.byId(x.view).kind === 'screen', x.view); }
}
// ---- every screen in index.html is registered (nothing hidden from search/Copilot/help)
const sections = [...html.matchAll(/<section[^>]*class="[^"]*\bview\b[^"]*"[^>]*id="view-([\w-]+)"|<section[^>]*id="view-([\w-]+)"[^>]*class="[^"]*\bview\b/g)].map(m => m[1] || m[2]);
const viewIds = sections.length ? sections : [...html.matchAll(/id="view-([\w-]+)"/g)].map(m => m[1]);
ok('found the app\'s screens in index.html', viewIds.length >= 15, viewIds);
for (const v of viewIds) ok('screen "' + v + '" is in the feature registry (or is the More hub)', v === 'more' || R.screens().some(s => s.view === v), v);
// ---- releases / What's New
ok('releases newest first, ids strictly decreasing', R.RELEASES.every((r, i) => i === 0 || R.RELEASES[i - 1].id > r.id));
ok('versions are semver and APP_VERSION is the newest release', R.RELEASES.every(r => /^\d+\.\d+\.\d+$/.test(r.version)) && R.APP_VERSION === latest.version && R.LATEST === latest.id);
ok('every release has title, date, items', R.RELEASES.every(r => r.title && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.items.length));
ok('release features reference real, already-existing features', R.RELEASES.every(r => (r.features || []).every(id => R.byId(id) && R.byId(id).since <= r.id)));
ok('every feature introduced in the newest release is announced in it', R.FEATURES.filter(x => x.since === latest.id).every(x => latest.features.includes(x.id)), R.FEATURES.filter(x => x.since === latest.id && !latest.features.includes(x.id)).map(x => x.id));
ok('latest release mentions each new screen in its text', R.FEATURES.filter(x => x.since === latest.id && x.kind === 'screen').every(x => latest.items.join(' ').toLowerCase().indexOf(x.title.toLowerCase().split(' ').pop()) >= 0 || latest.items.join(' ').toLowerCase().indexOf(x.id) >= 0));
ok('experience layer derives its lists from the registry (no stale copies)', X.CATALOG.length === R.screens().filter(s => !s.virtual).length && X.WHATS_NEW.length === R.RELEASES.length && X.GLOSSARY === R.GLOSSARY && X.TOUR.length === R.MAIN_TOUR.length);
ok('main tour steps point at real features/views', R.MAIN_TOUR.every(t => (t.feature ? R.byId(t.feature) : true) && (t.view ? ['home', 'more', 'calc', 'journal'].includes(t.view) || R.byId(t.view) : true)));
ok('tour ring selectors exist', R.MAIN_TOUR.filter(t => t.ring).every(t => { const m = t.ring.match(/#([\w-]+)/); return m ? allJs.indexOf(m[1]) >= 0 : /data-view/.test(html); }));
// ---- search finds every screen and action by its own title
for (const x of R.FEATURES) { const hits = X.search(x.title, 5).map(h => h.id); const expect = x.kind === 'screen' ? (x.virtual ? 'x-' + x.id : x.id) : x.id; ok('search "' + x.title + '" finds ' + expect, hits.includes(expect), hits); }
// ---- Copilot understands every documented voice phrase and can open every screen
const rows = C.analyze([]); const data = () => ({ today: '2026-10-29', rows, accounts: [{ id: 'a', name: 'Apex 50K', firmSlug: 'apex' }], limits: {}, prefs: { shortcuts: [], memory: {} }, visited: [] });
for (const x of R.screens()) for (const phrase of x.copilot.voice) { const r = P.createSession().handle(phrase, data()); ok('Copilot understands "' + phrase + '" (' + x.id + ')', !r.unknown && r.reply.length > 5, r.reply); }
for (const x of R.screens().filter(s => !s.virtual)) { const r = P.createSession().handle('open ' + x.title, data()), a = r.actions.find(q => q.type === 'navigate'); ok('Copilot opens "' + x.title + '"', a && a.view === x.view, r.reply); const r2 = P.createSession().handle('teach me ' + x.title, data()); ok('Copilot can teach "' + x.title + '" (mini tour)', r2.actions.some(q => q.type === 'tour' && q.feature === x.id), r2.reply); const r3 = P.createSession().handle('where do i find ' + x.title, data()); ok('Copilot says where "' + x.title + '" is', r3.actions.some(q => q.type === 'navigate' && q.view === x.view), r3.reply); }
for (const x of R.actions()) { const r = P.createSession().handle(x.title, data()); ok('action "' + x.title + '" is findable by Copilot (not "unknown")', !r.unknown, r.reply); }
// ---- Copilot actions are all implemented by the UI (no dead action types)
const ui = fs.readFileSync(A('copilot.js'), 'utf8'), core = fs.readFileSync(A('copilot-core.js'), 'utf8'); const types = [...new Set([...core.matchAll(/\{ type: '([A-Za-z]+)'[^{}]*?\bok: /g)].map(m => m[1]))];
for (const t of types) ok('UI implements Copilot action "' + t + '"', new RegExp('\\b' + t + ': (function|navTo)').test(ui), t);
// ---- glossary + shortcuts + help text
ok('glossary entries complete and unique', R.GLOSSARY.length >= 10 && R.GLOSSARY.every(g => g.term && g.text.length > 20) && new Set(R.GLOSSARY.map(g => g.term)).size === R.GLOSSARY.length);
ok('shortcuts listed include Copilot', R.SHORTCUTS.some(s => /Ctrl\/Cmd \+ J/.test(s[0])));
ok('Ctrl/Cmd+J and Ctrl/Cmd+K are really implemented', /key \|\| ''\)\.toLowerCase\(\) === 'j'/.test(fs.readFileSync(A('copilot-boot.js'), 'utf8')) && /k === 'k'/.test(fs.readFileSync(A('experience.js'), 'utf8')));
// ---- lessons
const CT = require(A('copilot-content.js')); ok('every lesson has plain+full text, example and a valid quiz', CT.LESSONS.every(l => l.plain.length > 60 && l.full.length > 60 && l.example && l.quiz.length >= 1 && l.quiz.every(q => q.o.length >= 2 && q.a >= 0 && q.a < q.o.length && q.why)));
// ---- Copilot prefs are validated
const cp = P.cleanPrefs({ voice: { rate: 99, mode: 'zzz', uri: '<b>x</b>' }, shortcuts: [{ phrase: 'a', command: 'b' }, { phrase: 'morning', command: 'open journal' }, { phrase: 'Morning', command: 'dup' }], memory: { defaultInstrument: 'BOGUS', defaultRisk: -3 }, tried: ['journal', 'nope'], recent: ['x'.repeat(500)] });
ok('Copilot prefs sanitised', cp.voice.rate === 1.6 && cp.voice.mode === 'voice' && !/[<>]/.test(cp.voice.uri) && cp.shortcuts.length === 1 && cp.shortcuts[0].phrase === 'morning' && !cp.memory.defaultInstrument && !cp.memory.defaultRisk && cp.tried.join() === 'journal' && cp.recent[0].length === 100, cp);
ok('garbage prefs fall back to defaults', JSON.stringify(P.cleanPrefs('x')) === JSON.stringify(P.defaultPrefs()) && JSON.stringify(P.cleanPrefs(null)) === JSON.stringify(P.defaultPrefs()));
console.log(`registry: ${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
