// STAGING read-only integrity of the synthetic audit organization after the 076 runs (service-role GET reads only).
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const fs = require('fs'); const N = Number; const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const all = async (q) => { const out = []; for (let f = 0; ; f += 1000) { const r = await L.sel(`${q}&limit=1000&offset=${f}`); out.push(...r); if (r.length < 1000) return out; } };
(async () => {
  const O = L.ORG; const R = []; const T = (id, t, ok, e, a) => { R.push({ id, t, ok, e, a }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${t} | exp=${JSON.stringify(e)} act=${JSON.stringify(a).slice(0, 200)}`); };
  const sellers = await all(`seller_gold_accounts?organization_id=eq.${O}&select=seller_id,current_physical_stock_g,seller_legacy_debt_obligation_g,seller_owes_manager_g`);
  const pieces = await all(`consignment_pieces?organization_id=eq.${O}&select=id,seller_id,status,sale_id,weight_grams`);
  const cons = await all(`seller_consignments?organization_id=eq.${O}&select=id,seller_id,status,base_weight_grams`);
  const sales = await all(`jewelry_sales?organization_id=eq.${O}&select=id,seller_id,status,base_weight_grams,sale_type,notes`);
  const allocs = await all(`weight_sale_allocations?organization_id=eq.${O}&select=sale_id,piece_id,grams,fully_consumed,reversed_at`);
  const legs = await all(`client_legacy_debts?organization_id=eq.${O}&select=seller_id,balance_type,delta_585_g,status`);
  const accs = await all(`client_gold_accounts?organization_id=eq.${O}&select=current_debt_grams,advance_balance_grams`);
  let gramVsPieces = []; let negative = []; let legDrift = [];
  for (const s of sellers) {
    const consigned = cons.filter((c) => c.seller_id === s.seller_id && ['held_by_seller', 'partially_sold', 'fully_sold'].includes(c.status)).reduce((a, c) => a + N(c.base_weight_grams), 0);
    const sold = sales.filter((x) => x.seller_id === s.seller_id && !['reversed', 'cancelled'].includes(x.status)).reduce((a, x) => a + N(x.base_weight_grams), 0);
    const raw = r4(consigned - sold); if (raw < -0.00005) negative.push({ s: s.seller_id, raw });
    const heldG = r4(pieces.filter((p) => p.seller_id === s.seller_id && p.status === 'held_by_seller').reduce((a, p) => a + N(p.weight_grams), 0));
    if (heldG > 0 && Math.abs(heldG - N(s.current_physical_stock_g)) > 0.00005) gramVsPieces.push({ s: s.seller_id, heldG, stock: N(s.current_physical_stock_g) });
    const model = Math.max(0, r4(legs.filter((l) => l.seller_id === s.seller_id && l.balance_type === 'debt' && l.status !== 'reversed').reduce((a, l) => a + N(l.delta_585_g), 0)));
    if (Math.abs(model - N(s.seller_legacy_debt_obligation_g)) > 0.00005) legDrift.push({ s: s.seller_id, model, db: s.seller_legacy_debt_obligation_g });
  }
  T('INT-01', `every seller of the org (${sellers.length}): consigned - sold never negative`, negative.length === 0, 0, negative);
  T('INT-02', 'every seller: held barcode piece grams = gram stock', gramVsPieces.length === 0, 0, gramVsPieces);
  T('INT-03', 'every seller: legacy obligation = max(0, active debt deltas)', legDrift.length === 0, 0, legDrift);
  const soldHeld = pieces.filter((p) => p.status === 'held_by_seller' && p.sale_id).length;
  T('INT-04', 'no piece is both held and linked to a sale', soldHeld === 0, 0, soldHeld);
  const activeSale = new Set(sales.filter((x) => !['reversed', 'cancelled'].includes(x.status)).map((x) => x.id));
  const full = {}; for (const a of allocs) if (a.fully_consumed && !a.reversed_at && activeSale.has(a.sale_id)) full[a.piece_id] = (full[a.piece_id] || 0) + 1;
  const twice = Object.values(full).filter((n) => n > 1).length;
  T('INT-05', 'no piece fully consumed by two active sales (no double sale)', twice === 0, 0, twice);
  const allocSum = {}; for (const a of allocs) if (!a.reversed_at) allocSum[a.sale_id] = r4((allocSum[a.sale_id] || 0) + N(a.grams));
  const bad = sales.filter((x) => x.sale_type === 'weight' && !['reversed', 'cancelled'].includes(x.status) && allocSum[x.id] !== undefined && Math.abs(allocSum[x.id] - N(x.base_weight_grams)) > 0.00005);
  T('INT-06', 'every active weight sale: allocated piece grams = sold grams', bad.length === 0, 0, bad.slice(0, 3).map((x) => ({ id: x.id, g: x.base_weight_grams, alloc: allocSum[x.id] })));
  const S = Object.fromEntries(sales.map((x) => [x.id, x]));
  const byReset = (id) => /TEST HISOBI TOZALANDI/.test((S[id] && S[id].notes) || '');
  const revAll = allocs.filter((a) => S[a.sale_id] && S[a.sale_id].status === 'reversed' && !byReset(a.sale_id));
  const revOpen = revAll.filter((a) => !a.reversed_at);
  T('INT-07', `allocations of normally REVERSED sales are all released (${revAll.length} allocations)`, revOpen.length === 0, 0, revOpen.length);
  // sales closed by rpc_execute_full_test_reset (note "TEST HISOBI TOZALANDI"): pieces are cancelled, allocations stay open
  const resetOpen = allocs.filter((a) => byReset(a.sale_id) && !a.reversed_at);
  T('INT-07b', 'INFO (LOW finding): allocations left open by the full TEST reset of 2026-11-03 (pieces cancelled, no balance effect)', true, 'info', resetOpen.length);
  const both = accs.filter((a) => N(a.current_debt_grams) > 0 && N(a.advance_balance_grams) > 0).length;
  const neg = accs.filter((a) => N(a.current_debt_grams) < 0 || N(a.advance_balance_grams) < 0).length;
  T('INT-08', 'no customer with debt and advance at the same time, none negative', both === 0 && neg === 0, 0, { both, neg });
  console.log(`checked: sellers ${sellers.length}, pieces ${pieces.length}, consignments ${cons.length}, sales ${sales.length}, allocations ${allocs.length}, legacy ${legs.length}, customer accounts ${accs.length}`);
  fs.writeFileSync(process.argv[2], JSON.stringify({ counts: { sellers: sellers.length, pieces: pieces.length, sales: sales.length, allocations: allocs.length }, results: R }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
