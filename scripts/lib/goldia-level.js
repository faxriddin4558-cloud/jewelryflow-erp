"use strict";
// Real database level detection, shared by scripts/goldia-staging-release.js, scripts/goldia-prod-release.js (--auto) and
// scripts/goldia-detect-level.js. The level is NEVER assumed: it is read from supabase_migrations.schema_migrations and
// compared with the migration files of this checkout.
//
//   latest   = the newest recorded version
//   gaps     = repository versions older than `latest` that are NOT recorded          -> STOP (version gap)
//   foreign  = recorded versions that have no file in this checkout                    -> STOP (unknown history)
//   chain    = every repository migration after `latest`, in order, up to the newest file
//
// A gap can only be passed with an explicit owner flag that names EXACTLY the missing versions (repairHistory), and only
// where the caller has verified that the objects of those migrations exist (staging: schema + CR-tolerant function
// parity of the restored copy with repository 001..latest). The repaired history rows are then inserted in the SAME
// transaction as the chain (scripts/lib/goldia-chain.js). Production never repairs: a gap there is always STOP.
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const MIG_DIR = path.join(REPO, "supabase/migrations");
const num3 = (v) => String(v).slice(-3);

function repoMigrations(dir = MIG_DIR) {
  return fs.readdirSync(dir).filter((x) => /^\d{14}_.*\.sql$/.test(x)).sort()
    .map((x) => ({ version: x.slice(0, 14), num: num3(x.slice(0, 14)), name: x.replace(/^\d+_/, "").replace(/\.sql$/, ""), file: path.join(dir, x) }));
}

// "057,058" | ["57", "058"] -> ["057", "058"] (sorted, unique)
function parseNums(list) {
  if (!list || list === true) return [];
  const arr = Array.isArray(list) ? list : String(list).split(/[\s,;]+/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean).map((s) => {
    if (!/^\d{1,3}$|^\d{14}$/.test(s)) throw new Error(`not a migration number: ${s}`);
    return num3(s.padStart(3, "0"));
  }))].sort();
}

/**
 * @param {string[]} history recorded versions (any order)
 * @param {{ repairHistory?: string[]|string, repo?: object[] }} opts
 * @returns {{ ok: boolean, stops: string[], latest: string|null, latestNum: string|null, newestNum: string, gaps: string[],
 *            foreign: string[], repair: string[], chain: object[], upToDate: boolean, report: string[] }}
 */
function analyze(history, opts = {}) {
  const repo = opts.repo || repoMigrations();
  const repoSet = new Set(repo.map((m) => m.version));
  const hist = [...new Set((history || []).map((v) => String(v).trim()).filter(Boolean))].sort();
  const histSet = new Set(hist);
  const stops = [];
  const repair = parseNums(opts.repairHistory);
  const newest = repo[repo.length - 1];
  const latest = hist.length ? hist[hist.length - 1] : null;
  const foreign = hist.filter((v) => !repoSet.has(v));
  const gaps = latest ? repo.filter((m) => m.version < latest && !histSet.has(m.version)).map((m) => m.num) : [];
  if (!hist.length) stops.push("migration history is empty - the database level cannot be determined");
  if (foreign.length) stops.push(`recorded versions unknown to this checkout: ${foreign.join(", ")} (wrong branch, or history written outside the repository)`);
  if (latest && newest && latest > newest.version) stops.push(`the database (${latest}) is NEWER than this checkout (${newest.version}) - wrong branch`);
  if (gaps.length) {
    if (!repair.length) {
      stops.push(`VERSION GAP: repository migrations older than the recorded level ${num3(latest)} are not recorded: ${gaps.join(", ")}`);
    } else if (repair.join(",") !== gaps.join(",")) {
      stops.push(`--repair-history ${repair.join(",")} does not name exactly the unrecorded versions (${gaps.join(",")})`);
    }
  } else if (repair.length) {
    stops.push(`--repair-history ${repair.join(",")} given, but there is no gap in the history`);
  }
  const chain = latest ? repo.filter((m) => m.version > latest) : [];
  // the chain must be contiguous in the repository numbering as well (a missing FILE is a gap too)
  if (latest) {
    for (let n = Number(num3(latest)) + 1, i = 0; i < chain.length; n++, i++) {
      if (chain[i].num !== String(n).padStart(3, "0")) { stops.push(`repository numbering gap: expected migration ${String(n).padStart(3, "0")}, found ${chain[i].num}`); break; }
    }
  }
  const upToDate = !!latest && !!newest && latest === newest.version;
  const report = [
    `history: ${hist.length} rows, latest ${latest || "-"} (level ${latest ? num3(latest) : "-"})`,
    `repository: ${repo.length} migration files, newest ${newest ? newest.num : "-"}`,
    `unrecorded repository versions below the level (gaps): ${gaps.length ? gaps.join(", ") : "none"}`,
    `recorded versions unknown to this checkout: ${foreign.length ? foreign.join(", ") : "none"}`,
    `history repair requested: ${repair.length ? repair.join(", ") : "none"}`,
    `migrations to apply: ${chain.length ? chain.map((m) => m.num).join(" -> ") : "none (up to date)"}`,
  ];
  return { ok: stops.length === 0, stops, latest, latestNum: latest ? num3(latest) : null, newestNum: newest ? newest.num : null,
    gaps, foreign, repair, chain, upToDate, report };
}

// psql -t -A output of HISTORY_SQL -> versions
const HISTORY_SQL = "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations";
function parseHistory(text) { return String(text || "").trim().split(",").map((s) => s.trim()).filter(Boolean); }

module.exports = { REPO, repoMigrations, parseNums, analyze, HISTORY_SQL, parseHistory };
