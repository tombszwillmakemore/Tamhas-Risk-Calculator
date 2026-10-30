/* Tamhas Trading - keeps the bottom navigation on the VISIBLE bottom of the screen on phones.
   position: fixed follows the layout viewport. On mobile browsers the visible area (visualViewport) can be shorter while the
   address bar or toolbar resizes (iOS Safari, Chrome, Samsung Internet) or while the on-screen keyboard is open. This script:
   - shifts the bar up by the difference, so it sits on the visible bottom (CSS variable --nav-shift, used in .nav's transform);
   - hides the bar while you type with the keyboard open, so it never covers the field you are typing in;
   - does nothing on wide screens (side rail) or in browsers without visualViewport (the plain CSS still pins the bar).
   No timers are left running: it reacts to viewport, scroll and focus events, throttled to one update per frame. */
(function () {
  'use strict';
  var nav = document.querySelector('.nav'); if (!nav) return;
  var wide = window.matchMedia ? matchMedia('(min-width: 900px)') : { matches: false };
  var queued = false, KEYBOARD_MIN = 120;
  function typing() { var a = document.activeElement; if (!a || a === document.body) return false; var t = a.tagName; return (t === 'INPUT' && !/^(checkbox|radio|button|submit|range|color|file|reset|image)$/i.test(a.type)) || t === 'TEXTAREA' || t === 'SELECT' || a.isContentEditable; }
  function update() {
    queued = false;
    var vv = window.visualViewport;
    if (wide.matches || !vv) { nav.style.removeProperty('--nav-shift'); nav.classList.remove('kb-hide'); return; }
    var gap = Math.round(window.innerHeight - vv.height - vv.offsetTop);   // hidden strip under the visible area, in CSS px
    var zoomed = vv.scale && Math.abs(vv.scale - 1) > 0.01;
    var kb = typing() && gap > KEYBOARD_MIN;
    nav.classList.toggle('kb-hide', kb);
    // Shift only for toolbar-sized differences; when pinch-zoomed or typing, leave the bar where the browser puts it.
    var shift = !kb && !zoomed && gap > 0 && gap <= KEYBOARD_MIN * 2 ? -gap : 0;
    if (shift) nav.style.setProperty('--nav-shift', shift + 'px'); else nav.style.removeProperty('--nav-shift');
  }
  function queue() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(update); }
  function bind() {
    var vv = window.visualViewport;
    if (vv && vv.addEventListener) { vv.addEventListener('resize', queue); vv.addEventListener('scroll', queue); }
    window.addEventListener('scroll', queue, { passive: true }); window.addEventListener('resize', queue);
    window.addEventListener('orientationchange', queue); document.addEventListener('focusin', queue); document.addEventListener('focusout', function () { setTimeout(queue, 60); });
    if (wide.addEventListener) wide.addEventListener('change', queue); else if (wide.addListener) wide.addListener(queue);
    window.addEventListener('tt:view', queue);
    update();
  }
  bind();
  window.TTNavPin = { update: update };
})();
