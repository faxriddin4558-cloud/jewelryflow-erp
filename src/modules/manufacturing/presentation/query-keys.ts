/**
 * Centralized query-key factory. Every hook builds its key here so
 * invalidation after a mutation (`use-operation-mutations.ts`) can target
 * exactly the right cache entries without string duplication.
 */
export const manufacturingKeys = {
  all: ["manufacturing"] as const,
  boards: () => [...manufacturingKeys.all, "board"] as const,
  board: (departmentId: string) => [...manufacturingKeys.boards(), departmentId] as const,
  dashboardSummary: () => [...manufacturingKeys.all, "dashboard-summary"] as const,
  batchHistory: (batchId: string) => [...manufacturingKeys.all, "batch-history", batchId] as const,
  stageStats: () => [...manufacturingKeys.all, "stage-stats"] as const,
};
