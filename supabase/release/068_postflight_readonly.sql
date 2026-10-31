-- PRODUCTION POSTFLIGHT for migration 068 — READ ONLY.

begin transaction read only;

-- Q1. 068 recorded
select version from supabase_migrations.schema_migrations where version = '20260101000068';

-- Q2. Every repaired weight sale (pieces before/after) and factory-counter change, from audit_logs
select action, record_id, old_data, new_data, created_at
  from public.audit_logs where action in ('REPAIR_WEIGHT_SALE_PIECES', 'REPAIR_FACTORY_COUNTERS') order by created_at;

-- Q3. Shelf vs authoritative stock per seller (expected: 0 rows, or only sellers with pre-barcode stock)
select sga.seller_id,
       coalesce((select sum(weight_grams) from public.consignment_pieces p where p.seller_id = sga.seller_id and p.status = 'held_by_seller'), 0) as held_pieces_g,
       sga.current_physical_stock_g as stock_g
  from public.seller_gold_accounts sga
 where abs(coalesce((select sum(weight_grams) from public.consignment_pieces p where p.seller_id = sga.seller_id and p.status = 'held_by_seller'), 0)
           - sga.current_physical_stock_g) > 0.0001;

-- Q4. Factory counters equal active receipts (expected: 0 rows)
select v.organization_id, v.total_factory_received_g, v.total_factory_obligation_g,
       (select coalesce(sum(original_physical_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled')) as receipts_g,
       (select coalesce(sum(factory_obligation_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled')) as receipts_obligation_g
  from public.manager_vault_account v
 where abs(v.total_factory_received_g - (select coalesce(sum(original_physical_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled'))) > 0.0001
    or abs(v.total_factory_obligation_g - (select coalesce(sum(factory_obligation_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled'))) > 0.0001;

rollback;
