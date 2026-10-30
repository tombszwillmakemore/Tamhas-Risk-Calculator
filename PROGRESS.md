# Tamhas Trading - Master Development Progress

Branch: `dev-free-platform` (never merged to `main` until the release candidate is approved).
Last updated: see the git log. This file is rewritten at the end of every stage.

## Constraints (unchanged)
Free and local-first (no paid services/APIs), no fabricated data, no broker passwords/secrets stored, read-only brokerage handling,
no invented firm rules, unknown shows as "-" (never $0), never silently delete data, tests are only reported as passed if actually run.

## Current stage
**Release 2.0.0 merged to `main` on 2026-10-30 at the owner's instruction ("make it live").** Stage J (Tradovate Smart Import) and Stage K (TRC install naming, startup/loading system, diagnostics) done and integrated with release 1.8.0 (registry, experience layer, Copilot, support, update bar), which had been merged to `main` separately. Previous `main` saved as `backup-main-before-v2`. Audit: AUDIT.md.
Previously: RELEASE CANDIDATE READY. Stages A-I and Final complete on `dev-free-platform`; main untouched. See RELEASE-CANDIDATE.md. Stages A (foundation), B (money) and C (scale-in fills + CSV import) are complete. Order: A foundation -> B money -> C import -> D journal v2 -> E analytics -> F risk -> G discipline -> H strategy lab -> I insights/health/onboarding/performance -> Final.

## Completed features
- Batch 0: IndexedDB platform, non-destructive legacy migration, PWA (manifest, offline service worker, icons), CSP.
- Batch 1: Accounts, editable prop-firm templates (17 researched firms with sources, 21 listed only), firm directory.
- Batch 2: Drawdown engine (static / EOD trailing / intraday trailing), evaluation tracker, rule versions + confirmation, ledger (fees, payouts, deposits, transfers, firm snapshots), CSV account columns, backup v2.
- Stage B: money core (`money-core.js`) + Money screen (overview, payout center, expense tracker, recurring costs with confirm-to-post, cost analysis by account and firm), optional 'received after split' on payouts, per-account payout readiness (only from numbers you enter), one shared toast.
- Stage A (partial): DB schema v3 (`docs` store), `TTStore`, shared UI kit (`TTUI`: dialogs, tooltips, SVG charts), light/dark/system theme, "More" hub with deep links + Back button, backup v3 (includes saved items).

## Remaining features
See the plan in the task list: B payouts/expenses/cost analysis - C scale-in fills + CSV import with rollback - D journal v2 - E analytics center - F risk center - G discipline - H strategy lab - I insights, system health, onboarding, performance - Final QA.
(Batch 3 from the original numbering - funded tracker, payouts, expenses, cost analyzer - was never built; it is Stage B.)

## Architectural decisions
- Static site, classic `<script>` globals, no build step, no dependencies. Pure-function "cores" are unit-tested in Node; UI is tested with Playwright.
- Money is integer cents. Missing data is `null` and renders as "-".
- IndexedDB `tt-platform` v3. Stores: meta, accounts, trades, quarantine, audit, ledger, docs. New features store `{id, kind, ...}` documents in `docs` (kinds whitelisted in `TTJournalCore.DOC_KINDS` so they are always backed up).
- Backup JSON v3 = trades + screenshots + accounts + ledger + docs. Older backups still restore; a backup without `docs` never erases saved items.
- Theme: CSS variables; `[data-theme=light]` overrides. Preference in localStorage (`tt.theme`, no flash via `theme-boot.js`) and mirrored into the database.
- Charts are hand-built SVG strings (`TTUI.lineChart/barChart/heatmap`) with text alternatives and tap/keyboard tooltips.
- Navigation: Home, Risk, Journal, Accounts, More (hub). Every section has a `#hash` deep link; modules re-render on the `tt:view` event.

## Test results
Recorded per stage below (only tests that were actually run).

## Known limitations
- Live GitHub Pages deployment is not verifiable from the build environment.
- Realized P&L is assigned to the trade's entry date (no exit time is stored yet; Stage C adds fills with times).
- Intraday trailing drawdown on an equity basis needs firm-reported figures (by design).
- Forex Factory has no verified free API; the Intel calendar stays on the bundled schedule data.
- Tradovate API stays disabled (needs a funded live account + paid API subscription). Smart Import of CSV, pasted tables and screenshots is the supported route.
- GC/MGC contract specs not yet verified against CME (Stage F verifies before adding).

## Next steps
Stage G: discipline - trading plans, pre-trade checklists, post-trade reviews, daily reflections, routines, goals, adherence/discipline scoring.

## Test log
- Stage A (run): stageA.js 24 passed; regression: engine 230, tracker e2e 54, backup/CSV 15, upgrade, migration, journal e2e, audit (XSS + 3,000 trades) all passed after updating assertions for the intentional changes (5-button nav, schema v3, backup v3). A flaky test (async waitForFunction does not await) was fixed with a polling helper.
- Stage B (run): bmoney.js 79 passed (costs, payouts, economics, recurring, readiness, validation); bmoney_e2e.js 38 passed (UI flows: add/void/duplicate prompts, ledger-vs-expense routing, post-once recurring, readiness section); full regression rerun: all green.
- Stage C (run): c1core 34 + c1e2e 13 (multi-fill model, FIFO P&L, per-lot risk, UI); c2core 78 (import engine: parsing, mapping, pairing, flips, duplicates, 20k fills < 4 s); c3e2e 42 (import UI in dark and light: preview writes nothing, import, re-import = all duplicates, overlapping export skips partly-known trades, rollback keeps an edited trade, journal save no longer erases trades it did not load). Safety fix: journal persist() is now diff-based. Full regression (20 suites) all green.
- Stage C notes: no broker presets (broker CSV headers could not be verified) - generic mapping with saved templates instead. Prices with more than 2 decimals are rejected, unsupported contracts skipped and listed, missing fees stay unknown. Realized P&L is still attributed to the entry date.
- Stage D (run): d1core 75 (labels, grades, custom values, filters, CSV 32 cols, periods incl. leap/year edges, review stats hand-checked, compare, bulk, label rename/merge, field/template/filter validation); d1e2e 54 in dark and light (setup field, v2 form fields, templates, saved filters, presets, select/compare/bulk, day review + reflection, rename-merge, field removal keeps values, backup round trip). Full regression (22 suites) green after updating the CSV column assertions (28 -> 32 columns; first 28 unchanged).
- Stage D notes: tags/emotions/mistake tags are free labels (case-insensitive de-duplication, 30 chars, caps 12/8/8); grade A-F measures plan execution; custom fields (text/number/choice/yes-no) live in docs kind `field`, values on `trade.custom` and are never deleted when a field is removed; templates never store prices/quantities/dates; custom field values are not in the CSV (they are in the JSON backup).
- Stage E (run): e1core 60 (hand-computed dataset: summary, Wilson interval, equity/drawdown incl. from-zero peak, histogram, 11 breakdown dimensions, heatmap, rolling, net/gross exclusions, layout validation, consistency with journal stats(), 5,000 trades < 2 s); e1e2e 50 in dark and light (empty state, KPIs, breakdown tabs, custom range, filters, layout customize + persistence + reset, no-fee/open banners, 3,000 trades render about 0.4 s, DOM under 6,000 nodes). Found/fixed duplicate element id (aRoot) with Accounts.
- Stage E notes: analytics counts closed trades only, drawdown is on closed-trade P&L (no percentages, starting balance unknown); heatmap/hour use entry time and report trades without a time; multi-label dimensions count a trade in each label; groups under 10 trades are flagged.
- Stage F (run): f1core 79 (position size incl. fees/rounding/cap and 2,000 randomized sizes never over risk and always maximal; reward:risk, net-of-fees, break-even price; loss-streak probability DP verified against brute-force enumeration; EV; open risk with FIFO lots; limits validation and evaluation; account context day/week/open risk; risk history); f1e2e 52 in dark and light (calculator incl. gold, limits save, exposure vs limits, scenarios, sequences, use-my-stats, history, backup). Instrument tests updated for 8 contracts; import test now uses CL as the unsupported example.
- Stage F notes: GC and MGC added after reading CME's "1 oz futures comparison" sheet (GC 100 oz, 0.10 = $10 tick -> $100/pt; MGC 1/10 of Gold, 0.10 = $1 tick -> $10/pt). Limits are only what the user enters (docs kind `risklimit`); firm rules are never assumed. Scenarios assume independent trades and are labelled as arithmetic, not forecasts. Open risk uses the initial stop; unknown stops are reported, never counted as $0.
- Known test-infrastructure note: tests currently live outside the repo (scratchpad) and use absolute paths; they are moved into `tests/` with a runner in Stage I so the release candidate is self-contained.


## Stage G - discipline (done)
Added `assets/discipline-core.js` (66 checks) and `assets/discipline.js` (54 browser checks, dark+light): trading plan, pre/post-trade checklists, routines, daily reflections, goals, and a discipline score (mean of measurable habits; ignores P&L; unmeasured habits shown as not measured, never 0). Mistake analysis is labelled association, not cause. Full regression: 22 suites green.


## Stage H - strategy lab (done)
`assets/strategy-core.js` (63 checks) + `assets/strategy.js` (62 browser checks, dark+light). Strategies (rules, status, link to journal by Strategy name), manual/pasted backtest results in R (nothing fetched or invented), journal results, forward-vs-backtest comparison, compare up to 4 sets with 95% ranges, Monte Carlo resampling (seeded, needs 20+ results), settings sweeps with earlier/later halves and an overfitting warning, show/hide sections. Limits: backtests are R-only entries (no tick replay, no market-data import); sweeps are risk-cap and trades-per-day only. Full regression: 25 suites green.


## Stage I + Final (done)
Insights (deterministic, no AI), System health (read-only audit + confirmed quarantine repairs), Getting-started card, migration tests from DB v1/v2/v3, offline/security/accessibility/performance checks, all tests moved into `tests/` with `node tests/run.js` (self-hosted server, relative paths). Final full run: 35/35 suites passed, plus `desk.js` (48 checks). Report: RELEASE-CANDIDATE.md.


## Stage J - Tradovate Smart Import (done)
`tradovate-core.js` (report detection: Orders, Performance, fills list, summary; fills rebuilt by id; reconciliation; OCR table builder), `ocr.js` + `vendor/ocr` (Tesseract core v5.1.1 and tessdata_fast English, Apache-2.0, run in a worker on the device), `import.js` rewritten as Smart Import (drop/choose/paste/clipboard/screenshots, review grid, account mapping with create-account, remembered settings and per-contract fees, preview with select/deselect, possible-duplicate and ambiguity review, success summary, history with report types, ranges, counts, saved copies and summary references). Engine extensions in `import-core.js` (pre-read fills, file P&L per trade, fingerprint duplicate check, enrichment hook) and `journal-core.js` (feeSource, srcInfo). Tests: tv1core 72, tv2e2e 93 (dark 390 px, light 1280 px, screenshot import at phone width, 2,000-trade import).
Notes: npm registry is blocked from the build environment, so Tesseract came from its GitHub repositories. Orders with multi-price average fills (more than 2 decimals) are listed, not guessed.

## Stage K - completeness (done)
TRC naming (manifest, Apple title, install guide, optional install step in the welcome and getting-started list), startup screen + shared loaders (`TTUI.skeleton/progress/busy/later/timeout`), animation settings, diagnostics + repair app files, backup reminder (`assets/platform.js`, `platform-core.js`).

## Merge with release 1.8.0 (done)
`main` had gained the registry, experience layer (search, help, tours, What's New), Copilot, support reporter and update bar. To avoid duplicate systems, this branch's own search, voice, help centre, tour, feedback and update banner were removed; Smart Import, Install TRC and the new actions are registered in `registry-core.js` (help, tours, Copilot phrases, release 2.0.0), Copilot learned import/install intents (+ tests), main's welcome mentions Tradovate import and offers optional install. My test files were renamed (p1core, p1e2e) because main already had x1core/x1e2e. Main's suites pinned to 1.8.0 now read the latest release from the registry.
Gate: `node scripts/predeploy.js` -> 46 of 46 suites, SAFE TO DEPLOY (2026-10-30).
## UX overhaul (done, merged)
New `assets/experience-core.js` (63 checks), `assets/experience.js`, `assets/experience.css`, `tests/x1e2e.js` (165 checks). Personal welcome (name, optional intro, interests, optional tour; skip/replay), greeting by name, favorites + recents + continue-where-you-left-off, customizable dashboard (show/hide/reorder/reset with undo), quick risk calculator, real-data week/today/recent-trades widgets, global search (Ctrl/Cmd+K, "/"), More hub grouped by category with pin stars, back-to-dashboard bar, Help page (glossary, shortcuts, what's new), keyboard shortcuts, compact mode, start-page setting, calculator memory/copy/clear/hints, toast UNDO, skip link, loading spinners. All stored locally, mirrored into backups. The stale "Coming next" panel was replaced by What's new. Existing suites use `tests/_pw.js` to skip the welcome screen. Known limits: tour highlights nav items rather than spotlighting inner controls; the attached brief was cut off after Phase 7 ("Don't add"). Final run: 37/37 suites.

## Release 2.0.1 - bottom navigation fix (done)
Report: the bottom bar did not stay at the bottom while scrolling on phones. Headless Chromium kept it pinned and no ancestor breaks `position: fixed`, so the fix targets mobile-browser behaviour:
`assets/nav-pin.js` pins the bar to the visual viewport (address bar / toolbar resizing) and hides it while the on-screen keyboard is open; `.nav` gets its own compositing layer (no flicker with the blurred background during momentum scroll); `html { scroll-padding-bottom }` keeps focused fields clear; `100dvh` fallbacks; `.app` uses `overflow-x: clip` (does not affect fixed positioning). Design, icons and navigation unchanged.
Tests: `tests/nav1e2e.js` (294 checks: 11 pages x 4 scroll positions at 390x844, 390x664, 412x915 and 1280x800, dark and light, 80-trade journal and 12 accounts, last control clear of the bar, bar on top and tappable, tabs work from scrolled pages, focused field above the bar, no fixed-breaking ancestors, simulated toolbar/keyboard/pinch-zoom, reduced motion, safe-area rules). Verified the suite fails without the fix. Real-device checks are listed in ROADMAP.md.

## Release 2.0.1 - Journal calendar containment (done)
Causes: the compact formatter produced long or misleading text ($999.99 -> "+$1000", $12,500 -> "-$13k", $1,000,000 -> "+$1000k"), cells had a fixed 11.5px value with no fitting, the * marker was glued to the value, and counts were hidden under 380px.
Fix: `TTJournalCore.moneyCandidates/countCandidates` give every exact form first, then rounded forms (each with its error; rounding always visible as ~ or K/M; minus never dropped). `fitCalendar()` measures each cell and picks the most precise readable text (exact at 13/9px, rounded within 1%, exact at 8px, then larger roundings). Cells are a 3-row grid (date top-left, value, count) in seven `minmax(0,1fr)` columns; * sits in its own corner; cells grow with larger text. If a cell cannot hold any readable value (e.g. 320px at 150% text) the calendar shows a coloured marker per day plus an exact day-totals list. Tapping a day shows the exact P&L and count. `TTUI.fitValues` shrinks then wraps large KPI/stat values app-wide.
Tests: cal0core (189 checks: exactness/flags/signs for all required amounts), cal1e2e (371 checks at 320/375/390/430/768/1280/1600, landscape, dark/light, zoom 1.3/1.5: ink boxes inside cells, no overlaps, nothing cut, >=8px, 7 equal aligned columns, date/count positions, exact values in labels and day view, 1/10/100/1,000 trades, dash for missing, other cards). Screenshots reviewed at 320, 375, 390, 844 landscape, 1280 and 320 large text.
