import { describe, it, expect } from "vitest";
import { GoldEngine } from "../erp-engine";

describe("JewelryFlow Sales — Sprint 2 & 3 Dynamic Markups & Calculations", () => {
  it("enforces non-compounding base weight rule across diverse arbitrary dynamic markups", () => {
    const baseWeight = 25.5; // 25.5 grams
    const markups = [6, 8, 10, 12, 14.5, 15, 18, 22, 25, 30];

    for (const fPct of markups) {
      for (const cPct of markups) {
        const result = GoldEngine.calculateJewelryConsignmentAndSale(baseWeight, fPct, cPct);

        // Factory due must be exactly baseWeight * (1 + fPct / 100)
        const expectedFactoryDue = Number((baseWeight * (1 + fPct / 100)).toFixed(4));
        expect(result.factoryGoldDueGrams).toBe(expectedFactoryDue);

        // Client due must be calculated directly from baseWeight, NEVER from factory due!
        const expectedClientDue = Number((baseWeight * (1 + cPct / 100)).toFixed(4));
        expect(result.clientGoldDueGrams).toBe(expectedClientDue);

        // Markup spread is the exact accounting differential
        const expectedSpread = Number((expectedClientDue - expectedFactoryDue).toFixed(4));
        expect(result.markupSpreadGrams).toBe(expectedSpread);

        // Verify that compounding was NOT done
        if (fPct > 0 && cPct > 0) {
          const forbiddenCompounded = Number((expectedFactoryDue * (1 + cPct / 100)).toFixed(4));
          expect(result.clientGoldDueGrams).not.toBe(forbiddenCompounded);
        }
      }
    }
  });

  it("handles live settlement conversion of cash + scrap gold under confirmed rate", () => {
    const clientDebt = 28.5600; // 28.56g gold debt
    const scrapWeight = 15.0000; // 15g 585 scrap paid
    const cashAmount = 9000000; // 9,000,000 UZS
    const ratePerGram = 900000; // 900,000 UZS/g

    const calc = GoldEngine.calculateGoldSettlement(clientDebt, scrapWeight, cashAmount, ratePerGram);

    // Cash 9M / 900k = exactly 10.0000g
    expect(calc.cashEquivalentGrams).toBe(10.0000);
    // Total settled = 15 + 10 = 25.0000g
    expect(calc.totalSettledGrams).toBe(25.0000);
    // Applied to debt = 25.0000g
    expect(calc.appliedToDebtGrams).toBe(25.0000);
    // Remaining debt = 28.56 - 25 = 3.5600g
    expect(calc.remainingDebtGrams).toBe(3.5600);
    // Excess = 0
    expect(calc.excessGoldGrams).toBe(0);
  });

  it("preserves excess overpayment as advance balance without discarding (Rule 10)", () => {
    const clientDebt = 10.0000;
    const scrapWeight = 8.0000;
    const cashAmount = 4500000; // 4.5M at 900k = 5g
    const ratePerGram = 900000;

    const calc = GoldEngine.calculateGoldSettlement(clientDebt, scrapWeight, cashAmount, ratePerGram);

    // Total settled = 8 + 5 = 13.0000g
    expect(calc.totalSettledGrams).toBe(13.0000);
    // Debt fully paid: remaining = 0
    expect(calc.remainingDebtGrams).toBe(0);
    expect(calc.appliedToDebtGrams).toBe(10.0000);
    // Excess preserved = 13 - 10 = 3.0000g
    expect(calc.excessGoldGrams).toBe(3.0000);
  });

  it("calculates seller-to-factory surrender correctly reducing factory obligation", () => {
    const factoryObligation = 108.0000; // 100g product issued at +8%
    const surrenderedScrap = 70.0000;
    const surrenderedCash = 18000000; // 18M UZS
    const rate = 900000;

    const calc = GoldEngine.calculateGoldSettlement(factoryObligation, surrenderedScrap, surrenderedCash, rate);

    expect(calc.cashEquivalentGrams).toBe(20.0000);
    expect(calc.totalSettledGrams).toBe(90.0000);
    expect(calc.remainingDebtGrams).toBe(18.0000); // 108 - 90 = 18g
  });
});
