import type { ManufacturingRepository } from "../domain/workflow/repository";
import { assertTransition } from "../domain/workflow/operation-status";
import { type FlagDelayInput, flagDelaySchema } from "../domain/workflow/schemas";
import { OperationNotFoundError } from "../domain/workflow/workflow-errors";
import type { BatchOperation } from "@/shared/types/domain";

/**
 * Flags the current operation delayed. `delayReasonCategory` is required
 * by the Zod schema so we never even attempt a write that would trip the
 * DB's `batch_operations_delay_requires_reason` check constraint.
 */
export async function flagDelay(
  repo: ManufacturingRepository,
  input: FlagDelayInput
): Promise<BatchOperation> {
  const { operationId, delayReasonCategory, delayReasonNotes, delayedMinutes } =
    flagDelaySchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  assertTransition(operation.status, "delayed");

  return repo.updateOperation(operationId, {
    status: "delayed",
    delay_reason_category: delayReasonCategory,
    delay_reason_notes: delayReasonNotes ?? operation.delay_reason_notes,
    delayed_minutes: delayedMinutes ?? operation.delayed_minutes,
  });
}
