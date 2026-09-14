"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrapApiResult } from "@/shared/lib/unwrap-api-result";
import { getDepartmentBoardAction } from "../actions/board-actions";
import { manufacturingKeys } from "../query-keys";

/**
 * Polls the department board every 15s to reflect what's happening on the
 * physical floor without requiring a manual refresh — floor tablets are
 * typically left open on one department's board all shift.
 */
export function useDepartmentBoard(departmentId: string, finishedLimit = 20) {
  return useQuery({
    queryKey: manufacturingKeys.board(departmentId),
    queryFn: async () =>
      unwrapApiResult(await getDepartmentBoardAction({ departmentId, finishedLimit })),
    enabled: Boolean(departmentId),
    refetchInterval: 15_000,
  });
}
