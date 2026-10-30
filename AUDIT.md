# TRC / Tamhas Trading — feature inventory and audit

Branch `dev-free-platform`, version 2.0.0 (2026-10-30). Every row below was checked by an automated test that was actually run
(`node tests/run.js`: **39 of 39 suites passed**, about 2,700 checks). The table is generated from `assets/help-data.js`, the same
registry that drives search, the help centre and voice navigation, and `tests/x1core.js` fails if a listed section or test file is missing.

## Inventory

| Feature | Status | Where (deep link) | Docs | Tests | Known limits |
|---|---|---|---|---|---|
| Home dashboard | Working | #home | Help centre, search | e2e.js, i1e2e.js | — |
| Import trades (Smart Import) | Working | #import | Help centre, search | tv1core.js, tv2e2e.js, c2core.js, c3e2e.js | Report layouts follow headers published by journal vendors, not a real account file. Screenshot reading was tested on synthetic tables. Orders filled at several prices need the Performance report. No commissions in Tradovate reports unless you set your own. |
| How to export from Tradovate | Working, with limits | #import › im-guide | Help centre, search | tv2e2e.js | Menu names come from published guides; Tradovate screens could not be checked without a login. |
| Import settings and commissions | Working | #import › im-settings | Help centre, search | tv2e2e.js | — |
| Install TRC on your Home Screen | Working | #install | Help centre, search | x1e2e.js | The browser or phone decides the final icon label in some cases; this cannot be tested on a real phone from here. |
| Guided tour | Working | #help | Help centre, search | x1e2e.js | — |
| Help centre | Working | #help | Help centre, search | x1e2e.js | — |
| Universal search | Working | #help | Help centre, search | x1e2e.js | — |
| Voice commands | Working, with limits | #help | Help centre, search | x1core.js, x1e2e.js | Uses your browser's speech service (not available in every browser; in Chrome and Safari the audio may be processed by Google or Apple). Fixed commands only, not an AI. |
| Report a bug or request a feature | Working | #feedback | Help centre, search | x1e2e.js | — |
| Trade journal | Working | #journal | Help centre, search | e2e.js, c1e2e.js, d1e2e.js | — |
| Quick and advanced journaling | Working | #journal | Help centre, search | d1e2e.js | — |
| Calendar and reviews | Working | #journal | Help centre, search | d1e2e.js | — |
| Backup and restore | Working | #journal › backup tab | Help centre, search | b2backup.js, d1e2e.js | — |
| Analytics | Working | #analytics | Help centre, search | e1core.js, e1e2e.js | — |
| Insights | Working | #insights | Help centre, search | i1core.js, i1e2e.js | — |
| Strategy lab | Working | #strategy | Help centre, search | h1core.js, h1e2e.js | — |
| Risk calculator | Working | #calc | Help centre, search | s2test.js, f1core.js | — |
| Risk centre | Working | #risk | Help centre, search | f1core.js, f1e2e.js | — |
| Accounts and prop firms | Working | #accounts | Help centre, search | b1e2e.js, b2e2e.js | — |
| Money | Working | #money | Help centre, search | bmoney.js, bmoney_e2e.js | — |
| Discipline | Working | #discipline | Help centre, search | g1core.js, g1e2e.js | — |
| Intel calendar | Working, with limits | #intel | Help centre, search | s4test.js | No free verified events feed; events are entered or imported. |
| Settings | Working | #settings | Help centre, search | e2e.js, x1e2e.js | — |
| Animations and startup screen | Working | #settings › animPick | Help centre, search | x1e2e.js | — |
| System health and diagnostics | Working | #health | Help centre, search | i1e2e.js, x1e2e.js | — |
| Repair app files (update problems) | Working | #health › diagRoot | Help centre, search | x1e2e.js | — |

Older features not in the search registry but still present and tested: legacy classic calculator page (`calculator-classic.html`, s3test), session clock (s5core), prop-firm templates (b1core), drawdown engine (b2core), migrations from DB v1–v3 (mig1e2e), XSS/accessibility/offline/performance checks (qa1e2e, audit), desk layout (desk.js).

## Tradovate Smart Import — what is verified and what is not
| Item | Status |
|---|---|
| Orders CSV layout | Matches the header list published by TradeZella and Edgewonk. **Not tested on a real Tradovate file.** |
| Performance CSV layout | Matches columns described by several journal tools (symbol, qty, buyPrice, sellPrice, pnl, bought/soldTimestamp, fill ids). **Not tested on a real file.** |
| Fills list | Recognised by column names only (needs `B/S` and `Contract`). Unverified layout, labelled as such in the preview. |
| Summary / balance reports | Recognised, saved as a reference, never turned into trades. |
| Fill grouping | FIFO, flat-to-flat, scale-ins, partial exits, reversals, multi-account; ambiguous same-second fills held for review (tv1core, 72 checks, hand-computed values). |
| Reconciliation | Per-trade check against Performance P&L to the cent, file total, optional typed total, missing commissions, unmatched accounts. Mismatches block import until confirmed. |
| Duplicates | Stable ids (order/fill ids), overlapping exports, and a second check that holds back the same trade arriving from another report or typed by hand. |
| Screenshots | On-device Tesseract (vendored, Apache-2.0), 3 passes merged cell by cell, low-confidence/invalid cells highlighted, editable grid. **Tested on synthetic tables (desktop and phone, dark and light), not on real Tradovate screenshots.** |
| Export instructions | From published guides (Edgewonk, Tradesyncer, TradeZella, SniperJournal). Tradovate screens could not be checked without a login; the guide says so. |
| Live API sync | **Not available.** Tradovate API access needs a funded live account and a paid API subscription. No passwords are ever requested. |

## Requirements checklist (latest instructions)
| Requirement | Result |
|---|---|
| Import Trades primary in Journal, prominent on Home, More hub, onboarding, tour, help, search | Done (tv2e2e, x1e2e) |
| Installed app named TRC (manifest name/short_name, Apple title), site stays Tamhas Trading | Done (x1e2e, b0test). Final label on iOS/Samsung is the editable box; not testable on real phones here. |
| Install instructions: iPhone, iPad, Android/Pixel, Samsung; first optional onboarding step | Done, wording verified against current guides 2026-10-30 |
| Data safety: backup reminder, rollback, duplicates, quarantine, storage explanation | Done |
| Update safety: versioned cache, version detection, update banner (only on real updates), repair app files | Done (x1e2e; a false banner on first visit was found and fixed) |
| Universal search (/ and Ctrl+K) | Done |
| Voice | Done with limits: browser speech service, off by default, fixed commands, privacy notice, text fallback |
| Feedback | Done: copy / download / prefilled GitHub issue; no trades or account names |
| Diagnostics | Done: version, offline support, connection, last import/backup, recent errors, repair |
| Startup screen + loading system | Done: removed as soon as the database is ready (no forced delay), 5 s failsafe, theme-aware, reduced/off settings, OS reduced motion; skeletons, indeterminate progress (never invented %), button spinners, cancel/timeout/retry for screenshot reading |
| Accessibility | Automated only: names on buttons, labels, keyboard search/tour, focus return, no horizontal scroll at 360–1280 px, reduced motion |

## Not verified / needs you
1. A real Tradovate Orders and Performance export, and a real screenshot, through Import (the most important check).
2. Real phones: install on iPhone/iPad Safari, Android Chrome, Samsung Internet; confirm the icon says TRC; offline launch.
3. Voice on a real device (automated browsers have no microphone; only the command grammar was tested).
4. Screen reader (VoiceOver/TalkBack) and colour contrast by eye.
5. GitHub Pages serving the new version after the merge (cannot be checked from here).
