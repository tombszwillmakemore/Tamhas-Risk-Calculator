/* Tamhas Trading - help centre, universal search, voice commands, install guide, feedback, diagnostics, update handling,
   backup reminder, guided tour and the startup screen hand-off. No network calls except: none. Voice uses the browser's own
   speech service only after you turn it on (see the notice in Settings). */
(function () {
  'use strict';
  var U = window.TTUI, D = window.TTHelpData, H = window.TTHelpCore, DB = window.TTDB, esc = U.esc;
  var VER = window.TT_VERSION || 'dev', BUILD = window.TT_BUILD || '';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function standalone() { try { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; } }
  function go(r) {
    if (!r) return; if (r.action === 'tour') { startTour(); return; } if (r.action === 'search') { openSearch(); return; } if (r.action === 'voice') { window.TTNav.go('settings'); setTimeout(function () { var v = $('#voiceSettings'); if (v) v.scrollIntoView({ block: 'start' }); }, 60); return; }
    window.TTNav.go(r.view);
    setTimeout(function () {
      if (r.tab) { var t = document.querySelector('[data-act=tab][data-tab="' + r.tab + '"]'); if (t) t.click(); }
      if (r.anchor) { var el = document.getElementById(r.anchor); if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ block: 'start' }); var f = el.querySelector('summary, button, input'); if (f) f.focus({ preventScroll: true }); } }
    }, 80);
  }

  /* ---------- recoverable error log (messages only; never data) ---------- */
  var ERR_KEY = 'tt.errors';
  function errors() { try { return JSON.parse(ls(ERR_KEY) || '[]'); } catch (e) { return []; } }
  function logError(msg) { var l = errors(); l.unshift({ at: Date.now(), m: String(msg || 'error').slice(0, 160) }); ls(ERR_KEY, JSON.stringify(l.slice(0, 20))); }
  window.addEventListener('error', function (e) { logError((e.message || 'error') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : '')); });
  window.addEventListener('unhandledrejection', function (e) { logError('Unhandled: ' + ((e.reason && e.reason.message) || e.reason)); });

  /* ---------- startup screen: hidden as soon as the app can be used (never an artificial wait) ---------- */
  var splash = document.getElementById('splash');
  function splashDone() { if (!splash || splash.classList.contains('out')) return; document.documentElement.classList.add('tt-booted'); splash.classList.add('out'); setTimeout(function () { if (splash && splash.parentNode) splash.parentNode.removeChild(splash); }, 320); }
  (DB && DB.ready ? DB.ready() : Promise.resolve()).then(function () { requestAnimationFrame(splashDone); }, function () { splashDone(); });
  setTimeout(splashDone, 5000);   // whatever happens, it never stays up
  function applyAnim(v) { document.documentElement.setAttribute('data-anim', v); document.querySelectorAll('[data-anim-set]').forEach(function (b) { var on = b.getAttribute('data-anim-set') === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-anim-set]'); if (!b) return; var v = b.getAttribute('data-anim-set'); ls('tt.anim', v); applyAnim(v); U.toast(v === 'off' ? 'Startup screen turned off.' : v === 'reduced' ? 'Animations reduced.' : 'Standard animations.'); });
  applyAnim(document.documentElement.getAttribute('data-anim') || 'standard');

  /* ---------- universal search (also the voice panel) ---------- */
  var srch = null, results = [], sel = 0, lastSpoken = '';
  function openSearch(prefill) {
    if (srch) { $('#srchQ').focus(); return; }
    var prev = document.activeElement;
    srch = document.createElement('div'); srch.className = 'srch-back';
    srch.innerHTML = '<div class="srch" role="dialog" aria-modal="true" aria-label="Search"><div class="srch-row"><label for="srchQ" class="vh">Search features, settings and help</label><input id="srchQ" type="search" autocomplete="off" placeholder="Search: import, fees, backup, drawdown…" role="combobox" aria-expanded="true" aria-controls="srchList" aria-autocomplete="list">' +
      (voiceOn() ? '<button type="button" class="iconbtn" id="srchMic" aria-label="Speak a command"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg></button>' : '') +
      '<button type="button" class="btn ghost" id="srchClose">CLOSE</button></div><ul id="srchList" role="listbox" aria-label="Results"></ul><p class="note voice-out" id="srchVoice" role="status" aria-live="polite"></p><p class="note" style="font-size:12px">Enter opens · ↑↓ move · Esc closes' + (voiceOn() ? ' · tap the microphone to speak' : '') + '</p></div>';
    document.body.appendChild(srch);
    var q = $('#srchQ'); q.value = prefill || ''; renderResults(); q.focus();
    q.addEventListener('input', function () { sel = 0; renderResults(); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, results.length - 1); renderResults(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderResults(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (results[sel]) { var r = results[sel]; closeSearch(); go(r); } }
    });
    srch.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSearch(); if (e.key === 'Tab') { var f = srch.querySelectorAll('input,button'); if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } } });
    srch.addEventListener('click', function (e) { if (e.target === srch || e.target.id === 'srchClose') closeSearch(); var b = e.target.closest('[data-r]'); if (b) { var r = results[+b.getAttribute('data-r')]; closeSearch(); go(r); } if (e.target.closest('#srchMic')) listen(); });
    srch._prev = prev;
  }
  function closeSearch() { if (!srch) return; stopListening(); var p = srch._prev; srch.parentNode.removeChild(srch); srch = null; if (p && p.focus) p.focus(); }
  function renderResults() {
    var q = $('#srchQ').value, list = $('#srchList');
    results = q.trim() ? H.search(q, 8) : D.features.filter(function (f) { return ['import', 'tradovate-guide', 'journal', 'calc', 'install', 'backup'].indexOf(f.id) >= 0; }).map(function (f) { return { kind: 'feature', id: f.id, title: f.title, text: f.how, view: f.view, anchor: f.anchor, tab: f.tab, action: f.action }; });
    list.innerHTML = results.length ? results.map(function (r, i) { return '<li><button type="button" role="option" id="srch-o' + i + '" data-r="' + i + '" aria-selected="' + (i === sel) + '"><b>' + esc(r.title) + (r.kind === 'learn' ? ' <small class="ui-badge">LEARN</small>' : '') + '</b><span>' + esc(r.text.slice(0, 110)) + (r.text.length > 110 ? '…' : '') + '</span></button></li>'; }).join('') : '<li class="note">Nothing found. Try another word, or open the Help centre.</li>';
    $('#srchQ').setAttribute('aria-activedescendant', results.length ? 'srch-o' + sel : '');
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSearch(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); } else if (e.key === 'i' && !srch) { window.TTNav.go('import'); } else if (e.key === '?' && !srch) { window.TTNav.go('help'); }
  });
  var sb = document.getElementById('searchBtn'); if (sb) sb.addEventListener('click', function () { openSearch(); });

  /* ---------- voice (Web Speech API), off until you turn it on ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null;
  function voiceSupported() { return { listen: !!SR, speak: 'speechSynthesis' in window }; }
  function voiceOn() { return ls('tt.voice') === 'on' && voiceSupported().listen; }
  function say(text) { lastSpoken = text; var out = $('#srchVoice'); if (out) out.textContent = text; if (ls('tt.voice.speak') === 'on' && 'speechSynthesis' in window) { try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.rate = 1; speechSynthesis.speak(u); } catch (e) {} } }
  function stopListening() { if (rec) { try { rec.abort(); } catch (e) {} rec = null; } var m = $('#srchMic'); if (m) m.classList.remove('on'); }
  function listen() {
    if (!SR) { say('Voice input is not available in this browser. Type instead.'); return; }
    if (rec) { stopListening(); return; }
    rec = new SR(); rec.lang = (navigator.language || 'en-US'); rec.interimResults = false; rec.maxAlternatives = 1;
    var m = $('#srchMic'); if (m) m.classList.add('on'); say('Listening…');
    rec.onresult = function (ev) { var tx = ev.results[0][0].transcript; var q = $('#srchQ'); if (q) q.value = tx; act(tx); };
    rec.onerror = function (ev) { say(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'Microphone permission was refused. You can allow it in your browser settings, or type instead.' : ev.error === 'no-speech' ? 'Nothing was heard. Tap the microphone and try again.' : ev.error === 'network' ? 'The browser\'s speech service could not be reached (it needs a connection in this browser). Type instead.' : 'Voice input stopped (' + ev.error + ').'); stopListening(); };
    rec.onend = function () { stopListening(); };
    try { rec.start(); } catch (e) { say('Voice input could not start.'); stopListening(); }
  }
  function act(tx) {
    var c = H.parseVoice(tx);
    if (c.type === 'go') { say('Opening ' + c.title + '.'); setTimeout(function () { closeSearch(); go(c); }, 400); }
    else if (c.type === 'explain') { say(c.title + '. ' + c.text); }
    else if (c.type === 'search') { var q = $('#srchQ'); if (q) { q.value = c.q; renderResults(); } say('Results for ' + c.q + '.'); }
    else if (c.type === 'calc') { closeSearch(); fillCalc(c); }
    else if (c.type === 'repeat') { if (lastSpoken) say(lastSpoken); }
    else if (c.type === 'stop') { try { speechSynthesis.cancel(); } catch (e) {} closeSearch(); }
    else if (c.type === 'back') { closeSearch(); history.back(); }
    else say('Sorry, I did not understand "' + (c.heard || tx) + '". Try "open journal", "import trades" or "explain drawdown".');
  }
  window.TTVoice = { act: act, parse: H.parseVoice };
  function fillCalc(c) {
    window.TTNav.go('calc');
    setTimeout(function () {
      function set(id, v) { var el = document.getElementById(id); if (!el || v == null) return; el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      if (c.instrument) set('instrument', c.instrument); set('stop', c.stop); set('minRisk', c.min); set('maxRisk', c.max);
      var missing = []; if (!c.stop) missing.push('the stop in points'); if (c.min == null) missing.push('your risk in dollars');
      U.toast(missing.length ? 'Filled what I heard. Still needed: ' + missing.join(' and ') + '.' : 'Calculator filled in. Check the numbers before you trade.');
    }, 80);
  }
  function renderVoiceSettings() {
    var el = document.getElementById('voiceSettings'); if (!el) return; var sup = voiceSupported();
    el.innerHTML = '<h2>Voice commands</h2>' + (sup.listen ? '<label class="ui-chk"><input type="checkbox" id="vOn"' + (ls('tt.voice') === 'on' ? ' checked' : '') + '><span>Turn on voice commands (adds a microphone to search)</span></label>' : '<p class="note" style="margin-top:0">This browser has no speech recognition, so voice commands are not available here. Everything works by typing.</p>') +
      (sup.speak ? '<label class="ui-chk"><input type="checkbox" id="vSpeak"' + (ls('tt.voice.speak') === 'on' ? ' checked' : '') + '><span>Read answers aloud (uses the voices on this device)</span></label>' : '') +
      '<p class="note">Say "open journal", "import trades", "search fees", "explain drawdown", or "risk MNQ stop 20 points risk 100 to 200" to fill the calculator. These are fixed commands, not an AI. <b>Privacy:</b> speech is turned into text by your browser\'s own speech service; in Chrome and Safari the audio may be sent to Google or Apple for that. TRC never receives or stores audio. The browser asks for microphone permission the first time.</p>';
  }
  document.addEventListener('change', function (e) {
    if (e.target.id === 'vOn') { ls('tt.voice', e.target.checked ? 'on' : null); U.toast(e.target.checked ? 'Voice commands on. Open search (/) and tap the microphone.' : 'Voice commands off.'); }
    if (e.target.id === 'vSpeak') ls('tt.voice.speak', e.target.checked ? 'on' : null);
  });

  /* ---------- help centre ---------- */
  function renderHelp() {
    var el = document.getElementById('helpRoot'); if (!el) return;
    var areas = {}; D.features.forEach(function (f) { (areas[f.area] || (areas[f.area] = [])).push(f); });
    el.innerHTML = '<div class="panel"><button type="button" class="btn wide" data-hact="search">SEARCH FEATURES AND HELP</button><div class="ui-row" style="margin-top:8px;flex-wrap:wrap"><button type="button" class="btn ghost" data-hact="tour">TAKE THE TOUR</button><button type="button" class="btn ghost" data-go="install">INSTALL TRC</button><button type="button" class="btn ghost" data-go="feedback">REPORT A PROBLEM</button></div>' +
      '<p class="note">Shortcuts on a computer: <b>/</b> or <b>Ctrl+K</b> search · <b>i</b> import trades · <b>?</b> help.</p></div>' +
      '<div class="panel"><h2>Quick start</h2><ol class="im-steps"><li>Export your Tradovate <b>Performance</b> or <b>Orders</b> report (or take a screenshot).</li><li>Tap <b>Import trades</b> on Home or in the Journal and drop it in.</li><li>Check the preview, choose the account, press Import. Your journal, calendar and analytics update.</li><li>Optional: add notes, tags or emotions to any trade, set your own risk limits, write a trading plan, and download a backup.</li></ol></div>' +
      Object.keys(areas).map(function (a) { return '<div class="panel"><h2>' + esc(a) + '</h2>' + areas[a].map(function (f) { return '<div class="help-art" id="help-' + f.id + '"><h3>' + esc(f.title) + '</h3><p class="note" style="margin-top:0">' + esc(f.how) + (f.limits ? ' <span class="warnline">Limits: ' + esc(f.limits) + '</span>' : '') + '</p><button type="button" class="btn ghost sm" data-hgo="' + f.id + '">OPEN</button></div>'; }).join('<hr class="ui-hr">') + '</div>'; }).join('') +
      '<div class="panel"><h2>Learn: trading basics and psychology</h2><p class="note" style="margin-top:0">General education, not financial advice.</p>' + D.learn.map(function (l) { return '<div class="help-art" id="learn-' + l.id + '"><h3>' + esc(l.title) + '</h3><p class="note" style="margin-top:0">' + esc(l.text) + '</p></div>'; }).join('') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-hact],[data-hgo]'); if (!b) return;
    var a = b.getAttribute('data-hact'), g = b.getAttribute('data-hgo');
    if (a === 'search') openSearch(); else if (a === 'tour') startTour(); else if (a === 'install-skip') { ls('tt.install.skip', '1'); U.toast('Hidden from the getting-started list.'); window.dispatchEvent(new Event('tt:journal-changed')); } else if (a === 'backup-snooze') { ls('tt.backup.snooze', String(Date.now() + 3 * 864e5)); renderBackupNag(); } else if (a === 'repair') repair(); else if (a === 'update-reload') location.reload();
    else if (g) go(D.features.filter(function (f) { return f.id === g; })[0]);
  });

  /* ---------- install guide ---------- */
  var INSTALL = {
    ios: { name: 'iPhone / iPad (Safari)', steps: ['Open this site in <b>Safari</b>.', 'Tap the <b>⋯</b> (more) button next to the address bar, then <b>Share</b>. On older iOS versions the <b>Share</b> button (square with an arrow) is in the toolbar.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Keep <b>Open as Web App</b> switched on if you see it.', 'Change the name to <b>TRC</b> if it shows anything else, then tap <b>Add</b>.'], note: 'iOS 16.4 and later can also add sites from other browsers through their Share menu. On iPad the Share option can be at the top right.' },
    android: { name: 'Android (Chrome, Pixel and most phones)', steps: ['Open this site in <b>Chrome</b>.', 'Tap the <b>⋮</b> menu at the top right.', 'Tap <b>Install app</b>. If you only see <b>Add to home screen</b>, tap that.', 'Confirm with <b>Install</b> (or <b>Add</b>). If Chrome lets you edit the name, use <b>TRC</b>.'], note: 'Chrome may also show an install banner or an install icon in the address bar. On a computer, Chrome and Edge show an install icon in the address bar.' },
    samsung: { name: 'Samsung Internet', steps: ['Open this site in <b>Samsung Internet</b>.', 'Tap the <b>☰</b> menu (three lines).', 'Tap <b>+ Add page to</b>, then <b>Home screen</b>.', 'Make the name <b>TRC</b> if needed, then tap <b>Add</b>.'], note: 'On some versions the menu may also offer <b>Install</b> or an install icon in the address bar.' }
  };
  var instTab = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /SamsungBrowser/.test(navigator.userAgent) ? 'samsung' : 'android';
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; renderInstall(); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; ls('tt.installed', '1'); U.toast('TRC was added to your Home Screen.'); renderInstall(); window.dispatchEvent(new Event('tt:journal-changed')); });
  function renderInstall() {
    var el = document.getElementById('installRoot'); if (!el) return; var t = INSTALL[instTab];
    el.innerHTML = (standalone() ? '<div class="ui-banner good">You are using the installed TRC app. Nothing else to do.</div>' : '') +
      '<div class="panel"><div class="inst-preview"><div><img src="icons/icon-192.png" alt="TRC app icon"><b>TRC</b></div><p class="note" style="margin:0">Installed, the app opens full screen like a normal app, works offline and appears on your Home Screen as <b>TRC</b>. The website itself stays <b>Tamhas Trading</b>. Your data stays in this browser on this device; installing does not copy it to other devices.</p></div>' +
      (deferredPrompt ? '<button type="button" class="btn wide" id="instNow">INSTALL TRC NOW</button>' : '') + '</div>' +
      '<div class="panel"><div class="ui-tabs inst-tabs" role="tablist" aria-label="Device">' + Object.keys(INSTALL).map(function (k) { return '<button type="button" role="tab" aria-selected="' + (k === instTab) + '" class="' + (k === instTab ? 'on' : '') + '" data-inst="' + k + '">' + esc(INSTALL[k].name) + '</button>'; }).join('') + '</div>' +
      '<ol class="im-steps">' + t.steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol><p class="note">' + t.note + '</p></div>' +
      '<div class="panel"><h2>About the name</h2><p class="note" style="margin-top:0">This site tells browsers the app is called <b>TRC</b> (in its app manifest and Apple\'s home-screen title setting). Android Chrome normally uses that name. On iPhone and iPad, and in Samsung Internet, the name is shown in an editable box before you add it; it should already say TRC, but the final label is whatever is in that box. Some launchers shorten long names; TRC is short enough not to be cut. Opening from the icon you may first see your phone\'s own brief splash before TRC\'s startup screen.</p>' +
      '<p class="note warnline">These steps follow current published guides (checked 30 Oct 2026) and could not be tested on real phones from here; wording can differ slightly between versions.</p>' +
      (!standalone() && !ls('tt.install.skip') ? '<button type="button" class="btn ghost sm" data-hact="install-skip">NOT NOW (HIDE FROM GETTING STARTED)</button>' : '') + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-inst]'); if (b) { instTab = b.getAttribute('data-inst'); renderInstall(); return; }
    if (e.target.id === 'instNow' && deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; renderInstall(); }); }
  });

  /* ---------- feedback ---------- */
  var REPO = 'https://github.com/tombszwillmakemore/Tamhas-Risk-Calculator/issues/new';
  function diag() {
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), DB.getAll('accounts'), DB.getAll('docs')]); }).then(function (r) {
      return { version: VER + (BUILD ? ' (' + BUILD + ')' : ''), ua: navigator.userAgent.slice(0, 160), screen: screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x, window ' + innerWidth + 'x' + innerHeight, standalone: standalone(), online: navigator.onLine, theme: document.documentElement.getAttribute('data-theme'), counts: r[0].length + ' trades, ' + r[1].length + ' accounts, ' + r[2].length + ' saved items', errors: errors().slice(0, 5).map(function (x) { return x.m; }).join(' | ') };
    }).catch(function () { return { version: VER, ua: navigator.userAgent.slice(0, 160), screen: screen.width + 'x' + screen.height, standalone: standalone(), online: navigator.onLine, theme: '', counts: 'database unavailable', errors: errors().slice(0, 5).map(function (x) { return x.m; }).join(' | ') }; });
  }
  function renderFeedback() {
    var el = document.getElementById('feedbackRoot'); if (!el) return;
    el.innerHTML = '<div class="panel ui-form"><p class="note" style="margin-top:0">Nothing is sent automatically. You get the text to copy, download, or post as a GitHub issue that you can read and edit before sending (needs a free GitHub account). Trades, notes and account names are never included.</p>' +
      '<div class="ui-tabs" role="radiogroup" aria-label="Type"><button type="button" role="radio" class="on" aria-checked="true" data-fbt="bug">Bug report</button><button type="button" role="radio" aria-checked="false" data-fbt="feature">Feature request</button></div>' +
      '<label for="fbTitle">Short summary *</label><input id="fbTitle" type="text" maxlength="140" placeholder="e.g. Screenshot import misses the price column">' +
      '<label for="fbBody">What happened, or what would you like? *</label><textarea id="fbBody" rows="5" maxlength="5000"></textarea>' +
      '<label for="fbSteps" id="fbStepsL">Steps to reproduce (optional)</label><textarea id="fbSteps" rows="3" maxlength="3000" placeholder="1. Open Import… 2. Drop the file… 3. …"></textarea>' +
      '<label class="ui-chk"><input type="checkbox" id="fbDiag" checked><span>Add anonymous app details (version, browser, screen size, number of records, recent error messages)</span></label>' +
      '<div class="ui-row" style="margin-top:12px;flex-wrap:wrap"><button type="button" class="btn" data-fb="preview">PREVIEW</button></div><div id="fbOut"></div></div>';
  }
  var fbType = 'bug', fbText = '';
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-fbt]'); if (t) { fbType = t.getAttribute('data-fbt'); document.querySelectorAll('[data-fbt]').forEach(function (x) { var on = x === t; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); }); var s = $('#fbSteps'), l = $('#fbStepsL'); if (s) { s.hidden = l.hidden = fbType === 'feature'; } return; }
    var b = e.target.closest && e.target.closest('[data-fb]'); if (!b) return; var a = b.getAttribute('data-fb');
    if (a === 'preview') {
      var f = { type: fbType, title: $('#fbTitle').value, body: $('#fbBody').value, steps: $('#fbSteps').value }, bad = H.feedbackValid(f); if (bad) { $('#fbOut').innerHTML = '<p class="note bad" role="alert">' + esc(bad) + '</p>'; return; }
      U.busy(b, ($('#fbDiag').checked ? diag() : Promise.resolve(null)).then(function (d) {
        fbText = H.feedbackText(f, d);
        $('#fbOut').innerHTML = '<label for="fbText">Your report (edit freely)</label><textarea id="fbText" rows="10">' + esc(fbText) + '</textarea><div class="ui-row" style="margin-top:8px;flex-wrap:wrap"><button type="button" class="btn" data-fb="copy">COPY</button><button type="button" class="btn ghost" data-fb="download">DOWNLOAD .TXT</button><a class="btn ghost" id="fbGh" target="_blank" rel="noopener noreferrer" href="#">OPEN GITHUB ISSUE</a></div>';
        updGh(f.title);
      }), 'PREPARING…');
    } else if (a === 'copy') { var tx = $('#fbText').value; (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(tx) : Promise.reject()).then(function () { U.toast('Copied.'); }, function () { $('#fbText').select(); U.toast('Press Ctrl+C (or long-press › Copy) to copy.'); }); }
    else if (a === 'download') { var blob = new Blob([$('#fbText').value], { type: 'text/plain' }), u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = 'trc-feedback.txt'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); }
  });
  function updGh(title) { var a = $('#fbGh'); if (!a) return; a.href = REPO + '?title=' + encodeURIComponent((fbType === 'feature' ? '[Feature] ' : '[Bug] ') + title) + '&body=' + encodeURIComponent(($('#fbText').value || '').slice(0, 6000)); }
  document.addEventListener('input', function (e) { if (e.target.id === 'fbText') updGh($('#fbTitle').value); });

  /* ---------- diagnostics (added under System health) ---------- */
  var swInfo = { state: 'checking', version: null };
  function renderDiag() {
    var el = document.getElementById('diagRoot'); if (!el) return; var er = errors(), lb = null;
    try { lb = (JSON.parse(ls('tt.journal.prefs.v1') || '{}') || {}).lastBackup || null; } catch (e) {}
    Promise.all([DB.ready().then(function () { return DB.getAll('docs'); }).catch(function () { return []; })]).then(function (r) {
      var imps = r[0].filter(function (d) { return d.kind === 'import'; }).sort(function (a, b) { return b.at - a.at; }), li = imps[0];
      el.innerHTML = '<div class="panel"><h2>App and device</h2><ul class="ui-list"><li><span>App version</span><b>' + esc(VER) + (BUILD ? ' · ' + esc(BUILD) : '') + '</b></li><li><span>Offline support</span><b>' + esc(swInfo.state) + (swInfo.version && swInfo.version !== VER ? ' (cached ' + esc(swInfo.version) + ')' : '') + '</b></li><li><span>Connection</span><b>' + (navigator.onLine ? 'online' : 'offline (everything still works)') + '</b></li><li><span>Opened as</span><b>' + (standalone() ? 'installed TRC app' : 'website') + '</b></li>' +
        '<li><span>Last import</span><b>' + (li ? esc(new Date(li.at).toLocaleString()) + ' · ' + (li.counts ? li.counts.trades : 0) + ' trades' + (li.rolledBack ? ' (rolled back)' : '') : 'none') + '</b></li><li><span>Last backup</span><b>' + (lb ? esc(new Date(lb).toLocaleString()) : 'never') + '</b></li></ul>' +
        '<h3 class="im-h3">Recent errors on this device</h3>' + (er.length ? '<ul class="ui-list">' + er.slice(0, 8).map(function (x) { return '<li><span class="note" style="margin:0">' + esc(new Date(x.at).toLocaleString()) + '</span><span>' + esc(x.m) + '</span></li>'; }).join('') + '</ul><button type="button" class="btn ghost sm" id="errClear">CLEAR LIST</button>' : '<p class="note" style="margin-top:0">None recorded.</p>') +
        '<h3 class="im-h3">Repair app files</h3><p class="note" style="margin-top:0">If the app looks out of date or broken after an update, this removes the cached app files (not your data) and reloads the latest version. Your trades, accounts and settings stay in place.</p><button type="button" class="btn ghost" data-hact="repair">REPAIR APP FILES</button>' +
        '<h3 class="im-h3">About local storage</h3><p class="note" style="margin-top:0">Your data is stored only in this browser on this device and does not sync to other devices. Clearing browsing data, removing the browser or installed app, private browsing, or the phone freeing space can remove it. Download a backup regularly (Journal › Backup).</p></div>';
    });
  }
  document.addEventListener('click', function (e) { if (e.target.id === 'errClear') { ls(ERR_KEY, null); renderDiag(); } if (e.target.id === 'updLater') { var b = document.getElementById('updBanner'); if (b) b.remove(); } });
  function repair() {
    U.confirm('Repair app files?', 'Removes the cached copy of the app (not your trades or settings) and reloads. Needs a connection to download the app again.', 'REPAIR', false).then(function (y) {
      if (!y) return;
      var jobs = []; if ('caches' in window) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('tt-app-') === 0; }).map(function (k) { return caches.delete(k); })); }));
      if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
      Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
    });
  }

  /* ---------- update detection ---------- */
  var prevVer = ls('tt.version');
  if (prevVer && prevVer !== VER) setTimeout(function () { U.toast('Updated to version ' + VER + '. Your data was kept.'); }, 1200);
  ls('tt.version', VER);
  // Only a page that was already controlled by an older worker has an update; the first install taking control is not one.
  var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { swInfo.state = location.protocol === 'https:' || location.hostname === 'localhost' ? 'starting' : 'not available here'; return; }
      swInfo.state = reg.active ? 'ready' : 'starting';
      if (reg.active) { navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'version') { swInfo.version = e.data.version; } }); reg.active.postMessage({ type: 'version' }); }
      reg.addEventListener('updatefound', function () { var w = reg.installing; if (!w) return; w.addEventListener('statechange', function () { if (w.state === 'installed' && hadController) showUpdate(); }); });
      setInterval(function () { reg.update().catch(function () {}); }, 3600000);
    }).catch(function () { swInfo.state = 'unavailable'; });
    var shown = false; navigator.serviceWorker.addEventListener('controllerchange', function () { if (shown || !hadController) return; shown = true; showUpdate(); });
  } else swInfo.state = 'not supported by this browser';
  function showUpdate() { if ($('#updBanner')) return; var d = document.createElement('div'); d.id = 'updBanner'; d.className = 'ui-banner good'; d.setAttribute('role', 'status'); d.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 8px);z-index:900;max-width:560px;margin:0 auto;display:flex;gap:10px;align-items:center;justify-content:space-between'; d.innerHTML = '<span>A new version of TRC is ready.</span><span class="ui-row"><button type="button" class="btn sm" data-hact="update-reload">RELOAD</button><button type="button" class="btn ghost sm" id="updLater">LATER</button></span>'; document.body.appendChild(d); }

  /* ---------- connection chip ---------- */
  function net() { var c = document.getElementById('netChip'); if (c) c.innerHTML = '<i></i>' + (navigator.onLine ? 'LOCAL MODE' : 'OFFLINE · LOCAL'); }
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  /* ---------- backup reminder on Home ---------- */
  function renderBackupNag() {
    var host = document.getElementById('homeStart'); if (!host) return; var old = document.getElementById('backupNag'); if (old) old.remove();
    var lb = null; try { lb = (JSON.parse(ls('tt.journal.prefs.v1') || '{}') || {}).lastBackup || null; } catch (e) {}
    DB.ready().then(function () { return DB.getAll('trades'); }).then(function (ts) {
      var newest = ts.reduce(function (a, t) { return Math.max(a, t.createdAt || 0); }, 0);
      var due = H.backupDue({ trades: ts.length, now: Date.now(), lastBackup: lb, snoozeUntil: +(ls('tt.backup.snooze') || 0), changedSince: !lb || newest > lb });
      if (!due.due) return; var d = document.createElement('div'); d.id = 'backupNag'; d.className = 'ui-banner warn';
      d.innerHTML = '<b>' + (due.reason === 'never' ? 'You have not downloaded a backup yet.' : 'Your last backup is ' + due.days + ' days old.') + '</b> Your ' + U.plural(ts.length, 'trade') + ' live only in this browser. <div class="ui-row" style="margin-top:8px"><button type="button" class="btn sm" data-hgo="backup">BACK UP NOW</button><button type="button" class="btn ghost sm" data-hact="backup-snooze">REMIND ME IN 3 DAYS</button></div>';
      host.parentNode.insertBefore(d, host);
    }).catch(function () {});
  }

  /* ---------- guided tour ---------- */
  var TOUR = [
    { sel: '#homeImport', title: 'Import trades', text: 'Start here: drop a Tradovate report or screenshot and your journal fills itself in.', view: 'home' },
    { sel: '.nav button[data-view=journal]', title: 'Journal', text: 'All your trades, calendar and reviews. Notes and tags are optional.' },
    { sel: '.nav button[data-view=calc]', title: 'Risk', text: 'Size positions so a stop-out stays inside your risk.' },
    { sel: '.nav button[data-view=accounts]', title: 'Accounts', text: 'Evaluation, funded, live and sim accounts with drawdown tracking.' },
    { sel: '.nav button[data-view=more]', title: 'More', text: 'Analytics, insights, discipline, strategy lab, money, help and settings.' },
    { sel: '#searchBtn', title: 'Search', text: 'Find any feature or answer. Press / on a computer.' }
  ];
  var tourI = -1, tourPop = null;
  function startTour() { window.TTNav.go('home'); tourI = -1; setTimeout(nextTour, 120); }
  function endTour() { document.querySelectorAll('.tour-hl').forEach(function (x) { x.classList.remove('tour-hl'); }); if (tourPop) tourPop.remove(); tourPop = null; tourI = -1; ls('tt.tour.done', '1'); }
  function nextTour() {
    document.querySelectorAll('.tour-hl').forEach(function (x) { x.classList.remove('tour-hl'); });
    tourI++; var st = TOUR[tourI]; if (!st) { endTour(); U.toast('Tour finished. Help is always under More › Help.'); return; }
    var el = document.querySelector(st.sel); if (!el || !el.offsetParent) { nextTour(); return; }
    el.classList.add('tour-hl'); el.scrollIntoView({ block: 'center' });
    if (!tourPop) { tourPop = document.createElement('div'); tourPop.className = 'tour-pop'; tourPop.setAttribute('role', 'dialog'); tourPop.setAttribute('aria-live', 'polite'); document.body.appendChild(tourPop); }
    tourPop.innerHTML = '<b>' + esc(st.title) + '</b> <small class="note">' + (tourI + 1) + ' / ' + TOUR.length + '</small><p class="note">' + esc(st.text) + '</p><div class="ui-row"><button type="button" class="btn sm" id="tourNext">' + (tourI === TOUR.length - 1 ? 'DONE' : 'NEXT') + '</button><button type="button" class="btn ghost sm" id="tourEnd">SKIP</button></div>';
    var r = el.getBoundingClientRect(), top = r.bottom + 10; if (top + 160 > innerHeight) top = Math.max(10, r.top - 170); tourPop.style.top = top + 'px'; tourPop.style.left = Math.max(10, Math.min(innerWidth - 310, r.left)) + 'px';
    $('#tourNext').focus();
  }
  document.addEventListener('click', function (e) { if (e.target.id === 'tourNext') nextTour(); else if (e.target.id === 'tourEnd') endTour(); });
  document.addEventListener('keydown', function (e) { if (tourPop && e.key === 'Escape') endTour(); });
  window.TTTour = { start: startTour };

  /* ---------- wiring ---------- */
  function renderFor(name) { if (name === 'help') renderHelp(); else if (name === 'install') renderInstall(); else if (name === 'feedback') renderFeedback(); else if (name === 'health') renderDiag(); else if (name === 'settings') renderVoiceSettings(); else if (name === 'home') renderBackupNag(); }
  window.addEventListener('tt:view', function (e) { renderFor(e.detail.name); });
  window.addEventListener('tt:journal-changed', renderBackupNag);
  if (window.TTNav) {
    window.TTNav.addHub({ id: 'help', title: 'Help', text: 'Guides, search, tour and trading basics.', icon: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>' });
    window.TTNav.addHub({ id: 'install', title: 'Install TRC', text: 'Add TRC to your phone\'s Home Screen.', icon: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>' });
    window.TTNav.addHub({ id: 'feedback', title: 'Feedback', text: 'Report a bug or ask for a feature.', icon: '<path d="M4 5h16v11H8l-4 4z"/>' });
  }
  renderVoiceSettings(); renderBackupNag();
  var cur = (location.hash || '#home').slice(1); renderFor(cur);
  window.TTHelp = { openSearch: openSearch, closeSearch: closeSearch, renderAll: function () { renderHelp(); renderInstall(); renderFeedback(); renderDiag(); }, errors: errors };
})();
