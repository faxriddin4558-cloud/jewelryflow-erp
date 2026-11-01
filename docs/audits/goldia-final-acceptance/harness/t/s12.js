const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  rec('S14.8', 'capital 10,000,000 UZS without USD rate (UI default when field empty)', await rpc(U.D, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 10000000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: null, p_idempotency_key: 'cap-0' }));
  rec('S14.9', 'capital 10,000,000 UZS with usd rate', await rpc(U.D, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 10000000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12800, p_idempotency_key: 'cap-1' }));
  rec('S14.10', 'retry same key', await rpc(U.D, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 10000000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12800, p_idempotency_key: 'cap-1' }));
  rec('S14.11', 'expense 500,000 UZS', await rpc(U.M, 'rpc_record_financial_transaction', { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 500000, p_currency: 'UZS', p_category: 'ijara', p_gold_rate: 1000000, p_usd_rate: 12800 }));
  rec('S14.12', 'expense larger than vault', await rpc(U.M, 'rpc_record_financial_transaction', { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 999000000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12800 }));
  const p1 = await rpc(U.D, 'rpc_get_accounting_profit_summary', {});
  rec('S14.13', 'profit (expected 0.528 - 0.5 = 0.028)', { result: p1.data?.period_accounting_result_585_g, cap_in: p1.data?.capital_contributions_585_g, exp: p1.data?.business_expenses_585_g, cash: p1.data?.components?.cash_uzs_amount });
  console.log(JSON.stringify(await su(`select transaction_type, source_till, amount_num, currency, equiv_585_grams, status from financial_transactions`)));
  await pool.end();
})();
