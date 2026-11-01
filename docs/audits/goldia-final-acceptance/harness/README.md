# Audit harness (local, disposable only)

Paths are hard-wired to `/opt/goldia-audit` (copy this folder there). Nothing here can reach a remote
database: the cluster listens on a unix socket + 127.0.0.1, `t/lib.js` refuses non-local hosts, the shim
binds 127.0.0.1 only.

1. `setup.sh` — fresh PostgreSQL 16 cluster, Supabase roles/default grants, all migrations
   (`MAX_MIGRATION=20260101000069_z ./setup.sh` stops before 070).
2. `./q -f seed.sql` (or `seed2.sql` with `employees.id <> user_id`; then run node scripts with `SEED2=1`).
3. `./run-scenario.sh <label>` — full scenario S1–S16, concurrency C1–C8, RLS matrix, SECURITY DEFINER
   sweep, independent reconciliation → `evidence/<label>/`.
4. `node t/regression.js out.json` — the 16 regression cases for migration 070.
5. Browser: create `shim.env` with a random `SHIM_JWT_SECRET` and anon/service JWTs signed with it,
   `./shimctl.sh restart`, build/start Next with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, then
   `node ui/explore.js`, `ui/interact.js`, `ui/logout.js`, `ui/shots.js <label>`.

Synthetic identities only; the password in `seed.sql` is a local test value.
`fix/patch.py` regenerates migration 070 from the live 069 function definitions.
