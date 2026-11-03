// GOLDIA 072 acceptance scenario (user-specified amounts). Every expected value is computed here, independently.
const { U, rpc, su, req, pool } = require('./lib');
const R = []; const r4 = (x) => Math.round(Number(x) * 10000) / 10000;
const T = (id, title, ok, exp, act, extra) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(exp) + ' act=' + JSON.stringify(act) + (extra ? ' ' + JSON.stringify(extra).slice(0, 160) : '')); };
const eq = (a, b, tol = 0.0005) => Math.abs(r4(a) - r4(b)) <= tol;
const one = async (s, p) => (await su(s, p))[0];
const must = (r, n) => { if (!r.ok) { console.log('ERROR', n, r.error); } return r.ok ? r.data : null; };
const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
(async () => {
  must(await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today }), 'rate');
  // 1. receipt 500 g @8%
  const rc = must(await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'Partiya 500', p_original_physical_g: 500, p_factory_markup_pct: 8, p_idempotency_key: 'k-r500' }), 'receipt');
  const rcRetry = must(await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'Partiya 500', p_original_physical_g: 500, p_factory_markup_pct: 8, p_idempotency_key: 'k-r500' }), 'receipt retry');
  const v1 = await one(`select current_factory_obligation_g o, manager_physical_stock_g s from manager_vault_account`);
  T('P1', 'factory receipt 500 g @8% (+ retry with same key)', eq(v1.o, 540) && eq(v1.s, 500) && rc.receipt_id === rcRetry.receipt_id, { obligation: 540, stock: 500 }, { obligation: r4(v1.o), stock: r4(v1.s) });
  // 2-3. consignments
  const piecesA = [12.5, 7.5, 30, 50, 100], piecesB = [25, 25, 50];
  const cA = must(await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 15, p_factory_receipt_id: rc.receipt_id, p_pieces: piecesA.map((w, i) => ({ weight_grams: w, model_code: 'A' + i })) }), 'consA');
  const cB = must(await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SB, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.receipt_id, p_pieces: piecesB.map((w, i) => ({ weight_grams: w, model_code: 'B' + i })) }), 'consB');
  const sa = await one(`select total_seller_obligation_g o, current_physical_stock_g s from seller_gold_accounts where seller_id=$1`, [U.SA]);
  const sb = await one(`select total_seller_obligation_g o, current_physical_stock_g s from seller_gold_accounts where seller_id=$1`, [U.SB]);
  T('P2', 'manager -> seller A 200 g @15%', eq(sa.o, 230) && eq(sa.s, 200), { obligation: 230, stock: 200 }, { obligation: r4(sa.o), stock: r4(sa.s) });
  T('P3', 'manager -> seller B 100 g @12%', eq(sb.o, 112) && eq(sb.s, 100), { obligation: 112, stock: 100 }, { obligation: r4(sb.o), stock: r4(sb.s) });
  T('P3b', 'manager stock after distribution', eq(await one(`select get_manager_available_stock_grams('00000000-0000-0000-0000-000000000001') g`).then(x => x.g), 200), 200, null);
  // customers
  const CA1 = must(await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'A mijoz 1 (sintetik)' }), 'c').customer_id;
  const CA2 = must(await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'A mijoz 2 (sintetik)' }), 'c').customer_id;
  const CB1 = must(await rpc(U.SB, 'rpc_create_customer_with_code', { p_contact_name: 'B mijoz 1 (sintetik)' }), 'c').customer_id;
  // 4-5. sales 12%, 15%, 20%
  const sA1 = must(await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: CA1, p_piece_id: cA.pieces[0].id, p_client_markup_pct: 12, p_idempotency_key: 'k-sa1' }), 'sale A1');
  const sA2 = must(await rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: CA2, p_weight_grams: 40, p_client_markup_pct: 15, p_idempotency_key: 'k-sa2' }), 'weight A2');
  const sB1 = must(await rpc(U.SB, 'rpc_record_barcode_piece_sale', { p_customer_id: CB1, p_piece_id: cB.pieces[0].id, p_client_markup_pct: 20 }), 'sale B1');
  T('P4a', 'barcode sale 12.5 g @12%', sA1 && eq(sA1.client_gold_due_grams, 14), 14, sA1 && sA1.client_gold_due_grams);
  const alloc = await su(`select count(*)::int n, sum(grams) g from weight_sale_allocations where sale_id=$1`, [sA2.sale_id]);
  T('P4b', 'weight sale 40 g @15% (allocated over held pieces; piece order is not deterministic — M-7)', eq(sA2.client_gold_due_grams, 46) && alloc[0].n >= 1 && eq(alloc[0].g, 40), { due: 46, grams: 40 }, { due: sA2.client_gold_due_grams, pieces: alloc[0].n, grams: r4(alloc[0].g) });
  T('P5', 'seller B sale 25 g @20%', sB1 && eq(sB1.client_gold_due_grams, 30), 30, sB1 && sB1.client_gold_due_grams);
  // 6. old debt
  must(await rpc(U.D, 'rpc_record_client_legacy_debt', { p_customer_id: CA1, p_balance_type: 'debt', p_amount_585_g: 3, p_as_of_date: '2026-10-15', p_seller_id: U.SA, p_idempotency_key: 'k-leg' }), 'legacy');
  // 7-8. seller-specific rates
  const rA = await rpc(U.SA, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 890000, p_usd_rate_uzs: 12500, p_reason: 'A kursi' });
  const rB = await rpc(U.SB, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12700, p_reason: 'B kursi' });
  T('P7', 'seller-specific LOM/USD rates saved (A 890,000/12,500; B 900,000/12,700)', rA.ok && rB.ok, 'ok', [rA.ok || rA.error, rB.ok || rB.error]);
  const badDev = await rpc(U.SA, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 2000000 });
  const mgrSet = await rpc(U.M, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000 });
  T('P7b', 'rate outside 25% band rejected; manager cannot use seller rate RPC', !badDev.ok && !mgrSet.ok, 'both rejected', [badDev.error && badDev.error.slice(0, 60), mgrSet.error && mgrSet.error.slice(0, 60)]);
  // 9. settlements. A: 4,450,000 UZS @890,000 = 5.0 g; 200 USD*12,500/890,000 = 2.8090 g; 3.0 g scrap @750 = 3.8462 g
  const wrongRate = await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: CA1, p_cash_amount: 100000, p_rate_per_gram: 900000 });
  T('P9a', 'seller A cannot pay at another rate (browser-sent 900,000)', !wrongRate.ok, 'ERR_RATE_MISMATCH', wrongRate.error && wrongRate.error.slice(0, 50));
  const stA = must(await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: CA1, p_cash_amount: 4450000, p_usd_amount: 200, p_scrap_weight: 3, p_scrap_proba: 750, p_idempotency_key: 'k-stA' }), 'settle A');
  const stAretry = must(await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: CA1, p_cash_amount: 4450000, p_usd_amount: 200, p_scrap_weight: 3, p_scrap_proba: 750, p_idempotency_key: 'k-stA' }), 'settle A retry');
  const expA = 5 + r4(200 * 12500 / 890000) + r4(3 * 750 / 585);
  T('P9b', 'CA1 cash+USD+scrap at seller A rates (+retry)', stA && eq(stA.total_settled_grams, expA) && stA.settlement_id === stAretry.settlement_id, { total: r4(expA), cash: 5, usd: r4(200 * 12500 / 890000), scrap: r4(3 * 750 / 585) }, stA && { total: stA.total_settled_grams, cash: stA.cash_equivalent_grams, usd: stA.usd_equivalent_grams, rate: stA.rate_applied, usd_rate: stA.usd_rate_applied });
  // CA1 owed 14 + 3 legacy = 17 -> remaining 17 - 11.6552
  const ca1 = await one(`select current_debt_grams d, advance_balance_grams a from client_gold_accounts where customer_id=$1`, [CA1]);
  T('P6', 'CA1 old debt 3 g + sale 14 g, partial payment', eq(ca1.d, 17 - expA), r4(17 - expA), r4(ca1.d));
  const stB = must(await rpc(U.SB, 'rpc_record_client_settlement', { p_customer_id: CB1, p_cash_amount: 9000000, p_usd_amount: 100 }), 'settle B');
  const expB = 10 + r4(100 * 12700 / 900000);
  T('P8', 'CB1 cash+USD at seller B rates 900,000 / 12,700', stB && eq(stB.total_settled_grams, expB), r4(expB), stB && stB.total_settled_grams);
  const stA2 = must(await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: CA2, p_cash_amount: 8900000 }), 'settle A2'); // 10 g
  // 10. A changes rate before handover, then hands everything over
  must(await rpc(U.SA, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 920000, p_reason: 'kurs oshdi' }), 'A rate change');
  const tillA = await one(`select seller_till_cash_amount c, seller_till_usd_amount u, seller_till_scrap_grams s, seller_till_scrap_physical_g p, till_valued_cash_585_g vc, till_valued_usd_585_g vu from seller_gold_accounts where seller_id=$1`, [U.SA]);
  const owesBefore = Number((await one(`select seller_owes_manager_g o from seller_gold_accounts where seller_id=$1`, [U.SA])).o);
  const hoA = must(await rpc(U.SA, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SA, p_cash_paid_amount: Number(tillA.c), p_usd_paid_amount: Number(tillA.u), p_scrap_weight_grams: Number(tillA.s), p_physical_scrap_g: Number(tillA.p), p_idempotency_key: 'k-hoA' }), 'handover A');
  const expHo = 5 + 10 + r4(200 * 12500 / 890000) + r4(3 * 750 / 585);
  const owesAfter = Number((await one(`select seller_owes_manager_g o from seller_gold_accounts where seller_id=$1`, [U.SA])).o);
  T('P10', 'A hands over at captured grams despite rate change 890,000 -> 920,000 (no grams created/destroyed)', hoA && eq(hoA.total_settled_grams, expHo) && eq(owesBefore - owesAfter, expHo), { settled: r4(expHo) }, hoA && { settled: hoA.total_settled_grams, owes_delta: r4(owesBefore - owesAfter) });
  const tillB = await one(`select seller_till_cash_amount c, seller_till_usd_amount u from seller_gold_accounts where seller_id=$1`, [U.SB]);
  const hoB = must(await rpc(U.SB, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SB, p_cash_paid_amount: Number(tillB.c), p_usd_paid_amount: Number(tillB.u) }), 'handover B');
  T('P10b', 'B handover closes exactly the captured grams', hoB && eq(hoB.total_settled_grams, expB), r4(expB), hoB && hoB.total_settled_grams);
  const crossHo = await rpc(U.SA, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SB, p_cash_paid_amount: 1 });
  T('P10c', 'seller A cannot hand over seller B till', !crossHo.ok, 'denied', crossHo.error && crossHo.error.slice(0, 50));
  // 11-12. purchase with valued pool
  const v2 = await one(`select manager_cash_amount c, valued_cash_uzs vu, valued_cash_585_g vg from manager_vault_account`);
  const pu = must(await rpc(U.M, 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor (sintetik)', p_cash_spent_uzs: 2000000, p_gold_weight_grams: 2.5, p_proba: 585, p_idempotency_key: 'k-buy' }), 'purchase');
  const avg = Number(v2.vu) / Number(v2.vg); const expDiff = 2.5 - 2000000 / avg;
  const rd = must(await rpc(U.D, 'rpc_get_company_rate_difference_report', {}), 'rd');
  T('P11', 'cash->gold purchase: company rate difference = purchased - valued', rd && Math.abs(Number(rd.net_difference_585_g) - expDiff) < 0.0005, { pool_avg_rate: Math.round(avg), diff: Number(expDiff.toFixed(6)) }, rd && { diff: rd.net_difference_585_g, pool: rd.pool_avg_conversion_rate });
  // 13. markup difference: A 12.5*(12-15)% = -0.375, A2 40*(15-15)% = 0, B 25*(20-12)% = +2.0
  let md = must(await rpc(U.D, 'rpc_get_seller_markup_difference_report', {}), 'md');
  T('P13a', 'signed markup difference -0.375 + 0 + 2.0 = +1.625', md && eq(md.total_difference_g, 1.625) && eq(md.negative_g, -0.375) && eq(md.positive_g, 2), { total: 1.625, neg: -0.375, pos: 2 }, md && { total: md.total_difference_g, neg: md.negative_g, pos: md.positive_g });
  const mdSeller = await rpc(U.SA, 'rpc_get_seller_markup_difference_report', { p_seller_id: U.SB });
  T('P13b', 'seller A cannot read seller B markup difference', !mdSeller.ok, 'denied', mdSeller.error && mdSeller.error.slice(0, 50));
  // 15. reversal of B sale (paid 11.4111 > 30? no: CB1 paid 11.4111 of 30) -> debt drops by 30, remaining paid becomes advance
  must(await rpc(U.M, 'rpc_reverse_client_sale', { p_sale_id: sB1.sale_id, p_reason: 'qaytarildi', p_idempotency_key: 'k-revB' }), 'reverse B');
  const again = await rpc(U.M, 'rpc_reverse_client_sale', { p_sale_id: sB1.sale_id, p_reason: 'yana' });
  const cb1 = await one(`select current_debt_grams d, advance_balance_grams a from client_gold_accounts where customer_id=$1`, [CB1]);
  T('P15a', 'reverse paid B sale: payment becomes advance; double reversal rejected', eq(cb1.d, 0) && eq(cb1.a, expB) && !again.ok, { debt: 0, advance: r4(expB) }, { debt: r4(cb1.d), advance: r4(cb1.a), again: again.ok ? 'ACCEPTED' : 'rejected' });
  md = must(await rpc(U.D, 'rpc_get_seller_markup_difference_report', {}), 'md2');
  T('P13c', 'markup difference after reversal = -0.375', md && eq(md.total_difference_g, -0.375), -0.375, md && md.total_difference_g);
  const w100 = Number((await one(`select weight_grams w from consignment_pieces where id=$1`, [cA.pieces[4].id])).w);
  const saR0 = Number((await one(`select total_seller_obligation_g o from seller_gold_accounts where seller_id=$1`, [U.SA])).o);
  const ret = must(await rpc(U.SA, 'rpc_return_piece_to_manager', { p_piece_id: cA.pieces[4].id, p_notes: 'qaytdi' }), 'return');
  const saR = await one(`select total_seller_obligation_g o from seller_gold_accounts where seller_id=$1`, [U.SA]);
  T('P15b', `A returns the "100 g" piece (now ${w100} g): obligation falls by ${w100} x 1.15`, eq(saR0 - Number(saR.o), w100 * 1.15), r4(w100 * 1.15), r4(saR0 - Number(saR.o)));
  // 14. refining + loss + factory handover. manager scrap 3.8462 eq (3.0 g @750)
  const ref = must(await rpc(U.M, 'rpc_record_refining_batch', { p_input_scrap_grams: 3, p_melted_weight_grams: 2.97, p_output_fine_grams: 2.24, p_output_fine_proba: 999, p_physical_scrap_grams: 3, p_input_scrap_proba: 750 }), 'refine');
  const expOut = r4(2.24 * 999 / 585), expLoss = r4(r4(3 * 750 / 585) - expOut);
  T('P14a', 'refining 3.0 g @750 -> 2.24 g @999, loss', ref && eq(ref.output_585_equiv_grams, expOut) && eq(ref.total_loss_grams, expLoss), { out: expOut, loss: expLoss }, ref && { out: ref.output_585_equiv_grams, loss: ref.total_loss_grams });
  const fh = must(await rpc(U.M, 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 2.24, p_proba: 999 }), 'fh');
  const fh2 = must(await rpc(U.M, 'rpc_record_factory_gold_handover', { p_source_type: 'purchased_gold', p_physical_weight_g: 2.5, p_proba: 585 }), 'fh2');
  T('P14b', 'factory liability 540 - refined - purchased', fh2 && eq(fh2.current_factory_obligation_g, 540 - expOut - 2.5), r4(540 - expOut - 2.5), fh2 && fh2.current_factory_obligation_g);
  // security spot checks on new 071/072 objects
  const ratesB = await rpc(U.SA, 'rpc_get_seller_rates', { p_seller_id: U.SB });
  const tblRates = await req(U.SA, `select count(*)::int n from seller_rates where seller_id <> '${U.SA}'`);
  const tblHist = await req(U.SA, `select count(*)::int n from seller_rate_history where seller_id <> '${U.SA}'`);
  const write = await req(U.SA, `update seller_rates set lom_rate_uzs = 1 where seller_id = '${U.SB}' returning 1`);
  const mstock = await rpc(U.SA, 'rpc_get_manager_available_stock_grams', {});
  const mstock2 = await rpc(U.SA, 'get_manager_available_stock_grams', {});
  const limits = await rpc(U.SA, 'rpc_set_seller_rate_limits', { p_lom_min_uzs: 1, p_lom_max_uzs: 99999999, p_usd_min_uzs: 1, p_usd_max_uzs: 999999 });
  T('S1', 'seller A cannot read/change seller B rates, history, limits or company stock', !ratesB.ok && tblRates.rows[0].n === 0 && tblHist.rows[0].n === 0 && !write.ok && !limits.ok && (!mstock.ok || mstock.data === null) && !mstock2.ok,
    'all denied', { rpcRatesB: ratesB.ok, rowsRates: tblRates.rows[0].n, rowsHist: tblHist.rows[0].n, write: write.ok, limits: limits.ok, rpcStock: mstock.ok ? mstock.data : 'denied', fnStock: mstock2.ok ? mstock2.data : 'denied' });
  const mgrRates = await rpc(U.M, 'rpc_get_seller_rates', {});
  T('S2', 'manager sees every seller rate', mgrRates.ok && mgrRates.data.sellers.length >= 2, '>=2 sellers', mgrRates.ok ? mgrRates.data.sellers.length : mgrRates.error);
  const noemp = await rpc(U.NOEMP, 'rpc_get_seller_rates', {});
  const anonR = await rpc(null, 'rpc_get_seller_rates', {});
  T('S3', 'employee-less and anonymous denied', !noemp.ok && !anonR.ok, 'denied', [noemp.error && noemp.error.slice(0, 40), anonR.error && anonR.error.slice(0, 40)]);
  require('fs').writeFileSync(process.argv[2] || '/opt/goldia-audit/evidence/s072.json', JSON.stringify(R, null, 1));
  console.log('RESULT', R.filter(x => x.ok).length, '/', R.length);
  await pool.end();
})();
