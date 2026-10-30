/* Tamhas Trading - problem reporting and friendly error handling.
   - Uncaught errors never blank the app or lose data: the person sees one calm message with a REPORT button.
   - Reports are written by the person and copied or opened as a GitHub issue THEY submit. Nothing is sent automatically,
     and diagnostics contain only app version, screen, browser type and screen size - never trades, balances or notes. */
(function () {
  'use strict';
  var REG = window.TTRegistry, U = window.TTUI, ISSUES = 'https://github.com/tombszwillmakemore/Tamhas-Risk-Calculator/issues/new';
  var recent = [], lastShown = 0, cur = 'home';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function base(u) { try { return String(u || '').split('?')[0].split('/').pop().slice(0, 40); } catch (e) { return ''; } }
  function note(kind, msg, file, line) {
    // Only the short message and file name are kept, in memory only (lost on reload). Long messages are clipped so pasted data cannot leak in.
    recent.push({ kind: kind, msg: String(msg || '').replace(/\s+/g, ' ').slice(0, 140), at: file ? base(file) + (line ? ':' + line : '') : '' });
    if (recent.length > 5) recent.shift();
  }
  function friendly() {
    var now = Date.now(); if (now - lastShown < 20000) return; lastShown = now;
    if (U && U.toast) U.toast('Something went wrong, but your data is safe. You can keep working.', true, { label: 'REPORT', fn: function () { openReport(); } });
  }
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) { note('load', 'Failed to load ' + base(e.target.src || e.target.href)); return; }
    if (!e.filename || e.filename.indexOf(location.origin) !== 0) return;       // cross-origin "Script error." and browser extensions are not ours
    note('error', e.message, e.filename, e.lineno); friendly();
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; note('promise', r && r.message ? r.message : r); friendly();
  });
  window.addEventListener('tt:view', function (e) { cur = e.detail && e.detail.name || cur; });

  function browser() {
    var ua = navigator.userAgent || '', os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
    var m = /(Edg|Firefox|FxiOS|CriOS|Chrome|Version)\/(\d+)/.exec(ua), name = !m ? 'Unknown browser' : m[1] === 'Edg' ? 'Edge' : (m[1] === 'FxiOS' || m[1] === 'Firefox') ? 'Firefox' : (m[1] === 'CriOS' || m[1] === 'Chrome') ? 'Chrome' : 'Safari';
    return name + (m ? ' ' + m[2] : '') + ' on ' + os;
  }
  function diagnostics(featureId) {
    var f = REG && REG.byId(featureId), standalone = false; try { standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) {}
    return { app: (REG ? REG.APP_NAME + ' ' + REG.APP_VERSION : 'Tamhas Trading'), feature: f ? f.title : (featureId || 'Not sure'), screen: cur, browser: browser(), viewport: window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x', mode: standalone ? 'installed (home screen)' : 'browser tab', online: navigator.onLine !== false, serviceWorker: 'serviceWorker' in navigator, recentErrors: recent.slice() };
  }
  function diagText(d) {
    return ['App: ' + d.app, 'Feature: ' + d.feature, 'Screen: ' + d.screen, 'Browser: ' + d.browser, 'Viewport: ' + d.viewport, 'Mode: ' + d.mode, 'Online: ' + d.online,
      'Recent errors: ' + (d.recentErrors.length ? d.recentErrors.map(function (x) { return '[' + x.kind + '] ' + x.msg + (x.at ? ' (' + x.at + ')' : ''); }).join(' | ') : 'none')].join('\n');
  }
  function buildReport(desc, featureId, withDiag) {
    var d = diagnostics(featureId), body = 'What happened:\n' + (desc || '(not described)') + '\n' + (withDiag ? '\n--- Diagnostics (no trading data) ---\n' + diagText(d) + '\n' : '');
    return { title: 'Problem report: ' + d.feature, body: body, url: ISSUES + '?title=' + encodeURIComponent('Problem report: ' + d.feature) + '&body=' + encodeURIComponent(body).slice(0, 5500) };
  }
  var open = null;
  function openReport(featureId) {
    if (open) return; var prev = document.activeElement, wrap = document.createElement('div'); wrap.className = 'xo'; open = wrap;
    var screens = REG ? REG.screens() : [], sel = featureId || (REG && REG.byId(cur) ? cur : '');
    wrap.innerHTML = '<div class="xcard" role="dialog" aria-modal="true" aria-labelledby="rpTitle" style="text-align:left;max-width:520px"><small class="k">REPORT A PROBLEM</small><h2 id="rpTitle">What went wrong?</h2>' +
      '<label for="rpDesc">Describe it in your own words</label><textarea id="rpDesc" class="xin" rows="4" maxlength="1500" placeholder="What did you do, what did you expect, and what happened instead?" style="width:100%"></textarea>' +
      '<label for="rpFeat" style="margin-top:12px">Which part of the app?</label><select id="rpFeat" class="xin"><option value="">Not sure</option>' + screens.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === sel ? ' selected' : '') + '>' + esc(f.title) + '</option>'; }).join('') + '</select>' +
      '<label style="display:flex;gap:8px;align-items:center;margin:12px 0 6px;text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" id="rpDiag" checked> Include app version, screen, browser type and screen size</label>' +
      '<pre id="rpPrev" class="note" style="white-space:pre-wrap;max-height:130px;overflow:auto;margin:0 0 10px"></pre>' +
      '<p class="note" style="margin:0 0 12px"><b>Nothing is sent automatically.</b> This never includes your trades, balances or notes. Copy the report, or open it as a GitHub issue that you submit yourself. GitHub issues are public, so please do not add account numbers or personal details.</p>' +
      '<div class="xact"><button type="button" class="btn" id="rpCopy">COPY REPORT</button><a class="btn ghost" id="rpGh" target="_blank" rel="noopener noreferrer" href="' + ISSUES + '" style="text-decoration:none;text-align:center">OPEN ON GITHUB</a><button type="button" class="btn ghost" id="rpClose">CANCEL</button></div></div>';
    document.body.appendChild(wrap);
    var $ = function (s) { return wrap.querySelector(s); };
    function refresh() { var r = buildReport($('#rpDesc').value, $('#rpFeat').value, $('#rpDiag').checked); $('#rpPrev').textContent = r.body; $('#rpGh').setAttribute('href', r.url); return r; }
    function close() { document.removeEventListener('keydown', key, true); wrap.remove(); open = null; if (prev && prev.focus && document.contains(prev)) try { prev.focus(); } catch (e) {} }
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; } if (e.key !== 'Tab') return; var f = Array.prototype.slice.call(wrap.querySelectorAll('button,a[href],textarea,select,input')).filter(function (x) { return !x.disabled; }); if (!f.length) return; var a = f[0], b = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); } }
    document.addEventListener('keydown', key, true);
    wrap.addEventListener('input', refresh); wrap.addEventListener('change', refresh);
    $('#rpClose').addEventListener('click', close); wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    $('#rpCopy').addEventListener('click', function () {
      var r = refresh(), done = function () { if (U) U.toast('Report copied. Paste it into an email or a GitHub issue.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.body).then(done, function () { fallback(r.body); }); else fallback(r.body);
      function fallback(t) { var ta = $('#rpDesc'); try { var tmp = document.createElement('textarea'); tmp.value = t; tmp.setAttribute('readonly', ''); tmp.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(tmp); tmp.select(); var okc = document.execCommand('copy'); tmp.remove(); if (okc) { done(); return; } } catch (e) {} if (U) U.toast('Could not copy automatically. Select the text above and copy it.', true); }
    });
    refresh(); $('#rpDesc').focus();
  }
  window.TTSupport = { openReport: openReport, diagnostics: diagnostics, buildReport: buildReport, recent: function () { return recent.slice(); }, note: note };
})();
