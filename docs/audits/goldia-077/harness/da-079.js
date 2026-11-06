// 079 (owner decisions D-A1 / D-A2) with real GoTrue logins through PostgREST + the real frontend:
//   DA1-*  a new sale to an archived customer is refused by the server on every sale path (gram, exact UZS / USD,
//          barcode piece; seller and manager), nothing moves; the old debt stays collectible (gram + USD payments,
//          reversal); the archived view shows the sale button disabled; after restore the sale works
//   DA2-*  a seller cannot assign an unassigned customer to himself or move his own customer (direct PATCH);
//          selling to an unassigned customer still works and does not assign it; director = manager assign
//   GA_TARGET=local (127.0.0.1:3300) | staging (synthetic organization only, after 079 is applied)
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const EV = path.join(__dirname, '..', 'evidence', TARGET === 'staging' ? 'staging-079' : 'local-079'); fs.mkdirSync(EV, { recursive: true });
const N = Number; const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const R = []; const OPS = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act, at: new Date().toISOString() }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
const op = (kind, r) => { OPS.push({ at: new Date().toISOString(), kind, ok: r.ok, error: r.ok ? undefined : (r.error || '').slice(0, 160), data: r.ok ? r.data : undefined }); return r; };
const stock = async (sid) => r4((await L.sel(`seller_gold_accounts?seller_id=eq.${sid}&select=s:current_physical_stock_g`))[0].s);
const gold = async (c) => { const a = (await L.sel(`client_gold_accounts?customer_id=eq.${c}&select=d:current_debt_grams`))[0]; return a ? r4(a.d) : 0; };
const usd = async (c) => { const a = (await L.sel(`client_currency_accounts?customer_id=eq.${c}&currency=eq.USD&select=d:debt_amount`))[0]; return a ? N(a.d) : 0; };
const nSales = async (c) => (await L.sel(`jewelry_sales?customer_id=eq.${c}&select=id`)).length;
const owner = async (c) => (await L.sel(`customers?id=eq.${c}&select=seller_id`))[0].seller_id;
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday();
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `DA79 ${run}`, p_original_physical_g: 30, p_factory_markup_pct: 8 });
  const cs = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.data.receipt_id, p_pieces: [{ weight_grams: 5 }, { weight_grams: 5 }, { weight_grams: 5 }, { weight_grams: 5 }, { weight_grams: 5 }, { weight_grams: 5 }] });
  if (!cs.ok) throw new Error('consignment ' + cs.error);
  await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12500, p_reason: 'da79' });
  const nA = `DA79 Arxiv ${run}`;
  const A = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nA })).data.customer_id;
  const F = (await L.svc('POST', 'rest/v1/customers', { organization_id: L.ORG, contact_name: `DA79 Free ${run}`, customer_code: `DA79F-${run}`.slice(0, 16), seller_id: null }, { Prefer: 'return=representation' })).data[0].id;
  const F2 = (await L.svc('POST', 'rest/v1/customers', { organization_id: L.ORG, contact_name: `DA79 Free2 ${run}`, customer_code: `DA79G-${run}`.slice(0, 16), seller_id: null }, { Prefer: 'return=representation' })).data[0].id;
  op('gram sale 5 g', await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: A, p_weight_grams: 5, p_client_markup_pct: 10, p_idempotency_key: `da79-w1-${run}` }));
  op('USD sale $500', await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: A, p_currency: 'USD', p_amount: 500, p_weight_grams: 2, p_idempotency_key: `da79-c1-${run}` }));
  op('archive', await L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: A, p_archive: true }));

  // ---------------- D-A1 ----------------
  const s0 = await stock(C.sellera.id), g0 = await gold(A), u0 = await usd(A), c0 = await nSales(A);
  const piece = (await L.sel(`consignment_pieces?seller_id=eq.${C.sellera.id}&status=eq.held_by_seller&select=id&limit=1`))[0].id;
  const attempts = {
    gram: await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: A, p_weight_grams: 1, p_client_markup_pct: 10, p_idempotency_key: `da79-x1-${run}` }),
    uzs: await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: A, p_currency: 'UZS', p_amount: 1000000, p_weight_grams: 1, p_idempotency_key: `da79-x2-${run}` }),
    usd: await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: A, p_currency: 'USD', p_amount: 100, p_weight_grams: 1, p_idempotency_key: `da79-x3-${run}` }),
    barcode: await L.rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: A, p_piece_id: piece, p_client_markup_pct: 10, p_idempotency_key: `da79-x4-${run}` }),
    manager: await L.rpc('manager', 'rpc_record_weight_sale', { p_customer_id: A, p_seller_id: C.sellera.id, p_weight_grams: 1, p_client_markup_pct: 10, p_idempotency_key: `da79-x5-${run}` }),
    director: await L.rpc('director', 'rpc_record_currency_sale', { p_customer_id: A, p_seller_id: C.sellera.id, p_currency: 'USD', p_amount: 50, p_weight_grams: 1, p_idempotency_key: `da79-x6-${run}` }),
  };
  OPS.push({ kind: 'sales to archived customer', results: Object.fromEntries(Object.entries(attempts).map(([k, r]) => [k, r.ok ? 'ACCEPTED' : (r.error || '').slice(0, 90)])) });
  const refusedAll = Object.values(attempts).every((r) => !r.ok && /ERR_CUSTOMER_ARCHIVED/.test(r.error || ''));
  T('DA1-01', 'archived customer: gram, UZS, USD, barcode-piece sale (seller) and manager / director sales refused with ERR_CUSTOMER_ARCHIVED', refusedAll, 'all refused', Object.fromEntries(Object.entries(attempts).map(([k, r]) => [k, r.ok ? 'ACCEPTED' : (r.error || '').slice(0, 40)])));
  T('DA1-02', 'nothing moved: seller stock, 585 debt, USD debt, number of sales', (await stock(C.sellera.id)) === s0 && (await gold(A)) === g0 && (await usd(A)) === u0 && (await nSales(A)) === c0, { s0, g0, u0, c0 }, { s: await stock(C.sellera.id), g: await gold(A), u: await usd(A), c: await nSales(A) });
  const pg = op('gram payment', await L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: A, p_cash_amount: 900000, p_rate_per_gram: 900000 }));
  const pu = op('USD payment', await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: A, p_currency: 'USD', p_usd_amount: 200, p_idempotency_key: `da79-p1-${run}` }));
  T('DA1-03', 'old debt still collectible while archived: 900 000 so\'m -> -1 g; $200 -> USD debt 300', pg.ok && pu.ok && (await gold(A)) === r4(g0 - 1) && (await usd(A)) === 300, { g: r4(g0 - 1), usd: 300 }, { g: await gold(A), usd: await usd(A), e: [pg.error, pu.error] });
  const sid = (await L.sel(`client_currency_settlements?customer_id=eq.${A}&idempotency_key=eq.da79-p1-${run}&select=id`))[0].id;
  const rv = op('reverse USD payment', await L.rpc('manager', 'rpc_reverse_client_currency_settlement', { p_settlement_id: sid, p_reason: 'DA79' }));
  T('DA1-04', 'manager reverses that payment of the archived customer -> USD debt 500', rv.ok && (await usd(A)) === 500, 500, { ok: rv.ok, err: rv.error, usd: await usd(A) });
  // UI: archived view, sale button disabled
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  try {
    const c = C.sellera; const ctx = await br.newContext({ viewport: { width: 1366, height: 860 } }); const p = await ctx.newPage(); const bad = [];
    p.on('response', (r) => { if (/supabase\.co|127\.0\.0\.1:54321/.test(r.url()) && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split('/rest/')[1]); });
    p.on('dialog', (d) => d.accept());
    await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
    await p.goto(BASE + '/sales/app/customers', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
    await p.locator('[data-testid="toggle-archived"]').first().click(); await p.waitForTimeout(1000);
    const row = p.locator(`tr:has-text("${nA}")`);
    const saleBtn = row.locator('[data-testid="open-sale"]'); const payBtn = row.locator('[data-testid="open-currency-payment"]');
    const disabled = await saleBtn.isDisabled().catch(() => null); const payEnabled = await payBtn.isEnabled().catch(() => null);
    await p.screenshot({ path: path.join(EV, 'da1-archived-view.png') });
    T('DA1-05', 'UI: in "Arxivlangan mijozlar" the sale button is disabled, the payment button stays enabled; no API errors', disabled === true && payEnabled === true && bad.length === 0, { saleDisabled: true, payEnabled: true }, { disabled, payEnabled, bad });
    await ctx.close();
  } finally { await br.close(); }
  op('restore', await L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: A, p_archive: false }));
  const after = op('sale after restore', await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: A, p_weight_grams: 1, p_client_markup_pct: 10, p_idempotency_key: `da79-w2-${run}` }));
  T('DA1-06', 'after restore the seller can sell again (1 g gram sale)', after.ok && (await nSales(A)) === c0 + 1, c0 + 1, { ok: after.ok, err: after.error, n: await nSales(A) });

  // ---------------- D-A2 ----------------
  const w = {
    claimFree: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${F}`, { seller_id: C.sellera.id }),
    moveOwn: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${A}`, { seller_id: C.sellerb.id }),
    unassignOwn: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${A}`, { seller_id: null }),
  };
  OPS.push({ kind: 'assignment attempts', results: Object.fromEntries(Object.entries(w).map(([k, r]) => [k, r.ok ? `ok rows=${Array.isArray(r.data) ? r.data.length : '-'}` : (r.error || '').slice(0, 90)])) });
  T('DA2-01', 'seller cannot claim an unassigned customer, move or unassign his own (direct PATCH refused); owners unchanged',
    !w.claimFree.ok && !w.moveOwn.ok && !w.unassignOwn.ok && (await owner(F)) === null && (await owner(A)) === C.sellera.id, 'refused', { claim: (w.claimFree.error || 'ok').slice(0, 70), move: (w.moveOwn.error || 'ok').slice(0, 50), unassign: (w.unassignOwn.error || 'ok').slice(0, 50) });
  const rename = await L.uwrite('sellera', 'PATCH', `customers?id=eq.${A}`, { contact_name: `${nA} yangi` });
  T('DA2-02', 'seller can still edit other fields of his own customer (name)', rename.ok && Array.isArray(rename.data) && rename.data.length === 1, 1, rename.ok ? rename.data.length : rename.error);
  const sf = op('sale to unassigned', await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: F, p_weight_grams: 1, p_client_markup_pct: 10, p_idempotency_key: `da79-w3-${run}` }));
  T('DA2-03', 'selling to an unassigned customer still works (076 rule) and does not assign it', sf.ok && (await owner(F)) === null, { ok: true, owner: null }, { ok: sf.ok, err: sf.error, owner: await owner(F) });
  const m1 = await L.uwrite('manager', 'PATCH', `customers?id=eq.${F2}`, { seller_id: C.sellerb.id }); const o1 = await owner(F2);
  const d1 = await L.uwrite('director', 'PATCH', `customers?id=eq.${F2}`, { seller_id: C.sellera.id }); const o2 = await owner(F2);
  T('DA2-04', 'manager and director (equal rights) assign / move a customer', m1.ok && o1 === C.sellerb.id && d1.ok && o2 === C.sellera.id, { manager: 'sellerb', director: 'sellera' }, { m: m1.ok || m1.error, d: d1.ok || d1.error, o1: o1 === C.sellerb.id, o2: o2 === C.sellera.id });

  fs.writeFileSync(path.join(EV, `${TARGET}-da-079.json`), JSON.stringify({ target: TARGET, run, ids: { A, F, F2 }, results: R, ops: OPS }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
