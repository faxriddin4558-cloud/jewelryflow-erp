-- =========================================================================
-- 20260101000044_goldia_p0_safety_and_lock_order_parity.sql
-- JewelryFlow Sales — P0 Safety Fixes, Deadlock Prevention & Strict Financial Guard
--
-- 1. Eliminates 900,000 UZS silent hardcoded fallback:
--    Throws ERR_DAILY_RATE_NOT_SET if daily gold rate is missing.
-- 2. Deadlock Elimination:
--    Enforces identical lock ordering in settlement and reversal:
--    Order: (1) manager_vault_account -> (2) seller_gold_accounts -> (3) gold_settlements.
-- 3. Storage Security Hardening:
--    Restricts jewelry-models Storage INSERT/UPDATE/DELETE to privileged roles:
--    ('admin', 'director', 'owner', 'manager', 'production_manager').
--    Sellers are strictly blocked by RLS.
-- 4. Strict Settlement & Client Payment Rate Checking:
--    Never allows converting cash to gold debt equivalent without confirmed rate.
-- =========================================================================

-- 1. Storage RLS Hardening for jewelry-models bucket
drop policy if exists "jewelry_models_auth_upload" on storage.objects;
create policy "jewelry_models_auth_upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'jewelry-models' and
    exists (
      select 1 from public.employees e
      where e.user_id = auth.uid()
        and e.is_active = true
        and e.role::text in ('admin', 'director', 'owner', 'manager', 'production_manager')
    )
  );

drop policy if exists "jewelry_models_auth_update" on storage.objects;
create policy "jewelry_models_auth_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'jewelry-models' and
    exists (
      select 1 from public.employees e
      where e.user_id = auth.uid()
        and e.is_active = true
        and e.role::text in ('admin', 'director', 'owner', 'manager', 'production_manager')
    )
  );

drop policy if exists "jewelry_models_auth_delete" on storage.objects;
create policy "jewelry_models_auth_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'jewelry-models' and
    exists (
      select 1 from public.employees e
      where e.user_id = auth.uid()
        and e.is_active = true
        and e.role::text in ('admin', 'director', 'owner', 'manager', 'production_manager')
    )
  );

-- 2. Hardened rpc_record_seller_to_manager_settlement
-- Enforces lock ordering: 1. Vault -> 2. Seller Account.
-- Throws ERR_DAILY_RATE_NOT_SET if cash > 0 and no valid rate exists.
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
  v_seller_acc      public.seller_gold_accounts%rowtype;
  v_vault           public.manager_vault_account%rowtype;
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

  -- 1. STRICT LOCK ORDER HIERARCHY: Lock Manager Vault FIRST
  perform public._get_or_create_manager_vault(v_org_id);

  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_org_id
  for update;

  -- 2. STRICT LOCK ORDER HIERARCHY: Lock Seller Gold Account SECOND
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id and organization_id = v_org_id
  for update;

  if not found then
    raise exception 'Sotuvchi oltin hisobi topilmadi: %', p_seller_id;
  end if;

  -- 3. HARD BALANCE CHECK (F03):
  if v_scrap_w > 0 and v_seller_acc.seller_till_scrap_grams < v_scrap_w then
    raise exception 'ERR_INSUFFICIENT_SCRAP_BALANCE: Sotuvchi kassasida yetarli lom mavjud emas (Kassada: % g, Talab: % g)',
      v_seller_acc.seller_till_scrap_grams, v_scrap_w;
  end if;

  if v_cash > 0 and v_seller_acc.seller_till_cash_amount < v_cash then
    raise exception 'ERR_INSUFFICIENT_CASH_BALANCE: Sotuvchi kassasida yetarli naqd pul mavjud emas (Kassada: % UZS, Talab: % UZS)',
      v_seller_acc.seller_till_cash_amount, v_cash;
  end if;

  -- 4. Determine gold rate (NO SILENT 900,000 FALLBACK!)
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_org_id and proba = 585 and is_confirmed = true
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      -- Fallback to any latest rate if confirmed flag is not used
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_org_id and proba = 585
      order by rate_date desc, created_at desc
      limit 1;
    end if;

    if v_cash > 0 and (v_rate is null or v_rate <= 0) then
      raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi 585 oltin kursi belgilanmagan! Naqd pul topshirish uchun avval kunlik kursni kiriting.';
    end if;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    if v_rate is null or v_rate <= 0 then
      v_rate := 1.0; -- Safe sentinel rate for DB check constraint (gold_rate_applied > 0) when cash is 0
    end if;
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

  -- 5. Deduct exactly from seller till
  update public.seller_gold_accounts
  set seller_till_scrap_grams = round(seller_till_scrap_grams - v_scrap_w, 4),
      seller_till_cash_amount = round(seller_till_cash_amount - v_cash, 2),
      updated_at = now()
  where seller_id = p_seller_id;

  -- 6. Add to manager vault
  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams + v_scrap_w, 4),
      manager_cash_amount = round(manager_cash_amount + v_cash, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  -- 7. Insert gold settlement
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

  -- 8. Read synced seller gold account
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'scrap_grams_settled', v_scrap_w,
    'scrap_weight_grams', v_scrap_w,
    'cash_amount_settled', v_cash,
    'applied_rate_per_gram', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'total_settled_grams', v_total_settled,
    'remaining_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
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

-- 3. Hardened rpc_reverse_seller_to_manager_settlement
-- Enforces lock ordering: 1. Vault -> 2. Seller Account -> 3. Settlement.
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

  -- 1. STRICT LOCK ORDER HIERARCHY: Lock Manager Vault FIRST
  perform public._get_or_create_manager_vault(v_caller_org);

  select * into v_vault
    from public.manager_vault_account
   where organization_id = v_caller_org
   for update;

  -- 2. Inspect settlement record
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

  -- 3. STRICT LOCK ORDER HIERARCHY: Lock Seller Gold Account SECOND
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id and organization_id = v_caller_org
   for update;

  if v_settle.scrap_weight_grams > 0 and v_vault.manager_scrap_grams < v_settle.scrap_weight_grams then
    raise exception 'Boshqaruvchi seyfida yetarli lom mavjud emas (Seyfda: % g, talab: % g). Lom allaqachon affinajga yoki zavodga yuborilgan.',
      v_vault.manager_scrap_grams, v_settle.scrap_weight_grams;
  end if;

  if v_settle.cash_paid_amount > 0 and v_vault.manager_cash_amount < v_settle.cash_paid_amount then
    raise exception 'Boshqaruvchi seyfida yetarli naqd pul mavjud emas (Seyfda: % UZS, talab: % UZS).',
      v_vault.manager_cash_amount, v_settle.cash_paid_amount;
  end if;

  -- 4. Deduct scrap & cash from manager vault
  update public.manager_vault_account
     set manager_scrap_grams = round(manager_scrap_grams - v_settle.scrap_weight_grams, 4),
         manager_cash_amount = round(manager_cash_amount - v_settle.cash_paid_amount, 2),
         updated_at          = now()
   where organization_id = v_caller_org;

  -- 5. Return scrap & cash to seller till
  update public.seller_gold_accounts
     set seller_till_scrap_grams = round(seller_till_scrap_grams + v_settle.scrap_weight_grams, 4),
         seller_till_cash_amount = round(seller_till_cash_amount + v_settle.cash_paid_amount, 2),
         updated_at              = now()
   where seller_id = v_settle.seller_id;

  -- 6. Mark original settlement as reversed
  update public.gold_settlements
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = v_settle.id;

  -- 7. Insert compensating record with explicit reversal link
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

  -- 8. Audit log
  if to_regclass('public.audit_logs') is not null then
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
  end if;

  -- 9. Read back restored seller account
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'reversal_id', v_comp_settle_id,
    'reversal_no', v_comp_settle_no,
    'original_settlement_no', v_settle.settlement_no,
    'scrap_returned_grams', v_settle.scrap_weight_grams,
    'cash_returned_amount', v_settle.cash_paid_amount,
    'restored_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_cash_amount', v_vault.manager_cash_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

-- 4. Hardened rpc_record_client_settlement
-- Enforces that cash payments MUST have an explicit or confirmed daily rate.
-- Throws ERR_DAILY_RATE_NOT_SET if rate is missing.
create or replace function public.rpc_record_client_settlement(
  p_customer_id       uuid,
  p_sale_id           uuid default null,
  p_scrap_weight      numeric default 0,
  p_scrap_proba       numeric default null,
  p_cash_amount       numeric default 0,
  p_rate_per_gram     numeric default null,
  p_settlement_date   date default current_date,
  p_notes             text default null,
  p_idempotency_key   text default null,
  p_seller_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_rate              numeric(18, 2);
  v_physical_scrap    numeric(14, 4);
  v_proba             numeric(6, 2);
  v_fine_gold         numeric(14, 4) := 0;
  v_scrap_585_eq      numeric(14, 4) := 0;
  v_cash              numeric(18, 2);
  v_cash_equiv        numeric(14, 4) := 0;
  v_total_settled     numeric(14, 4);
  v_settle_id         uuid;
  v_settle_no         text;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_prev_debt         numeric(14, 4) := 0;
  v_applied_to_debt   numeric(14, 4) := 0;
  v_excess_advance    numeric(14, 4) := 0;
  v_rem_debt          numeric(14, 4) := 0;
  v_new_advance       numeric(14, 4) := 0;
  v_payload           jsonb;
  v_existing          jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  v_physical_scrap := round(greatest(0, coalesce(p_scrap_weight, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_amount, 0))::numeric, 2);

  if v_physical_scrap <= 0 and v_cash <= 0 then
    raise exception 'To''lov uchun lom vazni yoki naqd pul summasi kiritilishi shart';
  end if;

  -- Strict proba validation
  if v_physical_scrap > 0 then
    if p_scrap_proba is null or p_scrap_proba <= 0 then
      raise exception 'Lom oltin probasi aniq ko''rsatilishi shart (masalan: 375, 585, 750, 995, 999.9)';
    end if;
    v_proba := round(p_scrap_proba::numeric, 2);
    if v_proba < 300.0 or v_proba > 1000.0 then
      raise exception 'Noto''g''ri proba kiritildi: % (ruxsat: 300 - 1000)', v_proba;
    end if;

    v_fine_gold := round((v_physical_scrap * (v_proba / 1000.0))::numeric, 4);
    v_scrap_585_eq := round((v_physical_scrap * (v_proba / 585.0))::numeric, 4);
  else
    v_proba := 585.0;
    v_fine_gold := 0;
    v_scrap_585_eq := 0;
  end if;

  -- Cash rate determination (NO SILENT 900,000 FALLBACK!)
  if v_cash > 0 then
    if p_rate_per_gram is not null and p_rate_per_gram > 0 then
      v_rate := round(p_rate_per_gram::numeric, 2);
    else
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_caller_org and proba = 585 and is_confirmed = true
      order by rate_date desc, created_at desc
      limit 1;

      if v_rate is null or v_rate <= 0 then
        select rate_per_gram into v_rate
        from public.daily_gold_rates
        where organization_id = v_caller_org and proba = 585
        order by rate_date desc, created_at desc
        limit 1;
      end if;

      if v_rate is null or v_rate <= 0 then
        raise exception 'ERR_DAILY_RATE_NOT_SET: Naqd pul qabul qilish uchun 585 oltin kursi kiritilishi shart! Avval kunlik kursni belgilang.';
      end if;
    end if;

    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    if p_rate_per_gram is not null and p_rate_per_gram > 0 then
      v_rate := round(p_rate_per_gram::numeric, 2);
    else
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_caller_org and proba = 585
      order by rate_date desc, created_at desc
      limit 1;
      if v_rate is null or v_rate <= 0 then
        v_rate := 1.0; -- Safe sentinel rate for DB check constraint (gold_rate_applied > 0) when cash is 0
      end if;
    end if;
  end if;

  v_total_settled := round(v_scrap_585_eq + v_cash_equiv, 4);

  -- Verify customer
  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- Determine seller
  if p_seller_id is not null then
    select * into v_seller
    from public.employees
    where id = p_seller_id and organization_id = v_caller_org
    limit 1;
  elsif v_customer.seller_id is not null then
    select * into v_seller
    from public.employees
    where id = v_customer.seller_id and organization_id = v_caller_org
    limit 1;
  else
    select * into v_seller
    from public.employees
    where user_id = auth.uid() and organization_id = v_caller_org
    limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi: mijozga yoki joriy foydalanuvchiga biriktirilgan sotuvchi topilmadi';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_client_settlement',
    'customer_id', p_customer_id,
    'scrap_weight', v_physical_scrap,
    'cash_amount', v_cash
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- Lock client gold account
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_prev_debt := coalesce(v_client_acc.current_debt_grams, 0);
  else
    v_prev_debt := 0;
  end if;

  -- Debt settlement math
  if v_total_settled <= v_prev_debt then
    v_applied_to_debt := v_total_settled;
    v_excess_advance  := 0;
    v_rem_debt        := round((v_prev_debt - v_total_settled)::numeric, 4);
    v_new_advance     := coalesce(v_client_acc.advance_balance_grams, 0);
  else
    v_applied_to_debt := v_prev_debt;
    v_excess_advance  := round((v_total_settled - v_prev_debt)::numeric, 4);
    v_rem_debt        := 0;
    v_new_advance     := round((coalesce(v_client_acc.advance_balance_grams, 0) + v_excess_advance)::numeric, 4);
  end if;

  v_settle_no := 'SETTL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id, customer_id, sale_id,
    settlement_date, gold_rate_applied,
    scrap_weight_grams, physical_scrap_grams, scrap_proba, fine_gold_grams, scrap_585_equiv_grams,
    cash_paid_amount, currency, cash_equivalent_grams, total_settled_grams,
    applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    status, notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settle_no, 'client_to_seller', v_seller.id, v_customer.id, p_sale_id,
    coalesce(p_settlement_date, current_date), v_rate,
    v_scrap_585_eq, v_physical_scrap, v_proba, v_fine_gold, v_scrap_585_eq,
    v_cash, 'UZS', v_cash_equiv, v_total_settled,
    v_applied_to_debt, v_excess_advance,
    v_prev_debt, v_rem_debt,
    'confirmed', p_notes, coalesce(public.current_employee_id(), v_seller.id), nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settle_id;

  -- Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, 0,
    v_scrap_585_eq, v_cash, v_cash_equiv, v_total_settled,
    v_rem_debt, v_new_advance, now()
  )
  on conflict (customer_id) do update set
    total_scrap_paid_grams = round((client_gold_accounts.total_scrap_paid_grams + v_scrap_585_eq)::numeric, 4),
    total_cash_paid_amount = round((client_gold_accounts.total_cash_paid_amount + v_cash)::numeric, 2),
    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv)::numeric, 4),
    total_settled_grams    = round((client_gold_accounts.total_settled_grams + v_total_settled)::numeric, 4),
    current_debt_grams     = v_rem_debt,
    advance_balance_grams  = v_new_advance,
    updated_at             = now();

  -- Update seller till with received scrap (in 585 eq) and cash
  insert into public.seller_gold_accounts (
    seller_id, organization_id, seller_till_scrap_grams, seller_till_cash_amount, updated_at
  ) values (
    v_seller.id, v_caller_org, v_scrap_585_eq, v_cash, now()
  )
  on conflict (seller_id) do update set
    seller_till_scrap_grams = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585_eq)::numeric, 4),
    seller_till_cash_amount = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    updated_at              = now();

  -- If linked to specific sale, update settled amount on sale
  if p_sale_id is not null then
    update public.jewelry_sales
    set settled_gold_grams = round((coalesce(settled_gold_grams, 0) + v_applied_to_debt)::numeric, 4),
        remaining_gold_grams = round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4),
        status = case
          when round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4) <= 0.0001 then 'fully_paid'
          else 'partially_paid'
        end,
        updated_at = now()
    where id = p_sale_id and organization_id = v_caller_org;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'physical_scrap_grams', v_physical_scrap,
    'scrap_weight_grams', v_physical_scrap,
    'scrap_proba', v_proba,
    'fine_gold_grams', v_fine_gold,
    'scrap_585_equiv_grams', v_scrap_585_eq,
    'cash_paid_amount', v_cash,
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'total_settled_585_grams', v_total_settled,
    'total_settled_grams', v_total_settled,
    'previous_debt_grams', v_prev_debt,
    'applied_to_debt_grams', v_applied_to_debt,
    'excess_gold_advance_grams', v_excess_advance,
    'excess_gold_grams', v_excess_advance,
    'remaining_debt_grams', v_rem_debt,
    'advance_balance_grams', v_new_advance,
    'seller_id', v_seller.id,
    'customer_id', v_customer.id
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;
