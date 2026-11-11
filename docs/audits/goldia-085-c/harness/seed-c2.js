// Completes seed-c.js after its USD sale step (weight must be > 0); reuses the customers / pieces already created in C.
const L = require('./lib');
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const out = {};
  const must = (r, n) => { if (!r.ok) { console.log('FAILED', n, r.status, r.error); process.exit(1); } out[n] = 'ok'; return r.data; };
  const cust = await L.sel(`customers?organization_id=eq.${L.ORG}&select=id,contact_name&order=contact_name`);
  const cu1 = cust.find((x) => / Mijoz 1 /.test(x.contact_name)).id; const cu2 = cust.find((x) => / Mijoz 2 /.test(x.contact_name)).id;
  const piece = (await L.sel(`consignment_pieces?organization_id=eq.${L.ORG}&status=eq.held_by_seller&weight_grams=eq.7&select=id`))[0];
  must(await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: cu2, p_currency: 'USD', p_amount: 300, p_weight_grams: 7, p_piece_ids: [piece.id], p_idempotency_key: `c85-cs-${run}` }), 'usd_sale');
  must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cu2, p_currency: 'USD', p_usd_amount: 100, p_usd_rate: 12600, p_idempotency_key: `c85-cp-${run}` }), 'usd_payment');
  must(await L.rpc('sellera', 'rpc_record_client_legacy_debt', { p_customer_id: cu1, p_balance_type: 'debt', p_amount_585_g: 2, p_as_of_date: L.tashkentToday(), p_idempotency_key: `c85-leg-${run}` }), 'legacy_debt');
  const acc = await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=current_physical_stock_g,seller_owes_manager_g,seller_till_cash_amount,seller_till_usd_amount`);
  const vault = await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=manager_physical_stock_g,current_factory_obligation_g`);
  console.log(JSON.stringify({ seeded: out, sellers: acc, vault }));
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
