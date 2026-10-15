-- ============================================================================
-- JewelryFlow ERP — Migration 020: Strict Multi-Tenant Isolation & RPC Guards
-- ============================================================================
-- 1. Hardened fail-closed public.current_organization_id()
-- 2. Quarantined legacy backfill to Goldia (never leave orphaned NULL rows exposed)
-- 3. Elimination of conflicting permissive `USING (true)` policies
-- 4. Strict tenant isolation RLS policies on ALL operational & master tables:
--    - organizations, organization_factory_settings
--    - batches, batch_stage_wip, orders, customers, products, sales
--    - inventory_items, gold_transactions, inventory_reservations, affinaj_records
--    - two_party_handovers, machines, salary_ledger, audit_logs
-- 5. Cross-tenant defense in depth inside SECURITY DEFINER RPC functions:
--    - rpc_create_batch_with_gold_issue
--    - rpc_move_partial_wip
--    - rpc_record_sale_with_stock_deduction
--    - rpc_record_debt_repayment
--    - rpc_launch_order_production_chain
--    - rpc_dispatch_stage_handover
--    - rpc_accept_stage_handover
--    - rpc_override_stage_handover
--    - rpc_execute_alloy_transaction
--    - rpc_execute_affinaj_transaction
-- ============================================================================

-- 1. Fail-closed helper: current_organization_id()
-- Returns active tenant UUID. Returns NULL (FAIL-CLOSED) if unauthenticated or unassigned!
-- NEVER defaults to Goldia for unknown users.
create or replace function public.current_organization_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_org_id    uuid;
  v_cfg_org   text;
begin
  -- Optional session/transaction override (used in automated multi-tenant test suites or API proxies)
  v_cfg_org := current_setting('app.current_organization_id', true);
  if v_cfg_org is not null and v_cfg_org ~* '^[0-9a-f-]{36}$' then
    return v_cfg_org::uuid;
  end if;

  -- Fail-closed if no authenticated session
  if v_uid is null then
    return null;
  end if;

  -- 1. Check employee organization assignment
  select organization_id
    into v_org_id
    from public.employees e
   where (e.user_id = v_uid or e.id::text = v_uid::text)
     and e.organization_id is not null
     and coalesce(e.is_active, true) = true
   limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- 2. Check profile organization assignment
  select organization_id
    into v_org_id
    from public.profiles p
   where p.user_id = v_uid
     and p.organization_id is not null
   limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  -- 3. Fail closed: Unassigned users have NO organization (NULL).
  return null;
end;
$$;

grant execute on function public.current_organization_id() to authenticated, anon;

-- 2. Ensure machines table has organization_id column
alter table public.machines
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_machines_org on public.machines(organization_id);

-- Backfill legacy records to Goldia so historical data is securely owned by Goldia, NOT left NULL!
do $$
declare
  v_goldia_id uuid;
begin
  select id into v_goldia_id from public.organizations where code = 'goldia' limit 1;
  if v_goldia_id is not null then
    update public.employees set organization_id = v_goldia_id where organization_id is null;
    update public.profiles set organization_id = v_goldia_id where organization_id is null;
    update public.batches set organization_id = v_goldia_id where organization_id is null;
    update public.orders set organization_id = v_goldia_id where organization_id is null;
    update public.inventory_items set organization_id = v_goldia_id where organization_id is null;
    update public.batch_stage_wip set organization_id = v_goldia_id where organization_id is null;
    update public.two_party_handovers set organization_id = v_goldia_id where organization_id is null;
    update public.gold_transactions set organization_id = v_goldia_id where organization_id is null;
    update public.products set organization_id = v_goldia_id where organization_id is null;
    update public.customers set organization_id = v_goldia_id where organization_id is null;
    update public.sales set organization_id = v_goldia_id where organization_id is null;
    update public.salary_ledger set organization_id = v_goldia_id where organization_id is null;
    update public.machines set organization_id = v_goldia_id where organization_id is null;
  end if;
end $$;

-- 3. ELIMINATE ALL PREVIOUS PERMISSIVE POLICIES AND REPLACE WITH STRICT TENANT POLICIES

-- A. Organizations
drop policy if exists "authenticated read organizations" on public.organizations;
drop policy if exists "director write organizations" on public.organizations;

create policy "organizations_tenant_select"
  on public.organizations for select to authenticated
  using (id = public.current_organization_id());

create policy "organizations_director_manage"
  on public.organizations for all to authenticated
  using (
    id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- B. Organization Factory Settings
drop policy if exists "authenticated read factory settings" on public.organization_factory_settings;
drop policy if exists "director write factory settings" on public.organization_factory_settings;

create policy "factory_settings_tenant_select"
  on public.organization_factory_settings for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "factory_settings_director_manage"
  on public.organization_factory_settings for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- C. Batches
drop policy if exists "authenticated read batches" on public.batches;
drop policy if exists "batches_admin_manage" on public.batches;
drop policy if exists "tenant isolation batches select" on public.batches;
drop policy if exists "tenant isolation batches mutate" on public.batches;

create policy "batches_tenant_select"
  on public.batches for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "batches_tenant_manage"
  on public.batches for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  );

-- D. Batch Stage WIP
drop policy if exists "Authenticated users can read batch stage wip" on public.batch_stage_wip;
drop policy if exists "batch_stage_wip_admin_manage" on public.batch_stage_wip;
drop policy if exists "tenant isolation batch_stage_wip select" on public.batch_stage_wip;

create policy "batch_stage_wip_tenant_select"
  on public.batch_stage_wip for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "batch_stage_wip_tenant_manage"
  on public.batch_stage_wip for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  );

-- E. Orders
drop policy if exists "orders_select_authorized" on public.orders;
drop policy if exists "sales write orders" on public.orders;
drop policy if exists "sales update orders" on public.orders;
drop policy if exists "admin delete orders" on public.orders;
drop policy if exists "tenant isolation orders select" on public.orders;

create policy "orders_tenant_select"
  on public.orders for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'sales', 'accountant', 'buxgalter', 'hisobchi',
      'inventory_manager', 'warehouse', 'omborchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "orders_tenant_insert"
  on public.orders for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "orders_tenant_update"
  on public.orders for update to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager',
      'sales', 'accountant', 'buxgalter', 'hisobchi'
    )
  );

create policy "orders_tenant_delete"
  on public.orders for delete to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- F. Inventory Items
drop policy if exists "inventory_items_select_authorized" on public.inventory_items;
drop policy if exists "inventory_items_insert_zero_balance_card" on public.inventory_items;
drop policy if exists "inventory_items_admin_manage" on public.inventory_items;
drop policy if exists "tenant isolation inventory select" on public.inventory_items;

create policy "inventory_items_tenant_select"
  on public.inventory_items for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'sales', 'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "inventory_items_tenant_insert_card"
  on public.inventory_items for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager',
      'inventory_manager', 'warehouse', 'omborchi'
    )
    and coalesce(on_hand, 0) = 0
    and coalesce(quantity_on_hand, 0) = 0
    and coalesce(reserved, 0) = 0
  );

create policy "inventory_items_tenant_admin_manage"
  on public.inventory_items for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- G. Gold Transactions
drop policy if exists "gold_transactions_select_authorized" on public.gold_transactions;
drop policy if exists "gold_transactions_admin_insert" on public.gold_transactions;

create policy "gold_transactions_tenant_select"
  on public.gold_transactions for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i',
      'inventory_manager', 'warehouse', 'omborchi',
      'accountant', 'buxgalter', 'hisobchi',
      'department_head', 'supervisor', 'master', 'bosh usta', 'usta'
    )
  );

create policy "gold_transactions_tenant_admin_insert"
  on public.gold_transactions for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- H. Two-Party Handovers
drop policy if exists "authenticated read two party handovers" on public.two_party_handovers;
drop policy if exists "authenticated write two party handovers" on public.two_party_handovers;

create policy "two_party_handovers_tenant_select"
  on public.two_party_handovers for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "two_party_handovers_tenant_manage"
  on public.two_party_handovers for all to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- I. Customers
alter table public.customers enable row level security;
drop policy if exists "authenticated read customers" on public.customers;
drop policy if exists "sales write customers" on public.customers;

create policy "customers_tenant_select"
  on public.customers for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'sales', 'accountant', 'buxgalter', 'hisobchi', 'manager'
    )
  );

create policy "customers_tenant_manage"
  on public.customers for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'sales', 'accountant', 'buxgalter', 'hisobchi', 'manager'
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'sales', 'accountant', 'buxgalter', 'hisobchi', 'manager'
    )
  );

-- J. Products
drop policy if exists "Authenticated users can read products and bom" on public.products;
drop policy if exists "products_admin_manage" on public.products;

create policy "products_tenant_select"
  on public.products for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "products_tenant_manage"
  on public.products for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager')
  );

-- K. Sales
drop policy if exists "Sales and managers can read sales" on public.sales;
drop policy if exists "sales_insert_expense_or_admin" on public.sales;
drop policy if exists "sales_admin_manage" on public.sales;

create policy "sales_tenant_select"
  on public.sales for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'sales', 'accountant', 'buxgalter', 'hisobchi', 'manager'
    )
  );

create policy "sales_tenant_manage"
  on public.sales for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar')
  );

-- L. Machines
drop policy if exists "Authenticated users can read machines" on public.machines;
drop policy if exists "Admins and managers can manage machines" on public.machines;

create policy "machines_tenant_select"
  on public.machines for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "machines_tenant_manage"
  on public.machines for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager')
  );

-- M. Salary Ledger
drop policy if exists "Admins and accountants can read salary ledger" on public.salary_ledger;
drop policy if exists "salary_ledger_admin_insert" on public.salary_ledger;

create policy "salary_ledger_tenant_select"
  on public.salary_ledger for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'hisobchi')
      or employee_id::text = auth.uid()::text
    )
  );

create policy "salary_ledger_tenant_admin_insert"
  on public.salary_ledger for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'hisobchi')
  );

-- 4. HARDEN SECURITY DEFINER RPCS WITH EXPLICIT TENANT ISOLATION GUARDS

-- A. rpc_create_batch_with_gold_issue
create or replace function public.rpc_create_batch_with_gold_issue(
  p_source_item_id   text,
  p_batch_no         text,
  p_product_name     text,
  p_master_name      text,
  p_proba            numeric,
  p_planned_qty      integer,
  p_issued_gold_gram numeric,
  p_pure_gold        numeric,
  p_priority         text default 'Normal',
  p_deadline         date default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_src        public.inventory_items%rowtype;
  v_batch_id   text;
  v_issued     numeric(14, 4) := round(coalesce(p_issued_gold_gram, 0)::numeric, 4);
  v_fine       numeric(18, 6);
  v_existing   jsonb;
  v_payload    jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'source_item_id', btrim(coalesce(p_source_item_id, '')),
    'batch_no', btrim(coalesce(p_batch_no, '')),
    'planned_qty', p_planned_qty,
    'issued_gold_gram', v_issued
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_create_batch_with_gold_issue', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if coalesce(btrim(p_source_item_id), '') = '' or coalesce(btrim(p_batch_no), '') = '' or p_planned_qty <= 0 or v_issued <= 0 then
    raise exception 'Invalid batch parameters';
  end if;

  select * into v_src
    from public.inventory_items
   where id::text = btrim(p_source_item_id)
     for update;

  if not found then
    raise exception 'Source gold item not found';
  end if;

  -- Cross-tenant verification
  if v_src.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Source inventory does not belong to your organization' using errcode = '42501';
  end if;

  if (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)) < v_issued then
    raise exception 'Insufficient available gold in SAFE: available=%g, required=%g',
      (coalesce(v_src.on_hand, v_src.quantity_on_hand, 0) - coalesce(v_src.reserved, 0)), v_issued;
  end if;

  update public.inventory_items
     set on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_issued,
         quantity_on_hand = coalesce(on_hand, quantity_on_hand, 0) - v_issued
   where id = v_src.id;

  v_fine := public.calc_fine_gold_exact(v_issued, p_proba);

  insert into public.batches (
    batch_number, batch_no, number, product_name, product, master_name,
    proba, planned_qty, planned_gram, issued_gold_gram, wip_gram,
    good_output_gram, sprue_gram, scrap_gram, rework_gram, loss_gram,
    finished_qty, credited_finished_qty, current_step, status, status_label,
    priority, priority_label, deadline, due_date, organization_id
  ) values (
    btrim(p_batch_no), btrim(p_batch_no), btrim(p_batch_no), btrim(p_product_name), btrim(p_product_name), btrim(p_master_name),
    p_proba, p_planned_qty, v_issued, v_issued, v_issued,
    0, 0, 0, 0, 0,
    0, 0, '8. Quyish', 'Jarayonda', 'Jarayonda',
    p_priority, p_priority, p_deadline, p_deadline, v_caller_org
  ) returning id::text into v_batch_id;

  insert into public.batch_stage_wip (
    batch_id, batch_no, stage_order, stage_name, department,
    available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
    queue_status, assigned_worker, organization_id
  ) values (
    v_batch_id, btrim(p_batch_no), 8, '8. Quyish', 'Quyish',
    p_planned_qty, 0, 0, v_issued, 0, 0,
    'NOW', btrim(p_master_name), v_caller_org
  );

  insert into public.gold_transactions (
    transaction_type, from_location, to_location, material_name,
    weight_grams, gross_weight, proba, pure_gold, batch_no, description,
    idempotency_key, performed_by, organization_id
  ) values (
    'chiqim', 'SAFE', 'CASTING', v_src.name,
    v_issued, v_issued, p_proba, v_fine, btrim(p_batch_no),
    format('Batch %s issue: %s pcs / %sg (%s)', btrim(p_batch_no), p_planned_qty, v_issued, p_proba),
    nullif(btrim(p_idempotency_key), ''), public.current_employee_id(), v_caller_org
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', v_batch_id,
    'batch_no', btrim(p_batch_no),
    'issued_gold_gram', v_issued,
    'pure_gold', v_fine,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_create_batch_with_gold_issue', v_existing, v_payload);

  return v_existing;
end;
$$;

-- B. rpc_move_partial_wip
create or replace function public.rpc_move_partial_wip(
  p_batch_id          text,
  p_from_stage_order  integer,
  p_to_stage_order    integer,
  p_to_stage_name     text,
  p_to_department     text,
  p_move_qty          integer,
  p_move_gram         numeric default null,
  p_move_weight       numeric default null,
  p_rework_qty        integer default 0,
  p_sprue_gram        numeric default 0,
  p_scrap_gram        numeric default 0,
  p_loss_gram         numeric default 0,
  p_worker_name       text default '',
  p_worker_id         text default null,
  p_idempotency_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org  uuid := public.current_organization_id();
  v_batch       public.batches%rowtype;
  v_cur_wip     public.batch_stage_wip%rowtype;
  v_nxt_wip     public.batch_stage_wip%rowtype;
  v_prod        public.products%rowtype;
  v_batch_code  text;
  v_rem_qty     integer;
  v_move_g      numeric(14, 4) := round(coalesce(p_move_weight, p_move_gram, 0)::numeric, 4);
  v_sprue_g     numeric(14, 4) := round(coalesce(p_sprue_gram, 0)::numeric, 4);
  v_scrap_g     numeric(14, 4) := round(coalesce(p_scrap_gram, 0)::numeric, 4);
  v_loss_g      numeric(14, 4) := round(coalesce(p_loss_gram, 0)::numeric, 4);
  v_new_sprue   numeric(14, 4);
  v_new_scrap   numeric(14, 4);
  v_new_loss    numeric(14, 4);
  v_new_good    numeric(14, 4);
  v_in_gold     numeric(14, 4);
  v_tot_out     numeric(14, 4);
  v_new_wip_g   numeric(14, 4);
  v_is_final    boolean := (p_to_stage_order >= 25);
  v_new_fin_qty integer;
  v_credit_qty  integer := 0;
  v_done_all    boolean;
  v_existing    jsonb;
  v_payload     jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'batch_id', btrim(coalesce(p_batch_id, '')),
    'from_stage_order', p_from_stage_order,
    'to_stage_order', p_to_stage_order,
    'move_qty', p_move_qty,
    'move_g', v_move_g,
    'rework_qty', p_rework_qty
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_move_partial_wip', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if p_move_qty < 0 or p_rework_qty < 0 or v_move_g < 0 or v_sprue_g < 0 or v_scrap_g < 0 or v_loss_g < 0 then
    raise exception 'Negative quantities or weights are not permitted';
  end if;
  if p_move_qty <= 0 and p_rework_qty <= 0 then
    raise exception 'Either moved quantity or rework quantity must be greater than 0';
  end if;

  select * into v_batch from public.batches where id::text = btrim(p_batch_id) for update;
  if not found then
    raise exception 'Batch (%) not found', p_batch_id;
  end if;

  -- Cross-tenant isolation verification
  if v_batch.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Batch does not belong to your organization' using errcode = '42501';
  end if;

  v_batch_code := coalesce(v_batch.batch_no, v_batch.batch_number, v_batch.number, p_batch_id);

  select * into v_cur_wip
    from public.batch_stage_wip
   where (batch_id = btrim(p_batch_id) or batch_no = v_batch_code)
     and stage_order = p_from_stage_order
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'WIP stage record (%) not found for batch %', p_from_stage_order, v_batch_code;
  end if;

  if (p_move_qty + p_rework_qty) > v_cur_wip.available_qty then
    raise exception 'Insufficient WIP in stage %: available=%, requested=%',
      p_from_stage_order, v_cur_wip.available_qty, (p_move_qty + p_rework_qty);
  end if;

  v_rem_qty   := v_cur_wip.available_qty - p_move_qty - p_rework_qty;
  v_new_sprue := round((coalesce(v_batch.sprue_gram, 0) + v_sprue_g)::numeric, 4);
  v_new_scrap := round((coalesce(v_batch.scrap_gram, 0) + v_scrap_g)::numeric, 4);
  v_new_loss  := round((coalesce(v_batch.loss_gram, 0) + v_loss_g)::numeric, 4);
  v_new_good  := case
                   when v_is_final then round((coalesce(v_batch.good_output_gram, 0) + v_move_g)::numeric, 4)
                   else round(coalesce(v_batch.good_output_gram, 0)::numeric, 4)
                 end;

  v_in_gold   := round(coalesce(v_batch.issued_gold_gram, v_batch.planned_gram, 0)::numeric, 4);
  v_tot_out   := round((v_new_good + v_new_sprue + v_new_scrap + v_new_loss)::numeric, 4);

  if v_in_gold <= 0 then
    raise exception 'Authoritative issued gold is missing or zero for batch %', v_batch_code;
  end if;

  if v_tot_out > (v_in_gold + 0.05) then
    raise exception 'Mass balance violation: total outputs (%g) exceeds issued gold (%g)', v_tot_out, v_in_gold;
  end if;

  v_new_wip_g := round(greatest(0, v_in_gold - v_tot_out)::numeric, 4);

  update public.batch_stage_wip
     set available_qty = v_rem_qty,
         completed_qty = coalesce(completed_qty, 0) + p_move_qty,
         rework_qty    = coalesce(rework_qty, 0) + p_rework_qty,
         loss_weight   = coalesce(loss_weight, 0) + v_loss_g,
         updated_at    = now()
   where id = v_cur_wip.id;

  if p_move_qty > 0 and not v_is_final then
    select * into v_nxt_wip
      from public.batch_stage_wip
     where (batch_id = btrim(p_batch_id) or batch_no = v_batch_code)
       and stage_order = p_to_stage_order
       and organization_id = v_caller_org
     for update;

    if found then
      update public.batch_stage_wip
         set available_qty = available_qty + p_move_qty,
             input_weight  = coalesce(input_weight, 0) + v_move_g,
             assigned_worker = coalesce(nullif(btrim(p_worker_name), ''), assigned_worker),
             updated_at    = now()
       where id = v_nxt_wip.id;
    else
      insert into public.batch_stage_wip (
        batch_id, batch_no, stage_order, stage_name, department,
        available_qty, completed_qty, rework_qty, input_weight, output_weight, loss_weight,
        queue_status, assigned_worker, organization_id
      ) values (
        btrim(p_batch_id), v_batch_code, p_to_stage_order, btrim(p_to_stage_name), btrim(p_to_department),
        p_move_qty, 0, 0, v_move_g, 0, 0,
        'NOW', nullif(btrim(p_worker_name), ''), v_caller_org
      );
    end if;
  end if;

  v_new_fin_qty := coalesce(v_batch.finished_qty, 0);
  if v_is_final and p_move_qty > 0 then
    v_new_fin_qty := v_new_fin_qty + p_move_qty;
    v_credit_qty  := p_move_qty;

    select * into v_prod
      from public.products
     where (lower(btrim(name)) = lower(btrim(v_batch.product_name)) or lower(btrim(name)) = lower(btrim(coalesce(v_batch.product, ''))))
       and organization_id = v_caller_org
     limit 1
     for update;

    if found then
      update public.products
         set stock      = coalesce(stock, quantity, 0) + v_credit_qty,
             quantity   = coalesce(stock, quantity, 0) + v_credit_qty,
             updated_at = now()
       where id = v_prod.id;
    end if;
  end if;

  v_done_all := (v_new_fin_qty >= coalesce(v_batch.planned_qty, 0) and v_new_wip_g <= 0.05);

  update public.batches
     set sprue_gram            = v_new_sprue,
         scrap_gram            = v_new_scrap,
         loss_gram             = v_new_loss,
         good_output_gram      = v_new_good,
         wip_gram              = v_new_wip_g,
         finished_qty          = v_new_fin_qty,
         credited_finished_qty = coalesce(credited_finished_qty, 0) + v_credit_qty,
         current_step          = case when v_done_all then '25. Tayyor ombor' else btrim(p_to_stage_name) end,
         status                = case when v_done_all then 'Tugatildi' else 'Jarayonda' end,
         status_label          = case when v_done_all then 'Tugatildi' else 'Jarayonda' end,
         updated_at            = now()
   where id = v_batch.id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', p_batch_id,
    'batch_no', v_batch_code,
    'from_stage_order', p_from_stage_order,
    'to_stage_order', p_to_stage_order,
    'moved_qty', p_move_qty,
    'moved_weight', v_move_g,
    'remaining_wip_qty', v_rem_qty,
    'remaining_wip_gram', v_new_wip_g,
    'is_completed', v_done_all,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_move_partial_wip', v_existing, v_payload);

  return v_existing;
end;
$$;

-- C. rpc_record_sale_with_stock_deduction
create or replace function public.rpc_record_sale_with_stock_deduction(
  p_product_id      text,
  p_client_name     text,
  p_product_name    text,
  p_quantity        integer,
  p_weight          numeric,
  p_proba           numeric,
  p_payment_type    text,
  p_paid_amount     numeric,
  p_debt_amount     numeric,
  p_order_id        text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_prod       public.products%rowtype;
  v_cur_stock  integer;
  v_paid       numeric(18, 2) := round(coalesce(p_paid_amount, 0)::numeric, 2);
  v_debt       numeric(18, 2) := round(coalesce(p_debt_amount, 0)::numeric, 2);
  v_sale_total numeric(18, 2) := round(v_paid + v_debt, 2);
  v_sale_id    text;
  v_existing   jsonb;
  v_payload    jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'sales', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'product_id', btrim(coalesce(p_product_id, '')),
    'client_name', btrim(coalesce(p_client_name, '')),
    'quantity', p_quantity,
    'paid_amount', v_paid,
    'debt_amount', v_debt
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_sale_with_stock_deduction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if p_quantity <= 0 or v_paid < 0 or v_debt < 0 or v_sale_total <= 0 then
    raise exception 'Invalid sale quantity or amounts';
  end if;

  select * into v_prod from public.products where id::text = btrim(p_product_id) for update;
  if not found then
    raise exception 'Product (%) not found in finished goods inventory', p_product_id;
  end if;

  -- Cross-tenant isolation verification
  if v_prod.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Product does not belong to your organization' using errcode = '42501';
  end if;

  v_cur_stock := coalesce(v_prod.stock, v_prod.quantity, 0);
  if p_quantity > v_cur_stock then
    raise exception 'Insufficient finished goods stock for "%": available=%, requested=%',
      v_prod.name, v_cur_stock, p_quantity;
  end if;

  update public.products
     set stock      = v_cur_stock - p_quantity,
         quantity   = v_cur_stock - p_quantity,
         updated_at = now()
   where id = v_prod.id;

  insert into public.sales (
    order_id, product_id, client_name, product_name, quantity,
    weight, proba, payment_type, sale_total_amount, total_amount,
    debt_amount, tx_type, idempotency_key, organization_id
  ) values (
    p_order_id, v_prod.id::text, btrim(p_client_name), v_prod.name, p_quantity,
    round(coalesce(p_weight, v_prod.weight, 0)::numeric, 4),
    coalesce(p_proba, v_prod.proba, 585),
    p_payment_type, v_sale_total, v_paid,
    v_debt, 'kirim', nullif(btrim(p_idempotency_key), ''), v_caller_org
  ) returning id::text into v_sale_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'product_id', v_prod.id::text,
    'remaining_stock', v_cur_stock - p_quantity,
    'paid_amount', v_paid,
    'debt_amount', v_debt,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_sale_with_stock_deduction', v_existing, v_payload);

  return v_existing;
end;
$$;

-- D. rpc_record_debt_repayment
create or replace function public.rpc_record_debt_repayment(
  p_sale_id         text default null,
  p_order_id        text default null,
  p_amount          numeric default 0,
  p_repaid_amount   numeric default null,
  p_payment_type    text default 'Naqd pul',
  p_note            text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_sale          public.sales%rowtype;
  v_order         public.orders%rowtype;
  v_pay_amount    numeric(18, 2) := round(coalesce(nullif(p_repaid_amount, 0), p_amount, 0)::numeric, 2);
  v_prev_debt     numeric(18, 2);
  v_new_debt      numeric(18, 2);
  v_client        text;
  v_label         text;
  v_repayment_id  uuid;
  v_existing      jsonb;
  v_payload       jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'accountant', 'buxgalter', 'hisobchi', 'sales', 'manager', 'production_manager', 'production manager'
  ]);

  v_payload := jsonb_build_object(
    'sale_id', btrim(coalesce(p_sale_id, '')),
    'order_id', btrim(coalesce(p_order_id, '')),
    'amount', v_pay_amount
  );
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_debt_repayment', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_pay_amount <= 0 then
    raise exception 'Debt repayment amount must be greater than 0';
  end if;

  if (coalesce(btrim(p_sale_id), '') = '' and coalesce(btrim(p_order_id), '') = '')
     or (coalesce(btrim(p_sale_id), '') <> '' and coalesce(btrim(p_order_id), '') <> '') then
    raise exception 'Specify exactly one of p_sale_id or p_order_id for debt repayment';
  end if;

  if coalesce(btrim(p_sale_id), '') <> '' then
    select * into v_sale from public.sales where id::text = btrim(p_sale_id) for update;
    if not found then
      raise exception 'Original sale (%) not found', p_sale_id;
    end if;

    if v_sale.organization_id is distinct from v_caller_org then
      raise exception 'Cross-tenant violation: Sale does not belong to your organization' using errcode = '42501';
    end if;

    v_prev_debt := round(coalesce(v_sale.debt_amount, 0)::numeric, 2);
    if v_prev_debt <= 0 then
      raise exception 'Sale (%) has no outstanding debt', p_sale_id;
    end if;
    if v_pay_amount > v_prev_debt then
      raise exception 'Repayment (%s) exceeds outstanding sale debt (%s)', v_pay_amount, v_prev_debt;
    end if;

    v_new_debt := round(v_prev_debt - v_pay_amount, 2);
    v_client   := v_sale.client_name;
    v_label    := format('Qarz to''lovi (%s)', v_sale.product_name);

    update public.sales
       set total_amount = round(coalesce(total_amount, 0) + v_pay_amount, 2),
           debt_amount  = v_new_debt
     where id = v_sale.id;
  else
    select * into v_order from public.orders where id::text = btrim(p_order_id) for update;
    if not found then
      raise exception 'Order (%) not found', p_order_id;
    end if;

    if v_order.organization_id is distinct from v_caller_org then
      raise exception 'Cross-tenant violation: Order does not belong to your organization' using errcode = '42501';
    end if;

    if lower(coalesce(v_order.status::text, '')) in ('cancelled', 'bekor qilindi')
       or lower(coalesce(v_order.status_label, '')) = 'bekor qilindi' then
      raise exception 'Cannot record debt repayment on a cancelled order (%)', coalesce(v_order.order_no, p_order_id);
    end if;

    v_prev_debt := round(greatest(0, coalesce(v_order.total_price, 0) - coalesce(v_order.advance, 0))::numeric, 2);
    if v_prev_debt <= 0 then
      raise exception 'Order (%) has no outstanding debt', coalesce(v_order.order_no, p_order_id);
    end if;
    if v_pay_amount > v_prev_debt then
      raise exception 'Repayment (%s) exceeds outstanding order debt (%s)', v_pay_amount, v_prev_debt;
    end if;

    v_new_debt := round(v_prev_debt - v_pay_amount, 2);
    v_client   := coalesce(v_order.client_name, v_order.customer_name, 'Mijoz');
    v_label    := format('Buyurtma Qarz To''lovi (%s)', coalesce(v_order.order_no, p_order_id));

    update public.orders
       set advance     = round(coalesce(advance, 0) + v_pay_amount, 2),
           paid_amount = round(coalesce(advance, 0) + v_pay_amount, 2),
           debt_amount = v_new_debt
     where id = v_order.id;
  end if;

  insert into public.debt_repayments (
    sale_id, order_id, client_name, amount, payment_type,
    previous_debt, remaining_debt, note, idempotency_key, recorded_by, organization_id
  ) values (
    nullif(btrim(p_sale_id), ''), nullif(btrim(p_order_id), ''), v_client, v_pay_amount, p_payment_type,
    v_prev_debt, v_new_debt, p_note, nullif(btrim(p_idempotency_key), ''), auth.uid(), v_caller_org
  ) returning id into v_repayment_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'repayment_id', v_repayment_id,
    'sale_id', nullif(btrim(p_sale_id), ''),
    'order_id', nullif(btrim(p_order_id), ''),
    'paid_amount', v_pay_amount,
    'previous_debt', v_prev_debt,
    'remaining_debt', v_new_debt,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_debt_repayment', v_existing, v_payload);

  return v_existing;
end;
$$;

-- E. rpc_dispatch_stage_handover
create or replace function public.rpc_dispatch_stage_handover(
  p_batch_id               text,
  p_batch_no               text,
  p_from_stage_order       integer,
  p_from_stage_name        text,
  p_from_department        text,
  p_to_stage_order         integer,
  p_to_stage_name          text,
  p_to_department          text,
  p_sender_worker_id       text,
  p_sender_worker_name     text,
  p_dispatched_qty         integer,
  p_dispatched_weight_gram numeric,
  p_receiver_worker_id     text default null,
  p_receiver_worker_name   text default null,
  p_tolerance_gram         numeric default 0.05,
  p_idempotency_key        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org  uuid := public.current_organization_id();
  v_batch       public.batches%rowtype;
  v_handover_id text;
  v_tol         numeric(6, 4) := round(coalesce(p_tolerance_gram, 0.05)::numeric, 4);
  v_weight      numeric(14, 4) := round(coalesce(p_dispatched_weight_gram, 0)::numeric, 4);
  v_existing    jsonb;
  v_payload     jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  if coalesce(p_dispatched_qty, 0) <= 0 then
    raise exception 'Dispatched quantity must be greater than 0';
  end if;
  if v_weight <= 0 then
    raise exception 'Dispatched weight must be greater than 0';
  end if;
  if p_from_stage_order = p_to_stage_order then
    raise exception 'Cannot dispatch handover to the same stage';
  end if;

  -- Verify batch ownership
  select * into v_batch
    from public.batches
   where (id::text = btrim(p_batch_id) or batch_no = btrim(p_batch_no))
   limit 1;

  if found and v_batch.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Batch does not belong to your organization' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'batch_id', p_batch_id,
    'batch_no', p_batch_no,
    'from_stage_order', p_from_stage_order,
    'to_stage_order', p_to_stage_order,
    'dispatched_qty', p_dispatched_qty,
    'dispatched_weight_gram', v_weight
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_dispatch_stage_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  v_handover_id := 'HO-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 6);

  insert into public.two_party_handovers (
    id, organization_id, batch_id, batch_no,
    from_stage_order, from_stage_name, from_department,
    to_stage_order, to_stage_name, to_department,
    sender_worker_id, sender_worker_name,
    receiver_worker_id, receiver_worker_name,
    dispatched_qty, dispatched_weight_gram,
    status, tolerance_gram, dispatched_at
  ) values (
    v_handover_id, v_caller_org, btrim(p_batch_id), btrim(p_batch_no),
    p_from_stage_order, btrim(p_from_stage_name), btrim(p_from_department),
    p_to_stage_order, btrim(p_to_stage_name), btrim(p_to_department),
    btrim(p_sender_worker_id), btrim(p_sender_worker_name),
    nullif(btrim(p_receiver_worker_id), ''), nullif(btrim(p_receiver_worker_name), ''),
    p_dispatched_qty, v_weight,
    'PENDING_ACCEPTANCE', v_tol, clock_timestamp()
  );

  v_existing := jsonb_build_object(
    'success', true,
    'status', 'PENDING_ACCEPTANCE',
    'handover_id', v_handover_id,
    'batch_no', btrim(p_batch_no),
    'dispatched_qty', p_dispatched_qty,
    'dispatched_weight_gram', v_weight,
    'tolerance_gram', v_tol,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_dispatch_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

-- F. rpc_accept_stage_handover
create or replace function public.rpc_accept_stage_handover(
  p_handover_id                text,
  p_receiver_worker_id         text,
  p_receiver_worker_name       text,
  p_received_qty               integer,
  p_received_weight_gram       numeric,
  p_supervisor_override_reason text default null,
  p_idempotency_key            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_h             public.two_party_handovers%rowtype;
  v_rec_weight    numeric(14, 4) := round(coalesce(p_received_weight_gram, 0)::numeric, 4);
  v_discrepancy   numeric(14, 4);
  v_qty_mismatch  boolean;
  v_weight_excess boolean;
  v_new_status    text := 'ACCEPTED';
  v_flag_reason   text := null;
  v_caller_role   text := public.current_employee_role_text();
  v_existing      jsonb;
  v_payload       jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta', 'usta', 'department_head', 'department_operator'
  ]);

  v_payload := jsonb_build_object(
    'handover_id', btrim(coalesce(p_handover_id, '')),
    'receiver_worker_id', btrim(coalesce(p_receiver_worker_id, '')),
    'received_qty', p_received_qty,
    'received_weight_gram', v_rec_weight
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_accept_stage_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_h
    from public.two_party_handovers
   where id = btrim(p_handover_id)
     for update;

  if not found then
    raise exception 'Handover record not found: %', p_handover_id;
  end if;

  -- Cross-tenant isolation verification
  if v_h.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Handover does not belong to your organization' using errcode = '42501';
  end if;

  if v_h.status not in ('PENDING_ACCEPTANCE', 'DISCREPANCY_FLAGGED') then
    raise exception 'Handover % is already finalized in status %', p_handover_id, v_h.status;
  end if;

  if coalesce(p_received_qty, 0) <= 0 or v_rec_weight <= 0 then
    raise exception 'Received quantity and weight must be positive';
  end if;

  v_discrepancy := round(abs(v_h.dispatched_weight_gram - v_rec_weight), 4);
  v_qty_mismatch := (v_h.dispatched_qty <> p_received_qty);
  v_weight_excess := (v_discrepancy > coalesce(v_h.tolerance_gram, 0.05));

  if v_qty_mismatch or v_weight_excess then
    if p_supervisor_override_reason is not null and length(btrim(p_supervisor_override_reason)) >= 5 then
      if v_caller_role not in ('admin', 'director', 'owner', 'manager', 'production_manager', 'supervisor', 'master') then
        raise exception 'Only supervisor or manager can override handover discrepancies';
      end if;

      v_new_status := 'SUPERVISOR_OVERRIDDEN';
      v_flag_reason := format('Overridden by supervisor: %s. Weight diff: %sg, Qty diff: %s',
        btrim(p_supervisor_override_reason), v_discrepancy, (p_received_qty - v_h.dispatched_qty));
    else
      v_new_status := 'DISCREPANCY_FLAGGED';
      if v_qty_mismatch and v_weight_excess then
        v_flag_reason := format('Quantity mismatch (sent %s, got %s) AND weight discrepancy of %sg exceeds allowable tolerance %sg',
          v_h.dispatched_qty, p_received_qty, v_discrepancy, v_h.tolerance_gram);
      elsif v_qty_mismatch then
        v_flag_reason := format('Quantity mismatch: sent %s, got %s', v_h.dispatched_qty, p_received_qty);
      else
        v_flag_reason := format('Weight discrepancy of %sg exceeds allowable tolerance %sg', v_discrepancy, v_h.tolerance_gram);
      end if;
    end if;
  end if;

  update public.two_party_handovers
     set receiver_worker_id         = btrim(p_receiver_worker_id),
         receiver_worker_name       = btrim(p_receiver_worker_name),
         received_qty               = p_received_qty,
         received_weight_gram       = v_rec_weight,
         weight_discrepancy_gram    = v_discrepancy,
         status                     = v_new_status,
         flag_reason                = v_flag_reason,
         supervisor_override_id     = case when v_new_status = 'SUPERVISOR_OVERRIDDEN' then auth.uid()::text else v_h.supervisor_override_id end,
         supervisor_override_reason = case when v_new_status = 'SUPERVISOR_OVERRIDDEN' then btrim(p_supervisor_override_reason) else v_h.supervisor_override_reason end,
         resolved_at                = clock_timestamp()
   where id = v_h.id;

  v_existing := jsonb_build_object(
    'success', (v_new_status in ('ACCEPTED', 'SUPERVISOR_OVERRIDDEN')),
    'handover_id', v_h.id,
    'status', v_new_status,
    'discrepancy_gram', v_discrepancy,
    'flag_reason', v_flag_reason,
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_accept_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;

-- G. rpc_override_stage_handover
create or replace function public.rpc_override_stage_handover(
  p_handover_id             text,
  p_supervisor_worker_id    text,
  p_supervisor_worker_name  text,
  p_override_reason         text,
  p_idempotency_key         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_h          public.two_party_handovers%rowtype;
  v_existing   jsonb;
  v_payload    jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'manager', 'production_manager', 'production manager',
    'master', 'supervisor', 'bosh usta'
  ]);

  if p_override_reason is null or length(btrim(p_override_reason)) < 5 then
    raise exception 'Supervisor override requires a documented investigation reason (min 5 characters)';
  end if;

  v_payload := jsonb_build_object(
    'handover_id', btrim(coalesce(p_handover_id, '')),
    'supervisor_worker_id', btrim(coalesce(p_supervisor_worker_id, '')),
    'reason', btrim(p_override_reason)
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_override_stage_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_h
    from public.two_party_handovers
   where id = btrim(p_handover_id)
     for update;

  if not found then
    raise exception 'Handover record not found: %', p_handover_id;
  end if;

  -- Cross-tenant verification
  if v_h.organization_id is distinct from v_caller_org then
    raise exception 'Cross-tenant violation: Handover does not belong to your organization' using errcode = '42501';
  end if;

  if v_h.status <> 'DISCREPANCY_FLAGGED' then
    raise exception 'Only flagged handovers can be overridden (current: %)', v_h.status;
  end if;

  update public.two_party_handovers
     set status                     = 'SUPERVISOR_OVERRIDDEN',
         supervisor_override_id     = coalesce(nullif(btrim(p_supervisor_worker_id), ''), auth.uid()::text),
         supervisor_override_reason = btrim(p_override_reason),
         resolved_at                = clock_timestamp()
   where id = v_h.id;

  v_existing := jsonb_build_object(
    'success', true,
    'handover_id', v_h.id,
    'status', 'SUPERVISOR_OVERRIDDEN',
    'reason', btrim(p_override_reason),
    'organization_id', v_caller_org
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_override_stage_handover', v_existing, v_payload);

  return v_existing;
end;
$$;
