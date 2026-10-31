-- PRODUCTION PREFLIGHT for migration 065 — READ ONLY.
-- Run in the Supabase SQL editor (or psql) BEFORE applying 065 and save the full output.
-- The whole script runs in a READ ONLY transaction: any write attempt is rejected by Postgres.
-- Output contains counts and identifiers only (no customer names or phone numbers).

begin transaction read only;

-- G1. Server version (pg_dump used for the backup must be >= this major version)
select version();

-- G2. Applied migrations: 20260101000064 MUST be present, 20260101000065 MUST be absent
select version, name from supabase_migrations.schema_migrations
 where version >= '20260101000060' order by version;

-- G3. Every function touched by 065 must exist exactly once (no overload drift)
select p.proname, count(*) as overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in (
   'get_seller_available_stock_grams', 'get_manager_available_stock_grams', 'recalc_seller_gold_account',
   'rpc_return_piece_to_factory', 'rpc_return_piece_to_manager', 'rpc_record_client_settlement',
   'rpc_record_seller_to_manager_settlement', 'rpc_record_barcode_piece_sale', 'rpc_record_weight_sale',
   'rpc_reverse_client_sale', 'rpc_reverse_jewelry_sale', 'rpc_reverse_client_settlement',
   'rpc_get_seller_reconciliation_statement', 'rpc_set_daily_gold_rate', 'rpc_reverse_refining_batch')
 group by 1 order by 1;

-- G4. 064 marker: get_manager_available_stock_grams must already skip receipt-backed returns
select position('factory_receipt_id IS NULL' in pg_get_functiondef('public.get_manager_available_stock_grams(uuid)'::regprocedure)) > 0
       as has_064_manager_stock_fix;

-- G5. ACL snapshot (needed to compare after a rollback)
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
   and table_name in ('manager_vault_account', 'consignment_pieces', 'seller_consignments', 'factory_receipts',
     'factory_gold_handovers', 'refining_batches', 'gold_purchases', 'daily_gold_rates', 'jewelry_sales',
     'gold_settlements', 'client_gold_accounts', 'seller_gold_accounts')
 group by 1, 2 order by 1, 2;

select p.oid::regprocedure as function, p.proacl
  from pg_proc p
 where p.oid in ('public.recalc_seller_gold_account(uuid,uuid)'::regprocedure,
                 'public.rpc_set_daily_gold_rate(numeric,numeric,date,text,text,text,numeric)'::regprocedure);

select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and cmd <> 'SELECT'
   and tablename in ('manager_vault_account', 'consignment_pieces', 'factory_receipts', 'factory_gold_handovers',
     'refining_batches', 'gold_purchases', 'daily_gold_rates')
 order by 1, 2;

-- G6. Row counts (must be identical after the migration: 065 changes no data)
select 'factory_receipts' t, count(*) from public.factory_receipts
union all select 'seller_consignments', count(*) from public.seller_consignments
union all select 'consignment_pieces', count(*) from public.consignment_pieces
union all select 'jewelry_sales', count(*) from public.jewelry_sales
union all select 'gold_settlements', count(*) from public.gold_settlements
union all select 'client_gold_accounts', count(*) from public.client_gold_accounts
union all select 'seller_gold_accounts', count(*) from public.seller_gold_accounts
union all select 'audit_logs', count(*) from public.audit_logs
order by 1;

-- D1. Pieces in status returned_to_factory (expected 0: the old RPC always failed)
select count(*) as returned_to_factory_pieces from public.consignment_pieces where status = 'returned_to_factory';

-- D2. Seller stock: old function formula vs new formula (difference = double-deducted returns)
select sga.seller_id,
       sga.current_physical_stock_g as recalc_stock_g,
       (select coalesce(sum(base_weight_grams), 0) from public.seller_consignments sc
         where sc.seller_id = sga.seller_id and sc.status in ('held_by_seller', 'partially_sold', 'fully_sold'))
     - (select coalesce(sum(base_weight_grams), 0) from public.jewelry_sales js
         where js.seller_id = sga.seller_id and js.status not in ('cancelled', 'reversed')) as new_formula_g,
       (select coalesce(sum(cp.weight_grams), 0) from public.consignment_pieces cp
          join public.seller_consignments sc on sc.id = cp.consignment_id
         where cp.seller_id = sga.seller_id and cp.status in ('returned_to_factory', 'returned_to_manager')
           and sc.status not in ('cancelled', 'reversed')) as old_formula_extra_deduction_g
  from public.seller_gold_accounts sga
 order by 1;

-- D3. Consignments marked fully_sold while pieces are still on the shelf (quantity bug)
select sc.consignment_no, sc.status, sc.quantity, sc.sold_quantity, sc.original_quantity,
       count(cp.id) filter (where cp.status = 'held_by_seller') as held_pieces
  from public.seller_consignments sc
  left join public.consignment_pieces cp on cp.consignment_id = sc.id
 where sc.status = 'fully_sold'
 group by 1, 2, 3, 4, 5
having count(cp.id) filter (where cp.status = 'held_by_seller') > 0;

-- D4. Official 585 rate that sellers will be held to after 065
select rate_date, rate_per_gram, is_confirmed, created_at from public.daily_gold_rates
 where proba = 585 order by rate_date desc, created_at desc limit 3;

-- S1. Demo accounts that must not exist (or must be disabled) in production
select email, created_at, last_sign_in_at, banned_until
  from auth.users
 where lower(email) in ('director@goldia.uz', 'manager@goldia.uz', 'seller@goldia.uz', 'accountant@goldia.uz',
   'worker@goldia.uz', 'xodim@goldia.uz', 'jamshid@jewelryflow.uz', 'dilshod@jewelryflow.uz', 'jasur@jewelryflow.uz')
    or lower(email) like 'demo.%';

rollback;
