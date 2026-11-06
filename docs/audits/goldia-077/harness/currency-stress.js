// 077 UZS / USD sales stress with an INDEPENDENT model (real GoTrue JWTs through PostgREST).
// Model (computed here): customer currency net per currency, seller gram stock, seller till UZS / USD / scrap 585 g.
// Then the period report of today is checked against the model and against the identity opening + flows = closing.
//   GA_TARGET=local | staging   (synthetic audit organization only)
const fs = require('fs'); const path = require('path');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const C = L.creds(); const N = Number;
const r2 = (x) => Math.round(N(x) * 100) / 100; const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
let seed = Number(process.env.SEED || 7705); const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const R = []; const OPS = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 240)}`); return ok; };
const op = (e) => { OPS.push({ at: new Date().toISOString(), ...e }); return e; };
const SELLERS = ['sellerb', 'sellerc'];
const RATE = { sellerb: { lom: 905000, usd: 12650 }, sellerc: { lom: 897000, usd: 12550 } };
const M = { net: {}, stock: {}, uzs: {}, usd: {}, scrap: {} };
const key = (c, cur) => `${c}:${cur}`;
const addNet = (c, cur, v) => { M.net[key(c, cur)] = r2((M.net[key(c, cur)] || 0) + v); };
const credit = (cur, cash, usd, scrap585, rate) => cur === 'UZS' ? r2(cash + usd * rate.usd + scrap585 * rate.lom) : r2(usd + (cash > 0 || scrap585 > 0 ? (cash + scrap585 * rate.lom) / rate.usd : 0));
const s585 = (w, p) => r4(w * (p / 585));
(async () => {
  const run = Date.now().toString(36); const today = L.tashkentToday();
  const acc = async (t) => (await L.sel(`seller_gold_accounts?seller_id=eq.${C[t].id}&select=st:current_physical_stock_g,c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams`))[0] || { st: 0, c: 0, u: 0, s: 0 };
  const repBefore = await L.rpc('manager', 'rpc_get_period_report', { p_from: today, p_to: today });
  if (!repBefore.ok) throw new Error('report ' + repBefore.error);
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  for (const t of SELLERS) {
    await L.rpc(t, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: RATE[t].lom, p_usd_rate_uzs: RATE[t].usd, p_reason: 'cs ' + run });
    const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `CS ${run} ${t}`, p_original_physical_g: 200, p_factory_markup_pct: 8 });
    const ps = [...Array(30)].map((_, i) => ({ weight_grams: r4(3 + (i % 7) * 0.71), model_code: `CS-${run}-${t}-${i}` }));
    const cs = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C[t].id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.data.receipt_id, p_pieces: ps });
    op({ kind: 'inventory', seller: t, ok: cs.ok, id: cs.ok && cs.data.consignment_id, error: cs.error });
    const a = await acc(t); M.stock[t] = N(a.st); M.uzs[t] = N(a.c); M.usd[t] = N(a.u); M.scrap[t] = N(a.s);
  }
  const custs = {};
  for (const t of SELLERS) { custs[t] = []; for (let k = 0; k < 10; k++) { const r = await L.rpc(t, 'rpc_create_customer_with_code', { p_contact_name: `CS ${run} ${t} ${k} "Valyuta"` }); custs[t].push(r.data.customer_id); M.net[key(r.data.customer_id, 'UZS')] = 0; M.net[key(r.data.customer_id, 'USD')] = 0; } }
  // ---- 160 sales (120 currency, 40 gram)
  const sales = [];
  for (let k = 0; k < 160; k++) {
    const t = SELLERS[k % 2]; const c = pick(custs[t]); const w = r4(0.5 + rnd() * 3.2);
    if (w > M.stock[t] - 1) continue;
    if (k % 4 === 3) {
      const r = await L.rpc(t, 'rpc_record_weight_sale', { p_customer_id: c, p_weight_grams: w, p_client_markup_pct: 12, p_idempotency_key: `CS-G-${run}-${k}` });
      op({ kind: 'sale_gram', ok: r.ok, id: r.ok && r.data.sale_id, w, error: r.error });
      if (r.ok) M.stock[t] = r4(M.stock[t] - w);
      continue;
    }
    const cur = rnd() < 0.5 ? 'USD' : 'UZS';
    const amount = cur === 'USD' ? r2(50 + rnd() * 1500) : Math.round((500000 + rnd() * 20000000) / 1000) * 1000;
    const r = await L.rpc(t, 'rpc_record_currency_sale', { p_customer_id: c, p_currency: cur, p_amount: amount, p_weight_grams: w, p_idempotency_key: `CS-S-${run}-${k}` });
    op({ kind: 'sale_currency', ok: r.ok, id: r.ok && r.data.sale_id, cur, amount, w, expected_debt_delta: amount, actual: r.ok ? N(r.data.sale_amount) : null, error: r.error });
    if (r.ok) { addNet(c, cur, amount); M.stock[t] = r4(M.stock[t] - w); sales.push({ id: r.data.sale_id, t, c, cur, amount, w }); }
  }
  // ---- 150 currency payments
  const pays = [];
  for (let k = 0; k < 150; k++) {
    const t = SELLERS[k % 2]; const c = pick(custs[t]); const cur = rnd() < 0.5 ? 'USD' : 'UZS'; const rate = RATE[t];
    const kind = pick(['same', 'same', 'cross', 'scrap', 'mixed', 'overpay']);
    let cash = 0; let usd = 0; let scrap = 0; let proba = 585;
    if (kind === 'same') { if (cur === 'USD') usd = r2(10 + rnd() * 300); else cash = Math.round((100000 + rnd() * 3000000) / 1000) * 1000; }
    if (kind === 'cross') { if (cur === 'USD') cash = Math.round((100000 + rnd() * 2000000) / 1000) * 1000; else usd = r2(10 + rnd() * 200); }
    if (kind === 'scrap') { scrap = r4(0.3 + rnd() * 2); proba = pick([585, 750]); }
    if (kind === 'mixed') { cash = 300000; usd = 20; scrap = 0.5; proba = 750; }
    if (kind === 'overpay') { if (cur === 'USD') usd = r2(Math.max(0, M.net[key(c, cur)] || 0) + 25); else cash = Math.round((Math.max(0, M.net[key(c, cur)] || 0) + 250000) / 1000) * 1000; }
    if (cash <= 0 && usd <= 0 && scrap <= 0) continue;
    const r = await L.rpc(t, 'rpc_record_client_currency_settlement', { p_customer_id: c, p_currency: cur, p_cash_uzs: cash, p_usd_amount: usd, p_scrap_weight: scrap, p_scrap_proba: scrap > 0 ? proba : null, p_idempotency_key: `CS-P-${run}-${k}` });
    const sc = scrap > 0 ? s585(scrap, proba) : 0; const exp = credit(cur, cash, usd, sc, rate);
    op({ kind: 'payment_currency', pkind: kind, ok: r.ok, id: r.ok && r.data.settlement_id, cur, cash, usd, scrap, proba, expected_credit: exp, actual_credit: r.ok ? N(r.data.credited_amount) : null, error: r.error });
    if (r.ok) { addNet(c, cur, -N(r.data.credited_amount)); M.uzs[t] += cash; M.usd[t] = r2(M.usd[t] + usd); M.scrap[t] = r4(M.scrap[t] + sc); pays.push({ id: r.data.settlement_id, t, c, cur, credit: N(r.data.credited_amount), cash, usd, sc }); }
  }
  // ---- reversals (manager): 20 payments, 10 sales
  for (const p of pays.slice(-20)) {
    const r = await L.rpc('manager', 'rpc_reverse_client_currency_settlement', { p_settlement_id: p.id, p_reason: 'cs reversal' });
    op({ kind: 'reversal_payment', ok: r.ok, id: p.id, error: r.error });
    if (r.ok) { addNet(p.c, p.cur, p.credit); M.uzs[p.t] -= p.cash; M.usd[p.t] = r2(M.usd[p.t] - p.usd); M.scrap[p.t] = r4(M.scrap[p.t] - p.sc); }
  }
  for (const s of sales.slice(-10)) {
    const r = await L.rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: s.id, p_reason: 'cs reversal' });
    op({ kind: 'reversal_sale', ok: r.ok, id: s.id, error: r.error });
    if (r.ok) { addNet(s.c, s.cur, -s.amount); M.stock[s.t] = r4(M.stock[s.t] + s.w); }
  }
  // ---- attacks / duplicates / concurrency
  const A = (what, refused, extra = {}) => op({ kind: 'attack', what, expected: 'refused', refused, ...extra });
  const cb = custs.sellerb[0], cc = custs.sellerc[0];
  let r = await L.rpc('sellerb', 'rpc_record_currency_sale', { p_customer_id: cc, p_currency: 'USD', p_amount: 10, p_weight_grams: 0.5 }); A("seller sells for USD to another seller's customer", !r.ok, { error: r.error });
  r = await L.rpc('sellerb', 'rpc_record_client_currency_settlement', { p_customer_id: cc, p_currency: 'USD', p_usd_amount: 1 }); A("seller takes a payment for another seller's customer", !r.ok, { error: r.error });
  r = await L.rpc('sellerb', 'rpc_record_client_currency_settlement', { p_customer_id: cb, p_currency: 'USD', p_cash_uzs: 100000, p_usd_rate: 99999 }); A('seller sends another USD rate', !r.ok, { error: r.error });
  r = await L.rpc('sellerb', 'rpc_record_client_currency_settlement', { p_customer_id: cb, p_currency: 'USD', p_usd_amount: -5 }); A('negative payment', !r.ok, { error: r.error });
  r = await L.rpc('sellerb', 'rpc_record_currency_sale', { p_customer_id: cb, p_currency: 'USD', p_amount: 0, p_weight_grams: 1 }); A('zero price', !r.ok, { error: r.error });
  r = await L.rpc('sellerb', 'rpc_record_currency_sale', { p_customer_id: cb, p_currency: 'USD', p_amount: 10, p_weight_grams: r4(M.stock.sellerb + 1) }); A('currency sale above the stock', !r.ok, { error: r.error });
  r = await L.rpc('sellerb', 'rpc_reverse_client_currency_settlement', { p_settlement_id: pays[0].id, p_reason: 'x' }); A('seller reverses a currency payment', !r.ok, { error: r.error });
  r = await L.rpc('worker', 'rpc_record_currency_sale', { p_customer_id: cb, p_currency: 'USD', p_amount: 10, p_weight_grams: 0.5 }); A('worker sells', !r.ok, { error: r.error });
  const OTHER = TARGET === 'staging' ? 'directorB' : 'director56';
  if (C[OTHER]) { r = await L.rpc(OTHER, 'rpc_record_client_currency_settlement', { p_customer_id: cb, p_currency: 'USD', p_usd_amount: 1, p_usd_rate: 12000 }); A('another organization pays for our customer', !r.ok, { error: r.error });
    const vis = await L.usel(OTHER, `client_currency_accounts?customer_id=eq.${cb}&select=customer_id`); A('another organization reads our currency balances', vis.ok && vis.data.length === 0); }
  const vis2 = await L.usel('sellerb', `client_currency_accounts?customer_id=eq.${cc}&select=customer_id`); A("seller reads another seller's currency balances", vis2.ok && vis2.data.length === 0);
  const ins = await L.uwrite('sellerb', 'POST', 'client_currency_accounts', { customer_id: cb, currency: 'EUR', organization_id: L.ORG }); A('direct INSERT into client_currency_accounts', !ins.ok);
  const upd = await L.uwrite('sellerb', 'PATCH', `client_currency_accounts?customer_id=eq.${cb}`, { debt_amount: 0 }); A('direct UPDATE of a currency debt', !upd.ok || !upd.data || upd.data.length === 0);
  // 8 parallel identical sales with one key -> one sale
  { const c = custs.sellerb[1]; const args = { p_customer_id: c, p_currency: 'USD', p_amount: 77, p_weight_grams: 0.6, p_idempotency_key: `CS-PAR-${run}` };
    const par = await Promise.all([...Array(8)].map(() => L.rpc('sellerb', 'rpc_record_currency_sale', args)));
    const ids = new Set(par.filter((x) => x.ok).map((x) => x.data.sale_id));
    op({ kind: 'attack', what: '8 parallel currency sales with one key', expected: 'one sale', refused: ids.size === 1, distinct: ids.size });
    if (ids.size) { addNet(c, 'USD', 77 * ids.size); M.stock.sellerb = r4(M.stock.sellerb - 0.6 * ids.size); }
    T('CS-PAR-1', '8 parallel currency sales with one idempotency key -> exactly one', ids.size === 1, 1, ids.size); }
  { const c = custs.sellerc[1]; const args = { p_customer_id: c, p_currency: 'UZS', p_cash_uzs: 123000, p_idempotency_key: `CS-PP-${run}` };
    const par = await Promise.all([...Array(8)].map(() => L.rpc('sellerc', 'rpc_record_client_currency_settlement', args)));
    const ids = new Set(par.filter((x) => x.ok).map((x) => x.data.settlement_id));
    op({ kind: 'attack', what: '8 parallel currency payments with one key', expected: 'one payment', refused: ids.size === 1, distinct: ids.size });
    if (ids.size) { addNet(c, 'UZS', -123000 * ids.size); M.uzs.sellerc += 123000 * ids.size; }
    T('CS-PAR-2', '8 parallel currency payments with one idempotency key -> exactly one, till +123 000 once', ids.size === 1, 1, ids.size); }
  // ---- reconciliation
  let bad = [];
  for (const [k, v] of Object.entries(M.net)) {
    const [c, cur] = k.split(':');
    const a = (await L.sel(`client_currency_accounts?customer_id=eq.${c}&currency=eq.${cur}&select=d:debt_amount,a:advance_amount`))[0] || { d: 0, a: 0 };
    if (Math.abs(r2(N(a.d) - N(a.a)) - v) > 0.005 || (N(a.d) > 0 && N(a.a) > 0)) bad.push({ k, model: v, db: r2(N(a.d) - N(a.a)) });
  }
  T('CS-REC-01', `customer currency balances: model = database for ${Object.keys(M.net).length} customer/currency pairs`, bad.length === 0, 0, bad.slice(0, 3));
  for (const t of SELLERS) {
    const a = await acc(t);
    const pz = r4((await L.sel(`consignment_pieces?seller_id=eq.${C[t].id}&status=eq.held_by_seller&select=weight_grams`)).reduce((x, y) => x + N(y.weight_grams), 0));
    T(`CS-REC-ST-${t}`, `${t} gram stock: model = database = held pieces`, Math.abs(N(a.st) - M.stock[t]) < 0.00005 && Math.abs(pz - N(a.st)) < 0.00005, M.stock[t], { db: N(a.st), pieces: pz });
    T(`CS-REC-TILL-${t}`, `${t} till UZS / USD / scrap 585 g: model = database (each payment counted once)`, Math.abs(N(a.c) - M.uzs[t]) < 0.005 && Math.abs(N(a.u) - M.usd[t]) < 0.005 && Math.abs(N(a.s) - M.scrap[t]) < 0.00005, { uzs: M.uzs[t], usd: M.usd[t], scrap: M.scrap[t] }, { uzs: N(a.c), usd: N(a.u), scrap: N(a.s) });
  }
  const credBad = OPS.filter((o) => o.kind === 'payment_currency' && o.ok && Math.abs(o.actual_credit - o.expected_credit) > 0.005);
  T('CS-REC-02', 'every currency payment: credited amount = independent conversion at the seller\'s rate', credBad.length === 0, 0, credBad.slice(0, 3).map((o) => [o.pkind, o.cur, o.expected_credit, o.actual_credit]));
  const att = OPS.filter((o) => o.kind === 'attack'); const attBad = att.filter((o) => !o.refused);
  T('CS-REC-03', `attack / duplicate / permission cases behaved (${att.length})`, attBad.length === 0, 0, attBad.map((o) => o.what));
  // ---- period report of today vs model
  const rep = await L.rpc('manager', 'rpc_get_period_report', { p_from: today, p_to: today });
  const f = rep.data.flows; const b0 = repBefore.data.flows;
  const dflow = (k, field) => r2(N((f[k] || {})[field] || 0) - N((b0[k] || {})[field] || 0));
  const okSales = OPS.filter((o) => o.kind === 'sale_currency' && o.ok);
  const parSale = 77; // the single parallel sale
  const expUsd = r2(okSales.filter((o) => o.cur === 'USD').reduce((a, o) => a + o.amount, 0) + parSale);
  const expUzs = r2(okSales.filter((o) => o.cur === 'UZS').reduce((a, o) => a + o.amount, 0));
  T('CS-REP-01', 'period report (today): USD / UZS sale amounts grew by exactly the model sales', dflow('sale_usd', 'amount') === expUsd && dflow('sale_uzs', 'amount') === expUzs, { usd: expUsd, uzs: expUzs }, { usd: dflow('sale_usd', 'amount'), uzs: dflow('sale_uzs', 'amount') });
  const liveUsd = r2((await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&currency=eq.USD&select=debt_amount,advance_amount`)).reduce((a, x) => a + N(x.debt_amount) - N(x.advance_amount), 0));
  const liveUzs = r2((await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&currency=eq.UZS&select=debt_amount,advance_amount`)).reduce((a, x) => a + N(x.debt_amount) - N(x.advance_amount), 0));
  T('CS-REP-02', 'report closing currency debts = live organization balances', N(rep.data.closing.customer_debt_net_usd) === liveUsd && N(rep.data.closing.customer_debt_net_uzs) === liveUzs, { usd: liveUsd, uzs: liveUzs }, rep.data.closing);
  // exact sums: grams carry 4 decimals, money 2 - rounding each side to 2 decimals made a gram sum that lands on a .xx5
  // boundary in floating point fail by 0.01 (staging 079 audit, harness precision, not a report defect)
  const sumF = (fld) => Object.values(f).reduce((a, x) => a + N(x[fld] || 0), 0);
  const ident = [['customer_debt_net_usd', 'customer_usd_change'], ['customer_debt_net_uzs', 'customer_uzs_change'], ['seller_stock_physical_g', 'seller_stock_change_g'], ['manager_cash_uzs', 'manager_uzs_change'], ['customer_debt_net_g585', 'customer_g585_change']];
  const tol = (b) => (/_g$|_g585$/.test(b) ? 0.00005 : 0.005);
  const idBad = ident.filter(([b, fl]) => Math.abs(N(rep.data.opening[b]) + sumF(fl) - N(rep.data.closing[b])) > tol(b))
    .map(([b, fl]) => [b, fl, (N(rep.data.opening[b]) + sumF(fl) - N(rep.data.closing[b])).toFixed(6)]);
  T('CS-REP-03', 'identity: opening + sum of period flows = closing (currency, grams, stock, manager cash)', idBad.length === 0, 0, idBad);
  const und = Object.entries(rep.data.undocumented_opening).filter(([k, v]) => k !== 'first_document_date' && Math.abs(N(v)) > 0.005);
  T('CS-REP-04', 'INFO: balances not explained by documents in this organization (0 for a fully documented ledger)', true, 'info', und);
  fs.writeFileSync(path.join(__dirname, '..', 'evidence', `${TARGET}-currency-stress-077.json`), JSON.stringify({ target: TARGET, run, results: R, model: M, ops: OPS }, null, 1));
  const cnt = (k) => OPS.filter((o) => o.kind === k && o.ok).length;
  console.log('COUNTS', JSON.stringify({ currency_sales: cnt('sale_currency'), gram_sales: cnt('sale_gram'), currency_payments: cnt('payment_currency'), reversed_payments: cnt('reversal_payment'), reversed_sales: cnt('reversal_sale'), attacks: OPS.filter((o) => o.kind === 'attack').length, failures: OPS.filter((o) => o.ok === false && o.kind !== 'attack').length }));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
