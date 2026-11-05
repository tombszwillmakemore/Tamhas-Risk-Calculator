# TRC Cashflow - implementation report (release 2.3.0, 2026-11-05)

## 1. Features completed
- **One accounting engine** (`assets/cash-core.js`, `TTCash.summarize`). It works in exact integer minor units and is used by four places: the
  Cashflow screen, the personal account panel (`live-core.js` now delegates to it), the dashboard "Account balances" card and Copilot.
- **Tradovate Cash History import.** It runs through the existing Import screen and covers:
  - recognition of the report and the reading of its amount columns, proven from the file, or asked
  - account mapping, unknown types held, and broker corrections held
  - unreadable rows quarantined with their line numbers
  - estimated totals, an atomic write, undo, import history, and one import at a time across tabs
- **Safe intake.** ZIP archives are opened with limits, text is decoded from UTF-8 (with or without BOM), UTF-16 or Windows-1252, and
  spreadsheets and other file types are refused with an explanation.
- **Reconciliation.** Every account gets one of these states: Reconciled, Partially reconciled, Estimated, Outdated, Discrepancy detected,
  Insufficient data or Import error. Each comes with the exact difference, possible causes and freshness (latest record, last import,
  period, source).
- **Cashflow screen.**
  - **Overview:** balance, starting balance and its source, gross and net trading P&L, fees by type, deposits, withdrawals, account change and
    time-weighted return.
  - **Profit vs balance:** "why your profit differs from your balance", line by line.
  - **History and checks:** fee breakdown, balance history, discrepancies, broker balance checks, and "not counted, and why".
  - **By period:** daily, weekly and monthly tables with cumulative fees.
  - **Transactions:** search, date, type and "not counted" filters; sorting; 50 rows per page; the original source row of every record;
    CSV export with formula-injection protection.
- **Copilot.** It answers balance, fees, commissions, largest expense, deposits, withdrawals, "why profit differs" and "are my imports
  accurate" from the engine's summaries. It explains that it has no live balance, and it never changes financial records.
- **Risk Center.** A button fills round-trip fees from the selected account's own settings. It only happens when you tap it, and it is
  labelled as an estimate.
- **Discoverability.** Registry entry with help, FAQ, tour and voice phrases; release 2.3.0 in What's New; the Account balances card on the
  dashboard; and a link from the account panel.

## 2. Files changed
New:
- `assets/cash-core.js`, `assets/zip-core.js`, `assets/cashflow.js`
- `tests/cash1core.js`, `tests/zip1core.js`, `tests/cf1e2e.js`, `tests/_cashgen.js`
- `CASHFLOW-REPORT.md`

Changed:
- `assets/import.js`: Cash History flow and safe file reading
- `assets/live-core.js`: delegates to the engine
- `assets/accounts.js`: status, link, list of your own entries
- `assets/journal-core.js`: `cash` ledger records accepted in backups
- `assets/copilot-core.js`, `assets/copilot.js`, `assets/risk.js`
- `assets/experience-core.js`, `assets/experience.js`: dashboard card
- `assets/registry-core.js`, `assets/ui.css`, `index.html`, `sw.js` (cache `tt-app-v9`)
- `tests/copilot1.js`
- `DATA-INTEGRITY.md`, `ROADMAP.md`, `PROGRESS.md`

## 3. Architecture decisions
- **Layers.** Original rows (kept as `source.raw` with file, line, file hash and adapter version) → normalised `cash` ledger records
  (category + broker type + signed change + broker running balance) → journal trades (analytics) → authoritative cash (authority rule) →
  derived figures. Re-processing after a rule change re-reads the kept original rows.
- **Authority rule** (the double-counting guard). Inside the period an imported Cash History covers, it is the only source of cash. Journal
  trades (for example from a Performance report) and hand-entered deposits, withdrawals or fees in that period are listed as not counted
  and cross-checked:
  - a typed deposit that matches an imported one is just a duplicate
  - a typed deposit missing from the Cash History is a discrepancy

  Outside that period, journal trades and your entries are used, and the result is never called reconciled without a broker balance.
- **Storage.** Imported records live in the existing `ledger` store (type `cash`, deterministic id from account + broker key). That means
  they are included in backups, in cloud sync, and in the atomic IndexedDB transactions already used by imports. The prop drawdown
  tracker ignores them.
- **Fees.** Trading fees (commission, exchange, clearing, NFA, routing) reduce net trading P&L. Account fees (data, platform, inactivity,
  funding and other) reduce the balance only.
- **Opening balance.** It is never assumed to be zero. It comes either from you (labelled with the date) or from the first broker running
  balance (labelled). Changing it recalculates the balance and the status.
- **No balancing entries.** TRC never creates a record to make numbers match. Differences are shown with their amount.
- **Return.** Time-weighted, chain-linked daily, with deposits and withdrawals treated as happening at the start of the day. It is only
  shown when the broker confirms the data and every day starts above zero; otherwise it says "unavailable" and why. Percentages are the
  only floating-point values; money is always whole cents.

## 4. Broker formats actually supported
- **Tradovate Cash History CSV**, recognised by the field names of Tradovate's documented CashBalanceLog entity (`cashChangeType`, `amount`,
  `delta`, `timestamp`, `tradeDate`, ids) and readable variants. All 42 documented types are mapped. "FundTransaction" is split into
  deposit or withdrawal by its sign, and the preview says so.
  **Not yet tested on a real exported file**, because none was available. The preview always shows how it read the file.
- Tradovate Performance, Orders and fills reports, as before (trades).
- Any other CSV of trades through the column mapper. Other brokers' cash statements are not supported yet: there is no adapter, and TRC
  does not claim compatibility.

## 5. Tests executed and results (all run in this environment)
- `cash1core.js` (62 checks):
  - the brief's regression: exactly **$143.14**, net +$43.14, fees $60.16
  - re-import, reversed order and renamed copies change nothing
  - overlapping Performance trades are not double-counted
  - opening-balance change → discrepancy, and derived opening balance
  - undo/delete rebuild
  - hand-entered duplicates and missing deposits
  - partial, outdated, insufficient and estimated states
  - a missing row and an inconsistent statement are located
  - unknown types are held
  - sign and reading questions; decimal commas; parentheses; quoted newlines
  - invalid rows quarantined; identical legitimate records kept; the same id in two accounts kept apart
  - corrected statements; currencies not mixed; JPY minor units
  - combined view nets internal transfers
  - fee share hidden in a losing period
  - time-weighted return
  - formula injection neutralised
  - property tests: 25 random ledgers × 400 records, exact to the cent, order-independent and idempotent
  - 20,000 records summarised in under 1.5 s
- `zip1core.js` (12): extraction, path traversal, executables, spreadsheets and nested archives skipped, a real ZIP bomb, a ZIP bomb with a
  forged size, the file limit, encrypted entries, a damaged archive, UTF-8 BOM, UTF-16 and Windows-1252.
- `cf1e2e.js` (56, real Chromium at 390 and 1280 px):
  - import, preview, re-import and Performance overlap
  - Reconciled at $143.14 and the dashboard card
  - explorer filters, search, source rows and CSV export
  - undo, ZIP intake, spreadsheet refused and the sign question
  - Risk Center estimate only on tap
  - no horizontal overflow and no script errors
- `copilot1.js` (+9): cash answers match the engine, no live claim, no data → no guess, never deletes.
- `lv1core.js` (42, unchanged) still passes on the new engine.
- Full release gate: see the result recorded in `PROGRESS.md`.

## 6. Security protections
- **File intake limits.**
  - ZIP: at most 20 files; 25 MB per file and 60 MB in total after decompression; at most a 200:1 compression ratio; the real size is
    counted while inflating; unsafe names (`..`, absolute paths, drive letters) and encrypted entries are refused.
  - Spreadsheets and other binary types are refused.
  - Non-text bytes are rejected.
  - CSV limits (40 MB, 250,000 rows) are kept.
- **CSV export:** cells that start with `= + - @ tab CR` and are not plain numbers are prefixed with `'`.
- **Output escaping:** all values shown on screen are HTML-escaped. The existing Content-Security-Policy is unchanged.
- **Data location:** no data is sent anywhere. With a TRC login, records sync to your own row-level-secured cloud space, as before.
- **Privacy:** no broker credentials or account passwords are ever requested. Account numbers are shown only as the name in the file;
  the alias field refuses full account numbers.

## 7. Known limitations
- Real Tradovate Cash History exports have not been tested. Column names may differ: TRC refuses or asks rather than guesses, and other
  layouts can be reported.
- XLSX is not opened directly (save as CSV). PDF statements are not supported.
- **Currencies:** no currency conversion. Accounts in different currencies are never combined, and a non-USD account cannot use USD trade
  P&L outside a Cash History.
- **Unrealized P&L** is never available (no live prices). Imported data is always a historical snapshot.
- **Untested Tradovate types:** some (BrokerageFee, CashSettlement, SwapTrade, OptionsTrade) are mapped from their documented names only.
  Their real-world sign conventions are untested.
- **Cash History and the drawdown tracker:** the prop drawdown tracker does not use imported Cash History records.
- **Large files:** they are processed on the main thread. 20,000 records take under 1.5 s on a desktop; phones are slower, and a very
  large file may briefly pause the screen.

## 8. Remaining unresolved issues
- Physical iPhone Safari, the installed home-screen app, Android and screen-reader checks were not possible here. These need manual
  verification.
- The 60 edge cases listed in the brief are handled as follows:
  - Most are handled and tested.
  - Truncated reports, missing rows and an internally inconsistent statement are detected through the broker's running balance. Without
    a running balance in the file they can't be detected; the status then stays "Estimated" until you enter a broker balance.
  - Settlement dates versus execution dates: the trade date column is used when present.
  - Pending deposits and withdrawal reversals are recorded as the broker lists them.

## 9. Deployment status
See `PROGRESS.md` (updated at deployment) for the gate result, merge commit and GitHub Pages deployment.

## 10. Manual actions required
1. Export a real Tradovate Cash History (and a Performance report for the same period) and import both. Check that the Cashflow balance
   says "Reconciled" and matches the cash balance Tradovate shows. If anything is held or asked, report the column names and types
   (never the file itself).
2. If you use the TRC login, nothing extra is needed for cash records; they sync as ledger records.
