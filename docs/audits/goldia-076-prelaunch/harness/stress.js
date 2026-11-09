// GOLDIA pre-launch stress with an INDEPENDENT financial model (real GoTrue JWTs through PostgREST, like the UI).
//   GA_TARGET=staging -> https://vouehtlmsunebracahon.supabase.co, synthetic audit organization (audit.fx075.*), schema 075
//   GA_TARGET=local   -> local full stack (127.0.0.1:54321), synthetic audit organization, schema 076
// Volumes (>=): 200 credit sales, 200 payments, 100 inventory / consignment operations, 100 legacy debt / advance /
// reconciliation cases, 50 reversals, 50 attack / duplicate / concurrency / permission cases.
// Model (computed here, never read back from the server): customer net balance (debt - advance), seller gram stock,
// seller till UZS / USD, seller legacy obligation; every operation is logged with id, expected and actual.
const fs = require('fs'); const path = require('path');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const V076 = TARGET !== 'staging' || process.env.GA_SCHEMA === '076';
const OUT = process.env.GA_OUT || path.join(__dirname, '..', 'evidence', `stress-${TARGET}-${V076 ? '076' : '075'}.json`);
const C = L.creds(); const ORG = L.ORG;
const SELLERS = ['sellera', 'sellerb', 'sellerc'];
const U4 = (x) => Math.round(Number(x) * 1e4); const r4 = (x) => Math.round(Number(x) * 1e4) / 1e4; const N = Number;
const dh = (n, d) => Math.floor((2 * n + d) / (2 * d)); // half-up integer division
let seed = Number(process.env.SEED || 20261104); const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const OPS = []; const R = []; const cnt = {};
const op = (kind, e) => { cnt[kind] = (cnt[kind] || 0) + 1; OPS.push({ kind, at: new Date().toISOString(), ...e }); return e; };
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 240)}`); return ok; };
// ---------------- model
const M = { cust: {}, stock: {}, cashUzs: {}, cashUsd: {}, legacy: {} };
const net = (c) => M.cust[c] || 0;
const addNet = (c, g) => { M.cust[c] = r4(net(c) + g); };
const SR = { sellera: { lom: 890000, usd: 12500 }, sellerb: { lom: 905000, usd: 12650 }, sellerc: { lom: 897000, usd: 12550 } };
const payGrams = (cash, usd, scrap, proba, rate) => r4((cash ? dh(cash * 1e4, rate.lom) / 1e4 : 0) + (usd ? dh(usd * rate.usd * 1e4, rate.lom) / 1e4 : 0) + (scrap ? dh(U4(scrap) * proba, 585) / 1e4 : 0));
const sid = (t) => C[t].id;
const dueOf = (w, m) => dh(U4(w) * (100 + m), 100) / 1e4; // server: round(w * (1 + m/100), 4), half-up, exact integers
(async () => {
  const run = Date.now().toString(36);
  const today = L.tashkentToday();
  // ---------------- snapshot of the sellers (stock / till / legacy obligation) as the model's starting point
  const acc = async (t) => (await L.sel(`seller_gold_accounts?seller_id=eq.${sid(t)}&select=st:current_physical_stock_g,c:seller_till_cash_amount,u:seller_till_usd_amount,l:seller_legacy_debt_obligation_g`))[0] || { st: 0, c: 0, u: 0, l: 0 };
  // the stored legacy obligation is clamped at 0 (076): the model must start from the UNclamped sum of the seller's active
  // debt-type deltas, otherwise a negative starting sum (e.g. a -1 g reduction by an earlier test) looks like a mismatch
  for (const t of SELLERS) {
    const a = await acc(t); M.stock[t] = r4(a.st); M.cashUzs[t] = N(a.c); M.cashUsd[t] = N(a.u);
    const legRows = await L.sel(`client_legacy_debts?seller_id=eq.${sid(t)}&balance_type=eq.debt&status=eq.confirmed&select=delta_585_g`);
    M.legacy[t] = r4(legRows.reduce((x, y) => x + N(y.delta_585_g), 0));
    if (Math.abs(Math.max(0, M.legacy[t]) - N(a.l)) > 0.00005) console.log(`NOTE start ${t}: stored obligation ${a.l} <> max(0, active debt deltas ${M.legacy[t]})`);
  }
  // ---------------- setup: rates, receipts (6/8/10 %), consignments (12/15/10 % seller markups)
  must(await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today }), 'daily rate');
  for (const t of SELLERS) must(await L.rpc(t, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: SR[t].lom, p_usd_rate_uzs: SR[t].usd, p_reason: 'stress ' + run }), 'rates ' + t);
  const pieces = {}; // seller -> [{id, w}]
  for (const [i, t] of SELLERS.entries()) {
    pieces[t] = [];
    for (const fpct of [6, 8, 10]) {
      const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `STRESS ${run} ${t} ${fpct}%`, p_original_physical_g: 160, p_factory_markup_pct: fpct });
      op('inventory', { what: 'factory_receipt', seller: t, ok: rc.ok, id: rc.ok ? rc.data.receipt_id : null, factory_pct: fpct, grams: 160, error: rc.error });
      if (!rc.ok) continue;
      const ps = [...Array(20)].map((_, k) => ({ weight_grams: r4(3.1 + ((k * 7 + i * 3) % 13) * 0.6137), model_code: `ST-${run}-${t}-${fpct}-${k}` }));
      const w = r4(ps.reduce((a, p) => a + p.weight_grams, 0));
      const cs = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: sid(t), p_factory_markup_pct: fpct, p_seller_markup_pct: [12, 15, 10][i], p_factory_receipt_id: rc.data.receipt_id, p_pieces: ps, p_idempotency_key: `ST-CONS-${run}-${t}-${fpct}` });
      op('inventory', { what: 'barcode_consignment', seller: t, ok: cs.ok, id: cs.ok ? cs.data.consignment_id : null, grams: w, pieces: ps.length, error: cs.error });
      if (cs.ok) { M.stock[t] = r4(M.stock[t] + w); for (const p of cs.data.pieces) pieces[t].push({ id: p.id, w: N(p.weight_grams) }); }
    }
  }
  // ---------------- customers (special characters, long, cyrillic)
  const NAMES = ["O'g'iloy Qodirova", 'Иван Петров', 'Ali "Zargar" Valiyev', 'Lola  Karimova', "Sh'ahnoza O`rinova", 'Mijoz <b>test</b>', 'Ёқубжон Тошматов', 'A'.repeat(60), 'Dilnoza & Co', 'Bekzod_123'];
  const custs = {};
  for (const t of SELLERS) {
    custs[t] = [];
    for (let k = 0; k < 10; k++) {
      const nm = `${NAMES[k]} ST${run}${t.slice(-1)}${k}`;
      const cu = await L.rpc(t, 'rpc_create_customer_with_code', { p_contact_name: nm });
      op('customer', { seller: t, ok: cu.ok, id: cu.ok ? cu.data.customer_id : null, name_len: nm.length, error: cu.error });
      if (cu.ok) { custs[t].push(cu.data.customer_id); M.cust[cu.data.customer_id] = 0; }
    }
    // name round trip (special characters stored exactly)
  }
  const saleIds = []; const payIds = []; const legIds = [];
  // ---------------- 200 credit sales
  const heldPieces = async (t) => (await L.sel(`consignment_pieces?seller_id=eq.${sid(t)}&status=eq.held_by_seller&select=id,weight_grams,created_at&order=created_at.asc,id.asc`)).map((p) => ({ id: p.id, w: N(p.weight_grams) }));
  for (let k = 0; k < 210; k++) {
    const t = SELLERS[k % 3]; const c = pick(custs[t]); const m = pick([10, 12, 15, 25, 30, 35]);
    const mode = k % 4 === 3 ? 'barcode' : 'weight';
    let r; let w;
    if (mode === 'barcode') {
      const hp = await heldPieces(t); const p = hp[Math.floor(rnd() * hp.length)];
      if (!p) continue; w = p.w;
      r = await L.rpc(t, 'rpc_record_barcode_piece_sale', { p_customer_id: c, p_piece_id: p.id, p_client_markup_pct: m, p_idempotency_key: `ST-BS-${run}-${k}` });
    } else {
      w = r4(0.37 + rnd() * 6.8);
      if (w > M.stock[t] - 1) w = r4(Math.max(0.1, M.stock[t] / 4));
      const args = { p_customer_id: c, p_weight_grams: w, p_client_markup_pct: m, p_idempotency_key: `ST-WS-${run}-${k}` };
      if (!V076 || k % 8 === 1) { // 075: the UI must send pieces; 076: some sales still name the pieces
        const hp = await heldPieces(t); const ids = []; let s = 0; for (const p of hp) { if (s >= w - 0.00005) break; ids.push(p.id); s = r4(s + p.w); }
        args.p_piece_ids = ids;
      }
      r = await L.rpc(t, 'rpc_record_weight_sale', args);
    }
    const due = dueOf(w, m);
    op('sale', { seller: t, mode, ok: r.ok, id: r.ok ? r.data.sale_id : null, customer: c, grams: w, markup: m, expected_due: due, actual_due: r.ok ? N(r.data.client_gold_due_grams ?? r.data.gross_gold_due_grams) : null, error: r.error });
    if (r.ok) { addNet(c, due); M.stock[t] = r4(M.stock[t] - w); saleIds.push({ id: r.data.sale_id, t, c, due, w }); }
  }
  // ---------------- 200 payments (UZS / USD / scrap 585 / 750 / mixed, some overpay -> advance)
  for (let k = 0; k < 210; k++) {
    const t = SELLERS[k % 3]; const c = pick(custs[t]); const rate = SR[t];
    const kind = pick(['cash', 'usd', 'scrap585', 'scrap750', 'mixed', 'overpay']);
    let cash = 0; let usd = 0; let scrap = 0; let proba = null;
    if (kind === 'cash') cash = Math.round(rnd() * 3) * 100000 + 50000;
    if (kind === 'usd') usd = Math.round(rnd() * 80) + 5;
    if (kind === 'scrap585') { scrap = r4(0.2 + rnd() * 2); proba = 585; }
    if (kind === 'scrap750') { scrap = r4(0.2 + rnd() * 1.5); proba = 750; }
    if (kind === 'mixed') { cash = 200000; usd = 10; scrap = r4(0.33); proba = 585; }
    if (kind === 'overpay') cash = Math.ceil((Math.max(net(c), 0) + 0.5) * rate.lom / 1000) * 1000;
    const args = { p_customer_id: c, p_cash_amount: cash, p_usd_amount: usd, p_scrap_weight: scrap, p_idempotency_key: `ST-PAY-${run}-${k}` };
    if (cash) args.p_rate_per_gram = rate.lom; if (usd) args.p_usd_rate = rate.usd; if (scrap) args.p_scrap_proba = proba;
    const r = await L.rpc(t, 'rpc_record_client_settlement', args);
    const g = payGrams(cash, usd, scrap, proba, rate);
    op('payment', { seller: t, pkind: kind, ok: r.ok, id: r.ok ? (r.data.settlement_id || r.data.id) : null, customer: c, cash, usd, scrap, proba, expected_g: g, actual_g: r.ok ? N(r.data.total_settled_grams) : null, error: r.error });
    if (r.ok) { addNet(c, -g); M.cashUzs[t] += cash; M.cashUsd[t] += usd; payIds.push({ id: r.data.settlement_id || r.data.id, t, c, g, cash, usd }); }
  }
  // ---------------- 100 legacy debt / advance / reconciliation cases
  const legWho = V076 ? ['manager', 'director'] : ['director'];
  for (let k = 0; k < 104; k++) {
    const t = SELLERS[k % 3]; const c = pick(custs[t]);
    const variant = k % 4; // 0 seller add (076) / director add (075), 1 reconcile up/down, 2 advance, 3 duplicate attempt
    let who = V076 && variant === 0 ? t : pick(legWho);
    let args; let expDelta;
    if (variant === 0 || variant === 3) { const a = r4(0.5 + rnd() * 30); args = { p_balance_type: 'debt', p_amount_585_g: a, p_entry_type: 'manual_addition' }; expDelta = a; }
    if (variant === 1) { const tgt = r4(Math.max(0, net(c) + (rnd() - 0.4) * 20)); args = { p_balance_type: 'debt', p_amount_585_g: 0, p_entry_type: 'reconciliation_adjustment', p_target_final_balance: tgt }; expDelta = r4(tgt - net(c)); }
    if (variant === 2) { const a = r4(0.25 + rnd() * 5); args = { p_balance_type: 'advance', p_amount_585_g: a, p_entry_type: 'manual_addition' }; expDelta = -a; }
    const key = `ST-LEG-${run}-${k}`;
    const r = await L.rpc(who, 'rpc_record_client_legacy_debt', { p_customer_id: c, p_as_of_date: today, p_notes: 'stress', p_target_final_balance: null, p_idempotency_key: key, ...args });
    const noChange = r.ok && r.data.no_change_needed;
    op('legacy', { seller: t, by: who, variant, ok: r.ok, id: r.ok ? r.data.legacy_debt_id || null : null, customer: c, expected_delta: noChange ? 0 : expDelta, actual_delta: r.ok ? N(r.data.delta_585_g) : null, error: r.error });
    if (r.ok && !noChange) { addNet(c, N(r.data.delta_585_g)); if (args.p_balance_type === 'debt') M.legacy[t] = r4(M.legacy[t] + N(r.data.delta_585_g)); legIds.push({ id: r.data.legacy_debt_id, t, c, d: N(r.data.delta_585_g), debtType: args.p_balance_type === 'debt' }); }
    if (variant === 3 && r.ok) { // the same addition again with a NEW key (double click with the old frontend)
      const d2 = await L.rpc(who, 'rpc_record_client_legacy_debt', { p_customer_id: c, p_as_of_date: today, p_notes: 'stress', p_target_final_balance: null, p_idempotency_key: key + '-again', ...args });
      op('attack', { what: 'legacy duplicate with a new key', ok_expected: !V076, accepted: d2.ok, error: d2.error });
      if (d2.ok && !d2.data.no_change_needed) { addNet(c, N(d2.data.delta_585_g)); M.legacy[t] = r4(M.legacy[t] + N(d2.data.delta_585_g)); legIds.push({ id: d2.data.legacy_debt_id, t, c, d: N(d2.data.delta_585_g), debtType: true }); }
    }
  }
  // ---------------- 50+ reversals (sales, payments, legacy), newest first where it matters
  const revWho = 'manager';
  for (const s of saleIds.slice(-20)) { const r = await L.rpc(revWho, 'rpc_reverse_client_sale', { p_sale_id: s.id, p_reason: 'stress reversal' }); op('reversal', { what: 'sale', id: s.id, ok: r.ok, error: r.error }); if (r.ok) { addNet(s.c, -s.due); M.stock[s.t] = r4(M.stock[s.t] + s.w); } }
  for (const p of payIds.slice(-20)) { const r = await L.rpc(revWho, 'rpc_reverse_client_settlement', { p_settlement_id: p.id, p_reason: 'stress reversal' }); op('reversal', { what: 'payment', id: p.id, ok: r.ok, error: r.error }); if (r.ok) { addNet(p.c, p.g); M.cashUzs[p.t] -= p.cash; M.cashUsd[p.t] -= p.usd; } }
  for (const l of legIds.slice().reverse().slice(0, 15)) {
    const r = await L.rpc(V076 ? 'manager' : 'director', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: l.id, p_reason: 'stress reversal' });
    op('reversal', { what: 'legacy', id: l.id, ok: r.ok, error: r.error && r.error.slice(0, 100) });
    if (r.ok) { addNet(l.c, -l.d); if (l.debtType) M.legacy[l.t] = r4(M.legacy[l.t] - l.d); }
  }
  // ---------------- inventory: returns to the manager (sellerc) + a consignment reversal attempt
  for (let k = 0; k < 12; k++) {
    const hp = await heldPieces('sellerc'); const p = hp[hp.length - 1 - k]; if (!p) break;
    const r = await L.rpc('sellerc', 'rpc_return_piece_to_manager', { p_piece_id: p.id, p_notes: 'stress return', p_idempotency_key: `ST-RET-${run}-${k}` });
    op('inventory', { what: 'return_piece_to_manager', ok: r.ok, id: p.id, grams: p.w, error: r.error });
    if (r.ok) M.stock.sellerc = r4(M.stock.sellerc - p.w);
  }
  // ---------------- 50 attacks / duplicates / concurrency / permission cases
  const A = async (what, fn, expectRefused) => { const r = await fn(); const refused = !r.ok; op('attack', { what, expected: expectRefused ? 'refused' : 'accepted', refused, status: r.status, error: r.error && r.error.slice(0, 120) }); if (!refused && !expectRefused) return r; return r; };
  const ca = custs.sellera[0]; const cb = custs.sellerb[0];
  // 084: a typed rate inside the limits is accepted (proven by goldia-077/harness/rate-084.js); an absurd rate is still refused
  // (LOM: deviation rule from the official rate; USD: above every organization limit). Before 084 both were ERR_RATE_MISMATCH.
  await A('seller pays at an absurd LOM rate (5 000 000)', () => L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: ca, p_cash_amount: 100000, p_rate_per_gram: 5000000 }), true);
  await A('seller pays at an absurd USD rate (200 000 000)', () => L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: ca, p_usd_amount: 10, p_usd_rate: 200000000 }), true);
  await A("seller collects from another seller's customer", () => L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: cb, p_cash_amount: 100000, p_rate_per_gram: SR.sellera.lom }), true);
  await A("seller sells by weight to another seller's customer", () => L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cb, p_weight_grams: 0.5, p_client_markup_pct: 10 }), V076);
  await A('seller oversells his stock', () => L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: ca, p_weight_grams: r4(M.stock.sellera + 1), p_client_markup_pct: 10 }), true);
  await A('negative weight', () => L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: ca, p_weight_grams: -1, p_client_markup_pct: 10 }), true);
  await A('markup 101 %', () => L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: ca, p_weight_grams: 1, p_client_markup_pct: 101 }), true);
  await A('negative cash', () => L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: ca, p_cash_amount: -100000, p_rate_per_gram: SR.sellera.lom }), true);
  await A('zero payment', () => L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: ca }), true);
  await A('seller reverses a payment', () => L.rpc('sellera', 'rpc_reverse_client_settlement', { p_settlement_id: payIds[0].id, p_reason: 'x' }), true);
  await A('seller issues a consignment', () => L.rpc('sellera', 'rpc_issue_barcode_consignment', { p_seller_id: sid('sellera'), p_factory_markup_pct: 8, p_pieces: [{ weight_grams: 1 }] }), true);
  await A('seller records a factory receipt', () => L.rpc('sellera', 'rpc_record_factory_receipt', { p_product_name: 'x', p_original_physical_g: 1, p_factory_markup_pct: 8 }), true);
  await A('seller sets the daily rate', () => L.rpc('sellera', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 1, p_rate_date: today }), true);
  await A('seller hands over for another seller', () => L.rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: sid('sellerb'), p_cash_paid_amount: 1000 }), true);
  await A('worker sells', () => L.rpc('worker', 'rpc_record_weight_sale', { p_customer_id: ca, p_weight_grams: 1, p_client_markup_pct: 10 }), true);
  await A('worker legacy debt', () => L.rpc('worker', 'rpc_record_client_legacy_debt', { p_customer_id: ca, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: today }), true);
  if (C.directorB) await A('director of org B reads org A customer debt', async () => { const r = await L.usel('directorB', `client_gold_accounts?customer_id=eq.${ca}&select=current_debt_grams`); return r.ok && r.data.length === 0 ? { ok: false, error: 'not visible' } : r; }, true);
  if (C.directorB) await A('director of org B pays for org A customer', () => L.rpc('directorB', 'rpc_record_client_settlement', { p_customer_id: ca, p_cash_amount: 1000, p_rate_per_gram: 900000 }), true);
  if (C.directorB) await A('director of org B legacy debt on org A customer', () => L.rpc('directorB', 'rpc_record_client_legacy_debt', { p_customer_id: ca, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: today }), true);
  await A('seller reads another seller customers', async () => { const r = await L.usel('sellera', `customers?id=eq.${cb}&select=id`); return r.ok && r.data.length === 0 ? { ok: false, error: 'not visible' } : r; }, true);
  await A('seller reads another seller account', async () => { const r = await L.usel('sellera', `seller_gold_accounts?seller_id=eq.${sid('sellerb')}&select=seller_id`); return r.ok && r.data.length === 0 ? { ok: false, error: 'not visible' } : r; }, true);
  await A('seller direct INSERT into jewelry_sales', () => L.uwrite('sellera', 'POST', 'jewelry_sales', { organization_id: ORG, seller_id: sid('sellera'), customer_id: ca, base_weight_grams: 1 }), true);
  await A('seller direct UPDATE of client debt', async () => { const r = await L.uwrite('sellera', 'PATCH', `client_gold_accounts?customer_id=eq.${ca}`, { current_debt_grams: 0 }); return r.ok && (!r.data || r.data.length === 0) ? { ok: false, error: 'no row changed' } : r; }, true);
  await A('seller direct UPDATE of own stock', async () => { const r = await L.uwrite('sellera', 'PATCH', `seller_gold_accounts?seller_id=eq.${sid('sellera')}`, { current_physical_stock_g: 9999 }); return r.ok && (!r.data || r.data.length === 0) ? { ok: false, error: 'no row changed' } : r; }, true);
  await A('seller direct DELETE of a legacy row', async () => { const r = await L.uwrite('sellera', 'DELETE', `client_legacy_debts?customer_id=eq.${ca}`); return r.ok && (!r.data || r.data.length === 0) ? { ok: false, error: 'no row deleted' } : r; }, true);
  await A('seller direct UPDATE of a sale', async () => { const r = await L.uwrite('sellera', 'PATCH', `jewelry_sales?seller_id=eq.${sid('sellera')}`, { client_gold_due_grams: 0 }); return r.ok && (!r.data || r.data.length === 0) ? { ok: false, error: 'no row changed' } : r; }, true);
  await A('seller direct UPDATE of a payment', async () => { const r = await L.uwrite('sellera', 'PATCH', `gold_settlements?seller_id=eq.${sid('sellera')}`, { total_settled_grams: 999 }); return r.ok && (!r.data || r.data.length === 0) ? { ok: false, error: 'no row changed' } : r; }, true);
  await A('double reversal of a sale', () => L.rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: saleIds[saleIds.length - 1].id, p_reason: 'again' }), true);
  // a second reversal of a payment answers ok as an idempotent no-op; it must not change the balance
  await A('double reversal of a payment (must not change the balance)', async () => {
    const p = payIds[payIds.length - 1];
    const b0 = (await L.sel(`client_gold_accounts?customer_id=eq.${p.c}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
    const r = await L.rpc('manager', 'rpc_reverse_client_settlement', { p_settlement_id: p.id, p_reason: 'again' });
    const b1 = (await L.sel(`client_gold_accounts?customer_id=eq.${p.c}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
    return JSON.stringify(b0) === JSON.stringify(b1) ? { ok: false, status: r.status, error: 'no change: ' + JSON.stringify(r.data || r.error).slice(0, 80) } : { ok: true };
  }, true);
  // same idempotency key, 8 parallel requests -> one sale
  {
    const c = custs.sellera[1]; const key = `ST-PAR-${run}`; const w = 0.77;
    const before = net(c);
    const args = { p_customer_id: c, p_weight_grams: w, p_client_markup_pct: 12, p_idempotency_key: key };
    if (!V076) { const hp = await heldPieces('sellera'); const ids = []; let s = 0; for (const p of hp) { if (s >= w) break; ids.push(p.id); s = r4(s + p.w); } args.p_piece_ids = ids; }
    const par = await Promise.all([...Array(8)].map(() => L.rpc('sellera', 'rpc_record_weight_sale', args)));
    const ids = new Set(par.filter((x) => x.ok).map((x) => x.data.sale_id));
    op('attack', { what: '8 parallel identical sales, same key', expected: 'one sale', refused: ids.size === 1, ok_count: par.filter((x) => x.ok).length, distinct_sales: ids.size });
    if (ids.size >= 1) { addNet(c, dueOf(w, 12) * ids.size); M.stock.sellera = r4(M.stock.sellera - w * ids.size); }
    T('ATT-PAR', '8 parallel requests with one idempotency key -> exactly one sale', ids.size === 1, 1, { distinct: ids.size, ok: par.filter((x) => x.ok).length, before });
  }
  // 10 parallel different sales draining one seller -> stock never negative
  {
    const t = 'sellerb'; const c = custs.sellerb[2]; const each = r4(Math.max(0.5, M.stock[t] / 8));
    const par = await Promise.all([...Array(10)].map(async (_, i) => {
      const args = { p_customer_id: c, p_weight_grams: each, p_client_markup_pct: 10, p_idempotency_key: `ST-DRAIN-${run}-${i}` };
      return L.rpc(t, 'rpc_record_weight_sale', args);
    }));
    const okN = par.filter((x) => x.ok).length;
    op('attack', { what: '10 parallel sales draining seller stock', expected: 'stock never negative', accepted: okN, refused: 10 - okN, each_g: each });
    addNet(c, r4(dueOf(each, 10) * okN)); M.stock[t] = r4(M.stock[t] - each * okN);
    for (const x of par) if (!x.ok) cnt.drain_refusals = (cnt.drain_refusals || 0) + 1;
  }
  // 6 parallel payments, different keys, same content -> each one is a separate payment (business may allow); recorded
  {
    const c = custs.sellerc[3]; const rate = SR.sellerc;
    const par = await Promise.all([...Array(6)].map((_, i) => L.rpc('sellerc', 'rpc_record_client_settlement', { p_customer_id: c, p_cash_amount: 50000, p_rate_per_gram: rate.lom, p_idempotency_key: `ST-PP-${run}-${i}` })));
    const okN = par.filter((x) => x.ok).length; const g = payGrams(50000, 0, 0, null, rate);
    addNet(c, -g * okN); M.cashUzs.sellerc += 50000 * okN;
    op('attack', { what: '6 parallel payments with different keys', expected: 'each recorded once', accepted: okN });
  }
  // same payment key twice -> one payment
  {
    const c = custs.sellerc[4]; const rate = SR.sellerc; const key = `ST-PK-${run}`;
    const a = await L.rpc('sellerc', 'rpc_record_client_settlement', { p_customer_id: c, p_cash_amount: 70000, p_rate_per_gram: rate.lom, p_idempotency_key: key });
    const b = await L.rpc('sellerc', 'rpc_record_client_settlement', { p_customer_id: c, p_cash_amount: 70000, p_rate_per_gram: rate.lom, p_idempotency_key: key });
    const same = a.ok && b.ok && (a.data.settlement_id || a.data.id) === (b.data.settlement_id || b.data.id);
    if (a.ok) { addNet(c, -payGrams(70000, 0, 0, null, rate)); M.cashUzs.sellerc += 70000; }
    op('attack', { what: 'payment retried with the same key', expected: 'one payment', refused: same });
    T('ATT-PK', 'payment retried with the same key -> one payment', same, true, { a: a.ok, b: b.ok });
  }
  // anonymous
  {
    const r = await fetch(`${L.URL}/rest/v1/rpc/rpc_record_weight_sale`, { method: 'POST', headers: { apikey: L.ANON || L.KEY, 'content-type': 'application/json' }, body: JSON.stringify({ p_customer_id: ca, p_weight_grams: 1, p_client_markup_pct: 10 }) });
    op('attack', { what: 'anonymous sale', expected: 'refused', refused: !r.ok, status: r.status });
  }
  // ---------------- handovers seller -> manager (cash and USD out of the seller till)
  for (const t of SELLERS) {
    const cash = Math.floor(Math.max(0, M.cashUzs[t]) / 2 / 1000) * 1000; if (cash <= 0) continue;
    const r = await L.rpc('manager', 'rpc_record_seller_to_manager_settlement', { p_seller_id: sid(t), p_cash_paid_amount: cash, p_idempotency_key: `ST-HO-${run}-${t}` });
    op('handover', { seller: t, ok: r.ok, id: r.ok ? (r.data.settlement_id || r.data.id) : null, cash, grams: r.ok ? N(r.data.total_settled_grams) : null, error: r.error });
    if (r.ok) M.cashUzs[t] -= cash;
  }
  // ---------------- reconciliation: model vs database
  let custBad = 0; const custDiff = [];
  for (const t of SELLERS) for (const c of custs[t]) {
    const a = (await L.sel(`client_gold_accounts?customer_id=eq.${c}&select=d:current_debt_grams,a:advance_balance_grams`))[0] || { d: 0, a: 0 };
    const dbNet = r4(N(a.d) - N(a.a));
    if (Math.abs(dbNet - net(c)) > 0.00005 || (N(a.d) > 0 && N(a.a) > 0)) { custBad++; custDiff.push({ c, model: net(c), db: dbNet, d: a.d, a: a.a }); }
  }
  T('REC-01', `customer balances (debt - advance): model = database for all ${SELLERS.length * 10} customers (0.0000 g)`, custBad === 0, 0, { mismatches: custBad, first: custDiff.slice(0, 3) });
  for (const t of SELLERS) {
    const a = await acc(t);
    const pz = r4((await L.sel(`consignment_pieces?seller_id=eq.${sid(t)}&status=eq.held_by_seller&select=weight_grams`)).reduce((x, y) => x + N(y.weight_grams), 0));
    T(`REC-ST-${t}`, `${t} gram stock: model = database = held pieces`, Math.abs(N(a.st) - M.stock[t]) < 0.00005 && Math.abs(pz - N(a.st)) < 0.00005, M.stock[t], { db: N(a.st), pieces: pz });
    T(`REC-TILL-${t}`, `${t} till UZS / USD: model = database`, Math.abs(N(a.c) - M.cashUzs[t]) < 0.005 && Math.abs(N(a.u) - M.cashUsd[t]) < 0.005, { uzs: M.cashUzs[t], usd: M.cashUsd[t] }, { uzs: N(a.c), usd: N(a.u) });
    // 076 clamps the seller's legacy obligation at 0 (075: a negative total raised a check-constraint error)
    T(`REC-LEG-${t}`, `${t} legacy obligation: model max(0, sum of active debt deltas) = database`, Math.abs(N(a.l) - Math.max(0, M.legacy[t])) < 0.00005, Math.max(0, M.legacy[t]), N(a.l));
  }
  // per-operation expected/actual
  const saleBad = OPS.filter((o) => o.kind === 'sale' && o.ok && Math.abs(o.actual_due - o.expected_due) > 0.00005).length;
  const payBad = OPS.filter((o) => o.kind === 'payment' && o.ok && Math.abs(o.actual_g - o.expected_g) > 0.00005).length;
  const legBad = OPS.filter((o) => o.kind === 'legacy' && o.ok && Math.abs(o.actual_delta - o.expected_delta) > 0.00005).length;
  T('REC-02', 'every sale: client due = grams x (1 + markup) exactly (no markup on markup)', saleBad === 0, 0, saleBad);
  T('REC-03', 'every payment: grams = independent UZS / USD / scrap conversion at the seller\'s rate', payBad === 0, 0, payBad);
  T('REC-04', 'every legacy entry: delta = independent expectation', legBad === 0, 0, legBad);
  const attacks = OPS.filter((o) => o.kind === 'attack');
  const attBad = attacks.filter((o) => o.expected === 'refused' && !o.refused);
  T('REC-05', `attack / duplicate / permission cases behaved as expected (${attacks.length})`, attBad.length === 0, 0, attBad.map((o) => o.what));
  const fails = OPS.filter((o) => ['sale', 'payment', 'legacy', 'inventory', 'reversal', 'handover', 'customer'].includes(o.kind) && o.ok === false);
  const counts = { sales_ok: OPS.filter((o) => o.kind === 'sale' && o.ok).length, payments_ok: OPS.filter((o) => o.kind === 'payment' && o.ok).length, inventory_ok: OPS.filter((o) => o.kind === 'inventory' && o.ok).length, legacy_ok: OPS.filter((o) => o.kind === 'legacy' && o.ok).length, reversals_ok: OPS.filter((o) => o.kind === 'reversal' && o.ok).length, attacks: attacks.length, failures: fails.length };
  console.log('COUNTS', JSON.stringify(counts));
  const errs = {}; for (const f of fails) { const k = f.kind + ': ' + String(f.error).slice(0, 90); errs[k] = (errs[k] || 0) + 1; }
  console.log('OPERATION ERRORS', JSON.stringify(errs, null, 1));
  fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, schema: V076 ? '076' : '075', run, counts, errors: errs, results: R, model: M, ops: OPS }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
function must(r, what) { if (!r.ok) throw new Error(`${what}: ${r.status} ${r.error}`); return r.data; }
