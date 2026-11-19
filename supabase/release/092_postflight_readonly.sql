-- POSTFLIGHT for migration 092 (old-sale return without an opening debt; old / new / advance parts) - READ ONLY.
-- Every column must be true. 092 writes no business row.
begin transaction read only;

select
  exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000092') as recorded,
  (select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'opening_sale_returns' and column_name = 'opening_document_id') as document_optional,
  (select is_generated = 'ALWAYS' and generation_expression like '%debt_reduced - opening_part%'
     from information_schema.columns where table_schema = 'public' and table_name = 'opening_sale_returns' and column_name = 'new_debt_part') as new_part_stored,
  -- 092 writes no business row: every return so far still has its opening document
  not exists (select 1 from public.opening_sale_returns where opening_document_id is null) as no_rows_written,
  -- the 089 checks stay: value split, opening part never above the debt part
  exists (select 1 from pg_constraint where conrelid = 'public.opening_sale_returns'::regclass and conname = 'opening_sale_returns_value_split')
    and exists (select 1 from pg_constraint where conrelid = 'public.opening_sale_returns'::regclass and conname = 'opening_sale_returns_opening_part') as split_checks,
  (select position('ERR_NO_OPENING_DEBT' in prosrc) = 0 and position('ERR_CUSTOMER_NO_SELLER' in prosrc) > 0 and position('new_debt_part' in prosrc) > 0
          and position('_goldia_opening_returned(v_doc.id)' in prosrc) > 0
     from pg_proc where proname = '_goldia_opening_return_calc' and pronamespace = 'public'::regnamespace) as calc_rule,
  (select position('ERR_SELLER_KEEP_NOT_DOCUMENTED' in prosrc) > 0 and position('check_and_lock_idempotency' in prosrc) > 0
     from pg_proc where proname = 'rpc_record_opening_sale_return' and pronamespace = 'public'::regnamespace) as record_rules,
  (select position('v_legacy_debt - v_ret_old' in prosrc) > 0 and position('v_gross_sales - v_ret_new' in prosrc) > 0 and position('v_total_paid + v_ret_adv' in prosrc) > 0
     from pg_proc where proname = 'rpc_get_unified_customer_ledger' and pronamespace = 'public'::regnamespace) as ledger_split,
  (select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('_goldia_opening_return_calc', 'rpc_record_opening_sale_return', 'rpc_get_unified_customer_ledger', 'rpc_preview_opening_sale_return')) as no_anon,
  (select count(distinct c.relname) = 12 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'trg_goldia_opening_draft_guard' and not tg.tgisinternal) as draft_guard_12;

rollback;
