const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  rec('S14.3b', 'capital in 10,000,000 UZS (with explicit usd rate)', await rpc(U.D, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 10000000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12800, p_idempotency_key: 'cap-1' }));
  rec('S14.3c', 'retry capital same key', await rpc(U.D, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 10000000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12800, p_idempotency_key: 'cap-1' }));
  rec('S14.4b', 'expense 500,000 UZS', await rpc(U.M, 'rpc_record_financial_transaction', { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 500000, p_currency: 'UZS', p_category: 'ijara', p_gold_rate: 1000000, p_usd_rate: 12800 }));
  rec('S14.6b', 'expense larger than vault', await rpc(U.M, 'rpc_record_financial_transaction', { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 999000000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12800 }));
  const p1 = await rpc(U.D, 'rpc_get_accounting_profit_summary', {});
  rec('S14.7b', 'profit after capital+expense; expected result -0.5000 (expense) +0 => cap neutral', { result: p1.data?.period_accounting_result_585_g, cap_in: p1.data?.capital_contributions_585_g, exp: p1.data?.business_expenses_585_g, net: p1.data?.current_net_assets_585_g, base: p1.data?.baseline?.net_assets_585_g });
  const C = Object.fromEntries((await su(`select customer_code, id from customers`)).map(r => [r.customer_code, r.id]));
  rec('S15.5', 'director records legacy debt 2.5g CA1 for seller A (as of 2026-09-30)', await rpc(U.D, 'rpc_record_client_legacy_debt', { p_customer_id: C['CUST-0001'], p_balance_type: 'debt', p_amount_585_g: 2.5, p_as_of_date: '2026-09-30', p_notes: 'eski daftar', p_idempotency_key: 'leg-3', p_seller_id: U.SA }));
  rec('S15.6', 'retry legacy same key', await rpc(U.D, 'rpc_record_client_legacy_debt', { p_customer_id: C['CUST-0001'], p_balance_type: 'debt', p_amount_585_g: 2.5, p_as_of_date: '2026-09-30', p_notes: 'eski daftar', p_idempotency_key: 'leg-3', p_seller_id: U.SA }));
  const p2 = await rpc(U.D, 'rpc_get_accounting_profit_summary', {});
  rec('S15.7', 'profit after legacy debt (expected unchanged -0.5)', { result: p2.data?.period_accounting_result_585_g, legacy: p2.data?.post_baseline_legacy_debt_adj_585_g });
  // a sale after baseline: SB sells UZ-01 4.4g @12% to CB1 -> expected profit +4.4*(1.12) - 4.4 = +0.528 (net assets: stock -4.4, debt +4.928)
  const P = (await su(`select cp.id from consignment_pieces cp where seller_id=$1 and model_code='UZ-01' and status='held_by_seller'`, [U.SB]))[0].id;
  rec('S16.1', 'SB sells UZ-01 4.4g @12% to CB1', await rpc(U.SB, 'rpc_record_barcode_piece_sale', { p_customer_id: C['CUST-0003'], p_piece_id: P, p_client_markup_pct: 12 }));
  const p3 = await rpc(U.D, 'rpc_get_accounting_profit_summary', {});
  rec('S16.2', 'profit after sale (expected -0.5 + 0.528 = 0.028)', { result: p3.data?.period_accounting_result_585_g });
  const md = await rpc(U.D, 'rpc_get_seller_markup_difference_report', {});
  rec('S16.3', 'markup difference report', { total: md.data?.total_difference_g, pos: md.data?.positive_g, neg: md.data?.negative_g, by: md.data?.by_seller?.map(b => [b.seller_name, b.total_difference_g]) });
  const rd = await rpc(U.D, 'rpc_get_company_rate_difference_report', {});
  rec('S16.4', 'rate difference report', { net: rd.data?.net_difference_585_g, gain: rd.data?.gain_585_g, loss: rd.data?.loss_585_g });
  await pool.end();
})();
