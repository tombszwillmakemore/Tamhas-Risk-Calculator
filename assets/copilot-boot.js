/* TRC Copilot launcher. Tiny and always loaded: draws the floating button and loads the real assistant (copilot-content.js,
   copilot-core.js, copilot.js) only the first time it is opened, so the rest of the app stays fast. Ctrl/Cmd + J toggles it. */
(function () {
  'use strict';
  var loading = null;
  function toast(m, err) { if (window.TTUI && window.TTUI.toast) window.TTUI.toast(m, err); }
  var fab = document.createElement('button');
  fab.type = 'button'; fab.id = 'copilotFab'; fab.className = 'cp-fab'; fab.setAttribute('aria-label', 'Open TRC Copilot'); fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="cpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2de2ff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><circle cx="16" cy="16" r="12" fill="none" stroke="url(#cpg)" stroke-width="2"/><path d="M9 16h2.5l2-5 3.5 10 2-5H23" fill="none" stroke="#e9f1ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="cp-fab-t">Copilot</span>';
  function add(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { s.remove(); rej(new Error('load ' + src)); }; document.head.appendChild(s); }); }
  function load() {
    if (window.TTCopilot) return Promise.resolve(window.TTCopilot);
    if (loading) return loading;
    fab.classList.add('loading');
    loading = add('assets/copilot-content.js').then(function () { return add('assets/copilot-core.js'); }).then(function () { return add('assets/copilot.js'); }).then(function () { fab.classList.remove('loading'); return window.TTCopilot; })
      .catch(function (e) { loading = null; fab.classList.remove('loading'); throw e; });
    return loading;
  }
  function open() { return load().then(function (c) { return c.open(); }).catch(function () { toast('Copilot could not load. Check your connection and try again.', true); }); }
  function toggle() { if (window.TTCopilot && window.TTCopilot.isOpen()) window.TTCopilot.close(); else open(); }
  fab.addEventListener('click', toggle);
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key || '').toLowerCase() === 'j') { e.preventDefault(); toggle(); } });
  function mount() { document.body.appendChild(fab); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.TTCopilotBoot = { open: open, toggle: toggle, load: load, fab: fab };
})();
