-- ============================================================================
-- Migration: 20260101000017_security_rls_and_privilege_hardening.sql
-- Purpose:   Phase 9 Security Hardening (Hybrid bigint/uuid Schema Compatible):
--            1. Prevent employee self-promotion to admin (RLS + Trigger)
--            2. Enable RLS on all operational & legacy tables (incl. orfers/payroll)
--            3. Remove permissive PUBLIC/anon policies and enforce role-based RLS
--            4. Protect audit logs and financial ledgers from DELETE/tampering
--            5. Harden SECURITY DEFINER search_path & revoke PUBLIC/anon EXECUTE
-- ============================================================================

-- 0. Verify all required core ERP tables exist before applying RLS policies & triggers
do $$
declare
  v_core_table text;
  v_required_core_tables text[] := array[
    'employees',
    'orders',
    'batches',
    'inventory_items',
    'gold_transactions',
    'idempotency_keys',
    'inventory_reservations',
    'affinaj_records',
    'production_stages',
    'batch_stage_wip',
    'consumption',
    'machines',
    'products',
    'bom_items',
    'sales',
    'debt_repayments',
    'salary_ledger',
    'quality_control',
    'audit_logs',
    'system_settings',
    'stage_loss_configs'
  ];
begin
  foreach v_core_table in array v_required_core_tables
  loop
    if to_regclass('public.' || v_core_table) is null then
      raise exception 'Required core ERP table "public.%" does not exist. Apply migration 015 before migration 017.', v_core_table;
    end if;
  end loop;
end $$;

-- 1. Harden search_path on all existing SECURITY DEFINER functions (if present)
do $$
begin
  if to_regprocedure('public.handle_new_auth_user()') is not null then
    alter function public.handle_new_auth_user() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.log_batch_status_change()') is not null then
    alter function public.log_batch_status_change() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.sync_batch_current_stage()') is not null then
    alter function public.sync_batch_current_stage() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.complete_batch_on_terminal_stage()') is not null then
    alter function public.complete_batch_on_terminal_stage() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.apply_inventory_transaction()') is not null then
    alter function public.apply_inventory_transaction() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.apply_gold_transaction()') is not null then
    alter function public.apply_gold_transaction() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.handle_qc_failure()') is not null then
    alter function public.handle_qc_failure() set search_path = public, pg_temp;
  end if;
  if to_regprocedure('public.record_audit_event()') is not null then
    alter function public.record_audit_event() set search_path = public, pg_temp;
  end if;
end $$;

create or replace function public.current_employee_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_employee_role_text();
begin
  case v_role
    when 'admin', 'director', 'owner', 'direktor', 'rahbar' then
      return 'admin'::public.app_role;
    when 'production_manager', 'production manager', 'manager', 'ishlab chiqarish boshlig''i' then
      return 'production_manager'::public.app_role;
    when 'inventory_manager', 'warehouse', 'omborchi' then
      return 'inventory_manager'::public.app_role;
    when 'sales', 'accountant', 'buxgalter', 'hisobchi' then
      return 'sales'::public.app_role;
    when 'quality_inspector', 'quality_control' then
      return 'quality_inspector'::public.app_role;
    when 'department_operator', 'department_head', 'supervisor', 'master', 'worker', 'usta', 'bosh usta' then
      return 'department_operator'::public.app_role;
    else
      return 'viewer'::public.app_role;
  end case;
end;
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i'
    ),
    false
  );
$$;

-- 2. Fix Employees Self-Promotion Vulnerability (BEFORE UPDATE Trigger)
create or replace function public.prevent_employee_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_in_salary_rpc  boolean := (coalesce(current_setting('app.in_salary_rpc', true), 'false') = 'true');
  v_in_auth_link   boolean := (coalesce(current_setting('app.in_auth_link_trigger', true), 'false') = 'true');
begin
  if auth.uid() is not null and not public.is_admin_or_manager() then
    if new.role is distinct from old.role
       or new.role_type is distinct from old.role_type
       or new.status is distinct from old.status
       or new.employment_status is distinct from old.employment_status
       or new.is_active is distinct from old.is_active
       or new.employee_code is distinct from old.employee_code
       or new.primary_department_id is distinct from old.primary_department_id
       or new.rate is distinct from old.rate
       or (new.user_id is distinct from old.user_id and not v_in_auth_link)
       or new.email is distinct from old.email
       or (new.balance is distinct from old.balance and not v_in_salary_rpc)
    then
      raise exception 'Privilege escalation blocked: only admin or manager may modify role, identity link, status, rate, or balance'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_employee_privilege_escalation on public.employees;
create trigger trg_prevent_employee_privilege_escalation
  before update on public.employees
  for each row execute function public.prevent_employee_privilege_escalation();

-- 3. Enable RLS on all core operational tables (and guarded optional legacy tables)
alter table public.employees              enable row level security;
alter table public.orders                 enable row level security;
alter table public.batches                enable row level security;
alter table public.inventory_items        enable row level security;
alter table public.gold_transactions      enable row level security;
alter table public.idempotency_keys       enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.affinaj_records        enable row level security;
alter table public.production_stages      enable row level security;
alter table public.batch_stage_wip        enable row level security;
alter table public.consumption            enable row level security;
alter table public.machines               enable row level security;
alter table public.products               enable row level security;
alter table public.bom_items              enable row level security;
alter table public.sales                  enable row level security;
alter table public.debt_repayments        enable row level security;
alter table public.salary_ledger          enable row level security;
alter table public.quality_control        enable row level security;
alter table public.audit_logs             enable row level security;
alter table public.system_settings        enable row level security;
alter table public.stage_loss_configs     enable row level security;

do $$
declare
  v_opt_tbl text;
  v_optional_legacy_tables text[] := array[
    'inventory_transactions',
    'gold_lots',
    'batch_operations',
    'batch_status_history',
    'qc_inspections',
    'qc_inspection_results',
    'audit_log'
  ];
begin
  foreach v_opt_tbl in array v_optional_legacy_tables
  loop
    if to_regclass('public.' || v_opt_tbl) is not null then
      execute format('alter table public.%I enable row level security', v_opt_tbl);
    end if;
  end loop;
end $$;

-- 4. Deterministically drop all pre-existing legacy (014) and permissive Dashboard policies
--    on managed ERP tables before creating the authoritative hardened policy set.
drop policy if exists "self update own profile" on public.employees;
drop policy if exists "Employees can update own profile" on public.employees;
drop policy if exists "Employees can update own safe profile fields" on public.employees;

do $$
declare
  v_pol record;
begin
  for v_pol in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in (
         'employees',
         'orders',
         'batches',
         'inventory_items',
         'inventory_transactions',
         'gold_lots',
         'gold_transactions',
         'batch_operations',
         'batch_status_history',
         'qc_inspections',
         'qc_inspection_results',
         'audit_log',
         'idempotency_keys',
         'inventory_reservations',
         'affinaj_records',
         'production_stages',
         'batch_stage_wip',
         'consumption',
         'machines',
         'products',
         'bom_items',
         'sales',
         'debt_repayments',
         'salary_ledger',
         'quality_control',
         'audit_logs',
         'system_settings',
         'stage_loss_configs',
         'orfers',
         'payroll'
       )
  loop
    execute format('drop policy if exists %I on %I.%I', v_pol.policyname, v_pol.schemaname, v_pol.tablename);
  end loop;

  if to_regclass('public.orfers') is not null then
    execute 'alter table public.orfers enable row level security';
    execute 'create policy "Admins and managers can access legacy orfers" on public.orfers for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager())';
  end if;
  if to_regclass('public.payroll') is not null then
    execute 'alter table public.payroll enable row level security';
    execute 'create policy "Admins and managers can access legacy payroll" on public.payroll for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager())';
  end if;
end $$;

-- 5. Least-Privilege SELECT & Write Policies on Core & Operational ERP Tables

-- 5.1 EMPLOYEES:
-- Every authenticated user can read their own employee row; only management, accounting,
-- and supervisory roles can read all employee rows (workers/viewers cannot dump other employees' salaries).
create policy "employees_select_own_or_authorized"
  on public.employees for select to authenticated
  using (
    user_id = auth.uid()
    or id::text = auth.uid()::text
    or public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "Employees can update own safe profile fields"
  on public.employees for update to authenticated
  using (user_id = auth.uid() or id::text = auth.uid()::text)
  with check (
    (user_id = auth.uid() or id::text = auth.uid()::text)
    and role is not distinct from (select e.role from public.employees e where e.id = employees.id)
    and role_type is not distinct from (select e.role_type from public.employees e where e.id = employees.id)
    and status is not distinct from (select e.status from public.employees e where e.id = employees.id)
    and employment_status is not distinct from (select e.employment_status from public.employees e where e.id = employees.id)
    and is_active is not distinct from (select e.is_active from public.employees e where e.id = employees.id)
    and employee_code is not distinct from (select e.employee_code from public.employees e where e.id = employees.id)
    and primary_department_id is not distinct from (select e.primary_department_id from public.employees e where e.id = employees.id)
    and user_id is not distinct from (select e.user_id from public.employees e where e.id = employees.id)
    and email is not distinct from (select e.email from public.employees e where e.id = employees.id)
    and rate is not distinct from (select e.rate from public.employees e where e.id = employees.id)
    and balance is not distinct from (select e.balance from public.employees e where e.id = employees.id)
  );

create policy "admin manage employees"
  on public.employees for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.2 ORDERS:
-- Contains customer phone, total price, advance, and debt. Restricted from worker/viewer.
create policy "orders_select_authorized"
  on public.orders for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi',
      'inventory_manager', 'warehouse', 'omborchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "sales write orders"
  on public.orders for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "sales update orders"
  on public.orders for update to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "admin delete orders"
  on public.orders for delete to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.3 INVENTORY, SAFE GOLD LOTS, GOLD TRANSACTIONS, RESERVATIONS & AFFINAJ:
-- Restricted from worker/viewer. All balance mutations occur via SECURITY DEFINER RPCs;
-- direct client INSERT on inventory_items is permitted ONLY for 0-balance material card registration.
create policy "inventory_items_select_authorized"
  on public.inventory_items for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'sales', 'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "inventory_items_insert_zero_balance_card"
  on public.inventory_items for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
    and coalesce(on_hand, 0) = 0
    and coalesce(quantity_on_hand, 0) = 0
    and coalesce(reserved, 0) = 0
  );

create policy "inventory_items_admin_manage"
  on public.inventory_items for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "gold_transactions_select_authorized"
  on public.gold_transactions for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "gold_transactions_admin_insert"
  on public.gold_transactions for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "inventory_reservations_select_authorized"
  on public.inventory_reservations for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "inventory_reservations_admin_manage"
  on public.inventory_reservations for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "affinaj_records_select_authorized"
  on public.affinaj_records for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "affinaj_records_admin_insert"
  on public.affinaj_records for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.4 BATCHES, WIP, CONSUMPTION, STAGES, OPERATIONS & QC:
-- Operational mutations on batches, batch_stage_wip, and consumption run via SECURITY DEFINER RPCs;
-- direct client table writes on those ledger/state tables are restricted to admin/director.
create policy "authenticated read batches"
  on public.batches for select to authenticated using (true);

create policy "batches_admin_manage"
  on public.batches for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read own idempotency keys"
  on public.idempotency_keys for select to authenticated
  using (actor_id = auth.uid() or public.is_admin_or_manager());

create policy "Authenticated users can read production stages"
  on public.production_stages for select to authenticated using (true);

create policy "Admins and managers can manage production stages"
  on public.production_stages for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "Authenticated users can read batch stage wip"
  on public.batch_stage_wip for select to authenticated using (true);

create policy "batch_stage_wip_admin_manage"
  on public.batch_stage_wip for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read consumption"
  on public.consumption for select to authenticated using (true);

create policy "consumption_admin_insert"
  on public.consumption for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read machines"
  on public.machines for select to authenticated using (true);

create policy "Admins and managers can manage machines"
  on public.machines for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

-- Guarded RLS policies for optional legacy tables (004..012) when present in the schema
do $$
begin
  if to_regclass('public.inventory_transactions') is not null then
    execute $sql$
      create policy "inventory_transactions_select_authorized"
        on public.inventory_transactions for select to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'inventory_manager', 'warehouse', 'omborchi',
            'accountant', 'buxgalter', 'hisobchi'
          )
        );
      create policy "inventory_transactions_admin_insert"
        on public.inventory_transactions for insert to authenticated
        with check (
          public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
        );
    $sql$;
  end if;

  if to_regclass('public.gold_lots') is not null then
    execute $sql$
      create policy "gold_lots_select_authorized"
        on public.gold_lots for select to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'inventory_manager', 'warehouse', 'omborchi',
            'accountant', 'buxgalter', 'hisobchi',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
          )
        );
      create policy "gold_lots_admin_manage"
        on public.gold_lots for all to authenticated
        using (
          public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
        )
        with check (
          public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
        );
    $sql$;
  end if;

  if to_regclass('public.batch_operations') is not null then
    execute $sql$
      create policy "authenticated read batch_operations"
        on public.batch_operations for select to authenticated using (true);
      create policy "Authorized manufacturing roles can insert batch operations"
        on public.batch_operations for insert to authenticated
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'worker'
          )
        );
      create policy "Authorized manufacturing roles can update batch operations"
        on public.batch_operations for update to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'worker'
          )
        )
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'worker'
          )
        );
    $sql$;
  end if;

  if to_regclass('public.batch_status_history') is not null then
    execute $sql$
      create policy "authenticated read batch_status_history"
        on public.batch_status_history for select to authenticated using (true);
    $sql$;
  end if;

  if to_regclass('public.qc_inspections') is not null then
    execute $sql$
      create policy "authenticated read qc_inspections"
        on public.qc_inspections for select to authenticated using (true);
      create policy "QC and managers can insert inspections"
        on public.qc_inspections for insert to authenticated
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        );
      create policy "QC and managers can update inspections"
        on public.qc_inspections for update to authenticated
        using (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        )
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        );
    $sql$;
  end if;

  if to_regclass('public.qc_inspection_results') is not null then
    execute $sql$
      create policy "authenticated read qc_inspection_results"
        on public.qc_inspection_results for select to authenticated using (true);
      create policy "QC and managers can insert inspection results"
        on public.qc_inspection_results for insert to authenticated
        with check (
          public.current_employee_role_text() in (
            'admin', 'director', 'owner', 'direktor', 'rahbar',
            'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
            'quality_inspector', 'quality_control'
          )
        );
    $sql$;
  end if;

  if to_regclass('public.audit_log') is not null then
    execute $sql$
      create policy "Only admins and managers can read audit log"
        on public.audit_log for select to authenticated
        using (public.is_admin_or_manager());
    $sql$;
  end if;
end $$;

-- 5.5 PRODUCTS & BOM ITEMS:
-- Model creation and stock mutations occur via rpc_create_product_with_bom, rpc_move_partial_wip,
-- and rpc_record_sale_with_stock_deduction. Direct client table writes are restricted to admin/director.
create policy "Authenticated users can read products and bom"
  on public.products for select to authenticated using (true);

create policy "products_admin_manage"
  on public.products for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Authenticated users can read bom items"
  on public.bom_items for select to authenticated using (true);

create policy "bom_items_admin_manage"
  on public.bom_items for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.6 SALES, DEBT REPAYMENTS & SALARY LEDGER:
-- Product sales ('kirim'), order advances, and debt repayments run through SECURITY DEFINER RPCs.
-- Direct client INSERT on public.sales is allowed ONLY for cash expenses ('chiqim' with 0 weight/debt, null product_id, positive amount) or admin/director.
create policy "Sales and managers can read sales"
  on public.sales for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "sales_insert_expense_or_admin"
  on public.sales for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
    or (
      public.current_employee_role_text() in (
        'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
        'sales', 'accountant', 'buxgalter', 'hisobchi'
      )
      and tx_type = 'chiqim'
      and product_id is null
      and coalesce(weight, 0) = 0
      and coalesce(debt_amount, 0) = 0
      and coalesce(total_amount, 0) > 0
    )
  );

create policy "sales_admin_manage"
  on public.sales for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Sales and managers can read debt repayments"
  on public.debt_repayments for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "debt_repayments_admin_insert"
  on public.debt_repayments for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

create policy "Admins and accountants can read salary ledger"
  on public.salary_ledger for select to authenticated
  using (
    public.is_admin_or_manager()
    or public.current_employee_role_text() in ('accountant', 'buxgalter', 'hisobchi')
    or employee_id::text = auth.uid()::text
    or employee_id::text = public.current_employee_id_text()
  );

create policy "salary_ledger_admin_insert"
  on public.salary_ledger for insert to authenticated
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- 5.7 QUALITY CONTROL, SETTINGS & AUDIT LOGS:
create policy "Authenticated users can read quality control"
  on public.quality_control for select to authenticated using (true);

create policy "QC and managers can insert quality control"
  on public.quality_control for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'quality_inspector', 'quality_control'
    )
  );

create policy "Authenticated users can read system settings"
  on public.system_settings for select to authenticated using (true);

create policy "Admins and managers can manage system settings"
  on public.system_settings for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "Authenticated users can read stage loss configs"
  on public.stage_loss_configs for select to authenticated using (true);

create policy "Admins and managers can manage stage loss configs"
  on public.stage_loss_configs for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

create policy "Only admins and managers can read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin_or_manager());

-- Enforce authoritative actor_id and actor_role on direct client audit_logs inserts (prevents spoofing)
create or replace function public.enforce_audit_logs_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- When pg_trigger_depth() = 1, the insert came directly from a client query rather than record_audit_event()
  if pg_trigger_depth() <= 1 and auth.uid() is not null then
    new.actor_id   := auth.uid();
    new.actor_role := coalesce(public.current_employee_role_text(), 'viewer');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_audit_logs_actor on public.audit_logs;
create trigger trg_enforce_audit_logs_actor
  before insert on public.audit_logs
  for each row execute function public.enforce_audit_logs_actor();

create policy "Authenticated users can append audit logs"
  on public.audit_logs for insert to authenticated
  with check (
    auth.uid() is not null
    and (actor_id is null or actor_id = auth.uid())
    and public.current_employee_role_text() is not null
  );

-- 6. Immutability Protection: Prevent DELETE (and unauthorized UPDATE) on audit & financial ledgers
create or replace function public.prevent_ledger_delete_or_tamper()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Deleting records from immutable ledger table "%" is strictly prohibited', tg_table_name
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and tg_table_name in (
    'audit_log', 'audit_logs', 'gold_transactions', 'inventory_transactions',
    'debt_repayments', 'salary_ledger', 'affinaj_records'
  ) then
    raise exception 'Modifying existing records in immutable ledger table "%" is strictly prohibited', tg_table_name
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_immutable_audit_logs on public.audit_logs;
create trigger trg_immutable_audit_logs
  before update or delete on public.audit_logs
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_gold_transactions on public.gold_transactions;
create trigger trg_immutable_gold_transactions
  before update or delete on public.gold_transactions
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_debt_repayments on public.debt_repayments;
create trigger trg_immutable_debt_repayments
  before update or delete on public.debt_repayments
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_salary_ledger on public.salary_ledger;
create trigger trg_immutable_salary_ledger
  before update or delete on public.salary_ledger
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_affinaj_records on public.affinaj_records;
create trigger trg_immutable_affinaj_records
  before update or delete on public.affinaj_records
  for each row execute function public.prevent_ledger_delete_or_tamper();

do $$
begin
  if to_regclass('public.audit_log') is not null then
    execute 'drop trigger if exists trg_immutable_audit_log on public.audit_log';
    execute 'create trigger trg_immutable_audit_log before update or delete on public.audit_log for each row execute function public.prevent_ledger_delete_or_tamper()';
  end if;

  if to_regclass('public.inventory_transactions') is not null then
    execute 'drop trigger if exists trg_immutable_inventory_transactions on public.inventory_transactions';
    execute 'create trigger trg_immutable_inventory_transactions before update or delete on public.inventory_transactions for each row execute function public.prevent_ledger_delete_or_tamper()';
  end if;
end $$;

-- 7. Least-Privilege Function EXECUTE Hardening
--    Revoke PUBLIC, anon, and broad authenticated EXECUTE on all public functions,
--    then explicitly grant EXECUTE to authenticated ONLY on safe helpers and
--    RBAC-protected ERP RPCs.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant execute on function public.try_cast_uuid(text) to authenticated;
grant execute on function public.calc_fine_gold_exact(numeric, numeric) to authenticated;
grant execute on function public.calculate_melting_loss(numeric, numeric) to authenticated;
grant execute on function public.normalize_erp_role_token(text) to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_employee_id_text() to authenticated;
grant execute on function public.current_employee_role_text() to authenticated;
grant execute on function public.current_employee_role() to authenticated;
grant execute on function public.is_admin_or_manager() to authenticated;
grant execute on function public.assert_erp_permission(text[]) to authenticated;
grant execute on function public.check_and_lock_idempotency(text, text, jsonb) to authenticated;
grant execute on function public.save_idempotency_response(text, text, jsonb, jsonb) to authenticated;

grant execute on function public.rpc_inventory_transaction(text, text, numeric, numeric, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.rpc_execute_alloy_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, numeric, text, numeric, text) to authenticated;
grant execute on function public.rpc_execute_affinaj_transaction(text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_create_batch_with_gold_issue(text, text, text, text, numeric, integer, numeric, numeric, text, date, text) to authenticated;
grant execute on function public.rpc_launch_order_production_chain(text, text, text, text, text, text, numeric, integer, numeric, numeric, text, date, text) to authenticated;
grant execute on function public.rpc_move_partial_wip(text, integer, integer, text, text, integer, numeric, numeric, integer, numeric, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.rpc_split_batch(text, integer, text, integer, text) to authenticated;
grant execute on function public.rpc_record_stage_consumption(text, text, text, numeric, numeric, numeric, numeric, numeric, text, boolean, text) to authenticated;
grant execute on function public.rpc_return_sprue_to_scrap_inventory(text, text, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.rpc_record_sale_with_stock_deduction(text, text, text, integer, numeric, numeric, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_record_debt_repayment(text, text, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.rpc_record_salary_transaction(text, text, text, text, text, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_create_product_with_bom(text, text, numeric, integer, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, text) to authenticated;
grant execute on function public.rpc_create_order_with_advance(text, text, text, text, text, numeric, integer, numeric, numeric, numeric, date, text, text, text) to authenticated;
