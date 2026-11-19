
-- ------------------------------------------------------------------ tables / columns
-- every factory receipt a consignment took goods from (grams), and how much of it went back (pieces / cancellation)
create table if not exists public.consignment_receipt_allocations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  consignment_id     uuid not null references public.seller_consignments(id) on delete cascade,
  factory_receipt_id uuid not null references public.factory_receipts(id),
  seq                integer not null,
  grams              numeric(14, 4) not null check (grams > 0),
  restored_grams     numeric(14, 4) not null default 0 check (restored_grams >= 0),
  created_at         timestamptz not null default now(),
  constraint consignment_receipt_allocations_restored check (restored_grams <= grams)
);
create index if not exists idx_consignment_receipt_allocations_con on public.consignment_receipt_allocations (consignment_id);
alter table public.consignment_receipt_allocations enable row level security;
drop policy if exists consignment_receipt_allocations_select_policy on public.consignment_receipt_allocations;
create policy consignment_receipt_allocations_select_policy on public.consignment_receipt_allocations for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text()) or public.current_employee_role_text() in ('accountant', 'buxgalter')));
revoke all on public.consignment_receipt_allocations from anon;
revoke insert, update, delete, truncate on public.consignment_receipt_allocations from authenticated;
grant select on public.consignment_receipt_allocations to authenticated;

-- finished goods back from the manager to the factory: a factory handover of its own source type (so the factory
-- cards, the period report and the opening audit count it exactly like every other handover) + its receipt link
alter table public.factory_gold_handovers drop constraint if exists factory_gold_handovers_source_type_check;
alter table public.factory_gold_handovers add constraint factory_gold_handovers_source_type_check
  check (source_type in ('capital_pure_gold', 'refined_gold', 'purchased_gold', 'scrap_gold', 'finished_goods_return'));
create table if not exists public.factory_goods_returns (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  handover_id         uuid not null unique references public.factory_gold_handovers(id),
  factory_receipt_id  uuid not null references public.factory_receipts(id),
  opening_document_id uuid references public.opening_documents(id),
  grams               numeric(14, 4) not null check (grams > 0),
  factory_markup_pct  numeric(6, 2) not null check (factory_markup_pct >= 0),
  factory_value_g     numeric(14, 4) not null check (factory_value_g > 0),
  reason              text not null check (length(btrim(reason)) > 0),
  idempotency_key     text not null unique,
  status              text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  created_by          uuid references public.employees(id),
  created_at          timestamptz not null default now(),
  reversed_at         timestamptz,
  reversed_by         uuid references public.employees(id),
  reversal_reason     text
);
create index if not exists idx_factory_goods_returns_receipt on public.factory_goods_returns (factory_receipt_id);
alter table public.factory_goods_returns enable row level security;
drop policy if exists factory_goods_returns_select_policy on public.factory_goods_returns;
create policy factory_goods_returns_select_policy on public.factory_goods_returns for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text()) or public.current_employee_role_text() in ('accountant', 'buxgalter')));
revoke all on public.factory_goods_returns from anon;
revoke insert, update, delete, truncate on public.factory_goods_returns from authenticated;
grant select on public.factory_goods_returns to authenticated;

-- who recorded a sale (new sales; the existing sale functions fill it through the default - the caller)
alter table public.jewelry_sales add column if not exists recorded_by uuid references public.employees(id) default public.current_employee_id();

-- @@@ FUNCTIONS @@@

-- ------------------------------------------------------------------ 1. consignment -> factory receipts restore
-- Puts p_grams back on the receipts the consignment took them from (allocations, newest first). A legacy consignment
-- (before 090, no allocations) goes back only to its remembered receipt and never above what that receipt gave out;
-- anything more is refused (the other receipts are unknown - nothing is guessed).
create or replace function public._goldia_restore_consignment_receipts(p_con uuid, p_grams numeric, p_adjust_transferred boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_rem  numeric(14, 4) := round(coalesce(p_grams, 0)::numeric, 4);
  v_take numeric(14, 4);
  v_cap  numeric(14, 4);
  a      record;
  c      public.seller_consignments%rowtype;
  r      public.factory_receipts%rowtype;
begin
  if v_rem <= 0 then return; end if;
  select * into c from public.seller_consignments where id = p_con;
  if exists (select 1 from public.consignment_receipt_allocations where consignment_id = p_con) then
    for a in select * from public.consignment_receipt_allocations where consignment_id = p_con order by seq desc for update loop
      v_take := least(v_rem, a.grams - a.restored_grams);
      continue when v_take <= 0;
      update public.consignment_receipt_allocations set restored_grams = round(restored_grams + v_take, 4) where id = a.id;
      update public.factory_receipts
         set available_physical_g = round(available_physical_g + v_take, 4),
             transferred_physical_g = case when p_adjust_transferred then round(greatest(0, transferred_physical_g - v_take), 4) else transferred_physical_g end,
             status = case when round(available_physical_g + v_take, 4) >= original_physical_g then 'in_manager_stock' else 'partially_transferred' end,
             updated_at = now()
       where id = a.factory_receipt_id;
      v_rem := round(v_rem - v_take, 4);
      exit when v_rem <= 0;
    end loop;
    if v_rem > 0.00005 then
      raise exception 'ERR_CONSIGNMENT_RESTORE_EXCEEDS: konsignatsiya kirimlardan olganidan % g ko''p qaytarilmoqda', v_rem using errcode = '22023';
    end if;
  else
    select * into r from public.factory_receipts where id = c.factory_receipt_id for update;
    if r.id is null then raise exception 'ERR_CONSIGNMENT_NO_RECEIPT: konsignatsiyaning zavod kirimi topilmadi' using errcode = '22023'; end if;
    -- room on this receipt for THIS consignment: what the receipt gave out, minus goods returned to the factory, minus
    -- what OTHER active consignments still hold from it, minus what this one keeps after the restore
    v_cap := greatest(0, r.original_physical_g - r.available_physical_g
             - coalesce((select sum(x.grams) from public.factory_goods_returns x where x.factory_receipt_id = r.id and x.status = 'confirmed'), 0)
             - coalesce((select sum(case when exists (select 1 from public.consignment_receipt_allocations a2 where a2.consignment_id = o.id)
                                         then (select coalesce(sum(a2.grams - a2.restored_grams), 0) from public.consignment_receipt_allocations a2 where a2.consignment_id = o.id and a2.factory_receipt_id = r.id)
                                         else (case when o.factory_receipt_id = r.id then o.base_weight_grams else 0 end) end)
                           from public.seller_consignments o
                          where o.organization_id = c.organization_id and o.id <> c.id and o.status in ('held_by_seller', 'partially_sold', 'fully_sold')), 0)
             - case when p_adjust_transferred then 0 else c.base_weight_grams end);
    if v_rem > v_cap + 0.00005 then
      raise exception 'ERR_CONSIGNMENT_RECEIPT_UNKNOWN: eski (090 dan oldingi) konsignatsiya: % g, lekin % kirimi bergan qolgani % g - qolgan qismi qaysi kirimdan olingani noma''lum, qo''lda tekshirish kerak (hech narsa o''zgarmadi)',
        v_rem, r.receipt_no, v_cap using errcode = '22023';
    end if;
    update public.factory_receipts
       set available_physical_g = round(available_physical_g + v_rem, 4),
           transferred_physical_g = case when p_adjust_transferred then round(greatest(0, transferred_physical_g - v_rem), 4) else transferred_physical_g end,
           status = case when round(available_physical_g + v_rem, 4) >= original_physical_g then 'in_manager_stock' else 'partially_transferred' end,
           updated_at = now()
     where id = r.id;
  end if;
end $f$;
revoke all on function public._goldia_restore_consignment_receipts(uuid, numeric, boolean) from public, anon, authenticated;

create or replace function public.rpc_reverse_barcode_consignment(p_consignment_id uuid, p_reason text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_emp      uuid := public.current_employee_id();
  v_reason   text := nullif(btrim(p_reason), '');
  c          public.seller_consignments%rowtype;
  v_w        numeric(14, 4);
  v_n        integer;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_reason is null then raise exception 'Konsignatsiyani bekor qilish sababi kiritilishi shart'; end if;
  v_payload := jsonb_build_object('action', 'reverse_barcode_consignment', 'consignment_id', p_consignment_id);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_barcode_consignment', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into c from public.seller_consignments where id = p_consignment_id and organization_id = v_org for update;
  if c.id is null then raise exception 'Konsignatsiya topilmadi (%)', p_consignment_id; end if;
  if c.status = 'cancelled' then raise exception 'Ushbu konsignatsiya allaqachon bekor qilingan (%)', c.consignment_no; end if;
  if exists (select 1 from public.opening_documents d where d.consignment_id = c.id and d.status = 'active') then
    raise exception 'ERR_OPENING_CONSIGNMENT: bu boshlang''ich (B) konsignatsiya - boshlang''ich hisob qulflangan, oddiy bekor qilinmaydi' using errcode = '55000';
  end if;
  if exists (select 1 from public.opening_sale_returns x where x.consignment_id = c.id) then
    raise exception 'ERR_RETURN_LOT: bu eski savdo vozvrati loti - uni vozvratni bekor qilish orqali bekor qiling' using errcode = '55000';
  end if;
  if c.factory_receipt_id is null then
    raise exception 'ERR_CONSIGNMENT_NO_RECEIPT: zavod kirimisiz konsignatsiya - tovar menejer omboriga qaytadigan kirim yo''q' using errcode = '55000';
  end if;
  select count(*) into v_n from public.consignment_pieces where consignment_id = c.id and status in ('sold', 'returned_to_factory');
  if v_n > 0 then
    raise exception 'Konsignatsiyani bekor qilib bo''lmaydi: % ta mahsulot allaqachon sotilgan yoki zavodga qaytarilgan. Avval savdolarni bekor qiling.', v_n;
  end if;
  -- 090: the grams still on the seller (base is already net of earlier returns): the held pieces
  select coalesce(sum(weight_grams), 0) into v_w from public.consignment_pieces where consignment_id = c.id and status = 'held_by_seller';
  v_w := round(v_w, 4);
  perform public._goldia_restore_consignment_receipts(c.id, v_w, true);
  -- the pieces are CANCELLED (not "returned to manager": the consignment_cancelled line already takes them off the seller)
  update public.consignment_pieces
     set status = 'cancelled', notes = coalesce(notes, '') || ' | KONSIGNATSIYA BEKOR QILINDI: ' || v_reason, updated_at = now()
   where consignment_id = c.id and status = 'held_by_seller';
  update public.seller_consignments
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_emp, cancellation_reason = v_reason, updated_at = now()
   where id = c.id;
  perform public.recalc_seller_gold_account(c.seller_id, v_org);
  perform public._get_or_create_manager_vault(v_org);
  update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org), updated_at = now() where organization_id = v_org;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'seller_consignments', c.id::text, 'CANCEL_CONSIGNMENT', auth.uid(),
    jsonb_build_object('consignment_no', c.consignment_no, 'seller_id', c.seller_id, 'base_weight_g', c.base_weight_grams, 'pieces_count', c.quantity),
    jsonb_build_object('status', 'cancelled', 'restored_physical_g', v_w,
      'receipts', (select jsonb_agg(jsonb_build_object('receipt_id', a.factory_receipt_id, 'grams', a.grams, 'restored', a.restored_grams)) from public.consignment_receipt_allocations a where a.consignment_id = c.id)),
    v_reason);
  v_res := jsonb_build_object('status', 'ok', 'consignment_id', c.id, 'consignment_no', c.consignment_no, 'restored_weight_grams', v_w, 'reason', v_reason);
  perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_barcode_consignment', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_reverse_barcode_consignment(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_barcode_consignment(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ 2. manager -> factory goods return
-- grams of ONE receipt still in the manager's stock go back to the factory, valued at that receipt's own factory %
-- (an opening A receipt: the A document's %, the 088 rule grams x (1 + A %)). Booked as a factory handover of source
-- 'finished_goods_return' (the factory net goes down by the value; with an advance the advance grows). Goods of an
-- opening receipt that were settled with the factory before T0 (factory_settled) are refused (no approved rule).
create or replace function public.rpc_return_goods_to_factory(p_receipt_id uuid, p_grams numeric, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_emp      uuid := public.current_employee_id();
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_reason   text := nullif(btrim(p_reason), '');
  v_g        numeric(14, 4) := round(coalesce(p_grams, 0)::numeric, 4);
  r          public.factory_receipts%rowtype;
  d          public.opening_documents%rowtype;
  v_pct      numeric(6, 2);
  v_value    numeric(14, 4);
  v_settled  numeric(14, 4) := 0;
  v_new_av   numeric(14, 4);
  v_hid      uuid;
  v_id       uuid;
  v_no       text;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then raise exception 'Takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_reason is null then raise exception 'Qaytarish sababi kiritilishi shart'; end if;
  if v_g <= 0 then raise exception 'Qaytariladigan vazn 0 dan katta bo''lishi shart' using errcode = '22023'; end if;
  v_payload := jsonb_build_object('action', 'return_goods_to_factory', 'receipt_id', p_receipt_id, 'grams', v_g);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_return_goods_to_factory', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into r from public.factory_receipts where id = p_receipt_id and organization_id = v_org for update;
  if r.id is null or r.status in ('reversed', 'cancelled') then raise exception 'Zavod kirimi topilmadi yoki bekor qilingan'; end if;
  if v_g > r.available_physical_g + 0.00005 then
    raise exception 'ERR_NOT_IN_STOCK: kirimda menejer omborida % g bor, % g so''raldi', r.available_physical_g, v_g using errcode = '22023';
  end if;
  select * into d from public.opening_documents where id = r.opening_document_id;
  if d.id is not null and d.kind = 'seller_inventory' then
    raise exception 'ERR_SETTLED_GOODS: bu sotuvchining boshlang''ich (B) kirimi - qaytarish qoidasi tasdiqlanmagan' using errcode = '55000';
  end if;
  if d.id is not null and d.kind = 'manager_inventory' then
    if d.factory_markup_pct is distinct from r.factory_markup_pct then
      raise exception 'ERR_PCT_MISMATCH: A hujjati foizi (%) kirim foizidan (%) farq qiladi - qo''lda tekshirish kerak', d.factory_markup_pct, r.factory_markup_pct using errcode = '55000';
    end if;
    -- goods of B documents taken from this A and settled with the factory before T0 that came back to the manager
    -- carry no factory obligation any more: they are not returnable here
    select coalesce(sum(c.returned_weight_grams), 0) into v_settled
      from public.opening_documents b join public.seller_consignments c on c.id = b.consignment_id
     where b.source_document_id = d.id and b.kind = 'seller_inventory' and b.status = 'active'
       and exists (select 1 from public.opening_documents fs where fs.source_document_id = b.id and fs.kind = 'factory_settled' and fs.status = 'active');
    if v_g > r.available_physical_g - v_settled + 0.00005 then
      raise exception 'ERR_SETTLED_GOODS: % kirimidagi % g zavod bilan T0 dan oldin hisob-kitob qilingan (factory_settled) tovar - qaytarish mumkin: % g', r.receipt_no, v_settled, greatest(0, r.available_physical_g - v_settled) using errcode = '55000';
    end if;
  end if;
  v_pct := r.factory_markup_pct;
  v_value := round(v_g * (1 + v_pct / 100.0), 4);
  v_new_av := round(r.available_physical_g - v_g, 4);
  update public.factory_receipts
     set available_physical_g = v_new_av,
         status = case when v_new_av <= 0.00005 then (case when transferred_physical_g > 0 then 'fully_transferred' else 'returned_to_factory' end)
                       else (case when transferred_physical_g > 0 then 'partially_transferred' else 'in_manager_stock' end) end,
         updated_at = now()
   where id = r.id;
  v_no := 'FGR-' || to_char(public._goldia_business_date(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  insert into public.factory_gold_handovers (organization_id, handover_no, source_type, physical_weight_g, proba, agreed_equivalent_g,
    factory_recipient, handover_date, notes, idempotency_key, recorded_by)
  values (v_org, v_no, 'finished_goods_return', v_g, 585, v_value, 'Zavod', public._goldia_business_date(),
    'TAYYOR MAHSULOT ZAVODGA QAYTARILDI: ' || r.receipt_no || ' ' || v_g || ' g x (1 + ' || v_pct || ' %) = ' || v_value || ' g. ' || v_reason, v_key || ':hnd', v_emp)
  returning id into v_hid;
  insert into public.factory_goods_returns (organization_id, handover_id, factory_receipt_id, opening_document_id, grams, factory_markup_pct,
    factory_value_g, reason, idempotency_key, created_by)
  values (v_org, v_hid, r.id, case when d.kind = 'manager_inventory' then d.id end, v_g, v_pct, v_value, v_reason, v_key, v_emp)
  returning id into v_id;
  -- the factory net goes down by the value (delta: the opening C / C2 / factory_settled parts are kept)
  perform public._goldia_vault_factory_add(v_org, 0, v_value);
  update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org), updated_at = now() where organization_id = v_org;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, new_data, reason)
  values (v_org, 'factory_goods_returns', v_id::text, 'RETURN_GOODS_TO_FACTORY', auth.uid(),
    jsonb_build_object('receipt_no', r.receipt_no, 'grams', v_g, 'factory_markup_pct', v_pct, 'factory_value_g', v_value, 'handover_no', v_no,
                       'opening_document', d.document_no, 'available_after_g', v_new_av), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'return_id', v_id, 'handover_id', v_hid, 'handover_no', v_no, 'receipt_no', r.receipt_no,
    'grams', v_g, 'factory_markup_pct', v_pct, 'factory_value_g', v_value, 'available_after_g', v_new_av,
    'factory_net_after_g', (select current_factory_obligation_g - current_factory_advance_g from public.manager_vault_account where organization_id = v_org));
  perform public.save_idempotency_response(v_key, 'rpc_return_goods_to_factory', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_return_goods_to_factory(uuid, numeric, text, text) from public, anon;
grant execute on function public.rpc_return_goods_to_factory(uuid, numeric, text, text) to authenticated, service_role;

create or replace function public.rpc_reverse_factory_goods_return(p_return_id uuid, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare
  v_org      uuid := public.current_organization_id();
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_reason   text := nullif(btrim(p_reason), '');
  x          public.factory_goods_returns%rowtype;
  r          public.factory_receipts%rowtype;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
begin
  if v_org is null then raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501'; end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then raise exception 'Takrorlanmas so''rov kaliti (idempotency key) majburiy'; end if;
  if v_reason is null then raise exception 'Bekor qilish sababi kiritilishi shart'; end if;
  v_payload := jsonb_build_object('action', 'reverse_factory_goods_return', 'return_id', p_return_id);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_reverse_factory_goods_return', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into x from public.factory_goods_returns where id = p_return_id and organization_id = v_org for update;
  if x.id is null then raise exception 'Zavodga qaytarish hujjati topilmadi'; end if;
  if x.status <> 'confirmed' then raise exception 'Bu qaytarish allaqachon bekor qilingan'; end if;
  select * into r from public.factory_receipts where id = x.factory_receipt_id for update;
  if r.available_physical_g + x.grams > r.original_physical_g + 0.00005 then
    raise exception 'ERR_RECEIPT_OVERFLOW: kirimga % g qaytarilsa asl vazndan oshadi' , x.grams using errcode = '55000';
  end if;
  update public.factory_receipts
     set available_physical_g = round(available_physical_g + x.grams, 4),
         status = case when round(available_physical_g + x.grams, 4) >= original_physical_g then 'in_manager_stock' else 'partially_transferred' end,
         updated_at = now()
   where id = r.id;
  perform set_config('goldia.fgr_reverse', txid_current()::text, true);
  update public.factory_gold_handovers set status = 'reversed', reversed_at = clock_timestamp() where id = x.handover_id;
  update public.factory_goods_returns set status = 'reversed', reversed_at = clock_timestamp(), reversed_by = public.current_employee_id(), reversal_reason = v_reason where id = x.id;
  perform public._goldia_vault_factory_add(v_org, 0, -x.factory_value_g);
  update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org), updated_at = now() where organization_id = v_org;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'factory_goods_returns', x.id::text, 'REVERSE_GOODS_TO_FACTORY', auth.uid(),
    jsonb_build_object('status', 'confirmed', 'grams', x.grams, 'factory_value_g', x.factory_value_g), jsonb_build_object('status', 'reversed'), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'return_id', x.id, 'grams', x.grams, 'factory_value_g', x.factory_value_g);
  perform public.save_idempotency_response(v_key, 'rpc_reverse_factory_goods_return', v_res, v_payload);
  return v_res;
end $f$;
revoke all on function public.rpc_reverse_factory_goods_return(uuid, text, text) from public, anon;
grant execute on function public.rpc_reverse_factory_goods_return(uuid, text, text) to authenticated, service_role;

-- a finished-goods handover is reversed only by its own function (the generic gold-handover reversal would put metal
-- back into the manager's scrap / refined stock)
create or replace function public._goldia_guard_finished_goods_handover()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  if old.source_type = 'finished_goods_return' and new.status is distinct from old.status
     and current_setting('goldia.fgr_reverse', true) is distinct from txid_current()::text then
    raise exception 'ERR_FINISHED_GOODS_HANDOVER: tayyor mahsulot qaytarishini "Zavodga qaytarishni bekor qilish" orqali bekor qiling' using errcode = '55000';
  end if;
  return new;
end $f$;
revoke all on function public._goldia_guard_finished_goods_handover() from public, anon, authenticated;
drop trigger if exists trg_goldia_guard_finished_goods_handover on public.factory_gold_handovers;
create trigger trg_goldia_guard_finished_goods_handover before update on public.factory_gold_handovers
  for each row execute function public._goldia_guard_finished_goods_handover();

-- ------------------------------------------------------------------ 3. a seller cancelling his own sale
-- Every sale reversal path (rpc_reverse_client_sale, rpc_reverse_jewelry_sale, piece-sale reversal) sets the sale's
-- status; when the CALLER is a seller this guard adds the seller rules. The reversal functions keep doing the work
-- (customer debt, pieces, seller account, stock) in one transaction - a refusal here rolls all of it back.
create or replace function public._goldia_guard_seller_sale_cancel()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_emp uuid; v_role text;
begin
  if not (new.status in ('reversed', 'cancelled') and old.status not in ('reversed', 'cancelled')) or auth.uid() is null then return new; end if;
  v_role := public.current_employee_role_text();
  if not public._goldia_is_seller_role(v_role) then return new; end if;
  v_emp := public.current_employee_id();
  if old.seller_id is distinct from v_emp then
    raise exception 'ERR_NOT_OWN_SALE: sotuvchi faqat o''z savdosini bekor qila oladi' using errcode = '42501';
  end if;
  if old.recorded_by is not null and old.recorded_by is distinct from v_emp then
    raise exception 'ERR_NOT_RECORDED_BY_SELLER: bu savdoni boshqa xodim kiritgan - menejer bekor qiladi' using errcode = '42501';
  end if;
  if coalesce(old.settled_gold_grams, 0) > 0
     or exists (select 1 from public.gold_settlements g where g.customer_id = old.customer_id and g.direction = 'client_to_seller'
                 and g.reversal_of_id is null and coalesce(g.status, 'confirmed') not in ('reversed', 'cancelled') and g.created_at >= old.created_at)
     or exists (select 1 from public.client_currency_settlements c where c.customer_id = old.customer_id and c.status <> 'reversed' and c.created_at >= old.created_at) then
    raise exception 'ERR_SALE_HAS_PAYMENTS: savdodan keyin mijoz to''lov (pul / LOM / avans) qilgan - bekor qilishni menejer bajaradi' using errcode = '55000';
  end if;
  if exists (select 1 from public.goldia_report_periods p where p.organization_id = old.organization_id and old.sale_date between p.period_start and p.period_end) then
    raise exception 'ERR_PERIOD_CLOSED: savdo sanasi yopilgan hisobot davrida - bekor qilishni menejer bajaradi' using errcode = '55000';
  end if;
  return new;
end $f$;
revoke all on function public._goldia_guard_seller_sale_cancel() from public, anon, authenticated;
drop trigger if exists trg_goldia_guard_seller_sale_cancel on public.jewelry_sales;
create trigger trg_goldia_guard_seller_sale_cancel before update of status on public.jewelry_sales
  for each row execute function public._goldia_guard_seller_sale_cancel();
