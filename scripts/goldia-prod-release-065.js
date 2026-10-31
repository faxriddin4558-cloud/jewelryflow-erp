#!/usr/bin/env node
/**
 * GOLDIA — production release of migration 065 (run only with the owner's approval).
 *
 * Steps, stopping at the first failed gate:
 *   1. Existing backup must still match its SHA256SUMS and have a readable dump TOC (no new dump).
 *   2. Read-only gates: 064 applied, 065 not applied, one signature per touched function.
 *   3. Demo accounts: classify (read only), then block ONLY the SAFE_TO_BLOCK ones
 *      (supabase/release/demo_accounts_block.sql). Nothing is deleted.
 *   4. Migration 065 in ONE transaction together with its schema_migrations row
 *      (lock_timeout 10 s). Any error means production is unchanged.
 *   5. Postflight gates evaluated automatically; row counts must equal the pre-migration counts.
 * No test sales, no balance changes, no deletes. Writes RELEASE-065-RESULT.txt next to the backup.
 *
 * Usage (repo root, PR #4 branch): node scripts/goldia-prod-release-065.js
 * Options: --host --port --user --db --sslmode --pg-bin <dir> --backups <dir> --skip-demo-block
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
}
const PROD = {
  host: args.host || "aws-0-ap-southeast-1.pooler.supabase.com",
  port: String(args.port || 5432),
  user: args.user || "postgres.vrozlllcaxinavzxueif",
  db: args.db || "postgres",
  sslmode: args.sslmode || "require",
};
const F = {
  migration: path.join(REPO, "supabase/migrations/20260101000065_goldia_blocker_high_audit_fixes.sql"),
  rollback: path.join(REPO, "supabase/rollback/20260101000065_rollback.sql"),
  demoIdentify: path.join(REPO, "supabase/release/demo_accounts_identify_readonly.sql"),
  demoBlock: path.join(REPO, "supabase/release/demo_accounts_block.sql"),
  postflight: path.join(REPO, "supabase/release/065_postflight_readonly.sql"),
};
const MIN = 60 * 1000;
const lines = [];
let resultFile;
let password;

function out(line) {
  console.log(line);
  lines.push(line);
  if (resultFile) fs.writeFileSync(resultFile, lines.join(os.EOL) + os.EOL);
}

function stop(message, { rollbackHint = false } = {}) {
  out(`\nSTOPPED: ${message}`);
  if (rollbackHint) {
    out("Safe rollback (restores the exact 064 functions, policies and grants; keeps all business rows):");
    out(`  psql "<same connection>" -v ON_ERROR_STOP=1 -f supabase\\rollback\\20260101000065_rollback.sql`);
  } else {
    out("Production was not changed by this step.");
  }
  process.exit(1);
}

function findPgBin() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const dirs = [];
  if (args["pg-bin"]) dirs.push(String(args["pg-bin"]));
  const roots = process.platform === "win32"
    ? [process.env["ProgramFiles"], "C:\\Program Files"].filter(Boolean).map((r) => path.join(r, "PostgreSQL"))
    : ["/usr/lib/postgresql"];
  for (const base of roots) {
    if (!fs.existsSync(base)) continue;
    for (const v of fs.readdirSync(base).sort((a, b) => parseFloat(b) - parseFloat(a))) dirs.push(path.join(base, v, "bin"));
  }
  for (const d of dirs) {
    if (["psql", "pg_restore"].every((t) => fs.existsSync(path.join(d, t + exe)))) return (t) => path.join(d, t + exe);
  }
  return null;
}
const tool = findPgBin();

function exec(name, argList, timeoutMs = 10 * MIN) {
  const res = spawnSync(tool(name), argList, {
    env: {
      ...process.env,
      PGHOST: PROD.host, PGPORT: PROD.port, PGUSER: PROD.user, PGDATABASE: PROD.db, PGSSLMODE: PROD.sslmode,
      PGCONNECT_TIMEOUT: "20", PGAPPNAME: "goldia-release-065",
      ...(password ? { PGPASSWORD: password } : {}),
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 256,
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (res.error && res.error.code === "ETIMEDOUT") return { status: null, stdout: "", stderr: `${name} timed out` };
  if (res.error) throw res.error;
  return res;
}

const q = (sql) => exec("psql", ["-X", "-q", "-w", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", sql]);
const ro = (sql) => q(`begin transaction read only; ${sql}; rollback;`);
const firstError = (r) => String(r.stderr || "").split(/\r?\n/).find((l) => /ERROR|FATAL|error/.test(l)) || String(r.stderr || "").trim();

function sha256(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1024 * 1024);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest("hex");
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") stop("run this in an interactive PowerShell window (or set PGPASSWORD)");
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write(os.EOL);
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const COUNTS = `select string_agg(t || '=' || c, ',' order by t) from (
  select 'factory_receipts' t, count(*) c from public.factory_receipts
  union all select 'seller_consignments', count(*) from public.seller_consignments
  union all select 'consignment_pieces', count(*) from public.consignment_pieces
  union all select 'jewelry_sales', count(*) from public.jewelry_sales
  union all select 'gold_settlements', count(*) from public.gold_settlements
  union all select 'client_gold_accounts', count(*) from public.client_gold_accounts
  union all select 'seller_gold_accounts', count(*) from public.seller_gold_accounts
  union all select 'employees', count(*) from public.employees
  union all select 'auth_users', count(*) from auth.users) x`;

async function main() {
  console.log("GOLDIA — migration 065 production release\n");
  if (!tool) stop("PostgreSQL 17 tools not found (pass --pg-bin)");
  for (const f of Object.values(F)) if (!fs.existsSync(f)) stop(`missing ${path.relative(REPO, f)} — run from the PR #4 branch`);

  // 1. Existing backup
  const root = path.resolve(String(args.backups || path.join(os.homedir(), "GoldiaBackups")));
  const backup = (fs.existsSync(root) ? fs.readdirSync(root) : []).filter((d) => d.startsWith("goldia-prod-")).sort().reverse()
    .map((d) => path.join(root, d)).find((d) => fs.existsSync(path.join(d, "goldia-full.dump")) && fs.existsSync(path.join(d, "SHA256SUMS.txt")));
  if (!backup) stop(`no backup found in ${root}`);
  resultFile = path.join(backup, "RELEASE-065-RESULT.txt");
  out(`started: ${new Date().toISOString()}`);
  out(`[1/5] backup ${backup}`);
  for (const line of fs.readFileSync(path.join(backup, "SHA256SUMS.txt"), "utf8").split(/\r?\n/).filter(Boolean)) {
    const [hash, file] = line.trim().split(/\s+/);
    if (sha256(path.join(backup, file)) !== hash) stop(`backup file changed or damaged: ${file}`);
  }
  const toc = exec("pg_restore", ["--list", path.join(backup, "goldia-full.dump")]);
  if (toc.status !== 0 || !/TABLE DATA public /.test(toc.stdout)) stop("backup dump is not readable");
  out("  BACKUP: intact (SHA256 + dump TOC ok), reused — no new dump");

  // 2. Gates
  if (!process.env.PGPASSWORD) password = await promptHidden(`Supabase DB password for ${PROD.user} (hidden): `);
  out("[2/5] read-only gates");
  const g = ro(`select
      exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000064'),
      exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000065'),
      (select coalesce(max(c), 0) from (select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('get_seller_available_stock_grams', 'get_manager_available_stock_grams',
           'rpc_return_piece_to_factory', 'rpc_record_client_settlement', 'rpc_record_seller_to_manager_settlement',
           'rpc_record_barcode_piece_sale', 'rpc_record_weight_sale', 'rpc_reverse_client_sale', 'rpc_reverse_jewelry_sale',
           'rpc_reverse_client_settlement', 'rpc_get_seller_reconciliation_statement', 'rpc_set_daily_gold_rate',
           'recalc_seller_gold_account') group by p.proname) x)`);
  if (g.status !== 0) stop(`cannot connect / query: ${firstError(g)}`);
  const [has064, has065, overloads] = g.stdout.trim().split("|");
  out(`  064=${has064} 065=${has065} max_overloads=${overloads}`);
  if (has064 !== "t") stop("migration 064 is not recorded in production");
  if (has065 === "t") stop("migration 065 is already applied — nothing to do (run postflight only)");
  if (Number(overloads) !== 1) stop("function overload drift detected");

  // 3. Demo accounts
  out("[3/5] demo accounts");
  const ident = exec("psql", ["-X", "-q", "-w", "-t", "-A", "-F", " | ", "-v", "ON_ERROR_STOP=1", "-f", F.demoIdentify]);
  if (ident.status !== 0) stop(`demo classification failed: ${firstError(ident)}`);
  const rows = ident.stdout.split(/\r?\n/).filter((l) => /^(SAFE_TO_BLOCK|REVIEW_HAS_ACTIVITY)/.test(l));
  for (const r of rows) out("  " + r.split(" | ").slice(0, 5).join(" | ") + " | activity=" + r.split(" | ").slice(7).join("/"));
  if (!rows.length) out("  no demo accounts found");
  if (rows.length && !args["skip-demo-block"]) {
    const blk = exec("psql", ["-X", "-q", "-w", "-t", "-A", "-F", " | ", "-v", "ON_ERROR_STOP=1", "-f", F.demoBlock]);
    if (blk.status !== 0) stop(`demo block failed (rolled back, nothing changed): ${firstError(blk)}`);
    const blocked = blk.stdout.split(/\r?\n/).filter((l) => l.startsWith("BLOCKED"));
    out(`  blocked: ${blocked.length ? blocked.map((l) => l.split(" | ")[1]).join(", ") : "none"}`);
    const review = rows.filter((r) => r.startsWith("REVIEW"));
    if (review.length) out(`  NOT touched (has activity, owner review): ${review.map((r) => r.split(" | ")[1]).join(", ")}`);
  }

  // 4. Migration 065, atomic
  out("[4/5] migration 065 (single transaction)");
  const before = ro(COUNTS);
  if (before.status !== 0) stop(`cannot read row counts: ${firstError(before)}`);
  const mig = exec("psql", ["-X", "-q", "-w", "-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-c", "set lock_timeout = '10s'; set statement_timeout = '5min';",
    "-f", F.migration,
    "-c", "insert into supabase_migrations.schema_migrations(version) values ('20260101000065')"], 15 * MIN);
  if (mig.status !== 0) stop(`migration 065 failed and was rolled back: ${firstError(mig)}`);
  out("  MIGRATION: applied and recorded");

  // 5. Postflight
  out("[5/5] postflight");
  const pf = exec("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", F.postflight]);
  fs.writeFileSync(path.join(backup, "postflight-production.txt"), String(pf.stdout || "") + String(pf.stderr || ""));
  const chk = ro(`select
      exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000065'),
      (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like '\\_goldia\\_%'),
      position('_goldia_assert_seller_rate' in pg_get_functiondef('public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric)'::regprocedure)) > 0,
      position('pg_advisory_xact_lock' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0,
      position('returned_to_manager' in pg_get_functiondef('public.get_seller_available_stock_grams(uuid)'::regprocedure)) = 0,
      (select count(*) from pg_policies where schemaname = 'public' and cmd <> 'SELECT' and tablename in ('manager_vault_account',
         'consignment_pieces', 'factory_receipts', 'factory_gold_handovers', 'refining_batches', 'gold_purchases', 'daily_gold_rates')),
      (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE') and table_name in ('manager_vault_account', 'consignment_pieces',
         'seller_consignments', 'factory_receipts', 'factory_gold_handovers', 'refining_batches', 'gold_purchases', 'daily_gold_rates',
         'jewelry_sales', 'gold_settlements', 'client_gold_accounts', 'seller_gold_accounts'))`);
  const after = ro(COUNTS);
  if (chk.status !== 0 || after.status !== 0) stop(`postflight query failed: ${firstError(chk.status !== 0 ? chk : after)}`, { rollbackHint: true });
  const [rec, helpers, rateGuard, lock, stock, writePolicies, writeGrants] = chk.stdout.trim().split("|");
  const countsSame = before.stdout.trim() === after.stdout.trim();
  out(`  recorded=${rec} helpers=${helpers} rate_guard=${rateGuard} weight_lock=${lock} stock_fix=${stock} write_policies=${writePolicies} write_grants=${writeGrants}`);
  out(`  row counts unchanged: ${countsSame ? "yes" : `NO — before ${before.stdout.trim()} after ${after.stdout.trim()}`}`);
  const pass = rec === "t" && Number(helpers) === 3 && rateGuard === "t" && lock === "t" && stock === "t"
    && Number(writePolicies) === 0 && Number(writeGrants) === 0 && countsSame;
  if (!pass) stop("POSTFLIGHT FAILED — do not merge PR #4", { rollbackHint: true });
  out("  POSTFLIGHT: PASS");
  out(`\nRESULT: MIGRATION 065 APPLIED, POSTFLIGHT PASS — PR #4 can be merged. Report saved: ${resultFile}`);
}

main().catch((e) => stop(e && e.message ? e.message : String(e)));
