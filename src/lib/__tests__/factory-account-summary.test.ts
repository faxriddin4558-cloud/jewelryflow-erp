import { describe, expect, it } from "vitest";
import { factoryNetWording, isFactoryAccountMismatch, summarizeFactoryAccount } from "@/lib/factory-account-summary";

describe("factory account summary (088)", () => {
  const receipts = [
    { status: "in_manager_stock", factory_obligation_g: 108, original_physical_g: 100 },
    { status: "reversed", factory_obligation_g: 50, original_physical_g: 50 },
    { status: "transferred", factory_obligation_g: "54", original_physical_g: "50" },
  ];
  const handovers = [{ status: "confirmed", agreed_equivalent_g: 20 }, { status: "reversed", agreed_equivalent_g: 99 }];
  const openingDocs = [
    { kind: "factory_obligation", status: "active", amount: 5 },
    { kind: "factory_advance", status: "active", amount: 30 },
    { kind: "factory_advance", status: "cancelled", amount: 1000 },
    { kind: "factory_settled", status: "active", amount: 54 },
  ];

  it("splits goods debt, C, C2 + handovers and checks them against the vault", () => {
    // vault: 108 + 54 + 5 - 54 = 113 obligation; 30 + 20 = 50 advance -> net 63
    const s = summarizeFactoryAccount({ receipts, handovers, openingDocs, vault: { current_factory_obligation_g: 113, current_factory_advance_g: 50 } });
    expect(s.receivedPhysicalG).toBe(150);
    expect(s.receiptsObligationG).toBe(162);
    expect(s.settledSellerGoodsG).toBe(54);
    expect(s.goodsDebtG).toBe(108);
    expect(s.obligationWithoutGoodsG).toBe(5);
    expect(s.givenGoldG).toBe(50);
    expect(s.partsNetG).toBe(63);
    expect(s.vaultNetG).toBe(63);
    expect(isFactoryAccountMismatch(s)).toBe(false);
  });

  it("reports a mismatch instead of hiding it; no vault = no check", () => {
    const s = summarizeFactoryAccount({ receipts, handovers, openingDocs, vault: { current_factory_obligation_g: 100, current_factory_advance_g: 50 } });
    expect(s.mismatchG).toBeCloseTo(13, 6);
    expect(isFactoryAccountMismatch(s)).toBe(true);
    const none = summarizeFactoryAccount({ receipts, handovers, openingDocs, vault: null });
    expect(none.vaultNetG).toBeNull();
    expect(isFactoryAccountMismatch(none)).toBe(false);
  });

  it("sign wording: positive = manager owes, negative = factory owes, 0 = closed", () => {
    expect(factoryNetWording(12.5)).toEqual({ direction: "manager_owes_factory", title: "Menejerning zavodga qarzi", amountG: 12.5 });
    expect(factoryNetWording(-7)).toEqual({ direction: "factory_owes_manager", title: "Zavodning menejerga qarzi", amountG: 7 });
    expect(factoryNetWording(0).title).toBe("Zavod bilan hisob yopiq");
    expect(factoryNetWording(null).direction).toBe("closed");
  });

  it("090 display split: opening A vs later receipts, gold handovers vs finished goods returns - totals unchanged", () => {
    const s = summarizeFactoryAccount({
      receipts: [{ factory_obligation_g: 108, opening_document_id: "a" }, { factory_obligation_g: 55 }, { factory_obligation_g: 9, status: "reversed" }],
      handovers: [{ agreed_equivalent_g: 30, source_type: "scrap_gold" }, { agreed_equivalent_g: 5.5, source_type: "finished_goods_return" }, { agreed_equivalent_g: 7, status: "reversed" }],
      openingDocs: [{ kind: "factory_advance", amount: 100 }], vault: null,
    });
    expect([s.openingReceiptsObligationG, s.laterReceiptsObligationG, s.receiptsObligationG]).toEqual([108, 55, 163]);
    expect([s.goldHandoversG, s.finishedGoodsReturnsG, s.handoversG, s.givenGoldG]).toEqual([30, 5.5, 35.5, 135.5]);
  });
});
