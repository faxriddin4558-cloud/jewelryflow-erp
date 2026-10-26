-- Migration 057: Goldia Capital Pure Gold Factory Handover and Vault Parity
-- Enables handing over pure bullion gold capital (manager_capital_pure_gold_g / fine_g)
-- to factory to pay down factory obligations with full audited reversal support.

-- 1. Update source_type check constraint on factory_gold_handovers
alter table public.factory_gold_handovers
  drop constraint if exists factory_gold_handovers_source_type_check;

alter table public.factory_gold_handovers
  add constraint factory_gold_handovers_source_type_check
  check (source_type in ('refined_gold', 'purchased_gold', 'scrap_gold', 'capital_pure_gold'));

-- 2. Update rpc_record_factory_gold_handover
create or replace function public.rpc_record_factory_gold_handover(
  p_source_type         text default 'refined_gold',
  p_physical_weight_g   numeric default null,
  p_proba               numeric default 585.0,
  p_agreed_equivalent_g numeric default null,
  p_factory_recipient   text default 'Zavod',
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_gross_weight_grams  numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id         uuid := public.current_organization_id();
  v_emp_id         uuid := public.current_employee_id();
  v_phys_w         numeric(14, 4);
  v_pr             numeric(6, 2);
  v_computed_eq    numeric(14, 4);
  v_agreed_eq      numeric(14, 4);
  v_fine_w         numeric(14, 4);
  v_src_type       text;
  v_handover_no    text;
  v_handover_id    uuid;
  v_vault          public.manager_vault_account;
  v_existing       jsonb;
  v_notes          text := p_notes;
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
      'equivalent_585_grams', agreed_equivalent_g
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

  -- Standard server formula: physical * (proba / 585)
  v_computed_eq := round(v_phys_w * (v_pr / 585.0), 4);
  v_fine_w := round((v_phys_w * (v_pr / 1000.0))::numeric, 4);

  -- Special agreed equivalent override check (Director permission required if > 0.005g difference)
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

  -- Deduct from corresponding manager holding
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
  end if;

  -- Update factory obligation: ONLY THIS EVENT REDUCES FACTORY DEBT!
  update public.manager_vault_account
  set total_factory_handed_over_g = round(total_factory_handed_over_g + v_agreed_eq, 4),
      current_factory_obligation_g = round(greatest(0, total_factory_obligation_g - (total_factory_handed_over_g + v_agreed_eq)), 4),
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
    recorded_by
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
    v_emp_id
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
    'total_factory_handed_over_g', v_vault.total_factory_handed_over_g,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g
  );
end;
$$;

grant execute on function public.rpc_record_factory_gold_handover to authenticated;


-- 3. Update rpc_reverse_factory_gold_handover
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

  -- Lock manager vault
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

  -- Atomically update factory obligation totals on manager vault
  update public.manager_vault_account
     set total_factory_handed_over_g = round(greatest(0, total_factory_handed_over_g - v_hnd.agreed_equivalent_g), 4),
         current_factory_obligation_g = round(greatest(0, total_factory_obligation_g - greatest(0, total_factory_handed_over_g - v_hnd.agreed_equivalent_g)), 4),
         updated_at = now()
   where organization_id = v_caller_org;

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
    jsonb_build_object('handover_no', v_hnd.handover_no, 'source_type', v_hnd.source_type, 'agreed_eq_g', v_hnd.agreed_equivalent_g),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'handover_id', p_handover_id,
    'handover_no', v_hnd.handover_no,
    'restored_gold_grams', v_hnd.agreed_equivalent_g,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_factory_gold_handover(uuid, text, text) to authenticated;
