-- POSTFLIGHT for migration 088 (factory_settled opening kind + unrated UZS / USD opening debts) - READ ONLY.
-- Every column must be true. 088 writes no business row.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000088') as recorded,
  exists (select 1 from pg_constraint where conrelid = 'public.opening_documents'::regclass and conname = 'opening_documents_kind_check'
            and pg_get_constraintdef(oid) like '%factory_settled%') as kind_allowed,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'opening_documents_one_factory_settled') as one_settlement_per_b,
  (select position('factory_settled' in prosrc) > 0 from pg_proc where oid = 'public._goldia_opening_factory_net(uuid)'::regprocedure)
    and (select position('equiv_585_g is null' in prosrc) > 0 from pg_proc where oid = 'public._goldia_opening_seller_obligation(uuid,uuid)'::regprocedure) as helpers,
  (select position('ERR_FACTORY_SETTLED_SOURCE' in prosrc) > 0 and position('hali hisoblanmagan' in prosrc) > 0 and position('ERR_RATE_REQUIRED: 585 kursi (so''m / g) kiritilishi shart' in prosrc) = 0
     from pg_proc where proname = 'rpc_record_opening_document' and pronamespace = 'public'::regnamespace) as opening_document_rules,
  (select position('factory_settled' in prosrc) > 0 from pg_proc where proname = 'rpc_cancel_opening_document' and pronamespace = 'public'::regnamespace)
    and (select position('_goldia_opening_factory_net(v_org)' in prosrc) > 0 and position('customers_uzs_unvalued' in prosrc) > 0 from pg_proc where proname = 'rpc_get_opening_state' and pronamespace = 'public'::regnamespace)
    and (select position('factory_settled' in prosrc) > 0 from pg_proc where proname = '_goldia_period_effects' and pronamespace = 'public'::regnamespace) as opening_state_and_reports,
  (select position('unrated_opening_debt_valued_g' in prosrc) > 0 from pg_proc where proname = 'rpc_record_client_currency_settlement' and pronamespace = 'public'::regnamespace)
    and (select position('recalc_seller_gold_account(v_row.seller_id' in prosrc) > 0 from pg_proc where proname = 'rpc_reverse_client_currency_settlement' and pronamespace = 'public'::regnamespace) as payments,
  not has_function_privilege('anon', 'public.rpc_get_opening_state()', 'EXECUTE') as no_anon;

rollback;
