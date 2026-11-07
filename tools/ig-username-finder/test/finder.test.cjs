"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateAll, usernameType, scoreUsername, rankCandidates } = require("../lib/candidates.cjs");
const { STATUS, classify } = require("../lib/classify.cjs");
const { toCsv, readCsv } = require("../lib/csv.cjs");

test("generatsiya: 2/3/4 belgili kombinatsiyalar soni", () => {
  let n = 0;
  for (const _ of generateAll([2, 3])) n++;
  assert.equal(n, 36 ** 2 + 36 ** 3);
  const first = generateAll([2]).next().value;
  assert.equal(first, "aa");
});

test("tur aniqlash", () => {
  assert.equal(usernameType("7112"), "digits");
  assert.equal(usernameType("nova"), "letters");
  assert.equal(usernameType("f1"), "mixed");
});

test("esda qoladigan niklar yuqori ball oladi", () => {
  const s = (u) => scoreUsername(u).score;
  assert.ok(s("f1") > s("q8z"), "f1 > q8z");
  assert.ok(s("x7") > s("a1b2"), "x7 > a1b2");
  assert.ok(s("7112") > s("7135"), "7112 > 7135");
  assert.ok(s("7777") > s("7112"), "7777 > 7112");
  assert.ok(s("1234") > s("1374"), "1234 > 1374");
  assert.ok(s("nova") > s("nqvx"), "nova > nqvx");
});

test("reyting uchala turni ham o'z ichiga oladi", () => {
  const r = rankCandidates({ lengths: [2, 3] });
  const types = new Set(r.map((c) => c.type));
  assert.deepEqual([...types].sort(), ["digits", "letters", "mixed"]);
  assert.ok(r.some((c) => c.username === "f1"));
});

const base = { username: "f1", httpStatus: 200, finalUrl: "https://www.instagram.com/f1/", title: "", ogTitle: "", ogUrl: "", description: "", bodyText: "", hasCaptcha: false };

test("klassifikatsiya: band profil", () => {
  const r = classify({ ...base, ogTitle: "F One (@f1) • Instagram photos and videos" });
  assert.equal(r.status, STATUS.TAKEN);
});

test("klassifikatsiya: topilmadi != bo'sh", () => {
  const r = classify({ ...base, bodyText: "Sorry, this page isn't available." });
  assert.equal(r.status, STATUS.POSSIBLE);
  assert.notEqual(r.status, "bosh");
});

test("klassifikatsiya: to'xtash signallari", () => {
  assert.equal(classify({ ...base, httpStatus: 429 }).status, STATUS.RATE_LIMITED);
  assert.equal(classify({ ...base, bodyText: "Please wait a few minutes before you try again." }).status, STATUS.RATE_LIMITED);
  assert.equal(classify({ ...base, finalUrl: "https://www.instagram.com/accounts/login/?next=/f1/" }).status, STATUS.LOGIN_WALL);
  assert.equal(classify({ ...base, finalUrl: "https://www.instagram.com/challenge/x" }).status, STATUS.CHALLENGE);
  assert.equal(classify({ ...base, hasCaptcha: true }).status, STATUS.CHALLENGE);
});

test("klassifikatsiya: signal yo'q -> noma'lum", () => {
  assert.equal(classify({ ...base, bodyText: "Instagram" }).status, STATUS.UNKNOWN);
});

test("CSV yozish/o'qish", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "igf-")), "x.csv");
  fs.writeFileSync(f, toCsv([{ username: "f1", note: 'a, "b"' }], ["username", "note"]));
  assert.deepEqual(readCsv(f), [{ username: "f1", note: 'a, "b"' }]);
});
