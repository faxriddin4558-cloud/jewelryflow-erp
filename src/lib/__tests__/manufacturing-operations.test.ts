import { describe, it, expect } from "vitest";
import {
  createStandardHighDensityBatchPlan,
  validateHighDensityBatchPlan,
  distributeCastingWeightToModels,
} from "@/lib/batch-density";
import {
  initiateHandoverDispatch,
  verifyAndAcceptHandover,
  overrideHandoverDiscrepancy,
  DEFAULT_HANDOVER_TOLERANCE_GRAM,
} from "@/lib/two-party-handover";
import {
  getStandardGoldiaStations,
  findOptimalStation,
  assignTaskToStation,
  completeStationTask,
  type MachineQueueTask,
} from "@/lib/machine-queue";
import { GoldEngine } from "@/lib/erp-engine";

describe("Manufacturing Operations — High Density Batches, Two-Party Handover & Machine Queues", () => {
  describe("1. High-Density Multi-Model Batch Management (15-20 Models, 10 Sets Each)", () => {
    it("creates a standard high-density batch plan with 20 models and 10 sets per model (200 sets)", () => {
      const modelsInput = Array.from({ length: 20 }, (_, i) => ({
        modelId: `m-${i + 1}`,
        modelCode: `RNG-2026-${(i + 1).toString().padStart(3, "0")}`,
        modelName: `Ring Model #${i + 1}`,
        targetWeightPerSetGram: 5.5,
        piecesPerSet: 1,
        setsCount: 10,
      }));

      // Total target weight = 20 * 10 * 5.5 = 1100 g
      const plan = createStandardHighDensityBatchPlan({
        batchNo: "B-2026-MULTI-01",
        models: modelsInput,
        issuedGoldGram: 1100,
        proba: 585,
      });

      expect(plan.totalModelsCount).toBe(20);
      expect(plan.totalSetsCount).toBe(200);
      expect(plan.totalPiecesCount).toBe(200);
      expect(plan.models.length).toBe(20);
      expect(plan.models[0]!.setsCount).toBe(10);

      const validation = validateHighDensityBatchPlan(plan);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("rejects batches with more than 20 models or negative sets", () => {
      const excessModels = Array.from({ length: 22 }, (_, i) => ({
        modelId: `m-${i}`,
        modelCode: `M-${i}`,
        modelName: `Model ${i}`,
        targetWeightPerSetGram: 4.0,
        piecesPerSet: 1,
        setsCount: 10,
      }));

      const plan = createStandardHighDensityBatchPlan({
        batchNo: "B-EXCESS",
        models: excessModels,
        issuedGoldGram: 1000,
      });

      const validation = validateHighDensityBatchPlan(plan, 20);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some((e) => e.includes("exceeds maximum limit"))).toBe(true);
    });

    it("distributes actual casting weight proportionally across models", () => {
      const modelsInput = [
        {
          modelId: "m-1",
          modelCode: "M-1",
          modelName: "Model 1",
          targetWeightPerSetGram: 5.0,
          setsCount: 10,
          piecesPerSet: 1,
          totalPieces: 10,
          totalTargetWeightGram: 50.0,
          status: "pending" as const,
        },
        {
          modelId: "m-2",
          modelCode: "M-2",
          modelName: "Model 2",
          targetWeightPerSetGram: 10.0,
          setsCount: 10,
          piecesPerSet: 1,
          totalPieces: 10,
          totalTargetWeightGram: 100.0,
          status: "pending" as const,
        },
      ];

      // Total target = 150g (M-1 = 1/3, M-2 = 2/3)
      // Actual casting tree yielded 147g
      const distribution = distributeCastingWeightToModels(147.0, modelsInput);
      expect(distribution).toHaveLength(2);
      expect(distribution[0]!.allocatedWeightGram).toBeCloseTo(49.0, 2);
      expect(distribution[1]!.allocatedWeightGram).toBeCloseTo(98.0, 2);
      expect(distribution[0]!.weightPerSetGram).toBeCloseTo(4.9, 2);
      expect(distribution[1]!.weightPerSetGram).toBeCloseTo(9.8, 2);
    });
  });

  describe("2. Two-Party Handover & Discrepancy Flagging Protocol", () => {
    it("successfully creates and verifies a handover within standard 0.05g tolerance", () => {
      const dispatch = initiateHandoverDispatch({
        batchId: "batch-101",
        batchNo: "B-101",
        fromStageOrder: 8,
        fromStageName: "8. Sanding",
        fromDepartment: "Sanding",
        toStageOrder: 11,
        toStageName: "11. Pre-Polish",
        toDepartment: "Pre-Polish",
        senderWorkerId: "emp-sanding-1",
        senderWorkerName: "Sardor (Sanding)",
        targetReceiverWorkerId: "emp-polish-1",
        targetReceiverWorkerName: "Jasur (Polisher)",
        dispatchedQty: 10,
        dispatchedWeightGram: 55.42,
      });

      expect(dispatch.status).toBe("PENDING_ACCEPTANCE");
      expect(dispatch.toleranceGram).toBe(DEFAULT_HANDOVER_TOLERANCE_GRAM);

      // Receiver receives exactly 55.40g (difference = 0.02g <= 0.05g)
      const accepted = verifyAndAcceptHandover(dispatch, {
        handoverId: dispatch.id,
        receiverWorkerId: "emp-polish-1",
        receiverWorkerName: "Jasur (Polisher)",
        receivedQty: 10,
        receivedWeightGram: 55.40,
      });

      expect(accepted.status).toBe("ACCEPTED");
      expect(accepted.weightDiscrepancyGram).toBe(0.02);
      expect(accepted.flagReason).toBeNull();
      expect(accepted.resolvedAt).not.toBeNull();
    });

    it("flags DISCREPANCY_FLAGGED when measured weight exceeds 0.05g tolerance", () => {
      const dispatch = initiateHandoverDispatch({
        batchId: "batch-102",
        batchNo: "B-102",
        fromStageOrder: 5,
        fromStageName: "5. Casting",
        fromDepartment: "Quyish",
        toStageOrder: 8,
        toStageName: "8. Sanding",
        toDepartment: "Sanding",
        senderWorkerId: "emp-cast-1",
        senderWorkerName: "Otabek (Casting)",
        dispatchedQty: 20,
        dispatchedWeightGram: 120.50,
      });

      // Receiver measures 120.25g (difference = 0.25g > 0.05g tolerance)
      const flagged = verifyAndAcceptHandover(dispatch, {
        handoverId: dispatch.id,
        receiverWorkerId: "emp-sand-1",
        receiverWorkerName: "Sardor (Sanding)",
        receivedQty: 20,
        receivedWeightGram: 120.25,
      });

      expect(flagged.status).toBe("DISCREPANCY_FLAGGED");
      expect(flagged.weightDiscrepancyGram).toBe(0.25);
      expect(flagged.flagReason).toContain("Weight discrepancy of 0.25g exceeds allowable tolerance");
    });

    it("flags DISCREPANCY_FLAGGED when item quantities do not match", () => {
      const dispatch = initiateHandoverDispatch({
        batchId: "batch-103",
        batchNo: "B-103",
        fromStageOrder: 8,
        fromStageName: "8. Sanding",
        fromDepartment: "Sanding",
        toStageOrder: 11,
        toStageName: "11. Pre-Polish",
        toDepartment: "Pre-Polish",
        senderWorkerId: "emp-1",
        senderWorkerName: "Sender Worker",
        dispatchedQty: 10,
        dispatchedWeightGram: 50.00,
      });

      // Receiver only found 9 items
      const flagged = verifyAndAcceptHandover(dispatch, {
        handoverId: dispatch.id,
        receiverWorkerId: "emp-2",
        receiverWorkerName: "Receiver Worker",
        receivedQty: 9,
        receivedWeightGram: 45.00,
      });

      expect(flagged.status).toBe("DISCREPANCY_FLAGGED");
      expect(flagged.flagReason).toContain("Quantity mismatch");
    });

    it("allows supervisor to override a flagged handover with an audit justification", () => {
      const dispatch = initiateHandoverDispatch({
        batchId: "batch-104",
        batchNo: "B-104",
        fromStageOrder: 8,
        fromStageName: "8. Sanding",
        fromDepartment: "Sanding",
        toStageOrder: 11,
        toStageName: "11. Pre-Polish",
        toDepartment: "Pre-Polish",
        senderWorkerId: "emp-1",
        senderWorkerName: "Sender",
        dispatchedQty: 10,
        dispatchedWeightGram: 50.00,
      });

      const flagged = verifyAndAcceptHandover(dispatch, {
        handoverId: dispatch.id,
        receiverWorkerId: "emp-2",
        receiverWorkerName: "Receiver",
        receivedQty: 10,
        receivedWeightGram: 49.85,
      });

      expect(flagged.status).toBe("DISCREPANCY_FLAGGED");

      const overridden = overrideHandoverDiscrepancy(
        flagged,
        "director-admin",
        "Investigated: 0.15g gate filings collected and weighed separately at sanding bench"
      );

      expect(overridden.status).toBe("SUPERVISOR_OVERRIDDEN");
      expect(overridden.supervisorOverrideWorkerId).toBe("director-admin");
      expect(overridden.supervisorOverrideReason).toContain("gate filings collected");
    });
  });

  describe("3. Machine Station Scheduling (8 Lasers, 2 Casting)", () => {
    it("initializes 8 laser machines and 2 casting stations matching Goldia plant specifications", () => {
      const stations = getStandardGoldiaStations();
      expect(stations).toHaveLength(10);

      const lasers = stations.filter((s) => s.type === "LASER");
      const casting = stations.filter((s) => s.type === "CASTING");

      expect(lasers).toHaveLength(8);
      expect(casting).toHaveLength(2);
      expect(lasers.every((l) => l.department === "Lazer")).toBe(true);
      expect(casting.every((c) => c.department === "Quyish")).toBe(true);
    });

    it("allocates task to the first available IDLE laser station and updates state", () => {
      const stations = getStandardGoldiaStations();
      const task: MachineQueueTask = {
        taskId: "task-laser-01",
        batchNo: "B-2026-MULTI-01",
        qtyPcs: 50,
        weightGram: 250.0,
        priority: "HIGH",
        status: "QUEUED",
        queuedAt: new Date().toISOString(),
      };

      const optimalStation = findOptimalStation(stations, "LASER", []);
      expect(optimalStation).not.toBeNull();
      expect(optimalStation?.code).toBe("LASER-01");

      const { updatedTask, updatedStation } = assignTaskToStation(
        task,
        optimalStation!,
        "Bekzod (Laser Master)"
      );

      expect(updatedTask.status).toBe("IN_PROGRESS");
      expect(updatedTask.assignedMachineId).toBe("laser-01");
      expect(updatedStation.status).toBe("BUSY");
      expect(updatedStation.currentBatchNo).toBe("B-2026-MULTI-01");
      expect(updatedStation.assignedOperator).toBe("Bekzod (Laser Master)");

      // Completing the task frees the machine
      const completed = completeStationTask(updatedTask, updatedStation);
      expect(completed.updatedTask.status).toBe("COMPLETED");
      expect(completed.updatedStation.status).toBe("IDLE");
      expect(completed.updatedStation.currentBatchNo).toBeNull();
    });
  });

  describe("4. Precision Mass Balance & Stage Loss Hardening", () => {
    it("validates that normal operational stage loss within tolerance is ACCEPTABLE", () => {
      // 100g input, 0.40g loss (0.4% <= 1.0% limit, 0.40g <= 0.50g limit)
      const res = GoldEngine.validateStageLoss({
        inputWeightGram: 100.0,
        lossWeightGram: 0.4,
        maxLossPct: 1.0,
        maxLossGram: 0.5,
      });

      expect(res.isAcceptable).toBe(true);
      expect(res.status).toBe("ACCEPTABLE");
      expect(res.excessLossGram).toBe(0);
      expect(res.lossPct).toBe(0.4);
    });

    it("flags EXCESSIVE_LOSS_ALERT when loss exceeds allowed stage percentage or gram limit", () => {
      // 100g input, 1.20g loss (1.2% > 1.0% limit, 1.20g > 0.50g limit)
      const res = GoldEngine.validateStageLoss({
        inputWeightGram: 100.0,
        lossWeightGram: 1.2,
        maxLossPct: 1.0,
        maxLossGram: 0.5,
      });

      expect(res.isAcceptable).toBe(false);
      expect(res.status).toBe("EXCESSIVE_LOSS_ALERT");
      expect(res.excessLossGram).toBe(0.7); // 1.20 - 0.50 = 0.70g excess
      expect(res.statusText).toContain("XATO: Yo'qotish me'yordan oshdi");
    });

    it("handles zero loss and edge cases without fabrication", () => {
      const resZero = GoldEngine.validateStageLoss({
        inputWeightGram: 50.0,
        lossWeightGram: 0,
      });
      expect(resZero.isAcceptable).toBe(true);
      expect(resZero.lossPct).toBe(0);
      expect(resZero.excessLossGram).toBe(0);
    });
  });
});
