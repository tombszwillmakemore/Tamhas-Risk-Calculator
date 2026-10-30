# Tamhas Trading - release candidate report

Branch `dev-free-platform`. **Not merged into `main`.** Merge only after your review and approval (back up `main` first).
Everything is vanilla JS, no build step, no dependencies, no paid services, no network calls. All data stays in this browser (IndexedDB).

## Implemented
| Area | What you get |
|---|---|
| Foundation | IndexedDB v3 (accounts, trades, ledger, docs, quarantine, audit), safe migrations, backup/restore v3, PWA offline cache |
| Money | Fees, payouts, deposits, transfers, prop-firm tracker, drawdown tracking, firm research (sourced, editable) |
| Import | Generic CSV mapping with preview, atomic commit, history, rollback of unedited imports (no broker presets, no credentials) |
| Journal v2 | Scale-in fills, tags/emotions/mistakes/grades, custom fields, templates, saved filters, bulk edit, compare, review (day/week/month) |
| Analytics | 11 breakdown dimensions, equity/drawdown, heatmap, histogram, Wilson ranges, sample-size labels, customizable layout |
| Risk center | Position sizing (NQ, MNQ, ES, MES, GC, MGC...), reward:risk, exposure vs your own limits, scenarios, risk history |
| Discipline | Trading plan, pre/post-trade checklists, routines, daily reflections, goals, discipline score (ignores P&L), mistake analysis |
| Strategy lab | Strategies, manual/pasted backtests (R), journal results, forward-vs-backtest, compare 4, Monte Carlo (seeded), settings sweeps with in/out-of-sample halves |
| Insights | Deterministic rules over your trades (mistakes, busy days, worst week, consistency, setups, weak time buckets, process gaps, weekly summary). No AI |
| System health | Integrity audit (read-only), confirmed repairs that move data to quarantine (never delete), storage estimate, persist request |
| Onboarding | Getting-started card on Home and Insights, empty states with next actions |

## Tested (all actually executed: `node tests/run.js`, 36 suites)
- 35 suites green at last full run (before adding `desk.js`, which also passes: 48 checks).
- Pure-logic suites: money, drawdown, journal, import, analytics, risk, discipline, strategy, insights, health (~1,000 checks, including brute-force verification of the loss-streak math).
- Browser suites (Playwright Chromium, dark and light, 390px phone width): every screen, forms, validation messages, persistence, delete/rollback flows.
- Migrations: real v1, v2 and v3 databases built and upgraded (42 checks), plus legacy localStorage journal copy with the original left untouched.
- Offline: service worker active, app reloads offline, all new screens open offline.
- Security: hostile HTML in strategy names, notes, tags and rules is rendered as text across all views (no script execution, no inline handlers).
- Accessibility (automated only): every visible button has a name, every input a label, images have alt, no horizontal scroll at 360, 390, 768, 1280px.
- Performance, 5,000 trades, headless Chromium on this machine: cold load ~0.5-0.8s; screens 30-850ms; Monte Carlo 5,000 sims x 1,000 trades ~0.1s.

## Not done / known limits (nothing silently dropped)
- Intel calendar: no verified free API for economic events (Forex Factory has none), so events are manual/importable only.
- Tradovate and other broker APIs: not used (disabled/paid or credential-based). CSV import only, no presets.
- Prop-firm research: only rules with a source are included; gaps stay marked unverified.
- Backtests: you enter results in R. No market data download, no tick replay (would need paid data).
- Sweeps: risk cap and trades-per-day only. Custom field values are in JSON backup but not in CSV export.
- Analytics drawdown is on closed-trade P&L from a zero peak (no % because starting balance is unknown); realized P&L is attributed to entry date.
- Insights/Monte Carlo/sweeps describe your history; they are not predictions.
- Phones: tab strips with 6+ tabs scroll sideways.

## Needs manual verification by you
1. Real phone check (iOS Safari and Android Chrome): add to home screen, offline launch, keyboard behaviour on number fields, safe-area spacing.
2. Screen-reader pass (VoiceOver/TalkBack) and keyboard-only pass. Only automated checks were run.
3. Color-contrast in both themes by eye (not measured with a tool).
4. Import one of your real broker CSV exports end to end.
5. Open your real data after the upgrade: Journal count, Accounts balances, System health shows ALL GOOD. Download a backup first.
6. Prop-firm figures: confirm the firms you use against their current official pages before relying on them.
7. After merge: confirm GitHub Pages actually serves the new version (cannot be checked from here) and that the service worker updates (hard refresh once).

## How to run the tests
`npm i -D playwright` once, then `node tests/run.js` (all), `node tests/run.js core` (no browser), `node tests/run.js h1` (filter). Screenshots go to `tests/out/shots` (git-ignored).
