// 30-day business simulation on STAGING (075), synthetic organization A only, real GoTrue sessions via PostgREST.
// Each "day": official daily rate for that calendar date, seller LOM/USD rates, sales (barcode + weight with named
// pieces), payments (UZS/USD/scrap), reversals, returns, handovers; receipts/consignments/purchases/factory handovers
// on schedule. Three sellers work in parallel every day. NOTE: staging's clock is real — documents are dated with the
// server's Tashkent business date (today); only the daily-rate history uses the 30 simulated dates.
// Every operation is logged with its record id and expected/actual; an independent model is compared at the end.
const fs = require('fs');
const { ORG, creds, rpc, sel, r4 } = require('./lib');
const SEED = Number(process.env.GA_SEED || 3030);
let s0 = SEED; const rnd = () => { s0 |= 0; s0 = (s0 + 0x6d2b79f5) | 0; let t = Math.imul(s0 ^ (s0 >>> 15), 1 | s0); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)]; const between = (a, b) => a + rnd() * (b - a);
const U4 = (x) => Math.round(Number(x) * 1e4); const divHalfUp = (n, d) => Math.floor((2 * n + d) / (2 * d));
const dueExact = (w, m) => divHalfUp(U4(w) * (100 + m), 100) / 1e4;
const cashExact = (c, lom) => divHalfUp(c * 1e4, lom) / 1e4;
const usdExact = (u, ur, lom) => divHalfUp(u * ur * 1e4, lom) / 1e4;
const scrapExact = (w, p) => divHalfUp(U4(w) * p, 585) / 1e4;
const RUN = process.env.GA_RUN || 'd30-' + Date.now().toString(36);
const OPS = []; const FAIL = [];
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.00005;
async function call(day, actor, kind, name, args, expectFn) {
  const r = await rpc(actor, name, args);
  const e = { n: OPS.length + 1, day, actor, kind, rpc: name, ok: r.ok };
  if (r.ok) {
    const d = r.data || {};
    e.id = d.sale_id || d.settlement_id || d.receipt_id || d.consignment_id || d.purchase_id || d.handover_id || d.reversal_id || d.piece_id || d.customer_id || d.id || null;
    if (expectFn) { const [exp, act] = expectFn(d); e.expected = exp; e.actual = act; e.match = JSON.stringify(exp) === JSON.stringify(act); if (!e.match) FAIL.push({ kind: kind + '_mismatch', op: e.n, expected: exp, actual: act }); }
  } else { e.error = r.error.slice(0, 160); FAIL.push({ kind, op: e.n, actor, error: e.error }); }
  OPS.push(e); return r;
}
(async () => {
  const C = creds(); const startedAt = new Date(Date.now() - 1000).toISOString();
  const SELLERS = [{ tag: 'sellera', markup: 15 }, { tag: 'sellerb', markup: 12 }, { tag: 'sellerc', markup: 10 }];
  for (const s of SELLERS) s.id = C[s.tag].id;
  const v0 = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0] || { o: 0, s: 0, c: 0, u: 0 };
  const M = { obl: Number(v0.o), stock: Number(v0.s), cash: Number(v0.c), usd: Number(v0.u), customers: {}, sellers: {}, pieces: {}, receipts: [] };
  for (const s of SELLERS) {
    const b = (await sel(`seller_gold_accounts?seller_id=eq.${s.id}&select=o:total_seller_obligation_g,st:total_settled_to_manager_g`))[0] || { o: 0, st: 0 };
    M.sellers[s.id] = { obligation: Number(b.o), settled: Number(b.st), till: { cash: 0, usd: 0, scrap: 0, grams: 0 }, consigned: 0, returned: 0, sales: [] };
  }
  // customers: 8 per seller through the 075 RPC
  for (const s of SELLERS) for (let i = 0; i < 8; i++) {
    const r = await call(0, s.tag, 'customer_create', 'rpc_create_customer_with_code', { p_contact_name: `${RUN} ${s.tag} mijoz ${i}` }, (d) => [true, /^CUST-\d{4,}$/.test(d.customer_code)]);
    if (r.ok) M.customers[r.data.customer_id] = { seller: s.id, net: 0, code: r.data.customer_code };
  }
  const today = new Date(Date.now() + 5 * 3600e3);
  const dateOf = (day) => new Date(today.getTime() - (30 - day) * 86400e3).toISOString().slice(0, 10);
  async function receipt(day) {
    const g = r4(between(120, 200));
    const r = await call(day, 'manager', 'factory_receipt', 'rpc_record_factory_receipt', { p_product_name: `${RUN} partiya d${day}`, p_original_physical_g: g, p_factory_markup_pct: 8, p_idempotency_key: `${RUN}-rc-${day}` });
    if (r.ok) { M.receipts.push({ id: r.data.receipt_id, left: g }); M.obl = r4(M.obl + r4(g * 1.08)); M.stock = r4(M.stock + g); }
  }
  async function consign(day, s) {
    const pieces = Array.from({ length: 6 + Math.floor(rnd() * 4) }, (_, j) => ({ weight_grams: r4(between(2, 8)), model_code: `${RUN}-${s.tag}-d${day}-${j}` }));
    const total = r4(pieces.reduce((a, p) => a + p.weight_grams, 0));
    const rc = M.receipts.find((x) => x.left >= total); if (!rc) return;
    const S = M.sellers[s.id]; const expObl = r4(S.obligation + r4(total * (1 + s.markup / 100)));
    const r = await call(day, 'manager', 'consignment', 'rpc_issue_barcode_consignment', { p_seller_id: s.id, p_factory_markup_pct: 8, p_seller_markup_pct: s.markup, p_factory_receipt_id: rc.id, p_pieces: pieces }, (d) => [pieces.length, (d.pieces || []).length]);
    if (!r.ok) return;
    rc.left = r4(rc.left - total); M.stock = r4(M.stock - total); S.consigned = r4(S.consigned + total); S.obligation = expObl;
    for (const p of r.data.pieces) M.pieces[p.id] = { seller: s.id, w: Number(p.weight_grams), status: 'held', code: p.model_code || pieces.find((x) => near(x.weight_grams, p.weight_grams)).model_code };
  }
  async function handover(day, s) {
    const S = M.sellers[s.id]; if (!(S.till.grams > 0)) return;
    const till = (await sel(`seller_gold_accounts?seller_id=eq.${s.id}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,p:seller_till_scrap_physical_g`))[0];
    if (!(Number(till.c) === S.till.cash && Number(till.u) === S.till.usd && near(till.s, S.till.scrap))) FAIL.push({ kind: 'till_mismatch', seller: s.tag, model: { ...S.till }, db: till });
    const exp = S.till.grams;
    const r = await call(day, s.tag, 'handover', 'rpc_record_seller_to_manager_settlement', { p_seller_id: s.id, p_cash_paid_amount: Number(till.c), p_usd_paid_amount: Number(till.u), p_scrap_weight_grams: Number(till.s), p_physical_scrap_g: Number(till.p), p_idempotency_key: `${RUN}-ho-${s.tag}-${day}` }, (d) => [exp, Number(d.total_settled_grams)]);
    if (r.ok) { S.settled = r4(S.settled + exp); M.cash += S.till.cash; M.usd += S.till.usd; M.scrapPhys = r4((M.scrapPhys || 0) + Number(till.p)); S.till = { cash: 0, usd: 0, scrap: 0, grams: 0 }; }
  }
  async function sellerDay(day, s) {
    const S = M.sellers[s.id]; const myCust = Object.entries(M.customers).filter(([, c]) => c.seller === s.id).map(([id]) => id);
    // daily seller rates (within the band around the official 900,000)
    s.lom = pick([885000, 890000, 895000, 900000, 905000, 910000]); s.usd = pick([12450, 12550, 12650, 12750]);
    await call(day, s.tag, 'seller_rate', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: s.lom, p_usd_rate_uzs: s.usd, p_reason: `kun ${day}` });
    for (let k = 0; k < 6; k++) {
      const held = Object.entries(M.pieces).filter(([, p]) => p.seller === s.id && p.status === 'held');
      const roll = rnd();
      if (roll < 0.30 && held.length) {
        const [pid, p] = pick(held); const cust = pick(myCust); const m = Math.round(between(s.markup - 4, s.markup + 10)); const due = dueExact(p.w, m);
        const r = await call(day, s.tag, 'sale_barcode', 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: pid, p_client_markup_pct: m }, (d) => [due, Number(d.client_gold_due_grams)]);
        if (r.ok) { M.customers[cust].net = r4(M.customers[cust].net + due); S.sales.push({ id: r.data.sale_id, cust, due, kind: 'barcode', pid, w: p.w }); p.status = 'sold'; }
      } else if (roll < 0.52 && held.length) {
        const cand = held.filter(([, p]) => p.w >= 1.5); if (!cand.length) continue;
        const [pid, p] = pick(cand); const w = r4(Math.min(p.w, between(1, 4))); const cust = pick(myCust); const m = Math.round(between(s.markup - 3, s.markup + 8)); const due = dueExact(w, m);
        const r = await call(day, s.tag, 'sale_weight', 'rpc_record_weight_sale', { p_customer_id: cust, p_weight_grams: w, p_client_markup_pct: m, p_piece_ids: [pid], p_idempotency_key: `${RUN}-ws-${s.tag}-${day}-${k}` }, (d) => [due, Number(d.client_gold_due_grams)]);
        if (r.ok) { M.customers[cust].net = r4(M.customers[cust].net + due); S.sales.push({ id: r.data.sale_id, cust, due, kind: 'weight', pid, w, whole: near(p.w, w) }); p.w = r4(p.w - w); if (p.w <= 0.00005) p.status = 'sold'; }
      } else if (roll < 0.85) {
        const cust = pick(myCust); const cash = rnd() < 0.8 ? Math.round(between(200000, 3000000) / 1000) * 1000 : 0; const usd = rnd() < 0.35 ? Math.round(between(10, 150)) : 0;
        const scrapW = rnd() < 0.2 ? r4(between(0.5, 2.5)) : 0; const proba = pick([585, 750]);
        if (!cash && !usd && !scrapW) continue;
        const args = { p_customer_id: cust, p_cash_amount: cash }; if (usd) args.p_usd_amount = usd; if (scrapW) { args.p_scrap_weight = scrapW; args.p_scrap_proba = proba; }
        const g = r4((cash ? cashExact(cash, s.lom) : 0) + (usd ? usdExact(usd, s.usd, s.lom) : 0) + (scrapW ? scrapExact(scrapW, proba) : 0));
        const r = await call(day, s.tag, 'payment', 'rpc_record_client_settlement', args, (d) => [g, Number(d.total_settled_grams)]);
        if (r.ok) { M.customers[cust].net = r4(M.customers[cust].net - Number(r.data.total_settled_grams)); S.till.cash += cash; S.till.usd += usd; S.till.scrap = r4(S.till.scrap + (scrapW ? scrapExact(scrapW, proba) : 0)); S.till.grams = r4(S.till.grams + Number(r.data.total_settled_grams)); }
      } else if (roll < 0.91 && S.sales.length) {
        const sale = S.sales.splice(Math.floor(rnd() * S.sales.length), 1)[0];
        const r = await call(day, 'manager', 'reversal', 'rpc_reverse_client_sale', { p_sale_id: sale.id, p_reason: `kun ${day} qaytdi`, p_idempotency_key: `${RUN}-rev-${sale.id}` });
        if (r.ok) {
          M.customers[sale.cust].net = r4(M.customers[sale.cust].net - sale.due); const p = M.pieces[sale.pid];
          if (sale.kind === 'barcode') p.status = 'held';
          else if (p.status === 'held') p.w = r4(p.w + sale.w);
          else if (sale.whole) { p.w = sale.w; p.status = 'held'; }
          else {
            const fresh = (await sel(`consignment_pieces?organization_id=eq.${ORG}&model_code=eq.${encodeURIComponent(p.code)}&status=eq.held_by_seller&notes=like.Restored*&select=id,weight_grams`)).filter((x) => !M.pieces[x.id] && near(x.weight_grams, sale.w));
            if (fresh.length) M.pieces[fresh[0].id] = { seller: p.seller, w: sale.w, status: 'held', code: p.code }; else FAIL.push({ kind: 'restored_piece_not_found', sale: sale.id });
          }
        }
      } else if (held.length) {
        const [pid, p] = pick(held); const expDelta = r4(p.w * (1 + s.markup / 100));
        const r = await call(day, s.tag, 'piece_return', 'rpc_return_piece_to_manager', { p_piece_id: pid, p_notes: `kun ${day} qaytarish` });
        if (r.ok) { S.obligation = r4(S.obligation - expDelta); S.returned = r4(S.returned + p.w); M.stock = r4(M.stock + p.w); p.status = 'returned'; OPS[OPS.length - 1].expected = { obligation_minus: expDelta }; }
      }
    }
    if (day % 3 === 0) await handover(day, s);
  }
  for (let day = 1; day <= 30; day++) {
    await call(day, 'director', 'daily_rate', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000 + Math.round(between(-8, 8)) * 1000, p_rate_date: dateOf(day) });
    if (day === 30) await call(day, 'director', 'daily_rate', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: dateOf(30) });
    if ([1, 6, 11, 16, 21, 26].includes(day)) await receipt(day);
    if ([1, 4, 8, 12, 16, 20, 24, 28].includes(day)) for (const s of SELLERS) await consign(day, s);
    await Promise.all(SELLERS.map((s) => sellerDay(day, s)));
    if (day % 5 === 0 && M.cash >= 2000000) { // purchase with cash, then hand the purchased gold to the factory
      const grams = r4(between(1, 2.2)); const spent = 1800000;
      const p = await call(day, 'manager', 'gold_purchase', 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor (sintetik)', p_cash_spent_uzs: spent, p_gold_weight_grams: grams, p_proba: 585, p_idempotency_key: `${RUN}-buy-${day}` });
      if (p.ok) {
        M.cash -= spent; const expObl = r4(M.obl - grams);
        const f = await call(day, 'manager', 'factory_handover', 'rpc_record_factory_gold_handover', { p_source_type: 'purchased_gold', p_physical_weight_g: grams, p_proba: 585 }, (d) => [expObl, Number(d.current_factory_obligation_g)]);
        if (f.ok) M.obl = expObl;
      }
    }
  }
  for (const s of SELLERS) await handover(31, s);
  // ---------- comparison ----------
  const diffs = []; let maxG = 0;
  const cmp = (what, exp, act, money = false) => { const d = Math.abs(Number(exp) - Number(act)); if (!money) maxG = Math.max(maxG, d); if (d > (money ? 0.5 : 0.00005)) diffs.push({ what, expected: exp, actual: Number(act) }); };
  const cg = Object.fromEntries((await sel(`client_gold_accounts?organization_id=eq.${ORG}&select=customer_id,d:current_debt_grams,a:advance_balance_grams`)).map((x) => [x.customer_id, x]));
  for (const [id, c] of Object.entries(M.customers)) { const row = cg[id] || { d: 0, a: 0 }; cmp(`customer ${c.code} debt-advance`, c.net, Number(row.d) - Number(row.a)); }
  const dbPieces = Object.fromEntries((await sel(`consignment_pieces?organization_id=eq.${ORG}&model_code=like.${RUN}*&select=id,weight_grams,status`)).map((p) => [p.id, p]));
  const activeSales = await sel(`jewelry_sales?organization_id=eq.${ORG}&status=not.in.(reversed,cancelled)&created_at=gte.${encodeURIComponent(startedAt)}&select=seller_id,base_weight_grams`);
  for (const s of SELLERS) {
    const S = M.sellers[s.id];
    const row = (await sel(`seller_gold_accounts?seller_id=eq.${s.id}&select=o:total_seller_obligation_g,st:total_settled_to_manager_g,ow:seller_owes_manager_g,ph:current_physical_stock_g,c:seller_till_cash_amount,u:seller_till_usd_amount,vc:till_valued_cash_585_g`))[0];
    const heldModel = r4(Object.values(M.pieces).filter((p) => p.seller === s.id && p.status === 'held').reduce((a, p) => a + p.w, 0));
    cmp(`${s.tag} obligation`, S.obligation, row.o); cmp(`${s.tag} settled to manager`, S.settled, row.st); cmp(`${s.tag} owes manager`, r4(S.obligation - S.settled), row.ow);
    cmp(`${s.tag} stock (held pieces)`, heldModel, row.ph); cmp(`${s.tag} till cash`, 0, row.c, true); cmp(`${s.tag} till usd`, 0, row.u, true); cmp(`${s.tag} till valued`, 0, row.vc);
    const heldDb = Object.values(dbPieces).filter((x) => x.status === 'held_by_seller' && (M.pieces[x.id] || {}).seller === s.id).reduce((a, x) => a + Number(x.weight_grams), 0);
    const sold = activeSales.filter((x) => x.seller_id === s.id).reduce((a, x) => a + Number(x.base_weight_grams), 0);
    cmp(`${s.tag} grams: held + sold + returned = consigned`, S.consigned, r4(heldDb + sold + S.returned));
  }
  for (const [id, p] of Object.entries(M.pieces)) {
    const d = dbPieces[id]; const st = { held: 'held_by_seller', sold: 'sold', returned: 'returned_to_manager' }[p.status];
    if (!d || d.status !== st) diffs.push({ what: `piece ${id} status`, expected: st, actual: d && d.status });
    if (p.status !== 'sold') cmp(`piece ${id} weight`, p.w, d ? d.weight_grams : -1);
  }
  const extra = Object.keys(dbPieces).filter((id) => !M.pieces[id] && dbPieces[id].status === 'held_by_seller');
  if (extra.length) diffs.push({ what: 'held pieces unknown to the model', expected: 0, actual: extra.length });
  const v = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0];
  cmp('manager physical stock', M.stock, v.s); cmp('factory obligation', M.obl, v.o); cmp('manager cash UZS', M.cash, v.c, true); cmp('manager USD', M.usd, v.u, true);
  const count = (k) => OPS.filter((o) => o.ok && o.kind === k).length;
  const summary = {
    run: RUN, seed: SEED, days: 30, operations_total: OPS.length, operations_ok: OPS.filter((o) => o.ok).length,
    sales: count('sale_barcode') + count('sale_weight'), sales_barcode: count('sale_barcode'), sales_weight: count('sale_weight'), payments: count('payment'),
    inventory_ops: count('factory_receipt') + count('consignment') + count('piece_return') + count('gold_purchase') + count('factory_handover'),
    inventory_detail: { receipts: count('factory_receipt'), consignments: count('consignment'), returns: count('piece_return'), purchases: count('gold_purchase'), factory_handovers: count('factory_handover') },
    reversals: count('reversal'), handovers: count('handover'), rate_changes: count('seller_rate') + count('daily_rate'), customers: count('customer_create'),
    expected_actual_mismatches: OPS.filter((o) => o.match === false).length, failed_calls: FAIL.length, model_differences: diffs.length, max_gram_diff: maxG.toFixed(4),
  };
  fs.writeFileSync(`${__dirname}/../evidence/sim30-${RUN}.json`, JSON.stringify({ summary, failures: FAIL, differences: diffs, final: { manager: v, model: { stock: M.stock, obl: M.obl, cash: M.cash, usd: M.usd } }, operations: OPS }, null, 1));
  console.log(JSON.stringify(summary, null, 1)); console.log('failures', JSON.stringify(FAIL.slice(0, 10))); console.log('diffs', JSON.stringify(diffs.slice(0, 10)));
  console.log(FAIL.length === 0 && diffs.length === 0 ? 'SIM30 PASS' : 'SIM30 FAIL');
})().catch((e) => { console.error('FATAL', e.stack); process.exit(1); });
