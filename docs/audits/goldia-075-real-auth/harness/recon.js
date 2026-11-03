// Independent reconciliation of the audit org after finance.js. Expected values derived only from the scenario inputs.
const { ORG, creds, sel, rpc, T, R, r4 } = require('./lib');
(async () => {
  const C = creds(); const SA = C.sellera.id, SB = C.sellerb.id;
  const exA = 5 + r4(200 * 12500 / 890000) + r4(3 * 750 / 585), exB = 10 + r4(100 * 12700 / 900000);
  const E = {
    client_debt: (17 - exA) + (46 - 10) + 0, client_advance: exB,
    sellerA_obligation: 230 + 3 - 115, sellerB_obligation: 112,
    sellerA_owes: 230 + 3 - 115 - (exA + 10), sellerB_owes: 112 - exB,
    sellerA_held_g: 7.5 + 40, sellerB_held_g: 100,
    sellerA_conservation_g: 200, // held + sold (12.5 + 40) + returned 100
    manager_stock_g: 500 - 300 + 100, manager_cash_uzs: 4450000 + 8900000 + 9000000 - 2000000, manager_usd: 300,
    factory_obligation_g: 540 - r4(2.24 * 999 / 585) - 2.5,
  };
  const cg = await sel(`client_gold_accounts?organization_id=eq.${ORG}&select=d:current_debt_grams,a:advance_balance_grams`);
  const sg = Object.fromEntries((await sel(`seller_gold_accounts?organization_id=eq.${ORG}&select=seller_id,o:total_seller_obligation_g,ow:seller_owes_manager_g`)).map((x) => [x.seller_id, x]));
  const pcs = await sel(`consignment_pieces?organization_id=eq.${ORG}&status=neq.cancelled&select=seller_id,weight_grams,status`);
  const sales = await sel(`jewelry_sales?organization_id=eq.${ORG}&status=not.in.(reversed,cancelled)&select=seller_id,base_weight_grams`);
  const v = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount,o:current_factory_obligation_g`))[0];
  const sum = (a, f) => a.reduce((s, x) => s + Number(f(x)), 0);
  const A = {
    client_debt: sum(cg, (x) => x.d), client_advance: sum(cg, (x) => x.a),
    sellerA_obligation: sg[SA].o, sellerB_obligation: sg[SB].o, sellerA_owes: sg[SA].ow, sellerB_owes: sg[SB].ow,
    sellerA_held_g: sum(pcs.filter((p) => p.seller_id === SA && p.status === 'held_by_seller'), (p) => p.weight_grams),
    sellerB_held_g: sum(pcs.filter((p) => p.seller_id === SB && p.status === 'held_by_seller'), (p) => p.weight_grams),
    sellerA_conservation_g: sum(pcs.filter((p) => p.seller_id === SA && ['held_by_seller', 'returned_to_manager'].includes(p.status)), (p) => p.weight_grams) + sum(sales.filter((s) => s.seller_id === SA), (s) => s.base_weight_grams),
    manager_stock_g: v.s, manager_cash_uzs: v.c, manager_usd: v.u, factory_obligation_g: v.o,
  };
  let maxDiff = 0;
  for (const kk of Object.keys(E)) { const d = Math.abs(r4(A[kk]) - r4(E[kk])); maxDiff = Math.max(maxDiff, kk.includes('uzs') || kk.includes('usd') ? 0 : d); T('X-' + kk, `reconciliation ${kk}`, d <= 0.00005 || (kk.includes('uzs') && d < 0.5), r4(E[kk]), r4(A[kk])); }
  const app = await rpc('director', 'rpc_get_financial_reconciliation_summary', {});
  T('X-app', 'app reconciliation report agrees (client debt, seller owes, factory obligation)', app.ok && Math.abs(app.data.clients_summary.total_client_debt_grams - E.client_debt) < 5e-5 && Math.abs(app.data.sellers_summary.total_seller_owes_manager_g - (E.sellerA_owes + E.sellerB_owes)) < 5e-5 && Math.abs(app.data.manager_factory_account.current_factory_obligation_g - E.factory_obligation_g) < 5e-5, 'agree', app.ok ? 'agree-check' : app.error);
  console.log('MAX GRAM DIFF', maxDiff.toFixed(4));
  require('fs').writeFileSync(__dirname + '/../evidence/reconciliation.json', JSON.stringify({ max_gram_diff: maxDiff.toFixed(4), checks: R }, null, 1));
})();
