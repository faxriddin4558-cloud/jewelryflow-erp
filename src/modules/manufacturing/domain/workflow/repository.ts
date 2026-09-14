import type {
  BatchOperation,
  BatchOperationInsert,
  BatchOperationUpdate,
  BatchOperationWithRelations,
  DepartmentBoardRow,
  FactoryDashboardSummary,
  StageDurationStats,
} from "@/shared/types/domain";
import type { ResolvedNextStage } from "./types";

/**
 * Minimal department reference used to resolve a stable business key
 * (`code`, e.g. "CASTING") to the department's UUID — needed because
 * every manufacturing route page is keyed by department `code` (a
 * human-meaningful constant from the seed data), never by the
 * generated UUID, which differs per environment/seed run.
 */
export interface DepartmentRef {
  id: string;
  code: string;
  name: string;
}

/**
 * An operation row enriched with just enough of its stage to drive
 * transition/advance decisions without a second round trip: the state
 * machine needs `status`; the workflow-advancer needs the stage's
 * `sequence_order` (to find "the next stage") and `is_terminal` (to know
 * whether completing it finishes the batch — mirroring the DB trigger
 * `complete_batch_on_terminal_stage`).
 */
export interface OperationWithStageSequence extends BatchOperation {
  stageSequenceOrder: number;
  stageIsTerminal: boolean;
}

/**
 * Port for the manufacturing workflow engine. The Supabase implementation
 * lives in `infrastructure/departments/manufacturing.repository.ts`; the
 * application layer depends only on this interface, never on Supabase
 * types, so the engine is testable with an in-memory fake.
 */
export interface ManufacturingRepository {
  // ---- reference lookups ---------------------------------------------------
  findDepartmentByCode(code: string): Promise<DepartmentRef | null>;

  // ---- reads used by transition guards / the advancer -------------------
  findOperationById(operationId: string): Promise<OperationWithStageSequence | null>;
  findOpenOperationForBatch(batchId: string): Promise<BatchOperation | null>;
  findFirstActiveStage(): Promise<ResolvedNextStage | null>;
  findNextActiveStage(currentSequenceOrder: number): Promise<ResolvedNextStage | null>;
  findStageById(stageId: string): Promise<ResolvedNextStage | null>;
  countAttemptsForStage(batchId: string, stageId: string): Promise<number>;

  // ---- writes -------------------------------------------------------------
  createOperation(input: BatchOperationInsert): Promise<BatchOperation>;
  updateOperation(operationId: string, patch: BatchOperationUpdate): Promise<BatchOperation>;

  // ---- read models for boards / reports -----------------------------------
  getDepartmentOpenBoardRows(departmentId: string): Promise<DepartmentBoardRow[]>;
  getRecentlyFinished(
    departmentId: string,
    limit: number
  ): Promise<BatchOperationWithRelations[]>;
  getFactoryDashboardSummary(): Promise<FactoryDashboardSummary>;
  getBatchOperationHistory(batchId: string): Promise<BatchOperationWithRelations[]>;
  getStageDurationStats(): Promise<StageDurationStats[]>;
}
