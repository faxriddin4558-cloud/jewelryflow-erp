// K4 on a FRESH till (org C, seller B of C): one 900 000 UZS payment at 900 000 UZS/g = exactly 1 g in the till, then two
// parallel handovers of the whole till -> exactly one succeeds, settled grows by exactly 1 g, till 0.
process.env.GA_CREDS = '/tmp/claude-0/-home-user-jewelryflow-erp/831fb3b9-adcd-5c4c-b551-ff376e212168/scratchpad/stg085d/creds.json';
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const S = 'c_sellerb';
  const cust = (await L.rpc(S, 'rpc_create_customer_with_code', { p_contact_name: `C85 K4 ${run}` })).data.customer_id;
  const rate = await L.rpc(S, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12600, p_reason: 'K4' });
  const pay = await L.rpc(S, 'rpc_record_client_settlement', { p_customer_id: cust, p_cash_amount: 900000, p_idempotency_key: `k4-pay-${run}` });
  const till = (await L.sel(`seller_gold_accounts?seller_id=eq.${C[S].id}&select=c:seller_till_cash_amount,st:total_settled_to_manager_g`))[0];
  const k4 = await Promise.all([1, 2].map((i) => L.rpc(S, 'rpc_record_seller_to_manager_settlement', { p_seller_id: C[S].id, p_cash_paid_amount: Number(till.c), p_idempotency_key: `k4-ho-${run}-${i}` })));
  const after = (await L.sel(`seller_gold_accounts?seller_id=eq.${C[S].id}&select=c:seller_till_cash_amount,st:total_settled_to_manager_g`))[0];
  const ok = rate.ok && pay.ok && Number(till.c) === 900000 && k4.filter((x) => x.ok).length === 1 && Math.abs(Number(after.st) - Number(till.st) - 1) < 0.00005 && Number(after.c) === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} K4-fresh 2 parallel handovers of a 1 g till: one ok, settled +1 g, till 0 | till_before=${till.c} ok=${k4.filter((x) => x.ok).length} delta=${Number(after.st) - Number(till.st)} till_after=${after.c} refused=${k4.filter((x) => !x.ok).map((x) => x.error.slice(0, 40))}`);
  require('fs').writeFileSync('/home/user/jewelryflow-erp/docs/audits/goldia-077/evidence/staging-085/k4-fresh.json', JSON.stringify({ ok, till, after, results: k4.map((x) => x.ok || x.error) }, null, 1));
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
