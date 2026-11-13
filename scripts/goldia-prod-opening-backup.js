#!/usr/bin/env node
/**
 * GOLDIA SALES - PRODUCTION backup verification for the 085 financial restart (PHASE F2).
 *
 *   node scripts/goldia-prod-opening-backup.js --org <organization uuid>                       check only (read only)
 *   node scripts/goldia-prod-opening-backup.js --org <uuid> --backup                           + full backup + SHA256SUMS + local restore test
 *   node scripts/goldia-prod-opening-backup.js --org <uuid> --backup --write-verification      + ONE verification row (the only write)
 *   node scripts/goldia-prod-opening-backup.js --org <uuid> --watch                            read only: report every business write until the restart
 *
 * Production only (Supabase vrozlllcaxinavzxueif through the session pooler); staging / JFS demo / ERP refs are refused
 * before any connection. Every read runs in an explicit BEGIN TRANSACTION READ ONLY. The password is typed hidden.
 *
 * Gates (any failure STOPs, nothing written):
 *  1. identity: PostgreSQL 17, not a JFS demo database, migration history latest = 085, the organization exists, no
 *     opening period in draft, no unused verification younger than 24 h for it (a second one is never needed).
 *  2. QUIET WINDOW ("freeze" by procedure, checked by the database): no business write in ANY organization during the
 *     last --quiet-minutes (default 15); no other open transaction of the application roles; seller tills of the
 *     organization reported (they must have been handed over before T0).
 *  3. --backup: full pg_dump (public, auth, storage, supabase_migrations), 3 attempts with TCP keepalives, each file
 *     accepted only when pg_restore --list reads it; SHA256SUMS; business fingerprint (every row, every column of the
 *     financial tables of every organization) identical before and after the dump.
 *  4. restore test into a disposable LOCAL PostgreSQL 17: row counts AND the business fingerprint identical to production.
 *  5. --write-verification: production fingerprint still identical to the dump (no write since); the owner types the
 *     production ref and the organization code; then ONE row in public.financial_backup_verifications (organization,
 *     backup reference, dump SHA-256, restore_verified). The restart must follow at once (the RPC accepts it 24 h).
 *  6. --watch: re-reads the fingerprint every --every seconds until a financial_restarts row of the organization exists;
 *     any business write between the dump and the restart is reported (the backup would then not contain it).
 * The restart itself is NOT done here: the director starts it on /sales/app/opening (rpc_financial_restart).
 * Local rehearsal (disposable stand-in only): --local-rehearsal --host 127.0.0.1 --port <p> [--yes].
 */
"use strict";
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]; if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
}
const PROD_REF = "vrozlllcaxinavzxueif";
const FORBIDDEN = { vouehtlmsunebracahon: "Goldia STAGING", yvvbdoqncubtwlzskgml: "JewelryFlow SaaS demo", hbbuskyifxkowlozsaym: "manufacturing ERP", vrozlilcaxinavzxueif: "typo of the production ref" };
const REHEARSAL = !!args["local-rehearsal"];
const T = {
  host: args.host || "aws-0-ap-southeast-1.pooler.supabase.com",
  port: String(args.port || 5432),
  user: REHEARSAL ? String(args.user || "postgres") : `postgres.${PROD_REF}`,
  sslmode: REHEARSAL ? "disable" : "require",
};
const ORG = String(args.org || "");
const QUIET_MIN = Number(args["quiet-minutes"] || 15);
const MIN = 60 * 1000;
const EXPECT_LEVEL = "20260101000085";

const lines = []; let outDir = null; let resultFile = null; let written = false;
function out(l = "") { console.log(l); lines.push(l); if (resultFile) fs.writeFileSync(resultFile, lines.join(os.EOL) + os.EOL); }
function stop(m) {
  out(`\nSTOP: ${m}`);
  out(written ? "ONE backup verification row WAS written (see above); it is unused until the director starts the restart." : "Production was NOT changed.");
  out("RESULT: STOP"); process.exit(1);
}

// ---------------------------------------------------------------- guards before any connection
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ORG)) stop("--org <organization uuid> is required");
const joined = [T.host, T.user, process.env.PGHOST, process.env.PGUSER, process.env.DATABASE_URL].filter(Boolean).join(" ");
for (const [ref, label] of Object.entries(FORBIDDEN)) if (joined.includes(ref)) stop(`${label} (${ref}) is never a target of this script`);
if (REHEARSAL && !/^(127\.0\.0\.1|localhost)$/.test(T.host)) stop("--local-rehearsal only with a local --host");
if (!REHEARSAL && !(/^aws-[0-9]-[a-z0-9-]+\.pooler\.supabase\.com$/.test(T.host))) stop(`unexpected host ${T.host}`);
if (args["write-verification"] && !args.backup) stop("--write-verification needs --backup (a verification is written only after a restore-verified backup)");
if (args.yes && !REHEARSAL) stop("--yes is accepted only with --local-rehearsal");

const NEED = ["psql", "pg_dump", "pg_restore", "initdb", "pg_ctl"];
function findPgBin() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const dirs = []; if (args["pg-bin"]) dirs.push(String(args["pg-bin"]));
  const roots = process.platform === "win32" ? [process.env.ProgramFiles, "C:\\Program Files"].filter(Boolean).map((r) => path.join(r, "PostgreSQL")) : ["/usr/lib/postgresql"];
  for (const b of roots) { if (!fs.existsSync(b)) continue; for (const v of fs.readdirSync(b).sort((x, y) => parseFloat(y) - parseFloat(x))) dirs.push(path.join(b, v, "bin")); }
  const dir = dirs.find((d) => NEED.every((t) => fs.existsSync(path.join(d, t + exe))));
  return dir ? { dir, tool: (t) => path.join(dir, t + exe) } : null;
}
const PG = findPgBin();
if (!PG) stop("PostgreSQL 17 tools not found (pass --pg-bin \"C:\\Program Files\\PostgreSQL\\17\\bin\")");
function run(tool, a, { env = {}, timeoutMs = 30 * MIN, noPipes = false } = {}) {
  const r = spawnSync(PG.tool(tool), a, { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 1024 * 1024 * 512, windowsHide: true, timeout: timeoutMs, killSignal: "SIGKILL", stdio: noPipes ? "ignore" : "pipe" });
  if (r.error && r.error.code === "ETIMEDOUT") return { status: null, stdout: "", stderr: `${tool} timed out` };
  if (r.error) throw r.error; return r;
}
let password = "";
const remoteEnv = () => ({ PGHOST: T.host, PGPORT: T.port, PGUSER: T.user, PGDATABASE: "postgres", PGSSLMODE: T.sslmode, PGCONNECT_TIMEOUT: "20", PGAPPNAME: "goldia-prod-opening-backup", PGPASSWORD: password || undefined });
let localPort; const localEnv = () => ({ PGHOST: "localhost", PGPORT: String(localPort), PGUSER: "postgres", PGDATABASE: "postgres", PGSSLMODE: "disable", PGPASSWORD: "" });
const clean = (s) => String(s || "").replace(/password=\S+/gi, "password=***");
const firstError = (r) => clean(String(r.stderr || "").split(/\r?\n/).find((l) => /ERROR|FATAL|error/.test(l)) || r.stderr || "").trim();
function psql(envFn, sql, { tuples = true, singleTx = false } = {}) {
  const a = ["-X", "-q", "-w", "-v", "ON_ERROR_STOP=1"]; if (tuples) a.push("-t", "-A", "-F", "|"); if (singleTx) a.push("--single-transaction"); a.push("-c", sql);
  return run("psql", a, { env: envFn(), timeoutMs: 15 * MIN });
}
// every read: explicit read-only transaction with a guard (the Supabase pooler ignores PGOPTIONS)
function q(envFn, sql) {
  const a = ["-X", "-q", "-w", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", "begin transaction read only",
    "-c", "do $$ begin if current_setting('transaction_read_only') <> 'on' then raise exception 'not read only'; end if; end $$", "-c", sql, "-c", "rollback"];
  const r = run("psql", a, { env: envFn(), timeoutMs: 15 * MIN });
  if (r.status !== 0) stop(`query failed: ${firstError(r)}`);
  return String(r.stdout).trim();
}
function sha256(file) { const h = crypto.createHash("sha256"); const fd = fs.openSync(file, "r"); const b = Buffer.alloc(1 << 20); let n; while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0) h.update(b.subarray(0, n)); fs.closeSync(fd); return h.digest("hex"); }
const sleep = (s) => spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${s * 1000})`]);
function freePort(start) { return new Promise((res) => { const t = (p) => { const s = net.createServer(); s.once("error", () => t(p + 1)); s.once("listening", () => s.close(() => res(p))); s.listen(p, "127.0.0.1"); }; t(start); }); }
function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") stop("run this in an interactive PowerShell window (typed confirmation required)");
    process.stdout.write(question); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8"); let v = "";
    const on = (chunk) => { for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", on); process.stdout.write(os.EOL); resolve(v); return; }
      if (ch === "\u0003") process.exit(130);
      if (ch === "\u007f" || ch === "\b") v = v.slice(0, -1); else { v += ch; if (!hidden) process.stdout.write(ch); } } };
    stdin.on("data", on);
  });
}

// ---------------------------------------------------------------- business fingerprint (every row, every column)
const FIN_TABLES = ["client_gold_accounts", "client_currency_accounts", "seller_gold_accounts", "manager_vault_account", "customers", "employees", "jewelry_sales",
  "jewelry_sale_returns", "gold_settlements", "client_currency_settlements", "client_legacy_debts", "seller_consignments", "consignment_pieces", "factory_receipts",
  "factory_gold_handovers", "refining_batches", "financial_transactions", "gold_purchases", "accounting_baselines", "opening_periods", "opening_documents",
  "financial_restarts", "financial_backup_verifications", "daily_gold_rates"];
const FP_SQL = `select md5(coalesce(string_agg(t || ':' || n || ':' || h, ';' order by t), '')) || '|' || coalesce(sum(n), 0) from (
  ${FIN_TABLES.map((t) => `select '${t}' t, count(*) n, md5(coalesce(string_agg(to_jsonb(r)::text, ';' order by to_jsonb(r)::text), '')) h from public.${t} r`).join(" union all ")}) x`;
const LAST_WRITE_SQL = `select coalesce(extract(epoch from (now() - max(ts)))::bigint, 999999) from (
  ${["jewelry_sales", "gold_settlements", "client_currency_settlements", "client_legacy_debts", "seller_consignments", "factory_receipts", "factory_gold_handovers",
    "refining_batches", "financial_transactions", "gold_purchases", "jewelry_sale_returns", "opening_documents"].map((t) => `select max(created_at) ts from public.${t}`).join(" union all ")}) x`;

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outRoot = path.resolve(String(args.out || path.join(os.homedir(), "GoldiaBackups")));
  const repo = path.resolve(__dirname, "..");
  if (outRoot.toLowerCase().startsWith(repo.toLowerCase())) stop("the backup folder must be outside the repository");
  outDir = path.join(outRoot, `goldia-prod-opening-${stamp}`); fs.mkdirSync(outDir, { recursive: true });
  resultFile = path.join(outDir, "OPENING-BACKUP-RESULT.txt");
  out(`GOLDIA production backup verification for the 085 restart - ${REHEARSAL ? "LOCAL REHEARSAL " : ""}${T.host} as ${T.user}, organization ${ORG}`);
  out(`mode: ${args.watch ? "WATCH (read only)" : args["write-verification"] ? "BACKUP + VERIFICATION ROW" : args.backup ? "BACKUP (production only read)" : "CHECK ONLY (read only)"}`);
  if (!REHEARSAL) password = process.env.PGPASSWORD || await prompt(`Production DB password for ${T.user} (hidden): `, { hidden: true });

  // 1. identity
  out("[1] identity and state (read only)");
  const id = q(remoteEnv, `select current_setting('server_version_num') || '|' || (to_regprocedure('public.deployment_environment()') is null)::text || '|' ||
    coalesce((select max(version) from supabase_migrations.schema_migrations), '-') || '|' ||
    coalesce((select name || '#' || coalesce(code, '') from public.organizations where id = '${ORG}'), '') || '|' ||
    (select count(*) from public.opening_periods where organization_id = '${ORG}' and status = 'draft') || '|' ||
    (select count(*) from public.financial_backup_verifications where organization_id = '${ORG}' and consumed_by_restart_id is null and verified_at > now() - interval '24 hours') || '|' ||
    (select count(*) from public.employees where organization_id = '${ORG}' and is_active)`);
  const [ver, notJfs, level, orgName, drafts, unused, emps] = id.split("|");
  out(`  PostgreSQL ${ver}; not JFS demo ${notJfs}; history latest ${level}; organization "${orgName.split("#")[0]}" (${orgName.split("#")[1] || "-"}), active employees ${emps}`);
  if (Math.floor(Number(ver) / 10000) !== 17) stop("PostgreSQL 17 expected");
  if (notJfs !== "true") stop("deployment_environment() exists: this is a JewelryFlow SaaS demo database");
  if (level !== EXPECT_LEVEL) stop(`migration history must be at 085, found ${level}`);
  if (!orgName) stop("organization not found");
  if (Number(drafts) > 0) stop("the organization already has an opening in draft (a restart was already done)");

  if (args.watch) {
    const every = Number(args.every || 20); const fp0 = q(remoteEnv, FP_SQL); out(`[watch] business fingerprint now ${fp0}; checking every ${every} s until a restart of the organization is recorded`);
    let last = fp0;
    // --expect <fingerprint printed by the verification step>: a write between the dump and the start of the watch counts too
    if (args.expect && String(args.expect) !== fp0) { out(`  BUSINESS WRITE since the dump: expected ${args.expect}, now ${fp0} - the backup does not contain it`); last = "changed"; }
    for (;;) {
      const r = q(remoteEnv, `select count(*) from public.financial_restarts where organization_id = '${ORG}' and created_at > now() - interval '24 hours'`);
      if (Number(r) > 0) { const clean = last === fp0 && !(args.expect && String(args.expect) !== fp0); out(`  restart recorded. Business writes between ${args.expect ? "the dump" : "the start of the watch"} and the restart: ${clean ? "none" : "YES (see above)"}`); out(clean ? "RESULT: WATCH DONE - CLEAN" : "RESULT: WATCH DONE - WRITES SEEN (the backup lacks them)"); process.exit(clean ? 0 : 2); }
      const fp = q(remoteEnv, FP_SQL);
      // the restart itself changes the fingerprint: a change that comes with a new restart row is not counted as a write
      const restartedNow = Number(q(remoteEnv, `select count(*) from public.financial_restarts where organization_id = '${ORG}' and created_at > now() - interval '24 hours'`)) > 0;
      if (restartedNow) continue;
      if (fp !== last && !(last === "changed" && fp === fp0)) { out(`  ${new Date().toISOString()} BUSINESS WRITE detected (fingerprint ${fp}) - the backup does not contain it`); last = fp; }
      sleep(every);
    }
  }
  if (Number(unused) > 0 && args["write-verification"]) stop(`an unused verification younger than 24 h already exists for this organization (${unused}); use it or let it expire`);

  // 2. quiet window
  out("[2] quiet window (read only)");
  const quietS = Number(q(remoteEnv, LAST_WRITE_SQL));
  const openTx = q(remoteEnv, `select count(*) || '|' || coalesce(max(extract(epoch from now() - xact_start))::int, 0) from pg_stat_activity
    where pid <> pg_backend_pid() and xact_start is not null and datname = current_database() and backend_type = 'client backend'
      and coalesce(application_name, '') not like 'goldia-%' and usename in ('authenticator', 'authenticated', 'service_role', 'postgres', 'supabase_admin')`).split("|");
  const tills = q(remoteEnv, `select coalesce(sum(seller_till_cash_amount), 0) || '|' || coalesce(sum(seller_till_usd_amount), 0) || '|' || coalesce(sum(seller_till_scrap_grams), 0)
    from public.seller_gold_accounts where organization_id = '${ORG}'`).split("|");
  out(`  last business write (any organization): ${quietS >= 999999 ? "never" : `${Math.round(quietS / 60)} min ago`}; required quiet: ${QUIET_MIN} min`);
  out(`  other open transactions of the application roles: ${openTx[0]} (oldest ${openTx[1]} s)`);
  out(`  seller tills of the organization (must be handed over to the manager before T0; the restart archives the recorded values): UZS ${tills[0]}, USD ${tills[1]}, LOM ${tills[2]} g`);
  if (quietS < QUIET_MIN * 60) stop(`a business write happened ${Math.round(quietS / 60)} min ago - stop all work (sales, payments, handovers) and re-run after ${QUIET_MIN} quiet minutes`);
  if (Number(openTx[0]) > 0) stop("another application transaction is open - wait until it ends (or the users are logged out) and re-run");
  if (!args.backup) { out("\nRESULT: CHECK PASS (read only). Next: the same command with --backup."); process.exit(0); }

  // 3. backup
  out("[3] full backup (outside the repository)");
  const fpBefore = q(remoteEnv, FP_SQL);
  const backupPath = path.join(outDir, "production-full.dump");
  const keepalive = "dbname=postgres keepalives=1 keepalives_idle=30 keepalives_interval=10 keepalives_count=6 connect_timeout=30";
  const schemas = ["public", "auth", "storage", "supabase_migrations"];
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const part = `${backupPath}.attempt${attempt}`; const t0 = Date.now();
    const r = run("pg_dump", ["-w", "-Fc", "-d", keepalive, ...schemas.flatMap((s) => ["-n", s]), "-f", part], { env: remoteEnv(), timeoutMs: 60 * MIN });
    const list = r.status === 0 ? run("pg_restore", ["--list", part], { timeoutMs: 10 * MIN }) : null;
    if (r.status === 0 && list && list.status === 0 && /TABLE DATA public /.test(list.stdout)) { fs.renameSync(part, backupPath); ok = true; out(`  full dump: attempt ${attempt} ok (${Math.round((Date.now() - t0) / 1000)} s)`); }
    else { fs.writeFileSync(path.join(outDir, `pg_dump-attempt${attempt}.err.txt`), clean(r.stderr)); try { fs.rmSync(part, { force: true }); } catch { /* */ } out(`  full dump: attempt ${attempt}/3 FAILED: ${r.status !== 0 ? firstError(r) : "not readable"}`); if (attempt < 3) sleep(attempt * 15); }
  }
  if (!ok) stop("full backup failed 3 times - nothing was changed");
  const dumpSha = sha256(backupPath);
  fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), `${dumpSha}  production-full.dump  ${fs.statSync(backupPath).size} bytes${os.EOL}`);
  out(`  ${dumpSha}  production-full.dump  ${fs.statSync(backupPath).size} bytes`);
  const fpAfterDump = q(remoteEnv, FP_SQL);
  out(`  business fingerprint before / after the dump: ${fpBefore} / ${fpAfterDump}`);
  if (fpBefore !== fpAfterDump) stop("a business write happened DURING the backup - stop all work and re-run");

  // 4. restore test
  out("[4] restore test into a disposable LOCAL PostgreSQL (production untouched)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goldia-prod-opening-restore-")); const data = path.join(dir, "data");
  localPort = await freePort(55700);
  let r = run("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"], { timeoutMs: 10 * MIN });
  if (r.status !== 0) stop(`initdb failed: ${firstError(r)}`);
  let up = true; const down = () => { if (!up) return; up = false; run("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "60", "stop"], { noPipes: true, timeoutMs: 2 * MIN }); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } };
  process.on("exit", down);
  run("pg_ctl", ["-D", data, "-o", `-p ${localPort} -c listen_addresses=localhost -c max_connections=50 -c jit=off`, "-l", path.join(dir, "pg.log"), "-w", "-t", "120", "start"], { noPipes: true, timeoutMs: 3 * MIN });
  let ready = false; for (let i = 0; i < 120 && !ready; i++) { ready = psql(localEnv, "select 1").status === 0; if (!ready) sleep(1); }
  if (!ready) stop("local PostgreSQL did not start");
  psql(localEnv, `do $$ declare r text; begin foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin','dashboard_user','pgbouncer']
    loop if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if; end loop; end $$`, { tuples: false });
  for (const pair of q(remoteEnv, "select coalesce(string_agg(e.extname || ':' || n.nspname, ','), '') from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql'").split(",").filter(Boolean)) {
    const [name, schema] = pair.split(":"); psql(localEnv, `create schema if not exists "${schema}"; create extension if not exists "${name}" with schema "${schema}"`, { tuples: false });
  }
  r = run("pg_restore", ["-w", "--no-owner", "-d", "postgres", backupPath], { env: localEnv(), timeoutMs: 60 * MIN });
  fs.writeFileSync(path.join(outDir, "restore-test.log"), clean(r.stderr));
  const COUNTS = `select string_agg(table_schema || '.' || table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text, ',' order by table_schema, table_name)
    from information_schema.tables where table_type = 'BASE TABLE' and (table_schema in ('public', 'supabase_migrations') or (table_schema = 'auth' and table_name = 'users'))`;
  const cProd = q(remoteEnv, COUNTS); const cCopy = q(localEnv, COUNTS); const fpCopy = q(localEnv, FP_SQL);
  out(`  row counts production = restored copy: ${cProd === cCopy ? "identical" : "DIFFERENT"} (${cProd.split(",").length} tables)`);
  out(`  business fingerprint production = restored copy: ${fpCopy === fpAfterDump ? "identical" : `DIFFERENT (${fpCopy})`}`);
  if (cProd !== cCopy || fpCopy !== fpAfterDump) stop("restore test failed: the restored copy differs from production");
  out(`  BACKUP: VERIFIED (production-full.dump sha256=${dumpSha})`);
  down();
  if (!args["write-verification"]) { out("\nRESULT: BACKUP VERIFIED - no verification row written (add --write-verification in the restart window)."); process.exit(0); }

  // 5. verification row
  out("[5] backup verification row (the only write)");
  // local rehearsal only: a business write after the dump must stop the verification
  if (REHEARSAL && args["simulate-write-after-dump"]) psql(remoteEnv, "update public.customers set contact_name = contact_name || ' (rehearsal)' where id = (select id from public.customers order by id limit 1)", { tuples: false });
  const fpNow = q(remoteEnv, FP_SQL);
  if (fpNow !== fpAfterDump) stop("production changed after the dump - the backup no longer contains everything; stop all work and re-run");
  const code = orgName.split("#")[1] || "";
  if (!(REHEARSAL && args.yes)) {
    const t1 = await prompt(`Type the production project ref (${PROD_REF}) to record the verification: `);
    if (t1.trim() !== PROD_REF) stop("confirmation did not match");
    const t2 = await prompt(`Type the organization code (${code}) of "${orgName.split("#")[0]}": `);
    if (t2.trim() !== code || !code) stop("organization confirmation did not match");
  }
  const ref = `${path.basename(outDir)}/production-full.dump`.replace(/'/g, "");
  const ins = psql(remoteEnv, `insert into public.financial_backup_verifications (organization_id, backup_reference, backup_sha256, restore_verified)
    values ('${ORG}', '${ref}', '${dumpSha}', true) returning id`, { singleTx: true });
  if (ins.status !== 0) stop(`writing the verification failed: ${firstError(ins)}`);
  written = true;
  const vid = String(ins.stdout).split(/\r?\n/).map((x) => x.trim()).find((x) => /^[0-9a-f-]{36}$/.test(x));
  out(`  verification ${vid}: ${ref} sha256=${dumpSha} (valid 24 h, one restart)`);
  // the verification row is part of the fingerprint: the watch starts from the state "dump + this one row"
  const fpWithRow = q(remoteEnv, FP_SQL);
  if (Number(fpWithRow.split("|")[1]) !== Number(fpNow.split("|")[1]) + 1) out(`  WARNING: more than the verification row changed since the dump (${fpNow} -> ${fpWithRow}); stop all work`);
  out("\nRESULT: BACKUP VERIFIED + VERIFICATION WRITTEN. Next, AT ONCE: the director starts the restart on /sales/app/opening and selects this backup;");
  out(`        in a second window, until the restart: node scripts\\goldia-prod-opening-backup.js --org ${ORG} --watch --expect ${fpWithRow}`);
  process.exit(0);
})().catch((e) => stop(clean(e && e.message ? e.message : String(e))));
