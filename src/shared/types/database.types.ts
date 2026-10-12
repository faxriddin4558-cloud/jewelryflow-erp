/**
 * Hand-authored to match `supabase/migrations/*.sql`.
 *
 * In CI/local dev this file should be regenerated from the live schema via:
 *   supabase gen types typescript --local > src/shared/types/database.types.ts
 *
 * It is checked in (rather than gitignored) so the app always compiles
 * against a known-good schema snapshot, and so this task can ship it
 * without a running Supabase instance. Regenerate after every new
 * migration and re-run `tsc` to catch drift immediately.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---------------------------------------------------------------------------
// Enums (must match migration 001_extensions_and_enums.sql)
// ---------------------------------------------------------------------------
export type AppRole =
  | "admin"
  | "production_manager"
  | "department_operator"
  | "quality_inspector"
  | "inventory_manager"
  | "sales"
  | "viewer";

export type OrderStatus =
  | "draft"
  | "confirmed"
  | "in_production"
  | "quality_hold"
  | "ready_to_ship"
  | "shipped"
  | "completed"
  | "cancelled";

export type OrderPriority = "low" | "normal" | "high" | "urgent";

export type BatchStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "delayed"
  | "on_hold"
  | "completed"
  | "cancelled";

export type BatchPriority = "low" | "normal" | "high" | "urgent";

export type OperationStatus =
  | "queued"
  | "in_progress"
  | "paused"
  | "completed"
  | "delayed"
  | "skipped"
  | "rejected";

export type DelayReasonCategory =
  | "machine_breakdown"
  | "material_shortage"
  | "employee_unavailable"
  | "power_outage"
  | "quality_rework"
  | "design_change"
  | "other";

export type QcResult = "pass" | "fail" | "conditional_pass";

export type InventoryUnit = "gram" | "kilogram" | "piece" | "carat" | "meter" | "box";

export type InventoryTransactionType =
  | "purchase_in"
  | "production_consumption"
  | "production_return"
  | "adjustment_in"
  | "adjustment_out"
  | "transfer"
  | "scrap_out";

export type GoldPurity = "k9" | "k14" | "k18" | "k21" | "k22" | "k24";

export type GoldTransactionType =
  | "lot_received"
  | "issued_to_batch"
  | "returned_from_batch"
  | "melting_loss"
  | "scrap_recovered"
  | "adjustment";

export type EmploymentStatus = "active" | "on_leave" | "terminated";

type TableDef<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Update extends Record<string, unknown> = Partial<Insert>,
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type ViewDef<Row extends Record<string, unknown>> = {
  Row: Row;
  Relationships: [];
};

// ---------------------------------------------------------------------------
// Database type (must be a `type`, not `interface`, for postgrest-js GenericSchema)
// ---------------------------------------------------------------------------
export type Database = {
  public: {
    Tables: {
      departments: TableDef<
        {
          id: string;
          code: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          code: string;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;

      workflow_stages: TableDef<
        {
          id: string;
          code: string;
          name: string;
          sequence_order: number;
          department_id: string;
          is_terminal: boolean;
          is_active: boolean;
          default_sla_minutes: number | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          code: string;
          name: string;
          sequence_order: number;
          department_id: string;
          is_terminal?: boolean;
          is_active?: boolean;
          default_sla_minutes?: number | null;
          created_at?: string;
          updated_at?: string;
        }
      >;

      employees: TableDef<
        {
          id: string;
          employee_code: string;
          full_name: string;
          phone: string | null;
          role: AppRole;
          primary_department_id: string | null;
          employment_status: EmploymentStatus;
          hired_at: string | null;
          photo_url: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          employee_code: string;
          full_name: string;
          phone?: string | null;
          role?: AppRole;
          primary_department_id?: string | null;
          employment_status?: EmploymentStatus;
          hired_at?: string | null;
          photo_url?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;

      customers: TableDef<
        {
          id: string;
          customer_code: string;
          company_name: string | null;
          contact_name: string;
          email: string | null;
          phone: string | null;
          billing_address: string | null;
          shipping_address: string | null;
          tax_id: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        },
        {
          id?: string;
          customer_code: string;
          company_name?: string | null;
          contact_name: string;
          email?: string | null;
          phone?: string | null;
          billing_address?: string | null;
          shipping_address?: string | null;
          tax_id?: string | null;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        }
      >;

      jewelry_models: TableDef<
        {
          id: string;
          model_code: string;
          name: string;
          category: string | null;
          ring_size: string | null;
          loops_count: number;
          locks_count: number;
          decorations: string | null;
          reference_weight_grams: number | null;
          gold_purity: GoldPurity | null;
          primary_image_url: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        },
        {
          id?: string;
          model_code: string;
          name: string;
          category?: string | null;
          ring_size?: string | null;
          loops_count?: number;
          locks_count?: number;
          decorations?: string | null;
          reference_weight_grams?: number | null;
          gold_purity?: GoldPurity | null;
          primary_image_url?: string | null;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        }
      >;

      jewelry_model_images: TableDef<
        {
          id: string;
          model_id: string;
          storage_path: string;
          caption: string | null;
          sort_order: number;
          created_at: string;
        },
        {
          id?: string;
          model_id: string;
          storage_path: string;
          caption?: string | null;
          sort_order?: number;
          created_at?: string;
        }
      >;

      orders: TableDef<
        {
          id: string;
          order_number: string;
          customer_id: string;
          status: OrderStatus;
          priority: OrderPriority;
          order_date: string;
          due_date: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        },
        {
          id?: string;
          order_number: string;
          customer_id: string;
          status?: OrderStatus;
          priority?: OrderPriority;
          order_date?: string;
          due_date?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        }
      >;

      order_items: TableDef<
        {
          id: string;
          order_id: string;
          model_id: string;
          quantity: number;
          ring_size: string | null;
          unit_notes: string | null;
          created_at: string;
        },
        {
          id?: string;
          order_id: string;
          model_id: string;
          quantity: number;
          ring_size?: string | null;
          unit_notes?: string | null;
          created_at?: string;
        }
      >;

      batches: TableDef<
        {
          id: string;
          batch_number: string;
          order_id: string;
          status: BatchStatus;
          priority: BatchPriority;
          current_stage_id: string | null;
          current_department_id: string | null;
          assigned_employee_id: string | null;
          started_at: string | null;
          completed_at: string | null;
          due_date: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        },
        {
          id?: string;
          batch_number: string;
          order_id: string;
          status?: BatchStatus;
          priority?: BatchPriority;
          current_stage_id?: string | null;
          current_department_id?: string | null;
          assigned_employee_id?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          due_date?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        }
      >;

      batch_models: TableDef<
        {
          id: string;
          batch_id: string;
          model_id: string;
          order_item_id: string | null;
          quantity: number;
          weight_grams: number | null;
          notes: string | null;
          created_at: string;
        },
        {
          id?: string;
          batch_id: string;
          model_id: string;
          order_item_id?: string | null;
          quantity: number;
          weight_grams?: number | null;
          notes?: string | null;
          created_at?: string;
        }
      >;

      batch_images: TableDef<
        {
          id: string;
          batch_id: string;
          stage_id: string | null;
          storage_path: string;
          caption: string | null;
          uploaded_by: string | null;
          created_at: string;
        },
        {
          id?: string;
          batch_id: string;
          stage_id?: string | null;
          storage_path: string;
          caption?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        }
      >;

      batch_status_history: TableDef<
        {
          id: string;
          batch_id: string;
          previous_status: BatchStatus | null;
          new_status: BatchStatus;
          previous_priority: BatchPriority | null;
          new_priority: BatchPriority | null;
          changed_by: string | null;
          reason: string | null;
          created_at: string;
        },
        {
          id?: string;
          batch_id: string;
          previous_status?: BatchStatus | null;
          new_status: BatchStatus;
          previous_priority?: BatchPriority | null;
          new_priority?: BatchPriority | null;
          changed_by?: string | null;
          reason?: string | null;
          created_at?: string;
        }
      >;

      batch_operations: TableDef<
        {
          id: string;
          batch_id: string;
          stage_id: string;
          department_id: string;
          attempt_number: number;
          status: OperationStatus;
          assigned_employee_id: string | null;
          performed_by_employee_id: string | null;
          queued_at: string;
          started_at: string | null;
          finished_at: string | null;
          duration_seconds: number | null;
          delay_reason_category: DelayReasonCategory | null;
          delay_reason_notes: string | null;
          delayed_minutes: number | null;
          input_weight_grams: number | null;
          output_weight_grams: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          batch_id: string;
          stage_id: string;
          department_id: string;
          attempt_number?: number;
          status?: OperationStatus;
          assigned_employee_id?: string | null;
          performed_by_employee_id?: string | null;
          queued_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          delay_reason_category?: DelayReasonCategory | null;
          delay_reason_notes?: string | null;
          delayed_minutes?: number | null;
          input_weight_grams?: number | null;
          output_weight_grams?: number | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;

      inventory_categories: TableDef<
        {
          id: string;
          name: string;
          parent_id: string | null;
          created_at: string;
        },
        {
          id?: string;
          name: string;
          parent_id?: string | null;
          created_at?: string;
        }
      >;

      inventory_items: TableDef<
        {
          id: string;
          sku: string;
          name: string;
          category_id: string | null;
          unit: InventoryUnit;
          quantity_on_hand: number;
          reorder_threshold: number | null;
          unit_cost: number | null;
          supplier_name: string | null;
          location: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          sku: string;
          name: string;
          category_id?: string | null;
          unit: InventoryUnit;
          reorder_threshold?: number | null;
          unit_cost?: number | null;
          supplier_name?: string | null;
          location?: string | null;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;

      inventory_transactions: TableDef<
        {
          id: string;
          item_id: string;
          type: InventoryTransactionType;
          quantity: number;
          batch_id: string | null;
          unit_cost: number | null;
          reference_note: string | null;
          performed_by: string | null;
          created_at: string;
        },
        {
          id?: string;
          item_id: string;
          type: InventoryTransactionType;
          quantity: number;
          batch_id?: string | null;
          unit_cost?: number | null;
          reference_note?: string | null;
          performed_by?: string | null;
          created_at?: string;
        },
        Record<string, never>
      >;

      gold_lots: TableDef<
        {
          id: string;
          lot_number: string;
          purity: GoldPurity;
          source: string;
          received_weight_grams: number;
          remaining_weight_grams: number;
          cost_per_gram: number | null;
          received_at: string;
          received_by: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          lot_number: string;
          purity: GoldPurity;
          source: string;
          received_weight_grams: number;
          remaining_weight_grams?: number;
          cost_per_gram?: number | null;
          received_at?: string;
          received_by?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          lot_number?: string;
          purity?: GoldPurity;
          source?: string;
          received_weight_grams?: number;
          cost_per_gram?: number | null;
          received_at?: string;
          received_by?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;

      gold_transactions: TableDef<
        {
          id: string;
          lot_id: string;
          type: GoldTransactionType;
          weight_grams: number;
          batch_id: string | null;
          batch_operation_id: string | null;
          performed_by: string | null;
          reference_note: string | null;
          created_at: string;
        },
        {
          id?: string;
          lot_id: string;
          type: GoldTransactionType;
          weight_grams: number;
          batch_id?: string | null;
          batch_operation_id?: string | null;
          performed_by?: string | null;
          reference_note?: string | null;
          created_at?: string;
        },
        Record<string, never>
      >;

      qc_checklists: TableDef<
        {
          id: string;
          stage_id: string | null;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        },
        {
          id?: string;
          stage_id?: string | null;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        }
      >;

      qc_checklist_items: TableDef<
        {
          id: string;
          checklist_id: string;
          label: string;
          sort_order: number;
          is_required: boolean;
        },
        {
          id?: string;
          checklist_id: string;
          label: string;
          sort_order?: number;
          is_required?: boolean;
        }
      >;

      qc_inspections: TableDef<
        {
          id: string;
          batch_id: string;
          batch_operation_id: string | null;
          checklist_id: string | null;
          inspector_id: string;
          result: QcResult;
          defect_notes: string | null;
          inspected_at: string;
          created_at: string;
        },
        {
          id?: string;
          batch_id: string;
          batch_operation_id?: string | null;
          checklist_id?: string | null;
          inspector_id: string;
          result: QcResult;
          defect_notes?: string | null;
          inspected_at?: string;
          created_at?: string;
        },
        Record<string, never>
      >;

      qc_inspection_results: TableDef<
        {
          id: string;
          inspection_id: string;
          checklist_item_id: string;
          passed: boolean;
          comment: string | null;
        },
        {
          id?: string;
          inspection_id: string;
          checklist_item_id: string;
          passed: boolean;
          comment?: string | null;
        },
        Record<string, never>
      >;

      audit_log: TableDef<
        {
          id: string;
          table_name: string;
          record_id: string;
          action: "insert" | "update" | "delete";
          old_data: Json | null;
          new_data: Json | null;
          changed_by: string | null;
          changed_at: string;
        },
        Record<string, never>,
        Record<string, never>
      >;
    };

    Views: {
      department_board: ViewDef<{
        department_id: string;
        department_code: string;
        department_name: string;
        operation_id: string;
        operation_status: OperationStatus;
        batch_id: string;
        batch_number: string;
        batch_priority: BatchPriority;
        stage_id: string;
        stage_name: string;
        assigned_employee_id: string | null;
        assigned_employee_name: string | null;
        queued_at: string;
        started_at: string | null;
        delay_reason_category: DelayReasonCategory | null;
        delayed_minutes: number | null;
      }>;
      factory_dashboard_summary: ViewDef<{
        batches_in_progress: number;
        batches_delayed: number;
        batches_on_hold: number;
        batches_pending: number;
        batches_completed_today: number;
        active_orders: number;
        qc_failures_today: number;
        gold_on_hand_grams: number;
      }>;
      stage_duration_stats: ViewDef<{
        stage_id: string;
        stage_name: string;
        sequence_order: number;
        default_sla_minutes: number | null;
        completed_count: number;
        avg_duration_seconds: number | null;
        median_duration_seconds: number | null;
        delayed_count: number;
      }>;
      batch_gold_summary: ViewDef<{
        batch_id: string;
        batch_number: string;
        issued_grams: number;
        returned_grams: number;
        melting_loss_grams: number;
        scrap_recovered_grams: number;
        net_consumed_grams: number;
      }>;
    };

    Functions: {
      current_employee_role: {
        Args: Record<PropertyKey, never>;
        Returns: AppRole;
      };
      is_admin_or_manager: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };

    Enums: {
      app_role: AppRole;
      order_status: OrderStatus;
      order_priority: OrderPriority;
      batch_status: BatchStatus;
      batch_priority: BatchPriority;
      operation_status: OperationStatus;
      delay_reason_category: DelayReasonCategory;
      qc_result: QcResult;
      inventory_unit: InventoryUnit;
      inventory_transaction_type: InventoryTransactionType;
      gold_purity: GoldPurity;
      gold_transaction_type: GoldTransactionType;
      employment_status: EmploymentStatus;
    };

    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
