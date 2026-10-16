// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePiecework } from '../use-piecework';
import { supabase } from '@/lib/erp-engine';

type MockSupabaseFrom = ReturnType<typeof supabase.from>;

describe('usePiecework hook (Real Backend Integration)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize and fetch real tenant piecework data', async () => {
    // Mock Supabase from("employees")
    const mockEmployee = {
      id: 'emp-uuid-1',
      name: 'Davron Usta',
      full_name: 'Davron Usta (Goldia)',
      role: 'worker',
      status: 'active',
      is_active: true,
    };

    // Mock Supabase from("salary_ledger")
    const mockLedger = [
      {
        id: 'led-1',
        tx_type: 'EARNED',
        amount: 150000,
        weight_done: 10,
        batch_no: 'BATCH-001',
        stage_name: '8. Quyish',
        created_at: '2026-10-16T10:00:00Z',
      },
      {
        id: 'led-2',
        tx_type: 'EARNED',
        amount: 200000,
        weight_done: 12,
        batch_no: 'BATCH-002',
        stage_name: '10. Zaklirovka',
        created_at: '2026-10-16T11:00:00Z',
      },
      {
        id: 'led-3',
        tx_type: 'ADJUSTMENT',
        amount: -25000,
        note: 'Texnologik nuqson jarimasi',
        created_at: '2026-10-16T12:00:00Z',
      },
    ];

    // Mock Supabase from("two_party_handovers")
    const mockHandovers = [
      {
        id: 'h-1',
        sent_pieces: 5,
        dispatched_qty: 5,
        status: 'PENDING_ACCEPTANCE',
      },
    ];

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'employees') {
        return {
          select: () => ({
            or: () => ({
              maybeSingle: async () => ({ data: mockEmployee, error: null }),
            }),
          }),
        } as unknown as MockSupabaseFrom;
      }
      if (table === 'salary_ledger') {
        const queryObj = {
          or: vi.fn().mockImplementation(() => queryObj),
          then: (resolve: (val: unknown) => void) => Promise.resolve({ data: mockLedger, error: null }).then(resolve),
        };
        return {
          select: () => ({
            order: () => queryObj,
          }),
        } as unknown as MockSupabaseFrom;
      }
      if (table === 'two_party_handovers') {
        const queryObj = {
          or: vi.fn().mockImplementation(() => queryObj),
          then: (resolve: (val: unknown) => void) => Promise.resolve({ data: mockHandovers, error: null }).then(resolve),
        };
        return {
          select: () => ({
            eq: () => queryObj,
          }),
        } as unknown as MockSupabaseFrom;
      }
      return {
        select: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      } as unknown as MockSupabaseFrom;
    });

    const { result } = renderHook(() => usePiecework('emp-uuid-1'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.employeeName).toBe('Davron Usta (Goldia)');
    expect(result.current.data?.employmentStatus).toBe('active');
    expect(result.current.data?.stats.acceptedPieces).toBe(2);
    expect(result.current.data?.stats.earnedAmount).toBe(325000); // 150000 + 200000 - 25000
    expect(result.current.data?.stats.pendingPieces).toBe(5);
    expect(result.current.data?.stats.currency).toBe('UZS');
    expect(result.current.data?.adjustments).toHaveLength(1);
    expect(result.current.data?.adjustments?.[0]?.type).toBe('penalty');
    expect(result.current.data?.adjustments?.[0]?.amount).toBe(-25000);
  });
});
