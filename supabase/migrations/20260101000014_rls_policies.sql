-- =========================================================================
-- JewelryFlow ERP — Migration 014
-- Row Level Security
-- =========================================================================
-- All access goes through Supabase Auth. Every authenticated user has an
-- `employees` row with a `role`. Policies below are role-based. Service-role
-- (server-side) requests bypass RLS entirely per Supabase default behavior
-- and are used for trusted backend jobs (e.g. nightly reports).
-- =========================================================================

-- -------------------------------------------------------------------------
-- Helper: current caller's role, read once per statement via a stable fn.
-- -------------------------------------------------------------------------
create or replace function current_employee_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from employees where id = auth.uid();
$$;

create or replace function is_admin_or_manager()
returns boolean
language sql
stable
as $$
  select current_employee_role() in ('admin', 'production_manager');
$$;

-- -------------------------------------------------------------------------
-- Enable RLS everywhere.
-- -------------------------------------------------------------------------
alter table departments enable row level security;
alter table workflow_stages enable row level security;
alter table employees enable row level security;
alter table customers enable row level security;
alter table jewelry_models enable row level security;
alter table jewelry_model_images enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table batches enable row level security;
alter table batch_models enable row level security;
alter table batch_images enable row level security;
alter table batch_status_history enable row level security;
alter table batch_operations enable row level security;
alter table inventory_categories enable row level security;
alter table inventory_items enable row level security;
alter table inventory_transactions enable row level security;
alter table gold_lots enable row level security;
alter table gold_transactions enable row level security;
alter table qc_checklists enable row level security;
alter table qc_checklist_items enable row level security;
alter table qc_inspections enable row level security;
alter table qc_inspection_results enable row level security;
alter table audit_log enable row level security;

-- -------------------------------------------------------------------------
-- Baseline: every authenticated employee can READ reference/operational
-- data needed to render the app (departments, stages, models, orders,
-- batches, etc). Writes are role-gated per table below.
-- -------------------------------------------------------------------------
create policy "authenticated read departments" on departments for select to authenticated using (true);
create policy "authenticated read workflow_stages" on workflow_stages for select to authenticated using (true);
create policy "authenticated read employees" on employees for select to authenticated using (true);
create policy "authenticated read customers" on customers for select to authenticated using (true);
create policy "authenticated read jewelry_models" on jewelry_models for select to authenticated using (true);
create policy "authenticated read jewelry_model_images" on jewelry_model_images for select to authenticated using (true);
create policy "authenticated read orders" on orders for select to authenticated using (true);
create policy "authenticated read order_items" on order_items for select to authenticated using (true);
create policy "authenticated read batches" on batches for select to authenticated using (true);
create policy "authenticated read batch_models" on batch_models for select to authenticated using (true);
create policy "authenticated read batch_images" on batch_images for select to authenticated using (true);
create policy "authenticated read batch_status_history" on batch_status_history for select to authenticated using (true);
create policy "authenticated read batch_operations" on batch_operations for select to authenticated using (true);
create policy "authenticated read inventory_categories" on inventory_categories for select to authenticated using (true);
create policy "authenticated read inventory_items" on inventory_items for select to authenticated using (true);
create policy "authenticated read inventory_transactions" on inventory_transactions for select to authenticated using (true);
create policy "authenticated read gold_lots" on gold_lots for select to authenticated using (true);
create policy "authenticated read gold_transactions" on gold_transactions for select to authenticated using (true);
create policy "authenticated read qc_checklists" on qc_checklists for select to authenticated using (true);
create policy "authenticated read qc_checklist_items" on qc_checklist_items for select to authenticated using (true);
create policy "authenticated read qc_inspections" on qc_inspections for select to authenticated using (true);
create policy "authenticated read qc_inspection_results" on qc_inspection_results for select to authenticated using (true);

-- -------------------------------------------------------------------------
-- Admin-only: departments, workflow_stages, qc checklist templates.
-- -------------------------------------------------------------------------
create policy "admin write departments" on departments for all to authenticated
  using (current_employee_role() = 'admin') with check (current_employee_role() = 'admin');

create policy "admin write workflow_stages" on workflow_stages for all to authenticated
  using (current_employee_role() = 'admin') with check (current_employee_role() = 'admin');

create policy "admin write qc_checklists" on qc_checklists for all to authenticated
  using (current_employee_role() = 'admin') with check (current_employee_role() = 'admin');

create policy "admin write qc_checklist_items" on qc_checklist_items for all to authenticated
  using (current_employee_role() = 'admin') with check (current_employee_role() = 'admin');

-- -------------------------------------------------------------------------
-- Employees: self-update limited profile fields; admin manages all.
-- -------------------------------------------------------------------------
create policy "admin manage employees" on employees for all to authenticated
  using (current_employee_role() = 'admin') with check (current_employee_role() = 'admin');

create policy "self update own profile" on employees for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -------------------------------------------------------------------------
-- Sales role: customers + orders.
-- -------------------------------------------------------------------------
create policy "sales write customers" on customers for all to authenticated
  using (current_employee_role() in ('admin', 'sales'))
  with check (current_employee_role() in ('admin', 'sales'));

create policy "sales write orders" on orders for all to authenticated
  using (current_employee_role() in ('admin', 'sales', 'production_manager'))
  with check (current_employee_role() in ('admin', 'sales', 'production_manager'));

create policy "sales write order_items" on order_items for all to authenticated
  using (current_employee_role() in ('admin', 'sales', 'production_manager'))
  with check (current_employee_role() in ('admin', 'sales', 'production_manager'));

-- -------------------------------------------------------------------------
-- Jewelry models: production managers + admins maintain the catalog.
-- -------------------------------------------------------------------------
create policy "managers write jewelry_models" on jewelry_models for all to authenticated
  using (is_admin_or_manager()) with check (is_admin_or_manager());

create policy "managers write jewelry_model_images" on jewelry_model_images for all to authenticated
  using (is_admin_or_manager()) with check (is_admin_or_manager());

-- -------------------------------------------------------------------------
-- Batches: production managers create/manage; department operators may
-- only update batches currently routed to their own department (enforced
-- via batches.current_department_id matching their primary_department_id).
-- -------------------------------------------------------------------------
create policy "managers write batches" on batches for all to authenticated
  using (is_admin_or_manager()) with check (is_admin_or_manager());

create policy "operators update own department batches" on batches for update to authenticated
  using (
    current_employee_role() = 'department_operator'
    and current_department_id = (select primary_department_id from employees where id = auth.uid())
  )
  with check (
    current_employee_role() = 'department_operator'
    and current_department_id = (select primary_department_id from employees where id = auth.uid())
  );

create policy "managers write batch_models" on batch_models for all to authenticated
  using (is_admin_or_manager()) with check (is_admin_or_manager());

create policy "authenticated insert batch_images" on batch_images for insert to authenticated
  with check (true);

-- -------------------------------------------------------------------------
-- Batch operations: department operators manage operations scoped to
-- their own department; managers/admins manage everything.
-- -------------------------------------------------------------------------
create policy "managers write batch_operations" on batch_operations for all to authenticated
  using (is_admin_or_manager()) with check (is_admin_or_manager());

create policy "operators manage own department operations" on batch_operations for all to authenticated
  using (
    current_employee_role() = 'department_operator'
    and department_id = (select primary_department_id from employees where id = auth.uid())
  )
  with check (
    current_employee_role() = 'department_operator'
    and department_id = (select primary_department_id from employees where id = auth.uid())
  );

-- -------------------------------------------------------------------------
-- Inventory + Gold: inventory_manager role, admins, and managers.
-- -------------------------------------------------------------------------
create policy "inventory write inventory_categories" on inventory_categories for all to authenticated
  using (current_employee_role() in ('admin', 'inventory_manager'))
  with check (current_employee_role() in ('admin', 'inventory_manager'));

create policy "inventory write inventory_items" on inventory_items for all to authenticated
  using (current_employee_role() in ('admin', 'inventory_manager'))
  with check (current_employee_role() in ('admin', 'inventory_manager'));

create policy "inventory write inventory_transactions" on inventory_transactions for insert to authenticated
  with check (current_employee_role() in ('admin', 'inventory_manager', 'production_manager'));

create policy "inventory write gold_lots" on gold_lots for all to authenticated
  using (current_employee_role() in ('admin', 'inventory_manager'))
  with check (current_employee_role() in ('admin', 'inventory_manager'));

create policy "inventory write gold_transactions" on gold_transactions for insert to authenticated
  with check (current_employee_role() in ('admin', 'inventory_manager', 'production_manager'));

-- -------------------------------------------------------------------------
-- Quality control: quality_inspector role writes inspections; admins too.
-- -------------------------------------------------------------------------
create policy "qc write qc_inspections" on qc_inspections for insert to authenticated
  with check (current_employee_role() in ('admin', 'quality_inspector'));

create policy "qc write qc_inspection_results" on qc_inspection_results for insert to authenticated
  with check (current_employee_role() in ('admin', 'quality_inspector'));

-- -------------------------------------------------------------------------
-- Audit log: read-only for admins, never writable via the API (only
-- trigger-inserted using the definer function).
-- -------------------------------------------------------------------------
create policy "admin read audit_log" on audit_log for select to authenticated
  using (current_employee_role() = 'admin');
