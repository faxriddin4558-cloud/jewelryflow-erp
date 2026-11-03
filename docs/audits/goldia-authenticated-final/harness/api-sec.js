// REAL Supabase Auth + REAL PostgREST/RLS on the isolated test project. Tokens stay in memory.
const fs = require('fs'); const { URL, ANON } = require('./guard');
const creds = JSON.parse(fs.readFileSync('/opt/goldia-audit/real/creds.json'));
const out = []; const R = (id, title, ok, d) => { out.push({ id, title, ok: ok ? 'PASS' : 'FAIL', detail: d }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | ' + JSON.stringify(d).slice(0, 220)); };
const login = async (k) => { const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email: creds[k].email, password: creds[k].password }) }); const j = await r.json(); return j.access_token; };
const H = (t) => ({ apikey: ANON, Authorization: `Bearer ${t || ANON}`, 'content-type': 'application/json' });
const get = async (t, path) => { const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H(t) }); const j = await r.json().catch(() => null); return { s: r.status, n: Array.isArray(j) ? j.length : null, j }; };
const rpc = async (t, f, a = {}) => { const r = await fetch(`${URL}/rest/v1/rpc/${f}`, { method: 'POST', headers: H(t), body: JSON.stringify(a) }); const j = await r.json().catch(() => null); return { s: r.status, ok: r.ok, code: j && j.code, msg: j && (j.message || '').slice(0, 70), j }; };
(async () => {
  const T = {}; for (const k of Object.keys(creds)) { T[k] = await login(k); }
  R('AUTH', 'real password grant for 5 identities', Object.values(T).every(Boolean), Object.fromEntries(Object.entries(T).map(([k, v]) => [k, !!v])));
  const ids = Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, v.id]));
  // schema level of the test project
  const lvl = { has070: (await rpc(T.sellera, 'rpc_get_financial_reconciliation_summary')).s !== 200, has072: (await rpc(T.sellera, 'rpc_get_seller_rates')).s !== 404 };
  R('SCHEMA', 'test project schema level (070 seller-summary guard / 072 rates)', true, lvl);
  // seller isolation on tables
  for (const t of ['customers', 'jewelry_sales', 'gold_settlements', 'client_gold_accounts', 'seller_gold_accounts', 'consignment_pieces', 'seller_consignments', 'client_legacy_debts', 'employees']) {
    const a = await get(T.sellera, `${t}?select=*`); const foreign = Array.isArray(a.j) ? a.j.filter(x => (x.seller_id && x.seller_id !== ids.sellera) || (t === 'employees' && x.id !== ids.sellera)).length : null;
    R('RLS-' + t, `seller A sees no other seller's ${t}`, a.s === 200 ? foreign === 0 : a.s >= 400, { status: a.s, rows: a.n, foreign });
  }
  for (const t of ['manager_vault_account', 'factory_receipts', 'financial_transactions', 'gold_purchases', 'refining_batches', 'factory_gold_handovers', 'accounting_baselines', 'audit_logs', 'company_rate_differences']) {
    const a = await get(T.sellera, `${t}?select=*`); R('CO-' + t, `seller sees no company ${t}`, a.s >= 400 || a.n === 0, { status: a.s, rows: a.n });
  }
  for (const f of ['rpc_get_accounting_profit_summary', 'rpc_get_financial_reconciliation_summary', 'rpc_get_three_tier_ledger_summary', 'rpc_get_company_rate_difference_report', 'rpc_get_director_sales_overview']) {
    const r = await rpc(T.sellera, f); R('CORPC-' + f, `seller denied ${f}`, !r.ok, { status: r.s, code: r.code });
  }
  const r1 = await rpc(T.sellera, 'rpc_get_seller_available_pieces', { p_seller_id: ids.sellerb }); R('X1', 'seller A cannot list seller B pieces', !r1.ok, { status: r1.s, code: r1.code });
  const r2 = await rpc(T.sellera, 'rpc_get_daily_sales_ledger', { p_seller_id: ids.sellerb }); R('X2', 'seller A cannot read seller B ledger', !r2.ok, { status: r2.s, code: r2.code });
  const r3 = await rpc(T.sellera, 'rpc_record_seller_to_manager_settlement', { p_seller_id: ids.sellerb, p_cash_paid_amount: 1 }); R('X3', 'seller A cannot hand over seller B till', !r3.ok, { status: r3.s, msg: r3.msg });
  const r4 = await rpc(T.sellera, 'rpc_record_factory_receipt', { p_product_name: 'x', p_original_physical_g: 1 }); R('X4', 'seller cannot record factory receipt', !r4.ok, { status: r4.s, code: r4.code });
  const r5 = await rpc(T.sellera, 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'x' }); R('X5', 'seller cannot reset', !r5.ok, { status: r5.s, code: r5.code });
  const w1 = await fetch(`${URL}/rest/v1/employees?id=eq.${ids.sellera}`, { method: 'PATCH', headers: { ...H(T.sellera), Prefer: 'return=representation' }, body: JSON.stringify({ role: 'admin' }) }); R('X6', 'seller cannot escalate own role', !w1.ok || (await w1.json()).length === 0, { status: w1.status });
  const w2 = await fetch(`${URL}/rest/v1/employees?id=eq.${ids.sellera}`, { method: 'PATCH', headers: { ...H(T.sellera), Prefer: 'return=representation' }, body: JSON.stringify({ organization_id: '00000000-0000-0000-0000-0000000000b2' }) }); R('X7', 'seller cannot move to another organization (070 F9)', !w2.ok, { status: w2.status });
  const w3 = await fetch(`${URL}/rest/v1/jewelry_sales`, { method: 'PATCH', headers: { ...H(T.sellera), Prefer: 'return=representation' }, body: JSON.stringify({ remaining_gold_grams: 0 }) }); R('X8', 'seller cannot write jewelry_sales directly', !w3.ok || (await w3.json()).length === 0, { status: w3.status });
  // anonymous
  const an = await rpc(null, 'rpc_get_accounting_profit_summary'); R('AN1', 'anon denied profit summary', !an.ok, { status: an.s });
  const ac = await get(null, 'customers?select=*'); R('AN2', 'anon sees no customers', ac.n === 0 || ac.s >= 400, { status: ac.s, rows: ac.n });
  // management keeps permissions
  const d1 = await rpc(T.director, 'rpc_get_accounting_profit_summary'); R('M1', 'director can read profit summary', d1.ok, { status: d1.s, st: d1.j && d1.j.status });
  const m1 = await rpc(T.manager, 'rpc_get_financial_reconciliation_summary'); R('M2', 'manager can read reconciliation', m1.ok, { status: m1.s });
  const m2 = await get(T.manager, 'manager_vault_account?select=organization_id'); R('M3', 'manager reads vault', m2.n === 1, { status: m2.s, rows: m2.n });
  const pc = await rpc(T.director, 'rpc_get_accounting_profit_summary', { p_org_id: '00000000-0000-0000-0000-0000000000b2' }); R('M4', 'director cannot request another org (070 F1)', !pc.ok, { status: pc.s, msg: pc.msg });
  fs.writeFileSync('/opt/goldia-audit/real/api-security-results.json', JSON.stringify(out, null, 1));
  console.log('TOTAL', out.length, 'PASS', out.filter(x => x.ok === 'PASS').length);
})();
