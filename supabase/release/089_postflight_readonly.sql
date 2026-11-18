-- POSTFLIGHT for migration 089 (old-sale returns, CPAY in the journal, payment currency correction, seller till counts,
-- stock movements) - READ ONLY. Every column must be true. 089 writes no business row.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000089') as recorded,
  -- the two new tables: RLS on, select-only for signed-in users, no anon access, value split / diff constraints present
  (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.opening_sale_returns'::regclass, 'public.seller_till_counts'::regclass)) as rls_on,
  (select bool_and(has_table_privilege('authenticated', t, 'SELECT') and not has_table_privilege('authenticated', t, 'INSERT')
                   and not has_table_privilege('authenticated', t, 'UPDATE') and not has_table_privilege('authenticated', t, 'DELETE')
                   and not has_table_privilege('anon', t, 'SELECT'))
     from unnest(array['public.opening_sale_returns', 'public.seller_till_counts']) t) as tables_read_only_for_users,
  exists (select 1 from pg_constraint where conrelid = 'public.opening_sale_returns'::regclass and conname = 'opening_sale_returns_value_split')
    and exists (select 1 from pg_constraint where conrelid = 'public.opening_sale_returns'::regclass and conname = 'opening_sale_returns_opening_part')
    and exists (select 1 from pg_constraint where conrelid = 'public.seller_till_counts'::regclass and conname = 'seller_till_counts_diff') as constraints,
  -- the draft / freeze guard stays on its 12 tables; old returns write the guarded consignment tables in the same transaction
  (select count(distinct c.relname) = 12 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal)
    and (select count(*) = 2 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal
           and tg.tgenabled = 'O' and c.relname in ('seller_consignments', 'consignment_pieces'))
    and (select position('insert into public.seller_consignments' in prosrc) > 0 from pg_proc where proname = 'rpc_record_opening_sale_return' and pronamespace = 'public'::regnamespace)
    and (select position('update public.consignment_pieces' in prosrc) > 0 from pg_proc where proname = 'rpc_reverse_opening_sale_return' and pronamespace = 'public'::regnamespace) as draft_guard,
  -- the changed bodies carry the 089 rule
  (select position('opening_sale_returns' in prosrc) > 0 and position('equiv_585_g is null' in prosrc) > 0 from pg_proc where oid = 'public._goldia_opening_seller_obligation(uuid,uuid)'::regprocedure) as seller_obligation,
  (select position('_goldia_opening_returned(v_od.id)' in prosrc) > 0 and position('unrated_opening_debt_valued_g' in prosrc) > 0
     from pg_proc where proname = 'rpc_record_client_currency_settlement' and pronamespace = 'public'::regnamespace) as cpay_takes_rest,
  (select position('opening_return_' in prosrc) > 0 and position('factory_settled' in prosrc) > 0 from pg_proc where proname = '_goldia_period_effects' and pronamespace = 'public'::regnamespace) as period_effects,
  (select position('v_old_ret_g' in prosrc) > 0 and position('cpay_paid' in prosrc) > 0 from pg_proc where proname = 'rpc_get_unified_customer_ledger' and pronamespace = 'public'::regnamespace)
    and (select position('currency_payment' in prosrc) > 0 and position('opening_return' in prosrc) > 0 from pg_proc where proname = 'rpc_get_daily_sales_ledger' and pronamespace = 'public'::regnamespace) as journal,
  -- new functions: present; writes need management + idempotency; the stock report and the preview are STABLE (read only)
  (select count(*) = 6 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('rpc_preview_opening_sale_return', 'rpc_record_opening_sale_return',
     'rpc_reverse_opening_sale_return', 'rpc_correct_client_payment', 'rpc_record_seller_till_count', 'rpc_get_seller_stock_movements')) as functions,
  (select bool_and(provolatile = 's') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('rpc_preview_opening_sale_return', 'rpc_get_seller_stock_movements', '_goldia_opening_return_calc')) as reads_are_stable,
  (select bool_and(position('ERR_CONFIRM_REQUIRED' in prosrc) > 0 and position('check_and_lock_idempotency' in prosrc) > 0 and position('assert_erp_permission' in prosrc) > 0)
     from pg_proc where proname = 'rpc_record_opening_sale_return' and pronamespace = 'public'::regnamespace) as return_rules,
  (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('rpc_preview_opening_sale_return', 'rpc_record_opening_sale_return', 'rpc_reverse_opening_sale_return', 'rpc_correct_client_payment',
                       'rpc_record_seller_till_count', 'rpc_get_seller_stock_movements', '_goldia_opening_returned', '_goldia_opening_return_calc',
                       '_goldia_opening_seller_obligation', 'rpc_record_client_currency_settlement', '_goldia_period_effects',
                       'rpc_get_unified_customer_ledger', 'rpc_get_daily_sales_ledger')) as no_anon,
  (select bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_goldia_opening_returned', '_goldia_opening_return_calc')) as helpers_internal;

rollback;
