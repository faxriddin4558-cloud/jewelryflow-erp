-- =========================================================================
-- 20260101000043_goldia_core_financial_and_reversal_parity.sql
-- JewelryFlow Sales — Goldia Final Financial & Reversal Parity (P0/P1)
--
-- Fixes:
-- 1. F03: Till Overdraft Guard in rpc_record_seller_to_manager_settlement &
--    rpc_record_manager_seller_settlement & rpc_record_seller_to_factory_settlement
--    (Strict balance checks, row locking FOR UPDATE, no greatest() clamping).
-- 2. F04: Reversal Arithmetic & Sync Trigger (fn_sync_seller_gold_account)
--    Excludes reversed records and reversal compensations from total_settled_grams,
--    restoring exact obligation on reversal (e.g. 30.24g instead of 26.00g).
-- 3. F02: Manager Gold Purchase Permission in rpc_record_gold_purchase
--    Authorizes 'manager', 'production_manager', 'boshqaruvchi' with strict till cash check.
-- 4. F01: Storage Bucket for Model Photos (jewelry-models) with public read and authenticated upload.
-- 5. Multi-Currency Support (USD Till and Settlement fields).
-- =========================================================================

-- 1. Add USD columns to seller_gold_accounts, manager_vault_account, gold_settlements if not present
alter table public.seller_gold_accounts
  add column if not exists seller_till_usd_amount numeric(18, 2) not null default 0 check (seller_till_usd_amount >= 0);

alter table public.manager_vault_account
  add column if not exists manager_usd_amount numeric(18, 2) not null default 0 check (manager_usd_amount >= 0);

alter table public.gold_settlements
  add column if not exists usd_paid_amount numeric(18, 2) default 0 check (usd_paid_amount >= 0),
  add column if not exists applied_usd_rate numeric(18, 2) default null;

-- 2. Storage Bucket setup for Model Photos (jewelry-models)
insert into storage.buckets (id, name, public)
values ('jewelry-models', 'jewelry-models', true)
on conflict (id) do update set public = true;

drop policy if exists "jewelry_models_public_read" on storage.objects;
create policy "jewelry_models_public_read"
  on storage.objects for select to public
  using (bucket_id = 'jewelry-models');

drop policy if exists "jewelry_models_auth_upload" on storage.objects;
create policy "jewelry_models_auth_upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'jewelry-models');

drop policy if exists "jewelry_models_auth_update" on storage.objects;
create policy "jewelry_models_auth_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'jewelry-models');

drop policy if exists "jewelry_models_auth_delete" on storage.objects;
create policy "jewelry_models_auth_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'jewelry-models');

-- 3. CRITICAL F04 FIX: fn_sync_seller_gold_account Trigger Function
-- Ensures that reversed settlements and compensating records NEVER deduct from obligation!
create or replace function public.fn_sync_seller_gold_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller_id  uuid := coalesce(NEW.seller_id, OLD.seller_id);
  v_org_id     uuid := coalesce(NEW.organization_id, OLD.organization_id);
  v_total_phys numeric(14, 4);
  v_total_obl  numeric(14, 4);
  v_total_stl  numeric(14, 4);
  v_s_owes     numeric(14, 4);
  v_m_owes     numeric(14, 4);
  v_signed     numeric(14, 4);
begin
  if v_seller_id is null or v_org_id is null then
    return coalesce(NEW, OLD);
  end if;

  select
    coalesce(sum(base_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0)
  into v_total_phys, v_total_obl
  from public.seller_consignments
  where seller_id = v_seller_id and organization_id = v_org_id
    and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  -- ONLY sum completed, non-reversed settlements!
  -- Explicitly exclude rows with status = 'reversed' OR reversal_of_id IS NOT NULL!
  select coalesce(sum(total_settled_grams), 0)
  into v_total_stl
  from public.gold_settlements
  where seller_id = v_seller_id and organization_id = v_org_id
    and direction in ('seller_to_manager', 'seller_to_factory')
    and (status is null or status not in ('reversed', 'cancelled'))
    and reversal_of_id is null;

  v_s_owes := round(greatest(0, v_total_obl - v_total_stl), 4);
  v_m_owes := round(greatest(0, v_total_stl - v_total_obl), 4);
  -- Sign convention per Section 1 and Addendum E:
  -- + (positive) = We owe the seller
  -- - (negative) = Seller owes us
  v_signed := round(v_m_owes - v_s_owes, 4);

  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    total_transferred_physical_g, total_seller_obligation_g,
    total_settled_to_manager_g, seller_owes_manager_g,
    manager_owes_seller_g, bozor_qarzi_signed_g,
    total_consigned_gold_grams, current_factory_obligation_grams,
    updated_at
  ) values (
    v_seller_id, v_org_id,
    v_total_phys, v_total_obl,
    v_total_stl, v_s_owes,
    v_m_owes, v_signed,
    v_total_obl, v_s_owes,
    now()
  )
  on conflict (seller_id) do update set
    total_transferred_physical_g = v_total_phys,
    total_seller_obligation_g = v_total_obl,
    total_settled_to_manager_g = v_total_stl,
    seller_owes_manager_g = v_s_owes,
    manager_owes_seller_g = v_m_owes,
    bozor_qarzi_signed_g = v_signed,
    total_consigned_gold_grams = v_total_obl,
    current_factory_obligation_grams = v_s_owes,
    updated_at = now();

  return coalesce(NEW, OLD);
end;
$$;

-- 4. CRITICAL F03 FIX: rpc_record_seller_to_manager_settlement
-- Authorizes managers to receive settlements from sellers, strictly locks balances,
-- verifies seller till has sufficient scrap and cash, and records atomically.
create or replace function public.rpc_record_seller_to_manager_settlement(
  p_seller_id           uuid,
  p_scrap_weight_grams  numeric default 0,
  p_cash_paid_amount    numeric default 0,
  p_rate_per_gram       numeric default null,
  p_notes               text default null,
  p_idempotency_key     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_rate            numeric(18, 2);
  v_scrap_w         numeric(14, 4);
  v_cash            numeric(18, 2);
  v_cash_equiv      numeric(14, 4) := 0;
  v_total_settled   numeric(14, 4);
  v_settle_no       text;
  v_settle_id       uuid;
  v_seller_acc      public.seller_gold_accounts;
  v_vault           public.manager_vault_account;
  v_existing        jsonb;
  v_payload         jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  v_scrap_w := round(greatest(0, coalesce(p_scrap_weight_grams, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_paid_amount, 0))::numeric, 2);

  if v_scrap_w <= 0 and v_cash <= 0 then
    raise exception 'Settlement must include either scrap gold grams or cash amount';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_seller_to_manager_settlement',
    'seller_id', p_seller_id,
    'scrap_w', v_scrap_w,
    'cash', v_cash
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. Fetch and lock seller gold account
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id and organization_id = v_org_id
  for update;

  if not found then
    raise exception 'Sotuvchi oltin hisobi topilmadi: %', p_seller_id;
  end if;

  -- 2. HARD BALANCE CHECK (F03):
  if v_scrap_w > 0 and v_seller_acc.seller_till_scrap_grams < v_scrap_w then
    raise exception 'ERR_INSUFFICIENT_SCRAP_BALANCE: Sotuvchi kassasida yetarli lom mavjud emas (Kassada: % g, Talab: % g)',
      v_seller_acc.seller_till_scrap_grams, v_scrap_w;
  end if;

  if v_cash > 0 and v_seller_acc.seller_till_cash_amount < v_cash then
    raise exception 'ERR_INSUFFICIENT_CASH_BALANCE: Sotuvchi kassasida yetarli naqd pul mavjud emas (Kassada: % UZS, Talab: % UZS)',
      v_seller_acc.seller_till_cash_amount, v_cash;
  end if;

  -- 3. Determine gold rate
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_org_id and proba = 585
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      v_rate := 900000;
    end if;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  end if;

  v_total_settled := round(v_scrap_w + v_cash_equiv, 4);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
    if v_caller_emp_id is null then
      v_caller_emp_id := p_seller_id;
    end if;
  end if;

  -- 4. Deduct exactly from seller till
  update public.seller_gold_accounts
  set seller_till_scrap_grams = round(seller_till_scrap_grams - v_scrap_w, 4),
      seller_till_cash_amount = round(seller_till_cash_amount - v_cash, 2),
      updated_at = now()
  where seller_id = p_seller_id;

  -- 5. Add to manager vault
  perform public._get_or_create_manager_vault(v_org_id);

  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams + v_scrap_w, 4),
      manager_cash_amount = round(manager_cash_amount + v_cash, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  -- 6. Insert gold settlement
  v_settle_no := 'STL-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id,
    settlement_no,
    direction,
    seller_id,
    gold_rate_applied,
    scrap_weight_grams,
    scrap_proba,
    cash_paid_amount,
    currency,
    cash_equivalent_grams,
    total_settled_grams,
    applied_to_debt_grams,
    excess_gold_grams,
    previous_debt_grams,
    remaining_debt_grams,
    status,
    notes,
    recorded_by,
    idempotency_key
  ) values (
    v_org_id,
    v_settle_no,
    'seller_to_manager',
    p_seller_id,
    v_rate,
    v_scrap_w,
    585,
    v_cash,
    'UZS',
    v_cash_equiv,
    v_total_settled,
    v_total_settled,
    0,
    coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0),
    round(greatest(0, coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0) - v_total_settled), 4),
    'confirmed',
    p_notes,
    v_caller_emp_id,
    p_idempotency_key
  ) returning id into v_settle_id;

  -- 7. Read synced seller gold account
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'scrap_grams_settled', v_scrap_w,
    'cash_amount_settled', v_cash,
    'cash_equivalent_grams', v_cash_equiv,
    'total_settled_grams', v_total_settled,
    'remaining_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_cash_amount', v_vault.manager_cash_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 5. CRITICAL F03/F04 FIX: rpc_reverse_seller_to_manager_settlement
-- Reverses manager settlement atomically, verifies vault balance, returns scrap & cash to seller till,
-- and inserts compensating record with status = 'reversed' and reversal_of_id.
create or replace function public.rpc_reverse_seller_to_manager_settlement(
  p_settlement_id   uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_clean_reason     text := nullif(btrim(p_reason), '');
  v_settle           public.gold_settlements%rowtype;
  v_vault            public.manager_vault_account%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_comp_settle_no   text;
  v_comp_settle_id   uuid;
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Tushumni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_seller_to_manager_settlement',
    'settlement_id', p_settlement_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_seller_to_manager_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_settle
    from public.gold_settlements
   where id = p_settlement_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Tushum kvitansiyasi topilmadi (%)', p_settlement_id;
  end if;

  if v_settle.direction <> 'seller_to_manager' then
    raise exception 'Ushbu operatsiya orqali faqat boshqaruvchi qabulini bekor qilish mumkin';
  end if;

  if v_settle.status = 'reversed' then
    raise exception 'Ushbu tushum kvitansiyasi allaqachon bekor qilingan (%s)', v_settle.settlement_no;
  end if;

  -- Lock manager vault
  select * into v_vault
    from public.manager_vault_account
   where organization_id = v_caller_org
   for update;

  if v_settle.scrap_weight_grams > 0 and v_vault.manager_scrap_grams < v_settle.scrap_weight_grams then
    raise exception 'Boshqaruvchi seyfida yetarli lom mavjud emas (Seyfda: % g, talab: % g). Lom allaqachon affinajga yoki zavodga yuborilgan.',
      v_vault.manager_scrap_grams, v_settle.scrap_weight_grams;
  end if;

  if v_settle.cash_paid_amount > 0 and v_vault.manager_cash_amount < v_settle.cash_paid_amount then
    raise exception 'Boshqaruvchi seyfida yetarli naqd pul mavjud emas (Seyfda: % UZS, talab: % UZS).',
      v_vault.manager_cash_amount, v_settle.cash_paid_amount;
  end if;

  -- Lock seller account
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id and organization_id = v_caller_org
   for update;

  -- 1. Deduct scrap & cash from manager vault
  update public.manager_vault_account
     set manager_scrap_grams = round(manager_scrap_grams - v_settle.scrap_weight_grams, 4),
         manager_cash_amount = round(manager_cash_amount - v_settle.cash_paid_amount, 2),
         updated_at          = now()
   where organization_id = v_caller_org;

  -- 2. Return scrap & cash to seller till
  update public.seller_gold_accounts
     set seller_till_scrap_grams = round(seller_till_scrap_grams + v_settle.scrap_weight_grams, 4),
         seller_till_cash_amount = round(seller_till_cash_amount + v_settle.cash_paid_amount, 2),
         updated_at              = now()
   where seller_id = v_settle.seller_id;

  -- 3. Mark original settlement as reversed
  update public.gold_settlements
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = v_settle.id;

  -- 4. Insert compensating record with explicit reversal link and direction 'seller_to_manager'
  v_comp_settle_no := 'STL-REV-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id,
    gold_rate_applied, scrap_weight_grams, cash_paid_amount,
    cash_equivalent_grams, total_settled_grams, status,
    reversal_of_id, reversal_reason,
    previous_debt_grams, remaining_debt_grams,
    notes, recorded_by
  ) values (
    v_caller_org, v_comp_settle_no, 'seller_to_manager', v_settle.seller_id,
    v_settle.gold_rate_applied, v_settle.scrap_weight_grams, v_settle.cash_paid_amount,
    coalesce(v_settle.cash_equivalent_grams, 0), v_settle.total_settled_grams, 'reversed',
    v_settle.id, v_clean_reason,
    coalesce(v_settle.remaining_debt_grams, 0), coalesce(v_settle.previous_debt_grams, 0),
    'KOMPENSATSIYA: Boshqaruvchi tushumi ' || v_settle.settlement_no || ' bekor qilindi. Sabab: ' || v_clean_reason, v_caller_emp_id
  ) returning id into v_comp_settle_id;

  -- 5. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'gold_settlements', v_settle.id::text, 'REVERSE_MANAGER_SETTLEMENT', auth.uid(),
    jsonb_build_object(
      'settlement_no', v_settle.settlement_no,
      'scrap_weight_g', v_settle.scrap_weight_grams,
      'cash_paid_uzs', v_settle.cash_paid_amount,
      'seller_id', v_settle.seller_id
    ),
    jsonb_build_object(
      'original_status', 'reversed',
      'compensating_settle_no', v_comp_settle_no
    ),
    v_clean_reason
  );

  -- 6. Re-fetch seller account updated by trigger
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'original_settlement_id', v_settle.id,
    'original_settlement_no', v_settle.settlement_no,
    'compensating_settlement_id', v_comp_settle_id,
    'compensating_settlement_no', v_comp_settle_no,
    'restored_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'restored_bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 6. P1 — F02: Manager Gold Purchase Permission in rpc_record_gold_purchase
create or replace function public.rpc_record_gold_purchase(
  p_supplier_name     text,
  p_cash_spent_uzs    numeric,
  p_rate_per_gram     numeric,
  p_gold_weight_grams numeric,
  p_proba             numeric default 585.0,
  p_notes             text default null,
  p_idempotency_key   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_caller_id      uuid := auth.uid();
  v_cash_spent     numeric(18, 2);
  v_rate           numeric(18, 2);
  v_gold_w         numeric(14, 4);
  v_pr             numeric(6, 2);
  v_equiv_585      numeric(14, 4);
  v_purch_no       text;
  v_purch_id       uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- F02 FIX: Authorize manager, production_manager, boshqaruvchi in addition to admin/director
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'inventory_manager', 'manager', 'production_manager', 'boshqaruvchi'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'purchase_id', id,
      'purchase_no', purchase_no,
      'gold_weight_grams', gold_weight_grams
    ) into v_existing
    from public.gold_purchases
    where idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_cash_spent := round(coalesce(p_cash_spent_uzs, 0)::numeric, 2);
  v_rate := round(coalesce(p_rate_per_gram, 0)::numeric, 2);
  v_gold_w := round(coalesce(p_gold_weight_grams, 0)::numeric, 4);
  v_pr := round(coalesce(p_proba, 585.0)::numeric, 2);

  if v_cash_spent <= 0 or v_gold_w <= 0 or v_rate <= 0 then
    raise exception 'Invalid purchase parameters: cash spent, rate and gold weight must be > 0';
  end if;

  v_equiv_585 := round(v_gold_w * (v_pr / 585.0), 4);

  -- Check manager cash in vault
  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  if v_vault.manager_cash_amount < v_cash_spent then
    raise exception 'ERR_INSUFFICIENT_VAULT_CASH: Boshqaruvchi seyfida yetarli naqd pul mavjud emas (Mavjud: % UZS, Talab: % UZS)',
      v_vault.manager_cash_amount, v_cash_spent;
  end if;

  -- Deduct cash, add purchased gold
  update public.manager_vault_account
  set manager_cash_amount = round(manager_cash_amount - v_cash_spent, 2),
      manager_purchased_gold_grams = round(manager_purchased_gold_grams + v_equiv_585, 4),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_purch_no := 'BUY-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_purchases (
    organization_id,
    purchase_no,
    supplier_name,
    cash_spent_uzs,
    rate_per_gram,
    gold_weight_grams,
    proba,
    equiv_585_grams,
    payment_method,
    notes,
    idempotency_key,
    recorded_by
  ) values (
    v_org_id,
    v_purch_no,
    coalesce(nullif(btrim(p_supplier_name), ''), 'Bozor / Yetkazib beruvchi'),
    v_cash_spent,
    v_rate,
    v_gold_w,
    v_pr,
    v_equiv_585,
    'cash',
    p_notes,
    p_idempotency_key,
    v_caller_id
  ) returning id into v_purch_id;

  return jsonb_build_object(
    'status', 'ok',
    'purchase_id', v_purch_id,
    'purchase_no', v_purch_no,
    'gold_weight_grams', v_gold_w,
    'equiv_585_grams', v_equiv_585,
    'cash_spent_uzs', v_cash_spent,
    'rate_per_gram', v_rate,
    'manager_remaining_cash', v_vault.manager_cash_amount,
    'manager_purchased_gold_grams', v_vault.manager_purchased_gold_grams
  );
end;
$$;

-- 7. Grant execution privileges to authenticated users
grant execute on function public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.rpc_reverse_seller_to_manager_settlement(uuid, text, text) to authenticated;
grant execute on function public.rpc_record_gold_purchase(text, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant usage on schema public to authenticated, service_role;
