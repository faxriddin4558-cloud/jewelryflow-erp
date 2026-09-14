import type { BatchOperation } from "@/shared/types/domain";
import type { BatchOperationWithRelations } from "@/shared/types/domain";
import type { OperationWithStageSequence } from "../../domain/workflow/repository";

/** Shape returned by the `findOperationById` query, which joins just
 * enough of `workflow_stages` to drive transition/advance decisions. */
export interface RawOperationWithStage extends BatchOperation {
  workflow_stages: { sequence_order: number; is_terminal: boolean } | null;
}

export function mapRawOperationWithStage(raw: RawOperationWithStage): OperationWithStageSequence {
  if (!raw.workflow_stages) {
    // Should be unreachable: stage_id is `not null references workflow_stages`
    // with `on delete restrict`, so a batch_operations row can never
    // outlive its stage. Fail loudly rather than silently defaulting.
    throw new Error(
      `batch_operations row ${raw.id} has no joined workflow_stages row — data integrity violation.`
    );
  }

  return {
    ...raw,
    stageSequenceOrder: raw.workflow_stages.sequence_order,
    stageIsTerminal: raw.workflow_stages.is_terminal,
  };
}

/** Shape returned by queries that need the full relation set for display
 * (Finished column, batch history tab). */
export interface RawOperationWithRelations extends BatchOperation {
  batches: { id: string; batch_number: string; priority: BatchOperationWithRelations["batch"]["priority"] };
  workflow_stages: BatchOperationWithRelations["stage"];
  departments: BatchOperationWithRelations["department"];
  assigned_employee: BatchOperationWithRelations["assigned_employee"];
}

export function mapRawOperationWithRelations(raw: RawOperationWithRelations): BatchOperationWithRelations {
  return {
    ...raw,
    batch: raw.batches,
    stage: raw.workflow_stages,
    department: raw.departments,
    assigned_employee: raw.assigned_employee,
  };
}
