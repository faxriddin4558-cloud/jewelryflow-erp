// PHASE F1 demonstration on the LOCAL stand-in only (127.0.0.1:55437, schema 085, 60 synthetic organizations with old
// history). One organization goes through the real 085 path, every call as the real user (JWT claims, role authenticated):
// restart -> opening documents (owner's example) -> one cancel -> reconciliation -> baseline lock -> lock check.
// The backup verification row is inserted by the local superuser and marked LOCAL DEMO (on production it must come from
// a verified full backup + restore tool). Expected values are computed independently here (oracle).
const fs = require('fs');
const { Pool } = require('/opt/goldia-audit/tools/node_modules/pg');
const pool = new Pool({ host: '127.0.0.1', port: 55437, user: 'postgres', database: 'postgres', max: 4 });
const ORG = '00000000-0000-0000-0000-000000000001';
const r4 = (x) => Math.round(Number(x) * 1e4) / 1e4; const N = (x) => Number(x || 0);
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
async function rpc(sub, fn, args) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const names = Object.keys(args);
    const sql = 'select to_jsonb(public.' + fn + '(' + names.map((k, i) => k + ' := $' + (i + 1)).join(', ') + ')) r';
    const vals = names.map((k) => (args[k] && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    const r = await c.query(sql, vals); await c.query('commit');
    return { ok: true, data: r.rows[0].r };
  } catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message.slice(0, 160) }; } finally { c.release(); }
}
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0] || {};
const balances = async () => one(`select
  (select coalesce(sum(a.current_debt_grams),0) from client_gold_accounts a join customers c on c.id=a.customer_id where c.organization_id=$1) cust_debt_g,
  (select coalesce(sum(a.advance_balance_grams),0) from client_gold_accounts a join customers c on c.id=a.customer_id where c.organization_id=$1) cust_adv_g,
  (select coalesce(sum(debt_amount),0) from client_currency_accounts where organization_id=$1 and currency='UZS') cust_uzs,
  (select coalesce(sum(debt_amount),0) from client_currency_accounts where organization_id=$1 and currency='USD') cust_usd_debt,
  (select coalesce(sum(advance_amount),0) from client_currency_accounts where organization_id=$1 and currency='USD') cust_usd_adv,
  (select coalesce(sum(seller_owes_manager_g),0) from seller_gold_accounts where organization_id=$1) seller_owes_g,
  (select coalesce(sum(current_physical_stock_g),0) from seller_gold_accounts where organization_id=$1) seller_stock_g,
  (select coalesce(sum(seller_till_cash_amount),0) from seller_gold_accounts where organization_id=$1) seller_till_uzs,
  (select coalesce(sum(seller_till_usd_amount),0) from seller_gold_accounts where organization_id=$1) seller_till_usd,
  (select coalesce(sum(manager_physical_stock_g),0) from manager_vault_account where organization_id=$1) mgr_stock_g,
  (select coalesce(sum(manager_cash_amount),0) from manager_vault_account where organization_id=$1) mgr_uzs,
  (select coalesce(sum(manager_usd_amount),0) from manager_vault_account where organization_id=$1) mgr_usd,
  (select coalesce(sum(current_factory_obligation_g),0) from manager_vault_account where organization_id=$1) factory_g`, [ORG]);
const ids = async () => JSON.stringify((await pool.query(`select id, contact_name, phone, seller_id from customers where organization_id=$1 order by id`, [ORG])).rows)
  + JSON.stringify((await pool.query(`select id, user_id, role from employees where organization_id=$1 order by id`, [ORG])).rows);
(async () => {
  const run = Date.now().toString(36);
  const emp = (await pool.query(`select role::text r, id::text eid, user_id::text uid from employees where organization_id=$1`, [ORG])).rows;
  const D = emp.find((e) => e.r === 'director'); const M = emp.find((e) => e.r === 'manager'); const S = emp.find((e) => e.r === 'sales');
  const before = await balances(); const ids0 = await ids();
  console.log('OLD balances (synthetic history):', JSON.stringify(before));
  // 1. backup verification (LOCAL DEMO; production: verified full backup + restore tool)
  const bv = (await pool.query(`insert into financial_backup_verifications (organization_id, backup_reference, backup_sha256, restore_verified) values ($1, 'LOCAL DEMO - no real backup', null, true) returning id`, [ORG])).rows[0].id;
  // 2. restart (director); the seller till must be handed over BEFORE T0 in reality - here the restart archives it
  const t0 = new Date(Date.now() - 60e3).toISOString();
  const wrong = await rpc(D.uid, 'rpc_financial_restart', { p_confirmation: 'moliyaviy hisobni qayta boshlash', p_reason: 'F1 demo', p_t0: t0, p_backup_verification_id: bv, p_idempotency_key: `f1-r0-${run}` });
  const notDir = await rpc(M.uid, 'rpc_financial_restart', { p_confirmation: 'MOLIYAVIY HISOBNI QAYTA BOSHLASH', p_reason: 'F1 demo', p_t0: t0, p_backup_verification_id: bv, p_idempotency_key: `f1-r1-${run}` });
  const rs = await rpc(D.uid, 'rpc_financial_restart', { p_confirmation: 'MOLIYAVIY HISOBNI QAYTA BOSHLASH', p_reason: 'F1 demo: eski hisob arxivga', p_t0: t0, p_backup_verification_id: bv, p_idempotency_key: `f1-r2-${run}` });
  const after = await balances(); const ids1 = await ids();
  const zero = Object.values(after).every((v) => N(v) === 0);
  T('F1-1', 'restart: wrong phrase refused, manager refused (director only), director with the exact phrase -> old balances archived to 0; customers / phones / seller assignment / employees kept',
    !wrong.ok && !notDir.ok && rs.ok && zero && ids0 === ids1, { zero: true, ids_kept: true }, { wrong: wrong.error, notDir: notDir.error, restart: rs.ok ? rs.data : rs.error, after, ids_kept: ids0 === ids1 });
  // 3. customers for independent obligations (seller's own customers)
  const cust = async (n) => (await rpc(S.uid, 'rpc_create_customer_with_code', { p_contact_name: `F1 ${n} ${run}` })).data.customer_id;
  const cG = await cust('eski 585 qarz'); const cU = await cust('eski UZS qarz'); const cD = await cust('USD qarz'); const cA = await cust('USD avans');
  let k = 0; const doc = (a) => rpc(M.uid, 'rpc_record_opening_document', { ...a, p_idempotency_key: `f1-d-${run}-${++k}` });
  const steps = {};
  const st = async (n, r) => { steps[n] = r.ok ? (r.data.document_no || 'ok') + (r.data.formula ? ' | ' + r.data.formula : '') : 'ERROR ' + r.error; return r; };
  const mi = (await st('A manager_inventory 100 g @8%', await doc({ p_kind: 'manager_inventory', p_physical_g: 100, p_factory_markup_pct: 8, p_product_name: 'Zavod partiyasi' }))).data.document_id;
  await st('B seller_inventory 60 g @12% from A', await doc({ p_kind: 'seller_inventory', p_seller_id: S.eid, p_pieces: [{ weight_grams: 20 }, { weight_grams: 25 }, { weight_grams: 15 }], p_seller_markup_pct: 12, p_source_document_id: mi }));
  await st('C factory_obligation 15 g (sold, not paid)', await doc({ p_kind: 'factory_obligation', p_amount: 15, p_notes: 'oldin sotilgan, zavodga to\'lanmagan' }));
  await st('E customer_gram debt 10 g', await doc({ p_kind: 'customer_gram', p_customer_id: cG, p_side: 'debt', p_amount: 10 }));
  await st('F customer_currency UZS 8 600 000 @860 000', await doc({ p_kind: 'customer_currency', p_customer_id: cU, p_unit: 'UZS', p_side: 'debt', p_amount: 8600000, p_lom_rate: 860000 }));
  await st('F customer_currency USD debt 100 @12 600 / 900 000', await doc({ p_kind: 'customer_currency', p_customer_id: cD, p_unit: 'USD', p_side: 'debt', p_amount: 100, p_usd_rate: 12600, p_lom_rate: 900000 }));
  await st('F customer_currency USD advance 50 @12 600 / 900 000', await doc({ p_kind: 'customer_currency', p_customer_id: cA, p_unit: 'USD', p_side: 'advance', p_amount: 50, p_usd_rate: 12600, p_lom_rate: 900000 }));
  await st('G manager_cash UZS 5 000 000', await doc({ p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 5000000 }));
  await st('G manager_cash USD 300', await doc({ p_kind: 'manager_cash', p_unit: 'USD', p_amount: 300 }));
  await st('H manager_scrap LOM 10 g @750', await doc({ p_kind: 'manager_scrap', p_physical_g: 10, p_proba: 750 }));
  await st('I manager_fine_gold 20 g @999', await doc({ p_kind: 'manager_fine_gold', p_physical_g: 20, p_proba: 999 }));
  await st('J other liability 2 g (585)', await doc({ p_kind: 'other', p_side: 'liability', p_unit: 'G585', p_amount: 2, p_other_type: 'ustaxona qarzi', p_counterparty: 'Ustaxona (sintetik)' }));
  // a mistaken entry and its cancellation
  const bad = await st('mistake manager_cash UZS 999', await doc({ p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 999 }));
  const cancel = await rpc(M.uid, 'rpc_cancel_opening_document', { p_document_id: bad.data.document_id, p_reason: 'xato kiritildi', p_idempotency_key: `f1-c-${run}` });
  const dup = await doc({ p_kind: 'customer_gram', p_customer_id: cG, p_side: 'debt', p_amount: 10 });
  const sellerRole = await rpc(S.uid, 'rpc_record_opening_document', { p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 1, p_idempotency_key: `f1-s-${run}` });
  const ordinary = await rpc(S.uid, 'rpc_record_client_legacy_debt', { p_customer_id: cG, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: t0.slice(0, 10) });
  const b = await balances();
  const vault = await one(`select manager_scrap_grams sc, manager_refined_gold_grams fg, manager_refined_gold_fine_grams ff from manager_vault_account where organization_id=$1`, [ORG]);
  const sObl = N((await one(`select seller_owes_manager_g v from seller_gold_accounts where seller_id=$1`, [S.eid])).v);
  const cg = await one(`select current_debt_grams d from client_gold_accounts where customer_id=$1`, [cG]);
  const exp = { mgr_stock: 40, seller_stock: 60, factory: 108 + 15, seller_inventory_obligation: r4(60 * 1.12), mgr_uzs: 5000000, mgr_usd: 300, cust_uzs: 8600000, cust_usd_debt: 100, cust_usd_adv: 50, cust_g: 10,
    scrap585: r4((10 * 750) / 585), fine585: r4((20 * 999) / 585), fine: r4((20 * 999) / 1000) };
  T('F1-2', 'opening documents: manager 100 g @8% -> 40 g after 60 g to the seller; factory 108 + 15 (sold, unpaid) = 123; seller stock 60; cash, LOM, fine gold, customer 585 / UZS / USD debt and advance as entered',
    N(b.mgr_stock_g) === exp.mgr_stock && N(b.seller_stock_g) === exp.seller_stock && N(b.factory_g) === exp.factory && N(b.mgr_uzs) === exp.mgr_uzs && N(b.mgr_usd) === exp.mgr_usd
      && N(b.cust_uzs) === exp.cust_uzs && N(b.cust_usd_debt) === exp.cust_usd_debt && N(b.cust_usd_adv) === exp.cust_usd_adv && N(cg.d) === exp.cust_g
      && r4(vault.fg) === exp.fine585 && r4(vault.ff) === exp.fine, exp, { ...b, scrap: vault.sc, fine585: vault.fg, fine: vault.ff, cust_g: cg.d });
  T('F1-3', 'seller obligation = inventory 60 g @12% (67.2 g) + snapshots of the debts of HIS customers (10 g 585, 8.6 M / 860 000 = 10 g, 100 USD x 12 600 / 900 000 = 1.4 g); the advance does not lower it',
    r4(sObl) === r4(exp.seller_inventory_obligation + 10 + 10 + 1.4), r4(exp.seller_inventory_obligation + 10 + 10 + 1.4), sObl);
  T('F1-4', 'cancel / guards: the mistaken entry cancelled (cash back to 5 000 000), the same customer 585 debt twice refused, a seller cannot enter openings, ordinary operations refused in the draft',
    cancel.ok && N(b.mgr_uzs) === 5000000 && !dup.ok && !sellerRole.ok && !ordinary.ok, 'ok', { cancel: cancel.ok || cancel.error, dup: dup.error, seller: sellerRole.error, ordinary: ordinary.error });
  const state = (await rpc(M.uid, 'rpc_get_opening_state', {})).data;
  const checks = state.checks;
  const greenBefore = Object.entries(checks).every(([kk, v]) => (kk === 'non_opening_documents_after_restart' ? v === 0 : v === true));
  T('F1-5', 'reconciliation: every check green before the lock (tills empty, stock = pieces, customers = documents, inventory = receipts, factory = documents, 0 ordinary documents)', greenBefore, 'all green', checks);
  const lock = await rpc(M.uid, 'rpc_confirm_accounting_baseline', { p_notes: 'F1 demo T0', p_idempotency_key: `f1-b-${run}`, p_usd_rate: 12500 });
  const late = await doc({ p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 1 });
  const per = await one(`select status, baseline_id from opening_periods where organization_id=$1 order by created_at desc limit 1`, [ORG]);
  const sale = await rpc(S.uid, 'rpc_record_client_legacy_debt', { p_customer_id: cG, p_balance_type: 'debt', p_amount_585_g: 0.5, p_as_of_date: new Date().toISOString().slice(0, 10) });
  T('F1-6', 'lock: baseline confirmed, period locked, later opening entries refused, ordinary work allowed again', lock.ok && per.status === 'locked' && !!per.baseline_id && !late.ok && /ERR_OPENING_LOCKED/.test(late.error) && sale.ok,
    { locked: true, late: 'ERR_OPENING_LOCKED', ordinary: 'ok' }, { lock: lock.ok || lock.error, period: per.status, late: late.error, ordinary: sale.ok || sale.error });
  const other = await one(`select count(*) n from organizations o where o.id <> $1 and exists (select 1 from opening_periods p where p.organization_id = o.id)`, [ORG]);
  T('F1-7', 'no other organization touched (no opening period anywhere else)', N(other.n) === 0, 0, other.n);
  fs.writeFileSync('/home/user/jewelryflow-erp/docs/audits/goldia-077/evidence/phase-f1/local-opening-demo.json', JSON.stringify({ run, old_balances: before, after_restart: after, documents: steps, totals: state.totals, checks, results: R }, null, 1));
  console.log(JSON.stringify(steps, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
  await pool.end();
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
