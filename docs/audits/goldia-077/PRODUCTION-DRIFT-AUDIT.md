# Goldia Sales — production version drift audit (frontend 2b48df9) — READ ONLY

Date 2026-11-09. **Production FREEZE: nothing was written, deployed, migrated or rolled back.** Staging 081 untouched by
this audit.

## 0. What this session can and cannot see
* Production `vrozlllcaxinavzxueif` and `goldia-sales-production.vercel.app` are **not reachable from this session**:
  the environment's network policy refuses both hosts (proxy HTTP 403), and the Supabase connector lists the staging
  project only. No request of any kind reached production. Items that need the live production DB are therefore
  marked **NOT VERIFIED HERE** and come with a read-only command for the owner (section 5).

## 1. Migration history of production — NOT VERIFIED HERE (evidence of record)
| Source | Says |
|---|---|
| owner's message 2026-11-06 15:01 ("PRODUCTION SMOKE LOGIN FAILURE") | "Production DB **080**, frontend **2b48df9**. Production postflight PASS." smoke 47 PASS / 1 FAIL (L-manager) |
| owner's messages 2026-11-05 / 06 morning | DB 076, frontend e717ffc (before the chain) |
| owner's message 2026-11-09 ("081 RELEASE SAFETY") | "oxirgi tasdiqlangan ... production DB versiyasi 076" — **contradicts** the 11-06 report |
| git | 2b48df9 (2026-11-06 10:35 UTC) = the CR-safe chain-gate fix written right after the Windows copy-chain gate failure of the 076 → 080 production run; it is on `claude/goldia-sales-077-parity-period-currency` |
Most probable sequence (inference, to be confirmed by section 5): on 2026-11-06 the owner ran the chain 076 → 080 with
the fixed kit from 2b48df9, then `production-frontend.ps1 -Apply -ReleaseCandidate 2b48df9`, then the smoke. The later
"076" statement is the drift in the *documents*, not necessarily in the system.

## 2. What frontend 2b48df9 needs from the database (static, from `src/` at 2b48df9)
83 RPCs and 10 key tables checked. Everything exists since ≤ 076 except:
| Needs | Objects | Feature |
|---|---|---|
| 077 | `rpc_record_currency_sale`, `rpc_record_client_currency_settlement`, `rpc_reverse_client_currency_settlement`, tables `client_currency_accounts`, `client_currency_settlements`, column `jewelry_sales.sale_currency` | UZS / USD sales and payments |
| 077 | `rpc_get_period_report`, `rpc_close_report_period`, table `goldia_report_periods` | period report page |
| 077 | new bodies of `rpc_confirm_accounting_baseline`, `rpc_manage_sales_markup_preset`, `rpc_reclassify_capital_transaction`, `rpc_reverse_financial_transaction`, `rpc_reverse_client_sale`, `rpc_issue_seller_consignment` | manager = director (capital, baseline, presets, reversals) |
| 078 | `rpc_reopen_report_period`, `rpc_archive_customer` (seller branch), `customers.archived_at / archived_by` | archive / restore, reopen period |
| 079 / 080 | server guards (archived customer, seller assignment), report performance | no UI dependency; without 080 the report can time out (F79-1) |
| 081 | not needed: the 2b48df9 UI has no seller-advance button (081 adds it in 64524e4) |
**DB 080 or 081 → compatible. DB 076 → INCOMPATIBLE**, proven on a local 076 copy with the new kit: `fe_rpc_present`
STOP (6 missing), `fe_tables` STOP (3 missing), archive / currency columns STOP; at 080 and 081 the same kit is OK
(`evidence/production-drift/`).

## 3. Functions on production (director = manager, capital, archive, UZS / USD, period report) — NOT VERIFIED HERE
Read-only proof = section 5 command 1: postflights 073..level (077: parity + currency + report; 078: archive / reopen;
079: guards; 080: report), CR-tolerant function parity of all 168 functions with the repository level, RLS isolation,
plus the drift kit (frontend contract incl. EXECUTE grants, role helper, guards, accounting sanity). On staging (same
code, 081) all of these work: see `STAGING-081-AUDIT.md`.

## 4. How the frontend became 2b48df9 — partly verified
* `sha_source=build` = the build received `NEXT_PUBLIC_GIT_COMMIT_SHA=2b48df9` explicitly. The only repository path that
  does this for production is `production-frontend.ps1 -Apply -ReleaseCandidate <sha>` (requires a clean checkout whose
  HEAD = that sha; `vercel deploy --prod --build-env NEXT_PUBLIC_GIT_COMMIT_SHA=<head>`). A Vercel Git-integration build
  would report `vercel_git`.
* Not provable from here: who / when (Vercel API not reachable). Residual risk: a project-level env var
  `NEXT_PUBLIC_GIT_COMMIT_SHA=2b48df9` would make a different build *claim* 2b48df9 → command 2 (deployment list) and
  command 3 (smoke checks the served pages) close it.

## 5. Owner commands (all read only; Windows PowerShell, repo root at branch HEAD)
```powershell
# 1. DB: history, gaps, frontend contract, postflights 073..level, function parity, RLS, accounting sanity
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-readonly-checks.ps1 -Target production-drift-audit
# 2. Vercel deployment history (read only)
npx vercel@latest ls goldia-sales-production --prod
npx vercel@latest inspect <the deployment URL that is "Current">
# 3. served frontend = 2b48df9, pages load, writes blocked by the smoke guard
powershell -NoProfile -ExecutionPolicy Bypass -File docs\releases\production-075\run-production-smoke.ps1 -ExpectCommit 2b48df9
```
Expected if production is as reported on 11-06: `latest_migration=20260101000080`, `RESULT|drift_audit|OK`,
postflights 073..080 PASS, `function_body_parity_080: identical+crlf_only=168 different=0 missing=0 extra=0`.

## 6. Risks
| ID | Sev | Risk | Status |
|---|---|---|---|
| D1 | HIGH (process) | Documents disagree on the production level (076 vs 080) | release tooling no longer trusts documents: `--auto` reads the real level (28596c3); confirm with command 1 |
| D2 | HIGH if DB < 078 | 2b48df9 against 076 / 077: currency sale / payment, period report, reopen, seller archive fail; manager refused on director-only 076 functions | NOT VERIFIED; command 1 decides (`fe_rpc_present`) |
| D3 | MEDIUM | L-manager smoke FAIL of 11-06 never closed; staging shows the same pattern was a wrong password (invalid_credentials) | command 3 with the correct manager password; the smoke now records the Auth error code |
| D4 | LOW | `sha_source=build` label could come from a project env var | command 2 |
| D5 | INFO | Accounting: if production is at 080, the per-migration business fingerprint gates proved balances unchanged by the chain on 11-06 (owner report); live sanity re-checked by command 1 (negative balances, debt + advance, currency) | — |
Verdict: **production stays FROZEN; no action is needed or allowed until command 1 is run.** If it shows 080 / OK, the
system is consistent (frontend 2b48df9 + DB 080) and only the documents were stale; if it shows < 078, D2 is real →
owner decision (frontend rollback to e717ffc first), no change by this session.
