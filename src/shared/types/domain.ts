import type { Database } from "./database.types";

/**
 * Ergonomic aliases so modules never write
 * `Database["public"]["Tables"]["batches"]["Row"]` directly.
 *
 * Usage: `import type { Batch, BatchInsert } from "@/shared/types/domain"`
 */

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export type TableName = keyof Tables;

export type Row<T extends TableName> = Tables[T]["Row"];
export type Insert<T extends TableName> = Tables[T]["Insert"];
export type Update<T extends TableName> = Tables[T]["Update"];
export type ViewRow<T extends keyof Views> = Views[T]["Row"];

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------
export type Department = Row<"departments">;
export type WorkflowStage = Row<"workflow_stages">;
export type Employee = Row<"employees">;
export type Customer = Row<"customers">;
export type JewelryModel = Row<"jewelry_models">;
export type JewelryModelImage = Row<"jewelry_model_images">;
export type Order = Row<"orders">;
export type OrderItem = Row<"order_items">;
export type Batch = Row<"batches">;
export type BatchModel = Row<"batch_models">;
export type BatchImage = Row<"batch_images">;
export type BatchStatusHistoryEntry = Row<"batch_status_history">;
export type BatchOperation = Row<"batch_operations">;
export type InventoryCategory = Row<"inventory_categories">;
export type InventoryItem = Row<"inventory_items">;
export type InventoryTransaction = Row<"inventory_transactions">;
export type GoldLot = Row<"gold_lots">;
export type GoldTransaction = Row<"gold_transactions">;
export type QcChecklist = Row<"qc_checklists">;
export type QcChecklistItem = Row<"qc_checklist_items">;
export type QcInspection = Row<"qc_inspections">;
export type QcInspectionResult = Row<"qc_inspection_results">;
export type AuditLogEntry = Row<"audit_log">;

// ---------------------------------------------------------------------------
// Insert / Update variants used by React Hook Form + Zod resolvers
// ---------------------------------------------------------------------------
export type CustomerInsert = Insert<"customers">;
export type CustomerUpdate = Update<"customers">;
export type JewelryModelInsert = Insert<"jewelry_models">;
export type JewelryModelUpdate = Update<"jewelry_models">;
export type OrderInsert = Insert<"orders">;
export type OrderUpdate = Update<"orders">;
export type OrderItemInsert = Insert<"order_items">;
export type BatchInsert = Insert<"batches">;
export type BatchUpdate = Update<"batches">;
export type BatchOperationInsert = Insert<"batch_operations">;
export type BatchOperationUpdate = Update<"batch_operations">;
export type InventoryItemInsert = Insert<"inventory_items">;
export type InventoryTransactionInsert = Insert<"inventory_transactions">;
export type GoldLotInsert = Insert<"gold_lots">;
export type GoldTransactionInsert = Insert<"gold_transactions">;
export type QcInspectionInsert = Insert<"qc_inspections">;
export type EmployeeInsert = Insert<"employees">;
export type EmployeeUpdate = Update<"employees">;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export type DepartmentBoardRow = ViewRow<"department_board">;
export type FactoryDashboardSummary = ViewRow<"factory_dashboard_summary">;
export type StageDurationStats = ViewRow<"stage_duration_stats">;
export type BatchGoldSummary = ViewRow<"batch_gold_summary">;

// ---------------------------------------------------------------------------
// Composite / joined shapes used by presentation-layer hooks. These are
// hand-defined (not derivable from the generated Database type) because
// they represent specific query shapes, not raw tables.
// ---------------------------------------------------------------------------
export interface BatchWithRelations extends Batch {
  order: Pick<Order, "id" | "order_number" | "customer_id">;
  current_stage: WorkflowStage | null;
  current_department: Department | null;
  assigned_employee: Pick<Employee, "id" | "full_name"> | null;
  models: Array<BatchModel & { model: JewelryModel }>;
}

export interface OrderWithRelations extends Order {
  customer: Customer;
  items: Array<OrderItem & { model: JewelryModel }>;
  batches: Batch[];
}

export interface BatchOperationWithRelations extends BatchOperation {
  batch: Pick<Batch, "id" | "batch_number" | "priority">;
  stage: WorkflowStage;
  department: Department;
  assigned_employee: Pick<Employee, "id" | "full_name"> | null;
}
