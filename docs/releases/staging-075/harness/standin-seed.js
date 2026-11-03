// Staging-like stand-in on the LOCAL PG17 stack at schema 074: 60 organizations, ~110 employees, customers created
// through the RPC, sales/settlements/purchases/handovers, then the staging defect is reproduced (a long customer code
// planted by a seller with a direct INSERT in one organization) so 074 -> 075 can be rehearsed on the staging shape.
const { Pool } = require(process.env.PG_MODULE || '/opt/goldia-audit/tools/node_modules/pg');
const pool = new Pool({ host: '127.0.0.1', port: Number(process.env.GA_PGPORT || 55437), user: 'postgres', database: 'postgres', max: 20 });
async function as(sub, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const r = await c.query(sql, params); await c.query('commit');
    return { ok: true, data: r.rows[0] && r.rows[0].r };
  } catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message }; } finally { c.release(); }
}
const enc = (v) => (v !== null && typeof v === 'object' && !(Array.isArray(v) && typeof v[0] !== 'object') ? JSON.stringify(v) : v);
const rpc = (sub, name, args) => { const k = Object.keys(args); return as(sub, 'select public.' + name + '(' + k.map((x, i) => x + ' => $' + (i + 1)).join(', ') + ') r', k.map((x) => enc(args[x]))); };
const id = (k, n) => '5e' + String(k).padStart(6, '0') + '-0000-4000-8000-' + String(n).padStart(12, '0');
(async () => {
  const tally = {};
  const t = (n, r) => { const kk = n + (r.ok ? ':ok' : ':fail'); tally[kk] = (tally[kk] || 0) + 1; if (!r.ok && !tally['e:' + n]) tally['e:' + n] = r.error.slice(0, 120); return r; };
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  for (let k = 1; k <= 60; k++) {
    const org = '00000000-0000-0000-0000-' + String(k).padStart(12, '0');
    await pool.query("insert into public.organizations (id, code, name, status) values ($1, $2, $3, 'ACTIVE') on conflict (id) do nothing", [org, 'org' + k, 'Sintetik tashkilot ' + k]);
    const D = id(k, 1), M = id(k, 2), S = id(k, 3), S2 = id(k, 4);
    const people = [[D, 'director'], [M, 'manager'], [S, 'sales']]; if (k % 3 === 0) people.push([S2, 'sales']);
    for (const [u, role] of people) {
      await pool.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated') on conflict (id) do nothing", [u, 'u' + u.slice(0, 8) + '-' + u.slice(-2) + '@standin.test']);
      await pool.query("insert into public.employees (id, user_id, employee_code, name, full_name, role, is_active, status, organization_id) values ($1, $1, $2, $3, $3, $4, true, 'active', $5) on conflict (id) do nothing", [u, 'E' + k + '-' + u.slice(-2), 'Xodim ' + k + '-' + u.slice(-2), role, org]);
    }
    if (k % 7 === 0) continue;
    t('rate', await rpc(D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000 + k * 1000, p_rate_date: today }));
    const r = t('receipt', await rpc(M, 'rpc_record_factory_receipt', { p_product_name: 'Partiya ' + k, p_original_physical_g: 30 + k, p_factory_markup_pct: 8 }));
    if (!r.ok) continue;
    const c = t('consign', await rpc(M, 'rpc_issue_barcode_consignment', { p_seller_id: S, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: r.data.receipt_id,
      p_pieces: [{ weight_grams: 10, model_code: 'M' + k + 'A' }, { weight_grams: 8.5, model_code: 'M' + k + 'B' }] }));
    const cu = t('customer', await rpc(S, 'rpc_create_customer_with_code', { p_contact_name: 'Mijoz ' + k + ' (sintetik)' }));
    if (k % 2 === 0) t('customer2', await rpc(D, 'rpc_create_customer_with_code', { p_contact_name: 'Mijoz ' + k + 'b (sintetik)' }));
    if (!c.ok || !cu.ok) continue;
    const cust = cu.data.customer_id;
    t('barcode_sale', await rpc(S, 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: c.data.pieces[0].id, p_client_markup_pct: 15 }));
    if (k % 2 === 0) t('settlement', await rpc(S, 'rpc_record_client_settlement', { p_customer_id: cust, p_cash_amount: 1000000 + k * 10000 }));
    if (k % 4 === 0) t('purchase', await rpc(M, 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor (sintetik)', p_cash_spent_uzs: 900000, p_gold_weight_grams: 1, p_proba: 585 }));
    if (k % 5 === 0) {
      const till = (await pool.query('select coalesce(seller_till_cash_amount,0) c from public.seller_gold_accounts where seller_id = $1', [S])).rows[0] || { c: 0 };
      if (Number(till.c) > 0) t('handover', await rpc(S, 'rpc_record_seller_to_manager_settlement', { p_seller_id: S, p_cash_paid_amount: Number(till.c) }));
    }
  }
  await pool.query("insert into public.customers (organization_id, customer_code, contact_name) values ('00000000-0000-0000-0000-000000000001', 'CUST-DEMO-01', 'demo'), ('00000000-0000-0000-0000-000000000002', 'CUST-1A2B3C', 'hex'), ('00000000-0000-0000-0000-000000000003', 'CUST-12C4D', 'mixed')");
  t('planted_by_seller_direct_insert', await as(id(56, 3), "insert into public.customers (organization_id, customer_code, contact_name, seller_id) values ('00000000-0000-0000-0000-000000000056', 'CUST-T056_1793002353699', 'planted by a seller (direct INSERT)', $1) returning 1 r", [id(56, 3)]));
  t('customer_after_plant', await rpc(id(1, 3), 'rpc_create_customer_with_code', { p_contact_name: 'after plant (sintetik)' }));
  console.log(JSON.stringify(tally, null, 1));
  await pool.end();
})();
