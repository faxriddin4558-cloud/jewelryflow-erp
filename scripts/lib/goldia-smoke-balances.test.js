// node --test scripts/lib/goldia-smoke-balances.test.js  (pure functions, no database)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const B = require("./goldia-smoke-balances");
const ORG = "00000000-0000-0000-0000-000000000001";
const snap = (vals, fp, hist = "20260101000088") => B.parseBaseline([
  `BASELINE | org ${ORG} | cust=5 ` + Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(" "),
  `BASELINE | fingerprint business | ${fp}`, `BASELINE | history latest | ${hist}`].join("\n"));
const base = { debt_g: 100.5, adv_g: 2, sel_stock_g: 926.92, sel_owes_g: 2821.6017, till_uzs: 64520000, till_usd: 2923, mgr_stock_g: 10, mgr_uzs: 0, mgr_usd: 0, fac_obl_g: -1184.818 };

test("quiet database, API equal -> PASS", () => {
  const s = snap(base, "a"); const r = B.compareLive({ ...base }, s, s, ORG);
  assert.equal(r.state, "PASS"); assert.equal(r.quiet, true); assert.equal(r.rows.length, 10);
});
test("quiet database, API differs -> FAIL (real error, not live sales)", () => {
  const s = snap(base, "a"); const r = B.compareLive({ ...base, debt_g: 101.5 }, s, s, ORG);
  assert.equal(r.state, "FAIL"); assert.match(r.detail, /debt_g/);
});
test("a sale during the run: API between before and after -> PASS (natural)", () => {
  const r = B.compareLive({ ...base, debt_g: 105.5, sel_stock_g: 921.92 }, snap(base, "a"), snap({ ...base, debt_g: 105.5, sel_stock_g: 921.92 }, "b"), ORG);
  assert.equal(r.state, "PASS"); assert.match(r.detail, /moved by live activity/);
});
test("database moved and API outside before..after -> REVIEW", () => {
  const r = B.compareLive({ ...base, debt_g: 300 }, snap(base, "a"), snap({ ...base, debt_g: 105.5 }, "b"), ORG);
  assert.equal(r.state, "REVIEW");
});
test("migration during the run or missing organization -> FAIL", () => {
  assert.equal(B.compareLive(base, snap(base, "a"), snap(base, "a", "20260101000089"), ORG).state, "FAIL");
  assert.equal(B.compareLive(base, snap(base, "a"), snap(base, "a"), "other-org").state, "FAIL");
});
test("money tolerance 0.005, grams 0.00005", () => {
  const s = snap(base, "a");
  assert.equal(B.compareLive({ ...base, till_uzs: 64520000.004 }, s, s, ORG).state, "PASS");
  assert.equal(B.compareLive({ ...base, sel_owes_g: 2821.6018 }, s, s, ORG).state, "FAIL");
});
