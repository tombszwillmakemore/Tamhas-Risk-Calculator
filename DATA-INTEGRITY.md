# TRC data integrity: how trades, duplicates, accounts and time are handled

This page states the rules TRC follows so that every trade is counted once, every balance is correct, and nothing is
invented. The code that implements each rule is named so it can be checked. Last updated with release 2.2.0 (2026-11-05).

## 1. How a trade is counted (trade-counting methodology)

- **One trade = flat to flat** in one account and one contract. The first fill opens the trade; further fills in the
  same direction are **scale-ins**; opposite fills are **exits** (partial exits and scale-outs). The trade closes when the
  position is back to zero.
- A fill that **crosses zero** (for example long 1, then sell 3) closes the trade with the part that brings the position to
  zero, and the rest opens the next trade in the other direction (flat-to-reverse).
- Exits are matched **first-in, first-out**. P&L = (exit − entry) × quantity × the contract's point value
  (`assets/instruments.js`; for example MNQ $2, NQ $20, MES $5, ES $50 per point). Micro and standard contracts are
  separate contracts with their own point values.
- **Orders that never filled** (cancelled, rejected, working) are never trades: only filled quantity is used
  (`tradovate-core.js`, Orders report: rows with 0 filled quantity are skipped).
- **Open positions are not closed trades.** A position still open at the end of a report is saved as an open trade, has
  no P&L and is not counted in win rate, profit factor or any closed-trade statistic. A later report that contains the exit
  completes it (offered as an "updated trade").
- **Overnight trades and trades crossing midnight** stay one trade; the exit keeps its own date.
- **Contract months** are kept apart when computing duplicate keys (MNQ Dec-26 and MNQ Mar-27 executions are different),
  but trades are journaled by root contract (MNQ), because point values do not change between months.
- **Fees**: missing fees are *unknown*, never $0. Net P&L is shown only when every fee is known. Fees estimated from your
  own per-contract settings are marked "estimated" and are replaced by real fees from a later report (with your OK).
- **Corrections and busts**: TRC cannot see broker corrections. If a broker re-reports an execution with the same id but a
  different price or size, the import shows it as a **conflict** for you to decide; it is never applied silently.

Code: `assets/import-core.js` (`pairFills`), `assets/journal-core.js` (`compute`).

## 2. Duplicate detection

Every incoming trade (CSV, pasted table, screenshot, the trade form, backup restore, cloud) gets exactly one class
(`assets/dedupe-core.js`, `classify`):

| Class | Meaning | What happens |
|---|---|---|
| New | Not in the journal | Added when you confirm the import |
| Exact duplicate | Same execution ids, or the same account, contract, side, time, and every fill size and price | Skipped automatically, recorded in Import Review |
| Updated | Same trade with more or better information (missing or estimated fees, more fills) | Shown in the preview with a tick box; fee-added / completed trades are pre-ticked, changed fees are not |
| Possible duplicate | Similar but not provable: matches a trade typed by hand, time differs by whole hours (time-zone export), or may close a position still open in the journal | Held for your decision |
| Conflicting | Same execution ids but different prices or sizes, a different account, or ids spread over several trades | Held for your decision |
| Invalid | Cannot be read | Listed with the reason; never imported |

**Identity, strongest first**

1. **Execution keys** (`srcKeys`), one per fill. Tradovate fill ids (Performance and fills reports) and order ids (Orders
   report) are used when present. Without ids, the key is built from the normalised account, contract *with expiry*,
   side, size, price and the time **to the second**, plus a counter for identical executions in the same second.
   File names, row numbers, column order, import dates, P&L and sub-second precision are **never** part of a key.
2. **Fingerprint**: account + contract + side + date + time (minute) + every entry and exit size@price. Matched as a
   **multiset**: if a report really contains two identical trades, both are kept.
3. **Near match**: same everything except the time, shifted by whole hours (1–14 h) → only ever "possible".

Two trades in **different accounts are never duplicates** of each other (copy trading is normal). If most new trades are
identical to trades already in another account, the preview warns you to check the account choice.

Keys written by earlier versions are still recognised (each fill also carries its older key format as an alternate).

## 3. The Duplicate Archive (Import Review)

- Archived records are stored as `docs` of kind `dupe`, **not** in the trades store, so they can never reach P&L, the
  calendar, the dashboard, analytics or balances.
- Actions: Accept update · Keep existing · Confirm duplicate · Merge into my trade (hand-entered trade) · Restore as
  separate trade (shows the exact effect on your totals first) · Review later · Undo decision.
- Every decision is one atomic write plus an audit entry. Undo only reverses a change if the affected trade has not been
  edited since; otherwise TRC says so and changes nothing.
- TRC also scans the **active journal** for the same execution counted twice (for example after restoring an old backup
  in merge mode, or syncing two devices) and offers "Archive this copy" or "They are separate trades".

## 4. Import history and undo

- Each import has a unique batch id and stores: file names, time, target accounts, rows processed, trades detected,
  new / duplicates / updated / held / unreadable / unticked counts, the trade ids it added with a content hash of each,
  and a before-copy of every trade it updated.
- **Undo import** removes only the trades that import added and that are unchanged since (no edits, no screenshots), and
  reverses only the updates it applied where the trade is unchanged since. Trades that existed before are never touched.
- An import is **one IndexedDB transaction**: it either fully happens or not at all, so a crash, a closed tab or a
  refresh can never leave half an import. Retrying simply finds the trades already there.
- Only one import can be saved at a time across tabs (Web Locks, `trc-import`); the plan is rebuilt inside the lock.

## 5. Accounts and balances

Five account types: Personal live · Personal demo / paper · Prop firm evaluation · Prop firm funded · Other. They are
stored on the existing categories (`live`, `sim`, `prop` + status, `other`), so older data needs no migration.

Personal live and demo accounts never get prop-firm rules (no profit target, evaluation, trailing drawdown, payout or
consistency rules). Optional personal daily-loss alerts are labelled "your own alert, not a broker rule".

Balance (`assets/live-core.js`):

```
balance      = starting balance + net trading P&L + deposits − withdrawals ± adjustments − account fees + transfers in − transfers out
net trading  = gross P&L of closed trades − trading fees on those trades
```

- A deposit is not profit; a withdrawal is not a loss; unrealized P&L is never added (TRC has no live prices).
- Trades dated before the account's starting date are not counted (and are listed).
- Adjustments need a direction and a reason and are kept in the history. Starting-balance edits are logged with the old
  and new value.
- A **broker balance** entry is compared with TRC's calculation at the same moment; a difference is flagged with likely
  causes and is never "corrected" automatically.
- Accounts in a currency other than USD: TRC does not convert currencies, so the calculated balance is shown as unknown.

Worked example (tested in `tests/lv1core.js`): start $100, trade +$30 gross, fees $5, deposit $50, withdrawal $10 →
balance **$165**, net trading P&L **+$25**.

## 6. Time zones and dates

- Times **with** their own offset (`Z`, `+02:00`) are converted exactly.
- Times **without** an offset are read in the time zone you choose for the report ("Time zone of the times in your
  Tradovate reports"); "No conversion" keeps the wall time exactly as written. TRC never shifts a time silently: the
  preview shows the converted times and the setting used, and the import history stores it.
- Converted times are shown in **your device's time zone**. The journal date of a trade is the **calendar date of its
  entry in that time zone** (not the exchange trading-session date). A Sunday-evening futures session trade therefore
  appears on Sunday.
- Daylight-saving changes are handled by the browser's time-zone database (`Intl`), not by fixed offsets.
- If the same report is exported once in UTC and once in local time and read without conversion, the second copy is
  held as a possible duplicate ("time differs by whole hours"), never added.

## 7. Cloud sync protections (when a TRC login is used)

- Trades imported from a report get a **deterministic id** made from their execution keys, so the same report imported
  on two devices produces the same record; the server keeps one copy (primary key owner + kind + id).
- The server also refuses a trade whose execution keys already belong to another live trade of the same person
  (`trc_push` returns `duplicate`); the device keeps its copy and lists it for review. This is server-side validation,
  not only a client check (`cloud/supabase.sql`).
- Pushes are compare-and-swap and idempotent; retries never create new records. Deletes travel as tombstones, so a
  deleted duplicate cannot come back. Archived duplicates are `docs` and sync as such; they never become trades unless
  restored.
- Two devices that imported the same trade with only import metadata differing (import time, batch id) are recognised
  as the same trade during sync instead of raising a conflict.

## 8. Known limitations

- Fill ids are assumed to be unique across a person's Tradovate accounts (they are system ids). If two accounts ever
  report the same id, the record is held as a conflict rather than guessed.
- Reports **without ids** that start in the middle of a position cannot show the opening fills; TRC flags a possible
  continuation of an open journal position but cannot reconstruct fills it never saw.
- Fees are not part of identity: the same executions with different fees are offered as an update, not imported twice.
- Real Tradovate export files have not been available for testing; the layouts follow published headers and all tests
  use synthetic data (`tests/fixtures/README.md`).
- Device testing on a physical iPhone and the installed home-screen app has not been done in this environment; see
  `ROADMAP.md` → "needs manual verification".
