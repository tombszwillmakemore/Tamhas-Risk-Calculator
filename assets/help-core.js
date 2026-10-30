/* Tamhas Trading - search, voice-command parsing, feedback text and reminder rules (pure logic). */
(function (root) {
  'use strict';
  var D = root.TTHelpData || (typeof require !== 'undefined' ? require('./help-data.js') : null);
  var INST = root.TTInstruments || (typeof require !== 'undefined' ? require('./instruments.js') : null);
  function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9&\/ ]/g, ' ').split(/\s+/).filter(Boolean); }
  var STOP = ['the', 'a', 'an', 'to', 'my', 'me', 'please', 'show', 'open', 'go', 'take', 'how', 'do', 'i', 'can', 'where', 'is', 'what', 'of', 'for', 'and', 'on', 'in'];

  /* ---------- universal search: every query word must match something; titles count most ---------- */
  function search(q, limit) {
    var qs = words(q).filter(function (w) { return STOP.indexOf(w) < 0; }); if (!qs.length) return [];
    var items = D.features.map(function (f) { return { kind: 'feature', id: f.id, title: f.title, text: f.how, view: f.view, anchor: f.anchor, tab: f.tab, action: f.action, hay: [f.title, f.words, f.area].join(' ') }; })
      .concat(D.learn.map(function (l) { return { kind: 'learn', id: l.id, title: l.title, text: l.text, view: 'help', anchor: 'learn-' + l.id, hay: [l.title, l.words].join(' ') }; }));
    var out = [];
    items.forEach(function (it) {
      var t = words(it.title), h = words(it.hay + ' ' + it.text), score = 0, all = true;
      qs.forEach(function (w) {
        var s = 0;
        if (t.indexOf(w) >= 0) s = 10; else if (t.some(function (x) { return x.indexOf(w) === 0; })) s = 7;
        else if (h.indexOf(w) >= 0) s = 4; else if (w.length >= 3 && h.some(function (x) { return x.indexOf(w) === 0; })) s = 2;
        if (!s) all = false; score += s;
      });
      if (all && score) out.push({ item: it, score: score + (it.kind === 'feature' ? 1 : 0) });
    });
    out.sort(function (a, b) { return b.score - a.score || a.item.title.localeCompare(b.item.title); });
    return out.slice(0, limit || 8).map(function (x) { return x.item; });
  }

  /* ---------- voice commands: a fixed grammar, not AI ---------- */
  var NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
  var SPOKEN_INST = { 'micro nasdaq': 'MNQ', 'micro nq': 'MNQ', 'm n q': 'MNQ', mnq: 'MNQ', 'nasdaq': 'NQ', 'n q': 'NQ', nq: 'NQ', 'micro s&p': 'MES', 'micro s and p': 'MES', 'micro es': 'MES', mes: 'MES', 'm e s': 'MES', 's&p': 'ES', 's and p': 'ES', es: 'ES', 'e s': 'ES', 'micro gold': 'MGC', mgc: 'MGC', gold: 'GC', gc: 'GC', 'nano nasdaq': 'NNQ', nnq: 'NNQ', 'nano s&p': 'NES', nes: 'NES' };
  function normSpeech(t) { return ' ' + String(t || '').toLowerCase().replace(/[,?!]/g, ' ').replace(/\$/g, ' ').replace(/\bdollars?\b/g, ' ').replace(/\s+/g, ' ').trim() + ' '; }
  function spokenNumbers(s) { return s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\b/g, function (w) { return String(NUM[w]); }); }
  function findInst(s) { var keys = Object.keys(SPOKEN_INST).sort(function (a, b) { return b.length - a.length; }); for (var i = 0; i < keys.length; i++) if (s.indexOf(' ' + keys[i] + ' ') >= 0 && (!INST || INST.byId[SPOKEN_INST[keys[i]]])) return SPOKEN_INST[keys[i]]; return null; }
  function parseVoice(transcript) {
    var s = normSpeech(spokenNumbers(normSpeech(transcript)));
    if (!s.trim()) return { type: 'unknown' };
    // risk calculator: "risk mnq stop 20 points risk 100 to 200"
    if (/\b(risk|calculate|calculator|position size|size)\b/.test(s) && /\bstop\b/.test(s)) {
      var inst = findInst(s), st = s.match(/stop (?:of |at |is )?(\d+(?:\.\d+)?)/), rng = s.match(/(?:risk(?:ing)?|between|from) (\d+(?:\.\d+)?) (?:to|and|-) (\d+(?:\.\d+)?)/), one = s.match(/risk(?:ing)? (\d+(?:\.\d+)?)\b(?! to| and)/);
      var out = { type: 'calc', instrument: inst, stop: st ? +st[1] : null, min: rng ? +rng[1] : (one ? +one[1] : null), max: rng ? +rng[2] : (one ? +one[1] : null) };
      if (out.min != null && out.max != null && out.min > out.max) { var x = out.min; out.min = out.max; out.max = x; }
      return out;
    }
    var m = s.match(/\b(?:explain|what is|what's|what are|tell me about|define)\s+(.+?)\s*$/);
    if (m) { var hit = D.learn.filter(function (l) { return words(l.words + ' ' + l.title).some(function (w) { return words(m[1]).indexOf(w) >= 0 && w.length > 2; }); })[0]; if (hit) return { type: 'explain', id: hit.id, title: hit.title, text: hit.text }; var f = search(m[1], 1)[0]; if (f) return { type: 'explain', id: f.id, title: f.title, text: f.text }; return { type: 'unknown', heard: transcript }; }
    var sm = s.match(/\bsearch(?: for)?\s+(.+?)\s*$/); if (sm) return { type: 'search', q: sm[1] };
    if (/\b(read|repeat|say)\b.*\b(again|that)\b/.test(s)) return { type: 'repeat' };
    if (/\b(stop|cancel|quiet|be quiet|never mind|nevermind)\b/.test(s)) return { type: 'stop' };
    if (/\b(back|go back)\b/.test(s) && s.trim().split(' ').length <= 3) return { type: 'back' };
    var nav = s.match(/\b(?:open|go to|show|take me to|navigate to|switch to)\s+(.+?)\s*$/), q = nav ? nav[1] : s;
    var r = search(q, 1)[0]; if (r) return { type: 'go', id: r.id, title: r.title, view: r.view, anchor: r.anchor, tab: r.tab, action: r.action };
    return { type: 'unknown', heard: transcript };
  }

  /* ---------- feedback: nothing personal is added unless you tick it, and never trade data or account names ---------- */
  function feedbackText(f, diag) {
    var lines = ['Type: ' + (f.type === 'feature' ? 'Feature request' : 'Bug report'), 'Summary: ' + String(f.title || '').trim().slice(0, 140), '', String(f.body || '').trim().slice(0, 5000)];
    if (f.type !== 'feature' && f.steps) lines.push('', 'Steps to reproduce:', String(f.steps).trim().slice(0, 3000));
    if (diag) lines.push('', '--- App details (no trades, no account names) ---', 'Version: ' + diag.version, 'Browser: ' + diag.ua, 'Screen: ' + diag.screen, 'Installed app: ' + (diag.standalone ? 'yes' : 'no'), 'Online: ' + (diag.online ? 'yes' : 'no'), 'Theme: ' + diag.theme, 'Records: ' + diag.counts, diag.errors ? 'Recent errors: ' + diag.errors : 'Recent errors: none');
    return lines.join('\n');
  }
  function feedbackValid(f) { if (!String(f.title || '').trim()) return 'Give it a short summary.'; if (String(f.body || '').trim().length < 10) return 'Describe it in a sentence or two.'; return null; }

  /* ---------- backup reminder: only when there is something to lose ---------- */
  function backupDue(o) {
    if (!o.trades) return { due: false };
    if (o.snoozeUntil && o.now < o.snoozeUntil) return { due: false };
    if (!o.lastBackup) return { due: true, reason: 'never' };
    var days = Math.floor((o.now - o.lastBackup) / 86400000);
    if (days >= 7 && o.changedSince !== false) return { due: true, reason: 'old', days: days };
    return { due: false };
  }

  var api = { search: search, parseVoice: parseVoice, feedbackText: feedbackText, feedbackValid: feedbackValid, backupDue: backupDue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTHelpCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
