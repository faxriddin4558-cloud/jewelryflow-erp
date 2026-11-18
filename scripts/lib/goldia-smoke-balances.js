// GOLDIA SALES - smoke balance check (B3): the director's balances read through the API compared with the database
// balances of the SAME moment (2026-11-18). Pure functions; no I/O, nothing written anywhere.
//
// The database lines come from 01_baseline_readonly.sql run read-only RIGHT BEFORE and RIGHT AFTER the browser smoke
// ("before" / "after"). An old baseline (opening day, release day) is NOT the current state once real sales run, so it
// is never used as the expected value here.
//
//   database quiet during the run (business fingerprint before = after): every API value must equal the database
//     value -> otherwise FAIL (the API shows a different number than the database at that moment: a real error)
//   database moved during the run (live sales / payments): an API value equal to "before" or "after", or between them,
//     is the natural result of the live activity (PASS); any other value is REVIEW (cannot be decided - rerun the smoke)
"use strict";

const KEYS = ["debt_g", "adv_g", "sel_stock_g", "sel_owes_g", "till_uzs", "till_usd", "mgr_stock_g", "mgr_uzs", "mgr_usd", "fac_obl_g"];
const epsFor = (k) => (k.endsWith("_g") ? 0.00005 : 0.005);

/** BASELINE lines of run-readonly-checks ("BASELINE | k | v") or the backup kit ("BASELINE|k|v") -> { k: v } */
function parseBaseline(text) {
  const m = {};
  for (const l of String(text).split(/\r?\n/)) {
    const t = l.trim().replace(/\s*\|\s*/g, "|");
    const x = /^BASELINE\|([^|]+)\|(.*)$/.exec(t);
    if (x) m[x[1]] = x[2];
  }
  return m;
}

/** the organization line "debt_g=.. adv_g=.." of a parsed baseline -> { k: Number } (null when absent) */
function orgValues(base, org) {
  const line = base["org " + org];
  if (line === undefined) return null;
  const v = {};
  for (const kv of line.split(" ")) { const i = kv.indexOf("="); if (i > 0) v[kv.slice(0, i)] = Number(kv.slice(i + 1)); }
  return v;
}

/**
 * api: { key: number } of the director's organization; before / after: parsed baselines (after may be null: legacy
 * single-file mode, then the database is treated as quiet only if the caller says so - see compareLegacy).
 * Returns { state: PASS|REVIEW|FAIL, quiet, detail, rows: [{ key, api, before, after, verdict }] }
 */
function compareLive(api, before, after, org) {
  const b = orgValues(before, org), a = orgValues(after, org);
  if (!b || !a) return { state: "FAIL", quiet: null, detail: "organization line missing in the " + (!b ? "before" : "after") + " snapshot", rows: [] };
  const fpB = before["fingerprint business"], fpA = after["fingerprint business"];
  if (!fpB || !fpA) return { state: "FAIL", quiet: null, detail: "business fingerprint missing in a snapshot (incomplete baseline)", rows: [] };
  if (before["history latest"] !== after["history latest"]) return { state: "FAIL", quiet: null, detail: `migration history changed during the smoke (${before["history latest"]} -> ${after["history latest"]})`, rows: [] };
  const quiet = fpB === fpA;
  const rows = [];
  for (const k of KEYS) {
    if (b[k] === undefined || a[k] === undefined || api[k] === undefined) continue;
    const e = epsFor(k), x = Number(api[k]);
    const lo = Math.min(b[k], a[k]) - e, hi = Math.max(b[k], a[k]) + e;
    let verdict;
    if (quiet) verdict = Math.abs(x - b[k]) <= e ? "equal" : "MISMATCH";
    else if (Math.abs(x - b[k]) <= e && Math.abs(b[k] - a[k]) <= e) verdict = "equal";
    else if (x >= lo && x <= hi) verdict = "moved-live";
    else verdict = "UNDECIDED";
    rows.push({ key: k, api: x, before: b[k], after: a[k], verdict });
  }
  if (!rows.length) return { state: "FAIL", quiet, detail: "no balance key could be compared", rows };
  const bad = rows.filter((r) => r.verdict === "MISMATCH"), und = rows.filter((r) => r.verdict === "UNDECIDED"), mv = rows.filter((r) => r.verdict === "moved-live");
  const fmt = (r) => `${r.key}: api=${r.api.toFixed(4)} db_before=${r.before} db_after=${r.after}`;
  const state = bad.length ? "FAIL" : und.length ? "REVIEW" : "PASS";
  const detail = bad.length ? "API differs from the database while the database did not change: " + bad.map(fmt).join("; ")
    : und.length ? "database moved during the run (live activity) and these API values are outside before..after - rerun the smoke: " + und.map(fmt).join("; ")
    : quiet ? `all ${rows.length} equal to the database (no activity during the run)`
    : `${rows.length - mv.length} equal, ${mv.length} moved by live activity during the run and the API value is within the database before..after (${mv.map((r) => r.key).join(", ")})`;
  return { state, quiet, detail, rows };
}

module.exports = { KEYS, parseBaseline, orgValues, compareLive };
