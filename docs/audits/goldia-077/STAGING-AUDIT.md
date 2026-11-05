# Goldia Sales 077 — REAL STAGING final audit (+ 078 customer archive)

Date 2026-11-05. Staging `vouehtlmsunebracahon`: DB **077**, frontend **c1a1d09** (`/api/version` → `sha_source=build`,
bundle check: 076 + 077 markers present, old 075 text absent — `evidence/staging-077-bundle-check.txt`).
Production `vrozlllcaxinavzxueif` (076, `e717ffc`) was **not touched** (no read, no write, no deploy). JFS demo and
manufacturing ERP not touched. Every staging write was made with real GoTrue JWTs through PostgREST / the real
staging frontend **only in the synthetic organizations** `GOLDIA AUDIT 075 A` / `B`; ground truth = service-role reads.
Synthetic users were unbanned for the run and **banned again** at the end (12 users, including the two new id≠uid ones).

## 1. Results on REAL staging (077)
| # | Requirement | Test (evidence file) | Result |
|---|---|---|---|
| 1 | Manager enters capital from the main panel | U77-02/03: button visible, 3 000 000 UZS once (`staging-ui-077.json`) | **PASS** |
| 2 | Director = manager in every business action | parity matrix 46 RPCs × director / manager / seller / worker / other org (`staging-parity-matrix.json`): **0 differences, 0 missing / ambiguous**; UI U77-04, UI-D-01; RLS policies via the matrix and 076 regression | **PASS** (exception D-P1, §4) |
| 3 | Reclassify UZS→USD, reversal, cash back | RC-01…06 (`staging-077-targeted.json`): +1 250 000 UZS → reclassified: UZS back to start, USD +100, document 100 USD with `reclassified_from_*` = 1 250 000 UZS; second reclassification refused; reversal → vault exactly as before (UZS 1 802 658 500, USD 600); second reversal refused | **PASS** |
| 4 | Reversal when employee id ≠ auth uid | ID-* : new synthetic manager **and** director whose `employees.id` ≠ login id; capital → `recorded_by` = employee id; reversal OK, `reversed_by` = employee id; reclassify + reverse OK; report readable | **PASS** |
| 5 | Gram+% / exact UZS / exact USD sales in the seller UI | U77-10 (20 g for $2 000, double click → 1 sale), U77-15 (390 px: 2.5 g for 3 100 000 so'm), 076 UI-08 (30 g gram sale without a product) | **PASS** |
| 6 | Currency: partial, mixed, advance, reversal, rate snapshot, till, seller obligation | U77-11…14/20 + currency stress (`staging-currency-stress-077.json`): 120 currency + 40 gram sales, 150 payments (same / cross / scrap / mixed / overpay → advance), 20 payment + 10 sale reversals, 15 attacks, 8× parallel same key → 1; model = DB (**0.0000** g, currency separately), obligation unchanged by currency sales | **PASS 13/13** |
| 7 | Period report 05.10–05.11, previous / next month | RB-01…08: continuity at the 04.11/05.11 boundary for all 10 balances, additivity of 26 flow kinds (no double count at inclusive ends), closing 05.11 = live DB, previous month empty, next month empty, sale_date = Tashkent date for 1 122 sales, per-day sale counts = DB | **PASS** |
| 8 | "Yangi davrni boshlash" deletes nothing | U77-24 (debts, stock, tills, vault unchanged), U77-25 reopen stored report | **PASS** (after F77-11, §2) |
| 9 | Simple main panel desktop + Android 390 px | U77-01, U77-27 (manager), UI-D-01 (director 390 px: panel, capital button, 0 overflow, 0 API errors) | **PASS** |
| 10 | Legacy debt seller + manager | 076 API 57/57 on 077 (`staging-076-api-on-077.json`), 076 UI UI-01…13 | **PASS** |
| 11 | Gram sale without product; FIFO | 076 UI-07/08/09, integrity INT-01…06 (`staging-integrity-077.json`: 9 sellers, 955 pieces, 1 121 sales, 1 294 allocations) | **PASS** |
| 12 | Till handover, payments, reversals | 076 stress on 077: 210 sales / 210 payments / 30 inventory / 104 legacy / 55 reversals (`stress-staging-076-on-077.json`) | **PASS 16/16** |
| 13 | Other seller / other organization refused on the server | 60 attacks (076 stress) + 15 (currency stress) + matrix column `directorB` | **PASS** |
| 14 | Double click, retry, concurrency, negative stock | parallel 8× same key → 1 (sale and payment), UI double clicks → 1, negative stock 0 (INT-01) | **PASS** |

Totals on real staging: UI 077 **21/21**, targeted **25/25**, currency stress **13/13**, parity **0 diffs**, 076 API **57/57**,
076 stress **16/16**, integrity **9/9**, 076 UI **16/17** (UI-14 expects the manager *not* to have director buttons —
superseded by the parity decision; the manager having them is the intended 077 behaviour).

## 2. Findings
| ID | Sev | Finding | Status |
|---|---|---|---|
| — | CRITICAL | none | — |
| — | HIGH | none new; the 077 HIGH fixes (F77-1 manager capital UI, F77-2 reclassification amount, F77-3 `reversed_by` FK) are now proven **on staging** (U77-03, RC-*, ID-*) | verified |
| F77-11 | MEDIUM | One mistaken "Yangi davrni boshlash" (old end date) blocks every later close: the next period starts the day after it and exceeds the 10-year report window; there was no undo. Found on staging because my first parity probe closed `2000-01-31` in both synthetic orgs | fixed in **078** (`rpc_reopen_report_period`, latest period only, audit copy); the two harness rows were removed with the service role (synthetic orgs) and the probe now uses a future date that is refused without writing |
| F78-1 | MEDIUM | `customers.is_archived` existed but nothing read it (archiving had no visible effect), sellers could not archive, and `customers_tenant_manage` lets a seller write `is_archived` of his own **and unassigned** customers directly | fixed in **078** (RPC rule + invoker guard trigger + UI) |
| F78-2 | LOW (pre-existing, 038) | A seller can direct-write an unassigned customer and assign it to himself (`seller_id` null → own id) | not changed — decision gate D-A2 |
| F77-12 | INFO | Staging org A has balances older than its documents (seeded before 073: undocumented opening manager cash 14 800 000, stock −1 075.847 g, factory −2 436.6232 g) | expected on staging; the report shows it separately |
| F77-13 | INFO | Report boundary at Tashkent midnight is proven by construction (RB-07: `sale_date` = Tashkent date of `created_at`); staging had **0** sales created between 19:00 and 24:00 UTC | limitation |
| F77-7 | INFO | Test reset / cleanup stay director-only and do not know the currency tables | open exception D-P1 |
| F77-8/9 | INFO | daily ledger shows currency sales as 0 g; seller obligation in the report is live only | unchanged follow-ups |

## 3. PRIORITET 4 — "Mijozni o'chirish" (migration 078, commit `318b3af`)
* Server: `rpc_archive_customer` — seller: only his organization's customer assigned to him; director = manager: all
  customers of the organization; other organization → "Mijoz topilmadi" (nothing leaks); restore with the same rule;
  idempotent (`changed:false`, no second audit row); `archived_at` / `archived_by`; audit row with the open balances.
  `trg_goldia_guard_customer_archive` (SECURITY INVOKER) applies the same rule to direct PostgREST updates.
* Soft delete only: no sale, payment, 585 g / UZS / USD debt, till or audit row changes; archived debts stay in the
  period report and ledgers and remain collectible; physical delete guard (051) unchanged.
* UI: "🗑️ Mijozni o'chirish" in the mobile card and the desktop row (only where allowed), one confirmation naming the
  open debt, double-click guard, "🗄️ Arxivlangan mijozlar (N)" view with debts and "♻️ Tiklash"; archived customers are
  hidden from the seller sale picker. Period page: "Qayta ochish" on the latest stored period.
* The 4 mandatory security tests (+ extras):

| Test | vitest (all migrations) | local full stack, real browser + JWT (`local-ui-078-archive.json`) | real staging |
|---|---|---|---|
| SEC-1 seller archives own customer | PASS | U78-01/02 PASS (double click → 1 operation) | **pending 078 on staging** |
| SEC-2 not another seller's / unassigned / other org (RPC + direct PATCH) | PASS | U78-03 PASS | pending |
| SEC-3 debt + history kept, collectible, in the report | PASS | U78-04 PASS (12.5 g + $1 000 kept, $200 paid after archive) | pending |
| SEC-4 restore (seller own; manager / director any) | PASS | U78-05/07/08 PASS | pending |

  Also: 390 px U78-09 PASS; 077 UI suite 21/21 on the 078 build; vitest **374/374**; postflights 073–078 all true;
  rollback + re-apply clean (customer hash unchanged); staging release script **077 → 078** rehearsed locally:
  DRY RUN PASS, APPLY + POSTFLIGHT PASS, parity 0/0/0, RLS isolation 9 829 PASS, balances unchanged
  (`release-rehearsal/STAGING-078-*.txt`).

## 4. Open exceptions and decision gates
* **D-P1 (open exception to director = manager):** `rpc_preview/execute_full_test_reset`, `rpc_preview/execute_staging_test_cleanup`
  stay director-only (they wipe data). Staging matrix: `rpc_preview_full_test_reset` director PASSES, manager DENY — the only difference.
* D-C1…D-C5 (currency rates, profit, overpayment) — unchanged, see `DECISION-GATES.md`.
* **D-A1 (new):** a sale to an archived customer is hidden in the UI but not refused by the server. Refuse it, or allow it (current)?
* **D-A2 (new):** may a seller take an unassigned customer for himself (current behaviour since 038)?

## 5. Coverage and limitations
* Covered on real staging: everything in §1 (UI, RPC, RLS, API through PostgREST with real GoTrue sessions).
* Not on staging yet: 078 (the session has no staging DB password). Owner steps:
  1. `node scripts/goldia-staging-release.js` (dry run) → `node scripts/goldia-staging-release.js --apply` (077 → 078);
  2. `deploy-staging-frontend.ps1 -ReleaseCandidate 318b3af` (or the branch HEAD);
  3. I then run `GA_TARGET=staging node docs/audits/goldia-077/harness/ui-078-archive.js` (the 4 security tests on
     staging) plus `ui-077.js` and `parity-matrix.js` again (synthetic users need unbanning: `ban-users.js none`).
* The production read-only kits were not run in this pass (production untouched); `production-prelaunch` remains a
  required step before any production release.

## 6. Verdict
* **Staging 077: PASS** — every PRIORITET 1–3 item verified on real staging, 0 CRITICAL / 0 HIGH open.
* **Production 077: LIMITED GO** once the owner gives written approval, the read-only `production-prelaunch` kit passes,
  and the D-C1…D-C5 defaults are accepted. Scope: director = manager, simple panel, UZS / USD sales and payments,
  period report; excluded: profit / rate difference of currency sales (D-C3). Because 078 fixes F77-11 and adds the
  required archive function, the recommended path is to release **077 + 078 together** after 078 passes on staging.
* **Production 078: NO-GO today** — local proof is complete, real-staging proof (§5 steps 1–3) is still missing.
