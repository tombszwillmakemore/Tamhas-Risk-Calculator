# Tamhas Trading (TRC) - permanent development rules

These rules apply to **every** session, feature, fix and refactor. They are enforced by automated checks
(`node scripts/predeploy.js`). If a rule and a request conflict, stop and ask the owner; never quietly bend a rule.

## What this project is
A free, local-first futures trading management app on GitHub Pages: vanilla JS, no build step, no dependencies, no accounts,
no servers. All data lives on the person's device (IndexedDB/localStorage). Classic `<script>` globals (`TTRegistry`, `TTStore`, `TTNav`...).
Pure "core" modules (`*-core.js`) are Node-testable; UI modules are tested with Playwright in `tests/`.

Map: `assets/registry-core.js` (single source of truth for features) -> `experience-core.js/.js` (search, hub, dashboard, tours, help, What's New)
-> `copilot-boot.js` (button, lazy loader) -> `copilot-core.js` (brain) + `copilot-content.js` (lessons/coaching) + `copilot.js` (panel, speech, actions)
-> `support.js` (error handler, problem reporter) -> `pwa.js` + `sw.js` (offline, safe updates).

## Non-negotiables
- Never invent data. Unknown = `null` shown as "—", never `$0`. Never invent a firm's rules, balances or statistics.
- Never silently delete or overwrite user data. Destructive or important changes need an explicit confirmation and, where possible, UNDO.
- Never store brokerage passwords, API keys or secrets. Never add order execution. TRC is read-only about brokers (CSV import only).
- Never send private trading data to any third party. The only network request in the app is the service worker fetching our own files.
- Never claim a test passed unless it was actually run and passed. Report failures honestly.
- Never remove, replace or disable working functionality without explicit authorisation. Never replace real functionality with placeholders.
- Never merge unfinished work to `main`. Make a backup branch of `main` before each merge (`backup-main-before-<name>`).

## Audit before building
Before writing code: search the repo for what already exists (`grep`, the registry, `PROGRESS.md`, `ROADMAP.md`). Reuse existing functions
and stores (`TTStore`, `TTDB`, `TTUI`, `TTNav`, analytics/risk cores). Do not duplicate calculators or analytics. Do not rebuild a feature that exists.
Prefer the smallest safe change. Keep complexity low: no frameworks, no build tools, no new dependencies.

## Finish and test before adding
Completing, hardening and testing what exists beats adding new features. Before a new feature: confirm the current app has no failing tests and
no known critical bugs in `ROADMAP.md`. Verify real behaviour on iPhone Safari, the installed home-screen app, and desktop browsers. Where a
real device is not available, say so plainly and list it under "needs manual verification" in the release notes. Do not claim device testing that did not happen.

## Feature integration checklist (do ALL that apply; never ship a hidden feature)
1. Implement the feature (reuse existing code).
2. **Register it in `assets/registry-core.js`**: id, title, text, category, view, keywords, `since` (release id), perms, `help` (summary, how, faq),
   `tour` (steps with real selectors), `copilot` (does, where, how, voice phrases, data, actions, beginner). Add screens to `index.html` as `<section id="view-<id>" class="view">`.
3. Navigation/discovery: bottom nav or More hub (automatic from the registry), search, dashboard/quick access when it genuinely helps, Settings option if configurable.
4. Tours: the feature's own mini-tour comes from `tour` in the registry (remembered in `toursSeen`). Add it to `MAIN_TOUR` only if every new user must see it. Existing users get one quiet pointer per release and the dot on More; never force onboarding again.
5. Copilot: teach it. Add voice phrases; add actions in `copilot-core.js` (returns descriptors) and `copilot.js` (performs and verifies). Any change to user data needs a confirmation.
6. Help: guide text comes from `help` in the registry; add glossary terms and shortcuts (`registry-core.js`) when relevant.
7. Accessibility: labelled controls, keyboard operable, focus managed, `aria-live` for status, reduced-motion respected, 44px touch targets.
8. What's New: add a release to `RELEASES` (version, date, items, fixes, improvements, `features`), bump `APP_VERSION` (it is the newest release).
9. Data: new stored data must be included in backups (docs `kind` in `DOC_KINDS`, or `TTStore` prefs), migrated safely, and covered by a restore test.
10. Offline: add every new file to `PRECACHE` in `sw.js` and bump the `CACHE` name. Test desktop, phone and installed-PWA behaviour.
11. Run `node scripts/predeploy.js`. A feature is **not complete** until it passes, and a human-visible check (screenshots) looks right at 390px and 1280px.
Automated guards: `tests/registry.js` (metadata, help, tours, Copilot phrases, releases, search), `tests/integration.js` (every screen at 4 sizes, tour targets, a11y names, storage failures),
`tests/static.js` (references, offline cache, security scan, required docs).

## Protect user data
- Data formats are versioned. Any storage change ships with a safe migration that is tested with old data (see `tests/mig1e2e.js`, `b2upgrade.js`).
- Backup and restore must keep working: `TTJournalCore.serializeBackup/parseBackup` include trades, accounts, ledger, and all `docs` (incl. personal + Copilot prefs). Merge mode never overwrites; replace mode needs a typed/confirmed step.
- Damaged or blocked storage must degrade gracefully (defaults, a calm message), never crash or erase. Wrap every `localStorage` access in try/catch.
- Keep different people's data separate: no shared servers; each browser profile holds its own data. Say clearly that data is stored on this device only.
- Never put real account numbers, balances, emails or trades in the repository, tests or issues. Test fixtures must be synthetic.

## Updates must never interrupt active work (installed iPhone app)
- The service worker is network-first. A new version found while the app is open shows the small "Update ready - RELOAD" bar; **never auto-reload**.
- Updates never touch IndexedDB/localStorage. Bump `CACHE` in `sw.js` whenever precached files change.
- Never block the UI waiting for the network. Everything must work offline after the first load.

## Performance
Load large features lazily (Copilot is loaded on first open). No polling timers left running; remove listeners and DOM on close; stop the microphone and
speech whenever Copilot closes or the page is hidden. Animations must be compositor-friendly and disabled for `prefers-reduced-motion`. Keep the initial script payload modest (`tests/integration.js` reports it).

## Copilot must be trustworthy
Copilot is rule-based, not an LLM - say so. It must: use real TRC data; never invent balances or statistics; never claim an action worked unless the UI verified it
(actions are descriptors; `copilot.js` performs them and `compose()` reports the real outcome); explain unsupported requests; ask before changing anything important
(limits, reflections, memory, shortcuts) and offer UNDO where possible; never place or suggest placing live trades; never silently modify risk limits; distinguish education from
personal financial advice; never encourage revenge trading, chasing losses or bigger size; handle speech errors safely; show a consent notice before the microphone is first used.
Add a test for every new Copilot ability (`tests/copilot1.js`, `tests/copilot2e.js`).

## Report problems (errors and feedback)
`support.js` catches uncaught errors and shows a calm message with REPORT. The reporter writes diagnostics (app version, feature, browser, screen size only), copies them or opens a prefilled
GitHub issue the person submits. **Nothing is sent automatically** and diagnostics never include trading data. User-facing messages are plain language, never raw stack traces.

## Keep everything free
No paid APIs, subscriptions, billing-enabled cloud services or accounts. Check a service's real free limits before relying on it and write them down. If a capability cannot be done reliably
for free (live market data, broker APIs, server-side speech/LLM, cross-device sync), say so in `ROADMAP.md` under Technical limitations instead of faking it.

## Release gate
Run `node scripts/predeploy.js` (static checks + every unit and browser suite). It prints **SAFE TO DEPLOY** or **DO NOT DEPLOY**. If anything critical fails, do not merge to `main` and do
not push to the Pages branch. Follow `RELEASE-CHECKLIST.md`. Roll back with `ROLLBACK.md`. Update `ROADMAP.md` and `PROGRESS.md` at the end of every session.

## Roadmap upkeep
`ROADMAP.md` records completed, partial and planned features, known bugs, technical limitations and ideas. Update it whenever status changes. Check it first so work is not repeated.
