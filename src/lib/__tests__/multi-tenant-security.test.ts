import { describe, it, expect } from "vitest";
import {
  initiateHandoverDispatch,
  verifyAndAcceptHandover,
  overrideHandoverDiscrepancy,
  DEFAULT_HANDOVER_TOLERANCE_GRAM,
} from "../two-party-handover";
import {
  getActiveFactoryConfig,
  isStageActive,
  getNextActiveStage,
  type FactoryConfig,
} from "../factory-config";

describe("Multi-Tenant Security & Two-Party Handover Protocol Contract Tests", () => {
  describe("1. Multi-Tenant Pipeline & Stage Configuration Isolation", () => {
    it("enforces Goldia factory defaults: Pumice and Zircon are disabled", () => {
      const goldiaConfig = getActiveFactoryConfig();
      expect(goldiaConfig.factoryId).toBe("goldia");
      expect(goldiaConfig.disabledStageOrders).toContain(9);
      expect(goldiaConfig.disabledStageOrders).toContain(13);
      expect(goldiaConfig.disabledStageCodes).toContain("PUMICE");
      expect(goldiaConfig.disabledStageCodes).toContain("ZIRCON");

      // Verify Ponza and Zircon are bypassed in active stage evaluation
      expect(isStageActive({ stage_order: 9, name: "9. Ponza", code: "PUMICE" })).toBe(false);
      expect(isStageActive({ stage_order: 13, name: "13. Zirkon terish", code: "ZIRCON" })).toBe(false);
      expect(isStageActive({ stage_order: 8, name: "8. Quyish", code: "CASTING" })).toBe(true);
      expect(isStageActive({ stage_order: 10, name: "10. Yig'uv", code: "ASSEMBLY" })).toBe(true);
    });

    it("allows a different tenant to enable Pumice and Zircon without affecting Goldia", () => {
      const customTenantConfig: FactoryConfig = {
        factoryId: "custom-tenant-uuid",
        factoryName: "Full Pipeline Factory",
        disabledStageCodes: [], // No stages disabled!
        disabledStageOrders: [],
        disabledDepartmentSlugs: [],
        laserMachinesCount: 4,
        castingMachinesCount: 1,
        workersCount: 20,
        maxModelsPerBatch: 10,
        setsPerModel: 5,
      };

      // Under custom config, stage 9 is active
      const isStage9ActiveForCustom = isStageActive(
        { stage_order: 9, name: "9. Ponza", code: "PUMICE" },
        customTenantConfig
      );
      expect(isStage9ActiveForCustom).toBe(true);

      // But Goldia still disables it
      expect(isStageActive({ stage_order: 9, name: "9. Ponza", code: "PUMICE" })).toBe(false);
    });

    it("advances directly from stage 8 (Casting) to stage 10 (Assembly) for Goldia", () => {
      const dummyStages = [
        { id: "s-8", stage_order: 8, name: "8. Quyish", department: "Quyish", is_active: true },
        { id: "s-9", stage_order: 9, name: "9. Ponza", department: "Ponza", is_active: true },
        { id: "s-10", stage_order: 10, name: "10. Yig'uv", department: "Yig'uv", is_active: true },
      ];

      const nextStage = getNextActiveStage(8, dummyStages);
      expect(nextStage).not.toBeNull();
      expect(nextStage?.stage_order).toBe(10);
      expect(nextStage?.name).toBe("10. Yig'uv");
    });
  });

  describe("2. Two-Party Handover Chain-of-Custody & Discrepancy Gate", () => {
    const baseDispatch = {
      batchId: "batch-101",
      batchNo: "B-2026-001",
      fromStageOrder: 8,
      fromStageName: "8. Quyish",
      fromDepartment: "Quyish",
      toStageOrder: 10,
      toStageName: "10. Yig'uv",
      toDepartment: "Yig'uv",
      senderWorkerId: "emp-sender-1",
      senderWorkerName: "Rustam Usta",
      dispatchedQty: 200,
      dispatchedWeightGram: 450.0,
    };

    it("dispatches stage handover into PENDING_ACCEPTANCE with default 0.05g tolerance", () => {
      const record = initiateHandoverDispatch(baseDispatch);
      expect(record.status).toBe("PENDING_ACCEPTANCE");
      expect(record.toleranceGram).toBe(DEFAULT_HANDOVER_TOLERANCE_GRAM);
      expect(record.dispatchedQty).toBe(200);
      expect(record.dispatchedWeightGram).toBe(450.0);
      expect(record.receivedQty).toBeNull();
      expect(record.receivedWeightGram).toBeNull();
    });

    it("accepts handover automatically when receiver weight is within 0.05g tolerance", () => {
      const record = initiateHandoverDispatch(baseDispatch);

      // Receiver receives exact quantity and 450.03g (diff = +0.03g <= 0.05g tolerance)
      const accepted = verifyAndAcceptHandover(record, {
        handoverId: record.id,
        receiverWorkerId: "emp-rec-1",
        receiverWorkerName: "Jamshid Usta",
        receivedQty: 200,
        receivedWeightGram: 450.03,
      });

      expect(accepted.status).toBe("ACCEPTED");
      expect(accepted.weightDiscrepancyGram).toBe(0.03);
      expect(accepted.flagReason).toBeNull();
      expect(accepted.resolvedAt).not.toBeNull();
    });

    it("flags DISCREPANCY_FLAGGED when receiver weight discrepancy exceeds 0.05g tolerance", () => {
      const record = initiateHandoverDispatch(baseDispatch);

      // Receiver receives 449.90g (diff = 0.10g > 0.05g tolerance)
      const flagged = verifyAndAcceptHandover(record, {
        handoverId: record.id,
        receiverWorkerId: "emp-rec-1",
        receiverWorkerName: "Jamshid Usta",
        receivedQty: 200,
        receivedWeightGram: 449.9,
      });

      expect(flagged.status).toBe("DISCREPANCY_FLAGGED");
      expect(flagged.weightDiscrepancyGram).toBe(0.1);
      expect(flagged.flagReason).toMatch(/exceeds allowable tolerance/);
    });

    it("flags DISCREPANCY_FLAGGED when pieces quantity mismatches even if weight matches", () => {
      const record = initiateHandoverDispatch(baseDispatch);

      // Sent 200 pcs, receiver reports 199 pcs
      const flagged = verifyAndAcceptHandover(record, {
        handoverId: record.id,
        receiverWorkerId: "emp-rec-1",
        receiverWorkerName: "Jamshid Usta",
        receivedQty: 199,
        receivedWeightGram: 450.0,
      });

      expect(flagged.status).toBe("DISCREPANCY_FLAGGED");
      expect(flagged.flagReason).toMatch(/Quantity mismatch: sent 200 items, received 199 items/);
    });

    it("prevents duplicate acceptance on already resolved handover", () => {
      const record = initiateHandoverDispatch(baseDispatch);
      const accepted = verifyAndAcceptHandover(record, {
        handoverId: record.id,
        receiverWorkerId: "emp-rec-1",
        receiverWorkerName: "Jamshid Usta",
        receivedQty: 200,
        receivedWeightGram: 450.0,
      });

      expect(() =>
        verifyAndAcceptHandover(accepted, {
          handoverId: record.id,
          receiverWorkerId: "emp-rec-1",
          receiverWorkerName: "Jamshid Usta",
          receivedQty: 200,
          receivedWeightGram: 450.0,
        })
      ).toThrowError(/Cannot accept handover in 'ACCEPTED' state/);
    });

    it("allows supervisor to override a flagged handover with required reason", () => {
      const record = initiateHandoverDispatch(baseDispatch);
      const flagged = verifyAndAcceptHandover(record, {
        handoverId: record.id,
        receiverWorkerId: "emp-rec-1",
        receiverWorkerName: "Jamshid Usta",
        receivedQty: 200,
        receivedWeightGram: 449.85, // 0.15g discrepancy
      });
      expect(flagged.status).toBe("DISCREPANCY_FLAGGED");

      const overridden = overrideHandoverDiscrepancy(
        flagged,
        "supervisor-admin-01",
        "Investigated: Sprue cutting residue verified in catch-tray; variance accounted."
      );

      expect(overridden.status).toBe("SUPERVISOR_OVERRIDDEN");
      expect(overridden.supervisorOverrideWorkerId).toBe("supervisor-admin-01");
      expect(overridden.supervisorOverrideReason).toContain("Sprue cutting residue verified");
    });

    it("rejects supervisor override if justification is empty or shorter than 5 characters", () => {
      const record = initiateHandoverDispatch(baseDispatch);
      const flagged = verifyAndAcceptHandover(record, {
        handoverId: record.id,
        receiverWorkerId: "emp-rec-1",
        receiverWorkerName: "Jamshid Usta",
        receivedQty: 200,
        receivedWeightGram: 449.85,
      });

      expect(() => overrideHandoverDiscrepancy(flagged, "sup-1", "")).toThrowError(
        /documented investigation reason \(min 5 chars\)/
      );
      expect(() => overrideHandoverDiscrepancy(flagged, "sup-1", "ok")).toThrowError(
        /documented investigation reason \(min 5 chars\)/
      );
    });
  });
});
