#!/usr/bin/env node
/**
 * GOLDIA — gated production release of one Sales migration (default 070).
 *
 *   node scripts/goldia-prod-release.js [--migration 070] [--acknowledge-findings]
 *
 * 1. Hidden password prompt (kept only in child-process environments, never printed or saved).
 * 2. FRESH backup + restore test + read-only preflight + migration test on the restored copy
 *    (scripts/goldia-prod-backup-and-preflight.js --fresh --migration NNN). Any failed gate stops here.
 * 3. Read-only gates on production: NNN-1 recorded, NNN absent. For 070 also the historical damage scan
 *    (supabase/release/070_damage_scan_readonly.sql, aggregates only): any REVIEW line stops the release
 *    unless the owner has reviewed it and re-runs with --acknowledge-findings. Nothing is repaired.
 * 4. Migration NNN and its schema_migrations row in ONE transaction (lock_timeout 10 s).
 * 5. Postflight checks; row counts must be unchanged. On failure the rollback command is printed.
 * No business transactions, no deletes, no balance changes. Result: RELEASE-NNN-RESULT.txt in the backup folder.
 * Options: --host --port --user --db --sslmode --pg-bin <dir> --out <dir>
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
}
const TARGET = String(args.migration || "070").padStart(3, "0");
const PREVIOUS = String(Number(TARGET) - 1).padStart(3, "0");
const TARGET_VERSION = `20260101000${TARGET}`;
const PREVIOUS_VERSION = `20260101000${PREVIOUS}`;
const PROD = {
  host: args.host || "aws-0-ap-southeast-1.pooler.supabase.com",
  port: String(args.port || 5432),
  user: args.user || "postgres.vrozlllcaxinavzxueif",
  db: args.db || "postgres",
  sslmode: args.sslmode || "require",
};
const MIN = 60 * 1000;
const migrationDir = path.join(REPO, "supabase/migrations");
const migrationName = fs.readdirSync(migrationDir).find((n) => n.startsWith(`${TARGET_VERSION}_`));
const F = {
  migration: migrationName ? path.join(migrationDir, migrationName) : null,
  rollback: path.join(REPO, `supabase/rollback/${TARGET_VERSION}_rollback.sql`),
  postflight: path.join(REPO, `supabase/release/${TARGET}_postflight_readonly.sql`),
  damageScan: path.join(REPO, `supabase/release/${TARGET}_damage_scan_readonly.sql`),
};

// Turns a read-only "select <bool> as a, <bool> as b ...;" postflight file into one query that is true only
// when every column is true.
function allColumnsTrue(file) {
  const body = fs.readFileSync(file, "utf8").split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l) && !/^\s*(begin transaction read only|rollback);\s*$/i.test(l))
    .join("\n").trim().replace(/;\s*$/, "");
  return `select bool_and(v::boolean) from json_each_text((select row_to_json(x) from (${body}) x)) j(k, v)`;
}

// Version-specific postflight checks: each query returns 't' when the check passes.
const POSTFLIGHT_CHECKS = {
  "065": [
    ["helpers", "select count(*) = 3 from pg_proc where pronamespace = 'public'::regnamespace and proname like '\\_goldia\\_%'"],
    ["weight_sale_lock", "select position('pg_advisory_xact_lock' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0"],
  ],
  "066": [
    ["ledger_table", "select to_regclass('public.company_rate_differences') is not null"],
    ["three_triggers", "select count(*) = 3 from pg_trigger where not tgisinternal and tgname in ('trg_goldia_rate_difference_from_purchase', 'trg_goldia_valued_cash_from_settlement', 'trg_goldia_cap_valued_pool')"],
    ["report_rpc", "select to_regprocedure('public.rpc_get_company_rate_difference_report(date,date)') is not null"],
    ["usd_only_payments_allowed", "select pg_get_constraintdef(oid) like '%usd_paid_amount%' from pg_constraint where conname = 'chk_gold_settlement_has_payment'"],
    ["ledger_not_client_writable", "select count(*) = 0 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'company_rate_differences' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')"],
    // Transactions are paused during the release, so nothing can be valued yet: history stays unvalued.
    ["no_historical_valuation", "select coalesce(sum(valued_cash_uzs + valued_usd), 0) = 0 from public.manager_vault_account"],
  ],
  "067": [
    ["snapshot_triggers", "select count(*) = 2 from pg_trigger where not tgisinternal and tgname in ('trg_goldia_sale_markup_snapshot', 'trg_goldia_piece_markup_snapshot')"],
    ["report_rpc", "select to_regprocedure('public.rpc_get_seller_markup_difference_report(uuid,date,date)') is not null"],
    ["sync_trigger_enabled", "select tgenabled = 'O' from pg_trigger where tgname = 'trg_sync_seller_gold_account_sales'"],
    ["snapshot_arithmetic_exact", "select count(*) = 0 from public.jewelry_sales where markup_difference_g is not null and markup_difference_g <> round(coalesce(base_weight_grams, 0) * (client_markup_pct - assigned_seller_markup_pct) / 100.0, 4)"],
    ["piece_sale_retry_fixed", "select position('v_existing, v_payload' in pg_get_functiondef('public.rpc_record_barcode_piece_sale(uuid,uuid,uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0"],
  ],
  "069": [
    ["no_anon_executable_rpcs", "select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')"],
    ["no_public_executable_rpcs", "select count(*) = 0 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\\_%' and a.grantee = 0"],
    ["authenticated_keeps_execute", "select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\\_%' and not has_function_privilege('authenticated', p.oid, 'EXECUTE')"],
    ["ledger_no_first_org_fallback", "select position('organizations' || chr(10) || '    limit 1' in pg_get_functiondef('public.rpc_get_unified_customer_ledger(uuid,uuid)'::regprocedure)) = 0"],
    ["ledger_no_admin_fallback", "select position(chr(39) || 'admin' || chr(39) || ')' in pg_get_functiondef('public.rpc_get_unified_customer_ledger(uuid,uuid)'::regprocedure)) = 0"],
  ],
  "070": [
    // every column of 070_postflight_readonly.sql must be true
    ["all_070_checks", allColumnsTrue(path.join(REPO, "supabase/release/070_postflight_readonly.sql"))],
  ],
  "068": [
    ["allocations_table", "select to_regclass('public.weight_sale_allocations') is not null"],
    ["weight_sale_multi_piece", "select position('_goldia_consume_weight_sale_pieces' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0"],
    ["reversals_use_allocations", "select position('_goldia_restore_weight_sale_allocations' in pg_get_functiondef('public.rpc_reverse_client_sale(uuid,text,text)'::regprocedure)) > 0 and position('_goldia_restore_weight_sale_allocations' in pg_get_functiondef('public.rpc_reverse_jewelry_sale(uuid,text,text)'::regprocedure)) > 0"],
    ["factory_counters_match_receipts", "select count(*) = 0 from public.manager_vault_account v where abs(v.total_factory_obligation_g - (select coalesce(sum(factory_obligation_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled'))) > 0.0001 or abs(v.total_factory_received_g - (select coalesce(sum(original_physical_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled'))) > 0.0001"],
    ["no_unrepaired_linked_shortfall", "select count(*) = 0 from public.jewelry_sales s where s.sale_type = 'weight' and s.status not in ('reversed', 'cancelled') and exists (select 1 from public.consignment_pieces p where p.sale_id = s.id and p.status = 'sold') and not exists (select 1 from public.weight_sale_allocations a where a.sale_id = s.id)"],
  ],
};

// Balances a migration is allowed to change (anything else must stay identical).
const BALANCE_ALLOWED_CHANGES = { "068": ["factory_obligation_g"] };
// Repair records written by a migration, printed after postflight.
const REPAIR_ACTIONS = { "068": ["REPAIR_WEIGHT_SALE_PIECES", "REPAIR_FACTORY_COUNTERS"] };

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
    out(`Database rollback (keeps all business rows): psql "<same connection>" -v ON_ERROR_STOP=1 -f supabase\\rollback\\${TARGET_VERSION}_rollback.sql`);
    out("A Vercel (frontend) rollback does NOT change the database.");
  } else {
    out("Production database was not changed by this step.");
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
  return dirs.find((d) => fs.existsSync(path.join(d, "psql" + exe))) || null;
}
const PG_BIN = findPgBin();

function prodEnv() {
  return {
    ...process.env,
    PGHOST: PROD.host, PGPORT: PROD.port, PGUSER: PROD.user, PGDATABASE: PROD.db, PGSSLMODE: PROD.sslmode,
    PGCONNECT_TIMEOUT: "20", PGAPPNAME: `goldia-release-${TARGET}`, PGPASSWORD: password,
  };
}

function psql(argList, timeoutMs = 10 * MIN) {
  const exe = path.join(PG_BIN, process.platform === "win32" ? "psql.exe" : "psql");
  const res = spawnSync(exe, ["-X", "-q", "-w", ...argList], {
    env: prodEnv(), encoding: "utf8", maxBuffer: 1024 * 1024 * 64, windowsHide: true, timeout: timeoutMs, killSignal: "SIGKILL",
  });
  if (res.error && res.error.code === "ETIMEDOUT") return { status: null, stdout: "", stderr: "psql timed out" };
  if (res.error) throw res.error;
  return res;
}
const ro = (sql) => psql(["-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", `begin transaction read only; ${sql}; rollback;`]);
const firstError = (r) => String(r.stderr || "").split(/\r?\n/).find((l) => /ERROR|FATAL|error/.test(l)) || String(r.stderr || "").trim();

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
  union all select 'gold_purchases', count(*) from public.gold_purchases
  union all select 'client_gold_accounts', count(*) from public.client_gold_accounts
  union all select 'seller_gold_accounts', count(*) from public.seller_gold_accounts
  union all select 'employees', count(*) from public.employees) x`;
const BALANCES = `select string_agg(k || '=' || v, ',' order by k) from (
  select 'customer_debt_g' k, coalesce(sum(current_debt_grams), 0)::text v from public.client_gold_accounts
  union all select 'customer_advance_g', coalesce(sum(advance_balance_grams), 0)::text from public.client_gold_accounts
  union all select 'seller_owes_g', coalesce(sum(seller_owes_manager_g), 0)::text from public.seller_gold_accounts
  union all select 'seller_stock_g', coalesce(sum(current_physical_stock_g), 0)::text from public.seller_gold_accounts
  union all select 'vault_cash_uzs', coalesce(sum(manager_cash_amount), 0)::text from public.manager_vault_account
  union all select 'vault_usd', coalesce(sum(manager_usd_amount), 0)::text from public.manager_vault_account
  union all select 'factory_obligation_g', coalesce(sum(current_factory_obligation_g), 0)::text from public.manager_vault_account) x`;

async function main() {
  console.log(`GOLDIA — migration ${TARGET} production release\n`);
  if (!PG_BIN) stop("PostgreSQL 17 tools not found (pass --pg-bin)");
  if (!F.migration) stop(`migration ${TARGET_VERSION} not found — run from the release branch`);
  for (const f of [F.rollback, F.postflight]) if (!fs.existsSync(f)) stop(`missing ${path.relative(REPO, f)}`);
  if (!POSTFLIGHT_CHECKS[TARGET]) stop(`no postflight checks defined for ${TARGET}`);

  password = process.env.PGPASSWORD || await promptHidden(`Supabase DB password for ${PROD.user} (hidden): `);

  // 2. Fresh backup + restore test + migration test on the restored copy
  console.log("[1/4] fresh backup, restore test and migration test on the restored copy");
  const passThrough = [];
  for (const k of ["host", "port", "user", "db", "sslmode", "pg-bin", "out"]) if (args[k]) passThrough.push(`--${k}`, String(args[k]));
  const backup = spawnSync(process.execPath, [path.join(__dirname, "goldia-prod-backup-and-preflight.js"), "--fresh", "--migration", TARGET, ...passThrough], {
    env: { ...process.env, PGPASSWORD: password }, stdio: "inherit", windowsHide: true,
  });
  const outRoot = path.resolve(String(args.out || path.join(os.homedir(), "GoldiaBackups")));
  const latest = fs.existsSync(outRoot) ? fs.readdirSync(outRoot).filter((d) => d.startsWith("goldia-prod-")).sort().reverse()
    .map((d) => path.join(outRoot, d)).find((d) => fs.existsSync(path.join(d, "GATES.json"))) : null;
  if (!latest) stop("backup step did not produce GATES.json");
  resultFile = path.join(latest, `RELEASE-${TARGET}-RESULT.txt`);
  out(`started: ${new Date().toISOString()}`);
  const gates = JSON.parse(fs.readFileSync(path.join(latest, "GATES.json"), "utf8"));
  out(`[1/4] backup folder ${latest}: ${JSON.stringify(gates)}`);
  if (backup.status !== 0 || !gates.ready || gates.target !== TARGET) stop("a backup/preflight/compatibility gate failed (see SUMMARY.txt in that folder)");

  // 3. Gates
  out("[2/4] production gates (read only)");
  const g = ro(`select exists (select 1 from supabase_migrations.schema_migrations where version = '${PREVIOUS_VERSION}'),
                       exists (select 1 from supabase_migrations.schema_migrations where version = '${TARGET_VERSION}')`);
  if (g.status !== 0) stop(`cannot query production: ${firstError(g)}`);
  const [hasPrev, hasTarget] = g.stdout.trim().split("|");
  out(`  ${PREVIOUS}=${hasPrev} ${TARGET}=${hasTarget}`);
  if (hasPrev !== "t") stop(`migration ${PREVIOUS} is not recorded in production`);
  if (hasTarget === "t") stop(`migration ${TARGET} is already applied`);
  if (fs.existsSync(F.damageScan)) {
    const scan = psql(["-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-f", F.damageScan]);
    fs.writeFileSync(path.join(latest, `damage-scan-${TARGET}.txt`), String(scan.stdout || "") + String(scan.stderr || ""));
    if (scan.status !== 0) stop(`damage scan failed: ${firstError(scan)}`);
    const rows = String(scan.stdout).split(/\r?\n/).filter((l) => /^D\d+_/.test(l));
    for (const r of rows) out(`  ${r}`);
    const review = rows.filter((r) => r.endsWith("|REVIEW"));
    if (review.length && !args["acknowledge-findings"]) {
      stop(`historical damage scan has ${review.length} REVIEW line(s) — owner review needed; nothing was changed or repaired. ` +
        "After review, re-run with --acknowledge-findings (070 prevents new damage; it does not rewrite old records).");
    }
    if (review.length) out(`  REVIEW lines acknowledged by the owner (--acknowledge-findings): ${review.length}`);
  }

  // 4. Atomic migration
  out(`[3/4] migration ${TARGET} (single transaction)`);
  const counts = ro(COUNTS);
  const balances = ro(BALANCES);
  if (counts.status !== 0 || balances.status !== 0) stop("cannot read row counts / balances");
  out(`  balances before: ${balances.stdout.trim()}`);
  const mig = psql(["-v", "ON_ERROR_STOP=1", "--single-transaction",
    "-c", "set lock_timeout = '10s'; set statement_timeout = '5min';",
    "-f", F.migration,
    "-c", `insert into supabase_migrations.schema_migrations(version) values ('${TARGET_VERSION}')`], 15 * MIN);
  if (mig.status !== 0) stop(`migration ${TARGET} failed and was rolled back: ${firstError(mig)}`);
  out("  MIGRATION: applied and recorded");

  // 5. Postflight
  out("[4/4] postflight");
  const pf = psql(["-v", "ON_ERROR_STOP=1", "-f", F.postflight]);
  fs.writeFileSync(path.join(latest, `postflight-${TARGET}-production.txt`), String(pf.stdout || "") + String(pf.stderr || ""));
  let pass = pf.status === 0;
  const rec = ro(`select exists (select 1 from supabase_migrations.schema_migrations where version = '${TARGET_VERSION}')`);
  pass = pass && rec.stdout.trim() === "t";
  for (const [name, sql] of POSTFLIGHT_CHECKS[TARGET]) {
    const r = ro(sql);
    const ok = r.status === 0 && r.stdout.trim() === "t";
    out(`  ${name}: ${ok ? "ok" : "FAIL"}`);
    pass = pass && ok;
  }
  const countsAfter = ro(COUNTS);
  const balancesAfter = ro(BALANCES);
  const countsSame = countsAfter.stdout.trim() === counts.stdout.trim();
  const allowed = BALANCE_ALLOWED_CHANGES[TARGET] || [];
  const parseBal = (txt) => Object.fromEntries(txt.trim().split(",").map((kv) => kv.split("=")));
  const balBefore = parseBal(balances.stdout), balAfter = parseBal(balancesAfter.stdout);
  for (const k of allowed) if (balBefore[k] !== balAfter[k]) out(`  allowed change ${k}: ${balBefore[k]} -> ${balAfter[k]} (see repair records)`);
  const balancesSame = Object.keys({ ...balBefore, ...balAfter }).filter((k) => !allowed.includes(k)).every((k) => balBefore[k] === balAfter[k]);
  for (const action of REPAIR_ACTIONS[TARGET] || []) {
    const r = ro(`select coalesce(string_agg(record_id || ' ' || old_data::text || ' => ' || new_data::text, E'\\n'), 'none') from public.audit_logs where action = '${action}'`);
    out(`  ${action}:`);
    for (const line of r.stdout.trim().split(/\r?\n/)) out(`    ${line}`);
  }
  out(`  row counts unchanged: ${countsSame ? "yes" : `NO before=${counts.stdout.trim()} after=${countsAfter.stdout.trim()}`}`);
  out(`  balances unchanged: ${balancesSame ? "yes" : `NO after=${balancesAfter.stdout.trim()}`}`);
  if (!(pass && countsSame && balancesSame)) stop(`POSTFLIGHT FAILED — do not merge the release PR`, { rollbackHint: true });
  out("  POSTFLIGHT: PASS");
  out(`\nRESULT: MIGRATION ${TARGET} APPLIED, POSTFLIGHT PASS — the release PR can be merged. Report: ${resultFile}`);
}

main().catch((e) => stop(e && e.message ? e.message : String(e)));
