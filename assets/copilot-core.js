/* TRC Copilot - the brain (pure functions, no DOM, no network, no storage).
   It is a rule-based assistant, NOT a large language model: it recognises a fixed set of requests, keeps short
   conversation context, answers from the trades/settings it is handed, and returns ACTION DESCRIPTORS that the UI
   performs through the app's real functions. It never claims an action succeeded; the UI reports the real outcome.
   Unknown numbers are never invented: missing data produces an explanation, not a guess. */
(function (root) {
  'use strict';
  function dep(g, p) { return root[g] || (typeof require === 'function' ? require(p) : null); }
  var REG = dep('TTRegistry', './registry-core.js'), INST = dep('TTInstruments', './instruments.js'), CT = dep('TTCopilotContent', './copilot-content.js');
  function A() { return dep('TTAnalyticsCore', './analytics-core.js'); }
  function K() { return dep('TTRiskCore', './risk-core.js'); }
  var MAX_SHORTCUTS = 20, MAX_MEMORY = 10;

  /* ---------- text and numbers ---------- */
  var ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function isNumWord(w) { return Object.prototype.hasOwnProperty.call(ONES, w) || Object.prototype.hasOwnProperty.call(TENS, w) || w === 'hundred' || w === 'thousand'; }
  // "twenty eight" -> "28", "one hundred fifty" -> "150", "twenty point five" -> "20.5". Leaves everything else alone.
  function wordsToNumbers(s) {
    var tk = String(s).split(/\s+/), out = [], i = 0;
    while (i < tk.length) {
      var w = tk[i];
      var aHundred = (w === 'a' || w === 'one') && (tk[i + 1] === 'hundred' || tk[i + 1] === 'thousand');
      if (!(isNumWord(w) || (w === 'a' && aHundred))) { out.push(w); i++; continue; }
      var total = 0, cur = 0, j = i, used = false;
      while (j < tk.length) {
        var x = tk[j];
        if (x === 'and' && used && j + 1 < tk.length && isNumWord(tk[j + 1]) && cur >= 100) { j++; continue; }
        if (x === 'a' && (tk[j + 1] === 'hundred' || tk[j + 1] === 'thousand')) { cur = 1; used = true; j++; continue; }
        if (Object.prototype.hasOwnProperty.call(ONES, x)) { cur += ONES[x]; }
        else if (Object.prototype.hasOwnProperty.call(TENS, x)) { cur += TENS[x]; }
        else if (x === 'hundred') { cur = (cur || 1) * 100; }
        else if (x === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
        else break;
        used = true; j++;
      }
      var val = total + cur, txt = String(val);
      // decimals: "point" followed by digit words or digits ("twenty point five")
      if (tk[j] === 'point' && j + 1 < tk.length && (/^\d+$/.test(tk[j + 1]) || (Object.prototype.hasOwnProperty.call(ONES, tk[j + 1]) && ONES[tk[j + 1]] < 10))) {
        var frac = '', k = j + 1;
        while (k < tk.length && (Object.prototype.hasOwnProperty.call(ONES, tk[k]) && ONES[tk[k]] < 10 || /^\d$/.test(tk[k]))) { frac += /^\d$/.test(tk[k]) ? tk[k] : ONES[tk[k]]; k++; }
        if (frac) { txt += '.' + frac; j = k; }
      }
      out.push(txt); i = j;
    }
    return out.join(' ');
  }
  function norm(s) {
    var t = String(s == null ? '' : s).toLowerCase().replace(/[‘’]/g, "'").replace(/\$\s+/g, '$');
    t = t.replace(/(\d)\.(\d)/g, '$1\u0001$2').replace(/(\d),(\d{3})/g, '$1$2');
    t = t.replace(/[^a-z0-9$%\u0001'\s-]/g, ' ').replace(/'/g, '').replace(/-/g, ' ').replace(/\u0001/g, '.').replace(/\s+/g, ' ').trim();
    return wordsToNumbers(t);
  }
  function money(c, signed) { if (c == null || !isFinite(c)) return '—'; var neg = c < 0, a = Math.abs(Math.round(c)), s = '$' + Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(a % 100).padStart(2, '0'); return neg ? '-' + s : (signed && c > 0 ? '+' + s : s); }
  function pct(x) { return x == null ? '—' : (x * 100).toFixed(0) + '%'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var ALIASES = [
    ['NNQ', ['e nano nasdaq', 'nano nasdaq', 'nano nq', 'nano nas', 'nnq']], ['NES', ['e nano s p', 'nano s p', 'nano es', 'nano spx', 'nes']],
    ['MNQ', ['micro e mini nasdaq', 'micro nasdaq', 'micro nq', 'mnq']], ['MES', ['micro e mini s p', 'micro s p', 'micro es', 'mes']],
    ['MGC', ['micro gold', 'mgc']], ['NQ', ['e mini nasdaq', 'emini nasdaq', 'nasdaq futures', 'nasdaq', 'nq']], ['GC', ['gold futures', 'gold', 'gc']],
    ['ES', ['e mini s p', 'emini s p', 's p 500', 's p', 'spx', 'es']]
  ];
  var FLAT = []; ALIASES.forEach(function (a) { a[1].forEach(function (al) { FLAT.push([al, a[0]]); }); }); FLAT.sort(function (x, y) { return y[0].length - x[0].length; });
  function findInstrument(n) {
    var p = ' ' + n + ' ';
    for (var i = 0; i < FLAT.length; i++) if (p.indexOf(' ' + FLAT[i][0] + ' ') >= 0) return FLAT[i][1];
    return null;
  }
  function numStr(m) { return parseFloat(m); }
  /* Pull stop points, dollar amounts, contract counts and an instrument out of an utterance. Returns only what was said. */
  function slotsFrom(n) {
    var s = {}, rest = n, m;
    s.inst = findInstrument(n);
    m = /(?:between|from)\s*\$?(\d+(?:\.\d+)?)\s*(?:and|to)\s*\$?(\d+(?:\.\d+)?)(?:\s*(?:dollars?|bucks?|usd))?/.exec(rest);
    if (m && !/point|pts/.test(rest.slice(m.index + m[0].length, m.index + m[0].length + 8))) { var a = numStr(m[1]), b = numStr(m[2]); s.minRisk = Math.min(a, b); s.risk = Math.max(a, b); rest = rest.replace(m[0], ' '); }
    m = /(\d+(?:\.\d+)?)\s*(?:points?|pts?|handles?)\b/.exec(rest) || /\bstop(?: loss)?(?: of| at| is| with| to)?\s*(\d+(?:\.\d+)?)(?!\s*(?:dollars?|bucks?|usd|k\b|contracts?))/.exec(rest);
    if (m) { s.stop = numStr(m[1]); rest = rest.replace(m[0], ' '); }
    m = /(\d+(?:\.\d+)?)\s*(?:contracts?|lots?)\b/.exec(rest); if (m) { s.contracts = numStr(m[1]); rest = rest.replace(m[0], ' '); }
    m = /\$(\d+(?:\.\d+)?)(k?)/.exec(rest) || /(\d+(?:\.\d+)?)(k?)\s*(?:dollars?|bucks?|usd)\b/.exec(rest);
    if (m && s.risk == null) { s.risk = numStr(m[1]) * (m[2] ? 1000 : 1); rest = rest.replace(m[0], ' '); }
    if (s.risk == null) { m = /\b(?:risk(?:ing)?|max(?:imum)?|budget)(?: of| at| is| about)?\s*(\d+(?:\.\d+)?)\b/.exec(rest); if (m) { s.risk = numStr(m[1]); rest = rest.replace(m[0], ' '); } }
    s.rest = rest.trim();
    s.bare = /^\D*(\d+(?:\.\d+)?)\D*$/.test(rest) ? numStr(/(\d+(?:\.\d+)?)/.exec(rest)[1]) : null;
    return s;
  }

  /* ---------- the calculator rule (same arithmetic as calculator.js, used only when the UI cannot drive the real calculator) ---------- */
  function calcFallback(o) {
    var i = INST.byId[o.inst]; if (!i) return { status: 'invalid', message: 'I do not know that contract.' };
    var stop = o.stop, min = o.minRisk || 0, max = o.risk;
    if (!(stop > 0) || !(max > 0)) return { status: 'invalid', message: 'Stop distance and maximum risk must be greater than zero.' };
    if (min > max) return { status: 'invalid', message: 'Minimum risk cannot be greater than maximum risk.' };
    var per = Math.round(stop * i.centsPerPoint), maxC = Math.round(max * 100), minC = Math.round(min * 100);
    if (per > maxC) return { status: 'toolarge', perCents: per };
    var n = Math.floor(maxC / per), tot = n * per;
    if (n < 1 || tot < minC || tot > maxC) return { status: 'nofit', perCents: per };
    return { status: 'ok', contracts: n, perCents: per, totalCents: tot };
  }

  /* ---------- data helpers ---------- */
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(date, k) { var p = date.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  function weekStart(date) { var p = date.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); return addDays(date, -((d.getUTCDay() + 6) % 7)); }
  function rangeOf(n, today) {
    if (/\btoday\b|\bthis session\b|\bmy day\b/.test(n)) return { from: today, to: today, label: 'today', key: 'today' };
    if (/\byesterday\b/.test(n)) { var y = addDays(today, -1); return { from: y, to: y, label: 'yesterday', key: 'yesterday' }; }
    if (/last week|previous week/.test(n)) { var w = addDays(weekStart(today), -7); return { from: w, to: addDays(w, 6), label: 'last week', key: 'lastweek' }; }
    if (/this week|weekly/.test(n)) { var s = weekStart(today); return { from: s, to: addDays(s, 6), label: 'this week', key: 'week' }; }
    if (/last month|previous month/.test(n)) { var p = today.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 2, 1)), e = new Date(Date.UTC(+p[0], +p[1] - 1, 0)); return { from: d.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10), label: 'last month', key: 'lastmonth' }; }
    if (/this month/.test(n)) { return { from: today.slice(0, 8) + '01', to: today.slice(0, 8) + '31', label: 'this month', key: 'month' }; }
    return null;
  }
  function basisOf(rows) { return rows.some(function (r) { return r.c.isClosed && !r.c.feesMissing; }) ? 'net' : 'gross'; }
  function prep(rows, f) { var b = basisOf(rows); var p = A().prepare(rows, f || {}, b); p.sum = A().summary(p.inc); return p; }
  function tradeWord(n) { return n === 1 ? 'trade' : 'trades'; }
  function sampleNote(n) { return n < 10 ? ' That is a very small sample (' + n + ' ' + tradeWord(n) + '), so treat it as a hint, not a conclusion.' : n < 30 ? ' This is a small sample (' + n + ' trades), so take it with caution.' : ''; }

  /* ---------- conversation session ---------- */
  function createSession(opts) {
    opts = opts || {};
    var ctx = { last: null, topic: null, level: 'plain', inst: null, stop: null, risk: null, minRisk: null, lastSlot: null, pending: null, confirm: null, routine: null, quiz: null, range: null, lastCalc: null, depth: 0 };
    function R(reply, extra) { var o = { reply: reply, actions: [], chips: [], confirm: null }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
    function ask(reply, need, chips) { ctx.pending = { need: need, intent: 'calc' }; return R(reply, { chips: chips || [], expecting: need[0] }); }
    function needConfirm(prompt, actions, done) { ctx.confirm = { actions: actions, done: done }; return R(prompt, { confirm: true, chips: ['Yes, do it', 'No, cancel'] }); }

    /* ----- position size ----- */
    function calcFlow(data, say) {
      var mem = (data.prefs && data.prefs.memory) || {};
      if (ctx.stop == null) { return ask('What stop distance do you want to use, in points?', ['stop']); }
      var need = [];
      if (!ctx.inst && mem.defaultInstrument) ctx.inst = mem.defaultInstrument;
      if (ctx.risk == null && mem.defaultRisk) ctx.risk = mem.defaultRisk;
      if (!ctx.inst) need.push('inst'); if (ctx.risk == null) need.push('risk');
      if (need.length) return ask(need.length === 2 ? 'What instrument and risk amount would you like to use?' : need[0] === 'inst' ? 'Which contract would you like to use? For example Nano Nasdaq, Micro Nasdaq or Nasdaq.' : 'How much do you want to risk, at most, in dollars?', need, need[0] === 'inst' ? ['Nano Nasdaq', 'Micro Nasdaq', 'Nasdaq', 'Micro S&P'] : []);
      ctx.pending = null;
      var q = { inst: ctx.inst, stop: ctx.stop, minRisk: ctx.minRisk || 0, risk: ctx.risk };
      var res = (data.calc && typeof data.calc.run === 'function') ? data.calc.run(q) : calcFallback(q);
      ctx.lastCalc = { q: q, res: res };
      var name = ctx.inst + ' (' + INST.byId[ctx.inst].label + ' per point)', pre = say || '';
      var act = [{ type: 'fillCalc', inst: ctx.inst, stop: ctx.stop, minRisk: ctx.minRisk || 0, risk: ctx.risk, ok: 'I have loaded the calculator.', fail: 'I could not load the calculator on this screen.' }];
      if (res.status === 'ok') return R(pre + 'That gives you ' + plural(res.contracts, 'contract') + ', with ' + money(res.totalCents) + ' of planned risk (' + money(res.perCents) + ' per contract on ' + name + '). ' + (res.contracts > 0 ? '' : ''), { actions: act, chips: ['What if I use a ten point stop?', 'Use ' + (ctx.inst === 'NNQ' ? 'Micro Nasdaq' : 'Nano Nasdaq'), 'What does this mean?'], calc: res });
      if (res.status === 'toolarge') return R(pre + 'A ' + ctx.stop + ' point stop on ' + ctx.inst + ' risks ' + money(res.perCents) + ' for even one contract, which is above your ' + money(ctx.risk * 100) + ' maximum. Try a smaller stop, a smaller contract such as Micro or Nano, or a higher risk amount.', { actions: act, chips: ['Use Nano Nasdaq', 'Use a smaller stop'], calc: res });
      if (res.status === 'nofit') return R(pre + 'No whole number of contracts fits inside your range. One contract risks ' + money(res.perCents) + '.', { actions: act, calc: res });
      return R(pre + (res.message || 'I could not calculate that.'), { calc: res });
    }
    function mergeCalc(sl, force) {
      var changed = [];
      if (sl.inst) { ctx.inst = sl.inst; changed.push('inst'); }
      if (sl.stop != null) { ctx.stop = sl.stop; changed.push('stop'); ctx.lastSlot = 'stop'; }
      if (sl.minRisk != null) { ctx.minRisk = sl.minRisk; changed.push('minRisk'); }
      if (sl.risk != null) { ctx.risk = sl.risk; changed.push('risk'); ctx.lastSlot = 'risk'; }
      return changed;
    }

    /* ----- features and navigation ----- */
    var STOPW = { a: 1, an: 1, the: 1, my: 1, me: 1, to: 1, of: 1, for: 1, and: 1, open: 1, go: 1, show: 1, take: 1, switch: 1, please: 1, screen: 1, page: 1, tab: 1, i: 1, want: 1, see: 1, view: 1, up: 1, bring: 1, pull: 1, launch: 1, find: 1, where: 1, do: 1, is: 1, are: 1, how: 1, can: 1, what: 1, whats: 1, tell: 1, about: 1, on: 1, in: 1, it: 1, this: 1, that: 1, use: 1, change: 1, set: 1, get: 1, make: 1, new: 0 };
    function toks(s) { return s.split(' ').filter(function (w) { return w && !STOPW[w]; }); }
    function findFeature(n, includeActions) {
      var q = toks(n), best = null, bestScore = 0;
      if (!q.length) return null;
      REG.FEATURES.forEach(function (f) {
        if (f.kind === 'action' && !includeActions) return;
        var hay = ' ' + norm(f.title + ' ' + (f.keys || '') + ' ' + (f.copilot ? f.copilot.voice.join(' ') : '')) + ' ', titleN = norm(f.title), sc = 0;
        if (n.indexOf(titleN) >= 0) sc += 10 + titleN.length / 10;
        q.forEach(function (w) { if (w.length > 2 && (' ' + titleN + ' ').indexOf(' ' + w + ' ') >= 0) sc += 3; else if (w.length > 2 && hay.indexOf(' ' + w + ' ') >= 0) sc += 2; else if (w.length > 3 && hay.indexOf(w) >= 0) sc += 1; });
        if (f.id === 'calc' && /calculator|position size/.test(n)) sc += 6;
        if (sc > bestScore) { bestScore = sc; best = f; }
      });
      return bestScore >= 2 ? best : null;
    }
    function titleMatch(n) {
      var best = null, bl = 0;
      REG.FEATURES.forEach(function (f) { if (f.kind !== 'screen' || f.virtual) return; var t = norm(f.title), alts = [t, t.replace(/ and glossary| center| lab| calculator/, '')]; if (f.id === 'calc') alts.push('calculator', 'risk calculator'); if (f.id === 'journal') alts.push('journal', 'trading journal'); if (f.id === 'home') alts.push('home', 'dashboard'); if (f.id === 'help') alts.push('help'); if (f.id === 'intel') alts.push('market intel', 'intel');
        alts.forEach(function (a) { if (a.length > 3 && (' ' + n + ' ').indexOf(' ' + a + ' ') >= 0 && a.length > bl) { best = f; bl = a.length; } }); });
      return best;
    }
    var VIEWTAB = { calendar: 'calendar', analytics: 'analytics', backup: 'backup' };
    function navTo(f, extra) {
      var v = f.view; if (f.virtual) return R('You are already talking to Copilot. Ask me anything or say help.');
      var act = { type: 'navigate', view: v, ok: 'Opened ' + f.title + '.', fail: 'I could not open ' + f.title + ' from here.' }; if (extra) for (var k in extra) act[k] = extra[k];
      return R('Opening ' + f.title + '.', { actions: [act], feature: f.id });
    }
    function featureInfo(f, simple) {
      var c = f.copilot || {}, h = f.help || {}, lines = [f.title + ': ' + (h.summary || f.text)];
      if (c.where) lines.push('You find it in ' + c.where + '.');
      if (c.how) lines.push(c.how);
      if (c.data) lines.push('It uses: ' + c.data + '.');
      if (simple && c.beginner) lines = [c.beginner, (c.where ? 'It lives in ' + c.where + '.' : '')];
      return lines.filter(Boolean).join(' ');
    }
    function whatsNew(data) {
      var rel = REG.RELEASES[0], fs = REG.releaseFeatures(rel).filter(function (f) { return f.kind === 'screen'; }), ids = fs.map(function (f) { return f.title; });
      var txt = 'The latest release is ' + rel.version + ', ' + rel.title + '. ' + rel.items.slice(0, 3).join(' ');
      return R(txt, { actions: [{ type: 'navigate', view: 'help', scroll: '#hpNew', ok: 'Opened What\'s new.', fail: 'I could not open What\'s new.' }], chips: fs.slice(0, 2).map(function (f) { return 'Teach me ' + f.title; }), feature: fs[0] && fs[0].id });
    }
    function untried(data) {
      var seen = (data.visited || []).concat(data.prefs && data.prefs.tried || []), list = REG.screens().filter(function (f) { return !f.virtual && seen.indexOf(f.id) < 0 && f.id !== 'home' && f.id !== 'calc'; });
      if (!list.length) return R('From what I can see, you have recently opened every area of the app. Ask "what is new" to see the latest additions.');
      var five = list.slice(0, 5);
      return R('Here are some areas I have not seen you open recently: ' + five.map(function (f) { return f.title + ' (' + f.text.replace(/\.$/, '').toLowerCase() + ')'; }).join('; ') + '. Say "teach me" and the name to get a quick walkthrough.', { chips: five.slice(0, 3).map(function (f) { return 'Teach me ' + f.title; }) });
    }
    function whatAmI(data) {
      var f = REG.byId(data.view) || (data.view === 'more' ? { title: 'the More menu', help: { summary: 'The menu of every tool in the app, grouped by purpose. Tap the star on a tool to pin it to your dashboard.' }, tour: [] } : null);
      if (!f) return R('I am not sure which screen this is. Say "help" to see what I can do.');
      var h = f.help || {}, hl = f.tour && f.tour[0] && f.tour[0].target;
      return R('You are on ' + f.title + '. ' + (h.summary || f.text) + ((h.how && h.how.length) ? ' To use it: ' + h.how.join(' ') : ''), { actions: hl ? [{ type: 'highlight', selector: hl, text: f.tour[0].text, ok: '', fail: '' }] : [], feature: f.id, chips: ['Teach me this', 'What can I ask here?'] });
    }

    /* ----- education ----- */
    function lessonFor(n) {
      var best = null, bs = 0;
      CT.LESSONS.forEach(function (L) { var sc = 0, hay = ' ' + norm(L.title + ' ' + L.keys) + ' '; toks(n).forEach(function (w) { if (w.length > 2 && hay.indexOf(' ' + w + ' ') >= 0) sc += 2; }); if (n.indexOf(norm(L.title)) >= 0) sc += 6; if (sc > bs) { bs = sc; best = L; } });
      return bs >= 2 ? best : null;
    }
    function termFor(n) {
      var best = null, bs = 0;
      REG.GLOSSARY.forEach(function (g) { var t = norm(g.term), sc = 0; if (n.indexOf(t) >= 0) sc = 10 + t.length; else toks(t).forEach(function (w) { if (w.length > 3 && n.split(' ').indexOf(w) >= 0) sc += 3; }); if (sc > bs) { bs = sc; best = g; } });
      return bs >= 3 ? best : null;
    }
    function teach(L, level) {
      ctx.topic = { type: 'lesson', id: L.id }; ctx.level = level || ctx.level;
      var body = ctx.level === 'new' ? L.plain : (ctx.level === 'deep' ? L.full : L.plain + ' ' + L.full);
      return R(L.title + '. ' + body, { chips: ['Give me an example', 'Explain that simpler', 'Quiz me on that'], topic: L.id });
    }
    function startQuiz(L) {
      var pool = L ? L.quiz.map(function (q) { return { L: L, q: q }; }) : [].concat.apply([], CT.LESSONS.map(function (l) { return l.quiz.map(function (q) { return { L: l, q: q }; }); }));
      if (!L) pool = pool.sort(function () { return 0; });
      var take = L ? pool : shuffle(pool, ctx.seed = (ctx.seed || 7) * 31 % 9973).slice(0, 5);
      ctx.quiz = { items: take, i: 0, score: 0 };
      return askQuiz();
    }
    function shuffle(a, seed) { var r = a.slice(), s = seed || 1; for (var i = r.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; var j = Math.floor(s / 233280 * (i + 1)), t = r[i]; r[i] = r[j]; r[j] = t; } return r; }
    function askQuiz() {
      var Q = ctx.quiz, it = Q.items[Q.i], opts = it.q.o.map(function (o, k) { return String.fromCharCode(65 + k) + ': ' + o; }).join('. ');
      return R('Question ' + (Q.i + 1) + ' of ' + Q.items.length + ': ' + it.q.q + ' ' + opts + '. Say A, B or C.', { chips: it.q.o.map(function (o, k) { return String.fromCharCode(65 + k); }), quiz: true });
    }
    function answerQuiz(n) {
      var Q = ctx.quiz, it = Q.items[Q.i], pick = -1, m = /^(?:answer |option |its |it is |i think )?([abc])\b|^(?:option |number )?([123])\b|^(one|two|three)\b/.exec(n);
      if (m) pick = m[1] ? m[1].charCodeAt(0) - 97 : m[2] ? +m[2] - 1 : -1;
      if (pick < 0) { it.q.o.forEach(function (o, k) { if (norm(o) === n || (n.length > 5 && norm(o).indexOf(n) >= 0)) pick = k; }); }
      if (pick < 0 || pick >= it.q.o.length) return null;
      var ok = pick === it.q.a; if (ok) Q.score++;
      var fb = (ok ? 'Correct. ' : 'Not quite. The answer is ' + String.fromCharCode(65 + it.q.a) + ', ' + it.q.o[it.q.a] + '. ') + it.q.why;
      Q.i++;
      if (Q.i >= Q.items.length) { var sc = Q.score, tot = Q.items.length; ctx.quiz = null; return R(fb + ' That is the end of the quiz: you got ' + sc + ' of ' + tot + '. ' + (sc === tot ? 'Nice work.' : 'Ask me to explain any topic and try again.'), { chips: ['Quiz me again', 'Explain a topic'] }); }
      var nx = askQuiz(); nx.reply = fb + ' Next. ' + nx.reply; return nx;
    }

    /* ----- performance analyst ----- */
    function noData(what) { return R('I cannot answer that yet because ' + what + '. Log some trades with exit prices and I can work it out from your real results.', { actions: [{ type: 'navigate', view: 'journal', ok: 'Opened your journal.', fail: '' }].slice(0, 0), chips: ['Add a trade', 'Open journal'] }); }
    function lastTrades(rows, k) {
      var s = rows.slice().sort(function (a, b) { return (b.t.date + (b.t.time || '')).localeCompare(a.t.date + (a.t.time || '')) || b.t.createdAt - a.t.createdAt; }).slice(0, k);
      if (!s.length) return null;
      return s.map(function (r) { return r.t.date + ' ' + r.t.contract + ' ' + (r.t.side === 'long' ? 'long' : 'short') + ' ' + (r.c.isClosed && r.c.shownCents != null ? money(r.c.shownCents, true) : 'open or no P&L'); });
    }
    function analyst(n, data) {
      var rows = data.rows || [], today = data.today, rg = rangeOf(n, today) || (/^(and |what about |how about )/.test(n) && ctx.range ? ctx.range : null), f = rg ? { from: rg.from, to: rg.to } : {}, label = rg ? ' ' + rg.label : '';
      if (rg) ctx.range = rg;
      var m;
      if (/(last|latest|recent|previous)\s*(\d+)?\s*trades|show me my trades/.test(n)) {
        var k = +(/(\d+)/.exec(n) || [0, 10])[1] || 10; k = Math.min(k, 25); var ls = lastTrades(rows, k);
        if (!ls) return noData('you have not logged any trades');
        return R('Your last ' + plural(ls.length, 'trade') + ': ' + ls.join('; ') + '.', { actions: [{ type: 'navigate', view: 'journal', ok: 'Opened the journal.', fail: '' }], chips: ['Find my mistakes', 'Show my performance'] });
      }
      if (/compare|what changed|versus|vs\b|last two/.test(n) && /week|month|period/.test(n)) {
        var monthly = /month/.test(n), a, b, la, lb;
        if (monthly) { var tm = rangeOf('this month', today), lm = rangeOf('last month', today); a = tm; b = lm; la = 'this month'; lb = 'last month'; }
        else { var tw = rangeOf('this week', today), lw = rangeOf('last week', today); a = tw; b = lw; la = 'this week'; lb = 'last week'; }
        var pa = prep(rows, { from: a.from, to: a.to }), pb = prep(rows, { from: b.from, to: b.to });
        if (!pa.sum.n && !pb.sum.n) return noData('there are no closed trades in either period');
        function line(p, l) { return p.sum.n ? l + ': ' + plural(p.sum.n, 'trade') + ', ' + money(p.sum.totalCents, true) + ', win rate ' + pct(p.sum.winRate) : l + ': no closed trades'; }
        var diff = pa.sum.n && pb.sum.n ? ' The difference in total is ' + money(pa.sum.totalCents - pb.sum.totalCents, true) + '.' : '';
        return R(line(pa, cap(la)) + '. ' + line(pb, cap(lb)) + '.' + diff + ' Both periods are small samples, so be careful reading too much into the change.', { actions: [{ type: 'navigate', view: 'analytics', ok: 'Opened analytics.', fail: '' }] });
      }
      var p = prep(rows, f), s = p.sum;
      if (/(worst|best|least|most).*(week ?day|day of the week)|(week ?day|day of the week).*(best|worst)|what day (do i|am i)|which day (do i|am i)|best day of the week/.test(n)) {
        if (s.n < 5) return noData('there are only ' + s.n + ' closed trades with a P&L' + label);
        var br = A().breakdown(p.inc, 'weekday').filter(function (x) { return x.n > 0; }), wantWorst = /worst|least/.test(n), top = br.slice().sort(function (x, y) { return wantWorst ? x.totalCents - y.totalCents : y.totalCents - x.totalCents; })[0];
        return R((wantWorst ? 'Your weakest' : 'Your best') + ' weekday' + label + ' by total P&L is ' + top.key + ': ' + money(top.totalCents, true) + ' over ' + plural(top.n, 'trade') + ', win rate ' + pct(top.winRate) + '.' + sampleNote(top.n) + ' Each weekday has fewer trades than the whole set, so this can easily be chance.', { actions: [{ type: 'navigate', view: 'analytics', ok: 'Opened analytics.', fail: '' }] });
      }
      if (/(biggest|largest|worst) (losing )?day|worst day|most losing day/.test(n)) {
        if (!s.n) return noData('there are no closed trades with a P&L' + label);
        var bd = A().byDay(p.inc); var w = bd.reduce(function (x, y) { return y.cents < x.cents ? y : x; }, bd[0]);
        if (w.cents >= 0) return R('You have no losing days' + label + ' in your recorded trades. Your lowest day was ' + w.date + ' at ' + money(w.cents, true) + '.');
        return R('Your biggest losing day' + label + ' was ' + w.date + ', at ' + money(w.cents) + '.');
      }
      if (/(biggest|largest|worst) (single )?(loss|losing trade)/.test(n)) { if (!s.n) return noData('there are no closed trades'); return R('Your largest single loss' + label + ' is ' + money(s.worstCents) + (s.worstCents >= 0 ? ', which means you have no losing trades yet.' : '.')); }
      if (/(best|biggest|largest) (winning )?(trade|win|day)\b/.test(n) && !/average|avg/.test(n)) { if (!s.n) return noData('there are no closed trades'); if (/day/.test(n)) { var bd2 = A().byDay(p.inc); var b2 = bd2.reduce(function (x, y) { return y.cents > x.cents ? y : x; }, bd2[0]); return R('Your best day' + label + ' was ' + b2.date + ', at ' + money(b2.cents, true) + '.'); } return R('Your largest single win' + label + ' is ' + money(s.bestCents, true) + '.'); }
      if (/average (winning|win)|avg win/.test(n)) { if (!s.wins) return noData('there are no winning closed trades' + label); return R('Your average winning trade' + label + ' is ' + money(s.avgWinCents) + ' across ' + plural(s.wins, 'winner') + '.' + sampleNote(s.wins)); }
      if (/average (losing|loss)|avg loss/.test(n)) { if (!s.losses) return noData('there are no losing closed trades' + label); return R('Your average losing trade' + label + ' is ' + money(s.avgLossCents) + ' across ' + plural(s.losses, 'loser') + '.' + sampleNote(s.losses)); }
      if (/(losing|loss) streak|winning streak|win streak|longest streak|current streak/.test(n)) {
        if (!s.n) return noData('there are no closed trades with a P&L');
        var wantWin = /winning|win streak/.test(n), cur = s.currentStreak ? ' Right now you are on a ' + s.currentStreak.n + '-trade ' + s.currentStreak.type + ' streak.' : '';
        return R('Your longest ' + (wantWin ? 'winning' : 'losing') + ' streak' + label + ' is ' + (wantWin ? s.maxWinStreak : s.maxLossStreak) + ' ' + tradeWord(wantWin ? s.maxWinStreak : s.maxLossStreak) + ' in a row, out of ' + plural(s.n, 'trade') + '.' + cur);
      }
      if (/strateg/.test(n)) {
        var bs = A().breakdown(p.inc, 'strategy').filter(function (x) { return x.key !== 'No strategy' && x.n >= 1; });
        if (!bs.length) return R('None of your closed trades have a strategy name yet, so I cannot compare strategies. Add the same strategy name to your trades and I can.', { chips: ['Open strategy lab'] });
        var byWr = /win rate/.test(n), pick = bs.slice().sort(function (x, y) { return byWr ? y.winRate - x.winRate || y.n - x.n : y.totalCents - x.totalCents; })[0];
        return R((byWr ? 'The strategy with the highest win rate' : 'Your most profitable strategy') + label + ' is "' + pick.label + '": ' + pct(pick.winRate) + ' win rate, ' + money(pick.totalCents, true) + ' over ' + plural(pick.n, 'trade') + '.' + sampleNote(pick.n) + (bs.length > 1 ? ' You have ' + bs.length + ' named strategies in total.' : ''), { actions: [{ type: 'navigate', view: 'strategy', ok: 'Opened the strategy lab.', fail: '' }] });
      }
      if (/improv|getting better|progress|better than/.test(n)) {
        var tm2 = rangeOf('this month', today), lm2 = rangeOf('last month', today), a2 = prep(rows, { from: tm2.from, to: tm2.to }), b2s = prep(rows, { from: lm2.from, to: lm2.to });
        if (a2.sum.n < 5 || b2s.sum.n < 5) return R('I do not have enough closed trades in both this month (' + a2.sum.n + ') and last month (' + b2s.sum.n + ') to say whether you are improving. I need at least five in each.');
        var d = a2.sum.expectancyCents - b2s.sum.expectancyCents;
        return R('This month your average result per trade is ' + money(a2.sum.expectancyCents, true) + ' over ' + plural(a2.sum.n, 'trade') + ', compared with ' + money(b2s.sum.expectancyCents, true) + ' over ' + plural(b2s.sum.n, 'trade') + ' last month, a difference of ' + money(d, true) + ' per trade. Win rate went from ' + pct(b2s.sum.winRate) + ' to ' + pct(a2.sum.winRate) + '. With samples this small it is a signal to watch, not proof of improvement.');
      }
      if (/mistake|repeat|rule violation|doing wrong|bad habit/.test(n)) {
        var mb = A().breakdown(p.inc, 'mistake').filter(function (x) { return x.key !== 'None recorded'; }).sort(function (x, y) { return y.n - x.n; });
        if (!mb.length) return R('You have not tagged any mistakes on your closed trades' + label + ', so I cannot tell which ones repeat. Tag mistakes in the journal as they happen, and I can rank them by how often they occur and what they cost.', { chips: ['Open journal'] });
        return R('The mistakes you tag most' + label + ': ' + mb.slice(0, 4).map(function (x) { return x.label + ' on ' + plural(x.n, 'trade') + ' (' + money(x.totalCents, true) + ' total)'; }).join('; ') + '. These come only from tags you entered yourself.', { chips: ['Start post-trade review', 'Open analytics'] });
      }
      if (/how consistent|consistency/.test(n)) {
        if (s.n < 5) return noData('there are only ' + s.n + ' closed trades');
        var days = A().byDay(p.inc), green = days.filter(function (d) { return d.cents > 0; }).length;
        return R('You traded on ' + plural(days.length, 'day') + ' and ' + green + ' of them were net positive (' + pct(green / days.length) + '). Your average winner is ' + money(s.avgWinCents) + ' against an average loser of ' + money(s.avgLossCents) + '. Consistency here is about days, not a score, so also look at whether you followed your plan.' + sampleNote(days.length), { actions: [{ type: 'navigate', view: 'discipline', ok: 'Opened Discipline.', fail: '' }].slice(0, 0) });
      }
      if (/average risk|avg risk|usual risk|risking more|risk per trade|risk too much/.test(n) && !/limit/.test(n)) {
        var h = K().riskHistory(rows);
        if (!h.withStop) return noData('your trades do not have stop prices, so planned risk cannot be worked out');
        var lastT = rows.slice().sort(function (a, b) { return (b.t.date + (b.t.time || '')).localeCompare(a.t.date + (a.t.time || '')); }).filter(function (r) { return r.c.plannedRiskCents != null; })[0];
        var cmp = ''; if (lastT && /more than usual|usual/.test(n) && h.medianRiskCents) { cmp = ' Your most recent trade risked ' + money(lastT.c.plannedRiskCents) + (lastT.c.plannedRiskCents > h.medianRiskCents * 1.25 ? ', which is well above your median.' : lastT.c.plannedRiskCents < h.medianRiskCents * 0.8 ? ', which is below your median.' : ', close to your median.'); }
        return R('Across ' + plural(h.withStop, 'trade') + ' with a stop recorded, your average planned risk is ' + money(h.avgRiskCents) + ' and your median is ' + money(h.medianRiskCents) + ' (range ' + money(h.minRiskCents) + ' to ' + money(h.maxRiskCents) + ').' + cmp + (h.noStop ? ' ' + plural(h.noStop, 'trade') + ' have no stop, so they are not included.' : ''), { chips: ['Compare risking $20 versus $30', 'Open risk center'] });
      }
      if (/win rate|winrate/.test(n)) { if (!s.n) return noData('there are no closed trades with a P&L'); return R('Your win rate' + label + ' is ' + pct(s.winRate) + ' (' + s.wins + ' wins out of ' + s.n + ' trades). A 95% range is roughly ' + pct(s.winCI.lo) + ' to ' + pct(s.winCI.hi) + '.' + sampleNote(s.n)); }
      if (/expectancy|average (result|trade)|per trade/.test(n)) { if (!s.n) return noData('there are no closed trades with a P&L'); return R('Your average result per trade' + label + ' is ' + money(s.expectancyCents, true) + ' over ' + plural(s.n, 'trade') + '. Past averages do not guarantee future results.' + sampleNote(s.n)); }
      if (/profit factor/.test(n)) { if (!s.n) return noData('there are no closed trades'); return R(s.profitFactor == null ? 'Your profit factor is not defined yet: ' + s.profitFactorNote + '.' : 'Your profit factor' + label + ' is ' + s.profitFactor.toFixed(2) + '.' + sampleNote(s.n)); }
      // generic performance
      if (!s.n) return noData('there are no closed trades with a P&L' + (rg ? ' ' + rg.label : '') + (p.open ? ' (' + plural(p.open, 'trade') + ' still open)' : ''));
      return R('Your performance' + (rg ? label : ' across all recorded trades') + ': ' + plural(s.n, 'closed trade') + ', total ' + money(s.totalCents, true) + ' (' + p.basis + '), win rate ' + pct(s.winRate) + ', average winner ' + money(s.avgWinCents) + ', average loser ' + money(s.avgLossCents) + '.' + (p.open ? ' ' + plural(p.open, 'trade') + ' still open and not counted.' : '') + sampleNote(s.n), { actions: [{ type: 'navigate', view: 'analytics', ok: 'Opened analytics.', fail: '' }], chips: ['What day do I perform best?', 'Find my mistakes', 'Compare my last two weeks'] });
    }

    /* ----- risk coach ----- */
    function riskCoach(n, data) {
      var rows = data.rows || [], sl = slotsFrom(n);
      if (/lose|losing|loss/.test(n) && /(in a row|straight|consecutive)/.test(n)) {
        var k = +(/(\d+)\s*(?:trades|losses|losing)?\s*(?:in a row|straight|consecutive)/.exec(n) || /lose (\d+)/.exec(n) || [0, 3])[1] || 3, h = K().riskHistory(rows), per = sl.risk != null ? Math.round(sl.risk * 100) : h.medianRiskCents, src = sl.risk != null ? 'the ' + money(per) + ' you mentioned' : 'your median planned risk of ' + money(per);
        if (!per) return R('If you risk a fixed amount per trade, ' + k + ' losses in a row cost ' + k + ' times that amount. Tell me your dollar risk per trade, for example "lose three in a row at thirty dollars risk", and I will work it out. I do not have enough stop data in your journal to estimate it.');
        var out = k + ' losses in a row at ' + src + ' would cost about ' + money(per * k) + ' if every stop was hit with no slippage.', lim = ((data.limits || {})[data.accountId || 'acct-default'] || {}).dailyLossCents;
        if (lim) out += ' Your daily loss limit is ' + money(lim) + ', so it takes ' + K().lossesToLimit(lim, per) + ' full losses to reach it.';
        var s2 = prep(rows).sum; if (s2.n >= 10) { var pr = K().probLossRun(s2.winRate, 20, k); out += ' Using your recorded win rate of ' + pct(s2.winRate) + ' (' + s2.n + ' trades), the chance of at least one run of ' + k + ' straight losses somewhere in the next 20 trades is about ' + pct(pr) + '. That is arithmetic on an assumption, not a forecast.'; }
        return R(out + ' If it happens, stop, review and keep your size the same or smaller.');
      }
      var cmpM = /(\d+(?:\.\d+)?)\D+(?:versus|vs|or|and|compared to|than)\D*?(\d+(?:\.\d+)?)/.exec(n);
      if (/compare|versus|\bvs\b/.test(n) && /risk/.test(n) && cmpM) {
        var a = +cmpM[1], b = +cmpM[2], s3 = prep(rows).sum, lines = ['Risking $' + a + ' per trade: three losses cost $' + (a * 3) + ' and five cost $' + (a * 5) + '.', 'Risking $' + b + ' per trade: three losses cost $' + (b * 3) + ' and five cost $' + (b * 5) + '.'];
        var lim2 = ((data.limits || {})[data.accountId || 'acct-default'] || {}).dailyLossCents; if (lim2) lines.push('With your ' + money(lim2) + ' daily limit, it takes ' + K().lossesToLimit(lim2, a * 100) + ' losses at $' + a + ' versus ' + K().lossesToLimit(lim2, b * 100) + ' at $' + b + '.');
        if (s3.rCount >= 10 && s3.avgR != null) lines.push('Your recorded average is ' + s3.avgR.toFixed(2) + 'R per trade over ' + s3.rCount + ' trades, which would be about ' + money(s3.avgR * a * 100, true) + ' versus ' + money(s3.avgR * b * 100, true) + ' per trade at those sizes. That assumes your past average continues, which it may not.');
        else lines.push('I do not have enough R-multiple history to estimate expected results for either, so this only compares downside.');
        lines.push('A larger size scales wins and losses together. It does not improve your edge.');
        return R(lines.join(' '));
      }
      if (/fixed.?dollar/.test(n)) return teach(CT.LESSONS.filter(function (l) { return l.id === 'sizing'; })[0], 'plain');
      if (/scal(e|ing)|increase (my )?size|bigger size|more contracts/.test(n)) {
        var s4 = prep(rows).sum;
        var own = s4.n ? ' In your journal you have ' + plural(s4.n, 'closed trade') + ', ' + (s4.n < 30 ? 'which is still a small sample.' : 'a reasonable sample to review.') : ' I do not see closed trades to review yet.';
        return R('Scaling up should be earned, not felt. Consider it only after a meaningful stretch of trades that followed your plan with positive results, not after a lucky run. Scale in small steps, keep your dollar risk per trade a small fixed fraction of your account, check your firm\'s contract limits and drawdown rule first, and step back down after a bad stretch. Bigger size multiplies losses too. ' + CT.DISCLAIMER + own, { chips: ['What happens if I lose three in a row?', 'How much drawdown room do I have?'] });
      }
      if (/drawdown room|room (left|do i have)|how close am i to (my )?(limit|drawdown)|distance to (my )?(limit|drawdown)/.test(n)) {
        return R('I do not calculate drawdown room myself, because it depends on the exact rules and balance you confirmed for each account. Your Accounts tracker does this with those rules, so I will open it.', { actions: [{ type: 'navigate', view: 'accounts', ok: 'Opened Accounts.', fail: 'I could not open Accounts.' }] });
      }
      if (/limit/.test(n) && /(what are|show|my) /.test(n)) {
        var lm = (data.limits || {})[data.accountId || 'acct-default'];
        if (!lm || !Object.keys(lm).length) return R('You have not set any personal risk limits, so I cannot read any back. I can open the Risk center so you can set them yourself.', { actions: [{ type: 'navigate', view: 'risk', ok: 'Opened the Risk center.', fail: '' }] });
        return R('Your limits: ' + [lm.dailyLossCents != null && 'daily loss ' + money(lm.dailyLossCents), lm.weeklyLossCents != null && 'weekly loss ' + money(lm.weeklyLossCents), lm.maxRiskPerTradeCents != null && 'risk per trade ' + money(lm.maxRiskPerTradeCents), lm.maxTradesPerDay != null && 'max ' + lm.maxTradesPerDay + ' trades a day', lm.maxContracts != null && 'max ' + lm.maxContracts + ' contracts'].filter(Boolean).join(', ') + '.');
      }
      return null;
    }

    /* ----- routines ----- */
    function today(data) { var rg = { from: data.today, to: data.today }; return prep(data.rows || [], rg); }
    function routineStep() {
      var r = ctx.routine, key = CT.ROUTINES[r.id].steps[r.i], d = r.data, T = CT.ROUTINES[r.id], head = T.title + ', step ' + (r.i + 1) + ' of ' + T.steps.length + '. ';
      var chips = ['Next', 'Skip', 'Stop'];
      switch (key) {
        case 'plan': return R(head + (d.plan ? 'Here is your plan. ' + d.plan + ' Say next when you have read it.' : 'You have not written a trading plan yet. A plan is the first line of defence against impulsive trades. Say next to continue, or "open discipline" to write one later.'), { chips: chips });
        case 'limits': { var L = d.limits || {}, has = Object.keys(L).length; return R(head + (has ? 'Your own limits: ' + [L.dailyLossCents != null && 'daily loss ' + money(L.dailyLossCents), L.maxTradesPerDay != null && 'max ' + L.maxTradesPerDay + ' trades', L.maxRiskPerTradeCents != null && 'risk per trade ' + money(L.maxRiskPerTradeCents), L.maxContracts != null && 'max ' + L.maxContracts + ' contracts'].filter(Boolean).join(', ') + '. Decide now that you will stop when you hit them. Say next.' : 'You have not set personal limits. Think about the most you are willing to lose today, and consider writing it in the Risk center. Say next.'), { chips: chips }); }
        case 'recent': { var ls = lastTrades(d.rows || [], 5), sm = d.recent; return R(head + (ls ? 'Your last five trades: ' + ls.join('; ') + '.' : 'You have no recorded trades yet.') + (sm && sm.n ? ' Over your last ' + sm.n + ' closed trades the total is ' + money(sm.totalCents, true) + '.' : '') + ' Say next.', { chips: chips }); }
        case 'checklist': { var cl = d.checklist; return R(head + (cl && cl.items && cl.items.length ? 'Your checklist "' + cl.title + '": ' + cl.items.map(function (x, i) { return (i + 1) + ', ' + x; }).join('; ') + '. Say done when you have honestly gone through it.' : 'You do not have a checklist saved. A simple one: Is this setup in my plan? Is my stop set before entry? Is my size within my limit? Am I calm? Say done to continue, or ask me to build your routine.'), { chips: ['Done', 'Skip', 'Stop'] }); }
        case 'ready': return R(head + 'How ready do you feel to trade today, from one to five? Five is calm and focused, one is stressed or tired.', { chips: ['1', '2', '3', '4', '5'], expecting: 'readiness' });
        case 'today': { var t = d.today; return R(head + (t && t.n ? 'Today you have ' + plural(t.n, 'closed trade') + ' for ' + money(t.totalCents, true) + ', ' + t.wins + ' won and ' + t.losses + ' lost.' : 'I do not see closed trades with a P&L today.') + ' Say next.', { chips: chips }); }
        case 'adherence': return R(head + 'Did you follow your plan on every trade today? Say yes, mostly, or no.', { chips: ['Yes', 'Mostly', 'No'], expecting: 'adherence' });
        case 'lesson': return R(head + 'What is one thing you did well and one thing you would change? Tell me in a sentence or two.', { expecting: 'lesson', chips: ['Skip'] });
        case 'save': return R(head + (d.lesson ? 'Would you like me to save that as a reflection in Discipline? Say yes or no.' : 'Nothing to save. Say next to finish.'), { chips: ['Yes', 'No'], expecting: 'save' });
        case 'week': { var w = d.week; return R(head + (w && w.n ? 'This week: ' + plural(w.n, 'closed trade') + ', ' + money(w.totalCents, true) + ', win rate ' + pct(w.winRate) + '.' : 'No closed trades with a P&L this week.') + ' Say next.', { chips: chips }); }
        case 'compare': { var lw = d.lastWeek, tw = d.week; return R(head + (tw && tw.n && lw && lw.n ? 'Compared with last week (' + money(lw.totalCents, true) + ' over ' + lw.n + ' trades), this week is ' + money(tw.totalCents, true) + ' over ' + tw.n + ' trades.' : 'There is not enough data in both weeks to compare.') + ' Say next.', { chips: chips }); }
        case 'mistakes': return R(head + (d.mistakes && d.mistakes.length ? 'The mistakes you tagged most: ' + d.mistakes.map(function (x) { return x.label + ' (' + x.n + ')'; }).join(', ') + '.' : 'You have not tagged mistakes this week.') + ' Say next.', { chips: chips });
        case 'journal': return R(head + (d.reflections ? 'You wrote ' + plural(d.reflections, 'reflection') + ' in the last 7 days.' : 'You have no reflections from the last seven days.') + ' Say next.', { chips: chips });
        case 'focus': return R(head + 'What is the one thing you want to focus on next week? Tell me in a sentence.', { expecting: 'focus', chips: ['Skip'] });
      }
      return R('Done.');
    }
    function routineStart(id, data) {
      var rows = data.rows || [], wk = rangeOf('this week', data.today), lw = rangeOf('last week', data.today), wkp = prep(rows, { from: wk.from, to: wk.to }), lwp = prep(rows, { from: lw.from, to: lw.to });
      var cl = (data.checklists || [])[0], mb = A().breakdown(wkp.inc, 'mistake').filter(function (x) { return x.key !== 'None recorded'; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
      var last = prep(rows).inc.slice(-10);
      ctx.routine = { id: id, i: 0, data: { plan: data.plan || '', limits: (data.limits || {})[data.accountId || 'acct-default'] || {}, rows: rows, recent: A().summary(last), checklist: cl && { title: cl.title || cl.name || 'Checklist', items: (cl.items || []).map(function (x) { return typeof x === 'string' ? x : (x.text || x.label || ''); }).filter(Boolean) }, today: today(data).sum, week: wkp.sum, lastWeek: lwp.sum, mistakes: mb, reflections: data.recentReflections || 0 } };
      var r = routineStep(); r.reply = 'Starting your ' + CT.ROUTINES[id].title.toLowerCase() + '. You can say next, skip or stop at any time. ' + r.reply; return r;
    }
    function routineAdvance(n, data) {
      var r = ctx.routine, key = CT.ROUTINES[r.id].steps[r.i], res = null, note = '';
      if (/^(stop|cancel|end|quit|exit|never mind)\b/.test(n)) { ctx.routine = null; return R('Okay, I have stopped the routine. You can restart it any time.'); }
      if (key === 'ready') { var m = /\b([1-5])\b/.exec(n); if (!m) { if (/^(next|skip)/.test(n)) { r.i++; } else return R('Please give me a number from one to five.', { chips: ['1', '2', '3', '4', '5'], expecting: 'readiness' }); } else { var v = +m[1]; note = v <= 2 ? 'Thank you for being honest. At ' + v + ' out of 5, consider trading smaller, taking a short break first, or skipping today. Not trading is a position too. ' : v === 3 ? 'A three is workable. Keep size small and stick to your checklist. ' : 'Good. Stay with your plan. '; r.i++; } }
      else if (key === 'adherence') { var a = /^(yes|yep|yeah|all)/.test(n) ? 'yes' : /^(mostly|mostly yes|kind of|some)/.test(n) ? 'mostly' : /^no/.test(n) ? 'no' : null; if (!a && !/^(next|skip)/.test(n)) return R('Please answer yes, mostly or no.', { chips: ['Yes', 'Mostly', 'No'], expecting: 'adherence' }); note = a === 'yes' ? 'Good. Following the plan is the part you control. ' : a === 'mostly' ? 'Mostly is a decent start. Name the one rule you bent so you can fix it next time. ' : a === 'no' ? 'Thank you for being honest. Tomorrow, pick one rule to follow perfectly rather than trying to fix everything. ' : ''; r.i++; }
      else if (key === 'lesson') { if (!/^(skip|next)$/.test(n)) r.data.lesson = n.length > 2 ? (data.raw || n) : ''; r.i++; if (r.data.lesson) note = 'Got it. '; }
      else if (key === 'save') {
        if (/^(yes|yep|yeah|sure|ok|okay|save)/.test(n) && r.data.lesson) { var text = r.data.lesson; ctx.routine = null; return needConfirm('To confirm: save this as a reflection dated today? "' + text.slice(0, 160) + '"', [{ type: 'saveReflection', text: text, ok: 'Saved your reflection.', fail: 'I could not save the reflection.' }], 'Saving your reflection.'); }
        r.i++;
      }
      else if (key === 'focus') { if (!/^(skip|next)$/.test(n)) { var tx = data.raw || n; ctx.routine = null; return needConfirm('To confirm: show "' + tx.slice(0, 160) + '" as your focus note on the dashboard?', [{ type: 'saveGoal', text: tx, ok: 'Saved your focus.', fail: 'I could not save that.' }], 'Saving.'); } r.i++; }
      else { r.i++; }
      if (r.i >= CT.ROUTINES[r.id].steps.length) { ctx.routine = null; return R(note + 'That completes your ' + CT.ROUTINES[r.id].title.toLowerCase() + '. Nice work.', { chips: ['Open journal', 'What is new'] }); }
      res = routineStep(); res.reply = note + res.reply; return res;
    }

    /* ----- shortcuts and memory ----- */
    function parseShortcut(raw, n, data) {
      var m = /(?:when i say|create (?:a )?(?:voice )?shortcut|new shortcut|add (?:a )?shortcut|shortcut)\s+["']?([a-z0-9 ]{2,40}?)["']?\s+(?:to|do|run|means|then|for|opens?)\s+(.+)$/.exec(n);
      if (!m) return null;
      var phrase = m[1].trim(), cmd = m[2].trim();
      if (data.prefs && (data.prefs.shortcuts || []).length >= MAX_SHORTCUTS) return R('You already have ' + MAX_SHORTCUTS + ' shortcuts. Remove one in Settings first.');
      var probe = parse(cmd, data, true);
      if (!probe || probe.unknown) return R('I could not understand "' + cmd + '" as something I can do, so I did not create the shortcut. Try a command like "open my journal" or "start my pre-trade check".');
      return needConfirm('Create the shortcut: when you say "' + phrase + '", I will run "' + cmd + '". Save it?', [{ type: 'saveShortcut', phrase: phrase, command: cmd, ok: 'Shortcut saved.', fail: 'I could not save the shortcut.' }], 'Saving the shortcut.');
    }

    /* ----- the intent parser ----- */
    function parse(raw, data, dry) {
      var n = norm(raw); if (!n) return R('I did not catch anything. You can type or tap the microphone and try again.');
      data = data || {}; data.raw = raw; data.today = data.today || ymd(new Date()); data.rows = data.rows || [];
      var sl;
      if (CT.CRISIS.test(n)) return R(CT.CRISIS_REPLY, { kind: 'crisis' });
      /* shortcut phrases (one level only) */
      if (!dry && ctx.depth === 0) { var sc = (data.prefs && data.prefs.shortcuts || []).filter(function (x) { return norm(x.phrase) === n; })[0]; if (sc) { ctx.depth = 1; var r0 = parse(sc.command, data); ctx.depth = 0; return r0; } }
      /* pending confirmation */
      if (ctx.confirm) {
        if (/^(yes|yep|yeah|yup|confirm|do it|go ahead|sure|ok|okay|save|correct|that is right|thats right|yes do it|yes please)\b/.test(n)) { var c = ctx.confirm; ctx.confirm = null; return R(c.done, { actions: c.actions, confirmed: true }); }
        if (/^(no|nope|cancel|stop|dont|do not|never mind|nevermind|abort)\b/.test(n)) { ctx.confirm = null; return R('Okay, I cancelled that. Nothing was changed.'); }
        return R('I am waiting for a yes or no. Should I go ahead? Nothing changes until you say yes.', { confirm: true, chips: ['Yes, do it', 'No, cancel'] });
      }
      if (ctx.quiz) { if (/^(stop|quit|end|exit|cancel|no more)\b/.test(n)) { ctx.quiz = null; return R('Okay, quiz ended.'); } var qa = answerQuiz(n); if (qa) return qa; return R('Please answer with A, B or C, or say stop to end the quiz.', { chips: ['A', 'B', 'C', 'Stop'] }); }
      if (ctx.routine) {
        if (/^(stop|cancel|end|quit|exit|never mind)\b/.test(n)) { ctx.routine = null; return R('Okay, I have stopped the routine.'); }
        if (/^(next|continue|done|skip|ok|okay|yes|no|mostly|go on|ready)\b/.test(n) || /^[1-5]$/.test(n) || ['lesson', 'focus', 'save', 'adherence', 'ready'].indexOf(CT.ROUTINES[ctx.routine.id].steps[ctx.routine.i]) >= 0) return routineAdvance(n, data);
      }
      /* pending slot answers */
      if (ctx.pending && ctx.pending.intent === 'calc') {
        sl = slotsFrom(n);
        var need = ctx.pending.need, got = false;
        if (sl.bare != null && !sl.inst && sl.stop == null && sl.risk == null) { if (need[0] === 'stop') { sl.stop = sl.bare; } else if (need[0] === 'risk') { sl.risk = sl.bare; } }
        var ch = mergeCalc(sl); if (ch.length) return calcFlow(data);
        ctx.pending = null;
      }
      /* conversation controls */
      if (/^(never mind|nevermind|forget it|cancel|stop|stop talking|be quiet|quiet|shut up)$/.test(n)) return R('Okay.', { actions: [{ type: 'stopSpeech', ok: '', fail: '' }] });
      if (/\b(unmute|turn (the )?(voice|sound) on|speak again)\b/.test(n)) return R('Voice is back on.', { actions: [{ type: 'setVoice', mute: false, ok: '', fail: 'I could not change voice settings.' }] });
      if (/\b(mute|stop speaking|turn (the )?(voice|sound) off|be silent|text only)\b/.test(n)) return R('Okay, I will stay quiet and answer in text only.', { actions: [{ type: 'setVoice', mute: true, ok: '', fail: 'I could not change voice settings.' }] });
      if (/(speak|talk) (more )?(slower|slowly)|slow down|slower voice/.test(n)) return R('Okay, speaking more slowly.', { actions: [{ type: 'setVoice', rateDelta: -0.15, ok: '', fail: '' }] });
      if (/(speak|talk) (a bit )?(faster|quicker)|speed up|faster voice/.test(n)) return R('Okay, speaking faster.', { actions: [{ type: 'setVoice', rateDelta: 0.15, ok: '', fail: '' }] });
      if (/^(hi|hello|hey|good morning|good afternoon|good evening|yo|sup)\b/.test(n) && n.split(' ').length <= 4) return R('Hi' + (data.name ? ', ' + data.name : '') + '. I am TRC Copilot. Ask me to open a screen, size a position, review your trades, coach you through a tough moment, or teach you a concept.', { chips: ['What can you do?', 'How many contracts can I take?', 'Start my pre-trade check'] });
      if (/^(thanks|thank you|cheers|great|perfect|nice|awesome|cool)\b/.test(n) && n.split(' ').length <= 5) return R('You are welcome.');
      var shc = parseShortcut(raw, n, data); if (shc) return shc;
      if (/(delete|remove|clear|forget).*(shortcut)/.test(n)) return needConfirm('Remove all your voice shortcuts?', [{ type: 'clearShortcuts', ok: 'Removed your shortcuts.', fail: 'I could not remove them.' }], 'Removing.');
      if (/^(remember|please remember)\b/.test(n)) {
        sl = slotsFrom(n);
        if (sl.inst && /(trade|use|trading|contract|default)/.test(n)) return needConfirm('May I remember that your usual contract is ' + sl.inst + '? I will only use it to fill in missing details, and you can clear it any time.', [{ type: 'remember', key: 'defaultInstrument', value: sl.inst, ok: 'I will remember that.', fail: 'I could not save that.' }], 'Saving.');
        if (sl.risk != null && /risk/.test(n)) return needConfirm('May I remember that your usual maximum risk is $' + sl.risk + '? I will only use it to fill in missing details.', [{ type: 'remember', key: 'defaultRisk', value: sl.risk, ok: 'I will remember that.', fail: 'I could not save that.' }], 'Saving.');
        return R('I can remember your usual contract ("remember that I trade Micro Nasdaq") and your usual maximum risk ("remember my risk is thirty dollars"). Nothing is saved unless you approve it.');
      }
      if (/(forget|clear|erase|delete).*(what you remember|memory|remembered|my preferences)|what do you (remember|know) about me/.test(n)) {
        if (/what do you/.test(n)) { var mem = data.prefs && data.prefs.memory || {}, keys = Object.keys(mem); return R(keys.length ? 'I remember: ' + keys.map(function (k) { return (k === 'defaultInstrument' ? 'your usual contract is ' : 'your usual maximum risk is $') + mem[k]; }).join('; ') + '. Say "forget what you remember" to clear it.' : 'I have not saved anything about you. I only remember things you approve.'); }
        return needConfirm('Clear everything I have remembered about you?', [{ type: 'forget', ok: 'I have cleared my memory of you.', fail: 'I could not clear it.' }], 'Clearing.');
      }
      if (/(clear|delete|erase).*(conversation|chat|history)/.test(n)) return needConfirm('Clear this conversation history from this device?', [{ type: 'clearHistory', ok: 'Conversation history cleared.', fail: 'I could not clear the history.' }], 'Clearing.');
      /* appearance */
      if (/(dark|night)\b.*(mode|theme)|(turn|switch|set|go|use|enable).*\b(dark)\b/.test(n)) return R('Switching to dark mode.', { actions: [{ type: 'theme', mode: 'dark', ok: 'Dark mode is on.', fail: 'I could not change the theme.' }] });
      if (/(light|day)\b.*(mode|theme)|(turn|switch|set|go|use|enable).*\b(light)\b/.test(n)) return R('Switching to light mode.', { actions: [{ type: 'theme', mode: 'light', ok: 'Light mode is on.', fail: 'I could not change the theme.' }] });
      if (/compact/.test(n) && /(layout|mode|view|density|spacing|use)/.test(n)) return R('Switching to the compact layout.', { actions: [{ type: 'density', value: 'compact', ok: 'Compact layout is on.', fail: 'I could not change the layout.' }] });
      if (/comfortable|roomy|spacious/.test(n) && /(layout|mode|view|density|spacing|use)/.test(n)) return R('Switching to the comfortable layout.', { actions: [{ type: 'density', value: 'comfortable', ok: 'Comfortable layout is on.', fail: 'I could not change the layout.' }] });
      /* direct "open <screen title>" beats everything below (so "open discipline" opens the screen instead of starting coaching) */
      if (/^(open|go to|take me to|launch|bring up|pull up|navigate to)\b/.test(n)) { var tm0 = titleMatch(n); if (tm0) { ctx.last = 'nav'; ctx.topic = { type: 'feature', id: tm0.id }; return navTo(tm0); } }
      if (/^(buy|sell|go long|go short|place|execute|submit|close my position|flatten)\b|\b(market|limit|stop) order\b|place (an? )?(order|trade)/.test(n)) return R('I cannot place trades or orders. Tamhas Trading has no brokerage connection and never will execute trades for you. I can size the position, open the trade form so you can record it, or help you plan the trade.', { unknown: true, kind: 'refusal', chips: ['How many contracts can I take?', 'Add a trade to my journal'] });
      /* guides */
      if (/(report|send).*(problem|bug|issue|error)|something (is )?(broken|wrong)|found a bug/.test(n)) return R('I will open the problem reporter. Nothing is sent anywhere unless you choose to.', { actions: [{ type: 'report', ok: 'Opened the reporter.', fail: 'I could not open the reporter.' }] });
      if (/^(help(?! me (set|with|build|find|understand|learn))|what can you do|what can i (ask|say)|how do you work|commands|what are you)\b|what can you help/.test(n)) return R('I can: open any screen; size a position (say "how many contracts with a twenty point stop"); answer questions about your own trades (best day, average win, streaks, mistakes, last ten trades); compare weeks; coach you through fear, revenge trading and tilt; run a pre-trade check, post-trade review or weekly review; teach concepts and quiz you; switch dark mode or layout; and guide you around the app. I am a rule-based helper that runs on your device, not a general AI, and I will say so when I cannot do something.', { chips: ['How many contracts can I take?', 'Start my pre-trade check', 'Quiz me', 'What is new?'] });
      if (/what.?s new|whats new|newest feature|latest feature|what changed in (the )?app|new in trc|recent update/.test(n)) return whatsNew(data);
      if (/(feature|thing|tool|area)s? (i )?(have ?n.?t|havent|not) (tried|used|opened)|haven.?t (tried|used)|show me (new |other |more )?features|unused features/.test(n)) return untried(data);
      if (/(what am i looking at|what does this (page|screen|tab|view)|explain this (page|screen)|where am i|what is this (page|screen)|what does this button|what.?s this button|explain what this feature)/.test(n)) return whatAmI(data);
      if (/(teach|show|walk) me (this|how)|(teach me|walk me through|give me a (tour|walkthrough) of|tour of|how do i use|how does .* work)/.test(n) && !/contract|stop|risk (of|amount)/.test(n)) {
        var cut = n.replace(/^.*?(teach me|walk me through|tour of|how do i use|give me a (tour|walkthrough) of|show me how (to use)?)\s*/, '').replace(/^(the|my|about)\s+/, ''), f = (/^(this|it|that)?$/.test(cut) || /^this\b/.test(cut)) ? REG.byId(data.view) : findFeature(cut || n);
        if (!f && (/new (tool|feature)/.test(n))) { f = REG.screens().filter(function (x) { return !x.virtual && x.since === REG.LATEST; })[0] || REG.byId('copilot'); }
        if (f) { return R('Let me walk you through ' + f.title + '. ' + (f.help && f.help.summary ? f.help.summary : f.text), { actions: [{ type: 'tour', feature: f.id, ok: '', fail: 'I could not start that tour.' }], feature: f.id }); }
        var lsn = lessonFor(cut || n); if (lsn) return teach(lsn);
      }
      if (/(set ?up|customi[sz]e|arrange|organi[sz]e|help me (with|set up)).*(dashboard|home)/.test(n)) return R('Opening the dashboard customizer. You can show, hide and reorder sections there.', { actions: [{ type: 'customize', ok: 'Opened the customizer.', fail: 'I could not open the customizer.' }] });
      if (/(add|create|make|set up) (another |a new |an? )?(trading )?account/.test(n)) return R('Opening Accounts and pointing at the add button.', { actions: [{ type: 'navigate', view: 'accounts', ok: 'Opened Accounts.', fail: 'I could not open Accounts.' }, { type: 'highlight', selector: '#aRoot [data-act=a-new]', text: 'Tap + ADD ACCOUNT to create one.', ok: '', fail: '' }] });
      if (/where (do i|can i|is|are|do you) (find|see|change|set|get|go)|how do i (find|get to|change|set)|where.?s (my|the)/.test(n)) {
        var f2 = findFeature(n, true); if (/account (settings|rules)|accounts? settings/.test(n)) f2 = REG.byId('accounts');
        if (f2 && f2.kind === 'action') { var tf = REG.byId(f2.view); return R(f2.title + ': ' + f2.text + ' You find it in ' + (tf ? tf.title : f2.view) + '. I will take you there.', { actions: [{ type: 'navigate', view: f2.view, ok: 'Opened ' + (tf ? tf.title : f2.view) + '.', fail: 'I could not open it.' }] }); }
        if (f2) return R(featureInfo(f2) + ' I will take you there.', { actions: [{ type: 'navigate', view: f2.view, ok: 'Opened ' + f2.title + '.', fail: 'I could not open it.' }].concat(f2.tour && f2.tour[0] ? [{ type: 'highlight', selector: f2.tour[0].target, text: f2.tour[0].text, ok: '', fail: '' }] : []), feature: f2.id });
      }
      /* explain results */
      if (/(explain|interpret|what does|what do).*(my |the )?(result|results|number|numbers|output)|explain my results|what does this mean|what does that mean/.test(n) && ctx.lastCalc && ctx.lastCalc.res && ctx.last === 'calc') {
        var lc = ctx.lastCalc; if (lc.res.status === 'ok') return R('The calculator rounds down to whole contracts so your planned loss never goes above your ' + money(lc.q.risk * 100) + ' maximum. ' + plural(lc.res.contracts, 'contract') + ' at ' + money(lc.res.perCents) + ' each risks ' + money(lc.res.totalCents) + ' if your stop is hit, ' + (lc.q.risk * 100 - lc.res.totalCents > 0 ? money(lc.q.risk * 100 - lc.res.totalCents) + ' under your maximum.' : 'exactly your maximum.') + ' Slippage, fees and gaps can make the real loss larger than planned.');
      }
      if (/(explain|interpret|summar(y|ise|ize)).*(my )?(results|performance|numbers|stats)/.test(n)) return analyst('performance', data);
      /* risk calculator intents */
      var isCalc = /(how many|what)\b.*\b(contracts?|lots?|size|position)\b|(calculate|work out|figure out|whats|what is)( my| the)? position size|(position siz(e|ing)\b(?=.*(stop|point|dollars|risk|\$)))|calculate (my )?(size|contracts)|size (my )?(trade|position)|how (big|much) (should|can) i (trade|size)|open (the )?calculator.*(stop)|\bcontracts can i\b|\bcontracts should i\b/.test(n) || (/\b(contracts?)\b/.test(n) && /\bstop\b/.test(n));
      sl = slotsFrom(n);
      if (/(risk|loss|lose|cost).*\b(with|for|if)\b.*\d+ ?(contracts?|lots?)|how much (would|will|do) i (risk|lose)/.test(n) && sl.contracts != null && sl.stop != null && sl.inst || (sl.contracts != null && sl.stop != null && /risk|lose|cost/.test(n) && !isCalc)) {
        var iid = sl.inst || ctx.inst; if (iid) { var per = Math.round(sl.stop * INST.byId[iid].centsPerPoint); ctx.inst = iid; return R('Planned risk for ' + plural(sl.contracts, 'contract') + ' on ' + iid + ' with a ' + sl.stop + ' point stop is ' + money(per * sl.contracts) + ' (' + money(per) + ' per contract).'); }
        mergeCalc({ stop: sl.stop }); return ask('Which contract is that on?', ['inst'], ['Nano Nasdaq', 'Micro Nasdaq', 'Nasdaq', 'Micro S&P']);
      }
      if (isCalc) { ctx.last = 'calc'; mergeCalc(sl); if (sl.risk == null && sl.stop == null && !sl.inst) { ctx.stop = null; } return calcFlow(data); }
      /* calc follow-ups and corrections */
      if (ctx.last === 'calc' && ctx.stop != null && (/^(what if|what about|how about|and with|and if|try|now|use|make it|change (it |that )?to|actually|no i meant|i meant|instead|with|and)\b/.test(n) || /^\d/.test(n) || sl.inst) && (sl.stop != null || sl.risk != null || sl.inst || sl.bare != null)) {
        if (sl.bare != null && sl.stop == null && sl.risk == null && !sl.inst) { if (ctx.lastSlot === 'stop') sl.stop = sl.bare; else sl.risk = sl.bare; }
        var changed = mergeCalc(sl), said = (changed.indexOf('stop') >= 0 ? 'Using a ' + ctx.stop + ' point stop. ' : changed.indexOf('risk') >= 0 ? 'Using ' + money(ctx.risk * 100) + ' maximum risk. ' : changed.indexOf('inst') >= 0 ? 'Switching to ' + ctx.inst + '. ' : '');
        ctx.last = 'calc'; var out = calcFlow(data); if (out.calc && out.calc.status === 'ok') out.reply = out.reply.replace(/^That gives you/, 'That changes your position size to'); return out;
      }
      /* limits (sensitive) */
      if (/(change|set|update|raise|lower|edit|adjust|increase|decrease|reduce)\b.*\b(daily|weekly|per trade|max|maximum)?\b.*\blimit/.test(n) || /\bset (my )?(daily|weekly) (loss|risk|limit)/.test(n) || /\b(set|change|update|raise|lower)\b.*\b(max|maximum)\b.*\b(trades|contracts)\b/.test(n)) {
        var which = /weekly/.test(n) ? 'weeklyLossCents' : /per trade|each trade|single trade|risk per/.test(n) ? 'maxRiskPerTradeCents' : /trades? (per|a) day|number of trades/.test(n) ? 'maxTradesPerDay' : /contracts/.test(n) ? 'maxContracts' : 'dailyLossCents', labels = { dailyLossCents: 'daily loss limit', weeklyLossCents: 'weekly loss limit', maxRiskPerTradeCents: 'maximum risk per trade', maxTradesPerDay: 'maximum trades per day', maxContracts: 'maximum contracts' };
        var amount = sl.risk != null ? sl.risk : sl.bare != null ? sl.bare : null, isCount = which === 'maxTradesPerDay' || which === 'maxContracts';
        if (isCount) { var mm = /(\d+)/.exec(n); amount = mm ? +mm[1] : null; }
        if (amount == null || !(amount > 0)) return R('To change your ' + labels[which] + ' I need the new number, for example "set my daily loss limit to three hundred dollars". I will ask you to confirm before saving. I can also open the Risk center so you can edit it yourself.', { actions: [{ type: 'navigate', view: 'risk', ok: 'Opened the Risk center.', fail: '' }] });
        var cur = ((data.limits || {})[data.accountId || 'acct-default'] || {})[which], newV = isCount ? Math.round(amount) : Math.round(amount * 100);
        return needConfirm('Please confirm: change your ' + labels[which] + (cur != null ? ' from ' + (isCount ? cur : money(cur)) : '') + ' to ' + (isCount ? newV : money(newV)) + (data.accountName ? ' on ' + data.accountName : '') + '? This will be saved to your risk limits.', [{ type: 'setLimit', key: which, value: newV, ok: 'Saved your ' + labels[which] + '.', fail: 'I could not save the limit.' }], 'Saving your limit.');
      }
      /* switching accounts */
      var am = /(?:switch|change|go|open|show|select|use|pick)\b.*\b(?:to |open |show )?(?:my |the )?(.+?)\s*(?:account|acct)\b/.exec(n) || /\b(?:my |the )?([a-z0-9 ]+?) account\b/.exec(n);
      if (am && /account|acct/.test(n) && !/(add|create|another|new account|settings|rules)/.test(n)) {
        var term = n.split(/\baccounts?\b|\bacct\b/)[0].replace(/\b(switch|change|go|open|show|select|use|pick|to|my|the|a|me|please|over)\b/g, ' ').replace(/\s+/g, ' ').trim(), accts = data.accounts || [];
        if (!accts.length) return R('You have no accounts yet. I can open Accounts so you can add one.', { actions: [{ type: 'navigate', view: 'accounts', ok: 'Opened Accounts.', fail: '' }] });
        var mt = term ? accts.filter(function (a) { var hay = norm([a.name, a.firmSlug, a.productName].join(' ')); return term.split(' ').every(function (w) { return hay.indexOf(w) >= 0; }); }) : [];
        if (mt.length === 1) { ctx.last = 'account'; return R('Opening ' + mt[0].name + '.', { actions: [{ type: 'openAccount', id: mt[0].id, name: mt[0].name, ok: 'Opened ' + mt[0].name + '.', fail: 'I could not open that account.' }] }); }
        if (mt.length > 1) return R('Which one do you mean: ' + mt.slice(0, 5).map(function (a) { return a.name; }).join(', ') + '?', { chips: mt.slice(0, 4).map(function (a) { return 'Switch to ' + a.name; }) });
        return R('I could not find an account matching "' + term + '". Your accounts are: ' + accts.slice(0, 8).map(function (a) { return a.name; }).join(', ') + '.', { chips: accts.slice(0, 3).map(function (a) { return 'Switch to ' + a.name; }) });
      }
      /* routines */
      if (/(pre.?trade|before (i )?(trade|trading)|morning routine|start (my )?(day|session)|trade ready|pre.?market)/.test(n) && /(start|run|begin|do|check|routine|check.?in|check)/.test(n)) return routineStart('pre', data);
      if (/(post.?trade|after (i )?(trade|trading)|end of (the )?day|review (my )?(day|session)|wrap up|post.?session)/.test(n) && /(start|run|begin|do|review|routine|check)/.test(n)) return routineStart('post', data);
      if (/(weekly|week).*(review|summary|routine)|review (my )?week|week in review/.test(n) && !/compare/.test(n)) return routineStart('weekly', data);
      if (/(build|create|make|set up|help me (with|build)).*(routine|checklist)/.test(n)) return R('A good pre-trade checklist is short and answerable with yes or no: Is this setup in my plan? Is my stop set before I enter? Is my size within my limit? Have I hit my loss or trade limit today? Am I calm? A post-trade one: Did I follow my plan? What did I do well? What will I change? I will open Discipline where you can save these as your own checklists.', { actions: [{ type: 'navigate', view: 'discipline', ok: 'Opened Discipline.', fail: '' }], chips: ['Start my pre-trade check'] });
      if (/(session|day)\b.*(summar|recap)|summar.*(my )?(session|day|activity|today)|how did i do today|how.?s my day|recap/.test(n)) {
        var tp = today(data), t2 = tp.sum; if (!t2.n) return R('I do not see closed trades with a P&L for today yet. ' + (tp.open ? tp.open + ' still open.' : 'Log your trades and I will summarise your day.'));
        var all = (data.rows || []).filter(function (r) { return r.t.date === data.today; }); return R('Today you made ' + plural(all.length, 'trade') + ', ' + t2.n + ' closed. Your total is ' + money(t2.totalCents, true) + ' with ' + t2.wins + ' ' + (t2.wins === 1 ? 'winner' : 'winners') + ' and ' + t2.losses + ' ' + (t2.losses === 1 ? 'loser' : 'losers') + '. Your best trade was ' + money(t2.bestCents, true) + ' and your worst ' + money(t2.worstCents, true) + '.' + sampleNote(t2.n), { chips: ['Start post-trade review', 'Find my mistakes'] });
      }
      if (/breath|calm (me|down)|relax|focus exercise|mindful|meditat|reset my mind/.test(n)) return R('Let us take a minute. I will guide you through box breathing: four seconds in, hold, out, hold. Follow along.', { steps: CT.BREATH, actions: [{ type: 'breathe', ok: '', fail: '' }], chips: ['Stop'] });
      /* education follow-ups */
      if (/^(explain( that| it)? (simpler|more simply|in simple terms)|simpler|simplify|dumb it down|explain it like (i.?m|i am|im) (completely |totally )?(new|five|a beginner)|i dont understand|explain like (im|i am) new|eli5|in plain english)/.test(n)) {
        if (ctx.topic && ctx.topic.type === 'lesson') { var l1 = CT.LESSONS.filter(function (x) { return x.id === ctx.topic.id; })[0]; ctx.level = 'new'; return R(l1.plain + ' In one line: ' + l1.example, { chips: ['Give me an example', 'Quiz me on that'] }); }
        if (ctx.topic && ctx.topic.type === 'term') { var g1 = ctx.topic.entry; return R(g1.text.split('. ')[0] + '. Ask me for an example if that helps.', { chips: ['Give me an example'] }); }
        if (ctx.topic && ctx.topic.type === 'feature') { var f3 = REG.byId(ctx.topic.id); return R(featureInfo(f3, true)); }
        return R('Tell me what you would like explained, for example "explain drawdown", and I will start simply.');
      }
      if (/^(give me )?(an )?example|^for example|^show me an example|^can you give (me )?an example/.test(n)) {
        if (ctx.topic && ctx.topic.type === 'lesson') { var l2 = CT.LESSONS.filter(function (x) { return x.id === ctx.topic.id; })[0]; return R('Example: ' + l2.example, { chips: ['Quiz me on that', 'Explain that simpler'] }); }
        if (ctx.topic && ctx.topic.type === 'term') return R('Take your recorded trades: ' + (ctx.topic.entry.example || ctx.topic.entry.text), { chips: ['Quiz me'] });
        return R('Tell me which concept you want an example of, for example "explain position sizing".');
      }
      if (/^(more detail|go deeper|tell me more|explain more|in more depth|advanced version)/.test(n) && ctx.topic && ctx.topic.type === 'lesson') { var l3 = CT.LESSONS.filter(function (x) { return x.id === ctx.topic.id; })[0]; ctx.level = 'deep'; return R(l3.full, { chips: ['Give me an example', 'Quiz me on that'] }); }
      if (/quiz|test (me|my)|knowledge check/.test(n)) { var lq = ctx.topic && ctx.topic.type === 'lesson' && /(that|it|this)/.test(n) ? CT.LESSONS.filter(function (x) { return x.id === ctx.topic.id; })[0] : lessonFor(n.replace(/quiz|test|me|on|my|knowledge|check/g, ' ')); return startQuiz(lq || null); }
      /* new trade and misc actions */
      if (/(add|log|record|enter|create|new)\b.*\b(trade|entry)\b|new trade/.test(n)) return R('Opening the trade form. You review and save it yourself; I will not record a trade for you.', { actions: [{ type: 'newTrade', ok: 'The trade form is open.', fail: 'I could not open the trade form.' }] });
      if (/(download|make|create|export|save)\b.*\b(backup|copy of my data)|back ?up my data/.test(n)) return R('Opening the backup tools. You choose where the file is saved.', { actions: [{ type: 'backup', ok: 'Opened the backup tools.', fail: 'I could not open them.' }] });
      if (/(show|open|view)\b.*\bcalendar\b|trading calendar/.test(n) && !/econom|event|news/.test(n)) return R('Opening your trading calendar.', { actions: [{ type: 'navigate', view: 'journal', tab: 'calendar', ok: 'Opened the calendar.', fail: 'I could not open the calendar.' }] });
      if (/(economic|market) calendar|next event|upcoming events/.test(n)) return navTo(REG.byId('intel'));
      var rc = riskCoach(n, data); if (rc) { ctx.last = 'risk'; return rc; }
      /* analyst */
      if ((/^(what|whats|which|how|show|compare|am i|do i|list|tell me|give me|did i|are my|is my|where|and|my)\b/.test(n) || /\bmy (performance|results|trades|win rate)\b/.test(n)) && /(performance|how am i doing|how did i do|results|profit|p and l|pnl|win rate|average|expectancy|profit factor|streak|best|worst|biggest|largest|strateg|improv|mistake|repeat|consisten|last \d+ trades|last trades|recent trades|compare|what changed|trades did i|how many trades|my trades|risking more)/.test(n) && (!/^(what is|what are|define|explain)\b/.test(n) || /\b(my|i|me|mine)\b/.test(n)) || (ctx.last === 'analyst' && /^(and |what about |how about )(this|last|today|yesterday)/.test(n))) { ctx.last = 'analyst'; return analyst(n, data); }
      /* coaching (before analytics so emotional language wins) */
      for (var ci = 0; ci < CT.COACH.length; ci++) {
        if (CT.COACH[ci].test.test(n) && !/^(what is|what are|define)/.test(n)) {
          var co = CT.COACH[ci], extra = '';
          if (co.id === 'losses' || co.id === 'revenge') { var tdy = today(data).sum, strk = tdy.n ? tdy.currentStreak : null; if (strk && strk.type === 'loss' && strk.n >= 2) extra = ' Your journal shows ' + strk.n + ' losses in a row today, so please slow down.'; }
          ctx.topic = { type: 'coach', id: co.id }; ctx.last = 'coach';
          return R(co.text + extra, { chips: co.chips, kind: 'coach' });
        }
      }
      /* lessons and glossary */
      var asksDef = /^(what is|what are|whats|what does|explain|define|tell me about|teach me about|teach me|how does|why|meaning of|i dont understand)\b|\bmean\b/.test(n);
      var term = termFor(n); if (asksDef && term) { ctx.topic = { type: 'term', entry: term }; ctx.last = 'edu'; return R(term.term + ': ' + term.text, { chips: ['Explain that simpler', 'Give me an example', 'Quiz me on that'] }); }
      var les = lessonFor(n); if ((asksDef || les) && les && !/\b(open|go to|show me my)\b/.test(n)) { ctx.last = 'edu'; return teach(les); }
      if (asksDef) { var ff = findFeature(n); if (ff) { ctx.topic = { type: 'feature', id: ff.id }; return R(featureInfo(ff), { feature: ff.id, actions: [], chips: ['Teach me ' + ff.title, 'Open ' + ff.title] }); } }
      /* navigation */
      if (/^(open|go to|go|show|take me to|switch to|launch|bring up|pull up|navigate to|view|i want to see|let me see)\b/.test(n) || /\b(open|take me to|go to)\b/.test(n)) {
        var ft = findFeature(n, true);
        if (ft && ft.kind === 'action') { var tf2 = REG.byId(ft.view); return R(ft.title + ': ' + ft.text, { actions: [{ type: 'navigate', view: ft.view, act: ft.act, ok: 'Opened ' + (tf2 ? tf2.title : ft.view) + '.', fail: 'I could not open it.' }] }); }
        if (ft) { ctx.last = 'nav'; ctx.topic = { type: 'feature', id: ft.id }; return navTo(ft); }
        if (/^(home|dashboard)/.test(n.replace(/^(open|go to|go|show|take me to)\s+(the |my )?/, ''))) return navTo(REG.byId('home'));
      }
      if (dry) return { unknown: true, reply: '' };
      /* fallback: be honest */
      var near = findFeature(n, false);
      return R('I am not sure I can do that. I understand requests like opening screens, position sizing, questions about your trades, trading psychology, lessons and routines.' + (near ? ' Did you mean ' + near.title + '?' : '') + ' Say "help" for a list.', { unknown: true, chips: near ? ['Open ' + near.title, 'Help'] : ['Help', 'How many contracts can I take?', 'Quiz me'] });
    }
    function handle(text, data) {
      var r;
      try { r = parse(text, data || {}); } catch (e) { r = R('Sorry, I ran into a problem understanding that and nothing was changed. Please try rephrasing, or say help.', { error: String(e && e.message || e) }); }
      if (r && !r.confirm && ctx.confirm == null) { /* keep */ }
      return r;
    }
    return { handle: handle, ctx: ctx, reset: function () { for (var k in ctx) ctx[k] = null; ctx.level = 'plain'; ctx.depth = 0; }, endRoutine: function () { ctx.routine = null; ctx.quiz = null; ctx.pending = null; ctx.confirm = null; } };
  }
  /* ---------- Copilot preferences (local, included in backups). Everything is validated; bad data falls back to defaults. ---------- */
  function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
  function defaultPrefs() { return { v: 1, voice: { uri: '', rate: 1, mode: 'voice', greet: false }, micConsent: false, shortcuts: [], memory: {}, tried: [], recent: [] }; }
  function cleanPrefs(raw) {
    var d = defaultPrefs(), r = raw && typeof raw === 'object' ? raw : {}, v = r.voice && typeof r.voice === 'object' ? r.voice : {};
    d.voice.uri = str(v.uri, 200); var rate = Number(v.rate); d.voice.rate = isFinite(rate) ? Math.min(1.6, Math.max(0.6, Math.round(rate * 100) / 100)) : 1;
    d.voice.mode = ['voice', 'always', 'never'].indexOf(v.mode) >= 0 ? v.mode : 'voice'; d.voice.greet = v.greet === true; d.micConsent = r.micConsent === true;
    var seen = {}; d.shortcuts = (Array.isArray(r.shortcuts) ? r.shortcuts : []).map(function (x) { return x && { phrase: str(x.phrase, 40), command: str(x.command, 120) }; }).filter(function (x) { if (!x || x.phrase.length < 2 || !x.command || seen[norm(x.phrase)]) return false; seen[norm(x.phrase)] = 1; return true; }).slice(0, MAX_SHORTCUTS);
    var m = r.memory && typeof r.memory === 'object' ? r.memory : {};
    if (m.defaultInstrument && INST.byId[m.defaultInstrument]) d.memory.defaultInstrument = m.defaultInstrument;
    if (Number(m.defaultRisk) > 0 && Number(m.defaultRisk) <= 1000000) d.memory.defaultRisk = Number(m.defaultRisk);
    d.tried = (Array.isArray(r.tried) ? r.tried : []).filter(function (id) { return REG.byId(id); }).slice(0, 40);
    d.recent = (Array.isArray(r.recent) ? r.recent : []).map(function (x) { return str(x, 100); }).filter(Boolean).slice(0, 8);
    return d;
  }
  var api = { cleanPrefs: cleanPrefs, defaultPrefs: defaultPrefs, createSession: createSession, norm: norm, wordsToNumbers: wordsToNumbers, slotsFrom: slotsFrom, findInstrument: findInstrument, calcFallback: calcFallback, rangeOf: rangeOf, money: money, MAX_SHORTCUTS: MAX_SHORTCUTS, MAX_MEMORY: MAX_MEMORY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTCopilotCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
