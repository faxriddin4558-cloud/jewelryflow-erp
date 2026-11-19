// node --test scripts/lib/goldia-baseline-compare.test.js  (pure functions, no database)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const C = require("./goldia-baseline-compare");

const base = (rows, debt, scrap, fp = "a", login = 10) => [
  `BASELINE | org 1 | debt_g=${debt} till_scrap_g=${scrap}`, `BASELINE | rows gold_settlements | ${rows}`,
  `BASELINE | rows sales_login_audit_logs | ${login}`, `BASELINE | fingerprint business | ${fp}`, "BASELINE | history latest | 20260101000088"].join("\n");

test("the production case: one 32.74 g payment during the dump is a BUSINESS difference (never hidden)", () => {
  const d = C.baselineDiff(base(65, 2318.608, 209.43, "a"), base(66, 2285.868, 242.17, "b"));
  assert.deepEqual(d.business, ["org 1: debt_g=2318.608 till_scrap_g=209.43 -> debt_g=2285.868 till_scrap_g=242.17", "rows gold_settlements: 65 -> 66"]);
  assert.deepEqual(d.other, ["fingerprint business: a -> b"]); // the md5 is replaced by the per-key comparison above
});
test("only a login during the dump: no business difference, the log table is listed", () => {
  const d = C.baselineDiff(base(65, 1, 2, "a", 10), base(65, 1, 2, "b", 11));
  assert.deepEqual(d.business, []);
  assert.deepEqual(d.other, ["fingerprint business: a -> b", "rows sales_login_audit_logs: 10 -> 11"]);
});
test("identical moments: nothing", () => {
  assert.deepEqual(C.baselineDiff(base(1, 1, 1), base(1, 1, 1)), { business: [], other: [] });
});
test("row counts: business tables decide, log tables are listed", () => {
  const d = C.countsDiff({ "public.gold_settlements": 65, "public.audit_logs": 5, "auth.users": 3 }, { "public.gold_settlements": 66, "public.audit_logs": 9, "auth.users": 3 });
  assert.deepEqual(d.business, ["public.gold_settlements: 65 -> 66"]);
  assert.deepEqual(d.other, ["public.audit_logs: 5 -> 9"]);
});
test("a missing key is a business difference", () => {
  assert.deepEqual(C.countsDiff({ "public.x": 1 }, {}).business, ["public.x: 1 -> missing"]);
});
