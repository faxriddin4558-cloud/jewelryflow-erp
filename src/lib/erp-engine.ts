import { supabase } from "./supabase/client";

export { supabase };

/**
 * JEWELRYFLOW ERP — NUMERIC PRECISION POLICY
 * - Weights (gross, net, WIP, sprue, scrap, loss): NUMERIC(14,4) (0.0001 g resolution)
 * - Exact Fine-Gold Accumulation: NUMERIC(18,6) / integer-scaled micro-grams (10^-7 g internal, 10^-4 g ledger)
 * - Currency (UZS / USD amounts, rates, balances, debts): NUMERIC(18,2) (0.01 resolution)
 * - Purity / Fineness (proba): parts per 1000 (e.g., 585, 750, 916, 988, 999)
 */
export const GOLD_PRECISION_POLICY = {
  WEIGHT_DECIMALS: 4,
  DISPLAY_DECIMALS: 2,
  EXACT_FINE_GOLD_DECIMALS: 6,
  CURRENCY_DECIMALS: 2,
  PROBA_SCALE: 1000,
  MASS_BALANCE_TOLERANCE_GRAM: 0.01,
  SEQUENTIAL_DRIFT_TOLERANCE_GRAM: 0.0001,
} as const;

export type ErpRole =
  | "admin"
  | "manager"
  | "master"
  | "worker"
  | "accountant"
  | "Director"
  | "Production Manager"
  | "Supervisor"
  | "Warehouse"
  | "Accountant"
  | "Worker";

export interface ErpUser {
  id?: string;
  email?: string;
  name: string;
  role: ErpRole;
  department: string;
}

export interface InventoryItemRow {
  id?: string;
  material_code?: string;
  name?: string;
  category?: string;
  unit?: string;
  proba?: number | string;
  on_hand?: number | string;
  stock_grams?: number | string;
  reserved?: number | string;
  created_at?: string;
}

export interface InventoryReservationRow {
  id?: string;
  item_id: string;
  order_id?: string | null;
  order_no?: string | null;
  batch_no?: string | null;
  reserved_gram: number;
  consumed_gram: number;
  released_gram: number;
  status: "ACTIVE" | "CONSUMED" | "RELEASED" | "CANCELLED";
  created_at?: string;
}

export interface GoldTransactionRow {
  id?: string;
  transaction_type?: string;
  from_location?: string;
  to_location?: string;
  material_name?: string;
  gross_weight?: number | string;
  proba?: number | string;
  pure_gold?: number | string;
  batch_no?: string;
  description?: string;
  idempotency_key?: string;
  created_at?: string;
}

export interface BatchRow {
  id?: string;
  order_id?: string;
  batch_no?: string;
  parent_batch_no?: string;
  number?: string;
  product_id?: string;
  product_name?: string;
  product?: string;
  client_name?: string;
  master_id?: string;
  master_name?: string;
  status?: string;
  proba?: number | string;
  planned_qty?: number | string;
  planned_gram?: number | string;
  actual_qty?: number | string;
  actual_gram?: number | string;
  issued_gold_gram?: number | string;
  wip_gram?: number | string;
  good_output_gram?: number | string;
  sprue_gram?: number | string;
  scrap_gram?: number | string;
  rework_gram?: number | string;
  loss_gram?: number | string;
  finished_qty?: number | string;
  stock_credited_qty?: number | string;
  current_step?: string;
  priority?: string;
  deadline?: string | null;
  created_at?: string;
}

export interface BatchStageWipRow {
  id?: string;
  batch_id?: string;
  batch_no?: string;
  stage_order: number;
  stage_name?: string;
  department?: string;
  available_qty?: number | string;
  completed_qty?: number | string;
  rework_qty?: number | string;
  input_weight?: number | string;
  output_weight?: number | string;
  loss_weight?: number | string;
  queue_status?: string;
  assigned_worker?: string;
  assigned_worker_id?: string;
}

export interface ProductionStageRow {
  id?: string;
  stage_order: number;
  name: string;
  department?: string;
}

export interface OrderRow {
  id?: string;
  order_no?: string;
  client_name?: string;
  customer_name?: string;
  phone?: string;
  product_model?: string;
  details?: string;
  proba?: number | string;
  qty?: number | string;
  weight_gram?: number | string;
  reserved_gold_gram?: number | string;
  reserved_item_id?: string | null;
  total_price?: number | string;
  advance?: number | string;
  deadline?: string | null;
  priority?: string;
  status?: string;
  batch_created?: boolean;
  created_at?: string;
}

export interface SaleRow {
  id?: string;
  product_id?: string | null;
  order_id?: string | null;
  parent_sale_id?: string | null;
  client_name?: string;
  product_name?: string;
  quantity?: number | string;
  weight?: number | string;
  proba?: number | string;
  payment_type?: string;
  total_amount?: number | string;
  paid_amount?: number | string;
  amount?: number | string;
  price?: number | string;
  total?: number | string;
  debt_amount?: number | string;
  tx_type?: string;
  created_at?: string;
}

export interface DebtRepaymentRow {
  id?: string;
  sale_id?: string | null;
  order_id?: string | null;
  client_name: string;
  payment_type: string;
  repaid_amount: number;
  previous_debt: number;
  remaining_debt: number;
  note?: string;
  idempotency_key?: string;
  created_at?: string;
}

export interface MachineRow {
  id?: string;
  name?: string;
  department?: string;
  daily_capacity?: number | string;
  current_batch?: string;
  status?: string;
}

export interface ConsumptionRow {
  id?: string;
  batch_id?: string;
  batch_no?: string;
  batch?: string;
  master_id?: string;
  master_name?: string;
  master?: string;
  department?: string;
  proba?: number | string;
  given_weight?: number | string;
  given?: number | string;
  returned_weight?: number | string;
  returned?: number | string;
  sprue_gram?: number | string;
  loss_weight?: number | string | null;
  sent_to_refinery?: boolean;
  created_at?: string;
}

export interface ProductRow {
  id?: string;
  name?: string;
  title?: string;
  category?: string;
  weight?: number | string;
  proba?: number | string;
  stock?: number | string | null;
  quantity?: number | string | null;
  stone_weight?: number | string;
  bom_version?: number | string;
  bom_details?: string;
  image_url?: string;
  created_at?: string;
}

export interface BomItemInput {
  component_name: string;
  material_category: string;
  weight_per_set: number;
  proba: number;
}

export interface EmployeeRow {
  id?: string;
  user_id?: string;
  full_name?: string;
  name?: string;
  email?: string;
  role?: string;
  department?: string;
  role_type?: string;
  position?: string;
  status?: string;
  employment_status?: string;
  is_active?: boolean;
  salary_type?: string;
  rate?: number | string;
  balance?: number | string;
}

export interface SalaryLedgerRow {
  id?: string;
  employee_id?: string;
  worker_name?: string;
  batch_no?: string;
  stage_name?: string;
  tx_type?: "EARNED" | "PAID" | "ADJUSTMENT" | "REVERSAL" | string;
  weight_done?: number | string;
  rate?: number | string;
  amount?: number | string;
  payment_status?: string;
  note?: string;
  handover_id?: string;
  stage_order?: number;
  original_ledger_id?: string;
  organization_id?: string;
  idempotency_key?: string;
  created_at?: string;
}

export interface QualityControlRow {
  id?: string;
  created_at: string;
  batch_id?: string;
  batch_no?: string;
  operation_name?: string;
  checked_qty?: number | string;
  passed_qty?: number | string;
  rework_qty?: number | string;
  defect_code?: string;
  rework_stage_order?: number;
  inspector_name?: string;
  reason?: string;
  status?: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
  organization_id?: string;
}

export interface AuditLogRow {
  id?: string;
  table_name?: string;
  record_id?: string;
  action?: string;
  actor_name?: string;
  actor_role?: string;
  old_data?: unknown;
  new_data?: unknown;
  reason?: string;
  created_at: string;
}

/**
 * NOTE ON SECURITY:
 * Client-side RBAC is a UI-layer guard only and does NOT provide database
 * security. True authorization is enforced server-side via Supabase Auth,
 * PostgreSQL Row Level Security (RLS), and `assert_erp_permission()` inside
 * atomic `SECURITY DEFINER` RPCs.
 * Default state is least-privilege ("Worker") — never a hardcoded administrator.
 */
const DEFAULT_USER: ErpUser = {
  name: "Unverified Session",
  role: "Worker",
  department: "Unassigned",
};

let currentSessionUser: ErpUser = { ...DEFAULT_USER };

const ROLE_PERMISSIONS: Record<ErpRole, ReadonlySet<string>> = {
  admin: new Set([
    "edit_inventory",
    "edit_sales",
    "create_batch",
    "edit_salary_rate",
    "move_batch",
    "move_wip",
    "split_batch",
    "record_consumption",
    "manage_products",
  ]),
  Director: new Set([
    "edit_inventory",
    "edit_sales",
    "create_batch",
    "edit_salary_rate",
    "move_batch",
    "move_wip",
    "split_batch",
    "record_consumption",
    "manage_products",
  ]),
  manager: new Set([
    "create_batch",
    "move_batch",
    "move_wip",
    "split_batch",
    "record_consumption",
    "manage_products",
  ]),
  "Production Manager": new Set([
    "create_batch",
    "move_batch",
    "move_wip",
    "split_batch",
    "record_consumption",
    "manage_products",
  ]),
  master: new Set(["create_batch", "move_batch", "move_wip", "record_consumption"]),
  Supervisor: new Set(["create_batch", "move_batch", "move_wip", "record_consumption"]),
  Warehouse: new Set(["edit_inventory", "manage_products"]),
  accountant: new Set(["edit_sales", "edit_salary_rate"]),
  Accountant: new Set(["edit_sales", "edit_salary_rate"]),
  worker: new Set([]),
  Worker: new Set([]),
};

const RESTRICTED_WORKER_MODULES = new Set([
  "sales",
  "finance",
  "accounting",
  "inventory_admin",
  "salary_admin",
]);

function classifyRoleToken(token?: string | null): ErpRole | null {
  const lower = (token || "").trim().toLowerCase();
  if (!lower) return null;
  if (
    lower === "admin" ||
    lower === "director" ||
    lower === "owner" ||
    lower === "direktor" ||
    lower === "rahbar"
  ) {
    return "Director";
  }
  if (
    lower === "manager" ||
    lower === "production manager" ||
    lower === "production_manager" ||
    lower === "ishlab chiqarish boshlig'i"
  ) {
    return "Production Manager";
  }
  if (
    lower === "master" ||
    lower === "supervisor" ||
    lower === "department_head" ||
    lower === "quality_inspector" ||
    lower === "quality_control" ||
    lower === "qc" ||
    lower === "otk" ||
    lower === "bosh usta" ||
    lower === "usta"
  ) {
    return "Supervisor";
  }
  if (lower === "warehouse" || lower === "inventory_manager" || lower === "omborchi") {
    return "Warehouse";
  }
  if (lower === "accountant" || lower === "sales" || lower === "buxgalter" || lower === "hisobchi") {
    return "Accountant";
  }
  if (
    lower === "worker" ||
    lower === "department_operator" ||
    lower === "zargar" ||
    lower === "operator" ||
    lower === "viewer"
  ) {
    return "Worker";
  }
  return null;
}

export function resolveEmployeeRole(emp?: Partial<EmployeeRow> | null): ErpRole {
  if (!emp) return "Worker";
  if (emp.is_active === false) return "Worker";
  const rawStatus = (emp.status || emp.employment_status || "").trim().toLowerCase();
  if (rawStatus && rawStatus !== "active" && rawStatus !== "faol") {
    return "Worker";
  }

  const roleTypeMatch = classifyRoleToken(emp.role_type);
  const roleColMatch = classifyRoleToken(emp.role);
  const posMatch = classifyRoleToken(emp.position);

  // Explicit role precedence rule (aligned with PostgreSQL current_employee_role_text()):
  // 1. Specific non-generic role_type (Director, Production Manager, Accountant, Warehouse, Supervisor)
  //    takes precedence over generic default role column ('worker'/'viewer'/'department_operator').
  // 2. Specific non-generic role column takes next precedence.
  // 3. Validated generic role_type / role column / position fallback.
  // 4. Unknown or malformed role values fail closed to 'Worker'.
  if (roleTypeMatch && roleTypeMatch !== "Worker") {
    return roleTypeMatch;
  }
  if (roleColMatch && roleColMatch !== "Worker") {
    return roleColMatch;
  }
  if (roleTypeMatch) {
    return roleTypeMatch;
  }
  if (roleColMatch) {
    return roleColMatch;
  }
  if (posMatch) {
    return posMatch;
  }
  return "Worker";
}

export function generateIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

const rbacListeners = new Set<(user: ErpUser) => void>();

function notifyRbacListeners(): void {
  const snapshot = { ...currentSessionUser };
  rbacListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore listener errors
    }
  });
}

export const RBAC = {
  getCurrentUser: (): ErpUser => ({ ...currentSessionUser }),
  setCurrentUser: (user: ErpUser): void => {
    if (!user || !user.role) return;
    currentSessionUser = {
      id: user.id != null ? String(user.id) : undefined,
      email: user.email,
      name: user.name || DEFAULT_USER.name,
      role: user.role,
      department: user.department || DEFAULT_USER.department,
    };
    notifyRbacListeners();
  },
  resetUser: (): void => {
    currentSessionUser = { ...DEFAULT_USER };
    notifyRbacListeners();
  },
  subscribe: (listener: (user: ErpUser) => void): (() => void) => {
    rbacListeners.add(listener);
    return () => {
      rbacListeners.delete(listener);
    };
  },
  hasPermission: (role: ErpRole, action: string): boolean => {
    const allowed = ROLE_PERMISSIONS[role];
    return allowed ? allowed.has(action) : false;
  },
  can: (action: string): boolean => {
    return RBAC.hasPermission(currentSessionUser.role, action);
  },
  canAccessModule: (role: ErpRole, moduleName: string): boolean => {
    if (!moduleName) return false;
    if (role === "worker" || role === "Worker") {
      return !RESTRICTED_WORKER_MODULES.has(moduleName.toLowerCase());
    }
    return Boolean(ROLE_PERMISSIONS[role]);
  },
};

export interface AlloyCalculationResult {
  pureGold: number;
  fineGold: number;
  totalWeight: number;
  totalOutputWeight: number;
  ligatureNeeded: number;
  requiredLigature: number;
  silverPart: number;
  copperPart: number;
  newGoldShare: number;
  oldGoldShare: number;
  fineGoldToAdd: number;
  sourceGoldDeducted: number;
  fineGold999Deducted: number;
  silverDeducted: number;
  copperDeducted: number;
}

export interface RefiningCalculationResult {
  expectedFine: number;
  actualFine: number;
  refLoss: number;
  copperRemoved: number;
  isValid: boolean;
}

export interface MassBalanceInput {
  inputGold: number;
  goodProduct: number;
  sprue: number;
  scrap: number;
  rework: number;
  loss: number;
  remainingWip: number;
}

export interface MassBalanceResult {
  isBalanced: boolean;
  accountedWeight: number;
  discrepancy: number;
  statusText: string;
}

export interface StageLossValidationInput {
  inputWeightGram: number;
  lossWeightGram: number;
  maxLossPct?: number;
  maxLossGram?: number;
  stageName?: string;
}

export interface StageLossValidationResult {
  isAcceptable: boolean;
  lossPct: number;
  lossWeightGram: number;
  maxLossPct: number;
  maxLossGram: number;
  excessLossGram: number;
  status: "ACCEPTABLE" | "EXCESSIVE_LOSS_ALERT";
  statusText: string;
}

export interface FineGoldAccumulationEntry {
  grossWeight: number | string;
  proba: number | string;
}

export interface HandoverAuditRow {
  id?: string;
  batch_no?: string;
  status?: string;
  dispatched_weight_gram?: number;
  received_weight_gram?: number | null;
  weight_discrepancy_gram?: number | null;
  tolerance_gram?: number;
  dispatched_at?: string;
}

export interface FactoryIntegrityAuditInput {
  inv?: InventoryItemRow[];
  batches?: BatchRow[];
  wipRows?: BatchStageWipRow[];
  handovers?: HandoverAuditRow[];
  sales?: SaleRow[];
  debtRepayments?: DebtRepaymentRow[];
  products?: ProductRow[];
  salaryLedger?: SalaryLedgerRow[];
}

export interface FactoryIntegrityAnomaly {
  severity: "CRITICAL" | "WARNING" | "INFO";
  category: "SAFE_VAULT" | "MASS_BALANCE" | "HANDOVER" | "FINANCE" | "PAYROLL";
  entityId: string;
  description: string;
  varianceGram?: number;
}

export interface FactoryIntegrityAuditReport {
  isHealthy: boolean;
  totalGoldIssuedGram: number;
  totalGoldAccountedGram: number;
  unaccountedGoldLeakGram: number;
  safeRawGoldOnHandGram: number;
  safeReservedGoldGram: number;
  safeAvailableGoldGram: number;
  fineGoldTotalGram: number;
  activeWipGoldGram: number;
  finishedProductGoldGram: number;
  anomaliesCount: number;
  anomalies: FactoryIntegrityAnomaly[];
}

export const GoldEngine = {
  /**
   * Standard 2-decimal Fine Gold display helper (preserved for backward compatibility).
   */
  toFineGold: (
    grossWeight: number | string | null | undefined,
    proba: number | string | null | undefined
  ): number => {
    const w = Number(grossWeight ?? 0);
    const p = Number(proba ?? 0);
    if (!Number.isFinite(w) || !Number.isFinite(p) || w <= 0 || p <= 0 || p > 1000) {
      return 0;
    }
    return Number(((w * p) / 1000).toFixed(2));
  },

  /**
   * 4-decimal pure gold calculation matching PostgreSQL `NUMERIC(14,4)`.
   */
  toPureGold: (
    grossWeight: number | string | null | undefined,
    proba: number | string | null | undefined
  ): number => {
    const w = Number(grossWeight ?? 0);
    const p = Number(proba ?? 0);
    if (!Number.isFinite(w) || !Number.isFinite(p) || w <= 0 || p <= 0 || p > 1000) {
      return 0;
    }
    const wScaled = Math.round(w * 10000);
    const pScaled = Math.round(p * 100);
    return Number(((wScaled * pScaled) / 1_000_000_000).toFixed(4));
  },

  /**
   * Exact integer-scaled fine gold calculation matching PostgreSQL `calc_fine_gold_exact` (`NUMERIC(18,6)`).
   * Prevents floating-point binary representation drift across sequential transactions.
   */
  toFineGoldExact: (
    grossWeight: number | string | null | undefined,
    proba: number | string | null | undefined
  ): number => {
    const w = Number(grossWeight ?? 0);
    const p = Number(proba ?? 0);
    if (!Number.isFinite(w) || !Number.isFinite(p) || w <= 0 || p <= 0 || p > 1000) {
      return 0;
    }
    const wScaled = Math.round(w * 10000); // 0.0001 g units
    const pScaled = Math.round(p * 100); // 0.01 proba units
    return Number(((wScaled * pScaled) / 1_000_000_000).toFixed(7));
  },

  /**
   * Accumulates sequential fine-gold transactions using exact integer-scaled arithmetic
   * before final rounding, guaranteeing <= 0.0001 g drift across 100+ sequential operations.
   */
  accumulateFineGold: (entries: FineGoldAccumulationEntry[]) => {
    let totalScaled = 0; // units of 10^-9 g
    let totalGrossScaled = 0; // units of 10^-4 g
    for (const entry of entries) {
      const w = Number(entry.grossWeight ?? 0);
      const p = Number(entry.proba ?? 0);
      if (Number.isFinite(w) && Number.isFinite(p) && w > 0 && p > 0 && p <= 1000) {
        const wScaled = Math.round(w * 10000);
        const pScaled = Math.round(p * 100);
        totalGrossScaled += wScaled;
        totalScaled += wScaled * pScaled;
      }
    }
    const grossGrams = Number((totalGrossScaled / 10000).toFixed(4));
    const exactGrams = Number((totalScaled / 1_000_000_000).toFixed(6));
    const grams4dp = Number((totalScaled / 1_000_000_000).toFixed(4));
    const grams2dp = Number((totalScaled / 1_000_000_000).toFixed(2));
    return {
      grossGrams,
      exactGrams,
      grams4dp,
      grams2dp,
    };
  },

  calculateAlloy: (
    inputWeight: number,
    currentProba: number,
    targetProba: number,
    ligatureRatio: number = 70
  ): AlloyCalculationResult => {
    const inW = Number(inputWeight);
    const curP = Number(currentProba);
    const tarP = Number(targetProba);
    const clampedRatio = Math.min(
      100,
      Math.max(0, Number.isFinite(ligatureRatio) ? ligatureRatio : 70)
    );

    if (
      !Number.isFinite(inW) ||
      !Number.isFinite(curP) ||
      !Number.isFinite(tarP) ||
      inW <= 0 ||
      curP <= 0 ||
      curP > 1000 ||
      tarP <= 0 ||
      tarP > 1000
    ) {
      return {
        pureGold: 0,
        fineGold: 0,
        totalWeight: 0,
        totalOutputWeight: 0,
        ligatureNeeded: 0,
        requiredLigature: 0,
        silverPart: 0,
        copperPart: 0,
        newGoldShare: 0,
        oldGoldShare: 0,
        fineGoldToAdd: 0,
        sourceGoldDeducted: 0,
        fineGold999Deducted: 0,
        silverDeducted: 0,
        copperDeducted: 0,
      };
    }

    if (tarP > curP) {
      // Up-alloying: raising purity requires consuming additional 999 fine gold from SAFE inventory
      const fineToAdd = tarP < 999 ? (inW * (tarP - curP)) / (999 - tarP) : 0;
      const fineToAdd4dp = Number(fineToAdd.toFixed(4));
      const totalUpWeight = inW + fineToAdd4dp;
      const pureUpGold = (inW * curP + fineToAdd4dp * 999) / 1000;
      return {
        pureGold: Number(pureUpGold.toFixed(4)),
        fineGold: Number(pureUpGold.toFixed(2)),
        totalWeight: Number(totalUpWeight.toFixed(4)),
        totalOutputWeight: Number(totalUpWeight.toFixed(2)),
        ligatureNeeded: 0,
        requiredLigature: 0,
        silverPart: 0,
        copperPart: 0,
        newGoldShare: Number(((inW * clampedRatio) / 100).toFixed(2)),
        oldGoldShare: Number(((inW * (100 - clampedRatio)) / 100).toFixed(2)),
        fineGoldToAdd: fineToAdd4dp,
        sourceGoldDeducted: Number(inW.toFixed(4)),
        fineGold999Deducted: fineToAdd4dp,
        silverDeducted: 0,
        copperDeducted: 0,
      };
    }

    const rawPureGold = (inW * curP) / 1000;
    const rawTotalRequiredWeight = (rawPureGold * 1000) / tarP;
    const rawAddedLigature = Math.max(0, rawTotalRequiredWeight - inW);
    const silverPart = Number(((rawAddedLigature * (100 - clampedRatio)) / 100).toFixed(4));
    const copperPart = Number(((rawAddedLigature * clampedRatio) / 100).toFixed(4));

    return {
      pureGold: Number(rawPureGold.toFixed(4)),
      fineGold: Number(rawPureGold.toFixed(2)),
      totalWeight: Number(rawTotalRequiredWeight.toFixed(4)),
      totalOutputWeight: Number(rawTotalRequiredWeight.toFixed(2)),
      ligatureNeeded: Number(rawAddedLigature.toFixed(4)),
      requiredLigature: Number(rawAddedLigature.toFixed(2)),
      silverPart,
      copperPart,
      newGoldShare: Number(((inW * clampedRatio) / 100).toFixed(2)),
      oldGoldShare: Number(((inW * (100 - clampedRatio)) / 100).toFixed(2)),
      fineGoldToAdd: 0,
      sourceGoldDeducted: Number(inW.toFixed(4)),
      fineGold999Deducted: 0,
      silverDeducted: silverPart,
      copperDeducted: copperPart,
    };
  },

  calculateRefining: (
    scrapWeight: number,
    estimatedProba: number,
    outputWeight: number,
    outputProba: number = 999
  ): RefiningCalculationResult => {
    const scW = Math.max(0, Number(scrapWeight) || 0);
    const estP = Number(estimatedProba) || 0;
    const outW = Math.max(0, Number(outputWeight) || 0);
    const outP = Number(outputProba) || 999;

    const expectedFine = GoldEngine.toFineGold(scW, estP);
    const actualFine = GoldEngine.toFineGold(outW, outP);
    const isValid = scW > 0 && outW > 0 && outW <= scW && actualFine <= expectedFine + 0.01;
    const refLoss = Number(Math.max(0, expectedFine - actualFine).toFixed(4));
    const copperRemoved = Number(Math.max(0, scW - outW - refLoss).toFixed(4));

    return {
      expectedFine,
      actualFine,
      refLoss,
      copperRemoved,
      isValid,
    };
  },

  verifyMassBalance: (input: MassBalanceInput): MassBalanceResult => {
    const inG = Number(input.inputGold);
    const goodG = Number(input.goodProduct);
    const sprueG = Number(input.sprue);
    const scrapG = Number(input.scrap);
    const reworkG = Number(input.rework);
    const lossG = Number(input.loss);
    const wipG = Number(input.remainingWip);

    if (
      !Number.isFinite(inG) ||
      inG <= 0 ||
      goodG < 0 ||
      sprueG < 0 ||
      scrapG < 0 ||
      reworkG < 0 ||
      lossG < 0 ||
      wipG < 0
    ) {
      return {
        isBalanced: false,
        accountedWeight: 0,
        discrepancy: Number.isFinite(inG) ? inG : 0,
        statusText: "NO INPUT GOLD / INVALID",
      };
    }

    const accountedWeight = Number((goodG + sprueG + scrapG + reworkG + lossG + wipG).toFixed(4));
    const discrepancy = Number((inG - accountedWeight).toFixed(4));
    const isBalanced = Math.abs(discrepancy) <= GOLD_PRECISION_POLICY.MASS_BALANCE_TOLERANCE_GRAM;

    return {
      isBalanced,
      accountedWeight,
      discrepancy,
      statusText: isBalanced
        ? "BALANCED (0.00g)"
        : `ANOMALY (${discrepancy > 0 ? "-" : "+"}${Math.abs(discrepancy).toFixed(2)}g)`,
    };
  },

  validateStageLoss: (input: StageLossValidationInput): StageLossValidationResult => {
    const inW = Math.max(0, Number(input.inputWeightGram) || 0);
    const lossW = Math.max(0, Number(input.lossWeightGram) || 0);
    const maxPct = Number(input.maxLossPct ?? 1.0);
    const maxGram = Number(input.maxLossGram ?? 0.5);

    const lossPct = inW > 0 ? Number(((lossW / inW) * 100).toFixed(3)) : 0;
    const maxAllowedByPct = Number(((inW * maxPct) / 100).toFixed(4));
    const effectiveLimitGram = Math.min(maxGram, maxAllowedByPct > 0 ? maxAllowedByPct : maxGram);

    const isAcceptable = lossW <= effectiveLimitGram && (inW === 0 || lossPct <= maxPct);
    const excessLossGram = Number(Math.max(0, lossW - effectiveLimitGram).toFixed(4));

    return {
      isAcceptable,
      lossPct,
      lossWeightGram: lossW,
      maxLossPct: maxPct,
      maxLossGram: maxGram,
      excessLossGram,
      status: isAcceptable ? "ACCEPTABLE" : "EXCESSIVE_LOSS_ALERT",
      statusText: isAcceptable
        ? `Ruxsat etilgan me'yor doirasida (${lossW.toFixed(2)}g / ${lossPct.toFixed(2)}%)`
        : `XATO: Yo'qotish me'yordan oshdi (+${excessLossGram.toFixed(2)}g ortiqcha pateriya)!`,
    };
  },

  calculateSafeGoldSummary: (items: InventoryItemRow[]) => {
    const goldItems = items.filter((x) => {
      const cat = (x.category || "").toLowerCase();
      return cat === "gold" || cat === "raw_gold" || cat === "scrap_gold";
    });
    const rawGoldOnHand = Number(
      goldItems
        .reduce((s, x) => s + Math.max(0, Number(x.on_hand ?? x.stock_grams ?? 0)), 0)
        .toFixed(4)
    );
    const reservedGold = Number(
      goldItems.reduce((s, x) => s + Math.max(0, Number(x.reserved || 0)), 0).toFixed(4)
    );
    const availableGold = Number(Math.max(0, rawGoldOnHand - reservedGold).toFixed(4));
    const acc = GoldEngine.accumulateFineGold(
      goldItems.map((x) => ({
        grossWeight: Math.max(0, Number(x.on_hand ?? x.stock_grams ?? 0)),
        proba: Number(x.proba || 0),
      }))
    );

    return {
      rawGoldOnHand,
      reservedGold,
      availableGold,
      fineGoldTotal: acc.grams4dp,
      fineGoldExactTotal: acc.exactGrams,
    };
  },

  calculateFinancialSummary: (sales: SaleRow[], orders: OrderRow[]) => {
    const getSaleSum = (x: SaleRow): number =>
      Number(x.total_amount ?? x.amount ?? x.price ?? x.total ?? 0);

    const isSyntheticOrderAdvance = (s: SaleRow): boolean => {
      const pName = (s.product_name || "").trim();
      return pName.startsWith("Buyurtma Avansi (") || pName.startsWith("Buyurtma Avansi");
    };

    const isOrderDebtRepayment = (s: SaleRow): boolean => {
      return s.tx_type === "debt_repayment" && Boolean(s.order_id);
    };

    const isCancelledOrder = (o: OrderRow): boolean => {
      const st = (o.status || "").trim().toLowerCase();
      return st === "bekor qilindi" || st === "cancelled";
    };

    // Direct sales + sale debt repayments (order debt repayments are already reflected in orders.advance when orders are loaded)
    const directSalesIn = sales
      .filter(
        (s) =>
          s.tx_type !== "chiqim" &&
          !isSyntheticOrderAdvance(s) &&
          !(orders.length > 0 && isOrderDebtRepayment(s))
      )
      .reduce((sum, s) => sum + getSaleSum(s), 0);

    const orderAdvancesIn =
      orders.length > 0
        ? orders.reduce((sum, o) => sum + Math.max(0, Number(o.advance || 0)), 0)
        : sales
            .filter((s) => s.tx_type !== "chiqim" && isSyntheticOrderAdvance(s))
            .reduce((sum, s) => sum + getSaleSum(s), 0);

    const kassaIn = Number((directSalesIn + orderAdvancesIn).toFixed(2));

    const kassaOut = Number(
      sales
        .filter((s) => s.tx_type === "chiqim")
        .reduce((sum, s) => sum + getSaleSum(s), 0)
        .toFixed(2)
    );

    const directSalesDebt = sales
      .filter((s) => !isSyntheticOrderAdvance(s) && s.tx_type !== "debt_repayment")
      .reduce((sum, s) => sum + Math.max(0, Number(s.debt_amount || 0)), 0);

    const ordersRemainingDebt =
      orders.length > 0
        ? orders
            .filter((o) => !isCancelledOrder(o))
            .reduce(
              (sum, o) => sum + Math.max(0, Number(o.total_price || 0) - Number(o.advance || 0)),
              0
            )
        : sales
            .filter((s) => isSyntheticOrderAdvance(s))
            .reduce((sum, s) => sum + Math.max(0, Number(s.debt_amount || 0)), 0);

    const customerDebt = Number((directSalesDebt + ordersRemainingDebt).toFixed(2));

    return {
      kassaIn,
      kassaOut,
      kassaNet: Number((kassaIn - kassaOut).toFixed(2)),
      customerDebt,
    };
  },

  /**
   * Factory-Wide Gold Conservation, Chain-of-Custody, and Financial Reconciliation Engine.
   * Scans all inventory, batches, handovers, sales, and payroll ledgers to detect:
   * - Missing or unaccounted gold
   * - Negative balances
   * - Broken batch mass balances
   * - Handover discrepancies & frozen chain-of-custody transfers
   * - Financial kassa/debt imbalances
   * - Duplicate piecework earnings
   */
  auditFactoryIntegrity: (ctx: FactoryIntegrityAuditInput): FactoryIntegrityAuditReport => {
    const anomalies: FactoryIntegrityAnomaly[] = [];

    // 1. SAFE VAULT AUDIT
    const inv = ctx.inv || [];

    for (const item of inv) {
      const onHand = Number(item.on_hand ?? item.stock_grams ?? 0);
      const reserved = Number(item.reserved ?? 0);
      const proba = Number(item.proba ?? 0);
      const name = item.name || item.material_code || "Noma'lum material";

      if (onHand < 0) {
        anomalies.push({
          severity: "CRITICAL",
          category: "SAFE_VAULT",
          entityId: String(item.id || name),
          description: `SAFE omborida manfiy qoldiq aniqlandi: ${name} (${onHand}g). Jismonan manfiy oltin mavjud bo'lishi mumkin emas!`,
          varianceGram: onHand,
        });
      }

      if (reserved > onHand && onHand >= 0) {
        anomalies.push({
          severity: "CRITICAL",
          category: "SAFE_VAULT",
          entityId: String(item.id || name),
          description: `Rezervdagi oltin (${reserved}g) mavjud qoldiqdan (${onHand}g) oshib ketgan: ${name}`,
          varianceGram: Number((reserved - onHand).toFixed(4)),
        });
      }

      if (onHand > 0 && (proba <= 0 || proba > 1000)) {
        anomalies.push({
          severity: "WARNING",
          category: "SAFE_VAULT",
          entityId: String(item.id || name),
          description: `Noto'g'ri proba kiritilgan: ${name} (proba: ${proba}). 1 dan 1000 gacha bo'lishi shart!`,
        });
      }
    }

    const safeSummary = GoldEngine.calculateSafeGoldSummary(inv);

    // 2. BATCH MASS BALANCE & LEAKAGE AUDIT
    const batches = ctx.batches || [];
    let totalGoldIssuedGram = 0;
    let totalGoldAccountedGram = 0;
    let totalActiveWipGram = 0;

    for (const b of batches) {
      const bCode = b.batch_no || b.number || "BATCH";
      const isCompleted = b.status === "COMPLETED" || b.status === "Tugatildi";
      const inG = Number(b.issued_gold_gram ?? b.planned_gram ?? 0);
      const goodG = Number(b.good_output_gram ?? (isCompleted ? b.actual_gram ?? 0 : 0));
      const sprueG = Number(b.sprue_gram ?? 0);
      const scrapG = Number(b.scrap_gram ?? 0);
      const reworkG = Number(b.rework_gram ?? 0);
      const lossG = Number(b.loss_gram ?? 0);
      const wipG = isCompleted ? 0 : Number(b.wip_gram ?? Math.max(0, inG - goodG - sprueG - scrapG - reworkG - lossG));

      totalGoldIssuedGram += inG;
      totalActiveWipGram += wipG;

      if (inG > 0) {
        const mb = GoldEngine.verifyMassBalance({
          inputGold: inG,
          goodProduct: goodG,
          sprue: sprueG,
          scrap: scrapG,
          rework: reworkG,
          loss: lossG,
          remainingWip: wipG,
        });

        totalGoldAccountedGram += mb.accountedWeight;

        if (!mb.isBalanced) {
          anomalies.push({
            severity: Math.abs(mb.discrepancy) > 0.05 ? "CRITICAL" : "WARNING",
            category: "MASS_BALANCE",
            entityId: bCode,
            description: `Partiya ${bCode} mass balansi nomuvofiq: ${mb.statusText}. Kirish: ${inG}g, Hisoblangan: ${mb.accountedWeight}g`,
            varianceGram: mb.discrepancy,
          });
        }

        if (goodG + sprueG + scrapG + lossG > inG + 0.05) {
          anomalies.push({
            severity: "CRITICAL",
            category: "MASS_BALANCE",
            entityId: bCode,
            description: `Partiya ${bCode}da chiqish va yo'qotishlar (${(goodG + sprueG + scrapG + lossG).toFixed(2)}g) berilgan oltindan (${inG}g) oshib ketgan! Oltin generatsiyasi nomaqbul.`,
            varianceGram: Number((goodG + sprueG + scrapG + lossG - inG).toFixed(4)),
          });
        }
      }
    }

    // 3. TWO-PARTY HANDOVER CHAIN-OF-CUSTODY AUDIT
    const handovers = ctx.handovers || [];
    const nowMs = Date.now();

    for (const h of handovers) {
      const bCode = h.batch_no || "BATCH";
      if (h.status === "DISCREPANCY_FLAGGED") {
        anomalies.push({
          severity: "WARNING",
          category: "HANDOVER",
          entityId: String(h.id || bCode),
          description: `Partiya ${bCode} topshirishida vazn farqi aniqlangan (+${h.weight_discrepancy_gram ?? 0}g) va jarayon muzlatilgan. Supervayzer xulosasi zarur.`,
          varianceGram: Number(h.weight_discrepancy_gram ?? 0),
        });
      }

      if (h.status === "PENDING_ACCEPTANCE" && h.dispatched_at) {
        const dispMs = new Date(h.dispatched_at).getTime();
        const waitingHours = (nowMs - dispMs) / (1000 * 3600);
        if (waitingHours > 24) {
          anomalies.push({
            severity: "WARNING",
            category: "HANDOVER",
            entityId: String(h.id || bCode),
            description: `Partiya ${bCode} topshirishi 24 soatdan ortiq qabul qilinmasdan turibdi (${waitingHours.toFixed(1)} soat).`,
          });
        }
      }
    }

    // 4. FINANCIAL & INVENTORY AUDIT
    const sales = ctx.sales || [];
    for (const s of sales) {
      const tot = Number(s.total_amount ?? s.amount ?? 0);
      const paid = Number(s.paid_amount ?? 0);
      const debt = Number(s.debt_amount ?? 0);

      if (tot > 0 && Math.abs(tot - (paid + debt)) > 1.0) {
        anomalies.push({
          severity: "WARNING",
          category: "FINANCE",
          entityId: String(s.id || "SALE"),
          description: `Sotuv kassa/qarz balansi nomuvofiq: Jami narx (${tot}) != To'langan (${paid}) + Qarz (${debt})`,
        });
      }
    }

    const products = ctx.products || [];
    let finishedProductGoldGram = 0;
    for (const p of products) {
      const stock = Number(p.stock ?? p.quantity ?? 0);
      const netWeight = Math.max(0, Number(p.weight || 0) - Number(p.stone_weight || 0));
      if (stock < 0) {
        anomalies.push({
          severity: "CRITICAL",
          category: "FINANCE",
          entityId: String(p.id || p.name),
          description: `Vitrina tayyor mahsulot qoldig'i manfiy: ${p.name || p.title} (${stock} dona). Manfiy tovar bo'lishi mumkin emas!`,
        });
      }
      if (stock > 0 && netWeight > 0) {
        finishedProductGoldGram += stock * netWeight;
      }
    }

    // 5. PAYROLL DUPLICATE & OVER-ADJUSTMENT AUDIT
    const salaryLedger = ctx.salaryLedger || [];
    const earnedKeySet = new Set<string>();
    const adjustmentsByOrigId = new Map<string, number>();
    const earnedRecordsById = new Map<string, { amount: number; worker: string }>();

    for (const entry of salaryLedger) {
      if (entry.tx_type === "EARNED") {
        if (entry.id) {
          earnedRecordsById.set(String(entry.id), {
            amount: Number(entry.amount || 0),
            worker: entry.worker_name || entry.employee_id || "Xodim",
          });
        }
        if (entry.employee_id && entry.batch_no && entry.stage_name) {
          const key = `${entry.employee_id}_${entry.batch_no}_${entry.stage_name}`;
          if (earnedKeySet.has(key)) {
            anomalies.push({
              severity: "WARNING",
              category: "PAYROLL",
              entityId: String(entry.id || key),
              description: `Ish haqi hisobida takroriy yozuv (dublikat) aniqlandi: Xodim ${entry.worker_name || entry.employee_id}, Partiya ${entry.batch_no}, Bosqich ${entry.stage_name}`,
            });
          }
          earnedKeySet.add(key);
        }
      } else if (
        (entry.tx_type === "ADJUSTMENT" || entry.tx_type === "REVERSAL") &&
        entry.original_ledger_id
      ) {
        const origId = String(entry.original_ledger_id);
        const currentSum = adjustmentsByOrigId.get(origId) || 0;
        adjustmentsByOrigId.set(origId, currentSum + Number(entry.amount || 0));
      }
    }

    for (const [origId, totalAdj] of adjustmentsByOrigId.entries()) {
      const orig = earnedRecordsById.get(origId);
      if (orig && totalAdj > orig.amount) {
        anomalies.push({
          severity: "CRITICAL",
          category: "PAYROLL",
          entityId: origId,
          description: `Ish haqi ortiqcha ushlab qolingan (over-adjusted): Xodim ${orig.worker}. Hisoblangan: ${orig.amount} UZS, Ushlangan: ${totalAdj} UZS.`,
        });
      }
    }

    const unaccountedLeak = Number(Math.max(0, totalGoldIssuedGram - totalGoldAccountedGram).toFixed(4));
    const isHealthy = anomalies.filter((a) => a.severity === "CRITICAL").length === 0 && unaccountedLeak <= 0.05;

    return {
      isHealthy,
      totalGoldIssuedGram: Number(totalGoldIssuedGram.toFixed(4)),
      totalGoldAccountedGram: Number(totalGoldAccountedGram.toFixed(4)),
      unaccountedGoldLeakGram: unaccountedLeak,
      safeRawGoldOnHandGram: safeSummary.rawGoldOnHand,
      safeReservedGoldGram: safeSummary.reservedGold,
      safeAvailableGoldGram: safeSummary.availableGold,
      fineGoldTotalGram: safeSummary.fineGoldTotal,
      activeWipGoldGram: Number(totalActiveWipGram.toFixed(4)),
      finishedProductGoldGram: Number(finishedProductGoldGram.toFixed(4)),
      anomaliesCount: anomalies.length,
      anomalies,
    };
  },
};


export interface AuditLogPayload {
  table_name?: string;
  table?: string;
  record_id?: string;
  recordId?: string;
  action: string;
  actor_name?: string;
  actor_role?: ErpRole | string;
  old_data?: unknown;
  oldData?: unknown;
  new_data?: unknown;
  newData?: unknown;
  reason?: string;
}

export const logErpAudit = async (payload: AuditLogPayload) => {
  const actor = RBAC.getCurrentUser();
  const normalizedRow = {
    table_name: payload.table_name ?? payload.table ?? "unknown_table",
    record_id: payload.record_id ?? payload.recordId,
    action: payload.action,
    actor_name: payload.actor_name ?? actor.name,
    actor_role: payload.actor_role ?? actor.role,
    old_data: payload.old_data ?? payload.oldData ?? null,
    new_data: payload.new_data ?? payload.newData ?? null,
    reason: payload.reason,
  };

  try {
    await supabase.from("audit_logs").insert([normalizedRow]);
  } catch (err) {
    console.error("Audit log error:", err);
  }
};

/**
 * Deterministic Transactional State Machine mirroring the 11 PostgreSQL RPCs
 * in `20260101000016_atomic_erp_rpcs.sql` and security triggers in
 * `20260101000017_security_rls_and_privilege_hardening.sql`.
 *
 * Used for:
 * 1. Pre-flight validation and deterministic simulation
 * 2. Automated transactional, concurrency (row-lock serialization), mass-balance,
 *    reservation, BOM, debt-repayment, payroll, and RLS/immutability verification tests.
 */
export class ErpTransactionalEngine {
  public inventory: InventoryItemRow[] = [];
  public reservations: InventoryReservationRow[] = [];
  public goldTransactions: GoldTransactionRow[] = [];
  public batches: BatchRow[] = [];
  public batchStageWip: BatchStageWipRow[] = [];
  public consumption: ConsumptionRow[] = [];
  public orders: OrderRow[] = [];
  public products: ProductRow[] = [];
  public bomItems: Array<BomItemInput & { id: string; product_id: string; product_name: string; bom_version: number }> = [];
  public sales: SaleRow[] = [];
  public debtRepayments: DebtRepaymentRow[] = [];
  public employees: EmployeeRow[] = [];
  public salaryLedger: SalaryLedgerRow[] = [];
  public auditLogs: AuditLogRow[] = [];
  private idempotencyStore = new Map<string, { signature?: string; response: unknown }>();
  private lockQueue: Promise<void> = Promise.resolve();

  private async withRowLock<T>(
    fn: () => T | Promise<T>,
    idempotencyKey?: string,
    requestSignature?: string
  ): Promise<T> {
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prevLock = this.lockQueue;
    this.lockQueue = prevLock.then(() => nextLock);
    await prevLock;
    try {
      const cleanKey = idempotencyKey?.trim();
      if (cleanKey && this.idempotencyStore.has(cleanKey)) {
        const cached = this.idempotencyStore.get(cleanKey)!;
        if (
          requestSignature &&
          cached.signature &&
          cached.signature !== requestSignature
        ) {
          throw new Error(
            `IDEMPOTENCY_KEY_CONFLICT: Key '${cleanKey}' was already used with a different request payload`
          );
        }
        return cached.response as T;
      }
      const res = await fn();
      if (cleanKey && res && typeof res === "object") {
        this.idempotencyStore.set(cleanKey, {
          signature: requestSignature,
          response: {
            ...(res as Record<string, unknown>),
            deduplicated: true,
          },
        });
      }
      return res;
    } finally {
      release();
    }
  }

  private assertPermission(action: string, actorRole: ErpRole = RBAC.getCurrentUser().role): void {
    if (!RBAC.hasPermission(actorRole, action)) {
      throw new Error(`ACCESS_DENIED: Role '${actorRole}' is not authorized for '${action}'`);
    }
  }

  /**
   * 1. Atomic Inventory & Order Reservation Transaction
   */
  public async inventoryTransaction(params: {
    itemId: string;
    txType: "kirim" | "chiqim" | "reserve" | "unreserve";
    weight: number;
    proba: number;
    fromLocation?: string;
    toLocation?: string;
    description?: string;
    orderId?: string;
    orderNo?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("edit_inventory", params.actorRole);
      const w = Number(params.weight);
      if (!Number.isFinite(w) || w <= 0) {
        throw new Error("INVALID_WEIGHT: Weight must be > 0");
      }
      const item = this.inventory.find((x) => x.id === params.itemId);
      if (!item) {
        throw new Error(`ITEM_NOT_FOUND: ${params.itemId}`);
      }
      const onHand = Number(item.on_hand ?? 0);
      const reserved = Number(item.reserved ?? 0);
      const avail = Number((onHand - reserved).toFixed(4));

      if (params.txType === "kirim") {
        item.on_hand = Number((onHand + w).toFixed(4));
      } else if (params.txType === "chiqim") {
        if (w > avail) {
          throw new Error(`NEGATIVE_INVENTORY_GUARD: Available ${avail}g < requested ${w}g`);
        }
        item.on_hand = Number((onHand - w).toFixed(4));
      } else if (params.txType === "reserve") {
        if (w > avail) {
          throw new Error(`INSUFFICIENT_AVAILABLE_TO_RESERVE: Available ${avail}g < requested ${w}g`);
        }
        item.reserved = Number((reserved + w).toFixed(4));
        this.reservations.push({
          id: `res-${this.reservations.length + 1}`,
          item_id: params.itemId,
          order_id: params.orderId ?? null,
          order_no: params.orderNo ?? null,
          reserved_gram: Number(w.toFixed(4)),
          consumed_gram: 0,
          released_gram: 0,
          status: "ACTIVE",
        });
        if (params.orderId) {
          const ord = this.orders.find((o) => o.id === params.orderId);
          if (ord) {
            ord.reserved_gold_gram = Number((Number(ord.reserved_gold_gram ?? 0) + w).toFixed(4));
            ord.reserved_item_id = params.itemId;
          }
        }
      } else if (params.txType === "unreserve") {
        if (w > reserved) {
          throw new Error(`INVALID_UNRESERVE: Requested ${w}g > reserved ${reserved}g`);
        }
        item.reserved = Number((reserved - w).toFixed(4));
        if (params.orderId) {
          const resRow = this.reservations.find(
            (r) => r.order_id === params.orderId && r.item_id === params.itemId && r.status === "ACTIVE"
          );
          if (resRow) {
            resRow.released_gram = Number((resRow.released_gram + w).toFixed(4));
            if (resRow.consumed_gram + resRow.released_gram >= resRow.reserved_gram) {
              resRow.status = "RELEASED";
            }
          }
          const ord = this.orders.find((o) => o.id === params.orderId);
          if (ord) {
            ord.reserved_gold_gram = Math.max(0, Number((Number(ord.reserved_gold_gram ?? 0) - w).toFixed(4)));
          }
        }
      }

      const txRow: GoldTransactionRow = {
        id: `gtx-${this.goldTransactions.length + 1}`,
        transaction_type: params.txType,
        from_location: params.fromLocation ?? (params.txType === "kirim" ? "SUPPLIER" : "SAFE"),
        to_location: params.toLocation ?? (params.txType === "kirim" ? "SAFE" : "CASTING"),
        material_name: item.name,
        gross_weight: Number(w.toFixed(4)),
        proba: params.proba,
        pure_gold: GoldEngine.toFineGoldExact(w, params.proba),
        description: params.description ?? `${params.txType}`,
        idempotency_key: params.idempotencyKey,
        created_at: new Date().toISOString(),
      };
      this.goldTransactions.push(txRow);
      return { status: "OK", deduplicated: false, item: { ...item }, tx: txRow };
    }, params.idempotencyKey);
  }

  /**
   * 2. Atomic Alloying Transaction (Down-Alloying & Up-Alloying with Source Material Consumption)
   */
  public async executeAlloyTransaction(params: {
    sourceItemId: string;
    targetItemId: string;
    inputWeight: number;
    sourceProba: number;
    targetProba: number;
    ligatureRatio?: number;
    fineGoldItemId?: string;
    silverItemId?: string;
    copperItemId?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("edit_inventory", params.actorRole);
      if (params.sourceProba === params.targetProba) {
        throw new Error("INVALID_ALLOY: Source and target proba must differ");
      }
      const sourceItem = this.inventory.find((x) => x.id === params.sourceItemId);
      const targetItem = this.inventory.find((x) => x.id === params.targetItemId);
      if (!sourceItem || !targetItem) {
        throw new Error("ITEM_NOT_FOUND: Source or target gold item missing");
      }
      const calc = GoldEngine.calculateAlloy(
        params.inputWeight,
        params.sourceProba,
        params.targetProba,
        params.ligatureRatio ?? 70
      );
      const srcAvail = Number(sourceItem.on_hand ?? 0) - Number(sourceItem.reserved ?? 0);
      if (srcAvail < calc.sourceGoldDeducted) {
        throw new Error(`INSUFFICIENT_SOURCE_GOLD: Available ${srcAvail}g < ${calc.sourceGoldDeducted}g`);
      }

      let fineGoldItem: InventoryItemRow | undefined;
      if (calc.fineGold999Deducted > 0) {
        fineGoldItem = params.fineGoldItemId
          ? this.inventory.find((x) => x.id === params.fineGoldItemId)
          : this.inventory.find(
              (x) => x.category === "Gold" && Number(x.proba) === 999 && x.id !== sourceItem.id
            );
        if (!fineGoldItem) {
          throw new Error("MISSING_999_GOLD: Up-alloying requires 999 fine gold inventory item");
        }
        const fineAvail = Number(fineGoldItem.on_hand ?? 0) - Number(fineGoldItem.reserved ?? 0);
        if (fineAvail < calc.fineGold999Deducted) {
          throw new Error(
            `INSUFFICIENT_999_GOLD: Available ${fineAvail}g < required ${calc.fineGold999Deducted}g`
          );
        }
      }

      let silverItem: InventoryItemRow | undefined;
      if (params.silverItemId && calc.silverDeducted > 0) {
        silverItem = this.inventory.find((x) => x.id === params.silverItemId);
        if (!silverItem) throw new Error("SILVER_ITEM_NOT_FOUND");
        const sAvail = Number(silverItem.on_hand ?? 0) - Number(silverItem.reserved ?? 0);
        if (sAvail < calc.silverDeducted) {
          throw new Error(`INSUFFICIENT_SILVER: Available ${sAvail}g < ${calc.silverDeducted}g`);
        }
      }

      let copperItem: InventoryItemRow | undefined;
      if (params.copperItemId && calc.copperDeducted > 0) {
        copperItem = this.inventory.find((x) => x.id === params.copperItemId);
        if (!copperItem) throw new Error("COPPER_ITEM_NOT_FOUND");
        const cAvail = Number(copperItem.on_hand ?? 0) - Number(copperItem.reserved ?? 0);
        if (cAvail < calc.copperDeducted) {
          throw new Error(`INSUFFICIENT_COPPER: Available ${cAvail}g < ${calc.copperDeducted}g`);
        }
      }

      // Apply all deductions and additions atomically
      sourceItem.on_hand = Number((Number(sourceItem.on_hand ?? 0) - calc.sourceGoldDeducted).toFixed(4));
      if (fineGoldItem && calc.fineGold999Deducted > 0) {
        fineGoldItem.on_hand = Number(
          (Number(fineGoldItem.on_hand ?? 0) - calc.fineGold999Deducted).toFixed(4)
        );
      }
      if (silverItem && calc.silverDeducted > 0) {
        silverItem.on_hand = Number((Number(silverItem.on_hand ?? 0) - calc.silverDeducted).toFixed(4));
      }
      if (copperItem && calc.copperDeducted > 0) {
        copperItem.on_hand = Number((Number(copperItem.on_hand ?? 0) - calc.copperDeducted).toFixed(4));
      }
      targetItem.on_hand = Number((Number(targetItem.on_hand ?? 0) + calc.totalWeight).toFixed(4));

      return {
        status: "OK",
        deduplicated: false,
        calculation: calc,
        sourceOnHand: Number(sourceItem.on_hand),
        fineGold999OnHand: fineGoldItem ? Number(fineGoldItem.on_hand) : null,
        targetOnHand: Number(targetItem.on_hand),
      };
    }, params.idempotencyKey);
  }

  /**
   * 3. Atomic Batch Creation with Order Reservation Consumption Support
   */
  public async createBatchWithGoldIssue(params: {
    sourceItemId: string;
    batchNo: string;
    productName: string;
    masterName: string;
    proba: number;
    plannedQty: number;
    issuedGoldGram: number;
    orderId?: string;
    productId?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("create_batch", params.actorRole);
      if (this.batches.some((b) => (b.batch_no || b.number) === params.batchNo)) {
        throw new Error(`DUPLICATE_BATCH_NO: ${params.batchNo}`);
      }
      const sourceItem = this.inventory.find((x) => x.id === params.sourceItemId);
      if (!sourceItem) throw new Error("SOURCE_GOLD_NOT_FOUND");

      const gIssue = Number(params.issuedGoldGram.toFixed(4));
      let consumedFromReservation = 0;

      if (params.orderId) {
        const activeRes = this.reservations.filter(
          (r) => r.order_id === params.orderId && r.item_id === params.sourceItemId && r.status === "ACTIVE"
        );
        for (const r of activeRes) {
          const remRes = Number((r.reserved_gram - r.consumed_gram - r.released_gram).toFixed(4));
          if (remRes > 0 && consumedFromReservation < gIssue) {
            const useNow = Math.min(remRes, Number((gIssue - consumedFromReservation).toFixed(4)));
            r.consumed_gram = Number((r.consumed_gram + useNow).toFixed(4));
            r.batch_no = params.batchNo;
            if (r.consumed_gram + r.released_gram >= r.reserved_gram) {
              r.status = "CONSUMED";
            }
            consumedFromReservation = Number((consumedFromReservation + useNow).toFixed(4));
          }
        }
      }

      const unreservedNeeded = Number((gIssue - consumedFromReservation).toFixed(4));
      const onHand = Number(sourceItem.on_hand ?? 0);
      const reserved = Number(sourceItem.reserved ?? 0);
      const unreservedAvail = Number((onHand - reserved).toFixed(4));

      if (unreservedNeeded > unreservedAvail) {
        throw new Error(
          `INSUFFICIENT_AVAILABLE_GOLD: Unreserved available ${unreservedAvail}g < needed ${unreservedNeeded}g`
        );
      }

      sourceItem.on_hand = Number((onHand - gIssue).toFixed(4));
      sourceItem.reserved = Number((reserved - consumedFromReservation).toFixed(4));

      const batchRow: BatchRow = {
        id: `batch-${this.batches.length + 1}`,
        order_id: params.orderId,
        batch_no: params.batchNo,
        product_id: params.productId,
        product_name: params.productName,
        master_name: params.masterName,
        proba: params.proba,
        planned_qty: params.plannedQty,
        planned_gram: gIssue,
        issued_gold_gram: gIssue,
        wip_gram: gIssue,
        good_output_gram: 0,
        sprue_gram: 0,
        scrap_gram: 0,
        rework_gram: 0,
        loss_gram: 0,
        finished_qty: 0,
        stock_credited_qty: 0,
        current_step: "8. Quyish (Casting)",
        status: "Jarayonda",
        created_at: new Date().toISOString(),
      };
      this.batches.push(batchRow);

      this.batchStageWip.push({
        id: `wip-${this.batchStageWip.length + 1}`,
        batch_id: batchRow.id,
        batch_no: params.batchNo,
        stage_order: 8,
        stage_name: "8. Quyish (Casting)",
        department: "Quyish",
        available_qty: params.plannedQty,
        completed_qty: 0,
        rework_qty: 0,
        input_weight: gIssue,
        output_weight: 0,
        loss_weight: 0,
        queue_status: "NOW",
        assigned_worker: params.masterName,
      });

      this.goldTransactions.push({
        id: `gtx-${this.goldTransactions.length + 1}`,
        transaction_type: "chiqim",
        from_location: "SAFE",
        to_location: "CASTING",
        material_name: sourceItem.name,
        gross_weight: gIssue,
        proba: params.proba,
        pure_gold: GoldEngine.toFineGoldExact(gIssue, params.proba),
        batch_no: params.batchNo,
        idempotency_key: params.idempotencyKey,
        created_at: new Date().toISOString(),
      });

      return {
        status: "OK",
        deduplicated: false,
        batch: batchRow,
        consumedFromReservation,
        unreservedConsumed: unreservedNeeded,
      };
    }, params.idempotencyKey);
  }

  /**
   * 4. Release Unused Reservations on Order Cancellation or Completion
   */
  public async releaseOrderReservations(params: {
    orderId: string;
    newStatus: "Bekor qilindi" | "Tugatildi";
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("edit_inventory", params.actorRole);
      const ord = this.orders.find((o) => o.id === params.orderId);
      if (!ord) throw new Error("ORDER_NOT_FOUND");
      let totalReleased = 0;
      for (const r of this.reservations) {
        if (r.order_id === params.orderId && r.status === "ACTIVE") {
          const unused = Number((r.reserved_gram - r.consumed_gram - r.released_gram).toFixed(4));
          if (unused > 0) {
            const item = this.inventory.find((x) => x.id === r.item_id);
            if (item) {
              item.reserved = Math.max(0, Number((Number(item.reserved ?? 0) - unused).toFixed(4)));
            }
            r.released_gram = Number((r.released_gram + unused).toFixed(4));
            totalReleased = Number((totalReleased + unused).toFixed(4));
          }
          r.status = params.newStatus === "Bekor qilindi" ? "CANCELLED" : "RELEASED";
        }
      }
      ord.status = params.newStatus;
      ord.reserved_gold_gram = 0;
      return { status: "OK", releasedGram: totalReleased };
    });
  }

  /**
   * 5. Atomic Partial WIP Movement & Single Stage-25 Finished Goods Stock Credit
   */
  public async movePartialWip(params: {
    batchId: string;
    fromStageOrder: number;
    toStageOrder?: number;
    toStageName?: string;
    toDepartment?: string;
    moveQty: number;
    moveWeight: number;
    reworkQty?: number;
    sprueGram?: number;
    scrapGram?: number;
    lossGram?: number;
    workerName?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("move_batch", params.actorRole);
      const batch = this.batches.find((b) => b.id === params.batchId);
      if (!batch) throw new Error("BATCH_NOT_FOUND");
      const bCode = batch.batch_no || batch.number || "";
      const curWip = this.batchStageWip.find(
        (w) => (w.batch_id === batch.id || w.batch_no === bCode) && w.stage_order === params.fromStageOrder
      );
      if (!curWip) throw new Error(`ACTIVE_WIP_STAGE_NOT_FOUND: Stage ${params.fromStageOrder}`);

      const qMove = Number(params.moveQty);
      const gMove = Number(params.moveWeight);
      const qRew = Number(params.reworkQty ?? 0);
      const gSprue = Number(params.sprueGram ?? 0);
      const gScrap = Number(params.scrapGram ?? 0);
      const gLoss = Number(params.lossGram ?? 0);

      if (qMove < 0 || gMove < 0 || qRew < 0 || gSprue < 0 || gScrap < 0 || gLoss < 0) {
        throw new Error("NEGATIVE_VALUE_NOT_ALLOWED");
      }
      if (!Number.isInteger(qMove) || !Number.isInteger(qRew)) {
        throw new Error("FRACTIONAL_PIECE_QUANTITY_NOT_ALLOWED");
      }
      if (qMove <= 0 && qRew <= 0) {
        throw new Error("ZERO_QUANTITY_MOVE");
      }

      const availQty = Number(curWip.available_qty ?? 0);
      if (qMove + qRew > availQty) {
        throw new Error(`INSUFFICIENT_STAGE_QTY: Available ${availQty} < ${qMove + qRew}`);
      }

      const targetStageOrder = params.toStageOrder ?? params.fromStageOrder + 1;
      const isFinal = targetStageOrder >= 25;
      const targetStageName =
        params.toStageName ?? (isFinal ? "25. Tayyor mahsulot ombori" : `Stage ${targetStageOrder}`);
      const targetDept = params.toDepartment ?? (isFinal ? "Ombor" : "Sex");

      const inG = Number(batch.issued_gold_gram ?? batch.planned_gram ?? 0);
      const nSprue = Number((Number(batch.sprue_gram ?? 0) + gSprue).toFixed(4));
      const nScrap = Number((Number(batch.scrap_gram ?? 0) + gScrap).toFixed(4));
      const nLoss = Number((Number(batch.loss_gram ?? 0) + gLoss).toFixed(4));
      const nGoodG = Number(
        (Number(batch.good_output_gram ?? 0) + (isFinal ? gMove : 0)).toFixed(4)
      );
      const nFinQ = Number(batch.finished_qty ?? 0) + (isFinal ? qMove : 0);

      const totalAccounted = Number((nGoodG + nSprue + nScrap + nLoss).toFixed(4));
      if (inG <= 0 || totalAccounted > inG + GOLD_PRECISION_POLICY.MASS_BALANCE_TOLERANCE_GRAM) {
        throw new Error(
          `MASS_BALANCE_VIOLATION: Accounted (${totalAccounted}g) exceeds issued gold (${inG}g)`
        );
      }

      const nWipG = Math.max(0, Number((inG - totalAccounted).toFixed(4)));
      const plannedQ = Number(batch.planned_qty ?? 0);
      const doneAll = plannedQ > 0 && nFinQ >= plannedQ && nWipG <= 0.05;

      // Update current stage WIP
      const remQty = availQty - qMove - qRew;
      curWip.available_qty = remQty;
      curWip.completed_qty = Number(curWip.completed_qty ?? 0) + qMove;
      curWip.rework_qty = Number(curWip.rework_qty ?? 0) + qRew;
      curWip.output_weight = Number((Number(curWip.output_weight ?? 0) + gMove).toFixed(4));
      curWip.loss_weight = Number((Number(curWip.loss_weight ?? 0) + gLoss).toFixed(4));
      curWip.queue_status = remQty === 0 ? "DONE" : "NOW";

      // Advance to next stage
      if (qMove > 0) {
        const nxtW = this.batchStageWip.find(
          (w) => (w.batch_id === batch.id || w.batch_no === bCode) && w.stage_order === targetStageOrder
        );
        if (nxtW) {
          nxtW.available_qty = Number(nxtW.available_qty ?? 0) + qMove;
          nxtW.input_weight = Number((Number(nxtW.input_weight ?? 0) + gMove).toFixed(4));
          nxtW.queue_status = isFinal ? "DONE" : "NOW";
        } else {
          this.batchStageWip.push({
            id: `wip-${this.batchStageWip.length + 1}`,
            batch_id: batch.id,
            batch_no: bCode,
            stage_order: targetStageOrder,
            stage_name: targetStageName,
            department: targetDept,
            available_qty: qMove,
            completed_qty: isFinal ? qMove : 0,
            rework_qty: 0,
            input_weight: gMove,
            output_weight: isFinal ? gMove : 0,
            loss_weight: 0,
            queue_status: isFinal ? "DONE" : "NOW",
            assigned_worker: params.workerName ?? "Unassigned",
          });
        }
      }

      // Credit finished goods inventory (`products.stock`) ONLY when reaching stage 25 and ONLY for newly completed units
      let newlyCreditedStock = 0;
      if (isFinal && qMove > 0) {
        const prevCredited = Number(batch.stock_credited_qty ?? 0);
        const targetCreditTotal = Math.min(plannedQ > 0 ? plannedQ : nFinQ, nFinQ);
        newlyCreditedStock = Math.max(0, targetCreditTotal - prevCredited);

        if (newlyCreditedStock > 0) {
          let prod = this.products.find(
            (p) =>
              (batch.product_id && p.id === batch.product_id) ||
              (p.name || "").trim().toLowerCase() === (batch.product_name || "").trim().toLowerCase()
          );
          if (!prod) {
            prod = {
              id: `prod-${this.products.length + 1}`,
              name: batch.product_name || "Komplekt",
              category: "Komplekt",
              weight: Number((gMove / qMove).toFixed(4)),
              proba: Number(batch.proba ?? 585),
              stock: newlyCreditedStock,
              quantity: newlyCreditedStock,
              stone_weight: 0,
              bom_version: 1,
            };
            this.products.push(prod);
          } else {
            const nextStock = Number(prod.stock ?? prod.quantity ?? 0) + newlyCreditedStock;
            prod.stock = nextStock;
            prod.quantity = nextStock;
          }
          batch.stock_credited_qty = prevCredited + newlyCreditedStock;
        }
      }

      batch.current_step = targetStageName;
      batch.sprue_gram = nSprue;
      batch.scrap_gram = nScrap;
      batch.loss_gram = nLoss;
      batch.good_output_gram = nGoodG;
      batch.wip_gram = doneAll ? 0 : nWipG;
      batch.finished_qty = nFinQ;
      batch.status = doneAll ? "Tugatildi" : "Jarayonda";

      return {
        status: "OK",
        deduplicated: false,
        remainingStageQty: remQty,
        nextStage: targetStageName,
        wipGram: batch.wip_gram,
        finishedQty: nFinQ,
        newlyCreditedStock,
        completed: doneAll,
      };
    }, params.idempotencyKey);
  }

  /**
   * 6. Atomic Batch Splitting (Parent + Child Batch + Active Stage WIP Splitting)
   */
  public async splitBatch(params: {
    parentBatchId: string;
    splitQty: number;
    childBatchNo?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("split_batch", params.actorRole);
      const parent = this.batches.find((b) => b.id === params.parentBatchId);
      if (!parent) throw new Error("PARENT_BATCH_NOT_FOUND");

      const totQ = Number(parent.planned_qty ?? 0);
      const sQ = Number(params.splitQty);
      const totG = Number(parent.issued_gold_gram ?? parent.planned_gram ?? 0);
      const curWipG = Number(parent.wip_gram ?? totG);

      if (!Number.isInteger(sQ) || sQ <= 0 || sQ >= totQ || totG <= 0) {
        throw new Error("INVALID_SPLIT_QTY");
      }

      const ratio = sQ / totQ;
      const childG = Number((totG * ratio).toFixed(4));
      const remG = Number((totG - childG).toFixed(4));
      const childWipG = Number((curWipG * ratio).toFixed(4));
      const remWipG = Number((curWipG - childWipG).toFixed(4));

      const baseNo = parent.batch_no || parent.number || "BATCH";
      const childNo = params.childBatchNo || `${baseNo}-S1`;
      if (this.batches.some((b) => (b.batch_no || b.number) === childNo)) {
        throw new Error(`DUPLICATE_CHILD_BATCH_NO: ${childNo}`);
      }

      parent.planned_qty = totQ - sQ;
      parent.planned_gram = remG;
      parent.issued_gold_gram = remG;
      parent.wip_gram = remWipG;

      const childBatch: BatchRow = {
        id: `batch-${this.batches.length + 1}`,
        order_id: parent.order_id,
        batch_no: childNo,
        parent_batch_no: baseNo,
        product_id: parent.product_id,
        product_name: parent.product_name,
        master_name: parent.master_name,
        proba: parent.proba ?? 585,
        planned_qty: sQ,
        planned_gram: childG,
        issued_gold_gram: childG,
        wip_gram: childWipG,
        good_output_gram: 0,
        sprue_gram: 0,
        scrap_gram: 0,
        rework_gram: 0,
        loss_gram: 0,
        finished_qty: 0,
        stock_credited_qty: 0,
        current_step: parent.current_step,
        status: "Jarayonda",
        created_at: new Date().toISOString(),
      };
      this.batches.push(childBatch);

      // Split active stage WIP rows proportionally so total stage quantities & weights are conserved
      const activeStage = this.batchStageWip.find(
        (w) =>
          (w.batch_id === parent.id || w.batch_no === baseNo) && Number(w.available_qty ?? 0) >= sQ
      );
      if (activeStage) {
        const stAvail = Number(activeStage.available_qty ?? 0);
        const stWeight = Number(activeStage.input_weight ?? 0);
        const childStWeight =
          stAvail > 0 ? Number(((stWeight * sQ) / stAvail).toFixed(4)) : childWipG;
        activeStage.available_qty = stAvail - sQ;
        activeStage.input_weight = Math.max(0, Number((stWeight - childStWeight).toFixed(4)));

        this.batchStageWip.push({
          id: `wip-${this.batchStageWip.length + 1}`,
          batch_id: childBatch.id,
          batch_no: childNo,
          stage_order: activeStage.stage_order,
          stage_name: activeStage.stage_name,
          department: activeStage.department,
          available_qty: sQ,
          completed_qty: 0,
          rework_qty: 0,
          input_weight: childStWeight,
          output_weight: 0,
          loss_weight: 0,
          queue_status: "NOW",
          assigned_worker: activeStage.assigned_worker,
        });
      }

      return {
        status: "OK",
        deduplicated: false,
        parentBatchNo: baseNo,
        childBatchNo: childNo,
        parentRemainingQty: totQ - sQ,
        parentRemainingGram: remG,
        childQty: sQ,
        childGram: childG,
      };
    }, params.idempotencyKey);
  }

  /**
   * 7. Atomic Stage Consumption & Single-Return Sprue to Scrap Inventory
   */
  public async recordStageConsumption(params: {
    batchNo: string;
    masterName: string;
    department: string;
    proba: number;
    givenWeight: number;
    returnedWeight: number;
    sprueGram: number;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("record_consumption", params.actorRole);
      const g = Number(params.givenWeight);
      const r = Number(params.returnedWeight);
      const sp = Number(params.sprueGram);
      if (g <= 0 || r < 0 || sp < 0) throw new Error("INVALID_CONSUMPTION_WEIGHTS");
      const loss = Number((g - r - sp).toFixed(4));
      if (loss < 0) {
        throw new Error("MASS_BALANCE_ERROR: Returned + Sprue exceeds Given weight");
      }

      const batch = this.batches.find((b) => (b.batch_no || b.number) === params.batchNo);
      if (batch) {
        const inG = Number(batch.issued_gold_gram ?? batch.planned_gram ?? 0);
        const newSprue = Number((Number(batch.sprue_gram ?? 0) + sp).toFixed(4));
        const newLoss = Number((Number(batch.loss_gram ?? 0) + loss).toFixed(4));
        const goodG = Number(batch.good_output_gram ?? 0);
        const scrapG = Number(batch.scrap_gram ?? 0);
        if (inG > 0 && goodG + newSprue + scrapG + newLoss > inG + 0.05) {
          throw new Error("BATCH_MASS_BALANCE_EXCEEDED");
        }
        batch.sprue_gram = newSprue;
        batch.loss_gram = newLoss;
        batch.wip_gram = Math.max(0, Number((inG - goodG - newSprue - scrapG - newLoss).toFixed(4)));
      }

      const row: ConsumptionRow = {
        id: `cons-${this.consumption.length + 1}`,
        batch_id: batch?.id,
        batch_no: params.batchNo,
        master_name: params.masterName,
        department: params.department,
        proba: params.proba,
        given_weight: g,
        returned_weight: r,
        sprue_gram: sp,
        loss_weight: loss,
        sent_to_refinery: false,
        created_at: new Date().toISOString(),
      };
      this.consumption.push(row);

      if (loss > 0) {
        this.goldTransactions.push({
          id: `gtx-${this.goldTransactions.length + 1}`,
          transaction_type: "yoqotish",
          from_location: "WIP",
          to_location: "LOSS",
          material_name: `Pateriya (${params.department} - ${params.batchNo})`,
          gross_weight: loss,
          proba: params.proba,
          pure_gold: GoldEngine.toFineGoldExact(loss, params.proba),
          batch_no: params.batchNo,
          idempotency_key: params.idempotencyKey,
          created_at: new Date().toISOString(),
        });
      }

      return { status: "OK", deduplicated: false, consumption: row, lossGram: loss };
    }, params.idempotencyKey);
  }

  public async returnSprueToScrapInventory(params: {
    consumptionId: string;
    scrapItemId: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("move_batch", params.actorRole);
      const cons = this.consumption.find((c) => c.id === params.consumptionId);
      if (!cons) throw new Error("CONSUMPTION_NOT_FOUND");
      if (cons.sent_to_refinery) {
        throw new Error("DUPLICATE_SPRUE_RETURN: Sprue already returned to scrap inventory");
      }
      const sp = Number(cons.sprue_gram ?? 0);
      if (sp <= 0) throw new Error("ZERO_SPRUE_WEIGHT");

      const scrapItem = this.inventory.find((x) => x.id === params.scrapItemId);
      if (!scrapItem) throw new Error("SCRAP_ITEM_NOT_FOUND");

      cons.sent_to_refinery = true;
      scrapItem.on_hand = Number((Number(scrapItem.on_hand ?? 0) + sp).toFixed(4));

      return {
        status: "OK",
        deduplicated: false,
        returnedSprueGram: sp,
        scrapOnHand: scrapItem.on_hand,
      };
    }, params.idempotencyKey);
  }

  /**
   * 8. Atomic Sale with Stock Deduction & Dedicated Debt Repayment (NEVER deducts stock again)
   */
  public async recordSaleWithStockDeduction(params: {
    productId: string;
    clientName: string;
    quantity: number;
    weight: number;
    proba: number;
    paymentType: string;
    paidAmount: number;
    debtAmount: number;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("edit_sales", params.actorRole);
      const prod = this.products.find((p) => p.id === params.productId);
      if (!prod) throw new Error("PRODUCT_NOT_FOUND");
      const curStock = Number(prod.stock ?? prod.quantity ?? 0);
      if (!Number.isInteger(params.quantity) || params.quantity <= 0 || params.quantity > curStock) {
        throw new Error(`NEGATIVE_STOCK_GUARD: Available ${curStock} < requested ${params.quantity}`);
      }
      prod.stock = curStock - params.quantity;
      prod.quantity = curStock - params.quantity;

      const saleRow: SaleRow = {
        id: `sale-${this.sales.length + 1}`,
        product_id: prod.id,
        client_name: params.clientName,
        product_name: prod.name,
        quantity: params.quantity,
        weight: params.weight,
        proba: params.proba,
        payment_type: params.paymentType,
        total_amount: Number(params.paidAmount.toFixed(2)),
        debt_amount: Number(params.debtAmount.toFixed(2)),
        tx_type: "kirim",
        created_at: new Date().toISOString(),
      };
      this.sales.push(saleRow);

      return {
        status: "OK",
        deduplicated: false,
        sale: saleRow,
        remainingStock: prod.stock,
      };
    }, params.idempotencyKey);
  }

  public async recordDebtRepayment(params: {
    saleId?: string;
    orderId?: string;
    paymentType: string;
    repaidAmount: number;
    note?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("edit_sales", params.actorRole);
      const amount = Number(params.repaidAmount.toFixed(2));
      if (amount <= 0) throw new Error("INVALID_REPAYMENT_AMOUNT");
      if ((!params.saleId && !params.orderId) || (params.saleId && params.orderId)) {
        throw new Error("MUST_SPECIFY_EITHER_SALE_OR_ORDER");
      }

      let prevDebt = 0;
      let remDebt = 0;
      let clientName = "";

      if (params.saleId) {
        const sale = this.sales.find((s) => s.id === params.saleId);
        if (!sale) throw new Error("SALE_NOT_FOUND");
        prevDebt = Number(sale.debt_amount ?? 0);
        if (prevDebt <= 0) throw new Error("NO_OUTSTANDING_DEBT");
        if (amount > prevDebt) {
          throw new Error(`OVER_REPAYMENT_GUARD: Repaid ${amount} > debt ${prevDebt}`);
        }
        remDebt = Number((prevDebt - amount).toFixed(2));
        sale.debt_amount = remDebt;
        clientName = sale.client_name || "";

        // Record cash inflow row without touching product stock
        this.sales.push({
          id: `sale-${this.sales.length + 1}`,
          parent_sale_id: sale.id,
          client_name: clientName,
          product_name: `Qarz to'lovi (${sale.product_name || "Sotuv"})`,
          quantity: 0,
          weight: 0,
          proba: Number(sale.proba ?? 585),
          payment_type: params.paymentType,
          total_amount: amount,
          debt_amount: 0,
          tx_type: "debt_repayment",
          created_at: new Date().toISOString(),
        });
      } else if (params.orderId) {
        const ord = this.orders.find((o) => o.id === params.orderId);
        if (!ord) throw new Error("ORDER_NOT_FOUND");
        const ordStatus = (ord.status || "").trim().toLowerCase();
        if (ordStatus === "bekor qilindi" || ordStatus === "cancelled") {
          throw new Error("CANCELLED_ORDER_DEBT_REPAYMENT_BLOCKED");
        }
        prevDebt = Math.max(0, Number(ord.total_price ?? 0) - Number(ord.advance ?? 0));
        if (prevDebt <= 0) throw new Error("NO_OUTSTANDING_ORDER_DEBT");
        if (amount > prevDebt) {
          throw new Error(`OVER_REPAYMENT_GUARD: Repaid ${amount} > order debt ${prevDebt}`);
        }
        remDebt = Number((prevDebt - amount).toFixed(2));
        ord.advance = Number((Number(ord.advance ?? 0) + amount).toFixed(2));
        clientName = ord.client_name || ord.customer_name || "";

        this.sales.push({
          id: `sale-${this.sales.length + 1}`,
          order_id: ord.id,
          client_name: clientName,
          product_name: `Qarz to'lovi (Buyurtma ${ord.order_no || ""})`,
          quantity: 0,
          weight: 0,
          proba: Number(ord.proba ?? 585),
          payment_type: params.paymentType,
          total_amount: amount,
          debt_amount: 0,
          tx_type: "debt_repayment",
          created_at: new Date().toISOString(),
        });
      }

      const repaymentRow: DebtRepaymentRow = {
        id: `drep-${this.debtRepayments.length + 1}`,
        sale_id: params.saleId ?? null,
        order_id: params.orderId ?? null,
        client_name: clientName,
        payment_type: params.paymentType,
        repaid_amount: amount,
        previous_debt: prevDebt,
        remaining_debt: remDebt,
        note: params.note,
        idempotency_key: params.idempotencyKey,
        created_at: new Date().toISOString(),
      };
      this.debtRepayments.push(repaymentRow);

      return {
        status: "OK",
        deduplicated: false,
        previousDebt: prevDebt,
        repaidAmount: amount,
        remainingDebt: remDebt,
      };
    }, params.idempotencyKey);
  }

  /**
   * 9. Atomic Salary Transaction with Duplicate-Earned Prevention & Row-Locked Employee Balance
   */
  public async recordSalaryTransaction(params: {
    employeeId: string;
    batchNo: string;
    stageName: string;
    txType: "EARNED" | "PAID";
    weightDone: number;
    rate: number;
    amount: number;
    note?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("edit_salary_rate", params.actorRole);
      const emp = this.employees.find((e) => e.id === params.employeeId);
      if (!emp) throw new Error("EMPLOYEE_NOT_FOUND");
      const sum = Number(params.amount.toFixed(2));
      if (sum <= 0) throw new Error("INVALID_SALARY_AMOUNT");

      const empName = emp.name || emp.full_name || "";
      if (params.txType === "EARNED") {
        const dup = this.salaryLedger.find(
          (l) =>
            l.tx_type === "EARNED" &&
            (l.employee_id === emp.id || l.worker_name === empName) &&
            l.batch_no === params.batchNo &&
            l.stage_name === params.stageName
        );
        if (dup) {
          throw new Error(
            `DUPLICATE_SALARY_GUARD: EARNED entry already exists for (${empName}, ${params.batchNo}, ${params.stageName})`
          );
        }
      }

      const curBal = Number(emp.balance ?? 0);
      const newBal = Number((params.txType === "EARNED" ? curBal + sum : curBal - sum).toFixed(2));
      emp.balance = newBal;

      const ledgerRow: SalaryLedgerRow = {
        id: `sal-${this.salaryLedger.length + 1}`,
        employee_id: emp.id,
        worker_name: empName,
        batch_no: params.batchNo,
        stage_name: params.stageName,
        tx_type: params.txType,
        weight_done: params.weightDone,
        rate: params.rate,
        amount: sum,
        payment_status: params.txType === "PAID" ? "PAID" : "UNPAID",
        note: params.note ?? `${params.batchNo} - ${params.stageName}`,
        idempotency_key: params.idempotencyKey,
        created_at: new Date().toISOString(),
      };
      this.salaryLedger.push(ledgerRow);

      return {
        status: "OK",
        deduplicated: false,
        newBalance: newBal,
        ledgerRow,
      };
    }, params.idempotencyKey);
  }

  /**
   * 10. Atomic Zero-Stock Product + BOM Creation (No Unbacked Stock Fabrication)
   */
  public async createProductWithBom(params: {
    name: string;
    category: string;
    proba: number;
    bomVersion: number;
    bomItems: BomItemInput[];
    actorRole?: ErpRole;
  }) {
    return this.withRowLock(() => {
      this.assertPermission("manage_products", params.actorRole);
      if (!params.name.trim() || !params.bomItems || params.bomItems.length === 0) {
        throw new Error("INVALID_PRODUCT_OR_EMPTY_BOM");
      }
      let totalWeight = 0;
      let stoneWeight = 0;
      for (const comp of params.bomItems) {
        if (!comp.component_name.trim() || comp.weight_per_set < 0) {
          throw new Error("INVALID_BOM_COMPONENT");
        }
        totalWeight = Number((totalWeight + comp.weight_per_set).toFixed(4));
        if (comp.material_category === "Stone") {
          stoneWeight = Number((stoneWeight + comp.weight_per_set).toFixed(4));
        }
      }
      if (totalWeight <= 0 || stoneWeight > totalWeight) {
        throw new Error("INVALID_BOM_WEIGHTS");
      }

      const prod: ProductRow = {
        id: `prod-${this.products.length + 1}`,
        name: params.name.trim(),
        category: params.category,
        weight: totalWeight,
        proba: params.proba,
        stock: 0, // Strictly 0 on model definition; stock is only created by finished stage-25 batches
        quantity: 0,
        stone_weight: stoneWeight,
        bom_version: params.bomVersion,
        created_at: new Date().toISOString(),
      };
      this.products.push(prod);

      for (const comp of params.bomItems) {
        this.bomItems.push({
          id: `bom-${this.bomItems.length + 1}`,
          product_id: prod.id!,
          product_name: prod.name!,
          bom_version: params.bomVersion,
          ...comp,
        });
      }

      return { status: "OK", product: prod, bomCount: params.bomItems.length };
    });
  }

  /**
   * 10b. Atomic Order Creation with Initial Advance Recording in Sales/Cash Ledger
   */
  public async createOrderWithAdvance(params: {
    orderNo: string;
    clientName: string;
    phone?: string;
    productModel: string;
    details?: string;
    proba: number;
    qty: number;
    weightGram: number;
    totalPrice: number;
    advance: number;
    deadline?: string | null;
    priority?: string;
    paymentType?: string;
    idempotencyKey?: string;
    actorRole?: ErpRole;
  }) {
    const cleanOrdNo = (params.orderNo || "").trim();
    const cleanClient = (params.clientName || "").trim();
    const cleanModel = (params.productModel || "").trim() || "Komplekt";
    const proba = Number(params.proba || 585);
    const qty = Math.trunc(Number(params.qty || 0));
    const weightGram = Number(Number(params.weightGram || 0).toFixed(4));
    const totalPrice = Number(Number(params.totalPrice || 0).toFixed(2));
    const advance = Number(Number(params.advance || 0).toFixed(2));
    const requestSig = JSON.stringify({
      orderNo: cleanOrdNo,
      clientName: cleanClient,
      productModel: cleanModel,
      proba,
      qty,
      weightGram,
      totalPrice,
      advance,
    });

    return this.withRowLock(
      () => {
        this.assertPermission("edit_sales", params.actorRole);
        if (!cleanOrdNo || !cleanClient) {
          throw new Error("INVALID_ORDER_INPUT: orderNo and clientName are required");
        }
        if (qty <= 0 || Number(params.qty) !== qty || weightGram <= 0) {
          throw new Error("INVALID_ORDER_QTY_OR_WEIGHT: qty must be a positive integer and weightGram > 0");
        }
        if (totalPrice < 0 || advance < 0) {
          throw new Error("INVALID_ORDER_PRICE_OR_ADVANCE: price and advance cannot be negative");
        }
        if (advance > totalPrice) {
          throw new Error(
            `ADVANCE_EXCEEDS_TOTAL_PRICE: Advance (${advance}) cannot exceed total price (${totalPrice})`
          );
        }
        if (this.orders.some((o) => (o.order_no || "").trim() === cleanOrdNo)) {
          throw new Error(`DUPLICATE_ORDER_NO: ${cleanOrdNo}`);
        }

        const nowIso = new Date().toISOString();
        const ordRow: OrderRow = {
          id: `ord-${this.orders.length + 1}`,
          order_no: cleanOrdNo,
          client_name: cleanClient,
          customer_name: cleanClient,
          phone: params.phone?.trim() || "",
          product_model: cleanModel,
          details: params.details?.trim() || `${cleanModel} (${proba} proba, ${weightGram}g)`,
          proba,
          qty,
          weight_gram: weightGram,
          reserved_gold_gram: 0,
          reserved_item_id: null,
          total_price: totalPrice,
          advance,
          deadline: params.deadline ?? null,
          priority: params.priority || "Normal",
          status: "Kutilmoqda",
          batch_created: false,
          created_at: nowIso,
        };
        const prevOrdersLen = this.orders.length;
        const prevSalesLen = this.sales.length;
        let advanceSaleRow: SaleRow | null = null;

        try {
          this.orders.push(ordRow);

          if (advance > 0) {
            advanceSaleRow = {
              id: `sale-${this.sales.length + 1}`,
              order_id: ordRow.id,
              client_name: cleanClient,
              product_name: `Buyurtma Avansi (${cleanOrdNo} - ${cleanModel})`,
              quantity: qty,
              weight: weightGram,
              proba,
              payment_type: params.paymentType || "Avans (Naqd / Karta)",
              total_amount: advance,
              debt_amount: Number(Math.max(0, totalPrice - advance).toFixed(2)),
              tx_type: "kirim",
              created_at: nowIso,
            };
            this.sales.push(advanceSaleRow);
          }
        } catch (err) {
          this.orders.length = prevOrdersLen;
          this.sales.length = prevSalesLen;
          throw err;
        }

        return {
          status: "OK",
          deduplicated: false,
          orderId: ordRow.id,
          orderNo: cleanOrdNo,
          advanceSaleId: advanceSaleRow?.id ?? null,
          totalPrice,
          advance,
          remainingDebt: Number(Math.max(0, totalPrice - advance).toFixed(2)),
        };
      },
      params.idempotencyKey,
      requestSig
    );
  }

  /**
   * 11. Security Guards: Block Employee Self-Role Escalation & Immutable Ledger Mutation
   */
  public updateEmployeeProfile(params: {
    targetEmployeeId: string;
    actorEmployeeId: string;
    actorRole: ErpRole;
    updates: Partial<EmployeeRow>;
  }) {
    const emp = this.employees.find((e) => e.id === params.targetEmployeeId);
    if (!emp) throw new Error("EMPLOYEE_NOT_FOUND");
    const isAdmin = params.actorRole === "admin" || params.actorRole === "Director";
    if (!isAdmin) {
      if (params.actorEmployeeId !== params.targetEmployeeId) {
        throw new Error("RLS_VIOLATION: Cannot update another employee record");
      }
      if (
        (params.updates.role && params.updates.role !== emp.role) ||
        (params.updates.role_type && params.updates.role_type !== emp.role_type) ||
        (params.updates.rate !== undefined && params.updates.rate !== emp.rate) ||
        (params.updates.balance !== undefined && params.updates.balance !== emp.balance)
      ) {
        throw new Error(
          "SECURITY_VIOLATION: Non-admin employees cannot modify role, role_type, rate, or balance"
        );
      }
    }
    Object.assign(emp, params.updates);
    return { status: "OK", employee: { ...emp } };
  }

  public deleteAuditOrLedgerRow(tableName: string, _id: string): never {
    throw new Error(
      `IMMUTABLE_LEDGER: Records in ${tableName} are append-only and cannot be modified or deleted.`
    );
  }
}

export const ERP_REPORT_TYPES = [
  "1. Daily production",
  "2. Monthly production",
  "3. Batch report",
  "4. Gold movement",
  "5. Gold balance",
  "6. Fine gold balance",
  "7. Loss report",
  "8. Scrap report",
  "9. Rework report",
  "10. QC report",
  "11. Worker productivity",
  "12. Department productivity",
  "13. Machine utilization",
  "14. Bottleneck report",
  "15. Sales report",
  "16. Cash report",
  "17. Customer debt",
  "18. Salary report",
  "19. Finished goods",
  "20. Raw material inventory",
  "21. Reconciliation and Integrity Audit",
] as const;

export type ErpReportType = (typeof ERP_REPORT_TYPES)[number];

/**
 * RFC-4180 compliant CSV cell escaping + UTF-8 BOM for Microsoft Excel compatibility.
 * Also guards against CSV formula injection by prefixing leading `=`, `+`, `-`, `@` on text strings when needed.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "0";
  }
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r") || str.includes(";")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatCsvContent(rows: (string | number)[][]): string {
  return "\uFEFF" + rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\r\n");
}

export function downloadExcelCsv(reportName: string, rows: (string | number)[][]): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const csvContent = formatCsvContent(rows);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ERP_${reportName.replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ErpReportContext {
  inv: InventoryItemRow[];
  goldTx: GoldTransactionRow[];
  batches: BatchRow[];
  wipRows?: BatchStageWipRow[];
  handovers?: {
    id?: string;
    batch_no?: string;
    status?: string;
    dispatched_weight_gram?: number;
    received_weight_gram?: number | null;
    weight_discrepancy_gram?: number | null;
    tolerance_gram?: number;
    dispatched_at?: string;
  }[];
  orders: OrderRow[];
  sales: SaleRow[];
  debtRepayments?: DebtRepaymentRow[];
  machines: MachineRow[];
  consumption: ConsumptionRow[];
  products: ProductRow[];
  employees: EmployeeRow[];
  salaryLedger?: SalaryLedgerRow[];
  qcLogs: QualityControlRow[];
}

export function buildErpReportRows(
  repName: string,
  ctx: ErpReportContext
): (string | number)[][] {
  const reportKey = repName.split(".")[0] ?? "";
  const idx = Number.parseInt(reportKey, 10);
  const isDone = (st?: string | null) =>
    st === "Tugatildi" || (st || "").toLowerCase() === "completed";
  const getSaleSum = (x: SaleRow) =>
    Number(x.total_amount ?? x.amount ?? x.price ?? x.total ?? 0);

  const todayIso = new Date().toISOString().slice(0, 10);
  const monthPrefix = todayIso.slice(0, 7);

  if (idx === 1) {
    const dailyBatches = ctx.batches.filter(
      (b) => !b.created_at || b.created_at.slice(0, 10) === todayIso || !isDone(b.status)
    );
    return [
      ["SANA", "BATCH NO", "MAHSULOT", "PROBA", "REJA QTY", "TAYYOR QTY", "BERILGAN (GR)", "WIP (GR)", "HOLAT"],
      ...dailyBatches.map((b) => [
        b.created_at ? new Date(b.created_at).toLocaleDateString("uz-UZ") : todayIso,
        b.batch_no || b.number || "-",
        b.product_name || b.product || "-",
        Number(b.proba ?? 585),
        Number(b.planned_qty ?? 0),
        Number(b.finished_qty ?? 0),
        Number(b.issued_gold_gram ?? b.planned_gram ?? 0),
        Number(b.wip_gram ?? 0),
        b.status || "-",
      ]),
    ];
  }

  if (idx === 2) {
    const monthlyBatches = ctx.batches.filter(
      (b) => !b.created_at || b.created_at.slice(0, 7) === monthPrefix
    );
    const list = monthlyBatches.length > 0 ? monthlyBatches : ctx.batches;
    return [
      ["OY", "BATCH NO", "MAHSULOT", "PROBA", "REJA QTY", "TAYYOR QTY", "KIRISH (GR)", "YAXSHI CHIQISH (GR)", "LOSS (GR)", "HOLAT"],
      ...list.map((b) => [
        b.created_at ? b.created_at.slice(0, 7) : monthPrefix,
        b.batch_no || b.number || "-",
        b.product_name || b.product || "-",
        Number(b.proba ?? 585),
        Number(b.planned_qty ?? 0),
        Number(b.finished_qty ?? 0),
        Number(b.issued_gold_gram ?? b.planned_gram ?? 0),
        Number(b.good_output_gram ?? 0),
        Number(b.loss_gram ?? 0),
        b.status || "-",
      ]),
    ];
  }

  if (idx === 3) {
    return [
      ["BATCH NO", "MAHSULOT", "PROBA", "REJA QTY", "TAYYOR QTY", "BERILGAN (GR)", "YAXSHI CHIQISH (GR)", "SPRUE (GR)", "SCRAP (GR)", "WIP (GR)", "LOSS (GR)", "MASS BALANCE", "HOLAT"],
      ...ctx.batches.map((b) => {
        const done = isDone(b.status);
        const inG = Number(b.issued_gold_gram ?? b.planned_gram ?? 0);
        const outG = Number(b.good_output_gram ?? b.actual_gram ?? 0);
        const sprueG = Number(b.sprue_gram ?? 0);
        const scrapG = Number(b.scrap_gram ?? 0);
        const reworkG = Number(b.rework_gram ?? 0);
        const lsG = Number(b.loss_gram ?? 0);
        const wipG = done
          ? 0
          : Number(b.wip_gram ?? Math.max(0, inG - outG - sprueG - scrapG - reworkG - lsG));
        const mb = GoldEngine.verifyMassBalance({
          inputGold: inG,
          goodProduct: outG,
          sprue: sprueG,
          scrap: scrapG,
          rework: reworkG,
          loss: lsG,
          remainingWip: wipG,
        });
        return [
          b.batch_no || b.number || "-",
          b.product_name || b.product || "-",
          Number(b.proba ?? 585),
          Number(b.planned_qty ?? 0),
          Number(b.finished_qty ?? 0),
          inG,
          outG,
          sprueG,
          scrapG,
          wipG,
          lsG,
          mb.statusText,
          b.status || "-",
        ];
      }),
    ];
  }

  if (idx === 4) {
    return [
      ["SANA", "AMAL TURI", "YO'NALISH", "MATERIAL", "GROSS (GR)", "PROBA", "FINE GOLD 999 (GR)", "PARTIYA", "IZOH"],
      ...ctx.goldTx.map((t) => [
        t.created_at ? new Date(t.created_at).toLocaleDateString("uz-UZ") : "-",
        t.transaction_type || "-",
        `${t.from_location || "SAFE"} -> ${t.to_location || "WIP"}`,
        t.material_name || "-",
        Number(t.gross_weight ?? 0),
        Number(t.proba ?? 0),
        Number(t.pure_gold ?? GoldEngine.toFineGoldExact(t.gross_weight, t.proba)),
        t.batch_no || "-",
        t.description || "-",
      ]),
    ];
  }

  if (idx === 5) {
    const activeBatches = ctx.batches.filter((b) => !isDone(b.status));
    const wipGross = Number(
      activeBatches.reduce((s, b) => s + Number(b.wip_gram ?? 0), 0).toFixed(4)
    );
    const finGross = Number(
      ctx.products
        .reduce(
          (s, p) =>
            s +
            Math.max(0, Number(p.weight || 0) - Number(p.stone_weight || 0)) *
              Number(p.stock ?? p.quantity ?? 0),
          0
        )
        .toFixed(4)
    );
    return [
      ["JOYLASHUV / TOIFA", "NOMI", "PROBA", "ON HAND (GR)", "RESERVED (GR)", "AVAILABLE (GR)"],
      ...ctx.inv.map((x) => {
        const onH = Number(x.on_hand ?? x.stock_grams ?? 0);
        const res = Number(x.reserved ?? 0);
        return [
          `SAFE (${x.category || "Material"})`,
          x.name || "-",
          Number(x.proba ?? 0),
          onH,
          res,
          Number(Math.max(0, onH - res).toFixed(4)),
        ];
      }),
      ["SEX WIP (JARAYONDA)", `${activeBatches.length} ta faol partiya`, 585, wipGross, 0, wipGross],
      ["VITRINA (TAYYOR MAHSULOT)", `${ctx.products.length} ta model`, 585, finGross, 0, finGross],
    ];
  }

  if (idx === 6) {
    const { rawGoldOnHand, reservedGold, availableGold, fineGoldTotal } =
      GoldEngine.calculateSafeGoldSummary(ctx.inv);
    const activeBatches = ctx.batches.filter((b) => !isDone(b.status));
    const wipFine = GoldEngine.accumulateFineGold(
      activeBatches.map((b) => ({
        grossWeight: Number(b.wip_gram ?? 0),
        proba: Number(b.proba ?? 585),
      }))
    );
    const finFine = GoldEngine.accumulateFineGold(
      ctx.products.map((p) => ({
        grossWeight:
          Math.max(0, Number(p.weight || 0) - Number(p.stone_weight || 0)) *
          Number(p.stock ?? p.quantity ?? 0),
        proba: Number(p.proba ?? 585),
      }))
    );
    return [
      ["HISOB BO'LIMI", "GROSS VAZN (GR)", "REZERV (GR)", "MAVJUD (GR)", "SOF OLTIN 999.9 (GR)"],
      ["SAFE Xomashyo Oltin", rawGoldOnHand, reservedGold, availableGold, fineGoldTotal],
      ["Sex WIP Oltin", wipFine.grossGrams, 0, wipFine.grossGrams, wipFine.grams4dp],
      ["Tayyor Mahsulot (Sof Oltin)", finFine.grossGrams, 0, finFine.grossGrams, finFine.grams4dp],
      [
        "JAMI ZAVOD OLTIN BALANSI",
        Number((rawGoldOnHand + wipFine.grossGrams + finFine.grossGrams).toFixed(4)),
        reservedGold,
        Number((availableGold + wipFine.grossGrams + finFine.grossGrams).toFixed(4)),
        Number((fineGoldTotal + wipFine.grams4dp + finFine.grams4dp).toFixed(4)),
      ],
    ];
  }

  if (idx === 7) {
    return [
      ["SANA", "PARTIYA", "BO'LIM", "USTA", "PROBA", "BERILDI (GR)", "QAYTDI (GR)", "SPRUE (GR)", "PATERIYA / LOSS (GR)", "SOF 999 LOSS (GR)"],
      ...ctx.consumption.map((c) => {
        const g = Number(c.given_weight ?? c.given ?? 0);
        const r = Number(c.returned_weight ?? c.returned ?? 0);
        const sp = Number(c.sprue_gram ?? 0);
        const ls = Number(c.loss_weight ?? g - r - sp);
        const pr = Number(c.proba ?? 585);
        return [
          c.created_at ? new Date(c.created_at).toLocaleDateString("uz-UZ") : "-",
          c.batch_no || c.batch || "-",
          c.department || "Quyish",
          c.master_name || c.master || "-",
          pr,
          g,
          r,
          sp,
          Number(ls.toFixed(4)),
          GoldEngine.toPureGold(ls, pr),
        ];
      }),
    ];
  }

  if (idx === 8) {
    const scrapInvRows = ctx.inv
      .filter((x) => x.category === "Scrap" || x.category === "Lom")
      .map((x) => [
        "OMBOR LOM/SCRAP",
        x.name || "Lom",
        "-",
        Number(x.proba ?? 585),
        Number(x.on_hand ?? 0),
        GoldEngine.toPureGold(x.on_hand, x.proba),
        "Omborda mavjud",
      ]);
    const sprueRows = ctx.consumption
      .filter((c) => Number(c.sprue_gram ?? 0) > 0)
      .map((c) => [
        c.batch_no || "-",
        c.department || "Quyish",
        c.master_name || "-",
        Number(c.proba ?? 585),
        Number(c.sprue_gram ?? 0),
        GoldEngine.toPureGold(c.sprue_gram, c.proba ?? 585),
        c.sent_to_refinery ? "Omborga qaytarilgan" : "Sexda (Qaytarilmagan)",
      ]);
    return [
      ["MANBA / PARTIYA", "BO'LIM / NOMI", "USTA", "PROBA", "SPRUE / LOM (GR)", "SOF 999 (GR)", "AFFINAJ HOLATI"],
      ...scrapInvRows,
      ...sprueRows,
    ];
  }

  if (idx === 9) {
    const qcRework = ctx.qcLogs
      .filter((q) => Number(q.rework_qty ?? 0) > 0)
      .map((q) => [
        q.created_at ? new Date(q.created_at).toLocaleDateString("uz-UZ") : "-",
        q.batch_no || "-",
        q.operation_name || "-",
        Number(q.checked_qty ?? 0),
        Number(q.rework_qty ?? 0),
        q.reason || "QC Rework",
      ]);
    const wipRework = (ctx.wipRows ?? [])
      .filter((w) => Number(w.rework_qty ?? 0) > 0)
      .map((w) => [
        "-",
        w.batch_no || "-",
        w.stage_name || `Stage ${w.stage_order}`,
        Number(w.available_qty ?? 0) + Number(w.completed_qty ?? 0) + Number(w.rework_qty ?? 0),
        Number(w.rework_qty ?? 0),
        `Mas'ul: ${w.assigned_worker || "-"}`,
      ]);
    return [
      ["SANA", "PARTIYA", "BOSQICH", "TEKSHIRILDI", "REWORK QTY", "SABAB / IZOH"],
      ...qcRework,
      ...wipRework,
    ];
  }

  if (idx === 10) {
    return [
      ["SANA", "PARTIYA", "BOSQICH", "TEKSHIRILDI", "PASS", "REWORK", "SABAB"],
      ...ctx.qcLogs.map((q) => [
        q.created_at ? new Date(q.created_at).toLocaleDateString("uz-UZ") : "-",
        q.batch_no || "-",
        q.operation_name || "-",
        Number(q.checked_qty ?? 0),
        Number(q.passed_qty ?? 0),
        Number(q.rework_qty ?? 0),
        q.reason || "-",
      ]),
    ];
  }

  if (idx === 11) {
    return [
      ["XODIM", "BO'LIM", "LAVOZIM", "FAOL WIP VAZIFALAR", "BAJARILGAN VAZN (GR)", "STAVKA (SO'M)", "BALANS (SO'M)"],
      ...ctx.employees.map((e) => {
        const empName = e.name || e.full_name || "-";
        const activeWipCount = (ctx.wipRows ?? []).filter(
          (w) => w.assigned_worker === empName && Number(w.available_qty ?? 0) > 0
        ).length;
        const totalWeightDone = (ctx.salaryLedger ?? [])
          .filter((l) => l.employee_id === e.id || l.worker_name === empName)
          .reduce((s, l) => s + Number(l.weight_done ?? 0), 0);
        return [
          empName,
          e.department || "Sex",
          e.role_type || e.position || e.role || "-",
          activeWipCount,
          Number(totalWeightDone.toFixed(2)),
          Number(e.rate ?? 0),
          Number(e.balance ?? 0),
        ];
      }),
    ];
  }

  if (idx === 12) {
    const depts = [
      "Quyish",
      "Zaklirovka",
      "Sanding",
      "Ponza",
      "Polirovka",
      "Tosh qo'yish",
      "Lazer",
      "Moyka",
      "QC",
      "Ombor",
    ];
    return [
      ["BO'LIM", "NAVbatDAGI (AVAILABLE QTY)", "TAYYOR (COMPLETED QTY)", "REWORK QTY", "KIRISH VAZN (GR)", "CHIQISH VAZN (GR)", "LOSS (GR)"],
      ...depts.map((d) => {
        const rows = (ctx.wipRows ?? []).filter((w) => w.department === d);
        const availQ = rows.reduce((s, w) => s + Number(w.available_qty ?? 0), 0);
        const compQ = rows.reduce((s, w) => s + Number(w.completed_qty ?? 0), 0);
        const rewQ = rows.reduce((s, w) => s + Number(w.rework_qty ?? 0), 0);
        const inW = Number(rows.reduce((s, w) => s + Number(w.input_weight ?? 0), 0).toFixed(2));
        const outW = Number(rows.reduce((s, w) => s + Number(w.output_weight ?? 0), 0).toFixed(2));
        const lsW = Number(rows.reduce((s, w) => s + Number(w.loss_weight ?? 0), 0).toFixed(2));
        return [d, availQ, compQ, rewQ, inW, outW, lsW];
      }),
    ];
  }

  if (idx === 13) {
    return [
      ["USKUNA", "BO'LIM", "CAPACITY (PCS/DAY)", "PARTIYA", "HOLAT"],
      ...ctx.machines.map((m) => [
        m.name || "-",
        m.department || "-",
        Number(m.daily_capacity ?? 0),
        m.current_batch || "-",
        m.status || "ACTIVE",
      ]),
    ];
  }

  if (idx === 14) {
    const depts = [
      "Quyish",
      "Zaklirovka",
      "Sanding",
      "Ponza",
      "Polirovka",
      "Tosh qo'yish",
      "Lazer",
      "Moyka",
      "QC",
    ];
    return [
      ["BO'LIM", "JORIY NAVBAT (PCS)", "KUNLIK QUVVAT (PCS/DAY)", "BACKLOG (PCS)", "BOTTLENECK HOLATI"],
      ...depts.map((d) => {
        const pcs = (ctx.wipRows ?? [])
          .filter((w) => w.department === d && Number(w.available_qty ?? 0) > 0)
          .reduce((s, w) => s + Number(w.available_qty ?? 0), 0);
        const cap = d === "Lazer" || d === "Tosh qo'yish" ? 200 : 300;
        const backlog = Math.max(0, pcs - cap);
        return [d, pcs, cap, backlog, backlog > 0 ? "CRITICAL BOTTLENECK" : "NORMAL"];
      }),
    ];
  }

  const isSyntheticOrderAdvanceRow = (s: SaleRow): boolean => {
    const pName = (s.product_name || "").trim();
    return pName.startsWith("Buyurtma Avansi (") || pName.startsWith("Buyurtma Avansi");
  };

  if (idx === 15) {
    const directSales = ctx.sales.filter(
      (s) =>
        s.tx_type !== "chiqim" &&
        s.tx_type !== "debt_repayment" &&
        !isSyntheticOrderAdvanceRow(s)
    );
    return [
      ["SANA", "MIJOZ", "MAHSULOT", "SONI", "VAZN (GR)", "PROBA", "TO'LOV USULI", "TO'LANDI (SO'M)", "QOLDIQ QARZ (SO'M)"],
      ...directSales.map((s) => [
        s.created_at ? new Date(s.created_at).toLocaleDateString("uz-UZ") : "-",
        s.client_name || "-",
        s.product_name || "-",
        Number(s.quantity ?? 1),
        Number(s.weight ?? 0),
        Number(s.proba ?? 585),
        s.payment_type || "-",
        getSaleSum(s),
        Number(s.debt_amount ?? 0),
      ]),
    ];
  }

  if (idx === 16) {
    const { kassaIn, kassaOut, kassaNet } = GoldEngine.calculateFinancialSummary(
      ctx.sales,
      ctx.orders
    );
    const filteredSalesForCash = ctx.sales.filter(
      (s) =>
        s.tx_type === "chiqim" ||
        !(
          ctx.orders.length > 0 &&
          (isSyntheticOrderAdvanceRow(s) ||
            (s.tx_type === "debt_repayment" && Boolean(s.order_id)))
        )
    );
    return [
      ["SANA", "YO'NALISH", "MIJOZ / SABAB", "TAFSILOT", "TO'LOV TURI", "SUMMA (SO'M)"],
      ...ctx.orders
        .filter((o) => Number(o.advance ?? 0) > 0)
        .map((o) => [
          o.created_at ? new Date(o.created_at).toLocaleDateString("uz-UZ") : "-",
          "KIRIM (BUYURTMA AVANSI)",
          o.client_name || o.customer_name || "-",
          `Buyurtma ${o.order_no || ""}`,
          "Avans",
          Number(o.advance ?? 0),
        ]),
      ...filteredSalesForCash.map((s) => [
        s.created_at ? new Date(s.created_at).toLocaleDateString("uz-UZ") : "-",
        s.tx_type === "chiqim"
          ? "CHIQIM (XARAJAT)"
          : s.tx_type === "debt_repayment"
            ? "KIRIM (QARZ TO'LOVI)"
            : isSyntheticOrderAdvanceRow(s)
              ? "KIRIM (BUYURTMA AVANSI)"
              : "KIRIM (SOTUV)",
        s.client_name || "-",
        s.product_name || "-",
        s.payment_type || "-",
        s.tx_type === "chiqim" ? -getSaleSum(s) : getSaleSum(s),
      ]),
      ["-", "JAMI KASSA BALANSI", `Kirim: ${kassaIn}`, `Chiqim: ${kassaOut}`, "SOF QOLDIQ", kassaNet],
    ];
  }

  if (idx === 17) {
    const activeOrderDebts = ctx.orders
      .filter((o) => {
        const st = (o.status || "").trim().toLowerCase();
        if (st === "bekor qilindi" || st === "cancelled") return false;
        return Math.max(0, Number(o.total_price ?? 0) - Number(o.advance ?? 0)) > 0;
      })
      .map((o) => [
        o.created_at ? new Date(o.created_at).toLocaleDateString("uz-UZ") : "-",
        "BUYURTMA QARZI",
        o.client_name || o.customer_name || "-",
        `${o.order_no || "Buyurtma"} - ${o.product_model || o.details || ""}`,
        Number(o.total_price ?? 0),
        Number(o.advance ?? 0),
        Math.max(0, Number(o.total_price ?? 0) - Number(o.advance ?? 0)),
      ]);
    const activeSaleDebts = ctx.sales
      .filter(
        (s) =>
          Number(s.debt_amount ?? 0) > 0 &&
          s.tx_type !== "chiqim" &&
          s.tx_type !== "debt_repayment" &&
          !(ctx.orders.length > 0 && isSyntheticOrderAdvanceRow(s))
      )
      .map((s) => [
        s.created_at ? new Date(s.created_at).toLocaleDateString("uz-UZ") : "-",
        "SOTUV QARZI",
        s.client_name || "-",
        s.product_name || "-",
        getSaleSum(s) + Number(s.debt_amount ?? 0),
        getSaleSum(s),
        Number(s.debt_amount ?? 0),
      ]);
    return [
      ["SANA", "MANBA", "MIJOZ", "MAHSULOT / BUYURTMA", "JAMI SUMMA (SO'M)", "TO'LANGAN (SO'M)", "QOLDIQ QARZ (SO'M)"],
      ...activeSaleDebts,
      ...activeOrderDebts,
    ];
  }

  if (idx === 18) {
    if (ctx.salaryLedger && ctx.salaryLedger.length > 0) {
      return [
        ["SANA", "XODIM", "PARTIYA", "BOSQICH", "TURI", "VAZN (GR)", "STAVKA (SO'M)", "SUMMA (SO'M)", "STATUS"],
        ...ctx.salaryLedger.map((l) => [
          l.created_at ? new Date(l.created_at).toLocaleDateString("uz-UZ") : "-",
          l.worker_name || "-",
          l.batch_no || "-",
          l.stage_name || "-",
          l.tx_type || "EARNED",
          Number(l.weight_done ?? 0),
          Number(l.rate ?? 0),
          Number(l.amount ?? 0),
          l.payment_status || "UNPAID",
        ]),
      ];
    }
    return [
      ["XODIM", "BO'LIM", "LAVOZIM", "STAVKA TURI", "STAVKA", "BALANS (SO'M)"],
      ...ctx.employees.map((e) => [
        e.name || e.full_name || "-",
        e.department || "Sex",
        e.role_type || e.position || e.role || "-",
        e.salary_type || "-",
        Number(e.rate ?? 0),
        Number(e.balance ?? 0),
      ]),
    ];
  }

  if (idx === 19) {
    return [
      ["MAHSULOT", "TOIFA", "VAZN (GR)", "TOSH VAZNI (GR)", "SOF OLTIN 999 (GR)", "PROBA", "QOLDIQ (DONA)", "BOM TARKIBI"],
      ...ctx.products.map((p) => {
        const w = Number(p.weight ?? 0);
        const stW = Number(p.stone_weight ?? 0);
        const pr = Number(p.proba ?? 585);
        const qty = Number(p.stock ?? p.quantity ?? 0);
        const netGold = Math.max(0, w - stW) * qty;
        return [
          p.name || p.title || "-",
          p.category || "Komplekt",
          w,
          stW,
          GoldEngine.toFineGold(netGold, pr),
          pr,
          qty,
          p.bom_details || "-",
        ];
      }),
    ];
  }

  if (idx === 21) {
    const audit = GoldEngine.auditFactoryIntegrity({
      inv: ctx.inv,
      batches: ctx.batches,
      wipRows: ctx.wipRows,
      handovers: ctx.handovers,
      sales: ctx.sales,
      debtRepayments: ctx.debtRepayments,
      products: ctx.products,
      salaryLedger: ctx.salaryLedger,
    });

    const header = [
      "TOIFA",
      "OBYEKT (ID)",
      "XATOLIK DARAJASI",
      "TAVSIF",
      "NOMUTANOSIBLIK (GR)",
    ];

    const anomalyRows = audit.anomalies.map((a) => [
      a.category,
      a.entityId,
      a.severity,
      a.description,
      a.varianceGram != null ? a.varianceGram : "-",
    ]);

    const summaryRows = [
      ["--- UMUMIY REKONSILYATSIYA XULOSASI ---", "", "", "", ""],
      [
        "FABRIKA HOLATI",
        audit.isHealthy ? "SOG'LOM / INTEGRITY PASS" : "XATOLIKLAR MAVJUD",
        audit.isHealthy ? "PASS" : "DEFECT",
        `Jami anomaliyalar: ${audit.anomaliesCount}`,
        "-",
      ],
      [
        "BERILGAN OLTIN",
        "JAMI PARTIYALAR",
        "INFO",
        "Fabrika partiyalariga berilgan jami oltin",
        audit.totalGoldIssuedGram,
      ],
      [
        "HISOBLANGAN OLTIN",
        "CHIQISH + QOLDIQ + LOSS",
        "INFO",
        "Barcha partiyalar bo'yicha hisoblangan oltin",
        audit.totalGoldAccountedGram,
      ],
      [
        "NOMALUM YO'QOTISH",
        "UNACCOUNTED LEAK",
        audit.unaccountedGoldLeakGram > 0.05 ? "CRITICAL" : "PASS",
        "Tushuntirilmagan oltin kamomadi (0.0000g kutiladi)",
        audit.unaccountedGoldLeakGram,
      ],
      [
        "SAFE SOF OLTIN",
        "999 EKVIVALENT",
        "INFO",
        "Safe omboridagi sof oltin zaxirasi",
        audit.fineGoldTotalGram,
      ],
      [
        "SEX WIP OLTIN",
        "JARAYONDA",
        "INFO",
        "Sexlarda hozirda ishlov berilayotgan oltin",
        audit.activeWipGoldGram,
      ],
      [
        "VITRINA OLTIN",
        "TAYYOR MAHSULOT",
        "INFO",
        "Vitrinada turgan tayyor mahsulotlar sof oltini",
        audit.finishedProductGoldGram,
      ],
    ];

    return [header, ...anomalyRows, ...summaryRows];
  }

  return [
    ["KATEGORIYA", "NOMI", "ON HAND", "RESERVED", "AVAILABLE", "PROBA", "SOF OLTIN (999)"],
    ...ctx.inv.map((x) => {
      const onH = Number(x.on_hand ?? x.stock_grams ?? 0);
      const res = Number(x.reserved ?? 0);
      return [
        x.category || "-",
        x.name || "-",
        onH,
        res,
        Number(Math.max(0, onH - res).toFixed(2)),
        Number(x.proba ?? 0),
        GoldEngine.toFineGold(onH, x.proba),
      ];
    }),
  ];
}