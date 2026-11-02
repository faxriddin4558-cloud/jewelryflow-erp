// Concurrency on top of the s072 scenario (073). Real parallel PostgreSQL sessions.
const { U, rpc, su, pool } = require('./lib');
const R = []; const T = (id, t, ok, d) => { R.push({ id, title: t, ok: !!ok, detail: d }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + t + ' | ' + JSON.stringify(d).slice(0, 200)); };
const one = async (s, p) => (await su(s, p))[0];
(async () => {
  const cb = (await one(`select id from customers where seller_id=$1 order by created_at limit 1`, [U.SB])).id;
  const piece = (await one(`select id from consignment_pieces where seller_id=$1 and status='held_by_seller' order by weight_grams limit 1`, [U.SB])).id;
  let r = await Promise.all([1, 2].map(i => rpc(U.SB, 'rpc_record_barcode_piece_sale', { p_customer_id: cb, p_piece_id: piece, p_client_markup_pct: 12, p_idempotency_key: 'cc1-' + i }, { hold: 1 })));
  T('K1', 'same barcode piece sold twice in parallel', r.filter(x => x.ok).length === 1, r.map(x => x.ok ? 'OK' : x.error.slice(0, 50)));
  const nc = (await rpc(U.SB, 'rpc_create_customer_with_code', { p_contact_name: 'Parallel mijoz (sintetik)' })).data.customer_id;
  r = await Promise.all([1, 2, 3].map(i => rpc(U.SB, 'rpc_record_client_settlement', { p_customer_id: nc, p_cash_amount: 900000, p_idempotency_key: 'cc3-' + i }, { hold: 1 })));
  const acc = await one(`select advance_balance_grams a from client_gold_accounts where customer_id=$1`, [nc]);
  T('K2', '3 parallel first payments of 900,000 at seller B rate 900,000 -> advance 3.0 g', r.every(x => x.ok) && Number(acc.a) === 3, { advance: acc.a });
  r = await Promise.all([1, 2].map(() => rpc(U.SB, 'rpc_record_client_settlement', { p_customer_id: nc, p_cash_amount: 9000, p_idempotency_key: 'cc5-same' }, { hold: 1 })));
  const n5 = (await one(`select count(*)::int n from gold_settlements where idempotency_key='cc5-same'`)).n;
  T('K3', 'same idempotency key twice in parallel -> one settlement', n5 === 1 && r.every(x => x.ok), { rows: n5 });
  const till = Number((await one(`select seller_till_cash_amount c from seller_gold_accounts where seller_id=$1`, [U.SB])).c);
  r = await Promise.all([1, 2].map(i => rpc(U.SB, 'rpc_record_seller_to_manager_settlement', { p_seller_id: U.SB, p_cash_paid_amount: till, p_idempotency_key: 'cc4-' + i }, { hold: 1 })));
  const pool0 = await one(`select seller_till_cash_amount c, till_valued_cash_uzs vu, till_valued_cash_585_g vg from seller_gold_accounts where seller_id=$1`, [U.SB]);
  T('K4', 'full till handed over twice in parallel -> one succeeds, till and valued pool exactly 0', r.filter(x => x.ok).length === 1 && Number(pool0.c) === 0 && Number(pool0.vu) === 0 && Number(pool0.vg) === 0, { results: r.map(x => x.ok ? 'OK ' + x.data.total_settled_grams : x.error.slice(0, 40)), pool: pool0 });
  const sale = (await one(`select id from jewelry_sales where seller_id=$1 and status not in ('reversed','cancelled') order by created_at desc limit 1`, [U.SB])).id;
  r = await Promise.all([1, 2].map(i => rpc(U.M, 'rpc_reverse_client_sale', { p_sale_id: sale, p_reason: 'p' + i }, { hold: 1 })));
  T('K5', 'parallel double reversal -> one succeeds', r.filter(x => x.ok).length === 1, r.map(x => x.ok ? 'OK' : x.error.slice(0, 40)));
  const rate = await Promise.all([[905000, 'a'], [915000, 'b']].map(([v, k]) => rpc(U.SB, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: v, p_reason: k }, { hold: 1 })));
  const hist = (await one(`select count(*)::int n from seller_rate_history where seller_id=$1`, [U.SB])).n; const cur = (await one(`select lom_rate_uzs l from seller_rates where seller_id=$1`, [U.SB])).l;
  T('K6', 'two parallel rate changes are serialized (both in history, final rate is one of them)', rate.every(x => x.ok) && [905000, 915000].includes(Number(cur)), { history: hist, current: cur });
  require('fs').writeFileSync(process.argv[2] || '/opt/goldia-audit/evidence/conc-073rc.json', JSON.stringify(R, null, 1));
  console.log('RESULT', R.filter(x => x.ok).length, '/', R.length); await pool.end();
})();
