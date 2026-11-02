-- JewelryFlow ERP Migration 20260101000071
-- GOLDIA SALES: sellers cannot read the company (manager) stock total
--
-- get_manager_available_stock_grams(p_org_id) is a SECURITY DEFINER helper that returns the manager's
-- available stock for the whole organization. Any signed-in user could call it, so a seller could read a
-- company total (audit 2026-11: seller A received 455 g). Every database caller of the helper is itself a
-- SECURITY DEFINER function or trigger owned by postgres, so they keep working after the client EXECUTE
-- grant is revoked. Management screens read the same number through rpc_get_manager_available_stock_grams(),
-- which requires a management role. No data is modified and no formula changes.

create or replace function public.rpc_get_manager_available_stock_grams()
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := public.current_organization_id();
begin
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  return public.get_manager_available_stock_grams(v_org_id);
end;
$$;

revoke execute on function public.rpc_get_manager_available_stock_grams() from public, anon;
grant execute on function public.rpc_get_manager_available_stock_grams() to authenticated, service_role;

revoke execute on function public.get_manager_available_stock_grams(uuid) from public, anon, authenticated;
grant execute on function public.get_manager_available_stock_grams(uuid) to service_role;

notify pgrst, 'reload schema';
