import re, sys
D = '/opt/goldia-audit/fix/'
def load(n): return open(D + n + '.sql').read()
def rep(s, old, new, n=1):
    c = s.count(old)
    if c != n: sys.exit(f'PATCH FAIL ({c} matches): {old[:90]!r}')
    return s.replace(old, new)
out = []
STAFF = "'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter', 'manager', 'production_manager', 'boshqaruvchi'"

# F1 profit summary: no cross-org p_org_id, staff only, expenses are no longer added back to the net result
s = load('rpc_get_accounting_profit_summary')
s = rep(s, """  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;""", f"""  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  -- 070: an explicit p_org_id may only name the caller's own organization (or be used by trusted
  -- server-side code without a JWT); company-wide profit data is restricted to management roles.
  if auth.uid() is not null then
    if v_org_id is distinct from public.current_organization_id() then
      raise exception 'Permission denied: boshqa tashkilot ma''lumotiga ruxsat yo''q' using errcode = '42501';
    end if;
    perform public.assert_erp_permission(array[{STAFF}]);
  end if;""")
s = rep(s, """    v_period_accounting_res := round(
      (v_cur_net_assets_g - v_base.net_assets_585_g)
      - v_cap_in_g
      + v_cap_out_g
      + v_expenses_g
      - v_post_base_legacy_adj,
      4
    );""", """    -- 070: business expenses are real outflows; they already reduce net assets and must NOT be
    -- added back. operational_trading_result_585_g (before expenses) is reported separately.
    v_period_accounting_res := round(
      (v_cur_net_assets_g - v_base.net_assets_585_g)
      - v_cap_in_g
      + v_cap_out_g
      - v_post_base_legacy_adj,
      4
    );""")
s = rep(s, "    'operational_trading_result_585_g', v_period_accounting_res,", "    'operational_trading_result_585_g', case when v_period_accounting_res is null then null else round(v_period_accounting_res + v_expenses_g, 4) end,\n    'result_includes_business_expenses', true,")
out.append(('profit summary', s))

# F2 reverse sale: unwind at account level so payments already received become an advance instead of vanishing
s = load('rpc_reverse_client_sale')
s = rep(s, """  v_new_cust_debt := ROUND(GREATEST(0, COALESCE(v_cust_acc.current_debt_grams, 0) - v_net_sale_debt)::numeric, 4);
  v_new_cust_adv  := ROUND((COALESCE(v_cust_acc.advance_balance_grams, 0) + COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4);""",
"""  -- 070: payments are applied at customer-account level (sale rows are usually not updated), so the
  -- reversal must remove the full sale amount from the account's net position. Whatever the customer
  -- has already paid beyond the remaining debt becomes an advance (credit) instead of disappearing.
  v_new_cust_debt := ROUND((COALESCE(v_cust_acc.current_debt_grams, 0) - COALESCE(v_cust_acc.advance_balance_grams, 0)
                            - v_sale.client_gold_due_grams)::numeric, 4);
  IF v_new_cust_debt >= 0 THEN
    v_new_cust_adv := 0;
  ELSE
    v_new_cust_adv  := ROUND(-v_new_cust_debt, 4);
    v_new_cust_debt := 0;
  END IF;""")
s = rep(s, "         total_settled_grams        = ROUND(GREATEST(0, total_settled_grams - COALESCE(v_sale.settled_gold_grams, 0))::numeric, 4),\n", "")
out.append(('reverse sale', s))

# F3 settlement lost update: make sure the account row exists before locking it
s = load('rpc_record_client_settlement')
s = rep(s, """  -- 7. Lock client gold account FOR UPDATE
  select * into v_client_acc""", """  -- 7. Lock client gold account FOR UPDATE (070: create the row first so concurrent first payments serialize)
  insert into public.client_gold_accounts (customer_id, organization_id, seller_id)
  values (v_customer.id, v_caller_org, v_seller.id)
  on conflict (customer_id) do nothing;
  select * into v_client_acc""")
s = rep(s, "    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv + v_usd_equiv)::numeric, 4),",
"    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv + v_usd_equiv)::numeric, 4),\n    total_usd_paid_amount  = round((coalesce(client_gold_accounts.total_usd_paid_amount, 0) + v_usd)::numeric, 2),\n    total_usd_equiv_grams  = round((coalesce(client_gold_accounts.total_usd_equiv_grams, 0) + v_usd_equiv)::numeric, 4),")
out.append(('client settlement', s))

# F4 whole-consignment sale: never re-sell weight already sold; markup explicit 0..100 like other sale RPCs
s = load('rpc_record_client_jewelry_sale')
s = rep(s, """  if v_cons.status in ('fully_sold', 'returned_to_factory', 'closed') or coalesce(v_cons.sold_quantity, 0) >= coalesce(v_cons.quantity, 0) then""",
"""  -- 070: only an untouched consignment may be sold as a whole; any weight sale, return or partial piece
  -- consumption means base_weight_grams no longer matches what the seller physically holds.
  if p_client_markup_pct is null or p_client_markup_pct < 0 or p_client_markup_pct > 100 then
    raise exception 'ERR_MARKUP_OUT_OF_RANGE: Mijoz ustama foizi 0 dan 100 gacha aniq ko''rsatilishi shart (kiritildi: %)', p_client_markup_pct;
  end if;
  if v_cons.status <> 'held_by_seller'
     or exists (select 1 from public.weight_sale_allocations w where w.consignment_id = v_cons.id and w.reversed_at is null)
     or exists (select 1 from public.jewelry_sales js where js.consignment_id = v_cons.id and js.status not in ('reversed', 'cancelled'))
     or (exists (select 1 from public.consignment_pieces p where p.consignment_id = v_cons.id)
         and abs(coalesce((select sum(p.weight_grams) from public.consignment_pieces p
                            where p.consignment_id = v_cons.id and p.status = 'held_by_seller'), 0) - v_cons.base_weight_grams) > 0.0001) then
    raise exception 'ERR_CONSIGNMENT_PARTIALLY_USED: Partiya % qisman sotilgan yoki qaytarilgan; donalab yoki vazn bo''yicha sotuvdan foydalaning', v_cons.consignment_no;
  end if;
  if v_cons.status in ('fully_sold', 'returned_to_factory', 'closed') or coalesce(v_cons.sold_quantity, 0) >= coalesce(v_cons.quantity, 0) then""")
s = rep(s, """    select 1 from public.consignment_pieces
    where consignment_id = v_cons.id
      and status in ('sold', 'returned_to_factory')""", """    select 1 from public.consignment_pieces
    where consignment_id = v_cons.id
      and status in ('sold', 'returned_to_factory', 'returned_to_manager')""")
# serialize with other stock-changing sales of the same seller
s = rep(s, "  -- Verify customer\n", "  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_cons.seller_id::text, 0));\n  -- Verify customer\n")
out.append(('whole consignment sale', s))

# F5 factory receipt idempotency: persist key + response
s = load('rpc_record_factory_receipt')
s = rep(s, """    proba, factory_markup_pct, factory_obligation_g, status, notes
  ) VALUES (""", """    proba, factory_markup_pct, factory_obligation_g, status, notes, idempotency_key
  ) VALUES (""")
s = rep(s, "    v_pr, v_f_pct, v_f_due_g, 'in_manager_stock', p_notes\n  ) RETURNING id INTO v_receipt_id;", "    v_pr, v_f_pct, v_f_due_g, 'in_manager_stock', p_notes, NULLIF(BTRIM(p_idempotency_key), '')\n  ) RETURNING id INTO v_receipt_id;")
s = rep(s, """  RETURN jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,""", """  v_existing := jsonb_build_object(
    'status', 'ok',
    'receipt_id', v_receipt_id,""")
s = rep(s, """    'new_total_obligation_g', v_new_obligation
  );
END;""", """    'new_total_obligation_g', v_new_obligation
  );
  -- 070: the key was checked but never stored before, so a retried request created a second receipt
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(p_idempotency_key, 'rpc_record_factory_receipt', v_existing,
      jsonb_build_object('action', 'record_factory_receipt', 'product_name', p_product_name,
        'physical_weight_g', v_phys_g, 'original_physical_g', v_phys_g, 'proba', v_pr));
  END IF;
  RETURN v_existing;
END;""")
# manager_physical_stock_g: the insert trigger already sets the canonical value; do not add the receipt twice
s = rep(s, "         manager_physical_stock_g     = ROUND(manager_physical_stock_g + v_phys_g, 4),\n", "         manager_physical_stock_g     = public.get_manager_available_stock_grams(v_org_id),\n")
out.append(('factory receipt', s))

# F6 financial transaction: currency_rates table is not created by any migration
s = load('rpc_record_financial_transaction')
s = rep(s, """    select rate_to_uzs into v_rate_usd
      from public.currency_rates
     where organization_id = v_org_id and from_currency = 'USD'
     order by rate_date desc, created_at desc limit 1;
    v_rate_usd := coalesce(v_rate_usd, 12800);""", """    -- 070: public.currency_rates is not created by any migration; query it only when it exists and
    -- never value a USD amount with a silent default rate.
    if to_regclass('public.currency_rates') is not null then
      execute 'select rate_to_uzs from public.currency_rates where organization_id = $1 and from_currency = ''USD'' order by rate_date desc, created_at desc limit 1'
        into v_rate_usd using v_org_id;
    end if;
    if v_rate_usd is null and v_cur in ('USD', 'CASH_USD') then
      raise exception 'ERR_USD_RATE_NOT_SET: USD summasi uchun USD kursi (p_usd_rate) kiritilishi shart';
    end if;
    v_rate_usd := coalesce(v_rate_usd, 12800); -- only reached for non-USD amounts (stored for reference)""")
out.append(('financial transaction', s))

# F7 weight sale: idempotent replay must be answered before the stock check
s = load('rpc_record_weight_sale')
s = rep(s, """  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_seller.id::text, 0));
  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);""", """  perform pg_advisory_xact_lock(hashtextextended('goldia_seller_stock:' || v_seller.id::text, 0));
  -- 070: a retried request (same key) must return the original result even when the stock is now used up
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_weight_sale', jsonb_build_object(
    'action', 'record_weight_sale', 'customer_id', p_customer_id, 'seller_id', v_seller.id,
    'weight_grams', v_weight, 'markup_pct', v_markup));
  if v_existing is not null then
    return v_existing;
  end if;
  v_avail_stock := public.get_seller_available_stock_grams(v_seller.id);""")
out.append(('weight sale', s))

# F8 company-wide summaries and other sellers' pieces: management only
for name in ['rpc_get_financial_reconciliation_summary', 'rpc_get_three_tier_ledger_summary']:
    s = load(name)
    s = rep(s, "\nbegin\n", f"\nbegin\n  -- 070: company-wide balances are not visible to sellers\n  perform public.assert_erp_permission(array[{STAFF}]);\n", 1)
    out.append((name, s))
s = load('rpc_get_seller_available_pieces')
s = rep(s, """  if p_seller_id is not null then
    v_target_seller := p_seller_id;""", """  -- 070: a seller may only list their own pieces
  if public._goldia_is_seller_role(public.current_employee_role_text())
     and p_seller_id is not null and p_seller_id is distinct from v_caller_emp then
    raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z mahsulotlarini ko''ra oladi' using errcode = '42501';
  end if;
  if p_seller_id is not null then
    v_target_seller := p_seller_id;""")
out.append(('seller pieces', s))

# F9 employees: organization_id is part of identity; nobody changes it through the API
s = load('prevent_employee_privilege_escalation')
s = rep(s, "begin\n  if auth.uid() is not null and not public.is_admin_or_manager() then", """begin
  -- 070: moving an employee between organizations is never allowed through the API (JWT callers)
  if auth.uid() is not null and new.organization_id is distinct from old.organization_id then
    raise exception 'Privilege escalation blocked: organization_id cannot be changed' using errcode = '42501';
  end if;
  if auth.uid() is not null and not public.is_admin_or_manager() then""")
out.append(('employee trigger', s))


# F10 daily rate: set_by references employees(id); auth.uid() is only equal to it when id = user_id
s = load('rpc_set_daily_gold_rate')
s = rep(s, "  v_caller_id   uuid := auth.uid();", "  v_caller_id   uuid := public.current_employee_id(); -- 070: employees(id), not auth.uid()")
out.append(('daily rate', s))

hdr = open(D + 'header.sql').read(); ftr = open(D + 'footer.sql').read()
body = '\n'.join(f'-- ---------------------------------------------------------------- {n}\n{s.rstrip()};\n' for n, s in out)
open('/home/user/jewelryflow-erp/supabase/migrations/20260101000070_goldia_acceptance_audit_fixes.sql', 'w').write(hdr + body + ftr)
print('ok', len(out))
