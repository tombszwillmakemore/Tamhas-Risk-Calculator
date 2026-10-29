# Tamhas Trading - Master Development Progress

Branch: `dev-free-platform` (never merged to `main` until the release candidate is approved).
Last updated: see the git log. This file is rewritten at the end of every stage.

## Constraints (unchanged)
Free and local-first (no paid services/APIs), no fabricated data, no broker passwords/secrets stored, read-only brokerage handling,
no invented firm rules, unknown shows as "-" (never $0), never silently delete data, tests are only reported as passed if actually run.

## Current stage
**Stage B - money tools** (next). Stage A (foundation) is complete. Order: A foundation -> B money -> C import -> D journal v2 -> E analytics -> F risk -> G discipline -> H strategy lab -> I insights/health/onboarding/performance -> Final.

## Completed features
- Batch 0: IndexedDB platform, non-destructive legacy migration, PWA (manifest, offline service worker, icons), CSP.
- Batch 1: Accounts, editable prop-firm templates (17 researched firms with sources, 21 listed only), firm directory.
- Batch 2: Drawdown engine (static / EOD trailing / intraday trailing), evaluation tracker, rule versions + confirmation, ledger (fees, payouts, deposits, transfers, firm snapshots), CSV account columns, backup v2.
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
Finish Stage A tests, commit, then Stage B.

## Test log
- Stage A (run): stageA.js 24 passed; regression: engine 230, tracker e2e 54, backup/CSV 15, upgrade, migration, journal e2e, audit (XSS + 3,000 trades) all passed after updating assertions for the intentional changes (5-button nav, schema v3, backup v3). A flaky test (async waitForFunction does not await) was fixed with a polling helper.
