-- PRODUCTION POSTFLIGHT for migration 065 — READ ONLY. Run right after `supabase db push`.

begin transaction read only;

-- P1. 065 is recorded
select version, name from supabase_migrations.schema_migrations where version = '20260101000065';

-- P2. New helpers exist and every touched function still has exactly one signature
select p.proname, count(*) as overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in (
   '_goldia_is_seller_role', '_goldia_official_585_rate', '_goldia_assert_seller_rate',
   'get_seller_available_stock_grams', 'get_manager_available_stock_grams', 'rpc_return_piece_to_factory',
   'rpc_record_client_settlement', 'rpc_record_seller_to_manager_settlement', 'rpc_record_barcode_piece_sale',
   'rpc_record_weight_sale', 'rpc_reverse_client_sale', 'rpc_reverse_jewelry_sale',
   'rpc_reverse_client_settlement', 'rpc_get_seller_reconciliation_statement')
 group by 1 order by 1;

-- P3. Fixed function bodies are live
select
  position('_goldia_assert_seller_rate' in pg_get_functiondef('public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric)'::regprocedure)) > 0 as settlement_rate_guard,
  position('pg_advisory_xact_lock' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0 as weight_sale_lock,
  position('returned_to_manager' in pg_get_functiondef('public.get_seller_available_stock_grams(uuid)'::regprocedure)) = 0 as seller_stock_no_double_deduction;

-- P4. No client write policies remain on ledger/stock tables (expected: 0 rows)
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and cmd <> 'SELECT'
   and tablename in ('manager_vault_account', 'consignment_pieces', 'factory_receipts', 'factory_gold_handovers',
     'refining_batches', 'gold_purchases', 'daily_gold_rates');

-- P5. No INSERT/UPDATE/DELETE for API roles on those tables (expected: 0 rows)
select table_name, grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
   and table_name in ('manager_vault_account', 'consignment_pieces', 'seller_consignments', 'factory_receipts',
     'factory_gold_handovers', 'refining_batches', 'gold_purchases', 'daily_gold_rates', 'jewelry_sales',
     'gold_settlements', 'client_gold_accounts', 'seller_gold_accounts');

-- P6. Row counts: must equal preflight G6 exactly
select 'factory_receipts' t, count(*) from public.factory_receipts
union all select 'seller_consignments', count(*) from public.seller_consignments
union all select 'consignment_pieces', count(*) from public.consignment_pieces
union all select 'jewelry_sales', count(*) from public.jewelry_sales
union all select 'gold_settlements', count(*) from public.gold_settlements
union all select 'client_gold_accounts', count(*) from public.client_gold_accounts
union all select 'seller_gold_accounts', count(*) from public.seller_gold_accounts
union all select 'audit_logs', count(*) from public.audit_logs
order by 1;

rollback;
