# PHASE D progress (2026-11-11 / 12, staging vouehtlmsunebracahon)
## Done
* Org C `GOLDIA AUDIT 085 C (sintetik)` a5d17085-0000-4000-8000-202611110085 + exactly 4 users (audit.c085.{director,manager,sellera,sellerb}@goldia-audit.test) + 4 employees.
  The auth trigger only links pre-existing employee rows by e-mail, so the user creation touched no other org.
* C seed (UI path, own JWTs): receipt 60 g @8 %, consignment 3 pieces 20 g, 2 customers, barcode sale, UZS payment, USD sale 300 + payment 100 @12 600, legacy debt 2 g
  -> seller stock 8 g, owes 24 g, till 900 000 UZS + 100 USD, vault 40 g, factory 64.8 g (= 60 x 1.08).
* Harness changes (B strictly read-only): the "other organization" actor of adv-081 / da-079 / ret-083 / currency-stress / parity-matrix /
  ui-078-archive / staging-078-extra / conc-rls is now configurable (GA_OTHER_*; PHASE D = C). conc-rls write probes aim at C (GA_FOREIGN_ORG); B is only read.
  RLS4 leak check: an empty answer (no entries, totals 0) counts as refused (A director on a C seller got entries [] / totals 0).
  opening-085 on staging uses only tooling-written verification rows with the owner's SHA-256 (GA_BACKUP_SHA256), never writes one.
* `--backup-only [--verify-org <synthetic org> --verify-count N]` in scripts/goldia-staging-release.js; local rehearsal: evidence/staging-backup-only/
  (case1 with --apply STOP, case2 non-synthetic org STOP, case3 PASS, case4 2 rows written, row SHA = SHA256SUMS = recomputed).

## Regression on A (additive, history kept) and isolation
| Suite | Result |
|---|---|
| staging-077-targeted | 25/25 |
| staging-078-extra | 17/17 |
| da-079 | 14/14 |
| recon-079 | 5/5 |
| report-080 | 8/8 |
| adv-081 | 11/11 |
| balance-082 | 13/13 |
| ret-083 | 23/23 |
| rate-084 | 13/13 |
| currency-stress | 13/13 (run 1: 11/13 because it crossed Tashkent midnight 19:00 UTC; 122 sales were dated 11-12 while the report asked for 11-11; harness timing, re-run inside one day 13/13) |
| parity-matrix | director = manager mismatches 0, missing 0 |
| ui-077 | 21/21 |
| ui-078-archive | 10/10 (run 1: 9/10, U78-07 UI restore click not applied within 3 s; the server restore works, re-run 10/10). Flaky UI timing, REVIEW |
| conc-rls | K1 K2 K3 K5 RLS1 RLS2 RLS3 PASS; K4 in A: the till held ~203 g of history (harness assumed a fresh till) -> K4 re-proved on a fresh 1 g till in C: PASS (one handover, +1.0000 g, till 0); RLS4: no leak (see above) |
| rls-b-read | 408 reads of B by A / C users: 0 rows; B director sees own rows |

Invariants (independent SQL, all columns of 24 tables per org): after every step only A and C differ; B, Goldia Jewelry Demo Staging and the other 60 orgs are identical.
Synthetic accounts: banned again while waiting for the backup.

## Waiting
New full backup of staging (contains C) with 2 verification rows for C -> then restart / opening OP-1..OP-10 in C.
