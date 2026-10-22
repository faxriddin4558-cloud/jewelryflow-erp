-- ============================================================================
-- Migration: 20260101000036_security_hardening_seller_isolation_and_factory_permissions.sql
-- Purpose:   Fix F01 & F02:
--            1. Authoritative Role Normalization: 'seller', 'sales', 'sotuvchi', 'savdo'
--               normalize to 'seller' (NOT 'accountant'!).
--            2. Prevent unauthorized factory mutations by sellers:
--               Strict RLS & RPC guards on factory_receipts, factory_gold_handovers,
--               manager_vault_account, refining_batches, gold_purchases.
--            3. Strict Seller Scope & RLS Data Isolation:
--               Sellers can ONLY read/write their own consignments, pieces, sales,
--               settlements, and gold accounts.
-- ============================================================================

-- -------------------------------------------------------------------------
-- 1. Correct Role Normalization Function
-- -------------------------------------------------------------------------
create or replace function public.normalize_erp_role_token(p_token text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_clean text := lower(btrim(coalesce(p_token, '')));
begin
  if v_clean = '' then
    return null;
  end if;

  case v_clean
    when 'admin', 'director', 'owner', 'direktor', 'rahbar' then
      return 'admin';
    when 'production_manager', 'production manager', 'manager', 'ishlab chiqarish boshlig''i', 'boshqaruvchi' then
      return 'production_manager';
    when 'department_head', 'supervisor', 'master', 'bosh usta', 'usta' then
      return 'supervisor';
    when 'quality_inspector', 'quality_control', 'qc', 'otk' then
      return 'quality_inspector';
    when 'inventory_manager', 'warehouse', 'omborchi' then
      return 'inventory_manager';
    when 'accountant', 'buxgalter', 'hisobchi' then
      return 'accountant';
    when 'seller', 'sales', 'sotuvchi', 'savdo', 'seller_agent' then
      return 'seller';
    when 'department_operator', 'worker', 'zargar', 'operator' then
      return 'worker';
    when 'viewer' then
      return 'viewer';
    else
      return null;
  end case;
end;
$$;

-- -------------------------------------------------------------------------
-- 2. Authoritative Employee Role Resolution
-- -------------------------------------------------------------------------
create or replace function public.current_employee_role_text()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_emp       public.employees%rowtype;
  v_role_type text;
  v_role_col  text;
  v_pos_role  text;
begin
  if v_uid is null then
    return null;
  end if;

  select *
    into v_emp
    from public.employees e
   where (e.user_id = v_uid or e.id::text = v_uid::text)
     and coalesce(e.is_active, true) = true
     and lower(coalesce(e.status, e.employment_status::text, 'active')) in ('active', 'faol')
   limit 1;

  if not found then
    return 'viewer';
  end if;

  v_role_type := public.normalize_erp_role_token(v_emp.role_type);
  v_role_col  := public.normalize_erp_role_token(v_emp.role::text);
  v_pos_role  := public.normalize_erp_role_token(v_emp.position);

  -- Explicit role precedence rule:
  -- 1. Specific non-generic role_type (Director, Manager, Accountant, Seller, Warehouse, Supervisor)
  --    takes precedence over legacy/default role column ('worker'/'viewer'/'department_operator').
  -- 2. Specific non-generic role column takes next precedence.
  -- 3. Validated generic role_type / role column / position fallback.
  -- 4. Unknown or malformed role values fail closed to 'viewer'.
  if v_role_type is not null and v_role_type not in ('worker', 'viewer') then
    return v_role_type;
  elsif v_role_col is not null and v_role_col not in ('worker', 'viewer') then
    return v_role_col;
  elsif v_role_type is not null then
    return v_role_type;
  elsif v_role_col is not null then
    return v_role_col;
  elsif v_pos_role is not null then
    return v_pos_role;
  else
    return 'viewer';
  end if;
end;
$$;

-- -------------------------------------------------------------------------
-- 3. Hardened RLS: Factory Receipts (F01 fix)
-- -------------------------------------------------------------------------
drop policy if exists "factory_receipts_all_policy" on public.factory_receipts;
drop policy if exists "factory_receipts_select_policy" on public.factory_receipts;
drop policy if exists "factory_receipts_modify_policy" on public.factory_receipts;

create policy "factory_receipts_select_policy"
  on public.factory_receipts for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

create policy "factory_receipts_modify_policy"
  on public.factory_receipts for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

-- -------------------------------------------------------------------------
-- 4. Hardened RLS: Factory Gold Handovers
-- -------------------------------------------------------------------------
drop policy if exists "factory_gold_handovers_all_policy" on public.factory_gold_handovers;
drop policy if exists "factory_gold_handovers_select_policy" on public.factory_gold_handovers;
drop policy if exists "factory_gold_handovers_modify_policy" on public.factory_gold_handovers;

create policy "factory_gold_handovers_select_policy"
  on public.factory_gold_handovers for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

create policy "factory_gold_handovers_modify_policy"
  on public.factory_gold_handovers for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

-- -------------------------------------------------------------------------
-- 5. Hardened RLS: Manager Vault Account
-- -------------------------------------------------------------------------
drop policy if exists "manager_vault_account_all_policy" on public.manager_vault_account;
drop policy if exists "manager_vault_account_select_policy" on public.manager_vault_account;
drop policy if exists "manager_vault_account_modify_policy" on public.manager_vault_account;

create policy "manager_vault_account_select_policy"
  on public.manager_vault_account for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

create policy "manager_vault_account_modify_policy"
  on public.manager_vault_account for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

-- -------------------------------------------------------------------------
-- 6. Hardened RLS: Refining Batches & Gold Purchases
-- -------------------------------------------------------------------------
drop policy if exists "refining_batches_all_policy" on public.refining_batches;
drop policy if exists "refining_batches_select_policy" on public.refining_batches;
drop policy if exists "refining_batches_modify_policy" on public.refining_batches;

create policy "refining_batches_select_policy"
  on public.refining_batches for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

create policy "refining_batches_modify_policy"
  on public.refining_batches for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

drop policy if exists "gold_purchases_all_policy" on public.gold_purchases;
drop policy if exists "gold_purchases_select_policy" on public.gold_purchases;
drop policy if exists "gold_purchases_modify_policy" on public.gold_purchases;

create policy "gold_purchases_select_policy"
  on public.gold_purchases for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

create policy "gold_purchases_modify_policy"
  on public.gold_purchases for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() in (
      'admin', 'director', 'owner', 'direktor', 'rahbar',
      'production_manager', 'manager', 'boshqaruvchi',
      'accountant', 'buxgalter'
    )
  );

-- -------------------------------------------------------------------------
-- 7. Hardened RLS: Strict Seller Data Isolation (F02 fix)
-- -------------------------------------------------------------------------

-- 7.1 Consignment Pieces (JF-PIECE items)
drop policy if exists "consignment_pieces_select_policy" on public.consignment_pieces;
create policy "consignment_pieces_select_policy"
  on public.consignment_pieces for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'production_manager', 'manager', 'boshqaruvchi',
        'accountant', 'buxgalter', 'inventory_manager', 'warehouse'
      )
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- 7.2 Seller Consignments
drop policy if exists "seller_consignments_select_policy" on public.seller_consignments;
create policy "seller_consignments_select_policy"
  on public.seller_consignments for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'production_manager', 'manager', 'boshqaruvchi',
        'accountant', 'buxgalter'
      )
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- 7.3 Seller Gold Accounts (Balances & Till)
drop policy if exists "seller_gold_accounts_select_policy" on public.seller_gold_accounts;
create policy "seller_gold_accounts_select_policy"
  on public.seller_gold_accounts for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'production_manager', 'manager', 'boshqaruvchi',
        'accountant', 'buxgalter'
      )
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- 7.4 Jewelry Sales (Sales Records)
drop policy if exists "jewelry_sales_select_policy" on public.jewelry_sales;
create policy "jewelry_sales_select_policy"
  on public.jewelry_sales for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'production_manager', 'manager', 'boshqaruvchi',
        'accountant', 'buxgalter'
      )
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- 7.5 Gold Settlements (Client / Seller Repayments)
drop policy if exists "gold_settlements_select_policy" on public.gold_settlements;
create policy "gold_settlements_select_policy"
  on public.gold_settlements for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and (
      public.current_employee_role_text() in (
        'admin', 'director', 'owner', 'direktor', 'rahbar',
        'production_manager', 'manager', 'boshqaruvchi',
        'accountant', 'buxgalter'
      )
      or seller_id = auth.uid()
      or seller_id in (select id from public.employees where user_id = auth.uid())
    )
  );

-- -------------------------------------------------------------------------
-- 8. Hardened RPC Security: Guard Privileged RPCs from Seller Execution
-- -------------------------------------------------------------------------

-- 8.1 rpc_record_factory_receipt
create or replace function public.rpc_record_factory_receipt(
  p_product_name       text,
  p_quantity           integer default 1,
  p_original_physical_g numeric default 0,
  p_proba              numeric default 585,
  p_factory_markup_pct numeric default 8.0,
  p_product_id         uuid default null,
  p_model_id           uuid default null,
  p_notes              text default null,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id        uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_receipt_no    text;
  v_receipt_id    uuid;
  v_phys_g        numeric(14, 4);
  v_f_pct         numeric(6, 2);
  v_f_due_g       numeric(14, 4);
  v_vault         public.manager_vault_account;
  v_existing      jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Fail closed: Explicitly reject sellers, workers, viewers
  if v_caller_role in ('seller', 'worker', 'viewer') or v_caller_role is null then
    raise exception 'Ruxsat etilmadi: Sotuvchi yoki begona foydalanuvchi zavod tovar kirimini saqlay olmaydi (Rol: %)', v_caller_role
      using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter']);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'receipt_id', id,
      'receipt_no', receipt_no,
      'factory_obligation_g', factory_obligation_g
    ) into v_existing
    from public.factory_receipts
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_g := round(coalesce(p_original_physical_g, 0)::numeric, 4);
  v_f_pct := round(greatest(0, coalesce(p_factory_markup_pct, 0))::numeric, 2);

  if v_phys_g <= 0 then
    raise exception 'Invalid physical weight: must be greater than 0';
  end if;

  -- Formula: factory_obligation_g = original_physical_g * (1 + factory_markup_pct / 100)
  v_f_due_g := round(v_phys_g * (1.0 + (v_f_pct / 100.0)), 4);
  v_receipt_no := 'ZVD-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.factory_receipts (
    organization_id,
    receipt_no,
    product_id,
    model_id,
    product_name,
    proba,
    quantity,
    original_physical_g,
    factory_markup_pct,
    factory_obligation_g,
    transferred_physical_g,
    available_physical_g,
    status,
    notes,
    idempotency_key
  ) values (
    v_org_id,
    v_receipt_no,
    p_product_id,
    p_model_id,
    coalesce(nullif(btrim(p_product_name), ''), 'Zargarlik buyumi'),
    coalesce(p_proba, 585),
    greatest(1, coalesce(p_quantity, 1)),
    v_phys_g,
    v_f_pct,
    v_f_due_g,
    0,
    v_phys_g,
    'in_manager_stock',
    p_notes,
    p_idempotency_key
  ) returning id into v_receipt_id;

  -- Update manager vault factory obligation
  perform public._get_or_create_manager_vault(v_org_id);

  update public.manager_vault_account
  set total_factory_received_g = round(total_factory_received_g + v_phys_g, 4),
      total_factory_obligation_g = round(total_factory_obligation_g + v_f_due_g, 4),
      current_factory_obligation_g = round(greatest(0, (total_factory_obligation_g + v_f_due_g) - total_factory_handed_over_g), 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  return jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'original_physical_g', v_phys_g,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'manager_current_factory_obligation_g', v_vault.current_factory_obligation_g
  );
end;
$$;

-- 8.2 rpc_record_factory_gold_handover
create or replace function public.rpc_record_factory_gold_handover(
  p_gross_weight_grams numeric,
  p_proba              numeric,
  p_equivalent_585_grams numeric default null,
  p_handover_date      date default current_date,
  p_notes              text default null,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id        uuid := public.current_organization_id();
  v_caller_role   text := public.current_employee_role_text();
  v_handover_no   text;
  v_handover_id   uuid;
  v_gross_g       numeric(14, 4);
  v_p             numeric(6, 2);
  v_eq_g          numeric(14, 4);
  v_vault         public.manager_vault_account;
  v_existing      jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'worker', 'viewer') or v_caller_role is null then
    raise exception 'Ruxsat etilmadi: Sotuvchi zavodga oltin topshirish operatsiyasini bajara olmaydi (Rol: %)', v_caller_role
      using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter']);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'handover_id', id,
      'handover_no', handover_no,
      'equivalent_585_grams', equivalent_585_grams
    ) into v_existing
    from public.factory_gold_handovers
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_gross_g := round(coalesce(p_gross_weight_grams, 0)::numeric, 4);
  v_p := round(coalesce(p_proba, 585)::numeric, 2);

  if v_gross_g <= 0 then
    raise exception 'Invalid handover weight: must be greater than 0';
  end if;

  -- 585 equivalent calculation: (gross * proba) / 585
  if p_equivalent_585_grams is not null and p_equivalent_585_grams > 0 then
    v_eq_g := round(p_equivalent_585_grams::numeric, 4);
  else
    v_eq_g := round((v_gross_g * v_p) / 585.0, 4);
  end if;

  v_handover_no := 'HND-' || to_char(coalesce(p_handover_date, current_date), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.factory_gold_handovers (
    organization_id,
    handover_no,
    handover_date,
    gross_weight_grams,
    proba,
    equivalent_585_grams,
    notes,
    idempotency_key
  ) values (
    v_org_id,
    v_handover_no,
    coalesce(p_handover_date, current_date),
    v_gross_g,
    v_p,
    v_eq_g,
    p_notes,
    p_idempotency_key
  ) returning id into v_handover_id;

  -- Reduce factory obligation in manager vault
  perform public._get_or_create_manager_vault(v_org_id);

  update public.manager_vault_account
  set total_factory_handed_over_g = round(total_factory_handed_over_g + v_eq_g, 4),
      current_factory_obligation_g = round(greatest(0, total_factory_obligation_g - (total_factory_handed_over_g + v_eq_g)), 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  return jsonb_build_object(
    'status', 'ok',
    'handover_id', v_handover_id,
    'handover_no', v_handover_no,
    'gross_weight_grams', v_gross_g,
    'proba', v_p,
    'equivalent_585_grams', v_eq_g,
    'remaining_factory_obligation_g', v_vault.current_factory_obligation_g
  );
end;
$$;

-- 8.3 rpc_record_manager_seller_settlement
create or replace function public.rpc_record_manager_seller_settlement(
  p_seller_id          uuid,
  p_physical_scrap_grams numeric default 0,
  p_scrap_proba        numeric default 585,
  p_cash_amount        numeric default 0,
  p_currency           text default 'UZS',
  p_rate_per_gram      numeric default null,
  p_notes              text default null,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id             uuid := public.current_organization_id();
  v_caller_role        text := public.current_employee_role_text();
  v_settlement_no      text;
  v_settlement_id      uuid;
  v_scrap_g            numeric(14, 4);
  v_p                  numeric(6, 2);
  v_scrap_585_eq       numeric(14, 4);
  v_cash               numeric(18, 2);
  v_rate               numeric(18, 2);
  v_cash_585_eq        numeric(14, 4);
  v_total_deducted_g   numeric(14, 4);
  v_seller_acc         public.seller_gold_accounts;
  v_vault              public.manager_vault_account;
  v_existing           jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'worker', 'viewer') or v_caller_role is null then
    raise exception 'Ruxsat etilmadi: Sotuvchi o''zining tushumini tasdiqlay olmaydi (Rol: %)', v_caller_role
      using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter']);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'settlement_id', id,
      'settlement_no', settlement_no,
      'total_deducted_585_eq_grams', total_deducted_585_eq_grams
    ) into v_existing
    from public.manager_seller_settlements
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_scrap_g := round(greatest(0, coalesce(p_physical_scrap_grams, 0))::numeric, 4);
  v_p := round(coalesce(p_scrap_proba, 585)::numeric, 2);
  v_cash := round(greatest(0, coalesce(p_cash_amount, 0))::numeric, 2);

  if v_scrap_g = 0 and v_cash = 0 then
    raise exception 'Invalid settlement: must provide at least scrap gold or cash';
  end if;

  v_scrap_585_eq := round((v_scrap_g * v_p) / 585.0, 4);

  if v_cash > 0 then
    if p_rate_per_gram is not null and p_rate_per_gram > 0 then
      v_rate := round(p_rate_per_gram::numeric, 2);
    else
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_org_id and proba = 585
      order by rate_date desc limit 1;

      if v_rate is null or v_rate <= 0 then
        raise exception 'Cannot convert cash: No active 585 daily gold rate found';
      end if;
    end if;
    v_cash_585_eq := round(v_cash / v_rate, 4);
  else
    v_rate := 0;
    v_cash_585_eq := 0;
  end if;

  v_total_deducted_g := round(v_scrap_585_eq + v_cash_585_eq, 4);
  v_settlement_no := 'STL-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.manager_seller_settlements (
    organization_id,
    settlement_no,
    seller_id,
    physical_scrap_grams,
    scrap_proba,
    scrap_585_equiv_grams,
    cash_amount,
    currency,
    rate_per_gram,
    cash_585_equiv_grams,
    total_deducted_585_eq_grams,
    notes,
    idempotency_key
  ) values (
    v_org_id,
    v_settlement_no,
    p_seller_id,
    v_scrap_g,
    v_p,
    v_scrap_585_eq,
    v_cash,
    coalesce(p_currency, 'UZS'),
    v_rate,
    v_cash_585_eq,
    v_total_deducted_g,
    p_notes,
    p_idempotency_key
  ) returning id into v_settlement_id;

  -- Update seller gold account
  update public.seller_gold_accounts
  set total_settled_to_manager_g = round(total_settled_to_manager_g + v_total_deducted_g, 4),
      seller_till_scrap_grams = round(greatest(0, seller_till_scrap_grams - v_scrap_g), 4),
      seller_till_cash_amount = round(greatest(0, seller_till_cash_amount - v_cash), 2),
      seller_owes_manager_g = round(greatest(0, seller_owes_manager_g - v_total_deducted_g), 4),
      current_factory_obligation_grams = round(greatest(0, current_factory_obligation_grams - v_total_deducted_g), 4),
      bozor_qarzi_signed_g = round(bozor_qarzi_signed_g + v_total_deducted_g, 4),
      updated_at = now()
  where seller_id = p_seller_id and organization_id = v_org_id
  returning * into v_seller_acc;

  -- Update manager vault
  perform public._get_or_create_manager_vault(v_org_id);

  update public.manager_vault_account
  set total_received_from_sellers_g = round(total_received_from_sellers_g + v_total_deducted_g, 4),
      vault_scrap_gold_g = round(vault_scrap_gold_g + v_scrap_585_eq, 4),
      vault_cash_amount = round(vault_cash_amount + v_cash, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  return jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settlement_id,
    'settlement_no', v_settlement_no,
    'total_deducted_585_eq_grams', v_total_deducted_g,
    'seller_remaining_obligation_g', v_seller_acc.seller_owes_manager_g,
    'seller_bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g
  );
end;
$$;
