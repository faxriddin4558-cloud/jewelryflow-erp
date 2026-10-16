// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { usePiecework } from '../use-piecework';
import { renderHook, act } from '@testing-library/react';

describe('usePiecework', () => {
  it('should initialize with loading false and data null', () => {
    const { result } = renderHook(() => usePiecework('emp-123'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('should fetch data when refetch is called', async () => {
    const { result } = renderHook(() => usePiecework('emp-123'));

    expect(result.current.isLoading).toBe(false);

    let promise: Promise<void> | undefined;
    act(() => {
      promise = result.current.refetch();
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await promise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.employeeId).toBe('emp-123');
    expect(result.current.data?.stats.acceptedPieces).toBe(145);
    expect(result.current.data?.adjustments).toHaveLength(2);
  });
});
