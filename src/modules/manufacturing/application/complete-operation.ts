import type { ManufacturingRepository } from "../domain/workflow/repository";
import { assertTransition } from "../domain/workflow/operation-status";
import { type CompleteOperationInput, completeOperationSchema } from "../domain/workflow/schemas";
import { OperationNotFoundError } from "../domain/workflow/workflow-errors";
import type { WorkflowAdvanceResult } from "../domain/workflow/types";
import { advanceBatchToNextStage } from "./workflow-advancer";

/**
 * Marks the current operation `completed` and immediately opens the next
 * stage's operation (or, if this was the terminal stage, relies on the DB
 * trigger to mark the batch `completed` — see `workflow-advancer.ts`).
 */
export async function completeOperation(
  repo: ManufacturingRepository,
  input: CompleteOperationInput
): Promise<WorkflowAdvanceResult> {
  const { operationId, performedByEmployeeId, outputWeightGrams, notes } =
    completeOperationSchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  assertTransition(operation.status, "completed");

  const finishedAt = new Date().toISOString();

  const closed = await repo.updateOperation(operationId, {
    status: "completed",
    finished_at: finishedAt,
    performed_by_employee_id: performedByEmployeeId ?? operation.performed_by_employee_id,
    output_weight_grams: outputWeightGrams ?? operation.output_weight_grams,
    notes: notes ?? operation.notes,
  });

  return advanceBatchToNextStage(repo, {
    ...closed,
    stageSequenceOrder: operation.stageSequenceOrder,
    stageIsTerminal: operation.stageIsTerminal,
  });
}
