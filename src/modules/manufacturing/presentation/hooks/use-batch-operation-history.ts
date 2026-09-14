"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrapApiResult } from "@/shared/lib/unwrap-api-result";
import { getBatchOperationHistoryAction } from "../actions/board-actions";
import { manufacturingKeys } from "../query-keys";

export function useBatchOperationHistory(batchId: string) {
  return useQuery({
    queryKey: manufacturingKeys.batchHistory(batchId),
    queryFn: async () => unwrapApiResult(await getBatchOperationHistoryAction({ batchId })),
    enabled: Boolean(batchId),
  });
}
