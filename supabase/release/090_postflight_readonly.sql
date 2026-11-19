-- POSTFLIGHT for migration 090 (consignment cancellation by allocations, manager -> factory goods return, seller
-- cancels own sale) - READ ONLY. Every column must be true. 090 writes no business row (only a nullable column + 2 tables).
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000090') as recorded,
  -- the two new tables: RLS on, select-only for signed-in users, no anon access
  (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.consignment_receipt_allocations'::regclass, 'public.factory_goods_returns'::regclass)) as rls_on,
  (select bool_and(has_table_privilege('authenticated', t, 'SELECT') and not has_table_privilege('authenticated', t, 'INSERT')
                   and not has_table_privilege('authenticated', t, 'UPDATE') and not has_table_privilege('authenticated', t, 'DELETE')
                   and not has_table_privilege('anon', t, 'SELECT'))
     from unnest(array['public.consignment_receipt_allocations', 'public.factory_goods_returns']) t) as tables_read_only_for_users,
  -- 090 writes no business row: the new tables start empty, recorded_by stays null on the existing sales
  (select count(*) = 0 from public.factory_goods_returns) as no_goods_returns_written,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jewelry_sales' and column_name = 'recorded_by') as sale_recorded_by,
  (select position('finished_goods_return' in pg_get_constraintdef(oid)) > 0 from pg_constraint
    where conrelid = 'public.factory_gold_handovers'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source_type%') as handover_source_type,
  -- the draft / freeze guard stays on exactly its 12 tables
  (select count(distinct c.relname) = 12 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal) as draft_guard_12,
  -- the guards are present and enabled
  exists (select 1 from pg_trigger where tgname = 'trg_goldia_guard_seller_sale_cancel' and tgrelid = 'public.jewelry_sales'::regclass and tgenabled = 'O') as seller_cancel_guard,
  exists (select 1 from pg_trigger where tgname = 'trg_goldia_guard_finished_goods_handover' and tgrelid = 'public.factory_gold_handovers'::regclass and tgenabled = 'O') as goods_handover_guard,
  (select bool_and(position(x in prosrc) > 0) from pg_proc, unnest(array['ERR_NOT_OWN_SALE', 'ERR_NOT_RECORDED_BY_SELLER', 'ERR_SALE_HAS_PAYMENTS', 'ERR_PERIOD_CLOSED']) x
    where oid = 'public._goldia_guard_seller_sale_cancel()'::regprocedure) as seller_cancel_rules,
  -- the changed bodies carry the 090 rule
  (select position('consignment_receipt_allocations' in prosrc) > 0 from pg_proc where proname = 'rpc_issue_barcode_consignment' and pronamespace = 'public'::regnamespace) as issue_allocations,
  (select position('_goldia_restore_consignment_receipts' in prosrc) > 0 from pg_proc where proname = 'rpc_return_piece_to_manager' and pronamespace = 'public'::regnamespace) as piece_return_allocations,
  (select bool_and(position(x in prosrc) > 0) from pg_proc, unnest(array['ERR_OPENING_CONSIGNMENT', 'ERR_RETURN_LOT', 'ERR_CONSIGNMENT_NO_RECEIPT', '_goldia_restore_consignment_receipts', 'recalc_seller_gold_account', 'check_and_lock_idempotency']) x
    where proname = 'rpc_reverse_barcode_consignment' and pronamespace = 'public'::regnamespace) as consignment_cancel_rules,
  (select bool_and(position(x in prosrc) > 0) from pg_proc, unnest(array['ERR_NOT_IN_STOCK', 'ERR_SETTLED_GOODS', 'ERR_PCT_MISMATCH', 'finished_goods_return', 'check_and_lock_idempotency', 'assert_erp_permission']) x
    where proname = 'rpc_return_goods_to_factory' and pronamespace = 'public'::regnamespace) as goods_return_rules,
  -- the period report / stock movements do not count a cancellation twice, and a goods return only once (as its handover)
  (select position('c.cancelled_at = p.returned_to_manager_at' in prosrc) > 0 and position('''factory_goods_return''' in prosrc) = 0
     from pg_proc where proname = '_goldia_period_effects' and pronamespace = 'public'::regnamespace) as period_effects_no_double,
  (select position('c.cancelled_at = p.returned_to_manager_at' in prosrc) > 0 from pg_proc where proname = 'rpc_get_seller_stock_movements' and pronamespace = 'public'::regnamespace) as stock_movements_no_double,
  -- functions: present; no anon; helpers / trigger functions not callable by users
  (select count(*) = 4 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_goldia_restore_consignment_receipts', 'rpc_return_goods_to_factory',
     'rpc_reverse_factory_goods_return', 'rpc_reverse_barcode_consignment')) as functions,
  (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_goldia_restore_consignment_receipts', 'rpc_return_goods_to_factory', 'rpc_reverse_factory_goods_return', 'rpc_reverse_barcode_consignment',
                       'rpc_issue_barcode_consignment', 'rpc_return_piece_to_manager', '_goldia_period_effects', 'rpc_get_seller_stock_movements',
                       '_goldia_guard_seller_sale_cancel', '_goldia_guard_finished_goods_handover')) as no_anon,
  (select bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_goldia_restore_consignment_receipts', '_goldia_guard_seller_sale_cancel', '_goldia_guard_finished_goods_handover')) as helpers_internal;

rollback;
