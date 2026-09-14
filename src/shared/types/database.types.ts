/**
 * Hand-authored to exactly match `supabase/migrations/*.sql`.
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

// ---------------------------------------------------------------------------
// Database interface
// ---------------------------------------------------------------------------
export interface Database {
  public: {
    Tables: {
      departments: {
        Row: {
          id: string;
          code: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["departments"]["Insert"]>;
      };

      workflow_stages: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: Partial<Database["public"]["Tables"]["workflow_stages"]["Insert"]>;
      };

      employees: {
        Row: {
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
        };
        Insert: {
          id: string; // must match auth.users.id
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
        };
        Update: Partial<Database["public"]["Tables"]["employees"]["Insert"]>;
      };

      customers: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Insert"]>;
      };

      jewelry_models: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: Partial<Database["public"]["Tables"]["jewelry_models"]["Insert"]>;
      };

      jewelry_model_images: {
        Row: {
          id: string;
          model_id: string;
          storage_path: string;
          caption: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          model_id: string;
          storage_path: string;
          caption?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["jewelry_model_images"]["Insert"]>;
      };

      orders: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
      };

      order_items: {
        Row: {
          id: string;
          order_id: string;
          model_id: string;
          quantity: number;
          ring_size: string | null;
          unit_notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          model_id: string;
          quantity: number;
          ring_size?: string | null;
          unit_notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
      };

      batches: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: Partial<Database["public"]["Tables"]["batches"]["Insert"]>;
      };

      batch_models: {
        Row: {
          id: string;
          batch_id: string;
          model_id: string;
          order_item_id: string | null;
          quantity: number;
          weight_grams: number | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          model_id: string;
          order_item_id?: string | null;
          quantity: number;
          weight_grams?: number | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["batch_models"]["Insert"]>;
      };

      batch_images: {
        Row: {
          id: string;
          batch_id: string;
          stage_id: string | null;
          storage_path: string;
          caption: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          stage_id?: string | null;
          storage_path: string;
          caption?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["batch_images"]["Insert"]>;
      };

      batch_status_history: {
        Row: {
          id: string;
          batch_id: string;
          previous_status: BatchStatus | null;
          new_status: BatchStatus;
          previous_priority: BatchPriority | null;
          new_priority: BatchPriority | null;
          changed_by: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          previous_status?: BatchStatus | null;
          new_status: BatchStatus;
          previous_priority?: BatchPriority | null;
          new_priority?: BatchPriority | null;
          changed_by?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["batch_status_history"]["Insert"]>;
      };

      batch_operations: {
        Row: {
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
          duration_seconds: number | null; // generated column, read-only
          delay_reason_category: DelayReasonCategory | null;
          delay_reason_notes: string | null;
          delayed_minutes: number | null;
          input_weight_grams: number | null;
          output_weight_grams: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
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
        };
        Update: Partial<Database["public"]["Tables"]["batch_operations"]["Insert"]>;
      };

      inventory_categories: {
        Row: {
          id: string;
          name: string;
          parent_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          parent_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inventory_categories"]["Insert"]>;
      };

      inventory_items: {
        Row: {
          id: string;
          sku: string;
          name: string;
          category_id: string | null;
          unit: InventoryUnit;
          quantity_on_hand: number; // maintained by trigger; do not write directly
          reorder_threshold: number | null;
          unit_cost: number | null;
          supplier_name: string | null;
          location: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
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
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["inventory_items"]["Insert"], "quantity_on_hand">
        >;
      };

      inventory_transactions: {
        Row: {
          id: string;
          item_id: string;
          type: InventoryTransactionType;
          quantity: number;
          batch_id: string | null;
          unit_cost: number | null;
          reference_note: string | null;
          performed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          type: InventoryTransactionType;
          quantity: number;
          batch_id?: string | null;
          unit_cost?: number | null;
          reference_note?: string | null;
          performed_by?: string | null;
          created_at?: string;
        };
        Update: never; // ledger rows are immutable
      };

      gold_lots: {
        Row: {
          id: string;
          lot_number: string;
          purity: GoldPurity;
          source: string;
          received_weight_grams: number;
          remaining_weight_grams: number; // maintained by trigger
          cost_per_gram: number | null;
          received_at: string;
          received_by: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
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
        };
        Update: Partial<
          Omit<Database["public"]["Tables"]["gold_lots"]["Insert"], "remaining_weight_grams">
        >;
      };

      gold_transactions: {
        Row: {
          id: string;
          lot_id: string;
          type: GoldTransactionType;
          weight_grams: number;
          batch_id: string | null;
          batch_operation_id: string | null;
          performed_by: string | null;
          reference_note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lot_id: string;
          type: GoldTransactionType;
          weight_grams: number;
          batch_id?: string | null;
          batch_operation_id?: string | null;
          performed_by?: string | null;
          reference_note?: string | null;
          created_at?: string;
        };
        Update: never; // ledger rows are immutable
      };

      qc_checklists: {
        Row: {
          id: string;
          stage_id: string | null;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          stage_id?: string | null;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["qc_checklists"]["Insert"]>;
      };

      qc_checklist_items: {
        Row: {
          id: string;
          checklist_id: string;
          label: string;
          sort_order: number;
          is_required: boolean;
        };
        Insert: {
          id?: string;
          checklist_id: string;
          label: string;
          sort_order?: number;
          is_required?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["qc_checklist_items"]["Insert"]>;
      };

      qc_inspections: {
        Row: {
          id: string;
          batch_id: string;
          batch_operation_id: string | null;
          checklist_id: string | null;
          inspector_id: string;
          result: QcResult;
          defect_notes: string | null;
          inspected_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          batch_operation_id?: string | null;
          checklist_id?: string | null;
          inspector_id: string;
          result: QcResult;
          defect_notes?: string | null;
          inspected_at?: string;
          created_at?: string;
        };
        Update: never; // inspections are immutable records
      };

      qc_inspection_results: {
        Row: {
          id: string;
          inspection_id: string;
          checklist_item_id: string;
          passed: boolean;
          comment: string | null;
        };
        Insert: {
          id?: string;
          inspection_id: string;
          checklist_item_id: string;
          passed: boolean;
          comment?: string | null;
        };
        Update: never;
      };

      audit_log: {
        Row: {
          id: string;
          table_name: string;
          record_id: string;
          action: "insert" | "update" | "delete";
          old_data: Json | null;
          new_data: Json | null;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: never; // system-inserted only, via trigger
        Update: never;
      };
    };

    Views: {
      department_board: {
        Row: {
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
        };
      };
      factory_dashboard_summary: {
        Row: {
          batches_in_progress: number;
          batches_delayed: number;
          batches_on_hold: number;
          batches_pending: number;
          batches_completed_today: number;
          active_orders: number;
          qc_failures_today: number;
          gold_on_hand_grams: number;
        };
      };
      stage_duration_stats: {
        Row: {
          stage_id: string;
          stage_name: string;
          sequence_order: number;
          default_sla_minutes: number | null;
          completed_count: number;
          avg_duration_seconds: number | null;
          median_duration_seconds: number | null;
          delayed_count: number;
        };
      };
      batch_gold_summary: {
        Row: {
          batch_id: string;
          batch_number: string;
          issued_grams: number;
          returned_grams: number;
          melting_loss_grams: number;
          scrap_recovered_grams: number;
          net_consumed_grams: number;
        };
      };
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
  };
}
