// B–H: full Goldia financial chain on the LOCAL 075 stack with real GoTrue sessions through PostgREST. Expected values are computed here independently.
const { ORG, creds, rpc, usel, uwrite, sel, R, T, r4, eq, must, tashkentToday } = require('./lib');
const one = async (p) => (await sel(p))[0];
const RUN = process.env.GA_RUN || Date.now().toString(36);
const k = (s) => `stg-${RUN}-${s}`;
(async () => {
  const C = creds(); const SA = C.sellera.id, SB = C.sellerb.id;
  const today = tashkentToday();
  must(await rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today }), 'rate');
  const vault = () => one(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,vu:valued_cash_uzs,vg:valued_cash_585_g`);
  const sga = (id, cols = 'o:total_seller_obligation_g,s:current_physical_stock_g') => one(`seller_gold_accounts?seller_id=eq.${id}&select=${cols}`);
  const v0 = (await vault()) || { o: 0, s: 0 };
  // 1. receipt 500 g @8% + retry
  const rc = must(await rpc('manager', 'rpc_record_factory_receipt', { p_product_name: 'Partiya 500 (audit)', p_original_physical_g: 500, p_factory_markup_pct: 8, p_idempotency_key: k('r500') }), 'receipt');
  const rcRetry = must(await rpc('manager', 'rpc_record_factory_receipt', { p_product_name: 'Partiya 500 (audit)', p_original_physical_g: 500, p_factory_markup_pct: 8, p_idempotency_key: k('r500') }), 'receipt retry');
  const v1 = await vault();
  T('P1', 'factory receipt 500 g @8% (+ retry with same key)', rc && rcRetry && eq(v1.o - v0.o, 540) && eq(v1.s - v0.s, 500) && rc.receipt_id === rcRetry.receipt_id, { obligation: 540, stock: 500, same_receipt: true }, { obligation: r4(v1.o - v0.o), stock: r4(v1.s - v0.s), same_receipt: rc && rcRetry && rc.receipt_id === rcRetry.receipt_id });
  // 2-3. consignments
  const piecesA = [12.5, 7.5, 30, 50, 100], piecesB = [25, 25, 50];
  const cA = must(await rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: SA, p_factory_markup_pct: 8, p_seller_markup_pct: 15, p_factory_receipt_id: rc.receipt_id, p_pieces: piecesA.map((w, i) => ({ weight_grams: w, model_code: 'A' + i })) }), 'consA');
  const cB = must(await rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: SB, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.receipt_id, p_pieces: piecesB.map((w, i) => ({ weight_grams: w, model_code: 'B' + i })) }), 'consB');
  const sa = await sga(SA), sb = await sga(SB);
  T('P2', 'manager -> seller A 200 g @15%', eq(sa.o, 230) && eq(sa.s, 200), { obligation: 230, stock: 200 }, { obligation: r4(sa.o), stock: r4(sa.s) });
  T('P3', 'manager -> seller B 100 g @12%', eq(sb.o, 112) && eq(sb.s, 100), { obligation: 112, stock: 100 }, { obligation: r4(sb.o), stock: r4(sb.s) });
  const mst = await rpc('manager', 'rpc_get_manager_available_stock_grams', {});
  T('P3b', 'manager available stock after distribution = 200 g', mst.ok && eq(typeof mst.data === 'object' && mst.data !== null ? (mst.data.available_grams ?? mst.data.grams ?? Object.values(mst.data)[0]) : mst.data, 200), 200, mst.ok ? mst.data : mst.error);
  // customers
  // customers come from step A (created in the real UI through rpc_create_customer_with_code)
  const byName = async (n) => (await one(`customers?organization_id=eq.${ORG}&contact_name=eq.${encodeURIComponent(n)}&select=id`)).id;
  const CA1 = await byName('A mijoz 1 (UI)'), CA2 = await byName('A mijoz 2 (UI)'), CB1 = await byName('B mijoz 1 (UI)');
  // 4-5. sales
  const sA1 = must(await rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: CA1, p_piece_id: cA.pieces[0].id, p_client_markup_pct: 12, p_idempotency_key: k('sa1') }), 'sale A1');
  const noPiece = await rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: CA2, p_weight_grams: 40, p_client_markup_pct: 15 });
  T('P4c', 'weight sale without naming pieces is refused (seller holds barcode pieces)', !noPiece.ok && /PIECE_REQUIRED/.test(noPiece.error), 'ERR_PIECE_REQUIRED', noPiece.ok ? 'ACCEPTED' : noPiece.error);
  const otherPiece = await rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: CA2, p_weight_grams: 5, p_client_markup_pct: 15, p_piece_ids: [cB.pieces[2].id] });
  T('P4d', "seller A cannot cut seller B's piece", !otherPiece.ok, 'refused', otherPiece.ok ? 'ACCEPTED' : otherPiece.error);
  const sA2 = must(await rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: CA2, p_weight_grams: 40, p_client_markup_pct: 15, p_idempotency_key: k('sa2'), p_piece_ids: [cA.pieces[2].id, cA.pieces[3].id] }), 'weight A2');
  const sB1 = must(await rpc('sellerb', 'rpc_record_barcode_piece_sale', { p_customer_id: CB1, p_piece_id: cB.pieces[0].id, p_client_markup_pct: 20 }), 'sale B1');
  T('P4a', 'barcode sale 12.5 g @12% = 14.0 g', sA1 && eq(sA1.client_gold_due_grams, 14), 14, sA1 && sA1.client_gold_due_grams);
  const alloc = sA2 ? await sel(`weight_sale_allocations?sale_id=eq.${sA2.sale_id}&select=piece_id,grams`) : [];
  const p50 = await one(`consignment_pieces?id=eq.${cA.pieces[3].id}&select=weight_grams,status`);
  T('P4b', 'weight sale 40 g @15% = 46 g; 30 g piece whole + 10 g cut from the 50 g piece (40 g left)', sA2 && eq(sA2.client_gold_due_grams, 46) && alloc.length === 2 && eq(alloc.reduce((s, a) => s + Number(a.grams), 0), 40) && eq(p50.weight_grams, 40), { due: 46, pieces: 2, grams: 40, piece50_left: 40 }, { due: sA2 && sA2.client_gold_due_grams, pieces: alloc.length, grams: r4(alloc.reduce((s, a) => s + Number(a.grams), 0)), piece50_left: p50 && r4(p50.weight_grams) });
  T('P5', 'seller B sale 25 g @20% = 30 g', sB1 && eq(sB1.client_gold_due_grams, 30), 30, sB1 && sB1.client_gold_due_grams);
  const sd = sA1 ? await one(`jewelry_sales?id=eq.${sA1.sale_id}&select=sale_date`) : {};
  T('D1', 'sale is dated with the Tashkent business date', sd.sale_date === today, today, sd.sale_date);
  // 6. legacy debt
  must(await rpc('director', 'rpc_record_client_legacy_debt', { p_customer_id: CA1, p_balance_type: 'debt', p_amount_585_g: 3, p_as_of_date: '2026-10-15', p_seller_id: SA, p_idempotency_key: k('leg') }), 'legacy');
  // 7-8. seller rates
  const rA = await rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 890000, p_usd_rate_uzs: 12500, p_reason: 'A kursi' });
  const rB = await rpc('sellerb', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12700, p_reason: 'B kursi' });
  T('P7', 'seller-specific LOM/USD rates saved (A 890,000/12,500; B 900,000/12,700)', rA.ok && rB.ok, 'ok', [rA.ok || rA.error, rB.ok || rB.error]);
  const badDev = await rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 2000000 });
  const mgrSet = await rpc('manager', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000 });
  T('P7b', 'rate outside the band rejected; manager cannot use the seller rate RPC', !badDev.ok && !mgrSet.ok, 'both rejected', [badDev.ok ? 'ACCEPTED' : badDev.error.slice(0, 60), mgrSet.ok ? 'ACCEPTED' : mgrSet.error.slice(0, 60)]);
  // 9. settlements
  const wrongRate = await rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: CA1, p_cash_amount: 100000, p_rate_per_gram: 900000 });
  T('P9a', 'seller A cannot pay at a browser-sent rate 900,000', !wrongRate.ok && /RATE_MISMATCH/.test(wrongRate.error), 'ERR_RATE_MISMATCH', wrongRate.ok ? 'ACCEPTED' : wrongRate.error.slice(0, 60));
  const stArgs = { p_customer_id: CA1, p_cash_amount: 4450000, p_usd_amount: 200, p_scrap_weight: 3, p_scrap_proba: 750, p_idempotency_key: k('stA') };
  const stA = must(await rpc('sellera', 'rpc_record_client_settlement', stArgs), 'settle A');
  const stAretry = must(await rpc('sellera', 'rpc_record_client_settlement', stArgs), 'settle A retry');
  const expA = 5 + r4(200 * 12500 / 890000) + r4(3 * 750 / 585);
  T('P9b', 'CA1 4,450,000 UZS + 200 USD + 3.0 g @750 at seller A rates (+retry same id)', stA && stAretry && eq(stA.total_settled_grams, expA) && stA.settlement_id === stAretry.settlement_id, { total: r4(expA), cash: 5, usd: r4(200 * 12500 / 890000), scrap: r4(3 * 750 / 585) }, stA && { total: stA.total_settled_grams, cash: stA.cash_equivalent_grams, usd: stA.usd_equivalent_grams, scrap: stA.scrap_equivalent_grams, rate: stA.rate_applied, usd_rate: stA.usd_rate_applied, same_id: stAretry && stA.settlement_id === stAretry.settlement_id });
  const ca1 = await one(`client_gold_accounts?customer_id=eq.${CA1}&select=d:current_debt_grams,a:advance_balance_grams`);
  T('P6', 'CA1 legacy 3 g + sale 14 g, partial payment -> remaining', eq(ca1.d, 17 - expA), r4(17 - expA), r4(ca1.d));
  const stB = must(await rpc('sellerb', 'rpc_record_client_settlement', { p_customer_id: CB1, p_cash_amount: 9000000, p_usd_amount: 100 }), 'settle B');
  const expB = 10 + r4(100 * 12700 / 900000);
  T('P8', 'CB1 9,000,000 UZS + 100 USD at seller B rates', stB && eq(stB.total_settled_grams, expB), r4(expB), stB && stB.total_settled_grams);
  must(await rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: CA2, p_cash_amount: 8900000 }), 'settle A2');
  // 10. A changes rate, then hands over
  must(await rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 920000, p_reason: 'kurs oshdi' }), 'A rate change');
  const tillA = await sga(SA, 'c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,p:seller_till_scrap_physical_g,ow:seller_owes_manager_g');
  const hoA = must(await rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: SA, p_cash_paid_amount: Number(tillA.c), p_usd_paid_amount: Number(tillA.u), p_scrap_weight_grams: Number(tillA.s), p_physical_scrap_g: Number(tillA.p), p_idempotency_key: k('hoA') }), 'handover A');
  const expHo = 5 + 10 + r4(200 * 12500 / 890000) + r4(3 * 750 / 585);
  const owA = await sga(SA, 'ow:seller_owes_manager_g');
  T('P10', 'A hands over captured grams after rate change 890,000 -> 920,000 (no grams created/destroyed)', hoA && eq(hoA.total_settled_grams, expHo) && eq(Number(tillA.ow) - Number(owA.ow), expHo), { settled: r4(expHo), owes_delta: r4(expHo) }, hoA && { settled: hoA.total_settled_grams, owes_delta: r4(Number(tillA.ow) - Number(owA.ow)), till: { cash: tillA.c, usd: tillA.u, scrap: tillA.s } });
  const tillB = await sga(SB, 'c:seller_till_cash_amount,u:seller_till_usd_amount');
  const hoB = must(await rpc('sellerb', 'rpc_record_seller_to_manager_settlement', { p_seller_id: SB, p_cash_paid_amount: Number(tillB.c), p_usd_paid_amount: Number(tillB.u) }), 'handover B');
  T('P10b', 'B handover closes exactly the captured grams', hoB && eq(hoB.total_settled_grams, expB), r4(expB), hoB && hoB.total_settled_grams);
  const crossHo = await rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: SB, p_cash_paid_amount: 1 });
  T('P10c', "seller A cannot hand over seller B's till", !crossHo.ok, 'denied', crossHo.ok ? 'ACCEPTED' : crossHo.error.slice(0, 60));
  // 11-12. purchase from valued pool
  const v2 = await vault();
  must(await rpc('manager', 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor (sintetik)', p_cash_spent_uzs: 2000000, p_gold_weight_grams: 2.5, p_proba: 585, p_idempotency_key: k('buy') }), 'purchase');
  const avg = Number(v2.vu) / Number(v2.vg); const expDiff = 2.5 - 2000000 / avg;
  const rd = must(await rpc('director', 'rpc_get_company_rate_difference_report', {}), 'rd');
  T('P11', 'cash->gold purchase: company rate difference = purchased - valued', rd && Math.abs(Number(rd.net_difference_585_g) - expDiff) < 0.0005, { pool_avg_rate: Math.round(avg), diff: Number(expDiff.toFixed(6)) }, rd && { diff: rd.net_difference_585_g, pool: rd.pool_avg_conversion_rate });
  // 13. markup difference
  let md = must(await rpc('director', 'rpc_get_seller_markup_difference_report', {}), 'md');
  T('P13a', 'signed markup difference -0.375 + 0 + 2.0 = +1.625', md && eq(md.total_difference_g, 1.625) && eq(md.negative_g, -0.375) && eq(md.positive_g, 2), { total: 1.625, neg: -0.375, pos: 2 }, md && { total: md.total_difference_g, neg: md.negative_g, pos: md.positive_g });
  const mdSeller = await rpc('sellera', 'rpc_get_seller_markup_difference_report', { p_seller_id: SB });
  T('P13b', 'seller A cannot read seller B markup difference', !mdSeller.ok, 'denied', mdSeller.ok ? 'ACCEPTED' : mdSeller.error.slice(0, 60));
  // 15. reversal
  must(await rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: sB1.sale_id, p_reason: 'qaytarildi', p_idempotency_key: k('revB') }), 'reverse B');
  const again = await rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: sB1.sale_id, p_reason: 'yana' });
  const cb1 = await one(`client_gold_accounts?customer_id=eq.${CB1}&select=d:current_debt_grams,a:advance_balance_grams`);
  T('P15a', 'reverse paid B sale: payment becomes advance; double reversal rejected', eq(cb1.d, 0) && eq(cb1.a, expB) && !again.ok, { debt: 0, advance: r4(expB) }, { debt: r4(cb1.d), advance: r4(cb1.a), again: again.ok ? 'ACCEPTED' : 'rejected' });
  md = must(await rpc('director', 'rpc_get_seller_markup_difference_report', {}), 'md2');
  T('P13c', 'markup difference after reversal = -0.375', md && eq(md.total_difference_g, -0.375), -0.375, md && md.total_difference_g);
  const w100 = Number((await one(`consignment_pieces?id=eq.${cA.pieces[4].id}&select=w:weight_grams`)).w);
  const saR0 = Number((await sga(SA)).o);
  must(await rpc('sellera', 'rpc_return_piece_to_manager', { p_piece_id: cA.pieces[4].id, p_notes: 'qaytdi' }), 'return');
  const saR = Number((await sga(SA)).o);
  T('P15b', `A returns the 100 g piece: obligation falls by ${w100} x 1.15`, eq(saR0 - saR, w100 * 1.15), r4(w100 * 1.15), r4(saR0 - saR));
  // 14. refining + factory handover
  const ref = must(await rpc('manager', 'rpc_record_refining_batch', { p_input_scrap_grams: 3, p_melted_weight_grams: 2.97, p_output_fine_grams: 2.24, p_output_fine_proba: 999, p_physical_scrap_grams: 3, p_input_scrap_proba: 750 }), 'refine');
  const expOut = r4(2.24 * 999 / 585), expLoss = r4(r4(3 * 750 / 585) - expOut);
  T('P14a', 'refining 3.0 g @750 -> 2.24 g @999: output and loss', ref && eq(ref.output_585_equiv_grams, expOut) && eq(ref.total_loss_grams, expLoss), { out: expOut, loss: expLoss }, ref && { out: ref.output_585_equiv_grams, loss: ref.total_loss_grams });
  must(await rpc('manager', 'rpc_record_factory_gold_handover', { p_source_type: 'refined_gold', p_physical_weight_g: 2.24, p_proba: 999 }), 'fh');
  const fh2 = must(await rpc('manager', 'rpc_record_factory_gold_handover', { p_source_type: 'purchased_gold', p_physical_weight_g: 2.5, p_proba: 585 }), 'fh2');
  T('P14b', 'factory liability 540 - refined - purchased', fh2 && eq(Number(fh2.current_factory_obligation_g) - v0.o, 540 - expOut - 2.5), r4(540 - expOut - 2.5), fh2 && r4(Number(fh2.current_factory_obligation_g) - v0.o));
  // seller isolation inside the org
  const ratesB = await rpc('sellera', 'rpc_get_seller_rates', { p_seller_id: SB });
  const tblRates = await usel('sellera', `seller_rates?seller_id=neq.${SA}&select=seller_id`);
  const tblHist = await usel('sellera', `seller_rate_history?seller_id=neq.${SA}&select=seller_id`);
  const write = await uwrite('sellera', 'PATCH', `seller_rates?seller_id=eq.${SB}`, { lom_rate_uzs: 1 });
  const limits = await rpc('sellera', 'rpc_set_seller_rate_limits', { p_lom_min_uzs: 1, p_lom_max_uzs: 99999999, p_usd_min_uzs: 1, p_usd_max_uzs: 999999 });
  const mstock = await rpc('sellera', 'rpc_get_manager_available_stock_grams', {});
  const bRate = await one(`seller_rates?seller_id=eq.${SB}&select=lom_rate_uzs`);
  T('S1', 'seller A cannot read/change seller B rates, history, limits or company stock', !ratesB.ok && tblRates.ok && tblRates.data.length === 0 && tblHist.ok && tblHist.data.length === 0 && (!write.ok || write.data.length === 0) && Number(bRate.lom_rate_uzs) === 900000 && !limits.ok && (!mstock.ok || mstock.data === null),
    'all denied', { rpcRatesB: ratesB.ok, rowsRates: tblRates.ok ? tblRates.data.length : tblRates.error, rowsHist: tblHist.ok ? tblHist.data.length : tblHist.error, writeRows: write.ok ? write.data.length : 'denied', bRate: bRate.lom_rate_uzs, limits: limits.ok, rpcStock: mstock.ok ? mstock.data : 'denied' });
  const mgrRates = await rpc('manager', 'rpc_get_seller_rates', {});
  T('S2', 'manager sees every seller rate of the org', mgrRates.ok && mgrRates.data.sellers.length >= 2, '>=2 sellers', mgrRates.ok ? mgrRates.data.sellers.length : mgrRates.error);
  const noemp = await rpc('noemp', 'rpc_get_seller_rates', {});
  T('S3', 'authenticated user without employee row denied', !noemp.ok, 'denied', noemp.ok ? 'ACCEPTED' : noemp.error.slice(0, 60));
  // independent reconciliation via the app's own report
  const recon = await rpc('director', 'rpc_get_financial_reconciliation_summary', {});
  require('fs').writeFileSync(__dirname + '/../evidence/recon-after-finance.json', JSON.stringify(recon.ok ? recon.data : { error: recon.error }, null, 1));
  require('fs').writeFileSync(__dirname + '/../evidence/finance.json', JSON.stringify(R, null, 1));
  console.log('RESULT', R.filter(x => x.ok).length, '/', R.length);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
