// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { useHandoverWeight } from '../use-handover-weight';
import { renderHook, act } from '@testing-library/react';

describe('useHandoverWeight', () => {
  it('should initialize with default values', () => {
    const { result } = renderHook(() => useHandoverWeight());

    expect(result.current.inputWeight).toBe(0);
    expect(result.current.outputWeight).toBe(0);
    expect(result.current.diff).toBe(0);
    expect(result.current.isLoss).toBe(false);
    expect(result.current.isGain).toBe(false);
    expect(result.current.isCriticalLoss).toBe(false);
    expect(result.current.isValid).toBe(false);
    expect(result.current.lossPercentage).toBe(0);
  });

  it('should calculate loss correctly when output is less than input', () => {
    const { result } = renderHook(() => useHandoverWeight({ expectedInputWeight: 100, maxLossThreshold: 0.5 }));

    act(() => {
      result.current.setOutputWeight(99.6);
    });

    expect(result.current.diff).toBeCloseTo(0.4, 1);
    expect(result.current.isLoss).toBe(true);
    expect(result.current.isGain).toBe(false);
    expect(result.current.isCriticalLoss).toBe(false); // 0.4 <= 0.5
    expect(result.current.lossPercentage).toBeCloseTo(0.4, 1);
    expect(result.current.isValid).toBe(true);
  });

  it('should flag critical loss when difference exceeds threshold', () => {
    const { result } = renderHook(() => useHandoverWeight({ expectedInputWeight: 100, maxLossThreshold: 0.5 }));

    act(() => {
      result.current.setOutputWeight(99.0);
    });

    expect(result.current.diff).toBeCloseTo(1.0, 1);
    expect(result.current.isCriticalLoss).toBe(true); // 1.0 > 0.5
  });

  it('should detect gain when output is greater than input', () => {
    const { result } = renderHook(() => useHandoverWeight({ expectedInputWeight: 100 }));

    act(() => {
      result.current.setOutputWeight(100.5);
    });

    expect(result.current.diff).toBeCloseTo(-0.5, 1);
    expect(result.current.isLoss).toBe(false);
    expect(result.current.isGain).toBe(true);
    expect(result.current.isCriticalLoss).toBe(false);
  });
});
