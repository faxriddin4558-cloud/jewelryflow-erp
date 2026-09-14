import type { ManufacturingRepository } from "../domain/workflow/repository";
import { isTerminalStatus } from "../domain/workflow/operation-status";
import { type AssignEmployeeInput, assignEmployeeSchema } from "../domain/workflow/schemas";
import { InvalidOperationTransitionError, OperationNotFoundError } from "../domain/workflow/workflow-errors";
import type { BatchOperation } from "@/shared/types/domain";

/**
 * Assigns (or reassigns) the employee responsible for an operation.
 * Allowed on any open operation (queued/in_progress/paused/delayed) —
 * unlike the status transitions, this isn't gated by the transition
 * table since it doesn't change `status` at all, only re-uses
 * `isTerminalStatus` as the one guard: a closed row's assignment is
 * historical record and shouldn't be edited after the fact.
 */
export async function assignEmployee(
  repo: ManufacturingRepository,
  input: AssignEmployeeInput
): Promise<BatchOperation> {
  const { operationId, employeeId } = assignEmployeeSchema.parse(input);

  const operation = await repo.findOperationById(operationId);
  if (!operation) {
    throw new OperationNotFoundError(operationId);
  }

  if (isTerminalStatus(operation.status)) {
    throw new InvalidOperationTransitionError(operation.status, operation.status);
  }

  return repo.updateOperation(operationId, { assigned_employee_id: employeeId });
}
