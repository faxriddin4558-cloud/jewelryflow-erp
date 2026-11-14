// 083 return in D after the opening: the barcode sale of P6 returned as a whole piece (8 g) to the seller.
const fs = require('fs'); const L = require('./lib');
const N = (x) => Number(x || 0); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
(async () => {
  const C = L.creds(); const ST = JSON.parse(fs.readFileSync(L.STATE)); const { cu1 } = ST.customers;
  const sale = (await L.sel(`jewelry_sales?organization_id=eq.${L.ORG}&status=neq.reversed&order=created_at.desc&limit=1&select=id`))[0];
  const debt = async () => r4((await L.sel(`client_gold_accounts?customer_id=eq.${cu1}&select=v:current_debt_grams`))[0].v);
  const stock = async () => r4((await L.sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=v:current_physical_stock_g`))[0].v);
  const d0 = await debt(); const s0 = await stock();
  const ret = await L.rpc('sellera', 'rpc_record_sale_return', { p_sale_id: sale.id, p_weight_grams: 8, p_reason: 'butun dona qaytarish (sinov)', p_destination: 'seller', p_idempotency_key: `f3d-ret-${Date.now()}` });
  const d1 = await debt(); const s1 = await stock();
  const ok = ret.ok && s1 === r4(s0 + 8) && r4(d0 - d1) === 8.96;
  const res = { id: 'REG-083', title: '083 return of the whole 8 g piece (to the seller): stock +8 g, customer debt -8.96 g (8 g x 1.12)', ok, actual: { ret: ret.ok || ret.error, s0, s1, d0, d1 } };
  console.log(`${ok ? 'PASS' : 'FAIL'} ${res.id} ${res.title} | ${JSON.stringify(res.actual)}`);
  fs.writeFileSync('/home/user/jewelryflow-erp/docs/audits/goldia-086-d/evidence/reg-083-return.json', JSON.stringify(res, null, 1));
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
