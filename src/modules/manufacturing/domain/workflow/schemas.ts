import { z } from "zod";
import { delayReasonCategorySchema } from "@/shared/lib/validation/enums";

const uuid = z.string().uuid();

/** Creates the first `batch_operations` row for a batch, at the pipeline's
 * first active workflow stage (sequence_order = 1). Called once when a
 * batch is created/released to the floor. */
export const enterQueueSchema = z.object({
  batchId: uuid,
});
export type EnterQueueInput = z.infer<typeof enterQueueSchema>;

export const startOperationSchema = z.object({
  operationId: uuid,
  performedByEmployeeId: uuid.optional(),
});
export type StartOperationInput = z.infer<typeof startOperationSchema>;

export const pauseOperationSchema = z.object({
  operationId: uuid,
  notes: z.string().max(2000).optional(),
});
export type PauseOperationInput = z.infer<typeof pauseOperationSchema>;

export const resumeOperationSchema = z.object({
  operationId: uuid,
});
export type ResumeOperationInput = z.infer<typeof resumeOperationSchema>;

export const completeOperationSchema = z.object({
  operationId: uuid,
  performedByEmployeeId: uuid.optional(),
  outputWeightGrams: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});
export type CompleteOperationInput = z.infer<typeof completeOperationSchema>;

export const skipOperationSchema = z.object({
  operationId: uuid,
  reason: z.string().min(1, "A reason is required to skip a stage.").max(2000),
});
export type SkipOperationInput = z.infer<typeof skipOperationSchema>;

export const flagDelaySchema = z.object({
  operationId: uuid,
  delayReasonCategory: delayReasonCategorySchema,
  delayReasonNotes: z.string().max(2000).optional(),
  delayedMinutes: z.number().int().positive().optional(),
});
export type FlagDelayInput = z.infer<typeof flagDelaySchema>;

/** QC (or a department operator) rejects the current attempt; a new
 * attempt is queued at the SAME stage by default (rework), or at an
 * explicit earlier `targetStageId` if the defect requires backing up
 * further than one stage. */
export const rejectForReworkSchema = z.object({
  operationId: uuid,
  reason: z.string().min(1, "A reason is required to reject an operation.").max(2000),
  targetStageId: uuid.optional(),
});
export type RejectForReworkInput = z.infer<typeof rejectForReworkSchema>;

export const assignEmployeeSchema = z.object({
  operationId: uuid,
  employeeId: uuid,
});
export type AssignEmployeeInput = z.infer<typeof assignEmployeeSchema>;

export const departmentBoardQuerySchema = z.object({
  departmentId: uuid,
  finishedLimit: z.number().int().positive().max(100).default(20),
});
export type DepartmentBoardQueryInput = z.infer<typeof departmentBoardQuerySchema>;

/** Route pages are keyed by the department's stable `code` (e.g.
 * "CASTING"), not its generated UUID — see `DepartmentRef` in
 * `repository.ts` for why. */
export const departmentByCodeQuerySchema = z.object({
  code: z.string().min(1),
});
export type DepartmentByCodeQueryInput = z.infer<typeof departmentByCodeQuerySchema>;

export const batchOperationHistoryQuerySchema = z.object({
  batchId: uuid,
});
export type BatchOperationHistoryQueryInput = z.infer<typeof batchOperationHistoryQuerySchema>;
