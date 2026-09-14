import type { BatchPriority, DelayReasonCategory, OperationStatus } from "@/shared/types/database.types";

/**
 * Normalized shape for a single card on a department board. Sourced from
 * two different places depending on status:
 *  - queue/working/delayed columns come from the `department_board` view
 *    (migration 013), which only exposes open statuses (queued,
 *    in_progress, paused, delayed, rejected) and therefore has no
 *    `finished_at`.
 *  - the finished column comes directly from `batch_operations` (the view
 *    deliberately excludes `completed` — a live floor board doesn't want
 *    an ever-growing "done" list), so it has `finishedAt` and
 *    `durationSeconds` populated and no `queuedAt`-driven wait-time
 *    meaning.
 *
 * Both mappers (`infrastructure/departments/mappers.ts`) converge on this
 * one shape so `DepartmentBoard` and `OperationCard` never need to branch
 * on where the row came from.
 */
export interface OperationBoardItem {
  operationId: string;
  batchId: string;
  batchNumber: string;
  batchPriority: BatchPriority;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  stageId: string;
  stageName: string;
  status: OperationStatus;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  delayReasonCategory: DelayReasonCategory | null;
  delayedMinutes: number | null;
}

export interface DepartmentBoardColumns {
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  queue: OperationBoardItem[];
  working: OperationBoardItem[];
  delayed: OperationBoardItem[];
  finished: OperationBoardItem[];
}

/**
 * Result of advancing a batch past a closed operation (used by complete,
 * skip, and the "queue next attempt" branch of reject-for-rework).
 */
export interface WorkflowAdvanceResult {
  closedOperationId: string;
  nextOperationId: string | null;
  batchCompleted: boolean;
}

export interface ResolvedNextStage {
  stageId: string;
  departmentId: string;
  isTerminal: boolean;
}
