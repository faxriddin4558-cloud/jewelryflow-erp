// GOLDIA SALES - business comparison of two moments of production (2026-11-19). Pure functions, no I/O.
//
// A backup is a consistent snapshot of ONE moment (pg_dump). The release may only use it when production did not
// change in BUSINESS data around it: before the dump = after the dump = the restored copy, and still the same right
// before the migration. Log tables that grow on every login / request (login audit, audit trail, idempotency keys,
// the lazily created factory settings row) are listed separately - the same non-business list as production-post -
// and never decide; every other row count and every balance line must be identical. Nothing is hidden: all
// differences are returned.
"use strict";

const NON_BUSINESS_TABLES = ["audit_logs", "idempotency_keys", "sales_login_audit_logs", "organization_factory_settings"];
const isNonBusinessCount = (k) => NON_BUSINESS_TABLES.some((t) => k === `public.${t}`);
// baseline keys (01_baseline_readonly.sql): "history ..." is the migration history; "rows <table>"; the business
// fingerprint is an md5 over keys that include the log tables, so it is replaced by the per-key comparison
const isNonBusinessBaselineKey = (k) => k.startsWith("history ") || k === "fingerprint business" || NON_BUSINESS_TABLES.some((t) => k === `rows ${t}`);

/** "BASELINE|k|v" (or "BASELINE | k | v") lines -> { k: v } */
function parseBaseline(text) {
  const m = {};
  for (const l of String(text || "").split(/\r?\n/)) {
    const x = /^BASELINE\|([^|]+)\|(.*)$/.exec(l.trim().replace(/\s*\|\s*/g, "|"));
    if (x) m[x[1]] = x[2];
  }
  return m;
}

/** differences of two key -> value maps split into business / non-business by `isNonBusiness` */
function split(a, b, isNonBusiness) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
  const business = [], other = [];
  for (const k of keys) {
    const va = a && k in a ? a[k] : "missing", vb = b && k in b ? b[k] : "missing";
    if (String(va) === String(vb)) continue;
    (isNonBusiness(k) ? other : business).push(`${k}: ${va} -> ${vb}`);
  }
  return { business, other };
}

const countsDiff = (a, b) => split(a, b, isNonBusinessCount);
const baselineDiff = (textA, textB) => split(parseBaseline(textA), parseBaseline(textB), isNonBusinessBaselineKey);

module.exports = { NON_BUSINESS_TABLES, parseBaseline, countsDiff, baselineDiff };
