-- =========================================================================
-- 20260101000045_goldia_core_sales_workflow_and_multi_currency.sql
-- Goldia Sales — Weight-Only Gram-Based Sales, Multi-Currency (USD/UZS) Settlement & Stock Tracking
--
-- 1. Adds current_physical_stock_g to seller_gold_accounts and auto-syncs via triggers.
-- 2. Adds usd_equivalent_grams to gold_settlements and sale_type to jewelry_sales.
-- 3. rpc_record_weight_sale: Atomically verifies seller physical stock (100g - 15g = 85g),
--    calculates customer debt (15g @ 12% = 16.8g), applies advance, records sale.
-- 4. rpc_reverse_client_sale: Reverses any client sale (weight or piece), restores balances and stock.
-- 5. rpc_record_client_settlement: Supports USD alongside UZS and Scrap, converts USD to gold grams
--    using verified USD and gold rates (no 12,850 and no 900,000 fallback), records to seller till.
-- 6. rpc_record_seller_to_manager_settlement: Supports USD surrender from seller till to manager vault.
-- 7. rpc_reverse_seller_to_manager_settlement: Supports USD reversal back to seller till.
-- =========================================================================

-- 1. Schema Enhancements
alter table public.seller_gold_accounts
  add column if not exists current_physical_stock_g numeric(14, 4) not null default 0 check (current_physical_stock_g >= 0);

alter table public.gold_settlements
  add column if not exists usd_equivalent_grams numeric(14, 4) default 0;

alter table public.jewelry_sales
  add column if not exists sale_type text default 'piece' check (sale_type in ('piece', 'weight'));

-- Backfill initial current_physical_stock_g for any existing accounts
update public.seller_gold_accounts sga
set current_physical_stock_g = round(greatest(0, 
  coalesce((select sum(base_weight_grams) from public.seller_consignments sc where sc.seller_id = sga.seller_id and sc.status in ('held_by_seller', 'partially_sold', 'fully_sold')), 0)
  - coalesce((select sum(base_weight_grams) from public.jewelry_sales js where js.seller_id = sga.seller_id and js.status not in ('cancelled', 'reversed')), 0)
), 4);

-- 2. Enhanced fn_sync_seller_gold_account()
create or replace function public.fn_sync_seller_gold_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller_id    uuid := coalesce(NEW.seller_id, OLD.seller_id);
  v_org_id       uuid := coalesce(NEW.organization_id, OLD.organization_id);
  v_total_phys   numeric(14, 4);
  v_total_obl    numeric(14, 4);
  v_total_stl    numeric(14, 4);
  v_s_owes       numeric(14, 4);
  v_m_owes       numeric(14, 4);
  v_signed       numeric(14, 4);
  v_total_sold   numeric(14, 4);
  v_total_ret    numeric(14, 4);
  v_cur_stock    numeric(14, 4);
begin
  if v_seller_id is null or v_org_id is null then
    return coalesce(NEW, OLD);
  end if;

  -- 1. Total physical consigned and total obligation from consignments
  select
    coalesce(sum(base_weight_grams), 0),
    coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0)
  into v_total_phys, v_total_obl
  from public.seller_consignments
  where seller_id = v_seller_id and organization_id = v_org_id
    and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  -- 2. Total non-reversed settlements to manager/factory
  select coalesce(sum(total_settled_grams), 0)
  into v_total_stl
  from public.gold_settlements
  where seller_id = v_seller_id and organization_id = v_org_id
    and direction in ('seller_to_manager', 'seller_to_factory')
    and (status is null or status not in ('reversed', 'cancelled'))
    and reversal_of_id is null;

  v_s_owes := round(greatest(0, v_total_obl - v_total_stl), 4);
  v_m_owes := round(greatest(0, v_total_stl - v_total_obl), 4);
  v_signed := round(v_m_owes - v_s_owes, 4);

  -- 3. Total sold physical grams (sales that are not cancelled or reversed)
  select coalesce(sum(base_weight_grams), 0)
  into v_total_sold
  from public.jewelry_sales
  where seller_id = v_seller_id and organization_id = v_org_id
    and status not in ('cancelled', 'reversed');

  -- 4. Total returned pieces/consignments
  select coalesce(sum(weight_grams), 0)
  into v_total_ret
  from public.consignment_pieces
  where seller_id = v_seller_id and organization_id = v_org_id
    and status in ('returned_to_factory', 'returned_to_manager');

  v_cur_stock := round(greatest(0, v_total_phys - v_total_sold - v_total_ret), 4);

  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    total_transferred_physical_g, total_seller_obligation_g,
    total_settled_to_manager_g, seller_owes_manager_g,
    manager_owes_seller_g, bozor_qarzi_signed_g,
    total_consigned_gold_grams, current_factory_obligation_grams,
    current_physical_stock_g,
    updated_at
  ) values (
    v_seller_id, v_org_id,
    v_total_phys, v_total_obl,
    v_total_stl, v_s_owes,
    v_m_owes, v_signed,
    v_total_obl, v_s_owes,
    v_cur_stock,
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
    current_physical_stock_g = v_cur_stock,
    updated_at = now();

  return coalesce(NEW, OLD);
end;
$$;

-- Triggers for fn_sync_seller_gold_account
drop trigger if exists trg_sync_seller_gold_account_sales on public.jewelry_sales;
create trigger trg_sync_seller_gold_account_sales
  after insert or update or delete on public.jewelry_sales
  for each row execute function public.fn_sync_seller_gold_account();

-- 3. Helper: get_seller_available_stock_grams
create or replace function public.get_seller_available_stock_grams(p_seller_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id    uuid := public.current_organization_id();
  v_consigned numeric(14, 4);
  v_sold      numeric(14, 4);
  v_ret       numeric(14, 4);
begin
  select coalesce(sum(base_weight_grams), 0) into v_consigned
    from public.seller_consignments
   where seller_id = p_seller_id and organization_id = v_org_id
     and status in ('held_by_seller', 'partially_sold', 'fully_sold');

  select coalesce(sum(base_weight_grams), 0) into v_sold
    from public.jewelry_sales
   where seller_id = p_seller_id and organization_id = v_org_id
     and status not in ('cancelled', 'reversed');

  select coalesce(sum(weight_grams), 0) into v_ret
    from public.consignment_pieces
   where seller_id = p_seller_id and organization_id = v_org_id
     and status in ('returned_to_factory', 'returned_to_manager');

  return round(greatest(0, v_consigned - v_sold - v_ret), 4);
end;
$$;

grant execute on function public.get_seller_available_stock_grams(uuid) to authenticated;

-- 4. rpc_record_weight_sale (WEIGHT_ONLY Core Sales Workflow)
create or replace function public.rpc_record_weight_sale(
  p_customer_id         uuid,
  p_seller_id           uuid default null,
  p_weight_grams        numeric default 0,
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
  v_caller_role       text := public.current_employee_role_text();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_seller_acc        public.seller_gold_accounts%rowtype;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_weight            numeric(14, 4);
  v_markup            numeric(6, 2);
  v_client_due        numeric(14, 4);
  v_avail_stock       numeric(14, 4);
  v_avail_adv         numeric(14, 4) := 0;
  v_apply_adv         numeric(14, 4) := 0;
  v_net_rem_due       numeric(14, 4);
  v_sale_id           uuid;
  v_sale_no           text;
  v_payload           jsonb;
  v_existing          jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  v_weight := round(greatest(0, coalesce(p_weight_grams, 0))::numeric, 4);
  if v_weight <= 0 then
    raise exception 'Sotilayotgan oltin vazni 0 dan katta bo''lishi shart (Kiritilgan: % g)', v_weight;
  end if;

  v_markup := round(coalesce(p_client_markup_pct, 12.0)::numeric, 2);
  if v_markup < 0 then
    raise exception 'Mijoz ustama foizi manfiy bo''lishi mumkin emas';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_weight_sale',
    'customer_id', p_customer_id,
    'weight_grams', v_weight,
    'client_markup_pct', v_markup
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_weight_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. Determine seller
  if p_seller_id is not null then
    select * into v_seller
      from public.employees
     where id = p_seller_id and organization_id = v_caller_org
     limit 1;
  elsif v_caller_emp_id is not null then
    select * into v_seller
      from public.employees
     where id = v_caller_emp_id and organization_id = v_caller_org
     limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  -- Ensure seller can only sell their own inventory unless privileged
  if v_caller_role not in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi') then
    if v_seller.id <> v_caller_emp_id then
      raise exception 'Boshqa sotuvchining omboridan savdo qilish huquqingiz yo''q' using errcode = '42501';
    end if;
  end if;

  -- 2. Verify customer
  select * into v_customer
    from public.customers
   where id = p_customer_id and organization_id = v_caller_org
   limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- 3. Lock seller_gold_accounts FOR UPDATE
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_seller.id and organization_id = v_caller_org
   for update;

  -- Dynamic real-time calculation of available physical stock
  declare
    v_dyn_cons numeric(14, 4);
    v_dyn_sold numeric(14, 4);
    v_dyn_ret  numeric(14, 4);
  begin
    select coalesce(sum(base_weight_grams), 0) into v_dyn_cons
      from public.seller_consignments
     where seller_id = v_seller.id and organization_id = v_caller_org
       and status in ('held_by_seller', 'partially_sold', 'fully_sold');

    select coalesce(sum(base_weight_grams), 0) into v_dyn_sold
      from public.jewelry_sales
     where seller_id = v_seller.id and organization_id = v_caller_org
       and status not in ('cancelled', 'reversed');

    select coalesce(sum(weight_grams), 0) into v_dyn_ret
      from public.consignment_pieces
     where seller_id = v_seller.id and organization_id = v_caller_org
       and status in ('returned_to_factory', 'returned_to_manager');

    v_avail_stock := round(greatest(0, v_dyn_cons - v_dyn_sold - v_dyn_ret), 4);
  end;

  -- 4. ATOMIC PHYSICAL STOCK CHECK (Requirement 3)
  if v_avail_stock < v_weight then
    raise exception 'ERR_INSUFFICIENT_SELLER_STOCK: Sotuvchi omborida yetarli oltin mavjud emas (Mavjud: % g, Talab: % g)',
      v_avail_stock, v_weight;
  end if;

  -- 5. Math: Client gross gold due = base_weight * (1 + markup / 100)
  v_client_due := round((v_weight * (1.0 + v_markup / 100.0))::numeric, 4);

  -- 6. Lock client_gold_accounts FOR UPDATE & check advance
  select * into v_client_acc
    from public.client_gold_accounts
   where customer_id = v_customer.id and organization_id = v_caller_org
   for update;

  if found then
    v_avail_adv := coalesce(v_client_acc.advance_balance_grams, 0);
  else
    v_avail_adv := 0;
  end if;

  if v_avail_adv > 0 then
    v_apply_adv   := round(least(v_avail_adv, v_client_due)::numeric, 4);
    v_net_rem_due := round((v_client_due - v_apply_adv)::numeric, 4);
  else
    v_apply_adv   := 0;
    v_net_rem_due := v_client_due;
  end if;

  v_sale_no := 'SALE-W-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  -- 7. Insert jewelry_sales record
  insert into public.jewelry_sales (
    organization_id, sale_no, seller_id, customer_id, consignment_id,
    product_name, quantity, base_weight_grams, proba,
    factory_markup_pct, factory_gold_due_grams,
    client_markup_pct, client_gold_due_grams,
    markup_spread_grams, settled_gold_grams, remaining_gold_grams,
    status, sale_date, idempotency_key, notes, sale_type
  ) values (
    v_caller_org, v_sale_no, v_seller.id, v_customer.id, null,
    'Standart 585 Oltin (Vazn bo''yicha)', 1, v_weight, 585.00,
    0.00, v_weight,
    v_markup, v_client_due,
    round((v_client_due - v_weight)::numeric, 4), v_apply_adv, v_net_rem_due,
    case when v_net_rem_due <= 0.0001 then 'fully_paid' else 'open_debt' end,
    current_date, nullif(btrim(p_idempotency_key), ''), p_notes, 'weight'
  ) returning id into v_sale_id;

  -- 8. Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    current_debt_grams, advance_balance_grams, total_settled_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, v_client_due,
    v_net_rem_due, round(greatest(0, v_avail_adv - v_apply_adv)::numeric, 4), v_apply_adv, now()
  )
  on conflict (customer_id) do update set
    total_purchased_gold_grams = round((client_gold_accounts.total_purchased_gold_grams + v_client_due)::numeric, 4),
    current_debt_grams         = round((client_gold_accounts.current_debt_grams + v_net_rem_due)::numeric, 4),
    advance_balance_grams      = round(greatest(0, client_gold_accounts.advance_balance_grams - v_apply_adv)::numeric, 4),
    total_settled_grams        = round((client_gold_accounts.total_settled_grams + v_apply_adv)::numeric, 4),
    seller_id                  = coalesce(client_gold_accounts.seller_id, v_seller.id),
    updated_at                 = now();

  -- 9. Update seller_gold_accounts total_client_debt_grams
  insert into public.seller_gold_accounts (
    seller_id, organization_id, total_client_debt_grams, updated_at
  ) values (
    v_seller.id, v_caller_org, v_net_rem_due, now()
  )
  on conflict (seller_id) do update set
    total_client_debt_grams = round((seller_gold_accounts.total_client_debt_grams + v_net_rem_due)::numeric, 4),
    updated_at              = now();

  -- Remaining physical stock
  v_avail_stock := round(v_avail_stock - v_weight, 4);

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale_id,
    'sale_no', v_sale_no,
    'seller_id', v_seller.id,
    'customer_id', v_customer.id,
    'base_weight_grams', v_weight,
    'weight_grams', v_weight,
    'client_markup_pct', v_markup,
    'gross_gold_due_grams', v_client_due,
    'client_gold_due_grams', v_client_due,
    'advance_applied_grams', v_apply_adv,
    'net_remaining_debt_grams', v_net_rem_due,
    'remaining_gold_grams', v_net_rem_due,
    'remaining_physical_stock_g', v_avail_stock,
    'sale_type', 'weight'
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_weight_sale', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text) to authenticated;

-- 5. rpc_reverse_client_sale (Universal Sale Reversal for Weight and Piece Sales)
create or replace function public.rpc_reverse_client_sale(
  p_sale_id         uuid,
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
  v_clean_reason     text := nullif(btrim(p_reason), '');
  v_sale             public.jewelry_sales%rowtype;
  v_cust_acc         public.client_gold_accounts%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_net_sale_debt    numeric(14, 4);
  v_new_cust_debt    numeric(14, 4);
  v_new_cust_adv     numeric(14, 4);
  v_new_seller_debt  numeric(14, 4);
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Savdoni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_client_sale',
    'sale_id', p_sale_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. Lock and fetch sale
  select * into v_sale
    from public.jewelry_sales
   where id = p_sale_id and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Savdo hujjati topilmadi (%)', p_sale_id;
  end if;

  if v_sale.status in ('reversed', 'cancelled') then
    raise exception 'Ushbu savdo allaqachon bekor qilingan (%s)', v_sale.sale_no;
  end if;

  -- 2. Lock client_gold_accounts
  select * into v_cust_acc
    from public.client_gold_accounts
   where customer_id = v_sale.customer_id and organization_id = v_caller_org
   for update;

  -- 3. Lock seller_gold_accounts
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_sale.seller_id and organization_id = v_caller_org
   for update;

  -- Net customer debt that was added by this sale
  v_net_sale_debt := round((v_sale.client_gold_due_grams - coalesce(v_sale.settled_gold_grams, 0))::numeric, 4);

  -- Adjust customer debt and restore any applied advance
  v_new_cust_debt := round(greatest(0, coalesce(v_cust_acc.current_debt_grams, 0) - v_net_sale_debt)::numeric, 4);
  v_new_cust_adv  := round((coalesce(v_cust_acc.advance_balance_grams, 0) + coalesce(v_sale.settled_gold_grams, 0))::numeric, 4);

  update public.client_gold_accounts
     set total_purchased_gold_grams = round(greatest(0, total_purchased_gold_grams - v_sale.client_gold_due_grams)::numeric, 4),
         current_debt_grams         = v_new_cust_debt,
         advance_balance_grams      = v_new_cust_adv,
         total_settled_grams        = round(greatest(0, total_settled_grams - coalesce(v_sale.settled_gold_grams, 0))::numeric, 4),
         updated_at                 = now()
   where customer_id = v_sale.customer_id;

  -- Adjust seller's total client debt
  v_new_seller_debt := round(greatest(0, coalesce(v_seller_acc.total_client_debt_grams, 0) - v_net_sale_debt)::numeric, 4);
  update public.seller_gold_accounts
     set total_client_debt_grams = v_new_seller_debt,
         updated_at              = now()
   where seller_id = v_sale.seller_id;

  -- Mark sale as reversed
  update public.jewelry_sales
     set status          = 'reversed',
         notes           = coalesce(notes, '') || ' [BEKOR QILINDI: ' || v_clean_reason || ']',
         updated_at      = now()
   where id = v_sale.id;

  -- If this sale was linked to an individual piece, restore piece status to held_by_seller
  update public.consignment_pieces
     set status = 'held_by_seller',
         sale_id = null,
         sold_at = null,
         updated_at = now()
   where sale_id = v_sale.id;

  -- Audit log
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
    ) values (
      v_caller_org, 'jewelry_sales', v_sale.id::text, 'REVERSE_CLIENT_SALE', auth.uid(),
      jsonb_build_object(
        'sale_no', v_sale.sale_no,
        'base_weight_grams', v_sale.base_weight_grams,
        'client_gold_due_grams', v_sale.client_gold_due_grams,
        'customer_id', v_sale.customer_id,
        'seller_id', v_sale.seller_id
      ),
      jsonb_build_object('status', 'reversed'),
      v_clean_reason
    );
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'reversed_sale_id', v_sale.id,
    'reversed_sale_no', v_sale.sale_no,
    'customer_id', v_sale.customer_id,
    'seller_id', v_sale.seller_id,
    'restored_customer_debt_g', v_new_cust_debt,
    'restored_customer_advance_g', v_new_cust_adv,
    'restored_seller_client_debt_g', v_new_seller_debt,
    'reversal_reason', v_clean_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_sale', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_client_sale(uuid, text, text) to authenticated;

-- Update rpc_reverse_barcode_piece_sale to delegate to rpc_reverse_client_sale
create or replace function public.rpc_reverse_barcode_piece_sale(
  p_piece_id        uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_piece      public.consignment_pieces%rowtype;
begin
  select * into v_piece
    from public.consignment_pieces
   where id = p_piece_id and organization_id = v_caller_org;

  if not found then
    raise exception 'Mahsulot donasi topilmadi (%)', p_piece_id;
  end if;

  if v_piece.sale_id is null then
    raise exception 'Ushbu donaga bog''langan savdo hujjati topilmadi';
  end if;

  return public.rpc_reverse_client_sale(v_piece.sale_id, p_reason, p_idempotency_key);
end;
$$;

grant execute on function public.rpc_reverse_barcode_piece_sale(uuid, text, text) to authenticated;

-- 6. Multi-Currency rpc_record_client_settlement (Supports UZS, USD and Scrap)
drop function if exists public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid);
drop function if exists public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric);

create or replace function public.rpc_record_client_settlement(
  p_customer_id       uuid,
  p_sale_id           uuid default null,
  p_scrap_weight      numeric default 0,
  p_scrap_proba       numeric default null,
  p_cash_amount       numeric default 0, -- UZS
  p_rate_per_gram     numeric default null, -- 585 gold rate (UZS/g)
  p_settlement_date   date default current_date,
  p_notes             text default null,
  p_idempotency_key   text default null,
  p_seller_id         uuid default null,
  p_usd_amount        numeric default 0, -- USD
  p_usd_rate          numeric default null -- USD exchange rate (UZS/USD)
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
  v_usd_rate          numeric(18, 2);
  v_physical_scrap    numeric(14, 4);
  v_proba             numeric(6, 2);
  v_fine_gold         numeric(14, 4) := 0;
  v_scrap_585_eq      numeric(14, 4) := 0;
  v_cash              numeric(18, 2);
  v_usd               numeric(18, 2);
  v_cash_equiv        numeric(14, 4) := 0;
  v_usd_equiv         numeric(14, 4) := 0;
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
  v_usd  := round(greatest(0, coalesce(p_usd_amount, 0))::numeric, 2);

  if v_physical_scrap <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'To''lov uchun lom vazni, naqd so''m yoki dollar summasi kiritilishi shart';
  end if;

  -- 1. Scrap validation
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

  -- 2. 585 Gold rate determination (NO SILENT 900,000 FALLBACK!)
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
  end if;

  if (v_cash > 0 or v_usd > 0) and (v_rate is null or v_rate <= 0) then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Naqd pul yoki dollarni qabul qilish uchun 585 oltin kursi kiritilishi shart! Avval kunlik kursni belgilang.';
  end if;

  -- Sentinel rate for scrap-only to satisfy DB check constraint
  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0;
  end if;

  -- 3. USD rate determination (NO SILENT 12,850 FALLBACK!)
  if v_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) to''lovini hisoblash uchun USD kursi (CBU yoki qo''lda) kiritilishi shart!';
    end if;

    -- USD -> UZS -> 585 Gold Grams
    v_usd_equiv := round(((v_usd * v_usd_rate) / v_rate)::numeric, 4);
  else
    v_usd_rate := null;
    v_usd_equiv := 0;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    v_cash_equiv := 0;
  end if;

  -- 4. Total settled grams = scrap (in 585 eq) + UZS equiv + USD equiv
  v_total_settled := round(v_scrap_585_eq + v_cash_equiv + v_usd_equiv, 4);

  -- 5. Customer lookup
  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- 6. Seller lookup
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
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_client_settlement',
    'customer_id', p_customer_id,
    'scrap_weight', v_physical_scrap,
    'cash_amount', v_cash,
    'usd_amount', v_usd
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 7. Lock client gold account FOR UPDATE
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_prev_debt := coalesce(v_client_acc.current_debt_grams, 0);
  else
    v_prev_debt := 0;
  end if;

  -- Debt reduction math
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
    cash_paid_amount, currency, cash_equivalent_grams,
    usd_paid_amount, applied_usd_rate, usd_equivalent_grams,
    total_settled_grams, applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    status, notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settle_no, 'client_to_seller', v_seller.id, v_customer.id, p_sale_id,
    coalesce(p_settlement_date, current_date), v_rate,
    v_scrap_585_eq, v_physical_scrap, v_proba, v_fine_gold, v_scrap_585_eq,
    v_cash, 'UZS', v_cash_equiv,
    v_usd, v_usd_rate, v_usd_equiv,
    v_total_settled, v_applied_to_debt, v_excess_advance,
    v_prev_debt, v_rem_debt,
    'confirmed', p_notes, coalesce(public.current_employee_id(), v_seller.id), nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settle_id;

  -- 8. Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, 0,
    v_scrap_585_eq, v_cash, round(v_cash_equiv + v_usd_equiv, 4), v_total_settled,
    v_rem_debt, v_new_advance, now()
  )
  on conflict (customer_id) do update set
    total_scrap_paid_grams = round((client_gold_accounts.total_scrap_paid_grams + v_scrap_585_eq)::numeric, 4),
    total_cash_paid_amount = round((client_gold_accounts.total_cash_paid_amount + v_cash)::numeric, 2),
    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv + v_usd_equiv)::numeric, 4),
    total_settled_grams    = round((client_gold_accounts.total_settled_grams + v_total_settled)::numeric, 4),
    current_debt_grams     = v_rem_debt,
    advance_balance_grams  = v_new_advance,
    updated_at             = now();

  -- 9. Update seller till with received scrap, cash UZS and cash USD
  insert into public.seller_gold_accounts (
    seller_id, organization_id, seller_till_scrap_grams, seller_till_cash_amount, seller_till_usd_amount, updated_at
  ) values (
    v_seller.id, v_caller_org, v_scrap_585_eq, v_cash, v_usd, now()
  )
  on conflict (seller_id) do update set
    seller_till_scrap_grams = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585_eq)::numeric, 4),
    seller_till_cash_amount = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    seller_till_usd_amount  = round((coalesce(seller_gold_accounts.seller_till_usd_amount, 0) + v_usd)::numeric, 2),
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
    'usd_paid_amount', v_usd,
    'usd_rate_applied', v_usd_rate,
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
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

grant execute on function public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric) to authenticated;

-- 7. Multi-Currency rpc_record_seller_to_manager_settlement
drop function if exists public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text);
drop function if exists public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text, numeric, numeric);

create or replace function public.rpc_record_seller_to_manager_settlement(
  p_seller_id           uuid,
  p_scrap_weight_grams  numeric default 0,
  p_cash_paid_amount    numeric default 0, -- UZS
  p_rate_per_gram       numeric default null, -- 585 gold rate
  p_notes               text default null,
  p_idempotency_key     text default null,
  p_usd_paid_amount     numeric default 0, -- USD
  p_usd_rate            numeric default null -- USD exchange rate
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
  v_usd_rate        numeric(18, 2);
  v_scrap_w         numeric(14, 4);
  v_cash            numeric(18, 2);
  v_usd             numeric(18, 2);
  v_cash_equiv      numeric(14, 4) := 0;
  v_usd_equiv       numeric(14, 4) := 0;
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
  v_usd  := round(greatest(0, coalesce(p_usd_paid_amount, 0))::numeric, 2);

  if v_scrap_w <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'Settlement must include either scrap gold grams, UZS cash, or USD cash';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_seller_to_manager_settlement',
    'seller_id', p_seller_id,
    'scrap_w', v_scrap_w,
    'cash', v_cash,
    'usd', v_usd
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
    raise exception 'ERR_INSUFFICIENT_CASH_BALANCE: Sotuvchi kassasida yetarli naqd pul (UZS) mavjud emas (Kassada: % UZS, Talab: % UZS)',
      v_seller_acc.seller_till_cash_amount, v_cash;
  end if;

  if v_usd > 0 and coalesce(v_seller_acc.seller_till_usd_amount, 0) < v_usd then
    raise exception 'ERR_INSUFFICIENT_USD_BALANCE: Sotuvchi kassasida yetarli dollar (USD) mavjud emas (Kassada: % USD, Talab: % USD)',
      coalesce(v_seller_acc.seller_till_usd_amount, 0), v_usd;
  end if;

  -- 4. Gold Rate determination
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    select rate_per_gram into v_rate
    from public.daily_gold_rates
    where organization_id = v_org_id and proba = 585 and is_confirmed = true
    order by rate_date desc, created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      select rate_per_gram into v_rate
      from public.daily_gold_rates
      where organization_id = v_org_id and proba = 585
      order by rate_date desc, created_at desc
      limit 1;
    end if;

    if (v_cash > 0 or v_usd > 0) and (v_rate is null or v_rate <= 0) then
      raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi 585 oltin kursi belgilanmagan! Naqd pul topshirish uchun avval kunlik kursni kiriting.';
    end if;
  end if;

  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0; -- Safe sentinel rate for DB check constraint (gold_rate_applied > 0) when cash is 0
  end if;

  -- 5. USD Rate determination
  if v_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) topshirish uchun USD kursi kiritilishi shart!';
    end if;
    v_usd_equiv := round(((v_usd * v_usd_rate) / v_rate)::numeric, 4);
  else
    v_usd_rate := null;
    v_usd_equiv := 0;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    v_cash_equiv := 0;
  end if;

  v_total_settled := round(v_scrap_w + v_cash_equiv + v_usd_equiv, 4);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
    if v_caller_emp_id is null then
      v_caller_emp_id := p_seller_id;
    end if;
  end if;

  -- 6. Deduct exactly from seller till
  update public.seller_gold_accounts
  set seller_till_scrap_grams = round(seller_till_scrap_grams - v_scrap_w, 4),
      seller_till_cash_amount = round(seller_till_cash_amount - v_cash, 2),
      seller_till_usd_amount  = round(coalesce(seller_till_usd_amount, 0) - v_usd, 2),
      updated_at = now()
  where seller_id = p_seller_id;

  -- 7. Add to manager vault
  update public.manager_vault_account
  set manager_scrap_grams = round(manager_scrap_grams + v_scrap_w, 4),
      manager_cash_amount = round(manager_cash_amount + v_cash, 2),
      manager_usd_amount  = round(coalesce(manager_usd_amount, 0) + v_usd, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  -- 8. Insert gold settlement
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
    usd_paid_amount,
    applied_usd_rate,
    usd_equivalent_grams,
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
    v_usd,
    v_usd_rate,
    v_usd_equiv,
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

  -- 9. Read synced seller gold account
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
    'usd_amount_settled', v_usd,
    'applied_usd_rate', v_usd_rate,
    'applied_rate_per_gram', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
    'total_settled_grams', v_total_settled,
    'remaining_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'seller_till_usd_amount', v_seller_acc.seller_till_usd_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text, numeric, numeric) to authenticated;

-- 8. Multi-Currency rpc_reverse_seller_to_manager_settlement
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
  v_usd              numeric(18, 2);
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

  v_usd := coalesce(v_settle.usd_paid_amount, 0);

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
    raise exception 'Boshqaruvchi seyfida yetarli naqd pul (UZS) mavjud emas (Seyfda: % UZS, talab: % UZS).',
      v_vault.manager_cash_amount, v_settle.cash_paid_amount;
  end if;

  if v_usd > 0 and coalesce(v_vault.manager_usd_amount, 0) < v_usd then
    raise exception 'Boshqaruvchi seyfida yetarli dollar (USD) mavjud emas (Seyfda: % USD, talab: % USD).',
      coalesce(v_vault.manager_usd_amount, 0), v_usd;
  end if;

  -- 4. Deduct scrap, UZS & USD from manager vault
  update public.manager_vault_account
     set manager_scrap_grams = round(manager_scrap_grams - v_settle.scrap_weight_grams, 4),
         manager_cash_amount = round(manager_cash_amount - v_settle.cash_paid_amount, 2),
         manager_usd_amount  = round(coalesce(manager_usd_amount, 0) - v_usd, 2),
         updated_at          = now()
   where organization_id = v_caller_org
  returning * into v_vault;

  -- 5. Return scrap, UZS & USD to seller till
  update public.seller_gold_accounts
     set seller_till_scrap_grams = round(seller_till_scrap_grams + v_settle.scrap_weight_grams, 4),
         seller_till_cash_amount = round(seller_till_cash_amount + v_settle.cash_paid_amount, 2),
         seller_till_usd_amount  = round(coalesce(seller_till_usd_amount, 0) + v_usd, 2),
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
    cash_equivalent_grams, usd_paid_amount, applied_usd_rate, usd_equivalent_grams,
    total_settled_grams, status, reversal_of_id, reversal_reason,
    previous_debt_grams, remaining_debt_grams,
    notes, recorded_by
  ) values (
    v_caller_org, v_comp_settle_no, 'seller_to_manager', v_settle.seller_id,
    v_settle.gold_rate_applied, v_settle.scrap_weight_grams, v_settle.cash_paid_amount,
    coalesce(v_settle.cash_equivalent_grams, 0), v_usd, v_settle.applied_usd_rate, coalesce(v_settle.usd_equivalent_grams, 0),
    v_settle.total_settled_grams, 'reversed', v_settle.id, v_clean_reason,
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
        'usd_paid', v_usd,
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
    'usd_returned_amount', v_usd,
    'restored_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'seller_till_usd_amount', v_seller_acc.seller_till_usd_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_seller_to_manager_settlement(uuid, text, text) to authenticated;
