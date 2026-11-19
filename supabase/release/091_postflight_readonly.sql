-- POSTFLIGHT for migration 091 (gold handover keeps C2 / C / goods returns in the factory account, seller LOM
-- purchase) - READ ONLY. Every column must be true. 091 writes no business row.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000091') as recorded,
  -- C2 fix: the handover and its reversal move the account by their own 585 equivalent through the vault helper;
  -- nothing recomputes the handed-over total from the handover rows any more
  (select position('_goldia_vault_factory_add(v_org_id, 0, v_agreed_eq)' in prosrc) > 0
          and position('sum(agreed_equivalent_g), 0) into v_new_handed_over' in prosrc) = 0
     from pg_proc where proname = 'rpc_record_factory_gold_handover' and pronamespace = 'public'::regnamespace) as handover_delta,
  (select position('_goldia_vault_factory_add(v_caller_org, 0, -v_hnd.agreed_equivalent_g)' in prosrc) > 0
          and position('GREATEST(0, v_vault.total_factory_handed_over_g' in prosrc) = 0
     from pg_proc where proname = 'rpc_reverse_factory_gold_handover' and pronamespace = 'public'::regnamespace) as reversal_delta,
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname not in ('_goldia_repair_factory_counters', 'rpc_financial_restart', 'rpc_execute_full_test_reset')
                and prosrc ~ 'total_factory_handed_over_g\s*=\s*v_new_handed_over') as no_recompute_left,
  -- the generic reversal still refuses a finished-goods return; restart / test reset may reverse it
  (select position('goldia.fgr_bulk' in prosrc) > 0 and position('goldia.opening_write' in prosrc) = 0 and position('ERR_FINISHED_GOODS_HANDOVER' in prosrc) > 0
     from pg_proc where proname = '_goldia_guard_finished_goods_handover' and pronamespace = 'public'::regnamespace)
    and exists (select 1 from pg_trigger where tgname = 'trg_goldia_guard_finished_goods_handover' and tgenabled = 'O') as goods_guard,
  (select bool_and(position('seller_lom_purchases' in prosrc) > 0 and position('factory_goods_returns' in prosrc) > 0
                   and position('set_config(''goldia.fgr_bulk'', '''', true)' in prosrc) > 0)
     from pg_proc where proname in ('rpc_financial_restart', 'rpc_execute_full_test_reset') and pronamespace = 'public'::regnamespace) as restart_covers_new_tables,
  -- seller LOM purchase: table read-only for users, RLS, constraints; RPCs management / own seller, idempotent, audited
  (select c.relrowsecurity from pg_class c where c.oid = 'public.seller_lom_purchases'::regclass)
    and has_table_privilege('authenticated', 'public.seller_lom_purchases', 'SELECT')
    and not has_table_privilege('authenticated', 'public.seller_lom_purchases', 'INSERT')
    and not has_table_privilege('authenticated', 'public.seller_lom_purchases', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.seller_lom_purchases', 'DELETE')
    and not has_table_privilege('anon', 'public.seller_lom_purchases', 'SELECT') as lom_table_read_only,
  exists (select 1 from pg_constraint where conrelid = 'public.seller_lom_purchases'::regclass and conname = 'seller_lom_purchases_equiv')
    and exists (select 1 from pg_constraint where conrelid = 'public.seller_lom_purchases'::regclass and conname = 'seller_lom_purchases_reversal') as lom_constraints,
  -- in the transaction that applies 091: no row; any later check: every purchase consistent (585 = g x proba / 585, status pair, audit)
  -- (091 applied in THIS transaction = the history row's xmin is this transaction's id)
  case when (select (h.xmin::text)::bigint from supabase_migrations.schema_migrations h where h.version = '20260101000091')
              = (pg_current_xact_id_if_assigned()::text::bigint % 4294967296) then (select count(*) = 0 from public.seller_lom_purchases)
       else not exists (select 1 from public.seller_lom_purchases x
                         where abs(x.equiv_585_g - round(x.physical_g * x.proba / 585.0, 4)) >= 0.00005
                            or (x.status = 'reversed') <> (x.reversed_at is not null)
                            or not exists (select 1 from public.audit_logs l where l.record_id = x.id::text and l.action = 'SELLER_LOM_PURCHASE')) end as no_rows_written_or_rows_consistent,
  (select bool_and(position(x in prosrc) > 0) from pg_proc, unnest(array['ERR_INSUFFICIENT_CASH_BALANCE', 'ERR_NOT_OWN_TILL', 'ERR_PROBA', 'ERR_FINANCIAL_FREEZE', 'ERR_OPENING_DRAFT',
       'check_and_lock_idempotency', 'for update', 'till_valued_cash_585_g', 'seller_till_scrap_physical_g', 'SELLER_LOM_PURCHASE', '/ 585.0']) x
    where proname = 'rpc_record_seller_lom_purchase' and pronamespace = 'public'::regnamespace) as lom_purchase_rules,
  (select bool_and(position(x in prosrc) > 0) from pg_proc, unnest(array['ERR_LOM_ALREADY_USED', 'ERR_ALREADY_REVERSED', 'ERR_REASON_REQUIRED', 'check_and_lock_idempotency']) x
    where proname = 'rpc_reverse_seller_lom_purchase' and pronamespace = 'public'::regnamespace) as lom_reversal_rules,
  -- the purchase never touches the customer, the obligation, the factory or profit
  (select position('client_gold_accounts' in prosrc) = 0 and position('seller_owes_manager_g' in prosrc) = 0 and position('manager_vault_account' in prosrc) = 0
          and position('jewelry_sales' in prosrc) = 0
     from pg_proc where proname = 'rpc_record_seller_lom_purchase' and pronamespace = 'public'::regnamespace) as lom_purchase_isolated,
  (select position('seller_lom_purchase' in prosrc) > 0 from pg_proc where proname = '_goldia_period_effects' and pronamespace = 'public'::regnamespace) as period_report,
  (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('rpc_record_seller_lom_purchase', 'rpc_reverse_seller_lom_purchase', 'rpc_record_factory_gold_handover', 'rpc_reverse_factory_gold_handover', '_goldia_period_effects')) as no_anon,
  -- the draft / freeze guard stays on exactly its 12 tables
  (select count(distinct c.relname) = 12 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal) as draft_guard_12;

rollback;
