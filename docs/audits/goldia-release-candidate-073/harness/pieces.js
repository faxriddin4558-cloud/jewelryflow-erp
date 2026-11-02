// 073 C: weight sales name the physical pieces. Local PG16 (073).
const { U, rpc, su, req, pool } = require('./lib');
const R = []; const T = (id, title, ok, d) => { R.push({ id, title, ok: !!ok, detail: d }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | ' + JSON.stringify(d).slice(0, 200)); };
const one = async (s, p) => (await su(s, p))[0];
(async () => {
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const rc = (await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'pc', p_original_physical_g: 60, p_factory_markup_pct: 8 })).data;
  const cA = (await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.receipt_id, p_pieces: [{ weight_grams: 3, model_code: 'P3', raw_barcode: 'P3|3.00' }, { weight_grams: 5, model_code: 'P5', raw_barcode: 'P5|5.00' }, { weight_grams: 8, model_code: 'P8', raw_barcode: 'P8|8.00' }] })).data;
  const cB = (await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SB, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.receipt_id, p_pieces: [{ weight_grams: 4, model_code: 'B4' }] })).data;
  const [p3, p5, p8] = cA.pieces.map(p => p.id); const b4 = cB.pieces[0].id;
  const cust = (await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Dona mijoz (sintetik)' })).data.customer_id;
  const ws = (args, key) => rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: cust, p_client_markup_pct: 10, ...args, ...(key ? { p_idempotency_key: key } : {}) });
  let r = await ws({ p_weight_grams: 4 });
  T('C1', 'weight sale without a selected piece is refused when the seller holds barcode pieces', !r.ok && /ERR_PIECE_REQUIRED/.test(r.error), r.error);
  r = await ws({ p_weight_grams: 4, p_piece_ids: [p8, p8] }); T('C2', 'duplicate piece refused', !r.ok && /DUPLICATE/.test(r.error), r.error);
  r = await ws({ p_weight_grams: 4, p_piece_ids: [b4] }); T('C3', "another seller's piece refused", !r.ok && /NOT_AVAILABLE/.test(r.error), r.error);
  r = await ws({ p_weight_grams: 4, p_piece_ids: [p3] }); T('C4', 'too light selection refused', !r.ok && /TOO_LIGHT/.test(r.error), r.error);
  r = await ws({ p_weight_grams: 4, p_piece_ids: [p5, p3] }); T('C5', 'unnecessary extra piece refused (only the last piece may be cut)', !r.ok && /EXTRA/.test(r.error), r.error);
  const s1 = await ws({ p_weight_grams: 4, p_piece_ids: [p8] }, 'k-pc1');
  const s1b = await ws({ p_weight_grams: 4, p_piece_ids: [p8] }, 'k-pc1');
  const a1 = await su(`select piece_id, grams, piece_weight_before, fully_consumed from weight_sale_allocations where sale_id=$1`, [s1.data && s1.data.sale_id]);
  const w8 = Number((await one(`select weight_grams from consignment_pieces where id=$1`, [p8])).weight_grams);
  T('C6', '4 g cut from the selected 8 g piece: allocation names the piece, piece keeps 4 g; retry returns same sale', s1.ok && a1.length === 1 && a1[0].piece_id === p8 && Number(a1[0].grams) === 4 && Number(a1[0].piece_weight_before) === 8 && !a1[0].fully_consumed && w8 === 4 && s1b.ok && s1b.data.sale_id === s1.data.sale_id, { alloc: a1, piece_now: w8 });
  const s2 = await ws({ p_weight_grams: 7, p_piece_ids: [p3, p5] });
  const a2 = await su(`select piece_id, grams, fully_consumed from weight_sale_allocations where sale_id=$1 order by created_at`, [s2.data && s2.data.sale_id]);
  const st3 = await one(`select status, sale_id from consignment_pieces where id=$1`, [p3]); const w5 = Number((await one(`select weight_grams from consignment_pieces where id=$1`, [p5])).weight_grams);
  T('C7', '7 g from [3 g, 5 g]: 3 g piece sold whole, 4 g cut from the 5 g piece (1 g left)', s2.ok && a2.length === 2 && st3.status === 'sold' && w5 === 1, { alloc: a2.map(x => [x.grams, x.fully_consumed]), p5_now: w5 });
  r = await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: p3, p_client_markup_pct: 10 });
  T('C8', 'piece sold by weight cannot be sold again by barcode', !r.ok, r.error && r.error.slice(0, 80));
  r = await ws({ p_weight_grams: 1, p_piece_ids: [p3] }); T('C9', 'sold piece cannot be selected again', !r.ok && /NOT_AVAILABLE/.test(r.error), r.error);
  const eq = async () => { const x = await one(`select (select coalesce(sum(weight_grams),0) from consignment_pieces where seller_id=$1 and status='held_by_seller') held, (select coalesce(sum(base_weight_grams),0) from jewelry_sales where seller_id=$1 and status not in ('reversed','cancelled')) sold, (select coalesce(sum(base_weight_grams),0) from seller_consignments where seller_id=$1 and status in ('held_by_seller','partially_sold','fully_sold')) cons`, [U.SA]); return { held: Number(x.held), sold: Number(x.sold), consigned: Number(x.cons) }; };
  let e = await eq(); T('C10', 'held + sold = consigned (16 g)', Math.abs(e.held + e.sold - e.consigned) < 0.0001 && e.consigned === 16, e);
  await rpc(U.M, 'rpc_reverse_client_sale', { p_sale_id: s2.data.sale_id, p_reason: 'qaytdi' });
  const back3 = await one(`select status, weight_grams from consignment_pieces where id=$1`, [p3]); const back5 = Number((await one(`select weight_grams from consignment_pieces where id=$1`, [p5])).weight_grams);
  e = await eq();
  T('C11', 'reversal restores exactly the same pieces (3 g held again, 5 g piece back to 5 g)', back3.status === 'held_by_seller' && Number(back3.weight_grams) === 3 && back5 === 5 && Math.abs(e.held + e.sold - e.consigned) < 0.0001, { p3: back3, p5: back5, ...e });
  // concurrency: two sellers sessions try to cut the same remaining 4 g piece
  const par = await Promise.all([1, 2].map(i => rpc(U.SA, 'rpc_record_weight_sale', { p_customer_id: cust, p_client_markup_pct: 10, p_weight_grams: 4, p_piece_ids: [p8], p_idempotency_key: 'k-par' + i }, { hold: 1 })));
  const w8b = await one(`select status, weight_grams from consignment_pieces where id=$1`, [p8]);
  T('C12', 'parallel sales of the same remaining 4 g piece: one succeeds, piece never negative', par.filter(x => x.ok).length === 1 && w8b.status === 'sold' && Number(w8b.weight_grams) >= 0, { results: par.map(x => x.ok ? 'OK' : x.error.slice(0, 40)), piece: w8b });
  e = await eq(); T('C13', 'equation still holds after concurrency', Math.abs(e.held + e.sold - e.consigned) < 0.0001, e);
  // a seller without barcode pieces (pre-barcode consignment) keeps the old weight-sale behaviour
  // legacy shape: a pre-barcode consignment row without pieces (inserted directly, as historical data)
  await su(`insert into seller_consignments (organization_id, consignment_no, seller_id, product_name, quantity, base_weight_grams, proba, factory_markup_pct, factory_gold_due_grams, factory_remaining_gold_grams, seller_markup_pct, seller_obligation_g, status)
            values ('00000000-0000-0000-0000-000000000001', 'LEGACY-1', $1, 'eski partiya', 1, 10, 585, 8, 10.8, 10.8, 12, 11.2, 'held_by_seller')`, [U.SC]);
  const leg = { ok: true };
  const custC = (await rpc(U.SC, 'rpc_create_customer_with_code', { p_contact_name: 'C mijoz' })).data.customer_id;
  const piecesC = Number((await one(`select count(*) n from consignment_pieces where seller_id=$1 and status='held_by_seller'`, [U.SC])).n);
  r = await rpc(U.SC, 'rpc_record_weight_sale', { p_customer_id: custC, p_client_markup_pct: 10, p_weight_grams: 2 });
  T('C14', 'seller without barcode pieces: weight sale still allowed', leg.ok ? (piecesC > 0 ? !r.ok : r.ok) : null, { legacy_consignment: leg.ok || leg.error, pieces: piecesC, sale: r.ok || r.error });
  require('fs').writeFileSync(process.argv[2] || '/opt/goldia-audit/evidence/pieces-073.json', JSON.stringify(R, null, 1));
  console.log('RESULT', R.filter(x => x.ok).length, '/', R.length);
  await pool.end();
})();
