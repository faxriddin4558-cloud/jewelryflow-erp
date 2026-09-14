import type { OperationStatus } from "@/shared/types/database.types";

/**
 * Domain error hierarchy for the manufacturing workflow engine. Every
 * error carries a stable `code` so `application/error-mapping.ts` can map
 * it to an `ApiErrorCode` without string-matching messages.
 */
export abstract class WorkflowError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidOperationTransitionError extends WorkflowError {
  readonly code = "INVALID_OPERATION_TRANSITION";

  constructor(
    readonly from: OperationStatus,
    readonly to: OperationStatus
  ) {
    super(`Cannot transition operation from "${from}" to "${to}".`);
  }
}

export class OperationNotFoundError extends WorkflowError {
  readonly code = "OPERATION_NOT_FOUND";

  constructor(readonly operationId: string) {
    super(`Operation "${operationId}" was not found.`);
  }
}

export class BatchNotFoundError extends WorkflowError {
  readonly code = "BATCH_NOT_FOUND";

  constructor(readonly batchId: string) {
    super(`Batch "${batchId}" was not found.`);
  }
}

export class BatchAlreadyActiveError extends WorkflowError {
  readonly code = "BATCH_ALREADY_ACTIVE";

  constructor(readonly batchId: string) {
    super(
      `Batch "${batchId}" already has an open operation (queued, in progress, paused, or delayed). ` +
        `A batch can only be active at one workflow stage at a time.`
    );
  }
}

export class MissingDelayReasonError extends WorkflowError {
  readonly code = "MISSING_DELAY_REASON";

  constructor() {
    super("Flagging an operation as delayed requires a delay_reason_category.");
  }
}

export class NextStageNotConfiguredError extends WorkflowError {
  readonly code = "NEXT_STAGE_NOT_CONFIGURED";

  constructor(readonly currentSequenceOrder: number) {
    super(
      `No active workflow stage is configured after sequence_order ${currentSequenceOrder}. ` +
        `Check the workflow_stages table for a gap in sequencing.`
    );
  }
}

export class ReworkTargetStageNotFoundError extends WorkflowError {
  readonly code = "REWORK_TARGET_STAGE_NOT_FOUND";

  constructor(readonly stageId: string) {
    super(`Rework target stage "${stageId}" was not found or is inactive.`);
  }
}

export class DepartmentCodeNotFoundError extends WorkflowError {
  readonly code = "DEPARTMENT_NOT_FOUND";

  constructor(readonly departmentCode: string) {
    super(`Department with code "${departmentCode}" was not found. Check the seed data.`);
  }
}

export class UnauthorizedWorkflowActionError extends WorkflowError {
  readonly code = "UNAUTHORIZED_WORKFLOW_ACTION";

  constructor(message = "You are not authorized to perform this workflow action.") {
    super(message);
  }
}

export function isWorkflowError(error: unknown): error is WorkflowError {
  return error instanceof WorkflowError;
}
