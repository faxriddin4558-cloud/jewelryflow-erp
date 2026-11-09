-- POSTFLIGHT for migration 082 (customer monthly report with signed balances) - READ ONLY.
-- Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000082') as recorded,
  -- the 073 clamps are gone, legacy advance rows are counted, the advance / net keys exist, old keys kept
  -- (closing line matched up to the sales term: 083 extends it with - v_month_returns)
  (select position('round(greatest(0, v_open_debt), 4)' in prosrc) = 0
          and position('v_close_net  := round(v_open_net + v_month_legacy - v_month_legacy_adv + v_month_sales' in prosrc) > 0
          and position('''closing_net_g''' in prosrc) > 0 and position('''closing_advance_g''' in prosrc) > 0
          and position('''total_closing_net_g''' in prosrc) > 0 and position('''closing_debt_g''' in prosrc) > 0
          and position('''total_customer_debt_g''' in prosrc) > 0
          and position('balance_type = ''advance''' in prosrc) > 0
     from pg_proc where oid = 'public.rpc_get_customer_monthly_report(uuid,integer,integer)'::regprocedure) as signed_monthly_report,
  -- permission rules of the report unchanged (organization required, seller sees only his own report), SECURITY DEFINER
  (select position('Permission denied: User must belong to an active organization' in prosrc) > 0
          and position('Cross-seller violation' in prosrc) > 0 and prosecdef
     from pg_proc where oid = 'public.rpc_get_customer_monthly_report(uuid,integer,integer)'::regprocedure) as report_rules_kept,
  not has_function_privilege('anon', 'public.rpc_get_customer_monthly_report(uuid,integer,integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_get_customer_monthly_report(uuid,integer,integer)', 'EXECUTE') as grants,
  -- the report is read-only: no insert / update / delete in its body
  (select prosrc !~* '\m(insert\s+into|update\s+public\.|delete\s+from)\M'
     from pg_proc where oid = 'public.rpc_get_customer_monthly_report(uuid,integer,integer)'::regprocedure) as report_writes_nothing;

rollback;
