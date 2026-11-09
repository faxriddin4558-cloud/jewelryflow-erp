import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const level = require("../../../scripts/lib/goldia-level.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const chain = require("../../../scripts/lib/goldia-chain.js");

// 2026-11-09: the release level is DETECTED from supabase_migrations, never assumed (the orchestrator used to default to
// "only the newest migration"). Real staging was found at 080 with the rows of 057 / 058 missing.
const V = (n: number) => `20260101000${String(n).padStart(3, "0")}`;
const repo = Array.from({ length: 81 }, (_, i) => ({ version: V(i + 1), num: String(i + 1).padStart(3, "0"), name: `m${i + 1}`, file: "" }));
const upTo = (n: number, without: number[] = []) => repo.filter((m) => Number(m.num) <= n && !without.includes(Number(m.num))).map((m) => m.version);

describe("goldia release level detection", () => {
  it("076 -> plans 077..081 in order", () => {
    const a = level.analyze(upTo(76), { repo });
    expect(a.ok).toBe(true);
    expect(a.latestNum).toBe("076");
    expect(a.chain.map((m: { num: string }) => m.num)).toEqual(["077", "078", "079", "080", "081"]);
  });
  it("080 -> plans only 081; 081 -> up to date, nothing to apply", () => {
    expect(level.analyze(upTo(80), { repo }).chain.map((m: { num: string }) => m.num)).toEqual(["081"]);
    const u = level.analyze(upTo(81), { repo });
    expect(u.ok && u.upToDate && u.chain.length === 0).toBe(true);
  });
  it("a version gap (staging: 057, 058 unrecorded) STOPs without the exact repair flag", () => {
    const h = upTo(80, [57, 58]);
    const a = level.analyze(h, { repo });
    expect(a.ok).toBe(false);
    expect(a.gaps).toEqual(["057", "058"]);
    expect(a.stops[0]).toMatch(/VERSION GAP/);
    expect(level.analyze(h, { repo, repairHistory: "057" }).ok).toBe(false);
    expect(level.analyze(h, { repo, repairHistory: "057,058,059" }).ok).toBe(false);
    const r = level.analyze(h, { repo, repairHistory: "58,057" });
    expect(r.ok).toBe(true);
    expect(r.repair).toEqual(["057", "058"]);
  });
  it("repair flag without a gap, unknown versions, a database newer than the checkout, an empty history -> STOP", () => {
    expect(level.analyze(upTo(80), { repo, repairHistory: "057" }).ok).toBe(false);
    expect(level.analyze([...upTo(80), "20251231000001"], { repo }).stops.join(" ")).toMatch(/unknown/);
    expect(level.analyze([...upTo(81), V(82)], { repo }).ok).toBe(false);
    expect(level.analyze([], { repo }).ok).toBe(false);
    expect(() => level.parseNums("abc")).toThrow();
  });
  it("a missing migration FILE inside the chain is a numbering gap", () => {
    const holed = repo.filter((m) => m.num !== "079");
    expect(level.analyze(upTo(76), { repo: holed }).stops.join(" ")).toMatch(/numbering gap/);
  });
  it("the chain SQL carries the contiguity gate; production never repairs history", () => {
    const sql = chain.buildChainSql("080", "081", { label: "staging" }).sql;
    expect(sql).toMatch(/VERSION GAP - repository migrations not recorded/);
    expect(sql).toMatch(/recorded versions unknown to the repository/);
    const rep = chain.buildChainSql("080", "081", { label: "staging", repairHistory: ["057", "058"] }).sql;
    expect(rep.indexOf("'20260101000057', 'goldia_capital_pure_gold_factory_handover'")).toBeGreaterThan(0);
    expect(rep.indexOf("history repair 058")).toBeLessThan(rep.indexOf("VERSION GAP"));
    expect(() => chain.buildChainSql("080", "081", { label: "production", repairHistory: ["057"] })).toThrow(/never/);
  });
});
