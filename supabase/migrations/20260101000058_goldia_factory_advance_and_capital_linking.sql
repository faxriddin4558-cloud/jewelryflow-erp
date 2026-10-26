-- Migration 058: Goldia Factory Advance and Capital Handover Linking
-- 1. Adds current_factory_advance_g to manager_vault_account (Bizning zavoddagi avansimiz / haqdorligimiz)
-- 2. Adds factory_advance_585_g to accounting_baselines
-- 3. Adds capital_tx_id to factory_gold_handovers to link handover with capital injection
-- 4. Updates rpc_record_factory_gold_handover to record advance when handover > debt, and link capital
-- 5. Updates rpc_reverse_factory_gold_handover to restore safe gold and recompute obligation/advance
-- 6. Updates rpc_record_factory_receipt to absorb advance before increasing obligation
-- 7. Updates rpc_reverse_factory_receipt to restore obligation/advance atomically
-- 8. Updates rpc_confirm_accounting_baseline to include factory advance in total assets
-- 9. Updates rpc_get_accounting_profit_summary to include factory advance in assets & components

-- 1. Schema enhancements
alter table public.manager_vault_account
  add column if not exists current_factory_advance_g numeric(14, 4) not null default 0 check (current_factory_advance_g >= 0);

alter table public.accounting_baselines
  add column if not exists factory_advance_585_g numeric(14, 4) not null default 0 check (factory_advance_585_g >= 0);

alter table public.factory_gold_handovers
  add column if not exists capital_tx_id uuid references public.financial_transactions(id) on delete set null;

create index if not exists idx_factory_gold_handovers_capital_tx
  on public.factory_gold_handovers (organization_id, capital_tx_id);

-- Recalculate existing vault balances to initialize advance correctly
update public.manager_vault_account
set current_factory_obligation_g = round(greatest(0, total_factory_obligation_g - total_factory_handed_over_g), 4),
    current_factory_advance_g = round(greatest(0, total_factory_handed_over_g - total_factory_obligation_g), 4);


-- 2. rpc_record_factory_gold_handover
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric);
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric, uuid);

create or replace function public.rpc_record_factory_gold_handover(
  p_source_type         text default 'refined_gold',
  p_physical_weight_g   numeric default null,
  p_proba               numeric default 585.0,
  p_agreed_equivalent_g numeric default null,
  p_factory_recipient   text default 'Zavod',
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_gross_weight_grams  numeric default null,
  p_capital_tx_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id          uuid := public.current_organization_id();
  v_emp_id          uuid := public.current_employee_id();
  v_phys_w          numeric(14, 4);
  v_pr              numeric(6, 2);
  v_computed_eq     numeric(14, 4);
  v_agreed_eq       numeric(14, 4);
  v_fine_w          numeric(14, 4);
  v_src_type        text;
  v_handover_no     text;
  v_handover_id     uuid;
  v_vault           public.manager_vault_account;
  v_existing        jsonb;
  v_notes           text := p_notes;
  v_cap_tx_id       uuid := p_capital_tx_id;
  v_cap_tx_no       text;
  v_new_handed_over numeric(14, 4);
  v_net_balance     numeric(14, 4);
  v_new_obligation  numeric(14, 4);
  v_new_advance     numeric(14, 4);
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi',
    'accountant', 'buxgalter'
  ]);

  if v_emp_id is null then
    select id into v_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
  end if;

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'handover_id', id,
      'handover_no', handover_no,
      'agreed_equivalent_g', agreed_equivalent_g,
      'equivalent_585_grams', agreed_equivalent_g,
      'current_factory_obligation_g', (select current_factory_obligation_g from public.manager_vault_account where organization_id = v_org_id),
      'current_factory_advance_g', (select current_factory_advance_g from public.manager_vault_account where organization_id = v_org_id)
    ) into v_existing
    from public.factory_gold_handovers
    where idempotency_key = p_idempotency_key and organization_id = v_org_id;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_w := round(coalesce(p_physical_weight_g, p_gross_weight_grams, 0)::numeric, 4);
  v_pr := round(coalesce(p_proba, 585.0)::numeric, 2);

  if v_phys_w <= 0 then
    raise exception 'Invalid physical weight: must be > 0';
  end if;

  v_computed_eq := round(v_phys_w * (v_pr / 585.0), 4);
  v_fine_w := round((v_phys_w * (v_pr / 1000.0))::numeric, 4);

  if p_agreed_equivalent_g is not null and abs(p_agreed_equivalent_g - v_computed_eq) > 0.005 then
    perform public.assert_erp_permission(array[
      'admin', 'director', 'owner', 'direktor', 'rahbar'
    ]);

    if p_notes is null or length(btrim(p_notes)) < 10 then
      raise exception 'Maxsus kelishilgan ekvivalent (farq: % g) kiritilganda uning sababi (notes) batafsil yozilishi shart (kamida 10 belgi)',
        round(abs(p_agreed_equivalent_g - v_computed_eq), 4);
    end if;

    v_agreed_eq := round(p_agreed_equivalent_g::numeric, 4);
    v_notes := coalesce(p_notes, '') || ' [Maxsus kelishilgan ekvivalent: ' || v_agreed_eq || 'g, formula bo''yicha: ' || v_computed_eq || 'g]';
  else
    v_agreed_eq := v_computed_eq;
  end if;

  v_src_type := coalesce(nullif(btrim(p_source_type), ''), 'refined_gold');
  if v_src_type not in ('refined_gold', 'purchased_gold', 'scrap_gold', 'capital_pure_gold') then
    v_src_type := 'refined_gold';
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- Deduct from corresponding manager safe holding
  if v_src_type = 'refined_gold' then
    update public.manager_vault_account
    set manager_refined_gold_grams = round(greatest(0, manager_refined_gold_grams - v_agreed_eq), 4),
        manager_refined_gold_fine_grams = round(greatest(0, coalesce(manager_refined_gold_fine_grams, 0) - v_phys_w), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'purchased_gold' then
    update public.manager_vault_account
    set manager_purchased_gold_grams = round(greatest(0, manager_purchased_gold_grams - v_agreed_eq), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'scrap_gold' then
    update public.manager_vault_account
    set manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_phys_w), 4),
        manager_scrap_585_eq_g = round(greatest(0, coalesce(manager_scrap_585_eq_g, 0) - v_agreed_eq), 4),
        manager_scrap_physical_g = round(greatest(0, coalesce(manager_scrap_physical_g, 0) - v_phys_w), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'capital_pure_gold' then
    if (coalesce(v_vault.manager_capital_pure_gold_g, 0) + 0.001) < v_agreed_eq then
      raise exception 'ERR_INSUFFICIENT_CAPITAL_GOLD: Seyfda yetarli toza kapital oltin mavjud emas. Mavjud: % g (585 eq), Topshirilmoqchi: % g',
        coalesce(v_vault.manager_capital_pure_gold_g, 0), v_agreed_eq;
    end if;

    update public.manager_vault_account
    set manager_capital_pure_gold_g = round(greatest(0, coalesce(manager_capital_pure_gold_g, 0) - v_agreed_eq), 4),
        manager_capital_pure_gold_fine_g = round(greatest(0, coalesce(manager_capital_pure_gold_fine_g, 0) - v_fine_w), 4)
    where organization_id = v_org_id;

    -- Capital transaction linking
    if v_cap_tx_id is not null then
      select transaction_no into v_cap_tx_no
      from public.financial_transactions
      where id = v_cap_tx_id and organization_id = v_org_id and status <> 'reversed';
    else
      select id, transaction_no into v_cap_tx_id, v_cap_tx_no
      from public.financial_transactions
      where organization_id = v_org_id
        and transaction_type in ('capital_in', 'capital_contribution')
        and source_till in ('manager_fine_gold', 'fine_gold')
        and status <> 'reversed'
      order by created_at desc
      limit 1;
    end if;

    if v_cap_tx_no is not null then
      v_notes := coalesce(v_notes, '') || ' [Bog''langan kapital: ' || v_cap_tx_no || ']';
    end if;
  end if;

  -- Atomically update factory obligation and advance:
  -- Net = total_factory_obligation_g - (total_factory_handed_over_g + v_agreed_eq)
  -- If Net >= 0: obligation = Net, advance = 0
  -- If Net < 0: obligation = 0, advance = abs(Net) (Bizning haqdorligimiz / Zavoddagi avans!)
  v_new_handed_over := round(v_vault.total_factory_handed_over_g + v_agreed_eq, 4);
  v_net_balance := round(v_vault.total_factory_obligation_g - v_new_handed_over, 4);

  if v_net_balance >= 0 then
    v_new_obligation := v_net_balance;
    v_new_advance := 0;
  else
    v_new_obligation := 0;
    v_new_advance := abs(v_net_balance);
  end if;

  update public.manager_vault_account
  set total_factory_handed_over_g = v_new_handed_over,
      current_factory_obligation_g = v_new_obligation,
      current_factory_advance_g = v_new_advance,
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_handover_no := 'HND-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.factory_gold_handovers (
    organization_id,
    handover_no,
    source_type,
    physical_weight_g,
    proba,
    agreed_equivalent_g,
    factory_recipient,
    factory_accepted,
    notes,
    idempotency_key,
    recorded_by,
    capital_tx_id
  ) values (
    v_org_id,
    v_handover_no,
    v_src_type,
    v_phys_w,
    v_pr,
    v_agreed_eq,
    coalesce(nullif(btrim(p_factory_recipient), ''), 'Zavod'),
    true,
    v_notes,
    p_idempotency_key,
    v_emp_id,
    v_cap_tx_id
  ) returning id into v_handover_id;

  return jsonb_build_object(
    'status', 'ok',
    'handover_id', v_handover_id,
    'handover_no', v_handover_no,
    'source_type', v_src_type,
    'physical_weight_g', v_phys_w,
    'gross_weight_grams', v_phys_w,
    'proba', v_pr,
    'agreed_equivalent_g', v_agreed_eq,
    'equivalent_585_grams', v_agreed_eq,
    'capital_tx_id', v_cap_tx_id,
    'total_factory_handed_over_g', v_vault.total_factory_handed_over_g,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g,
    'current_factory_advance_g', v_vault.current_factory_advance_g,
    'excess_advance_g', v_vault.current_factory_advance_g
  );
end;
$$;

grant execute on function public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric, uuid) to authenticated;


-- 3. rpc_reverse_factory_gold_handover
drop function if exists public.rpc_reverse_factory_gold_handover(uuid, text, text);

create or replace function public.rpc_reverse_factory_gold_handover(
  p_handover_id     uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_hnd             public.factory_gold_handovers%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
  v_src             text;
  v_new_handed_over numeric(14, 4);
  v_net_balance     numeric(14, 4);
  v_new_obligation  numeric(14, 4);
  v_new_advance     numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Zavodga topshirishni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_factory_gold_handover',
    'handover_id', p_handover_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_hnd
  from public.factory_gold_handovers
  where id = p_handover_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Zavodga oltin topshirish hujjati topilmadi: %', p_handover_id;
  end if;

  if v_hnd.status = 'reversed' then
    raise exception 'Ushbu zavodga topshirish hujjati allaqachon bekor qilingan (%s)', v_hnd.handover_no;
  end if;

  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_caller_org
  for update;

  v_src := coalesce(v_hnd.source_type, 'refined_gold');

  -- Restore handed-over gold to manager vault according to source_type
  if v_src = 'refined_gold' then
    update public.manager_vault_account
       set manager_refined_gold_grams = round((manager_refined_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           manager_refined_gold_fine_grams = round((coalesce(manager_refined_gold_fine_grams, 0) + coalesce(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  elsif v_src = 'purchased_gold' then
    update public.manager_vault_account
       set manager_purchased_gold_grams = round((manager_purchased_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  elsif v_src = 'capital_pure_gold' then
    update public.manager_vault_account
       set manager_capital_pure_gold_g = round((coalesce(manager_capital_pure_gold_g, 0) + v_hnd.agreed_equivalent_g)::numeric, 4),
           manager_capital_pure_gold_fine_g = round((coalesce(manager_capital_pure_gold_fine_g, 0) + round((v_hnd.physical_weight_g * (v_hnd.proba / 1000.0))::numeric, 4))::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  else -- scrap_gold or scrap
    update public.manager_vault_account
       set manager_scrap_grams = round((manager_scrap_grams + coalesce(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           manager_scrap_physical_g = round((coalesce(manager_scrap_physical_g, 0) + coalesce(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           manager_scrap_585_eq_g = round((coalesce(manager_scrap_585_eq_g, 0) + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  end if;

  -- Atomically recalculate obligation and advance:
  v_new_handed_over := round(greatest(0, v_vault.total_factory_handed_over_g - v_hnd.agreed_equivalent_g), 4);
  v_net_balance := round(v_vault.total_factory_obligation_g - v_new_handed_over, 4);

  if v_net_balance >= 0 then
    v_new_obligation := v_net_balance;
    v_new_advance := 0;
  else
    v_new_obligation := 0;
    v_new_advance := abs(v_net_balance);
  end if;

  update public.manager_vault_account
     set total_factory_handed_over_g = v_new_handed_over,
         current_factory_obligation_g = v_new_obligation,
         current_factory_advance_g = v_new_advance,
         updated_at = now()
   where organization_id = v_caller_org
   returning * into v_vault;

  -- Mark handover as reversed
  update public.factory_gold_handovers
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = p_handover_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'factory_gold_handovers', p_handover_id::text,
    'REVERSE_FACTORY_GOLD_HANDOVER', auth.uid(),
    jsonb_build_object(
      'handover_no', v_hnd.handover_no,
      'source_type', v_hnd.source_type,
      'agreed_eq_g', v_hnd.agreed_equivalent_g,
      'capital_tx_id', v_hnd.capital_tx_id
    ),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'handover_id', p_handover_id,
    'handover_no', v_hnd.handover_no,
    'restored_gold_grams', v_hnd.agreed_equivalent_g,
    'reason', v_clean_reason,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g,
    'current_factory_advance_g', v_vault.current_factory_advance_g
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_factory_gold_handover(uuid, text, text) to authenticated;


-- 4. rpc_record_factory_receipt
create or replace function public.rpc_record_factory_receipt(
  p_product_name        text,
  p_quantity            integer default 1,
  p_original_physical_g numeric default 0,
  p_proba               numeric default 585,
  p_factory_markup_pct  numeric default 8.0,
  p_product_id          uuid default null,
  p_model_id            uuid default null,
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
  v_caller_role     text := public.current_employee_role_text();
  v_receipt_no      text;
  v_receipt_id      uuid;
  v_phys_g          numeric(14, 4);
  v_f_pct           numeric(6, 2);
  v_f_due_g         numeric(14, 4);
  v_vault           public.manager_vault_account;
  v_existing        jsonb;
  v_new_obligation  numeric(14, 4);
  v_net_balance     numeric(14, 4);
  v_cur_obligation  numeric(14, 4);
  v_cur_advance     numeric(14, 4);
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'sotuvchi', 'sales', 'worker', 'viewer') or v_caller_role is null then
    raise exception 'Ruxsat etilmadi: Sotuvchi yoki begona foydalanuvchi zavod tovar kirimini saqlay olmaydi (Rol: %)', v_caller_role
      using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'production_manager', 'manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'action', 'record_factory_receipt',
      'product_name', p_product_name,
      'physical_weight_g', round(coalesce(p_original_physical_g, 0)::numeric, 4),
      'proba', coalesce(p_proba, 585)
    ) into v_existing;
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_factory_receipt', v_existing);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_phys_g := round(coalesce(p_original_physical_g, 0)::numeric, 4);
  if v_phys_g <= 0 then
    raise exception 'Zavod kirimi fizik vazni 0 dan katta bo''lishi shart';
  end if;

  v_f_pct   := round(coalesce(p_factory_markup_pct, 8.0)::numeric, 2);
  v_f_due_g := round((v_phys_g * (1.0 + v_f_pct / 100.0))::numeric, 4);

  v_receipt_no := 'ZVD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.factory_receipts (
    organization_id, receipt_no, product_id, model_id, product_name,
    quantity, original_physical_g, available_physical_g, transferred_physical_g,
    proba, factory_markup_pct, factory_obligation_g, status, notes
  ) values (
    v_org_id, v_receipt_no, p_product_id, p_model_id, p_product_name,
    greatest(1, coalesce(p_quantity, 1)), v_phys_g, v_phys_g, 0,
    coalesce(p_proba, 585), v_f_pct, v_f_due_g, 'in_manager_stock', p_notes
  ) returning id into v_receipt_id;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  v_new_obligation := round(v_vault.total_factory_obligation_g + v_f_due_g, 4);
  v_net_balance := round(v_new_obligation - v_vault.total_factory_handed_over_g, 4);

  if v_net_balance >= 0 then
    v_cur_obligation := v_net_balance;
    v_cur_advance := 0;
  else
    v_cur_obligation := 0;
    v_cur_advance := abs(v_net_balance);
  end if;

  update public.manager_vault_account
  set total_factory_received_g   = round((total_factory_received_g + v_phys_g)::numeric, 4),
      total_factory_obligation_g = v_new_obligation,
      current_factory_obligation_g = v_cur_obligation,
      current_factory_advance_g = v_cur_advance,
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_no', v_receipt_no,
    'original_physical_g', v_phys_g,
    'physical_weight_g', v_phys_g,
    'factory_markup_pct', v_f_pct,
    'factory_obligation_g', v_f_due_g,
    'vault_factory_obligation_g', v_vault.current_factory_obligation_g,
    'manager_current_factory_obligation_g', v_vault.current_factory_obligation_g,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g,
    'current_factory_advance_g', v_vault.current_factory_advance_g
  );

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text) to authenticated;


-- 5. rpc_reverse_factory_receipt
create or replace function public.rpc_reverse_factory_receipt(
  p_receipt_id      uuid,
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
  v_rcp              public.factory_receipts%rowtype;
  v_vault            public.manager_vault_account%rowtype;
  v_payload          jsonb;
  v_existing         jsonb;
  v_new_obligation   numeric(14, 4);
  v_net_balance      numeric(14, 4);
  v_cur_obligation   numeric(14, 4);
  v_cur_advance      numeric(14, 4);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Fabrika qabulini bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_factory_receipt',
    'receipt_id', p_receipt_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_factory_receipt', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_rcp
    from public.factory_receipts
   where id = p_receipt_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Fabrika qabuli topilmadi (%)', p_receipt_id;
  end if;

  if v_rcp.status = 'reversed' then
    raise exception 'Ushbu fabrika qabuli allaqachon bekor qilingan (%s)', v_rcp.receipt_no;
  end if;

  if coalesce(v_rcp.transferred_physical_g, 0) > 0.0001 or v_rcp.available_physical_g < (v_rcp.original_physical_g - 0.0001) then
    raise exception 'Fabrika qabulini bekor qilib bo''lmaydi: ushbu partiyadan tovarlar allaqachon konsignatsiyaga tarqatilgan (% g). Avval bog''langan konsignatsiyalarni bekor qiling.',
      v_rcp.transferred_physical_g;
  end if;

  update public.factory_receipts
     set status          = 'reversed',
         available_physical_g = 0,
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason,
         updated_at      = now()
   where id = p_receipt_id;

  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault from public.manager_vault_account where organization_id = v_caller_org for update;

  v_new_obligation := round(greatest(0, v_vault.total_factory_obligation_g - v_rcp.factory_obligation_g), 4);
  v_net_balance := round(v_new_obligation - v_vault.total_factory_handed_over_g, 4);

  if v_net_balance >= 0 then
    v_cur_obligation := v_net_balance;
    v_cur_advance := 0;
  else
    v_cur_obligation := 0;
    v_cur_advance := abs(v_net_balance);
  end if;

  update public.manager_vault_account
     set total_factory_received_g   = round(greatest(0, total_factory_received_g - v_rcp.original_physical_g), 4),
         total_factory_obligation_g = v_new_obligation,
         current_factory_obligation_g = v_cur_obligation,
         current_factory_advance_g  = v_cur_advance,
         manager_physical_stock_g   = round(greatest(0, coalesce(manager_physical_stock_g, 0) - v_rcp.original_physical_g), 4),
         updated_at = now()
   where organization_id = v_caller_org
   returning * into v_vault;

  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'factory_receipts', v_rcp.id::text, 'REVERSE_FACTORY_RECEIPT', auth.uid(),
    jsonb_build_object(
      'receipt_no', v_rcp.receipt_no,
      'original_physical_g', v_rcp.original_physical_g,
      'factory_obligation_g', v_rcp.factory_obligation_g,
      'product_name', v_rcp.product_name
    ),
    jsonb_build_object(
      'status', 'reversed',
      'available_physical_g', 0
    ),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_rcp.id,
    'receipt_no', v_rcp.receipt_no,
    'deducted_obligation_grams', v_rcp.factory_obligation_g,
    'deducted_physical_grams', v_rcp.original_physical_g,
    'reason', v_clean_reason,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g,
    'current_factory_advance_g', v_vault.current_factory_advance_g
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_receipt', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_factory_receipt(uuid, text, text) to authenticated;


-- 6. rpc_confirm_accounting_baseline
drop function if exists public.rpc_confirm_accounting_baseline(text, numeric);
drop function if exists public.rpc_confirm_accounting_baseline(text, text, numeric);

create or replace function public.rpc_confirm_accounting_baseline(
  p_notes text default null,
  p_idempotency_key text default null,
  p_usd_rate numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id                 uuid := public.current_organization_id();
  v_caller_emp_id          uuid := public.current_employee_id();
  v_today                  date := (timezone('Asia/Tashkent', now()))::date;
  v_rate_585               numeric(18, 2);
  v_rate_usd               numeric(18, 2);
  v_mgr_finished_g         numeric(14, 4);
  v_mgr_scrap_585_eq_g     numeric(14, 4);
  v_mgr_refined_g          numeric(14, 4);
  v_mgr_capital_pure_g     numeric(14, 4);
  v_mgr_purchased_g        numeric(14, 4);
  v_mgr_cash_uzs           numeric(18, 2);
  v_mgr_cash_usd           numeric(18, 2);
  v_seller_finished_g      numeric(14, 4);
  v_seller_scrap_585_eq_g  numeric(14, 4);
  v_seller_cash_uzs        numeric(18, 2);
  v_seller_cash_usd        numeric(18, 2);
  v_refining_wip_g         numeric(14, 4);
  v_cash_uzs_total         numeric(18, 2);
  v_cash_usd_total         numeric(18, 2);
  v_cash_uzs_585_eq_g      numeric(14, 4);
  v_cash_usd_585_eq_g      numeric(14, 4);
  v_customer_debts_g       numeric(14, 4);
  v_customer_advances_g    numeric(14, 4);
  v_factory_rcp_g          numeric(14, 4);
  v_factory_hnd_g          numeric(14, 4);
  v_net_factory_g          numeric(14, 4);
  v_factory_obligation_g   numeric(14, 4);
  v_factory_advance_g      numeric(14, 4);
  v_total_assets_g         numeric(14, 4);
  v_total_liabilities_g    numeric(14, 4);
  v_net_assets_g           numeric(14, 4);
  v_baseline_no            text;
  v_baseline_id            uuid;
  v_snapshot               jsonb;
  v_payload                jsonb;
  v_existing               jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_org_id limit 1;
  end if;

  select rate_per_gram into v_rate_585
    from public.daily_gold_rates
   where organization_id = v_org_id
     and proba = 585
     and rate_date = v_today
     and is_confirmed = true
   order by created_at desc
   limit 1;

  if v_rate_585 is null or v_rate_585 <= 0 then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Boshlang''ich hisobni tasdiqlash uchun bugungi (% sanadagi) tasdiqlangan 585 oltin kursi kiritilishi shart', v_today
      using errcode = '22023';
  end if;

  v_payload := jsonb_build_object('action', 'confirm_accounting_baseline', 'org_id', v_org_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select coalesce(sum(available_physical_g), 0) into v_mgr_finished_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(manager_scrap_585_eq_g, manager_scrap_grams, 0),
         coalesce(manager_refined_gold_grams, 0),
         coalesce(manager_capital_pure_gold_g, 0),
         coalesce(manager_purchased_gold_grams, 0),
         coalesce(manager_cash_amount, 0),
         coalesce(manager_usd_amount, 0)
    into v_mgr_scrap_585_eq_g, v_mgr_refined_g, v_mgr_capital_pure_g, v_mgr_purchased_g, v_mgr_cash_uzs, v_mgr_cash_usd
    from public.manager_vault_account
   where organization_id = v_org_id;

  select coalesce(sum(coalesce(input_585_equiv_grams, input_scrap_grams * (coalesce(input_scrap_proba, 585.0) / 585.0))), 0)
    into v_refining_wip_g
    from public.refining_batches
   where organization_id = v_org_id and status in ('pending', 'in_progress');

  select coalesce(sum(public.get_seller_available_stock_grams(seller_id)), 0),
         coalesce(sum(coalesce(seller_till_scrap_585_eq_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(seller_till_cash_amount), 0),
         coalesce(sum(coalesce(seller_till_usd_amount, 0)), 0)
    into v_seller_finished_g, v_seller_scrap_585_eq_g, v_seller_cash_uzs, v_seller_cash_usd
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  v_cash_uzs_total := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_cash_usd_total := round(v_mgr_cash_usd + v_seller_cash_usd, 2);

  if v_cash_usd_total > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_rate_usd := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Kassalarda dollar (USD) mavjud, boshlang''ich hisob uchun tasdiqlangan USD kursi kiritilishi shart'
        using errcode = '22023';
    end if;
  else
    v_rate_usd := coalesce(p_usd_rate, 1.0);
  end if;

  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_customer_debts_g, v_customer_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  v_cash_uzs_585_eq_g := round((v_cash_uzs_total / v_rate_585)::numeric, 4);
  if v_cash_usd_total > 0 and v_rate_usd > 0 then
    v_cash_usd_585_eq_g := round(((v_cash_usd_total * v_rate_usd) / v_rate_585)::numeric, 4);
  else
    v_cash_usd_585_eq_g := 0;
  end if;

  -- Factory net balance: receipts vs handovers
  select coalesce(sum(factory_obligation_g), 0) into v_factory_rcp_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0) into v_factory_hnd_g
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_net_factory_g := v_factory_rcp_g - v_factory_hnd_g;
  if v_net_factory_g >= 0 then
    v_factory_obligation_g := round(v_net_factory_g, 4);
    v_factory_advance_g := 0;
  else
    v_factory_obligation_g := 0;
    v_factory_advance_g := round(abs(v_net_factory_g), 4);
  end if;

  -- Total Assets includes factory advance gold as enterprise asset!
  v_total_assets_g := round(
    v_mgr_finished_g + v_seller_finished_g +
    v_mgr_scrap_585_eq_g + v_seller_scrap_585_eq_g +
    v_mgr_refined_g + v_mgr_capital_pure_g + v_mgr_purchased_g +
    v_refining_wip_g +
    v_customer_debts_g +
    v_cash_uzs_585_eq_g + v_cash_usd_585_eq_g +
    v_factory_advance_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g, 4);
  v_net_assets_g := round(v_total_assets_g - v_total_liabilities_g, 4);

  update public.accounting_baselines
     set status = 'archived'
   where organization_id = v_org_id and status = 'active';

  v_baseline_no := 'BASE-' || to_char(v_today, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  v_snapshot := jsonb_build_object(
    'gold_rate_585', v_rate_585,
    'usd_rate', v_rate_usd,
    'rate_date', v_today,
    'manager_finished_g', v_mgr_finished_g,
    'seller_finished_g', v_seller_finished_g,
    'manager_scrap_585_eq_g', v_mgr_scrap_585_eq_g,
    'seller_scrap_585_eq_g', v_seller_scrap_585_eq_g,
    'manager_refined_gold_g', v_mgr_refined_g,
    'manager_capital_pure_gold_g', v_mgr_capital_pure_g,
    'manager_purchased_gold_g', v_mgr_purchased_g,
    'refining_wip_585_g', v_refining_wip_g,
    'customer_debts_585_g', v_customer_debts_g,
    'customer_advances_585_g', v_customer_advances_g,
    'cash_uzs_total', v_cash_uzs_total,
    'cash_uzs_585_eq_g', v_cash_uzs_585_eq_g,
    'cash_usd_total', v_cash_usd_total,
    'cash_usd_585_eq_g', v_cash_usd_585_eq_g,
    'factory_obligation_585_g', v_factory_obligation_g,
    'factory_advance_585_g', v_factory_advance_g,
    'total_assets_585_g', v_total_assets_g,
    'total_liabilities_585_g', v_total_liabilities_g,
    'net_assets_585_g', v_net_assets_g
  );

  insert into public.accounting_baselines (
    organization_id, baseline_no, baseline_date, confirmed_by, status, notes,
    gold_rate_585, usd_rate,
    manager_finished_g, seller_finished_g,
    manager_scrap_585_eq_g, seller_scrap_585_eq_g,
    manager_refined_gold_g, manager_purchased_gold_g,
    customer_debts_585_g, cash_uzs_amount, cash_uzs_585_eq_g,
    cash_usd_amount, cash_usd_585_eq_g,
    total_assets_585_g, factory_obligation_585_g, factory_advance_585_g,
    customer_advances_585_g, total_liabilities_585_g,
    net_assets_585_g, components_snapshot
  ) values (
    v_org_id, v_baseline_no, now(), v_caller_emp_id, 'active', p_notes,
    v_rate_585, v_rate_usd,
    v_mgr_finished_g, v_seller_finished_g,
    v_mgr_scrap_585_eq_g, v_seller_scrap_585_eq_g,
    v_mgr_refined_g, v_mgr_purchased_g,
    v_customer_debts_g, v_cash_uzs_total, v_cash_uzs_585_eq_g,
    v_cash_usd_total, v_cash_usd_585_eq_g,
    v_total_assets_g, v_factory_obligation_g, v_factory_advance_g,
    v_customer_advances_g, v_total_liabilities_g,
    v_net_assets_g, v_snapshot
  ) returning id into v_baseline_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'baseline_id', v_baseline_id,
    'baseline_no', v_baseline_no,
    'baseline_date', v_today,
    'gold_rate_585', v_rate_585,
    'usd_rate', v_rate_usd,
    'total_assets_585_g', v_total_assets_g,
    'factory_obligation_585_g', v_factory_obligation_g,
    'factory_advance_585_g', v_factory_advance_g,
    'total_liabilities_585_g', v_total_liabilities_g,
    'net_assets_585_g', v_net_assets_g,
    'snapshot', v_snapshot
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_confirm_accounting_baseline', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_confirm_accounting_baseline(text, text, numeric) to authenticated;


-- 7. rpc_get_accounting_profit_summary
create or replace function public.rpc_get_accounting_profit_summary(
  p_start_date  date default null,
  p_end_date    date default null,
  p_gold_rate   numeric default null,
  p_usd_rate    numeric default null,
  p_org_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id                 uuid := coalesce(p_org_id, public.current_organization_id());
  v_today                  date := (timezone('Asia/Tashkent', now()))::date;
  v_gold_rate_585          numeric(18, 2);
  v_usd_rate               numeric(18, 2);
  v_rate_confirmed         boolean := false;
  v_base                   public.accounting_baselines%rowtype;
  v_mgr_stock_g            numeric(14, 4) := 0;
  v_seller_stock_g         numeric(14, 4) := 0;
  v_mgr_scrap_g            numeric(14, 4) := 0;
  v_mgr_scrap_phys_g       numeric(14, 4) := 0;
  v_seller_scrap_g         numeric(14, 4) := 0;
  v_seller_scrap_phys_g    numeric(14, 4) := 0;
  v_mgr_refined_g          numeric(14, 4) := 0;
  v_mgr_capital_pure_g     numeric(14, 4) := 0;
  v_mgr_purchased_g        numeric(14, 4) := 0;
  v_refining_wip_g         numeric(14, 4) := 0;
  v_cust_debts_g           numeric(14, 4) := 0;
  v_cust_advances_g        numeric(14, 4) := 0;
  v_mgr_cash_uzs           numeric(18, 2) := 0;
  v_seller_cash_uzs        numeric(18, 2) := 0;
  v_total_cash_uzs         numeric(18, 2) := 0;
  v_cash_585_eq_g          numeric(14, 4) := 0;
  v_mgr_usd                numeric(18, 2) := 0;
  v_seller_usd             numeric(18, 2) := 0;
  v_total_usd              numeric(18, 2) := 0;
  v_usd_585_eq_g           numeric(14, 4) := 0;
  v_factory_rcp_due_g      numeric(14, 4) := 0;
  v_factory_hnd_paid_g     numeric(14, 4) := 0;
  v_net_factory_g          numeric(14, 4) := 0;
  v_factory_debt_g         numeric(14, 4) := 0;
  v_factory_advance_g      numeric(14, 4) := 0;
  v_tot_assets_g           numeric(14, 4) := 0;
  v_tot_liabilities_g      numeric(14, 4) := 0;
  v_cur_net_assets_g       numeric(14, 4) := 0;
  v_cap_in_g               numeric(14, 4) := 0;
  v_cap_out_g              numeric(14, 4) := 0;
  v_expenses_g             numeric(14, 4) := 0;
  v_refining_loss_g        numeric(14, 4) := 0;
  v_post_base_legacy_adj   numeric(14, 4) := 0;
  v_period_accounting_res  numeric(14, 4) := null;
  v_vault_rec              public.manager_vault_account%rowtype;
  v_components             jsonb;
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if p_end_date is not null and p_end_date > v_today then
    return jsonb_build_object(
      'status', 'unsupported_pilot_period',
      'error', format('Pilot davrida faqat bugungi kungacha (jonli real-time) hisoblash qo''llab-quvvatlanadi. Tanlangan oxirgi sana: %s, Bugun: %s.', p_end_date, v_today),
      'is_computable', false,
      'is_complete', false,
      'accounting_method', 'realtime_pilot_locked'
    );
  end if;

  select * into v_base
    from public.accounting_baselines
   where organization_id = v_org_id
     and status = 'active'
   order by baseline_date desc, created_at desc
   limit 1;

  if p_gold_rate is not null and p_gold_rate > 0 then
    v_gold_rate_585 := round(p_gold_rate::numeric, 2);
    v_rate_confirmed := true;
  else
    select rate_per_gram, is_confirmed
      into v_gold_rate_585, v_rate_confirmed
      from public.daily_gold_rates
     where organization_id = v_org_id
       and proba = 585
       and rate_date = v_today
     order by created_at desc
     limit 1;

    if v_gold_rate_585 is null and v_base.id is not null then
      v_gold_rate_585 := v_base.gold_rate_585;
      v_rate_confirmed := true;
    end if;
  end if;

  if p_usd_rate is not null and p_usd_rate > 0 then
    v_usd_rate := round(p_usd_rate::numeric, 2);
  else
    if v_base.id is not null and v_base.usd_rate is not null and v_base.usd_rate > 0 then
      v_usd_rate := v_base.usd_rate;
    else
      v_usd_rate := 12800.0;
    end if;
  end if;

  select coalesce(sum(available_physical_g), 0) into v_mgr_stock_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(public.get_seller_available_stock_grams(seller_id)), 0)
    into v_seller_stock_g
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  select * into v_vault_rec
  from public.manager_vault_account
  where organization_id = v_org_id;

  if found then
    v_mgr_scrap_g := coalesce(v_vault_rec.manager_scrap_585_eq_g, v_vault_rec.manager_scrap_grams, 0);
    v_mgr_scrap_phys_g := coalesce(v_vault_rec.manager_scrap_physical_g, v_vault_rec.manager_scrap_grams, 0);
    v_mgr_refined_g := coalesce(v_vault_rec.manager_refined_gold_grams, 0);
    v_mgr_capital_pure_g := coalesce(v_vault_rec.manager_capital_pure_gold_g, 0);
    v_mgr_purchased_g := coalesce(v_vault_rec.manager_purchased_gold_grams, 0);
    v_mgr_cash_uzs := coalesce(v_vault_rec.manager_cash_amount, 0);
    v_mgr_usd := coalesce(v_vault_rec.manager_usd_amount, 0);
  end if;

  select coalesce(sum(coalesce(seller_till_scrap_585_eq_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(coalesce(seller_till_scrap_physical_g, seller_till_scrap_grams, 0)), 0),
         coalesce(sum(seller_till_cash_amount), 0),
         coalesce(sum(coalesce(seller_till_usd_amount, 0)), 0)
    into v_seller_scrap_g, v_seller_scrap_phys_g, v_seller_cash_uzs, v_seller_usd
    from public.seller_gold_accounts
   where organization_id = v_org_id;

  select coalesce(sum(coalesce(input_585_equiv_grams, input_scrap_grams * (coalesce(input_scrap_proba, 585.0) / 585.0))), 0)
    into v_refining_wip_g
    from public.refining_batches
   where organization_id = v_org_id and status in ('pending', 'in_progress');

  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_cust_debts_g, v_cust_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  v_total_cash_uzs := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_total_usd := round(v_mgr_usd + v_seller_usd, 2);

  if v_gold_rate_585 is not null and v_gold_rate_585 > 0 then
    v_cash_585_eq_g := round((v_total_cash_uzs / v_gold_rate_585)::numeric, 4);
    if v_usd_rate is not null and v_usd_rate > 0 then
      v_usd_585_eq_g := round(((v_total_usd * v_usd_rate) / v_gold_rate_585)::numeric, 4);
    end if;
  end if;

  -- Factory net balance: receipts vs handovers
  select coalesce(sum(factory_obligation_g), 0) into v_factory_rcp_due_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0) into v_factory_hnd_paid_g
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_net_factory_g := v_factory_rcp_due_g - v_factory_hnd_paid_g;
  if v_net_factory_g >= 0 then
    v_factory_debt_g := round(v_net_factory_g, 4);
    v_factory_advance_g := 0;
  else
    v_factory_debt_g := 0;
    v_factory_advance_g := round(abs(v_net_factory_g), 4);
  end if;

  -- Total Assets includes factory advance gold as asset!
  v_tot_assets_g := round(
    v_mgr_stock_g + v_seller_stock_g +
    v_mgr_scrap_g + v_seller_scrap_g +
    v_mgr_refined_g + v_mgr_capital_pure_g + v_mgr_purchased_g +
    v_refining_wip_g +
    v_cust_debts_g +
    v_cash_585_eq_g + v_usd_585_eq_g +
    v_factory_advance_g,
    4
  );

  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g, 4);
  v_cur_net_assets_g := round(v_tot_assets_g - v_tot_liabilities_g, 4);

  v_components := jsonb_build_object(
    'manager_finished_goods_585_g', v_mgr_stock_g,
    'sellers_finished_goods_585_g', v_seller_stock_g,
    'manager_scrap_585_eq_g', v_mgr_scrap_g,
    'manager_scrap_physical_g', v_mgr_scrap_phys_g,
    'sellers_scrap_585_eq_g', v_seller_scrap_g,
    'sellers_scrap_physical_g', v_seller_scrap_phys_g,
    'manager_refined_gold_585_g', v_mgr_refined_g,
    'manager_capital_pure_gold_585_g', v_mgr_capital_pure_g,
    'manager_purchased_gold_585_g', v_mgr_purchased_g,
    'refining_wip_585_g', v_refining_wip_g,
    'customer_debts_585_g', v_cust_debts_g,
    'customer_advances_585_g', v_cust_advances_g,
    'manager_cash_uzs', v_mgr_cash_uzs,
    'sellers_cash_uzs', v_seller_cash_uzs,
    'cash_uzs_amount', v_total_cash_uzs,
    'cash_uzs_585_eq_g', v_cash_585_eq_g,
    'manager_cash_usd', v_mgr_usd,
    'sellers_cash_usd', v_seller_usd,
    'cash_usd_amount', v_total_usd,
    'cash_usd_585_eq_g', v_usd_585_eq_g,
    'factory_obligation_585_g', v_factory_debt_g,
    'factory_debt_585_g', v_factory_debt_g,
    'factory_advance_585_g', v_factory_advance_g
  );

  if v_base.id is not null then
    select coalesce(sum(case when transaction_type in ('capital_in', 'capital_contribution') then equiv_585_grams else 0 end), 0),
           coalesce(sum(case when transaction_type in ('capital_out', 'capital_distribution') then equiv_585_grams else 0 end), 0),
           coalesce(sum(case when transaction_type in ('expense', 'business_expense') then equiv_585_grams else 0 end), 0)
      into v_cap_in_g, v_cap_out_g, v_expenses_g
      from public.financial_transactions
     where organization_id = v_org_id and status <> 'reversed'
       and created_at > v_base.created_at;

    select coalesce(sum(delta_585_g), 0) into v_post_base_legacy_adj
    from public.client_legacy_debts
    where organization_id = v_org_id and status <> 'reversed'
      and created_at > v_base.created_at;

    select coalesce(sum(total_loss_grams), 0) into v_refining_loss_g
    from public.refining_batches
    where organization_id = v_org_id and status = 'completed'
      and created_at > v_base.created_at;

    v_period_accounting_res := round(
      (v_cur_net_assets_g - v_base.net_assets_585_g)
      - v_cap_in_g
      + v_cap_out_g
      + v_expenses_g
      - v_post_base_legacy_adj,
      4
    );
  end if;

  return jsonb_build_object(
    'status', case when v_base.id is null then 'baseline_not_set' else 'ok' end,
    'is_computable', (v_base.id is not null),
    'is_complete', (v_gold_rate_585 is not null and v_gold_rate_585 > 0 and v_rate_confirmed and v_base.id is not null),
    'as_of_time', timezone('Asia/Tashkent', now()),
    'as_of_date', v_today,
    'has_baseline', (v_base.id is not null),
    'has_active_baseline', (v_base.id is not null),
    'missing_data', case
      when v_base.id is null then jsonb_build_array('Boshlang''ich hisob tasdiqlanmagan (muzlatilmagan). Boshqaruv panelidan hisobni boshlang.')
      else '[]'::jsonb
    end,
    'rates', jsonb_build_object(
      'gold_rate_585', v_gold_rate_585,
      'is_confirmed', (v_rate_confirmed and v_gold_rate_585 is not null),
      'usd_rate', v_usd_rate,
      'rate_date', v_today
    ),
    'baseline', case
      when v_base.id is null then null
      else jsonb_build_object(
        'id', v_base.id,
        'baseline_no', v_base.baseline_no,
        'baseline_date', v_base.baseline_date,
        'net_assets_585_g', v_base.net_assets_585_g,
        'total_assets_585_g', v_base.total_assets_585_g,
        'total_liabilities_585_g', v_base.total_liabilities_585_g,
        'gold_rate_585', v_base.gold_rate_585,
        'usd_rate', v_base.usd_rate
      )
    end,
    'current_net_assets_585_g', v_cur_net_assets_g,
    'net_assets_585_g', v_cur_net_assets_g,
    'current_total_assets_585_g', v_tot_assets_g,
    'current_total_liabilities_585_g', v_tot_liabilities_g,
    'period_accounting_result_585_g', v_period_accounting_res,
    'operational_trading_result_585_g', v_period_accounting_res,
    'fx_valuation_impact_585_g', null,
    'capital_contributions_585_g', v_cap_in_g,
    'capital_distributions_585_g', v_cap_out_g,
    'business_expenses_585_g', v_expenses_g,
    'refining_loss_585_g', v_refining_loss_g,
    'post_baseline_legacy_debt_adj_585_g', v_post_base_legacy_adj,
    'accounting_method', 'net_assets_delta_capital_adjusted_585_g',
    'accounting_scope_notes', 'Hisob 585 proba sof oltin ekvivalentida yuritiladi. Sof aktivlar o''zgarishi (kapital va pateriya ta''siri to''g''ri hisobga olingan holda) korxona sof natijasini beradi.',
    'pilot_notice', 'Pilot davrida umumiy hisobiy natija (aktivlar o''sishi) to''liq aniq; alohida savdo marjasi va kurs tafovutiga ajratish to''liq partiyaviy konvertatsiya tahlili yakunlangach taqdim etiladi.',
    'components', v_components,
    'assets', jsonb_build_object(
      'manager_stock_585_g', v_mgr_stock_g,
      'seller_stock_585_g', v_seller_stock_g,
      'manager_scrap_585_eq_g', v_mgr_scrap_g,
      'seller_scrap_585_eq_g', v_seller_scrap_g,
      'manager_refined_gold_585_g', v_mgr_refined_g,
      'manager_capital_pure_gold_585_g', v_mgr_capital_pure_g,
      'manager_purchased_gold_585_g', v_mgr_purchased_g,
      'refining_wip_585_g', v_refining_wip_g,
      'customer_debts_585_g', v_cust_debts_g,
      'cash_uzs_585_eq_g', v_cash_585_eq_g,
      'cash_usd_585_eq_g', v_usd_585_eq_g,
      'factory_advance_585_g', v_factory_advance_g
    ),
    'liabilities', jsonb_build_object(
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g
    )
  );
end;
$$;

grant execute on function public.rpc_get_accounting_profit_summary(date, date, numeric, numeric, uuid) to authenticated;
