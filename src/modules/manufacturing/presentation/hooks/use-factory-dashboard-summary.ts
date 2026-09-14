"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrapApiResult } from "@/shared/lib/unwrap-api-result";
import { getFactoryDashboardSummaryAction } from "../actions/board-actions";
import { manufacturingKeys } from "../query-keys";

export function useFactoryDashboardSummary() {
  return useQuery({
    queryKey: manufacturingKeys.dashboardSummary(),
    queryFn: async () => unwrapApiResult(await getFactoryDashboardSummaryAction()),
    refetchInterval: 30_000,
  });
}
