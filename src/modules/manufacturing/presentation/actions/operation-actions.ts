"use server";

import type { ApiResult } from "@/shared/types/api";
import type { BatchOperation } from "@/shared/types/domain";
import { getManufacturingRepository } from "../../infrastructure/departments/factory";
import { requireCurrentEmployeeId } from "../../infrastructure/departments/session";
import { runAction } from "../../application/error-mapping";
import * as workflow from "../../application";
import type {
  AssignEmployeeInput,
  CompleteOperationInput,
  EnterQueueInput,
  FlagDelayInput,
  PauseOperationInput,
  RejectForReworkInput,
  ResumeOperationInput,
  SkipOperationInput,
  StartOperationInput,
} from "../../domain/workflow/schemas";
import type { WorkflowAdvanceResult } from "../../domain/workflow/types";

/**
 * Every action here follows the same shape: resolve a request-scoped
 * repository, run the use case inside `runAction` so any thrown
 * `WorkflowError`/`ZodError` becomes a typed `ApiError` instead of an
 * unhandled Server Action rejection, and return `ApiResult<T>`.
 *
 * Board freshness after a mutation is driven by TanStack Query
 * invalidation on the client (`use-operation-mutations.ts`), not
 * `revalidatePath` — a factory-floor board is expected to be live/polled
 * regardless of which client made the change, so cache invalidation
 * belongs to the query layer, not the Server Action.
 */

export async function enterQueueAction(input: EnterQueueInput): Promise<ApiResult<BatchOperation>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.enterQueue(repo, input);
  });
}

export async function startOperationAction(
  input: StartOperationInput
): Promise<ApiResult<BatchOperation>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    const performedByEmployeeId = input.performedByEmployeeId ?? (await requireCurrentEmployeeId());
    return workflow.startOperation(repo, { ...input, performedByEmployeeId });
  });
}

export async function pauseOperationAction(
  input: PauseOperationInput
): Promise<ApiResult<BatchOperation>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.pauseOperation(repo, input);
  });
}

export async function resumeOperationAction(
  input: ResumeOperationInput
): Promise<ApiResult<BatchOperation>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.resumeOperation(repo, input);
  });
}

export async function completeOperationAction(
  input: CompleteOperationInput
): Promise<ApiResult<WorkflowAdvanceResult>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    const performedByEmployeeId = input.performedByEmployeeId ?? (await requireCurrentEmployeeId());
    return workflow.completeOperation(repo, { ...input, performedByEmployeeId });
  });
}

export async function skipOperationAction(
  input: SkipOperationInput
): Promise<ApiResult<WorkflowAdvanceResult>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.skipOperation(repo, input);
  });
}

export async function flagDelayAction(input: FlagDelayInput): Promise<ApiResult<BatchOperation>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.flagDelay(repo, input);
  });
}

export async function rejectForReworkAction(
  input: RejectForReworkInput
): Promise<ApiResult<WorkflowAdvanceResult>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.rejectForRework(repo, input);
  });
}

export async function assignEmployeeAction(
  input: AssignEmployeeInput
): Promise<ApiResult<BatchOperation>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.assignEmployee(repo, input);
  });
}
