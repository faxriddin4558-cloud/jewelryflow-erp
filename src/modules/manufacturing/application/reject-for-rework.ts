import type { ManufacturingRepository } from "../domain/workflow/repository";
import { assertTransition } from "../domain/workflow/operation-status";
import { type RejectForReworkInput, rejectForReworkSchema } from "../domain/workflow/schemas";
import { OperationNotFoundError, ReworkTargetStageNotFoundError } from "../domain/workflow/workflow-errors";
import type { WorkflowAdvanceResult } from "../domain/workflow/types";

/**
 * Closes the current attempt as `rejected` (e.g. failed QC) and opens a
 * new attempt — at the SAME stage by default, since `attempt_number`
 * exists precisely so a batch can revisit a stage (migration 008's
 * comment: "A batch can revisit a stage (QC rejection -> rework)").
 *
 * If the defect requires backing up further than one stage,
 * `targetStageId` lets the caller specify an earlier stage explicitly.
 * This deliberately does NOT call `advanceBatchToNextStage` — rework
 * moves backward or sideways in the pipeline, never forward, so it has
 * its own (simpler) re-queue logic instead of reusing the "next stage by
 * sequence_order" advancer.
 */
export async function rejectForRework(
  repo: ManufacturingRepository,
  input: RejectForReworkInput
): Promise<WorkflowAdvanceResult> {
  const { operationId, reason, targetStageId } = rejectForReworkSchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  assertTransition(operation.status, "rejected");

  const closed = await repo.updateOperation(operationId, {
    status: "rejected",
    finished_at: new Date().toISOString(),
    notes: reason,
  });

  const targetStage = targetStageId
    ? await repo.findStageById(targetStageId)
    : { stageId: operation.stage_id, departmentId: operation.department_id, isTerminal: operation.stageIsTerminal };

  if (!targetStage) {
    throw new ReworkTargetStageNotFoundError(targetStageId as string);
  }

  const attemptCount = await repo.countAttemptsForStage(operation.batch_id, targetStage.stageId);

  const nextOperation = await repo.createOperation({
    batch_id: operation.batch_id,
    stage_id: targetStage.stageId,
    department_id: targetStage.departmentId,
    attempt_number: attemptCount + 1,
    status: "queued",
  });

  return {
    closedOperationId: closed.id,
    nextOperationId: nextOperation.id,
    batchCompleted: false,
  };
}
