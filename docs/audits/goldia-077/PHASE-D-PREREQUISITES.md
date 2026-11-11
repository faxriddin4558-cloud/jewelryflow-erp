# PHASE D: prerequisite check (2026-11-11). Read-only; nothing written on staging
| # | Prerequisite | Result | Evidence |
|---|---|---|---|
| P1 | Real staging full dump: exists, SHA-256 = SHA256SUMS.txt, restore test passed | **NOT VERIFIED (owner's computer)** | the dump is only in `%USERPROFILE%\GoldiaBackups\goldia-staging-*`; run `docs\releases\staging-075\show-staging-backup-evidence.ps1` (read-only) and send the output |
| P2 | Can org A be restarted without losing what later tests need? | **NO**: restart is irreversible per organization | restart reverses every document of A and zeroes its balances (11 705 rows of history, 2 362 active sales, period-report scale data). The only undo is restoring the whole staging dump, which would also roll back every other org. Per condition 4: **restart / opening run in a NEW synthetic org C** |
| P3 | 077-084 regression in A keeps A's history | **YES** (additive) | the suites create their own customers / documents and reverse only those; no reset / cleanup / restart call (checked by grep: only parity-matrix *lists* the reset RPCs, as excluded) |
| P4 | Org B strictly read-only with the current harnesses | **NO, harness change needed** | B writes in: conc-rls.js (directorB rate, managerB receipt + consignment, sellerB1 sale / rates / settlement), adv-081.js and ui-078-archive.js (directorB creates a customer), parity-matrix.js (directorB probes write RPCs "harmless in the synthetic org"). Fix: remove these setup writes and keep for B only reads and cross-tenant write *attempts* that must be refused (B fingerprint must stay identical, otherwise STOP) |
| P5 | Pre-test invariants of all other orgs saved | **DONE** | `evidence/staging-085/org-invariants-pre-test.txt`: 63 org fingerprints over 24 financial tables, all columns, plus audit_logs. Script: `supabase/release/staging_org_invariants_readonly.sql` |
| P6 | Synthetic accounts | 12 known (A: 8, B: 3, noemp), all banned | **609 old sessions / refresh tokens never revoked** (A 498, B 64, 11-03 org 32, no-employee 16; 2026-10-27..11-09). Ban blocks their use, but condition 11 needs them revoked: proposal at the end of the run is `delete from auth.sessions where user_id in (<synthetic ids>)` (refresh tokens cascade), approval needed |

## Proposed org C (needs approval: new rows only in C plus 4 new Auth users)
* organization `GOLDIA AUDIT 085 C (sintetik)`, id `a5d17085-0000-4000-8000-202611110085`, code `GOLDIA-AUDIT-085-C`
* 4 new GoTrue users `audit.c085.{director,manager,sellera,sellerb}@goldia-audit.test` (random passwords, 0600 file in the
  session scratchpad, never printed) and their 4 employee rows (admin, production_manager, sales, sales)
* test data created by the harness only with `organization_id = C`; at the end: users banned, sessions revoked, org and rows kept (audit trail)
* backup for the C restart: the release dump does not contain C (C did not exist yet). Two honest options:
  (a) use the verified release dump: it holds every business row of the other orgs; C is disposable; or
  (b) better: add a `--backup-only` mode to the release script (full dump + SHA256SUMS + local restore test, no chain).
      Today the script exits "UP TO DATE" at 085 before taking a backup. The owner runs it after C is seeded.
