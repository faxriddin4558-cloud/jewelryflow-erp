-- POSTFLIGHT for migration 083 (partial / full customer returns) - READ ONLY. Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000083') as recorded,
  -- the return document table: RLS on, no direct write grant, value split + status constraints present
  (select c.relrowsecurity from pg_class c where c.oid = 'public.jewelry_sale_returns'::regclass)
    and not has_table_privilege('authenticated', 'public.jewelry_sale_returns', 'INSERT')
    and not has_table_privilege('authenticated', 'public.jewelry_sale_returns', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.jewelry_sale_returns', 'DELETE')
    and not has_table_privilege('anon', 'public.jewelry_sale_returns', 'SELECT')
    and exists (select 1 from pg_constraint where conname = 'jewelry_sale_returns_value_split') as returns_table_locked,
  -- the RPC: definer, idempotency key mandatory, original-sale proportion, remainder on the last return, advance split,
  -- barcode whole piece, reversal-like rights, manager reception via rpc_return_piece_to_manager
  (select prosecdef
          and position('idempotency key) majburiy' in prosrc) > 0
          and position('v_sale.client_gold_due_grams * v_w / v_sale.base_weight_grams' in prosrc) > 0
          and position('v_sale.client_gold_due_grams - v_prev_due' in prosrc) > 0
          and position('v_adv_new  := v_value - v_debt_red' in prosrc) > 0
          and position('butun dona sifatida' in prosrc) > 0
          and position('zi amalga oshirgan savdodan vozvrat' in prosrc) > 0
          and position('public.rpc_return_piece_to_manager(v_piece_id' in prosrc) > 0
          and position('for update' in prosrc) > 0
     from pg_proc where oid = 'public.rpc_record_sale_return(uuid,numeric,text,text,text)'::regprocedure) as return_rpc_rules,
  not has_function_privilege('anon', 'public.rpc_record_sale_return(uuid,numeric,text,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_record_sale_return(uuid,numeric,text,text,text)', 'EXECUTE') as grants,
  exists (select 1 from pg_trigger where tgname = 'trg_goldia_guard_sale_reversal_with_returns' and tgrelid = 'public.jewelry_sales'::regclass) as reversal_guard,
  -- every aggregate that sums sales subtracts confirmed returns
  (select bool_and(position('jewelry_sale_returns' in p.prosrc) > 0) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('recalc_seller_gold_account', 'get_seller_available_stock_grams',
          'rpc_get_unified_customer_ledger', 'rpc_get_customer_monthly_report', 'rpc_get_daily_sales_ledger', '_goldia_period_effects',
          'rpc_get_seller_markup_difference_report', 'rpc_get_seller_reconciliation_statement', 'rpc_get_three_tier_ledger_summary',
          'rpc_execute_full_test_reset')) as aggregates_count_returns,
  -- invariant over all confirmed returns: never more than the sale (weight and value)
  not exists (select 1 from public.jewelry_sale_returns r join public.jewelry_sales s on s.id = r.sale_id
               where r.status = 'confirmed' group by s.id, s.base_weight_grams, s.client_gold_due_grams, s.sale_amount
              having sum(r.returned_weight_grams) > s.base_weight_grams or sum(r.client_gold_due_returned_g) > s.client_gold_due_grams
                  or sum(r.sale_amount_returned) > coalesce(s.sale_amount, 0) + 0.001 and max(r.sale_currency) <> 'XAU585') as returns_within_sales;

rollback;
