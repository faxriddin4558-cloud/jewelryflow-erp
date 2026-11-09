import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { balanceTotals, customerBalance, goldAdvanceOf, goldDebtOf, netDirectionLabel } from "../customer-balance";

// Critical display bug 2026-11-09: dashboards summed gross debt and called it "sof", clamped negative nets away,
// and could subtract an advance twice. One canonical model: signed net = gross debt - gross advance, per unit.
describe("canonical customer balance model", () => {
  it("per customer: signed net, open debt and open advance are its two sides", () => {
    expect(customerBalance(11, 0)).toEqual({ signedNet: 11, openDebt: 11, openAdvance: 0 });
    expect(customerBalance(0, 5)).toEqual({ signedNet: -5, openDebt: 0, openAdvance: 5 });
    expect(customerBalance(0, 0)).toEqual({ signedNet: 0, openDebt: 0, openAdvance: 0 });
    // a (never expected) row with both sides is netted once, not counted twice
    expect(customerBalance(3, 8)).toEqual({ signedNet: -5, openDebt: 0, openAdvance: 5 });
    expect(customerBalance("2.12345", null)).toEqual({ signedNet: 2.1235, openDebt: 2.1235, openAdvance: 0 });
  });
  it("totals: net = SUM(debt) - SUM(advance); a net advance stays negative (not clamped)", () => {
    const rows = [{ d: 11, a: 0 }, { d: 0, a: 5 }, { d: 7, a: 0 }, { d: 0, a: 7 }, { d: 0, a: 0 }];
    const t = balanceTotals(rows, (r) => r.d, (r) => r.a);
    expect(t).toEqual({ grossDebt: 18, grossAdvance: 12, signedNet: 6, debtors: 2, creditors: 2 });
    const adv = balanceTotals([{ d: 2, a: 0 }, { d: 0, a: 9 }], (r) => r.d, (r) => r.a);
    expect(adv.signedNet).toBe(-7);
    expect(netDirectionLabel(adv.signedNet)).toBe("Biz mijozlarga qarzdormiz");
    expect(netDirectionLabel(6)).toBe("Mijozlar bizga qarzdor");
    expect(netDirectionLabel(0)).toBe("Hisob-kitob teng");
  });
  it("feeding already-netted rows (open debt / open advance) gives the same totals - no double subtraction", () => {
    const raw = [{ d: 11, a: 0 }, { d: 0, a: 5 }, { d: 3, a: 8 }];
    const netted = raw.map((r) => { const b = customerBalance(r.d, r.a); return { d: b.openDebt, a: b.openAdvance }; });
    expect(balanceTotals(netted, (r) => r.d, (r) => r.a)).toEqual(balanceTotals(raw, (r) => r.d, (r) => r.a));
  });
  it("gram accessors accept the old column aliases", () => {
    expect(goldDebtOf({ current_gold_debt_grams: 4 })).toBe(4);
    expect(goldAdvanceOf({ advance_gold_balance_grams: 2 })).toBe(2);
    expect(goldDebtOf({ current_debt_grams: 0, current_gold_debt_grams: 9 })).toBe(0);
  });
  it("the dashboards use the canonical model (no ad-hoc sum of current_debt_grams, no per-customer clamp)", () => {
    const root = path.resolve(__dirname, "../../..");
    for (const f of ["src/components/sales/DirectorSalesWorkspace.tsx", "src/app/sales/app/page.tsx", "src/components/sales/ManagerSimplePanel.tsx"]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src, f).toMatch(/balanceTotals\(/);
      expect(src, f).not.toMatch(/reduce\([^)]*current_debt_grams/);
      expect(src, f).not.toMatch(/Math\.max\(0,\s*Number\(c\.current_debt_grams/);
    }
  });
  it("migration 082: monthly report is signed over all legacy rows, keeps the old keys, adds advance / net", () => {
    const root = path.resolve(__dirname, "../../..");
    const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260101000082_goldia_monthly_report_signed_balance.sql"), "utf8");
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.rpc_get_customer_monthly_report"));
    expect(body).not.toMatch(/round\(greatest\(0, v_open_debt\)/);
    expect(body).not.toMatch(/round\(greatest\(0, \(v_open_debt \+ v_month_legacy/);
    for (const k of ["closing_debt_g", "closing_advance_g", "closing_net_g", "opening_net_g", "legacy_advance_month_g", "total_closing_net_g", "total_customer_debt_g"]) expect(body).toContain(`'${k}'`);
    expect(body).toMatch(/v_close_net\s+:= round\(v_open_net \+ v_month_legacy - v_month_legacy_adv \+ v_month_sales - v_month_settle, 4\)/);
  });
});
