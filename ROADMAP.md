# TRC roadmap and status

Last updated with release 2.0.1 (2026-10-30). Honest status; check here before building anything.

## Completed
- Risk calculator (contracts from stop and dollar range; NNQ, NES, MNQ, NQ, MES, MGC, GC, ES with CME point values), remembered inputs, copy result.
- Trade journal (entries, calendar, notes, tags, screenshots, custom fields), CSV import with preview and undo, JSON backup and restore (merge or replace), CSV export.
- Accounts and prop-firm profiles with editable, sourced rules; drawdown tracker; fees, payouts and deposits ledger; Money view.
- Analytics (R multiples, expectancy, drawdown, breakdowns, heatmaps, sample-size labels), Risk center (sizing, limits you set, exposure, scenarios), Insights (rule-based), Discipline (plan, checklists, routines, reflections, goals, score), Strategy lab (manual backtests, comparisons, Monte Carlo), System health.
- Experience layer: welcome, tours, search (Ctrl/Cmd+K), personal dashboard with widgets, favorites, recents, compact layout, help and glossary, keyboard shortcuts.
- **Release 1.8.0:** central feature registry; per-feature mini-tours remembered per feature; What's New with release history and unseen dot; problem reporter and friendly error handler; PWA update bar; TRC Copilot (typed and spoken); automated registry, integration, static and pre-deploy checks.

- **Release 2.0.0:** Tradovate Smart Import (Orders, Performance, fills lists, summary reports; CSV, pasted tables, on-device screenshot reading with review grid; FIFO fill grouping with scale-ins, partial exits and reversals; reconciliation against the report's P&L; account mapping incl. evaluation/funded/live/sim with remembered choices; your own commission per contract; duplicate and possible-duplicate protection; select/deselect; history with ranges, counts, saved copies, summary references and rollback). Install TRC guide and TRC Home Screen name. Startup screen (no forced delay) with reduced/off settings, shared loading components, backup reminder, diagnostics and repair app files. Copilot understands "import my tradovate report" and "install the app".

- **Release 2.0.1:** bottom navigation pinned to the visible bottom on phones (visual-viewport pinning for address-bar/toolbar changes, hidden while the keyboard is open, own compositing layer, safe-area and `dvh` units, focused fields kept clear via scroll padding). Regression suite `tests/nav1e2e.js`.

## Partially implemented
- Tradovate layouts follow header lists published by journal vendors; not yet checked against a real Tradovate export. Orders with several fill prices (average with more than 2 decimals) are listed for manual entry or the Performance report.
- Screenshot reading tested on synthetic Orders tables (desktop and phone, dark and light). Real Tradovate screenshots, other report tables and low-resolution images may need more corrections in the review grid.
- Copilot voice: depends on the browser's Web Speech API. Typed use works everywhere. Spoken input is not available in every browser and some iPhone home-screen apps (see limitations).
- Copilot conversation: rule-based understanding of a fixed set of requests, with context for follow-ups and corrections. Not open-ended.
- Tours highlight a registered control per screen; they do not walk through every inner control.
- Mobile tab strips with 6+ tabs scroll sideways (by design) rather than wrapping.

## Known bugs / needs manual verification
- Bottom navigation on real devices: scroll long Journal/Accounts pages on iPhone Safari, the installed TRC app, Chrome on Android and Samsung Internet; open the keyboard in a form. Address-bar and keyboard behaviour were simulated, not tested on a phone.
- Import a real Tradovate Performance and Orders CSV and a real screenshot; compare totals with Tradovate.
- Confirm the Home Screen icon label says TRC on iPhone/iPad Safari, Android Chrome and Samsung Internet.
- Not verified on a physical iPhone, an installed home-screen app, VoiceOver or Android in this environment (all automated tests ran in headless Chromium with mocked speech APIs). Please test: install to home screen, update bar, microphone prompt, spoken replies, keyboard-open layout of the Copilot panel.
- GitHub Pages deployment status could not be queried from the build environment; confirm the live site after each merge.
- Screen-reader announcements and colour-contrast in light theme were checked structurally (labels, roles, live regions) but not with a screen reader or a contrast tool.

## Planned improvements
- Copilot: an "ask about this screen" mode that explains the numbers currently visible; richer date phrases ("two weeks ago"); user-defined lesson notes.
- Tour: highlight inner controls (add/edit steps) per feature in the registry.
- Backup reminders tied to the update bar; automatic JSON backup file naming with account labels.
- CI: run `scripts/predeploy.js` on every push (workflow file included in `.github/workflows/ci.yml` when the repository token allows).

## Technical limitations (cannot be done reliably for free)
- **No large language model.** Free infrastructure cannot provide unrestricted conversation. Copilot is deterministic; it says when it does not understand.
- **Speech recognition** uses the browser's own service (Chrome/Safari may send audio to Google/Apple). A fully offline engine would be a large download; not included.
- **No live market data, no economic-calendar feed** with a verified free API; events are imported/entered by the user.
- **No broker connections or order execution** (by design: read-only, CSV only; no secrets stored). Tradovate's API needs a funded live account (about $1,000) and a paid API subscription, so live sync is not offered.
- **Screenshot reading** uses a bundled Tesseract engine and English model (about 12 MB, cached on first use); accuracy depends on image quality and every value is shown for review.
- **No cross-device sync or accounts**: data is per browser. Backups are manual files.
- iOS may evict site storage for sites not added to the home screen; keep regular backups.

## Future ideas
- Optional local-only encrypted backups; per-account dashboards; trade replay notes; printable weekly review; more instruments with verified specs; a guided "set up your risk rules" wizard; in-app changelog diff for accounts rules edits.
