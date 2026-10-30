#!/usr/bin/env node
/**
 * GOLDIA — production backup + restore test + read-only release preflight (migration 065).
 *
 * Production is only READ: pg_dump/pg_dumpall snapshots and SQL files that run inside
 * "begin transaction read only ... rollback". Migration 065 is applied ONLY to a disposable
 * local PostgreSQL cluster restored from the fresh backup — never to production.
 *
 * Usage (from the repo root, on the PR #4 branch):
 *   node scripts/goldia-prod-backup-and-preflight.js
 * The database password is asked in a hidden prompt (or taken from PGPASSWORD / pgpass).
 * It is never printed, written to disk or committed.
 *
 * Options: --host --port --user --db --sslmode --pg-bin <dir> --out <dir> --keep-restore
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const PROD = {
  host: args.host || "aws-0-ap-southeast-1.pooler.supabase.com",
  port: String(args.port || 5432),
  user: args.user || "postgres.vrozlllcaxinavzxueif",
  db: args.db || "postgres",
  sslmode: args.sslmode || "require",
};
const SCHEMAS = ["public", "auth", "storage", "supabase_migrations"];
const FILES = {
  preflight: path.join(REPO, "supabase/release/065_preflight_readonly.sql"),
  postflight: path.join(REPO, "supabase/release/065_postflight_readonly.sql"),
  investigation: path.join(REPO, "supabase/release/065_investigation_readonly.sql"),
  advisor: path.join(REPO, "supabase/release/security_advisor_readonly.sql"),
  migration065: path.join(REPO, "supabase/migrations/20260101000065_goldia_blocker_high_audit_fixes.sql"),
  rollback065: path.join(REPO, "supabase/rollback/20260101000065_rollback.sql"),
};

const summary = [];
const gate = {};
let outDir;
let logFile;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

function log(line) {
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + os.EOL);
}

function note(key, value) {
  summary.push(`${key}: ${value}`);
  log(`  -> ${key}: ${value}`);
}

function fail(message) {
  log(`\nSTOPPED: ${message}`);
  writeSummary("STOPPED: " + message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// PostgreSQL tools
// ---------------------------------------------------------------------------
function findPgBin() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidates = [];
  if (args["pg-bin"]) candidates.push(String(args["pg-bin"]));
  if (process.platform === "win32") {
    for (const root of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], "C:\\Program Files"]) {
      if (!root) continue;
      const base = path.join(root, "PostgreSQL");
      if (!fs.existsSync(base)) continue;
      for (const v of fs.readdirSync(base).sort((a, b) => parseFloat(b) - parseFloat(a))) {
        candidates.push(path.join(base, v, "bin"));
      }
    }
  } else {
    const base = "/usr/lib/postgresql";
    if (fs.existsSync(base)) {
      for (const v of fs.readdirSync(base).sort((a, b) => parseFloat(b) - parseFloat(a))) {
        candidates.push(path.join(base, v, "bin"));
      }
    }
    candidates.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin");
  }
  for (const dir of candidates) {
    const need = ["pg_dump", "pg_dumpall", "pg_restore", "psql", "initdb", "pg_ctl"];
    if (need.every((t) => fs.existsSync(path.join(dir, t + exe)))) {
      return { dir, tool: (t) => path.join(dir, t + exe) };
    }
  }
  return null;
}

let PG;

function run(tool, argList, { env = {}, input, quiet } = {}) {
  const res = spawnSync(PG.tool(tool), argList, {
    env: { ...process.env, ...env },
    input,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
    windowsHide: true,
  });
  if (res.error) throw res.error;
  if (!quiet && res.status !== 0 && logFile) {
    fs.appendFileSync(logFile, `[${tool} exit ${res.status}] ${String(res.stderr || "").slice(0, 4000)}${os.EOL}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Connections (password only ever lives in the child process environment)
// ---------------------------------------------------------------------------
let prodPassword;
const prodEnv = () => ({
  PGHOST: PROD.host,
  PGPORT: PROD.port,
  PGUSER: PROD.user,
  PGDATABASE: PROD.db,
  PGSSLMODE: PROD.sslmode,
  PGCONNECT_TIMEOUT: "20",
  PGAPPNAME: "goldia-readonly-preflight",
  ...(prodPassword ? { PGPASSWORD: prodPassword } : {}),
});
let localPort;
const localEnv = () => ({
  PGHOST: "localhost",
  PGPORT: String(localPort),
  PGUSER: "postgres",
  PGDATABASE: "postgres",
  PGSSLMODE: "disable",
  PGPASSWORD: "",
});

function psql(envFn, sqlOrFile, { file = false, tuples = true, onErrorStop = true, singleTx = false } = {}) {
  const a = ["-X", "-q"];
  if (tuples) a.push("-t", "-A", "-F", "|");
  if (onErrorStop) a.push("-v", "ON_ERROR_STOP=1");
  if (singleTx) a.push("--single-transaction");
  if (file) a.push("-f", sqlOrFile);
  else a.push("-c", sqlOrFile);
  return run("psql", a, { env: envFn() });
}

function readOnly(sql) {
  return `begin transaction read only; ${sql}; rollback;`;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      fail("Parol so'rash uchun interaktiv terminal kerak (PowerShell/cmd), yoki PGPASSWORD ni shu oynada o'rnating.");
    }
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const COUNTS_SQL = `
select table_schema || '.' || table_name || '|' ||
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and (table_schema in ('public', 'supabase_migrations') or (table_schema = 'auth' and table_name = 'users'))
 order by 1`;

function counts(envFn) {
  const r = psql(envFn, readOnly(COUNTS_SQL));
  if (r.status !== 0) return null;
  const map = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const [k, v] = line.split("|");
    if (k && v !== undefined) map[k] = Number(v);
  }
  return map;
}

function diffCounts(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of [...keys].sort()) if (a[k] !== b[k]) out.push(`${k}: ${a[k] ?? "missing"} vs ${b[k] ?? "missing"}`);
  return out;
}

function sha256(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1024 * 1024);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest("hex");
}

function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.once("error", () => tryPort(p + 1));
      srv.once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    tryPort(start);
  });
}

function writeSummary(verdict) {
  if (!outDir) return;
  const text = [
    "GOLDIA PRODUCTION BACKUP + PREFLIGHT SUMMARY (no secrets, no customer names)",
    `generated: ${new Date().toISOString()}`,
    `backup folder: ${outDir}`,
    "",
    ...summary,
    "",
    `RESULT: ${verdict}`,
    "",
  ].join(os.EOL);
  fs.writeFileSync(path.join(outDir, "SUMMARY.txt"), text);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("GOLDIA — production backup, restore test and read-only preflight\n");

  for (const f of Object.values(FILES)) {
    if (!fs.existsSync(f)) {
      console.error(`Missing ${path.relative(REPO, f)}. Run from the PR #4 branch (claude/jewelryflow-onboarding-audit-c87f49).`);
      process.exit(1);
    }
  }

  PG = findPgBin();
  if (!PG) {
    console.error("PostgreSQL tools not found. Install PostgreSQL 17, or pass --pg-bin \"C:\\Program Files\\PostgreSQL\\17\\bin\".");
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outRoot = path.resolve(String(args.out || path.join(os.homedir(), "GoldiaBackups")));
  if (outRoot.toLowerCase().startsWith(REPO.toLowerCase())) {
    console.error("Backup folder must be outside the repository.");
    process.exit(1);
  }
  outDir = path.join(outRoot, `goldia-prod-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  logFile = path.join(outDir, "run.log");

  // 1. Tools
  log("[1/9] PostgreSQL tools");
  const dumpVersion = run("pg_dump", ["--version"]).stdout.trim();
  note("pg tools", `${PG.dir} (${dumpVersion})`);
  const dumpMajor = parseInt((dumpVersion.match(/(\d+)\./) || [])[1], 10);

  // 2. Connection
  log("[2/9] Production connection (read-only use)");
  if (!process.env.PGPASSWORD && !args["no-password"]) {
    prodPassword = await promptHidden(`Supabase DB password for ${PROD.user} (hidden): `);
  }
  const ver = psql(prodEnv, "select current_setting('server_version_num') || '|' || current_setting('server_version')");
  if (ver.status !== 0) {
    const err = String(ver.stderr || "").replace(/password=\S+/gi, "password=***").trim();
    fail(`connection failed: ${err.split(/\r?\n/)[0]}`);
  }
  const [serverNum, serverVersion] = ver.stdout.trim().split("|");
  const serverMajor = Math.floor(Number(serverNum) / 10000);
  note("production server", `PostgreSQL ${serverVersion}`);
  if (dumpMajor < serverMajor) fail(`pg_dump ${dumpMajor} is older than server ${serverMajor}; install PostgreSQL ${serverMajor}+`);

  // 3. Backups
  log("[3/9] Backups (outside the repository)");
  const before = counts(prodEnv);
  if (!before) fail("could not read production row counts");
  const schemaFlags = (schemas) => schemas.flatMap((s) => ["-n", s]);
  let schemas = SCHEMAS;
  const full = path.join(outDir, "goldia-full.dump");
  let r = run("pg_dump", ["-Fc", ...schemaFlags(schemas), "-f", full], { env: prodEnv() });
  if (r.status !== 0) {
    log("  full dump with auth/storage failed, retrying public + supabase_migrations only");
    schemas = ["public", "supabase_migrations"];
    r = run("pg_dump", ["-Fc", ...schemaFlags(schemas), "-f", full], { env: prodEnv() });
    if (r.status !== 0) fail("pg_dump failed (see run.log)");
    note("WARNING", "auth/storage schemas NOT in backup (logins must be recreated after a disaster)");
  }
  note("schemas in backup", schemas.join(", "));
  const schemaSql = path.join(outDir, "goldia-schema.sql");
  r = run("pg_dump", ["--schema-only", ...schemaFlags(schemas), "-f", schemaSql], { env: prodEnv() });
  note("schema backup", r.status === 0 ? "ok" : "FAILED");
  const dataDump = path.join(outDir, "goldia-data.dump");
  r = run("pg_dump", ["-Fc", "--data-only", ...schemaFlags(schemas), "-f", dataDump], { env: prodEnv() });
  note("data backup", r.status === 0 ? "ok" : "FAILED");
  const rolesSql = path.join(outDir, "goldia-roles.sql");
  r = run("pg_dumpall", ["--roles-only", "--no-role-passwords", "-l", PROD.db, "-f", rolesSql], { env: prodEnv() });
  note("roles backup", r.status === 0 ? "ok" : "not permitted on Supabase pooler (non-critical: Supabase recreates platform roles)");
  const after = counts(prodEnv);
  const liveChanges = diffCounts(before, after);
  note("rows changed during backup", liveChanges.length ? liveChanges.join("; ") : "none");

  const checksums = fs.readdirSync(outDir).filter((f) => /\.(dump|sql)$/.test(f))
    .map((f) => `${sha256(path.join(outDir, f))}  ${f}  ${fs.statSync(path.join(outDir, f)).size} bytes`);
  fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), checksums.join(os.EOL) + os.EOL);
  for (const c of checksums) log("  " + c);

  // 4. Restore test into a disposable local cluster
  log("[4/9] Restore test into a disposable LOCAL PostgreSQL (never production)");
  const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "goldia-restore-"));
  const dataDir = path.join(restoreDir, "data");
  localPort = await freePort(55432);
  r = run("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"]);
  if (r.status !== 0) fail("initdb failed (see run.log)");
  r = run("pg_ctl", ["-D", dataDir, "-o", `-p ${localPort} -c listen_addresses=localhost`, "-l", path.join(restoreDir, "pg.log"), "-w", "start"]);
  if (r.status !== 0) fail("local PostgreSQL did not start (see run.log)");
  let localStarted = true;
  const stopLocal = () => {
    if (!localStarted) return;
    run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], { quiet: true });
    localStarted = false;
    if (!args["keep-restore"]) fs.rmSync(restoreDir, { recursive: true, force: true });
  };
  process.on("exit", stopLocal);

  try {
    psql(localEnv, `
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create role authenticator nologin; create role supabase_admin nologin; create role supabase_auth_admin nologin;
      create role supabase_storage_admin nologin; create role dashboard_user nologin;`, { tuples: false, onErrorStop: false });
    // pg_dump -n does not emit CREATE EXTENSION: recreate production's extensions in the same schemas.
    const ext = psql(prodEnv, readOnly(`select e.extname || '|' || n.nspname from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql' order by 1`));
    const missingExt = [];
    for (const line of String(ext.stdout || "").split(/\r?\n/).filter(Boolean)) {
      const [name, schema] = line.split("|");
      const ok = psql(localEnv, `create schema if not exists "${schema}"; create extension if not exists "${name}" with schema "${schema}"`,
        { tuples: false });
      if (ok.status !== 0) missingExt.push(name);
    }
    note("extensions not available locally (Supabase platform only)", missingExt.length ? missingExt.join(", ") : "none");
    const restoreLog = path.join(outDir, "restore-test.log");
    r = run("pg_restore", ["--no-owner", "--no-acl", "-d", "postgres", full], { env: localEnv(), quiet: true });
    fs.writeFileSync(restoreLog, String(r.stderr || ""));
    const restoreErrors = String(r.stderr || "").split(/\r?\n/)
      .filter((l) => l.includes("error:") && !l.includes('schema "public" already exists')).length;
    note("restore errors (Supabase platform objects may account for some)", restoreErrors);

    const local = counts(localEnv) || {};
    const restoreDiff = diffCounts(liveChanges.length ? after : before, local)
      .filter((d) => !schemas.includes("auth") ? !d.startsWith("auth.") : true);
    // Project objects only (extension member functions excluded)
    const OBJ_SQL = `select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'))
      || '/' || (select count(*) from pg_policies where schemaname = 'public')
      || '/' || (select count(*) from pg_views where schemaname = 'public')`;
    const fnProd = psql(prodEnv, readOnly(OBJ_SQL)).stdout.trim();
    const fnLocal = psql(localEnv, OBJ_SQL).stdout.trim();
    note("public functions/policies/views prod vs restored", `${fnProd} vs ${fnLocal}`);
    note("tables compared", Object.keys(local).length);
    gate.backup = restoreDiff.length === 0 && liveChanges.length === 0 && fnProd === fnLocal && Object.keys(local).length > 0;
    note("row-count differences prod vs restored", restoreDiff.length ? restoreDiff.join("; ") : "none");
    note("BACKUP", gate.backup ? "VERIFIED (restored copy matches production row counts)" : "FAILED");

    // 5-6. Read-only checks on production
    log("[5/9] Migration 064/065 status + preflight (read only)");
    const g = psql(prodEnv, readOnly(`
      select
        exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000064'),
        exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000065'),
        (select coalesce(max(c), 0) from (select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('get_seller_available_stock_grams', 'get_manager_available_stock_grams',
             'recalc_seller_gold_account', 'rpc_return_piece_to_factory', 'rpc_return_piece_to_manager', 'rpc_record_client_settlement',
             'rpc_record_seller_to_manager_settlement', 'rpc_record_barcode_piece_sale', 'rpc_record_weight_sale',
             'rpc_reverse_client_sale', 'rpc_reverse_jewelry_sale', 'rpc_reverse_client_settlement',
             'rpc_get_seller_reconciliation_statement', 'rpc_set_daily_gold_rate', 'rpc_reverse_refining_batch')
           group by p.proname) x),
        position('factory_receipt_id IS NULL' in pg_get_functiondef('public.get_manager_available_stock_grams(uuid)'::regprocedure)) > 0,
        (select count(*) from public.consignment_pieces where status = 'returned_to_factory'),
        (select count(*) from auth.users where lower(email) in ('director@goldia.uz', 'manager@goldia.uz', 'seller@goldia.uz',
           'accountant@goldia.uz', 'worker@goldia.uz', 'xodim@goldia.uz', 'jamshid@jewelryflow.uz', 'dilshod@jewelryflow.uz',
           'jasur@jewelryflow.uz') or lower(email) like 'demo.%'),
        (select count(*) from public.daily_gold_rates where proba = 585 and rate_per_gram > 0)`));
    if (g.status !== 0) fail("preflight gate query failed (see run.log)");
    const [has064, has065, maxOverloads, has064Fix, retFactory, demoUsers, rates585] = g.stdout.trim().split("|");
    note("migration 064 applied", has064 === "t" ? "VERIFIED" : "NO");
    note("migration 065 already applied", has065 === "t" ? "YES (stop)" : "no");
    note("max overloads of touched functions", maxOverloads);
    note("064 manager-stock fix present", has064Fix === "t" ? "yes" : "no");
    note("pieces in returned_to_factory", retFactory);
    note("demo accounts in production auth", demoUsers);
    note("585 rates available", rates585);
    gate.migration064 = has064 === "t" && has064Fix === "t";
    gate.preflight = gate.migration064 && has065 === "f" && Number(maxOverloads) === 1 && Number(retFactory) === 0;
    note("PREFLIGHT", gate.preflight ? "PASS" : "FAIL");

    for (const [name, file] of [["preflight", FILES.preflight], ["investigation", FILES.investigation], ["security-advisor", FILES.advisor]]) {
      const res = psql(prodEnv, file, { file: true, tuples: false });
      fs.writeFileSync(path.join(outDir, `${name}.txt`), String(res.stdout || "") + String(res.stderr || ""));
      note(`${name} output`, res.status === 0 ? `${name}.txt` : `${name}.txt (ERRORS — see file)`);
    }

    // 7. Accounting findings (row counts per check, details stay in investigation.txt)
    log("[6/9] Accounting consistency findings");
    const inv = psql(prodEnv, FILES.investigation, { file: true });
    const tally = {};
    for (const line of String(inv.stdout || "").split(/\r?\n/)) {
      const key = line.split("|")[0];
      if (/^I\d+_/.test(key)) tally[key] = (tally[key] || 0) + 1;
    }
    const critical = ["I3_seller_mismatch", "I5_sold_piece_without_active_sale", "I5_held_piece_with_sale",
      "I5_sale_linked_to_many_pieces", "I5_piece_owner_differs_from_consignment", "I6_receipt_out_of_range"];
    for (const [k, v] of Object.entries(tally).sort()) note(`finding ${k}`, `${v} row(s)`);
    gate.accounting = critical.every((k) => !tally[k]);
    note("CRITICAL ACCOUNTING FINDINGS", gate.accounting ? "none" : critical.filter((k) => tally[k]).join(", "));

    log("[7/9] Security Advisor equivalents");
    const adv = psql(prodEnv, FILES.advisor, { file: true });
    const advTally = {};
    for (const line of String(adv.stdout || "").split(/\r?\n/)) {
      const key = line.split("|")[0];
      if (/^A\d+_/.test(key) && key !== "A7_summary") advTally[key] = (advTally[key] || 0) + 1;
    }
    for (const [k, v] of Object.entries(advTally).sort()) note(`advisor ${k}`, `${v}`);

    // 8. Migration 065 compatibility on the RESTORED LOCAL COPY
    log("[8/9] Migration 065 on the restored LOCAL copy (production untouched)");
    const localBefore = counts(localEnv) || {};
    const m = psql(localEnv, FILES.migration065, { file: true, tuples: false, singleTx: true });
    fs.writeFileSync(path.join(outDir, "local-065-apply.log"), String(m.stderr || ""));
    const localAfter = counts(localEnv) || {};
    const dataChanged = diffCounts(localBefore, localAfter);
    const post = psql(localEnv, FILES.postflight, { file: true, tuples: false });
    fs.writeFileSync(path.join(outDir, "local-postflight.txt"), String(post.stdout || "") + String(post.stderr || ""));
    const rb = psql(localEnv, FILES.rollback065, { file: true, tuples: false });
    const re = psql(localEnv, FILES.migration065, { file: true, tuples: false, singleTx: true });
    gate.compat = m.status === 0 && dataChanged.length === 0 && post.status === 0 && rb.status === 0 && re.status === 0;
    note("065 applies on production schema copy", m.status === 0 ? "yes" : "NO (see local-065-apply.log)");
    note("065 changed row counts", dataChanged.length ? dataChanged.join("; ") : "no");
    note("rollback + re-apply on copy", rb.status === 0 && re.status === 0 ? "ok" : "FAILED");
    note("065 COMPATIBILITY", gate.compat ? "PASS" : "FAIL");
  } finally {
    stopLocal();
  }

  // 9. Decision
  log("[9/9] Decision");
  const ready = gate.backup && gate.preflight && gate.compat && gate.accounting;
  const verdict = ready
    ? "ALL AUTOMATED GATES PASS — send SUMMARY.txt for review; production change still needs explicit owner approval"
    : "NO-GO — see failed gates above";
  note("GATES", `backup=${!!gate.backup} preflight=${!!gate.preflight} migration064=${!!gate.migration064} compat065=${!!gate.compat} accounting=${!!gate.accounting}`);
  writeSummary(verdict);
  log(`\nRESULT: ${verdict}`);
  log(`Send this file back for review: ${path.join(outDir, "SUMMARY.txt")}`);
  log("Keep the backup folder private (it contains customer data and login records). Do not commit it.");
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
