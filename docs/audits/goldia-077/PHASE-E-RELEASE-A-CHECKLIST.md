# PHASE E: production release A (080 -> 085), final checklist (2026-11-13)
## Verified (owner's read-only runs)
* Production DB 080; frontend 2b48df9fa764a793bfa85af60ddfc4dfe3aad8c9 (env production, staging_mode false, ref vrozlllcaxinavzxueif).
* Staging DB 085, frontend 1621c1b (085 integration PASS on staging).
* production-prelaunch: 07_prelaunch_081 PASS; parity 080 = 110 identical / 58 crlf_only / 0 different; baseline 84 lines,
  fingerprint 09dd8eda601a797daf2c51d826f3fe56; RESULT PASS.
* Drift WARN monthly_report_073_effect: the rule flags the presence of the 073 report code (open debt clamped at 0), not data.
  0 customers differ; report 2698.4000 g = live gross debt 2698.4000 g. **Definition, not a financial error**; 082 replaces the report.
  No acknowledgement is needed: 08_drift_audit is not a release gate, and the only prelaunch kit of the 081..085 chain (07) is PASS.
* Approved commit candidate 4c27c0487e6b76071a3fcadc5bce69694e62d6ae: runtime trees identical to 1621c1b (0 non-tooling changes).

## Release A never starts a financial restart
085 only creates tables / functions / triggers. No release script calls rpc_financial_restart, writes a backup verification
(only the staging script can, for a "(sintetik)" organization), records opening documents or confirms a baseline.
The draft guard is inert while no opening period exists. B / C / D stay separate approvals.

## Step 1: gate test, nothing written (stop at the first typed prompt)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target production -ApprovedCommit 4c27c0487e6b76071a3fcadc5bce69694e62d6ae -TestedCommit 1621c1b -ExpectProductionLevel 080
Before the prompt it only does git work and reads the staging /api/version (GET). Expected: "N changed path(s) since 1621c1b ... runtime inputs identical",
"staging runs 1621c1b...". At "Type PRODUCTION 4c27c04 ..." type `NO` -> "RELEASE STOPPED: confirmation did not match". Production untouched.

## Step 2: release A (only after the written approval)
Same command; type `PRODUCTION 4c27c04`. Mandatory gates, any failure stops:
| # | Gate |
|---|---|
| 1/5 | production-prelaunch (read only): 07, parity 080, baseline |
| 2/5 | fresh FULL backup (public, auth, storage, supabase_migrations), SHA256SUMS, local restore (row counts + baseline identical), chain 081..085 on the copy, postflights 073..085, CR-tolerant parity, emergency rollback 085..081 to an exact 080, re-apply; production gates (history 080, parity, RLS before); typed ref `vrozlllcaxinavzxueif`; ONE transaction with 5 per-migration postflight + fingerprint gates; postflight (counts, balances, 79-category fingerprint, parity 085, RLS after) |
| 3/5 | frontend: Vercel goldia-sales-production only, env verified, typed ref, /api/version must show 4c27c04 |
| 4/5 | production-post (read only): postflights + baseline compared with the pre-release baseline (business lines identical) |
| 5/5 | read-only browser smoke: production logins typed hidden; the write guard blocks every write |
Rollback after a committed chain: emergency/rollback_085..081_with_history.sql newest first (owner-approved), or a full restore of the fresh dump.

## After release A
Keep the backup folder private. Next separate decisions: B restart (needs a production backup-verification tool), C opening documents, D baseline lock.
