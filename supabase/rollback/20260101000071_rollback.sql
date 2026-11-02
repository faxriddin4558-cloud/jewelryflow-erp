-- ROLLBACK for migration 20260101000071_goldia_seller_company_stock_guard.sql
-- NOT a migration (never applied automatically). Restores the pre-071 grant (any signed-in user may call
-- get_manager_available_stock_grams) and drops the management-only wrapper. No business rows are touched.
-- Re-opens the seller read of the company stock total; run only if 071 breaks a legitimate workflow.

begin;

grant execute on function public.get_manager_available_stock_grams(uuid) to authenticated, service_role;
drop function if exists public.rpc_get_manager_available_stock_grams();

notify pgrst, 'reload schema';

commit;
