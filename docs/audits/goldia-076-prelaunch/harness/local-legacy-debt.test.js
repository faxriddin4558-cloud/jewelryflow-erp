// 076 legacy debt - behavioural tests on the LOCAL PG17 stand-in (075 + 076, standin-seed.js data), real JWT claims as
// PostgREST would set them (role authenticated + request.jwt.claims.sub). Org 3 has a director, a manager and two sellers;
// org 4 is "another organization".
const { Pool } = require(process.env.PG_MODULE || '/opt/goldia-audit/tools/node_modules/pg');
const pool = new Pool({ host: '127.0.0.1', port: Number(process.env.GA_PGPORT || 55437), user: 'postgres', database: 'postgres', max: 20 });
const id = (k, n) => '5e' + String(k).padStart(6, '0') + '-0000-4000-8000-' + String(n).padStart(12, '0');
const ORG = '00000000-0000-0000-0000-000000000003', ORG4 = '00000000-0000-0000-0000-000000000004';
const D = id(3, 1), M = id(3, 2), S = id(3, 3), S2 = id(3, 4), D4 = id(4, 1), M4 = id(4, 2);
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
const rpc = (sub, name, args) => { const k = Object.keys(args); return as(sub, `select public.${name}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) r`, k.map((x) => args[x])); };
const q1 = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const R = []; const T = (idn, title, ok, exp, act) => { R.push({ id: idn, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${idn} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 220)}`); };
const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const snap = async () => q1(`select
   (select coalesce(sum(current_physical_stock_g),0) from seller_gold_accounts where organization_id=$1)::text as seller_stock,
   (select coalesce(sum(manager_physical_stock_g),0)||'/'||coalesce(sum(current_factory_obligation_g),0)||'/'||coalesce(sum(manager_cash_amount),0) from manager_vault_account where organization_id=$1) as vault,
   (select count(*) from jewelry_sales where organization_id=$1)::text as sales,
   (select count(*) from factory_receipts where organization_id=$1)::text as receipts`, [ORG]);
const acc = async (cust) => q1('select current_debt_grams::numeric d, advance_balance_grams::numeric a from client_gold_accounts where customer_id=$1', [cust]) || { d: 0, a: 0 };
const sobl = async (sel) => q1('select seller_legacy_debt_obligation_g::numeric l, total_seller_obligation_g::numeric o, seller_owes_manager_g::numeric w from seller_gold_accounts where seller_id=$1', [sel]) || { l: 0, o: 0, w: 0 };
const N = (x) => Number(x);
(async () => {
  const run = Date.now().toString(36);
  const mk = async (who, name) => { const r = await rpc(who, 'rpc_create_customer_with_code', { p_contact_name: name }); if (!r.ok) throw new Error('customer ' + r.error); return r.data.customer_id; };
  const cS = await mk(S, `LD S mijoz ${run}`), cS2 = await mk(S2, `LD S2 mijoz ${run}`);
  const cU = (await q1("insert into customers (organization_id, contact_name, customer_code) values ($1, $2, $3) returning id", [ORG, `LD unassigned ${run}`, 'CUST-U' + run])).id;
  const c4 = await mk(id(4, 3), `LD org4 mijoz ${run}`);
  const before = await snap(); const ob0 = await sobl(S);
  // ---- seller: the incident
  const leg = (who, cust, extra = {}) => rpc(who, 'rpc_record_client_legacy_debt', { p_customer_id: cust, p_balance_type: 'debt', p_amount_585_g: 206.83, p_as_of_date: today, p_notes: 'daftar', p_entry_type: 'manual_addition', p_target_final_balance: null, p_idempotency_key: `LEGACY-${cust}-${run}-${Math.random()}`, ...extra });
  const key1 = `LEGACY-${cS}-${run}-stable`;
  const r1 = await leg(S, cS, { p_idempotency_key: key1 });
  const a1 = await acc(cS); const ob1 = await sobl(S);
  T('LD-01', 'seller adds 206.83 g legacy debt to OWN customer (incident case)', r1.ok && N(a1.d) === 206.83, { ok: true, debt: 206.83 }, r1.ok ? { debt: N(a1.d), delta: r1.data.delta_585_g } : r1.error);
  T('LD-02', "seller's obligation to the manager grows by exactly 206.83 g", Math.abs(N(ob1.l) - N(ob0.l) - 206.83) < 1e-9 && Math.abs(N(ob1.o) - N(ob0.o) - 206.83) < 1e-9, '+206.83', { legacy: N(ob1.l) - N(ob0.l), obligation: N(ob1.o) - N(ob0.o) });
  const after1 = await snap();
  T('LD-03', 'stock, vault, factory obligation, cash, sales, receipts unchanged', JSON.stringify(before) === JSON.stringify(after1), before, after1);
  const r2 = await leg(S, cS, { p_idempotency_key: key1 });
  T('LD-04', 'retry with the SAME key returns the first result, no second row', r2.ok && r2.data.legacy_debt_id === r1.data.legacy_debt_id && N((await acc(cS)).d) === 206.83, r1.ok && r1.data.legacy_debt_id, r2.ok ? r2.data.legacy_debt_id : r2.error);
  const r3 = await leg(S, cS);
  T('LD-05', 'same addition with a NEW key within 10 min (double click / old frontend) is refused', !r3.ok && /Takroriy/.test(r3.error) && N((await acc(cS)).d) === 206.83, 'refused, debt 206.83', r3.ok ? 'ACCEPTED' : r3.error.slice(0, 90));
  // parallel: 6 concurrent identical additions with different keys -> exactly 1
  const cP = await mk(S, `LD parallel ${run}`);
  const par = await Promise.all([...Array(6)].map(() => leg(S, cP, { p_amount_585_g: 12.5 })));
  T('LD-06', '6 parallel identical additions (different keys) -> exactly one booked', par.filter((x) => x.ok).length === 1 && N((await acc(cP)).d) === 12.5, 1, { ok: par.filter((x) => x.ok).length, debt: N((await acc(cP)).d) });
  const par2 = await Promise.all([...Array(6)].map(() => leg(S, cP, { p_amount_585_g: 3, p_idempotency_key: `same-${run}` })));
  T('LD-07', '6 parallel requests with the SAME key -> one row, all answer the same id', par2.every((x) => x.ok) && new Set(par2.map((x) => x.data.legacy_debt_id)).size === 1 && N((await acc(cP)).d) === 15.5, 15.5, { ok: par2.filter((x) => x.ok).length, ids: new Set(par2.filter((x) => x.ok).map((x) => x.data.legacy_debt_id)).size, debt: N((await acc(cP)).d) });
  // ---- seller boundaries
  const rO = await leg(S, cS2); T('LD-08', "seller cannot touch another seller's customer", !rO.ok && rO.code === '42501', '42501', rO.ok ? 'ACCEPTED' : rO.code + ' ' + rO.error.slice(0, 70));
  const rU = await leg(S, cU); T('LD-09', 'seller cannot book on an unassigned customer', !rU.ok && rU.code === '42501', '42501', rU.ok ? 'ACCEPTED' : rU.code);
  const r4 = await leg(S, c4); T('LD-10', 'seller cannot touch another organization', !r4.ok, 'refused', r4.ok ? 'ACCEPTED' : r4.error.slice(0, 60));
  const rA = await leg(S, cS, { p_balance_type: 'advance', p_amount_585_g: 5 }); T('LD-11', 'seller cannot enter an advance', !rA.ok && rA.code === '42501', '42501', rA.ok ? 'ACCEPTED' : rA.code);
  const rDn = await leg(S, cS, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: 100 });
  T('LD-12', 'seller cannot reconcile DOWN (would lower own obligation)', !rDn.ok && rDn.code === '42501' && N((await acc(cS)).d) === 206.83, '42501', rDn.ok ? 'ACCEPTED' : rDn.code + ' ' + rDn.error.slice(0, 80));
  const rUp = await leg(S, cS, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: 250.0001 });
  T('LD-13', 'seller may reconcile UP to the notebook balance (250.0001)', rUp.ok && N((await acc(cS)).d) === 250.0001 && N(rUp.data.delta_585_g) === 43.1701, { debt: 250.0001, delta: 43.1701 }, rUp.ok ? { debt: N((await acc(cS)).d), delta: rUp.data.delta_585_g } : rUp.error);
  const rSame = await leg(S, cS, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: 250.0001 });
  T('LD-14', 'reconciliation to the same balance again -> no change (natural idempotency)', rSame.ok && rSame.data.no_change_needed === true, true, rSame.ok ? rSame.data.no_change_needed : rSame.error);
  const rPS = await leg(S, cS, { p_seller_id: S2, p_amount_585_g: 1 }); T('LD-15', 'seller cannot book the debt on another seller', !rPS.ok && rPS.code === '42501', '42501', rPS.ok ? 'ACCEPTED' : rPS.code);
  for (const [n, v] of [['zero', 0], ['negative', -5]]) { const r = await leg(S, cS, { p_amount_585_g: v }); T('LD-16-' + n, `amount ${v} refused`, !r.ok, 'refused', r.ok ? 'ACCEPTED' : r.error.slice(0, 60)); }
  const rNeg = await leg(S, cS, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: -10 });
  T('LD-17', 'negative notebook balance is clamped to 0 -> a reduction -> refused for seller', !rNeg.ok, 'refused', rNeg.ok ? 'ACCEPTED' : rNeg.code);
  // ---- manager / director
  const rM = await leg(M, cS2, { p_amount_585_g: 7.25 }); T('LD-18', "manager adds legacy debt to any customer of the org (seller S2's)", rM.ok && N((await acc(cS2)).d) === 7.25, 7.25, rM.ok ? N((await acc(cS2)).d) : rM.error);
  const rMd = await leg(M, cS, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: 200 });
  T('LD-19', 'manager may reconcile DOWN (250.0001 -> 200)', rMd.ok && N((await acc(cS)).d) === 200, 200, rMd.ok ? N((await acc(cS)).d) : rMd.error);
  const rMa = await leg(M, cU, { p_balance_type: 'advance', p_amount_585_g: 4 }); T('LD-20', 'manager may enter an advance', rMa.ok && N((await acc(cU)).a) === 4, 4, rMa.ok ? N((await acc(cU)).a) : rMa.error);
  const rM4 = await leg(M, c4); T('LD-21', "manager cannot touch another organization's customer", !rM4.ok, 'refused', rM4.ok ? 'ACCEPTED' : rM4.error.slice(0, 50));
  const sob4 = await q1('select seller_gold_accounts.*::text t from seller_gold_accounts where seller_id=$1', [id(4, 3)]);
  const rX = await leg(D, cS, { p_seller_id: id(4, 3), p_amount_585_g: 1 });
  const sob4b = await q1('select seller_gold_accounts.*::text t from seller_gold_accounts where seller_id=$1', [id(4, 3)]);
  T('LD-22', "director cannot book on another organization's seller (before 076 it overwrote that seller's account)", !rX.ok && rX.code === '42501' && JSON.stringify(sob4) === JSON.stringify(sob4b), '42501, other org untouched', rX.ok ? 'ACCEPTED' : rX.code);
  const rW = await rpc('00000000-0000-4000-8000-00000000dead', 'rpc_record_client_legacy_debt', { p_customer_id: cS, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: today });
  T('LD-23', 'user without employee profile refused', !rW.ok && rW.code === '42501', '42501', rW.ok ? 'ACCEPTED' : rW.code);
  // ---- reversal
  let obA = await sobl(S);
  const rvS = await rpc(S, 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: r1.data.legacy_debt_id, p_reason: 'xato' });
  T('LD-24', 'seller cannot reverse a legacy debt', !rvS.ok && rvS.code === '42501', '42501', rvS.ok ? 'ACCEPTED' : rvS.code);
  const rvBlk = await rpc(M, 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: r1.data.legacy_debt_id, p_reason: 'xato kiritilgan' });
  T('LD-24b', 'reversing an entry that has a newer reconciliation on top is refused (would invent an advance)', !rvBlk.ok && /keyingi qayta solishtirish/.test(rvBlk.error), 'refused', rvBlk.ok ? 'ACCEPTED' : rvBlk.error.slice(0, 70));
  const recs = (await pool.query("select id from client_legacy_debts where customer_id=$1 and entry_type='reconciliation_adjustment' and status<>'reversed' order by created_at desc", [cS])).rows;
  for (const x of recs) { const rr = await rpc(M, 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: x.id, p_reason: 'qayta solishtirish bekor' }); if (!rr.ok) console.log('rec reverse', rr.error); }
  T('LD-24c', 'after reversing the reconciliations (newest first) the customer is back at 206.83 g', N((await acc(cS)).d) === 206.83, 206.83, N((await acc(cS)).d));
  obA = await sobl(S);
  const rvM = await rpc(M, 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: r1.data.legacy_debt_id, p_reason: 'xato kiritilgan' });
  const obB = await sobl(S);
  T('LD-25', 'manager reverses the 206.83 g entry; customer back to 0 debt, 0 advance', rvM.ok && N((await acc(cS)).d) === 0 && N((await acc(cS)).a) === 0, { debt: 0, adv: 0 }, rvM.ok ? await acc(cS) : rvM.error);
  T('LD-26', "seller obligation recalculated after the reversal (-206.83 g; before 076 it stayed)", Math.abs(N(obA.l) - N(obB.l) - 206.83) < 1e-9, -206.83, N(obB.l) - N(obA.l));
  const rv2 = await rpc(M, 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: r1.data.legacy_debt_id, p_reason: 'yana' });
  T('LD-27', 'second reversal refused', !rv2.ok && /allaqachon/.test(rv2.error), 'refused', rv2.ok ? 'ACCEPTED' : rv2.error.slice(0, 60));
  // ---- independent model of the seller obligation and the ledger cache
  const model = await q1(`select coalesce(sum(delta_585_g) filter (where balance_type='debt' and status<>'reversed'),0)::numeric m from client_legacy_debts where seller_id=$1`, [S]);
  T('LD-28', 'seller legacy obligation = independent sum of active debt entries', Math.abs(N((await sobl(S)).l) - N(model.m)) < 1e-9, N(model.m), N((await sobl(S)).l));
  const ledg = await rpc(M, 'rpc_get_unified_customer_ledger', { p_customer_id: cP, p_seller_id: null });
  const it = ledg.ok && ledg.data.items[0];
  T('LD-29', 'customer ledger recomputation agrees with the stored balance (15.5 g)', ledg.ok && N(it.net_debt_g) === 15.5 && N((await acc(cP)).d) === 15.5, 15.5, ledg.ok ? { net: it.net_debt_g, stored: N((await acc(cP)).d) } : ledg.error);
  const after = await snap();
  T('LD-30', 'whole run: stock, vault, factory obligation, sales, receipts of the org unchanged', JSON.stringify(before) === JSON.stringify(after), before, after);
  const sel = await as(S, "select count(*)::int r from client_legacy_debts where customer_id = '" + cS2 + "'");
  T('LD-31', "seller cannot SELECT another seller's customer legacy rows (RLS)", sel.ok && sel.data === 0, 0, sel.ok ? sel.data : sel.error);
  const dir = await as(S, "insert into client_legacy_debts (organization_id, customer_id, seller_id, balance_type, amount_585_g, as_of_date) values ('" + ORG + "', '" + cS + "', '" + S + "', 'debt', 1, current_date) returning 1 r");
  T('LD-32', 'direct INSERT into client_legacy_debts by a seller is refused (RPC only)', !dir.ok, 'refused', dir.ok ? 'ACCEPTED' : dir.error.slice(0, 60));
  const pass = R.filter((x) => x.ok).length;
  console.log(`TOTAL ${pass}/${R.length}`);
  require('fs').writeFileSync(process.env.OUT || '/dev/null', JSON.stringify(R, null, 2));
  await pool.end(); process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
