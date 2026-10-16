import { useState } from 'react';
import type { QcResult } from '@/shared/types/database.types';
import {
  recordQcInspectionToDb,
  completeQcReworkToDb,
  type DefectCategory,
  type QcReworkCompletionInput,
  type QcReworkCompletionResult,
} from '@/lib/quality-control';
import { generateIdempotencyKey, RBAC } from '@/lib/erp-engine';

export interface QcInspectionSubmission {
  batchId: string;
  batchNo?: string;
  stageName?: string;
  currentStageOrder?: number;
  checkedQty?: number;
  passedQty?: number;
  reworkQty?: number;
  result: QcResult;
  defectCategory?: string;
  notes: string;
  photoFile?: File | null;
  reworkDestination?: string;
  inspectorName?: string;
}

export interface QcInspectionResponse {
  success: boolean;
  qcId?: string;
  error?: string;
  storageWarning?: string;
  reworkStageOrder?: number;
}

const REWORK_STAGE_ORDER_MAP: Record<string, number> = {
  CASTING: 8,
  SOLDERING: 10,
  STONE_SETTING: 14,
  PRE_POLISH: 16,
  POLISHING: 17,
  SCRAP: 8,
};

const DEFECT_CODE_MAP: Record<string, DefectCategory> = {
  POROSITY: 'CASTING_POROSITY',
  CASTING_POROSITY: 'CASTING_POROSITY',
  SURFACE_DEFECT: 'SURFACE_SCRATCH',
  SURFACE_SCRATCH: 'SURFACE_SCRATCH',
  DIMENSION_ERROR: 'DIMENSIONAL_ERROR',
  DIMENSIONAL_ERROR: 'DIMENSIONAL_ERROR',
  STONE_SETTING_DEFECT: 'STONE_SETTING_DEFECT',
  POLISHING_UNEVEN: 'POLISHING_UNEVEN',
  SOLDER_JOINT_WEAK: 'SOLDER_JOINT_WEAK',
  ALLOY_DISCOLORATION: 'ALLOY_DISCOLORATION',
  WEIGHT_OUT_OF_SPEC: 'WEIGHT_OUT_OF_SPEC',
  OTHER: 'WEIGHT_OUT_OF_SPEC',
};

/**
 * Real hook for Quality Control inspection submission and rework completion.
 * Fully wired to rpc_record_qc_inspection and rpc_complete_qc_rework.
 */
export function useQcInspection() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<QcInspectionResponse | null>(null);

  const submitInspection = async (data: QcInspectionSubmission): Promise<QcInspectionResponse> => {
    setIsSubmitting(true);
    setError(null);
    setStorageWarning(null);

    try {
      const isFail = data.result === 'fail';
      const isConditional = data.result === 'conditional_pass';
      const checked = Math.max(1, data.checkedQty ?? 1);
      const passed = isFail ? 0 : Math.max(0, data.passedQty ?? checked);
      const rework = isFail ? Math.max(1, data.reworkQty ?? checked) : 0;

      // Map defect category and rework destination
      let mappedDefect: DefectCategory | undefined;
      if (data.defectCategory) {
        const norm = data.defectCategory.toUpperCase().replace(/\s+/g, '_');
        mappedDefect = DEFECT_CODE_MAP[norm] || 'CASTING_POROSITY';
      }

      let targetReworkStage: number | undefined;
      if (data.reworkDestination) {
        const normDest = data.reworkDestination.toUpperCase().replace(/\s+/g, '_');
        targetReworkStage = REWORK_STAGE_ORDER_MAP[normDest] ?? 8;
      }

      // Check photo attachment persistence (explicitly declared unavailable if no bucket)
      let photoWarning: string | undefined;
      if (data.photoFile) {
        photoWarning =
          "Eslatma: Xavfsiz rasm saqlash (Supabase Storage) hozirda sozlanmagan. Tekshiruv dalolatnomasi matnli maʼlumotlar bilan bazaga muvaffaqiyatli saqlandi.";
        setStorageWarning(photoWarning);
      }

      const currentUser = RBAC.getCurrentUser();
      const inspector = data.inspectorName || currentUser.name || 'QC Inspector';

      // Call database RPC through erp-engine / quality-control domain
      const dbResult = await recordQcInspectionToDb({
        batchId: data.batchId,
        batchNo: data.batchNo || data.batchId,
        operationName: data.stageName || (isConditional ? 'OTM Shartli Qabul' : 'OTM Sifat Nazorati'),
        currentStageOrder: data.currentStageOrder || 20,
        checkedQty: checked,
        passedQty: passed,
        reworkQty: rework,
        defectCategory: mappedDefect,
        reworkStageOrder: targetReworkStage,
        inspectorName: inspector,
        reason: isConditional ? `[SHARTLI QABUL]: ${data.notes}` : data.notes,
        idempotencyKey: generateIdempotencyKey('qc-insp'),
      });

      if (!dbResult.success) {
        const errMsg = dbResult.error || 'QC tekshiruvini saqlashda xatolik yuz berdi';
        setError(errMsg);
        const res: QcInspectionResponse = { success: false, error: errMsg };
        setLastResult(res);
        return res;
      }

      const res: QcInspectionResponse = {
        success: true,
        qcId: dbResult.qcId,
        storageWarning: photoWarning,
        reworkStageOrder: targetReworkStage,
      };
      setLastResult(res);
      return res;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Nomaʼlum xatolik';
      setError(errMsg);
      const res: QcInspectionResponse = { success: false, error: errMsg };
      setLastResult(res);
      return res;
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Completes rework for defective pieces and restores available WIP to the inspection stage.
   */
  const completeRework = async (input: QcReworkCompletionInput): Promise<QcReworkCompletionResult> => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await completeQcReworkToDb(input);
      if (!result.success) {
        setError(result.error || 'Qayta ishlashni yakunlashda xatolik');
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nomaʼlum xatolik';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    submitInspection,
    completeRework,
    isSubmitting,
    error,
    storageWarning,
    lastResult,
  };
}
