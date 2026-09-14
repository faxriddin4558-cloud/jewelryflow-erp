import type { OperationStatus } from "@/shared/types/database.types";
import { InvalidOperationTransitionError } from "./workflow-errors";

/**
 * State machine mirroring the operational constraints on `batch_operations`
 * (migration 008_batch_operations.sql):
 *  - `batch_operations_delay_requires_reason`: entering `delayed` requires a
 *    `delay_reason_category` (enforced again here so we fail fast in the
 *    application layer, before the DB constraint would reject the write).
 *  - `idx_batch_operations_one_active_per_batch`: only one of
 *    queued/in_progress/paused/delayed may exist per batch at a time — this
 *    module never creates a new operation while one of those is open on the
 *    same batch (enforced by the workflow-advancer, not here).
 *
 * `rejected` and `skipped` are dead ends for the *row* (the attempt is
 * closed), but the batch itself continues: rejectForRework opens a new
 * attempt at the same stage, and skip/complete open a new attempt at the
 * next stage. That forward motion is the workflow-advancer's job, not this
 * state machine's — this file only governs what a single row may become.
 */

const TRANSITIONS: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = {
  queued: ["in_progress", "skipped", "rejected"],
  in_progress: ["paused", "completed", "delayed", "skipped", "rejected"],
  paused: ["in_progress", "delayed", "skipped", "rejected"],
  delayed: ["in_progress", "skipped", "rejected"],
  completed: [],
  skipped: [],
  rejected: [],
};

/** Statuses considered "open" — at most one may exist per batch at a time. */
export const OPEN_OPERATION_STATUSES: readonly OperationStatus[] = [
  "queued",
  "in_progress",
  "paused",
  "delayed",
];

export const TERMINAL_OPERATION_STATUSES: readonly OperationStatus[] = [
  "completed",
  "skipped",
  "rejected",
];

export function isOpenStatus(status: OperationStatus): boolean {
  return OPEN_OPERATION_STATUSES.includes(status);
}

export function isTerminalStatus(status: OperationStatus): boolean {
  return TERMINAL_OPERATION_STATUSES.includes(status);
}

export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedNextStatuses(from: OperationStatus): readonly OperationStatus[] {
  return TRANSITIONS[from];
}

/**
 * Structural guard used by every mutating use case before it touches the
 * repository. Throws a typed domain error (caught and mapped to
 * `ApiResult` by `application/error-mapping.ts`) rather than returning a
 * boolean, so use cases can call it unconditionally as a precondition.
 */
export function assertTransition(from: OperationStatus, to: OperationStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidOperationTransitionError(from, to);
  }
}

