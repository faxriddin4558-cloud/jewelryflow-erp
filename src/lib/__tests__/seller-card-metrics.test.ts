import { describe, it, expect } from "vitest";
import { sellerCardMetrics } from "../seller-card-metrics";

describe("seller card metrics (display only, same rule as before)", () => {
  it("seller owes the manager: negative direction, amount = seller_owes_manager_g; till and stock read as stored", () => {
    const m = sellerCardMetrics({ seller_owes_manager_g: "2821.6017", manager_owes_seller_g: 0, bozor_qarzi_signed_g: -2821.6017,
      current_physical_stock_g: "926.92", seller_till_scrap_grams: 12.5, seller_till_cash_amount: "64520000", seller_till_usd_amount: "2923" });
    expect(m).toEqual({ direction: "seller_owes", obligationG: 2821.6017, stockG: 926.92, tillLomG: 12.5, tillUzs: 64520000, tillUsd: 2923 });
  });
  it("manager owes the seller; USD shown as 0 when empty (never hidden)", () => {
    const m = sellerCardMetrics({ seller_owes_manager_g: 0, manager_owes_seller_g: 3.25, bozor_qarzi_signed_g: 3.25 });
    expect(m.direction).toBe("manager_owes");
    expect(m.obligationG).toBe(3.25);
    expect(m.tillUsd).toBe(0);
  });
  it("even account and missing values", () => {
    expect(sellerCardMetrics({})).toEqual({ direction: "even", obligationG: 0, stockG: 0, tillLomG: 0, tillUzs: 0, tillUsd: 0 });
  });
  it("only the signed column set (older rows): the sign decides", () => {
    expect(sellerCardMetrics({ bozor_qarzi_signed_g: -1.5 })).toMatchObject({ direction: "seller_owes", obligationG: 1.5 });
  });
});
