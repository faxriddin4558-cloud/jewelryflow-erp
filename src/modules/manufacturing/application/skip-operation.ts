import type { ManufacturingRepository } from "../domain/workflow/repository";
import { assertTransition } from "../domain/workflow/operation-status";
import { type SkipOperationInput, skipOperationSchema } from "../domain/workflow/schemas";
import { OperationNotFoundError } from "../domain/workflow/workflow-errors";
import type { WorkflowAdvanceResult } from "../domain/workflow/types";
import { advanceBatchToNextStage } from "./workflow-advancer";

/**
 * Deliberately bypasses a stage (e.g. a model doesn't need Zircon
 * setting) without recording it as worked. Still advances the batch to
 * the next stage, exactly like `completeOperation` — the only difference
 * is the closed row's status and that a reason is mandatory.
 */
export async function skipOperation(
  repo: ManufacturingRepository,
  input: SkipOperationInput
): Promise<WorkflowAdvanceResult> {
  const { operationId, reason } = skipOperationSchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  assertTransition(operation.status, "skipped");

  const closed = await repo.updateOperation(operationId, {
    status: "skipped",
    finished_at: new Date().toISOString(),
    notes: reason,
  });

  return advanceBatchToNextStage(repo, {
    ...closed,
    stageSequenceOrder: operation.stageSequenceOrder,
    stageIsTerminal: operation.stageIsTerminal,
  });
}
