/* Tamhas Trading - keeps several open tabs in step (e.g. the Home Screen app and a browser tab on the same device).
   When one tab saves trades, accounts or account records, the others drop their cached copies and reload from the
   database instead of working from stale data. Only event names travel between tabs; no data is copied or sent anywhere. */
(function () {
  'use strict';
  if (!window.BroadcastChannel) return;
  var bc; try { bc = new BroadcastChannel('tt-sync'); } catch (e) { return; }
  var NAMES = ['tt:journal-changed', 'tt:accounts-changed', 'tt:ledger-changed'];
  NAMES.forEach(function (name) {
    window.addEventListener(name, function (ev) { if (!(ev.detail && ev.detail.remote)) { try { bc.postMessage(name); } catch (e) {} } });
  });
  bc.onmessage = function (m) {
    var name = m && m.data; if (NAMES.indexOf(name) < 0) return;
    if (window.TTStore && window.TTStore.invalidate) window.TTStore.invalidate();
    if (name === 'tt:journal-changed' && window.TTJournal && window.TTJournal.reload) window.TTJournal.reload();
    if (name !== 'tt:journal-changed' && window.TTAccounts && window.TTAccounts.reload) window.TTAccounts.reload();
    // Re-announce locally so Home, Analytics, Risk, Money and Discipline refresh too. Marked remote so it is not echoed back.
    try { window.dispatchEvent(new CustomEvent(name, { detail: { remote: true } })); } catch (e) {}
  };
})();
