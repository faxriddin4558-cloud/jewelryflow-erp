# PHASE E: production preflight (READ ONLY, 2026-11-12)
Nothing was written to production. This cloud session cannot reach production: the Supabase tool is restricted to staging by a
hook, and the network policy refuses goldia-sales-production.vercel.app. Every production fact below must come from the
owner's read-only commands.

## 1. Versions
| Item | Status |
|---|---|
| Production DB migration level | **NOT VERIFIED**: documents disagree (076 / 080 / 081); not used. Owner command: run-readonly-checks.ps1 -Target production-drift-audit |
| Production frontend commit | **NOT VERIFIED**: owner command: Invoke-RestMethod .../api/version + production-frontend.ps1 (check only) |
| Missing migrations | = (verified level + 1) .. 085; unknown until the level is verified |

## 2. Release / backup kit audit
| Requirement | Kit | Status |
|---|---|---|
| Full backup (public, auth, storage, supabase_migrations) | scripts/goldia-prod-backup-and-preflight.js --fresh (called by the production release script) | exists; pg_dump is read only |
| SHA256 | SHA256SUMS + reuse check | exists |
| Local restore test | disposable local PostgreSQL 17, row counts + business baseline identical | exists |
| Dry run of all migrations | same single-transaction chain SQL (scripts/lib/goldia-chain.js) on the restored copy, per-migration postflight + business fingerprint, emergency rollback newest first, re-apply | exists; postflights 073..085 and rollbacks + emergency rollbacks 073..085 present; **local rehearsal of the production chain only up to 081**: rehearse (verified level)..085 locally once the level is known |
| Schema / function parity | function_body_parity_<level>(_full) for 075..085 (CR-tolerant) | exists |
| RLS | 03_rls_isolation_readonly.sql before / after | exists |
| Balances before / after | 01_baseline_readonly.sql (now also in production-drift-audit) + production-post comparison | exists |
| Rollback / restore plan | emergency/rollback_NNN_with_history.sql newest first (data preserving) or full restore of the fresh dump | exists; owner-approved only |
| Production restart (085) | rpc_financial_restart needs a tooling-written backup verification row; **no production backup-only + verify mechanism** (the staging script refuses production) | MISSING: needed only for step B, not for the release |
| Gap | scripts/goldia-release.ps1 step 1 runs production-prelaunch, which accepts only levels 075 / 076 / 080 | if the verified level is 081..084 the release STOPs there (safe); the kit then needs a prelaunch for that level |

## 3. Separate approvals (never mixed)
Four steps, each with its own approval:
* A: migration + frontend (085 code, no restart);
* B: financial restart;
* C: opening documents;
* D: baseline confirm + lock.

The 085 migration itself writes no business row (staging: balances unchanged, 0 opening periods after the release).
Customers, phones, users, seller assignments and models are kept by the restart (OP-3 on staging).

## 4. Staging residual risks
* Incident (staging only): `accounts.js unban` covered the whole regression set (A / B / noemp, 12 accounts) instead of C. They were unbanned
  for about 1 min, re-banned at once, and nobody signed in during that window. Fixed with explicit unban-c / ban-c / ban-non-c. The script uses the
  staging library, whose key guard refuses any non-staging key, and touches only @goldia-audit.test e-mails, so it cannot reach production.
* Production tools and Auth: the production release and backup scripts make no Auth admin call (no admin/users, no ban, no
  password); auth is only dumped (read). Staging helpers (staging lib key guard, reset-staging-test-passwords.ps1, the staging
  release script's FORBIDDEN_REFS) refuse the production ref.
* Old sessions: not deleted (701 synthetic, 9 demo, 1 gmail on staging).
* RELEASE REVIEW (not blockers):
  * (a) ui-078 U78-07: restore-click timing in the harness; the server restore is correct and idempotent; no financial effect.
  * (b) "midnight": the period report uses the Tashkent business date correctly; the failure was a harness run that crossed 19:00 UTC; no financial effect.
  * (c) F80-1: report speed grows with history.

## 5. Verdict
**Production release: NO-GO** until these are closed:
1. Verify the production DB level + frontend commit (owner, read only).
2. Capture the pre-release financial baseline + postflights + parity + RLS at that level (same command).
3. Local rehearsal of the production chain (verified level)..085, plus prelaunch support for that level (repository / local only).
4. Owner approval A, then goldia-release.ps1 -Target production. B / C / D are later, separate approvals (they need a production backup-verification tool).
