# Goldia Sales 079 — REAL STAGING final audit

Date 2026-11-06. Staging `vouehtlmsunebracahon`: DB **079** (owner's release script: POSTFLIGHT PASS), frontend
**0d3cb62** (`/api/version`: `full_commit=0d3cb625…`, `env=staging`, `sha_source=build`). Production (076, `e717ffc`),
JFS demo and ERP **not touched**. All writes with real GoTrue JWTs through PostgREST / the real staging frontend, only
in the synthetic organizations `GOLDIA AUDIT 075 A / B`; ground truth = service-role reads. Every suite was re-run on
079 (no earlier result is counted). Synthetic users unbanned for the run and **banned again** (login refused).
Evidence: `evidence/staging-079/` (ids, expected / actual, operation logs, screenshots).

## 1. Results on real staging 079
| # | Requirement | Tests | Result |
|---|---|---|---|
| 1–2 | New sales to an archived customer refused by the server on every path | DA1-01 gram, exact UZS, exact USD, barcode piece (seller) + manager + director → `ERR_CUSTOMER_ARCHIVED`; DA1-07 consignment client sale + legacy create-sale → `ERR_CUSTOMER_ARCHIVED`; DA1-02 stock / 585 debt / USD debt / sale count unchanged (`staging-079-da-079.json`) | **PASS** |
| 3 | Old debt collectible, payment reversible, reports work | DA1-03 900 000 so'm → −1 g, $200 → USD 300; DA1-04 manager reverses → USD 500; DA1-05 UI archived view: sale button disabled, payment enabled; DA1-06 sale works after restore; 078 AR-04…07 (ledger, period report, collections, reversal) | **PASS** |
| 4 | Seller cannot take an unassigned or another seller's customer | DA2-01 claim / move / unassign refused; DA2-05 seller A → seller B's customer 0 rows + archive refused, other-org seller → unassigned 0 rows; DA2-03 selling to an unassigned customer still works and does not assign it | **PASS** |
| 5 | Director = manager | DA2-04 both assign; parity matrix 46 RPCs × 5 roles: **0 differences** (only D-P1 test reset) | **PASS** |
| 6 | 078 archive / restore desktop + mobile, debt + history kept | archive UI **10/10**, extra **17/17** (balances + history fingerprint unchanged, 11 bypass attempts refused, period close / reopen) | **PASS** |
| 7 | 077 capital, reclassification, UZS / USD, report | UI 077 **21/21**, targeted **25/25** (reclassify UZS→USD + reversal back to the exact vault, employee id ≠ auth uid, report boundaries), currency stress **13/13** (103 currency + 40 gram sales, 150 payments, 30 reversals, 15 attacks, 8× parallel → 1; model = DB) | **PASS** (report: see F79-1) |
| 8 | 076 legacy debt, gram sale, till, reversals, RLS | 076 API **57/57**, 076 stress **16/16** (210 sales, 210 payments, 104 legacy, 55 reversals, 60 attacks), integrity **9/9**, 076 UI **16/17** (UI-14 superseded by director = manager) | **PASS** |
| 9 | Double click, retry, parallel, cross-tenant | DA1-08 8 parallel + retry to the archived customer → all 9 refused; DA1-09 other org: sale / payment / restore refused; 078 AR-01 8 parallel archive → 1 change; currency stress parallel → 1; 076 / currency attacks | **PASS** |
| 10 | Independent reconciliation | RC-CUR 181 customer × currency pairs: DB = active sales − applied − advance (414 sales, 538 payments) **0.00**; RC-STK 9 sellers: stock = held pieces **0.0000 g** (1 958.7208 g); RC-OBL legacy obligation = active debt deltas **0.0000 g** (387 rows); RC-NEG no negative balance; currency model = DB **0.0000**; integrity identities. **RC-585 via the period report: BLOCKED by F79-1** (same identity computed exactly, 0.0000 g, when the report finished: 01–06.11, 05.11, 06.11) | **PASS except RC-585 (blocked)** |

## 2. Findings
| ID | Sev | Finding | Status |
|---|---|---|---|
| — | CRITICAL / HIGH | none | — |
| **F79-1** | **MEDIUM** | `rpc_get_period_report` (077) hits the API statement timeout (HTTP 500 "canceling statement due to statement timeout") for a 6-day window on staging org A (~2 000 sales): the effects function ran 7× per report (once per seller in a lateral) with a correlated `audit_logs` subquery per sale. Production has 52 sales today, so it would surface after months of use, but the report is a release feature | **fixed in 080** (commit `b6e370b`): effects computed once + grouped join; 580 reports jsonb-identical before / after on a local copy, 618 s → 96.5 s (slowest 1.62 s → 0.28 s); **staging verification pending** (owner applies 080) |
| — | INFO | harness corrections (test code only): U77-21 compared a rounded USD amount with a page that shows cents ($58 012,52); CS-REP-03 rounded grams to 2 decimals on both sides (a .xx5 float boundary gave a false 0.01); RC-OBL first counted advance entries (now debt deltas only, the 076 rule) | fixed, re-run PASS |
| — | INFO | the 077 emergency rollback refuses while UZS / USD data exist (documented limit, reproduced locally: `rollback-077-refused-with-currency-data.json`) | by design |
| F77-12 | INFO | staging org A has balances older than its documents (undocumented opening) | staging seeding |
| D-P1 | open exception | test reset / cleanup stay director-only | owner decision |

## 3. Not verified
* Period report on staging after the 080 fix (needs the owner to apply 080 + no frontend change is needed; then I re-run
  RC-585, CS-REP, U77-21…25 and a timing check on the 01–06.11 window).
* SQL-level RLS probes on staging (no DB password; they run in the owner's release script).
* Anonymous calls on staging (postflights check `anon` has no EXECUTE on the new functions).
* Windows PowerShell 5.1 itself; the production pooler (only local rehearsals).

## 4. GO / NO-GO
| Function | Staging | Production |
|---|---|---|
| 079 D-A1 (no sale to an archived customer) / D-A2 (no self-assignment) | **GO** | LIMITED GO with the chain (below) |
| 078 archive / restore, period close + reopen | **GO** | as above |
| 077 director = manager, capital, reclassification, UZS / USD sales + payments | **GO** | as above (profit of currency sales excluded, D-C3) |
| 077 period report | **NO-GO until 080 is verified on staging** (timeout at ~2 000 sales / org) | release only together with 080 |
| 076 functions | **GO** | already in production |

**Production today: NO-GO.** Required before the release: 080 on staging (`node scripts/goldia-staging-release.js
--apply`, 079 → 080) + my re-run of the report checks; then the prelaunch steps in
`docs/releases/production-075/PRELAUNCH-076-080.md`.
