// Zero-reset ONLY on the disposable database. Verifies: role gate, confirmation code, and that everything returns to zero.
const { U, rpc, su, pool } = require('./lib');
(async () => {
  const counts = async () => (await su(`select (select count(*) from jewelry_sales)::int sales, (select count(*) from gold_settlements)::int settl, (select count(*) from factory_receipts)::int receipts,
     (select count(*) from consignment_pieces)::int pieces, (select count(*) from customers)::int customers, (select count(*) from employees)::int employees, (select count(*) from audit_logs)::int audit,
     (select coalesce(sum(manager_cash_amount),0) from manager_vault_account) cash, (select coalesce(sum(current_factory_obligation_g),0) from manager_vault_account) fobl`))[0];
  const before = await counts();
  const prev = await rpc(U.D, 'rpc_preview_full_test_reset', {});
  const m = await rpc(U.M, 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'audit' });
  const s = await rpc(U.SA, 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'audit' });
  const bad = await rpc(U.D, 'rpc_execute_full_test_reset', { p_confirmation_code: 'WRONG', p_reason: 'audit' });
  const ok = await rpc(U.D, 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'disposable audit environment reset' });
  const after = await counts();
  const recon = await rpc(U.D, 'rpc_get_financial_reconciliation_summary', {});
  console.log(JSON.stringify({ before, preview: prev.ok ? Object.keys(prev.data).slice(0, 12) : prev.error, manager: m.ok ? 'ALLOWED' : m.error.slice(0, 80), seller: s.ok ? 'ALLOWED' : s.error.slice(0, 80), wrong_code: bad.ok ? 'ALLOWED' : bad.error.slice(0, 80), director: ok.ok ? 'OK' : ok.error, after, recon: recon.ok ? recon.data : recon.error }, null, 1));
  await pool.end();
})();
