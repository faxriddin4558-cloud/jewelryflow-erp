# GOLDIA SALES — EMERGENCY PRE-LAUNCH RED-TEAM AUDIT (2026-11-04)

Incident: a real seller entering **206.83 g** legacy debt got *permission denied*. Earlier audits missed it because their
staging legacy-debt test (`scripts/test-staging-legacy-debt-and-reversals.js`) logged in **only as a director**, and no
audit compared "button visible for role X" with "server allows role X".

Environments: production `vrozlllcaxinavzxueif` (075, frontend `fec64ec`) — **not reachable from this session**
(no credentials, host blocked); nothing was read from or written to production. Staging `vouehtlmsunebracahon` (075,
frontend `fc1a1fa`) — synthetic audit organization only (users `audit.fx075.*`, banned again after the run). JFS demo
and ERP were not touched. All fixes are in migration **076** + frontend; 076 is **not applied anywhere** except local
disposable PostgreSQL 17 copies (the session has no staging DB password).

## 1. Root cause of the incident (proved on real staging)
`rpc_record_client_legacy_debt` (056) calls `assert_erp_permission(['admin','director','owner','direktor','rahbar',
'accountant','buxgalter'])`; sellers normalize to `seller`, managers to `production_manager` → both refused. The UI
(`CustomerLedgerAndSheetsSection.tsx`) shows the **Eski qarz** button to every role. Staging UI as the synthetic seller:
`Eski qarzni saqlashda xatolik: Permission denied for role "seller" (required one of: admin, director, owner, direktor,
rahbar, accountant, buxgalter)` — `evidence/staging-ui-075.json`, `evidence/staging-ui-075-screens/`. The same RPC as the
manager: `Permission denied for role "production_manager"` — `evidence/staging-075-role-matrix.json`.

**Was the 206.83 g saved in production?** A denied call raises before any write and the transaction is rolled back, so
by construction no row exists and nothing can be doubled. This is verified only in code and on staging; for production
run the read-only check in §5 (line `PRE|legacy_206_83_rows`). After 076 the seller enters it once; a second submit
(double click, retry, old frontend) is refused for 10 minutes (`Takroriy so'rov`).

## 2. Findings
| ID | Sev | Finding | Status | Evidence |
|---|---|---|---|---|
| F1 | CRITICAL | Seller and manager cannot enter legacy debt / reconcile; reversal of legacy debt only director/accountant | fixed in 076 + UI | staging UI STG-075-01, role matrix; local LD-01..32, UI-02/12 |
| F2 | HIGH | Business rule 1 broken: a gram credit sale is refused (`ERR_PIECE_REQUIRED`, 073) whenever the seller holds barcode pieces; the UI forces ONE piece, so e.g. 30 g / 100 g sales are impossible ("Tanlangan dona … yengil") | fixed in 076 + UI (piece optional, automatic oldest-first) | staging UI STG-075-02; local WS-01..19, UI-07/08 |
| F3 | HIGH | Reversing a cash / capital operation fails for **every role**: HTTP 300 `PGRST203` (two overloads of `rpc_reverse_financial_transaction`) | fixed in 076 (old 051 overload dropped) | staging role matrix (AMBIGUOUS ×5 roles); local UI-17 |
| F4 | HIGH | Reconciling a customer's **sales** debt down to the notebook (e.g. 70 → 69 g) crashes: `violates check constraint seller_gold_accounts_seller_legacy_debt_obligation_g_check` | fixed in 076 (obligation clamped at 0) | staging stress op (`stress-staging-075.json`); local LD-33/34, vitest |
| F5 | HIGH | Through the API a seller can sell (weight, barcode, consignment) to **another seller's** customer — debt lands on a customer he cannot see | fixed in 076 (same rule as payments since 065) | local WS-12 (075 accepted, 076 refuses) |
| F6 | MEDIUM | Legacy debt reversal does not recalculate the seller → his obligation keeps the reversed grams | fixed in 076 | LD-26, UI-13; production drift check §5 |
| F7 | MEDIUM | Legacy debt `p_seller_id` not checked against the organization → recalc could overwrite another organization's seller account | fixed in 076 | LD-22 |
| F8 | MEDIUM | Idempotency keys built with `Date.now()` per submit → a retry after a lost response books legacy debt / a sale twice | fixed: stable keys per dialog (UI) + server duplicate guard for legacy debt | LD-04..07, UI-03 (double click → 1 row) |
| F9 | MEDIUM | Manager sees director-only buttons (markup presets, accounting baseline / capital reclassification, product consignment) → permission denied on click | fixed in UI (hidden / notice; server unchanged) | UI-14, UI-16 |
| F10 | MEDIUM | Reversing an old legacy entry under a newer reconciliation invents an advance (e.g. +6.83 g) | fixed in 076 (reverse the newer reconciliation first) | LD-24b/c |
| F11 | LOW | A 0.0001 g remainder consumed the whole piece: held pieces 0.0001 g below the gram stock | fixed in 076 | stress model (20.7665 g sale consumed 20.7666 g) |
| F12 | LOW | "Oldest first" inside one consignment is arbitrary (same `created_at`, ordered by uuid); grams stay exact | documented | vitest 073 C (now invariant-based) |
| F13 | LOW (policy) | A seller can reverse his own sale at any time without manager approval (payments become an advance) | not changed — owner decision | role matrix |
| F14 | LOW | Opening *Mijozlar* writes: `rpc_get_unified_customer_ledger` upserts the debt cache (since 069) | documented | production smoke kit G2 |
| F15 | LOW | Two vitest tests used UTC `CURRENT_DATE` and failed daily 19:00–24:00 UTC (pre-existing, fails on `b4a5ba3` too) | fixed (tests only) | commit after `af04927` |
| F16 | LOW | `rpc_record_financial_transaction` code accepts `capital_in` but the table constraint rejects it (the UI never sends it) | documented | local probe |
| F18 | LOW | `rpc_execute_full_test_reset` closes weight sales but leaves their piece allocations open (`reversed_at` null; pieces become `cancelled`) - test-only function, no balance effect (100 rows on staging from the 2026-11-03 reset) | documented | `evidence/staging-076-integrity.json` INT-07b |
| F17 | INFO | Sellers see the organization's **unassigned** customers (065 rule); after 076 they cannot put legacy debt on them — the manager assigns the customer first or enters it himself | by design | LD-09 |

Not audited in this pass (no new evidence, earlier audits only): Telegram linking, receipt printing, physical scanner,
Sheets import. Brilliant sets: design only (`BRILLIANT-KOMPLEKT-DESIGN.md`), **must not be sold through the system as a
gram sale tomorrow**.

## 3. What 076 changes (and nothing else)
`supabase/migrations/20260101000076_goldia_legacy_debt_manager_and_seller.sql`, rollback
`supabase/rollback/20260101000076_rollback.sql` (restores the 075 bodies), emergency rollback with history
`docs/releases/production-075/emergency/rollback_076_with_history.sql`, postflight
`supabase/release/076_postflight_readonly.sql` (15 checks). Functions only — no table, column, grant widening or data
change: `rpc_record_client_legacy_debt`, `rpc_reverse_client_legacy_debt`, `rpc_record_weight_sale`,
`rpc_record_barcode_piece_sale`, `rpc_record_client_jewelry_sale`, `recalc_seller_gold_account`,
`_goldia_consume_weight_sale_pieces`, `_goldia_consume_selected_pieces`; drop of the old overload
`rpc_reverse_financial_transaction(uuid,text,text)`. Permission was **not** opened to everyone: sellers get legacy debt
only for their own customers, booked on themselves, additions only (lowering a debt or an advance would lower their own
obligation → manager); no seller reversal. Stock, factory obligation, vault and profit are untouched by legacy debt.

Frontend (`src/`): stable idempotency keys (legacy debt, sales), seller legacy dialog = debt addition only, no reverse
button for sellers, weight-sale piece optional ("Avtomatik — eng eski donalardan ayriladi"), director-only actions hidden
from managers (`isDirectorUiRole`). Server rate-mismatch protection unchanged.

## 4. Test evidence (all in `docs/audits/goldia-076-prelaunch/evidence/`)
| Run | Where | Result |
|---|---|---|
| Incident + rule 1 through the browser | **real staging UI** (075) | both reproduced (`staging-ui-075.json`) |
| Role matrix, 26 write RPCs × 5 roles, real JWTs | **real staging** (075) | F1, F3 confirmed (`staging-075-role-matrix.json`) |
| Stress + independent model: 210 sales, 210 payments, 103 legacy, 55 reversals, 60 attacks, 29 inventory operations (9 factory receipts 6/8/10 %, 9 barcode consignments = 180 pieces, 11 returns) — **below the requested 100 inventory operations** | **real staging** (075) | model = database **0.0000 g** (customers, stock = held pieces, tills UZS/USD, legacy obligation); F4 found (`stress-staging-075.json`) |
| Same stress on 076 | local full stack (GoTrue + PostgREST) | 16/16, 0.0000 g, 0 failed operations (`stress-local-076.json`) |
| UI with real logins (desktop + 390 px phone), 17 checks | local full stack, real Next.js build | 17/17 (`local-ui-076.json`, screenshots) |
| Legacy debt roles / limits / concurrency / retries | local PG17, real JWT claims | 37/37 (`local-legacy-debt-076.json`) |
| Gram sale rule 1: 100 g @ 12 % → 112 g, markups 10–35 %, negative stock, 12 parallel sales, double sale, reversal | local PG17 | 28/28 (`local-weight-sale-076.json`) |
| vitest (pglite, all migrations) | CI-equivalent | 360/360 |
| Staging release script 075 → 076: backup, restore, parity, chain, 073–076 postflights, RLS read (9 226) + write (16 800) isolation, rollback + re-apply, apply, postflight | local rehearsal | DRY RUN PASS, APPLY + POSTFLIGHT PASS |
| Production release script `--migration 076` | local production-shaped stand-in | all gates PASS, APPLIED, POSTFLIGHT PASS, balances unchanged (`release-rehearsal/`) |
| Read-only kits (`production-prelaunch`, `production-post` at 075/076) | local | PASS; harness 12/12 + 19/19; PowerShell 5.1 parse clean |

Harness mistakes made and corrected during the run (not product defects): wrong probe argument names (5 RPCs reported
MISSING), a PostgREST aggregate in a test, an obligation measured at the wrong moment, wrong till / transaction type
in a test, JS float rounding in the stress model (now integer half-up like the server), an idempotent no-op reversal
counted as "accepted", a too-specific baseline-file expectation. Commit `af04927` was made while 2 (pre-existing,
time-of-day) tests were red; fixed in the next commit.

## 5. Release plan (nothing below has been run; production needs the owner's separate written approval)
Order: **staging DB → staging frontend → staging re-verification → production read-only → production DB → production
frontend → post checks.** The new frontend on a 075 database is harmless but useless (sellers still denied; gram sale
without a piece → `ERR_PIECE_REQUIRED` message), so the database goes first.

1. Staging DB (owner, PowerShell, repository at this branch):
   `node scripts/goldia-staging-release.js` (dry run, staging only read) → `node scripts/goldia-staging-release.js --apply`
2. Staging frontend: `powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\staging-075\deploy-staging-frontend.ps1 -ReleaseCandidate <commit of this branch>`
3. Staging re-verification (I run it when you say "076 staging PASS": unban synthetic users, `stg-ui-incident.js` with
   `TAG=076`, `stress.js` with `GA_SCHEMA=076`, role matrix, re-ban).
4. Production read-only (owner): `powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-prelaunch`
   → shows the 206.83 g rows, real login roles, legacy obligation drift, hidden negative stock, 075 parity.
5. Production DB, **only after approval**: `node scripts/goldia-prod-release.js --migration 076` (fresh backup + restore
   test + gates + typed ref + one transaction + postflight).
6. Production frontend: `powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\production-frontend.ps1 -Apply -ReleaseCandidate <commit>`
7. Post: `run-readonly-checks.ps1 -Target production-post` (runs the 076 postflight, compares with the 075 baseline) and
   `run-production-smoke.ps1 -ExpectCommit <commit>` (read only, writes blocked in the browser).

Rollback: DB `psql … --single-transaction -f docs/releases/production-075/emergency/rollback_076_with_history.sql`
(rehearsed: back to 075, 075 postflight true; legacy rows written meanwhile stay valid); frontend: redeploy `fec64ec`.
Backup: step 5 makes a fresh verified backup before any change.

## 6. Verdict for tomorrow morning
* **Current production (075 + `fec64ec`): NO-GO** for normal seller work — sellers and managers cannot enter legacy
  debt (F1), gram credit sales without a product are blocked (F2), no cash operation can be reversed (F3), downward
  reconciliation crashes (F4).
* **After steps 1–7 pass with evidence: LIMITED GO** — sales, payments, legacy debt, reconciliation, handovers and
  reversals as audited above; **excluded**: brilliant sets in USD/UZS (design only), and areas not re-audited here
  (Telegram, printing, scanner hardware, Sheets import) should be watched on day one.
* Full **GO** is not justified from this session: 076 has not run on real staging or production yet, and the production
  read-only results are not in.

## 7. Re-verification on REAL staging after 076 (2026-11-05) — nothing from before 076 counted
Staging DB 076 (owner: POSTFLIGHT PASS), frontend `6956236` (`/api/version` full_commit 6956236…, `sha_source=build`).
The browser bundle contains the 076 UI (4 markers) and not the 075 text (`evidence/staging-076-bundle-check.txt`).
Real GoTrue logins, PostgREST, Playwright; synthetic organization A + organization B only; users banned again after.

| Run | Result | Evidence |
|---|---|---|
| API re-proof of every CRITICAL/HIGH fix: seller + manager legacy debt (206.83 g), own customer only, advance / reconcile-down / other seller refused, retries and 6-way concurrency, org B / worker / no-employee refused, reversal + recalc, gram sale 100 g @ 12 % = 112 g without a product, FIFO across consignments, markups 10–35 % on the base, negative stock / invalid input refused, cross-seller weight AND barcode sale refused, 12 parallel sales, one-key ×8 → one sale, sale reversal, cash reversal (no PGRST203), downward reconciliation of a sales debt, refresh token + logout | **57/57** | `staging-076-api.json` |
| Browser (desktop + 390 px): seller legacy 206.83 g, double click → 1 row, reconcile-down refused, piece choice optional, 30 g sale without a product, mobile legacy, manager reversal + recalc, manager has no director-only buttons, director has them, cash reversal | **17/17**, no API 4xx/5xx | `staging-ui-076.json`, `staging-ui-076-screens/` |
| Role matrix 26 write RPCs × 5 roles | legacy debt: manager + seller allowed; seller reversal denied; financial reversal resolved for all roles | `staging-076-role-matrix.json` |
| Stress + independent model: 210 sales (158 weight without/with pieces, 52 barcode), 210 payments, 104 legacy (26 by sellers, 39 manager, 39 director), 55 reversals, 60 attacks, 30 inventory operations; 26 legacy duplicates with a new key → 0 accepted | **16/16**, model = database **0.0000 g**, 0 failed operations | `stress-staging-076.json` |
| Whole-organization integrity (9 sellers, 664 pieces, 716 sales, 730 allocations): no negative stock, pieces = grams, legacy obligation model, no double sale, allocations = sold grams, reversals release allocations, no debt+advance | all PASS (+ F18 info) | `staging-076-integrity.json` |

Still open: inventory operations 30 (< 100 requested); the 0-g legacy-obligation clamp edge is proven locally / in vitest, on
staging only the non-negative case; Telegram, printing, scanner hardware, Sheets import not re-audited; production untouched.
