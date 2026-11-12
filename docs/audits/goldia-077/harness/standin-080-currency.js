// LOCAL stand-in only (127.0.0.1): production-shaped currency / legacy data at schema 080 before the 081..085 rehearsal:
// USD currency sales + payments and a legacy debt in 4 organizations, through the RPCs as the real users
// (JWT claims, role authenticated).
const { Pool } = require('/opt/goldia-audit/tools/node_modules/pg');
const pool = new Pool({ host: '127.0.0.1', port: 55437, user: 'postgres', database: 'postgres', max: 5 });
async function rpc(sub, fn, args) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const names = Object.keys(args);
    const sql = 'select to_jsonb(public.' + fn + '(' + names.map((k, i) => k + ' := $' + (i + 1)).join(', ') + ')) r';
    const vals = names.map((k) => (args[k] && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]));
    const r = await c.query(sql, vals);
    await c.query('commit');
    return { ok: true, data: r.rows[0].r };
  } catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message.slice(0, 120) }; } finally { c.release(); }
}
(async () => {
  const sellers = (await pool.query("select e.user_id::text uid, e.id::text eid, e.organization_id::text org from public.employees e where e.role::text = 'sales' and e.user_id is not null order by e.organization_id limit 4")).rows;
  const out = {};
  const t = (k, r) => { const key = k + (r.ok ? ':ok' : ':fail'); out[key] = (out[key] || 0) + 1; if (!r.ok) out['e:' + k] = r.error; return r; };
  for (const s of sellers) {
    const cust = (await pool.query('select id::text from public.customers where organization_id = $1 and seller_id = $2 limit 1', [s.org, s.eid])).rows[0];
    const piece = (await pool.query("select id::text, weight_grams from public.consignment_pieces where organization_id = $1 and status = 'held_by_seller' order by weight_grams desc limit 1", [s.org])).rows[0];
    if (!cust || !piece) { out.skipped = (out.skipped || 0) + 1; continue; }
    t('usd_sale', await rpc(s.uid, 'rpc_record_currency_sale', { p_customer_id: cust.id, p_currency: 'USD', p_amount: 250, p_weight_grams: Number(piece.weight_grams), p_piece_ids: [piece.id] }));
    t('usd_payment', await rpc(s.uid, 'rpc_record_client_currency_settlement', { p_customer_id: cust.id, p_currency: 'USD', p_usd_amount: 100, p_usd_rate: 12600 }));
    t('legacy_debt', await rpc(s.uid, 'rpc_record_client_legacy_debt', { p_customer_id: cust.id, p_balance_type: 'debt', p_amount_585_g: 3, p_as_of_date: '2026-11-01' }));
  }
  console.log(JSON.stringify(out, null, 1));
  await pool.end();
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
