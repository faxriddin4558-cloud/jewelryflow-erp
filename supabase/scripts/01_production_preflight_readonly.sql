-- ============================================================================
-- JEWELRYFLOW ERP — PRODUCTION PREFLIGHT READ-ONLY DIAGNOSTIC SCRIPT
-- ============================================================================
-- File: supabase/scripts/01_production_preflight_readonly.sql
-- Purpose: Read-only inspection of the live PostgreSQL / Supabase database.
-- SAFETY: This script contains ONLY SELECT statements. It makes ZERO modifications,
--         takes ZERO exclusive locks, and will NOT alter or delete any production data.
-- ============================================================================

-- 1. Database Version & Extensions
select
  version() as postgresql_version,
  current_schema() as current_schema,
  current_user as connected_role;

-- 2. Inspect Primary Key and Identity Column Types on Core ERP Tables
-- (Crucial for verifying whether inventory_items, orders, batches use UUID vs BIGINT)
select
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'inventory_items',
    'orders',
    'batches',
    'employees',
    'products',
    'sales',
    'salary_ledger',
    'consumption'
  )
  and c.column_name in ('id', 'user_id', 'order_id', 'product_id', 'batch_id', 'employee_id')
order by c.table_name, c.column_name;

-- 3. Check for Duplicate Business Keys Before Applying Unique Indexes
-- 3a. Orders: Duplicate order_no
select
  order_no,
  count(*) as duplicate_count
from public.orders
where order_no is not null and btrim(order_no) <> ''
group by order_no
having count(*) > 1;

-- 3b. Batches: Duplicate batch_no
select
  batch_no,
  count(*) as duplicate_count
from public.batches
where batch_no is not null and btrim(batch_no) <> ''
group by batch_no
having count(*) > 1;

-- 3c. Employees: Duplicate Lowercase Email
select
  lower(btrim(email)) as normalized_email,
  count(*) as duplicate_count
from public.employees
where email is not null and btrim(email) <> ''
group by lower(btrim(email))
having count(*) > 1;

-- 3d. Salary Ledger: Duplicate EARNED Records for Same Worker + Batch + Stage
select
  employee_id,
  worker_name,
  batch_no,
  stage_name,
  count(*) as duplicate_count
from public.salary_ledger
where upper(btrim(coalesce(tx_type, 'EARNED'))) = 'EARNED'
group by employee_id, worker_name, batch_no, stage_name
having count(*) > 1;

-- 4. Audit admin@goldia.uz Auth User & Linked Employee Profile
-- 4a. Supabase Auth Record for admin@goldia.uz
select
  id as auth_user_id,
  email,
  role,
  aud,
  confirmed_at,
  created_at,
  last_sign_in_at
from auth.users
where lower(email) = 'admin@goldia.uz';

-- 4b. Employees Table Records for admin@goldia.uz or Linked by user_id
select
  e.id as employee_id,
  e.user_id,
  e.email,
  e.name,
  e.full_name,
  e.role,
  e.role_type,
  e.position,
  e.department,
  e.status,
  e.employment_status,
  e.is_active
from public.employees e
where lower(coalesce(e.email, '')) = 'admin@goldia.uz'
   or e.user_id in (select u.id from auth.users u where lower(u.email) = 'admin@goldia.uz');

-- 5. Inspect Existing Tables and Row Counts
select
  t.table_name,
  coalesce(s.n_live_tup, 0) as estimated_rows
from information_schema.tables t
left join pg_stat_user_tables s
  on s.schemaname = t.table_schema and s.relname = t.table_name
where t.table_schema = 'public'
order by t.table_name;

-- 6. Inspect RLS Status on All Core Tables
select
  c.relname as table_name,
  case when c.relrowsecurity then 'ENABLED' else 'DISABLED' end as rls_status,
  case when c.relforcerowsecurity then 'FORCE' else 'NOFORCE' end as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

-- 7. Inspect Existing Check Constraints (e.g., chk_inventory_items_non_negative_and_reserved)
select
  conname as constraint_name,
  conrelid::regclass as table_name,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and contype = 'c'
order by conrelid::regclass::text, conname;

