-- PRODUCTION POSTFLIGHT for migration 067 — READ ONLY.

begin transaction read only;

-- Q1. 067 recorded
select version from supabase_migrations.schema_migrations where version = '20260101000067';

-- Q2. Snapshot triggers and report RPC exist (expected: 2, t)
select (select count(*) from pg_trigger where not tgisinternal
          and tgname in ('trg_goldia_sale_markup_snapshot', 'trg_goldia_piece_markup_snapshot')) as triggers,
       to_regprocedure('public.rpc_get_seller_markup_difference_report(uuid,date,date)') is not null as report_rpc;

-- Q3. Historical backfill: reconstructed vs unknown (unknown = assigned markup not provable)
select coalesce(markup_snapshot_source, 'unknown') as snapshot, status in ('reversed', 'cancelled') as reversed,
       count(*) as sales, round(coalesce(sum(markup_difference_g), 0), 4) as difference_g
  from public.jewelry_sales group by 1, 2 order by 1, 2;

-- Q4. Snapshot arithmetic is exact for every filled row (expected: 0)
select count(*) as wrong_rows from public.jewelry_sales
 where markup_difference_g is not null
   and markup_difference_g <> round(coalesce(base_weight_grams, 0) * (client_markup_pct - assigned_seller_markup_pct) / 100.0, 4);

-- Q5. Sync trigger re-enabled after the backfill (expected: O = enabled)
select tgenabled from pg_trigger where tgname = 'trg_sync_seller_gold_account_sales';

rollback;
