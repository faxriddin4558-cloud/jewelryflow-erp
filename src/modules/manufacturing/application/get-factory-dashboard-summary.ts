import type { ManufacturingRepository } from "../domain/workflow/repository";
import type { FactoryDashboardSummary } from "@/shared/types/domain";

/** Thin pass-through over the `factory_dashboard_summary` view (migration
 * 013) — kept as a use case (rather than calling the repository directly
 * from the Server Action) so future KPI derivations have one place to live. */
export async function getFactoryDashboardSummary(
  repo: ManufacturingRepository
): Promise<FactoryDashboardSummary> {
  return repo.getFactoryDashboardSummary();
}
