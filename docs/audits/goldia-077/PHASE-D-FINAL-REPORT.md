# PHASE D: staging 085 integration, final report (2026-11-12)
Staging vouehtlmsunebracahon, DB 085, frontend 1621c1b. Production, Manufacturing ERP and JFS Demo: not touched.

## Backup used for the C restart (verified read-only before use)
2 rows in financial_backup_verifications: org C, unused before the test, restore_verified, written by the tooling (postgres),
reference goldia-staging-2026-11-12T06-00-47/staging-full.dump, SHA-256 9ca717e3...4260 = the owner's output. No business write between the dump and the test.

## Results
| Block | Org | Result |
|---|---|---|
| 077-084 regression (12 suites) | A (additive, history kept, no restart) | all PASS; 2 harness re-runs: currency-stress crossed Tashkent midnight, ui-078 UI timing (REVIEW, flaky) |
| conc-rls K1..K5, RLS1..RLS4 | A, C as foreign write target | PASS (K4 re-proved on a fresh till in C; RLS4: an empty answer is no leak) |
| B read isolation | B read-only | 408 reads, 0 rows |
| OP-1..OP-10 restart + opening (UI + API, real JWTs) | C | 10/10 PASS |
| D-4 / D-6 / D-2 UZS / D-2 USD / D-3 / D-1 (oracle = local final-rules tests) | C | 6/6 PASS |

### Opening reconciliation (C)
* OP-6: all 8 checks green at the lock; lock via baseline; a later opening entry refused (ERR_OPENING_LOCKED).
* OP-4 / OP-5: manager 100 g @8 % -> stock 70 after 30 g to seller A, factory 108; seller obligation 33.6 + 10 (UZS 8.6 M @860 000) = 43.6 g.
* Second opening (D-rules): factory 108 - 17.0769 (10 g @999 payment) = 90.9231 g; seller obligation 50 g @12 % = 56 g after the 10 g + 1.4 g handovers;
  company rate difference 0.4444 g (UZS) and 0.0111 g (USD) recorded, removed by the reversal and recorded once on the redo; advance 50 USD = liability 0.6944 g, result unchanged.
* After the lock, the live-vs-documents checks naturally differ (7 ordinary documents after the lock); they are gates for the lock only.

## Invariants of the other organizations (independent SQL, all columns of 24 financial tables)
* pre-test (63 orgs) -> after regression: only A and C changed.
* pre-OP (64 orgs) -> after OP + D-rules: only C changed; **A, B, Goldia Jewelry Demo Staging and the other 60 orgs identical**.

## Cleanup
* C: 4 accounts banned; sessions 0, live refresh tokens 0 (each user signed in once and signed out with scope=global).
* All 40 synthetic accounts banned. Incident: `accounts.js unban` lifted the ban for about 1 min on the 12 regression accounts (A / B / noemp) instead of only C;
  re-banned at once; no sign-in in that window (last sign-ins from the day before). The script now has unban-c / ban-c / ban-non-c.
* Not touched as agreed: 701 older synthetic sessions (see auth-sessions-inventory-2026-11-12.md), 9 demo-account sessions, 1 gmail account.

## Financial defects found
None in the database logic. Found and fixed in the test harnesses only: K4 till assumption, RLS4 empty-answer, midnight crossing, B setup writes.

## Production: remaining real blockers (NO-GO)
1. Production DB level and frontend version **not verified** (owner read-only check: history + /api/version).
2. Release 081..085 (from the verified level) has not been rehearsed on a restored copy of the production backup (dry run) and has no owner approval.
3. A production backup-only + verification mechanism for an opening restart does not exist (the staging script refuses production by design); needed before any production restart.
4. Real opening documents (manager / seller stock, customer UZS / USD debts and advances, factory obligation) must come from the books and be approved by the owner.
5. Production read-only smoke with a post-release baseline file (B3) after the release.
6. Low / REVIEW: ui-078 U78-07 UI timing flake; F80-1 report time grows with history (date-bounded design later).
