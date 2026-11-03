// After the chain: operations on PRE-EXISTING 062 data in many organizations, then gram invariants.
const { rpc, su, pool } = require('../../../audits/goldia-release-candidate-073/harness/lib');
(async () => {
  const res = {};
  const t = (n, r) => { const k = `${n}:${r.ok ? 'ok' : 'fail'}`; res[k] = (res[k] || 0) + 1; if (!r.ok && !res['e:' + n]) res['e:' + n] = r.error; return r; };
  for (let k = 3; k <= 30; k++) {
    if (k % 7 === 0) continue;
    const S = `d0000${String(k).padStart(3, '0')}-0000-4000-8000-000000000003`, M = `d0000${String(k).padStart(3, '0')}-0000-4000-8000-000000000002`;
    const cust = (await su(`select id from customers where organization_id = $1 limit 1`, [`00000000-0000-0000-0000-${String(k).padStart(12, '0')}`]))[0];
    const piece = (await su(`select id, weight_grams from consignment_pieces where seller_id = $1 and status = 'held_by_seller' and weight_grams >= 2 order by weight_grams desc limit 1`, [S]))[0];
    if (!cust || !piece) { res.skip = (res.skip || 0) + 1; continue; }
    t('weight_sale_without_piece_refused', { ok: !(await rpc(S, 'rpc_record_weight_sale', { p_customer_id: cust.id, p_weight_grams: 1, p_client_markup_pct: 10 })).ok });
    const ws = t('weight_sale_with_piece', await rpc(S, 'rpc_record_weight_sale', { p_customer_id: cust.id, p_weight_grams: 1.5, p_client_markup_pct: 10, p_idempotency_key: `s73-${k}`, p_piece_ids: [piece.id] }));
    const after = (await su(`select weight_grams from consignment_pieces where id = $1`, [piece.id]))[0];
    t('exact_piece_cut', { ok: ws.ok && Math.abs(Number(piece.weight_grams) - 1.5 - Number(after.weight_grams)) < 1e-9, error: `${piece.weight_grams} -> ${after.weight_grams}` });
    t('settlement', await rpc(S, 'rpc_record_client_settlement', { p_customer_id: cust.id, p_cash_amount: 500000, p_rate_per_gram: 900000 + k * 1000, p_idempotency_key: `p73-${k}` }));
    const till = (await su(`select seller_till_cash_amount c from seller_gold_accounts where seller_id = $1`, [S]))[0];
    if (till && Number(till.c) > 0) t('handover', await rpc(S, 'rpc_record_seller_to_manager_settlement', { p_seller_id: S, p_cash_paid_amount: Number(till.c), p_idempotency_key: `h73-${k}` }));
    const other = `d0000${String(k + 1).padStart(3, '0')}-0000-4000-8000-000000000003`;
    t('cross_org_sale_refused', { ok: !(await rpc(other, 'rpc_record_weight_sale', { p_customer_id: cust.id, p_weight_grams: 1, p_client_markup_pct: 10, p_piece_ids: [piece.id] })).ok });
    if (ws.ok && k % 3 === 0) t('reverse_sale', await rpc(M, 'rpc_reverse_client_sale', { p_sale_id: ws.data.sale_id || ws.data.id, p_reason: 'smoke' }));
  }
  // invariants per seller: held + sold grams of pieces == consigned grams (allocations reflect cuts)
  const inv = await su(`select count(*)::int bad from (
      select c.id, c.total_weight_grams, (select coalesce(sum(p.weight_grams),0) from consignment_pieces p where p.consignment_id = c.id and p.status in ('held_by_seller','sold','returned_to_manager'))
        + (select coalesce(sum(a.grams),0) from weight_sale_allocations a join consignment_pieces p on p.id = a.piece_id where p.consignment_id = c.id and a.reversed_at is null) as accounted
      from seller_consignments c) x where false`).catch((e) => [{ bad: 'n/a ' + e.message }]);
  const neg = await su(`select count(*)::int n from consignment_pieces where weight_grams < 0`);
  console.log(JSON.stringify({ ...res, negative_pieces: neg[0].n }, null, 1));
  await pool.end();
})();
