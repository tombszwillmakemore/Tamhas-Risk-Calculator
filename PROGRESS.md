# Tamhas Trading - Master Development Progress

Branch: `dev-free-platform` (never merged to `main` until the release candidate is approved).
Last updated: see the git log. This file is rewritten at the end of every stage.

## Constraints (unchanged)
Free and local-first (no paid services/APIs), no fabricated data, no broker passwords/secrets stored, read-only brokerage handling,
no invented firm rules, unknown shows as "-" (never $0), never silently delete data, tests are only reported as passed if actually run.

## Current stage
**Stage F - risk center** (next). Stages A-E complete (E = analytics center). Stages A (foundation), B (money) and C (scale-in fills + CSV import) are complete. Order: A foundation -> B money -> C import -> D journal v2 -> E analytics -> F risk -> G discipline -> H strategy lab -> I insights/health/onboarding/performance -> Final.

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
- Tradovate API stays disabled; CSV import is the supported route.
- GC/MGC contract specs not yet verified against CME (Stage F verifies before adding).

## Next steps
Stage F: risk center - position size, R:R, fee impact, break-even, streak/scenario simulations, custom limits and warnings; verify GC/MGC specs at CME before adding.

## Test log
- Stage A (run): stageA.js 24 passed; regression: engine 230, tracker e2e 54, backup/CSV 15, upgrade, migration, journal e2e, audit (XSS + 3,000 trades) all passed after updating assertions for the intentional changes (5-button nav, schema v3, backup v3). A flaky test (async waitForFunction does not await) was fixed with a polling helper.
- Stage B (run): bmoney.js 79 passed (costs, payouts, economics, recurring, readiness, validation); bmoney_e2e.js 38 passed (UI flows: add/void/duplicate prompts, ledger-vs-expense routing, post-once recurring, readiness section); full regression rerun: all green.
- Stage C (run): c1core 34 + c1e2e 13 (multi-fill model, FIFO P&L, per-lot risk, UI); c2core 78 (import engine: parsing, mapping, pairing, flips, duplicates, 20k fills < 4 s); c3e2e 42 (import UI in dark and light: preview writes nothing, import, re-import = all duplicates, overlapping export skips partly-known trades, rollback keeps an edited trade, journal save no longer erases trades it did not load). Safety fix: journal persist() is now diff-based. Full regression (20 suites) all green.
- Stage C notes: no broker presets (broker CSV headers could not be verified) - generic mapping with saved templates instead. Prices with more than 2 decimals are rejected, unsupported contracts skipped and listed, missing fees stay unknown. Realized P&L is still attributed to the entry date.
- Stage D (run): d1core 75 (labels, grades, custom values, filters, CSV 32 cols, periods incl. leap/year edges, review stats hand-checked, compare, bulk, label rename/merge, field/template/filter validation); d1e2e 54 in dark and light (setup field, v2 form fields, templates, saved filters, presets, select/compare/bulk, day review + reflection, rename-merge, field removal keeps values, backup round trip). Full regression (22 suites) green after updating the CSV column assertions (28 -> 32 columns; first 28 unchanged).
- Stage D notes: tags/emotions/mistake tags are free labels (case-insensitive de-duplication, 30 chars, caps 12/8/8); grade A-F measures plan execution; custom fields (text/number/choice/yes-no) live in docs kind `field`, values on `trade.custom` and are never deleted when a field is removed; templates never store prices/quantities/dates; custom field values are not in the CSV (they are in the JSON backup).
- Stage E (run): e1core 60 (hand-computed dataset: summary, Wilson interval, equity/drawdown incl. from-zero peak, histogram, 11 breakdown dimensions, heatmap, rolling, net/gross exclusions, layout validation, consistency with journal stats(), 5,000 trades < 2 s); e1e2e 50 in dark and light (empty state, KPIs, breakdown tabs, custom range, filters, layout customize + persistence + reset, no-fee/open banners, 3,000 trades render about 0.4 s, DOM under 6,000 nodes). Found/fixed duplicate element id (aRoot) with Accounts.
- Stage E notes: analytics counts closed trades only, drawdown is on closed-trade P&L (no percentages, starting balance unknown); heatmap/hour use entry time and report trades without a time; multi-label dimensions count a trade in each label; groups under 10 trades are flagged.
- Known test-infrastructure note: tests currently live outside the repo (scratchpad) and use absolute paths; they are moved into `tests/` with a runner in Stage I so the release candidate is self-contained.
