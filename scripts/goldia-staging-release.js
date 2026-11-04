#!/usr/bin/env node
/**
 * GOLDIA SALES — gated STAGING release: migration 076 (075 -> 076) in ONE transaction.
 * (2026-11-04: moved from 074 -> 075 to 075 -> 076; the steps are unchanged, the 073/074/075 postflights must stay true.)
 *
 *   node scripts/goldia-staging-release.js            dry run: backup + restore test + all checks on a LOCAL copy;
 *                                                     staging is only READ
 *   node scripts/goldia-staging-release.js --apply    the same, then (after you type the project ref) applies
 *                                                     075 to staging and runs the postflight
 *
 * Only the Goldia Sales STAGING project can be targeted (vouehtlmsunebracahon). Production (vrozlllcaxinavzxueif)
 * and JewelryFlow SaaS demo (yvvbdoqncubtwlzskgml) are refused before any connection is opened.
 *
 * Steps (any failed gate stops; nothing is written to staging before step 9):
 *  1. PostgreSQL 17 tools; repository files.
 *  2. Connection: session pooler for postgres.vouehtlmsunebracahon (region found without sending the password,
 *     or --host). Hidden password prompt (or PGPASSWORD); never printed or saved.
 *  3. Identity + state gates (read only): PostgreSQL 17, not a JFS demo database, 074 recorded, nothing > 074.
 *  4. Fresh backup (pg_dump -Fc public/auth/storage/supabase_migrations + schema + roles), SHA256SUMS.
 *  5. Restore test into a disposable LOCAL cluster; row counts must match staging.
 *  6. Schema parity of the restored copy with repository 001..074 (reported; the 075 parity in step 7 decides).
 *  7. On the LOCAL copy: 075 in one transaction with its postflight checks; every business row
 *     count and per-organization balance unchanged; schema parity with repository 001..075; RLS read AND write
 *     isolation across every organization (each login as `authenticated`, plus `anon`), compared before/after:
 *     after 075 no cross-organization access may remain anywhere; 073/074 postflights stay true; 075 rollback + re-apply.
 *     Missing objects stop the release; function bodies that differ from the repository are listed for review.
 *  8. Dry run ends here (DRY RUN PASS).
 *  9. --apply: staging must be unchanged since the backup; type the project ref; 075 in ONE transaction
 *     (lock_timeout 10 s) — on any error PostgreSQL rolls everything back and staging stays at 074.
 * 10. Postflight on staging (read only): 073 + 074 + 075 postflights, schema parity, RLS isolation, counts and balances.
 * Report: STAGING-075-RESULT.txt in the backup folder (no secrets, no customer data).
 *
 * Options: --host --port --sslmode --pg-bin <dir> --out <dir> --keep-restore
 */
"use strict";

const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const checks = require("./lib/goldia-release-checks");

const REPO = path.resolve(__dirname, "..");
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith("--") ? true : (i++, next);
}

const STAGING_REF = "vouehtlmsunebracahon";
const FORBIDDEN_REFS = { vrozlllcaxinavzxueif: "PRODUCTION", yvvbdoqncubtwlzskgml: "JewelryFlow SaaS demo (jfs-demo)" };
const FROM = "075";
const TO = "076";
const V = (n) => `20260101000${n}`;
const MIN = 60 * 1000;

// Local rehearsal only: a disposable cluster on this machine stands in for staging (used to test this script).
const REHEARSAL = !!args["local-rehearsal"];
const TARGET = {
  host: args.host || null,
  port: String(args.port || 5432),
  user: REHEARSAL ? String(args.user || "postgres") : `postgres.${STAGING_REF}`,
  db: "postgres",
  sslmode: String(args.sslmode || (REHEARSAL ? "disable" : "require")),
};

// ---------------------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------------------
const lines = [];
let outDir;
let resultFile;
function out(line = "") {
  console.log(line);
  lines.push(line);
  if (resultFile) fs.writeFileSync(resultFile, lines.join(os.EOL) + os.EOL);
}
let stagingWritten = false;
let knownLeaksAfter = [];
let backupPath = null;
function stop(message) {
  out(`\nSTOP: ${message}`);
  if (stagingWritten) {
    out(`Staging WAS changed by the migration transaction. Data-preserving rollback of the last migration (${TO}) only:`);
    out(`  psql "<same connection>" -v ON_ERROR_STOP=1 -f supabase/rollback/${V(TO)}_rollback.sql`);
    out(`Full return to the pre-release state: restore ${backupPath || "the backup in this folder"} (see docs/releases/staging-073/README.md).`);
  } else {
    out("Staging database was NOT changed.");
  }
  out("RESULT: STOP");
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------------------------
const NEED = ["psql", "pg_dump", "pg_dumpall", "pg_restore", "initdb", "pg_ctl"];
function findPgBin() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const dirs = [];
  if (args["pg-bin"]) dirs.push(String(args["pg-bin"]));
  const roots = process.platform === "win32"
    ? [process.env.ProgramFiles, "C:\\Program Files"].filter(Boolean).map((r) => path.join(r, "PostgreSQL"))
    : ["/usr/lib/postgresql"];
  for (const base of roots) {
    if (!fs.existsSync(base)) continue;
    for (const v of fs.readdirSync(base).sort((a, b) => parseFloat(b) - parseFloat(a))) dirs.push(path.join(base, v, "bin"));
  }
  const dir = dirs.find((d) => NEED.every((t) => fs.existsSync(path.join(d, t + exe))));
  return dir ? { dir, tool: (t) => path.join(dir, t + exe) } : null;
}
let PG;

function run(tool, argList, { env = {}, timeoutMs = 30 * MIN, noPipes = false, input } = {}) {
  const res = spawnSync(PG.tool(tool), argList, {
    env: { ...process.env, ...env }, input, encoding: "utf8", maxBuffer: 1024 * 1024 * 512, windowsHide: true,
    timeout: timeoutMs, killSignal: "SIGKILL",
    // A server started by pg_ctl inherits pipes; on Windows spawnSync would wait for them forever.
    stdio: noPipes ? "ignore" : "pipe",
  });
  if (res.error && res.error.code === "ETIMEDOUT") return { status: null, timedOut: true, stdout: "", stderr: `${tool} timed out` };
  if (res.error) throw res.error;
  return res;
}

let password;
const remoteEnv = (withPassword = true) => ({
  PGHOST: TARGET.host, PGPORT: TARGET.port, PGUSER: TARGET.user, PGDATABASE: TARGET.db, PGSSLMODE: TARGET.sslmode,
  PGCONNECT_TIMEOUT: "20", PGAPPNAME: `goldia-staging-release-${TO}`,
  // undefined removes the variable for the child (Node ignores undefined env values): nothing is sent while probing.
  PGPASSWORD: withPassword && password ? password : undefined,
});
let localPort;
const localEnv = () => ({
  PGHOST: "localhost", PGPORT: String(localPort), PGUSER: "postgres", PGDATABASE: "postgres", PGSSLMODE: "disable", PGPASSWORD: "",
});

function psql(envFn, sqlOrFile, { file = false, tuples = true, singleTx = false, timeoutMs = 15 * MIN, extra = [] } = {}) {
  const a = ["-X", "-q", "-w", "-v", "ON_ERROR_STOP=1", ...extra];
  if (tuples) a.push("-t", "-A", "-F", "|");
  if (singleTx) a.push("--single-transaction");
  a.push(file ? "-f" : "-c", sqlOrFile);
  return run("psql", a, { env: envFn(), timeoutMs });
}
const ro = (sql) => `begin transaction read only; ${sql}; rollback;`;
const clean = (s) => String(s || "").replace(/password=\S+/gi, "password=***");
const firstError = (r) => clean(String(r.stderr || "").split(/\r?\n/).find((l) => /ERROR|FATAL|error/.test(l)) || r.stderr || "").trim();
function q(envFn, sql) {
  const r = psql(envFn, ro(sql));
  if (r.status !== 0) stop(`query failed: ${firstError(r)}`);
  return String(r.stdout).trim();
}

function promptLine(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") stop("run this in an interactive PowerShell window");
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
        else { value += ch; if (!hidden) process.stdout.write(ch); }
      }
    };
    stdin.on("data", onData);
  });
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
const sleep = (s) => spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${s * 1000})`]);

// ---------------------------------------------------------------------------------------------------------------
// SQL used on staging (read only) and on the local copy
// ---------------------------------------------------------------------------------------------------------------
// Every base table in public + migration history + auth.users: exact row counts.
const ALL_COUNTS = `select string_agg(k || '=' || c, ',' order by k) from (
  select table_schema || '.' || table_name as k,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text as c
    from information_schema.tables
   where table_type = 'BASE TABLE'
     and (table_schema in ('public', 'supabase_migrations') or (table_schema = 'auth' and table_name = 'users'))) x`;
// Balances per organization (gram/cash/usd); factory obligation separately (068 may repair it, logged in audit_logs).
const ORG_BALANCES = `select coalesce(string_agg(x.line, E'\\n' order by x.line), '') from (
  select o.id::text || ' cust=' || coalesce((select sum(current_debt_grams)::text || '/' || sum(advance_balance_grams)::text from public.client_gold_accounts a
              join public.customers c on c.id = a.customer_id where c.organization_id = o.id), '-')
      || ' seller=' || coalesce((select sum(seller_owes_manager_g)::text || '/' || sum(current_physical_stock_g)::text from public.seller_gold_accounts s
              join public.employees e on e.id = s.seller_id where e.organization_id = o.id), '-')
      || ' vault=' || coalesce((select sum(manager_cash_amount)::text || '/' || sum(manager_usd_amount)::text from public.manager_vault_account v
              where v.organization_id = o.id), '-') as line
    from public.organizations o) x`;
const FACTORY_OBLIGATION = `select coalesce(sum(current_factory_obligation_g), 0)::text from public.manager_vault_account`;
// Schema signature: functions, columns, policies, triggers, RLS-enabled tables (extension members excluded).
const SIGNATURE_SQL = fs.readFileSync(path.join(REPO, "supabase/release/staging-073/signature.sql"), "utf8")
  .replace(/^\s*--.*$/gm, "").trim().replace(/;\s*$/, "");

const F = {
  rls: path.join(REPO, "supabase/release/staging_rls_isolation_readonly.sql"),
  rlsWrite: path.join(REPO, "supabase/release/staging_rls_write_isolation_LOCAL_COPY_ONLY.sql"),
  postflight: path.join(REPO, `supabase/release/${TO}_postflight_readonly.sql`),
  rollback: path.join(REPO, `supabase/rollback/${V(TO)}_rollback.sql`),
  expectedFrom: path.join(REPO, `supabase/release/staging-073/expected-${FROM}-signature.txt`),
  expectedTo: path.join(REPO, `supabase/release/staging-073/expected-${TO}-signature.txt`),
  postflight073: path.join(REPO, "supabase/release/073_postflight_readonly.sql"),
  postflight074: path.join(REPO, "supabase/release/074_postflight_readonly.sql"),
  postflight075: path.join(REPO, "supabase/release/075_postflight_readonly.sql"),
};
const migDir = path.join(REPO, "supabase/migrations");
const CHAIN = [];
for (let n = Number(FROM) + 1; n <= Number(TO); n++) {
  const num = String(n).padStart(3, "0");
  const name = fs.readdirSync(migDir).find((x) => x.startsWith(`${V(num)}_`));
  CHAIN.push({ num, version: V(num), name: name ? name.replace(/^\d+_/, "").replace(/\.sql$/, "") : null, file: name ? path.join(migDir, name) : null });
}
const MIGRATIONS_UP_TO_FROM = fs.readdirSync(migDir).filter((x) => /^\d{14}_.*\.sql$/.test(x) && x.slice(0, 14) <= V(FROM)).map((x) => x.slice(0, 14));

// One file, one transaction: guard, then each migration + its history row + its postflight checks.
function buildChainSql() {
  const parts = [
    `-- GOLDIA staging release chain ${CHAIN[0].num}..${TO} — generated by scripts/goldia-staging-release.js. Run with --single-transaction.`,
    "set lock_timeout = '10s';",
    "set statement_timeout = '15min';",
    `do $guard$ begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '${V(FROM)}') then
    raise exception 'STOP: migration ${FROM} is not recorded'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version > '${V(FROM)}') then
    raise exception 'STOP: a migration after ${FROM} is already recorded'; end if;
  if to_regprocedure('public.deployment_environment()') is not null then
    raise exception 'STOP: this is a JewelryFlow SaaS demo database, not Goldia staging'; end if;
end $guard$;`,
  ];
  for (const m of CHAIN) {
    parts.push(`\n-- ===== ${m.version}_${m.name} =====`);
    parts.push(`\\echo [chain] ${m.num} ${m.name}`);
    parts.push(fs.readFileSync(m.file, "utf8").replace(/^\uFEFF/, ""));
    parts.push(";");
    parts.push("reset all;\nset lock_timeout = '10s';\nset statement_timeout = '15min';");
    parts.push(`do $hist$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' and column_name = 'name') then
    insert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${m.name}');
  else
    insert into supabase_migrations.schema_migrations (version) values ('${m.version}');
  end if;
end $hist$;`);
    for (const [cname, sql] of checks.POSTFLIGHT_CHECKS[m.num] || []) {
      parts.push(`do $pf$ begin if not coalesce((${sql}), false) then raise exception 'POSTFLIGHT ${m.num} ${cname} FAILED'; end if; end $pf$;`);
    }
  }
  return parts.join("\n") + "\n";
}

function parseCounts(txt) { return Object.fromEntries(String(txt).split(",").filter(Boolean).map((kv) => kv.split("="))); }
function diffCounts(a, b, ignore) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.filter((k) => a[k] !== b[k] && !ignore(k, a[k], b[k])).map((k) => `${k}: ${a[k] ?? "absent"} -> ${b[k] ?? "absent"}`);
}
// Rows a migration may add: new empty tables, the history rows, repair/audit and allocation ledgers.
const COUNT_CHANGE_ALLOWED = (k, before, after) =>
  (before === undefined && after === "0")
  || k === "supabase_migrations.schema_migrations"
  || /^public\.(audit_logs|weight_sale_allocations|company_rate_differences|seller_rate_history)$/.test(k);

function signatureDiff(actualTxt, expectedFile) {
  const actual = new Set(String(actualTxt).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const expected = fs.readFileSync(expectedFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const exp = new Set(expected);
  // H lines are function body hashes: a different body is reported for review, a missing object stops.
  const missing = expected.filter((l) => !actual.has(l) && !l.startsWith("H "));
  const bodies = expected.filter((l) => l.startsWith("H ") && !actual.has(l)).map((l) => l.replace(/ [0-9a-f]{32}$/, ""));
  const extra = [...actual].filter((l) => !exp.has(l) && !l.startsWith("H "));
  return { missing, bodies, extra };
}

function writeParity(name, d) {
  fs.writeFileSync(path.join(outDir, name), [`MISSING (${d.missing.length})`, ...d.missing, "", `FUNCTION BODY DIFFERS FROM REPOSITORY (${d.bodies.length})`,
    ...d.bodies, "", `EXTRA, KEPT AS IS (${d.extra.length})`, ...d.extra, ""].join(os.EOL));
}

// Since 074 no cross-organization exposure is known: after the chain NO leak is tolerated anywhere. (Kept as a list so a future known exception is explicit.)
const KNOWN_PREEXISTING_LEAK_TABLES = [];
function isolationProbe(envFn, file, label) {
  const r = psql(envFn, file, { file: true, tuples: true, timeoutMs: 30 * MIN });
  const text = clean(String(r.stdout || "") + String(r.stderr || ""));
  fs.writeFileSync(path.join(outDir, `${path.basename(file, ".sql")}-${label}.txt`), text);
  const leaks = (text.match(/LEAK\|[^\r\n]*/g) || []).map((l) => l.replace(/\|users=.*$/, "").replace(/^LEAK\|/, ""));
  const summary = (text.match(/RLS_(WRITE_)?ISOLATION\|[^\r\n]*/) || [])[0];
  return { ok: r.status === 0 && !!summary, summary: summary || firstError(r), leaks, text };
}
// kind|table|role keys: after must be a subset of before, and only in the known shared tables.
function judgeLeaks(before, after) {
  const b = new Set(before);
  const introduced = after.filter((k) => !b.has(k));
  const other = after.filter((k) => !KNOWN_PREEXISTING_LEAK_TABLES.includes(k.split("|")[1]));
  const known = after.filter((k) => KNOWN_PREEXISTING_LEAK_TABLES.includes(k.split("|")[1]));
  return { introduced, other, known };
}

// ---------------------------------------------------------------------------------------------------------------
// Connection discovery (no password is sent while probing)
// ---------------------------------------------------------------------------------------------------------------
const REGIONS = ["eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-2", "eu-north-1", "ap-southeast-1",
  "ap-south-1", "ap-northeast-1", "ap-northeast-2", "ap-southeast-2", "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "ca-central-1", "sa-east-1"];
function discoverHost() {
  for (const prefix of ["aws-0", "aws-1"]) {
    for (const region of REGIONS) {
      const host = `${prefix}-${region}.pooler.supabase.com`;
      TARGET.host = host;
      const r = run("psql", ["-X", "-w", "-c", "select 1"], { env: remoteEnv(false), timeoutMs: 30 * 1000 });
      const err = String(r.stderr || "");
      // The right pooler knows the tenant and asks for a password; a wrong region answers "Tenant or user not found".
      if (/no password supplied|password authentication failed/i.test(err)) return host;
    }
  }
  TARGET.host = null;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------
async function main() {
  console.log(`GOLDIA SALES — staging release ${FROM} -> ${TO} (${args.apply ? "APPLY" : "DRY RUN: staging is only read"})\n`);

  // 0. Target guard before anything else
  const joined = [TARGET.host, TARGET.user, args.user, process.env.PGHOST, process.env.PGUSER, process.env.DATABASE_URL].filter(Boolean).join(" ");
  for (const [ref, label] of Object.entries(FORBIDDEN_REFS)) if (joined.includes(ref)) stop(`${label} (${ref}) is never a target of this script`);
  if (REHEARSAL) {
    if (!TARGET.host || !(/^(localhost|127\.0\.0\.1)$/.test(TARGET.host) || TARGET.host.startsWith("/"))) stop("--local-rehearsal only works with a local --host");
  } else if (args.user && args.user !== TARGET.user) {
    stop(`only ${TARGET.user} (Goldia Sales staging) can be used`);
  }

  // 1. Tools + files
  PG = findPgBin();
  if (!PG) stop("PostgreSQL 17 tools not found (install PostgreSQL 17 or pass --pg-bin \"C:\\Program Files\\PostgreSQL\\17\\bin\")");
  const toolVer = run("pg_dump", ["--version"]).stdout.trim();
  const toolMajor = parseInt((toolVer.match(/(\d+)\./) || [])[1], 10);
  for (const m of CHAIN) if (!m.file) stop(`migration ${m.version} not found — run from the 076 release-candidate branch (claude/goldia-sales-staging-audit-qtrq1d)`);
  for (const f of Object.values(F)) if (!fs.existsSync(f)) stop(`missing ${path.relative(REPO, f)}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outRoot = path.resolve(String(args.out || path.join(os.homedir(), "GoldiaBackups")));
  if (outRoot.toLowerCase().startsWith(REPO.toLowerCase())) stop("backup folder must be outside the repository");
  outDir = path.join(outRoot, `goldia-staging-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  resultFile = path.join(outDir, `STAGING-${TO}-RESULT.txt`);
  out(`started: ${new Date().toISOString()}  mode: ${args.apply ? "APPLY" : "DRY RUN"}${REHEARSAL ? " (LOCAL REHEARSAL)" : ""}`);
  out(`[1/10] tools: ${PG.dir} (${toolVer})`);
  const chainFile = path.join(outDir, `chain-${CHAIN[0].num}-${TO}.sql`);
  fs.writeFileSync(chainFile, buildChainSql());
  out(`  chain file: ${path.basename(chainFile)} sha256=${sha256(chainFile).slice(0, 16)} (${CHAIN.length} migrations)`);

  // 2. Connection
  out("[2/10] connection");
  if (!TARGET.host) {
    out(`  finding the session pooler of ${STAGING_REF} (no password sent)...`);
    if (!discoverHost()) stop("staging pooler not found — pass --host from Supabase Dashboard -> Connect -> Session pooler");
  }
  out(`  host=${TARGET.host} port=${TARGET.port} user=${TARGET.user}`);
  password = REHEARSAL ? "" : (process.env.PGPASSWORD || await promptLine(`Supabase DB password for ${TARGET.user} (hidden): `, { hidden: true }));
  const ver = psql(remoteEnv, "select current_setting('server_version_num') || '|' || current_setting('server_version') || '|' || current_user");
  if (ver.status !== 0) stop(`connection failed: ${firstError(ver)}`);
  const [serverNum, serverVersion, currentUser] = ver.stdout.trim().split("|");
  const serverMajor = Math.floor(Number(serverNum) / 10000);
  out(`  server: PostgreSQL ${serverVersion}, user ${currentUser}`);
  if (serverMajor !== 17) stop(`expected PostgreSQL 17 (staging inventory), found ${serverVersion}`);
  if (toolMajor < serverMajor) stop(`pg_dump ${toolMajor} is older than the server (${serverMajor})`);

  // 3. Identity + state gates (read only)
  out("[3/10] identity and state gates (read only)");
  const st = q(remoteEnv, `select
      (to_regprocedure('public.deployment_environment()') is not null)::text,
      (to_regclass('supabase_migrations.schema_migrations') is not null)::text,
      (select count(*) from public.organizations)::text,
      (select count(*) from public.employees)::text,
      (select count(*) from auth.users)::text,
      (select count(*) from public.jewelry_sales)::text`);
  const [jfsMarker, hasHistory, orgs, emps, users, sales] = st.split("|");
  out(`  organizations=${orgs} employees=${emps} auth.users=${users} jewelry_sales=${sales}`);
  if (jfsMarker === "true") stop("deployment_environment() exists — this is a JewelryFlow SaaS demo database, not Goldia staging");
  if (hasHistory !== "true") stop("supabase_migrations.schema_migrations is missing");
  const hist = q(remoteEnv, "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations").split(",").filter(Boolean);
  const histSet = new Set(hist);
  const maxVersion = hist[hist.length - 1];
  const after = hist.filter((v) => v > V(FROM));
  const missing = MIGRATIONS_UP_TO_FROM.filter((v) => !histSet.has(v));
  const foreign = hist.filter((v) => v <= V(FROM) && !MIGRATIONS_UP_TO_FROM.includes(v));
  out(`  history: ${hist.length} rows, latest ${maxVersion}`);
  out(`  repository versions <= ${FROM} not recorded on staging: ${missing.length ? missing.join(", ") : "none"}`);
  out(`  recorded versions unknown to the repository: ${foreign.length ? foreign.join(", ") : "none"}`);
  if (after.length) stop(`versions after ${FROM} already recorded (${after.join(", ")}) — this script only moves ${FROM} -> ${TO}`);
  if (!histSet.has(V(FROM))) stop(`migration ${FROM} is not recorded`);

  // 4. Fresh backup
  out("[4/10] fresh backup (outside the repository)");
  const countsBefore = parseCounts(q(remoteEnv, ALL_COUNTS));
  const schemas = ["public", "auth", "storage", "supabase_migrations"];
  backupPath = path.join(outDir, "staging-full.dump");
  let dumpSchemas = schemas;
  let r = run("pg_dump", ["-w", "-Fc", ...dumpSchemas.flatMap((s) => ["-n", s]), "-f", backupPath], { env: remoteEnv(), timeoutMs: 60 * MIN });
  if (r.status !== 0) {
    fs.writeFileSync(path.join(outDir, "pg_dump-full.err.txt"), clean(r.stderr));
    dumpSchemas = ["public", "supabase_migrations"];
    r = run("pg_dump", ["-w", "-Fc", ...dumpSchemas.flatMap((s) => ["-n", s]), "-f", backupPath], { env: remoteEnv(), timeoutMs: 60 * MIN });
    if (r.status !== 0) stop(`pg_dump failed: ${firstError(r)}`);
    out("  WARNING: auth/storage could not be dumped; public + supabase_migrations only (logins are not in this backup)");
  }
  run("pg_dump", ["-w", "--schema-only", ...dumpSchemas.flatMap((s) => ["-n", s]), "-f", path.join(outDir, "staging-schema.sql")], { env: remoteEnv(), timeoutMs: 30 * MIN });
  const roles = run("pg_dumpall", ["-w", "--roles-only", "--no-role-passwords", "-l", TARGET.db, "-f", path.join(outDir, "staging-roles.sql")], { env: remoteEnv(), timeoutMs: 10 * MIN });
  out(`  schemas: ${dumpSchemas.join(", ")}; roles dump: ${roles.status === 0 ? "ok" : "not permitted (non-critical)"}`);
  const countsAfterDump = parseCounts(q(remoteEnv, ALL_COUNTS));
  const liveChanges = diffCounts(countsBefore, countsAfterDump, () => false);
  if (liveChanges.length) stop(`staging changed during the backup (${liveChanges.slice(0, 5).join("; ")}) — pause staging use and re-run`);
  const sums = fs.readdirSync(outDir).filter((f) => /\.(dump|sql)$/.test(f) && f !== path.basename(chainFile))
    .map((f) => `${sha256(path.join(outDir, f))}  ${f}  ${fs.statSync(path.join(outDir, f)).size} bytes`);
  fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), sums.join(os.EOL) + os.EOL);
  for (const s of sums) out(`  ${s}`);
  const list = run("pg_restore", ["--list", backupPath], { timeoutMs: 10 * MIN });
  if (list.status !== 0 || !/TABLE DATA public /.test(list.stdout)) stop("backup is not readable by pg_restore --list");

  // 5. Restore test
  out("[5/10] restore test into a disposable LOCAL PostgreSQL (staging untouched)");
  const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "goldia-staging-restore-"));
  const dataDir = path.join(restoreDir, "data");
  localPort = await freePort(55500);
  r = run("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"], { timeoutMs: 10 * MIN });
  if (r.status !== 0) stop(`initdb failed: ${firstError(r)}`);
  let localUp = true;
  const stopLocal = () => {
    if (!localUp) return;
    localUp = false;
    run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "-t", "60", "stop"], { noPipes: true, timeoutMs: 2 * MIN });
    if (!args["keep-restore"]) { try { fs.rmSync(restoreDir, { recursive: true, force: true }); } catch { /* temp folder */ } }
  };
  process.on("exit", stopLocal);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => { stopLocal(); process.exit(130); });
  run("pg_ctl", ["-D", dataDir, "-o", `-p ${localPort} -c listen_addresses=localhost -c max_connections=50`, "-l", path.join(restoreDir, "pg.log"), "-w", "-t", "120", "start"], { noPipes: true, timeoutMs: 3 * MIN });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { ready = psql(localEnv, "select 1", { timeoutMs: 15000 }).status === 0; if (!ready) sleep(1); }
  if (!ready) stop("local PostgreSQL did not start");
  psql(localEnv, `do $$ declare r text; begin foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin',
      'supabase_auth_admin','supabase_storage_admin','dashboard_user','pgbouncer'] loop
      if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if; end loop;
      alter role service_role bypassrls; end $$`, { tuples: false });
  const ext = q(remoteEnv, `select coalesce(string_agg(e.extname || ':' || n.nspname, ','), '') from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql'`);
  const extMissing = [];
  for (const pair of ext.split(",").filter(Boolean)) {
    const [name, schema] = pair.split(":");
    if (psql(localEnv, `create schema if not exists "${schema}"; create extension if not exists "${name}" with schema "${schema}"`, { tuples: false }).status !== 0) extMissing.push(name);
  }
  out(`  extensions not available locally (platform only): ${extMissing.length ? extMissing.join(", ") : "none"}`);
  // Grants are restored too (the anon/authenticated contract is part of what the chain changes and checks);
  // grants to platform roles that do not exist locally only produce restore warnings.
  r = run("pg_restore", ["-w", "--no-owner", "-d", "postgres", backupPath], { env: localEnv(), timeoutMs: 60 * MIN });
  fs.writeFileSync(path.join(outDir, "restore-test.log"), clean(r.stderr));
  if (q(localEnv, "select (to_regprocedure('auth.uid()') is not null)::text") !== "true") {
    psql(localEnv, `create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
      create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`, { tuples: false });
    out("  note: auth helper functions recreated locally (auth schema not in backup)");
  }
  const countsLocal = parseCounts(q(localEnv, ALL_COUNTS));
  const restoreDiff = diffCounts(countsBefore, countsLocal, (k) => !dumpSchemas.includes("auth") && k.startsWith("auth."));
  out(`  restored copy vs staging row counts: ${restoreDiff.length ? restoreDiff.join("; ") : "identical"} (${Object.keys(countsLocal).length} tables)`);
  if (restoreDiff.length) stop("restore test failed: restored copy differs from staging");
  out("  BACKUP: VERIFIED");

  // 6. FROM schema parity
  out(`[6/10] schema parity of the restored copy with repository 001..${FROM}`);
  const sig062 = signatureDiff(q(localEnv, SIGNATURE_SQL), F.expectedFrom);
  writeParity(`parity-${FROM}.txt`, sig062);
  out(`  missing objects: ${sig062.missing.length}; different function bodies: ${sig062.bodies.length}; extra objects (kept): ${sig062.extra.length} — parity-${FROM}.txt`);
  for (const l of sig062.missing.slice(0, 10)) out(`    missing at ${FROM}: ${l}`);
  out(`  (information only: the decisive gate is parity with ${TO} after the chain on the local copy)`);

  // 7. Chain on the local copy
  out(`[7/10] ${CHAIN[0].num}..${TO} on the restored LOCAL copy (one transaction)`);
  const readBefore = isolationProbe(localEnv, F.rls, `local-${FROM}`);
  const writeBefore = isolationProbe(localEnv, F.rlsWrite, `local-${FROM}`);
  if (!readBefore.ok || !writeBefore.ok) stop(`isolation probe failed to run on the ${FROM} copy: ${readBefore.ok ? writeBefore.summary : readBefore.summary}`);
  const balBefore = q(localEnv, ORG_BALANCES);
  const factoryBefore = q(localEnv, FACTORY_OBLIGATION);
  const loc = psql(localEnv, chainFile, { file: true, tuples: false, singleTx: true, timeoutMs: 30 * MIN });
  fs.writeFileSync(path.join(outDir, "local-chain.log"), clean(String(loc.stdout || "") + String(loc.stderr || "")));
  if (loc.status !== 0) stop(`chain failed on the local copy: ${firstError(loc)} (local-chain.log)`);
  out("  chain + per-migration postflight checks: PASS");
  const countsLocalAfter = parseCounts(q(localEnv, ALL_COUNTS));
  const localCountChanges = diffCounts(countsLocal, countsLocalAfter, COUNT_CHANGE_ALLOWED);
  const localLedgerChanges = diffCounts(countsLocal, countsLocalAfter, (k, a, b) => !COUNT_CHANGE_ALLOWED(k, a, b) || (a === undefined && b === "0"));
  out(`  business row counts changed: ${localCountChanges.length ? localCountChanges.join("; ") : "none"}`);
  out(`  ledger/history rows added: ${localLedgerChanges.join("; ") || "none"}`);
  const balAfter = q(localEnv, ORG_BALANCES);
  const factoryAfter = q(localEnv, FACTORY_OBLIGATION);
  out(`  per-organization balances (customer/seller/vault): ${balBefore === balAfter ? "unchanged" : "CHANGED"}`);
  out(`  factory obligation total: ${factoryBefore} -> ${factoryAfter}${factoryBefore === factoryAfter ? "" : " (068 repair, see audit_logs REPAIR_FACTORY_COUNTERS)"}`);
  if (localCountChanges.length || balBefore !== balAfter) stop("the chain changed business rows or balances on the local copy");
  const sig073 = signatureDiff(q(localEnv, SIGNATURE_SQL), F.expectedTo);
  writeParity(`parity-${TO}-local.txt`, sig073);
  out(`  schema parity with repository 001..${TO}: missing ${sig073.missing.length}, different function bodies ${sig073.bodies.length}, extra ${sig073.extra.length}`);
  for (const l of sig073.bodies.slice(0, 10)) out(`    REVIEW body differs from repository: ${l}`);
  if (sig073.missing.length) stop(`after the chain the copy lacks ${sig073.missing.length} object(s) of ${TO} (parity-${TO}-local.txt)`);
  const pfLocal = psql(localEnv, checks.allColumnsTrue(F.postflight));
  const pf073Local = psql(localEnv, checks.allColumnsTrue(F.postflight073));
  const pf074Local = psql(localEnv, checks.allColumnsTrue(F.postflight074));
  const pf075Local = psql(localEnv, checks.allColumnsTrue(F.postflight075));
  if (pf075Local.status !== 0 || pf075Local.stdout.trim() !== "t") stop("075 postflight failed on the local copy");
  if (pfLocal.status !== 0 || pfLocal.stdout.trim() !== "t") stop(`${TO} postflight failed on the local copy`);
  if (pf073Local.status !== 0 || pf073Local.stdout.trim() !== "t") stop("073 postflight failed on the local copy");
  if (pf074Local.status !== 0 || pf074Local.stdout.trim() !== "t") stop("074 postflight failed on the local copy");
  out(`  073 + 074 + 075 postflights: all true; ${TO} postflight: all true`);
  const readAfter = isolationProbe(localEnv, F.rls, `local-${TO}`);
  const writeAfter = isolationProbe(localEnv, F.rlsWrite, `local-${TO}`);
  if (!readAfter.ok || !writeAfter.ok) stop(`isolation probe failed to run: ${readAfter.ok ? writeAfter.summary : readAfter.summary}`);
  out(`  RLS read  (every login x every organization + anon): ${FROM} ${readBefore.summary} -> ${TO} ${readAfter.summary}`);
  out(`  RLS write (update/delete other organizations' rows, rolled back): ${FROM} ${writeBefore.summary} -> ${TO} ${writeAfter.summary}`);
  const jr = judgeLeaks(readBefore.leaks, readAfter.leaks);
  const jw = judgeLeaks(writeBefore.leaks, writeAfter.leaks);
  for (const k of readBefore.leaks.filter((x) => !readAfter.leaks.includes(x))) out(`    closed by the chain: read ${k}`);
  for (const k of writeBefore.leaks.filter((x) => !writeAfter.leaks.includes(x))) out(`    closed by the chain: write ${k}`);
  for (const k of [...jr.known.map((x) => `read ${x}`), ...jw.known.map((x) => `write ${x}`)]) out(`    KNOWN PRE-EXISTING: ${k}`);
  if (jr.introduced.length || jw.introduced.length) stop(`the chain INTRODUCES cross-organization access: ${[...jr.introduced, ...jw.introduced].join(", ")}`);
  if (jr.other.length || jw.other.length) stop(`cross-organization access remains after ${TO}: ${[...jr.other, ...jw.other].join(", ")}`);
  knownLeaksAfter = readAfter.leaks;
  const rb = psql(localEnv, F.rollback, { file: true, tuples: false, singleTx: true });
  const re = psql(localEnv, path.join(migDir, path.basename(CHAIN[CHAIN.length - 1].file)), { file: true, tuples: false, singleTx: true });
  const pfAgain = psql(localEnv, checks.allColumnsTrue(F.postflight));
  out(`  ${TO} rollback + re-apply on the copy: ${rb.status === 0 && re.status === 0 && pfAgain.stdout.trim() === "t" ? "ok" : "FAILED"}`);
  if (!(rb.status === 0 && re.status === 0 && pfAgain.stdout.trim() === "t")) stop(`${TO} rollback / re-apply failed on the local copy`);
  stopLocal();
  out("  LOCAL COPY: PASS");

  // 8. Dry run ends here
  if (!args.apply) {
    out("[8/10] DRY RUN PASS — staging was only read. To apply, run the same command with --apply.");
    out(`\nRESULT: DRY RUN PASS. Report: ${resultFile}`);
    return;
  }

  // 9. Apply
  out("[9/10] apply to staging");
  const countsNow = parseCounts(q(remoteEnv, ALL_COUNTS));
  const sinceBackup = diffCounts(countsBefore, countsNow, () => false);
  if (sinceBackup.length) stop(`staging changed since the backup (${sinceBackup.slice(0, 5).join("; ")}) — re-run so the backup is current`);
  const typed = REHEARSAL && args.yes ? STAGING_REF : await promptLine(`Type the staging project ref (${STAGING_REF}) to apply ${CHAIN[0].num}..${TO}: `);
  if (typed.trim() !== STAGING_REF) stop("confirmation did not match");
  const balStgBefore = q(remoteEnv, ORG_BALANCES);
  const mig = psql(remoteEnv, chainFile, { file: true, tuples: false, singleTx: true, timeoutMs: 30 * MIN });
  fs.writeFileSync(path.join(outDir, "staging-chain.log"), clean(String(mig.stdout || "") + String(mig.stderr || "")));
  if (mig.status !== 0) stop(`migration transaction failed and was rolled back by PostgreSQL: ${firstError(mig)}`);
  stagingWritten = true;
  out(`  ${CHAIN[0].num}..${TO} applied and recorded in one transaction`);

  // 10. Postflight on staging (read only)
  out("[10/10] postflight on staging (read only)");
  const recorded = q(remoteEnv, `select count(*) from supabase_migrations.schema_migrations where version in (${CHAIN.map((m) => `'${m.version}'`).join(",")})`);
  out(`  history rows ${CHAIN[0].num}..${TO}: ${recorded}/${CHAIN.length}`);
  const pf = psql(remoteEnv, checks.allColumnsTrue(F.postflight));
  const pfFile = psql(remoteEnv, F.postflight, { file: true, tuples: false });
  fs.writeFileSync(path.join(outDir, `postflight-${TO}-staging.txt`), clean(String(pfFile.stdout || "") + String(pfFile.stderr || "")));
  const pf073 = psql(remoteEnv, checks.allColumnsTrue(F.postflight073));
  const pf074 = psql(remoteEnv, checks.allColumnsTrue(F.postflight074));
  const pf075 = psql(remoteEnv, checks.allColumnsTrue(F.postflight075));
  pf.stdout = pf.stdout.trim() === "t" && pf073.stdout.trim() === "t" && pf074.stdout.trim() === "t" && pf075.stdout.trim() === "t" ? "t" : "f";
  out(`  073 + 074 + 075 + ${TO} postflight: ${pf.stdout === "t" ? "all true" : "FAIL"}`);
  const sigStg = signatureDiff(q(remoteEnv, SIGNATURE_SQL), F.expectedTo);
  writeParity(`parity-${TO}-staging.txt`, sigStg);
  out(`  schema parity with repository 001..${TO}: missing ${sigStg.missing.length}, different function bodies ${sigStg.bodies.length}, extra ${sigStg.extra.length}`);
  const rlsStg = isolationProbe(remoteEnv, F.rls, `staging-${TO}`);
  const stgUnexpected = rlsStg.leaks.filter((k) => !knownLeaksAfter.includes(k) || !KNOWN_PREEXISTING_LEAK_TABLES.includes(k.split("|")[1]));
  out(`  RLS read isolation: ${rlsStg.summary}${stgUnexpected.length ? " — UNEXPECTED: " + stgUnexpected.join(", ") : ""}`);
  rlsStg.ok = rlsStg.ok && stgUnexpected.length === 0;
  const countsStgAfter = parseCounts(q(remoteEnv, ALL_COUNTS));
  const stgChanges = diffCounts(countsNow, countsStgAfter, COUNT_CHANGE_ALLOWED);
  const balStgAfter = q(remoteEnv, ORG_BALANCES);
  out(`  business row counts changed: ${stgChanges.length ? stgChanges.join("; ") : "none"}`);
  out(`  per-organization balances: ${balStgBefore === balStgAfter ? "unchanged" : "CHANGED"}`);
  const pass = recorded === String(CHAIN.length) && pf.stdout.trim() === "t" && !sigStg.missing.length && rlsStg.ok && !stgChanges.length && balStgBefore === balStgAfter;
  if (!pass) stop("POSTFLIGHT FAILED on staging");
  out("  POSTFLIGHT: PASS");
  out(`\nRESULT: STAGING ${FROM} -> ${TO} APPLIED, POSTFLIGHT PASS. Next: deploy the release-candidate frontend to staging (docs/releases/staging-075/README.md). Report: ${resultFile}`);
}

main().catch((e) => stop(e && e.message ? clean(e.message) : String(e)));
