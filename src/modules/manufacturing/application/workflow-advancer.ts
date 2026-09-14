import type { ManufacturingRepository, OperationWithStageSequence } from "../domain/workflow/repository";
import type { WorkflowAdvanceResult } from "../domain/workflow/types";
import { NextStageNotConfiguredError } from "../domain/workflow/workflow-errors";

/**
 * The one piece of business logic the SQL migrations deliberately leave to
 * the application layer: given an operation that was JUST closed out
 * (completed or skipped), open the next operation in the pipeline.
 *
 * The database triggers (migration 008) handle the two things that must
 * be atomic and always-consistent regardless of which client wrote the
 * row: keeping `batches.current_stage_id`/`status` in sync, and flipping
 * `batches.status = 'completed'` when a `batch_operations` row for the
 * terminal stage (`is_terminal = true`, i.e. "Completed", sequence 20)
 * finishes. Everything else — deciding *which* stage comes next, and
 * creating that row — is application logic because it needs the
 * currently-active `workflow_stages` set, which is data, not schema.
 *
 * Both `complete-operation.ts` and `skip-operation.ts` call this after
 * closing their operation row. Reject-for-rework does NOT call this — it
 * re-queues the *same* stage (a new attempt), which is a different
 * operation entirely (see `reject-for-rework.ts`).
 */
export async function advanceBatchToNextStage(
  repo: ManufacturingRepository,
  closedOperation: OperationWithStageSequence
): Promise<WorkflowAdvanceResult> {
  // The terminal stage's own completion already marks the batch complete
  // via `trg_complete_batch_on_terminal_stage`; there is no "next" stage
  // to open past it.
  if (closedOperation.stageIsTerminal) {
    return {
      closedOperationId: closedOperation.id,
      nextOperationId: null,
      batchCompleted: closedOperation.status === "completed",
    };
  }

  const next = await repo.findNextActiveStage(closedOperation.stageSequenceOrder);

  // No configured next stage is a data-configuration gap, not a normal
  // "batch is done" outcome — that case is handled above via
  // `is_terminal`. Throw so it gets fixed in workflow_stages rather than
  // silently stranding the batch with no open operation anywhere.
  if (!next) {
    throw new NextStageNotConfiguredError(closedOperation.stageSequenceOrder);
  }

  const attemptCount = await repo.countAttemptsForStage(closedOperation.batch_id, next.stageId);

  const nextOperation = await repo.createOperation({
    batch_id: closedOperation.batch_id,
    stage_id: next.stageId,
    department_id: next.departmentId,
    attempt_number: attemptCount + 1,
    status: "queued",
  });

  return {
    closedOperationId: closedOperation.id,
    nextOperationId: nextOperation.id,
    batchCompleted: false,
  };
}
