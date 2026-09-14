import type { ManufacturingRepository } from "../domain/workflow/repository";
import {
  type BatchOperationHistoryQueryInput,
  batchOperationHistoryQuerySchema,
} from "../domain/workflow/schemas";
import type { BatchOperationWithRelations } from "@/shared/types/domain";

/**
 * Full attempt-by-attempt history for a batch, across every stage it has
 * visited (including rejected/reworked attempts) — powers the batch
 * detail page's "History" / timeline tab.
 */
export async function getBatchOperationHistory(
  repo: ManufacturingRepository,
  input: BatchOperationHistoryQueryInput
): Promise<BatchOperationWithRelations[]> {
  const { batchId } = batchOperationHistoryQuerySchema.parse(input);
  return repo.getBatchOperationHistory(batchId);
}
