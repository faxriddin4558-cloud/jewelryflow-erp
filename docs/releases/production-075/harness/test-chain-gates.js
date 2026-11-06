// LOCAL ONLY: proves the gates of the 076 -> 077 -> 078 -> 079 production chain on a disposable PostgreSQL copy
// (127.0.0.1 only; refuses anything else). Starts from a copy at 079 (or 076) and checks:
//   G1 emergency rollbacks 079 -> 078 -> 077 bring the copy back to EXACTLY 076: schema signature and business
//      fingerprint identical to the 076 state, history row 076 latest
//   G2 a chain whose 078 step changes ONE customer balance by 0.0001 g is stopped by the fingerprint gate and NOTHING
//      stays applied (history still 076, schema signature still 076)
//   G3 a chain whose 079 postflight fails (guard trigger disabled inside the step) is stopped, nothing stays applied
//   G4 the clean chain applies; 073..079 postflights true; fingerprint identical; schema = expected 079 signature
//   G5 running the chain again on 079 is refused by its guard (no double apply)
// Usage: node docs/releases/production-075/harness/test-chain-gates.js [--port 55437] [--out <file>]
"use strict";
const fs = require("fs"); const path = require("path"); const { spawnSync } = require("child_process");
const REPO = path.resolve(__dirname, "../../../..");
const chainLib = require(path.join(REPO, "scripts/lib/goldia-chain.js"));
const checks = require(path.join(REPO, "scripts/lib/goldia-release-checks.js"));
const args = {}; for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args[process.argv[i].slice(2)] = process.argv[i + 1];
const PORT = String(args.port || 55437);
const TO = String(args.to || "079").padStart(3, "0");   // last migration of the chain (079, or 080 with the report fix)
const OUT = args.out || path.join(REPO, "docs/audits/goldia-077/evidence/release-rehearsal/chain-gates-test.json");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "goldia-chain-"));
const R = [];
const T = (id, title, ok, act) => { R.push({ id, title, ok: !!ok, actual: act }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${title} | ${JSON.stringify(act).slice(0, 260)}`); };
function psql(sqlOrFile, { file = false, single = false } = {}) {
  const a = ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  if (single) a.push("--single-transaction");
  a.push(file ? "-f" : "-c", sqlOrFile);
  const r = spawnSync("psql", a, { encoding: "utf8", maxBuffer: 1 << 28 });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").split("\n").filter((l) => /ERROR/.test(l)).join(" ").slice(0, 300) };
}
const SIG = fs.readFileSync(path.join(REPO, "supabase/release/staging-073/signature.sql"), "utf8").replace(/^\s*--.*$/gm, "").trim().replace(/;\s*$/, "");
const sig = () => psql(SIG).out;
const fp = () => psql(chainLib.fingerprintSql()).out;
// compare only the categories of the reference state (tables created by 077 / 078 have no reference row) - same rule as the gate
const fpSame = (ref, now) => { const m = new Map(now.split("\n").map((l) => [l.split("|")[0], l])); return ref.split("\n").every((l) => m.get(l.split("|")[0]) === l); };
// the 077 rollback keeps these on purpose (reclassification history; dropping them would lose it) - documented exception
const KEPT_BY_ROLLBACK_077 = ["C financial_transactions.reclassified_at timestamp with time zone", "C financial_transactions.reclassified_from_amount numeric(18,2)",
  "C financial_transactions.reclassified_from_currency text", "C financial_transactions.reclassified_from_till text"];
const latest = () => psql("select max(version) from supabase_migrations.schema_migrations").out;
const pfAll = (vs) => vs.every((v) => psql(checks.allColumnsTrue(path.join(REPO, `supabase/release/${v}_postflight_readonly.sql`))).out === "t");
const PFS = []; for (let n = 73; n <= Number(TO); n++) PFS.push(String(n).padStart(3, "0"));
const writeChain = (name, mutate) => { let { sql } = chainLib.buildChainSql("076", TO, { label: "gate-test" }); if (mutate) sql = mutate(sql); const f = path.join(TMP, name); fs.writeFileSync(f, sql); return f; };

(async () => {
  // bring the copy to 076 with the emergency rollbacks (newest first)
  const start = latest();
  if (!/^202601010000(76|77|78|79|80)$/.test(start)) throw new Error(`unexpected latest ${start}`);
  if (start !== "20260101000076") {
    // fingerprint at 079 equals the one at 076 (the chain changes no business data) -> compare after rollback
    const fpTop = fp(); const rb = [];
    for (const v of ["080", "079", "078", "077"]) {
      if (latest() < chainLib.V(v)) continue;
      const r = psql(path.join(REPO, `docs/releases/production-075/emergency/rollback_${v}_with_history.sql`), { file: true, single: true }); rb.push(`${v}:${r.ok ? "ok" : r.err}`);
    }
    const exp076 = fs.readFileSync(path.join(REPO, "supabase/release/staging-073/expected-076-signature.txt"), "utf8").trim();
    const s = sig();
    const missing = exp076.split("\n").filter((l) => !s.includes(l)); const extra = s.split("\n").filter((l) => !exp076.includes(l));
    const unexpected = extra.filter((l) => !KEPT_BY_ROLLBACK_077.includes(l));
    T("G1", "emergency rollbacks (newest first) back to 076: history 076, schema = expected 076 signature (+ only the 4 reclassification-history columns 077 keeps on purpose), business fingerprint unchanged",
      rb.every((x) => x.endsWith(":ok")) && latest() === "20260101000076" && !missing.length && !unexpected.length && fpSame(fp(), fpTop),
      { rollbacks: rb, latest: latest(), missing: missing.slice(0, 5), kept_columns: extra.length - unexpected.length, unexpected: unexpected.slice(0, 5), fingerprint_same: fpSame(fp(), fpTop) });
  }
  const sig076 = sig(); const fp076 = fp();
  // G2 tampered balance inside the 078 step
  const fTamper = writeChain("chain-tamper.sql", (sql) => sql.replace("\\echo [chain] 078 postflight + business fingerprint: ok",
    "select 1;").replace(/(-- ===== 20260101000078_[^\n]*\n)/, "$1update public.client_gold_accounts set current_debt_grams = current_debt_grams + 0.0001 where customer_id = (select customer_id from public.client_gold_accounts order by customer_id limit 1);\n"));
  const g2 = psql(fTamper, { file: true, single: true });
  T("G2", "a 0.0001 g balance change inside the chain is stopped by the fingerprint gate; nothing stays applied", !g2.ok && /BUSINESS DATA CHANGED after 078/.test(g2.err) && latest() === "20260101000076" && sig() === sig076 && fpSame(fp076, fp()),
    { error: g2.err, latest: latest(), schema_same: sig() === sig076, data_same: fpSame(fp076, fp()) });
  // G3 failing postflight in 079
  const fPf = writeChain("chain-postflight.sql", (sql) => sql.replace(/(-- ===== 20260101000079_[^\n]*\n)/, "$1").replace(
    /(insert into supabase_migrations\.schema_migrations \(version, name\) values \('20260101000079'[^\n]*\n)/, "$1    execute 'alter table public.jewelry_sales disable trigger trg_goldia_guard_sale_archived_customer';\n"));
  const g3 = psql(fPf, { file: true, single: true });
  T("G3", "a failing 079 postflight stops the chain; nothing stays applied", !g3.ok && /POSTFLIGHT 079/.test(g3.err) && latest() === "20260101000076" && sig() === sig076 && fpSame(fp076, fp()),
    { error: g3.err, latest: latest(), schema_same: sig() === sig076 });
  // G4 clean chain
  const fClean = writeChain("chain-clean.sql");
  const g4 = psql(fClean, { file: true, single: true });
  const exp079 = fs.readFileSync(path.join(REPO, `supabase/release/staging-073/expected-${TO}-signature.txt`), "utf8").trim();
  const s4 = sig(); const miss4 = exp079.split("\n").filter((l) => !s4.includes(l)); const extra4 = s4.split("\n").filter((l) => !exp079.includes(l));
  T("G4", `clean chain 076 -> ${TO} in one transaction: applied, 073..${TO} postflights true, fingerprint identical, schema = expected ${TO}`, g4.ok && latest() === chainLib.V(TO) && pfAll(PFS) && fpSame(fp076, fp()) && !miss4.length && !extra4.length,
    { ok: g4.ok, err: g4.err, latest: latest(), postflights: pfAll(PFS), data_same: fpSame(fp076, fp()), missing: miss4.slice(0, 5), extra: extra4.slice(0, 5) });
  // G5 no double apply
  const g5 = psql(fClean, { file: true, single: true });
  T("G5", `running the chain again on ${TO} is refused by its guard; nothing changes`, !g5.ok && /migration after 076 is already recorded/.test(g5.err) && latest() === chainLib.V(TO) && fpSame(fp076, fp()), { error: g5.err });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ port: PORT, results: R }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
