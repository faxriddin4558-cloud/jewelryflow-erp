import { useState, useEffect, useCallback } from 'react';
import type { OwnerDashboardStats } from '@/components/manufacturing/OwnerDashboard';
import { supabase } from '@/lib/erp-engine';

export interface UseOwnerDashboardResult {
  stats: OwnerDashboardStats;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const DEFAULT_STATS: OwnerDashboardStats = {
  activeBatches: 0,
  overdueStages: 0,
  machineLoadPercent: 0,
  wipQuantityGrams: 0,
  unresolvedGoldDiscrepancies: 0,
  productionPerformanceScore: 10.0,
};

/**
 * Hook calculating real tenant-scoped owner and director level manufacturing metrics.
 */
export function useOwnerDashboard(): UseOwnerDashboardResult {
  const [stats, setStats] = useState<OwnerDashboardStats>(DEFAULT_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [batchesRes, wipRes, machinesRes, handoversRes] = await Promise.all([
        supabase.from('batches').select('id, status, wip_gram'),
        supabase.from('batch_stage_wip').select('available_qty, queue_status, weight_g'),
        supabase.from('machines').select('id, status'),
        supabase.from('two_party_handovers').select('id, status').eq('status', 'DISCREPANCY_FLAGGED'),
      ]);

      let activeCount = 0;
      let totalWipGrams = 0;

      if (batchesRes.data && Array.isArray(batchesRes.data)) {
        for (const b of batchesRes.data) {
          const st = String(b.status || '').toLowerCase();
          if (st !== 'completed' && st !== 'tugatildi' && st !== 'cancelled') {
            activeCount += 1;
            totalWipGrams += Number(b.wip_gram || 0);
          }
        }
      }

      let overdueCount = 0;
      if (wipRes.data && Array.isArray(wipRes.data)) {
        for (const w of wipRes.data) {
          if (w.queue_status === 'NOW' && Number(w.available_qty || 0) > 0) {
            overdueCount += 1;
          }
          if (totalWipGrams === 0 && Number(w.weight_g || 0) > 0) {
            totalWipGrams += Number(w.weight_g || 0);
          }
        }
      }

      let loadPercent = 0;
      if (machinesRes.data && Array.isArray(machinesRes.data) && machinesRes.data.length > 0) {
        const busyCount = machinesRes.data.filter(
          (m) => String(m.status || '').toUpperCase() === 'BUSY'
        ).length;
        loadPercent = Math.round((busyCount / machinesRes.data.length) * 100);
      }

      const unresolvedDiscrepancies = handoversRes.data ? handoversRes.data.length : 0;

      // Dynamic performance score calculation (1.0 to 10.0 scale)
      const penalty = overdueCount * 0.4 + unresolvedDiscrepancies * 1.0;
      const perfScore = Number(Math.max(1.0, Math.min(10.0, 10.0 - penalty)).toFixed(1));

      setStats({
        activeBatches: activeCount,
        overdueStages: overdueCount,
        machineLoadPercent: loadPercent,
        wipQuantityGrams: Number(totalWipGrams.toFixed(2)),
        unresolvedGoldDiscrepancies: unresolvedDiscrepancies,
        productionPerformanceScore: perfScore,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Metriklarni yuklashda xatolik';
      setError(msg);
      console.error('[useOwnerDashboard] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  return {
    stats,
    isLoading,
    error,
    refetch: fetchMetrics,
  };
}
