/* TRC Copilot - the assistant panel: text and voice in/out, conversation, and the code that PERFORMS actions through the app's real
   functions. copilot-core.js decides what was asked; this file does it, checks the result, and only then says it worked.
   Microphone: the browser's own speech recognition (Chrome/Safari may send audio to their vendor to transcribe, which is why a
   consent notice comes first). Nothing is sent by TRC. The microphone is stopped whenever the panel closes or the page is hidden. */
(function () {
  'use strict';
  var CP = window.TTCopilotCore, U = window.TTUI, N = window.TTNav, DB = window.TTDB, ST = window.TTStore, C = window.TTJournalCore, REG = window.TTRegistry, X = window.TTExperience;
  if (!CP || !U || !N) return;
  var esc = U.esc, KEY = 'tt.copilot.v1', HKEY = 'tt.copilot.hist.v1', MAXH = 60;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, TTS = window.speechSynthesis;
  var P = CP.cleanPrefs(null), session = CP.createSession(), panel = null, state = 'idle', rec = null, recTimer = null, snap = null, hist = [], viaVoice = false, breatheT = null, inited = false, voices = [];
  function $(s, r) { return (r || panel || document).querySelector(s); }
  function wait(sel, fn, ms) { var t = Date.now(); (function poll() { var el = document.querySelector(sel); if (el) { fn(el); return; } if (Date.now() - t < (ms || 2000)) setTimeout(poll, 50); else fn(null); })(); }

  /* ---------- preferences and history (local only) ---------- */
  function loadPrefs() {
    try { var raw = localStorage.getItem(KEY); if (raw) P = CP.cleanPrefs(JSON.parse(raw)); } catch (e) {}
    try { hist = JSON.parse(localStorage.getItem(HKEY) || '[]'); if (!Array.isArray(hist)) hist = []; hist = hist.filter(function (h) { return h && typeof h.t === 'string'; }).slice(-MAXH); } catch (e) { hist = []; }
    var had = false; try { had = !!localStorage.getItem(KEY); } catch (e) {}
    if (ST && !had) ST.getPref('copilot', null).then(function (v) { if (v) { P = CP.cleanPrefs(v); savePrefs(true); } }).catch(function () {});
  }
  var mt = null;
  function savePrefs(noMirror) { P = CP.cleanPrefs(P); try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} if (!noMirror && ST) { clearTimeout(mt); mt = setTimeout(function () { ST.setPref('copilot', P).catch(function () {}); }, 400); } }
  function pushHist(role, text) { hist.push({ r: role, t: String(text).slice(0, 600), at: Date.now() }); hist = hist.slice(-MAXH); try { localStorage.setItem(HKEY, JSON.stringify(hist)); } catch (e) {} }
  function clearHist() { hist = []; try { localStorage.removeItem(HKEY); } catch (e) {} }

  /* ---------- real data snapshot ---------- */
  var DEF = DB && DB.DEFAULT_ACCOUNT_ID || 'acct-default';
  function itemText(it) { return typeof it === 'string' ? it : (it && (it.text || it.label)) || ''; }
  function getSnap() {
    if (snap && Date.now() - snap.at < 15000) return Promise.resolve(snap.v);
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), DB.getAll('accounts'), ST.list('risklimit'), ST.list('plan'), ST.list('checklist'), ST.list('reflection')]); }).then(function (r) {
      var ok = []; r[0].forEach(function (raw) { var n = C.normalizeTrade(raw); if (n.ok) ok.push(n.trade); });
      var accts = r[1].filter(function (a) { return !a.archived; }).map(function (a) { return { id: a.id, name: a.name, firmSlug: a.firmSlug || '', productName: a.productName || '' }; });
      var limits = {}; r[2].forEach(function (d) { limits[d.accountId] = d.limits || {}; });
      var plan = r[3].filter(function (x) { return x.id === 'plan-main'; })[0], ptxt = '';
      if (plan) { var seg = []; if (plan.entryRules && plan.entryRules.length) seg.push('Entry rules: ' + plan.entryRules.map(itemText).join('; ') + '.'); if (plan.exitRules && plan.exitRules.length) seg.push('Exit rules: ' + plan.exitRules.map(itemText).join('; ') + '.'); if (plan.dontRules && plan.dontRules.length) seg.push('Things I will not do: ' + plan.dontRules.map(itemText).join('; ') + '.'); if (plan.maxTradesPerDay) seg.push('Max trades per day: ' + plan.maxTradesPerDay + '.'); if (plan.maxRiskCents) seg.push('Max risk per trade: ' + CP.money(plan.maxRiskCents) + '.'); ptxt = seg.join(' ').slice(0, 700); }
      var defs = r[4].filter(function (x) { return x.type === 'def'; }), pre = defs.filter(function (x) { return x.listType === 'pre'; })[0] || defs[0];
      var wk = new Date(); wk.setDate(wk.getDate() - 7); var wkKey = wk.getFullYear() + '-' + String(wk.getMonth() + 1).padStart(2, '0') + '-' + String(wk.getDate()).padStart(2, '0');
      var a0 = accts.filter(function (a) { return a.id === DEF; })[0] || accts[0];
      var v = { rows: C.analyze(ok), accounts: accts, limits: limits, plan: ptxt, checklists: pre ? [{ title: pre.name, items: (pre.items || []).map(itemText) }] : [], recentReflections: r[5].filter(function (x) { return x.date >= wkKey; }).length, accountId: a0 ? a0.id : DEF, accountName: accts.length > 1 && a0 ? a0.name : '' };
      snap = { at: Date.now(), v: v }; return v;
    });
  }
  ['tt:journal-changed', 'tt:accounts-changed'].forEach(function (e) { window.addEventListener(e, function () { snap = null; }); });
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function curView() { var a = document.querySelector('.view.active'); return a ? a.id.replace('view-', '') : 'home'; }

  /* The REAL calculator is driven through its own inputs; the answer is read back from its own output. */
  function calcRun(q) {
    var inst = document.getElementById('instrument'), st = document.getElementById('stop'), mn = document.getElementById('minRisk'), mx = document.getElementById('maxRisk'), card = document.getElementById('resultCard');
    if (!inst || !st || !mn || !mx || !card) return CP.calcFallback(q);
    function set(el, v, ev) { el.value = v; el.dispatchEvent(new Event(ev || 'input', { bubbles: true })); }
    set(inst, q.inst, 'change'); set(st, String(q.stop)); set(mn, String(q.minRisk || 0)); set(mx, String(q.risk));
    var cents = function (id) { var m = /\$([\d,]+\.\d{2})/.exec((document.getElementById(id) || {}).textContent || ''); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : null; };
    var cls = card.className, val = card.querySelector('.value');
    if (/\bwarn\b/.test(cls)) return { status: 'toolarge', perCents: cents('perContract') };
    if (/\binfo\b/.test(cls)) return { status: 'nofit', perCents: cents('perContract') };
    if (val) { var n = parseInt(val.textContent, 10); return { status: 'ok', contracts: n, perCents: cents('perContract'), totalCents: cents('totalRisk') }; }
    return CP.calcFallback(q);
  }

  /* ---------- performing actions (returns {ok, text?}) ---------- */
  function navTo(a) {
    N.go(a.view); var el = document.getElementById('view-' + a.view); if (!el || !el.classList.contains('active')) return Promise.resolve({ ok: false });
    if (X && a.view !== 'home') X.markTried(a.view);
    var chain = Promise.resolve({ ok: true });
    if (a.act && X && X.act) { var it = REG.byId(a.act) || REG.FEATURES.filter(function (f) { return f.act === a.act; })[0]; if (it) X.act({ view: a.view, kind: 'action', act: a.act }); }
    if (a.scroll) wait(a.scroll, function (e) { if (e) try { e.scrollIntoView({ block: 'start' }); } catch (x) {} });
    if (a.tab) chain = new Promise(function (res) { wait('#view-' + a.view + ' [data-act=tab][data-tab=' + a.tab + ']', function (b) { if (!b) { res({ ok: false }); return; } b.click(); setTimeout(function () { var again = document.querySelector('#view-' + a.view + ' [data-act=tab][data-tab=' + a.tab + ']'); res({ ok: !!again && again.getAttribute('aria-selected') === 'true' }); }, 80); }); });
    return chain;
  }
  var DO = {
    navigate: navTo,
    fillCalc: function (a) { N.go('calc'); var st = document.getElementById('stop'), mx = document.getElementById('maxRisk'); return { ok: !!(st && mx && String(parseFloat(st.value)) === String(a.stop) && parseFloat(mx.value) === a.risk) }; },
    theme: function (a) { var b = document.querySelector('[data-theme-set="' + a.mode + '"]'); if (!b) return { ok: false }; b.click(); return { ok: document.documentElement.getAttribute('data-theme-pref') === a.mode }; },
    density: function (a) { return { ok: !!(X && X.setDensity(a.value)) && document.documentElement.getAttribute('data-density') === a.value }; },
    customize: function () { return { ok: !!(X && X.customize()) && (collapse(), true) }; },
    highlight: function (a) { if (X) X.highlight(a.selector, a.text); return { ok: true }; },
    newTrade: function () { N.go('journal'); return new Promise(function (res) { var t = document.querySelector('#view-journal [data-act=tab][data-tab=entries]'); if (t && !document.querySelector('#view-journal [data-act=new]')) t.click(); wait('#view-journal [data-act=new]', function (b) { if (!b) { res({ ok: false }); return; } b.click(); wait('#jForm', function (f) { res({ ok: !!f }); collapse(); }, 1500); }); }); },
    backup: function () { N.go('journal'); return new Promise(function (res) { wait('#view-journal [data-act=tab][data-tab=backup]', function (b) { if (!b) { res({ ok: false }); return; } b.click(); setTimeout(function () { var again = document.querySelector('#view-journal [data-act=tab][data-tab=backup]'); res({ ok: !!again && again.getAttribute('aria-selected') === 'true' }); }, 80); }); }); },
    report: function () { if (!window.TTSupport) return { ok: false }; window.TTSupport.openReport(curView()); return { ok: true }; },
    tour: function (a) { var ok = X && X.featureTour(a.feature); if (ok) collapse(); return { ok: !!ok }; },
    openAccount: function (a) { N.go('accounts'); var ok = !!(window.TTAccounts && window.TTAccounts.open && window.TTAccounts.open(a.id)); if (ok) setTimeout(collapse, 0); return { ok: ok }; },
    stopSpeech: function () { stopSpeaking(); return { ok: true }; },
    setVoice: function (a) { if (a.mute != null) { P.voice.muted = !!a.mute; if (a.mute) stopSpeaking(); } if (a.rateDelta) P.voice.rate = Math.min(1.6, Math.max(0.6, P.voice.rate + a.rateDelta)); savePrefs(); renderSettings(); return { ok: true }; },
    breathe: function () { return { ok: true }; },
    remember: function (a) { P.memory[a.key] = a.value; savePrefs(); return { ok: P.memory[a.key] === a.value }; },
    forget: function () { P.memory = {}; savePrefs(); return { ok: Object.keys(P.memory).length === 0 }; },
    saveShortcut: function (a) { if (P.shortcuts.length >= CP.MAX_SHORTCUTS) return { ok: false }; P.shortcuts = P.shortcuts.filter(function (s) { return CP.norm(s.phrase) !== CP.norm(a.phrase); }).concat([{ phrase: a.phrase, command: a.command }]); savePrefs(); return { ok: true }; },
    clearShortcuts: function () { P.shortcuts = []; savePrefs(); renderSettings(); return { ok: true }; },
    clearHistory: function () { clearHist(); if (panel) $('.cp-log').innerHTML = ''; return { ok: true }; },
    setFocus: function () { return { ok: false }; },
    saveGoal: function (a) { return { ok: !!(X && X.setFocus && X.setFocus(a.text)) }; },
    saveReflection: function (a) {
      var D = window.TTDisciplineCore, date = todayKey(), id = 'ref-' + date; if (!D) return Promise.resolve({ ok: false });
      return ST.get(id).then(function (old) {
        var raw = { date: date, lesson: a.text };
        if (old) { raw = { date: date, mood: old.mood, focus: old.focus, planFollowed: old.planFollowed, wentWell: old.wentWell || '', struggled: old.struggled || '', tomorrow: old.tomorrow || '', lesson: ((old.lesson ? old.lesson + '\n' : '') + a.text).slice(0, 1500) }; }
        var v = D.validateReflection(raw); if (!v.ok) return { ok: false };
        return ST.save(Object.assign({ id: id, kind: 'reflection', createdAt: old && old.createdAt }, v.reflection)).then(function () { return ST.get(id); }).then(function (back) { snap = null; return { ok: !!back && String(back.lesson).indexOf(a.text.slice(0, 20)) >= 0, text: old ? 'I added it to the reflection you already had for today.' : '' }; });
      }).catch(function () { return { ok: false }; });
    },
    setLimit: function (a) {
      var K = window.TTRiskCore; if (!K) return Promise.resolve({ ok: false });
      return getSnap().then(function (s) {
        var id = s.accountId, rid = 'rl-' + id, prev = s.limits[id] || {}, raw = {};
        K.LIMITS.forEach(function (L) { var v = prev[L.key]; if (v != null) raw[L.key] = L.kind === 'money' ? (v / 100).toFixed(2) : String(v); });
        var L0 = K.LIMITS.filter(function (L) { return L.key === a.key; })[0]; raw[a.key] = L0.kind === 'money' ? (a.value / 100).toFixed(2) : String(a.value); raw.warnPct = prev.warnPct == null ? 80 : prev.warnPct;
        var v = K.validateLimits(raw); if (!v.ok) return { ok: false, text: v.errors.join(' ') };
        return ST.get(rid).then(function (old) { return ST.save({ id: rid, kind: 'risklimit', accountId: id, limits: v.limits, createdAt: old && old.createdAt }).then(function () { return ST.get(rid); }).then(function (back) {
          snap = null; var good = !!back && back.limits && back.limits[a.key] === a.value;
          if (good) U.toast('Limit saved.', false, { label: 'UNDO', fn: function () { (old ? ST.save(old) : ST.remove(rid, 'risklimit')).then(function () { snap = null; U.toast('Limit change undone.'); }).catch(function () { U.toast('Could not undo.', true); }); } });
          return { ok: good };
        }); });
      }).catch(function () { return { ok: false }; });
    }
  };
  function perform(actions) {
    var out = [], chain = Promise.resolve();
    (actions || []).forEach(function (a) { chain = chain.then(function () { var fn = DO[a.type]; if (!fn) return { ok: false }; try { return Promise.resolve(fn(a)); } catch (e) { return { ok: false }; } }).then(function (r) { out.push({ a: a, ok: !!(r && r.ok), text: r && r.text }); }, function () { out.push({ a: a, ok: false }); }); });
    return chain.then(function () { return out; });
  }
  function compose(reply, results) {
    if (!results.length) return { text: reply, ok: null };
    var bad = results.filter(function (r) { return !r.ok && r.a.fail; }), good = results.filter(function (r) { return r.ok && (r.a.ok || r.text); }), short = reply.length < 70;
    if (bad.length) return { text: (short ? '' : reply + ' ') + bad.map(function (r) { return r.a.fail; }).join(' ') + ' Nothing else was changed.', ok: false };
    var extra = good.map(function (r) { return [r.a.ok, r.text].filter(Boolean).join(' '); }).filter(Boolean).join(' ');
    return { text: short && extra ? extra : (reply + (extra ? ' ' + extra : '')).trim(), ok: results.some(function (r) { return r.a.ok; }) ? true : null };
  }

  /* ---------- speech out ---------- */
  function speakable(t) {
    return String(t).replace(/([+-]?)\$([\d,]+)(?:\.(\d\d))?/g, function (m, sg, d, c) { return (sg === '-' ? 'minus ' : '') + d.replace(/,/g, '') + ' dollars' + (c && c !== '00' ? ' and ' + c + ' cents' : ''); }).replace(/%/g, ' percent').replace(/(\d)R\b/g, '$1 R').replace(/[—•]/g, ', ').replace(/\bNNQ\b/g, 'nano Nasdaq').replace(/\bMNQ\b/g, 'micro Nasdaq').replace(/\bNQ\b/g, 'Nasdaq').replace(/\bMES\b/g, 'micro S and P').replace(/\bES\b/g, 'S and P');
  }
  function loadVoices() { if (!TTS) return; try { voices = TTS.getVoices() || []; } catch (e) { voices = []; } }
  function setState(s) { state = s; if (!panel) return; var orb = $('.cp-orb'); orb.className = 'cp-orb' + (s === 'listening' ? ' listen' : s === 'speaking' ? ' speak' : ''); $('.cp-wave').className = 'cp-wave' + (s === 'listening' || s === 'speaking' ? ' on' : '');
    var label = s === 'listening' ? 'Listening…' : s === 'speaking' ? 'Speaking…' : s === 'thinking' ? 'Thinking…' : 'Ready'; $('.cp-status').textContent = label + (P.voice.muted || P.voice.mode === 'never' ? ' · voice replies off' : ''); var m = $('.cp-btn.mic'); if (m) { m.classList.toggle('on', s === 'listening'); m.setAttribute('aria-pressed', s === 'listening'); m.setAttribute('aria-label', s === 'listening' ? 'Stop listening' : 'Start voice input'); } var st = $('.cp-hb.stop'); if (st) st.hidden = s !== 'speaking'; }
  function stopSpeaking() { if (TTS) try { TTS.cancel(); } catch (e) {} if (state === 'speaking') setState('idle'); }
  function speak(text, spokenTurn) {
    if (!TTS || P.voice.muted || P.voice.mode === 'never' || (P.voice.mode === 'voice' && !spokenTurn)) return;
    try {
      TTS.cancel(); var u = new SpeechSynthesisUtterance(speakable(text)); u.rate = P.voice.rate; u.lang = navigator.language || 'en-US';
      if (P.voice.uri) { var v = voices.filter(function (x) { return x.voiceURI === P.voice.uri; })[0]; if (v) { u.voice = v; u.lang = v.lang; } }
      u.onstart = function () { setState('speaking'); }; u.onend = u.onerror = function () { if (state === 'speaking') setState('idle'); };
      TTS.speak(u);
    } catch (e) { setState('idle'); }
  }
  function unlockSpeech() { if (!TTS) return; try { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; TTS.speak(u); } catch (e) {} }   // iOS only allows speech started from a tap

  /* ---------- speech in ---------- */
  function stopMic() { clearTimeout(recTimer); if (rec) { var r = rec; rec = null; r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (e) {} } if (state === 'listening') setState('idle'); }
  var MICERR = { 'not-allowed': 'Microphone permission is blocked. Allow it in your browser settings, or type instead.', 'service-not-allowed': 'Speech recognition is not allowed here. You can type instead.', 'no-speech': 'I did not hear anything. Tap the microphone and try again.', 'audio-capture': 'I could not find a microphone. You can type instead.', 'network': 'Speech recognition needs an internet connection. You can type instead.', 'language-not-supported': 'That language is not supported for voice. You can type instead.' };
  function startMic() {
    if (!SR) { say('c', 'Voice input is not available in this browser (some iPhone home-screen apps do not offer it). Typing works the same way.', 'bad'); return; }
    if (!P.micConsent) { showConsent(); return; }
    stopSpeaking(); stopMic(); unlockSpeech();
    try {
      rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1; var got = false, input = $('.cp-in');
      rec.onresult = function (e) { var t = '', fin = false; for (var i = e.resultIndex; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; } input.value = t; if (fin) { got = true; stopMic(); viaVoice = true; submit(); } };
      rec.onerror = function (e) { var code = e && e.error; if (code === 'aborted') return; stopMic(); say('c', MICERR[code] || 'Voice input stopped unexpectedly. You can try again or type.', 'bad'); };
      rec.onend = function () { var wasListening = state === 'listening'; rec = null; clearTimeout(recTimer); if (wasListening) { setState('idle'); if (!got && input.value.trim()) { viaVoice = true; submit(); } else if (!got) say('c', 'I did not catch that. Tap the microphone and try again, or type.'); } };
      rec.start(); setState('listening'); recTimer = setTimeout(function () { if (state === 'listening') stopMic(); }, 15000);
    } catch (e) { stopMic(); say('c', 'I could not start the microphone. You can type instead.', 'bad'); }
  }
  function showConsent() {
    if ($('.cp-notice')) return; var d = document.createElement('div'); d.className = 'cp-notice'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', 'Microphone notice');
    d.innerHTML = '<b>Before you use your voice</b><p style="margin:6px 0">Voice input uses your browser\'s own speech recognition. On Chrome and Safari your audio may be sent to Google or Apple to be turned into text. TRC itself never sends your audio or your trades anywhere, and the microphone only listens after you tap it and stops when you close Copilot.</p><div class="xact"><button type="button" class="btn" data-cp="consent">USE MY VOICE</button><button type="button" class="btn ghost" data-cp="noconsent">TYPE INSTEAD</button></div>';
    $('.cp-log').appendChild(d); d.scrollIntoView({ block: 'nearest' }); d.querySelector('button').focus();
  }

  /* ---------- conversation UI ---------- */
  function say(role, text, cls) { if (!panel) return null; var b = document.createElement('div'); b.className = 'cp-m ' + role + (cls ? ' ' + cls : ''); b.textContent = text; var log = $('.cp-log'); log.appendChild(b); log.scrollTop = log.scrollHeight; return b; }
  function setChips(list) { var h = $('.cp-chips'); h.innerHTML = ''; (list || []).slice(0, 6).forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.className = 'cp-chip'; b.textContent = c; b.setAttribute('data-q', c); h.appendChild(b); }); }
  function suggestions() {
    var v = curView(), f = REG.byId(v), c = f && f.copilot ? f.copilot.voice.slice(0, 2) : [];
    return c.concat(['What can you do?', 'Start my pre-trade check', "What's new?"]).slice(0, 5).map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1); });
  }
  function showConfirm(bubble) {
    var d = document.createElement('div'); d.className = 'cp-conf'; d.innerHTML = '<button type="button" class="go" data-cp="yes">YES, DO IT</button><button type="button" data-cp="no">NO, CANCEL</button>'; bubble.appendChild(d); d.querySelector('.go').focus();
  }
  function clearConf() { var c = panel && panel.querySelectorAll('.cp-conf'); if (c) Array.prototype.forEach.call(c, function (e) { e.remove(); }); }
  function submit(textOverride) {
    var input = $('.cp-in'), text = (textOverride != null ? textOverride : input.value).trim(); if (!text) return; input.value = ''; autosize();
    stopSpeaking(); stopBreathe(); clearConf(); var n0 = panel.querySelector('.cp-notice'); if (n0) n0.remove();
    say('u', text); pushHist('u', text); setState('thinking'); var voiceTurn = viaVoice; viaVoice = false;
    P.recent = [text].concat(P.recent.filter(function (x) { return x !== text; })).slice(0, 8); savePrefs();
    getSnap().catch(function () { return { rows: [], accounts: [], limits: {}, __failed: true }; }).then(function (s) {
      var data = Object.assign({}, s, { today: todayKey(), view: curView(), prefs: P, visited: ((X && X.prefs && X.prefs().recents) || []).concat((X && X.toursSeen && X.toursSeen()) || [], P.tried || []), name: X && X.prefs ? X.prefs().name : '', calc: { run: calcRun } });
      var r = session.handle(text, data), bubble;
      return perform(r.actions).then(function (res) {
        var out = compose(r.reply, res); if (s.__failed) out.text += ' (I could not read your saved data just now, so this answer may be incomplete.)';
        bubble = say('c', out.text, out.ok === false ? 'bad' : out.ok === true ? 'ok' : ''); pushHist('c', out.text);
        if (r.confirm) showConfirm(bubble);
        if (r.steps) runBreathe(r.steps, bubble);
        setChips(r.chips && r.chips.length ? r.chips : (r.confirm ? [] : suggestions()));
        speak(out.text, voiceTurn);
        if (r.feature && P.tried.indexOf(r.feature) < 0) { P.tried = P.tried.concat([r.feature]); savePrefs(); }
        if (state === 'thinking') setState('idle');
      });
    }).catch(function () { say('c', 'Sorry, something went wrong and nothing was changed. Please try again, or say help.', 'bad'); setState('idle'); });
  }
  function runBreathe(steps, bubble) {
    var i = 0; stopBreathe(); (function next() { if (!panel || i >= steps.length) { breatheT = null; return; } bubble.textContent = steps[i]; speakStep(steps[i]); i++; breatheT = setTimeout(next, i === 1 ? 3500 : 4600); })();
  }
  function speakStep(t) { if (!TTS || P.voice.muted || P.voice.mode === 'never') return; try { TTS.cancel(); var u = new SpeechSynthesisUtterance(t); u.rate = Math.min(P.voice.rate, 0.9); TTS.speak(u); } catch (e) {} }
  function stopBreathe() { if (breatheT) { clearTimeout(breatheT); breatheT = null; } }
  function autosize() { var i = $('.cp-in'); if (i) { i.style.height = 'auto'; i.style.height = Math.min(110, i.scrollHeight) + 'px'; } }

  /* ---------- settings drawer ---------- */
  function renderSettings() {
    var d = $('.cp-set'); if (!d || d.hidden) return; loadVoices();
    var vopts = '<option value="">Default voice</option>' + voices.map(function (v) { return '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === P.voice.uri ? ' selected' : '') + '>' + esc(v.name + ' (' + v.lang + ')') + '</option>'; }).join('');
    d.innerHTML = '<h3 style="margin-top:0">Voice</h3>' + (TTS ? '<label for="cpVoice">Voice</label><select id="cpVoice">' + vopts + '</select><label for="cpRate" style="display:block;margin-top:10px">Speaking speed: ' + P.voice.rate.toFixed(2) + 'x</label><input type="range" id="cpRate" min="0.6" max="1.6" step="0.05" value="' + P.voice.rate + '" style="width:100%">' +
      '<label for="cpMode" style="display:block;margin-top:10px">Speak replies</label><select id="cpMode"><option value="voice"' + (P.voice.mode === 'voice' ? ' selected' : '') + '>Only after I use voice</option><option value="always"' + (P.voice.mode === 'always' ? ' selected' : '') + '>Always</option><option value="never"' + (P.voice.mode === 'never' ? ' selected' : '') + '>Never (muted)</option></select>' +
      '<div class="row"><input type="checkbox" id="cpGreet"' + (P.voice.greet ? ' checked' : '') + '><label for="cpGreet">Speak a greeting when I open Copilot</label></div>' : '<p class="note">This browser cannot speak replies. Everything still appears as text.</p>') +
      '<h3>Microphone</h3><p class="note" style="margin:0">' + (SR ? 'Voice input is available. ' : 'Voice input is not available in this browser. ') + (P.micConsent ? 'You agreed to use it. <button type="button" class="linkbtn" data-cp="revoke">Withdraw agreement</button>' : 'You will be asked before it is first used.') + '</p>' +
      '<h3>What I remember (only if you approved it)</h3>' + (Object.keys(P.memory).length ? '<ul>' + Object.keys(P.memory).map(function (k) { return '<li>' + (k === 'defaultInstrument' ? 'Usual contract: ' : 'Usual max risk: $') + esc(P.memory[k]) + '</li>'; }).join('') + '</ul><button type="button" class="linkbtn" data-cp="forget">Forget these</button>' : '<p class="note" style="margin:0">Nothing. Say "remember that I trade micro Nasdaq" and I will ask first.</p>') +
      '<h3>My voice shortcuts</h3>' + (P.shortcuts.length ? '<ul>' + P.shortcuts.map(function (s, i) { return '<li>"' + esc(s.phrase) + '" runs "' + esc(s.command) + '" <button type="button" class="linkbtn" data-cp="delsc" data-i="' + i + '">remove</button></li>'; }).join('') + '</ul>' : '<p class="note" style="margin:0">None yet. Say: when I say "morning" do start my pre-trade check.</p>') +
      '<h3>Conversation</h3><input type="search" id="cpSearch" placeholder="Search past conversation" aria-label="Search past conversation"><div id="cpHits" class="note"></div><div class="row"><button type="button" class="btn ghost" data-cp="clearhist">CLEAR HISTORY</button><button type="button" class="btn ghost" data-cp="report">REPORT A PROBLEM</button></div>' +
      '<h3>How Copilot works</h3><p class="note" style="margin:0">Copilot is a rule-based helper that runs on your device. It is not a large language model, so it understands a fixed set of requests and says so when it cannot help. It answers from the trades you logged, never invents numbers, asks before changing anything important, and cannot place trades. Lessons and coaching are education, not personal financial advice. History is stored only in this browser (last ' + MAXH + ' messages).</p><div class="xact" style="margin-top:12px"><button type="button" class="btn" data-cp="closeset">DONE</button></div>';
  }
  function toggleSettings() { var d = $('.cp-set'); d.hidden = !d.hidden; $('.cp-hb.gear').setAttribute('aria-expanded', !d.hidden); if (!d.hidden) renderSettings(); }

  /* ---------- panel ---------- */
  var ICON = { close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', big: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></svg>', mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>', send: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>', stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>', mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6"/></svg>' };
  function build() {
    panel = document.createElement('section'); panel.className = 'cp-panel'; panel.id = 'copilotPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'TRC Copilot');
    panel.innerHTML = '<div class="cp-head"><div class="cp-orb" aria-hidden="true"></div><div class="cp-title"><b>TRC COPILOT</b><span class="cp-status" role="status" aria-live="polite">Ready</span></div>' +
      '<button type="button" class="cp-hb stop" hidden aria-label="Stop speaking" data-cp="stopspeech">' + ICON.stop + '</button>' +
      '<button type="button" class="cp-hb mute" aria-label="Mute voice replies" aria-pressed="false" data-cp="mute">' + ICON.mute + '</button>' +
      '<button type="button" class="cp-hb gear" aria-label="Copilot settings" aria-expanded="false" data-cp="gear">' + ICON.gear + '</button>' +
      '<button type="button" class="cp-hb size" aria-label="Expand or collapse" data-cp="size">' + ICON.big + '</button>' +
      '<button type="button" class="cp-hb" aria-label="Close Copilot" data-cp="close">' + ICON.close + '</button></div>' +
      '<div class="cp-set" hidden></div><div class="cp-log" role="log" aria-live="polite" aria-relevant="additions"></div><div class="cp-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="cp-chips" role="group" aria-label="Suggestions"></div>' +
      '<form class="cp-form"><label class="cp-sr" for="cpIn">Message to Copilot</label><textarea id="cpIn" class="cp-in" rows="1" placeholder="Ask or tell me what to do…" autocomplete="off" enterkeyhint="send"></textarea><button type="button" class="cp-btn mic" aria-label="Start voice input" aria-pressed="false"' + (SR ? '' : ' title="Voice input is not available in this browser"') + '>' + ICON.mic + '</button><button type="submit" class="cp-btn send" aria-label="Send">' + ICON.send + '</button></form>';
    document.body.appendChild(panel);
    panel.addEventListener('click', onClick); panel.querySelector('.cp-form').addEventListener('submit', function (e) { e.preventDefault(); unlockSpeech(); viaVoice = false; submit(); });
    var inp = $('.cp-in'); inp.addEventListener('input', autosize); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); unlockSpeech(); viaVoice = false; submit(); } });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    panel.addEventListener('input', function (e) { if (e.target.id === 'cpSearch') searchHist(e.target.value); });
    panel.addEventListener('change', function (e) {
      var id = e.target.id; if (id === 'cpVoice') P.voice.uri = e.target.value; else if (id === 'cpMode') P.voice.mode = e.target.value; else if (id === 'cpGreet') P.voice.greet = e.target.checked; else if (id === 'cpRate') { P.voice.rate = parseFloat(e.target.value); } else return;
      if (P.voice.mode === 'never') stopSpeaking(); savePrefs(); if (id === 'cpRate') renderSettings(); syncMute(); setState(state);
    });
    var micB = $('.cp-btn.mic'); micB.addEventListener('click', function () { if (state === 'listening') { stopMic(); } else startMic(); });
    if (!SR) micB.setAttribute('aria-disabled', 'true');
  }
  function syncMute() { var m = $('.cp-hb.mute'); if (m) { var mu = P.voice.muted || P.voice.mode === 'never'; m.setAttribute('aria-pressed', mu); m.setAttribute('aria-label', mu ? 'Unmute voice replies' : 'Mute voice replies'); } }
  function searchHist(q) {
    var out = $('#cpHits'); q = String(q).trim().toLowerCase(); if (!out) return; if (!q) { out.textContent = ''; return; }
    var hits = hist.filter(function (h) { return h.t.toLowerCase().indexOf(q) >= 0; }).slice(-8).reverse(); out.innerHTML = hits.length ? hits.map(function (h) { return '<div>' + (h.r === 'u' ? 'You' : 'Copilot') + ': ' + esc(h.t.slice(0, 140)) + '</div>'; }).join('') : 'No matches.';
  }
  function collapse() { if (panel && window.innerWidth < 900) close(true); }
  function onClick(e) {
    var chip = e.target.closest('.cp-chip'); if (chip) { unlockSpeech(); viaVoice = false; submit(chip.getAttribute('data-q')); return; }
    var b = e.target.closest('[data-cp]'); if (!b) return; var a = b.getAttribute('data-cp');
    if (a === 'close') close(); else if (a === 'gear' || a === 'closeset') toggleSettings(); else if (a === 'size') { panel.classList.toggle('big'); }
    else if (a === 'stopspeech') { stopSpeaking(); stopBreathe(); } else if (a === 'mute') { P.voice.muted = !(P.voice.muted || P.voice.mode === 'never'); if (P.voice.mode === 'never' && !P.voice.muted) P.voice.mode = 'voice'; if (P.voice.muted) stopSpeaking(); savePrefs(); syncMute(); setState(state); }
    else if (a === 'yes' || a === 'no') { unlockSpeech(); viaVoice = false; submit(a); }
    else if (a === 'consent') { P.micConsent = true; savePrefs(); b.closest('.cp-notice').remove(); startMic(); } else if (a === 'noconsent') { b.closest('.cp-notice').remove(); $('.cp-in').focus(); }
    else if (a === 'revoke') { P.micConsent = false; savePrefs(); renderSettings(); } else if (a === 'forget') { DO.forget(); renderSettings(); } else if (a === 'delsc') { P.shortcuts.splice(+b.getAttribute('data-i'), 1); savePrefs(); renderSettings(); }
    else if (a === 'clearhist') { clearHist(); $('.cp-log').innerHTML = ''; renderSettings(); U.toast('Conversation history cleared.'); } else if (a === 'report') { close(true); if (window.TTSupport) window.TTSupport.openReport(curView()); }
  }
  function open() {
    if (!inited) { inited = true; loadPrefs(); loadVoices(); if (TTS && TTS.addEventListener) TTS.addEventListener('voiceschanged', function () { loadVoices(); renderSettings(); }); }
    if (panel) { $('.cp-in').focus(); return true; }
    build(); var fab = document.getElementById('copilotFab'); if (fab) { fab.classList.add('on'); fab.setAttribute('aria-expanded', 'true'); }
    var name = X && X.prefs ? X.prefs().name : '', first = !hist.length;
    var greet = 'Hi' + (name ? ', ' + name : '') + '. I am TRC Copilot. ' + (SR ? 'Type or tap the microphone. ' : 'Type a request. ') + 'I can open screens, size a position, review your trades, coach you through a tough moment, and teach concepts. I run on your device and can\'t place trades.';
    if (first) say('c', greet); else { hist.slice(-6).forEach(function (h) { say(h.r === 'u' ? 'u' : 'c', h.t); }); var sep = document.createElement('div'); sep.className = 'cp-sep note'; sep.textContent = 'Earlier conversation above. How can I help now?'; $('.cp-log').appendChild(sep); }
    setChips(P.recent.length && first ? P.recent.slice(0, 3).concat(suggestions().slice(0, 2)) : suggestions()); syncMute(); setState('idle');
    if (P.voice.greet && first) speak(greet, true);
    if (window.matchMedia && matchMedia('(pointer: fine)').matches) $('.cp-in').focus(); else $('.cp-hb[data-cp=close]').focus();
    return true;
  }
  function close(keepFocus) {
    if (!panel) return; stopMic(); stopSpeaking(); stopBreathe(); session.endRoutine && session.endRoutine();
    panel.remove(); panel = null; state = 'idle'; var fab = document.getElementById('copilotFab'); if (fab) { fab.classList.remove('on'); fab.setAttribute('aria-expanded', 'false'); if (keepFocus !== true) try { fab.focus(); } catch (e) {} }
  }
  // The microphone and speech must never keep running unseen.
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel && !document.querySelector('.xo, .ui-dlg-back, .coach')) { var set = $('.cp-set'); if (set && !set.hidden) toggleSettings(); else close(); } });
  document.addEventListener('visibilitychange', function () { if (document.hidden) { stopMic(); stopSpeaking(); stopBreathe(); } });
  window.addEventListener('pagehide', function () { stopMic(); stopSpeaking(); });
  window.addEventListener('tt:view', function () { if (panel && !$('.cp-chips').children.length) setChips(suggestions()); });
  window.TTCopilot = { open: open, close: close, isOpen: function () { return !!panel; }, session: session, prefs: function () { return P; }, say: function (t) { return session.handle(t, {}); }, _micActive: function () { return !!rec; }, _state: function () { return state; } };
})();
