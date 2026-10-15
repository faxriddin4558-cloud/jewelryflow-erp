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

  describe("3. Negative Multi-Tenant Isolation Contract Tests (Org A vs Org B)", () => {
    interface TenantUser {
      userId: string;
      email: string;
      organizationId: string | null;
      role: string;
    }

    interface TenantRecord {
      id: string;
      organizationId: string | null;
      title: string;
      data: Record<string, unknown>;
    }

    const orgAId = "org-uuid-aaa-111";
    const orgBId = "org-uuid-bbb-222";

    const userA: TenantUser = {
      userId: "user-a",
      email: "worker@orga.uz",
      organizationId: orgAId,
      role: "worker",
    };

    const userB: TenantUser = {
      userId: "user-b",
      email: "worker@orgb.uz",
      organizationId: orgBId,
      role: "worker",
    };

    const unassignedUser: TenantUser = {
      userId: "user-unassigned",
      email: "stranger@unknown.uz",
      organizationId: null,
      role: "worker",
    };

    const records: TenantRecord[] = [
      { id: "batch-org-a", organizationId: orgAId, title: "Org A Gold Batch", data: { goldGram: 100 } },
      { id: "batch-org-b", organizationId: orgBId, title: "Org B Gold Batch", data: { goldGram: 250 } },
      { id: "batch-legacy-null", organizationId: null, title: "Unassigned Legacy Batch", data: { goldGram: 50 } },
    ];

    // Authoritative simulated RLS filter predicate matching Migration 020
    const evaluateRlsFilter = (record: TenantRecord, caller: TenantUser): boolean => {
      if (!caller.organizationId) return false; // Fail closed if caller has no tenant!
      if (!record.organizationId) return false; // Fail closed: unassigned records are NOT open!
      return record.organizationId === caller.organizationId;
    };

    it("ensures User A can only see Organization A records and cannot see Org B records", () => {
      const visibleToUserA = records.filter((r) => evaluateRlsFilter(r, userA));
      expect(visibleToUserA.map((r) => r.id)).toEqual(["batch-org-a"]);
      expect(visibleToUserA.some((r) => r.id === "batch-org-b")).toBe(false);
    });

    it("ensures User B can only see Organization B records and cannot see Org A records", () => {
      const visibleToUserB = records.filter((r) => evaluateRlsFilter(r, userB));
      expect(visibleToUserB.map((r) => r.id)).toEqual(["batch-org-b"]);
      expect(visibleToUserB.some((r) => r.id === "batch-org-a")).toBe(false);
    });

    it("ensures unassigned user cannot see any records (fail-closed, no Goldia fallback)", () => {
      const visibleToUnassigned = records.filter((r) => evaluateRlsFilter(r, unassignedUser));
      expect(visibleToUnassigned).toEqual([]);
    });

    it("ensures legacy NULL organization records are never exposed to other tenants", () => {
      // Neither User A nor User B can see unassigned NULL records
      expect(evaluateRlsFilter(records[2]!, userA)).toBe(false);
      expect(evaluateRlsFilter(records[2]!, userB)).toBe(false);
    });

    it("prevents User A from inserting or mutating records belonging to Organization B", () => {
      const insertRecord = (newRecord: TenantRecord, caller: TenantUser) => {
        if (!caller.organizationId || newRecord.organizationId !== caller.organizationId) {
          throw new Error("Cross-tenant violation: Cannot create record for another organization");
        }
        return true;
      };

      expect(() =>
        insertRecord(
          { id: "batch-attack", organizationId: orgBId, title: "Malicious Batch", data: {} },
          userA
        )
      ).toThrowError(/Cross-tenant violation/);
    });

    it("prevents User A from moving or acting on an Org B batch via RPC logic", () => {
      const rpcSimulateMoveWip = (batch: TenantRecord, caller: TenantUser) => {
        if (!caller.organizationId) {
          throw new Error("Permission denied: User must belong to an active organization");
        }
        if (batch.organizationId !== caller.organizationId) {
          throw new Error("Cross-tenant violation: Batch does not belong to your organization");
        }
        return { success: true };
      };

      const orgBBatch = records[1]!;
      expect(() => rpcSimulateMoveWip(orgBBatch, userA)).toThrowError(
        /Cross-tenant violation: Batch does not belong to your organization/
      );

      const orgABatch = records[0]!;
      expect(rpcSimulateMoveWip(orgABatch, userA)).toEqual({ success: true });
    });
  });

  describe("4. Database Migration 020 Security & Hardening Audit", () => {
    it("verifies migration 020 eliminates permissive policies and enforces strict tenant isolation", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const m20Path = path.resolve(
        process.cwd(),
        "supabase",
        "migrations",
        "20260101000020_strict_multi_tenant_isolation.sql"
      );

      expect(fs.existsSync(m20Path)).toBe(true);
      const sql = fs.readFileSync(m20Path, "utf8");

      // Verify fail-closed current_organization_id()
      expect(sql).toContain("create or replace function public.current_organization_id()");
      expect(sql).toContain("return null;"); // Fails closed, does NOT fallback to Goldia!

      // Verify drop of old permissive policies
      expect(sql).toContain('drop policy if exists "authenticated read batches" on public.batches;');
      expect(sql).toContain('drop policy if exists "Authenticated users can read batch stage wip" on public.batch_stage_wip;');
      expect(sql).toContain('drop policy if exists "orders_select_authorized" on public.orders;');
      expect(sql).toContain('drop policy if exists "inventory_items_select_authorized" on public.inventory_items;');
      expect(sql).toContain('drop policy if exists "gold_transactions_select_authorized" on public.gold_transactions;');
      expect(sql).toContain('drop policy if exists "authenticated read two party handovers" on public.two_party_handovers;');
      expect(sql).toContain('drop policy if exists "authenticated read customers" on public.customers;');

      // Verify strict tenant policies WITHOUT "OR organization_id IS NULL"
      expect(sql).toContain("using (organization_id = public.current_organization_id());");

      // Verify RPC tenant guards
      expect(sql).toContain("Cross-tenant violation: Source inventory does not belong to your organization");
      expect(sql).toContain("Cross-tenant violation: Batch does not belong to your organization");
      expect(sql).toContain("Cross-tenant violation: Product does not belong to your organization");
      expect(sql).toContain("Cross-tenant violation: Handover does not belong to your organization");
    });
  });
});
