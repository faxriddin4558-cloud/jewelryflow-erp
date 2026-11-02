
-- ---------------------------------------------------------------- F9 policies
drop policy if exists "admin manage employees" on public.employees;
create policy "admin manage employees" on public.employees for all to authenticated
  using (organization_id = public.current_organization_id()
         and public.current_employee_role_text() = any (array['admin', 'director', 'owner', 'direktor', 'rahbar']))
  with check (organization_id = public.current_organization_id()
         and public.current_employee_role_text() = any (array['admin', 'director', 'owner', 'direktor', 'rahbar']));

drop policy if exists employees_select_own_or_authorized on public.employees;
create policy employees_select_own_or_authorized on public.employees for select to authenticated
  using ((user_id = auth.uid()) or ((id)::text = (auth.uid())::text)
         or (organization_id = public.current_organization_id()
             and public.current_employee_role_text() = any (array['admin', 'director', 'owner', 'direktor', 'rahbar',
               'manager', 'production_manager', 'production manager', 'ishlab chiqarish boshlig''i', 'accountant',
               'buxgalter', 'hisobchi', 'department_head', 'supervisor', 'master', 'bosh usta', 'usta'])));

drop policy if exists "Only admins and managers can read audit logs" on public.audit_logs;
create policy "Only admins and managers can read audit logs" on public.audit_logs for select to authenticated
  using (public.is_admin_or_manager() and organization_id = public.current_organization_id());

drop policy if exists "Authenticated users can read own idempotency keys" on public.idempotency_keys;
create policy "Authenticated users can read own idempotency keys" on public.idempotency_keys for select to authenticated
  using ((actor_id = auth.uid())
         or (public.is_admin_or_manager() and exists (
               select 1 from public.employees e
                where (e.user_id = idempotency_keys.actor_id or e.id = idempotency_keys.actor_id)
                  and e.organization_id = public.current_organization_id())));

drop policy if exists client_legacy_debts_select_policy on public.client_legacy_debts;
create policy client_legacy_debts_select_policy on public.client_legacy_debts for select to authenticated
  using (organization_id = public.current_organization_id()
         and (not public._goldia_is_seller_role(public.current_employee_role_text())
              or seller_id = public.current_employee_id()
              or exists (select 1 from public.customers c
                          where c.id = client_legacy_debts.customer_id and c.seller_id = public.current_employee_id())));

-- keep anonymous callers out of every function redefined above (069 contract)
revoke execute on function public.rpc_get_accounting_profit_summary(date, date, numeric, numeric, uuid) from public, anon;
revoke execute on function public.rpc_reverse_client_sale(uuid, text, text) from public, anon;
revoke execute on function public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric) from public, anon;
revoke execute on function public.rpc_record_client_jewelry_sale(uuid, uuid, numeric, text, text) from public, anon;
revoke execute on function public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text) from public, anon;
revoke execute on function public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text, numeric, numeric, numeric, uuid, uuid, text, integer) from public, anon;
revoke execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text) from public, anon;
revoke execute on function public.rpc_get_financial_reconciliation_summary() from public, anon;
revoke execute on function public.rpc_get_three_tier_ledger_summary() from public, anon;
revoke execute on function public.rpc_get_seller_available_pieces(uuid) from public, anon;
grant execute on function public.rpc_get_accounting_profit_summary(date, date, numeric, numeric, uuid) to authenticated, service_role;
grant execute on function public.rpc_reverse_client_sale(uuid, text, text) to authenticated, service_role;
grant execute on function public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric) to authenticated, service_role;
grant execute on function public.rpc_record_client_jewelry_sale(uuid, uuid, numeric, text, text) to authenticated, service_role;
grant execute on function public.rpc_record_factory_receipt(text, integer, numeric, numeric, numeric, uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.rpc_record_financial_transaction(text, text, numeric, text, text, text, numeric, numeric, text, numeric, numeric, numeric, uuid, uuid, text, integer) to authenticated, service_role;
grant execute on function public.rpc_record_weight_sale(uuid, uuid, numeric, numeric, text, text) to authenticated, service_role;
grant execute on function public.rpc_get_financial_reconciliation_summary() to authenticated, service_role;
grant execute on function public.rpc_get_three_tier_ledger_summary() to authenticated, service_role;
grant execute on function public.rpc_get_seller_available_pieces(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
