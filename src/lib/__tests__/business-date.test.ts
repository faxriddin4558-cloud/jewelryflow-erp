import { describe, it, expect } from "vitest";
import { tashkentBusinessDate } from "../business-date";

// 073: one business-date rule shared with public._goldia_business_date() — the Asia/Tashkent calendar date.
describe("tashkentBusinessDate", () => {
  const cases: [string, string, string][] = [
    ["23:59 Tashkent", "2026-11-25T18:59:00Z", "2026-11-25"],
    ["00:00 Tashkent", "2026-11-25T19:00:00Z", "2026-11-26"],
    ["00:01 Tashkent", "2026-11-25T19:01:00Z", "2026-11-26"],
    ["04:59 Tashkent", "2026-11-25T23:59:00Z", "2026-11-26"],
    ["05:00 Tashkent", "2026-11-26T00:00:00Z", "2026-11-26"],
    ["month end 23:59", "2026-11-30T18:59:00Z", "2026-11-30"],
    ["new month 00:00", "2026-11-30T19:00:00Z", "2026-12-01"],
    ["year end 23:59", "2026-12-31T18:59:00Z", "2026-12-31"],
    ["new year 00:00", "2026-12-31T19:00:00Z", "2027-01-01"],
    ["new year 04:59", "2026-12-31T23:59:00Z", "2027-01-01"],
    ["new year 05:00", "2027-01-01T00:00:00Z", "2027-01-01"],
    ["leap day 00:30", "2028-02-28T19:30:00Z", "2028-02-29"],
  ];
  for (const [label, utc, expected] of cases) {
    it(`${label} (${utc}) -> ${expected}`, () => expect(tashkentBusinessDate(new Date(utc))).toBe(expected));
  }
  it("offsetDays shifts whole Tashkent days across a month boundary", () => {
    expect(tashkentBusinessDate(new Date("2026-12-01T00:30:00Z"), -1)).toBe("2026-11-30");
    expect(tashkentBusinessDate(new Date("2026-11-30T19:30:00Z"), -1)).toBe("2026-11-30");
  });
  it("accepts ISO strings (created_at)", () => expect(tashkentBusinessDate("2026-11-30T19:30:00+00:00")).toBe("2026-12-01"));
});
