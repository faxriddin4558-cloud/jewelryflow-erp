import type { ManufacturingRepository } from "../domain/workflow/repository";
import { assertTransition } from "../domain/workflow/operation-status";
import { type ResumeOperationInput, resumeOperationSchema } from "../domain/workflow/schemas";
import { OperationNotFoundError } from "../domain/workflow/workflow-errors";
import type { BatchOperation } from "@/shared/types/domain";

export async function resumeOperation(
  repo: ManufacturingRepository,
  input: ResumeOperationInput
): Promise<BatchOperation> {
  const { operationId } = resumeOperationSchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  assertTransition(operation.status, "in_progress");

  return repo.updateOperation(operationId, { status: "in_progress" });
}
