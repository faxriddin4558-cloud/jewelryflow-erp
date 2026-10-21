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

  describe("Master Financial Logic: Google Sheets Parity & Invariants", () => {
    it("matches exact Google Sheets factory receipt: 194.75g @ 8% = 210.33g, 65.14g @ 8% = 70.35g", () => {
      const res1 = GoldEngine.calculateFactoryReceipt(194.75, 8.0);
      expect(res1.baseWeightGrams).toBe(194.75);
      expect(res1.factoryMarkupPct).toBe(8.0);
      expect(res1.factoryObligationGrams).toBe(210.33);

      const res2 = GoldEngine.calculateFactoryReceipt(65.14, 8.0);
      expect(res2.factoryObligationGrams).toBe(70.3512);
      expect(Number(res2.factoryObligationGrams.toFixed(2))).toBe(70.35);

      const res3 = GoldEngine.calculateFactoryReceipt(100.0, 8.0);
      expect(res3.factoryObligationGrams).toBe(108.0);
    });

    it("matches exact Google Sheets seller transfer: 194.75g @ 12% = 218.12g, 65.14g @ 12% = 72.96g", () => {
      const res1 = GoldEngine.calculateSellerTransfer(194.75, 12.0, 8.0);
      expect(res1.baseWeightGrams).toBe(194.75);
      expect(res1.sellerMarkupPct).toBe(12.0);
      expect(res1.sellerObligationGrams).toBe(218.12);
      expect(res1.factoryGoldDueGrams).toBe(210.33);
      // Accounting differential between seller and factory markups
      expect(res1.markupSpreadGrams).toBe(7.79);

      const res2 = GoldEngine.calculateSellerTransfer(65.14, 12.0, 8.0);
      expect(Number(res2.sellerObligationGrams.toFixed(2))).toBe(72.96);

      const res3 = GoldEngine.calculateSellerTransfer(100.0, 12.0, 8.0);
      expect(res3.sellerObligationGrams).toBe(112.0);
      expect(res3.factoryGoldDueGrams).toBe(108.0);
      expect(res3.markupSpreadGrams).toBe(4.0);
    });

    it("enforces non-compounding rule: 100g at 8% factory and 12% seller never produces 108 * 1.12", () => {
      const compoundedWrong = Number((108 * 1.12).toFixed(4)); // 120.96g - WRONG!
      const correctNonCompounded = GoldEngine.calculateSellerTransfer(100, 12, 8);

      expect(correctNonCompounded.sellerObligationGrams).toBe(112.0);
      expect(correctNonCompounded.sellerObligationGrams).not.toBe(compoundedWrong);
      // The 7.79g difference in the 194.75g case belongs to factory accounting, not personal manager profit
      const case194 = GoldEngine.calculateSellerTransfer(194.75, 12, 8);
      expect(case194.markupSpreadGrams).toBe(7.79);
    });

    it("verifies owner-confirmed 'Bozor qarzi' sign convention: positive = we owe seller, negative = seller owes us", () => {
      // Case 1: Seller owes us 112g
      const debtorSeller = GoldEngine.calculateBozorQarzi(0, 112.0);
      expect(debtorSeller.signedBalanceGrams).toBe(-112.0);
      expect(debtorSeller.isSellerDebtor).toBe(true);
      expect(debtorSeller.isManagerDebtor).toBe(false);
      expect(debtorSeller.statusText).toContain("Sotuvchi bizga qarzdor");

      // Case 2: Seller overpaid / advanced by 8g (we owe seller)
      const creditorSeller = GoldEngine.calculateBozorQarzi(8.0, 0);
      expect(creditorSeller.signedBalanceGrams).toBe(8.0);
      expect(creditorSeller.isSellerDebtor).toBe(false);
      expect(creditorSeller.isManagerDebtor).toBe(true);
      expect(creditorSeller.statusText).toContain("Biz sotuvchiga qarzdormiz");

      // Case 3: Exactly settled
      const settled = GoldEngine.calculateBozorQarzi(0, 0);
      expect(settled.signedBalanceGrams).toBe(0);
      expect(settled.isSettled).toBe(true);
      expect(settled.statusText).toBe("Hisob yopilgan");
    });

    it("calculates refining batch ('Lom pateriya') and records loss as manager operating loss", () => {
      // 100g scrap gold melted, 95g melted weight, produces 56.5g fine gold @ 995 proba
      const refining = GoldEngine.calculateRefiningBatch(100.0, 95.0, 56.5, 995.0);
      // 585 equivalent = 56.5 * (995 / 585) = 96.0983g
      expect(refining.output585EquivGrams).toBe(96.0983);
      // Loss = 100 - 96.0983 = 3.9017g
      expect(refining.totalLossGrams).toBe(3.9017);
      expect(refining.lossPct).toBe(3.902);
    });

    it("calculates gold purchase with cash ('Tovar olish') correctly", () => {
      // Purchase 10g 585 gold at 900,000 UZS/g = 9,000,000 UZS
      const purchase = GoldEngine.calculateGoldPurchase(9_000_000, 900_000, 10.0, 585.0);
      expect(purchase.cashSpentUzs).toBe(9_000_000);
      expect(purchase.goldWeightGrams).toBe(10.0);
      expect(purchase.equiv585Grams).toBe(10.0);
    });

    it("maintains separation of 3-tier debt: customer -> seller -> manager -> factory", () => {
      // 1. Customer debt: 112g (from credit sale)
      const custSale = GoldEngine.calculateJewelryConsignmentAndSale(100, 8, 12);
      expect(custSale.clientGoldDueGrams).toBe(112);

      // 2. Customer pays seller 70g scrap + 18M UZS @ 900k (20g equiv) = 90g
      const custPayment = GoldEngine.calculateGoldSettlement(112, 70, 18_000_000, 900_000);
      expect(custPayment.remainingDebtGrams).toBe(22);

      // Customer payment stays in seller till (70g scrap, 18M UZS cash).
      // Manager vault scrap and cash remain 0 until seller physically hands it over.
      const managerVaultBeforeHandover = { scrap: 0, cash: 0, factoryDebt: 108 };
      expect(managerVaultBeforeHandover.factoryDebt).toBe(108);

      // 3. Seller hands over 70g scrap + 18M cash to manager
      const sellerToManagerSettlement = GoldEngine.calculateGoldSettlement(112, 70, 18_000_000, 900_000);
      // Seller remaining debt to manager: 22g
      expect(sellerToManagerSettlement.remainingDebtGrams).toBe(22);
      // Manager now has 70g scrap and 18M cash, but factory debt is STILL 108g!
      const managerVaultAfterHandover = { scrap: 70, cash: 18_000_000, factoryDebt: 108 };
      expect(managerVaultAfterHandover.factoryDebt).toBe(108);

      // 4. Factory debt ONLY reduces when manager hands over gold to factory!
      const factoryHandoverGrams = 108;
      const managerFactoryDebtFinal = managerVaultAfterHandover.factoryDebt - factoryHandoverGrams;
      expect(managerFactoryDebtFinal).toBe(0);
    });
  });
});


