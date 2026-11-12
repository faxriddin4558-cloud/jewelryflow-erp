# PHASE E: production 080 -> 085 local release rehearsal (2026-11-12)
Production was not touched (no connection from this session). Everything ran on a disposable LOCAL PostgreSQL 17 stand-in,
built at 080 with the repository migrations 001..080 and seeded with 60 organizations, 200 users, sales, settlements, purchases,
handovers and production-shaped USD currency sales / payments and legacy debts. The real production release script
(auto level detection, --expect-level 080, Windows CRLF psql simulation) ran in --local-rehearsal mode.

## Owner's read-only production audit (input, not re-measured here)
DB 080 (081 not applied); postflights 073-080 PASS; function parity 110 identical / 58 crlf_only / 0 different; RLS PASS;
baseline 84 lines, fingerprint 09dd8eda601a797daf2c51d826f3fe56; customers gross debt 2698.4000 g, advance 1.1700 g,
signed net 2697.2300 g; 8 currency accounts, 8 currency payments; 08_drift_audit = WARN. Frontend commit: **not yet verified**.

## Rehearsal results
| Run | Stand-in shape | Result |
|---|---|---|
| lf-pass | 080, all bodies LF (168 identical) | PASS: backup + SHA256SUMS + restore (row counts and baseline identical), chain 081..085 on the copy, postflights 073..085, emergency rollback 085..081 back to exact 080, re-apply, chain on the stand-in in ONE transaction (5 per-migration gates), postflight PASS, balances / 79-category fingerprint unchanged, parity 182/0/0, RLS PASS |
| crlf-before-fix-FAIL | 080 like production: 110 identical + 58 crlf_only | **FAIL** at the copy gate "back at 080 after the emergency rollback" (lost=5 extra=5): the rollback restores 5 replaced functions from LF repository text, while the originals had CR. Formatting only (proved: md5 of each original with CR removed = md5 after the rollback). **The real production release would have STOPPED here (safe, but blocking).** |
| crlf-after-fix-PASS | same production shape | PASS: the gate compares function bodies CR-tolerantly and every other schema line byte for byte; "carriage-return-only bodies after the rollback: 5" reported; whole release PASS (parity before 110 + 58, after 129 identical + 53 crlf_only, 0 different) |
| crlf-real-change-STOP | production shape + one planted real code change | **STOP** (lost=1 extra=1, 4 CR-only reported): a real difference is still refused; the stand-in stayed at 080 |

Fix: scripts/goldia-prod-backup-and-preflight.js (SIG_LF = signature with md5(replace(prosrc, chr(13), '')) for H lines only).

## 08_drift_audit WARN rules that can fire at 080 (owner to send the DRIFT|...|WARN lines)
* monthly_report_073_effect: the 080 monthly report clamps the open debt at 0 (advance not netted). This is a **report definition** difference, fixed by 082 (signed balance); no ledger error.
* debt_and_advance_at_once: a customer holding debt and advance at the same time. This is a data state; 081 / 082 show it as gross / advance / signed net. To be reviewed per customer, not a migration blocker.
* history_gaps / history_unknown / archive / trigger checks: OK expected at 080 (postflights 073-080 passed).

## Release plan (separate approvals)
A (needs approval): `scripts\goldia-release.ps1 -Target production -ApprovedCommit <sha> -ExpectProductionLevel 080`. Its steps:
staging must run <sha> -> production-prelaunch at 080 (07 + parity 080 + baseline) -> fresh backup + restore + copy chain + rollback + re-apply
-> typed ref -> one transaction 081..085 -> frontend -> production-post (baseline comparison) -> read-only smoke.
B financial restart, C opening documents, D baseline lock: later, separately approved; B needs a production backup-verification tool.

## Verdict
Rehearsal (production shape 080 -> 085): **PASS after the CR fix**; negative proof PASS.
Production release: **NO-GO until**:
1. the frontend commit is verified (/api/version);
2. the 08_drift_audit WARN lines are reviewed;
3. the fixed kit commit is released to staging first (the release requires staging to run the same commit);
4. owner approval A.
