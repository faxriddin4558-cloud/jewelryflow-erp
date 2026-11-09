-- POSTFLIGHT for migration 081 (sellers may enter a legacy advance for their own customers) - READ ONLY.
-- Every column must be true.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000081') as recorded,
  -- the 076 blanket refusal is gone, the 081 rules are present
  (select position('Avansni faqat menejer yoki direktor kiritadi' in prosrc) = 0
          and position('v_is_seller and v_bal_type = ''advance''' in prosrc) > 0
          and position('v_cur_debt > 0' in prosrc) > 0
          and position('p_target_final_balance is not null' in prosrc) > 0
          and position('v_is_seller and v_bal_type = ''debt'' and v_delta <= 0' in prosrc) > 0
     from pg_proc where oid = 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure) as seller_advance_rules,
  -- 076 rules kept: own customer, booked on himself, other organization's seller refused, duplicate guard
  (select position('sizga biriktirilmagan' in prosrc) > 0 and position('nomiga kirita oladi' in prosrc) > 0
          and position('boshqa tashkilotga tegishli' in prosrc) > 0 and position('10 minutes' in prosrc) > 0 and prosecdef
     from pg_proc where oid = 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)'::regprocedure) as rules_076_kept,
  not has_function_privilege('anon', 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_record_client_legacy_debt(uuid,text,numeric,date,text,text,numeric,text,uuid)', 'EXECUTE') as grants,
  -- reversal stays management only (no seller token in its permission list)
  (select position('''seller''' in prosrc) = 0 and position('''sales''' in prosrc) = 0
     from pg_proc where oid = 'public.rpc_reverse_client_legacy_debt(uuid,text,text)'::regprocedure) as reversal_management_only,
  -- seller obligation formula unchanged: debt-type legacy rows only
  (select position('balance_type = ''debt''' in prosrc) > 0 from pg_proc where oid = 'public.recalc_seller_gold_account(uuid,uuid)'::regprocedure) as obligation_counts_debt_only;

rollback;
