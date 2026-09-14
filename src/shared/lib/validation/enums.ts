import { z } from "zod";

/**
 * Zod schemas mirroring every PostgreSQL enum defined in
 * `supabase/migrations/20260101000001_extensions_and_enums.sql`.
 *
 * These are the single source of truth for validating enum values on the
 * client (React Hook Form) and at the API boundary (Route Handlers /
 * Server Actions) before they ever reach Postgres. If a migration adds or
 * renames an enum value, update it here in the same PR.
 */

export const appRoleSchema = z.enum([
  "admin",
  "production_manager",
  "department_operator",
  "quality_inspector",
  "inventory_manager",
  "sales",
  "viewer",
]);

export const orderStatusSchema = z.enum([
  "draft",
  "confirmed",
  "in_production",
  "quality_hold",
  "ready_to_ship",
  "shipped",
  "completed",
  "cancelled",
]);

export const orderPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const batchStatusSchema = z.enum([
  "pending",
  "queued",
  "in_progress",
  "delayed",
  "on_hold",
  "completed",
  "cancelled",
]);

export const batchPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const operationStatusSchema = z.enum([
  "queued",
  "in_progress",
  "paused",
  "completed",
  "delayed",
  "skipped",
  "rejected",
]);

export const delayReasonCategorySchema = z.enum([
  "machine_breakdown",
  "material_shortage",
  "employee_unavailable",
  "power_outage",
  "quality_rework",
  "design_change",
  "other",
]);

export const qcResultSchema = z.enum(["pass", "fail", "conditional_pass"]);

export const inventoryUnitSchema = z.enum(["gram", "kilogram", "piece", "carat", "meter", "box"]);

export const inventoryTransactionTypeSchema = z.enum([
  "purchase_in",
  "production_consumption",
  "production_return",
  "adjustment_in",
  "adjustment_out",
  "transfer",
  "scrap_out",
]);

export const goldPuritySchema = z.enum(["k9", "k14", "k18", "k21", "k22", "k24"]);

export const goldTransactionTypeSchema = z.enum([
  "lot_received",
  "issued_to_batch",
  "returned_from_batch",
  "melting_loss",
  "scrap_recovered",
  "adjustment",
]);

export const employmentStatusSchema = z.enum(["active", "on_leave", "terminated"]);
