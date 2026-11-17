-- POSTFLIGHT for migration 088 (factory_settled opening kind + unrated UZS / USD opening debts) - READ ONLY.
-- Every column must be true. 088 writes no business row.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000088') as recorded,
  exists (select 1 from pg_constraint c where c.conrelid = 'public.opening_documents'::regclass and c.conname = 'opening_documents_kind_check'
            and (select bool_and(position('''' || k || '''' in pg_get_constraintdef(c.oid)) > 0) from unnest(array['manager_inventory', 'seller_inventory',
                 'factory_obligation', 'factory_advance', 'factory_settled', 'seller_obligation', 'customer_gram', 'customer_currency', 'manager_cash',
                 'manager_scrap', 'manager_fine_gold', 'other']) k)) as kind_allowed,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'opening_documents_one_factory_settled'
            and indexdef like 'CREATE UNIQUE INDEX%(source_document_id)%' and indexdef like '%factory_settled%' and indexdef like '%active%') as one_settlement_per_b,
  (select position('factory_settled' in prosrc) > 0 from pg_proc where oid = 'public._goldia_opening_factory_net(uuid)'::regprocedure)
    and (select position('equiv_585_g is null' in prosrc) > 0 from pg_proc where oid = 'public._goldia_opening_seller_obligation(uuid,uuid)'::regprocedure) as helpers,
  (select position('ERR_FACTORY_SETTLED_SOURCE' in prosrc) > 0 and position('hali hisoblanmagan' in prosrc) > 0 and position('ERR_RATE_REQUIRED: 585 kursi (so''m / g) kiritilishi shart' in prosrc) = 0
     from pg_proc where proname = 'rpc_record_opening_document' and pronamespace = 'public'::regnamespace) as opening_document_rules,
  (select position('factory_settled' in prosrc) > 0 from pg_proc where proname = 'rpc_cancel_opening_document' and pronamespace = 'public'::regnamespace)
    and (select position('_goldia_opening_factory_net(v_org)' in prosrc) > 0 and position('customers_uzs_unvalued' in prosrc) > 0 from pg_proc where proname = 'rpc_get_opening_state' and pronamespace = 'public'::regnamespace)
    and (select position('factory_settled' in prosrc) > 0 from pg_proc where proname = '_goldia_period_effects' and pronamespace = 'public'::regnamespace) as opening_state_and_reports,
  (select position('unrated_opening_debt_valued_g' in prosrc) > 0 from pg_proc where proname = 'rpc_record_client_currency_settlement' and pronamespace = 'public'::regnamespace)
    and (select position('recalc_seller_gold_account(v_row.seller_id' in prosrc) > 0 and position('pool_seq_at_payment' in prosrc) > 0 from pg_proc where proname = 'rpc_reverse_client_currency_settlement' and pronamespace = 'public'::regnamespace)
    and exists (select 1 from pg_trigger where tgname = 'trg_goldia_pool_handover_seq' and tgrelid = 'public.gold_settlements'::regclass and not tgisinternal) as payments,
  (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_goldia_opening_factory_net', '_goldia_opening_seller_obligation', 'rpc_record_opening_document', 'rpc_cancel_opening_document',
                       'rpc_get_opening_state', '_goldia_period_effects', 'rpc_record_client_currency_settlement', 'rpc_reverse_client_currency_settlement')) as no_anon;

rollback;
