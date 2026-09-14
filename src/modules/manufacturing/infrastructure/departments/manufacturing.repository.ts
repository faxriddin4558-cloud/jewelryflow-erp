import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/shared/types/database.types";
import type {
  BatchOperation,
  BatchOperationInsert,
  BatchOperationUpdate,
  BatchOperationWithRelations,
  DepartmentBoardRow,
  FactoryDashboardSummary,
  StageDurationStats,
} from "@/shared/types/domain";
import type {
  ManufacturingRepository,
  OperationWithStageSequence,
} from "../../domain/workflow/repository";
import type { ResolvedNextStage } from "../../domain/workflow/types";
import { OPEN_OPERATION_STATUSES } from "../../domain/workflow/operation-status";
import {
  mapRawOperationWithRelations,
  mapRawOperationWithStage,
  type RawOperationWithRelations,
  type RawOperationWithStage,
} from "./mappers";

/**
 * Supabase-backed implementation of `ManufacturingRepository`. Every
 * mutating method relies on RLS (migration 014) for authorization and on
 * the DB triggers (migration 008 — `sync_batch_current_stage`,
 * `complete_batch_on_terminal_stage`) to keep `batches` in sync; this
 * class only writes to `batch_operations` and reads from the reporting
 * views, exactly as the schema was designed to be used.
 *
 * Nested `select()` results are cast via the `Raw*` shapes in
 * `mappers.ts` rather than inferred by supabase-js, because
 * `database.types.ts` is hand-authored and does not include the
 * generated `Relationships` metadata supabase-js needs for nested-select
 * type inference. The selected columns are kept in exact lockstep with
 * those `Raw*` interfaces — verify both together when editing either.
 */
export class SupabaseManufacturingRepository implements ManufacturingRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async findDepartmentByCode(code: string) {
    const { data, error } = await this.client
      .from("departments")
      .select("id, code, name")
      .eq("code", code)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async findOperationById(operationId: string): Promise<OperationWithStageSequence | null> {
    const { data, error } = await this.client
      .from("batch_operations")
      .select("*, workflow_stages(sequence_order, is_terminal)")
      .eq("id", operationId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return mapRawOperationWithStage(data as unknown as RawOperationWithStage);
  }

  async findOpenOperationForBatch(batchId: string): Promise<BatchOperation | null> {
    const { data, error } = await this.client
      .from("batch_operations")
      .select("*")
      .eq("batch_id", batchId)
      .in("status", [...OPEN_OPERATION_STATUSES])
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async findFirstActiveStage(): Promise<ResolvedNextStage | null> {
    const { data, error } = await this.client
      .from("workflow_stages")
      .select("id, department_id, is_terminal")
      .eq("is_active", true)
      .order("sequence_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return { stageId: data.id, departmentId: data.department_id, isTerminal: data.is_terminal };
  }

  async findNextActiveStage(currentSequenceOrder: number): Promise<ResolvedNextStage | null> {
    const { data, error } = await this.client
      .from("workflow_stages")
      .select("id, department_id, is_terminal")
      .eq("is_active", true)
      .gt("sequence_order", currentSequenceOrder)
      .order("sequence_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return { stageId: data.id, departmentId: data.department_id, isTerminal: data.is_terminal };
  }

  async findStageById(stageId: string): Promise<ResolvedNextStage | null> {
    const { data, error } = await this.client
      .from("workflow_stages")
      .select("id, department_id, is_terminal")
      .eq("id", stageId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return { stageId: data.id, departmentId: data.department_id, isTerminal: data.is_terminal };
  }

  async countAttemptsForStage(batchId: string, stageId: string): Promise<number> {
    const { count, error } = await this.client
      .from("batch_operations")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("stage_id", stageId);

    if (error) throw error;
    return count ?? 0;
  }

  async createOperation(input: BatchOperationInsert): Promise<BatchOperation> {
    const { data, error } = await this.client
      .from("batch_operations")
      .insert(input)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async updateOperation(operationId: string, patch: BatchOperationUpdate): Promise<BatchOperation> {
    const { data, error } = await this.client
      .from("batch_operations")
      .update(patch)
      .eq("id", operationId)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async getDepartmentOpenBoardRows(departmentId: string): Promise<DepartmentBoardRow[]> {
    const { data, error } = await this.client
      .from("department_board")
      .select("*")
      .eq("department_id", departmentId)
      .order("queued_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  async getRecentlyFinished(
    departmentId: string,
    limit: number
  ): Promise<BatchOperationWithRelations[]> {
    const { data, error } = await this.client
      .from("batch_operations")
      .select(
        `*,
         batches(id, batch_number, priority),
         workflow_stages(*),
         departments(*),
         assigned_employee:employees!batch_operations_assigned_employee_id_fkey(id, full_name)`
      )
      .eq("department_id", departmentId)
      .eq("status", "completed")
      .order("finished_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []).map((row) =>
      mapRawOperationWithRelations(row as unknown as RawOperationWithRelations)
    );
  }

  async getFactoryDashboardSummary(): Promise<FactoryDashboardSummary> {
    const { data, error } = await this.client
      .from("factory_dashboard_summary")
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async getBatchOperationHistory(batchId: string): Promise<BatchOperationWithRelations[]> {
    const { data, error } = await this.client
      .from("batch_operations")
      .select(
        `*,
         batches(id, batch_number, priority),
         workflow_stages(*),
         departments(*),
         assigned_employee:employees!batch_operations_assigned_employee_id_fkey(id, full_name)`
      )
      .eq("batch_id", batchId)
      .order("queued_at", { ascending: true })
      .order("attempt_number", { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row) =>
      mapRawOperationWithRelations(row as unknown as RawOperationWithRelations)
    );
  }

  async getStageDurationStats(): Promise<StageDurationStats[]> {
    const { data, error } = await this.client
      .from("stage_duration_stats")
      .select("*")
      .order("sequence_order", { ascending: true });

    if (error) throw error;
    return data ?? [];
  }
}
