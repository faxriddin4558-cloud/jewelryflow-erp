# Goldia Sales — production release 076 → 077 → 078 → 079 (prepared, NOT executed)

> Superseded for the chain end: the release now goes to **080** (`--chain-to 080`, period report fix) - see `PRELAUNCH-076-080.md`.

Branch `claude/goldia-sales-077-parity-period-currency`. Production today: DB **076**, frontend **e717ffc** — untouched
(no read, no write, no deploy in this preparation). JFS demo and ERP untouched.

## 1. What goes to production
| Migration | Content | Real staging |
|---|---|---|
| 077 | director = manager (parity), UZS / USD exact-price sales + currency payments, period report + "Yangi davrni boshlash" (no reset), F77-2 / F77-3 fixes | PASS (`docs/audits/goldia-077/STAGING-AUDIT.md`) |
| 078 | seller archives / restores own customer (soft delete, server rule + guard trigger), reopen latest report period | PASS (`STAGING-078-AUDIT.md`) |
| 079 | **D-A1** no new sale to an archived customer (server, every sale path; payments / reversals keep working); **D-A2** sellers cannot (re)assign customers (director = manager can) | **pending on real staging** (local full stack 10/10, vitest 6/6) |

Unchanged on purpose: D-C1…D-C5 rate and accounting rules as tested on staging; **no profit / rate-difference computation
for UZS / USD sales** (D-C3). Director = manager everywhere (parity matrix 0 differences) — **open exception D-P1**:
`rpc_preview/execute_full_test_reset` and `rpc_preview/execute_staging_test_cleanup` stay director-only (they wipe data).

## 2. Release mechanics (automatic STOP on any failure)
`node scripts/goldia-prod-release.js --migration 077 --chain-to 079`
1. **Fresh backup** of production (read only), restore into a disposable local PostgreSQL, baseline identical production
   = copy; 077 compatibility; then on the copy **exactly the production chain SQL** (one transaction), postflights
   073..079, expected 079 schema, business fingerprint unchanged, **emergency rollback 079 → 078 → 077 back to 076**
   (schema + fingerprint), **re-apply**. Gate `chainTo` must PASS.
2. **Production read-only gates**: latest must be exactly 076, none of 077..079 recorded; prelaunch kits 05 (077) and
   06 (078 / 079) — STOP stops, WARN stops unless the owner re-runs with `--acknowledge-findings` after review; 076
   function-body parity (DIFFERENT / MISSING stops); RLS isolation probe (before).
3. Owner types the production ref.
4. **One transaction** (`scripts/lib/goldia-chain.js`): for 077, 078, 079 in turn — migration, history row, every postflight
   check of that migration, and the **business fingerprint** (balances, customer 585 g debts / advances, seller stock and
   tills, manager vault / cash, factory obligation, customers, sale / payment / cash / legacy / consignment / receipt
   history, row counts of every table). Any difference or failed check raises → **the whole chain is rolled back**,
   production stays 076.
5. Read-only postflight: 073..079 postflights, row counts, balances, fingerprint (76 categories), no new RLS leak.
   On failure after commit the script stops and prints the rollback order.

## 3. Evidence (local, production-shaped stand-in: 60 organizations, 200 logins)
| Test | Result | File |
|---|---|---|
| Full chain release rehearsal (`--local-rehearsal`) | **PASS**: copy chain + rollback + re-apply PASS, prelaunch 05 OK, 06 OK, parity identical 156, RLS PASS, chain applied, 073..079 postflights true, counts / balances / fingerprint unchanged, RLS 9 829 PASS | `docs/audits/goldia-077/evidence/release-rehearsal/production-chain-077-079/` |
| Re-run on a database already at 079 | **STOPPED** automatically, nothing changed (fingerprint identical) | `…/NEGATIVE-rerun-at-079-SUMMARY.txt` |
| Chain gate test | **5/5**: emergency rollback to 076; a 0.0001 g balance change inside 078 → "BUSINESS DATA CHANGED after 078", nothing applied; failing 079 postflight → nothing applied; clean chain PASS; double apply refused | `…/chain-gates-test.json` |
| Read-only kits | `production-prelaunch` at 076 **PASS** (05, 06, parity, baseline); `production-post` at 079 **PASS** (postflights 073..079, business lines identical to the pre-release baseline) | `…/kit-production-*.log` |
| Staging release script 078 → 079 (local rehearsal) | DRY RUN PASS, APPLY + POSTFLIGHT PASS | `…/STAGING-079-*.txt` |
| vitest (all migrations 001..079) | 380/380 | — |
| 079 D-A1 / D-A2, real browser + JWT, local | 10/10; 077 UI 21/21 and 078 archive 10/10 on the 079 build | `docs/audits/goldia-077/evidence/local-079/` |

## 4. Windows PowerShell commands (repo root, from the release commit)
Release commit: the HEAD of the branch that contains this file (`git rev-parse HEAD`). App code last changed in `0c14df2`.
```powershell
git fetch origin claude/goldia-sales-077-parity-period-currency; git checkout --detach FETCH_HEAD; git rev-parse HEAD
```
**A. Staging 079 first** (proves D-A1 / D-A2 on real staging):
```powershell
node scripts/goldia-staging-release.js
node scripts/goldia-staging-release.js --apply
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\staging-075\deploy-staging-frontend.ps1 -ReleaseCandidate (git rev-parse HEAD)
```
then I run `da-079.js`, `ui-078-archive.js`, `ui-077.js`, `parity-matrix.js` with `GA_TARGET=staging`.

**B. Production — only after A is PASS and the owner's written approval:**
```powershell
# read only
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-prelaunch
node scripts/goldia-prod-backup-and-preflight.js --fresh --migration 077 --chain-to 079
# database (asks the password hidden, then the typed ref; stops by itself on any gate)
node scripts/goldia-prod-release.js --migration 077 --chain-to 079
# frontend, then read-only verification
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\production-frontend.ps1 -Apply -ReleaseCandidate (git rev-parse HEAD)
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-post
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-production-smoke.ps1
```
Order: **database first** (the new frontend on a 076 database cannot record currency sales / reports / archive).

## 5. Rollback and its limits
* Frontend: redeploy `e717ffc` (Vercel "Instant Rollback") **before** rolling the database back.
* Database: emergency files, newest first, one transaction each, only with the owner's approval:
  `docs\releases\production-075\emergency\rollback_079_with_history.sql` → `…078…` → `…077…`.
  - 079: removes the two guards only (sales to archived customers and seller self-assignment become possible again).
  - 078: archived customers **stay archived** (rows and audit kept); sellers lose the archive right; `archived_at` / `archived_by` dropped.
  - 077: **refused while UZS / USD sales, currency payments or currency balances exist** (reverse them first); keeps the
    four `financial_transactions.reclassified_*` columns (reclassification history) on purpose.
  - Proven on the local copy: after 079 → 078 → 077 the copy is 076 again (schema + business fingerprint identical).
* Business data is never deleted by a rollback; no balance changes.

## 6. Owner decisions in force
D-A1 (no new sale to an archived customer; payments allowed) and D-A2 (only director / manager assign customers) — 079.
D-C1…D-C5 defaults (staging-tested; no automatic CBU / market rate, no profit of currency sales). D-P1 open exception.
Prelaunch 06 shows, read-only, how many customers are **already archived with recent sales** (they cannot buy after 079
until restored) — WARN stops the release until the owner reviews it.

## 7. GO / NO-GO
* **Today: NO-GO for production** — 079 (D-A1 / D-A2) is not yet proven on real staging; no written approval yet;
  `production-prelaunch` not yet run on real production.
* **LIMITED GO** for `--migration 077 --chain-to 079` + frontend when: staging 079 PASS (A) · `production-prelaunch` PASS
  (or WARN reviewed) · fresh backup / copy chain gate PASS · owner's written approval. Scope: director = manager,
  simple panel, UZS / USD sales and payments, period report, customer archive, D-A1 / D-A2. Excluded: profit / rate
  difference of currency sales (D-C3); test reset stays director-only (D-P1).
* Not verified: the release scripts against the real production pooler (only local rehearsals); Windows PowerShell 5.1
  itself (pwsh 7 parser + ASCII checks only).
