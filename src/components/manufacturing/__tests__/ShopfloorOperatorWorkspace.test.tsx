// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ShopfloorOperatorWorkspace } from "../ShopfloorOperatorWorkspace";
import { GOLDIA_FACTORY_CONFIG, isStageActive } from "@/lib/factory-config";

import type * as ErpEngineModule from "@/lib/erp-engine";

// Mock supabase client calls to avoid real remote network
vi.mock("@/lib/erp-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof ErpEngineModule>();
  return {
    ...actual,
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "batches") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "batch-101",
                    batch_no: "BATCH-001",
                    product_name: "Uzuk Klassika 585",
                    status: "in_progress",
                    priority: "normal",
                    planned_qty: 20,
                    issued_gold_gram: 52.0,
                    deadline: "2026-11-01",
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "production_stages") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  { id: "st-8", stage_order: 8, name: "8. Quyish (Casting)", department: "Quyish" },
                  { id: "st-9", stage_order: 9, name: "9. Ponza (Pumice)", department: "Ponza" },
                  { id: "st-10", stage_order: 10, name: "10. Zaklirovka", department: "Zaklirovka" },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "batch_stage_wip") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "wip-1",
                    batch_no: "BATCH-001",
                    stage_order: 8,
                    stage_name: "8. Quyish (Casting)",
                    department: "Casting",
                    available_qty: 20,
                    input_weight: 52.0,
                    queue_status: "WORKING",
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "machines") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  { id: "m-1", name: "Casting Station 1", department: "Casting", status: "ACTIVE" },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "two_party_handovers") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "ho-1",
                      batch_no: "BATCH-001",
                      from_stage_order: 7,
                      from_stage_name: "Wax Assembly",
                      to_stage_order: 8,
                      to_stage_name: "Casting",
                      sender_worker_name: "Usta Alisher",
                      dispatched_qty: 20,
                      dispatched_weight_gram: 52.0,
                      status: "PENDING_ACCEPTANCE",
                      tolerance_gram: 0.05,
                      dispatched_at: new Date().toISOString(),
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "employees") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ id: "emp-1", name: "Operator Nodir", department: "Casting" }],
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({ data: { status: "ACCEPTED" }, error: null }),
    },
  };
});

describe("ShopfloorOperatorWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the touch panel and loads department batches", async () => {
    render(<ShopfloorOperatorWorkspace initialDepartment="casting" />);

    // Check title presence
    expect(screen.getByText(/Shopfloor Operator Touch Panel/i)).toBeDefined();

    // Wait for batches and pending handover banner to load
    await waitFor(() => {
      expect(screen.getAllByText("BATCH-001").length).toBeGreaterThan(0);
      expect(screen.getByText(/Qabul qilinishi kutilayotgan/i)).toBeDefined();
    });
  });

  it("identifies Goldia bypass stages correctly according to factory configuration", () => {
    const pumiceStage = { stage_order: 9, name: "9. Ponza (Pumice)", department: "Ponza" };
    const castingStage = { stage_order: 8, name: "8. Quyish (Casting)", department: "Quyish" };

    expect(isStageActive(pumiceStage, GOLDIA_FACTORY_CONFIG)).toBe(false);
    expect(isStageActive(castingStage, GOLDIA_FACTORY_CONFIG)).toBe(true);
  });
});
