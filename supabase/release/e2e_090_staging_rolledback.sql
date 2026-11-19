-- GOLDIA 090 staging end-to-end AFTER the staging release (staging at 090): new synthetic organization, ONE transaction, ROLLED BACK.
-- Every row of the final select must be ok = true (17 rows). Nothing persists.
begin;
-- GOLDIA 090 end-to-end on a NEW synthetic organization; runs right after migration 090 inside the SAME transaction,
-- which is ROLLED BACK at the end. Business calls run as the real `authenticated` role (RLS on). Nothing persists.
create temp table _e2e (n serial, name text, ok boolean, detail text) on commit drop;
do $e2e$
declare
  v_org uuid := gen_random_uuid();
  u_dir uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid(); u_s1 uuid := gen_random_uuid(); u_s2 uuid := gen_random_uuid();
  e_s1 uuid; e_s2 uuid; c_a uuid; c_b uuid; v_bv uuid; v_a uuid; v_arcp uuid; v_r2 uuid; v_r3 uuid;
  r jsonb; r2 jsonb; c1 jsonb; v_err text; st0 numeric; o0 numeric; m0 numeric; n0 numeric; n1 numeric; pe0 numeric; pe1 numeric; x numeric; y numeric;
  v_ok boolean; v_cnt int;
begin
  insert into public.organizations (id, code, name, status) values (v_org, 'e2e-090-' || substr(v_org::text, 1, 6), 'E2E 090 (sintetik)', 'ACTIVE');
  insert into auth.users (id, email) values (u_dir, 'e2e9-dir-' || substr(v_org::text,1,6) || '@goldia.test'), (u_mgr, 'e2e9-mgr-' || substr(v_org::text,1,6) || '@goldia.test'),
    (u_s1, 'e2e9-s1-' || substr(v_org::text,1,6) || '@goldia.test'), (u_s2, 'e2e9-s2-' || substr(v_org::text,1,6) || '@goldia.test');
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_dir, 'E2E Direktor', 'E2E Direktor', 'director', true), (v_org, u_mgr, 'E2E Menejer', 'E2E Menejer', 'manager', true);
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_s1, 'E2E Sotuvchi 1', 'E2E Sotuvchi 1', 'sales', true) returning id into e_s1;
  insert into public.employees (organization_id, user_id, name, full_name, role, is_active) values (v_org, u_s2, 'E2E Sotuvchi 2', 'E2E Sotuvchi 2', 'sales', true) returning id into e_s2;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E9-A', 'E2E mijoz A', '+998900000901', e_s1) returning id into c_a;
  insert into public.customers (organization_id, customer_code, contact_name, phone, seller_id) values (v_org, 'E9-B', 'E2E mijoz B', '+998900000902', e_s2) returning id into c_b;
  insert into public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) values (v_org, public._goldia_business_date(), 585, 900000, 'UZS', true) on conflict do nothing;
  perform public._goldia_financial_freeze(v_org, 'e2e 090 window', true);
  perform pg_sleep(0.01);
  insert into public.financial_backup_verifications (organization_id, backup_reference, restore_verified, verified_at) values (v_org, 'e2e-090.dump', true, clock_timestamp()) returning id into v_bv;
  perform set_config('request.jwt.claim.sub', u_dir::text, true); execute 'set local role authenticated';
  perform public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'e2e 090', clock_timestamp() - interval '1 minute', v_bv, 'e2e90-restart-' || v_org);
  execute 'reset role'; perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  v_a := (public.rpc_record_opening_document(p_kind := 'manager_inventory', p_physical_g := 20, p_factory_markup_pct := 8, p_idempotency_key := 'e2e90-a-' || v_org) ->> 'document_id')::uuid;
  perform public.rpc_record_opening_document(p_kind := 'seller_inventory', p_seller_id := e_s2, p_pieces := '[{"weight_grams":4}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := v_a, p_idempotency_key := 'e2e90-b-' || v_org);
  perform public.rpc_record_opening_document(p_kind := 'factory_advance', p_amount := 100, p_notes := 'C2 e2e', p_idempotency_key := 'e2e90-c2-' || v_org);
  perform public.rpc_confirm_accounting_baseline(p_notes := 'T0 e2e 090', p_idempotency_key := 'e2e90-lock-' || v_org, p_usd_rate := 12650);
  v_r2 := (public.rpc_record_factory_receipt(p_product_name := 'E2E keyingi kirim', p_original_physical_g := 50, p_factory_markup_pct := 10, p_idempotency_key := 'e2e90-r2-' || v_org) ->> 'receipt_id')::uuid;
  execute 'reset role';
  select factory_receipt_id into v_arcp from public.opening_documents where id = v_a;

  -- ---------------- K1 FIFO 39.46 g over A (16 g left) + later receipt; cancel puts each part back on its own receipt
  select current_physical_stock_g, seller_owes_manager_g into st0, o0 from public.seller_gold_accounts where seller_id = e_s1;
  st0 := coalesce(st0, 0); o0 := coalesce(o0, 0); m0 := public.get_manager_available_stock_grams(v_org);
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  c1 := public.rpc_issue_barcode_consignment(p_seller_id := e_s1, p_factory_markup_pct := 8, p_pieces := '[{"weight_grams":20},{"weight_grams":19.46}]'::jsonb, p_seller_markup_pct := 10, p_idempotency_key := 'e2e90-k1-' || v_org);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('K1a issue: allocations total 39.46 g and equal what each receipt gave (A had 16 g, later receipt 50 g)',
    (select sum(grams) from public.consignment_receipt_allocations where consignment_id = (c1 ->> 'consignment_id')::uuid) = 39.46
      and coalesce((select sum(grams) from public.consignment_receipt_allocations where consignment_id = (c1 ->> 'consignment_id')::uuid and factory_receipt_id = v_arcp), 0) = 16 - (select available_physical_g from public.factory_receipts where id = v_arcp)
      and coalesce((select sum(grams) from public.consignment_receipt_allocations where consignment_id = (c1 ->> 'consignment_id')::uuid and factory_receipt_id = v_r2), 0) = 50 - (select available_physical_g from public.factory_receipts where id = v_r2),
    (select string_agg(case when factory_receipt_id = v_arcp then 'A ' else 'r2 ' end || grams::text, ', ' order by seq) from public.consignment_receipt_allocations where consignment_id = (c1 ->> 'consignment_id')::uuid));
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  perform public.rpc_reverse_barcode_consignment((c1 ->> 'consignment_id')::uuid, 'ikki marta kiritilgan', 'e2e90-k1x-' || v_org);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('K1b cancel: A back to 16 g, later receipt back to 50 g, A transferred stays 4 g (B), seller/manager unchanged',
    (select available_physical_g from public.factory_receipts where id = v_arcp) = 16 and (select available_physical_g from public.factory_receipts where id = v_r2) = 50
      and (select transferred_physical_g from public.factory_receipts where id = v_arcp) = 4
      and coalesce((select current_physical_stock_g from public.seller_gold_accounts where seller_id = e_s1), 0) = st0
      and coalesce((select seller_owes_manager_g from public.seller_gold_accounts where seller_id = e_s1), 0) = o0
      and public.get_manager_available_stock_grams(v_org) = m0,
    format('A=%s r2=%s st=%s mgr=%s', (select available_physical_g from public.factory_receipts where id = v_arcp), (select available_physical_g from public.factory_receipts where id = v_r2),
      (select current_physical_stock_g from public.seller_gold_accounts where seller_id = e_s1), public.get_manager_available_stock_grams(v_org)));
  insert into _e2e (name, ok, detail) values ('K1c report: the cancellation is taken off the seller ONCE (period stock = stored stock)',
    (select coalesce(sum(stock_g), 0) from public._goldia_period_effects(v_org) where seller_id = e_s1) = coalesce((select current_physical_stock_g from public.seller_gold_accounts where seller_id = e_s1), 0),
    (select coalesce(sum(stock_g), 0)::text from public._goldia_period_effects(v_org) where seller_id = e_s1));

  -- ---------------- K2 the user's case: 39.46 g entered twice, one cancelled; double cancel refused; B opening refused
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  v_r3 := (public.rpc_record_factory_receipt(p_product_name := 'E2E K2 kirim', p_original_physical_g := 100, p_factory_markup_pct := 10, p_idempotency_key := 'e2e90-r3-' || v_org) ->> 'receipt_id')::uuid;
  c1 := public.rpc_issue_barcode_consignment(p_seller_id := e_s1, p_factory_markup_pct := 10, p_pieces := '[{"weight_grams":39.46}]'::jsonb, p_factory_receipt_id := v_r3, p_seller_markup_pct := 10, p_idempotency_key := 'e2e90-k2a-' || v_org);
  perform public.rpc_issue_barcode_consignment(p_seller_id := e_s1, p_factory_markup_pct := 10, p_pieces := '[{"weight_grams":39.46}]'::jsonb, p_factory_receipt_id := v_r3, p_seller_markup_pct := 10, p_idempotency_key := 'e2e90-k2b-' || v_org);
  perform public.rpc_reverse_barcode_consignment((c1 ->> 'consignment_id')::uuid, 'ikkinchi marta xato kiritilgan', 'e2e90-k2x-' || v_org);
  v_err := null;
  begin perform public.rpc_reverse_barcode_consignment((c1 ->> 'consignment_id')::uuid, 'yana', 'e2e90-k2y-' || v_org); exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('K2 twice 39.46 g, one cancelled: receipt 100-39.46 = 60.54 g, seller holds 39.46 g once, report = stored; double cancel refused',
    (select available_physical_g from public.factory_receipts where id = v_r3) = 60.54
      and coalesce((select current_physical_stock_g from public.seller_gold_accounts where seller_id = e_s1), 0) = st0 + 39.46
      and (select coalesce(sum(stock_g), 0) from public._goldia_period_effects(v_org) where seller_id = e_s1) = st0 + 39.46
      and v_err like '%allaqachon%', v_err);
  v_err := null;
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  begin perform public.rpc_reverse_barcode_consignment((select consignment_id from public.opening_documents where kind = 'seller_inventory' and organization_id = v_org), 'x', 'e2e90-k3-' || v_org);
  exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('K3 opening B consignment (LOCK) cannot be cancelled', v_err like 'ERR_OPENING_CONSIGNMENT%', v_err);
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  r := public.rpc_get_seller_stock_movements(null, null, null);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('K4 stock movements: every seller ok, only own organization',
    not exists (select 1 from jsonb_array_elements(r -> 'sellers') s where not (s ->> 'ok')::boolean)
      and not exists (select 1 from jsonb_array_elements(r -> 'sellers') s join public.employees e on e.id = (s ->> 'seller_id')::uuid where e.organization_id <> v_org),
    (select string_agg((s ->> 'seller_name') || ' all=' || (s ->> 'all_time_g') || ' stored=' || (s ->> 'stored_stock_g'), '; ') from jsonb_array_elements(r -> 'sellers') s));

  -- ---------------- F manager -> factory goods return (later receipt 10 %, opening A 8 %), with the C2 factory advance
  select current_factory_obligation_g - current_factory_advance_g into n0 from public.manager_vault_account where organization_id = v_org;
  select coalesce(sum(factory_g), 0) into pe0 from public._goldia_period_effects(v_org);
  m0 := public.get_manager_available_stock_grams(v_org);
  select seller_owes_manager_g into o0 from public.seller_gold_accounts where seller_id = e_s1;
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  r := public.rpc_return_goods_to_factory(v_r2, 5, 'menejerda saqlanmaydi', 'e2e90-f1-' || v_org);
  r2 := public.rpc_return_goods_to_factory(v_r2, 5, 'menejerda saqlanmaydi', 'e2e90-f1-' || v_org);
  execute 'reset role';
  select current_factory_obligation_g - current_factory_advance_g into n1 from public.manager_vault_account where organization_id = v_org;
  select coalesce(sum(factory_g), 0) into pe1 from public._goldia_period_effects(v_org);
  insert into _e2e (name, ok, detail) values ('F1 5 g at 10 % = 5.5 g: factory net -5.5, manager stock -5, period report factory -5.5 (once), replay idempotent, seller unchanged',
    (r ->> 'factory_value_g')::numeric = 5.5 and r2 ->> 'return_id' = r ->> 'return_id' and round(n1 - n0, 4) = -5.5 and round(pe1 - pe0, 4) = -5.5
      and public.get_manager_available_stock_grams(v_org) = m0 - 5
      and (select seller_owes_manager_g from public.seller_gold_accounts where seller_id = e_s1) = o0,
    format('value=%s net %s->%s report %s mgr %s->%s', r ->> 'factory_value_g', n0, n1, round(pe1 - pe0, 4), m0, public.get_manager_available_stock_grams(v_org)));
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  r2 := public.rpc_return_goods_to_factory(v_arcp, 10, 'A tovari zavodga', 'e2e90-f2-' || v_org);
  v_err := null; begin perform public.rpc_return_goods_to_factory(v_arcp, 7, 'ortiqcha', 'e2e90-f3-' || v_org); exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('F2 opening A 10 g at the A document 8 % = 10.8 g; more than in stock refused',
    (r2 ->> 'factory_value_g')::numeric = 10.8 and v_err like 'ERR_NOT_IN_STOCK%', v_err);
  v_err := null;
  perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  begin perform public.rpc_return_goods_to_factory(v_r2, 1, 'x', 'e2e90-f4-' || v_org); exception when others then v_err := sqlerrm; end;
  select count(*) into v_cnt from public.factory_goods_returns;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('F3 a seller may not return goods to the factory, and sees no goods returns', v_err is not null and v_cnt = 0, v_err);
  perform set_config('request.jwt.claim.sub', u_dir::text, true); execute 'set local role authenticated';
  v_err := null; begin perform public.rpc_reverse_factory_gold_handover((r2 ->> 'handover_id')::uuid, 'x', 'e2e90-f5-' || v_org); exception when others then v_err := sqlerrm; end;
  perform public.rpc_reverse_factory_goods_return((r2 ->> 'return_id')::uuid, 'xato', 'e2e90-f6-' || v_org);
  perform public.rpc_reverse_factory_goods_return((r ->> 'return_id')::uuid, 'xato', 'e2e90-f7-' || v_org);
  execute 'reset role';
  select current_factory_obligation_g - current_factory_advance_g into n1 from public.manager_vault_account where organization_id = v_org;
  select coalesce(sum(factory_g), 0) into pe1 from public._goldia_period_effects(v_org);
  insert into _e2e (name, ok, detail) values ('F4 director (= manager rights) reverses both returns: net, stock and report back to before; generic handover reversal refused',
    v_err is not null and round(n1 - n0, 4) = 0 and round(pe1 - pe0, 4) = 0 and public.get_manager_available_stock_grams(v_org) = m0,
    format('net %s->%s report delta %s; generic: %s', n0, n1, round(pe1 - pe0, 4), v_err));

  -- ---------------- S seller cancels own sale; refusals
  perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  r := public.rpc_record_weight_sale(p_customer_id := c_a, p_weight_grams := 2, p_client_markup_pct := 20, p_idempotency_key := 'e2e90-s1-' || v_org);
  x := (select current_debt_grams from public.client_gold_accounts where customer_id = c_a);
  v_err := null; begin perform public.rpc_reverse_client_sale(p_sale_id := (r ->> 'sale_id')::uuid, p_reason := '  '); exception when others then v_err := sqlerrm; end;
  perform public.rpc_reverse_client_sale(p_sale_id := (r ->> 'sale_id')::uuid, p_reason := 'noto''g''ri vazn');
  y := (select current_debt_grams from public.client_gold_accounts where customer_id = c_a);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('S1 seller cancels own sale (reason required): debt 2.4 -> 0, stock restored, document kept as reversed, recorded_by = seller',
    x = 2.4 and y = 0 and v_err like '%sababi%'
      and (select status from public.jewelry_sales where id = (r ->> 'sale_id')::uuid) = 'reversed'
      and (select recorded_by from public.jewelry_sales where id = (r ->> 'sale_id')::uuid) = e_s1
      and coalesce((select current_physical_stock_g from public.seller_gold_accounts where seller_id = e_s1), 0) = st0 + 39.46,
    format('debt %s -> %s', x, y));
  perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  v_err := null; begin perform public.rpc_reverse_client_sale(p_sale_id := (r ->> 'sale_id')::uuid, p_reason := 'yana'); exception when others then v_err := sqlerrm; end;
  r2 := public.rpc_record_weight_sale(p_customer_id := c_a, p_weight_grams := 1.5, p_client_markup_pct := 20, p_idempotency_key := 'e2e90-s2-' || v_org);
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('S2 double cancel refused; the seller re-enters the sale correctly', v_err like '%allaqachon%' and r2 ->> 'sale_id' is not null, v_err);
  -- another seller's sale / a sale recorded by the manager / a sale with a later payment
  perform set_config('request.jwt.claim.sub', u_s2::text, true); execute 'set local role authenticated';
  v_err := null; begin perform public.rpc_reverse_client_sale(p_sale_id := (r2 ->> 'sale_id')::uuid, p_reason := 'x'); exception when others then v_err := sqlerrm; end;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('S3 another seller may not cancel it', v_err is not null and (select status from public.jewelry_sales where id = (r2 ->> 'sale_id')::uuid) <> 'reversed', v_err);
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  r := public.rpc_record_weight_sale(p_customer_id := c_a, p_seller_id := e_s1, p_weight_grams := 1, p_client_markup_pct := 10, p_idempotency_key := 'e2e90-s3-' || v_org);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', u_s1::text, true); execute 'set local role authenticated';
  v_err := null; begin perform public.rpc_reverse_client_sale(p_sale_id := (r ->> 'sale_id')::uuid, p_reason := 'x'); exception when others then v_err := sqlerrm; end;
  perform public.rpc_record_client_settlement(p_customer_id := c_a, p_scrap_weight := 0.5, p_scrap_proba := 585, p_idempotency_key := 'e2e90-pay-' || v_org);
  r2 := r2; -- the 1.5 g own sale, now followed by a payment
  begin perform public.rpc_reverse_client_sale(p_sale_id := (r2 ->> 'sale_id')::uuid, p_reason := 'x'); v_ok := false; exception when others then v_ok := sqlerrm like 'ERR_SALE_HAS_PAYMENTS%'; end;
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('S4 seller refused: sale recorded by the manager (ERR_NOT_RECORDED_BY_SELLER), own sale with a later payment (ERR_SALE_HAS_PAYMENTS)',
    v_err like 'ERR_NOT_RECORDED_BY_SELLER%' and v_ok, v_err);
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); execute 'set local role authenticated';
  perform public.rpc_reverse_client_sale(p_sale_id := (r ->> 'sale_id')::uuid, p_reason := 'menejer bekor qildi');
  execute 'reset role';
  insert into _e2e (name, ok, detail) values ('S5 the manager cancels the sale he recorded (safe flow unchanged)',
    (select status from public.jewelry_sales where id = (r ->> 'sale_id')::uuid) = 'reversed', null);
  -- RLS: the new tables of this org are invisible to another organization (the anon role has no access at all)
  insert into _e2e (name, ok, detail) values ('R1 new tables: no anon access, allocations / goods returns only through RPCs',
    not has_table_privilege('anon', 'public.factory_goods_returns', 'SELECT') and not has_table_privilege('authenticated', 'public.consignment_receipt_allocations', 'INSERT')
      and not has_table_privilege('authenticated', 'public.factory_goods_returns', 'UPDATE'), null);
end $e2e$;
insert into _e2e (name, ok, detail) select 'M1 the 10 changed/new 090 function bodies are identical to the repository', (select md5(string_agg(p.proname || md5(p.prosrc), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('rpc_issue_barcode_consignment','rpc_return_piece_to_manager','rpc_reverse_barcode_consignment','_goldia_period_effects','rpc_get_seller_stock_movements','_goldia_restore_consignment_receipts','rpc_return_goods_to_factory','rpc_reverse_factory_goods_return','_goldia_guard_finished_goods_handover','_goldia_guard_seller_sale_cancel')) = '428ae7b42162419628624d60423fdca4', (select md5(string_agg(p.proname || md5(p.prosrc), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('rpc_issue_barcode_consignment','rpc_return_piece_to_manager','rpc_reverse_barcode_consignment','_goldia_period_effects','rpc_get_seller_stock_movements','_goldia_restore_consignment_receipts','rpc_return_goods_to_factory','rpc_reverse_factory_goods_return','_goldia_guard_finished_goods_handover','_goldia_guard_seller_sale_cancel'));
select n, name, ok, detail from _e2e order by n;
rollback;
