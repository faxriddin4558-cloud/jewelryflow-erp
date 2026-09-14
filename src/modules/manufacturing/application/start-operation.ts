import type { ManufacturingRepository } from "../domain/workflow/repository";
import { assertTransition } from "../domain/workflow/operation-status";
import { type StartOperationInput, startOperationSchema } from "../domain/workflow/schemas";
import { OperationNotFoundError } from "../domain/workflow/workflow-errors";
import type { BatchOperation } from "@/shared/types/domain";

export async function startOperation(
  repo: ManufacturingRepository,
  input: StartOperationInput
): Promise<BatchOperation> {
  const { operationId, performedByEmployeeId } = startOperationSchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  assertTransition(operation.status, "in_progress");

  return repo.updateOperation(operationId, {
    status: "in_progress",
    started_at: operation.started_at ?? new Date().toISOString(),
    performed_by_employee_id: performedByEmployeeId ?? operation.performed_by_employee_id,
  });
}
