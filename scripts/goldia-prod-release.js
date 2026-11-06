#!/usr/bin/env node
/**
 * GOLDIA — gated production release of one Sales migration (default 073).
 *
 *   node scripts/goldia-prod-release.js [--migration 072] [--acknowledge-findings]
 *
 * 1. Hidden password prompt (kept only in child-process environments, never printed or saved).
 * 2. FRESH backup + restore test + read-only preflight + migration test on the restored copy
 *    (scripts/goldia-prod-backup-and-preflight.js --fresh --migration NNN). Any failed gate stops here.
 * 3. Read-only gates on production: NNN-1 recorded, NNN absent. For 070 also the historical damage scan
 *    (supabase/release/070_damage_scan_readonly.sql, aggregates only): any REVIEW line stops the release
 *    unless the owner has reviewed it and re-runs with --acknowledge-findings. Nothing is repaired.
 * 4. The owner types the production ref; then migration NNN and its schema_migrations row in ONE transaction (lock_timeout 10 s).
 *    Staging / JFS demo / ERP refs are refused before any connection. Local rehearsal: --local-rehearsal --yes with a local --host.
 * 5. Postflight checks; row counts must be unchanged. On failure the rollback command is printed.
 * No business transactions, no deletes, no balance changes. Result: RELEASE-NNN-RESULT.txt in the backup folder.
 * Options: --host --port --user --db --sslmode --pg-bin <dir> --out <dir>
 *
 * CHAIN MODE (2026-11-06, 076 -> 077 -> 078 -> 079):  node scripts/goldia-prod-release.js --migration 077 --chain-to 079
 *   1. fresh backup + restore + the SAME chain SQL on the restored copy + emergency rollback to 076 + re-apply
 *      (goldia-prod-backup-and-preflight.js --migration 077 --chain-to 079; gate chainTo must PASS);
 *   2. production read-only gates: 076 recorded, none of 077..079 recorded; prelaunch kits 05 (077) and 06 (078 / 079):
 *      any STOP stops, any WARN stops unless the owner re-runs with --acknowledge-findings; 076 function-body parity
 *      (DIFFERENT / MISSING stops); RLS isolation probe (read only) recorded as the "before" state;
 *   3. typed production ref, then ONE transaction (scripts/lib/goldia-chain.js): after EVERY migration its history row,
 *      its postflight checks and the business fingerprint (balances, debts, stock, tills, vault, customers, sale /
 *      payment / cash / legacy history, row counts) are checked inside the transaction - any difference rolls back the
 *      whole chain, production stays at 076;
 *   4. postflight (read only): 073..079 postflights, counts + balances + fingerprint unchanged, no new RLS leak.
 *   Rollback after a committed chain: emergency rollbacks newest first (see the printed hint and the release report).
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
const TARGET = String(args.migration || "073").padStart(3, "0");
const CHAIN_TO = args["chain-to"] ? String(args["chain-to"]).padStart(3, "0") : null;
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
  // historical damage scan: the version-specific one, else the latest generic one (070)
  damageScan: [TARGET, "070"].map((v) => path.join(REPO, `supabase/release/${v}_damage_scan_readonly.sql`)).find((f) => fs.existsSync(f)),
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
  "073": [
    ["all_073_checks", allColumnsTrue(path.join(REPO, "supabase/release/073_postflight_readonly.sql"))],
  ],
  "074": [
    ["all_074_checks", allColumnsTrue(path.join(REPO, "supabase/release/074_postflight_readonly.sql"))],
  ],
  "075": [
    ["all_075_checks", allColumnsTrue(path.join(REPO, "supabase/release/075_postflight_readonly.sql"))],
  ],
  "077": [
    ["all_077_checks", allColumnsTrue(path.join(REPO, "supabase/release/077_postflight_readonly.sql"))],
    ["076_still_true", allColumnsTrue(path.join(REPO, "supabase/release/076_postflight_readonly.sql"))],
    ["075_still_true", allColumnsTrue(path.join(REPO, "supabase/release/075_postflight_readonly.sql"))],
    ["074_still_true", allColumnsTrue(path.join(REPO, "supabase/release/074_postflight_readonly.sql"))],
    ["073_still_true", allColumnsTrue(path.join(REPO, "supabase/release/073_postflight_readonly.sql"))],
  ],
  "076": [
    ["all_076_checks", allColumnsTrue(path.join(REPO, "supabase/release/076_postflight_readonly.sql"))],
    ["073_still_true", allColumnsTrue(path.join(REPO, "supabase/release/073_postflight_readonly.sql"))],
    ["074_still_true", allColumnsTrue(path.join(REPO, "supabase/release/074_postflight_readonly.sql"))],
    ["075_still_true", allColumnsTrue(path.join(REPO, "supabase/release/075_postflight_readonly.sql"))],
  ],
  "070": [
    // every column of 070_postflight_readonly.sql must be true
    ["all_070_checks", allColumnsTrue(path.join(REPO, "supabase/release/070_postflight_readonly.sql"))],
  ],
  "071": [
    // every column of 071_postflight_readonly.sql must be true
    ["all_071_checks", allColumnsTrue(path.join(REPO, "supabase/release/071_postflight_readonly.sql"))],
  ],
  "072": [
    // every column of 072_postflight_readonly.sql must be true
    ["all_072_checks", allColumnsTrue(path.join(REPO, "supabase/release/072_postflight_readonly.sql"))],
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

function promptVisible(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) stop("run this in an interactive PowerShell window (typed confirmation required)");
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
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
  // Target guard (before any connection): never staging, JFS demo or the manufacturing ERP.
  const FORBIDDEN_REFS = { vouehtlmsunebracahon: "Goldia STAGING", yvvbdoqncubtwlzskgml: "JewelryFlow SaaS demo", hbbuskyifxkowlozsaym: "manufacturing ERP" };
  const joinedTarget = [PROD.host, PROD.user, process.env.PGHOST, process.env.PGUSER, process.env.DATABASE_URL].filter(Boolean).join(" ");
  for (const [ref, label] of Object.entries(FORBIDDEN_REFS)) if (joinedTarget.includes(ref)) stop(`${label} (${ref}) is never a target of this script`);
  const LOCAL_TARGET = /^(localhost|127\.0\.0\.1)$/.test(String(PROD.host)) || String(PROD.host).startsWith("/");
  if (args["local-rehearsal"] && !LOCAL_TARGET) stop("--local-rehearsal only works with a local --host");
  if (!LOCAL_TARGET && !String(PROD.user).endsWith(".vrozlllcaxinavzxueif")) stop(`unexpected database user ${PROD.user} (production is postgres.vrozlllcaxinavzxueif)`);
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
  if (F.damageScan && fs.existsSync(F.damageScan)) {
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

  // 4. Typed confirmation: the owner types the production project ref before anything is written
  if (!(args["local-rehearsal"] && args.yes)) {
    const typed = await promptVisible(`Type the production project ref (vrozlllcaxinavzxueif) to apply migration ${TARGET}: `);
    if (typed.trim() !== "vrozlllcaxinavzxueif") stop("confirmation did not match — nothing was changed");
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

// ------------------------------------------------------------------ CHAIN MODE (--chain-to)
function stopChain(message, { committed = false } = {}) {
  out(`\nSTOPPED: ${message}`);
  if (committed) {
    out("The chain WAS committed. Data-preserving emergency rollback, newest first, ONE file per transaction, only with the owner's approval:");
    for (let n = Number(CHAIN_TO); n >= Number(TARGET); n--) {
      const v = String(n).padStart(3, "0");
      out(`  psql "<same connection>" -X -v ON_ERROR_STOP=1 --single-transaction -f docs\\releases\\production-075\\emergency\\rollback_${v}_with_history.sql`);
    }
    out("  limits: 079 only removes the two guards; 078 keeps archived customers archived (rows and audit kept); 077 is REFUSED while");
    out("  UZS / USD sales, currency payments or currency balances exist (reverse them first) and keeps the 4 reclassification-history columns.");
    out("A Vercel (frontend) rollback does NOT change the database.");
  } else {
    out("Production database was not changed (the chain runs in one transaction; nothing was committed).");
  }
  process.exit(1);
}

async function mainChain() {
  const chainLib = require("./lib/goldia-chain");
  const checksLib = require("./lib/goldia-release-checks");
  console.log(`GOLDIA — production release chain ${PREVIOUS} -> ${CHAIN_TO}\n`);
  const FORBIDDEN_REFS = { vouehtlmsunebracahon: "Goldia STAGING", yvvbdoqncubtwlzskgml: "JewelryFlow SaaS demo", hbbuskyifxkowlozsaym: "manufacturing ERP", vrozlilcaxinavzxueif: "typo of the production ref" };
  const joinedTarget = [PROD.host, PROD.user, process.env.PGHOST, process.env.PGUSER, process.env.DATABASE_URL].filter(Boolean).join(" ");
  for (const [ref, label] of Object.entries(FORBIDDEN_REFS)) if (joinedTarget.includes(ref)) stopChain(`${label} (${ref}) is never a target of this script`);
  const LOCAL_TARGET = /^(localhost|127\.0\.0\.1)$/.test(String(PROD.host)) || String(PROD.host).startsWith("/");
  if (args["local-rehearsal"] && !LOCAL_TARGET) stopChain("--local-rehearsal only works with a local --host");
  if (!LOCAL_TARGET && !String(PROD.user).endsWith(".vrozlllcaxinavzxueif")) stopChain(`unexpected database user ${PROD.user} (production is postgres.vrozlllcaxinavzxueif)`);
  if (!PG_BIN) stopChain("PostgreSQL 17 tools not found (pass --pg-bin)");
  if (!(Number(CHAIN_TO) > Number(TARGET))) stopChain(`--chain-to ${CHAIN_TO} must be after --migration ${TARGET}`);
  let built;
  try { built = chainLib.buildChainSql(PREVIOUS, CHAIN_TO, { label: "production" }); } catch (e) { stopChain(`cannot build the chain: ${e.message}`); }
  for (const m of built.chain) {
    for (const f of [path.join(REPO, `supabase/rollback/${m.version}_rollback.sql`), path.join(REPO, `supabase/release/${m.num}_postflight_readonly.sql`),
      path.join(REPO, `docs/releases/production-075/emergency/rollback_${m.num}_with_history.sql`)]) if (!fs.existsSync(f)) stopChain(`missing ${path.relative(REPO, f)}`);
  }
  const KITS = ["docs/releases/production-075/05_prelaunch_077_readonly.sql", "docs/releases/production-075/06_prelaunch_078_079_readonly.sql",
    "supabase/release/function_body_parity_076_readonly.sql", "docs/releases/production-075/03_rls_isolation_readonly.sql"].map((f) => path.join(REPO, f));
  for (const f of KITS) if (!fs.existsSync(f)) stopChain(`missing ${path.relative(REPO, f)}`);

  password = process.env.PGPASSWORD || await promptHidden(`Supabase DB password for ${PROD.user} (hidden): `);

  console.log(`[1/5] fresh backup, restore test, chain ${TARGET}..${CHAIN_TO} + emergency rollback + re-apply on the restored copy`);
  const passThrough = [];
  for (const k of ["host", "port", "user", "db", "sslmode", "pg-bin", "out"]) if (args[k]) passThrough.push(`--${k}`, String(args[k]));
  const backup = spawnSync(process.execPath, [path.join(__dirname, "goldia-prod-backup-and-preflight.js"), "--fresh", "--migration", TARGET, "--chain-to", CHAIN_TO, ...passThrough], {
    env: { ...process.env, PGPASSWORD: password }, stdio: "inherit", windowsHide: true,
  });
  const outRoot = path.resolve(String(args.out || path.join(os.homedir(), "GoldiaBackups")));
  const latest = fs.existsSync(outRoot) ? fs.readdirSync(outRoot).filter((d) => d.startsWith("goldia-prod-")).sort().reverse()
    .map((d) => path.join(outRoot, d)).find((d) => fs.existsSync(path.join(d, "GATES.json"))) : null;
  if (!latest) stopChain("backup step did not produce GATES.json");
  resultFile = path.join(latest, `RELEASE-${TARGET}-${CHAIN_TO}-RESULT.txt`);
  out(`started: ${new Date().toISOString()}  mode: CHAIN ${PREVIOUS} -> ${CHAIN_TO}${args["local-rehearsal"] ? " (LOCAL REHEARSAL)" : ""}`);
  const gates = JSON.parse(fs.readFileSync(path.join(latest, "GATES.json"), "utf8"));
  out(`[1/5] backup folder ${latest}: ${JSON.stringify(gates)}`);
  if (backup.status !== 0 || !gates.ready || gates.target !== TARGET || gates.chainToTarget !== CHAIN_TO || gates.chainToPass !== true) {
    stopChain("a backup / restore / copy-chain / rollback gate failed (see SUMMARY.txt in that folder)");
  }

  out("[2/5] production gates (read only)");
  const versions = built.chain.map((m) => `'${m.version}'`).join(",");
  const g = ro(`select exists (select 1 from supabase_migrations.schema_migrations where version = '${PREVIOUS_VERSION}'),
                       (select count(*) from supabase_migrations.schema_migrations where version in (${versions})),
                       (select max(version) from supabase_migrations.schema_migrations)`);
  if (g.status !== 0) stopChain(`cannot query production: ${firstError(g)}`);
  const [hasPrev, nChain, maxV] = g.stdout.trim().split("|");
  out(`  ${PREVIOUS} recorded=${hasPrev}; chain versions recorded=${nChain}; latest=${maxV}`);
  if (hasPrev !== "t" || maxV !== PREVIOUS_VERSION) stopChain(`production must be exactly at ${PREVIOUS} (latest ${maxV})`);
  if (nChain !== "0") stopChain("a chain migration is already recorded");
  const kit = (file, name) => {
    const r = psql(["-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", file]);
    const text = String(r.stdout || "") + String(r.stderr || "");
    fs.writeFileSync(path.join(latest, `${name}.txt`), text);
    if (r.status !== 0) stopChain(`${name} failed: ${firstError(r)}`);
    return text;
  };
  for (const [file, name] of [[KITS[0], "prelaunch-077"], [KITS[1], "prelaunch-078-079"]]) {
    const text = kit(file, name);
    for (const l of text.split(/\r?\n/).filter((x) => /\|(WARN|STOP)\|/.test(x) || x.startsWith("RESULT|"))) out(`  ${l}`);
    const res = (text.match(/RESULT\|[^|]+\|(OK|WARN|STOP)/) || [])[1];
    if (res !== "OK" && res !== "WARN") stopChain(`${name}: ${res || "no RESULT line"}`);
    if (res === "WARN" && !args["acknowledge-findings"]) stopChain(`${name}: WARN - owner review needed; after review re-run with --acknowledge-findings (nothing was changed)`);
  }
  const parity = kit(KITS[2], "function-body-parity-076");
  const differ = parity.split(/\r?\n/).filter((l) => /^(DIFFERENT|MISSING)\|/.test(l) && !/\|0$/.test(l));
  out(`  function-body parity 076: ${parity.split(/\r?\n/).filter((l) => /^(identical|crlf_only|DIFFERENT|MISSING)\|/.test(l)).join(" ")}`);
  if (differ.length) stopChain("production function bodies differ from the repository 076 (see function-body-parity-076.txt)");
  const rlsBefore = kit(KITS[3], "rls-isolation-before");
  const leaksBefore = new Set(rlsBefore.split(/\r?\n/).map((l) => l.replace(/^.*NOTICE:\s*/, "")).filter((l) => l.startsWith("LEAK|")).map((l) => l.split("|").slice(0, 4).join("|")));
  out(`  RLS isolation before: ${(rlsBefore.match(/RLS_ISOLATION\|[^\r\n]*/) || ["no result line"])[0]}`);
  if (!/RLS_ISOLATION\|/.test(rlsBefore)) stopChain("RLS isolation probe produced no result");

  if (!(args["local-rehearsal"] && args.yes)) {
    const typed = await promptVisible(`Type the production project ref (vrozlllcaxinavzxueif) to apply ${built.chain.map((m) => m.num).join(" -> ")} in ONE transaction: `);
    if (typed.trim() !== "vrozlllcaxinavzxueif") stopChain("confirmation did not match — nothing was changed");
  }

  out(`[3/5] chain ${TARGET}..${CHAIN_TO} (ONE transaction; per-migration postflight + business fingerprint gates)`);
  const counts = ro(COUNTS); const balances = ro(BALANCES); const fpBefore = ro(chainLib.fingerprintSql());
  if (counts.status !== 0 || balances.status !== 0 || fpBefore.status !== 0) stopChain("cannot read row counts / balances / fingerprint");
  out(`  balances before: ${balances.stdout.trim()}`);
  const chainFile = path.join(latest, `chain-${TARGET}-${CHAIN_TO}-production.sql`);
  fs.writeFileSync(chainFile, built.sql);
  const mig = psql(["-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", chainFile], 30 * MIN);
  fs.writeFileSync(path.join(latest, `chain-${TARGET}-${CHAIN_TO}-production.log`), String(mig.stdout || "") + String(mig.stderr || ""));
  for (const l of String(mig.stdout || "").split(/\r?\n/).filter((x) => x.startsWith("[chain]"))) out(`  ${l}`);
  if (mig.status !== 0) stopChain(`chain failed and was rolled back as a whole: ${firstError(mig)}`);
  out("  CHAIN: applied and recorded in one transaction");

  out("[4/5] postflight (read only)");
  let pass = true;
  const rec = ro(`select count(*) from supabase_migrations.schema_migrations where version in (${versions})`);
  out(`  history rows ${TARGET}..${CHAIN_TO}: ${rec.stdout.trim()}/${built.chain.length}`);
  pass = pass && rec.stdout.trim() === String(built.chain.length);
  for (let n = 73; n <= Number(CHAIN_TO); n++) {
    const v = String(n).padStart(3, "0");
    const r = ro(checksLib.allColumnsTrue(path.join(REPO, `supabase/release/${v}_postflight_readonly.sql`)));
    const ok = r.status === 0 && r.stdout.trim() === "t";
    out(`  ${v} postflight: ${ok ? "all true" : "FAIL"}`);
    pass = pass && ok;
  }
  const pfFile = psql(["-v", "ON_ERROR_STOP=1", "-f", path.join(REPO, `supabase/release/${CHAIN_TO}_postflight_readonly.sql`)]);
  fs.writeFileSync(path.join(latest, `postflight-${CHAIN_TO}-production.txt`), String(pfFile.stdout || "") + String(pfFile.stderr || ""));
  const countsAfter = ro(COUNTS); const balancesAfter = ro(BALANCES); const fpAfter = ro(chainLib.fingerprintSql());
  const countsSame = countsAfter.stdout.trim() === counts.stdout.trim();
  const balancesSame = balancesAfter.stdout.trim() === balances.stdout.trim();
  const fpMap = new Map(fpAfter.stdout.trim().split(/\r?\n/).map((l) => [l.split("|")[0], l]));
  const fpDiff = fpBefore.stdout.trim().split(/\r?\n/).filter((l) => fpMap.get(l.split("|")[0]) !== l);
  out(`  row counts unchanged: ${countsSame ? "yes" : `NO before=${counts.stdout.trim()} after=${countsAfter.stdout.trim()}`}`);
  out(`  balances unchanged: ${balancesSame ? "yes" : `NO after=${balancesAfter.stdout.trim()}`}`);
  out(`  business fingerprint unchanged (${fpBefore.stdout.trim().split(/\r?\n/).length} categories): ${fpDiff.length ? `NO ${fpDiff.map((l) => l.split("|")[0]).join(", ")}` : "yes"}`);
  const rlsAfter = kit(KITS[3], "rls-isolation-after");
  const newLeaks = rlsAfter.split(/\r?\n/).map((l) => l.replace(/^.*NOTICE:\s*/, "")).filter((l) => l.startsWith("LEAK|")).map((l) => l.split("|").slice(0, 4).join("|")).filter((k) => !leaksBefore.has(k));
  out(`  RLS isolation after: ${(rlsAfter.match(/RLS_ISOLATION\|[^\r\n]*/) || ["no result line"])[0]}${newLeaks.length ? " NEW LEAKS: " + newLeaks.join(", ") : ""}`);
  pass = pass && countsSame && balancesSame && !fpDiff.length && !newLeaks.length && /RLS_ISOLATION\|/.test(rlsAfter);
  if (!pass) stopChain("POSTFLIGHT FAILED — do not deploy the frontend", { committed: true });
  out("  POSTFLIGHT: PASS");
  out(`[5/5] next: production frontend (production-frontend.ps1 -Apply -ReleaseCandidate <sha>), then run-readonly-checks.ps1 -Target production-post, then run-production-smoke.ps1`);
  out(`\nRESULT: CHAIN ${TARGET}..${CHAIN_TO} APPLIED, POSTFLIGHT PASS. Report: ${resultFile}`);
}

(CHAIN_TO ? mainChain() : main()).catch((e) => (CHAIN_TO ? stopChain : stop)(e && e.message ? e.message : String(e)));
