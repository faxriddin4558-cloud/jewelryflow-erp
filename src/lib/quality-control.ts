/**
 * JewelryFlow ERP — Quality Control (QC) & Defect Rework Engine
 *
 * Implements standard jewelry manufacturing defect classification,
 * stage-level rework dispatching, and quality metrics tracking.
 */

export type DefectCategory =
  | "CASTING_POROSITY"       // Quyishdagi g'ovaklik
  | "SURFACE_SCRATCH"        // Yuzadagi tirnalish / chiziq
  | "DIMENSIONAL_ERROR"      // O'lcham yoki simmetriya xatosi
  | "STONE_SETTING_DEFECT"   // Tosh qimirlashi yoki qiyshiq o'rnatilishi
  | "POLISHING_UNEVEN"       // Jilolashdagi notekislik yoki dog'
  | "SOLDER_JOINT_WEAK"      // Kuchsiz chok / payvandlash nuqsoni
  | "ALLOY_DISCOLORATION"    // Rangi bir xil emas / proba nuqsoni
  | "WEIGHT_OUT_OF_SPEC";    // Buyum vazni me'yordan ortiq yoki kam

export interface DefectClassification {
  code: DefectCategory;
  nameUz: string;
  recommendedReworkStage: string;
  defaultReworkStageOrder: number;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
}

export const DEFECT_CATALOG: Record<DefectCategory, DefectClassification> = {
  CASTING_POROSITY: {
    code: "CASTING_POROSITY",
    nameUz: "Quyish g'ovakligi (Porosity)",
    recommendedReworkStage: "8. Quyish",
    defaultReworkStageOrder: 8,
    severity: "CRITICAL",
  },
  SURFACE_SCRATCH: {
    code: "SURFACE_SCRATCH",
    nameUz: "Yuzadagi tirnalish (Scratch)",
    recommendedReworkStage: "11. Sanding",
    defaultReworkStageOrder: 11,
    severity: "MINOR",
  },
  DIMENSIONAL_ERROR: {
    code: "DIMENSIONAL_ERROR",
    nameUz: "O'lcham nomuvofiqligi (Dimension)",
    recommendedReworkStage: "10. Zaklirovka / To'g'rilash",
    defaultReworkStageOrder: 10,
    severity: "MAJOR",
  },
  STONE_SETTING_DEFECT: {
    code: "STONE_SETTING_DEFECT",
    nameUz: "Tosh nuqsoni (Setting defect)",
    recommendedReworkStage: "14. Tosh qo'yish",
    defaultReworkStageOrder: 14,
    severity: "MAJOR",
  },
  POLISHING_UNEVEN: {
    code: "POLISHING_UNEVEN",
    nameUz: "Jilolash notekisligi (Uneven Polish)",
    recommendedReworkStage: "17. Yakuniy polirovka",
    defaultReworkStageOrder: 17,
    severity: "MINOR",
  },
  SOLDER_JOINT_WEAK: {
    code: "SOLDER_JOINT_WEAK",
    nameUz: "Kuchsiz payvand choki (Weak Solder)",
    recommendedReworkStage: "10. Zaklirovka",
    defaultReworkStageOrder: 10,
    severity: "MAJOR",
  },
  ALLOY_DISCOLORATION: {
    code: "ALLOY_DISCOLORATION",
    nameUz: "Qotishma rang nuqsoni (Discoloration)",
    recommendedReworkStage: "18. Moyka va kislotalash",
    defaultReworkStageOrder: 18,
    severity: "MINOR",
  },
  WEIGHT_OUT_OF_SPEC: {
    code: "WEIGHT_OUT_OF_SPEC",
    nameUz: "Vazn chetlanishi (Weight Out of Spec)",
    recommendedReworkStage: "11. Sanding",
    defaultReworkStageOrder: 11,
    severity: "MAJOR",
  },
};

export interface QcInspectionInput {
  batchNo: string;
  operationName: string;
  checkedQty: number;
  passedQty: number;
  reworkQty: number;
  defectCategory?: DefectCategory;
  inspectorName: string;
  defectReason?: string;
}

export interface QcInspectionResult {
  inspectionId: string;
  isPassed: boolean;
  passRatePercentage: number;
  reworkActionRecommended: string | null;
  timestamp: string;
}

/**
 * Validates and classifies a Quality Control inspection.
 */
export function evaluateQcInspection(input: QcInspectionInput): QcInspectionResult {
  const checked = Math.max(0, input.checkedQty);
  const passed = Math.max(0, input.passedQty);
  const rework = Math.max(0, input.reworkQty);

  if (checked <= 0) {
    throw new Error("Tekshirilgan buyumlar soni 0 dan katta bo'lishi shart!");
  }
  if (passed + rework > checked) {
    throw new Error("Yaxshi va qayta ishlashga ajratilgan son tekshirilgan umumiy sondan oshib ketdi!");
  }

  const passRate = Number(((passed / checked) * 100).toFixed(1));
  const isAllPassed = rework === 0;

  let reworkRecommendation: string | null = null;
  if (rework > 0 && input.defectCategory) {
    const classification = DEFECT_CATALOG[input.defectCategory];
    if (classification) {
      reworkRecommendation = `Qayta ishlash tavsiya etiladi: "${classification.recommendedReworkStage}" bosqichiga yuborish (Nuqson: ${classification.nameUz}). Sabab: ${input.defectReason || "Sifat talabiga javob bermadi"}`;
    }
  }

  return {
    inspectionId: `QC-${Date.now()}`,
    isPassed: isAllPassed,
    passRatePercentage: passRate,
    reworkActionRecommended: reworkRecommendation,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Persistently records a quality control inspection and routes rework pieces to the target stage via Supabase RPC.
 */
export async function recordQcInspectionToDb(input: {
  batchId: string;
  batchNo: string;
  operationName: string;
  currentStageOrder: number;
  checkedQty: number;
  passedQty: number;
  reworkQty: number;
  defectCategory?: DefectCategory;
  reworkStageOrder?: number;
  inspectorName?: string;
  reason?: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; qcId?: string; error?: string }> {
  try {
    const { supabase, generateIdempotencyKey } = await import("./erp-engine");
    const targetStage =
      input.reworkStageOrder ??
      (input.defectCategory ? DEFECT_CATALOG[input.defectCategory]?.defaultReworkStageOrder ?? 8 : 8);

    const { data, error } = await supabase.rpc("rpc_record_qc_inspection", {
      p_batch_id: input.batchId,
      p_batch_no: input.batchNo,
      p_operation_name: input.operationName,
      p_current_stage_order: input.currentStageOrder,
      p_checked_qty: input.checkedQty,
      p_passed_qty: input.passedQty,
      p_rework_qty: input.reworkQty,
      p_defect_code: input.defectCategory ?? null,
      p_rework_stage_order: targetStage,
      p_inspector_name: input.inspectorName ?? "",
      p_reason: input.reason ?? null,
      p_idempotency_key: input.idempotencyKey ?? generateIdempotencyKey("qc-insp"),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const payload = data as Record<string, unknown>;
    return { success: true, qcId: String(payload.qcId || "") };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export interface QcReworkCompletionInput {
  qcId?: string;
  batchId?: string;
  batchNo?: string;
  reworkStageOrder?: number;
  inspectStageOrder?: number;
  completedQty: number;
  masterName?: string;
  resolutionNotes?: string;
  idempotencyKey?: string;
}

export interface QcReworkCompletionResult {
  success: boolean;
  qcId?: string;
  batchNo?: string;
  completedReworkQty?: number;
  reworkStage?: number;
  returnedStage?: number;
  resolvedBy?: string;
  error?: string;
}

/**
 * Marks rework completed by a master goldsmith and returns pieces to the inspection stage WIP.
 */
export async function completeQcReworkToDb(
  input: QcReworkCompletionInput
): Promise<QcReworkCompletionResult> {
  try {
    const { supabase, generateIdempotencyKey } = await import("./erp-engine");
    const { data, error } = await supabase.rpc("rpc_complete_qc_rework", {
      p_qc_id: input.qcId ?? null,
      p_batch_id: input.batchId ?? null,
      p_batch_no: input.batchNo ?? null,
      p_rework_stage_order: input.reworkStageOrder ?? 8,
      p_inspect_stage_order: input.inspectStageOrder ?? 20,
      p_completed_qty: input.completedQty,
      p_master_name: input.masterName ?? "",
      p_resolution_notes: input.resolutionNotes ?? "",
      p_idempotency_key: input.idempotencyKey ?? generateIdempotencyKey("qc-rw-comp"),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const payload = data as Record<string, unknown>;
    return {
      success: true,
      qcId: payload.qcId ? String(payload.qcId) : undefined,
      batchNo: payload.batchNo ? String(payload.batchNo) : undefined,
      completedReworkQty: typeof payload.completedReworkQty === "number" ? payload.completedReworkQty : input.completedQty,
      reworkStage: typeof payload.reworkStage === "number" ? payload.reworkStage : input.reworkStageOrder,
      returnedStage: typeof payload.returnedStage === "number" ? payload.returnedStage : input.inspectStageOrder,
      resolvedBy: payload.resolvedBy ? String(payload.resolvedBy) : input.masterName,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

