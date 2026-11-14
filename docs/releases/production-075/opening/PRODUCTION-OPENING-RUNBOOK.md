# Production: release 085 -> 087 and the real opening (short runbook)
Each numbered block is a SEPARATE owner approval. Nothing here runs without it.

## R. Release 085 -> 087 (one gated release, never 086 alone)
Precondition: staging is at 087 and the org D integration passed on the SAME commit.
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\goldia-release.ps1 -Target production -ApprovedCommit <commit>
```
It runs: prelaunch (read only), full backup + restore test, the chain 086 -> 087 on a local copy with rollback and re-apply,
the chain in ONE transaction on production (typed ref), postflights 073..087, frontend deploy, read-only smoke.
Applying 087 freezes nothing and writes no business row: daily work continues.

## O. The opening day (after R)
| Step | Who | What | Command / place |
|---|---|---|---|
| O-0 | owner | Day before: read-only reconciliation of the old balances; fill `goldia-opening-template.xlsx` (A..J, Jamlama) | `docs\releases\production-075\run-readonly-checks.ps1 -Target production-opening-recon` |
| O-1 | sellers | Stop sales. Hand ALL cash / USD / LOM to the manager **in the system** (seller -> manager handover). Tills must be 0 | app, as usual |
| O-2 | owner | Freeze the organization (typed ref + org code). From now the database refuses every ordinary financial write | `node scripts\goldia-prod-opening-backup.js --org <org uuid> --freeze` |
| O-3 | owner | Backup inside the freeze + restore test + ONE verification row | `node scripts\goldia-prod-opening-backup.js --org <org uuid> --backup --write-verification` (keep the printed `--watch` command running in a 2nd window) |
| O-4 | director | `/sales/app/opening`: T0 = Tashkent time (a few minutes ago), choose the backup, type `MOLIYAVIY HISOBNI QAYTA BOSHLASH` | app |
| O-5 | manager | Enter A..J exactly from the template; every reconciliation line green; the totals equal the "Jamlama" sheet | app, `/sales/app/opening` |
| O-6 | manager | Lock (baseline, USD rate of the day). The freeze ends by itself; normal work resumes | app |

Abort at any time BEFORE O-4: `node scripts\goldia-prod-opening-backup.js --org <org uuid> --release-freeze` (nothing else changes).
After O-4 there is no abort: finish O-5 and O-6 (the draft blocks ordinary work until the lock).

## What the server enforces (you cannot get these wrong)
* no restart without a freeze; no ordinary write during the freeze or the draft;
* the backup verification must be written inside the freeze; one backup = one restart (087);
* T0 not in the future, not older than 24 h, not more than 1 h before the freeze (wrong time zone);
* a customer's debt lands in HIS seller's obligation; unsold goods and sold-goods debts are not counted twice; the factory obligation stays separate.
