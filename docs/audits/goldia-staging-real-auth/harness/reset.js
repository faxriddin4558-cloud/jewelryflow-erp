// Zero-reset of the AUDIT organization only (function is scoped to the caller's org; verified in migration 073).
const { ORG, rpc, sel, T, R } = require('./lib');
const label = process.argv[2] || 'reset';
(async () => {
  const cnt = async (t, extra = '') => (await sel(`${t}?organization_id=eq.${ORG}&select=id${extra}`)).length;
  const otherOrgs = async () => { const v = await sel(`manager_vault_account?organization_id=neq.${ORG}&select=organization_id,current_factory_obligation_g,manager_cash_amount,manager_physical_stock_g&order=organization_id`); return JSON.stringify(v); };
  const others0 = await otherOrgs();
  const before = { sales: await cnt('jewelry_sales', '&status=not.in.(reversed,cancelled)'), receipts: await cnt('factory_receipts', '&status=not.in.(reversed,cancelled)') };
  const m = await rpc('manager', 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'audit' });
  const s = await rpc('sellera', 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'audit' });
  const bad = await rpc('director', 'rpc_execute_full_test_reset', { p_confirmation_code: 'WRONG', p_reason: 'audit' });
  T(label + '-R1', 'reset denied for manager, seller and wrong confirmation code', !m.ok && !s.ok && !bad.ok, 'denied x3', [m.ok ? 'ALLOWED' : m.error.slice(0, 50), s.ok ? 'ALLOWED' : s.error.slice(0, 50), bad.ok ? 'ALLOWED' : bad.error.slice(0, 50)]);
  const ok = await rpc('director', 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'GOLDIA AUDIT synthetic org reset' });
  const v = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0];
  const sg = await sel(`seller_gold_accounts?organization_id=eq.${ORG}&select=total_seller_obligation_g,current_physical_stock_g,seller_owes_manager_g,seller_till_cash_amount,seller_till_usd_amount,till_valued_cash_585_g,till_valued_usd_585_g`);
  const nonzero = sg.flatMap((r) => Object.entries(r).filter(([, x]) => Math.abs(Number(x || 0)) > 0.00005).map(([kk, x]) => kk + '=' + x));
  const after = { sales: await cnt('jewelry_sales', '&status=not.in.(reversed,cancelled)'), receipts: await cnt('factory_receipts', '&status=not.in.(reversed,cancelled)') };
  const others1 = await otherOrgs();
  T(label + '-R2', 'director reset: audit org balances all zero (incl. 072 valued till pool)', ok.ok && Math.abs(Number(v.o)) < 1e-4 && Math.abs(Number(v.s)) < 1e-4 && Math.abs(Number(v.c)) < 1e-4 && nonzero.length === 0 && after.sales === 0 && after.receipts === 0, 'all zero', { ok: ok.ok || ok.error, before, after, vault: v, seller_nonzero: nonzero });
  T(label + '-R3', 'other 60 organizations unchanged by the reset', others0 === others1, 'identical', others0 === others1 ? 'identical' : 'CHANGED');
  require('fs').writeFileSync(__dirname + `/../evidence/${label}.json`, JSON.stringify(R, null, 1));
})();
