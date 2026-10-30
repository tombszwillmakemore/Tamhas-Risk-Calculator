/* Tamhas Trading - small platform rules (pure logic): when to remind about backups, and which install guide fits this device. */
(function (root) {
  'use strict';
  // Remind only when there is something to lose: trades exist and there has never been a backup, or the last one is 7+ days old
  // and trades were added since. A snooze hides it until the given time.
  function backupDue(o) {
    if (!o.trades) return { due: false };
    if (o.snoozeUntil && o.now < o.snoozeUntil) return { due: false };
    if (!o.lastBackup) return { due: true, reason: 'never' };
    var days = Math.floor((o.now - o.lastBackup) / 86400000);
    if (days >= 7 && o.changedSince !== false) return { due: true, reason: 'old', days: days };
    return { due: false };
  }
  function installTab(ua, platform, touchPoints) {
    ua = String(ua || '');
    if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    return 'android';
  }
  var api = { backupDue: backupDue, installTab: installTab };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TTPlatformCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
