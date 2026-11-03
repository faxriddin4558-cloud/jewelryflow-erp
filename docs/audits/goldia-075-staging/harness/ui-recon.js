// Independent reconciliation of the whole UI session on staging (org A was zero-reset before UI-1).
// Expected values are derived ONLY from the UI operations' inputs (weights, markups, amounts, rates) in ui-operations.json.
const fs = require('fs');
const { ORG, creds, sel, r4 } = require('./lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = JSON.parse(fs.readFileSync(LOG));
const U4 = (x) => Math.round(Number(x) * 1e4); const dh = (n, d) => Math.floor((2 * n + d) / (2 * d));
(async () => {
  const C = creds();
  const plan = { sellera: { markup: 15, w: [5.11, 6.23, 7.37, 8.41, 12.53, 3.29] }, sellerb: { markup: 12, w: [4.17, 5.29, 6.31, 9.43] }, sellerc: { markup: 10, w: [4.61, 5.73, 6.87, 7.91] } };
  const E = {}; const A = {};
  E.factory_obligation_g = r4(200 * 1.08); E.manager_stock_g = r4(200 - Object.values(plan).reduce((a, p) => a + p.w.reduce((x, y) => x + y, 0), 0));
  const ops = state.ops;
  const custOf = {};
  for (const tag of Object.keys(plan)) for (const c of await sel(`customers?seller_id=eq.${C[tag].id}&select=id`)) custOf[c.id] = tag;
  for (const [tag, p] of Object.entries(plan)) {
    const total = r4(p.w.reduce((a, b) => a + b, 0));
    const sold = ops.filter((o) => (o.op === 'scan_sale' || o.op === 'weight_sale') && custOf[o.customer] === tag);
    const reversed = ops.filter((o) => o.op === 'reversal' && custOf[o.customer] === tag).map((o) => o.sale_id);
    const soldG = sold.filter((o) => !reversed.includes(o.sale_id)).reduce((a, o) => a + (o.op === 'scan_sale' ? o.piece_g : o.grams), 0);
    const settled = ops.filter((o) => o.op === 'handover' && o.seller === tag).reduce((a, o) => a + o.actual_grams, 0);
    const paid = ops.filter((o) => o.op === 'payment' && custOf[o.customer] === tag).reduce((a, o) => a + o.expected_grams, 0);
    E[`${tag}_obligation_g`] = r4(total * (1 + p.markup / 100)); E[`${tag}_settled_g`] = r4(paid); E[`${tag}_owes_g`] = r4(E[`${tag}_obligation_g`] - paid);
    E[`${tag}_stock_g`] = r4(total - soldG); E[`${tag}_till_cash`] = 0; E[`${tag}_till_usd`] = 0;
    const row = (await sel(`seller_gold_accounts?seller_id=eq.${C[tag].id}&select=o:total_seller_obligation_g,st:total_settled_to_manager_g,ow:seller_owes_manager_g,ph:current_physical_stock_g,c:seller_till_cash_amount,u:seller_till_usd_amount`))[0];
    A[`${tag}_obligation_g`] = row.o; A[`${tag}_settled_g`] = row.st; A[`${tag}_owes_g`] = row.ow; A[`${tag}_stock_g`] = row.ph; A[`${tag}_till_cash`] = row.c; A[`${tag}_till_usd`] = row.u;
    void settled;
  }
  // customers: due of sales (minus reversed) minus payments
  const custIds = [...new Set(ops.filter((o) => o.customer).map((o) => o.customer))];
  for (const cid of custIds) {
    const rev = ops.filter((o) => o.op === 'reversal' && o.customer === cid).map((o) => o.sale_id);
    const due = ops.filter((o) => (o.op === 'scan_sale' || o.op === 'weight_sale') && o.customer === cid && !rev.includes(o.sale_id)).reduce((a, o) => a + (o.op === 'scan_sale' ? dh(U4(o.piece_g) * (100 + o.markup), 100) / 1e4 : dh(U4(o.grams) * (100 + o.markup), 100) / 1e4), 0);
    const paid = ops.filter((o) => o.op === 'payment' && o.customer === cid).reduce((a, o) => a + o.expected_grams, 0);
    const code = (await sel(`customers?id=eq.${cid}&select=customer_code`))[0].customer_code;
    E[`customer_${code}_net_g`] = r4(due - paid);
    const acc = (await sel(`client_gold_accounts?customer_id=eq.${cid}&select=d:current_debt_grams,a:advance_balance_grams`))[0] || { d: 0, a: 0 };
    A[`customer_${code}_net_g`] = r4(Number(acc.d) - Number(acc.a));
  }
  const hand = ops.filter((o) => o.op === 'handover');
  E.manager_cash_uzs = hand.reduce((a, o) => a + o.cash, 0); E.manager_usd = hand.reduce((a, o) => a + o.usd, 0);
  const v = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0];
  A.factory_obligation_g = v.o; A.manager_stock_g = v.s; A.manager_cash_uzs = v.c; A.manager_usd = v.u;
  // every recorded operation: expected == actual
  const opMismatch = ops.filter((o) => ('expected_due' in o && Math.abs(o.expected_due - o.actual_due) > 5e-5) || (o.op === 'payment' && o.expected_grams !== null && Math.abs(o.expected_grams - o.actual_grams) > 5e-5) || (o.op === 'handover' && Math.abs(o.expected_grams - o.actual_grams) > 5e-5));
  const rows = Object.keys(E).map((k) => ({ item: k, expected: E[k], actual: Number(A[k]), diff: r4(Math.abs(Number(A[k]) - E[k])) }));
  const bad = rows.filter((r) => r.diff > (r.item.includes('uzs') || r.item.includes('usd') || r.item.includes('cash') ? 0.5 : 0.00005));
  const maxG = Math.max(...rows.filter((r) => !/uzs|usd|cash/.test(r.item)).map((r) => r.diff));
  state.reconciliation = { rows, mismatching_rows: bad, operation_mismatches: opMismatch, max_gram_diff: maxG.toFixed(4), at: new Date().toISOString() };
  fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
  for (const r of rows) console.log((bad.includes(r) ? 'DIFF ' : 'ok   ') + r.item.padEnd(34) + ' exp ' + r.expected + '  act ' + r.actual);
  console.log('operations', ops.length, 'op mismatches', opMismatch.length, 'rows', rows.length, 'bad', bad.length, 'max gram diff', maxG.toFixed(4));
})();
