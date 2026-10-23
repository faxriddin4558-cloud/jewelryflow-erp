-- =========================================================================
-- MIGRATION 041: JULES SECURITY AUDIT HARDENING
-- 1. Enforce strict `search_path = public, pg_temp` on all SECURITY DEFINER functions
-- 2. Revoke execute privileges from anon & public; grant strictly to authenticated
-- 3. Harden `rpc_record_factory_gold_handover` with strict formula calculation & privileged override
-- 4. Harden piece sale logic against legacy piece status anomalies & provide diagnostic RPC
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. HARDEN SEARCH_PATH = public, pg_temp ON ALL SECURITY DEFINER FUNCTIONS
-- -------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef = true
  loop
    execute format('alter function public.%I(%s) set search_path = public, pg_temp', r.proname, r.args);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------
-- 2. REVOKE EXECUTE FROM anon & public ON ALL BUSINESS & FINANCIAL RPCS
-- -------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' 
      and (p.proname like 'rpc_%' or p.proname like 'fn_%')
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
end;
$$;

-- Re-grant execute to anon on public helper functions if strictly needed for auth
grant execute on function public.current_organization_id to authenticated, anon;
grant execute on function public.current_employee_id to authenticated, anon;
grant execute on function public.current_employee_role to authenticated, anon;
grant execute on function public.current_employee_name to authenticated, anon;

-- -------------------------------------------------------------------------
-- 3. HARDEN rpc_record_factory_gold_handover (STRICT PROBA FORMULA & OVERRIDE GUARD)
-- -------------------------------------------------------------------------

drop function if exists public.rpc_record_factory_gold_handover(numeric, numeric, numeric, date, text, text);
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text);
drop function if exists public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric);

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
  v_caller_id      uuid := auth.uid();
  v_caller_role    text := public.current_employee_role();
  v_phys_w         numeric(14, 4);
  v_pr             numeric(6, 2);
  v_computed_eq    numeric(14, 4);
  v_agreed_eq      numeric(14, 4);
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

  -- Baseline permission check for factory handover
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi',
    'accountant', 'buxgalter'
  ]);

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

  -- Jules Finding 3: Server computes equivalent by default.
  -- If client passes custom agreed equivalent differing from formula by > 0.005g:
  -- Only director/owner/admin can authorize it, and notes/reason is mandatory!
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
  if v_src_type not in ('refined_gold', 'purchased_gold', 'scrap_gold') then
    v_src_type := 'refined_gold';
  end if;

  perform public._get_or_create_manager_vault(v_org_id);
  select * into v_vault from public.manager_vault_account where organization_id = v_org_id for update;

  -- Deduct from corresponding manager holding
  if v_src_type = 'refined_gold' then
    update public.manager_vault_account
    set manager_refined_gold_grams = round(greatest(0, manager_refined_gold_grams - v_agreed_eq), 4),
        manager_refined_gold_fine_grams = round(greatest(0, manager_refined_gold_fine_grams - v_phys_w), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'purchased_gold' then
    update public.manager_vault_account
    set manager_purchased_gold_grams = round(greatest(0, manager_purchased_gold_grams - v_agreed_eq), 4)
    where organization_id = v_org_id;

  elsif v_src_type = 'scrap_gold' then
    update public.manager_vault_account
    set manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_phys_w), 4)
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
    v_caller_id
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
    'computed_equivalent_g', v_computed_eq,
    'equivalent_585_grams', v_agreed_eq,
    'total_factory_handed_over_g', v_vault.total_factory_handed_over_g,
    'current_factory_obligation_g', v_vault.current_factory_obligation_g
  );
end;
$$;

grant execute on function public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric) to authenticated;

-- -------------------------------------------------------------------------
-- 4. HARDEN rpc_record_barcode_piece_sale (MUTUAL BLOCKING & PIECE RESOLUTION)
-- -------------------------------------------------------------------------

drop function if exists public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text);
drop function if exists public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, numeric, numeric, text, text, uuid);

create or replace function public.rpc_record_barcode_piece_sale(
  p_customer_id         uuid,
  p_seller_id           uuid default null,
  p_piece_id            uuid default null,
  p_model_id            uuid default null,
  p_weight_grams        numeric default null,
  p_client_markup_pct   numeric default 12.0,
  p_notes               text default null,
  p_idempotency_key     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_caller_emp_id     uuid := public.current_employee_id();
  v_caller_role       text := public.current_employee_role();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_piece             public.consignment_pieces%rowtype;
  v_consign           public.seller_consignments%rowtype;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_client_pct        numeric(6, 2) := round(coalesce(p_client_markup_pct, 12.0)::numeric, 2);
  v_base_w            numeric(14, 4);
  v_factory_due       numeric(14, 4);
  v_client_due        numeric(14, 4);
  v_spread            numeric(14, 4);
  v_avail_adv         numeric(14, 4) := 0;
  v_apply_adv         numeric(14, 4) := 0;
  v_net_rem_due       numeric(14, 4);
  v_sale_id           uuid;
  v_sale_no           text;
  v_remaining_pieces  integer;
  v_existing          jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select jsonb_build_object(
      'status', 'ok',
      'idempotent_replay', true,
      'sale_id', id,
      'sale_no', sale_no,
      'client_gold_due_grams', client_gold_due_grams,
      'gross_gold_due_grams', client_gold_due_grams,
      'advance_applied_grams', settled_gold_grams,
      'net_remaining_debt_grams', remaining_gold_grams,
      'remaining_gold_grams', remaining_gold_grams
    ) into v_existing
    from public.jewelry_sales
    where idempotency_key = p_idempotency_key and organization_id = v_caller_org;

    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- Determine seller
  if p_seller_id is not null then
    select * into v_seller
      from public.employees
     where id = p_seller_id
       and organization_id = v_caller_org
     limit 1;
  elsif v_caller_emp_id is not null then
    select * into v_seller
      from public.employees
     where id = v_caller_emp_id
       and organization_id = v_caller_org
     limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  -- Ensure seller can only sell their own pieces unless privileged
  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    if v_seller.id <> v_caller_emp_id then
      raise exception 'Boshqa sotuvchining mahsulotini sotish huquqingiz yo''q' using errcode = '42501';
    end if;
  end if;

  -- Verify customer
  select * into v_customer
    from public.customers
   where id = p_customer_id
     and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Mijoz topilmadi';
  end if;

  -- Jules Finding 2: Locate piece with robust FOR UPDATE lock & parent verification
  if p_piece_id is not null then
    select * into v_piece
      from public.consignment_pieces
     where id = p_piece_id
       and seller_id = v_seller.id
       and organization_id = v_caller_org
     for update;
  elsif p_model_id is not null and p_weight_grams is not null then
    select cp.* into v_piece
      from public.consignment_pieces cp
      join public.seller_consignments sc on sc.id = cp.consignment_id
     where cp.model_id = p_model_id
       and cp.weight_grams = round(p_weight_grams::numeric, 4)
       and cp.seller_id = v_seller.id
       and cp.status = 'held_by_seller'
       and cp.sale_id is null
       and sc.status not in ('fully_sold', 'returned_to_manager', 'cancelled')
       and coalesce(sc.sold_quantity, 0) < sc.quantity
       and cp.organization_id = v_caller_org
     order by cp.created_at asc
     limit 1
     for update of cp;
  else
    raise exception 'Mahsulot donasini aniqlash uchun piece_id yoki (model_id + weight_grams) talab qilinadi';
  end if;

  if not found or v_piece.id is null then
    raise exception 'Tanlangan mahsulot donasi sotuvchi omborida mavjud emas yoki allaqachon sotilgan';
  end if;

  -- Piece-level double sale & anomaly guard
  if v_piece.sale_id is not null or v_piece.status = 'sold' then
    raise exception 'Bu mahsulot donasi (% — % g) allaqachon sotilgan (Sotuv ID: %)',
      v_piece.model_code, v_piece.weight_grams, coalesce(v_piece.sale_id::text, 'MAVJUD');
  end if;

  if v_piece.status <> 'held_by_seller' then
    raise exception 'Mahsulot sotuvga yaroqsiz holatda (Joriy holat: %)', v_piece.status;
  end if;

  -- Fetch parent consignment with FOR UPDATE lock & enforce mutual exclusion!
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
   for update;

  if not found then
    raise exception 'Konsignatsiya yozuvi topilmadi';
  end if;

  if v_consign.status in ('fully_sold', 'returned_to_manager', 'cancelled') or coalesce(v_consign.sold_quantity, 0) >= coalesce(v_consign.quantity, 0) then
    raise exception 'Tarixiy ziddiyat: Ushbu dona mansub bo''lgan partiya (%) allaqachon to''liq sotilgan yoki bekor qilingan (Sotilgan: %/%)',
      v_consign.consignment_no, coalesce(v_consign.sold_quantity, 0), v_consign.quantity;
  end if;

  v_base_w      := v_piece.weight_grams;
  v_factory_due := round((v_base_w * (1.0 + v_consign.factory_markup_pct / 100.0))::numeric, 4);
  v_client_due  := round((v_base_w * (1.0 + v_client_pct / 100.0))::numeric, 4);
  v_spread      := round((v_client_due - v_factory_due)::numeric, 4);

  -- Check customer advance
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_customer.id
     and organization_id = v_caller_org
   for update;

  v_avail_adv := coalesce(v_client_acc.advance_balance_grams, 0);
  if v_avail_adv > 0 then
    v_apply_adv   := round(least(v_avail_adv, v_client_due)::numeric, 4);
    v_net_rem_due := round((v_client_due - v_apply_adv)::numeric, 4);
  else
    v_apply_adv   := 0;
    v_net_rem_due := v_client_due;
  end if;

  v_sale_no := 'SALE-BC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Insert sale record (strictly 'fully_paid' or 'open_debt')
  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams,
    client_markup_pct, client_gold_due_grams,
    markup_spread_grams, settled_gold_grams, remaining_gold_grams,
    status, sale_date, idempotency_key, notes
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, v_consign.id,
    v_piece.model_name || ' (' || v_piece.weight_grams || 'g)',
    1, v_base_w, v_piece.purity,
    v_consign.factory_markup_pct, v_factory_due,
    v_client_pct, v_client_due,
    v_spread, v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes
  ) returning id into v_sale_id;

  -- Mark piece as sold
  update public.consignment_pieces
     set status = 'sold',
         sale_id = v_sale_id,
         sold_at = now(),
         updated_at = now()
   where id = v_piece.id;

  -- Update parent consignment sold_quantity and status
  select count(*) into v_remaining_pieces
    from public.consignment_pieces
   where consignment_id = v_consign.id
     and status = 'held_by_seller'
     and sale_id is null;

  if v_remaining_pieces = 0 or (coalesce(v_consign.sold_quantity, 0) + 1) >= v_consign.quantity then
    update public.seller_consignments
       set status = 'fully_sold',
           sold_quantity = quantity,
           updated_at = now()
     where id = v_consign.id;
  else
    update public.seller_consignments
       set status = 'partially_sold',
           sold_quantity = coalesce(sold_quantity, 0) + 1,
           updated_at = now()
     where id = v_consign.id;
  end if;

  -- Update client running debt in client_gold_accounts
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    current_debt_grams, advance_balance_grams, total_settled_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, v_client_due,
    v_net_rem_due, greatest(0, v_avail_adv - v_apply_adv), v_apply_adv, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    updated_at                 = now();

  return jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'model_name', v_piece.model_name,
    'weight_grams', v_base_w,
    'purity', v_piece.purity,
    'client_markup_pct', v_client_pct,
    'gross_gold_due_grams', v_client_due,
    'client_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'remaining_gold_grams', v_net_rem_due,
    'parent_consignment_status', case when v_remaining_pieces = 0 then 'fully_sold' else 'partially_sold' end
  );
end;
$$;

grant execute on function public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- 5. DIAGNOSTIC RPC FOR HISTORICAL PIECE & INVENTORY CONFLICTS
-- -------------------------------------------------------------------------

create or replace function public.rpc_diagnose_piece_inventory_conflicts()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_anomalies  jsonb := '[]'::jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(d), '[]'::jsonb)
  into v_anomalies
  from (
    select
      cp.id as piece_id,
      cp.model_code,
      cp.model_name,
      cp.weight_grams,
      cp.status as piece_status,
      cp.sale_id,
      sc.id as consignment_id,
      sc.consignment_no,
      sc.status as consignment_status,
      case
        when sc.status = 'fully_sold' and cp.status = 'held_by_seller' then 'consignment_fully_sold_but_piece_marked_held'
        when cp.status = 'held_by_seller' and cp.sale_id is not null then 'piece_marked_held_with_active_sale_id'
        when cp.status = 'sold' and cp.sale_id is null then 'piece_marked_sold_without_sale_id'
        when sc.sold_quantity > sc.quantity then 'consignment_sold_quantity_overflow'
        else 'other_anomaly'
      end as conflict_type
    from public.consignment_pieces cp
    join public.seller_consignments sc on sc.id = cp.consignment_id
    where cp.organization_id = v_caller_org
      and (
        (sc.status = 'fully_sold' and cp.status = 'held_by_seller')
        or (cp.status = 'held_by_seller' and cp.sale_id is not null)
        or (cp.status = 'sold' and cp.sale_id is null)
        or (sc.sold_quantity > sc.quantity)
      )
  ) d;

  return jsonb_build_object(
    'organization_id', v_caller_org,
    'conflict_count', jsonb_array_length(v_anomalies),
    'conflicts', v_anomalies,
    'audit_timestamp', now()
  );
end;
$$;

grant execute on function public.rpc_diagnose_piece_inventory_conflicts() to authenticated;

-- -------------------------------------------------------------------------
-- 6. SECURE RPC TO GET GENUINE AVAILABLE PIECES FOR SELLER
-- -------------------------------------------------------------------------

create or replace function public.rpc_get_seller_available_pieces(
  p_seller_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_caller_emp uuid := public.current_employee_id();
  v_caller_role text := public.current_employee_role();
  v_target_seller uuid;
  v_pieces jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if p_seller_id is not null then
    v_target_seller := p_seller_id;
  else
    v_target_seller := v_caller_emp;
  end if;

  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
  into v_pieces
  from (
    select 
      cp.id,
      cp.consignment_id,
      cp.model_id,
      cp.model_code,
      cp.model_name,
      cp.category,
      cp.purity,
      cp.proba,
      cp.weight_grams,
      cp.status,
      cp.seller_id,
      cp.raw_barcode,
      jm.primary_image_url,
      cp.notes,
      cp.seller_markup_pct,
      cp.seller_obligation_grams,
      cp.created_at,
      sc.consignment_no
    from public.consignment_pieces cp
    join public.seller_consignments sc on sc.id = cp.consignment_id
    left join public.jewelry_models jm on jm.id = cp.model_id
    where cp.organization_id = v_caller_org
      and (v_target_seller is null or cp.seller_id = v_target_seller)
      and cp.status = 'held_by_seller'
      and cp.sale_id is null
      and sc.status not in ('fully_sold', 'returned_to_manager', 'cancelled')
      and coalesce(sc.sold_quantity, 0) < sc.quantity
    order by cp.created_at desc
  ) r;

  return v_pieces;
end;
$$;

grant execute on function public.rpc_get_seller_available_pieces(uuid) to authenticated;

revoke execute on function public.rpc_record_barcode_piece_sale(uuid, uuid, uuid, uuid, numeric, numeric, text, text) from public, anon;
revoke execute on function public.rpc_record_factory_gold_handover(text, numeric, numeric, numeric, text, text, text, numeric) from public, anon;
revoke execute on function public.rpc_diagnose_piece_inventory_conflicts() from public, anon;
revoke execute on function public.rpc_get_seller_available_pieces(uuid) from public, anon;
revoke execute on function public._get_or_create_manager_vault(uuid) from public, anon;

