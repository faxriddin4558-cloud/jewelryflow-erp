"use strict";
/**
 * Shared, read-only release checks for Goldia Sales migrations (used by the production and staging release scripts).
 * Each check is a SQL query that returns true when the check passes.
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

// Turns a read-only "select <bool> as a, <bool> as b ...;" postflight file into one query that is true only
// when every column is true.
function allColumnsTrue(file) {
  const body = fs.readFileSync(file, "utf8").split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l) && !/^\s*(begin transaction read only|rollback);\s*$/i.test(l))
    .join("\n").trim().replace(/;\s*$/, "");
  return `select bool_and(v::boolean) from json_each_text((select row_to_json(x) from (${body}) x)) j(k, v)`;
}

const pf = (n) => path.join(REPO, `supabase/release/${n}_postflight_readonly.sql`);

// Version-specific postflight checks: each query returns true when the check passes.
const POSTFLIGHT_CHECKS = {
  "065": [
    ["helpers", "select count(*) = 3 from pg_proc where pronamespace = 'public'::regnamespace and proname like '\\_goldia\\_%'"],
    ["weight_sale_lock", "select position('pg_advisory_xact_lock' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0"],
  ],
  "066": [
    ["ledger_table", "select to_regclass('public.company_rate_differences') is not null"],
    ["three_triggers", "select count(*) = 3 from pg_trigger where not tgisinternal and tgname in ('trg_goldia_rate_difference_from_purchase', 'trg_goldia_valued_cash_from_settlement', 'trg_goldia_cap_valued_pool')"],
    ["report_rpc", "select to_regprocedure('public.rpc_get_company_rate_difference_report(date,date)') is not null"],
    ["usd_only_payments_allowed", "select pg_get_constraintdef(oid) like '%usd_paid_amount%' from pg_constraint where conname = 'chk_gold_settlement_has_payment'"],
    ["ledger_not_client_writable", "select count(*) = 0 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'company_rate_differences' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')"],
    // Transactions are paused during the release, so nothing can be valued yet: history stays unvalued.
    ["no_historical_valuation", "select coalesce(sum(valued_cash_uzs + valued_usd), 0) = 0 from public.manager_vault_account"],
  ],
  "067": [
    ["snapshot_triggers", "select count(*) = 2 from pg_trigger where not tgisinternal and tgname in ('trg_goldia_sale_markup_snapshot', 'trg_goldia_piece_markup_snapshot')"],
    ["report_rpc", "select to_regprocedure('public.rpc_get_seller_markup_difference_report(uuid,date,date)') is not null"],
    ["sync_trigger_enabled", "select tgenabled = 'O' from pg_trigger where tgname = 'trg_sync_seller_gold_account_sales'"],
    ["snapshot_arithmetic_exact", "select count(*) = 0 from public.jewelry_sales where markup_difference_g is not null and markup_difference_g <> round(coalesce(base_weight_grams, 0) * (client_markup_pct - assigned_seller_markup_pct) / 100.0, 4)"],
    ["piece_sale_retry_fixed", "select position('v_existing, v_payload' in pg_get_functiondef('public.rpc_record_barcode_piece_sale(uuid,uuid,uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0"],
  ],
  "068": [
    ["allocations_table", "select to_regclass('public.weight_sale_allocations') is not null"],
    ["weight_sale_multi_piece", "select position('_goldia_consume_weight_sale_pieces' in pg_get_functiondef('public.rpc_record_weight_sale(uuid,uuid,numeric,numeric,text,text)'::regprocedure)) > 0"],
    ["reversals_use_allocations", "select position('_goldia_restore_weight_sale_allocations' in pg_get_functiondef('public.rpc_reverse_client_sale(uuid,text,text)'::regprocedure)) > 0 and position('_goldia_restore_weight_sale_allocations' in pg_get_functiondef('public.rpc_reverse_jewelry_sale(uuid,text,text)'::regprocedure)) > 0"],
    ["factory_counters_match_receipts", "select count(*) = 0 from public.manager_vault_account v where abs(v.total_factory_obligation_g - (select coalesce(sum(factory_obligation_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled'))) > 0.0001 or abs(v.total_factory_received_g - (select coalesce(sum(original_physical_g), 0) from public.factory_receipts r where r.organization_id = v.organization_id and r.status not in ('reversed', 'cancelled'))) > 0.0001"],
    ["no_unrepaired_linked_shortfall", "select count(*) = 0 from public.jewelry_sales s where s.sale_type = 'weight' and s.status not in ('reversed', 'cancelled') and exists (select 1 from public.consignment_pieces p where p.sale_id = s.id and p.status = 'sold') and not exists (select 1 from public.weight_sale_allocations a where a.sale_id = s.id)"],
  ],
  "069": [
    ["no_anon_executable_rpcs", "select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')"],
    ["no_public_executable_rpcs", "select count(*) = 0 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\\_%' and a.grantee = 0"],
    ["authenticated_keeps_execute", "select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname like 'rpc\\_%' and not has_function_privilege('authenticated', p.oid, 'EXECUTE')"],
    ["ledger_no_first_org_fallback", "select position('organizations' || chr(10) || '    limit 1' in pg_get_functiondef('public.rpc_get_unified_customer_ledger(uuid,uuid)'::regprocedure)) = 0"],
    ["ledger_no_admin_fallback", "select position(chr(39) || 'admin' || chr(39) || ')' in pg_get_functiondef('public.rpc_get_unified_customer_ledger(uuid,uuid)'::regprocedure)) = 0"],
  ],
  // every column of NNN_postflight_readonly.sql must be true
  "070": [["all_070_checks", allColumnsTrue(pf("070"))]],
  "071": [["all_071_checks", allColumnsTrue(pf("071"))]],
  "072": [["all_072_checks", allColumnsTrue(pf("072"))]],
  "073": [["all_073_checks", allColumnsTrue(pf("073"))]],
  "074": [["all_074_checks", allColumnsTrue(pf("074"))]],
  "075": [["all_075_checks", allColumnsTrue(pf("075"))]],
  "076": [["all_076_checks", allColumnsTrue(pf("076"))]],
  "077": [["all_077_checks", allColumnsTrue(pf("077"))]],
  "078": [["all_078_checks", allColumnsTrue(pf("078"))], ["077_still_true", allColumnsTrue(pf("077"))], ["076_still_true", allColumnsTrue(pf("076"))]],
  "079": [["all_079_checks", allColumnsTrue(pf("079"))], ["078_still_true", allColumnsTrue(pf("078"))], ["077_still_true", allColumnsTrue(pf("077"))]],
  "080": [["all_080_checks", allColumnsTrue(pf("080"))], ["079_still_true", allColumnsTrue(pf("079"))], ["077_still_true", allColumnsTrue(pf("077"))]],
  "081": [["all_081_checks", allColumnsTrue(pf("081"))], ["080_still_true", allColumnsTrue(pf("080"))], ["076_still_true", allColumnsTrue(pf("076"))]],
  "082": [["all_082_checks", allColumnsTrue(pf("082"))], ["081_still_true", allColumnsTrue(pf("081"))], ["080_still_true", allColumnsTrue(pf("080"))]],
  "083": [["all_083_checks", allColumnsTrue(pf("083"))], ["082_still_true", allColumnsTrue(pf("082"))], ["080_still_true", allColumnsTrue(pf("080"))], ["077_still_true", allColumnsTrue(pf("077"))]],
};

// Balances a migration is allowed to change (anything else must stay identical).
const BALANCE_ALLOWED_CHANGES = { "068": ["factory_obligation_g"] };
// Repair records written by a migration.
const REPAIR_ACTIONS = { "068": ["REPAIR_WEIGHT_SALE_PIECES", "REPAIR_FACTORY_COUNTERS"] };

const COUNTS = `select string_agg(t || '=' || c, ',' order by t) from (
  select 'factory_receipts' t, count(*) c from public.factory_receipts
  union all select 'seller_consignments', count(*) from public.seller_consignments
  union all select 'consignment_pieces', count(*) from public.consignment_pieces
  union all select 'jewelry_sales', count(*) from public.jewelry_sales
  union all select 'gold_settlements', count(*) from public.gold_settlements
  union all select 'gold_purchases', count(*) from public.gold_purchases
  union all select 'client_gold_accounts', count(*) from public.client_gold_accounts
  union all select 'seller_gold_accounts', count(*) from public.seller_gold_accounts
  union all select 'employees', count(*) from public.employees) x`;
const BALANCES = `select string_agg(k || '=' || v, ',' order by k) from (
  select 'customer_debt_g' k, coalesce(sum(current_debt_grams), 0)::text v from public.client_gold_accounts
  union all select 'customer_advance_g', coalesce(sum(advance_balance_grams), 0)::text from public.client_gold_accounts
  union all select 'seller_owes_g', coalesce(sum(seller_owes_manager_g), 0)::text from public.seller_gold_accounts
  union all select 'seller_stock_g', coalesce(sum(current_physical_stock_g), 0)::text from public.seller_gold_accounts
  union all select 'vault_cash_uzs', coalesce(sum(manager_cash_amount), 0)::text from public.manager_vault_account
  union all select 'vault_usd', coalesce(sum(manager_usd_amount), 0)::text from public.manager_vault_account
  union all select 'factory_obligation_g', coalesce(sum(current_factory_obligation_g), 0)::text from public.manager_vault_account) x`;

module.exports = { REPO, allColumnsTrue, POSTFLIGHT_CHECKS, BALANCE_ALLOWED_CHANGES, REPAIR_ACTIONS, COUNTS, BALANCES };
