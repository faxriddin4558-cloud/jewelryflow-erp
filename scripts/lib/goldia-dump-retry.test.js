// node --test scripts/lib/goldia-dump-retry.test.js  (pure functions, no database)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const R = require("./goldia-dump-retry");

test("keepalive tolerates ~6 min of silence (was ~90 s)", () => {
  const v = Object.fromEntries(R.KEEPALIVE.split(" ").map((kv) => kv.split("=")));
  assert.equal(v.keepalives, "1");
  assert.ok(Number(v.keepalives_idle) + Number(v.keepalives_interval) * Number(v.keepalives_count) >= 300);
  assert.equal(R.dumpConninfo("postgres"), "dbname=postgres " + R.KEEPALIVE);
});
test("pauses grow and are capped; 5 attempts", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(R.pauseAfter), [15, 30, 45, 60, 60]);
  assert.equal(R.DUMP_ATTEMPTS, 5);
});
test("waits until the database answers again", () => {
  let calls = 0; const slept = [];
  const r = R.waitForNetwork(() => ++calls >= 4, (s) => slept.push(s), { maxSeconds: 600, everySeconds: 15 });
  assert.deepEqual(r, { ok: true, waitedSeconds: 45, probes: 4 });
  assert.deepEqual(slept, [15, 15, 15]);
});
test("gives up after maxSeconds without an answer", () => {
  const r = R.waitForNetwork(() => false, () => {}, { maxSeconds: 60, everySeconds: 15 });
  assert.deepEqual(r, { ok: false, waitedSeconds: 60, probes: 5 });
});
test("answer at once: no wait", () => {
  assert.deepEqual(R.waitForNetwork(() => true, () => { throw new Error("must not sleep"); }), { ok: true, waitedSeconds: 0, probes: 1 });
});
test("stderr tail keeps the last lines", () => {
  assert.equal(R.stderrTail("a\n\nb\nc\nd\n"), "b | c | d");
});
