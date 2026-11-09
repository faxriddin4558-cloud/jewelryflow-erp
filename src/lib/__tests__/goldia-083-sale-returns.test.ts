import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// 083 partial / full customer returns: source-level guards for the rules decided on 2026-11-09 (the behaviour itself is
// proven against PostgreSQL + GoTrue + PostgREST by docs/audits/goldia-077/harness/ret-083.js).
const root = path.resolve(__dirname, "../../..");
const mig = fs.readFileSync(path.join(root, "supabase/migrations/20260101000083_goldia_partial_sale_returns.sql"), "utf8");
const rb = fs.readFileSync(path.join(root, "supabase/rollback/20260101000083_rollback.sql"), "utf8");
const rpc = mig.slice(mig.indexOf("CREATE OR REPLACE FUNCTION public.rpc_record_sale_return"), mig.indexOf("revoke execute on function public.rpc_record_sale_return"));

describe("083 customer returns", () => {
  it("own audited document; the original sale row is never updated by the return", () => {
    expect(mig).toMatch(/create table if not exists public\.jewelry_sale_returns/);
    expect(rpc).not.toMatch(/update public\.jewelry_sales/i);
    expect(mig).toMatch(/revoke insert, update, delete, truncate on public\.jewelry_sale_returns from authenticated/);
    expect(mig).toMatch(/jewelry_sale_returns_value_split/);
  });
  it("value = share of the ORIGINAL sale; the completing return takes the exact remainder; never above the sale", () => {
    expect(rpc).toContain("round(v_sale.client_gold_due_grams * v_w / v_sale.base_weight_grams, 4)");
    expect(rpc).toContain("round(coalesce(v_sale.sale_amount, 0) * v_w / v_sale.base_weight_grams, 2)");
    expect(rpc).toContain("v_due  := round(v_sale.client_gold_due_grams - v_prev_due, 4)");
    expect(rpc).toContain("round(coalesce(v_sale.sale_amount, 0) - v_prev_amt, 2)");
    expect(rpc).toMatch(/savdoning qaytarilmagan qismidan/);
    expect(rpc).not.toMatch(/daily_gold_rates|rate_per_gram/);   // no re-pricing at today's rate
  });
  it("advance-only rule: open debt first, the rest becomes an advance; no till / cash movement", () => {
    expect(rpc).toContain("v_debt_red := least(v_value, greatest(v_net, 0))");
    expect(rpc).toContain("v_adv_new  := v_value - v_debt_red");
    expect(rpc).not.toMatch(/seller_till_cash_amount|manager_cash_amount|financial_transactions/);
  });
  it("barcode = whole piece; rights like a reversal; manager reception only by management, via the existing flow", () => {
    expect(rpc).toMatch(/butun dona sifatida qaytariladi/);
    expect(rpc).toMatch(/_goldia_is_seller_role\(v_role\) and v_sale\.seller_id is distinct from v_emp/);
    expect(rpc).toMatch(/v_dest = 'manager' and not public\._goldia_is_management_role\(v_role\)/);
    expect(rpc).toContain("public.rpc_return_piece_to_manager(v_piece_id");
  });
  it("double click / parallel: mandatory idempotency key + sale row lock; no time-window refusal of legitimate returns", () => {
    expect(rpc).toMatch(/idempotency key\) majburiy/);
    expect(rpc).toMatch(/check_and_lock_idempotency\(v_key, 'rpc_record_sale_return'/);
    expect(rpc).toMatch(/from public\.jewelry_sales where id = p_sale_id and organization_id = v_org for update/);
    expect(rpc).not.toMatch(/interval '1 minute'/);
  });
  it("every sales aggregate subtracts confirmed returns; a sale with returns cannot be reversed as a whole", () => {
    for (const fn of ["recalc_seller_gold_account", "get_seller_available_stock_grams", "rpc_get_unified_customer_ledger", "rpc_get_customer_monthly_report",
      "rpc_get_daily_sales_ledger", "_goldia_period_effects", "rpc_get_seller_markup_difference_report", "rpc_get_seller_reconciliation_statement",
      "rpc_get_three_tier_ledger_summary", "rpc_execute_full_test_reset"]) {
      const i = mig.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\s*\\(`, "i"));
      expect(i, fn).toBeGreaterThan(0);
      const body = mig.slice(i, mig.indexOf("$", mig.indexOf("AS $", i) + 4) > 0 ? mig.length : mig.length);
      expect(body.slice(0, 40000), fn).toMatch(/jewelry_sale_returns/);
    }
    expect(mig).toMatch(/ERR_SALE_HAS_RETURNS/);
    expect(mig).toMatch(/status = 'confirmed'/);
  });
  it("rollback is refused while return documents exist", () => {
    expect(rb).toMatch(/ROLLBACK 083 REFUSED/);
    expect(rb.indexOf("ROLLBACK 083 REFUSED")).toBeLessThan(rb.indexOf("drop table if exists public.jewelry_sale_returns"));
  });
  it("UI: one idempotency key per dialog, busy lock, return rows are documents (no reversal button)", () => {
    const m = fs.readFileSync(path.join(root, "src/components/sales/SaleReturnModal.tsx"), "utf8");
    expect(m).toMatch(/const \[idemKey\] = useState\(newKey\)/);
    expect(m).toMatch(/if \(busy \|\| invalid \|\| !sale\) return/);
    const c = fs.readFileSync(path.join(root, "src/components/sales/CustomerLedgerAndSheetsSection.tsx"), "utf8");
    expect(c).toMatch(/r\.tx_type === "return" \? \(\s*<span[^>]*>🧾 Vozvrat hujjati/);
  });
});
