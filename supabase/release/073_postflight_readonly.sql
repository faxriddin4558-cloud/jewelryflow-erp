-- PRODUCTION POSTFLIGHT for migration 073 — READ ONLY. Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000073') as recorded,
  -- A. business date
  to_regprocedure('public._goldia_business_date(timestamptz)') is not null as business_date_fn,
  public._goldia_business_date('2026-11-25 19:00:00+00') = date '2026-11-26' and public._goldia_business_date('2026-11-25 18:59:00+00') = date '2026-11-25' as business_date_boundary,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'rpc\_%'
     and p.proname not in ('rpc_execute_sheets_historical_import') and p.prosrc ~* '\mcurrent_date\M'
     and p.prosrc ~* '(jewelry_sales|gold_settlements|daily_gold_rates|refining_batches|factory_gold_handovers|seller_consignments)') as no_utc_current_date_in_sales_rpcs,
  -- 077 adds client_currency_settlements.settlement_date, 083 jewelry_sale_returns.return_date with the same business-date default
  (select count(*) = 8 + case when exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000077') then 1 else 0 end
                       + case when exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000083') then 1 else 0 end
     from information_schema.columns where table_schema = 'public' and column_default like '%_goldia_business_date()%') as document_defaults,
  -- B. reset empties the seller valued till pool
  position('till_valued_cash_uzs = 0' in pg_get_functiondef('public.rpc_execute_full_test_reset(text,text)'::regprocedure)) > 0 as reset_clears_till_pool,
  -- C. explicit pieces for weight sales
  to_regprocedure('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text,uuid[])') is not null as weight_sale_piece_ids,
  to_regprocedure('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)') is null as old_weight_sale_removed,
  -- 076 makes the piece choice optional again (business decision); the refusal is expected only before 076
  (position('ERR_PIECE_REQUIRED' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text,uuid[])'::regprocedure)) > 0
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000076')) as ambiguous_cut_refused_or_076,
  not has_function_privilege('authenticated', 'public._goldia_consume_selected_pieces(uuid,uuid,uuid[],numeric,uuid)'::regprocedure, 'EXECUTE') as consume_helper_internal,
  -- contracts of 069/070 preserved
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_rpcs,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_keeps_rpcs;

rollback;
