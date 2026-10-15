import { useState, useMemo } from 'react';

export interface UseHandoverWeightOptions {
  expectedInputWeight?: number;
  maxLossThreshold?: number; // In grams
}

export function useHandoverWeight(options: UseHandoverWeightOptions = {}) {
  const { expectedInputWeight = 0, maxLossThreshold = 0.5 } = options;

  const [inputWeight, setInputWeight] = useState<number>(expectedInputWeight);
  const [outputWeight, setOutputWeight] = useState<number>(0);

  const result = useMemo(() => {
    const diff = inputWeight - outputWeight;
    const isLoss = diff > 0;
    const isGain = diff < 0;
    const isCriticalLoss = diff > maxLossThreshold;
    const isValid = inputWeight > 0 && outputWeight > 0;

    return {
      diff,
      isLoss,
      isGain,
      isCriticalLoss,
      isValid,
      lossPercentage: inputWeight > 0 ? (diff / inputWeight) * 100 : 0
    };
  }, [inputWeight, outputWeight, maxLossThreshold]);

  return {
    inputWeight,
    setInputWeight,
    outputWeight,
    setOutputWeight,
    ...result,
  };
}
