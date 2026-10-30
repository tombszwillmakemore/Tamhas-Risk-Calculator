# Release quality checklist

Copy into the PR or release note and tick honestly. Do not tick what was not actually run.

## Before merging to `main`
- [ ] `node scripts/predeploy.js` prints **SAFE TO DEPLOY** (static, unit and browser suites all green; paste the summary).
- [ ] The new feature really works (manual walkthrough + screenshots at 390px and 1280px, light and dark).
- [ ] Existing features still work (full suite green, not just the new tests).
- [ ] Data intact: old backups restore; migration tests pass; nothing was deleted or overwritten silently.
- [ ] Feature integration complete (see CLAUDE.md): registry entry, nav/search/hub, tour, Copilot phrases and actions, help text, settings, accessibility, What's New release, `APP_VERSION`.
- [ ] Offline: new files in `PRECACHE`, `CACHE` name bumped; app loads offline after first visit.
- [ ] Update safety: update bar appears for a running app and does not reload by itself.
- [ ] Accessibility: keyboard path, labels, focus return, reduced motion, 44px targets.
- [ ] Copilot trustworthiness: no invented numbers, confirmations for changes, no order placement, mic stops when closed.
- [ ] Performance: Copilot stays lazy; no console errors; initial payload reported by `tests/integration.js` not worse without reason.
- [ ] Free-only: no new paid service, API key or billing (check actual limits of anything new).
- [ ] `ROADMAP.md` and `PROGRESS.md` updated; known limitations and manual-verification items listed.
- [ ] Backup branch of `main` created (`backup-main-before-<name>`).

## After deploying
- [ ] Load the live site in a fresh browser profile; open each tab; open Copilot.
- [ ] On an iPhone with the installed app: confirm the update bar appears and RELOAD shows the new version in Help (Version x.y.z).
- [ ] If anything is wrong, follow `ROLLBACK.md` immediately.

## Device matrix (record what was truly tested)
| Environment | Tested by | Result |
|---|---|---|
| Headless Chromium 390px / 768px / 1280px (automated) | CI / predeploy | |
| iPhone Safari (browser tab) | person | |
| iPhone installed home-screen app | person | |
| Desktop Chrome / Safari / Firefox | person | |
