"use server";

import type { ApiResult } from "@/shared/types/api";
import type { BatchOperationWithRelations, FactoryDashboardSummary, StageDurationStats } from "@/shared/types/domain";
import { getManufacturingRepository } from "../../infrastructure/departments/factory";
import { runAction } from "../../application/error-mapping";
import * as workflow from "../../application";
import type { DepartmentBoardColumns } from "../../domain/workflow/types";
import type {
  BatchOperationHistoryQueryInput,
  DepartmentBoardQueryInput,
} from "../../domain/workflow/schemas";

export async function getDepartmentBoardAction(
  input: DepartmentBoardQueryInput
): Promise<ApiResult<DepartmentBoardColumns>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.getDepartmentBoard(repo, input);
  });
}

export async function getFactoryDashboardSummaryAction(): Promise<ApiResult<FactoryDashboardSummary>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.getFactoryDashboardSummary(repo);
  });
}

export async function getBatchOperationHistoryAction(
  input: BatchOperationHistoryQueryInput
): Promise<ApiResult<BatchOperationWithRelations[]>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.getBatchOperationHistory(repo, input);
  });
}

export async function getStageDurationStatsAction(): Promise<ApiResult<StageDurationStats[]>> {
  return runAction(async () => {
    const repo = await getManufacturingRepository();
    return workflow.getStageDurationStats(repo);
  });
}
