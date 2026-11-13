# PHASE F2: production opening readiness (2026-11-13)
Production: nothing written, nothing run against it. Every tool below was tested only on the LOCAL stand-in (085, 60
synthetic organizations) with synthetic data.

## 1. Production backup verification tool: scripts/goldia-prod-opening-backup.js
Production only. Staging, JFS demo, ERP and the typo ref are refused before any connection; the hook blocks it from Claude sessions without --local-rehearsal.
Every read runs in an explicit BEGIN TRANSACTION READ ONLY with a guard. The password is typed hidden.

| Mode | What it does | Writes |
|---|---|---|
| (default) check | identity (PG 17, not JFS, history 085, organization exists, no draft opening); QUIET WINDOW: no business write in any organization for --quiet-minutes (15); no other open transaction of the application roles; seller tills reported | none |
| --backup | + full dump (public, auth, storage, supabase_migrations; 3 attempts, keepalives, pg_restore --list), SHA256SUMS; business fingerprint (every row and column of 24 financial tables) identical before / after the dump; restore into a disposable local PG 17: row counts and fingerprint identical | none |
| --backup --write-verification | + fingerprint still identical to the dump; typed production ref + organization code; ONE row in financial_backup_verifications (organization, reference, dump SHA-256); prints the `--watch --expect <fingerprint>` command | 1 row |
| --watch --expect <fp> | read only: compares the fingerprint every N s until the restart row exists; any business write between the dump and the restart is reported (exit 2: the backup lacks it) | none |

Local rehearsal (evidence/phase-f2/):
* R1 / R2 check: PASS.
* R3 business write 0 min ago: STOP.
* R4 open transaction: STOP.
* R5 staging host: STOP.
* R6 backup: VERIFIED (77 tables, fingerprint identical).
* R7 write after the dump: STOP before the row.
* R8 backup + verification: 1 row, SHA-256 = SHA256SUMS.
* R9 second verification while one is unused: STOP.
* R10 / R11: watch CLEAN when nothing happened; WRITES SEEN for a write before or during the watch; the restart itself is not counted.

**Freeze design (no new migration).**
* Writes are stopped by procedure. The database proves it twice: the quiet-window gate before the dump, and fingerprint equality dump = copy = now before the verification row.
* The watch covers the gap up to the restart. The restart itself then makes the 085 draft guard refuse every ordinary financial write until the lock.
* In-flight transactions: the check STOPs while any other application transaction is open. A transaction that began earlier and commits later would change the fingerprint, so it is caught.
* Sessions: users stay logged in but must not work (announce + sellers hand over). The guard and the watch, not Auth changes, protect the data.
* Optional hardening, not built (needs migration 086 + a release): a director-set "financial freeze" flag checked by the same draft-guard trigger.
* Unfreeze / abort:
  * before the restart: just resume work; the unused verification expires after 24 h;
  * after the restart: work reopens only by the baseline lock;
  * undo of a restart: only a full restore of the verified dump (owner-approved; it also removes everything written after the dump).

## 2. Old balances: independent reconciliation (read only)
supabase/release/opening_old_balances_recon_readonly.sql runs through `run-readonly-checks.ps1 -Target production-opening-recon` (history must be 085), together with 01_baseline.
Output is per seller (employee name) plus totals; no customer data. Tested on the stand-in: for every seller the stored obligation = the independent recomputation (RESULT OK).

| Column | Meaning (585 g) |
|---|---|
| held_obl_g | obligation of pieces still in the seller's hands (unsold inventory) |
| sold_obl_g | obligation of goods already sold / cut (consignment obligation minus held) |
| legacy_obl_g | old customer debts assigned to the seller |
| opening_obl_g | 085 opening obligations (0 before the restart) |
| settled_g | everything handed to the manager / factory (reversed excluded; returns and reversed sales already excluded upstream) |
| recomputed_owes_g | max(0, held + sold + legacy + opening - settled): the system formula, recomputed independently |
| cust_debt_g / cust_uzs / cust_usd | open debts of HIS customers |
| till_* | cash / USD / LOM still recorded in his till |
| unexplained_g | recomputed - held - customers' 585 debt. **> 0**: till money, currency debts, or goods / money to find. **Small < 0**: company markup difference |

Risks are counted too: customers without a seller holding a balance; debt and advance at once; the same customer with 585 AND currency balance (possible double entry).

**Rules for the real opening (no double counting):**
* the seller's obligation to the manager = his unsold goods x (1 + seller %) + the debts of HIS customers (snapshot) + other proven seller debts (D);
* a sold item appears ONCE: as the customer's debt (E or F), never also as seller inventory (B) or an extra seller obligation (D);
* a customer's debt is entered ONCE: either in 585 g (E) or in UZS / USD (F), not both for the same goods;
* UZS / USD: 585 g = UZS / 585 rate, or USD x USD rate / 585 rate, frozen at the opening (snapshot).

### Three examples
1. **Unsold goods only.**
   * Seller A holds 30 g (pieces 10 + 20), seller rate 12 %.
   * Enter B: pieces "10 20", 12 %, source = the A batch.
   * Result: seller stock 30 g, obligation 33.6 g, manager stock -30 g. Factory obligation unchanged: it was counted in A.
2. **Sold, not paid.**
   * Seller B sold 20 g; customer K still owes 23 g (585).
   * Enter E: K, debt, 23 g; K is assigned to seller B, so B's obligation is +23 g. Do NOT enter the 20 g again in B or D.
   * Factory side: if those 20 g are not paid to the factory, enter C: 20 x 1.08 = 21.6 g (sold, not paid). This is the company's debt to the factory, a different counterparty: no double count.
3. **Currency debt, cash handover, other seller debt.**
   * Customer M (seller C) owes 4 300 000 UZS; T0 585 rate 860 000. Enter F: UZS, debt, 4 300 000, 585 rate 860 000. Snapshot 5 g; C's obligation +5 g.
   * Seller C hands 2 000 000 UZS to the manager before T0. It is part of G (manager cash); his till is 0.
   * C also owes 1.5 g for a missing piece: enter D: 1.5 g, reason required.
   * Seller C obligation = 0 (stock) + 5 + 1.5 = 6.5 g.

## 3. Factory obligation
Factory obligation = A (all goods received, still with the manager OR the sellers) x (1 + factory %)
+ B without a source (goods only with a seller, not in A) x (1 + factory %)
+ C (sold, not paid)
- C2 (advance given to the factory).
Later factory payments (refined gold / scrap handovers) lower it.

The manager -> seller move (B with source A) never changes it. The seller obligation is to the manager, a separate ledger:
the same goods appearing on both sides is correct, not a double count. The ONLY double count is entering the seller's goods in A and
also in B without a source. The template's "Jamlama" shows exactly this split.

Gold or advances already given to the factory before T0: subtract them from C, or enter C2 when more was given than is due.

## 4. T0
* The server stores T0 as given and dates the opening documents at T0's Tashkent business date. T0 cannot be corrected in a draft (a second restart is refused).
* Frontend fix (src/components/sales/OpeningAccountingSection.tsx + src/lib/business-date.ts, tested):
  * T0 is read as a Tashkent wall-clock time and sent as +05:00, whatever the browser's time zone;
  * the page shows "T0 = dd.mm.yyyy hh:mm (Toshkent)" before the button;
  * a future T0 or one older than 24 h disables the button;
  * stored T0 and backup times are displayed in Tashkent.
  * Unit tests: 16 / 16 PASS under TZ = America/New_York, Asia/Tokyo and UTC.
* Server-side enforcement (T0 <= now and >= now - 24 h inside rpc_financial_restart) needs migration 086: proposed, not built.
* Procedure: T0 = the moment after the last correction and the count, right before the restart; sellers hand all UZS / USD / LOM to the manager before T0 (opening seller tills = 0, a lock gate).

## 5. Template audit (goldia-opening-template.xlsx, regenerated)
| Check | Result |
|---|---|
| sheet = page type | A..J = the 11 kinds of /sales/app/opening (C and C2 on one sheet with a type column); columns = the form fields |
| formulas | factory = g x (1 + %), seller = g x (1 + %), UZS / 585 rate, USD x USD rate / 585 rate, LOM / fine x proba / 585, fine x proba / 1000. Filled with the F1 example and recalculated (LibreOffice): Jamlama = server results (40 / 60 / 123 / 88.6 / 10 / 8 600 000 / 100 / 50 / 5 000 000 / 300 / 12.8205 / 34.1538) |
| physical vs 585 | separate columns: A / B physical grams of 585 goods (other probas: H, I or J); H / I physical + proba + 585 equivalent; C / D / E in 585 g |
| added | per row "document number after entry" and "counted / confirmed by" columns; 585-proba note on A / B |
| real data | not filled; it has no customer data |
| limitation | Jamlama "Sahifada" values are typed by hand from the page's reconciliation |

## 6. Verdict
**F2 tooling: GO** (all local rehearsals pass). **Production restart: NO-GO** until:
1. **A2 frontend release** (T0 fix; DB stays 085): staging deploy + smoke, then the production frontend. Runtime change, so the normal release path, not -TestedCommit.
2. **Owner decisions:**
   * customer debts belong to the seller's obligation, or customers must be unassigned;
   * real balances collected and confirmed in the template;
   * T0 and the stop-work window.
3. **Production read-only run:** `run-readonly-checks.ps1 -Target production-opening-recon`, then review the unexplained grams per seller.
4. **Separate approvals, in order:**
   * (a) A2 release;
   * (b) backup + verification row (tool, in the window);
   * (c) restart by the director;
   * (d) opening documents;
   * (e) baseline lock.

### Practical sequence on the day
1. Day before: read-only recon + template filled and confirmed.
2. Stop work; sellers hand over money and LOM; nobody enters operations.
3. `node scripts\goldia-prod-opening-backup.js --org <id>` (check), then `--backup --write-verification`.
4. Second window: `--watch --expect <fp>`.
5. Director: /sales/app/opening -> T0 (Tashkent), reason, this backup, typed phrase -> restart.
6. Watch must say CLEAN.
7. Manager: enter the template rows A..J, writing the document number into the sheet.
8. Reconciliation all green + Jamlama = page.
9. Lock with the USD rate.
10. Read-only check, then real work starts.
