# Goldia Sales 077 — director = manager, UZS / USD sales, period report, simple main screen

Branch `claude/goldia-sales-077-parity-period-currency` (separate from the 076 production branch). Production (076,
frontend `e717ffc`) was **not touched**: no migration, no deploy, no write. JFS demo and manufacturing ERP not touched.
Staging is **not yet at 077** (the session has no staging DB password; the owner applies it with the gated script, §6).
Everything below marked *local* ran on disposable PostgreSQL 17 + real GoTrue + PostgREST + the real Next.js build.

## 1. Why the manager lost "capital" (task 2) — root cause
`src/app/sales/app/page.tsx` had `canManageAccounting={!isSeller}` since `025fa81` (049). **My 076 commit `7b573d9`**
changed it to `isDirectorUiRole(...)` because two actions in that banner (accounting baseline, capital
reclassification) were director-only on the server — but the same banner also holds **capital in / out and expenses**,
which the server (`rpc_record_financial_transaction`) has always allowed to the manager. So 076 hid a working manager
function: a regression caused by me. Server rights before 077:

| Action | Server before 077 | UI 076 | 077 |
|---|---|---|---|
| Capital in / out, expense (`rpc_record_financial_transaction`) | director + manager | director only (my regression) | director = manager |
| Reverse a cash operation | director + manager | both | both (+ FK bug fixed, F77-3) |
| Capital reclassification | director only | director only | director = manager (+ amount bug fixed, F77-2) |
| Accounting baseline ("balansni muzlatish") | director only | director only | director = manager |
| Markup presets, product consignment, staff creation, Telegram management, sales overview, archive customer, customer-settlement reversal, transfer to seller | director only | director only | director = manager |

## 2. Findings
| ID | Sev | Finding | Status | Evidence |
|---|---|---|---|---|
| F77-1 | HIGH | Manager could not enter capital / expenses from the main screen since 076 (UI hid what the server allowed) — my regression | fixed (UI) | local UI U77-02/03 |
| F77-2 | HIGH | Capital reclassification changed the till / currency but kept `amount_num` in the OLD currency; a later reversal subtracted it from the NEW till (1 250 000 UZS → 100 USD, reversal took "1 250 000 USD", clamped to 0 = USD cash silently lost) | fixed in 077 (amount follows the money, original kept in `reclassified_from_*`, one reclassification per operation, immutability trigger adjusted) | vitest 077 A; production check `reclassified_capital_operations` (05) |
| F77-3 | HIGH | `rpc_reverse_financial_transaction` wrote `auth.uid()` into `reversed_by` (FK → employees.id): reversal fails for every director / manager whose employee id ≠ login id | fixed in 077 | vitest; production check `management_logins_id_differs_from_login` |
| F77-4 | MEDIUM | Director-only allow-lists in 9 Sales RPCs, 4 RLS policies, the staff API and the Telegram screen (contradicts the new parity decision) | fixed in 077 / UI | parity matrix: 46 RPCs × 5 roles, 0 director/manager differences |
| F77-5 | LOW | Period-report seller filter sent an unknown enum literal (HTTP 400) | found and fixed before release | local UI U77-26 |
| F77-6 | LOW | Currency payment in the debt's own currency returned NULL credit (no cross rate) | found and fixed before release | vitest 077 B |
| F77-7 | INFO | Test reset / cleanup stay director-only and do not know the currency tables | decision gate D-P1 | — |
| F77-8 | INFO | The daily sales ledger lists a UZS / USD sale with 0 g (no currency columns); amounts are in the period report and on the customer | follow-up | — |
| F77-9 | INFO | Report: seller obligation shown live (current), not derived for past dates (non-linear clamp) | documented | — |
| F77-10 | LOW (pre-existing) | `worker` passes the permission check of a few RPCs (`rpc_record_client_jewelry_sale`, `rpc_return_piece_to_manager`, ledger reads) and is stopped later by data rules | documented | parity matrix |

## 3. Director = manager (business decision 2026-11-05)
077 adds the manager to every Sales allow-list that had the director only (RPCs, RLS policies on `employees`,
`organization_factory_settings`, `organizations`, `sales_markup_presets`), the staff-creation API and the Telegram screen.
Tenant isolation is unchanged everywhere (`current_organization_id()`; RLS read isolation 9 829 checks and write isolation
18 000 checks PASS on the 077 copy). **Exception — decision gate D-P1:** `rpc_execute/preview_full_test_reset` and
`rpc_execute/preview_staging_test_cleanup` stay director-only (they wipe data; not business operations).
Proof: automatic matrix with real JWTs (`evidence/local-parity-matrix.json`): 46 RPCs × director / manager / seller /
worker / other organization → **0 director-vs-manager differences, 0 wrong / ambiguous calls**; postflight 077 checks
the same from the catalog.

## 4. UZS / USD sales (architecture and rules)
* A sale has a pricing: `XAU585` (gram + %, unchanged), `UZS` or `USD` (`jewelry_sales.sale_currency`, `sale_amount`,
  rate snapshots). Physical grams leave the **same** seller stock (FIFO pieces / chosen piece, per-seller lock, negative
  stock and double sale impossible). `client_gold_due_grams = 0` for a currency sale, so no 585 report changes.
* The customer owes the currency in `client_currency_accounts` (never mixed with 585 grams); an advance in the same
  currency is used first; overpayment becomes an advance in that currency.
* The seller's 585 obligation (consignment grams × (1 + seller %)) is **not** touched by the sale (20 g @ 10 % → 22 g stays).
* Payments: same currency 1:1; other currency or scrap at the **operation rate stored on the payment** — a seller's own
  approved LOM / USD rates (shown read-only, server checks `ERR_RATE_MISMATCH`), the director / manager must enter the
  rate. Cash / USD / scrap enter the seller till **once**, as unvalued cash; the existing 072 handover converts it to
  585 grams at the rate recorded on that handover.
* Reversals: payment (manager / director; refused if the money already left the till), sale (`rpc_reverse_client_sale`
  reverses the currency debt and returns the grams). Idempotency keys on all three; one key per opened dialog in the UI.
* **Not computed** (decision gates): profit / rate difference / stone value / company share of currency sales.

## 5. Period report and "new period"
`rpc_get_period_report(from, to, seller)` — Asia/Tashkent business dates, both inclusive; each document keeps its own
rate (no revaluation). Balances at a date = live balance − documented effects dated after it (exact even with an
undocumented starting balance, which is reported separately). Physical g, 585 g, UZS and USD are separate fields.
Sections: opening / closing (customer debt 585 / UZS / USD, seller stock, seller tills UZS / USD / LOM, manager cash
UZS / USD, factory obligation), flows by operation (receipts with markup, distribution, returns, gram / UZS / USD sales,
legacy additions / reconciliations / advances separate from sales, payments with LOM 585 / 750 and rates, advances,
reversals, handovers, factory handovers, capital, expenses, purchases), per seller, rate snapshots.
`rpc_close_report_period` ("Yangi davrni boshlash") only stores the period and a frozen copy of its report: **no balance,
debt, stock, till or transaction is reset, changed or deleted** (checked by hash before / after). UI: date pickers,
seller filter, CSV, stored periods, mobile 390 px.

## 6. Evidence (all files in `evidence/`)
| Run | Where | Result |
|---|---|---|
| vitest (all migrations incl. 077, new 077 suite: parity, $2000 example, payments, reversals, report, close period) | CI-equivalent | 369/369 |
| UI 077 — real logins, desktop + 390 px: simple panel, manager capital entry, presets, USD sale (double click → 1), USD payment, UZS→USD at own rate, UZS sale on phone, seller kept out of the report, manager reversal, report = server, CSV, new period without changes, stored period | local full stack | **21/21** (`local-ui-077.json`, screenshots) |
| Parity matrix 46 RPCs × 5 roles | local, real JWTs | 0 differences (`local-parity-matrix.json`) |
| Currency stress with independent model: 103 UZS / USD + 40 gram sales, 150 currency payments (same / cross / scrap 585 / 750 / mixed / overpay), 30 reversals, 15 attacks (cross-seller, other org, wrong rate, negative, direct table writes, parallel same key ×8) + report vs model + identity opening + flows = closing | local | **13/13**, 0.0000 differences, undocumented balance 0 (`local-currency-stress-077.json`) |
| 076 regression stress (210 sales / 210 payments / 104 legacy / 55 reversals / 57 attacks) on 077 | local | 16/16 (`stress-local-077-regression.json`) |
| 076 regression suites on 077: legacy debt 37/37, gram sale 28/28; 076 UI 16/17 — UI-14 expected the manager NOT to see director buttons, superseded by the parity decision | local | see `local-ui-076-regression-on-077.json` |
| Staging release script 076 → 077: backup, restore, parity, 073–077 postflights, RLS read + write isolation, rollback + re-apply, apply, postflight | local rehearsal | DRY RUN PASS, APPLY + POSTFLIGHT PASS (`release-rehearsal/STAGING-077-RESULT.txt`) |
| Production release script `--migration 077` | local production-shaped stand-in | all gates PASS, APPLIED, POSTFLIGHT PASS, balances unchanged (`release-rehearsal/RELEASE-077-RESULT.txt`) |
| Emergency rollback 077 → 076 | local | 076 postflights true, function bodies 156/156 identical to 076 |
| Read-only kits: `production-prelaunch` at 076 (05 check + 076 parity), `production-post` at 077 (073–077 postflights, report RPCs read-only, baseline with new tables) | local | PASS |

**Not yet done (needs the owner):** every test above on REAL staging. Old 076 staging audits are not counted for 077.

## 7. Release plan (production only with separate written approval)
1. Staging DB: `node scripts/goldia-staging-release.js` (dry run) → `node scripts/goldia-staging-release.js --apply`
   (from this branch; 076 → 077 in one transaction).
2. Staging frontend: `deploy-staging-frontend.ps1 -ReleaseCandidate <HEAD of this branch>`.
3. Staging verification (I run it): `ui-077.js`, `parity-matrix.js`, `currency-stress.js` with `GA_TARGET=staging`,
   plus the 076 regression (`stg-076-api.js`, `stress.js`, `stg-integrity.js`) and the bundle check.
4. Production read-only: `run-readonly-checks.ps1 -Target production-prelaunch` (at 076: F77-2 / F77-3 exposure,
   roles, drift, 076 parity).
5. Production: `node scripts/goldia-prod-release.js --migration 077` → `production-frontend.ps1 -Apply
   -ReleaseCandidate <commit>` → `-Target production-post` → `run-production-smoke.ps1`.
Order: database first (the new frontend on a 076 database cannot record currency sales / reports).
Rollback: `emergency/rollback_077_with_history.sql` (refused while UZS / USD sales or payments are active — reverse them
first); frontend: redeploy `e717ffc`.

## 8. Decision gates (owner) — see DECISION-GATES.md
D-P1 test reset rights · D-C1 handover rate for currency-sale cash · D-C2 cross-currency payment rate · D-C3 profit /
rate difference / stone value / company share · D-C4 currency overpayment = advance in the same currency · D-C5 seller
gram obligation unchanged by currency sales.

## 9. Verdict
* **Staging: not yet verified at 077** — local evidence is complete; real staging proof is pending steps 1–3.
* **Production: NO-GO for 077 today** (no staging proof yet). After steps 1–4 PASS and D-C1…D-C5 confirmed (or the
  defaults accepted): **LIMITED GO** — director = manager, period report, simple main screen, UZS / USD sales and
  payments; excluded: profit of currency sales (D-C3) until the accounting policy is decided.
