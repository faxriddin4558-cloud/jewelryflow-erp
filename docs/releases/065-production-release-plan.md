# Goldia Sales — Migration 065 production release plan

Target: `https://goldia-sales-production.vercel.app`, Supabase `vrozlllcaxinavzxueif`.
Staging is not used. Nothing below may run without the owner's explicit approval at the gate.

## What ships

| Part | Content | Reversible how |
|---|---|---|
| DB | `supabase/migrations/20260101000065_goldia_blocker_high_audit_fixes.sql` — functions, RLS policies, grants, one nullable column. **No data changes.** | `supabase/rollback/20260101000065_rollback.sql` (tested: restores the exact 064 function definitions and policies) |
| Frontend | Changes in `src/` from this PR | Vercel: promote the previous deployment |

Compatibility (verified by reading the call sites):

- **Old frontend (5d16c31) + new DB (065): works.** The old seller sale form passes a markup (it is now validated). The old mobile "return" button calls `rpc_return_piece_to_factory`, which now works instead of erroring. Remaining effects:
  - the old direct `daily_gold_rates` upsert fallback is now denied (it only ran when the RPC failed);
  - an old seller screen that shows a non-585 rate gets `ERR_RATE_MISMATCH`.
- **New frontend + old DB (064): works.** Only existing RPCs are called. The fixes, however, only take effect once 065 is applied.
- **Recommended order:** DB first, then frontend.

## Gate 0 — verified backup (mandatory, owner)

A frontend rollback **never** restores database state. Before 065:

1. Supabase Dashboard → Database → Backups. Record whether daily backups and PITR are enabled, plus the latest backup time.
2. Take an independent logical backup:
   `pg_dump "$PROD_DB_URL" -Fc --no-owner --no-acl -f goldia-prod-YYYYMMDD.dump`
   (pg_dump major version ≥ the server version from preflight G1).
3. Prove the backup is restorable, using one of:
   - `scripts/verify-backup-restore-local.sh goldia-prod-YYYYMMDD.dump`: row counts must equal preflight G6.
   - or Supabase "Restore to a new project" from the dashboard backup.
4. Store the dump outside the laptop as well. It contains customer data, so never commit it.

## Gate 1 — preflight (read only)

Run `supabase/release/065_preflight_readonly.sql` and save the output. Stop if:

- G2 does not show `20260101000064`, or already shows `20260101000065`;
- G3 shows any function with more than 1 overload;
- G4 is `false`;
- D1 is greater than 0. (The new seller-stock formula assumes no legacy `returned_to_factory` pieces. Report the numbers first.)

Review, without acting on them:

- **D2:** how much seller stock the old function under-reported.
- **D3:** consignments stuck at `fully_sold` while pieces remain held.
- **S1:** demo accounts present in production.

## Gate 2 — apply 065

```
supabase link --project-ref vrozlllcaxinavzxueif
supabase db push --dry-run      # MUST list exactly one migration: 20260101000065
supabase db push
```

If the dry run lists anything else, stop: production schema has drifted.
Do **not** use `release.ps1`. It pushes every pending migration and falls back to `psql -f` on error.

## Gate 3 — postflight (read only)

Run `supabase/release/065_postflight_readonly.sql`:

- P1 present;
- every overload count is 1;
- P3 all `true`;
- P4 and P5 return 0 rows;
- P6 counts equal preflight G6 exactly.

## Gate 4 — frontend

1. Merge the PR into `feature/jewelryflow-sales-mvp`. Confirm this is the Vercel production branch first.
2. Wait for the deploy, then open `/api/version`: `commit` must equal the merge commit.
3. Read-only smoke check (no sales, payments, returns or reversals):
   - Director login: the "Menejer Ombori" total equals `get_manager_available_stock_grams` (the same value is shown in both cards).
   - A seller account sees only its own data.
   - The browser console shows no errors.

## Gate 5 — security follow-up

- The demo password was in public bundles and is in git history. Delete or ban every account listed by preflight S1, or rotate its password.
- Keep `NEXT_PUBLIC_DEMO_PASSWORD` unset in the production Vercel environment.

## Rollback

| Situation | Action | Data impact |
|---|---|---|
| UI problem only | Vercel → Deployments → promote the previous production deployment | None (DB stays on 065, which is compatible) |
| 065 function problem | `psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20260101000065_rollback.sql`, then the postflight queries should show the 064 state | Business rows written meanwhile are kept. `jewelry_sales.source_piece_id` is kept (unused by 064) |
| Data damage | Restore from the Gate 0 backup / PITR | Loses everything after the backup time; last resort only |

The rollback script was tested locally: after "064 + 065 + rollback", the md5 of all public function definitions and of all RLS policies equals a pure 064 database. Then 065 re-applies cleanly.
