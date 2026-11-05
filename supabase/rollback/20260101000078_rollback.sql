-- ROLLBACK of 078 (seller customer archive + report period reopen). Restores the 077 rpc_archive_customer (director /
-- manager only), drops the 078 guard trigger, helper functions, rpc_reopen_report_period and the archived_at /
-- archived_by columns. customers.is_archived (051) and every archive / restore audit row are KEPT, so no customer,
-- debt or history is lost; note that the 077 UI does not hide archived customers. Keeps the history row (like the
-- other supabase/rollback files; the emergency variant removes it).
CREATE OR REPLACE FUNCTION public.rpc_archive_customer(p_customer_id uuid, p_archive boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org uuid := public.current_organization_id();
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);

  update public.customers
     set is_archived = p_archive,
         updated_at = now()
   where id = p_customer_id and organization_id = v_caller_org;

  if not found then
    raise exception 'Mijoz topilmadi: %', p_customer_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'customer_id', p_customer_id,
    'is_archived', p_archive
  );
end;
$function$;

drop trigger if exists trg_goldia_guard_customer_archive on public.customers;
drop function if exists public._goldia_guard_customer_archive();
drop function if exists public._goldia_customer_open_balances(uuid);
drop function if exists public.rpc_reopen_report_period(uuid, text);
alter table public.customers drop column if exists archived_at;
alter table public.customers drop column if exists archived_by;
revoke all on function public.rpc_archive_customer(uuid, boolean) from public, anon;
grant execute on function public.rpc_archive_customer(uuid, boolean) to authenticated, service_role;
notify pgrst, 'reload schema';
