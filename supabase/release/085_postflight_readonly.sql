-- POSTFLIGHT for migration 085 (controlled financial restart + opening accounting) - READ ONLY. Every column must be true.
-- The migration creates schema and functions only: right after it no restart and no opening document exists.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000085') as recorded,
  -- the tables: RLS on, no direct write for signed-in users, nothing for anon
  (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.financial_restarts'::regclass, 'public.financial_restart_items'::regclass,
     'public.financial_backup_verifications'::regclass, 'public.opening_periods'::regclass, 'public.opening_documents'::regclass))
    and not exists (select 1 from unnest(array['financial_restarts', 'financial_restart_items', 'financial_backup_verifications', 'opening_periods', 'opening_documents']) t
                     where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
                        or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('anon', 'public.' || t, 'SELECT')) as tables_locked,
  -- the restart: definer, director only, typed confirmation, reason, T0, key, restore-verified backup (24 h, one use),
  -- one draft at a time, currency documents and balances included, archive list, audit row
  (select prosecdef
          and position('faqat direktor' in prosrc) > 0
          and position('MOLIYAVIY HISOBNI QAYTA BOSHLASH' in prosrc) > 0
          and position('ERR_BACKUP_NOT_VERIFIED' in prosrc) > 0 and position('interval ''24 hours''' in prosrc) > 0
          and position('ERR_RESTART_ALREADY_OPEN' in prosrc) > 0
          and position('update public.client_currency_settlements set status = ''reversed''' in prosrc) > 0
          and position('update public.client_currency_accounts' in prosrc) > 0
          and position('financial_restart_items' in prosrc) > 0
          and position('FINANCIAL_RESTART' in prosrc) > 0
     from pg_proc where oid = 'public.rpc_financial_restart(text,text,timestamptz,uuid,text)'::regprocedure) as restart_rules,
  not has_function_privilege('anon', 'public.rpc_financial_restart(text,text,timestamptz,uuid,text)', 'EXECUTE') as restart_not_anon,
  -- opening documents: management only, mandatory key, draft period only, duplicates refused, rates required
  (select prosecdef and position('ERR_OPENING_LOCKED' in prosrc) > 0 and position('ERR_OPENING_DUPLICATE' in prosrc) > 0
          and position('ERR_RATE_REQUIRED' in prosrc) > 0 and position('ERR_IDEMPOTENCY' in prosrc) > 0
     from pg_proc where oid = 'public.rpc_record_opening_document(text,numeric,text,text,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,uuid,uuid,text,text,text,text,text)'::regprocedure) as opening_rules,
  (select prosecdef and position('ERR_OPENING_LOCKED' in prosrc) > 0 from pg_proc where oid = 'public.rpc_cancel_opening_document(uuid,text,text)'::regprocedure) as cancel_rules,
  -- every balance engine knows the opening documents
  (select position('_goldia_opening_seller_obligation' in prosrc) > 0 from pg_proc where oid = 'public.recalc_seller_gold_account(uuid,uuid)'::regprocedure) as seller_obligation_engine,
  (select position('opening_documents' in prosrc) > 0 from pg_proc where proname = '_goldia_period_effects' and pronamespace = 'public'::regnamespace) as period_engine,
  (select bool_and(position('_goldia_opening_factory_net' in prosrc) > 0 and position('_goldia_opening_other' in prosrc) > 0) from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('rpc_get_accounting_profit_summary', 'rpc_confirm_accounting_baseline')) as profit_and_baseline,
  (select position('ERR_OPENING_SELLER_TILL_NOT_EMPTY' in prosrc) > 0 and position('status = ''locked''' in prosrc) > 0
          and position('ERR_OPENING_NOT_RECONCILED' in prosrc) > 0
     from pg_proc where proname = 'rpc_confirm_accounting_baseline' and pronamespace = 'public'::regnamespace) as baseline_locks_opening,
  -- D-1: the reconciliation proves the factory -> manager -> seller chain; the old test cleanup is refused once used
  (select position('inventory_equals_opening_receipts' in prosrc) > 0 and position('factory_obligation_equals_documents' in prosrc) > 0
     from pg_proc where oid = 'public.rpc_get_opening_state()'::regprocedure)
    and (select position('ERR_USE_FINANCIAL_RESTART' in prosrc) > 0 from pg_proc where proname = 'rpc_execute_full_test_reset' and pronamespace = 'public'::regnamespace) as d1_chain_and_reset_guard,
  -- D-4: every ordinary financial table refuses writes while an opening is in draft (database trigger, not the UI)
  (select count(distinct c.relname) = 12 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal
      and c.relname in ('jewelry_sales', 'jewelry_sale_returns', 'gold_settlements', 'client_currency_settlements', 'client_legacy_debts',
                        'seller_consignments', 'consignment_pieces', 'factory_receipts', 'factory_gold_handovers', 'refining_batches',
                        'financial_transactions', 'gold_purchases'))
    and (select position('pg_try_advisory_xact_lock_shared' in prosrc) > 0 and position('ERR_OPENING_DRAFT' in prosrc) > 0
           from pg_proc where oid = 'public._goldia_guard_opening_draft()'::regprocedure) as draft_write_guard,
  -- D-2 / D-3: currency payments carry their pool share; handovers record the company rate difference
  exists (select 1 from pg_attribute where attrelid = 'public.client_currency_settlements'::regclass and attname = 'pool_cash_585_g' and not attisdropped)
    and exists (select 1 from pg_attribute where attrelid = 'public.gold_settlements'::regclass and attname = 'company_rate_difference_585_g' and not attisdropped)
    and (select position('company_rate_difference_585_g' in prosrc) > 0 from pg_proc where proname = 'rpc_record_seller_to_manager_settlement' and pronamespace = 'public'::regnamespace)
    and (select position('till_valued_cash_585_g' in prosrc) > 0 from pg_proc where proname = 'rpc_record_client_currency_settlement' and pronamespace = 'public'::regnamespace)
    and (select position('pool_cash_585_g' in prosrc) > 0 from pg_proc where proname = 'rpc_reverse_client_currency_settlement' and pronamespace = 'public'::regnamespace) as rate_difference_and_advance,
  -- helpers are not callable by clients
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('_goldia_opening_seller_obligation', '_goldia_opening_factory_net', '_goldia_opening_other', '_goldia_vault_factory_add', '_goldia_currency_account_add', '_goldia_guard_opening_draft')
               and has_function_privilege('authenticated', p.oid, 'EXECUTE')) as helpers_private,
  -- consistency of whatever exists (empty right after the migration): one draft per organization, active documents
  -- only in a draft or locked period, a used backup verification belongs to its restart's organization
  not exists (select organization_id from public.opening_periods where status = 'draft' group by organization_id having count(*) > 1)
    and not exists (select 1 from public.opening_documents d join public.opening_periods p on p.id = d.opening_period_id
                     where d.status = 'active' and p.status = 'closed')
    and not exists (select 1 from public.financial_backup_verifications b join public.financial_restarts r on r.id = b.consumed_by_restart_id
                     where r.organization_id <> b.organization_id) as data_consistent;

rollback;
