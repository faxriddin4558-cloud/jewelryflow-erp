# PHASE D: staging 085 integration, read-only preparation (2026-11-11)
Staging `vouehtlmsunebracahon` only, read-only SQL via the staging-restricted MCP. No migration, deploy, Auth change or write.
Production, Manufacturing ERP and JFS Demo were not touched.

## 1. B3: balances before / after the release
| Evidence | What it proves | Status |
|---|---|---|
| Release script step [9/10]-[10/10]: `per-organization balances: unchanged` (ORG_BALANCES before and after the chain, same session) | customer debt/advance, seller owes/stock, vault UZS/USD of **every** org unchanged by 081..085 | in the owner's release folder (`RESULT` / console). **Not visible here; owner to confirm the line** |
| Release step [4/10]-[8/10]: backup + restore test on a local copy; chain on the copy with balances before = after, emergency rollback, re-apply | the same on a full copy, plus rollback | owner's release folder |
| No business row written since 2026-11-10 (sales, settlements, transactions, currency, receipts, restarts and opening documents: 0; audit_logs since 11-11: 0) | today's DB = the post-release state | **VERIFIED (SQL, read-only)** |
| `evidence/staging-085/baseline-post-release-2026-11-11.txt` (generated with the repository's `01_baseline_readonly.sql` lines, read-only) | numeric post-release baseline for the demo org and both synthetic orgs | **created** |

Limit: the release script stores only the *equality* of before/after, not the numbers. A numeric pre-release comparison
needs the release dump restored locally (`pg_restore` into a disposable cluster, then `01_baseline_readonly.sql`). This
was not done here, so the pre-release numbers are **NOT VERIFIED**. B3 now becomes a real check:
`node scripts\goldia-prod-smoke-readonly.js --target staging --expect-commit 1621c1b --baseline docs\audits\goldia-077\evidence\staging-085\baseline-post-release-2026-11-11.txt`
(director org = Goldia Jewelry Demo Staging: debt 0, advance 0, sellers 0, manager stock 100 g, factory obligation 108 g; this is the D-1 example, 100 g @ 8 %).

## 2. G3: unexpected blocked requests
The guard lets through only GET requests, the Auth token request and RPCs in `READ_RPCS`. Every other POST is aborted
in the browser before it leaves, so no write reached staging (audit_logs since 11-11 = 0 confirms it).
UI RPCs that were missing from both lists (classified on staging):
| RPC | Page | Volatility | Writes? | Smoke change |
|---|---|---|---|---|
| rpc_get_operation_rate_review | /sales/app/sellers (director, manager) | STABLE | none: PostgreSQL refuses DML in a STABLE function | added to READ_RPCS |
| rpc_get_opening_state | /sales/app/opening | STABLE | none | added to READ_RPCS; /opening page added for director and manager |
| rpc_preview_selective_test_cleanup, rpc_preview_full_test_reset | /sales/app/settings (staging only tab) | VOLATILE | no DML in the body today | EXPECTED_BLOCKS (kept blocked on purpose: VOLATILE) |
Verdict: false positives (read-only RPCs over POST), **not** a write risk. The exact 14 entries are in the owner's
`blocked-requests.json` (role, page, what); please send that list (it contains no secret) to confirm each line.

## 3. Synthetic organizations and users
| Org | id | Users (all banned now) | Use |
|---|---|---|---|
| GOLDIA AUDIT 075 A (sintetik) | a5d17075-...-202611030075 | director, iddir (admin); manager, idmgr (production_manager); sellera/b/c (sales); worker | main test org (restart, opening, regression) |
| GOLDIA AUDIT 075 B (sintetik) | a5d17075-...-20261103075b | directorB, managerB, sellerB1 | second tenant: RLS / isolation |
| GOLDIA AUDIT (sintetik, real Auth) 2026-11-03 | a5d17000-...-202611030001 | 5 banned | not needed |
| noemp | - | banned, no employee | "no employee" negative check |
**Real staging org: Goldia Jewelry Demo Staging (00000000-0000-4001-8001-000000000001)** and the many small legacy test orgs: never written.

## 4. Scope safety (verified in the staging function bodies)
* `rpc_financial_restart`: every INSERT / UPDATE is restricted to the caller's organization or the new restart id.
* `_goldia_guard_opening_draft`: blocks only writes whose `organization_id` has a draft period. A draft in org A does not lock the demo org.
* The restart needs a restore-verified backup row (24 h, one use) that only the service role can write. The OP-1 harness
  writes one with a test reference. On staging it must name the real dump of the same day (owner decision, see §6).

## 5. Test battery (synthetic org A, B as the foreign tenant)
| Area | Harness | Proof |
|---|---|---|
| restart, identities kept, balances 0, double-click = 1 restart | opening-085.js OP-1..OP-3 | restart/draft counts, ids before = after |
| opening inventory, factory/seller obligation (D-1: 100 g @8 % -> 108, seller 30 g @12 %) | OP-4, D-1 checks | vault / seller rows = expected grams |
| UZS/USD debt and advance (D-2/D-3), rate difference on handover | OP-5, rate-084.js, currency-stress.js | currency accounts, pool g, `company_rate_difference_585_g` |
| reversal | ret-083.js, currency reversal cases | balances back to before |
| baseline + lock, entry refused after lock | OP-6 | `ERR_OPENING_LOCKED` |
| draft guard (12 tables), parallel drafts, restart race | OP-9, OP-10 | `ERR_OPENING_DRAFT`, exactly one winner |
| RLS / tenant isolation | parity-matrix.js, conc-rls.js (A vs B) | 0 foreign rows / writes |
| 390 px | OP-7 | no horizontal overflow |
| 077..084 regression | staging-077-targeted, da-079, report-080, adv-081, balance-082, ret-083, rate-084 | per-suite PASS counts |
| real org untouched | before/after `01_baseline` lines of the demo org + row counts | identical |

## 6. Write boundary needing the owner's approval (nothing done yet)
1. Unban, for the run only, the 11 synthetic users above (new passwords via setup.js; stored only in the session scratchpad, not printed). Ban them again at the end.
2. Writes only in org A (and B for the isolation probes) through the harnesses (`GA_TARGET=staging GA_ALLOW_RESTART=1`).
3. One service-role row in `financial_backup_verifications` for org A that names the release dump of 2026-11-11 (owner gives the file name / sha256).
4. Stop rule: any change to the demo org line or any other org line -> STOP and report.
5. Afterwards: demo org and other org lines must equal the baseline file. Report with expected / actual per test.

## 7. GO / NO-GO
Production stays **NO-GO** until §5 passes on staging and the production level and version are verified read-only.
