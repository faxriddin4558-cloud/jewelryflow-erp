import type { ManufacturingRepository } from "../domain/workflow/repository";
import { assertTransition } from "../domain/workflow/operation-status";
import { type PauseOperationInput, pauseOperationSchema } from "../domain/workflow/schemas";
import { OperationNotFoundError } from "../domain/workflow/workflow-errors";
import type { BatchOperation } from "@/shared/types/domain";

export async function pauseOperation(
  repo: ManufacturingRepository,
  input: PauseOperationInput
): Promise<BatchOperation> {
  const { operationId, notes } = pauseOperationSchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  assertTransition(operation.status, "paused");

  return repo.updateOperation(operationId, {
    status: "paused",
    notes: notes ?? operation.notes,
  });
}
