import { describe, it, expect } from "vitest";
import { buildCorrectionPayload, ledgerTypeLabel, tillCountDiff, STOCK_KIND_LABEL } from "../goldia-089-ui";

describe("089 UI helpers", () => {
  it("journal labels keep CPAY and SETTL apart", () => {
    expect(ledgerTypeLabel("currency_payment")).toMatch(/CPAY/);
    expect(ledgerTypeLabel("payment")).toMatch(/SETTL/);
    expect(ledgerTypeLabel("opening_return")).toMatch(/Eski savdo/);
    expect(Object.keys(STOCK_KIND_LABEL)).toContain("old_sale_return");
  });
  it("till count difference: match / short / surplus; invalid input -> null", () => {
    expect(tillCountDiff(5000000, 100, "5000000", "100")).toEqual({ diffUzs: 0, diffUsd: 0, kind: "match" });
    expect(tillCountDiff(5000000, 100, "4000000", "120")).toEqual({ diffUzs: -1000000, diffUsd: 20, kind: "short" });
    expect(tillCountDiff(0, 0, "10", "0")?.kind).toBe("surplus");
    expect(tillCountDiff(0, 0, "-1", "0")).toBeNull();
    expect(tillCountDiff(0, 0, "abc", "0")).toBeNull();
  });
  it("correction payload: required rates per dialog, nothing converted", () => {
    expect(buildCorrectionPayload({ newKind: "CPAY", currency: "USD", cashUzs: "", usdAmount: "500", lomRate: "", usdRate: "" }))
      .toEqual({ payload: { cash_uzs: 0, usd_amount: 500, currency: "USD" } });
    expect(buildCorrectionPayload({ newKind: "CPAY", currency: "UZS", cashUzs: "", usdAmount: "500", lomRate: "", usdRate: "" })).toHaveProperty("error");
    expect(buildCorrectionPayload({ newKind: "SETTL", currency: "UZS", cashUzs: "1 000 000", usdAmount: "", lomRate: "", usdRate: "" })).toHaveProperty("error");
    expect(buildCorrectionPayload({ newKind: "SETTL", currency: "UZS", cashUzs: "", usdAmount: "100", lomRate: "900000", usdRate: "12650" }))
      .toEqual({ payload: { cash_uzs: 0, usd_amount: 100, lom_rate: 900000, usd_rate: 12650 } });
    expect(buildCorrectionPayload({ newKind: "CPAY", currency: "UZS", cashUzs: "0", usdAmount: "0", lomRate: "", usdRate: "" })).toHaveProperty("error");
  });
});
