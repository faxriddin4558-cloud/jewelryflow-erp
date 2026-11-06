# Goldia Sales 078 — REAL STAGING final audit

Date 2026-11-06. Staging `vouehtlmsunebracahon`: DB **078** (owner's release script: POSTFLIGHT PASS), frontend
**9c95340** (`/api/version`: `full_commit=9c95340d6cb4…`, `env=staging`, `sha_source=build`; app code identical to
`318b3af`, only the deploy script changed). The 078 functions are visible on staging (`rpc_reopen_report_period`,
`rpc_archive_customer` in the PostgREST schema).
Production (076, `e717ffc`), JFS demo and ERP were **not touched**. All writes used real GoTrue JWTs through PostgREST /
the real staging frontend, **only in the synthetic organizations** `GOLDIA AUDIT 075 A` / `B`; ground truth = service-role
reads. Synthetic users were unbanned for the run and banned again afterwards (login now refused).
**No business code or migration was changed in this audit**: no real defect was found (§3).
Evidence: `evidence/staging-078/` (IDs, expected / actual per test, operation logs, screenshots).

## 1. Results on real staging
| # | Requirement | Tests (evidence) | Result |
|---|---|---|---|
| 1 | Seller archives / restores own customer, desktop + mobile | U78-01/02 (one confirmation, double click → 1 operation, `archived_by` = seller), U78-05 (restore from "Arxivlangan mijozlar"), U78-09/10 (390 px: archive from the mobile card, restore, 0 API errors) (`staging-ui-078-archive.json`) | **PASS 10/10** |
| 2 | Other seller's / other organization's customer refused | U78-03 (RPC: "sizga biriktirilmagan" / "Mijoz topilmadi"), BY-01 (other seller restore, other org RPC) | **PASS** |
| 3 | Direct API cannot bypass | BY-01/02: 11 attempts — PATCH `is_archived` / `archived_at` of another seller's customer (0 rows), PATCH `archived_by` / `is_archived` of an unassigned customer (refused by the guard trigger), `seller_id` hijack together with the archive flag (refused), DELETE own customer with operations (refused), DELETE other seller's (0 rows), worker RPC, other org RPC + PATCH; **no row changed** (`staging-078-extra.json`) | **PASS** |
| 4 | Legacy debt, UZS / USD debt, advance, sales, payment history kept | AR-00…03: 19 g legacy debt, 2 000 000 UZS debt, $100 USD advance, 2 sales, 2 currency + 1 gram payment, 1 legacy row → fingerprint of every row **identical** before / after archiving; audit row stores the open balances | **PASS** |
| 5 | Archived customer in reports, debt collectible | AR-04 (unified ledger, manager + own seller: 19 g), AR-05 (period report closing = live incl. the archived customer), AR-06 (archived customer pays 1 800 000 so'm → 19 → 17 g; 1 000 000 so'm → UZS debt 1 000 000), AR-07 (manager reverses that payment), AR-08 (stays archived), U78-04 (archived list shows 12.5 g; $200 paid while archived) | **PASS** |
| 6 | Period close, reopen latest, history kept | PR-01…04: close up to 05.11 (stored after 01–04.11; balances fingerprint unchanged); reopen refused for the older period and for a seller; other org → `changed:false`, nothing removed; director reopens latest (manager repeat → `changed:false`), earlier period kept, frozen report kept in `audit_logs.old_data`; same period closed again | **PASS** |
| 7 | 077 regression | parity matrix 46 RPCs × 5 roles: **0 director/manager differences** (only D-P1 test reset); UI 077 **21/21** (manager capital, presets, USD / UZS sales and payments, reversal, report, CSV, new period, 390 px); targeted **25/25** (reclassify UZS→USD + reversal back to the exact vault state, employee id ≠ auth uid manager + director, report boundaries yesterday / today, director 390 px); currency stress **13/13** (103 currency + 40 gram sales, 150 payments, 30 reversals, 15 attacks, 8× parallel → 1; model = DB 0.0000) | **PASS** |
| 8 | 076 regression | 076 API **57/57**, 076 stress **16/16** (210 sales, 210 payments, 30 inventory, 104 legacy, 55 reversals, 60 attacks, 0 failures), integrity **9/9** (9 sellers, 1 271 pieces, 1 515 sales, 1 860 allocations), 076 UI **16/17** (UI-14 superseded by director = manager) | **PASS** |
| 9 | Double click, idempotency, isolation, reconciliation | 8 parallel archive calls → 1 change / 1 audit row; repeated archive / restore / reopen → `changed:false`; UI double clicks → 1; other-org refusals (BY, matrix, stress attacks); currency model = DB; integrity identities; report closing = live balances | **PASS** |

## 2. Harness corrections made during this audit (test code only, disclosed)
* `staging-077-targeted.js`: the report window was hard-coded to "today = 05.11"; on 06.11 RB-04 / RB-06 failed. Dates
  are now relative to today (window 05.10 … today, boundary yesterday / today, next 30 days). Re-run 25/25.
* `ui-077.js` U77-21 read the report a fixed 3 s after "Hisobot"; staging now holds more data, so the page still showed
  the previous first-of-month report. It now waits for the response of the requested dates. Re-run 21/21.
  I first suspected a stale-response race in the page and wrote a fix; a deterministic test
  (`ui-078-report-race.js`: the first report delayed 6 s) **passes on the deployed build** — the "Hisobot" button is
  disabled while a load runs — so the fix was **reverted** (no app change).
* `ui-078-archive.js`: the "back in the list" check now counts the customer's own table row (a wrapping card matched
  every customer); added U78-10 (full mobile archive + restore).

## 3. Findings
| ID | Sev | Finding | Status |
|---|---|---|---|
| — | CRITICAL / HIGH / MEDIUM | none found in 078 on real staging | — |
| F78-2 | LOW (pre-existing since 038) | a seller can assign an unassigned customer to himself with a direct write | decision gate D-A2 |
| F78-3 | INFO | `rpc_reopen_report_period` answers another organization with `changed:false` and echoes the id it was given (no data of the other organization is returned or changed) | acceptable |
| F77-12 | INFO | staging org A has balances older than its documents (`undocumented_opening`: manager cash 14 800 000, stock −1 075.847 g, factory −2 436.6232 g) | staging seeding; report shows it separately |
| F77-7 | INFO | test reset / cleanup stay director-only, unaware of currency / archive data | open exception D-P1 |
| D-A1 | decision | a sale to an archived customer is hidden in the UI but not refused by the server | owner decision |

## 4. Not verified here (open)
* SQL-level RLS read / write isolation probes were not re-run by me (no staging DB password); they ran in the owner's
  078 release script (POSTFLIGHT PASS) and in the local rehearsal (9 829 read checks PASS). API-level isolation was
  re-tested (attacks above).
* Anonymous (no login) calls were not re-tested on staging; the 078 postflight checks that `anon` cannot execute the
  archive / reopen functions.
* Report boundary at Tashkent midnight: proven from `sale_date` = Tashkent date of `created_at`; no real sale between
  19:00 and 24:00 UTC exists on staging.
* Windows PowerShell 5.1 itself did not run here (pwsh 7 parser + functional tests only); the owner's deploy run passed.
* Production read-only kits (`production-prelaunch`) were not run in this pass.

## 5. GO / NO-GO
| Function | Staging | Production |
|---|---|---|
| Seller archives / restores own customer (078) | **GO** | **LIMITED GO** after written approval (release 077 + 078 together) |
| Archive security (server rule, guard trigger, isolation) | **GO** | as above |
| Debts / history kept, collectible while archived | **GO** | as above |
| Period close + reopen latest | **GO** | as above |
| Director = manager (077) | **GO** (exception D-P1) | as above |
| UZS / USD sales and payments (077) | **GO** | as above; profit / rate difference of currency sales excluded (D-C3) |
| Period report (077) | **GO** | as above |
| 076 functions (legacy debt, gram sale, till, RLS) | **GO** | already in production (076) |

Production preconditions: owner's written approval, `run-readonly-checks.ps1 -Target production-prelaunch` PASS,
D-C1…D-C5 / D-A1 / D-A2 defaults accepted, then `goldia-prod-release.js` 077 → 078 (the production release kit for 078
still has to be extended and rehearsed — it currently knows `--migration 077`), frontend, `production-post`, smoke.
Until then: **production NO-GO for any change**; production stays 076 strictly read-only.
