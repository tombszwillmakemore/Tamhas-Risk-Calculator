/* Tamhas Trading - Journal UI.
   Everything stays on this device: trades in localStorage, screenshots in IndexedDB.
   All numbers come from assets/journal-core.js and only from trades you recorded.
   Missing data is shown as an em dash (—) or "not entered", never as $0. */
(function () {
  'use strict';
  var C = window.TTJournalCore, INST = window.TTInstruments;
  var root = document.getElementById('jRoot');
  if (!C || !INST || !root) return;

  var PREF_KEY = 'tt.journal.prefs.v1';
  var DASH = '—';
  var SLOTS = ['before', 'after'];

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayKey() { return dateKey(new Date()); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function fmtDate(key) {
    var p = key.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2], 12), o = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('en-US', o);
  }
  function fmtTime(hm) { var p = hm.split(':'), h = +p[0]; return ((h % 12) || 12) + ':' + p[1] + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function fmtR(r) { return r == null ? DASH : (r > 0 ? '+' : '') + r.toFixed(2) + 'R'; }
  function fmtPct(x) { return x == null ? DASH : (x * 100).toFixed(1).replace(/\.0$/, '') + '%'; }
  function clsOf(c) { return c == null ? 'none' : c > 0 ? 'pos' : c < 0 ? 'neg' : 'none'; }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs(o) { try { localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(loadPrefs(), o))); } catch (e) {} }

  var toastEl, toastT;
  function toast(msg, bad) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.className = 'toast'; }, bad ? 7000 : 3500);
  }

  /* ---------- state ---------- */
  var now0 = new Date();
  var S = { trades: [], corrupt: false, rejected: 0, tab: 'entries', editing: null, filters: {}, filtersOpen: false, expanded: null, limit: 30,
    basis: null, accounts: [], dbOk: false, loaded: false, range: 'all', cal: { y: now0.getFullYear(), m: now0.getMonth() }, imgOk: null, saveFail: false, restoreMode: 'merge', backupBlob: null };

  function loadTrades() {
    var raw = null; try { raw = localStorage.getItem(C.STORE_KEY); } catch (e) {}
    var r = C.parseStored(raw);
    S.trades = r.trades; S.corrupt = r.corrupt; S.rejected = r.rejected.length;
    // Never lose unreadable data silently: keep a copy aside before anything can overwrite it.
    if (r.corrupt && raw) { try { localStorage.setItem(C.STORE_KEY + '.corrupt', raw); } catch (e) {} }
    if (r.rejected.length) { try { localStorage.setItem(C.STORE_KEY + '.rejected', JSON.stringify(r.rejected)); } catch (e) {} }
  }
  // Saves the whole journal. Resolves true only once it is really stored. IndexedDB (atomic: all trades or none); localStorage only if IndexedDB is unavailable.
  function persist() {
    if (S.dbOk) {
      var ops = [{ store: 'trades', type: 'clear' }];
      S.trades.forEach(function (t) { ops.push({ store: 'trades', type: 'put', value: t }); });
      return window.TTDB.batch(ops).then(function () { S.saveFail = false; return true; }).catch(function () { S.saveFail = true; return false; });
    }
    try { localStorage.setItem(C.STORE_KEY, C.serializeStored(S.trades)); S.saveFail = false; return Promise.resolve(true); } catch (e) { S.saveFail = true; return Promise.resolve(false); }
  }
  function changed() { try { window.dispatchEvent(new Event('tt:journal-changed')); } catch (e) {} }
  function rows() { return C.analyze(S.trades); }
  function effBasis(all) {
    if (S.basis) return S.basis;
    return (all || rows()).some(function (r) { return r.c.isClosed && !r.c.feesMissing; }) ? 'net' : 'gross';
  }

  /* ---------- screenshots: IndexedDB (key "tradeId:before|after" -> data URL) ---------- */
  var IMG = {
    open: function () {
      if (this._p) return this._p;
      this._p = new Promise(function (res, rej) {
        if (!window.indexedDB) { rej(new Error('IndexedDB unavailable')); return; }
        var rq; try { rq = indexedDB.open('tt-journal', 1); } catch (e) { rej(e); return; }
        rq.onupgradeneeded = function () { rq.result.createObjectStore('shots'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error || new Error('open failed')); };
      });
      return this._p;
    },
    run: function (mode, fn) {
      return this.open().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction('shots', mode), out = fn(tx.objectStore('shots'));
          tx.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); };
          tx.onerror = function () { rej(tx.error); };
          tx.onabort = function () { rej(tx.error || new Error('aborted')); };
        });
      });
    },
    get: function (k) { return this.run('readonly', function (s) { return s.get(k); }); },
    put: function (k, v) { return this.run('readwrite', function (s) { return s.put(v, k); }); },
    del: function (k) { return this.run('readwrite', function (s) { return s.delete(k); }); },
    keys: function () { return this.run('readonly', function (s) { return s.getAllKeys(); }); },
    clear: function () { return this.run('readwrite', function (s) { return s.clear(); }); }
  };
  IMG.open().then(function () { S.imgOk = true; }).catch(function () { S.imgOk = false; });

  function compressImage(file) {
    return new Promise(function (res, rej) {
      if (!/^image\//.test(file.type)) { rej(new Error('Please choose an image file.')); return; }
      if (file.size > 25e6) { rej(new Error('That image is too large (25 MB max).')); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, 1400 / Math.max(w, h)), cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
        var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        try { res(cv.toDataURL('image/jpeg', 0.75)); } catch (e) { rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  /* ---------- file delivery (download, or share sheet on phones) ---------- */
  function deliver(name, mime, content) {
    var blob = new Blob([content], { type: mime });
    function anchor() {
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
      return true;
    }
    var mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
    if (mobile && window.File && navigator.canShare && navigator.share) {
      try {
        var f = new File([blob], name, { type: mime });
        if (navigator.canShare({ files: [f] })) {
          return navigator.share({ files: [f], title: name }).then(function () { return true; }).catch(function (e) { return e && e.name === 'AbortError' ? false : anchor(); });
        }
      } catch (e) { /* fall through to a normal download */ }
    }
    return Promise.resolve(anchor());
  }

  /* ---------- derived views of the data ---------- */
  function filteredRows(all) { return C.filterRows(all || rows(), S.filters).sort(function (a, b) { return C.order(b, a); }); }
  function strategyLabels(all) {
    var m = {}; (all || rows()).forEach(function (r) { var s = r.t.strategy; if (s && !m[s.toLowerCase()]) m[s.toLowerCase()] = s; }); return m;
  }
  function inRange(all) {
    if (S.range === 'all') return all;
    var d = new Date(); d.setDate(d.getDate() - (S.range === '30' ? 30 : 90)); var cut = dateKey(d);
    return all.filter(function (r) { return r.t.date >= cut; });
  }

  /* ================= RENDER ================= */
  function bannersHtml() {
    var h = '';
    if (S.corrupt) h += '<div class="banner bad">Your saved journal could not be read. A copy of the unreadable data was kept aside. Saving new trades will start a fresh journal. If you have a backup file, restore it in the Backup tab.</div>';
    if (S.rejected) h += '<div class="banner warn">' + plural(S.rejected, 'saved entry') + ' could not be read and ' + (S.rejected === 1 ? 'was' : 'were') + ' set aside (not deleted).</div>';
    if (S.saveFail) h += '<div class="banner bad">Your browser would not save the last change (storage full or blocked). Export a backup now so nothing is lost.</div>';
    return h;
  }
  function render() {
    if (S.editing) { root.innerHTML = bannersHtml() + formHtml(); afterForm(); }
    else {
      var tabs = [['entries', 'ENTRIES'], ['calendar', 'CALENDAR'], ['analytics', 'ANALYTICS'], ['backup', 'BACKUP']];
      var body = S.tab === 'calendar' ? calendarHtml() : S.tab === 'analytics' ? analyticsHtml() : S.tab === 'backup' ? backupHtml() : entriesHtml();
      root.innerHTML = bannersHtml() + '<div class="chips jtabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" role="tab" aria-selected="' + (S.tab === t[0]) + '" class="chip' + (S.tab === t[0] ? ' on' : '') + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' + body;
      afterTab();
    }
  }

  /* ---------- entries ---------- */
  function entriesHtml() {
    return '<button type="button" class="btn big" data-act="new">+ NEW TRADE</button>' +
      '<div class="panel jsearch"><input id="jq" type="text" data-f="q" placeholder="Search strategy, reasons, mistakes, notes…" autocomplete="off" value="' + esc(S.filters.q || '') + '" aria-label="Search journal">' +
      '<div class="jbar"><button type="button" class="chip' + (S.filtersOpen ? ' on' : '') + '" data-act="toggle-filters" aria-expanded="' + S.filtersOpen + '">FILTERS<span id="jFiltBadge"></span></button>' +
      '<button type="button" class="chip" data-act="clear-filters">CLEAR</button><span class="note" id="jCount"></span></div>' +
      '<div id="jFilters"' + (S.filtersOpen ? '' : ' hidden') + '>' + filtersHtml() + '</div></div><div id="jList"></div>';
  }
  function filtersHtml() {
    var f = S.filters, labels = strategyLabels();
    function sel(key, label, opts) {
      return '<div class="field"><label for="jf-' + key + '">' + label + '</label><select id="jf-' + key + '" data-f="' + key + '">' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + ((f[key] || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
    }
    return '<div class="fgrid">' +
      sel('contract', 'Contract', [['', 'All']].concat(INST.list.map(function (i) { return [i.id, i.id]; }))) +
      sel('side', 'Direction', [['', 'All'], ['long', 'Long'], ['short', 'Short']]) +
      sel('session', 'Session', [['', 'All'], ['__none', 'Not set']].concat(C.SESSIONS.map(function (s) { return [s, s]; }))) +
      sel('strategy', 'Strategy', [['', 'All'], ['__none', 'No strategy']].concat(Object.keys(labels).sort().map(function (k) { return [labels[k], labels[k]]; }))) +
      (S.accounts.length > 1 ? sel('account', 'Account', [['', 'All']].concat(S.accounts.map(function (a) { return [a.id, a.name + (a.archived ? ' (archived)' : '')]; }))) : '') +
      sel('result', 'Result', [['', 'All'], ['win', 'Winners'], ['loss', 'Losers'], ['be', 'Breakeven'], ['open', 'Open / partial']]) +
      sel('rules', 'Followed rules', [['', 'All'], ['yes', 'Yes'], ['no', 'No'], ['unknown', 'Not recorded']]) +
      '<div class="field"><label for="jf-from">From date</label><input id="jf-from" type="date" data-f="from" value="' + esc(f.from || '') + '"></div>' +
      '<div class="field"><label for="jf-to">To date</label><input id="jf-to" type="date" data-f="to" value="' + esc(f.to || '') + '"></div></div>';
  }
  function activeFilterCount() { var n = 0; Object.keys(S.filters).forEach(function (k) { if (S.filters[k]) n++; }); return n; }
  function renderList() {
    var list = $('#jList'); if (!list) return;
    var all = rows(), fr = filteredRows(all), shown = fr.slice(0, S.limit);
    var n = activeFilterCount(), badge = $('#jFiltBadge'); if (badge) badge.textContent = n ? ' · ' + n : '';
    var cnt = $('#jCount'); if (cnt) cnt.textContent = all.length ? 'Showing ' + fr.length + ' of ' + all.length : '';
    var h = '';
    if (S.filters.date) h += '<div class="fchip">Date: ' + esc(fmtDate(S.filters.date)) + ' <button type="button" data-act="clear-date" aria-label="Clear date filter">✕</button></div>';
    if (!all.length) h += '<div class="panel empty"><h2>No trades yet</h2><p class="note" style="margin-top:0">Log your first trade to start building your journal, calendar and analytics. Everything you see here comes only from trades you enter.</p></div>';
    else if (!fr.length) h += '<div class="panel empty"><p class="note" style="margin:0">No trades match these filters.</p></div>';
    else h += shown.map(cardHtml).join('');
    if (fr.length > shown.length) h += '<button type="button" class="btn wide" data-act="more">SHOW MORE (' + (fr.length - shown.length) + ')</button>';
    list.innerHTML = h;
    loadThumbs();
  }
  function pnlChip(c) {
    if (c.shownCents == null) return '<span class="jt-pnl none">OPEN<small>nothing realized</small></span>';
    var kind = c.shownKind === 'net' ? 'net of fees' : c.shownKind === 'gross' ? 'gross, no fees entered' : 'realized so far';
    return '<span class="jt-pnl ' + clsOf(c.shownCents) + '">' + C.fmtMoney(c.shownCents, true) + '<small>' + kind + '</small></span>';
  }
  function cardHtml(r) {
    var t = r.t, c = r.c, open = S.expanded === t.id, tags = [];
    if (c.status === 'open') tags.push('<span class="tag warn">OPEN</span>');
    if (c.status === 'partial') tags.push('<span class="tag warn">PARTIAL ' + c.exitedQty + '/' + t.contracts + '</span>');
    if (t.followedRules === true) tags.push('<span class="tag ok">RULES ✓</span>');
    if (t.followedRules === false) tags.push('<span class="tag bad">BROKE RULES</span>');
    if (t.session) tags.push('<span class="tag">' + esc(t.session) + '</span>');
    if (t.strategy) tags.push('<span class="tag">' + esc(t.strategy) + '</span>');
    if (t.rating) tags.push('<span class="tag">★ ' + t.rating + '</span>');
    return '<article class="jt' + (open ? ' open' : '') + '"><button type="button" class="jt-head" data-act="toggle-card" data-id="' + esc(t.id) + '" aria-expanded="' + open + '">' +
      '<span class="jt-l"><span class="jt-date">' + esc(fmtDate(t.date)) + (t.time ? ' · ' + esc(fmtTime(t.time)) : '') + '</span>' +
      '<span class="jt-title"><b class="dir ' + t.side + '">' + t.side.toUpperCase() + '</b> ' + t.contracts + ' × ' + esc(t.contract) + '</span></span>' + pnlChip(c) + '</button>' +
      (tags.length ? '<div class="tags">' + tags.join('') + '</div>' : '') + (open ? detailHtml(r) : '') + '</article>';
  }
  function detailHtml(r) {
    var t = r.t, c = r.c, m = C.fmtMoney;
    var facts = [
      ['Entry', t.entry], ['Initial stop', t.stop != null ? t.stop : DASH + ' not set'],
      ['Exits', t.exits.length ? t.exits.map(function (x) { return x.qty + ' @ ' + x.price; }).join(', ') : DASH + ' none yet'],
      ['Average exit', c.avgExit != null ? c.avgExit : DASH],
      ['Gross P&L', c.grossCents != null ? m(c.grossCents, true) + (c.isClosed ? '' : ' (so far)') : DASH],
      ['Fees', c.feesCents != null ? m(c.feesCents) : 'Not entered'],
      ['Net P&L', c.netCents != null ? m(c.netCents, true) : (c.isClosed ? 'Needs fees' : DASH)],
      ['Risk at stop', c.plannedRiskCents != null ? m(c.plannedRiskCents) : DASH + ' no stop'],
      ['Realized R (gross)', fmtR(c.rMultiple)]];
    var text = [['Entry reason', t.entryReason], ['Exit reason', t.exitReason], ['Mistakes', t.mistakes], ['Lessons learned', t.lessons], ['Notes', t.notes]]
      .filter(function (x) { return x[1]; }).map(function (x) { return '<div class="jt-tx"><h3>' + x[0] + '</h3><p>' + esc(x[1]) + '</p></div>'; }).join('');
    return '<div class="jt-det"><dl class="facts">' + facts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' + text +
      '<div class="thumbs" data-trade="' + esc(t.id) + '"></div>' +
      '<div class="jt-act"><button type="button" class="btn" data-act="edit" data-id="' + esc(t.id) + '">EDIT</button><button type="button" class="btn danger" data-act="delete" data-id="' + esc(t.id) + '">DELETE</button></div></div>';
  }
  function loadThumbs() {
    if (S.imgOk === false) return;
    $$('.thumbs[data-trade]').forEach(function (box) {
      var id = box.getAttribute('data-trade');
      SLOTS.forEach(function (slot) {
        IMG.get(id + ':' + slot).then(function (url) {
          if (!url || !box.isConnected) return;
          var fig = document.createElement('figure'); fig.innerHTML = '<img class="shot-img" alt="' + slot + ' screenshot" data-act="lightbox"><figcaption>' + slot.toUpperCase() + '</figcaption>';
          fig.firstChild.src = url; box.appendChild(fig);
        }).catch(function () {});
      });
    });
  }

  /* ---------- calendar ---------- */
  function basisToggleHtml(b, note) {
    return '<div class="panel"><h2>P&amp;L basis</h2><div class="chips"><button type="button" class="chip' + (b === 'net' ? ' on' : '') + '" data-act="basis" data-b="net">NET (after fees)</button>' +
      '<button type="button" class="chip' + (b === 'gross' ? ' on' : '') + '" data-act="basis" data-b="gross">GROSS (before fees)</button></div>' +
      '<p class="note" style="margin:0">' + note + '</p></div>';
  }
  function calendarHtml() {
    var all = rows(), b = effBasis(all), dm = C.dailyMap(all, b), y = S.cal.y, m = S.cal.m;
    var first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), lead = first.getDay(), today = todayKey();
    var total = null, traded = 0, green = 0, red = 0, ntr = 0;
    for (var d = 1; d <= days; d++) {
      var e = dm[y + '-' + pad2(m + 1) + '-' + pad2(d)]; if (!e) continue;
      ntr += e.trades; traded++;
      if (e.pnlCents != null) { total = (total || 0) + e.pnlCents; if (e.pnlCents > 0) green++; else if (e.pnlCents < 0) red++; }
    }
    var cells = '';
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (w) { cells += '<div class="cal-h">' + w + '</div>'; });
    for (var i = 0; i < lead; i++) cells += '<div class="cal-d blank"></div>';
    for (var k = 1; k <= days; k++) {
      var key = y + '-' + pad2(m + 1) + '-' + pad2(k), e2 = dm[key];
      if (!e2) { cells += '<div class="cal-d empty' + (key === today ? ' today' : '') + '"><span class="cn">' + k + '</span></div>'; continue; }
      var star = (e2.excluded || e2.open) ? '*' : '';
      var label = fmtDate(key) + ': ' + plural(e2.trades, 'trade') + (e2.pnlCents != null ? ', ' + C.fmtMoney(e2.pnlCents, true) : ', no counted P&L') + (star ? ' (some trades not counted)' : '');
      cells += '<button type="button" class="cal-d has ' + clsOf(e2.pnlCents) + (key === today ? ' today' : '') + '" data-act="cal-day" data-date="' + key + '" aria-label="' + esc(label) + '">' +
        '<span class="cn">' + k + '</span><span class="cp">' + (e2.pnlCents != null ? esc(C.fmtCompact(e2.pnlCents)) : DASH) + star + '</span><span class="ct">' + plural(e2.trades, 'trade') + '</span></button>';
    }
    var mname = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return basisToggleHtml(b, b === 'net' ? 'Only closed trades with fees entered are counted. Others are marked * and left out of the total.' : 'All fully closed trades are counted before fees.') +
      '<div class="panel"><div class="calnav"><button type="button" class="chip" data-act="cal-prev" aria-label="Previous month">‹</button><h2 class="calt">' + esc(mname) + '</h2>' +
      '<button type="button" class="chip" data-act="cal-next" aria-label="Next month">›</button></div>' +
      '<div class="kpis small cal-k"><div class="kpi"><div class="kpi-l">MONTH P&amp;L</div><div class="kpi-v ' + clsOf(total) + '">' + C.fmtMoney(total, true) + '</div></div>' +
      '<div class="kpi"><div class="kpi-l">DAYS TRADED</div><div class="kpi-v">' + traded + '</div><div class="kpi-s">' + green + ' green · ' + red + ' red</div></div>' +
      '<div class="kpi"><div class="kpi-l">TRADES</div><div class="kpi-v">' + ntr + '</div></div></div>' +
      '<div class="cal">' + cells + '</div><div class="jbar"><button type="button" class="chip" data-act="cal-today">THIS MONTH</button></div>' +
      '<p class="note">Tap a day to see its trades. ' + DASH + ' means the day has trades but none with a counted P&amp;L (open, partly closed' + (b === 'net' ? ', or fees missing' : '') + '). * marks days that include trades left out.</p></div>';
  }

  /* ---------- analytics ---------- */
  function kpi(label, value, sub, cls) { return '<div class="kpi"><div class="kpi-l">' + label + '</div><div class="kpi-v ' + (cls || '') + '">' + value + '</div><div class="kpi-s">' + (sub || '&nbsp;') + '</div></div>'; }
  function analyticsHtml() {
    var all = rows(), b = effBasis(all), data = inRange(all), st = C.stats(data, b), m = C.fmtMoney;
    var h = basisToggleHtml(b, b === 'net' ? 'After fees. Closed trades with no fees entered are left out, not counted as $0 fees.' : 'Before fees. Every fully closed trade is counted.');
    h += '<div class="chips" style="margin-bottom:12px">' + [['all', 'ALL TIME'], ['90', 'LAST 90 DAYS'], ['30', 'LAST 30 DAYS']].map(function (r) {
      return '<button type="button" class="chip' + (S.range === r[0] ? ' on' : '') + '" data-act="range" data-r="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>';
    if (b === 'net' && st.excludedNoFees) h += '<div class="banner warn">' + plural(st.excludedNoFees, 'closed trade') + ' ' + (st.excludedNoFees === 1 ? 'has' : 'have') + ' no fees entered and ' + (st.excludedNoFees === 1 ? 'is' : 'are') + ' left out of these net figures. Add fees to include ' + (st.excludedNoFees === 1 ? 'it' : 'them') + ', or switch to Gross.</div>';
    if (st.openCount) h += '<div class="banner info">' + plural(st.openCount, 'open or partly closed trade') + ' not counted until fully exited.</div>';
    if (!st.n) {
      return h + '<div class="panel empty"><h2>Nothing to analyze yet</h2><p class="note" style="margin-top:0">' + (all.length ? 'No fully closed trades match this view and basis.' : 'Statistics appear once you log closed trades. Nothing is estimated or simulated.') + '</p></div>';
    }
    var wl = 'W ' + st.wins + ' · L ' + st.losses + ' · BE ' + st.breakeven;
    h += '<div class="panel"><h2>' + (b === 'net' ? 'Net P&amp;L after fees' : 'Gross P&amp;L before fees') + '</h2>' +
      '<div class="pnl-value ' + clsOf(st.pnlCents) + '">' + m(st.pnlCents, true) + '</div><p class="note">Based on ' + plural(st.n, 'closed trade') + '.' +
      (b === 'gross' && st.feesRecordedCount ? ' Fees recorded on ' + st.feesRecordedCount + ' of ' + st.closedCount + ' trades (' + m(st.feesRecordedCents) + ' total).' : '') + '</p>' +
      '<div class="kpis">' +
      kpi('WIN RATE', fmtPct(st.winRate), wl) +
      kpi('PROFIT FACTOR', st.profitFactor != null ? st.profitFactor.toFixed(2) : DASH, st.profitFactor != null ? 'gross profit ÷ gross loss' : st.profitFactorNote) +
      kpi('AVG WINNER', m(st.avgWinCents), st.wins ? plural(st.wins, 'winner') : 'no winners', st.avgWinCents != null ? 'pos' : '') +
      kpi('AVG LOSER', m(st.avgLossCents), st.losses ? plural(st.losses, 'loser') : 'no losers', st.avgLossCents != null ? 'neg' : '') +
      kpi('AVG REALIZED R:R', st.realizedRR != null ? st.realizedRR.toFixed(2) + ' : 1' : DASH, st.realizedRR != null ? 'avg winner R ÷ avg loser R' : 'needs a stop on a winner and a loser') +
      kpi('AVG R PER TRADE', fmtR(st.avgR), st.rCount ? 'from ' + st.rCount + ' of ' + st.n + ' trades with a stop (before fees)' : 'no trades with a stop price') +
      kpi('LARGEST DRAWDOWN', st.maxDrawdownCents ? m(-st.maxDrawdownCents) : m(0), st.maxDrawdownCents ? (st.ddFrom ? esc(fmtDate(st.ddFrom)) : 'Start') + ' → ' + esc(fmtDate(st.ddTo)) : 'no losing stretch yet', st.maxDrawdownCents ? 'neg' : '') +
      kpi('PAYOFF RATIO', st.payoff != null ? st.payoff.toFixed(2) : DASH, st.payoff != null ? 'avg winner $ ÷ avg loser $' : '') +
      kpi('BEST TRADE', m(st.bestCents, true), '', clsOf(st.bestCents)) + kpi('WORST TRADE', m(st.worstCents, true), '', clsOf(st.worstCents)) + '</div></div>';
    h += '<div class="panel"><h2>Equity curve</h2>' + equityHtml(st.curve) + '</div>';
    var lbl = strategyLabels(all);
    h += breakdownHtml('By session', C.breakdown(data, function (r) { return r.t.session || 'Unspecified'; }, C.SESSIONS, b), function (k) { return k; });
    h += breakdownHtml('By contract', C.breakdown(data, function (r) { return r.t.contract; }, INST.list.map(function (i) { return i.id; }), b), function (k) { return k; });
    h += breakdownHtml('By strategy', C.breakdown(data, function (r) { return r.t.strategy ? r.t.strategy.toLowerCase() : 'Unspecified'; }, null, b), function (k) { return lbl[k] || k; });
    return h + '<p class="note">* fewer than 10 trades: treat as an anecdote, not evidence. Statistics describe only trades you recorded.</p>';
  }
  function breakdownHtml(title, groups, label) {
    if (!groups.length) return '';
    var maxAbs = 0; groups.forEach(function (g) { if (g.pnlCents != null) maxAbs = Math.max(maxAbs, Math.abs(g.pnlCents)); });
    var body = groups.map(function (g) {
      var w = g.pnlCents != null && maxAbs ? Math.round(Math.abs(g.pnlCents) / maxAbs * 100) : 0;
      return '<tr><th scope="row">' + esc(label(g.key)) + '</th><td>' + g.n + (g.n < 10 && g.n > 0 ? '*' : '') + (g.excluded ? '<small> +' + g.excluded + ' no fees</small>' : '') + '</td><td>' + fmtPct(g.winRate) + '</td>' +
        '<td class="' + clsOf(g.pnlCents) + '">' + C.fmtMoney(g.pnlCents, true) + '<div class="bar ' + clsOf(g.pnlCents) + '"><i style="width:' + w + '%"></i></div></td></tr>';
    }).join('');
    return '<div class="panel"><h2>' + title + '</h2><table class="btbl"><thead><tr><th scope="col"></th><th scope="col">Trades</th><th scope="col">Win %</th><th scope="col">P&amp;L</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  var chartPts = null;
  function equityHtml(curve) {
    if (curve.length < 2) return '<p class="note" style="margin:0">An equity curve needs at least 2 counted trades.</p>';
    var pts = [{ i: 0, date: null, cents: 0 }].concat(curve.map(function (p, i) { return { i: i + 1, date: p.date, cents: p.cents }; }));
    var W = 340, H = 180, pl = 46, pr = 10, pt = 12, pb = 14, lo = 0, hi = 0;
    pts.forEach(function (p) { lo = Math.min(lo, p.cents); hi = Math.max(hi, p.cents); });
    var dMin = lo, dMax = hi; if (hi === lo) hi = lo + 100;
    var padv = (hi - lo) * 0.08; lo -= padv; hi += padv;
    var X = function (i) { return pl + (W - pl - pr) * (i / (pts.length - 1)); }, Y = function (v) { return pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo)); };
    var line = pts.map(function (p, k) { return (k ? 'L' : 'M') + X(p.i).toFixed(1) + ' ' + Y(p.cents).toFixed(1); }).join(' ');
    var z = Y(0), area = line + ' L' + X(pts.length - 1).toFixed(1) + ' ' + z.toFixed(1) + ' L' + X(0).toFixed(1) + ' ' + z.toFixed(1) + ' Z';
    function ax(c) { return C.fmtCompact(c).replace('+', ''); }
    var grid = '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + z.toFixed(1) + '" y2="' + z.toFixed(1) + '" class="eq-zero"/><text x="' + (pl - 6) + '" y="' + (z + 3).toFixed(1) + '" class="eq-ax" text-anchor="end">$0</text>';
    if (Math.abs(Y(dMax) - z) > 14) grid += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(dMax).toFixed(1) + '" y2="' + Y(dMax).toFixed(1) + '" class="eq-grid"/><text x="' + (pl - 6) + '" y="' + (Y(dMax) + 3).toFixed(1) + '" class="eq-ax" text-anchor="end">' + esc(ax(dMax)) + '</text>';
    if (dMin < 0 && Math.abs(Y(dMin) - z) > 14) grid += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(dMin).toFixed(1) + '" y2="' + Y(dMin).toFixed(1) + '" class="eq-grid"/><text x="' + (pl - 6) + '" y="' + (Y(dMin) + 3).toFixed(1) + '" class="eq-ax" text-anchor="end">' + esc(ax(dMin)) + '</text>';
    chartPts = { pts: pts, W: W, X: X, Y: Y, pl: pl, pr: pr };
    var last = pts[pts.length - 1];
    var table = '<details class="io"><summary>View as table</summary><div class="tscroll"><table class="btbl"><thead><tr><th scope="col">Trade</th><th scope="col">Date</th><th scope="col">Cumulative P&amp;L</th></tr></thead><tbody>' +
      pts.slice(1).map(function (p) { return '<tr><th scope="row">' + p.i + '</th><td>' + esc(fmtDate(p.date)) + '</td><td class="' + clsOf(p.cents) + '">' + C.fmtMoney(p.cents, true) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    return '<svg id="eqSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Equity curve of cumulative P&L across ' + (pts.length - 1) + ' closed trades, ending at ' + esc(C.fmtMoney(last.cents, true)) + '" class="eq">' +
      '<defs><linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2de2ff" stop-opacity=".28"/><stop offset="1" stop-color="#2de2ff" stop-opacity="0"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#eqg)"/><path d="' + line + '" class="eq-line"/>' +
      '<g id="eqCross" style="display:none"><line id="eqV" y1="' + pt + '" y2="' + (H - pb) + '" class="eq-cross"/><circle id="eqDot" r="4" class="eq-dot"/></g></svg>' +
      '<div class="eq-read" id="eqRead" aria-live="off">Latest: after trade ' + last.i + ' · ' + esc(fmtDate(last.date)) + ' · <b class="' + clsOf(last.cents) + '">' + C.fmtMoney(last.cents, true) + '</b> cumulative</div>' + table;
  }
  function bindChart() {
    var svg = $('#eqSvg'); if (!svg || !chartPts) return;
    var cp = chartPts, cross = $('#eqCross'), v = $('#eqV'), dot = $('#eqDot'), read = $('#eqRead'), latest = read.innerHTML;
    function at(ev) {
      var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * cp.W;
      var f = (x - cp.pl) / (cp.W - cp.pl - cp.pr), i = Math.max(0, Math.min(cp.pts.length - 1, Math.round(f * (cp.pts.length - 1)))), p = cp.pts[i];
      cross.style.display = ''; v.setAttribute('x1', cp.X(i)); v.setAttribute('x2', cp.X(i)); dot.setAttribute('cx', cp.X(i)); dot.setAttribute('cy', cp.Y(p.cents));
      read.innerHTML = i === 0 ? 'Start · $0.00' : 'After trade ' + p.i + ' · ' + esc(fmtDate(p.date)) + ' · <b class="' + clsOf(p.cents) + '">' + C.fmtMoney(p.cents, true) + '</b> cumulative';
    }
    svg.addEventListener('pointermove', at); svg.addEventListener('pointerdown', at);
    svg.addEventListener('pointerleave', function () { cross.style.display = 'none'; read.innerHTML = latest; });
  }

  /* ---------- backup ---------- */
  function backupHtml() {
    var size = 0; try { size = new Blob([C.serializeStored(S.trades)]).size; } catch (e) {}
    var prefs = loadPrefs(), last = prefs.lastBackup ? new Date(prefs.lastBackup).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null;
    var stale = S.trades.length && (!prefs.lastBackup || Date.now() - prefs.lastBackup > 30 * 86400000);
    var shotsOk = S.imgOk !== false;
    return (stale ? '<div class="banner warn">' + (last ? 'Your last backup was ' + esc(last) + '.' : 'You have not exported a backup yet.') + ' Your journal lives only in this browser, so a backup is your safety net.</div>' : '') +
      '<div class="panel"><h2>Your data</h2><div class="kpis small"><div class="kpi"><div class="kpi-l">TRADES</div><div class="kpi-v">' + S.trades.length + '</div></div>' +
      '<div class="kpi"><div class="kpi-l">SCREENSHOTS</div><div class="kpi-v" id="bkShots">' + (shotsOk ? DASH : 'n/a') + '</div></div>' +
      '<div class="kpi"><div class="kpi-l">TEXT SIZE</div><div class="kpi-v">' + (size / 1024).toFixed(1) + ' KB</div></div></div>' +
      '<p class="note">Stored only on this device. Clearing browser data, or removing the app, erases it. <b>iPhone:</b> the Home Screen app and Safari keep separate storage, so back up and restore from the same place you log your trades.' +
      (last ? ' Last backup created: ' + esc(last) + '.' : '') + '</p></div>' +
      '<div class="panel"><h2>Export CSV</h2><p class="note" style="margin-top:0">Opens in Excel or Google Sheets. Missing values stay blank (never 0).</p>' +
      '<div class="row-inline"><button type="button" class="btn" data-act="csv-all"' + (S.trades.length ? '' : ' disabled') + '>ALL TRADES</button><button type="button" class="btn" data-act="csv-filtered"' + (S.trades.length ? '' : ' disabled') + '>CURRENT FILTER</button></div></div>' +
      '<div class="panel"><h2>Full backup</h2><p class="note" style="margin-top:0">A JSON file you can restore later, on this or another device. Includes trades, accounts, rule versions, fees, payouts and firm snapshots.</p>' +
      (shotsOk ? '<label class="chk"><input type="checkbox" id="bkInclShots" checked> Include screenshots (larger file)</label>' : '') +
      '<button type="button" class="btn wide" data-act="bk-prepare"' + (S.trades.length || S.accounts.length > 1 ? '' : ' disabled') + '>PREPARE BACKUP</button><div id="bkReady"></div></div>' +
      '<div class="panel"><h2>Restore from backup</h2>' +
      '<div class="seg" role="radiogroup" aria-label="Restore mode"><label class="seg-i"><input type="radio" name="bkmode" value="merge"' + (S.restoreMode === 'merge' ? ' checked' : '') + '><span>MERGE</span></label>' +
      '<label class="seg-i"><input type="radio" name="bkmode" value="replace"' + (S.restoreMode === 'replace' ? ' checked' : '') + '><span>REPLACE ALL</span></label></div>' +
      '<p class="note">Merge keeps what you have and adds anything new, including accounts and account records (fees, payouts, snapshots) from newer backups. Replace swaps your journal, accounts and account records for the backup.</p>' +
      '<label class="btn wide filebtn">CHOOSE BACKUP FILE<input type="file" id="bkFile" accept=".json,application/json" class="vh"></label></div>' +
      '<div class="panel"><h2>Danger zone</h2><p class="note" style="margin-top:0">Permanently deletes every trade and screenshot from this device.</p><button type="button" class="btn danger wide" data-act="wipe"' + (S.trades.length ? '' : ' disabled') + '>DELETE ALL JOURNAL DATA</button></div>';
  }

  /* ================= FORM ================= */
  function distinctStrategies() { var m = strategyLabels(); return Object.keys(m).sort().map(function (k) { return m[k]; }); }
  function fld(label, id, inner, hint) { return '<div class="field"><label for="' + id + '">' + label + '</label>' + inner + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>'; }
  function exRow(qty, price, auto) {
    return '<div class="exrow"><input class="ex-qty" type="text" inputmode="numeric" placeholder="Qty" aria-label="Exit quantity" value="' + esc(qty) + '"' + (auto ? ' data-auto="1"' : '') + '>' +
      '<input class="ex-price" type="text" inputmode="decimal" placeholder="Exit price" aria-label="Exit price" value="' + esc(price) + '">' +
      '<button type="button" class="xbtn" data-act="ex-del" aria-label="Remove this exit">✕</button></div>';
  }
  var DEFACCT = 'acct-default';
  // Accounts you can pick: all active ones, plus the trade's own account even if archived (so editing never silently moves a trade).
  function accountChoices(t) { return S.accounts.filter(function (a) { return !a.archived || (t && t.accountId === a.id); }); }
  function formHtml() {
    var E = S.editing, t = E.trade || {}, p = loadPrefs(), isNew = !E.id;
    var v = { date: t.date || todayKey(), time: t.time || '', contract: t.contract || p.contract || INST.defaultId, side: t.side || p.side || 'long',
      qty: t.contracts != null ? t.contracts : '', session: t.session || '', strategy: t.strategy || '', entry: t.entry != null ? t.entry : '', stop: t.stop != null ? t.stop : '',
      fees: t.feesCents != null ? (t.feesCents / 100).toFixed(2) : '' };
    var exits = (t.exits && t.exits.length) ? t.exits.map(function (x) { return exRow(x.qty, x.price, false); }).join('') : exRow('', '', true);
    var rules = t.followedRules === true ? 'yes' : t.followedRules === false ? 'no' : '';
    function radio(name, val, label, cur) { return '<label class="seg-i"><input type="radio" name="' + name + '" value="' + val + '"' + (cur === val ? ' checked' : '') + '><span>' + label + '</span></label>'; }
    var h = '<div class="formtop"><button type="button" class="chip" data-act="cancel">‹ BACK</button><h2 class="calt">' + (isNew ? 'New trade' : 'Edit trade') + '</h2></div>' +
      '<div class="errs" id="fErrs" role="alert" hidden></div>' +
      '<div class="panel"><h2>Trade</h2><div class="fgrid">' +
      fld('Trade date', 'f-date', '<input id="f-date" type="date" value="' + esc(v.date) + '">') +
      fld('Entry time (optional)', 'f-time', '<input id="f-time" type="time" value="' + esc(v.time) + '">') +
      (accountChoices(t).length > 1 ? fld('Account', 'f-account', '<select id="f-account">' + accountChoices(t).map(function (a) { return '<option value="' + esc(a.id) + '"' + ((t.accountId || p.account || DEFACCT) === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>') : '') +
      fld('Contract', 'f-contract', '<select id="f-contract">' + INST.list.map(function (i) { return '<option value="' + i.id + '"' + (v.contract === i.id ? ' selected' : '') + '>' + i.id + ' · ' + i.label + '/pt</option>'; }).join('') + '</select>') +
      fld('Contracts', 'f-qty', '<input id="f-qty" type="text" inputmode="numeric" placeholder="e.g. 2" autocomplete="off" value="' + esc(v.qty) + '">') + '</div>' +
      '<div class="field"><label id="f-side-l">Direction</label><div class="seg" role="radiogroup" aria-labelledby="f-side-l">' + radio('f-side', 'long', 'LONG', v.side) + radio('f-side', 'short', 'SHORT', v.side) + '</div></div>' +
      '<div class="fgrid">' +
      fld('Trading session (optional)', 'f-session', '<select id="f-session"><option value="">Not set</option>' + C.SESSIONS.map(function (s) { return '<option' + (v.session === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>') +
      fld('Strategy / setup (optional)', 'f-strategy', '<input id="f-strategy" type="text" maxlength="60" list="f-strategies" autocomplete="off" placeholder="e.g. ORB" value="' + esc(v.strategy) + '"><datalist id="f-strategies">' + distinctStrategies().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>') +
      '</div></div>' +
      '<div class="panel"><h2>Prices &amp; fees</h2><div class="fgrid">' +
      fld('Entry price', 'f-entry', '<input id="f-entry" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 21050.25" value="' + esc(v.entry) + '">') +
      fld('Initial stop (optional)', 'f-stop', '<input id="f-stop" type="text" inputmode="decimal" autocomplete="off" placeholder="price" value="' + esc(v.stop) + '">', 'Needed for R multiples.') + '</div>' +
      '<div class="field"><label>Exits <span class="lh">(add a row per partial exit)</span></label><div id="exList">' + exits + '</div><button type="button" class="chip" data-act="ex-add">+ ADD PARTIAL EXIT</button>' +
      '<p class="hint">Leave exits empty while the trade is open. Quantities must add up to your contracts for the trade to count in statistics.</p></div>' +
      fld('Total fees &amp; commissions, $ (optional)', 'f-fees', '<div class="input-wrap"><span class="prefix">$</span><input id="f-fees" class="money" type="text" inputmode="decimal" autocomplete="off" placeholder="blank = not entered" value="' + esc(v.fees) + '"></div>',
        'Blank means <b>not entered</b>. Type 0 only if there really were no fees.') + '</div>' +
      '<div class="panel preview"><h2>Calculated from your prices</h2><div id="fPreview"></div></div>' +
      '<div class="panel"><h2>Reasoning &amp; review</h2>' +
      fld('Entry reason', 'f-entryReason', '<textarea id="f-entryReason" rows="2" maxlength="500" placeholder="Why did you take this trade?">' + esc(t.entryReason || '') + '</textarea>') +
      fld('Exit reason', 'f-exitReason', '<textarea id="f-exitReason" rows="2" maxlength="500" placeholder="Why did you exit?">' + esc(t.exitReason || '') + '</textarea>') +
      '<div class="field"><label id="f-rules-l">Did you follow your trading rules?</label><div class="seg" role="radiogroup" aria-labelledby="f-rules-l">' + radio('f-rules', 'yes', 'YES', rules) + radio('f-rules', 'no', 'NO', rules) + radio('f-rules', '', 'NOT RECORDED', rules) + '</div></div>' +
      fld('Self-rating (optional)', 'f-rating', '<select id="f-rating"><option value="">Not rated</option>' + [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (t.rating === n ? ' selected' : '') + '>' + '★'.repeat(n) + ' ' + n + ' / 5</option>'; }).join('') + '</select>') +
      fld('Mistakes', 'f-mistakes', '<textarea id="f-mistakes" rows="3" maxlength="1000" placeholder="What went wrong?">' + esc(t.mistakes || '') + '</textarea>') +
      fld('Lessons learned', 'f-lessons', '<textarea id="f-lessons" rows="3" maxlength="1000" placeholder="What will you do differently?">' + esc(t.lessons || '') + '</textarea>') +
      fld('Notes', 'f-notes', '<textarea id="f-notes" rows="2" maxlength="1000" placeholder="Anything else">' + esc(t.notes || '') + '</textarea>') + '</div>';
    h += '<div class="panel"><h2>Screenshots (optional)</h2>' + (S.imgOk === false ? '<p class="note" style="margin:0">Screenshot storage is not available in this browser (private mode?). Everything else still works.</p>' :
      '<div class="shots">' + SLOTS.map(function (s) {
        return '<div class="shot" data-slot="' + s + '"><div class="shot-t">' + s.toUpperCase() + ' TRADE</div><div class="shot-box" id="shot-' + s + '"></div>' +
          '<div class="row-inline"><label class="btn small filebtn" id="shotbtn-' + s + '">ADD<input type="file" accept="image/*" class="vh" data-slot="' + s + '"></label><button type="button" class="btn small danger" data-act="shot-remove" data-slot="' + s + '" hidden>REMOVE</button></div></div>'; }).join('') +
      '</div><p class="hint">Saved on this device only, shrunk to save space.</p>') + '</div>' +
      '<div class="formact"><button type="button" class="btn big" data-act="save">' + (isNew ? 'SAVE TRADE' : 'SAVE CHANGES') + '</button><button type="button" class="btn wide" data-act="cancel">CANCEL</button>' +
      (isNew ? '' : '<button type="button" class="btn danger wide" data-act="delete" data-id="' + esc(E.id) + '">DELETE TRADE</button>') + '</div>';
    return h;
  }
  function afterForm() {
    var E = S.editing;
    SLOTS.forEach(function (s) { renderShot(s); });
    if (E.id && S.imgOk !== false) SLOTS.forEach(function (s) {
      IMG.get(E.id + ':' + s).then(function (url) { if (url && S.editing === E && !E.shots[s].changed && !E.shots[s].removed) { E.shots[s].dataUrl = url; E.shots[s].had = true; renderShot(s); } }).catch(function () {});
    });
    updatePreview();
  }
  function renderShot(slot) {
    var sh = S.editing && S.editing.shots[slot], box = $('#shot-' + slot); if (!box || !sh) return;
    box.innerHTML = sh.dataUrl ? '<img class="shot-img" data-act="lightbox" alt="' + slot + ' screenshot">' : '<span class="note">No screenshot</span>';
    if (sh.dataUrl) box.firstChild.src = sh.dataUrl;
    var rm = $('[data-act="shot-remove"][data-slot="' + slot + '"]'); if (rm) rm.hidden = !sh.dataUrl;
    var b = $('#shotbtn-' + slot); if (b && b.firstChild) b.firstChild.nodeValue = sh.dataUrl ? 'REPLACE' : 'ADD';
  }
  function readForm() {
    var E = S.editing, g = function (id) { var e = $('#' + id); return e ? e.value : ''; };
    var side = ($('input[name="f-side"]:checked') || {}).value || '', rules = ($('input[name="f-rules"]:checked') || {}).value || '';
    var exits = $$('.exrow').map(function (r) {
      var q = $('.ex-qty', r), pr = $('.ex-price', r).value, qv = q.value;
      if (String(pr).trim() === '' && q.getAttribute('data-auto') === '1') qv = '';          // untouched auto-filled qty with no price = empty row
      return { qty: qv, price: pr };
    });
    return { id: E.id || undefined, createdAt: E.trade ? E.trade.createdAt : undefined, date: g('f-date'), time: g('f-time'), accountId: g('f-account') || (E.trade ? E.trade.accountId : undefined), contract: g('f-contract'), side: side,
      contracts: g('f-qty'), session: g('f-session'), strategy: g('f-strategy'), entry: g('f-entry'), stop: g('f-stop'), exits: exits, fees: g('f-fees'),
      entryReason: g('f-entryReason'), exitReason: g('f-exitReason'), followedRules: rules, rating: g('f-rating'), mistakes: g('f-mistakes'), lessons: g('f-lessons'), notes: g('f-notes') };
  }
  function updatePreview() {
    var el = $('#fPreview'); if (!el) return;
    var r = C.normalizeTrade(readForm());
    if (!r.ok) { el.innerHTML = '<p class="note" style="margin:0">Not calculated yet: ' + esc(r.errors[0]) + '</p>'; return; }
    var t = r.trade, c = C.compute(t), m = C.fmtMoney, inst = INST.byId[t.contract];
    var status = c.status === 'open' ? 'OPEN (no exits yet)' : c.status === 'partial' ? 'PARTLY CLOSED (' + c.exitedQty + ' of ' + t.contracts + ' exited)' : 'CLOSED';
    var rowsH = [
      ['Status', status, ''],
      ['Gross P&L', c.grossCents != null ? m(c.grossCents, true) : DASH + ' <small>nothing exited yet</small>', clsOf(c.grossCents)],
      ['Fees', c.feesCents != null ? m(c.feesCents) : 'Not entered', ''],
      ['Net P&L', c.netCents != null ? m(c.netCents, true) : DASH + ' <small>' + (c.isClosed ? 'enter fees to see net' : 'when fully closed') + '</small>', clsOf(c.netCents)],
      ['Risk at your stop', c.plannedRiskCents != null ? m(c.plannedRiskCents) : DASH + ' <small>no stop entered</small>', ''],
      ['Realized R (gross)', c.rMultiple != null ? fmtR(c.rMultiple) : DASH, '']];
    el.innerHTML = rowsH.map(function (x) { return '<div class="row"><span>' + x[0] + '</span><span class="' + x[2] + '">' + x[1] + '</span></div>'; }).join('') +
      '<p class="hint">Uses ' + inst.label + ' per point for ' + inst.id + ' (CME spec). Nothing is estimated.</p>';
  }
  function showErrors(list) {
    var box = $('#fErrs'); if (!box) return;
    box.innerHTML = '<b>Please fix:</b><ul>' + list.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>'; box.hidden = false;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function openForm(id) {
    var t = id ? S.trades.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !t) return;
    S.editing = { id: id || null, trade: t, shots: { before: { dataUrl: null, changed: false, removed: false, had: false }, after: { dataUrl: null, changed: false, removed: false, had: false } } };
    render(); window.scrollTo(0, 0);
  }
  function saveForm() {
    var E = S.editing, r = C.normalizeTrade(readForm());
    if (!r.ok) { showErrors(r.errors); return; }
    var t = r.trade, before = S.trades.slice(), idx = S.trades.findIndex(function (x) { return x.id === t.id; });
    if (idx >= 0) S.trades[idx] = t; else S.trades.push(t);
    persist().then(function (ok) {
    if (!ok) { S.trades = before; showErrors(['Your browser would not save this trade (storage full or blocked). Export a backup, free some space, then try again.']); return; }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    savePrefs({ contract: t.contract, side: t.side, account: t.accountId });
    var ops = [];
    if (S.imgOk !== false) SLOTS.forEach(function (s) {
      var sh = E.shots[s], key = t.id + ':' + s;
      if (sh.removed) ops.push(IMG.del(key)); else if (sh.changed && sh.dataUrl) ops.push(IMG.put(key, sh.dataUrl));
    });
    Promise.all(ops).then(function () { toast('Trade saved.'); }).catch(function () { toast('Trade saved, but a screenshot could not be stored.', true); }).then(function () { if (S.tab === 'entries') renderList(); });
    S.editing = null; S.tab = 'entries'; S.expanded = t.id; changed(); render(); window.scrollTo(0, 0);
    });
  }
  function deleteTrade(id) {
    var t = S.trades.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    if (!window.confirm('Delete this ' + t.contract + ' trade from ' + t.date + '? This cannot be undone.')) return;
    var before = S.trades.slice(); S.trades = S.trades.filter(function (x) { return x.id !== id; });
    persist().then(function (ok) {
      if (!ok) { S.trades = before; toast('Could not delete (browser storage blocked).', true); return; }
      if (S.imgOk !== false) SLOTS.forEach(function (s) { IMG.del(id + ':' + s).catch(function () {}); });
      S.editing = null; S.expanded = null; changed(); render(); toast('Trade deleted.');
    });
  }

  /* ---------- tab setup ---------- */
  function afterTab() {
    if (S.tab === 'entries') renderList();
    if (S.tab === 'analytics') bindChart();
    if (S.tab === 'backup' && S.imgOk !== false) IMG.keys().then(function (k) { var e = $('#bkShots'); if (e) e.textContent = k.length; }).catch(function () { var e = $('#bkShots'); if (e) e.textContent = 'n/a'; });
  }

  /* ---------- backup / restore actions ---------- */
  function stamp() { return todayKey(); }
  function acctNames() { var m = {}; S.accounts.forEach(function (a) { m[a.id] = a.name; }); return m; }
  function exportCsv(onlyFiltered) {
    var all = rows(), list = onlyFiltered ? filteredRows(all) : all;
    if (!list.length) { toast('No trades to export.', true); return; }
    deliver('tamhas-journal-' + stamp() + '.csv', 'text/csv;charset=utf-8', '﻿' + C.toCsv(list, acctNames())).then(function (ok) { if (ok) toast('CSV ready (' + plural(list.length, 'trade') + ').'); });
  }
  function prepareBackup() {
    var incl = $('#bkInclShots') && $('#bkInclShots').checked, ready = $('#bkReady'); if (!ready) return;
    ready.innerHTML = '<p class="note">Preparing…</p>';
    var shots = {}, jobs = [];
    if (incl && S.imgOk !== false) S.trades.forEach(function (t) { SLOTS.forEach(function (s) { jobs.push(IMG.get(t.id + ':' + s).then(function (u) { if (u) shots[t.id + ':' + s] = u; }).catch(function () {})); }); });
    Promise.all(jobs).then(function () {
      return S.dbOk ? Promise.all([window.TTDB.getAll('accounts'), window.TTDB.getAll('ledger')]) : [[], []];
    }).then(function (ex) {
      var json = C.serializeBackup(S.trades, shots, { accounts: ex[0], ledger: ex[1] }), n = Object.keys(shots).length;
      S.backupBlob = { name: 'tamhas-journal-backup-' + stamp() + '.json', json: json };
      ready.innerHTML = '<p class="note">Backup ready: ' + plural(S.trades.length, 'trade') + (incl ? ', ' + plural(n, 'screenshot') : '') + ', ' + plural(ex[0].length, 'account') + ', ' + plural(ex[1].length, 'account record') + ', ' + (json.length / 1024).toFixed(0) + ' KB.</p><button type="button" class="btn wide" data-act="bk-save">SAVE / SHARE FILE</button>';
    });
  }
  function saveBackupFile() {
    var b = S.backupBlob; if (!b) return;
    deliver(b.name, 'application/json', b.json).then(function (ok) { if (ok) { savePrefs({ lastBackup: Date.now() }); toast('Backup file created.'); } });
  }
  // Restores accounts and the account ledger from a version-2 backup. Existing records are never overwritten in merge mode.
  function restoreExtras(r, mode) {
    if (!S.dbOk) return Promise.resolve();
    var T = window.TTDB, DEF = T.DEFAULT_ACCOUNT_ID;
    if (!r.hasExtras) mode = 'merge';   // an older (version 1) backup has no accounts or records, so it must never erase yours
    return Promise.all([T.getAll('accounts'), T.getAll('ledger')]).then(function (cur) {
      var haveA = {}, haveL = {}, ops = [];
      cur[0].forEach(function (a) { haveA[a.id] = 1; }); cur[1].forEach(function (l) { haveL[l.id] = 1; });
      if (mode === 'replace') {
        cur[0].forEach(function (a) { if (a.id !== DEF) { ops.push({ store: 'accounts', type: 'del', key: a.id }); delete haveA[a.id]; } });
        ops.push({ store: 'ledger', type: 'clear' }); haveL = {};
      }
      (r.accounts || []).forEach(function (a) { if (!haveA[a.id]) { ops.push({ store: 'accounts', type: 'put', value: a }); haveA[a.id] = 1; } });
      (r.ledger || []).forEach(function (l) { if (!haveL[l.id]) { ops.push({ store: 'ledger', type: 'put', value: l }); haveL[l.id] = 1; } });
      // A restored trade must never point at a missing account: add a clearly named placeholder instead of silently re-assigning it.
      var AC = window.TTAccountsCore;
      S.trades.forEach(function (t) { var id = t.accountId || DEF; if (!haveA[id] && AC) { var n = AC.newAccount({ id: id, name: 'Restored account', category: 'other', note: 'Created during restore because trades referenced this account.' }); if (n.ok) { ops.push({ store: 'accounts', type: 'put', value: n.account }); haveA[id] = 1; } } });
      return T.batch(ops);
    }).then(function () { loadAccounts().then(function () { try { window.dispatchEvent(new Event('tt:accounts-changed')); } catch (e) {} }); });
  }
  function restoreFrom(file) {
    var rd = new FileReader();
    rd.onerror = function () { toast('Could not read that file.', true); };
    rd.onload = function () {
      var r = C.parseBackup(String(rd.result));
      if (!r.ok) { toast(r.error, true); return; }
      var mode = ($('input[name="bkmode"]:checked') || {}).value || 'merge';
      var res = C.mergeTrades(S.trades, r.trades, mode);
      var msg = mode === 'replace' ? 'Replace your whole journal (' + plural(S.trades.length, 'trade') + ') with ' + plural(r.trades.length, 'trade') + ' from this backup?' :
        'Add ' + plural(res.added, 'new trade') + ' from this backup' + (res.skipped ? ' (' + res.skipped + ' already here will be skipped)' : '') + '?';
      if (r.skipped.length) msg += '\n\n' + plural(r.skipped.length, 'row') + ' in the file could not be read and will be skipped.';
      if (!window.confirm(msg)) return;
      var before = S.trades.slice(); S.trades = res.trades;
      persist().then(function (ok) {
      if (!ok) { S.trades = before; toast('Could not save the restored journal (storage full or blocked).', true); return; }
      var addIds = {}; (mode === 'replace' ? r.trades : r.trades.filter(function (t) { return before.every(function (b) { return b.id !== t.id; }); })).forEach(function (t) { addIds[t.id] = 1; });
      var chain = Promise.resolve();
      chain = chain.then(function () { return restoreExtras(r, mode); });
      if (S.imgOk !== false) {
        if (mode === 'replace') chain = chain.then(function () { return IMG.clear(); });
        Object.keys(r.shots).forEach(function (k) { if (addIds[k.split(':')[0]]) chain = chain.then(function () { return IMG.put(k, r.shots[k]); }); });
      }
      chain.catch(function () { toast('Trades restored, but some screenshots could not be stored.', true); }).then(function () { changed(); render(); });
      if (S.dbOk) window.TTDB.getAll('quarantine').then(function (q) { return window.TTDB.batch(q.filter(function (x) { return x.kind === 'legacy-journal-unreadable' && !x.resolved; }).map(function (x) { x.resolved = true; return { store: 'quarantine', type: 'put', value: x }; })); }).catch(function () {}); // kept, just marked handled
      S.corrupt = false; S.rejected = 0; toast('Restored ' + plural(res.added, 'trade') + '.');
      });
    };
    rd.readAsText(file);
  }
  function wipeAll() {
    if (!S.trades.length) return;
    var a = window.prompt('This permanently deletes ' + plural(S.trades.length, 'trade') + ' and all screenshots from this device.\n\nType DELETE to confirm.');
    if (a !== 'DELETE') { if (a !== null) toast('Nothing was deleted.'); return; }
    var before = S.trades; S.trades = [];
    persist().then(function (ok) {
      if (!ok) { S.trades = before; toast('Could not delete (browser storage blocked).', true); return; }
      if (S.imgOk !== false) IMG.clear().catch(function () {});
      S.expanded = null; changed(); render(); toast('Journal cleared.');
    });
  }

  /* ---------- lightbox ---------- */
  function lightbox(src) {
    var o = document.createElement('div'); o.className = 'lightbox'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'Screenshot');
    o.innerHTML = '<img alt="Screenshot, full size"><button type="button" aria-label="Close">✕</button>'; o.firstChild.src = src;
    o.addEventListener('click', function () { o.remove(); }); document.body.appendChild(o);
  }

  /* ================= EVENTS ================= */
  root.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    var act = el.getAttribute('data-act');
    switch (act) {
      case 'tab': S.tab = el.getAttribute('data-tab'); render(); break;
      case 'new': openForm(null); break;
      case 'edit': openForm(el.getAttribute('data-id')); break;
      case 'delete': deleteTrade(el.getAttribute('data-id')); break;
      case 'cancel': S.editing = null; render(); break;
      case 'save': saveForm(); break;
      case 'toggle-card': var id = el.getAttribute('data-id'); S.expanded = S.expanded === id ? null : id; renderList(); break;
      case 'more': S.limit += 30; renderList(); break;
      case 'toggle-filters': S.filtersOpen = !S.filtersOpen; el.classList.toggle('on', S.filtersOpen); el.setAttribute('aria-expanded', S.filtersOpen); $('#jFilters').hidden = !S.filtersOpen; break;
      case 'clear-filters': S.filters = {}; S.limit = 30; render(); break;
      case 'clear-date': delete S.filters.date; render(); break;
      case 'ex-add': var l = $('#exList'); l.insertAdjacentHTML('beforeend', exRow('', '', false)); $('.exrow:last-child .ex-qty', l).focus(); break;
      case 'ex-del': var row = el.closest('.exrow'); if ($$('.exrow').length > 1) row.remove(); else { $('.ex-qty', row).value = ''; $('.ex-price', row).value = ''; } updatePreview(); break;
      case 'shot-remove': var sh = S.editing.shots[el.getAttribute('data-slot')]; sh.dataUrl = null; sh.changed = false; sh.removed = !!S.editing.id || sh.removed; renderShot(el.getAttribute('data-slot')); break;
      case 'basis': S.basis = el.getAttribute('data-b'); render(); break;
      case 'range': S.range = el.getAttribute('data-r'); render(); break;
      case 'cal-prev': S.cal.m--; if (S.cal.m < 0) { S.cal.m = 11; S.cal.y--; } render(); break;
      case 'cal-next': S.cal.m++; if (S.cal.m > 11) { S.cal.m = 0; S.cal.y++; } render(); break;
      case 'cal-today': var n = new Date(); S.cal = { y: n.getFullYear(), m: n.getMonth() }; render(); break;
      case 'cal-day': S.filters = { date: el.getAttribute('data-date') }; S.filtersOpen = false; S.tab = 'entries'; S.limit = 30; render(); window.scrollTo(0, 0); break;
      case 'csv-all': exportCsv(false); break;
      case 'csv-filtered': exportCsv(true); break;
      case 'bk-prepare': prepareBackup(); break;
      case 'bk-save': saveBackupFile(); break;
      case 'wipe': wipeAll(); break;
      case 'lightbox': lightbox(el.src); break;
    }
  });
  function onInput(ev) {
    var t = ev.target;
    if (t.hasAttribute && t.hasAttribute('data-f')) {          // search + filters
      var k = t.getAttribute('data-f'), val = t.value;
      if (val) S.filters[k] = val; else delete S.filters[k];
      S.limit = 30; renderList(); return;
    }
    if (!S.editing) return;
    if (t.id === 'f-qty') { var rs = $$('.exrow'); if (rs.length === 1) { var q = $('.ex-qty', rs[0]); if (q.getAttribute('data-auto') === '1') q.value = t.value; } }
    if (t.classList && t.classList.contains('ex-qty')) t.removeAttribute('data-auto');
    updatePreview();
  }
  root.addEventListener('input', onInput);
  root.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.name === 'bkmode') { S.restoreMode = t.value; return; }
    if (t.id === 'bkFile' && t.files && t.files[0]) { var f = t.files[0]; t.value = ''; restoreFrom(f); return; }
    if (t.type === 'file' && t.getAttribute('data-slot') && S.editing) {
      var slot = t.getAttribute('data-slot'), f2 = t.files && t.files[0]; t.value = ''; if (!f2) return;
      compressImage(f2).then(function (url) { var sh = S.editing && S.editing.shots[slot]; if (!sh) return; sh.dataUrl = url; sh.changed = true; sh.removed = false; renderShot(slot); })
        .catch(function (e) { toast(e.message || 'Could not use that image.', true); });
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-f')) { onInput(ev); return; }
    if (S.editing) updatePreview();
  });

  function loadFromDb() {
    return window.TTDB.getAll('trades').then(function (list) {
      var ok = [], bad = 0;
      list.forEach(function (raw) { var r = C.normalizeTrade(raw); if (r.ok) ok.push(r.trade); else bad++; });
      S.trades = ok; S.rejected = bad;
    }).then(function () { return window.TTDB.getAll('quarantine'); }).then(function (q) {
      // Unreadable earlier data was kept aside (never deleted). Keep telling the person until they dismiss it via backup/restore.
      S.corrupt = q.some(function (x) { return x.kind === 'legacy-journal-unreadable' && !x.resolved; });
    });
  }
  function loadAccounts() { return window.TTDB.getAll('accounts').then(function (a) { S.accounts = a.filter(function (x) { return x && x.id; }).sort(function (x, y) { return x.createdAt - y.createdAt; }); }).catch(function () {}); }
  window.addEventListener('tt:accounts-changed', function () { if (S.dbOk) loadAccounts().then(function () { if (!S.editing) render(); }); });
  function boot() {
    if (!window.TTDB || !window.indexedDB) { loadTrades(); S.loaded = true; render(); changed(); return; }
    window.TTDB.ready().then(function () { S.dbOk = true; return Promise.all([loadFromDb(), loadAccounts()]); })
      .catch(function () { S.dbOk = false; loadTrades(); })       // database unusable: fall back to the old localStorage journal
      .then(function () { S.loaded = true; render(); changed(); });
  }
  boot();
  window.TTJournal = { reload: function () { (S.dbOk ? loadFromDb() : Promise.resolve(loadTrades())).then(function () { render(); }); } };
})();
