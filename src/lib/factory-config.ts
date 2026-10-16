/**
 * Factory Configuration & Dynamic Manufacturing Route Advancer
 *
 * Supports multi-tenant factory profiles with customizable workflow stages,
 * machinery limits, and worker allocation.
 *
 * For the primary factory (Goldia, admin@goldia.uz):
 * - Ponza (Pumice machine / PUMICE) is DISABLED.
 * - Zircon (Zircon machine / ZIRCON) is DISABLED.
 * - Capacity: 30+ workers, 8 laser machines, 2 casting stations.
 * - Batch density: 15–20 models per batch, 10 sets per model.
 *
 * Other tenants/factories can activate or customize any stage dynamically.
 */

export interface FactoryConfig {
  factoryId: string;
  factoryName: string;
  /** Codes or names of stages disabled for this factory (case-insensitive) */
  disabledStageCodes: string[];
  /** Specific stage sequence numbers disabled (e.g. 9 for Pumice, 13 for Zircon) */
  disabledStageOrders: number[];
  /** Route slugs disabled in the web UI (e.g. 'pumice', 'zircon') */
  disabledDepartmentSlugs: string[];
  /** Physical machinery and worker capacities */
  laserMachinesCount: number;
  castingMachinesCount: number;
  workersCount: number;
  maxModelsPerBatch: number;
  setsPerModel: number;
}

export interface StageIdentifier {
  stage_order?: number | string | null;
  code?: string | null;
  name?: string | null;
  department?: string | null;
  is_active?: boolean | null;
}

/**
 * Default Factory Configuration for Goldia Factory
 * Ponza & Zircon stages disabled; configured for 8 lasers, 2 casting operators,
 * 15-20 models per batch, 10 sets per model.
 */
export const GOLDIA_FACTORY_CONFIG: FactoryConfig = {
  factoryId: "goldia",
  factoryName: "Goldia Jewelry Factory",
  disabledStageCodes: [
    "PUMICE",
    "PUMICE_MACHINE",
    "PONZA",
    "ZIRCON",
    "ZIRCON_MACHINE",
    "ZIRKON",
  ],
  disabledStageOrders: [9, 13],
  disabledDepartmentSlugs: ["pumice", "zircon"],
  laserMachinesCount: 8,
  castingMachinesCount: 2,
  workersCount: 35,
  maxModelsPerBatch: 20,
  setsPerModel: 10,
};

/**
 * Standard Full-Pipeline Factory Configuration
 * All stages enabled (used as fallback or for tenants with pumice & zircon machines)
 */
export const FULL_PIPELINE_FACTORY_CONFIG: FactoryConfig = {
  factoryId: "full-pipeline",
  factoryName: "Standard Jewelry Factory",
  disabledStageCodes: [],
  disabledStageOrders: [],
  disabledDepartmentSlugs: [],
  laserMachinesCount: 8,
  castingMachinesCount: 2,
  workersCount: 30,
  maxModelsPerBatch: 20,
  setsPerModel: 10,
};

/** Active default configuration reference */
let activeFactoryConfig: FactoryConfig = { ...GOLDIA_FACTORY_CONFIG };

/** Get current in-memory factory configuration */
export function getActiveFactoryConfig(): FactoryConfig {
  return activeFactoryConfig;
}

/** Override current in-memory factory configuration (e.g. for testing or tenant switching) */
export function setActiveFactoryConfig(config: FactoryConfig): void {
  activeFactoryConfig = { ...config };
}

/** Reset to the Goldia factory default configuration */
export function resetFactoryConfig(): void {
  activeFactoryConfig = { ...GOLDIA_FACTORY_CONFIG };
}

/**
 * Loads the tenant's persistent factory configuration from Supabase.
 * Updates in-memory activeFactoryConfig upon successful retrieval.
 */
export async function fetchFactoryConfigFromDb(
  organizationId?: string
): Promise<FactoryConfig> {
  try {
    const { supabase } = await import("./erp-engine");
    const { data, error } = await supabase.rpc("rpc_get_factory_settings", {
      p_organization_id: organizationId ?? null,
    });

    if (error || !data) {
      return activeFactoryConfig;
    }

    const payload = data as Record<string, unknown>;
    const loadedConfig: FactoryConfig = {
      factoryId: String(payload.organizationId || payload.organizationCode || "goldia"),
      factoryName: String(payload.organizationName || "Goldia Jewelry Factory"),
      disabledStageCodes: Array.isArray(payload.disabledStageCodes) ? (payload.disabledStageCodes as string[]) : [],
      disabledStageOrders: Array.isArray(payload.disabledStageOrders) ? (payload.disabledStageOrders as number[]) : [],
      disabledDepartmentSlugs: Array.isArray(payload.disabledDepartmentSlugs) ? (payload.disabledDepartmentSlugs as string[]) : [],
      laserMachinesCount: Number(payload.laserMachinesCount ?? 8),
      castingMachinesCount: Number(payload.castingMachinesCount ?? 2),
      workersCount: Number(payload.workersCount ?? 35),
      maxModelsPerBatch: Number(payload.maxModelsPerBatch ?? 20),
      setsPerModel: Number(payload.setsPerModel ?? 10),
    };

    activeFactoryConfig = loadedConfig;
    return loadedConfig;
  } catch {
    return activeFactoryConfig;
  }
}

/**
 * Persistently saves the factory configuration into Supabase via rpc_update_factory_settings.
 */
export async function persistFactoryConfigToDb(
  updates: Partial<FactoryConfig>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await import("./erp-engine");
    const merged = { ...activeFactoryConfig, ...updates };

    const { error } = await supabase.rpc("rpc_update_factory_settings", {
      p_disabled_stage_codes: merged.disabledStageCodes,
      p_disabled_stage_orders: merged.disabledStageOrders,
      p_disabled_department_slugs: merged.disabledDepartmentSlugs,
      p_laser_machines_count: merged.laserMachinesCount,
      p_casting_machines_count: merged.castingMachinesCount,
      p_workers_count: merged.workersCount,
      p_max_models_per_batch: merged.maxModelsPerBatch,
      p_sets_per_model: merged.setsPerModel,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    activeFactoryConfig = merged;
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Normalizes an identifier string for matching (trim and uppercase, replace underscores with spaces)
 */
function normalizeIdentifier(val?: string | null): string {
  if (!val) return "";
  return val.trim().toUpperCase().replace(/[\s_-]+/g, "");
}

/**
 * Determines whether a stage is active for a given factory configuration.
 *
 * Checks:
 * 1. Explicit `is_active` boolean on stage record (if false, stage is inactive).
 * 2. `disabledStageOrders` matching stage.stage_order.
 * 3. `disabledStageCodes` matching stage.code, stage.name, or stage.department.
 */
export function isStageActive(
  stage: StageIdentifier,
  config: FactoryConfig = activeFactoryConfig
): boolean {
  if (stage.is_active === false) {
    return false;
  }

  const orderNum = stage.stage_order != null ? Number(stage.stage_order) : null;
  if (orderNum != null && !Number.isNaN(orderNum)) {
    if (config.disabledStageOrders.includes(orderNum)) {
      return false;
    }
  }

  const normalizedDisabled = config.disabledStageCodes.map((c) => normalizeIdentifier(c));

  const codeNorm = normalizeIdentifier(stage.code);
  if (codeNorm && normalizedDisabled.some((d) => codeNorm.includes(d) || d.includes(codeNorm))) {
    return false;
  }

  const nameNorm = normalizeIdentifier(stage.name);
  if (nameNorm && normalizedDisabled.some((d) => nameNorm.includes(d) || d.includes(nameNorm))) {
    return false;
  }

  const deptNorm = normalizeIdentifier(stage.department);
  if (deptNorm && normalizedDisabled.some((d) => deptNorm.includes(d) || d.includes(deptNorm))) {
    return false;
  }

  return true;
}

/**
 * Filters a list of stages to only include active ones for the given factory configuration.
 */
export function filterActiveStages<T extends StageIdentifier>(
  stages: T[],
  config: FactoryConfig = activeFactoryConfig
): T[] {
  return stages.filter((stage) => isStageActive(stage, config));
}

/**
 * Computes the next active stage order in the pipeline, skipping any disabled stages.
 * If no subsequent active stage is found, returns the terminal warehouse stage (default order 25)
 * or the last available stage.
 */
export function getNextActiveStage<T extends StageIdentifier & { stage_order: number; name: string }>(
  currentStageOrder: number,
  stages: T[],
  config: FactoryConfig = activeFactoryConfig
): T | { stage_order: number; name: string; department: string } {
  // Sort stages by stage_order ascending
  const sorted = [...stages].sort((a, b) => Number(a.stage_order) - Number(b.stage_order));

  // Find the first active stage strictly greater than currentStageOrder
  for (const st of sorted) {
    if (Number(st.stage_order) > currentStageOrder && isStageActive(st, config)) {
      return st;
    }
  }

  // Fallback: terminal finished goods warehouse stage
  return {
    stage_order: 25,
    name: "25. Tayyor mahsulot ombori",
    department: "Ombor",
  };
}

/**
 * Computes the previous active stage order in the pipeline, skipping any disabled stages.
 */
export function getPreviousActiveStage<T extends StageIdentifier & { stage_order: number }>(
  currentStageOrder: number,
  stages: T[],
  config: FactoryConfig = activeFactoryConfig
): T | null {
  const sorted = [...stages].sort((a, b) => Number(b.stage_order) - Number(a.stage_order));

  for (const st of sorted) {
    if (Number(st.stage_order) < currentStageOrder && isStageActive(st, config)) {
      return st;
    }
  }

  return null;
}

/**
 * Checks whether a department route slug (e.g. 'pumice', 'zircon') is active in the factory.
 */
export function isDepartmentSlugActive(
  slug: string,
  config: FactoryConfig = activeFactoryConfig
): boolean {
  const cleanSlug = slug.toLowerCase().trim();
  return !config.disabledDepartmentSlugs.some((d) => d.toLowerCase().trim() === cleanSlug);
}

/**
 * Returns active department route slugs filtered by factory configuration.
 */
export function getActiveDepartmentSlugs(
  allSlugs: string[],
  config: FactoryConfig = activeFactoryConfig
): string[] {
  return allSlugs.filter((slug) => isDepartmentSlugActive(slug, config));
}
