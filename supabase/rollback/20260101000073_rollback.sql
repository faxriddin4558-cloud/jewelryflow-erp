-- ROLLBACK for 20260101000073_goldia_reset_clears_seller_till_pool.sql (NOT a migration).
-- Restores the exact pre-073 rpc_execute_full_test_reset (072 state). Re-opens the stale till pool after a reset.
begin;

CREATE OR REPLACE FUNCTION public.rpc_execute_full_test_reset(p_confirmation_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_emp_id uuid := public.current_employee_id();
  v_reason        text := nullif(btrim(p_reason), '');
  v_rev_ts        timestamptz := now();
  v_rev_note      text;
  v_base_archived int := 0;
  v_sale_rev      int := 0;
  v_settle_rev    int := 0;
  v_piece_rev     int := 0;
  v_consign_rev   int := 0;
  v_rcp_rev       int := 0;
  v_hnd_rev       int := 0;
  v_ref_rev       int := 0;
  v_fintx_rev     int := 0;
  v_purch_rev     int := 0;
  v_leg_rev       int := 0;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id from public.employees where user_id = auth.uid() and organization_id = v_caller_org limit 1;
  end if;

  if p_confirmation_code is null or btrim(p_confirmation_code) <> 'RESET_TEST_ACCOUNT_2026' then
    raise exception 'Tasdiqlash kodi noto''g''ri. Talab qilinadi: RESET_TEST_ACCOUNT_2026';
  end if;

  if v_reason is null then
    raise exception 'Test hisobini tozalash sababi (audit uchun) kiritilishi shart';
  end if;

  v_rev_note := 'TEST HISOBI TOZALANDI: ' || v_reason || ' (' || to_char(v_rev_ts, 'YYYY-MM-DD HH24:MI') || ')';

  -- A. Reverse sales
  update public.jewelry_sales
     set status = 'reversed',
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_sale_rev = row_count;

  -- B. Reverse customer settlements and manager surrenders
  update public.gold_settlements
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']'
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_settle_rev = row_count;

  -- C. Reset client gold accounts
  update public.client_gold_accounts
     set current_debt_grams = 0,
         advance_balance_grams = 0,
         total_settled_grams = 0,
         total_purchased_gold_grams = 0,
         total_scrap_paid_grams = 0,
         total_cash_paid_amount = 0,
         total_cash_equiv_grams = 0,
         total_usd_paid_amount = 0,
         total_usd_equiv_grams = 0,
         updated_at = v_rev_ts
   where organization_id = v_caller_org;

  -- D. Reverse legacy client debts
  update public.client_legacy_debts
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'reversed';
  get diagnostics v_leg_rev = row_count;

  -- E. Mark consignment pieces CANCELLED (never returned_to_manager!)
  update public.consignment_pieces
     set status = 'cancelled',
         sale_id = null,
         sold_at = null,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'cancelled';
  get diagnostics v_piece_rev = row_count;

  -- F. Cancel seller consignments
  update public.seller_consignments
     set status = 'cancelled',
         base_weight_grams = 0,
         seller_obligation_g = 0,
         quantity = 0,
         sold_quantity = 0,
         returned_quantity = 0,
         returned_weight_grams = 0,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'cancelled';
  get diagnostics v_consign_rev = row_count;

  -- G. Reverse factory receipts
  update public.factory_receipts
     set status = 'reversed',
         available_physical_g = 0,
         transferred_physical_g = 0,
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'reversed';
  get diagnostics v_rcp_rev = row_count;

  -- H. Reverse factory gold handovers
  update public.factory_gold_handovers
     set status = 'reversed',
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']',
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status <> 'reversed';
  get diagnostics v_hnd_rev = row_count;

  -- I. Cancel refining batches
  update public.refining_batches
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_ref_rev = row_count;

  -- J. Reverse financial transactions
  update public.financial_transactions
     set status = 'reversed',
         reversed_at = v_rev_ts,
         reversed_by = v_caller_emp_id,
         reversal_reason = v_reason,
         updated_at = v_rev_ts
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_fintx_rev = row_count;

  -- J2. Reverse gold purchases
  update public.gold_purchases
     set status = 'reversed',
         notes = coalesce(notes, '') || ' [' || v_rev_note || ']'
   where organization_id = v_caller_org and status not in ('cancelled', 'reversed');
  get diagnostics v_purch_rev = row_count;

  -- K. Reset seller gold accounts to exact zero
  update public.seller_gold_accounts
     set total_transferred_physical_g = 0,
         total_seller_obligation_g = 0,
         total_settled_to_manager_g = 0,
         seller_owes_manager_g = 0,
         manager_owes_seller_g = 0,
         bozor_qarzi_signed_g = 0,
         total_consigned_gold_grams = 0,
         current_factory_obligation_grams = 0,
         current_physical_stock_g = 0,
         seller_till_scrap_grams = 0,
         seller_till_scrap_physical_g = 0,
         seller_till_scrap_585_eq_g = 0,
         seller_till_cash_amount = 0,
         seller_till_usd_amount = 0,
         seller_legacy_debt_obligation_g = 0,
         updated_at = v_rev_ts
   where organization_id = v_caller_org;

  -- L. Reset manager vault to exact zero
  perform public._get_or_create_manager_vault(v_caller_org);
  update public.manager_vault_account
     set manager_physical_stock_g        = 0,
         manager_scrap_grams             = 0,
         manager_scrap_physical_g        = 0,
         manager_scrap_585_eq_g          = 0,
         manager_refined_gold_grams      = 0,
         manager_refined_gold_fine_grams = 0,
         manager_capital_pure_gold_g     = 0,
         manager_capital_pure_gold_fine_g= 0,
         manager_finished_capital_g      = 0,
         manager_purchased_gold_grams    = 0,
         manager_cash_amount             = 0,
         manager_usd_amount              = 0,
         total_factory_received_g        = 0,
         total_factory_obligation_g      = 0,
         total_factory_handed_over_g     = 0,
         current_factory_obligation_g    = 0,
         current_factory_advance_g       = 0,
         updated_at                      = v_rev_ts
   where organization_id = v_caller_org;

  -- M. Archive active baseline
  update public.accounting_baselines
     set status = 'archived',
         notes = coalesce(notes, '') || ' [TEST HISOBI TOZALASH BILAN ARXIVLANDI: ' || v_reason || ']'
   where organization_id = v_caller_org and status = 'active';
  get diagnostics v_base_archived = row_count;

  -- N. Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id, new_data
  ) values (
    v_caller_org, 'accounting_baselines', 'FULL_RESET', 'FULL_TEST_ACCOUNT_RESET', auth.uid(),
    jsonb_build_object(
      'reason', v_reason,
      'baselines_archived', v_base_archived,
      'sales_reversed', v_sale_rev,
      'settlements_reversed', v_settle_rev,
      'consignments_cancelled', v_consign_rev,
      'pieces_cancelled', v_piece_rev,
      'receipts_reversed', v_rcp_rev,
      'handovers_reversed', v_hnd_rev,
      'refining_reversed', v_ref_rev,
      'fintx_reversed', v_fintx_rev,
      'purchases_reversed', v_purch_rev,
      'legacy_debts_reversed', v_leg_rev
    )
  );

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Test hisobi to''liq muvaffaqiyatli tozalandi va barcha faol qoldiqlar 0 ga keltirildi!',
    'summary', jsonb_build_object(
      'baselines_archived', v_base_archived,
      'sales_reversed', v_sale_rev,
      'settlements_reversed', v_settle_rev,
      'consignments_cancelled', v_consign_rev,
      'pieces_cancelled', v_piece_rev,
      'factory_receipts_reversed', v_rcp_rev,
      'factory_handovers_reversed', v_hnd_rev,
      'refining_batches_reversed', v_ref_rev,
      'financial_transactions_reversed', v_fintx_rev,
      'gold_purchases_reversed', v_purch_rev,
      'legacy_debts_reversed', v_leg_rev,
      'active_inventory_g', 0.0,
      'active_factory_obligation_g', 0.0,
      'active_customer_debts_g', 0.0,
      'active_seller_obligation_g', 0.0,
      'active_vault_scrap_g', 0.0,
      'active_vault_cash_uzs', 0.0,
      'active_vault_usd', 0.0
    )
  );
end;
$function$;

revoke execute on function public.rpc_execute_full_test_reset(text, text) from public, anon;
grant execute on function public.rpc_execute_full_test_reset(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
