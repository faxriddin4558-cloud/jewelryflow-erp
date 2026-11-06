-- ROLLBACK of 079 (D-A1 archived-customer sale block, D-A2 assignment guard). Drops the two guard triggers and their
-- functions only; no row is changed. Keeps the history row (like the other supabase/rollback files; the emergency
-- variant removes it). After it, sales to archived customers and seller self-assignment by direct write are possible again.
drop trigger if exists trg_goldia_guard_sale_archived_customer on public.jewelry_sales;
drop function if exists public._goldia_guard_sale_archived_customer();
drop trigger if exists trg_goldia_guard_customer_assignment on public.customers;
drop function if exists public._goldia_guard_customer_assignment();
notify pgrst, 'reload schema';
