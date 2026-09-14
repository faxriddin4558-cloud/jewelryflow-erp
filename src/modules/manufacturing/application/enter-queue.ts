import type { ManufacturingRepository } from "../domain/workflow/repository";
import { type EnterQueueInput, enterQueueSchema } from "../domain/workflow/schemas";
import { BatchAlreadyActiveError, NextStageNotConfiguredError } from "../domain/workflow/workflow-errors";
import type { BatchOperation } from "@/shared/types/domain";

/**
 * Creates the very first `batch_operations` row for a batch, at
 * `workflow_stages` sequence_order 1 (WAX, per the seed pipeline).
 * Called once, when a batch is released to the factory floor.
 */
export async function enterQueue(
  repo: ManufacturingRepository,
  input: EnterQueueInput
): Promise<BatchOperation> {
  const { batchId } = enterQueueSchema.parse(input);

  const existingOpen = await repo.findOpenOperationForBatch(batchId);
  if (existingOpen) {
    throw new BatchAlreadyActiveError(batchId);
  }

  const firstStage = await repo.findFirstActiveStage();
  if (!firstStage) {
    throw new NextStageNotConfiguredError(0);
  }

  const attemptCount = await repo.countAttemptsForStage(batchId, firstStage.stageId);

  return repo.createOperation({
    batch_id: batchId,
    stage_id: firstStage.stageId,
    department_id: firstStage.departmentId,
    attempt_number: attemptCount + 1,
    status: "queued",
  });
}
