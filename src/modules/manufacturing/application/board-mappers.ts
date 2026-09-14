import type { BatchOperationWithRelations, DepartmentBoardRow } from "@/shared/types/domain";
import type { OperationBoardItem } from "../domain/workflow/types";

/**
 * Maps a `department_board` view row (open statuses only — see migration
 * 013) to the normalized board item. Pure, DB-shape-in/domain-shape-out;
 * lives in the application layer (not infrastructure) because the input
 * type is a plain row shape, not anything Supabase-client-specific, and
 * both the read use case and any future consumer need it without pulling
 * in the Supabase repository implementation.
 */
export function mapBoardRowToItem(row: DepartmentBoardRow): OperationBoardItem {
  return {
    operationId: row.operation_id,
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    batchPriority: row.batch_priority,
    departmentId: row.department_id,
    departmentCode: row.department_code,
    departmentName: row.department_name,
    stageId: row.stage_id,
    stageName: row.stage_name,
    status: row.operation_status,
    assignedEmployeeId: row.assigned_employee_id,
    assignedEmployeeName: row.assigned_employee_name,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: null,
    durationSeconds: null,
    delayReasonCategory: row.delay_reason_category,
    delayedMinutes: row.delayed_minutes,
  };
}

/**
 * Maps a completed `batch_operations` row (with its joined relations) to
 * the same normalized shape, for the Finished column — which the
 * `department_board` view deliberately excludes.
 */
export function mapFinishedOperationToItem(op: BatchOperationWithRelations): OperationBoardItem {
  return {
    operationId: op.id,
    batchId: op.batch_id,
    batchNumber: op.batch.batch_number,
    batchPriority: op.batch.priority,
    departmentId: op.department_id,
    departmentCode: op.department.code,
    departmentName: op.department.name,
    stageId: op.stage_id,
    stageName: op.stage.name,
    status: op.status,
    assignedEmployeeId: op.performed_by_employee_id ?? op.assigned_employee_id,
    assignedEmployeeName: op.assigned_employee?.full_name ?? null,
    queuedAt: op.queued_at,
    startedAt: op.started_at,
    finishedAt: op.finished_at,
    durationSeconds: op.duration_seconds,
    delayReasonCategory: op.delay_reason_category,
    delayedMinutes: op.delayed_minutes,
  };
}
