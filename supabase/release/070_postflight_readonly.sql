-- PRODUCTION POSTFLIGHT for migration 070 — READ ONLY. Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000070') as recorded,
  -- F1 profit summary: own organization + management roles; F1b expenses not added back
  position('boshqa tashkilot' in pg_get_functiondef('public.rpc_get_accounting_profit_summary(date,date,numeric,numeric,uuid)'::regprocedure)) > 0 as f1_org_guard,
  position(E'+ v_cap_out_g\n      + v_expenses_g' in pg_get_functiondef('public.rpc_get_accounting_profit_summary(date,date,numeric,numeric,uuid)'::regprocedure)) = 0 as f1b_no_expense_addback,
  position('result_includes_business_expenses' in pg_get_functiondef('public.rpc_get_accounting_profit_summary(date,date,numeric,numeric,uuid)'::regprocedure)) > 0 as f1b_before_after_fields,
  -- F2 reversal keeps payments as advance
  position('v_new_cust_adv  := ROUND(-v_new_cust_debt, 4)' in pg_get_functiondef('public.rpc_reverse_client_sale(uuid,text,text)'::regprocedure)) > 0 as f2_reversal_advance,
  -- F3 account row created before lock
  position('on conflict (customer_id) do nothing' in pg_get_functiondef('public.rpc_record_client_settlement(uuid,uuid,numeric,numeric,numeric,numeric,date,text,text,uuid,numeric,numeric)'::regprocedure)) > 0 as f3_lock_first_payment,
  -- F4 whole-consignment guard
  position('ERR_CONSIGNMENT_PARTIALLY_USED' in pg_get_functiondef('public.rpc_record_client_jewelry_sale(uuid,uuid,numeric,text,text)'::regprocedure)) > 0 as f4_oversell_guard,
  -- F5 receipt idempotency stored
  position('save_idempotency_response' in pg_get_functiondef('public.rpc_record_factory_receipt(text,integer,numeric,numeric,numeric,uuid,uuid,text,text)'::regprocedure)) > 0 as f5_receipt_idempotency,
  -- F6 no hard dependency on currency_rates
  position('to_regclass(''public.currency_rates'')' in pg_get_functiondef('public.rpc_record_financial_transaction(text,text,numeric,text,text,text,numeric,numeric,text,numeric,numeric,numeric,uuid,uuid,text,integer)'::regprocedure)) > 0 as f6_currency_rates_optional,
  -- F7 weight-sale replay before stock check
  position('a retried request (same key)' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0 as f7_weight_retry,
  -- F8 company summaries management only
  position('assert_erp_permission' in pg_get_functiondef('public.rpc_get_financial_reconciliation_summary()'::regprocedure)) > 0
    and position('assert_erp_permission' in pg_get_functiondef('public.rpc_get_three_tier_ledger_summary()'::regprocedure)) > 0 as f8_summaries_staff_only,
  -- F9 organization-scoped employee/audit/idempotency policies + immutable organization_id
  (select count(*) = 4 from pg_policies where schemaname = 'public' and qual like '%current_organization_id()%'
     and (tablename, policyname) in (('employees','admin manage employees'), ('employees','employees_select_own_or_authorized'),
          ('audit_logs','Only admins and managers can read audit logs'), ('idempotency_keys','Authenticated users can read own idempotency keys'))) as f9_org_policies,
  position('organization_id cannot be changed' in pg_get_functiondef('public.prevent_employee_privilege_escalation()'::regprocedure)) > 0 as f9_org_immutable,
  -- F10 daily rate set_by = employee id
  position('public.current_employee_id(); -- 070' in pg_get_functiondef('public.rpc_set_daily_gold_rate(numeric,numeric,date,text,text,text,numeric)'::regprocedure)) > 0 as f10_rate_set_by,
  -- F11 legacy debts seller-scoped
  (select count(*) = 1 from pg_policies where tablename = 'client_legacy_debts' and policyname = 'client_legacy_debts_select_policy' and qual like '%_goldia_is_seller_role%') as f11_legacy_scoped,
  -- 069 contract preserved
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as no_anon_rpcs,
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\_%'
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_keeps_rpcs;

rollback;
