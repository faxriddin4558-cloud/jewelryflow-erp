/**
 * High-Density Multi-Model Batch Management
 *
 * Implements factory capacity requirements:
 * - 15–20 models per batch
 * - 10 sets per model (200 sets / items per batch)
 * - Model-level item breakdown, target weights, and progress tracking
 */

export interface ModelSetItem {
  modelId: string;
  modelCode: string;
  modelName: string;
  setsCount: number;
  piecesPerSet: number;
  totalPieces: number;
  targetWeightPerSetGram: number;
  totalTargetWeightGram: number;
  status: "pending" | "in_production" | "completed";
}

export interface HighDensityBatchPlan {
  batchNo: string;
  totalModelsCount: number;
  totalSetsCount: number;
  totalPiecesCount: number;
  totalIssuedGoldGram: number;
  proba: number;
  models: ModelSetItem[];
}

export interface BatchValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates a high-density batch plan against factory capacity constraints.
 * Standard factory profile:
 * - Up to 20 models per batch
 * - Typically 10 sets per model
 * - Issued gold must cover target model weights within tolerance
 */
export function validateHighDensityBatchPlan(
  plan: HighDensityBatchPlan,
  maxModels: number = 20,
  maxSetsPerModel: number = 20
): BatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan.batchNo || plan.batchNo.trim() === "") {
    errors.push("Batch number is required");
  }

  if (plan.models.length === 0) {
    errors.push("At least one model must be included in the batch");
  } else if (plan.models.length > maxModels) {
    errors.push(`Batch model count (${plan.models.length}) exceeds maximum limit of ${maxModels}`);
  }

  let computedTotalSets = 0;
  let computedTotalPieces = 0;
  let computedTotalTargetWeight = 0;

  for (let i = 0; i < plan.models.length; i++) {
    const m = plan.models[i]!;
    if (m.setsCount <= 0) {
      errors.push(`Model ${m.modelCode || i + 1}: Sets count must be greater than 0`);
    } else if (m.setsCount > maxSetsPerModel) {
      warnings.push(`Model ${m.modelCode || i + 1}: Sets count (${m.setsCount}) is high (standard is 10 sets)`);
    }

    if (m.piecesPerSet <= 0) {
      errors.push(`Model ${m.modelCode || i + 1}: Pieces per set must be at least 1`);
    }

    if (m.targetWeightPerSetGram <= 0) {
      errors.push(`Model ${m.modelCode || i + 1}: Target weight must be positive`);
    }

    computedTotalSets += m.setsCount;
    computedTotalPieces += m.setsCount * m.piecesPerSet;
    computedTotalTargetWeight += m.setsCount * m.targetWeightPerSetGram;
  }

  if (plan.totalSetsCount && plan.totalSetsCount !== computedTotalSets) {
    errors.push(
      `Plan total sets count (${plan.totalSetsCount}) does not match sum of model sets (${computedTotalSets})`
    );
  }
  if (plan.totalPiecesCount && plan.totalPiecesCount !== computedTotalPieces) {
    errors.push(
      `Plan total pieces count (${plan.totalPiecesCount}) does not match sum of model pieces (${computedTotalPieces})`
    );
  }

  if (plan.totalIssuedGoldGram <= 0) {
    errors.push("Issued gold weight must be greater than 0");
  } else if (computedTotalTargetWeight > plan.totalIssuedGoldGram * 1.05) {
    errors.push(
      `Total target weight (${computedTotalTargetWeight.toFixed(2)}g) exceeds issued gold (${plan.totalIssuedGoldGram.toFixed(2)}g) by more than 5% allowance`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Creates a standard high-density production batch plan (e.g. 15-20 models, 10 sets each).
 */
export function createStandardHighDensityBatchPlan(params: {
  batchNo: string;
  models: {
    modelId: string;
    modelCode: string;
    modelName: string;
    targetWeightPerSetGram: number;
    piecesPerSet?: number;
    setsCount?: number;
  }[];
  issuedGoldGram: number;
  proba?: number;
}): HighDensityBatchPlan {
  const proba = params.proba ?? 585;
  const processedModels: ModelSetItem[] = params.models.map((m) => {
    const setsCount = m.setsCount ?? 10;
    const piecesPerSet = m.piecesPerSet ?? 1;
    const totalPieces = setsCount * piecesPerSet;
    const totalTargetWeightGram = Number((setsCount * m.targetWeightPerSetGram).toFixed(4));
    return {
      modelId: m.modelId,
      modelCode: m.modelCode,
      modelName: m.modelName,
      setsCount,
      piecesPerSet,
      totalPieces,
      targetWeightPerSetGram: m.targetWeightPerSetGram,
      totalTargetWeightGram,
      status: "pending",
    };
  });

  const totalSetsCount = processedModels.reduce((acc, m) => acc + m.setsCount, 0);
  const totalPiecesCount = processedModels.reduce((acc, m) => acc + m.totalPieces, 0);

  return {
    batchNo: params.batchNo,
    totalModelsCount: processedModels.length,
    totalSetsCount,
    totalPiecesCount,
    totalIssuedGoldGram: params.issuedGoldGram,
    proba,
    models: processedModels,
  };
}

/**
 * Calculates per-model allocated weight share based on actual casting output.
 */
export function distributeCastingWeightToModels(
  totalCastingWeightGram: number,
  models: ModelSetItem[]
): { modelCode: string; allocatedWeightGram: number; weightPerSetGram: number }[] {
  const totalTargetWeight = models.reduce((acc, m) => acc + m.totalTargetWeightGram, 0);
  if (totalTargetWeight <= 0) return [];

  return models.map((m) => {
    const share = m.totalTargetWeightGram / totalTargetWeight;
    const allocatedWeightGram = Number((totalCastingWeightGram * share).toFixed(4));
    const weightPerSetGram = m.setsCount > 0 ? Number((allocatedWeightGram / m.setsCount).toFixed(4)) : 0;
    return {
      modelCode: m.modelCode,
      allocatedWeightGram,
      weightPerSetGram,
    };
  });
}
