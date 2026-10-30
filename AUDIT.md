# TRC / Tamhas Trading — feature inventory and audit

Branch `dev-free-platform`, version 2.0.0 (2026-10-30). Every row below was checked by an automated test that was actually run
(`node scripts/predeploy.js`: **46 of 46 suites passed, SAFE TO DEPLOY**, about 3,500 checks). The table is generated from `assets/registry-core.js`,
the registry that drives search, Help, tours, What's New and Copilot; `tests/registry.js` fails if any feature is registered half-way.

## Inventory (generated from `assets/registry-core.js`)

| Feature | Status | Where | Docs | Tests | Known limits |
|---|---|---|---|---|---|
| Dashboard | Working | #home | Help: Your starting point: today's trading, favorites, recent tools and a qu… | x1e2e, integration | — |
| Risk calculator | Working | #calc | Help: Enter your stop distance in points and the dollar range you are willin… | s2test, f1core, copilot2e | — |
| Trade journal | Working | #journal | Help: Record every trade with entry, stop, exits, fees, notes, tags and scre… | e2e, d1e2e | — |
| Import trades | Working | #import | Help: Drop a Tradovate Orders or Performance report, paste a copied table, o… | tv1core, tv2e2e, c2core, c3e2e, copilot1 | Tradovate layouts from published headers, not a real export; screenshots tested on synthetic tables; no commissions in Tradovate reports unless you set yours; no live sync. |
| Risk center | Working | #risk | Help: Size positions from prices, see your open exposure against limits you … | f1core, f1e2e | — |
| Analytics | Working | #analytics | Help: Statistics, equity curve, drawdown, breakdowns by day, hour, strategy,… | e1core, e1e2e | Closed trades only; drawdown from zero peak. |
| Insights | Working | #insights | Help: Fixed rules look for patterns in your trades, such as repeated mistake… | i1core, i1e2e | — |
| Discipline | Working | #discipline | Help: Write your trading plan, build checklists and routines, reflect daily,… | g1core, g1e2e | — |
| Strategy lab | Working | #strategy | Help: Describe strategies, enter backtest results by hand, compare them with… | h1core, h1e2e | Backtests entered in R; no market data. |
| Accounts | Working | #accounts | Help: Track each account: firm rules, drawdown room, balance snapshots and p… | b1e2e, b2e2e | — |
| Money | Working | #money | Help: Record fees, subscriptions, payouts and deposits to see profit after r… | bmoney, bmoney_e2e | — |
| Market intel | Working | #intel | Help: A calendar of market-moving events you can import or edit, plus sessio… | s4test | No free verified events feed. |
| System health | Working | #health | Help: A read-only check of your saved data. Any repair is a separate, confir… | i1e2e, p1e2e | — |
| Help and glossary | Working | #help | Help: Glossary, feature guides with tours, keyboard shortcuts, what is new a… | x1e2e | — |
| Settings | Working | #settings | Help: Your name, theme, layout density, start page, market session windows a… | x1e2e, p1e2e | — |
| Install TRC | Working | #install | Help: Step-by-step instructions for adding TRC to your Home Screen on iPhone… | p1e2e, p1core | Final icon label is the editable box on iOS/Samsung; not tested on real phones. |
| TRC Copilot | Working | floating button | Help: A built-in assistant you can speak to or type to. It runs commands on … | copilot1, copilot2e | Rule-based, not an AI; voice depends on browser speech service. |
| ↳ Log a new trade | Working | #journal | search, Copilot | registry, integration | — |
| ↳ Change my name | Working | #settings | search, Copilot | registry, integration | — |
| ↳ Switch light or dark theme | Working | #settings | search, Copilot | registry, integration | — |
| ↳ Compact or comfortable layout | Working | #settings | search, Copilot | registry, integration | — |
| ↳ Replay the welcome tour | Working | #home | search, Copilot | registry, integration | — |
| ↳ Choose my start page | Working | #settings | search, Copilot | registry, integration | — |
| ↳ Customize my dashboard | Working | #home | search, Copilot | registry, integration | — |
| ↳ Download a backup | Working | #journal | search, Copilot | registry, integration | — |
| ↳ Edit market session windows | Working | #settings | search, Copilot | registry, integration | — |
| ↳ What's new | Working | #help | search, Copilot | registry, integration | — |
| ↳ Keyboard shortcuts | Working | #help | search, Copilot | registry, integration | — |
| ↳ Report a problem | Working | #help | search, Copilot | registry, integration | — |
| ↳ Import settings and commissions | Working | #import | search, Copilot | registry, integration | — |
| ↳ How to export from Tradovate | Working | #import | search, Copilot | registry, integration | — |
| ↳ Animations and startup screen | Working | #settings | search, Copilot | registry, integration | — |
| ↳ Repair app files | Working | #health | search, Copilot | registry, integration | — |

Also present and tested: legacy classic calculator page (`calculator-classic.html`, s3test), session clock (s5core), prop-firm templates (b1core), drawdown engine (b2core), migrations from DB v1–v3 (mig1e2e), XSS/accessibility/offline/performance checks (qa1e2e, audit), desk layout (desk.js).

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
| Installed app named TRC (manifest name/short_name, Apple title), site stays Tamhas Trading | Done (p1e2e, b0test). Final label on iOS/Samsung is the editable box; not testable on real phones here. |
| Install instructions: iPhone, iPad, Android/Pixel, Samsung; first optional onboarding step | Done (welcome final step + getting-started list), wording verified against current guides 2026-10-30 |
| Data safety: backup reminder, rollback, duplicates, quarantine, storage explanation | Done |
| Update safety | Update bar from 1.8.0 (never auto-reloads); cache bumped to tt-app-v5 with all new files; repair app files under System health |
| Universal search (/ and Ctrl+K) | Provided by release 1.8.0 (experience layer); Smart Import and Install TRC are registered so search finds them |
| Voice | Provided by TRC Copilot (1.8.0): rule-based, consent notice, text fallback. Taught: "import my tradovate report", "install the app" |
| Feedback | Provided by support.js (1.8.0): copy or prefilled GitHub issue, no trading data |
| Diagnostics | Done: version, offline support, connection, last import/backup, recent errors, repair |
| Startup screen + loading system | Done: removed as soon as the database is ready (no forced delay), 5 s failsafe, theme-aware, reduced/off settings, OS reduced motion; skeletons, indeterminate progress (never invented %), button spinners, cancel/timeout/retry for screenshot reading |
| Accessibility | Automated only: names on buttons, labels, keyboard search/tour, focus return, no horizontal scroll at 360–1280 px, reduced motion |

## Not verified / needs you
1. A real Tradovate Orders and Performance export, and a real screenshot, through Import (the most important check).
2. Real phones: install on iPhone/iPad Safari, Android Chrome, Samsung Internet; confirm the icon says TRC; offline launch.
3. Voice on a real device (automated browsers have no microphone; only the command grammar was tested).
4. Screen reader (VoiceOver/TalkBack) and colour contrast by eye.
5. GitHub Pages serving the new version after the merge (cannot be checked from here).
