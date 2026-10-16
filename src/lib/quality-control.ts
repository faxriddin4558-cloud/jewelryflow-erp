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
