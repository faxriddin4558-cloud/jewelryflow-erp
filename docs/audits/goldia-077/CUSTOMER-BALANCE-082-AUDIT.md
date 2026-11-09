# Goldia Sales — critical financial display bug: customer debt / advance (fix 082 + frontend)

Date 2026-11-09. **Production FREEZE: nothing deployed, migrated or written** (production frontend 2b48df9, DB 080).
Staging 081: read-only queries + scenario writes in the synthetic organization only (users unbanned for the run,
banned again). No balance, document or history row was changed by the fix: 082 replaces one read-only report function.

## 1. Root cause — every place that shows customer debt / advance
| Place | Before | Effect |
|---|---|---|
| `DirectorSalesWorkspace` "Mijozlarning Jami Qarzi" (`/sales/director`) | `SUM(current_debt_grams)` | gross debt only; advances neither subtracted nor shown |
| main page `/sales/app` "3. Mijozlar **Sof** Nasiyasi" + "3-Daraja" | `SUM(max(0, debt − advance))` per customer | = gross debt labelled "sof"; the advance shown beside it was never subtracted; a net advance was clamped to 0 |
| `ManagerSimplePanel` "Mijozlarning jami qarzi" | grams: gross debt + "avans" line; UZS / USD: signed net | two different conventions on one card; a negative currency net had no wording |
| **monthly report RPC `rpc_get_customer_monthly_report` (073)** | opening and closing `greatest(0, …)`; legacy **advance** rows (`balance_type='advance'`) left out completely | customers with an advance shown with too much debt or missing; a month starting with an advance overstated the closing. Real staging: **135 of 339** synthetic-org customers wrong + 9 missing; whole staging 107 / 649 wrong, closing 8 924.03 g vs live gross debt 8 560.34 g |
| `CustomerLedgerAndSheetsSection` list (RPC path) | `current_debt_grams := net_debt_g` (server open debt), advance separate | correct (server values are already mutually exclusive) — **no** double subtraction today; `debt − advance` at line ~886 is the signed net |
| same, fallback path | `max(0, debt − advance)` + raw advance | double count only if a row ever had both > 0 → made canonical |
| period report + CSV | signed nets per unit (server) | correct; negative now worded |
| daily ledger "Yakuniy qarz" | per-document stored remaining debt (`remaining_*_grams`, `excess_gold_grams` = created advance) | historical document snapshot, not a running balance — unchanged |
| unified ledger RPC, accounts, seller obligation ("Bozor qarzi") | signed over all legacy rows; obligation from `seller_gold_accounts` | correct; customer advances never reduce the seller obligation (proved BM-OBL, 081 SA-MOD-1, RC-OBL) |

## 2. Canonical model (`src/lib/customer-balance.ts`)
Per customer and unit (585 g / UZS / USD separately, never added): `signedNet = debt − advance`,
`openDebt = max(0, signedNet)`, `openAdvance = max(0, −signedNet)`. Totals: `grossDebt = Σ openDebt`,
`grossAdvance = Σ openAdvance`, **`signedNet = grossDebt − grossAdvance`**; negative → "Biz mijozlarga qarzdormiz".
The advance is subtracted exactly once; already-netted rows give the same totals (unit test).

## 3. Minimal fix
* Frontend: the four cards above use the model (net + "qarz X − avans Y" + direction); monthly table and summary show
  signed opening / closing ("+X g avans"); period report labels / wording for negative nets; fallback mapping canonical.
* DB **082** (`20260101000082_goldia_monthly_report_signed_balance.sql`, generated from the 073 body): signed opening /
  closing over all unreversed legacy rows + sales − payments; every old key kept (`closing_debt_g` = open debt), new
  `*_advance_g`, `*_net_g`, `total_closing_net_g`; grants unchanged; read only. Rollback restores the 073 body (hash
  identical to expected-081). Release kit: postflight 082, emergency rollback 082, expected signature 082 (one line
  differs from 081: this body), CR-tolerant function parity 082 (168), POSTFLIGHT_CHECKS 082, production-post / drift kit.
* Old 2b48df9 frontend with DB 082: compatible (old keys unchanged).

## 4. Evidence
| Test | Result |
|---|---|
| vitest (incl. 6 new model / source-guard tests) | **405/405** |
| local, DB 081 (old report), 8 scenario customers / 2 sellers | 6/8: accounts, unified ledger, obligation, currency **correct**; monthly report **FAIL** (D 11 instead of 7, G 2 debt instead of 7 advance, C 0 instead of 5 advance, B missing) |
| local staging-release rehearsal 081 → 082 (backup, restore, chain + fingerprint, postflights 073–082, RLS read / write, emergency rollback + re-apply, apply + postflight) | **PASS** |
| local, DB 082 + new frontend, real GoTrue + PostgREST + Playwright: scenarios, monthly report (every customer = live account, totals = rows = live, seller filter, continuity Oct → Nov, negative nets), period report (585 / UZS / USD), director card, manager panel 585 + USD, main page card, monthly tab ("+7.00 g avans") | **19/19** |
| production-post kit at 082 (postflights 073–082, post-release, RLS) | PASS (REVIEW: no pre-release baseline locally) |
| real staging 081 (synthetic org, before 082) | 6/8 — same picture: 135 customers wrong / 9 missing in the old report; everything else correct |
| real staging 082 + new frontend, 076–081 regression, reconciliation | **PENDING** — needs the owner's staging release (section 5) |

## 5. Owner (staging only)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging
```
(detects 081 → 082, gated apply, deploys the frontend, smoke). Then the staging battery (balance-082 with UI, 076–081
suites, reconciliation) is run against real staging Auth.

## 6. Verdict
**Production: NO-GO** (freeze; 082 + frontend not yet verified on real staging; owner approval needed). Production
impact today (frontend 2b48df9 + 073 report): display / report only — balances are correct; the director / main page
cards show gross debt as "net" and the monthly report overstates customers with advances. Read-only measurement:
`run-readonly-checks.ps1 -Target production-drift-audit` → lines `customer_g585_canonical`, `monthly_report_073_effect`.
