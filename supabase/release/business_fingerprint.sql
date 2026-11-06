-- GOLDIA business fingerprint (SELECT only; no transaction statements - the caller wraps it).
-- One row per category: (category, rows, md5). Balances and history columns that exist since 076, explicitly listed,
-- so a migration that only ADDS columns / tables / functions keeps every md5 identical. Used by
--   * scripts/goldia-prod-release.js --chain-to: snapshot before the chain and an equality gate after EVERY migration
--     inside the release transaction (any difference raises -> the whole chain is rolled back);
--   * scripts/goldia-prod-backup-and-preflight.js --chain-to: the same gates on the restored local copy, and after the
--     emergency rollbacks back to 076;
--   * docs/releases/production-075/06_prelaunch_078_079_readonly.sql (read-only print).
-- Timestamps (updated_at) are excluded on purpose. Row counts of EVERY public table are included (category "rows <table>").
select category, n, h from (
  select 'balances client_gold_accounts' as category, count(*) as n,
         md5(coalesce(string_agg(concat_ws('|', customer_id, organization_id, seller_id, current_debt_grams, advance_balance_grams, total_scrap_paid_grams,
             total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams, total_usd_paid_amount, total_usd_equiv_grams), ';' order by customer_id), '')) as h
    from public.client_gold_accounts
  union all
  select 'balances seller_gold_accounts', count(*),
         md5(coalesce(string_agg(concat_ws('|', seller_id, organization_id, current_physical_stock_g, total_seller_obligation_g, seller_owes_manager_g, manager_owes_seller_g,
             seller_till_cash_amount, seller_till_usd_amount, seller_till_scrap_grams, seller_till_scrap_physical_g, seller_till_scrap_585_eq_g, seller_legacy_debt_obligation_g,
             till_valued_cash_uzs, till_valued_cash_585_g, till_valued_usd, till_valued_usd_585_g), ';' order by seller_id), ''))
    from public.seller_gold_accounts
  union all
  select 'balances manager_vault_account', count(*),
         md5(coalesce(string_agg(concat_ws('|', organization_id, manager_cash_amount, manager_usd_amount, manager_physical_stock_g, manager_scrap_grams, manager_scrap_physical_g,
             manager_scrap_585_eq_g, manager_refined_gold_grams, manager_purchased_gold_grams, manager_capital_pure_gold_g, manager_finished_capital_g, current_factory_obligation_g,
             total_factory_obligation_g, total_factory_received_g, total_factory_handed_over_g, current_factory_advance_g, valued_cash_uzs, valued_cash_585_g, valued_usd, valued_usd_585_g), ';' order by organization_id), ''))
    from public.manager_vault_account
  union all
  select 'customers', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, seller_id, customer_code, contact_name, phone, is_archived), ';' order by id), ''))
    from public.customers
  union all
  select 'history jewelry_sales', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, sale_no, status, customer_id, seller_id, sale_date, base_weight_grams, client_gold_due_grams), ';' order by id), ''))
    from public.jewelry_sales
  union all
  select 'history gold_settlements', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, status, direction, customer_id, seller_id, sale_id, settlement_date, cash_paid_amount, usd_paid_amount,
             scrap_weight_grams, applied_to_debt_grams, excess_gold_grams, remaining_debt_grams), ';' order by id), ''))
    from public.gold_settlements
  union all
  select 'history financial_transactions', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, transaction_type, status, source_till, amount_num, currency, equiv_585_grams, transaction_date), ';' order by id), ''))
    from public.financial_transactions
  union all
  select 'history consignment_pieces', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, consignment_id, status, seller_id, sale_id, weight_grams), ';' order by id), ''))
    from public.consignment_pieces
  union all
  select 'history seller_consignments', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, seller_id, status, base_weight_grams, seller_obligation_g, returned_weight_grams), ';' order by id), ''))
    from public.seller_consignments
  union all
  select 'history factory_receipts', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, status, original_physical_g, available_physical_g, transferred_physical_g, factory_obligation_g), ';' order by id), ''))
    from public.factory_receipts
  union all
  select 'history client_legacy_debts', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, customer_id, seller_id, status, delta_585_g, new_debt_585_g, new_advance_585_g), ';' order by id), ''))
    from public.client_legacy_debts
  union all
  select 'history gold_purchases', count(*),
         md5(coalesce(string_agg(concat_ws('|', id, organization_id, status, gold_weight_grams, equiv_585_grams, cash_spent_uzs, usd_spent), ';' order by id), ''))
    from public.gold_purchases
  union all
  -- row counts of every public base table (a table created by a migration simply has no snapshot row to compare with)
  select 'rows ' || c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint, ''
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname not in ('audit_logs', 'idempotency_keys')
) fp
