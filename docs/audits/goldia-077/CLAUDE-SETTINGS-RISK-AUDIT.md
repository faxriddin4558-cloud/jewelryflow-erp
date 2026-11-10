# `.claude/settings.json` — production risk audit (2026-11-10)

**Nothing was changed.** This is a proposal only; the owner decides.

## 1. Current file (commit 3a6f147)

```json
{ "permissions": { "allow": ["mcp__Supabase__execute_sql", "Bash(psql:*)", "Bash(node scripts/*)"] } }
```

These rules apply to every Claude Code session opened in this repository. That includes sessions on the owner's own PC, where `.env.production.local`, the production DB URL and the Supabase MCP login can exist. In the cloud sandbox, production is unreachable (network policy 403), so the risk is on machines that do have production access.

| Rule | What it allows without asking | Production risk | Severity |
|---|---|---|---|
| `mcp__Supabase__execute_sql` | Any SQL (DDL / DML included) on **any project** the connected Supabase account can see. A permission rule cannot restrict the `project_id` argument. | If the MCP account sees production (today it sees only staging), a `DELETE` / `UPDATE` / `DROP` on production runs **with no prompt**. A typo ref (`vrozlilc…`) or a JFS / ERP ref is not stopped either. | **HIGH** |
| `Bash(psql:*)` | Any `psql` command: any host, any SQL, `-c "…"` or `-f file`. | With a production URL in the environment or typed into the command, a write runs with no prompt. It also bypasses the release scripts' gates (level detection, backup, typed confirmation). | **HIGH** |
| `Bash(node scripts/*)` | Every script in `scripts/`. | Safe: `goldia-prod-release.js` asks for the typed production ref; `goldia-release.ps1` asks for "PRODUCTION &lt;sha&gt;". **Not safe:** the old `apply-prod-migration-043…063.js`, `apply-prod-migrations-001-042.js` and `-045-to-047.js` read `.env.production.local` and run `supabase db push` **without a typed confirmation**. `sync-vercel-prod-env.js` changes Vercel production variables. `backup-prod-data.js` reads production with the service-role key. | **HIGH** |

## 2. Proposed staging-only variant (not applied)

These are the principles. The JSON follows below.
- **Prompt instead of auto-allow** for anything that can reach a remote database.
- **Auto-allow only the local stand-in** (127.0.0.1:55437) and the gated staging release script.
- **Deny** production / JFS / ERP refs and the ungated production scripts.
- **Hook guard** for the Supabase MCP: a permission rule cannot see `project_id`, but a `PreToolUse` hook can.

```json
{
  "permissions": {
    "allow": [
      "Bash(psql -h 127.0.0.1 -p 55437:*)",
      "Bash(node scripts/goldia-staging-release.js --local-rehearsal:*)"
    ],
    "ask": [
      "mcp__Supabase__execute_sql",
      "Bash(psql:*)",
      "Bash(node scripts/goldia-staging-release.js:*)"
    ],
    "deny": [
      "mcp__Supabase__apply_migration",
      "Bash(node scripts/apply-prod-*)",
      "Bash(node scripts/sync-vercel-prod-env.js:*)",
      "Bash(node scripts/backup-prod-data.js:*)",
      "Bash(node scripts/goldia-prod-release.js:*)",
      "Read(./.env.production.local)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "mcp__Supabase__execute_sql|mcp__Supabase__apply_migration",
        "hooks": [ { "type": "command", "command": "node .claude/hooks/supabase-staging-only.js" } ] },
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "node .claude/hooks/block-protected-refs.js" } ] }
    ]
  }
}
```

The two hook scripts (proposed, about 15 lines each) read the tool call from stdin and exit with code 2, which blocks the call with a message:
- `supabase-staging-only.js` blocks unless `tool_input.project_id === "vouehtlmsunebracahon"` (staging).
- `block-protected-refs.js` blocks any Bash command containing `vrozlllcaxinavzxueif`, `vrozlilcaxinavzxueif`, `yvvbdoqncubtwlzskgml` or `hbbuskyifxkowlozsaym`.

The production release still works, because the owner runs `goldia-release.ps1 -Target production` in their own PowerShell window, outside Claude Code.

**Before relying on the deny list:** after applying, check the effective rules with `/permissions`. The hooks are the reliable guard: argument-level checks are not expressible as permission rules, and the hooks cover them.

## 3. Recommendation

1. Apply the variant above, or at minimum remove `Bash(node scripts/*)` and `mcp__Supabase__execute_sql` from `allow`.
2. Move the old `scripts/apply-prod-migration-0NN.js` scripts, which have no typed confirmation, to an `archive/` folder or add the typed-ref gate to them. They are superseded by `goldia-prod-release.js`.
3. Keep `.env.production.local` only on the owner's PC, never in a directory where Claude Code runs with these rules.
