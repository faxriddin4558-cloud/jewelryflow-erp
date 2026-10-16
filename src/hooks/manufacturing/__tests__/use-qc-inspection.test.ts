// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQcInspection, type QcInspectionResponse } from '../use-qc-inspection';
import * as qcLib from '@/lib/quality-control';
import type { QcReworkCompletionResult } from '@/lib/quality-control';

describe('useQcInspection hook (Real Backend Integration)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submits inspection successfully for pass result', async () => {
    vi.spyOn(qcLib, 'recordQcInspectionToDb').mockResolvedValue({
      success: true,
      qcId: 'qc-uuid-123',
    });

    const { result } = renderHook(() => useQcInspection());

    let res: QcInspectionResponse | undefined;
    await act(async () => {
      res = await result.current.submitInspection({
        batchId: 'batch-1',
        batchNo: 'B-001',
        stageName: '20. OTM Sifat Nazorati',
        currentStageOrder: 20,
        checkedQty: 10,
        passedQty: 10,
        reworkQty: 0,
        result: 'pass',
        notes: 'Barcha buyumlar mezonlarga mos',
      });
    });

    expect(res).toEqual({
      success: true,
      qcId: 'qc-uuid-123',
      storageWarning: undefined,
      reworkStageOrder: undefined,
    });
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('submits fail inspection and sets rework stage order and defect mapping', async () => {
    const recordSpy = vi.spyOn(qcLib, 'recordQcInspectionToDb').mockResolvedValue({
      success: true,
      qcId: 'qc-uuid-fail-1',
    });

    const { result } = renderHook(() => useQcInspection());

    let res: QcInspectionResponse | undefined;
    await act(async () => {
      res = await result.current.submitInspection({
        batchId: 'batch-2',
        batchNo: 'B-002',
        stageName: '20. OTM Sifat Nazorati',
        checkedQty: 5,
        passedQty: 0,
        reworkQty: 5,
        result: 'fail',
        defectCategory: 'CASTING_POROSITY',
        reworkDestination: 'CASTING',
        notes: "Quyish g'ovakligi aniqlandi",
      });
    });

    expect(res?.success).toBe(true);
    expect(res?.reworkStageOrder).toBe(8);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 'batch-2',
        reworkQty: 5,
        defectCategory: 'CASTING_POROSITY',
        reworkStageOrder: 8,
      })
    );
  });

  it('emits explicit storage warning when photoFile is provided', async () => {
    vi.spyOn(qcLib, 'recordQcInspectionToDb').mockResolvedValue({
      success: true,
      qcId: 'qc-uuid-photo',
    });

    const fakeFile = new File(['fake-photo-data'], 'defect.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => useQcInspection());

    let res: QcInspectionResponse | undefined;
    await act(async () => {
      res = await result.current.submitInspection({
        batchId: 'batch-3',
        result: 'pass',
        notes: 'Tekshiruv surati ilova qilindi',
        photoFile: fakeFile,
      });
    });

    expect(res?.success).toBe(true);
    expect(res?.storageWarning).toContain('Supabase Storage');
    expect(result.current.storageWarning).toContain('Supabase Storage');
  });

  it('handles database RPC error gracefully', async () => {
    vi.spyOn(qcLib, 'recordQcInspectionToDb').mockResolvedValue({
      success: false,
      error: 'Batch topilmadi yoki yopilgan',
    });

    const { result } = renderHook(() => useQcInspection());

    let res: QcInspectionResponse | undefined;
    await act(async () => {
      res = await result.current.submitInspection({
        batchId: 'batch-nonexistent',
        result: 'fail',
        notes: 'Xatolik tekshiruvi',
      });
    });

    expect(res?.success).toBe(false);
    expect(res?.error).toBe('Batch topilmadi yoki yopilgan');
    expect(result.current.error).toBe('Batch topilmadi yoki yopilgan');
  });

  it('completes rework successfully via completeRework', async () => {
    vi.spyOn(qcLib, 'completeQcReworkToDb').mockResolvedValue({
      success: true,
      qcId: 'qc-123',
      batchNo: 'B-001',
      completedReworkQty: 3,
      reworkStage: 8,
      returnedStage: 20,
      resolvedBy: 'Master Bobur',
    });

    const { result } = renderHook(() => useQcInspection());

    let res: QcReworkCompletionResult | undefined;
    await act(async () => {
      res = await result.current.completeRework({
        qcId: 'qc-123',
        batchId: 'batch-1',
        completedQty: 3,
        masterName: 'Master Bobur',
        resolutionNotes: 'Qayta quyildi va defekt bartaraf etildi',
      });
    });

    expect(res?.success).toBe(true);
    expect(res?.completedReworkQty).toBe(3);
    expect(result.current.error).toBeNull();
  });
});
