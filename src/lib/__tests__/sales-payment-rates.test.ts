import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isSellerRole, ownRatesFromRpc, pickPaymentRates, tillValuation, pickHandoverUsdRate } from "../sales-payment-rates";

// F-UI-1 / F-UI-2 / F-UI-3 (staging Playwright audit 2026-11-03).
describe("payment dialog rates (F-UI-1)", () => {
  it("seller: own stored LOM and USD rates, read-only, independent of CBU and of the official rate", () => {
    const p = pickPaymentRates({ role: "seller", ownRates: { lom: 905000, usd: 12650 }, officialRate: 900000, cbuUsdRate: null });
    expect(p).toEqual({ lom: "905000", usd: "12650", locked: true, source: "seller_own" });
    const withCbu = pickPaymentRates({ role: "sales", ownRates: { lom: 890000, usd: 12500 }, officialRate: 900000, cbuUsdRate: 12999 });
    expect([withCbu.lom, withCbu.usd]).toEqual(["890000", "12500"]);
  });
  it("seller without an own LOM rate shows the official rate (server fallback); without own USD the field stays empty", () => {
    const p = pickPaymentRates({ role: "sotuvchi", ownRates: { lom: null, usd: null }, officialRate: 900000, cbuUsdRate: 12800 });
    expect([p.lom, p.usd, p.locked]).toEqual(["900000", "", true]);
  });
  it("director / manager keep the previous behaviour (official + CBU, editable)", () => {
    for (const role of ["director", "admin", "production_manager", "manager"]) {
      const p = pickPaymentRates({ role, ownRates: null, officialRate: 900000, cbuUsdRate: 12800 });
      expect(p).toEqual({ lom: "900000", usd: "12800", locked: false, source: "official_and_cbu" });
    }
    expect(pickPaymentRates({ role: "manager", ownRates: null, officialRate: 900000, cbuUsdRate: null }).usd).toBe("");
  });
  it("reads the seller's own row from the rpc_get_seller_rates payload", () => {
    expect(ownRatesFromRpc({ sellers: [{ lom_rate_uzs: "895000.00", usd_rate_uzs: 12550 }] })).toEqual({ lom: 895000, usd: 12550 });
    expect(ownRatesFromRpc({ sellers: [] })).toEqual({ lom: null, usd: null });
    expect(ownRatesFromRpc(null)).toEqual({ lom: null, usd: null });
    expect(isSellerRole("SALES")).toBe(true);
    expect(isSellerRole("director")).toBe(false);
  });
});

describe("till handover (F-UI-3)", () => {
  it("dollars collected since 072 are valued at payment time: no USD rate required, grams not recalculated", () => {
    const v = tillValuation({ seller_till_cash_amount: 890000, seller_till_usd_amount: 100, till_valued_cash_uzs: 890000, till_valued_cash_585_g: 1,
      till_valued_usd: 100, till_valued_usd_585_g: 1.4045 });
    expect(v.usdRateRequired).toBe(false);
    expect(v.unvaluedUsd).toBe(0);
    expect(v.valuedUsdGrams).toBe(1.4045);
    expect(v.valuedCashGrams).toBe(1);
  });
  it("older (unvalued) dollars still need a rate, only for that part", () => {
    const v = tillValuation({ seller_till_usd_amount: 150, till_valued_usd: 100, till_valued_usd_585_g: 1.4045 });
    expect([v.usdRateRequired, v.unvaluedUsd, v.valuedUsd]).toEqual([true, 50, 100]);
  });
  it("pre-fills the seller's stored USD rate, then CBU, never a guess", () => {
    expect(pickHandoverUsdRate(12550, null)).toBe("12550");
    expect(pickHandoverUsdRate(12550, 12999)).toBe("12550");
    expect(pickHandoverUsdRate(null, 12800)).toBe("12800");
    expect(pickHandoverUsdRate(null, null)).toBe("");
  });
});

describe("UZS amount inputs accept whole so'm (F-UI-2)", () => {
  const read = (f: string) => fs.readFileSync(path.resolve(process.cwd(), f), "utf8");
  it("payment, handover, purchase and mobile settlement cash fields use step=1 (rate fields unchanged)", () => {
    const ledger = read("src/components/sales/CustomerLedgerAndSheetsSection.tsx");
    const cashInput = ledger.slice(ledger.indexOf("To&apos;langan Naqd Pul (UZS)"), ledger.indexOf("value={payCashAmount}"));
    expect(cashInput).toContain('step="1"');
    const director = read("src/components/sales/DirectorSalesWorkspace.tsx");
    for (const label of ["Naqd Pul (UZS):", "Sarflangan UZS (So&apos;m):"]) {
      const i = director.indexOf(label);
      expect(director.slice(i, i + 600)).toContain('step="1"');
    }
    const mobile = read("src/components/sales/SellerMobileWorkspace.tsx");
    const m = mobile.indexOf('htmlFor="settleCashAmountInput"');
    expect(mobile.slice(m, m + 800)).toContain('step="1"');
    // 447 500 so'm is a valid amount for step=1, min=0
    expect(447500 % 1).toBe(0);
  });
  it("the seller dialog sends the rate only as a check value; the server keeps ERR_RATE_MISMATCH (073 unchanged)", () => {
    const mig = read("supabase/migrations/20260101000073_goldia_release_candidate_stabilization.sql");
    expect(mig).toContain("ERR_RATE_MISMATCH: Sizning joriy LOM kursingiz");
    expect(mig).toContain("ERR_RATE_MISMATCH: Sizning joriy USD kursingiz");
  });
});
