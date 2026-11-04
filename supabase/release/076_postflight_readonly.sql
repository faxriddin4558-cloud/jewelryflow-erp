-- POSTFLIGHT for migration 076 (legacy debt for managers and sellers) - READ ONLY. Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000076') as recorded,
  position('''sales'', ''seller'', ''sotuvchi''' in pg_get_functiondef('public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure)) > 0
    and position('''manager'', ''production_manager''' in pg_get_functiondef('public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure)) > 0 as record_roles,
  position('Ushbu mijoz sizga biriktirilmagan' in pg_get_functiondef('public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure)) > 0
    and position('Qarzni kamaytirishni faqat menejer' in pg_get_functiondef('public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure)) > 0
    and position('Avansni faqat menejer' in pg_get_functiondef('public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure)) > 0 as seller_limits,
  position('Sotuvchi boshqa tashkilotga tegishli' in pg_get_functiondef('public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure)) > 0 as seller_id_org_checked,
  position('Takroriy so''''rov' in pg_get_functiondef('public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure)) > 0 as duplicate_guard,
  position('recalc_seller_gold_account' in pg_get_functiondef('public.rpc_reverse_client_legacy_debt(uuid,text,text)'::regprocedure)) > 0
    and position('keyingi qayta solishtirish' in pg_get_functiondef('public.rpc_reverse_client_legacy_debt(uuid,text,text)'::regprocedure)) > 0
    and position('''sales''' in pg_get_functiondef('public.rpc_reverse_client_legacy_debt(uuid,text,text)'::regprocedure)) = 0 as reverse_fixed,
  not has_function_privilege('anon', 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.rpc_reverse_client_legacy_debt(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)', 'EXECUTE') as grants,
  position('ERR_PIECE_REQUIRED' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text,uuid[])'::regprocedure)) = 0
    and position('_goldia_consume_weight_sale_pieces' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text,uuid[])'::regprocedure)) > 0
    and position('ERR_PIECE_EXTRA' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text,uuid[])'::regprocedure)) > 0 as weight_sale_piece_optional,
  to_regprocedure('public.rpc_reverse_financial_transaction(uuid,text,text)') is null
    and to_regprocedure('public.rpc_reverse_financial_transaction(uuid,text)') is not null as financial_reversal_unambiguous,
  (select count(*) = 0 from (select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'rpc\_%'
       and p.proname not in ('rpc_record_refining_batch') group by 1 having count(*) > 1) d) as no_other_rpc_overloads,
  (select count(*) = 3 from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('rpc_record_weight_sale', 'rpc_record_barcode_piece_sale', 'rpc_record_client_jewelry_sale')
     and position('boshqa sotuvchiga biriktirilgan' in prosrc) > 0) as sales_own_customers_only,
  (select count(*) = 2 from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('_goldia_consume_weight_sale_pieces', '_goldia_consume_selected_pieces')
     and position('v_left > 0.00005' in prosrc) > 0 and position('v_left > 0.0001 ' in prosrc) = 0) as piece_cut_threshold_fixed,
  (select prosecdef and proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid = 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure) as definer_pinned_path,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_rpcs;

rollback;
