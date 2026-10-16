// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOwnerDashboard } from '../use-owner-dashboard';
import { supabase } from '@/lib/erp-engine';

type MockSupabaseFrom = ReturnType<typeof supabase.from>;

describe('useOwnerDashboard hook (Real Backend Integration)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates real tenant manufacturing and machine load metrics correctly', async () => {
    const mockBatches = [
      { id: 'b-1', status: 'IN_PROGRESS', wip_gram: 125.5 },
      { id: 'b-2', status: 'PAUSED', wip_gram: 80.25 },
      { id: 'b-3', status: 'COMPLETED', wip_gram: 0 },
      { id: 'b-4', status: 'cancelled', wip_gram: 0 },
    ];

    const mockWip = [
      { available_qty: 10, queue_status: 'NOW', weight_g: 50 },
      { available_qty: 0, queue_status: 'NOW', weight_g: 0 },
      { available_qty: 5, queue_status: 'QUEUED', weight_g: 20 },
    ];

    const mockMachines = [
      { id: 'm-1', status: 'BUSY' },
      { id: 'm-2', status: 'BUSY' },
      { id: 'm-3', status: 'IDLE' },
      { id: 'm-4', status: 'OFFLINE' },
    ];

    const mockDiscrepancies = [
      { id: 'h-1', status: 'DISCREPANCY_FLAGGED' },
      { id: 'h-2', status: 'DISCREPANCY_FLAGGED' },
    ];

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'batches') {
        return {
          select: () => Promise.resolve({ data: mockBatches, error: null }),
        } as unknown as MockSupabaseFrom;
      }
      if (table === 'batch_stage_wip') {
        return {
          select: () => Promise.resolve({ data: mockWip, error: null }),
        } as unknown as MockSupabaseFrom;
      }
      if (table === 'machines') {
        return {
          select: () => Promise.resolve({ data: mockMachines, error: null }),
        } as unknown as MockSupabaseFrom;
      }
      if (table === 'two_party_handovers') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: mockDiscrepancies, error: null }),
          }),
        } as unknown as MockSupabaseFrom;
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      } as unknown as MockSupabaseFrom;
    });

    const { result } = renderHook(() => useOwnerDashboard());

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    // 2 active batches (b-1, b-2)
    expect(result.current.stats.activeBatches).toBe(2);
    // Total WIP grams = 125.5 + 80.25 = 205.75
    expect(result.current.stats.wipQuantityGrams).toBe(205.75);
    // 1 overdue stage (queue_status === 'NOW' and available_qty > 0)
    expect(result.current.stats.overdueStages).toBe(1);
    // 2 out of 4 machines busy = 50%
    expect(result.current.stats.machineLoadPercent).toBe(50);
    // 2 unresolved discrepancies
    expect(result.current.stats.unresolvedGoldDiscrepancies).toBe(2);
    // Score: 10.0 - (1 * 0.4 + 2 * 1.0) = 10.0 - 2.4 = 7.6
    expect(result.current.stats.productionPerformanceScore).toBe(7.6);
  });

  it('handles empty database tables without crashing', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'two_party_handovers') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        } as unknown as MockSupabaseFrom;
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      } as unknown as MockSupabaseFrom;
    });

    const { result } = renderHook(() => useOwnerDashboard());

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.stats.activeBatches).toBe(0);
    expect(result.current.stats.wipQuantityGrams).toBe(0);
    expect(result.current.stats.overdueStages).toBe(0);
    expect(result.current.stats.machineLoadPercent).toBe(0);
    expect(result.current.stats.unresolvedGoldDiscrepancies).toBe(0);
    expect(result.current.stats.productionPerformanceScore).toBe(10.0);
  });
});
