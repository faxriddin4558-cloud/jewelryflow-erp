# Goldia Sales — production prelaunch readiness 076 → 077 → 078 → 079 → 080

Status 2026-11-06: **NOT READY — one step open** (080 on real staging). Everything else in the kit is prepared and
rehearsed locally. Production (076, `e717ffc`) untouched.

## 1. Readiness checklist
| # | Item | State | Evidence |
|---|---|---|---|
| 1 | 077 / 078 / 079 verified on REAL staging | **DONE** (079 audit: all suites PASS except the report timeout) | `docs/audits/goldia-077/STAGING-079-AUDIT.md` |
| 2 | Period report timeout (F79-1) fixed | **DONE in code** — migration 080, identical results, ~6× faster | commit `b6e370b`, `evidence/local-080/` |
| 3 | 080 verified on REAL staging | **OPEN** — owner: `node scripts/goldia-staging-release.js` then `--apply` (079 → 080); I re-run report checks + timing | — |
| 4 | Production chain release script 076 → 080 | **READY**, local rehearsal PASS (copy chain + emergency rollback to 076 + re-apply; prelaunch 05 / 06 OK; parity 076 identical; one-transaction chain with per-migration postflight + business fingerprint; 073..080 postflights; counts / balances / 76-category fingerprint unchanged; RLS PASS) | `evidence/release-rehearsal/production-chain-077-080/` |
| 5 | Automatic STOP | **PROVEN**: tampered balance / failing postflight roll the whole chain back; re-run on an applied DB stops with nothing changed; double apply refused | `chain-gates-test-080.json`, `production-chain-077-079/NEGATIVE-*` |
| 6 | Emergency rollback 080 → 079 → 078 → 077 | **READY**, proven on a copy without currency data (back to 076: schema + fingerprint); 077 refused while UZS / USD data exist (proven) | `chain-gates-test-080.json`, `rollback-077-refused-with-currency-data.json` |
| 7 | Read-only kits | **READY**: `production-prelaunch` at 076 = 05 + 06 + parity 076 + baseline; `production-post` at 077..080 = postflights + business lines vs the pre-release baseline (rehearsed PASS for 079; 080 adds its postflight) | `kit-production-*.log` |
| 8 | D-C1…D-C5 unchanged, no profit calculation | **YES** (no rate / accounting rule touched by 078 / 079 / 080) | migrations |
| 9 | Director = manager | **YES** (0 differences); **open exception D-P1** test reset / cleanup director-only | parity matrix |
| 10 | Owner's written approval | **OPEN** | — |

## 2. Commands (Windows PowerShell, repo root, release commit = branch HEAD after `b6e370b`)
```powershell
git fetch origin claude/goldia-sales-077-parity-period-currency; git checkout --detach FETCH_HEAD; git rev-parse HEAD
# staging 080 (step 3) - database only, the frontend does not change for 080
node scripts/goldia-staging-release.js
node scripts/goldia-staging-release.js --apply
# production - only after step 3 PASS and written approval
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-prelaunch
node scripts/goldia-prod-backup-and-preflight.js --fresh --migration 077 --chain-to 080
node scripts/goldia-prod-release.js --migration 077 --chain-to 080
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\production-frontend.ps1 -Apply -ReleaseCandidate (git rev-parse HEAD)
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-post
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-production-smoke.ps1
```
The frontend release candidate can be the same HEAD (app code last changed in `0c14df2`; 080 is database-only).
Database first, then frontend.

## 3. Rollback limits
Frontend: redeploy `e717ffc` first. Database, newest first, one transaction each, owner approval:
`emergency\rollback_080_with_history.sql` (restores the 077 report bodies) → `079` (removes the two guards) → `078`
(archived customers stay archived) → `077` (**refused while UZS / USD sales, payments or balances exist**; keeps the 4
reclassification-history columns). No business row is deleted by any rollback.

## 4. Verdict
**NO-GO today** (step 3 and the written approval are open). **LIMITED GO** for `--migration 077 --chain-to 080` + frontend
as soon as: 080 PASS on real staging · `production-prelaunch` PASS (WARN reviewed) · fresh-backup copy-chain gate PASS ·
owner's written approval. Excluded: profit / rate difference of currency sales (D-C3); test reset stays director-only (D-P1).
