"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrapApiResult } from "@/shared/lib/unwrap-api-result";
import {
  assignEmployeeAction,
  completeOperationAction,
  enterQueueAction,
  flagDelayAction,
  pauseOperationAction,
  rejectForReworkAction,
  resumeOperationAction,
  skipOperationAction,
  startOperationAction,
} from "../actions/operation-actions";
import { manufacturingKeys } from "../query-keys";

/**
 * Every mutation here invalidates every open department board and the
 * dashboard summary, rather than trying to compute exactly which
 * department(s) were touched. A single operation's transition can affect
 * two boards at once (the stage it left and the stage it entered), so
 * broad invalidation is simpler and cheaper than threading department IDs
 * through every call site — boards refetch in the background (TanStack
 * Query keeps the previous data visible) so this doesn't cause a flash.
 */
function useInvalidateBoards() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: manufacturingKeys.boards() });
    queryClient.invalidateQueries({ queryKey: manufacturingKeys.dashboardSummary() });
  };
}

export function useEnterQueue() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof enterQueueAction>[0]) =>
      unwrapApiResult(await enterQueueAction(input)),
    onSuccess: invalidate,
  });
}

export function useStartOperation() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof startOperationAction>[0]) =>
      unwrapApiResult(await startOperationAction(input)),
    onSuccess: invalidate,
  });
}

export function usePauseOperation() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof pauseOperationAction>[0]) =>
      unwrapApiResult(await pauseOperationAction(input)),
    onSuccess: invalidate,
  });
}

export function useResumeOperation() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof resumeOperationAction>[0]) =>
      unwrapApiResult(await resumeOperationAction(input)),
    onSuccess: invalidate,
  });
}

export function useCompleteOperation() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof completeOperationAction>[0]) =>
      unwrapApiResult(await completeOperationAction(input)),
    onSuccess: invalidate,
  });
}

export function useSkipOperation() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof skipOperationAction>[0]) =>
      unwrapApiResult(await skipOperationAction(input)),
    onSuccess: invalidate,
  });
}

export function useFlagDelay() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof flagDelayAction>[0]) =>
      unwrapApiResult(await flagDelayAction(input)),
    onSuccess: invalidate,
  });
}

export function useRejectForRework() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof rejectForReworkAction>[0]) =>
      unwrapApiResult(await rejectForReworkAction(input)),
    onSuccess: invalidate,
  });
}

export function useAssignEmployee() {
  const invalidate = useInvalidateBoards();
  return useMutation({
    mutationFn: async (input: Parameters<typeof assignEmployeeAction>[0]) =>
      unwrapApiResult(await assignEmployeeAction(input)),
    onSuccess: invalidate,
  });
}
