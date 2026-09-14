import type { ManufacturingRepository } from "../domain/workflow/repository";
import type { StageDurationStats } from "@/shared/types/domain";

/** Pass-through over `stage_duration_stats` (migration 013), ordered by
 * pipeline sequence — used by Reports & Analytics to surface bottlenecks. */
export async function getStageDurationStats(
  repo: ManufacturingRepository
): Promise<StageDurationStats[]> {
  return repo.getStageDurationStats();
}
