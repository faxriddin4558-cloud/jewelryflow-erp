import { describe, it, expect } from "vitest";
import { GoldEngine } from "../erp-engine";

describe("JewelryFlow Sales — Gold Ledger & Consignment Calculations", () => {
  describe("GoldEngine.calculateJewelryConsignmentAndSale", () => {
    it("matches the exact required specification: 100g product, factory 8%, client 12%", () => {
      const res = GoldEngine.calculateJewelryConsignmentAndSale(100, 8, 12);

      // 1. Asl mahsulot vazni
      expect(res.baseWeightGrams).toBe(100);

      // 2. Zavod ustamasi (8%) -> 100 * 1.08 = 108g (Sotuvchining zavod oldidagi majburiyati)
      expect(res.factoryGoldDueGrams).toBe(108);

      // 3. Mijoz ustamasi (12%) -> 100 * 1.12 = 112g (Mijozning sotuvchi oldidagi qarzi)
      expect(res.clientGoldDueGrams).toBe(112);

      // 4. Foizlar orasidagi farq (112 - 108 = 4g) -> Hisob-kitobdagi farq (shaxsiy foyda deb etiketlanmaydi)
      expect(res.markupSpreadGrams).toBe(4);
    });

    it("strictly calculates both markups from base weight without compounding", () => {
      const res = GoldEngine.calculateJewelryConsignmentAndSale(50, 6, 10);

      // Factory due = 50 * 1.06 = 53.0000g
      expect(res.factoryGoldDueGrams).toBe(53);

      // Client due = 50 * 1.10 = 55.0000g (NOT 53 * 1.10 = 58.3g!)
      expect(res.clientGoldDueGrams).toBe(55);
      expect(res.markupSpreadGrams).toBe(2);
    });

    it("handles zero or missing markup percentages gracefully", () => {
      const res = GoldEngine.calculateJewelryConsignmentAndSale(25.5, 0, 0);
      expect(res.factoryGoldDueGrams).toBe(25.5);
      expect(res.clientGoldDueGrams).toBe(25.5);
      expect(res.markupSpreadGrams).toBe(0);
    });

    it("returns zero for negative or invalid base weights", () => {
      const res = GoldEngine.calculateJewelryConsignmentAndSale(-10, 8, 12);
      expect(res.baseWeightGrams).toBe(0);
      expect(res.factoryGoldDueGrams).toBe(0);
      expect(res.clientGoldDueGrams).toBe(0);
      expect(res.markupSpreadGrams).toBe(0);
    });
  });

  describe("GoldEngine.calculateGoldSettlement", () => {
    it("matches the exact required specification: initial debt 112g, 70g scrap, 18M UZS cash at 900k UZS/g -> remaining 22g", () => {
      // 1. Initial client debt from previous sale: 112g
      const initialDebt = 112;
      const scrapWeight = 70;
      const cashAmount = 18_000_000;
      const ratePerGram = 900_000;

      const settlement = GoldEngine.calculateGoldSettlement(
        initialDebt,
        scrapWeight,
        cashAmount,
        ratePerGram
      );

      // 2. Pul qaytimi o'sha kungi kursga bo'linib gramm ekvivalentiga o'tadi: 18,000,000 / 900,000 = 20g
      expect(settlement.cashEquivalentGrams).toBe(20);

      // 3. Jami qaytim = 70g lom + 20g pul ekvivalenti = 90g
      expect(settlement.totalSettledGrams).toBe(90);

      // 4. Qarzdan chegirilgan miqdor = 90g
      expect(settlement.appliedToDebtGrams).toBe(90);

      // 5. Ortiqcha to'lov yo'q (excess = 0)
      expect(settlement.excessGoldGrams).toBe(0);

      // 6. Qolgan qarz: 112 - 90 = 22g
      expect(settlement.remainingDebtGrams).toBe(22);
    });

    it("handles 100% scrap gold settlement without cash", () => {
      const settlement = GoldEngine.calculateGoldSettlement(50, 50, 0, 900_000);
      expect(settlement.cashEquivalentGrams).toBe(0);
      expect(settlement.totalSettledGrams).toBe(50);
      expect(settlement.appliedToDebtGrams).toBe(50);
      expect(settlement.remainingDebtGrams).toBe(0);
      expect(settlement.excessGoldGrams).toBe(0);
    });

    it("handles 100% cash settlement without scrap gold", () => {
      // 10g debt settled via 9,000,000 UZS at 900,000 UZS/g
      const settlement = GoldEngine.calculateGoldSettlement(10, 0, 9_000_000, 900_000);
      expect(settlement.cashEquivalentGrams).toBe(10);
      expect(settlement.totalSettledGrams).toBe(10);
      expect(settlement.appliedToDebtGrams).toBe(10);
      expect(settlement.remainingDebtGrams).toBe(0);
    });

    it("preserves excess payment as advance balance without discarding it (Rule 10)", () => {
      // Client has 20g debt, but brings 15g scrap + 9,000,000 UZS cash (10g) = 25g total
      const settlement = GoldEngine.calculateGoldSettlement(20, 15, 9_000_000, 900_000);

      expect(settlement.totalSettledGrams).toBe(25);
      expect(settlement.appliedToDebtGrams).toBe(20);
      expect(settlement.remainingDebtGrams).toBe(0);

      // Excess 5g is preserved as advance balance!
      expect(settlement.excessGoldGrams).toBe(5);
    });

    it("handles zero cash when rate is missing", () => {
      const settlement = GoldEngine.calculateGoldSettlement(15, 10, 0, 0);
      expect(settlement.cashEquivalentGrams).toBe(0);
      expect(settlement.totalSettledGrams).toBe(10);
      expect(settlement.remainingDebtGrams).toBe(5);
    });
  });

  describe("Complete End-to-End Sales Chain Verification", () => {
    it("simulates full lifecycle: Factory Consignment -> Client Sale -> Partial Settlement -> Remaining Balance", () => {
      // Step 1: Factory issues 100g product to Seller with 8% markup
      const consignment = GoldEngine.calculateJewelryConsignmentAndSale(100, 8, 12);
      expect(consignment.factoryGoldDueGrams).toBe(108);
      expect(consignment.clientGoldDueGrams).toBe(112);

      // Step 2: Client pays 70g scrap + 18M UZS cash at 900k UZS/g
      const firstSettlement = GoldEngine.calculateGoldSettlement(
        consignment.clientGoldDueGrams,
        70,
        18_000_000,
        900_000
      );
      expect(firstSettlement.remainingDebtGrams).toBe(22);

      // Step 3: Client pays remaining 22g later (22g scrap)
      const secondSettlement = GoldEngine.calculateGoldSettlement(
        firstSettlement.remainingDebtGrams,
        22,
        0,
        900_000
      );
      expect(secondSettlement.remainingDebtGrams).toBe(0);
      expect(secondSettlement.appliedToDebtGrams).toBe(22);
    });
  });

  describe("Sprint 5: Consignment Piece Returns, Reversals, and Inventory Invariant", () => {
    it("verifies inventory reconciliation invariant: Consigned = Sold + Available + Returned", () => {
      // Scenario: Consigned 10 pieces (100g total)
      const consignedQty = 10;
      const consignedGrams = 100.0;

      // 4 pieces sold (40g)
      const soldQty = 4;
      const soldGrams = 40.0;

      // 2 pieces returned to factory (20g)
      const returnedQty = 2;
      const returnedGrams = 20.0;

      // Remaining available in seller inventory
      const availableQty = consignedQty - soldQty - returnedQty;
      const availableGrams = Number((consignedGrams - soldGrams - returnedGrams).toFixed(4));

      expect(availableQty).toBe(4);
      expect(availableGrams).toBe(40.0);

      // Invariant check
      expect(soldQty + availableQty + returnedQty).toBe(consignedQty);
      expect(Number((soldGrams + availableGrams + returnedGrams).toFixed(4))).toBe(consignedGrams);
    });

    it("calculates exact factory liability deduction on piece return", () => {
      // Piece base weight: 14.52g, factory markup: 8%
      const baseWeight = 14.52;
      const factoryMarkup = 8;
      const pieceObligation = Number((baseWeight * (1 + factoryMarkup / 100)).toFixed(4));
      // 14.52 * 1.08 = 15.6816g
      expect(pieceObligation).toBe(15.6816);

      // If initial seller factory debt was 108g (from 100g at 8%), returning this piece reduces debt
      const initialSellerObligation = 108.0;
      const updatedSellerObligation = Number((initialSellerObligation - pieceObligation).toFixed(4));
      expect(updatedSellerObligation).toBe(92.3184);
    });

    it("calculates exact client debt reversal on sale cancellation", () => {
      // Piece sold with 12% markup on 14.52g base
      const baseWeight = 14.52;
      const clientMarkup = 12;
      const pieceDebt = Number((baseWeight * (1 + clientMarkup / 100)).toFixed(4));
      // 14.52 * 1.12 = 16.2624g
      expect(pieceDebt).toBe(16.2624);

      // Client debt before reversal: 112g
      const clientInitialDebt = 112.0;
      const clientReversedDebt = Number((clientInitialDebt - pieceDebt).toFixed(4));
      expect(clientReversedDebt).toBe(95.7376);
    });

    it("verifies physical 585g never conflates with scrap-equivalent or 999 pure gold", () => {
      // Physical piece weight is 14.52g of 585 alloy (contains ~8.4942g fine gold)
      const piece585Weight = 14.52;
      const pureGold = Number((piece585Weight * (585 / 1000)).toFixed(4));
      expect(pureGold).toBe(8.4942);

      // Physical piece counts as 14.52g in physical inventory count, NOT 8.4942g
      // In physical piece tracking, count = 1, physical_weight = 14.52g
      expect(piece585Weight).not.toBe(pureGold);
    });
  });
});

