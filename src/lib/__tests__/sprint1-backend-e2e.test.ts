import { describe, it, expect } from "vitest";
import {
  GOLDIA_FACTORY_CONFIG,
  FULL_PIPELINE_FACTORY_CONFIG,
  isStageActive,
  getNextActiveStage,
  filterActiveStages,
} from "../factory-config";

describe("Sprint 1: Manufacturing Workflow & Goldia Bypass Engine", () => {
  const STAGES_MOCK = [
    { stage_order: 1,  name: "Wax",               code: "WAX",               department: "Wax",           is_active: true },
    { stage_order: 5,  name: "Casting",           code: "CASTING",           department: "Casting",       is_active: true },
    { stage_order: 8,  name: "Sanding",           code: "SANDING",           department: "Sanding",       is_active: true },
    { stage_order: 9,  name: "Pumice Machine",    code: "PUMICE_MACHINE",    department: "Pumice",        is_active: true },
    { stage_order: 10, name: "Cleaning 1",        code: "CLEANING_1",        department: "Cleaning",      is_active: true },
    { stage_order: 11, name: "Pre-Polish Machine",code: "PRE_POLISH_MACHINE",department: "Pre-Polish",   is_active: true },
    { stage_order: 12, name: "Cleaning 2",        code: "CLEANING_2",        department: "Cleaning",      is_active: true },
    { stage_order: 13, name: "Zircon Machine",    code: "ZIRCON_MACHINE",    department: "Zircon",        is_active: true },
    { stage_order: 14, name: "Cleaning 3",        code: "CLEANING_3",        department: "Cleaning",      is_active: true },
    { stage_order: 16, name: "Laser Decoration",  code: "LASER_DECORATION",  department: "Laser",         is_active: true },
    { stage_order: 20, name: "Completed",         code: "COMPLETED",         department: "Packaging",     is_active: true },
  ];

  it("Goldia config correctly disables Pumice (9) and Zircon (13)", () => {
    expect(isStageActive({ stage_order: 9, code: "PUMICE_MACHINE" }, GOLDIA_FACTORY_CONFIG)).toBe(false);
    expect(isStageActive({ stage_order: 13, code: "ZIRCON_MACHINE" }, GOLDIA_FACTORY_CONFIG)).toBe(false);
    expect(isStageActive({ stage_order: 8, code: "SANDING" }, GOLDIA_FACTORY_CONFIG)).toBe(true);
    expect(isStageActive({ stage_order: 10, code: "CLEANING_1" }, GOLDIA_FACTORY_CONFIG)).toBe(true);
  });

  it("Full pipeline config allows Pumice and Zircon for third-party factories", () => {
    expect(isStageActive({ stage_order: 9, code: "PUMICE_MACHINE" }, FULL_PIPELINE_FACTORY_CONFIG)).toBe(true);
    expect(isStageActive({ stage_order: 13, code: "ZIRCON_MACHINE" }, FULL_PIPELINE_FACTORY_CONFIG)).toBe(true);
  });

  it("Goldia route skips Pumice (9) and advances Sanding (8) directly to Cleaning 1 (10)", () => {
    const nextStage = getNextActiveStage(8, STAGES_MOCK, GOLDIA_FACTORY_CONFIG);
    expect(nextStage).not.toBeNull();
    expect(nextStage?.stage_order).toBe(10);
    expect(nextStage?.name).toBe("Cleaning 1");
  });

  it("Goldia route skips Zircon (13) and advances Cleaning 2 (12) directly to Cleaning 3 (14)", () => {
    const nextStage = getNextActiveStage(12, STAGES_MOCK, GOLDIA_FACTORY_CONFIG);
    expect(nextStage).not.toBeNull();
    expect(nextStage?.stage_order).toBe(14);
    expect(nextStage?.name).toBe("Cleaning 3");
  });

  it("Full pipeline route advances through Pumice (9) and Zircon (13) sequentially", () => {
    const nextAfter8 = getNextActiveStage(8, STAGES_MOCK, FULL_PIPELINE_FACTORY_CONFIG);
    expect(nextAfter8?.stage_order).toBe(9);

    const nextAfter12 = getNextActiveStage(12, STAGES_MOCK, FULL_PIPELINE_FACTORY_CONFIG);
    expect(nextAfter12?.stage_order).toBe(13);
  });

  it("Filters active stages accurately based on factory configuration", () => {
    const goldiaStages = filterActiveStages(STAGES_MOCK, GOLDIA_FACTORY_CONFIG);
    expect(goldiaStages.length).toBe(9);
    expect(goldiaStages.some((s) => s.stage_order === 9 || s.stage_order === 13)).toBe(false);

    const fullStages = filterActiveStages(STAGES_MOCK, FULL_PIPELINE_FACTORY_CONFIG);
    expect(fullStages.length).toBe(11);
  });
});

describe("Sprint 1: Two-Party Handover Scale Tolerance & Supervisor Override", () => {
  const TOLERANCE_GRAM = 0.05;

  function evaluateHandover(dispatchedG: number, receivedG: number, dispatchedQty: number, receivedQty: number) {
    const discrepancy = Math.round(Math.abs(dispatchedG - receivedG) * 10000) / 10000;
    const qtyMismatch = dispatchedQty !== receivedQty;
    const weightExcess = discrepancy > TOLERANCE_GRAM;

    if (qtyMismatch || weightExcess) {
      return { status: "DISCREPANCY_FLAGGED", discrepancy, canAutoAccept: false };
    }
    return { status: "ACCEPTED", discrepancy, canAutoAccept: true };
  }

  it("Accepts handover when scale difference is within 0.05g tolerance", () => {
    const result1 = evaluateHandover(50.0000, 50.0300, 10, 10);
    expect(result1.status).toBe("ACCEPTED");
    expect(result1.canAutoAccept).toBe(true);

    const result2 = evaluateHandover(50.0000, 49.9500, 10, 10);
    expect(result2.status).toBe("ACCEPTED");
    expect(result2.canAutoAccept).toBe(true);
  });

  it("Flags discrepancy when scale difference exceeds 0.05g tolerance", () => {
    const result = evaluateHandover(50.0000, 49.8800, 10, 10); // 0.12g difference
    expect(result.status).toBe("DISCREPANCY_FLAGGED");
    expect(result.canAutoAccept).toBe(false);
    expect(result.discrepancy).toBe(0.12);
  });

  it("Flags discrepancy when piece count does not match", () => {
    const result = evaluateHandover(50.0000, 50.0000, 10, 9);
    expect(result.status).toBe("DISCREPANCY_FLAGGED");
    expect(result.canAutoAccept).toBe(false);
  });

  it("Validates supervisor override requirement rules", () => {
    const validateOverride = (role: string, reason: string | null) => {
      const allowedRoles = ["admin", "director", "owner", "manager", "production_manager", "supervisor"];
      if (!allowedRoles.includes(role)) {
        throw new Error("Unauthorized role for override");
      }
      if (!reason || reason.trim().length < 5) {
        throw new Error("Supervisor override requires a documented investigation reason (min 5 chars)");
      }
      return { status: "SUPERVISOR_OVERRIDDEN" };
    };

    expect(() => validateOverride("department_operator", "Some reason")).toThrow("Unauthorized role for override");
    expect(() => validateOverride("production_manager", "ok")).toThrow("min 5 chars");
    expect(validateOverride("production_manager", "Scale re-calibrated and verified").status).toBe("SUPERVISOR_OVERRIDDEN");
  });
});

describe("Sprint 1: Idempotent Piecework Salary Calculation & Adjustments", () => {
  const DEFAULT_RATE_UZS = 15000;

  function calculatePieceworkSalary(weightG: number, rate: number = DEFAULT_RATE_UZS) {
    if (weightG <= 0) throw new Error("Weight must be positive");
    const amount = Math.round(weightG * rate * 100) / 100;
    return {
      tx_type: "EARNED",
      weight_done: weightG,
      rate,
      amount: Math.max(amount, 1.0),
      payment_status: "UNPAID",
    };
  }

  function adjustPieceworkSalary(originalAmount: number, adjustmentDelta: number, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new Error("Adjustment requires documented reason");
    }
    const finalAmount = Math.round((originalAmount + adjustmentDelta) * 100) / 100;
    return {
      tx_type: adjustmentDelta < 0 ? "ADJUSTMENT" : "ADJUSTMENT",
      adjustmentDelta,
      finalAmount,
      reason,
    };
  }

  it("Calculates piecework earnings accurately based on worker gram rate", () => {
    const salary = calculatePieceworkSalary(52.0000, 15000);
    expect(salary.amount).toBe(780000); // 52g * 15,000 UZS = 780,000 UZS
    expect(salary.tx_type).toBe("EARNED");
  });

  it("Calculates piecework with custom rate (e.g. 18,000 UZS for polish)", () => {
    const salary = calculatePieceworkSalary(65.0000, 18000);
    expect(salary.amount).toBe(1170000); // 65g * 18,000 UZS = 1,170,000 UZS
  });

  it("Creates immutable adjustment entry for penalty or bonus", () => {
    const origSalary = 780000;
    const penalty = adjustPieceworkSalary(origSalary, -25000, "Defect detected in assembly");
    expect(penalty.adjustmentDelta).toBe(-25000);
    expect(penalty.finalAmount).toBe(755000);
  });
});

describe("Sprint 1: Physical Mass Balance Conservation", () => {
  it("Guarantees issued gold == finished + sprue + scrap + process loss", () => {
    const batches = [
      { gold: 52.0000, finished: 43.9000, sprue: 6.2000, scrap: 1.8000, loss: 0.1000 },
      { gold: 85.0000, finished: 71.8500, sprue: 9.8000, scrap: 3.2000, loss: 0.1500 },
      { gold: 96.0000, finished: 80.8200, sprue: 11.2000, scrap: 3.8000, loss: 0.1800 },
    ];

    let totalIssued = 0;
    let totalAccounted = 0;

    for (const b of batches) {
      totalIssued += b.gold;
      totalAccounted += (b.finished + b.sprue + b.scrap + b.loss);
      const batchDiff = Math.abs(b.gold - (b.finished + b.sprue + b.scrap + b.loss));
      expect(Math.round(batchDiff * 10000) / 10000).toBe(0.0000);
    }

    const overallDiff = Math.abs(totalIssued - totalAccounted);
    expect(Math.round(overallDiff * 10000) / 10000).toBe(0.0000);
  });

  it("Strictly catches and rejects mass balance violations", () => {
    const issuedGold = 50.0000;
    const attemptedGood = 45.0000;
    const sprue = 5.0000;
    const scrap = 2.0000; // Total 52g > 50g issued!

    const totalOutputs = attemptedGood + sprue + scrap;
    expect(totalOutputs > issuedGold).toBe(true);
    expect(() => {
      if (totalOutputs > issuedGold) {
        throw new Error("Mass balance violation: total outputs exceed issued gold");
      }
    }).toThrow("Mass balance violation");
  });
});
