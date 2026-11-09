"use strict";
// Shared by scripts/goldia-prod-release.js (--chain-to) and scripts/goldia-prod-backup-and-preflight.js (--chain-to):
// ONE SQL file that applies migrations FROM+1 .. TO in a single transaction. Before the first migration the business
// fingerprint (supabase/release/business_fingerprint.sql) is stored in a temp table; after EVERY migration
//   * its history row is inserted,
//   * every postflight check of that migration (scripts/lib/goldia-release-checks.js) must be true,
//   * the business fingerprint (balances, debts, stock, tills, vault, customers, sales / payment / cash / legacy history,
//     row counts of all pre-existing tables) must be identical to the snapshot.
// Any failure raises an exception -> psql --single-transaction -v ON_ERROR_STOP=1 rolls the WHOLE chain back.
const fs = require("fs");
const path = require("path");
const checks = require("./goldia-release-checks");

const REPO = path.resolve(__dirname, "..", "..");
const V = (n) => `20260101000${String(n).padStart(3, "0")}`;

// psql output lines, CR-safe: psql.exe on Windows ends lines with CRLF; a plain split("\n") leaves "\r" on every line
// except the last, so the SAME data looked different whenever the line order changed (production chain gate,
// 2026-11-06). Trailing whitespace / CR is removed, empty lines dropped.
function outputLines(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
}

// Business fingerprint comparison by VALUE per category ("category|rows|md5"), independent of line order and line
// endings. Returns every category of the reference whose row count or hash differs, that is missing afterwards, or that
// is duplicated. Categories that only exist afterwards (tables created by a migration) have no reference row.
function fingerprintDiff(beforeText, afterText) {
  const parse = (t) => {
    const m = new Map(); const dup = [];
    for (const l of outputLines(t)) {
      const parts = l.split("|"); const cat = parts[0];
      if (m.has(cat)) dup.push(cat);
      m.set(cat, { n: parts[1] === undefined ? "" : parts[1], h: parts[2] === undefined ? "" : parts[2] });
    }
    return { m, dup };
  };
  const b = parse(beforeText); const a = parse(afterText); const diff = [];
  if (b.m.size === 0) diff.push({ category: "(no reference fingerprint)", before: null, after: null });
  for (const cat of [...b.dup, ...a.dup]) diff.push({ category: cat, before: "duplicate category", after: "duplicate category" });
  for (const [cat, x] of b.m) {
    const y = a.m.get(cat);
    if (!y || y.n !== x.n || y.h !== x.h) diff.push({ category: cat, before: x, after: y || null });
  }
  return diff;
}

// SQL text with Windows line endings normalized to LF (and no BOM), so function bodies stored by the chain / a rollback
// are byte-identical to the repository whatever the checkout (core.autocrlf) of the machine that runs the release.
function lfText(file) { return fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n"); }
function lfCopy(file, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, path.basename(file));
  fs.writeFileSync(out, lfText(file));
  return out;
}

function chainList(from, to) {
  const dir = path.join(REPO, "supabase/migrations");
  const list = [];
  for (let n = Number(from) + 1; n <= Number(to); n++) {
    const num = String(n).padStart(3, "0");
    const file = fs.readdirSync(dir).find((x) => x.startsWith(`${V(num)}_`));
    if (!file) throw new Error(`migration ${num} not found`);
    list.push({ num, version: V(num), name: file.replace(/^\d+_/, "").replace(/\.sql$/, ""), file: path.join(dir, file) });
  }
  return list;
}

function fingerprintSql() {
  return fs.readFileSync(path.join(REPO, "supabase/release/business_fingerprint.sql"), "utf8")
    .split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join("\n").trim().replace(/;\s*$/, "");
}

// Gate SQL comparing the live fingerprint with _goldia_fp0 (only categories present in the snapshot).
function fingerprintGate(label) {
  return `do $fp$ declare d text; begin
  select string_agg(b.category || ' ' || coalesce(a.n::text, 'missing') || '/' || b.n || case when a.h is distinct from b.h then ' hash' else '' end, '; ')
    into d
    from _goldia_fp0 b left join (${fingerprintSql()}) a on a.category = b.category
   where a.n is distinct from b.n or a.h is distinct from b.h;
  if d is not null then raise exception 'BUSINESS DATA CHANGED after ${label}: %', d; end if;
end $fp$;`;
}

// History row insert that works with and without the optional `name` column of supabase_migrations.schema_migrations.
function historyInsert(version, name, tag = "hist") {
  return `do $${tag}$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' and column_name = 'name') then
    insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');
  else
    insert into supabase_migrations.schema_migrations (version) values ('${version}');
  end if;
end $${tag}$;`;
}

// Contiguity gate (inside the chain transaction): every repository version <= FROM must be recorded and no recorded
// version <= FROM may be unknown to the repository. repairHistory (owner flag, staging only, objects verified by the
// caller) inserts exactly the listed unrecorded versions first; a listed version that IS recorded stops the chain.
function historyGate(from, repairHistory = []) {
  const repo = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((x) => /^\d{14}_.*\.sql$/.test(x)).sort();
  const upTo = repo.filter((x) => x.slice(0, 14) <= V(from));
  const parts = [];
  for (const n of repairHistory) {
    const file = upTo.find((x) => x.startsWith(`${V(n)}_`));
    if (!file) throw new Error(`repair-history ${n}: no repository migration <= ${from}`);
    const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
    parts.push(`\\echo [chain] history repair ${n} ${name} (owner flag --repair-history; objects verified before the chain)`);
    parts.push(`do $rep$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '${V(n)}') then
    raise exception 'STOP: --repair-history ${n} but ${V(n)} is already recorded'; end if; end $rep$;`);
    parts.push(historyInsert(V(n), name, "rephist"));
  }
  const arr = `array[${upTo.map((x) => `'${x.slice(0, 14)}'`).join(",")}]::text[]`;
  parts.push(`do $gap$ declare v_missing text; v_foreign text; begin
  select string_agg(v, ',' order by v) into v_missing from unnest(${arr}) v
   where not exists (select 1 from supabase_migrations.schema_migrations h where h.version = v);
  if v_missing is not null then raise exception 'STOP: VERSION GAP - repository migrations not recorded: %', v_missing; end if;
  select string_agg(version, ',' order by version) into v_foreign from supabase_migrations.schema_migrations
   where version <= '${V(from)}' and version <> all (${arr});
  if v_foreign is not null then raise exception 'STOP: recorded versions unknown to the repository: %', v_foreign; end if;
end $gap$;`);
  return parts.join("\n");
}

function buildChainSql(from, to, { label = "production", repairHistory = [] } = {}) {
  const chain = chainList(from, to);
  if (repairHistory.length && label === "production") throw new Error("history repair is never done on production");
  const parts = [
    `-- GOLDIA ${label} release chain ${chain[0].num}..${to} - generated by scripts/lib/goldia-chain.js. Run with psql --single-transaction -v ON_ERROR_STOP=1.`,
    "set lock_timeout = '10s';",
    "set statement_timeout = '15min';",
    `do $guard$ begin
  if to_regprocedure('public.deployment_environment()') is not null then
    raise exception 'STOP: this is a JewelryFlow SaaS demo database, not Goldia'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '${V(from)}') then
    raise exception 'STOP: migration ${from} is not recorded'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version > '${V(from)}') then
    raise exception 'STOP: a migration after ${from} is already recorded'; end if;
end $guard$;`,
    historyGate(from, repairHistory),
    `create temp table _goldia_fp0 on commit drop as ${fingerprintSql()};`,
  ];
  for (const m of chain) {
    parts.push(`\n-- ===== ${m.version}_${m.name} =====`);
    parts.push(`\\echo [chain] ${m.num} ${m.name}`);
    parts.push(lfText(m.file));
    parts.push(";");
    parts.push("reset all;\nset lock_timeout = '10s';\nset statement_timeout = '15min';");
    parts.push(historyInsert(m.version, m.name));
    const pf = checks.POSTFLIGHT_CHECKS[m.num];
    if (!pf || !pf.length) throw new Error(`no postflight checks for ${m.num}`);
    for (const [cname, sql] of pf) {
      parts.push(`do $pf$ begin if not coalesce((${sql}), false) then raise exception 'POSTFLIGHT ${m.num} ${cname} FAILED'; end if; end $pf$;`);
    }
    parts.push(fingerprintGate(m.num));
    parts.push(`\\echo [chain] ${m.num} postflight + business fingerprint: ok`);
  }
  return { sql: parts.join("\n") + "\n", chain };
}

module.exports = { V, chainList, buildChainSql, historyGate, historyInsert, fingerprintSql, fingerprintGate, outputLines, fingerprintDiff, lfText, lfCopy };
