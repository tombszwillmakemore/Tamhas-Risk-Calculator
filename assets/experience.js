/* Tamhas Trading - experience layer: personal welcome, tour, search palette, personal dashboard, favorites and recents,
   settings for personalisation, help page, keyboard shortcuts. It sits on top of the existing screens and changes none of
   their logic. Personal choices live on this device only (localStorage, mirrored into backups). No account, no network. */
(function () {
  'use strict';
  var X = window.TTExperienceCore, U = window.TTUI, N = window.TTNav, C = window.TTJournalCore, A = window.TTAnalyticsCore, DB = window.TTDB, ST = window.TTStore, INST = window.TTInstruments, REG = window.TTRegistry;
  if (!X || !N) return;
  var esc = U.esc, KEY = 'tt.profile.v1', CALC_KEY = 'tt.calc.last.v1', LEGACY_SETTINGS = 'tt.settings.v1';
  var P = X.defaults(), S = { rows: [], plan: null, refToday: false, customizing: false, cur: 'home', data: false };
  var ICON = {
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function todayKey() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* ---------- profile storage ---------- */
  function readLocal() { try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  var mirrorT = null;
  function persist() {
    P = X.cleanPrefs(P);
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* private mode: lasts for this visit */ }
    clearTimeout(mirrorT); mirrorT = setTimeout(function () { if (ST) ST.setPref('profile', P).catch(function () {}); }, 400);   // so it is included in backups
  }
  function applyDensity() { document.documentElement.setAttribute('data-density', P.density === 'compact' ? 'compact' : 'comfortable'); }
  function legacyName() { try { var s = JSON.parse(localStorage.getItem(LEGACY_SETTINGS) || '{}'); var n = X.cleanName(s && s.displayName); return n && n.toLowerCase() !== 'trader' ? n : ''; } catch (e) { return ''; } }

  /* ---------- small helpers ---------- */
  function go(v) { N.go(v); }
  function title(id) { var e = X.entry(id); return e ? e.title : id; }
  function toast(m, err, act) { U.toast(m, err, act); }
  // Focus-trapped overlay; returns {close}. Esc closes. Focus returns to whatever had it.
  function overlay(cls, html, opts) {
    opts = opts || {}; var prev = document.activeElement, wrap = document.createElement('div'); wrap.className = 'xo ' + (cls || ''); wrap.innerHTML = html; document.body.appendChild(wrap);
    var box = wrap.firstElementChild; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); if (opts.label) box.setAttribute('aria-label', opts.label);
    function close(r) { document.removeEventListener('keydown', key, true); wrap.remove(); if (prev && prev.focus && document.contains(prev)) try { prev.focus(); } catch (e) {} if (opts.onClose) opts.onClose(r); }
    function key(e) {
      box = wrap.firstElementChild;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('esc'); return; }
      if (e.key !== 'Tab') return; var f = $$('button,input,select,textarea,[tabindex="0"],a[href]', box).filter(function (x) { return !x.disabled && x.offsetParent !== null; }); if (!f.length) return;
      var first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', key, true); return { el: wrap, box: box, close: close };
  }

  /* ---------- real data for the dashboard ---------- */
  function loadData() {
    if (!DB || !C) return Promise.resolve();
    return DB.ready().then(function () { return Promise.all([DB.getAll('trades'), ST ? ST.list('plan') : [], ST ? ST.list('reflection') : []]); }).then(function (r) {
      var ok = []; r[0].forEach(function (raw) { var n = C.normalizeTrade(raw); if (n.ok) ok.push(n.trade); }); S.rows = C.analyze(ok);
      S.plan = r[1].filter(function (x) { return x.id === 'plan-main'; })[0] || null; S.refToday = r[2].some(function (x) { return x.date === todayKey(); }); S.data = true;
    }).catch(function () { S.data = true; });
  }
  function weekRange() { var d = new Date(); var dow = (d.getDay() + 6) % 7, m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow), s = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6); var f = function (x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }; return { from: f(m), to: f(s) }; }
  function basis() { return S.rows.some(function (r) { return r.c.isClosed && !r.c.feesMissing; }) ? 'net' : 'gross'; }

  /* ---------- dashboard widgets ---------- */
  function tile(id, withStar) {
    var e = X.entry(id); if (!e) return ''; var fav = P.favorites.indexOf(id) >= 0;
    return '<div class="xtile"><button type="button" class="tile" data-go="' + id + '"><b>' + esc(e.title) + '</b><span>' + esc(e.text) + '</span></button>' + (withStar ? '<button type="button" class="xstar" data-fav="' + id + '" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Remove ' : 'Pin ') + esc(e.title) + (fav ? ' from' : ' to') + ' your dashboard" title="' + (fav ? 'Unpin' : 'Pin to dashboard') + '">' + ICON.star + '</button>' : '') + '</div>';
  }
  var W = {
    continue: function () { var v = P.lastView; if (!v || v === 'home') return ''; var e = X.entry(v); return e ? '<button type="button" class="cont-btn" data-go="' + v + '"><span><small>CONTINUE WHERE YOU LEFT OFF</small><b>' + esc(e.title) + '</b></span>' + ICON.arrow + '</button>' : ''; },
    actions: function () { return '<div class="qa"><button type="button" class="btn" data-xact="new-trade">+ LOG TRADE</button><button type="button" class="btn" data-go="calc">RISK CALC</button><button type="button" class="btn" data-xact="search">SEARCH</button><button type="button" class="btn" data-go="discipline">REFLECT</button></div>'; },
    today: function () {
      var t = todayKey(), n = S.rows.filter(function (r) { return r.t.date === t; }).length, max = S.plan && S.plan.maxTradesPerDay, note = P.goalDate === t ? P.goalNote : '';
      return '<h2>Today</h2><div class="xrow"><div class="ui-stat"><small>TRADES</small><b>' + n + '</b>' + (max ? '<em>plan allows ' + max + '</em>' : '') + '</div><div class="ui-stat"><small>REFLECTION</small><b>' + (S.refToday ? 'Saved' : '—') + '</b>' + (S.refToday ? '' : '<em><a href="#discipline" data-go="discipline">add one</a></em>') + '</div><div class="ui-stat"><small>PLAN</small><b>' + (S.plan ? 'Set' : '—') + '</b>' + (S.plan ? '' : '<em><a href="#discipline" data-go="discipline">write one</a></em>') + '</div></div>' +
        '<label for="focusIn" style="display:block;margin-top:12px;font-size:12px;letter-spacing:.14em;color:var(--muted);font-weight:700">TODAY\'S FOCUS (OPTIONAL)</label><input id="focusIn" class="xin" type="text" maxlength="140" placeholder="e.g. Only A-setups, stop at 2 losses" value="' + esc(note) + '" autocomplete="off">';
    },
    favorites: function () { var f = P.favorites; return '<h2>Favorites</h2>' + (f.length ? '<div class="xgrid">' + f.map(function (id) { return tile(id, true); }).join('') + '</div>' : '<p class="note" style="margin:0">Tap the star on any tool, in <a href="#more" data-go="more">More</a> or at the top of a screen, to pin it here.</p>'); },
    quickrisk: function () {
      var rc = P.recentCalc || {}, opts = INST.list.map(function (i) { return '<option value="' + i.id + '"' + ((rc.inst || INST.defaultId) === i.id ? ' selected' : '') + '>' + i.id + ' (' + i.label + '/pt)</option>'; }).join('');
      return '<h2>Quick risk</h2><div class="fgrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label for="qrInst" class="note" style="margin:0 0 4px;display:block">Contract</label><select id="qrInst" class="xin">' + opts + '</select></div><div><label for="qrStop" class="note" style="margin:0 0 4px;display:block">Stop (points)</label><input id="qrStop" class="xin" inputmode="decimal" autocomplete="off" placeholder="e.g. 12" value="' + esc(rc.stop || '') + '"></div></div><label for="qrRisk" class="note" style="margin:10px 0 4px;display:block">Most I will risk ($)</label><input id="qrRisk" class="xin" inputmode="decimal" autocomplete="off" placeholder="e.g. 300" value="' + esc(rc.risk || '') + '"><div class="qr-out" id="qrOut" aria-live="polite"></div>';
    },
    week: function () {
      var r = weekRange(), P2 = A.prepare(S.rows, { from: r.from, to: r.to }, basis()), s = A.summary(P2.inc);
      return '<h2>This week</h2>' + (s.n ? '<div class="xrow"><div class="ui-stat"><small>CLOSED</small><b>' + s.n + '</b></div><div class="ui-stat"><small>P&amp;L</small><b class="' + U.cls(s.totalCents) + '">' + C.fmtMoney(s.totalCents, true) + '</b></div><div class="ui-stat"><small>WIN RATE</small><b>' + (s.winRate * 100).toFixed(0) + '%</b></div></div><p class="note">' + (P2.basis === 'net' ? 'After fees.' : 'Before fees.') + ' ' + A.sampleLabel(s.n).replace(/^./, function (c) { return c.toUpperCase(); }) + ': a few trades say little. <a href="#analytics" data-go="analytics">Full analytics</a></p>' : '<p class="note" style="margin:0">No closed trades this week yet. This fills in from the trades you log.</p>');
    },
    recentTrades: function () {
      var rows = S.rows.slice().sort(function (a, b) { return (b.t.date + (b.t.time || '')).localeCompare(a.t.date + (a.t.time || '')) || b.t.createdAt - a.t.createdAt; }).slice(0, 3);
      return '<h2>Recent trades</h2>' + (rows.length ? '<ul class="rt-list">' + rows.map(function (r) { var res = r.c.isClosed ? (r.c.netCents != null ? r.c.netCents : r.c.grossCents) : null; return '<li><span>' + esc(r.t.date.slice(5)) + ' · ' + esc(r.t.side.toUpperCase()) + ' ' + r.t.contracts + ' × ' + esc(r.t.contract) + '</span><b class="' + (res == null ? '' : U.cls(res)) + '">' + (res == null ? 'Open' : C.fmtMoney(res, true)) + '</b></li>'; }).join('') + '</ul><button type="button" class="linkbtn" data-go="journal">Open journal</button>' : '<p class="note" style="margin:0">No trades yet. <a href="#journal" data-xact="new-trade">Log your first trade</a>.</p>');
    },
    recents: function () { var r = P.recents.filter(function (id) { return X.entry(id); }).slice(0, 4); return r.length ? '<h2>Recently used</h2><div class="chips">' + r.map(function (id) { return '<button type="button" class="chip" data-go="' + id + '">' + esc(title(id).toUpperCase()) + '</button>'; }).join('') + '</div>' : ''; },
    tools: function () { return '<h2>All tools</h2><div class="xgrid">' + X.prioritize(P).map(function (id) { return tile(id, true); }).join('') + '</div>'; },
    news: function () { var n = X.WHATS_NEW[0]; if (!n || n.id <= P.whatsNewSeen) return ''; return '<div class="wd-head"><h2>What\'s new</h2><button type="button" class="linkbtn" data-xact="dismiss-news">Dismiss</button></div><h3 style="margin:0 0 4px;font-size:16px">' + esc(n.title) + '</h3><ul style="margin:6px 0 10px;padding-left:20px;color:var(--muted);line-height:1.5">' + n.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' + (n.features || []).map(function (id) { return REG.byId(id); }).filter(function (f) { return f && f.kind === 'screen'; }).slice(0, 2).map(function (f) { return '<button type="button" class="btn ghost" style="margin:0 8px 8px 0" data-xact="ftour" data-f="' + esc(f.id) + '">TRY: ' + esc(f.title.toUpperCase()) + '</button>'; }).join('') + '<br><button type="button" class="linkbtn" data-go="help">More in Help</button>'; }
  };
  var STATIC = { pnl: 1, sessions: 1, next: 1 };
  function buildWidgets() {
    var host = $('#homeWidgets'); if (!host) return;
    var old = {}; $$('[data-widget]', host).forEach(function (el) { old[el.getAttribute('data-widget')] = el; });
    // Real-data widgets need data; render them from what is loaded and refresh when it arrives.
    P.widgets.forEach(function (w) {
      var el = old[w.id];
      if (!STATIC[w.id]) { var html = W[w.id] ? W[w.id]() : ''; if (!el) { el = document.createElement('div'); el.setAttribute('data-widget', w.id); el.className = (w.id === 'continue' || w.id === 'actions') ? '' : 'panel'; host.appendChild(el); } el.innerHTML = html; el.hidden = !w.visible || !html; if (w.id === 'continue' || w.id === 'actions') el.style.marginBottom = html ? '14px' : '0'; }
      else if (el) el.hidden = !w.visible;
      if (el) host.appendChild(el);          // appendChild moves it, which applies the saved order
    });
    updateQuickRisk(); renderCustomize();
  }
  function renderCustomize() {
    var cp = $('#customPanel'), btn = $('#customizeBtn'); if (btn) { btn.setAttribute('aria-expanded', S.customizing); btn.textContent = S.customizing ? 'DONE' : 'CUSTOMIZE'; }
    if (!cp) return; cp.hidden = !S.customizing; if (!S.customizing) { cp.innerHTML = ''; return; }
    var lab = {}; X.WIDGETS.forEach(function (w) { lab[w.id] = w.label; });
    cp.innerHTML = '<h2>Customize your dashboard</h2><p class="note" style="margin-top:0">Show or hide sections and move them up or down. Nothing is deleted; hidden tools stay one search away.</p>' + P.widgets.map(function (w, i) { return '<div class="custom-row"><label><input type="checkbox" data-wvis="' + w.id + '"' + (w.visible ? ' checked' : '') + '> ' + esc(lab[w.id]) + '</label><button type="button" class="btn ghost" data-wmove="' + w.id + '" data-d="-1" aria-label="Move ' + esc(lab[w.id]) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button type="button" class="btn ghost" data-wmove="' + w.id + '" data-d="1" aria-label="Move ' + esc(lab[w.id]) + ' down"' + (i === P.widgets.length - 1 ? ' disabled' : '') + '>↓</button></div>'; }).join('') + '<div class="xact"><button type="button" class="btn ghost" data-xact="reset-layout">RESET TO DEFAULT</button><button type="button" class="btn" data-xact="customize">DONE</button></div>';
  }
  function updateQuickRisk() {
    var out = $('#qrOut'); if (!out) return; var inst = INST.byId[$('#qrInst').value], stop = $('#qrStop').value.trim(), risk = $('#qrRisk').value.replace(/[$,\s]/g, '');
    var ok = /^\d+(\.\d{1,2})?$/.test(stop) && parseFloat(stop) > 0 && /^\d+(\.\d{1,2})?$/.test(risk) && parseFloat(risk) > 0;
    if (!stop && !risk) { out.innerHTML = '<span class="note" style="margin:0">Enter a stop and your maximum risk.</span>'; return; }
    if (!ok) { out.innerHTML = '<span class="note" style="margin:0">Use plain numbers, for example 12 and 300.</span>'; return; }
    var pts100 = Math.round(parseFloat(stop) * 100), riskC = Math.round(parseFloat(risk) * 100), per100 = pts100 * inst.centsPerPoint, n = Math.floor(riskC * 100 / per100), cap = Math.min(n, 500);
    var txt = cap + ' ' + inst.id + ' · stop ' + stop + ' pts · risk $' + (cap * per100 / 10000).toFixed(2);
    out.innerHTML = cap < 1 ? '<span class="note" style="margin:0">One contract risks $' + (per100 / 10000).toFixed(2) + ', more than your $' + parseFloat(risk).toFixed(2) + '. No contracts fit.</span>' : '<b>' + cap + ' ' + (cap === 1 ? 'contract' : 'contracts') + '</b><div class="note" style="margin:4px 0 8px">Risk $' + (cap * per100 / 10000).toFixed(2) + ' · $' + (per100 / 10000).toFixed(2) + ' per contract' + (n > 500 ? ' · capped at 500' : '') + '</div><button type="button" class="btn ghost sm" data-copy="' + esc(txt) + '">COPY RESULT</button>';
    P.recentCalc = { inst: inst.id, stop: stop, risk: risk, entry: '' }; persist();
  }
  function copyText(t) {
    var done = function () { toast('Copied.'); }, fail = function () { toast('Could not copy. Select the text and copy it manually.', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { legacyCopy(t) ? done() : fail(); }); else legacyCopy(t) ? done() : fail();
  }
  function legacyCopy(t) { try { var a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); var ok = document.execCommand('copy'); a.remove(); return ok; } catch (e) { return false; } }
  function renderGreeting() {
    var g = X.greeting(P.name, new Date(), P.lastSeen), h1 = $('#displayName'), sm = $('#view-home .welcome small');
    if (h1) h1.textContent = g.line; if (sm) sm.textContent = g.sub.split('.')[0].toUpperCase();
    var sub = $('#greetSub'); if (sub) sub.textContent = g.sub.split('. ').slice(1).join('. ').replace(/\.$/, '') + '.';
  }
  function ensureHomeHead() {
    var wel = $('#view-home .welcome'); if (!wel || $('#customizeBtn')) return;
    var row = document.createElement('div'); row.className = 'home-head'; wel.parentNode.insertBefore(row, wel); row.appendChild(wel);
    var b = document.createElement('button'); b.type = 'button'; b.id = 'customizeBtn'; b.className = 'btn ghost sm'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('data-xact', 'customize'); b.textContent = 'CUSTOMIZE'; row.appendChild(b);
    var sub = document.createElement('p'); sub.id = 'greetSub'; sub.className = 'note'; sub.style.margin = '-10px 2px 12px'; row.parentNode.insertBefore(sub, row.nextSibling);
    var cp = document.createElement('div'); cp.id = 'customPanel'; cp.className = 'panel custom-panel'; cp.hidden = true; sub.parentNode.insertBefore(cp, sub.nextSibling);
  }

  /* ---------- search palette ---------- */
  var searchOv = null;
  function openSearch(prefill) {
    if (searchOv) return; var sel = 0, res = [];
    searchOv = overlay('xs-wrap', '<div class="xs"><input id="xsIn" type="text" role="combobox" aria-expanded="true" aria-controls="xsList" aria-autocomplete="list" aria-label="Search tools, actions and settings" placeholder="Search tools, actions and settings…" autocomplete="off" spellcheck="false"><ul id="xsList" role="listbox" aria-label="Results"></ul><div class="foot"><span><kbd class="kbd">↑</kbd> <kbd class="kbd">↓</kbd> move</span><span><kbd class="kbd">Enter</kbd> open</span><span><kbd class="kbd">Esc</kbd> close</span></div></div>', { label: 'Search', onClose: function () { searchOv = null; } });
    var inp = $('#xsIn', searchOv.el), list = $('#xsList', searchOv.el); inp.value = prefill || '';
    function draw() {
      res = X.search(inp.value, 8, P.favorites); if (sel >= res.length) sel = 0;
      list.innerHTML = res.length ? res.map(function (r, i) { return '<li role="option" id="xs' + i + '" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span><b>' + esc(r.title) + '</b><span class="d">' + esc(r.text) + '</span></span><span class="kind">' + (r.kind === 'action' ? 'Action' : 'Open') + '</span></li>'; }).join('') : '<li class="none" role="presentation">Nothing matches “' + esc(inp.value) + '”. Try a different word, like risk, journal or backup.</li>';
      inp.setAttribute('aria-activedescendant', res.length ? 'xs' + sel : '');
    }
    function pick(i) { var r = res[i]; if (!r) return; searchOv.close('pick'); run(r); }
    inp.addEventListener('input', function () { sel = 0; draw(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(res.length - 1, sel + 1); draw(); scrollSel(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); scrollSel(); } else if (e.key === 'Enter') { e.preventDefault(); pick(sel); } });
    function scrollSel() { var el = $('#xs' + sel, list); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    list.addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) pick(+li.getAttribute('data-i')); });
    searchOv.el.addEventListener('mousedown', function (e) { if (e.target === searchOv.el) searchOv.close('bg'); });
    draw(); inp.focus(); inp.select();
  }
  function waitFor(sel, fn, ms) { var t = Date.now(); (function poll() { var el = $(sel); if (el) { fn(el); return; } if (Date.now() - t < (ms || 2500)) setTimeout(poll, 60); })(); }
  function scrollTo(sel) { waitFor(sel, function (el) { el.scrollIntoView({ block: 'center' }); if (el.focus) try { el.focus({ preventScroll: true }); } catch (e) {} }); }
  function openNewTrade() { var t = $('#view-journal [data-act=tab][data-tab=entries]'); if (t && !$('#view-journal [data-act=new]')) t.click(); waitFor('#view-journal [data-act=new]', function (b) { b.click(); }); }
  function run(item) {
    go(item.view);
    if (item.kind !== 'action') return;
    var a = item.act;
    if (a === 'new-trade') openNewTrade();
    else if (a === 'focus-name') scrollTo('#nameInput'); else if (a === 'theme') scrollTo('#themePick'); else if (a === 'personalize') scrollTo('#personalizePanel'); else if (a === 'sessions') scrollTo('#sessionEditor');
    else if (a === 'tour') startTour(); else if (a === 'customize') { S.customizing = true; renderCustomize(); setTimeout(function () { var c = $('#customPanel'); if (c) c.scrollIntoView({ block: 'center' }); }, 50); }
    else if (a === 'backup') waitFor('#view-journal [data-act=tab][data-tab=backup]', function (b) { b.click(); }); else if (a === 'whatsnew') scrollTo('#hpNew'); else if (a === 'shortcuts') scrollTo('#hpKeys');
    else if (a === 'report' && window.TTSupport) window.TTSupport.openReport(); else if (a === 'copilot' && window.TTCopilotBoot) window.TTCopilotBoot.open();
  }

  /* ---------- welcome and tour ---------- */
  var obOv = null;
  function startWelcome() {
    if (obOv) return; var step = 0, name = P.name, picks = P.interests.slice();
    function view() {
      var dots = '<div class="xdots" aria-hidden="true">' + [0, 1, 2, 3].map(function (i) { return '<i class="' + (i === step ? 'on' : '') + '"></i>'; }).join('') + '</div>', note = '<p class="xnote">Saved on this device only. No account needed.</p>';
      if (step === 0) return '<div class="xcard"><svg class="logo" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2de2ff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><path d="M24 3l18 10.5v21L24 45 6 34.5v-21z" fill="rgba(10,18,44,.8)" stroke="url(#lg2)" stroke-width="2"/><path d="M15 17h18M24 17v15" stroke="url(#lg2)" stroke-width="3.2" stroke-linecap="round" fill="none"/><path d="M13 31l6-5 4 3 8-9" stroke="#2de2ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><small class="k">WELCOME TO</small><h2>Tamhas Trading</h2><p>Your private futures trading workspace: size positions, journal every trade, track prop-firm accounts and see what your own results say.</p><label for="obName" style="display:block;font-size:12px;letter-spacing:.14em;color:var(--muted);font-weight:700;margin-bottom:6px">WHAT SHOULD WE CALL YOU?</label><input id="obName" class="xin" type="text" maxlength="24" autocomplete="given-name" placeholder="First name" value="' + esc(name) + '"><div class="xact"><button type="button" class="btn" id="obNext">CONTINUE</button></div><button type="button" class="xskip" id="obSkip">Skip for now</button>' + dots + note + '</div>';
      if (step === 1) return '<div class="xcard"><small class="k">QUICK INTRO</small><h2>What you can do here</h2><ul class="xlist"><li>Work out how many contracts fit your risk</li><li>Log trades and see win rate, drawdown and more</li><li>Track prop-firm accounts, fees and payouts</li><li>Build a plan, checklists and daily reflections</li><li>Everything works offline and stays on your device</li></ul><div class="xact"><button type="button" class="btn ghost" id="obBack">BACK</button><button type="button" class="btn" id="obNext">NEXT</button></div><button type="button" class="xskip" id="obSkip2">Skip the intro</button>' + dots + note + '</div>';
      if (step === 2) return '<div class="xcard"><small class="k">YOUR FOCUS</small><h2>What matters most?</h2><p>Pick any. We will put those tools first. You can change this in Settings.</p><div class="chips" role="group" aria-label="Interests">' + X.INTERESTS.map(function (i) { return '<button type="button" class="chip' + (picks.indexOf(i.id) >= 0 ? ' on' : '') + '" data-pick="' + i.id + '" aria-pressed="' + (picks.indexOf(i.id) >= 0) + '">' + esc(i.label.toUpperCase()) + '</button>'; }).join('') + '</div><div class="xact"><button type="button" class="btn ghost" id="obBack">BACK</button><button type="button" class="btn" id="obNext">NEXT</button></div>' + dots + note + '</div>';
      return '<div class="xcard"><small class="k">ALL SET' + (name ? ', ' + esc(name.toUpperCase()) : '') + '</small><h2>Want a 1-minute tour?</h2><p>A quick look at the dashboard, calculator, journal and search. You can skip it now and replay it anytime from Help or Settings.</p><div class="xact"><button type="button" class="btn" id="obTour">TAKE THE TOUR</button><button type="button" class="btn ghost" id="obDone">START EXPLORING</button></div>' + dots + note + '</div>';
    }
    function finish(tour) { P.name = X.cleanName(name); P.interests = picks; P.onboarded = true; persist(); obOv.close('done'); afterProfile(); if (tour) startTour(); }
    function draw() { obOv.el.innerHTML = view(); var b = obOv.el.firstElementChild; b.setAttribute('role', 'dialog'); b.setAttribute('aria-modal', 'true'); b.setAttribute('aria-label', 'Welcome'); obOv.box = b; var f = $('#obName', b) || $('#obNext', b) || $('#obTour', b); if (f) f.focus(); }
    obOv = overlay('', view(), { label: 'Welcome', onClose: function (r) { obOv = null; if (r === 'esc') { P.onboarded = true; P.name = X.cleanName(name); persist(); afterProfile(); } } }); draw();
    obOv.el.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return; var nm = $('#obName', obOv.el); if (nm) name = nm.value;
      if (t.id === 'obNext') { step++; draw(); } else if (t.id === 'obBack') { step--; draw(); } else if (t.id === 'obSkip') finish(false); else if (t.id === 'obSkip2') { step = 2; draw(); }
      else if (t.id === 'obTour') finish(true); else if (t.id === 'obDone') finish(false);
      else if (t.getAttribute('data-pick')) { var id = t.getAttribute('data-pick'), i = picks.indexOf(id); if (i >= 0) picks.splice(i, 1); else picks.push(id); draw(); var again = $('[data-pick="' + id + '"]', obOv.el); if (again) again.focus(); }
    });
    obOv.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'obName') { e.preventDefault(); name = e.target.value; step = 1; draw(); } });
  }
  var tourEl = null, tourStep = 0, tourSteps = [], tourMeta = {};
  function clearRing() { $$('.tour-ring').forEach(function (e) { e.classList.remove('tour-ring'); }); }
  function runTour(steps, meta) { if (!steps || !steps.length) return false; tourSteps = steps; tourMeta = meta || {}; tourStep = 0; drawTour(); return true; }
  function startTour() { return runTour(X.TOUR.map(function (t) { return { view: t.view, ring: t.ring || (t.view === 'home' ? '#customizeBtn' : ''), title: t.title, text: t.text }; }), { main: true }); }
  // A short tour for one feature, built from the registry. Remembered in P.toursSeen so it is offered once, then available any time.
  function featureTour(id) {
    var f = REG && REG.byId(id); if (!f || !f.tour || !f.tour.length) { toast('There is no tour for that yet.', true); return false; }
    var v = f.virtual ? 'home' : f.view; if (tourEl) endTour(false);
    return runTour(f.tour.map(function (t) { return { view: v, ring: t.target, title: t.title, text: t.text }; }), { feature: id });
  }
  function markToured(id) { if (id && P.toursSeen.indexOf(id) < 0) { P.toursSeen = P.toursSeen.concat([id]); persist(); } }
  function endTour(done) { clearRing(); if (tourEl) { tourEl.remove(); tourEl = null; } if (tourMeta.main) P.tourSeen = true; if (tourMeta.feature) markToured(tourMeta.feature); persist(); if (done) toast(tourMeta.feature ? 'Tour finished. Replay it any time from Help.' : 'Tour finished. Replay it anytime from Help or Settings.'); tourMeta = {}; }
  function drawTour() {
    var s = tourSteps[tourStep]; if (!s) { endTour(true); return; } if (s.view) go(s.view); clearRing();
    if (s.ring) waitFor(s.ring, function (el) { if (!tourEl) return; clearRing(); el.classList.add('tour-ring'); try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }, 1500);
    if (!tourEl) { tourEl = document.createElement('div'); tourEl.className = 'coach'; tourEl.setAttribute('role', 'dialog'); tourEl.setAttribute('aria-label', 'Tour'); document.body.appendChild(tourEl); tourEl.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.id === 'tNext') { tourStep++; drawTour(); } else if (b.id === 'tBack') { tourStep--; drawTour(); } else if (b.id === 'tSkip') endTour(false); }); tourEl.addEventListener('keydown', function (e) { if (e.key === 'Escape') endTour(false); }); }
    var last = tourStep === tourSteps.length - 1;
    tourEl.innerHTML = '<small>STEP ' + (tourStep + 1) + ' OF ' + tourSteps.length + '</small><h3>' + esc(s.title) + '</h3><p>' + esc(s.text) + '</p><div class="xact">' + (tourStep ? '<button type="button" class="btn ghost" id="tBack">BACK</button>' : '') + '<button type="button" class="btn ghost" id="tSkip">SKIP</button><button type="button" class="btn" id="tNext">' + (last ? 'FINISH' : 'NEXT') + '</button></div>'; $('#tNext', tourEl).focus();
  }

  /* ---------- screens: back bar, star, hub, settings, help ---------- */
  function addBackBars() {
    $$('.view').forEach(function (v) {
      var id = v.id.replace('view-', ''); if (id === 'home' || $('.backbar', v)) return; var inMore = N.parents && N.parents[id] === 'more' && id !== 'more';
      var bar = document.createElement('div'); bar.className = 'backbar'; bar.innerHTML = '<span><button type="button" class="linkbtn" data-go="home">‹ Dashboard</button>' + (inMore ? ' <button type="button" class="linkbtn" data-go="more">· More</button>' : '') + '</span>' + (X.entry(id) && id !== 'settings' && id !== 'help' ? '<button type="button" class="starbtn" data-fav="' + id + '" aria-pressed="false">' + ICON.star + '<span>PIN</span></button>' : ''); v.insertBefore(bar, v.firstChild);
    }); syncStars();
  }
  function syncStars() { $$('.starbtn[data-fav]').forEach(function (b) { var on = P.favorites.indexOf(b.getAttribute('data-fav')) >= 0; b.setAttribute('aria-pressed', on); b.lastElementChild.textContent = on ? 'PINNED' : 'PIN'; b.setAttribute('aria-label', (on ? 'Unpin ' : 'Pin ') + title(b.getAttribute('data-fav')) + (on ? ' from' : ' to') + ' your dashboard'); }); $$('.xstar[data-fav]').forEach(function (b) { b.setAttribute('aria-pressed', P.favorites.indexOf(b.getAttribute('data-fav')) >= 0); }); }
  function toggleFav(id) {
    var before = P.favorites.slice(), r = X.toggleFavorite(P.favorites, id);
    if (r.full) { toast('You can pin up to ' + X.MAX_FAV + '. Unpin one first.', true); return; } if (!r.changed) return;
    P.favorites = r.list; persist(); refreshAll(); toast((r.added ? 'Pinned ' : 'Unpinned ') + title(id) + '.', false, { label: 'UNDO', fn: function () { P.favorites = before; persist(); refreshAll(); } });
  }
  function renderHub() {
    var el = $('#hubRoot'); if (!el) return; var by = {}; X.CATALOG.forEach(function (c) { if (c.id !== 'home' && $('#view-' + c.id)) (by[c.cat] = by[c.cat] || []).push(c.id); });
    el.className = ''; el.innerHTML = '<button type="button" class="tile" data-xact="search" style="width:100%;margin-bottom:6px"><b>Search everything</b><span>Find any tool, action or setting. Press Ctrl or Cmd + K anywhere.</span></button>' + X.CATS.filter(function (c) { return by[c[0]]; }).map(function (c) { return '<div class="cat-h">' + esc(c[1]) + '</div><div class="xgrid">' + by[c[0]].map(function (id) { return tile(id, id !== 'settings' && id !== 'help'); }).join('') + '</div>'; }).join('');
  }
  function renderSettings() {
    var v = $('#view-settings'); if (!v) return; var host = $('#personalizePanel'); if (!host) { host = document.createElement('div'); host.id = 'personalizePanel'; host.className = 'panel'; var after = $('#nameInput', v).closest('.panel'); after.parentNode.insertBefore(host, after.nextSibling); host.addEventListener('click', onSettingsClick); host.addEventListener('change', onSettingsChange); }
    var sp = '<option value="home"' + (P.startPage === 'home' ? ' selected' : '') + '>Dashboard</option><option value="last"' + (P.startPage === 'last' ? ' selected' : '') + '>Where I left off</option>' + X.CATALOG.filter(function (c) { return c.id !== 'home' && c.id !== 'settings'; }).map(function (c) { return '<option value="' + c.id + '"' + (P.startPage === c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>'; }).join('');
    var ni0 = $('#nameInput'); if (ni0 && document.activeElement !== ni0) ni0.value = P.name;
    host.innerHTML = '<h2>Personalize</h2><p class="note" style="margin-top:0">Saved on this device only, included in your backups. No account and nothing is synced anywhere.</p><div class="note" style="margin:0 0 6px">I care most about</div><div class="chips" role="group" aria-label="Interests">' + X.INTERESTS.map(function (i) { return '<button type="button" class="chip' + (P.interests.indexOf(i.id) >= 0 ? ' on' : '') + '" data-int="' + i.id + '" aria-pressed="' + (P.interests.indexOf(i.id) >= 0) + '">' + esc(i.label.toUpperCase()) + '</button>'; }).join('') + '</div>' +
      '<label for="startSel" style="display:block;margin-top:14px">Open this screen first</label><select id="startSel" class="xin">' + sp + '</select><div class="note" style="margin:14px 0 6px">Layout</div><div class="ui-tabs" role="radiogroup" aria-label="Layout density"><button type="button" role="radio" aria-checked="' + (P.density === 'comfortable') + '" class="' + (P.density === 'comfortable' ? 'on' : '') + '" data-dens="comfortable">Comfortable</button><button type="button" role="radio" aria-checked="' + (P.density === 'compact') + '" class="' + (P.density === 'compact' ? 'on' : '') + '" data-dens="compact">Compact</button></div>' +
      '<div class="xact" style="margin-top:16px"><button type="button" class="btn ghost" data-xact="tour">REPLAY WELCOME TOUR</button><button type="button" class="btn ghost" data-xact="reset-all">RESET PERSONALIZATION</button></div>';
  }
  function onSettingsClick(e) {
    var b = e.target.closest('button'); if (!b) return; var before = JSON.stringify(P);
    if (b.getAttribute('data-int')) { var id = b.getAttribute('data-int'), i = P.interests.indexOf(id); if (i >= 0) P.interests.splice(i, 1); else P.interests.push(id); persist(); afterProfile(); }
    else if (b.getAttribute('data-dens')) { P.density = b.getAttribute('data-dens'); persist(); applyDensity(); renderSettings(); }
  }
  function onSettingsChange(e) { if (e.target.id === 'startSel') { P.startPage = e.target.value; persist(); toast('Saved.'); } }
  function resetAll() {
    U.confirm('Reset personalization?', 'Clears your name, interests, favorites, layout and start page on this device. Your trades and other data are not touched.', 'RESET', true).then(function (y) {
      if (!y) return; var before = JSON.stringify(P); P = X.defaults(); P.onboarded = true; persist(); applyDensity(); afterProfile();
      toast('Personalization reset.', false, { label: 'UNDO', fn: function () { P = X.cleanPrefs(JSON.parse(before)); persist(); applyDensity(); afterProfile(); } });
    });
  }
  function newBadge(f) { return f.since > P.whatsNewSeen && P.toursSeen.indexOf(f.id) < 0 ? ' <span class="xnew">NEW</span>' : ''; }
  function guideHtml(f) {
    var h = f.help || {}, hasTour = f.tour && f.tour.length;
    return '<details id="hp-' + esc(f.id) + '"><summary>' + esc(f.title) + newBadge(f) + '</summary><p>' + esc(h.summary || f.text) + '</p>' +
      (h.how && h.how.length ? '<ol>' + h.how.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') +
      (h.faq && h.faq.length ? h.faq.map(function (q) { return '<p><b>' + esc(q.q) + '</b><br>' + esc(q.a) + '</p>'; }).join('') : '') +
      '<div class="xact">' + (hasTour ? '<button type="button" class="btn ghost" data-xact="ftour" data-f="' + esc(f.id) + '">TEACH ME THIS</button>' : '') + (f.virtual ? '<button type="button" class="btn ghost" data-xact="copilot">OPEN COPILOT</button>' : '<button type="button" class="btn ghost" data-go="' + esc(f.view) + '">OPEN</button>') + '</div></details>';
  }
  function releaseHtml(n, i) {
    var fl = (n.features || []).map(function (id) { return REG.byId(id); }).filter(function (f) { return f && f.kind === 'screen'; });
    return '<h3>' + esc(n.title) + (n.id > P.whatsNewSeen ? ' <span class="xnew">NEW</span>' : '') + '</h3><small>Version ' + esc(n.version) + ' · ' + esc(n.date) + '</small><ul>' + n.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      (n.fixes && n.fixes.length ? '<p class="note" style="margin:4px 0 2px"><b>Fixed</b></p><ul>' + n.fixes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      (fl.length ? '<div class="xact">' + fl.map(function (f) { return '<button type="button" class="btn ghost" data-xact="ftour" data-f="' + esc(f.id) + '">TRY: ' + esc(f.title.toUpperCase()) + '</button>'; }).join('') + '</div>' : '');
  }
  function renderHelp() {
    var h = $('#hpRoot'); if (!h) return;
    var screens = REG.screens();
    h.innerHTML = '<div class="panel"><h2>Getting around</h2><p class="note" style="margin-top:0">Press <kbd class="kbd">Ctrl</kbd>/<kbd class="kbd">Cmd</kbd> + <kbd class="kbd">K</kbd> or tap the magnifier at the top to find any tool or setting.</p><div class="xact" style="margin-top:8px"><button type="button" class="btn" data-xact="tour">REPLAY WELCOME TOUR</button><button type="button" class="btn ghost" data-xact="search">SEARCH</button><button type="button" class="btn ghost" data-xact="copilot">ASK COPILOT</button></div></div>' +
      '<div class="panel nw" id="hpNew"><h2>What\'s new</h2>' + X.WHATS_NEW.map(releaseHtml).join('<hr class="xhr">') + '</div>' +
      '<div class="panel gl" id="hpGuides"><h2>Feature guides</h2><p class="note" style="margin-top:0">Every tool, explained. Tap one to read it or take a short tour.</p>' + screens.map(guideHtml).join('') + '</div>' +
      '<div class="panel gl"><h2>Plain-language glossary</h2>' + X.GLOSSARY.map(function (g) { return '<details><summary>' + esc(g.term) + '</summary><p>' + esc(g.text) + '</p></details>'; }).join('') + '</div>' +
      '<div class="panel" id="hpKeys"><h2>Keyboard shortcuts</h2><table class="sc-table">' + X.SHORTCUTS.map(function (s) { return '<tr><td><kbd class="kbd">' + esc(s[0]) + '</kbd></td><td>' + esc(s[1]) + '</td></tr>'; }).join('') + '</table></div>' +
      '<div class="panel"><h2>Your data and this app</h2><p class="note" style="margin:0">Everything is saved in this browser on this device only. Use Journal → Backup to download a copy, and System health to check your data. Tamhas Trading does not give financial advice.</p><p class="note">Version ' + esc(REG.APP_VERSION) + '.</p><div class="xact"><button type="button" class="btn ghost" data-xact="report">REPORT A PROBLEM</button></div></div>';
  }
  function syncDot() {
    var unseen = X.WHATS_NEW[0] && P.whatsNewSeen < X.WHATS_NEW[0].id;
    $$('.nav [data-view=more]').forEach(function (b) { var d = b.querySelector('.nav-dot'); if (unseen && !d) { d = document.createElement('i'); d.className = 'nav-dot'; d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'New updates'); b.appendChild(d); } else if (!unseen && d) d.remove(); });
    $$('[data-go=help]', $('#hubRoot') || document.createElement('div')).forEach(function (b) { var d = b.querySelector('.xnew'); if (unseen && !d) { d = document.createElement('span'); d.className = 'xnew'; d.textContent = 'NEW'; b.appendChild(d); } else if (!unseen && d) d.remove(); });
  }
  function markNewsSeen() { if (X.WHATS_NEW[0] && P.whatsNewSeen < X.WHATS_NEW[0].id) { P.whatsNewSeen = X.WHATS_NEW[0].id; persist(); buildWidgets(); syncDot(); } }

  /* ---------- calculator niceties: remember last inputs, reset, copy, hints ---------- */
  function enhanceCalc() {
    var stop = $('#stop'), mn = $('#minRisk'), mx = $('#maxRisk'); if (!stop || $('#calcReset')) return;
    var last = null; try { last = JSON.parse(localStorage.getItem(CALC_KEY) || 'null'); } catch (e) {}
    function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    if (last && typeof last === 'object') { [[stop, 'stop'], [mn, 'min'], [mx, 'max']].forEach(function (p) { if (typeof last[p[1]] === 'string' && last[p[1]].length < 14 && !p[0].value) { p[0].value = last[p[1]]; fire(p[0]); } }); }
    var save = function () { try { localStorage.setItem(CALC_KEY, JSON.stringify({ stop: stop.value, min: mn.value, max: mx.value })); } catch (e) {} };
    [stop, mn, mx].forEach(function (el) { el.addEventListener('input', save); });
    var card = $('#resultCard'), row = document.createElement('div'); row.className = 'xact'; row.style.margin = '0 0 14px';
    row.innerHTML = '<button type="button" class="btn ghost" id="calcCopy">COPY RESULT</button><button type="button" class="btn ghost" id="calcReset">CLEAR INPUTS</button>'; card.parentNode.insertBefore(row, card.nextSibling);
    $('#calcCopy').addEventListener('click', function () { var main = $('#resultMain').innerText.replace(/\s+/g, ' ').trim(), per = $('#perContract').innerText, tot = $('#totalRisk').innerText; if (/^enter/i.test(main) || !main) { toast('Nothing to copy yet. Enter your stop and risk range.', true); return; } copyText($('#instrument').value + ' · stop ' + stop.value + ' pts · ' + main + ' · risk/contract ' + per + ' · total risk ' + tot); });
    $('#calcReset').addEventListener('click', function () { var b = [stop.value, mn.value, mx.value]; stop.value = mn.value = mx.value = ''; fire(stop); save(); toast('Inputs cleared.', false, { label: 'UNDO', fn: function () { stop.value = b[0]; mn.value = b[1]; mx.value = b[2]; fire(stop); save(); } }); });
    var tips = { stop: 'How far your stop-loss is from your entry, in index points.', minRisk: 'The smallest dollar loss you are willing to size for. Optional context for your range.', maxRisk: 'The most you are willing to lose if the stop is hit. The result never goes above this.' };
    Object.keys(tips).forEach(function (id) { var l = $('label[for=' + id + ']'); if (l && !l.querySelector('[data-tip]')) { var q = document.createElement('button'); q.type = 'button'; q.className = 'linkbtn'; q.setAttribute('data-tip', tips[id]); q.setAttribute('aria-label', 'What is this?'); q.style.cssText = 'margin-left:6px;padding:0 6px;min-height:24px;border:1px solid var(--line);border-radius:50%;font-size:12px'; q.textContent = '?'; l.appendChild(q); } });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-xact],[data-fav],[data-copy],[data-wmove]'); if (!t) return;
    if (t.hasAttribute('data-fav')) { e.preventDefault(); toggleFav(t.getAttribute('data-fav')); return; }
    if (t.hasAttribute('data-copy')) { copyText(t.getAttribute('data-copy')); return; }
    if (t.hasAttribute('data-wmove')) { P.widgets = X.moveWidget(P.widgets, t.getAttribute('data-wmove'), +t.getAttribute('data-d')); persist(); buildWidgets(); var again = $('[data-wmove="' + t.getAttribute('data-wmove') + '"][data-d="' + t.getAttribute('data-d') + '"]'); if (again && !again.disabled) again.focus(); return; }
    var a = t.getAttribute('data-xact'); e.preventDefault();
    if (a === 'search') openSearch(); else if (a === 'tour') { if (obOv) return; go('home'); startTour(); } else if (a === 'new-trade') { go('journal'); openNewTrade(); }
    else if (a === 'customize') { S.customizing = !S.customizing; renderCustomize(); if (S.customizing) { var c = $('#customPanel'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' }); } }
    else if (a === 'reset-layout') { var wb = JSON.stringify(P.widgets); P.widgets = X.defaults().widgets; persist(); buildWidgets(); toast('Dashboard reset to default.', false, { label: 'UNDO', fn: function () { P.widgets = JSON.parse(wb); persist(); buildWidgets(); } }); }
    else if (a === 'dismiss-news') { P.whatsNewSeen = X.WHATS_NEW[0].id; persist(); buildWidgets(); }
    else if (a === 'reset-all') resetAll();
    else if (a === 'ftour') featureTour(t.getAttribute('data-f')); else if (a === 'report' && window.TTSupport) window.TTSupport.openReport();
    else if (a === 'copilot' && window.TTCopilotBoot) window.TTCopilotBoot.open();
  });
  document.addEventListener('change', function (e) {
    var w = e.target.getAttribute && e.target.getAttribute('data-wvis'); if (w) { P.widgets = P.widgets.map(function (x) { return x.id === w ? { id: x.id, visible: e.target.checked } : x; }); persist(); buildWidgets(); var again = $('[data-wvis="' + w + '"]'); if (again) again.focus(); return; }
    if (e.target.id === 'focusIn') { P.goalNote = e.target.value; P.goalDate = e.target.value.trim() ? todayKey() : ''; persist(); }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'qrInst' || e.target.id === 'qrStop' || e.target.id === 'qrRisk') updateQuickRisk(); });
  var sb = $('#searchBtn'); if (sb) sb.addEventListener('click', function () { openSearch(); });
  var gPending = 0;
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable, k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); if (searchOv) searchOv.close('toggle'); else openSearch(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || searchOv || obOv || document.querySelector('.ui-dlg-back')) return;
    if (k === '/') { e.preventDefault(); openSearch(); } else if (k === '?') { e.preventDefault(); go('help'); scrollTo('#hpKeys'); }
    else if (k === 'n') { go('journal'); openNewTrade(); }
    else if (k === 'g') { gPending = Date.now(); }
    else if (gPending && Date.now() - gPending < 1200) { var m = { h: 'home', j: 'journal', r: 'calc', a: 'analytics', s: 'settings' }[k]; gPending = 0; if (m) go(m); }
  });
  window.addEventListener('tt:view', function (e) {
    var n = e.detail.name; S.cur = n; syncStars();
    if (X.entry(n) && n !== 'home') { P.recents = X.pushRecent(P.recents, n); P.lastView = n; persist(); }
    if (n === 'home') { renderGreeting(); loadData().then(buildWidgets); }
    if (n === 'more') renderHub(); if (n === 'settings') renderSettings(); if (n === 'help') { renderHelp(); setTimeout(function () { if (S.cur === 'help') { markNewsSeen(); } }, 1500); }
    syncDot();
  });
  window.addEventListener('tt:journal-changed', function () { if (S.cur === 'home') loadData().then(buildWidgets); });
  var nameSave = $('#saveName'); if (nameSave) nameSave.addEventListener('click', function () { var v = X.cleanName($('#nameInput').value); P.name = v.toLowerCase() === 'trader' ? '' : v; persist(); renderGreeting(); });
  window.addEventListener('pagehide', function () { P.lastSeen = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(X.cleanPrefs(P))); } catch (e) {} });

  // Existing users get ONE quiet pointer per release (never the full onboarding again). Skipping it loses nothing: the dot on More stays until What's New is opened.
  function nudgeRelease() {
    var rel = X.WHATS_NEW[0]; if (!rel || P.whatsNewSeen >= rel.id) return; var key = 'tt.nw.nudged', last = 0;
    try { last = +localStorage.getItem(key) || 0; } catch (e) {} if (last >= rel.id) return;
    var tries = 0; (function later() { setTimeout(function () { var tt = document.querySelector('.ui-toast.show'); if (obOv || searchOv || tourEl || document.getElementById('copilotPanel') || tt || document.querySelector('.ui-dlg-back, .xo')) { if (++tries < 4) later(); return; } try { localStorage.setItem(key, String(rel.id)); } catch (e) {} toast('New in version ' + rel.version + ': ' + rel.title + '.', false, { label: 'SEE WHAT\'S NEW', fn: function () { go('help'); scrollTo('#hpNew'); } }); }, tries ? 15000 : 4000); })();
  }
  function afterProfile() { syncDot(); applyDensity(); renderGreeting(); buildWidgets(); if (S.cur === 'more') renderHub(); renderSettings(); var ni = $('#nameInput'); if (ni && P.name && document.activeElement !== ni) ni.value = P.name; syncStars(); }
  function refreshAll() { buildWidgets(); renderHub(); syncStars(); }

  /* ---------- start ---------- */
  function init() {
    var stored = readLocal(), fresh = !stored; P = X.cleanPrefs(stored);
    if (fresh) { var ln = legacyName(); if (ln) { P.name = ln; P.onboarded = true; } }      // existing users keep their name and skip the welcome
    ensureHomeHead(); addBackBars(); enhanceCalc(); applyDensity(); renderGreeting(); renderSettings(); renderHelp(); renderHub(); syncDot();
    // A profile restored from a backup beats an empty one.
    if (fresh && ST) ST.getPref('profile', null).then(function (v) { if (v && !P.onboarded) { P = X.cleanPrefs(v); persist(); afterProfile(); } }).catch(function () {});
    loadData().then(function () {
      buildWidgets();
      var hash = (location.hash || '').replace('#', ''), deep = hash && hash !== 'home';
      if (!deep && P.onboarded && (P.startPage === 'last' ? P.lastView !== 'home' : P.startPage !== 'home')) go(P.startPage === 'last' ? P.lastView : P.startPage);
      if (!P.onboarded && (S.rows.length || legacyName())) { P.onboarded = true; if (!P.name) P.name = legacyName(); persist(); afterProfile(); toast('New: a 1-minute tour of the dashboard, search and more.', false, { label: 'TAKE TOUR', fn: startTour }); P.tourSeen = true; persist(); }   // existing users skip the welcome
      else if (!P.onboarded) startWelcome();
      else nudgeRelease();
    });
  }
  window.TTExperience = { state: S, prefs: function () { return P; }, openSearch: openSearch, startTour: startTour, startWelcome: startWelcome, featureTour: featureTour, runTour: runTour, endTour: endTour,
    setDensity: function (d) { P.density = d === 'compact' ? 'compact' : 'comfortable'; persist(); applyDensity(); renderSettings(); return P.density === d; },
    customize: function () { go('home'); S.customizing = true; renderCustomize(); setTimeout(function () { var c = $('#customPanel'); if (c) c.scrollIntoView({ block: 'center' }); }, 50); return true; },
    highlight: function (sel, text) { clearRing(); waitFor(sel, function (el) { el.classList.add('tour-ring'); try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} setTimeout(clearRing, 6000); }, 1500); return !!$(sel) || true; },
    markTried: function (id) { markToured(id); }, syncDot: syncDot, act: run, toursSeen: function () { return P.toursSeen.slice(); },
    setFocus: function (t) { P.goalNote = String(t || ''); P.goalDate = P.goalNote.trim() ? todayKey() : ''; persist(); buildWidgets(); return P.goalNote.trim() !== '' ? true : false; } };
  init();
})();
