-- POSTFLIGHT for migration 084 (per-operation rates, no compulsory / guessed rate; customer UZS / USD balances in the
-- profit summary and the baseline) - READ ONLY. Every column must be true.
begin transaction read only;

with f as (
  select p.proname, p.prosrc, p.prosecdef from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('rpc_record_client_settlement', 'rpc_record_client_currency_settlement', 'rpc_record_seller_to_manager_settlement',
                       'rpc_record_financial_transaction', 'rpc_record_seller_to_factory_settlement', 'rpc_execute_sheets_historical_import',
                       'rpc_get_accounting_profit_summary', 'rpc_confirm_accounting_baseline')
)
select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000084') as recorded,
  -- the one rate rule: definer, entered value first, default second, otherwise refused; not callable by clients
  (select prosecdef and position('ERR_RATE_REQUIRED' in prosrc) > 0 and position('_goldia_validate_rate_value' in prosrc) > 0
          and position('max_lom_deviation_pct' in prosrc) > 0
     from pg_proc where oid = 'public._goldia_operation_rate(uuid,text,text,numeric,numeric)'::regprocedure)
    and not has_function_privilege('authenticated', 'public._goldia_operation_rate(uuid,text,text,numeric,numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public._goldia_operation_rate(uuid,text,text,numeric,numeric)', 'EXECUTE') as rate_helper,
  -- payments and the handover: no forced saved / official rate any more, the helper decides
  (select count(*) = 3 and bool_and(position('_goldia_operation_rate(' in prosrc) > 0 and position('ERR_RATE_MISMATCH' in prosrc) = 0)
     from f where proname in ('rpc_record_client_settlement', 'rpc_record_client_currency_settlement', 'rpc_record_seller_to_manager_settlement')) as payments_use_entered_rate,
  (select position('_goldia_assert_seller_rate' in prosrc) = 0 from f where proname = 'rpc_record_seller_to_manager_settlement') as handover_not_forced,
  -- no hard-coded rate constant anywhere it used to be
  (select count(*) = 5 and bool_and(prosrc !~ '\m(12800|880000|900000)(\.0+)?\M')
     from f where proname in ('rpc_get_accounting_profit_summary', 'rpc_record_financial_transaction', 'rpc_record_seller_to_factory_settlement',
                              'rpc_execute_sheets_historical_import', 'rpc_confirm_accounting_baseline')) as no_guessed_constants,
  -- a baseline without dollars stores no USD rate
  (select not attnotnull from pg_attribute where attrelid = 'public.accounting_baselines'::regclass and attname = 'usd_rate') as baseline_usd_rate_nullable,
  -- profit summary and baseline include the customers' UZS / USD debt and advance; unvalued amounts give no result
  (select position('customer_usd_debt_amount' in prosrc) > 0 and position('customer_uzs_debt_amount' in prosrc) > 0
          and position('not_valued' in prosrc) > 0 and position('currency_receivables_included' in prosrc) > 0
     from f where proname = 'rpc_get_accounting_profit_summary') as profit_counts_currency,
  (select position('currency_receivables_included' in prosrc) > 0 from f where proname = 'rpc_confirm_accounting_baseline') as baseline_counts_currency,
  -- every patched entry point is still a definer function callable by signed-in users only
  (select count(*) = 8 and bool_and(prosecdef) from f) as definer_kept,
  (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('rpc_record_client_settlement', 'rpc_record_client_currency_settlement', 'rpc_record_seller_to_manager_settlement',
                        'rpc_get_accounting_profit_summary', 'rpc_confirm_accounting_baseline')) as grants,
  -- decision 2026-11-10: a handover snapshots the rate entered for its unvalued money; nothing revalues stored rates
  exists (select 1 from pg_attribute where attrelid = 'public.gold_settlements'::regclass and attname = 'handover_entered_lom_rate' and not attisdropped)
    and (select position('handover_entered_lom_rate' in prosrc) > 0 from f where proname = 'rpc_record_seller_to_manager_settlement')
    and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.prosrc ~* 'update\s+public\.(gold_settlements|client_currency_settlements)[^;]*(gold_rate_applied|applied_usd_rate|rate_usd_uzs|rate_lom_uzs|handover_entered_lom_rate)\s*=')
    and not has_table_privilege('authenticated', 'public.gold_settlements', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.client_currency_settlements', 'UPDATE') as rate_snapshots_immutable,
  -- the manager review of the rates used: read-only definer, signed-in users only (sellers see only their own rows)
  (select prosecdef and provolatile = 's' and position('_goldia_is_management_role' in prosrc) > 0 and position('v_seller := v_emp' in prosrc) > 0
     from pg_proc where oid = 'public.rpc_get_operation_rate_review(date,date,uuid)'::regprocedure)
    and has_function_privilege('authenticated', 'public.rpc_get_operation_rate_review(date,date,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.rpc_get_operation_rate_review(date,date,uuid)', 'EXECUTE') as rate_review;

rollback;
