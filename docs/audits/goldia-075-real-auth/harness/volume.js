// Volume run on the LOCAL 075 stack with real GoTrue sessions through PostgREST: hundreds of transactions
// (customer creation through the 075 RPC, receipts, consignments, barcode and weight sales with named pieces,
// payments in UZS/USD/scrap at changing seller rates, handovers, reversals, returns) with three sellers working in
// parallel. An independent model (only the scenario's own inputs) predicts every balance; the database is then
// compared customer by customer, seller by seller, piece by piece. Failed calls are counted and listed, never hidden.
const fs = require('fs');
const { ORG, creds, rpc, sel, r4, tashkentToday } = require('./lib');
const SEED = Number(process.env.GA_SEED || 75075);
let s0 = SEED; const rnd = () => { s0 |= 0; s0 = (s0 + 0x6d2b79f5) | 0; let t = Math.imul(s0 ^ (s0 >>> 15), 1 | s0); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)]; const between = (a, b) => a + rnd() * (b - a);
// exact decimal rounding (PostgreSQL numeric, half away from zero) on integer 1e-4 units — float r4 misrounds x.xxxx5
const U4 = (x) => Math.round(Number(x) * 1e4);
const divHalfUp = (num, den) => Math.floor((2 * num + den) / (2 * den));
const dueExact = (w, m) => divHalfUp(U4(w) * (100 + m), 100) / 1e4;
const cashExact = (cash, lom) => divHalfUp(cash * 1e4, lom) / 1e4;
const usdExact = (usd, usdRate, lom) => divHalfUp(usd * usdRate * 1e4, lom) / 1e4;
const scrapExact = (w, proba) => divHalfUp(U4(w) * proba, 585) / 1e4;
const RUN = process.env.GA_RUN || 'v' + Date.now().toString(36);
const stats = { ok: {}, expected_reject: {}, unexpected_fail: [] };
const okc = (k) => { stats.ok[k] = (stats.ok[k] || 0) + 1; };
async function call(tag, name, args, kind) {
  const r = await rpc(tag, name, args);
  if (r.ok) okc(kind || name); else stats.unexpected_fail.push({ kind: kind || name, tag, error: r.error.slice(0, 140) });
  return r;
}
(async () => {
  const C = creds(); const startedAt = new Date(Date.now() - 1000).toISOString();
  const SELLERS = [{ tag: 'sellera', markup: 15 }, { tag: 'sellerb', markup: 12 }, { tag: 'sellerc', markup: 10 }];
  for (const s of SELLERS) s.id = C[s.tag].id;
  const M = { factoryObl: 0, received: 0, stock: 0, cash: 0, usd: 0, customers: {}, sellers: {}, pieces: {} };
  const start = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0];
  M.factoryObl = Number(start.o); M.stock = Number(start.s); M.cash = Number(start.c); M.usd = Number(start.u);
  await call('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: tashkentToday() }, 'daily_rate');
  // receipts
  const receipts = [];
  for (let i = 0; i < 6; i++) {
    const g = r4(between(150, 260));
    const r = await call('manager', 'rpc_record_factory_receipt', { p_product_name: `${RUN} partiya ${i}`, p_original_physical_g: g, p_factory_markup_pct: 8, p_idempotency_key: `${RUN}-rc-${i}` }, 'factory_receipt');
    if (r.ok) { receipts.push({ id: r.data.receipt_id, left: g }); M.factoryObl = r4(M.factoryObl + r4(g * 1.08)); M.received += g; M.stock = r4(M.stock + g); }
  }
  // consignments: each seller gets 3 consignments of 8..12 pieces
  for (const s of SELLERS) {
    M.sellers[s.id] = { obligation: 0, settled: 0, till: { cash: 0, usd: 0, scrap: 0, phys: 0, grams: 0 }, consigned: 0, returned: 0 };
    const before = (await sel(`seller_gold_accounts?seller_id=eq.${s.id}&select=o:total_seller_obligation_g,st:total_settled_to_manager_g`))[0] || { o: 0, st: 0 };
    M.sellers[s.id].obligation = Number(before.o); M.sellers[s.id].settled = Number(before.st);
    for (let k = 0; k < 3; k++) {
      const pieces = Array.from({ length: 8 + Math.floor(rnd() * 5) }, (_, j) => ({ weight_grams: r4(between(2, 9)), model_code: `${RUN}-${s.tag}-${k}-${j}` }));
      const total = r4(pieces.reduce((a, p) => a + p.weight_grams, 0));
      const rc = receipts.find((x) => x.left >= total); if (!rc) continue;
      const r = await call('manager', 'rpc_issue_barcode_consignment', { p_seller_id: s.id, p_factory_markup_pct: 8, p_seller_markup_pct: s.markup, p_factory_receipt_id: rc.id, p_pieces: pieces }, 'consignment');
      if (!r.ok) continue;
      rc.left = r4(rc.left - total);
      M.stock = r4(M.stock - total); M.sellers[s.id].consigned = r4(M.sellers[s.id].consigned + total);
      M.sellers[s.id].obligation = r4(M.sellers[s.id].obligation + r4(total * (1 + s.markup / 100)));
      for (const p of r.data.pieces) M.pieces[p.id] = { seller: s.id, w: Number(p.weight_grams), status: 'held', markup: s.markup, code: p.model_code || pieces.find((x) => Math.abs(x.weight_grams - Number(p.weight_grams)) < 1e-9).model_code };
    }
  }
  // seller rates
  for (const s of SELLERS) {
    s.lom = pick([880000, 890000, 900000, 910000]); s.usd = pick([12500, 12600, 12700]);
    await call(s.tag, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: s.lom, p_usd_rate_uzs: s.usd, p_reason: 'volume start' }, 'seller_rate');
  }
  // customers through the 075 RPC, three sellers + manager in parallel
  const custJobs = [];
  for (const s of SELLERS) for (let i = 0; i < 8; i++) custJobs.push([s.tag, s.id, `${RUN} ${s.tag} mijoz ${i}`]);
  const created = await Promise.all(custJobs.map(([tag, sid, n]) => call(tag, 'rpc_create_customer_with_code', { p_contact_name: n }, 'customer_create').then((r) => ({ r, sid, n }))));
  for (const { r, sid } of created) if (r.ok) { M.customers[r.data.customer_id] = { seller: sid, net: 0, code: r.data.customer_code }; }
  const codes = created.filter((x) => x.r.ok).map((x) => x.r.data.customer_code);
  // per-seller workload, sellers in parallel
  const salesOf = {};
  async function sellerLoop(s) {
    const S = M.sellers[s.id]; salesOf[s.id] = [];
    const myCust = Object.entries(M.customers).filter(([, c]) => c.seller === s.id).map(([id]) => id);
    for (let step = 0; step < 70; step++) {
      const roll = rnd();
      const held = Object.entries(M.pieces).filter(([, p]) => p.seller === s.id && p.status === 'held');
      if (roll < 0.30 && held.length) { // barcode sale of a whole piece
        const [pid, p] = pick(held); const cust = pick(myCust); const m = Math.round(between(s.markup - 5, s.markup + 10));
        const r = await call(s.tag, 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: pid, p_client_markup_pct: m }, 'barcode_sale');
        if (r.ok) { const due = dueExact(p.w, m); M.customers[cust].net = r4(M.customers[cust].net + due); salesOf[s.id].push({ id: r.data.sale_id, cust, due, kind: 'barcode', pid, w: p.w }); p.status = 'sold';
          if (!(Math.abs(Number(r.data.client_gold_due_grams) - due) < 0.00005)) stats.unexpected_fail.push({ kind: 'due_mismatch', expected: due, got: r.data.client_gold_due_grams }); }
      } else if (roll < 0.50 && held.length) { // weight sale cut from one named piece
        const cand = held.filter(([, p]) => p.w >= 1.5); if (!cand.length) continue;
        const [pid, p] = pick(cand); const w = r4(Math.min(p.w, between(1, 5))); const cust = pick(myCust); const m = Math.round(between(s.markup - 3, s.markup + 8));
        const r = await call(s.tag, 'rpc_record_weight_sale', { p_customer_id: cust, p_weight_grams: w, p_client_markup_pct: m, p_piece_ids: [pid], p_idempotency_key: `${RUN}-ws-${s.tag}-${step}` }, 'weight_sale');
        if (r.ok) { const due = dueExact(w, m); M.customers[cust].net = r4(M.customers[cust].net + due); salesOf[s.id].push({ id: r.data.sale_id, cust, due, kind: 'weight', pid, w, whole: Math.abs(p.w - w) < 0.00005 });
          p.w = r4(p.w - w); if (p.w <= 0.00005) p.status = 'sold';
          if (!(Math.abs(Number(r.data.client_gold_due_grams) - due) < 0.00005)) stats.unexpected_fail.push({ kind: 'due_mismatch', expected: due, got: r.data.client_gold_due_grams }); }
      } else if (roll < 0.80) { // payment UZS / USD / scrap at the seller's current rate
        const cust = pick(myCust); const cash = rnd() < 0.8 ? Math.round(between(100000, 3000000) / 1000) * 1000 : 0; const usd = rnd() < 0.35 ? Math.round(between(10, 150)) : 0;
        const scrapW = rnd() < 0.2 ? r4(between(0.5, 3)) : 0; const proba = pick([585, 750]);
        if (!cash && !usd && !scrapW) continue;
        const args = { p_customer_id: cust, p_cash_amount: cash }; if (usd) args.p_usd_amount = usd; if (scrapW) { args.p_scrap_weight = scrapW; args.p_scrap_proba = proba; }
        const r = await call(s.tag, 'rpc_record_client_settlement', args, 'payment');
        if (r.ok) {
          const g = r4((cash ? cashExact(cash, s.lom) : 0) + (usd ? usdExact(usd, s.usd, s.lom) : 0) + (scrapW ? scrapExact(scrapW, proba) : 0));
          if (!(Math.abs(Number(r.data.total_settled_grams) - g) < 0.00005)) stats.unexpected_fail.push({ kind: 'payment_grams_mismatch', expected: g, got: r.data.total_settled_grams, cash, usd, scrapW, proba, lom: s.lom });
          M.customers[cust].net = r4(M.customers[cust].net - Number(r.data.total_settled_grams));
          S.till.cash += cash; S.till.usd += usd; S.till.scrap = r4(S.till.scrap + (scrapW ? scrapExact(scrapW, proba) : 0)); S.till.phys = r4(S.till.phys + scrapW); S.till.grams = r4(S.till.grams + Number(r.data.total_settled_grams));
        }
      } else if (roll < 0.86) { // seller changes rate (captured grams of earlier payments must not move)
        const lom = pick([880000, 890000, 900000, 910000, 920000]); const usd = pick([12400, 12500, 12600, 12700]);
        const r = await call(s.tag, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: lom, p_usd_rate_uzs: usd, p_reason: 'volume' }, 'seller_rate');
        if (r.ok) { s.lom = lom; s.usd = usd; }
      } else if (roll < 0.92 && salesOf[s.id].length) { // manager reverses a sale of this seller
        const sale = salesOf[s.id].splice(Math.floor(rnd() * salesOf[s.id].length), 1)[0];
        const r = await call('manager', 'rpc_reverse_client_sale', { p_sale_id: sale.id, p_reason: 'volume reversal', p_idempotency_key: `${RUN}-rev-${sale.id}` }, 'reversal');
        if (r.ok) { M.customers[sale.cust].net = r4(M.customers[sale.cust].net - sale.due); const p = M.pieces[sale.pid];
          if (sale.kind === 'barcode') p.status = 'held';
          else if (p.status === 'held') p.w = r4(p.w + sale.w);
          else if (sale.whole) { p.w = sale.w; p.status = 'held'; }
          else { // the cut part comes back as its own piece (073 _goldia_restore_weight_sale_allocations), grams conserved
            const fresh = (await sel(`consignment_pieces?organization_id=eq.${ORG}&model_code=eq.${encodeURIComponent(p.code)}&status=eq.held_by_seller&notes=like.Restored*&select=id,weight_grams`)).filter((x) => !M.pieces[x.id] && Math.abs(Number(x.weight_grams) - sale.w) < 0.00005);
            if (fresh.length) M.pieces[fresh[0].id] = { seller: p.seller, w: sale.w, status: 'held', markup: p.markup, code: p.code };
            else stats.unexpected_fail.push({ kind: 'restored_piece_not_found', sale: sale.id, grams: sale.w });
          } }
      } else if (roll < 0.95 && held.length) { // return a held piece to the manager
        const [pid, p] = pick(held);
        const r = await call(s.tag, 'rpc_return_piece_to_manager', { p_piece_id: pid, p_notes: 'volume return' }, 'piece_return');
        if (r.ok) { S.obligation = r4(S.obligation - r4(p.w * (1 + s.markup / 100))); S.returned = r4(S.returned + p.w); M.stock = r4(M.stock + p.w); p.status = 'returned'; }
      } else if (S.till.grams > 0) { // handover the whole till
        const till = (await sel(`seller_gold_accounts?seller_id=eq.${s.id}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,p:seller_till_scrap_physical_g`))[0];
        const tillMatches = Number(till.c) === S.till.cash && Number(till.u) === S.till.usd && Math.abs(Number(till.s) - S.till.scrap) < 0.00005;
        if (!tillMatches) stats.unexpected_fail.push({ kind: 'till_mismatch', seller: s.tag, model: S.till, db: till });
        const r = await call(s.tag, 'rpc_record_seller_to_manager_settlement', { p_seller_id: s.id, p_cash_paid_amount: Number(till.c), p_usd_paid_amount: Number(till.u), p_scrap_weight_grams: Number(till.s), p_physical_scrap_g: Number(till.p), p_idempotency_key: `${RUN}-ho-${s.tag}-${step}` }, 'handover');
        if (r.ok) {
          if (!(Math.abs(Number(r.data.total_settled_grams) - S.till.grams) < 0.00005)) stats.unexpected_fail.push({ kind: 'handover_grams_mismatch', seller: s.tag, expected: S.till.grams, got: r.data.total_settled_grams });
          S.settled = r4(S.settled + S.till.grams); M.cash += S.till.cash; M.usd += S.till.usd; S.till = { cash: 0, usd: 0, scrap: 0, phys: 0, grams: 0 };
        }
      }
    }
  }
  await Promise.all(SELLERS.map(sellerLoop));
  // final handovers so every till is closed
  for (const s of SELLERS) {
    const S = M.sellers[s.id]; if (!(S.till.grams > 0)) continue;
    const till = (await sel(`seller_gold_accounts?seller_id=eq.${s.id}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,p:seller_till_scrap_physical_g`))[0];
    const r = await call(s.tag, 'rpc_record_seller_to_manager_settlement', { p_seller_id: s.id, p_cash_paid_amount: Number(till.c), p_usd_paid_amount: Number(till.u), p_scrap_weight_grams: Number(till.s), p_physical_scrap_g: Number(till.p), p_idempotency_key: `${RUN}-ho-final-${s.tag}` }, 'handover');
    if (r.ok) { if (!(Math.abs(Number(r.data.total_settled_grams) - S.till.grams) < 0.00005)) stats.unexpected_fail.push({ kind: 'handover_grams_mismatch', seller: s.tag, expected: S.till.grams, got: r.data.total_settled_grams });
      S.settled = r4(S.settled + S.till.grams); M.cash += S.till.cash; M.usd += S.till.usd; S.till = { cash: 0, usd: 0, scrap: 0, phys: 0, grams: 0 }; }
  }
  // ---- comparison ----
  const diffs = []; let maxG = 0;
  const cmp = (what, exp, act, money = false) => { const d = Math.abs(Number(exp) - Number(act)); if (!money) maxG = Math.max(maxG, d); if (d > (money ? 0.5 : 0.00005)) diffs.push({ what, expected: exp, actual: Number(act) }); };
  const cg = Object.fromEntries((await sel(`client_gold_accounts?organization_id=eq.${ORG}&select=customer_id,d:current_debt_grams,a:advance_balance_grams`)).map((x) => [x.customer_id, x]));
  for (const [id, c] of Object.entries(M.customers)) { const row = cg[id] || { d: 0, a: 0 }; cmp(`customer ${c.code} net (debt - advance)`, c.net, Number(row.d) - Number(row.a)); }
  for (const s of SELLERS) {
    const S = M.sellers[s.id];
    const row = (await sel(`seller_gold_accounts?seller_id=eq.${s.id}&select=o:total_seller_obligation_g,st:total_settled_to_manager_g,ow:seller_owes_manager_g,ph:current_physical_stock_g,c:seller_till_cash_amount,u:seller_till_usd_amount,vc:till_valued_cash_585_g`))[0];
    const heldW = r4(Object.values(M.pieces).filter((p) => p.seller === s.id && p.status === 'held').reduce((a, p) => a + p.w, 0));
    cmp(`${s.tag} obligation`, S.obligation, row.o); cmp(`${s.tag} settled to manager`, S.settled, row.st); cmp(`${s.tag} owes manager`, r4(S.obligation - S.settled), row.ow);
    cmp(`${s.tag} physical stock`, heldW, row.ph); cmp(`${s.tag} till cash`, 0, row.c, true); cmp(`${s.tag} till usd`, 0, row.u, true); cmp(`${s.tag} till valued`, 0, row.vc);
  }
  const dbPieces = Object.fromEntries((await sel(`consignment_pieces?organization_id=eq.${ORG}&model_code=like.${RUN}*&select=id,weight_grams,status`)).map((p) => [p.id, p]));
  for (const [id, p] of Object.entries(M.pieces)) {
    const d = dbPieces[id]; const st = { held: 'held_by_seller', sold: 'sold', returned: 'returned_to_manager' }[p.status];
    if (!d || d.status !== st) diffs.push({ what: `piece ${id.slice(0, 8)} status`, expected: st, actual: d && d.status });
    if (p.status !== 'sold') cmp(`piece ${id.slice(0, 8)} weight`, p.w, d ? d.weight_grams : -1);
  }
  const extra = Object.keys(dbPieces).filter((id) => !M.pieces[id] && dbPieces[id].status === 'held_by_seller');
  if (extra.length) diffs.push({ what: 'held pieces unknown to the model', expected: 0, actual: extra.length });
  const activeSales = await sel(`jewelry_sales?organization_id=eq.${ORG}&status=not.in.(reversed,cancelled)&select=seller_id,base_weight_grams,created_at&created_at=gte.${encodeURIComponent(startedAt)}`);
  for (const s of SELLERS) {
    const held = Object.values(dbPieces).filter((x) => x.status === 'held_by_seller' && (M.pieces[x.id] || {}).seller === s.id).reduce((a, x) => a + Number(x.weight_grams), 0);
    const sold = activeSales.filter((x) => x.seller_id === s.id).reduce((a, x) => a + Number(x.base_weight_grams), 0);
    cmp(`${s.tag} grams conserved: held + sold + returned = consigned`, M.sellers[s.id].consigned, r4(held + sold + M.sellers[s.id].returned));
  }
  const v = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0];
  cmp('manager physical stock', M.stock, v.s); cmp('factory obligation', M.factoryObl, v.o); cmp('manager cash UZS', M.cash, v.c, true); cmp('manager USD', M.usd, v.u, true);
  const writes = Object.values(stats.ok).reduce((a, b) => a + b, 0);
  const result = { run: RUN, seed: SEED, successful_writes: writes, by_type: stats.ok, unexpected_failures: stats.unexpected_fail.length, failures: stats.unexpected_fail,
    customers: Object.keys(M.customers).length, pieces: Object.keys(M.pieces).length, distinct_customer_codes: new Set(codes).size, customer_codes_created: codes.length,
    max_gram_diff: maxG.toFixed(4), differences: diffs };
  fs.writeFileSync(`${__dirname}/../evidence/volume-${RUN}.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ ...result, failures: result.failures.slice(0, 8), differences: diffs.slice(0, 12) }, null, 1));
  console.log(diffs.length === 0 && stats.unexpected_fail.length === 0 ? 'VOLUME PASS' : 'VOLUME FAIL');
})().catch((e) => { console.error('FATAL', e.stack); process.exit(1); });
