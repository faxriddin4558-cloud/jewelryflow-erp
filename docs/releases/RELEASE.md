# Goldia Sales — release in one command

Run from the repository folder in Windows PowerShell (5.1 or 7). Needs: git, Node.js 20+, PostgreSQL 17 client
(`C:\Program Files\PostgreSQL\17\bin`), Vercel CLI login (`npx vercel@latest login`), Microsoft Edge or Chrome.

```powershell
git fetch origin claude/goldia-sales-077-parity-period-currency; git checkout --detach FETCH_HEAD
# 1. staging (database + frontend + read-only smoke)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target staging
# 2. production - only after 1 is DONE, only with the owner's written approval of that exact commit
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target production -ApprovedCommit <sha printed by step 1>
```

* Each target has its own Git worktree (`%USERPROFILE%\GoldiaRelease\staging` / `production`), checked out detached at the
  exact branch commit, refused when dirty. Your working folder is never used for a release.
* Steps (each one an existing gated script; the first failure STOPS everything, nothing is skipped):
  * staging: dry run (backup, restore copy, chain, rollback, RLS) → apply in one transaction + postflight → Vercel
    `jewelryflow-sales-staging` deploy (env read-only, `/api/version` = commit, `sha_source=build`) → read-only browser smoke.
  * production: the commit must be live on staging → typed `PRODUCTION <sha7>` → read-only prelaunch checks → fresh
    backup + restore copy + the same chain + emergency rollback + re-apply on the copy → read-only gates → typed ref →
    one transaction with per-migration postflight + business fingerprint → read-only postflight → Vercel
    `goldia-sales-production` deploy (env verified) → read-only post-release checks → read-only browser smoke.
* Guards kept in the child scripts: only Supabase `vouehtlmsunebracahon` (staging) / `vrozlllcaxinavzxueif` (production)
  and the matching Vercel project; JFS demo (`yvvbdoqncubtwlzskgml`) and ERP (`hbbuskyifxkowlozsaym`) are refused
  before any connection. Passwords are asked hidden by the child scripts and never written.
* Log: `%USERPROFILE%\GoldiaBackups\release-<target>-<time>.log`; every step's own report is in the same folder.
* Re-run after a fixed failure: the same command. `-SkipStagingDatabase` / `-SkipProductionDatabase` only when that
  database is already at the release level (the frontend, post-checks and smoke still run).
* Rollback: frontend first (Vercel Instant Rollback to the previous deployment), then
  `docs\releases\production-075\emergency\rollback_<NNN>_with_history.sql`, newest first, one transaction each, owner
  approval (081: seller advances already entered are kept; a manager can reverse them).
