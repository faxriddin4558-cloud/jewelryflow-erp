# PHASE F1: real opening accounting, preparation (2026-11-13)
Production: not touched (no restart, no baseline, no opening document, no synthetic test).
Staging: read-only queries only. Staging org C is LOCKED, so it was not restarted again. The demonstration ran on a LOCAL stand-in
(schema 085, 60 synthetic organizations with old history), through the real 085 RPCs as the real users (the same calls the page makes).

## 1. Demonstration (harness/f1-opening-demo.js, evidence/phase-f1/local-opening-demo.json): 7/7 PASS
| # | Check | Result |
|---|---|---|
| F1-1 | restart: wrong phrase refused, manager refused (director only); with the exact phrase all old balances -> 0, customers / phones / seller assignment / employees identical | PASS |
| F1-2 | manager 100 g @8 % -> 40 g after 60 g @12 % to the seller (pieces 20 / 25 / 15); factory 108 + 15 g (sold, not paid) = 123; cash 5 000 000 UZS + 300 USD; LOM 10 g @750 = 12.8205 g; fine gold 20 g @999 = 34.1538 g (19.98 g fine); customer debts / advances as entered | PASS |
| F1-3 | seller obligation = 67.2 (inventory) + 10 (585 debt) + 10 (8.6 M / 860 000) + 1.4 (100 USD x 12 600 / 900 000) = **88.6 g**; the 50 USD advance does not lower it | PASS |
| F1-4 | a mistaken entry cancelled; the same customer's 585 debt twice refused; a seller cannot enter openings; ordinary operations refused in the draft | PASS |
| F1-5 | reconciliation all green before the lock | PASS |
| F1-6 | lock: baseline confirmed, period locked, later opening refused (ERR_OPENING_LOCKED), ordinary work allowed again | PASS |
| F1-7 | no other organization touched | PASS |

**Decision needed (business):** a debt of a customer ASSIGNED to a seller is added to that seller's obligation (085 / D-1 design:
the seller is responsible for his customers' debts). The owner's example "seller obligation 67.2 g" holds only for the
inventory part; with the customer debts above it is 88.6 g. If those customer debts are the manager's, not the seller's,
enter those customers WITHOUT a seller (or assign them to the manager) before the opening.

## 2. Page walkthrough: /sales/app/opening (menu "Boshlang'ich hisob", director and manager)
1. Restart (director only, red panel "Moliyaviy hisobni qayta boshlash"):
   * T0 (date and time, Asia/Tashkent);
   * reason;
   * "Tiklab sinalgan backup": choose the verified backup;
   * type exactly `MOLIYAVIY HISOBNI QAYTA BOSHLASH`, then press the button.
   * Result: the old documents are archived (reversed / cancelled + restart list), every balance becomes 0, and the period is "qoralama" (draft).
2. Form "Kiritish" -> choose "Turi" (A..J); the fields shown depend on the type:
   * **A Menejer ombori**: fizik vazn (g), zavod ustamasi (%), partiya nomi -> manager stock +g, factory +g x (1 + %).
   * **B Sotuvchi ombori**: sotuvchi, dona vaznlari (or jami vazn), sotuvchi ustamasi (%), manba = A document -> seller stock +g, manager stock -g, seller obligation +g x (1 + %); factory unchanged. Without a source: zavod ustamasi -> factory +g x (1 + %).
   * **C / C2**: 585 g -> factory obligation + / - (C = sold, not paid).
   * **D**: sotuvchi, 585 g, izoh (required) -> seller obligation +.
   * **E**: mijoz, qarz / avans, 585 g -> customer 585 balance (+ seller obligation if the customer has a seller).
   * **F**: mijoz, UZS / USD, qarz / avans, summa, USD kursi (USD), 585 kursi -> customer currency balance + 585 snapshot (+ seller obligation for a debt).
   * **G**: UZS / USD, summa -> manager cash.
   * **H LOM**: fizik g, proba -> manager LOM (585 equivalent).
   * **I toza oltin**: fizik g, proba -> refined gold (585 and fine grams).
   * **J boshqa**: aktiv / majburiyat, birlik, summa, qarz turi, qarshi tomon -> other asset / liability.
   * Then press "Kiritish": the message shows the document number and the formula.
3. Cancel: "Boshlang'ich hujjatlar" table -> "Bekor" on the row -> reason. The effect is removed; the row stays crossed out. Only before the lock.
4. Reconciliation: "Solishtirish" block. Every line must be ✅:
   * seller tills empty;
   * seller stock = pieces;
   * customers 585 / UZS / USD = documents;
   * inventory = opening receipts;
   * factory = documents;
   * 0 ordinary documents.
   It also shows a per-seller table (ombor g, majburiyat g, kassa, LOM).
5. Lock: enter "USD kursi" (required if USD exists) -> "Boshlang'ich hisobni tasdiqlash va qulflash". The button is enabled only when all checks are green. Then the baseline is created, the period is locked, opening entries are closed and ordinary work starts.

## 3. Production restart, read-only audit (code + staging evidence; production itself not queried)
| | Topic | Finding |
|---|---|---|
| A | Kept | customers (phone, code, seller), employees / logins, models: restart does not touch them (OP-3 staging, F1-1 local) |
| B | Archive | no DELETE. Every active document of the organization is set to reversed / cancelled with the restart mark, each row is listed in financial_restart_items (table, row id, old status), and counts are stored in financial_restarts.archived_counts |
| C | Balances | customer 585 + currency accounts, seller accounts (stock, obligation, tills, pool) and manager vault (stock, cash, LOM, refined, factory) set to 0 in the same transaction |
| D | Baseline / periods | accounting_baselines -> archived; a previous locked opening -> closed. goldia_report_periods are not touched: periods closed before T0 stay as history, and the period report shows the opening flows |
| E | Backup verification | restart requires a row in financial_backup_verifications: same organization, restore_verified, unused, < 24 h; users cannot write it. **Missing for production**: a tool that takes the full backup, restores it, then writes that row with the dump SHA-256. Needed in F2, separate from the staging script |
| F | Atomic / idempotent / rollback | one function = one transaction; idempotency key; exclusive per-organization advisory lock; a second restart while a draft exists is refused (ERR_RESTART_ALREADY_OPEN). No logical undo: the 085 rollback refuses once a restart exists. **The only undo is a full restore of the verified backup** (it also loses anything written after it), so the restart must follow the backup immediately with writes stopped |
| G | Stop writes | before T0: sellers hand all money and LOM to the manager (tills must be 0); announce the stop and log users out of work. The 085 draft guard refuses every ordinary financial write only AFTER the restart, until the lock. Gap: nothing blocks writes between the backup and the restart. F2 procedure: stop work -> backup + restore + verify -> check the business row counts are unchanged since the dump -> restart at once |
| H | T0 | T0 is entered as datetime-local in the browser: use a computer set to Asia/Tashkent. The server checks only that T0 is not empty. Choose T0 = after the last correction and before the first real sale; documents of the new period are dated from T0 |

## 4. Template for the real balances
docs/releases/production-075/opening/goldia-opening-template.xlsx (generator gen-opening-template.py).
* One sheet per page type (A..J) plus T0; the columns are exactly the page fields; formulas give the same values the server computes.
* "Jamlama" sheet: to be compared with the page's reconciliation before the lock.
* Checked: filled with the F1 example, the totals equal the server results (manager 40, sellers 60, factory 123, seller obligation 88.6,
  customer 10 g / 8 600 000 UZS / 100 USD debt / 50 USD advance, cash 5 000 000 + 300 USD, LOM 12.8205, fine 34.1538).

## 5. F2 prerequisites (need the owner's approval; nothing done)
1. Production backup-verification tool: full backup -> SHA256SUMS -> local restore (row counts + baseline identical) -> typed production ref -> ONE row in financial_backup_verifications (organization, dump SHA-256), then a check that the business rows are unchanged since the dump. Built on the existing production backup script; rehearsed locally first.
2. Business decision on customer debts and seller obligation (section 1).
3. Stop-work window, sellers' tills handed over, T0 chosen.
