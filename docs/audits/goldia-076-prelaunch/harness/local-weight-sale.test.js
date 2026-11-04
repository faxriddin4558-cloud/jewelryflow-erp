// Business rule 1 (product choice NOT mandatory) on the LOCAL PG17 stand-in at 076, real JWT claims.
// 100 g physical at 12 % -> stock -100 g, customer debt +112 g; markup always on the base grams (no compounding);
// pieces and gram stock never disagree; no negative stock; no piece sold twice; parallel sales serialized.
const { Pool } = require(process.env.PG_MODULE || '/opt/goldia-audit/tools/node_modules/pg');
const pool = new Pool({ host: '127.0.0.1', port: Number(process.env.GA_PGPORT || 55437), user: 'postgres', database: 'postgres', max: 30 });
const id = (k, n) => '5e' + String(k).padStart(6, '0') + '-0000-4000-8000-' + String(n).padStart(12, '0');
const K = Number(process.env.ORGK || 6); // org 6 has director, manager, seller (and seller 2 since 6 % 3 == 0)
const ORG = '00000000-0000-0000-0000-' + String(K).padStart(12, '0');
const D = id(K, 1), M = id(K, 2), S = id(K, 3), S2 = id(K, 4);
async function as(sub, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub, role: 'authenticated' }), sub]);
    await c.query('set local role authenticated');
    const r = await c.query(sql, params); await c.query('commit');
    return { ok: true, data: r.rows[0] && r.rows[0].r };
  } catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message, code: e.code }; } finally { c.release(); }
}
const rpc = (sub, name, args) => { const k = Object.keys(args); return as(sub, `select public.${name}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) r`, k.map((x) => (x === 'p_pieces' ? JSON.stringify(args[x]) : args[x]))); };
const q1 = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const N = (x) => Number(x); const r4 = (x) => Math.round(Number(x) * 1e4) / 1e4;
const R = []; const T = (idn, title, ok, exp, act) => { R.push({ id: idn, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${idn} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 200)}`); };
const stockOf = async (sel) => N((await as(M, 'select public.get_seller_available_stock_grams($1) r', [sel])).data);
const heldG = async (sel) => N((await q1("select coalesce(sum(weight_grams),0) g from consignment_pieces where seller_id=$1 and status='held_by_seller'", [sel])).g);
const debtOf = async (c) => N(((await q1('select current_debt_grams d from client_gold_accounts where customer_id=$1', [c])) || { d: 0 }).d);
(async () => {
  const run = Date.now().toString(36);
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  await rpc(D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const rc = await rpc(M, 'rpc_record_factory_receipt', { p_product_name: `WS ${run}`, p_original_physical_g: 300, p_factory_markup_pct: 8 });
  if (!rc.ok) throw new Error('receipt ' + rc.error);
  // 30 pieces of 4.25 .. 11.5 g (realistic sizes), total = 230.25 g
  const pieces = [...Array(30)].map((_, i) => ({ weight_grams: r4(4.25 + (i % 6) * 1.45), model_code: `WS-${run}-${i}` }));
  const total = r4(pieces.reduce((a, p) => a + p.weight_grams, 0));
  const cons = await rpc(M, 'rpc_issue_barcode_consignment', { p_seller_id: S, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.data.receipt_id, p_pieces: pieces });
  if (!cons.ok) throw new Error('consign ' + cons.error);
  const mk = async (name, who = S) => (await rpc(who, 'rpc_create_customer_with_code', { p_contact_name: name })).data.customer_id;
  const c1 = await mk(`WS 100g ${run}`);
  const st0 = await stockOf(S); const h0 = await heldG(S);
  T('WS-00', 'before: gram stock equals held piece grams', Math.abs(st0 - h0) < 1e-9, st0, h0);
  // ---- the business example
  const s100 = await rpc(S, 'rpc_record_weight_sale', { p_customer_id: c1, p_weight_grams: 100, p_client_markup_pct: 12, p_idempotency_key: `ws100-${run}` });
  T('WS-01', 'seller sells 100 g at 12 % WITHOUT choosing a product (075 refused: ERR_PIECE_REQUIRED)', s100.ok, 'ok', s100.ok ? s100.data.sale_no : s100.error);
  if (!s100.ok) { await pool.end(); process.exit(1); }
  T('WS-02', 'customer debt = 112 g (12 % of the base 100 g)', N(s100.data.client_gold_due_grams) === 112 && (await debtOf(c1)) === 112, 112, { due: s100.data.client_gold_due_grams, debt: await debtOf(c1) });
  const st1 = await stockOf(S); const h1 = await heldG(S);
  T('WS-03', 'seller gram stock -100 g exactly', r4(st0 - st1) === 100, 100, r4(st0 - st1));
  T('WS-04', 'held piece grams -100 g exactly (pieces and grams agree)', r4(h0 - h1) === 100 && Math.abs(st1 - h1) < 1e-9, { held: 100, equal: true }, { held: r4(h0 - h1), stock: st1, pieces: h1 });
  const al = await q1('select count(*) n, sum(grams) g, count(*) filter (where not fully_consumed) cut from weight_sale_allocations where sale_id=$1', [s100.data.sale_id]);
  T('WS-05', 'allocations: whole pieces + at most one cut piece, sum 100 g', N(al.g) === 100 && N(al.cut) <= 1, { g: 100, cut: '<=1' }, al);
  const again = await rpc(S, 'rpc_record_weight_sale', { p_customer_id: c1, p_weight_grams: 100, p_client_markup_pct: 12, p_idempotency_key: `ws100-${run}` });
  T('WS-06', 'retry with the same key returns the same sale, nothing deducted twice', again.ok && again.data.sale_id === s100.data.sale_id && (await stockOf(S)) === st1, s100.data.sale_id, again.ok ? again.data.sale_id : again.error);
  // ---- markups on the base grams, factory markups 6/8/10 independent
  const c2 = await mk(`WS markups ${run}`);
  let exp = await debtOf(c2);
  for (const m of [10, 12, 15, 25, 30, 35]) {
    const w = 1.37;
    const r = await rpc(S, 'rpc_record_weight_sale', { p_customer_id: c2, p_weight_grams: w, p_client_markup_pct: m });
    exp = r4(exp + r4(w * (1 + m / 100)));
    T(`WS-07-${m}`, `${m} % on 1.37 g = ${r4(w * (1 + m / 100))} g (no markup on markup)`, r.ok && N(r.data.client_gold_due_grams) === r4(w * (1 + m / 100)), r4(w * (1 + m / 100)), r.ok ? N(r.data.client_gold_due_grams) : r.error);
  }
  T('WS-08', 'customer debt is the exact sum of the six sales', (await debtOf(c2)) === exp, exp, await debtOf(c2));
  // ---- limits
  const stNow = await stockOf(S);
  const over = await rpc(S, 'rpc_record_weight_sale', { p_customer_id: c2, p_weight_grams: r4(stNow + 0.0001), p_client_markup_pct: 10 });
  T('WS-09', 'selling 0.0001 g more than the stock is refused (no negative stock)', !over.ok && /ERR_INSUFFICIENT_SELLER_STOCK/.test(over.error), 'refused', over.ok ? 'ACCEPTED' : over.error.slice(0, 60));
  for (const [n, w] of [['zero', 0], ['negative', -1]]) { const r = await rpc(S, 'rpc_record_weight_sale', { p_customer_id: c2, p_weight_grams: w, p_client_markup_pct: 10 }); T(`WS-10-${n}`, `weight ${w} refused`, !r.ok, 'refused', r.ok ? 'ACCEPTED' : r.error.slice(0, 50)); }
  for (const [n, m] of [['neg', -1], ['101', 101], ['null', null]]) { const r = await rpc(S, 'rpc_record_weight_sale', { p_customer_id: c2, p_weight_grams: 1, p_client_markup_pct: m }); T(`WS-11-${n}`, `markup ${m} refused`, !r.ok, 'refused', r.ok ? 'ACCEPTED' : r.error.slice(0, 50)); }
  const cOther = await mk(`WS other seller cust ${run}`, S2);
  const xs = await rpc(S, 'rpc_record_weight_sale', { p_customer_id: cOther, p_weight_grams: 1, p_client_markup_pct: 10 });
  T('WS-12', "seller cannot sell to another seller's customer (075 accepted it through the API)", !xs.ok && xs.code === '42501', '42501', xs.ok ? 'ACCEPTED' : xs.code + ' ' + xs.error.slice(0, 60));
  // ---- concurrency: 12 parallel sales of 9 g against the remaining stock -> never negative, pieces == grams
  const before = await stockOf(S);
  const par = await Promise.all([...Array(12)].map((_, i) => rpc(S, 'rpc_record_weight_sale', { p_customer_id: c2, p_weight_grams: 9, p_client_markup_pct: 10, p_idempotency_key: `par-${run}-${i}` })));
  const okN = par.filter((x) => x.ok).length; const after = await stockOf(S); const hA = await heldG(S);
  T('WS-13', '12 parallel 9 g sales: accepted x 9 g = stock decrease, stock >= 0, pieces == grams', r4(before - after) === r4(okN * 9) && after >= 0 && Math.abs(after - hA) < 1e-9, { dec: r4(okN * 9) }, { ok: okN, dec: r4(before - after), after, pieces: hA });
  const dupPieces = await q1("select count(*) n from (select piece_id from weight_sale_allocations wa join jewelry_sales j on j.id=wa.sale_id where j.seller_id=$1 and wa.fully_consumed and wa.reversed_at is null and j.status not in ('reversed','cancelled') group by piece_id having count(*)>1) x", [S]);
  T('WS-14', 'no piece fully consumed by two active sales', N(dupPieces.n) === 0, 0, N(dupPieces.n));
  // ---- barcode sale of a piece that was already consumed
  const soldPiece = await q1("select piece_id from weight_sale_allocations where sale_id=$1 and fully_consumed limit 1", [s100.data.sale_id]);
  const bs = await rpc(S, 'rpc_record_barcode_piece_sale', { p_customer_id: c2, p_piece_id: soldPiece.piece_id, p_client_markup_pct: 10 });
  T('WS-15', 'a piece consumed by the gram sale cannot be sold again by barcode', !bs.ok, 'refused', bs.ok ? 'ACCEPTED' : bs.error.slice(0, 70));
  // ---- reversal restores stock, pieces and debt
  const stR0 = await stockOf(S); const hR0 = await heldG(S); const dR0 = await debtOf(c1);
  const rv = await rpc(M, 'rpc_reverse_client_sale', { p_sale_id: s100.data.sale_id, p_reason: 'qaytdi' });
  T('WS-16', 'manager reverses the 100 g sale: stock +100, pieces +100, debt -112', rv.ok && r4((await stockOf(S)) - stR0) === 100 && r4((await heldG(S)) - hR0) === 100 && r4(dR0 - (await debtOf(c1))) === 112, { stock: 100, pieces: 100, debt: -112 }, rv.ok ? { stock: r4((await stockOf(S)) - stR0), pieces: r4((await heldG(S)) - hR0), debt: r4((await debtOf(c1)) - dR0) } : rv.error);
  const rv2 = await rpc(M, 'rpc_reverse_client_sale', { p_sale_id: s100.data.sale_id, p_reason: 'yana' });
  T('WS-17', 'second reversal refused (no double restore)', !rv2.ok, 'refused', rv2.ok ? 'ACCEPTED' : rv2.error.slice(0, 60));
  // ---- independent end-state model
  const model = await q1(`select
     (select coalesce(sum(base_weight_grams),0) from seller_consignments where seller_id=$1 and status in ('held_by_seller','partially_sold','fully_sold'))
   - (select coalesce(sum(base_weight_grams),0) from jewelry_sales where seller_id=$1 and status not in ('reversed','cancelled')) g`, [S]);
  T('WS-18', 'end: stock = consigned - active sales (independent) = held piece grams', Math.abs(N(model.g) - (await stockOf(S))) < 1e-9 && Math.abs((await stockOf(S)) - (await heldG(S))) < 1e-9, N(model.g), { stock: await stockOf(S), pieces: await heldG(S) });
  const acc = await q1('select seller_owes_manager_g o, current_physical_stock_g p from seller_gold_accounts where seller_id=$1', [S]);
  T('WS-19', 'seller account physical stock = model', Math.abs(N(acc.p) - N(model.g)) < 1e-9, N(model.g), N(acc.p));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} (consignment total ${total} g)`);
  require('fs').writeFileSync(process.env.OUT || '/dev/null', JSON.stringify(R, null, 2));
  await pool.end(); process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
