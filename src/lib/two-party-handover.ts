/**
 * Two-Party Handover & Partial Batch Verification Protocol
 *
 * Implements strict chain-of-custody for gold jewelry manufacturing:
 * 1. Sender Dispatches: Measures items and records dispatched quantity + weight.
 * 2. Receiver Acknowledges: Independently weighs the batch upon physical receipt.
 * 3. Tolerance Validation: Discrepancy within tolerance (0.05g) is auto-accepted.
 *    Discrepancy exceeding tolerance triggers DISCREPANCY_FLAGGED state.
 * 4. Partial Handover: Allows moving a subset of sets/items without blocking the whole batch.
 */

export type HandoverStatus =
  | "PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "DISCREPANCY_FLAGGED"
  | "SUPERVISOR_OVERRIDDEN"
  | "REJECTED";

export interface HandoverDispatchInput {
  handoverId?: string;
  batchId: string;
  batchNo: string;
  fromStageOrder: number;
  fromStageName: string;
  fromDepartment: string;
  toStageOrder: number;
  toStageName: string;
  toDepartment: string;
  senderWorkerId: string;
  senderWorkerName: string;
  targetReceiverWorkerId?: string | null;
  targetReceiverWorkerName?: string | null;
  dispatchedQty: number;
  dispatchedWeightGram: number;
  notes?: string;
}

export interface HandoverReceiptInput {
  handoverId: string;
  receiverWorkerId: string;
  receiverWorkerName: string;
  receivedQty: number;
  receivedWeightGram: number;
  notes?: string;
}

export interface HandoverRecord {
  id: string;
  batchId: string;
  batchNo: string;
  fromStageOrder: number;
  fromStageName: string;
  fromDepartment: string;
  toStageOrder: number;
  toStageName: string;
  toDepartment: string;
  senderWorkerId: string;
  senderWorkerName: string;
  receiverWorkerId: string | null;
  receiverWorkerName: string | null;
  dispatchedQty: number;
  dispatchedWeightGram: number;
  receivedQty: number | null;
  receivedWeightGram: number | null;
  weightDiscrepancyGram: number | null;
  status: HandoverStatus;
  toleranceGram: number;
  flagReason: string | null;
  supervisorOverrideWorkerId?: string | null;
  supervisorOverrideReason?: string | null;
  dispatchedAt: string;
  resolvedAt: string | null;
}

export const DEFAULT_HANDOVER_TOLERANCE_GRAM = 0.05;

/**
 * Creates an initial dispatch record for a batch or partial sub-batch.
 */
export function initiateHandoverDispatch(
  input: HandoverDispatchInput,
  toleranceGram: number = DEFAULT_HANDOVER_TOLERANCE_GRAM
): HandoverRecord {
  if (input.dispatchedQty <= 0) {
    throw new Error("Dispatched quantity must be greater than 0");
  }
  if (input.dispatchedWeightGram <= 0) {
    throw new Error("Dispatched weight must be greater than 0");
  }
  if (input.fromStageOrder === input.toStageOrder) {
    throw new Error("Cannot dispatch handover to the same stage");
  }

  const id = input.handoverId || `HO-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  return {
    id,
    batchId: input.batchId,
    batchNo: input.batchNo,
    fromStageOrder: input.fromStageOrder,
    fromStageName: input.fromStageName,
    fromDepartment: input.fromDepartment,
    toStageOrder: input.toStageOrder,
    toStageName: input.toStageName,
    toDepartment: input.toDepartment,
    senderWorkerId: input.senderWorkerId,
    senderWorkerName: input.senderWorkerName,
    receiverWorkerId: input.targetReceiverWorkerId ?? null,
    receiverWorkerName: input.targetReceiverWorkerName ?? null,
    dispatchedQty: input.dispatchedQty,
    dispatchedWeightGram: Number(input.dispatchedWeightGram.toFixed(4)),
    receivedQty: null,
    receivedWeightGram: null,
    weightDiscrepancyGram: null,
    status: "PENDING_ACCEPTANCE",
    toleranceGram,
    flagReason: null,
    dispatchedAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

/**
 * Verifies receiver measurement against sender dispatch measurement.
 */
export function verifyAndAcceptHandover(
  record: HandoverRecord,
  receipt: HandoverReceiptInput
): HandoverRecord {
  if (record.status !== "PENDING_ACCEPTANCE") {
    throw new Error(`Cannot accept handover in '${record.status}' state`);
  }
  if (receipt.receivedQty <= 0 || receipt.receivedWeightGram <= 0) {
    throw new Error("Received quantity and weight must be positive");
  }

  const discrepancy = Number(
    Math.abs(record.dispatchedWeightGram - receipt.receivedWeightGram).toFixed(4)
  );

  const qtyMismatch = record.dispatchedQty !== receipt.receivedQty;
  const weightExceedsTolerance = discrepancy > record.toleranceGram;

  let newStatus: HandoverStatus = "ACCEPTED";
  let flagReason: string | null = null;

  if (qtyMismatch && weightExceedsTolerance) {
    newStatus = "DISCREPANCY_FLAGGED";
    flagReason = `Quantity mismatch (sent ${record.dispatchedQty}, got ${receipt.receivedQty}) AND weight discrepancy ${discrepancy}g exceeds tolerance ${record.toleranceGram}g`;
  } else if (qtyMismatch) {
    newStatus = "DISCREPANCY_FLAGGED";
    flagReason = `Quantity mismatch: sent ${record.dispatchedQty} items, received ${receipt.receivedQty} items`;
  } else if (weightExceedsTolerance) {
    newStatus = "DISCREPANCY_FLAGGED";
    flagReason = `Weight discrepancy of ${discrepancy}g exceeds allowable tolerance of ${record.toleranceGram}g`;
  }

  return {
    ...record,
    receiverWorkerId: receipt.receiverWorkerId,
    receiverWorkerName: receipt.receiverWorkerName,
    receivedQty: receipt.receivedQty,
    receivedWeightGram: Number(receipt.receivedWeightGram.toFixed(4)),
    weightDiscrepancyGram: discrepancy,
    status: newStatus,
    flagReason,
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Allows a supervisor or director to override a flagged handover discrepancy after investigation.
 */
export function overrideHandoverDiscrepancy(
  record: HandoverRecord,
  supervisorId: string,
  reason: string
): HandoverRecord {
  if (record.status !== "DISCREPANCY_FLAGGED") {
    throw new Error(`Only flagged handovers can be overridden (current: ${record.status})`);
  }
  if (!reason || reason.trim().length < 5) {
    throw new Error("Supervisor override requires a documented investigation reason (min 5 chars)");
  }

  return {
    ...record,
    status: "SUPERVISOR_OVERRIDDEN",
    supervisorOverrideWorkerId: supervisorId,
    supervisorOverrideReason: reason.trim(),
    resolvedAt: new Date().toISOString(),
  };
}
