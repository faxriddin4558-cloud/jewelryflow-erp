-- ============================================================================
-- Migration: 20260101000017_security_rls_and_privilege_hardening.sql
-- Purpose:   Phase 9 Security Hardening (Hybrid bigint/uuid Schema Compatible):
--            1. Prevent employee self-promotion to admin (RLS + Trigger)
--            2. Enable RLS on all operational & legacy tables (incl. orfers/payroll)
--            3. Remove permissive PUBLIC/anon policies and enforce role-based RLS
--            4. Protect audit logs and financial ledgers from DELETE/tampering
--            5. Harden SECURITY DEFINER search_path & revoke PUBLIC/anon EXECUTE
-- ============================================================================

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

-- 2. Fix Employees Self-Promotion Vulnerability (RLS + BEFORE UPDATE Trigger)
-- Uses (user_id = auth.uid() or id::text = auth.uid()::text) so bigint employee IDs never fail against UUID auth.uid()
drop policy if exists "self update own profile" on public.employees;
drop policy if exists "Employees can update own profile" on public.employees;
drop policy if exists "Employees can update own safe profile fields" on public.employees;

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
    and rate is not distinct from (select e.rate from public.employees e where e.id = employees.id)
    and balance is not distinct from (select e.balance from public.employees e where e.id = employees.id)
  );

create or replace function public.prevent_employee_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_in_salary_rpc boolean := (coalesce(current_setting('app.in_salary_rpc', true), 'false') = 'true');
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
       or (new.balance is distinct from old.balance and not v_in_salary_rpc)
    then
      raise exception 'Privilege escalation blocked: only admin or manager may modify role, status, rate, or balance'
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

-- 3. Enable RLS on all core, operational, and legacy tables
alter table public.employees              enable row level security;
alter table public.orders                 enable row level security;
alter table public.batches                enable row level security;
alter table public.inventory_items        enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.gold_lots              enable row level security;
alter table public.gold_transactions      enable row level security;
alter table public.batch_operations       enable row level security;
alter table public.batch_status_history   enable row level security;
alter table public.qc_inspections         enable row level security;
alter table public.qc_inspection_results  enable row level security;
alter table public.audit_log              enable row level security;
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
begin
  if to_regclass('public.orfers') is not null then
    execute 'alter table public.orfers enable row level security';
    execute 'drop policy if exists "Admins and managers can access legacy orfers" on public.orfers';
    execute 'create policy "Admins and managers can access legacy orfers" on public.orfers for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager())';
  end if;
  if to_regclass('public.payroll') is not null then
    execute 'alter table public.payroll enable row level security';
    execute 'drop policy if exists "Admins and managers can access legacy payroll" on public.payroll';
    execute 'create policy "Admins and managers can access legacy payroll" on public.payroll for all to authenticated using (public.is_admin_or_manager()) with check (public.is_admin_or_manager())';
  end if;
end $$;

-- 4. Ensure authenticated SELECT policies exist on core tables (self-contained even if 014 was skipped)
drop policy if exists "authenticated read employees" on public.employees;
create policy "authenticated read employees"
  on public.employees for select to authenticated using (true);

drop policy if exists "authenticated read orders" on public.orders;
create policy "authenticated read orders"
  on public.orders for select to authenticated using (true);

drop policy if exists "authenticated read batches" on public.batches;
create policy "authenticated read batches"
  on public.batches for select to authenticated using (true);

drop policy if exists "authenticated read inventory_items" on public.inventory_items;
create policy "authenticated read inventory_items"
  on public.inventory_items for select to authenticated using (true);

drop policy if exists "authenticated read inventory_transactions" on public.inventory_transactions;
create policy "authenticated read inventory_transactions"
  on public.inventory_transactions for select to authenticated using (true);

drop policy if exists "authenticated read gold_lots" on public.gold_lots;
create policy "authenticated read gold_lots"
  on public.gold_lots for select to authenticated using (true);

drop policy if exists "authenticated read gold_transactions" on public.gold_transactions;
create policy "authenticated read gold_transactions"
  on public.gold_transactions for select to authenticated using (true);

drop policy if exists "authenticated read batch_operations" on public.batch_operations;
create policy "authenticated read batch_operations"
  on public.batch_operations for select to authenticated using (true);

drop policy if exists "authenticated read batch_status_history" on public.batch_status_history;
create policy "authenticated read batch_status_history"
  on public.batch_status_history for select to authenticated using (true);

drop policy if exists "authenticated read qc_inspections" on public.qc_inspections;
create policy "authenticated read qc_inspections"
  on public.qc_inspections for select to authenticated using (true);

drop policy if exists "authenticated read qc_inspection_results" on public.qc_inspection_results;
create policy "authenticated read qc_inspection_results"
  on public.qc_inspection_results for select to authenticated using (true);

-- 5. Tighten write policies (using text-safe role resolution)
drop policy if exists "admin manage employees" on public.employees;
create policy "admin manage employees"
  on public.employees for all to authenticated
  using (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

drop policy if exists "sales write orders" on public.orders;
create policy "sales write orders"
  on public.orders for all to authenticated
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

drop policy if exists "managers write batches" on public.batches;
create policy "managers write batches"
  on public.batches for all to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

drop policy if exists "inventory write inventory_items" on public.inventory_items;
create policy "inventory write inventory_items"
  on public.inventory_items for all to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  );

drop policy if exists "inventory write inventory_transactions" on public.inventory_transactions;
drop policy if exists "Authenticated users can record inventory transactions" on public.inventory_transactions;
drop policy if exists "Authorized roles can record inventory transactions" on public.inventory_transactions;
create policy "Authorized roles can record inventory transactions"
  on public.inventory_transactions for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  );

drop policy if exists "inventory write gold_transactions" on public.gold_transactions;
drop policy if exists "Authenticated users can record gold transactions" on public.gold_transactions;
drop policy if exists "Authorized roles can record gold transactions" on public.gold_transactions;
create policy "Authorized roles can record gold transactions"
  on public.gold_transactions for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi', 'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

drop policy if exists "Workers and managers can insert batch operations" on public.batch_operations;
drop policy if exists "Authorized manufacturing roles can insert batch operations" on public.batch_operations;
create policy "Authorized manufacturing roles can insert batch operations"
  on public.batch_operations for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'worker'
    )
  );

drop policy if exists "Workers and managers can update batch operations" on public.batch_operations;
drop policy if exists "Authorized manufacturing roles can update batch operations" on public.batch_operations;
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

drop policy if exists "qc write qc_inspections" on public.qc_inspections;
drop policy if exists "QC and managers can insert inspections" on public.qc_inspections;
create policy "QC and managers can insert inspections"
  on public.qc_inspections for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'quality_inspector', 'quality_control'
    )
  );

drop policy if exists "QC and managers can update inspections" on public.qc_inspections;
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

drop policy if exists "qc write qc_inspection_results" on public.qc_inspection_results;
drop policy if exists "QC and managers can insert inspection results" on public.qc_inspection_results;
create policy "QC and managers can insert inspection results"
  on public.qc_inspection_results for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'quality_inspector', 'quality_control'
    )
  );

-- 6. Role-based RLS policies for operational ERP tables
drop policy if exists "Authenticated users can read own idempotency keys" on public.idempotency_keys;
create policy "Authenticated users can read own idempotency keys"
  on public.idempotency_keys for select to authenticated
  using (actor_id = auth.uid() or public.is_admin_or_manager());

drop policy if exists "Authenticated users can read affinaj records" on public.affinaj_records;
create policy "Authenticated users can read affinaj records"
  on public.affinaj_records for select to authenticated using (true);
drop policy if exists "Inventory and managers can insert affinaj records" on public.affinaj_records;
create policy "Inventory and managers can insert affinaj records"
  on public.affinaj_records for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  );

drop policy if exists "Authenticated users can read production stages" on public.production_stages;
create policy "Authenticated users can read production stages"
  on public.production_stages for select to authenticated using (true);
drop policy if exists "Admins and managers can manage production stages" on public.production_stages;
create policy "Admins and managers can manage production stages"
  on public.production_stages for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

drop policy if exists "Authenticated users can read batch stage wip" on public.batch_stage_wip;
create policy "Authenticated users can read batch stage wip"
  on public.batch_stage_wip for select to authenticated using (true);
drop policy if exists "Manufacturing roles can modify batch stage wip" on public.batch_stage_wip;
create policy "Manufacturing roles can modify batch stage wip"
  on public.batch_stage_wip for all to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator'
    )
  );

drop policy if exists "Authenticated users can read consumption" on public.consumption;
create policy "Authenticated users can read consumption"
  on public.consumption for select to authenticated using (true);
drop policy if exists "Manufacturing roles can insert consumption" on public.consumption;
create policy "Manufacturing roles can insert consumption"
  on public.consumption for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta', 'department_operator', 'inventory_manager', 'warehouse'
    )
  );

drop policy if exists "Authenticated users can read machines" on public.machines;
create policy "Authenticated users can read machines"
  on public.machines for select to authenticated using (true);
drop policy if exists "Admins and managers can manage machines" on public.machines;
create policy "Admins and managers can manage machines"
  on public.machines for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

drop policy if exists "Authenticated users can read products and bom" on public.products;
create policy "Authenticated users can read products and bom"
  on public.products for select to authenticated using (true);
drop policy if exists "Inventory and managers can manage products" on public.products;
create policy "Inventory and managers can manage products"
  on public.products for all to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  );

drop policy if exists "Authenticated users can read bom items" on public.bom_items;
create policy "Authenticated users can read bom items"
  on public.bom_items for select to authenticated using (true);
drop policy if exists "Inventory and managers can manage bom items" on public.bom_items;
create policy "Inventory and managers can manage bom items"
  on public.bom_items for all to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  );

drop policy if exists "Sales and managers can read sales" on public.sales;
create policy "Sales and managers can read sales"
  on public.sales for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );
drop policy if exists "Sales and managers can insert sales" on public.sales;
create policy "Sales and managers can insert sales"
  on public.sales for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

drop policy if exists "Sales and managers can read debt repayments" on public.debt_repayments;
create policy "Sales and managers can read debt repayments"
  on public.debt_repayments for select to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );
drop policy if exists "Sales and managers can insert debt repayments" on public.debt_repayments;
create policy "Sales and managers can insert debt repayments"
  on public.debt_repayments for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

drop policy if exists "Admins and managers can read salary ledger" on public.salary_ledger;
create policy "Admins and managers can read salary ledger"
  on public.salary_ledger for select to authenticated
  using (
    public.is_admin_or_manager()
    or public.current_employee_role_text() in ('accountant', 'buxgalter', 'hisobchi', 'sales')
    or employee_id::text = auth.uid()::text
    or employee_id::text = public.current_employee_id_text()
  );
drop policy if exists "Admins and managers can insert salary ledger" on public.salary_ledger;
create policy "Admins and managers can insert salary ledger"
  on public.salary_ledger for insert to authenticated
  with check (
    public.is_admin_or_manager()
    or public.current_employee_role_text() in ('accountant', 'buxgalter', 'hisobchi', 'sales')
  );

drop policy if exists "Authenticated users can read inventory reservations" on public.inventory_reservations;
create policy "Authenticated users can read inventory reservations"
  on public.inventory_reservations for select to authenticated using (true);
drop policy if exists "Inventory and managers can manage reservations" on public.inventory_reservations;
create policy "Inventory and managers can manage reservations"
  on public.inventory_reservations for all to authenticated
  using (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  )
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi'
    )
  );

drop policy if exists "Authenticated users can read quality control" on public.quality_control;
create policy "Authenticated users can read quality control"
  on public.quality_control for select to authenticated using (true);
drop policy if exists "QC and managers can insert quality control" on public.quality_control;
create policy "QC and managers can insert quality control"
  on public.quality_control for insert to authenticated
  with check (
    public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'quality_inspector', 'quality_control'
    )
  );

drop policy if exists "Authenticated users can read system settings" on public.system_settings;
create policy "Authenticated users can read system settings"
  on public.system_settings for select to authenticated using (true);
drop policy if exists "Admins and managers can manage system settings" on public.system_settings;
create policy "Admins and managers can manage system settings"
  on public.system_settings for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

drop policy if exists "Authenticated users can read stage loss configs" on public.stage_loss_configs;
create policy "Authenticated users can read stage loss configs"
  on public.stage_loss_configs for select to authenticated using (true);
drop policy if exists "Admins and managers can manage stage loss configs" on public.stage_loss_configs;
create policy "Admins and managers can manage stage loss configs"
  on public.stage_loss_configs for all to authenticated
  using (public.is_admin_or_manager()) with check (public.is_admin_or_manager());

drop policy if exists "Only admins and managers can read audit log" on public.audit_log;
create policy "Only admins and managers can read audit log"
  on public.audit_log for select to authenticated
  using (public.is_admin_or_manager());

drop policy if exists "Only admins and managers can read audit logs" on public.audit_logs;
create policy "Only admins and managers can read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin_or_manager());
drop policy if exists "Authenticated users can append audit logs" on public.audit_logs;
create policy "Authenticated users can append audit logs"
  on public.audit_logs for insert to authenticated
  with check (true);

-- 7. Immutability Protection: Prevent DELETE (and unauthorized UPDATE) on audit & financial ledgers
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

drop trigger if exists trg_immutable_audit_log on public.audit_log;
create trigger trg_immutable_audit_log
  before update or delete on public.audit_log
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_audit_logs on public.audit_logs;
create trigger trg_immutable_audit_logs
  before update or delete on public.audit_logs
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_gold_transactions on public.gold_transactions;
create trigger trg_immutable_gold_transactions
  before update or delete on public.gold_transactions
  for each row execute function public.prevent_ledger_delete_or_tamper();

drop trigger if exists trg_immutable_inventory_transactions on public.inventory_transactions;
create trigger trg_immutable_inventory_transactions
  before update or delete on public.inventory_transactions
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

-- 8. Revoke PUBLIC and anon EXECUTE privileges on all public functions
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
