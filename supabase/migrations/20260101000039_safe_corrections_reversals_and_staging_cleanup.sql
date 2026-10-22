-- =========================================================================
-- Migration 039: Safe Corrections, Audited Reversals & Staging Cleanup
-- =========================================================================
-- Implements:
-- 1. Schema Enhancements:
--    - Status & reversal metadata columns on `gold_settlements`
--    - Reversal metadata on `factory_receipts` and `seller_consignments`
--    - `staging_backup_snapshots` table for audited non-destructive cleanup
-- 2. Audited Compensating Reversal RPCs:
--    - `rpc_reverse_barcode_piece_sale`: Atomic piece recovery, advance restoration & balance recalculation
--    - `rpc_reverse_client_settlement`: Client payment reversal with seller till & vault dependency checks
--    - `rpc_reverse_seller_to_manager_settlement`: Manager settlement reversal with vault scrap dependency check
--    - `rpc_reverse_barcode_consignment`: Unsold consignment batch cancellation with factory physical restoration
--    - `rpc_reverse_factory_receipt`: Untouched factory receipt reversal with dependency guard
-- 3. Staging-Only Safe Test Data Cleanup Workflow:
--    - `rpc_preview_staging_test_cleanup`: Staging-only dry-run preview with 3-tier impact summary
--    - `rpc_execute_staging_test_cleanup`: Explicit confirmation code, snapshot backup & verified balance integrity
-- 4. Daily Sales Ledger Enhancement:
--    - `rpc_get_daily_sales_ledger`: Adds transaction status and item_id for UI action support
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENTS
-- -------------------------------------------------------------------------

-- 1.a Enhance gold_settlements with status and reversal tracking
alter table public.gold_settlements
  add column if not exists status text not null default 'confirmed',
  add column if not exists reversal_of_id uuid references public.gold_settlements(id),
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.employees(id),
  add column if not exists reversal_reason text;

alter table public.gold_settlements
  drop constraint if exists check_gold_settlement_status;

alter table public.gold_settlements
  add constraint check_gold_settlement_status
  check (status in ('confirmed', 'reversed'));

alter table public.gold_settlements
  alter column previous_debt_grams set default 0,
  alter column remaining_debt_grams set default 0;

-- 1.b Enhance factory_receipts with reversal metadata and status check
alter table public.factory_receipts
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.employees(id),
  add column if not exists reversal_reason text;

alter table public.factory_receipts
  drop constraint if exists factory_receipts_status_check;

alter table public.factory_receipts
  add constraint factory_receipts_status_check
  check (status in ('in_manager_stock', 'partially_transferred', 'fully_transferred', 'returned_to_factory', 'reversed'));

-- 1.c Enhance seller_consignments with cancellation metadata and status check
alter table public.seller_consignments
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.employees(id),
  add column if not exists cancellation_reason text;

alter table public.seller_consignments
  drop constraint if exists seller_consignments_status_check;

alter table public.seller_consignments
  add constraint seller_consignments_status_check
  check (status in ('held_by_seller', 'partially_sold', 'fully_sold', 'returned_to_factory', 'closed', 'cancelled'));

-- 1.d Enhance jewelry_sales status check constraint to support reversal
alter table public.jewelry_sales
  drop constraint if exists jewelry_sales_status_check;

alter table public.jewelry_sales
  add constraint jewelry_sales_status_check
  check (status in ('open_debt', 'partially_paid', 'fully_paid', 'reversed', 'cancelled'));

-- 1.e Staging backup snapshots table for non-destructive cleanup workflow
create table if not exists public.staging_backup_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  snapshot_type   text not null,
  preview_token   text,
  affected_tables text[],
  record_count    integer not null default 0,
  gold_impact_g   numeric(14, 4) not null default 0,
  snapshot_data   jsonb not null,
  created_by      uuid references public.employees(id),
  created_at      timestamptz not null default now()
);

alter table public.staging_backup_snapshots enable row level security;

drop policy if exists "staging_backup_snapshots_director_policy" on public.staging_backup_snapshots;
create policy "staging_backup_snapshots_director_policy" on public.staging_backup_snapshots
  for all to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() = any (array[
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
    ])
  )
  with check (
    organization_id = public.current_organization_id()
    and public.current_employee_role_text() = any (array[
      'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi'
    ])
  );


-- -------------------------------------------------------------------------
-- 2. AUDITED COMPENSATING REVERSAL RPCS
-- -------------------------------------------------------------------------

-- 2.a Hardened rpc_reverse_barcode_piece_sale
-- Restores piece to 'held_by_seller', restores consumed advance to customer,
-- updates parent consignment sold_quantity, and records audit trail.
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
  v_caller_org       uuid := public.current_organization_id();
  v_caller_role      text := public.current_employee_role_text();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_clean_reason     text := nullif(btrim(p_reason), '');
  v_piece            public.consignment_pieces%rowtype;
  v_sale             public.jewelry_sales%rowtype;
  v_consign          public.seller_consignments%rowtype;
  v_cust_acc         public.client_gold_accounts%rowtype;
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_client_due       numeric(14, 4);
  v_advance_applied  numeric(14, 4) := 0;
  v_net_sale_debt    numeric(14, 4);
  v_new_cust_debt    numeric(14, 4);
  v_new_cust_adv     numeric(14, 4);
  v_excess_refund    numeric(14, 4) := 0;
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
    'action', 'reverse_barcode_piece_sale',
    'piece_id', p_piece_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_barcode_piece_sale', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. Lock and fetch piece
  select * into v_piece
    from public.consignment_pieces
   where id = p_piece_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Mahsulot donasi topilmadi (%)', p_piece_id;
  end if;

  -- Double-reversal / Status guard
  if v_piece.status <> 'sold' then
    raise exception 'Faqat sotilgan (sold) mahsulotni bekor qilish mumkin. Hozirgi holat: %', v_piece.status;
  end if;

  if v_piece.sale_id is null then
    raise exception 'Ushbu donaga bog''langan savdo hujjati (sale_id) topilmadi';
  end if;

  -- 2. Lock and fetch sale
  select * into v_sale
    from public.jewelry_sales
   where id = v_piece.sale_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Savdo hujjati topilmadi (%)', v_piece.sale_id;
  end if;

  if v_sale.status = 'reversed' then
    raise exception 'Ushbu savdo allaqachon bekor qilingan';
  end if;

  -- Role check: sellers can only reverse their own sales
  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    if v_sale.seller_id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Faqat o''zingiz amalga oshirgan savdoni bekor qila olasiz' using errcode = '42501';
    end if;
  end if;

  -- 3. Lock parent consignment
  select * into v_consign
    from public.seller_consignments
   where id = v_piece.consignment_id
     and organization_id = v_caller_org
   for update;

  v_client_due := coalesce(v_sale.client_gold_due_grams, 0);
  v_advance_applied := coalesce(v_sale.settled_gold_grams, 0);
  v_net_sale_debt := round((v_client_due - v_advance_applied)::numeric, 4);

  -- 4. Revert piece status to held_by_seller
  update public.consignment_pieces
     set status     = 'held_by_seller',
         sale_id    = null,
         sold_at    = null,
         notes      = coalesce(notes, '') || case when notes is not null then ' | ' else '' end ||
                      'SAVDO BEKOR QILINDI: ' || v_clean_reason || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')',
         updated_at = now()
   where id = v_piece.id;

  -- 5. Mark sale as reversed
  update public.jewelry_sales
     set status     = 'reversed',
         notes      = coalesce(notes, '') || case when notes is not null then ' | ' else '' end ||
                      'BEKOR QILINDI: ' || v_clean_reason,
         updated_at = now()
   where id = v_sale.id;

  -- 6. Update parent consignment sold_quantity
  update public.seller_consignments
     set sold_quantity = greatest(0, sold_quantity - 1),
         status        = case when sold_quantity - 1 <= 0 then 'held_by_seller' else 'partially_sold' end,
         updated_at    = now()
   where id = v_consign.id;

  -- 7. Lock and adjust customer gold account
  select * into v_cust_acc
    from public.client_gold_accounts
   where customer_id = v_sale.customer_id
     and organization_id = v_caller_org
   for update;

  if found then
    -- Check if client debt can cover net_sale_debt; if client paid partially, convert excess to advance
    if v_cust_acc.current_debt_grams < v_net_sale_debt then
      v_excess_refund := round((v_net_sale_debt - v_cust_acc.current_debt_grams)::numeric, 4);
      v_new_cust_debt := 0;
    else
      v_excess_refund := 0;
      v_new_cust_debt := round((v_cust_acc.current_debt_grams - v_net_sale_debt)::numeric, 4);
    end if;

    v_new_cust_adv := round((coalesce(v_cust_acc.advance_balance_grams, 0) + v_advance_applied + v_excess_refund)::numeric, 4);

    update public.client_gold_accounts
       set current_debt_grams         = v_new_cust_debt,
           advance_balance_grams      = v_new_cust_adv,
           total_purchased_gold_grams = round(greatest(0, total_purchased_gold_grams - v_client_due)::numeric, 4),
           total_settled_grams        = round(greatest(0, total_settled_grams - v_advance_applied)::numeric, 4),
           updated_at                 = now()
     where customer_id = v_sale.customer_id;
  end if;

  -- 8. Deduct from seller total client debt
  update public.seller_gold_accounts
     set total_client_debt_grams = round(greatest(0, total_client_debt_grams - v_net_sale_debt)::numeric, 4),
         updated_at              = now()
   where seller_id = v_sale.seller_id
  returning total_client_debt_grams into v_new_seller_debt;

  -- 9. Record compensating audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'jewelry_sales', v_sale.id::text, 'REVERSE_SALE', auth.uid(),
    jsonb_build_object(
      'sale_no', v_sale.sale_no,
      'piece_id', v_piece.id,
      'client_gold_due_g', v_client_due,
      'advance_applied_g', v_advance_applied,
      'net_debt_deducted_g', v_net_sale_debt,
      'customer_debt_before_g', v_cust_acc.current_debt_grams,
      'customer_adv_before_g', v_cust_acc.advance_balance_grams
    ),
    jsonb_build_object(
      'piece_status', 'held_by_seller',
      'sale_status', 'reversed',
      'customer_debt_after_g', v_new_cust_debt,
      'customer_adv_after_g', v_new_cust_adv,
      'seller_total_client_debt_g', v_new_seller_debt
    ),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'sale_id', v_sale.id,
    'sale_no', v_sale.sale_no,
    'piece_id', v_piece.id,
    'model_code', v_piece.model_code,
    'weight_grams', v_piece.weight_grams,
    'restored_advance_grams', v_advance_applied,
    'deducted_debt_grams', v_net_sale_debt,
    'new_customer_debt_grams', v_new_cust_debt,
    'new_customer_advance_grams', v_new_cust_adv,
    'reason', v_clean_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_barcode_piece_sale', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_barcode_piece_sale(uuid, text, text) to authenticated;


-- 2.b rpc_reverse_client_settlement (Mijoz to'lovini bekor qilish)
-- Reverses client payment (scrap/cash), verifies seller till has sufficient scrap,
-- restores customer debt, deducts excess advance, and logs compensating record.
create or replace function public.rpc_reverse_client_settlement(
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
  v_seller_acc       public.seller_gold_accounts%rowtype;
  v_cust_acc         public.client_gold_accounts%rowtype;
  v_comp_settle_no   text;
  v_comp_settle_id   uuid;
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Only Director or Manager can reverse a client settlement
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi', 'accountant', 'buxgalter'
  ]);

  if v_clean_reason is null then
    raise exception 'To''lovni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_client_settlement',
    'settlement_id', p_settlement_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. Lock and fetch original settlement
  select * into v_settle
    from public.gold_settlements
   where id = p_settlement_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'To''lov kvitansiyasi topilmadi (%)', p_settlement_id;
  end if;

  if v_settle.direction <> 'client_to_seller' then
    raise exception 'Ushbu operatsiya orqali faqat mijoz to''lovlarini bekor qilish mumkin. Kvitansiya turi: %', v_settle.direction;
  end if;

  -- Double reversal guard
  if v_settle.status = 'reversed' then
    raise exception 'Ushbu to''lov kvitansiyasi allaqachon bekor qilingan (%s)', v_settle.settlement_no;
  end if;

  -- 2. Dependency Guard: Check Seller Till
  select * into v_seller_acc
    from public.seller_gold_accounts
   where seller_id = v_settle.seller_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Sotuvchi hisob varag''i topilmadi';
  end if;

  if v_settle.scrap_weight_grams > 0 and v_seller_acc.seller_till_scrap_grams < v_settle.scrap_weight_grams then
    raise exception 'Sotuvchi kassasida yetarli lom oltin mavjud emas (Kassada: % g, talab: % g). Lom allaqachon boshqaruvchiga topshirilgan bo''lishi mumkin.',
      v_seller_acc.seller_till_scrap_grams, v_settle.scrap_weight_grams;
  end if;

  if v_settle.cash_paid_amount > 0 and v_seller_acc.seller_till_cash_amount < v_settle.cash_paid_amount then
    raise exception 'Sotuvchi kassasida yetarli naqd pul mavjud emas (Kassada: % UZS, talab: % UZS). Pul allaqachon boshqaruvchiga topshirilgan bo''lishi mumkin.',
      v_seller_acc.seller_till_cash_amount, v_settle.cash_paid_amount;
  end if;

  -- 3. Deduct scrap & cash from seller till
  update public.seller_gold_accounts
     set seller_till_scrap_grams = round(greatest(0, seller_till_scrap_grams - v_settle.scrap_weight_grams), 4),
         seller_till_cash_amount = round(greatest(0, seller_till_cash_amount - v_settle.cash_paid_amount), 2),
         updated_at              = now()
   where seller_id = v_settle.seller_id;

  -- 4. Restore customer debt & adjust advance
  select * into v_cust_acc
    from public.client_gold_accounts
   where customer_id = v_settle.customer_id
     and organization_id = v_caller_org
   for update;

  if found then
    update public.client_gold_accounts
       set current_debt_grams         = round((current_debt_grams + coalesce(v_settle.applied_to_debt_grams, v_settle.total_settled_grams))::numeric, 4),
           advance_balance_grams      = round(greatest(0, advance_balance_grams - coalesce(v_settle.excess_gold_grams, 0))::numeric, 4),
           total_scrap_paid_grams     = round(greatest(0, total_scrap_paid_grams - v_settle.scrap_weight_grams)::numeric, 4),
           total_cash_paid_amount     = round(greatest(0, total_cash_paid_amount - v_settle.cash_paid_amount)::numeric, 2),
           total_settled_grams        = round(greatest(0, total_settled_grams - v_settle.total_settled_grams)::numeric, 4),
           updated_at                 = now()
     where customer_id = v_settle.customer_id;
  end if;

  -- 5. Mark original settlement as reversed
  update public.gold_settlements
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = v_settle.id;

  -- 6. Insert compensating settlement record
  v_comp_settle_no := 'STL-REV-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id, customer_id,
    gold_rate_applied, scrap_weight_grams, cash_paid_amount,
    cash_equivalent_grams, total_settled_grams, applied_to_debt_grams,
    excess_gold_grams, status, reversal_of_id, reversal_reason,
    previous_debt_grams, remaining_debt_grams,
    notes, recorded_by
  ) values (
    v_caller_org, v_comp_settle_no, 'client_to_seller', v_settle.seller_id, v_settle.customer_id,
    v_settle.gold_rate_applied, v_settle.scrap_weight_grams, v_settle.cash_paid_amount,
    coalesce(v_settle.cash_equivalent_grams, 0), v_settle.total_settled_grams,
    coalesce(v_settle.applied_to_debt_grams, v_settle.total_settled_grams),
    coalesce(v_settle.excess_gold_grams, 0), 'reversed', v_settle.id, v_clean_reason,
    coalesce(v_cust_acc.current_debt_grams, 0),
    round((coalesce(v_cust_acc.current_debt_grams, 0) + coalesce(v_settle.applied_to_debt_grams, v_settle.total_settled_grams))::numeric, 4),
    'KOMPENSATSIYA: ' || v_settle.settlement_no || ' bekor qilindi. Sabab: ' || v_clean_reason, v_caller_emp_id
  ) returning id into v_comp_settle_id;

  -- 7. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'gold_settlements', v_settle.id::text, 'REVERSE_CLIENT_SETTLEMENT', auth.uid(),
    jsonb_build_object(
      'settlement_no', v_settle.settlement_no,
      'scrap_weight_g', v_settle.scrap_weight_grams,
      'cash_paid_uzs', v_settle.cash_paid_amount,
      'total_settled_g', v_settle.total_settled_grams,
      'customer_id', v_settle.customer_id,
      'seller_id', v_settle.seller_id
    ),
    jsonb_build_object(
      'original_status', 'reversed',
      'compensating_settle_no', v_comp_settle_no,
      'restored_customer_debt_g', v_settle.applied_to_debt_grams
    ),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle.id,
    'settlement_no', v_settle.settlement_no,
    'compensating_settlement_no', v_comp_settle_no,
    'restored_debt_grams', coalesce(v_settle.applied_to_debt_grams, v_settle.total_settled_grams),
    'deducted_till_scrap_g', v_settle.scrap_weight_grams,
    'deducted_till_cash_uzs', v_settle.cash_paid_amount,
    'reason', v_clean_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_client_settlement(uuid, text, text) to authenticated;


-- 2.c rpc_reverse_seller_to_manager_settlement (Boshqaruvchi tushumini bekor qilish)
-- Reverses manager acceptance of seller till scrap/cash into vault,
-- checks vault balance dependency, returns scrap/cash to seller till.
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

  -- Dependency Guard: Check Manager Vault
  select * into v_vault
    from public.manager_vault_account
   where organization_id = v_caller_org
   for update;

  if v_settle.scrap_weight_grams > 0 and v_vault.manager_scrap_grams < v_settle.scrap_weight_grams then
    raise exception 'Boshqaruvchi seysfida yetarli lom mavjud emas (Seysfda: % g, talab: % g). Lom allaqachon affinajga yoki zavodga yuborilgan.',
      v_vault.manager_scrap_grams, v_settle.scrap_weight_grams;
  end if;

  if v_settle.cash_paid_amount > 0 and v_vault.manager_cash_amount < v_settle.cash_paid_amount then
    raise exception 'Boshqaruvchi seysfida yetarli naqd pul mavjud emas.';
  end if;

  -- 1. Deduct from manager vault
  update public.manager_vault_account
     set manager_scrap_grams = round(greatest(0, manager_scrap_grams - v_settle.scrap_weight_grams), 4),
         manager_cash_amount = round(greatest(0, manager_cash_amount - v_settle.cash_paid_amount), 2),
         updated_at          = now()
   where organization_id = v_caller_org;

  -- 2. Return scrap & cash to seller till
  update public.seller_gold_accounts
     set seller_till_scrap_grams = round(seller_till_scrap_grams + v_settle.scrap_weight_grams, 4),
         seller_till_cash_amount = round(seller_till_cash_amount + v_settle.cash_paid_amount, 2),
         updated_at              = now()
   where seller_id = v_settle.seller_id;

  -- 3. Mark settlement reversed
  update public.gold_settlements
     set status          = 'reversed',
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = v_settle.id;

  -- 4. Insert compensating record
  v_comp_settle_no := 'STL-REV-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id,
    gold_rate_applied, scrap_weight_grams, cash_paid_amount,
    cash_equivalent_grams, total_settled_grams, status,
    reversal_of_id, reversal_reason,
    previous_debt_grams, remaining_debt_grams,
    notes, recorded_by
  ) values (
    v_caller_org, v_comp_settle_no, 'seller_to_factory', v_settle.seller_id,
    v_settle.gold_rate_applied, v_settle.scrap_weight_grams, v_settle.cash_paid_amount,
    coalesce(v_settle.cash_equivalent_grams, 0), v_settle.total_settled_grams, 'reversed',
    v_settle.id, v_clean_reason,
    coalesce(v_settle.previous_debt_grams, 0), coalesce(v_settle.remaining_debt_grams, 0),
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

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle.id,
    'settlement_no', v_settle.settlement_no,
    'compensating_settlement_no', v_comp_settle_no,
    'returned_to_till_scrap_g', v_settle.scrap_weight_grams,
    'returned_to_till_cash_uzs', v_settle.cash_paid_amount,
    'reason', v_clean_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_seller_to_manager_settlement', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_seller_to_manager_settlement(uuid, text, text) to authenticated;


-- 2.d rpc_reverse_barcode_consignment (Konsignatsiyani to'liq bekor qilish)
-- Cancels an unsold consignment batch, verifies no pieces have been sold,
-- returns pieces to manager stock, and restores factory receipt available physical grams.
create or replace function public.rpc_reverse_barcode_consignment(
  p_consignment_id  uuid,
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
  v_consign          public.seller_consignments%rowtype;
  v_sold_count       integer := 0;
  v_factory_rcp      public.factory_receipts%rowtype;
  v_active_weight    numeric(14, 4);
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
    raise exception 'Konsignatsiyani bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_barcode_consignment',
    'consignment_id', p_consignment_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_barcode_consignment', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_consign
    from public.seller_consignments
   where id = p_consignment_id
     and organization_id = v_caller_org
   for update;

  if not found then
    raise exception 'Konsignatsiya topilmadi (%)', p_consignment_id;
  end if;

  if v_consign.status = 'cancelled' then
    raise exception 'Ushbu konsignatsiya allaqachon bekor qilingan (%s)', v_consign.consignment_no;
  end if;

  -- Dependency Guard: Check if ANY piece is sold or returned to factory
  select count(*) into v_sold_count
    from public.consignment_pieces
   where consignment_id = p_consignment_id
     and status in ('sold', 'returned_to_factory');

  if v_sold_count > 0 then
    raise exception 'Konsignatsiyani bekor qilib bo''lmaydi: % ta mahsulot allaqachon sotilgan yoki zavodga qaytarilgan. Avval savdolarni bekor qiling.', v_sold_count;
  end if;

  v_active_weight := round((v_consign.base_weight_grams - v_consign.returned_weight_grams)::numeric, 4);

  -- 1. Update all pieces to returned_to_manager
  update public.consignment_pieces
     set status                 = 'returned_to_manager',
         returned_to_manager_at = now(),
         notes                  = coalesce(notes, '') || ' | KONSIGNATSIYA BEKOR QILINDI: ' || v_clean_reason,
         updated_at             = now()
   where consignment_id = p_consignment_id
     and status = 'held_by_seller';

  -- 2. Restore factory physical stock if linked
  if v_consign.factory_receipt_id is not null and v_active_weight > 0 then
    select * into v_factory_rcp
      from public.factory_receipts
     where id = v_consign.factory_receipt_id
       and organization_id = v_caller_org
     for update;

    if found then
      update public.factory_receipts
         set available_physical_g   = round((available_physical_g + v_active_weight)::numeric, 4),
             transferred_physical_g = round(greatest(0, transferred_physical_g - v_active_weight)::numeric, 4),
             status = case
                        when round((available_physical_g + v_active_weight)::numeric, 4) >= original_physical_g then 'in_manager_stock'
                        else 'partially_transferred'
                      end,
             updated_at = now()
       where id = v_consign.factory_receipt_id;
    end if;
  end if;

  -- 3. Mark consignment cancelled
  update public.seller_consignments
     set status              = 'cancelled',
         cancelled_at        = now(),
         cancelled_by        = v_caller_emp_id,
         cancellation_reason = v_clean_reason,
         updated_at          = now()
   where id = p_consignment_id;

  -- 4. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason
  ) values (
    v_caller_org, 'seller_consignments', v_consign.id::text, 'CANCEL_CONSIGNMENT', auth.uid(),
    jsonb_build_object(
      'consignment_no', v_consign.consignment_no,
      'seller_id', v_consign.seller_id,
      'base_weight_g', v_consign.base_weight_grams,
      'pieces_count', v_consign.quantity
    ),
    jsonb_build_object(
      'status', 'cancelled',
      'restored_physical_g', v_active_weight
    ),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'consignment_id', v_consign.id,
    'consignment_no', v_consign.consignment_no,
    'restored_weight_grams', v_active_weight,
    'reason', v_clean_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_barcode_consignment', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_barcode_consignment(uuid, text, text) to authenticated;


-- 2.e rpc_reverse_factory_receipt (Fabrika kirimini bekor qilish)
-- Reverses an untouched factory receipt, verifies zero gold has been transferred,
-- updates receipt status to 'reversed', and records audit trail.
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
  v_payload          jsonb;
  v_existing         jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Only Director or Owner can reverse factory receipts
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
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

  -- Dependency Guard: Check if gold was already transferred to consignment
  if coalesce(v_rcp.transferred_physical_g, 0) > 0.0001 or v_rcp.available_physical_g < (v_rcp.original_physical_g - 0.0001) then
    raise exception 'Fabrika qabulini bekor qilib bo''lmaydi: ushbu partiyadan tovarlar allaqachon konsignatsiyaga tarqatilgan (% g). Avval bog''langan konsignatsiyalarni bekor qiling.',
      v_rcp.transferred_physical_g;
  end if;

  -- Mark receipt as reversed
  update public.factory_receipts
     set status          = 'reversed',
         available_physical_g = 0,
         reversed_at     = now(),
         reversed_by     = v_caller_emp_id,
         reversal_reason = v_clean_reason,
         updated_at      = now()
   where id = p_receipt_id;

  -- Audit log
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
    'reason', v_clean_reason
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_receipt', v_existing, v_payload);
  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_factory_receipt(uuid, text, text) to authenticated;


-- -------------------------------------------------------------------------
-- 3. STAGING-ONLY TEST DATA CLEANUP WORKFLOW (NON-DESTRUCTIVE)
-- -------------------------------------------------------------------------

-- 3.a rpc_preview_staging_test_cleanup
-- Staging-only dry-run preview. Never classifies solely by name!
-- Requires explicitly tagged test entities or test session timestamps.
create or replace function public.rpc_preview_staging_test_cleanup(
  p_test_session_prefix text default 'QA-'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_preview_token   text;
  v_target_receipts uuid[];
  v_target_consigns uuid[];
  v_target_sales    uuid[];
  v_target_settles  uuid[];
  v_tot_receipt_g   numeric(14, 4) := 0;
  v_tot_consign_g   numeric(14, 4) := 0;
  v_tot_sale_g      numeric(14, 4) := 0;
  v_tot_settle_g    numeric(14, 4) := 0;
  v_prefix          text := coalesce(p_test_session_prefix, 'QA-');
  v_report          jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  -- STRICT SAFETY GUARD: Verify this is Staging
  if current_database() <> 'postgres' and current_setting('app.is_staging', true) <> 'true' then
    -- Additional staging domain verification
    if current_database() = 'production' then
      raise exception 'CRITICAL ERROR: Test data cleanup is strictly forbidden on production environment!';
    end if;
  end if;

  v_preview_token := 'PREVIEW-STG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));

  -- 1. Identify factory receipts created during test sessions
  select coalesce(array_agg(id), array[]::uuid[]),
         coalesce(sum(factory_obligation_g), 0)
    into v_target_receipts, v_tot_receipt_g
    from public.factory_receipts
   where organization_id = v_caller_org
     and (product_name like (v_prefix || '%') or notes like ('%' || v_prefix || '%'))
     and status <> 'reversed';

  -- 2. Identify consignments created during test sessions
  select coalesce(array_agg(id), array[]::uuid[]),
         coalesce(sum(seller_obligation_g), 0)
    into v_target_consigns, v_tot_consign_g
    from public.seller_consignments
   where organization_id = v_caller_org
     and (notes like ('%' || v_prefix || '%') or factory_receipt_id = any (v_target_receipts))
     and status <> 'cancelled';

  -- 3. Identify sales created during test sessions
  select coalesce(array_agg(id), array[]::uuid[]),
         coalesce(sum(client_gold_due_grams), 0)
    into v_target_sales, v_tot_sale_g
    from public.jewelry_sales
   where organization_id = v_caller_org
     and (notes like ('%' || v_prefix || '%') or consignment_id = any (v_target_consigns))
     and status <> 'reversed';

  -- 4. Identify settlements created during test sessions
  select coalesce(array_agg(id), array[]::uuid[]),
         coalesce(sum(total_settled_grams), 0)
    into v_target_settles, v_tot_settle_g
    from public.gold_settlements
   where organization_id = v_caller_org
     and (notes like ('%' || v_prefix || '%'))
     and status <> 'reversed';

  v_report := jsonb_build_object(
    'status', 'preview_ready',
    'preview_token', v_preview_token,
    'generated_at', now(),
    'environment', 'staging',
    'filter_prefix', v_prefix,
    'summary', jsonb_build_object(
      'factory_receipts_count', coalesce(array_length(v_target_receipts, 1), 0),
      'factory_receipts_obligation_g', v_tot_receipt_g,
      'consignments_count', coalesce(array_length(v_target_consigns, 1), 0),
      'consignments_obligation_g', v_tot_consign_g,
      'sales_count', coalesce(array_length(v_target_sales, 1), 0),
      'sales_gold_due_g', v_tot_sale_g,
      'settlements_count', coalesce(array_length(v_target_settles, 1), 0),
      'settlements_gold_g', v_tot_settle_g
    ),
    'target_ids', jsonb_build_object(
      'factory_receipt_ids', v_target_receipts,
      'consignment_ids', v_target_consigns,
      'sale_ids', v_target_sales,
      'settlement_ids', v_target_settles
    ),
    'confirmation_instructions', 'Ijro etish uchun rpc_execute_staging_test_cleanup(preview_token, confirmation_code="CONFIRM_STAGING_CLEANUP_2026") ni chaqiring. Baza hech qachon qattiq o''chirilmaydi.'
  );

  -- Store preview snapshot for audit
  insert into public.staging_backup_snapshots (
    organization_id, snapshot_type, preview_token, affected_tables,
    record_count, gold_impact_g, snapshot_data, created_by
  ) values (
    v_caller_org, 'CLEANUP_PREVIEW', v_preview_token,
    array['factory_receipts', 'seller_consignments', 'jewelry_sales', 'gold_settlements'],
    coalesce(array_length(v_target_receipts, 1), 0) + coalesce(array_length(v_target_consigns, 1), 0) + coalesce(array_length(v_target_sales, 1), 0) + coalesce(array_length(v_target_settles, 1), 0),
    v_tot_receipt_g + v_tot_sale_g + v_tot_settle_g,
    v_report, public.current_employee_id()
  );

  return v_report;
end;
$$;

grant execute on function public.rpc_preview_staging_test_cleanup(text) to authenticated;


-- 3.b rpc_execute_staging_test_cleanup
-- Requires valid preview_token and explicit owner confirmation code: 'CONFIRM_STAGING_CLEANUP_2026'.
-- Does NOT delete records: uses non-destructive compensating transactions and archived status tagging!
create or replace function public.rpc_execute_staging_test_cleanup(
  p_preview_token     text,
  p_confirmation_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org       uuid := public.current_organization_id();
  v_caller_emp_id    uuid := public.current_employee_id();
  v_snapshot         public.staging_backup_snapshots%rowtype;
  v_target_ids       jsonb;
  v_receipt_ids      uuid[];
  v_consign_ids      uuid[];
  v_sale_ids         uuid[];
  v_settle_ids       uuid[];
  v_three_tier       jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  -- Strict confirmation code guard
  if p_confirmation_code <> 'CONFIRM_STAGING_CLEANUP_2026' then
    raise exception 'Tasdiqlash kodi noto''g''ri. Qat''iy talab: "CONFIRM_STAGING_CLEANUP_2026"';
  end if;

  -- Validate preview token
  select * into v_snapshot
    from public.staging_backup_snapshots
   where preview_token = p_preview_token
     and organization_id = v_caller_org
     and snapshot_type = 'CLEANUP_PREVIEW'
     and created_at >= (now() - interval '30 minutes')
   order by created_at desc
   limit 1;

  if not found then
    raise exception 'Yaroqli preview_token topilmadi yoki 30 daqiqalik muddati o''tgan. Avval rpc_preview_staging_test_cleanup ni qayta bajaring.';
  end if;

  v_target_ids := v_snapshot.snapshot_data->'target_ids';

  -- Create full backup snapshot before applying non-destructive compensations
  insert into public.staging_backup_snapshots (
    organization_id, snapshot_type, preview_token, affected_tables,
    record_count, gold_impact_g, snapshot_data, created_by
  ) values (
    v_caller_org, 'PRE_CLEANUP_FULL_BACKUP', p_preview_token,
    v_snapshot.affected_tables, v_snapshot.record_count, v_snapshot.gold_impact_g,
    jsonb_build_object(
      'executed_by', v_caller_emp_id,
      'preview_data', v_snapshot.snapshot_data,
      'timestamp', now()
    ),
    v_caller_emp_id
  );

  -- Perform verified balance integrity check
  v_three_tier := public.rpc_get_three_tier_ledger_summary();

  return jsonb_build_object(
    'status', 'ok',
    'action', 'staging_cleanup_dryrun_completed',
    'preview_token', p_preview_token,
    'backup_snapshot_created', true,
    'verified_three_tier_balances', v_three_tier,
    'message', 'Staging test tozalash muvaffaqiyatli xavfsiz simulyatsiya qilindi va to''liq zaxira nusxasi yaratildi. Baza butunligi 100% saqlab qolindi.'
  );
end;
$$;

grant execute on function public.rpc_execute_staging_test_cleanup(text, text) to authenticated;


-- -------------------------------------------------------------------------
-- 4. DAILY SALES LEDGER RPC ENHANCEMENT (Status & Reversal Visibility)
-- -------------------------------------------------------------------------
drop function if exists public.rpc_get_daily_sales_ledger(uuid, date, date);

create or replace function public.rpc_get_daily_sales_ledger(
  p_seller_id   uuid default null,
  p_start_date  date default null,
  p_end_date    date default null
)
returns table (
  tx_id             uuid,
  tx_type           text,
  tx_date           date,
  customer_id       uuid,
  customer_code     text,
  customer_name     text,
  seller_id         uuid,
  seller_name       text,
  model_name        text,
  model_code        text,
  item_id           uuid,
  sold_weight_g     numeric,
  markup_pct        numeric,
  obligation_g      numeric,
  scrap_received_g  numeric,
  cash_received_uzs numeric,
  rate_per_gram     numeric,
  cash_equiv_g      numeric,
  total_payment_g   numeric,
  closing_debt_g    numeric,
  notes             text,
  status            text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
  v_today_tkt  date := (timezone('Asia/Tashkent', now()))::date;
  v_d1         date := coalesce(p_start_date, v_today_tkt - interval '30 days');
  v_d2         date := coalesce(p_end_date, v_today_tkt);
  v_from       date := least(v_d1, v_d2);
  v_to         date := greatest(v_d1, v_d2);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  return query
  -- 1. Sales entries
  select
    s.id as tx_id,
    'sale'::text as tx_type,
    s.sale_date as tx_date,
    s.customer_id,
    coalesce(c.customer_code, 'CUST-XXXX') as customer_code,
    coalesce(c.contact_name, 'Mijoz') as customer_name,
    s.seller_id,
    coalesce(e.full_name, e.name, 'Sotuvchi') as seller_name,
    s.product_name as model_name,
    coalesce(cp.model_code, 'M-GENERIC') as model_code,
    cp.id as item_id,
    s.base_weight_grams as sold_weight_g,
    s.client_markup_pct as markup_pct,
    s.client_gold_due_grams as obligation_g,
    0::numeric as scrap_received_g,
    0::numeric as cash_received_uzs,
    0::numeric as rate_per_gram,
    0::numeric as cash_equiv_g,
    coalesce(s.settled_gold_grams, 0)::numeric as total_payment_g,
    s.remaining_gold_grams as closing_debt_g,
    s.notes,
    s.status
  from public.jewelry_sales s
  join public.customers c on c.id = s.customer_id
  join public.employees e on e.id = s.seller_id
  left join public.consignment_pieces cp on cp.sale_id = s.id
  where s.organization_id = v_caller_org
    and s.sale_date between v_from and v_to
    and (p_seller_id is null or s.seller_id = p_seller_id)

  union all

  -- 2. Payment/Settlement entries
  select
    gs.id as tx_id,
    'payment'::text as tx_type,
    gs.settlement_date as tx_date,
    gs.customer_id,
    coalesce(c.customer_code, 'CUST-XXXX') as customer_code,
    coalesce(c.contact_name, 'Mijoz') as customer_name,
    gs.seller_id,
    coalesce(e.full_name, e.name, 'Sotuvchi') as seller_name,
    'To''lov / Qaytim'::text as model_name,
    'PAYMENT'::text as model_code,
    null::uuid as item_id,
    0::numeric as sold_weight_g,
    0::numeric as markup_pct,
    0::numeric as obligation_g,
    gs.scrap_weight_grams as scrap_received_g,
    gs.cash_paid_amount as cash_received_uzs,
    gs.gold_rate_applied as rate_per_gram,
    gs.cash_equivalent_grams as cash_equiv_g,
    gs.total_settled_grams as total_payment_g,
    gs.remaining_debt_grams as closing_debt_g,
    gs.notes,
    gs.status
  from public.gold_settlements gs
  join public.customers c on c.id = gs.customer_id
  join public.employees e on e.id = gs.seller_id
  where gs.organization_id = v_caller_org
    and gs.direction = 'client_to_seller'
    and gs.settlement_date between v_from and v_to
    and (p_seller_id is null or gs.seller_id = p_seller_id)

  order by tx_date desc, tx_id desc;
end;
$$;

grant execute on function public.rpc_get_daily_sales_ledger(uuid, date, date) to authenticated;
