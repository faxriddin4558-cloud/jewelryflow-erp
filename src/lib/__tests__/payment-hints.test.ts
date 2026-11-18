import { describe, it, expect } from "vitest";
import { usdToUzsPreview, wholeDollarsInUzs, cpayScopeText, SETTL_SCOPE_TEXT } from "../payment-hints";

describe("payment dialog hints (display only)", () => {
  it("USD preview: 500 USD x 12 650 = 6 325 000 so'm; nothing without both values", () => {
    expect(usdToUzsPreview("500", "12650")).toBe(6325000);
    expect(usdToUzsPreview(500, 0)).toBeNull();
    expect(usdToUzsPreview("", 12650)).toBeNull();
  });
  it("whole-dollar so'm amount (dollars typed as so'm) is detected; ordinary so'm amounts are not", () => {
    expect(wholeDollarsInUzs(6325000, 12650)).toBe(500);
    expect(wholeDollarsInUzs(6325001, 12650)).toBeNull();
    expect(wholeDollarsInUzs(5000000, 12650)).toBeNull();
    expect(wholeDollarsInUzs(126500, 12650)).toBe(10);
    expect(wholeDollarsInUzs(113850, 12650)).toBeNull(); // 9 USD: below the 10 USD threshold
    expect(wholeDollarsInUzs(6325000, 0)).toBeNull();
  });
  it("scope texts name the debt each dialog closes", () => {
    expect(SETTL_SCOPE_TEXT).toMatch(/585 GRAMM/);
    expect(cpayScopeText("USD")).toMatch(/USD QARZINI/);
  });
});
