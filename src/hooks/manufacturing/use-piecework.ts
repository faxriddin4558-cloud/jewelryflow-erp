import { useState, useEffect, useCallback } from 'react';
import type { PieceworkStats, AdjustmentRecord } from '@/components/manufacturing/PieceworkDashboard';
import type { EmploymentStatus } from '@/shared/types/database.types';
import { supabase, RBAC } from '@/lib/erp-engine';

export interface PieceworkData {
  employeeId: string;
  employeeName: string;
  employmentStatus: EmploymentStatus;
  stats: PieceworkStats;
  adjustments: AdjustmentRecord[];
}

export interface UsePieceworkResult {
  data: PieceworkData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Real tenant-scoped hook for employee piecework earnings and adjustments.
 * Queries public.employees, public.salary_ledger, and public.two_party_handovers.
 */
export function usePiecework(employeeId?: string): UsePieceworkResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PieceworkData | null>(null);

  const fetchPieceworkData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const currentUser = RBAC.getCurrentUser();
      const targetEmpId = employeeId || currentUser.id;

      // 1. Fetch employee details
      let empName = currentUser.name;
      let empStatus: EmploymentStatus = 'active';

      if (targetEmpId) {
        const { data: empData, error: empErr } = await supabase
          .from('employees')
          .select('id, name, full_name, role, status, is_active')
          .or(`id.eq.${targetEmpId},user_id.eq.${targetEmpId}`)
          .maybeSingle();

        if (empErr) {
          console.warn('[usePiecework] Employee query warning:', empErr.message);
        } else if (empData) {
          empName = empData.full_name || empData.name || empName;
          const rawStatus = String(empData.status || '').toLowerCase();
          if (rawStatus === 'terminated' || empData.is_active === false) {
            empStatus = 'terminated';
          } else if (rawStatus === 'on_leave') {
            empStatus = 'on_leave';
          } else {
            empStatus = 'active';
          }
        }
      }

      // 2. Fetch salary ledger records (tenant-scoped via RLS)
      let ledgerQuery = supabase
        .from('salary_ledger')
        .select('*')
        .order('created_at', { ascending: false });

      if (targetEmpId) {
        ledgerQuery = ledgerQuery.or(`employee_id.eq.${targetEmpId},worker_name.ilike.%${empName}%`);
      }

      const { data: ledgerRows, error: ledgerErr } = await ledgerQuery;
      if (ledgerErr) {
        console.warn('[usePiecework] Salary ledger query warning:', ledgerErr.message);
      }

      // 3. Fetch pending two-party handovers for receiver piece count
      let handoverQuery = supabase
        .from('two_party_handovers')
        .select('sent_pieces, dispatched_qty, status')
        .eq('status', 'PENDING_ACCEPTANCE');

      if (targetEmpId) {
        handoverQuery = handoverQuery.or(`to_worker_id.eq.${targetEmpId},to_worker_name.ilike.%${empName}%`);
      }

      const { data: handoverRows, error: handoverErr } = await handoverQuery;
      if (handoverErr) {
        console.warn('[usePiecework] Handover query warning:', handoverErr.message);
      }

      // 4. Calculate piecework statistics
      let acceptedCount = 0;
      let earnedTotal = 0;
      const adjustmentsList: AdjustmentRecord[] = [];

      if (ledgerRows && Array.isArray(ledgerRows)) {
        for (const row of ledgerRows) {
          const txType = String(row.tx_type || '').toUpperCase();
          const amount = Number(row.amount || 0);

          if (txType === 'EARNED') {
            acceptedCount += 1;
            earnedTotal += amount;
          } else if (txType === 'ADJUSTMENT' || txType === 'REVERSAL') {
            const isNegative = txType === 'REVERSAL' || amount < 0 || String(row.note || '').toLowerCase().includes('jarima');
            const adjAmount = isNegative ? -Math.abs(amount) : Math.abs(amount);
            earnedTotal += adjAmount;

            adjustmentsList.push({
              id: String(row.id),
              date: row.created_at || new Date().toISOString(),
              amount: adjAmount,
              reason: row.note || row.stage_name || (isNegative ? 'Intizomiy jarima' : 'Mukofot'),
              type: isNegative ? 'penalty' : 'bonus',
            });
          }
        }
      }

      // Pending pieces from handovers
      interface HandoverPieceRow {
        received_pieces?: number | null;
        received_qty?: number | null;
        dispatched_qty?: number | null;
        sent_pieces?: number | null;
      }
      let pendingCount = 0;
      if (handoverRows && Array.isArray(handoverRows)) {
        pendingCount = (handoverRows as unknown as HandoverPieceRow[]).reduce((sum: number, h: HandoverPieceRow) => {
          return sum + Number(h.received_pieces || h.received_qty || h.dispatched_qty || h.sent_pieces || 1);
        }, 0);
      }

      setData({
        employeeId: targetEmpId || 'current-user',
        employeeName: empName,
        employmentStatus: empStatus,
        stats: {
          acceptedPieces: acceptedCount,
          pendingPieces: pendingCount,
          earnedAmount: Math.max(0, earnedTotal),
          currency: 'UZS',
        },
        adjustments: adjustmentsList,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nomaʼlum xatolik';
      setError(msg);
      console.error('[usePiecework] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void fetchPieceworkData();
  }, [fetchPieceworkData]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchPieceworkData,
  };
}
