import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const chain = require("../../../scripts/lib/goldia-chain.js");

// The production chain copy gate failed on Windows (2026-11-06): psql.exe prints CRLF, the old comparison split on "\n"
// only and compared whole lines, so the same data looked different once the line order changed. The comparison must be
// by VALUE per category and CR-safe - and must still catch every real difference.
describe("goldia chain - business fingerprint comparison", () => {
  const before = "balances client_gold_accounts|52|aaa\r\nhistory jewelry_sales|59|bbb\r\nrows customers|92|";
  it("same data, CRLF, different line order, a new table afterwards -> no difference", () => {
    const after = "rows customers|92|\r\nrows client_currency_accounts|0|\r\nhistory jewelry_sales|59|bbb\r\nbalances client_gold_accounts|52|aaa";
    expect(chain.fingerprintDiff(before, after)).toEqual([]);
  });
  it("a changed balance hash is reported with before / after", () => {
    const d = chain.fingerprintDiff(before, "balances client_gold_accounts|52|zzz\nhistory jewelry_sales|59|bbb\nrows customers|92|");
    expect(d).toEqual([{ category: "balances client_gold_accounts", before: { n: "52", h: "aaa" }, after: { n: "52", h: "zzz" } }]);
  });
  it("a changed row count, a missing category and a duplicated category are reported", () => {
    expect(chain.fingerprintDiff(before, "balances client_gold_accounts|52|aaa\nhistory jewelry_sales|60|bbb\nrows customers|92|")[0].category).toBe("history jewelry_sales");
    expect(chain.fingerprintDiff(before, "balances client_gold_accounts|52|aaa\nrows customers|92|")[0]).toEqual({ category: "history jewelry_sales", before: { n: "59", h: "bbb" }, after: null });
    expect(chain.fingerprintDiff(before, before + "\nrows customers|92|").map((x: { category: string }) => x.category)).toContain("rows customers");
  });
  it("an empty reference never passes", () => {
    expect(chain.fingerprintDiff("", "rows customers|92|").length).toBe(1);
  });
  it("outputLines drops CR and empty lines", () => {
    expect(chain.outputLines("a|1\r\n\r\nb|2\r\n")).toEqual(["a|1", "b|2"]);
  });
});
