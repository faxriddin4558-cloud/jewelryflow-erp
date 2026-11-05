// REAL STAGING (vouehtlmsunebracahon, schema 076, frontend 6956236): every 076 fix re-proved with real GoTrue JWTs through
// PostgREST (exactly the requests the UI sends). Synthetic audit organization A (audit.fx075.*) and organization B
// (directorB / managerB / sellerB1) only. Ground truth: service-role reads. Nothing from before 076 is reused.
const fs = require('fs'); const path = require('path');
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const OUT = path.join(__dirname, '..', 'evidence', 'staging-076-api.json');
const C = L.creds(); const ORG = L.ORG; const N = Number;
const U4 = (x) => Math.round(N(x) * 1e4); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const dh = (n, d) => Math.floor((2 * n + d) / (2 * d)); const dueOf = (w, m) => dh(U4(w) * (100 + m), 100) / 1e4;
const R = []; const OPS = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act, at: new Date().toISOString() }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 230)}`); return !!ok; };
const op = (e) => { OPS.push({ at: new Date().toISOString(), ...e }); return e; };
const sid = (t) => C[t].id;
const acc = async (c) => { const a = (await L.sel(`client_gold_accounts?customer_id=eq.${c}&select=d:current_debt_grams,a:advance_balance_grams`))[0]; return { d: a ? N(a.d) : 0, a: a ? N(a.a) : 0 }; };
const sacc = async (t) => (await L.sel(`seller_gold_accounts?seller_id=eq.${sid(t)}&select=st:current_physical_stock_g,l:seller_legacy_debt_obligation_g,o:total_seller_obligation_g`))[0] || { st: 0, l: 0, o: 0 };
const held = async (t) => L.sel(`consignment_pieces?seller_id=eq.${sid(t)}&status=eq.held_by_seller&select=id,weight_grams,consignment_id&order=created_at.asc,id.asc`);
const heldG = async (t) => r4((await held(t)).reduce((x, y) => x + N(y.weight_grams), 0));
const vault = async () => (await L.sel(`manager_vault_account?organization_id=eq.${ORG}&select=s:manager_physical_stock_g,o:current_factory_obligation_g,c:manager_cash_amount`))[0];
const legRows = async (c) => L.sel(`client_legacy_debts?customer_id=eq.${c}&select=id,delta_585_g,status,entry_type,created_at&order=created_at.asc`);
const denied = (r) => !r.ok && (r.code === '42501' || /Ruxsat etilmadi|Permission denied/i.test(r.error || ''));
(async () => {
  const run = Date.now().toString(36); const today = L.tashkentToday();
  const mk = async (who, name) => { const r = await L.rpc(who, 'rpc_create_customer_with_code', { p_contact_name: `${name} S76 ${run}` }); if (!r.ok) throw new Error(`customer ${who}: ${r.error}`); op({ what: 'customer', by: who, id: r.data.customer_id }); return r.data.customer_id; };
  const leg = (who, c, extra = {}) => L.rpc(who, 'rpc_record_client_legacy_debt', { p_customer_id: c, p_balance_type: 'debt', p_amount_585_g: 206.83, p_as_of_date: today, p_notes: 'S76', p_entry_type: 'manual_addition', p_target_final_balance: null, p_idempotency_key: `S76-${run}-${Math.random().toString(36).slice(2)}`, ...extra });
  const cA = await mk('sellera', 'A1'), cA2 = await mk('sellera', 'A2'), cB = await mk('sellerb', 'B1'), cAp = await mk('sellera', 'Apar');
  // ================= 1 + 2 + 7: legacy debt =================
  const v0 = await vault(); const sa0 = await sacc('sellera');
  const K = `S76-LEG-${run}`;
  const l1 = await leg('sellera', cA, { p_idempotency_key: K }); op({ what: 'legacy 206.83 seller', id: l1.ok ? l1.data.legacy_debt_id : null, error: l1.error });
  T('S76-01', 'seller enters 206.83 g legacy debt for his own customer (075: permission denied)', l1.ok && (await acc(cA)).d === 206.83, 206.83, l1.ok ? await acc(cA) : l1.error);
  const sa1 = await sacc('sellera');
  T('S76-02', 'seller legacy obligation +206.83 g; gram stock unchanged', r4(N(sa1.l) - N(sa0.l)) === 206.83 && N(sa1.st) === N(sa0.st), { l: 206.83 }, { l: r4(N(sa1.l) - N(sa0.l)), st0: sa0.st, st1: sa1.st });
  T('S76-03', 'vault stock, factory obligation and manager cash untouched by legacy debt', JSON.stringify(v0) === JSON.stringify(await vault()), v0, await vault());
  const l2 = await leg('sellera', cA, { p_idempotency_key: K });
  T('S76-04', 'retry with the SAME key -> same legacy row, debt stays 206.83', l2.ok && l2.data.legacy_debt_id === l1.data.legacy_debt_id && (await acc(cA)).d === 206.83, l1.data.legacy_debt_id, l2.ok ? l2.data.legacy_debt_id : l2.error);
  const l3 = await leg('sellera', cA);
  T('S76-05', 'same addition with a NEW key within 10 min -> refused (double click / retry)', !l3.ok && /Takroriy/.test(l3.error) && (await acc(cA)).d === 206.83, 'refused', l3.ok ? 'ACCEPTED' : l3.error.slice(0, 80));
  const par = await Promise.all([...Array(6)].map(() => leg('sellera', cAp, { p_amount_585_g: 12.5 })));
  T('S76-06', '6 parallel identical additions with different keys -> exactly one', par.filter((x) => x.ok).length === 1 && (await acc(cAp)).d === 12.5, 1, { ok: par.filter((x) => x.ok).length, debt: (await acc(cAp)).d });
  const par2 = await Promise.all([...Array(6)].map(() => leg('sellera', cAp, { p_amount_585_g: 3, p_idempotency_key: `S76-SAME-${run}` })));
  T('S76-07', '6 parallel requests with one key -> one row, all answers the same id', par2.every((x) => x.ok) && new Set(par2.map((x) => x.data.legacy_debt_id)).size === 1 && (await acc(cAp)).d === 15.5, 15.5, { ok: par2.filter((x) => x.ok).length, debt: (await acc(cAp)).d });
  const xB = await leg('sellera', cB, { p_amount_585_g: 5 });
  T('S76-08', "seller cannot add legacy debt to another seller's customer", denied(xB) && (await acc(cB)).d === 0, '42501', xB.ok ? 'ACCEPTED' : `${xB.code} ${xB.error.slice(0, 70)}`);
  const xAdv = await leg('sellera', cA, { p_balance_type: 'advance', p_amount_585_g: 5 });
  T('S76-09', 'seller cannot enter an advance', denied(xAdv), '42501', xAdv.ok ? 'ACCEPTED' : xAdv.code);
  const xDown = await leg('sellera', cA, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: 150 });
  T('S76-10', 'seller cannot reconcile DOWN (would lower his own obligation)', denied(xDown) && (await acc(cA)).d === 206.83, '42501', xDown.ok ? 'ACCEPTED' : xDown.error.slice(0, 80));
  const up = await leg('sellera', cA, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: 250.0001 });
  T('S76-11', 'seller may reconcile UP to the notebook (250.0001, delta 43.1701)', up.ok && (await acc(cA)).d === 250.0001 && N(up.data.delta_585_g) === 43.1701, 43.1701, up.ok ? up.data.delta_585_g : up.error);
  const xSel = await leg('sellera', cA, { p_seller_id: sid('sellerb'), p_amount_585_g: 1 });
  T('S76-12', 'seller cannot book the debt on another seller', denied(xSel), '42501', xSel.ok ? 'ACCEPTED' : xSel.code);
  const m1 = await leg('manager', cB, { p_amount_585_g: 7.25 });
  T('S76-13', "manager enters legacy debt for seller B's customer (075: permission denied)", m1.ok && (await acc(cB)).d === 7.25, 7.25, m1.ok ? (await acc(cB)).d : m1.error);
  const mAdv = await leg('manager', cA2, { p_balance_type: 'advance', p_amount_585_g: 4 });
  T('S76-14', 'manager may enter an advance', mAdv.ok && (await acc(cA2)).a === 4, 4, mAdv.ok ? (await acc(cA2)).a : mAdv.error);
  for (const who of ['directorB', 'managerB', 'sellerB1']) { if (!C[who]) continue; const r = await leg(who, cA, { p_amount_585_g: 1 }); T(`S76-15-${who}`, `${who} (organization B) cannot touch organization A's customer`, !r.ok && (await acc(cA)).d === 250.0001, 'refused', r.ok ? 'ACCEPTED' : r.error.slice(0, 60)); }
  for (const who of ['worker', 'noemp']) { if (!C[who]) continue; const r = await leg(who, cA, { p_amount_585_g: 1 }); T(`S76-16-${who}`, `${who} cannot enter legacy debt`, !r.ok, 'refused', r.ok ? 'ACCEPTED' : r.error.slice(0, 60)); }
  const dIns = await L.uwrite('sellera', 'POST', 'client_legacy_debts', { organization_id: ORG, customer_id: cA, seller_id: sid('sellera'), balance_type: 'debt', amount_585_g: 1, as_of_date: today });
  T('S76-17', 'direct INSERT into client_legacy_debts by a seller refused (RPC only)', !dIns.ok, 'refused', dIns.ok ? 'ACCEPTED' : dIns.error.slice(0, 60));
  // reversal: seller refused; manager must reverse newer reconciliation first; recalc
  const rvS = await L.rpc('sellera', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: l1.data.legacy_debt_id, p_reason: 'x' });
  T('S76-18', 'seller cannot reverse a legacy entry', denied(rvS), '42501', rvS.ok ? 'ACCEPTED' : rvS.code);
  const rvBlk = await L.rpc('manager', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: l1.data.legacy_debt_id, p_reason: 'xato' });
  T('S76-19', 'reversing an entry under a newer reconciliation is refused (no invented advance)', !rvBlk.ok && /keyingi qayta solishtirish/.test(rvBlk.error), 'refused', rvBlk.ok ? 'ACCEPTED' : rvBlk.error.slice(0, 70));
  const recs = (await legRows(cA)).filter((x) => x.entry_type === 'reconciliation_adjustment' && x.status !== 'reversed').reverse();
  for (const x of recs) await L.rpc('manager', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: x.id, p_reason: 'qayta solishtirish bekor' });
  const saB = await sacc('sellera');
  const rvM = await L.rpc('manager', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: l1.data.legacy_debt_id, p_reason: 'xato kiritilgan' });
  const saC = await sacc('sellera');
  T('S76-20', 'manager reverses the 206.83 g entry: customer back to 0 / 0 (075: permission denied)', rvM.ok && (await acc(cA)).d === 0 && (await acc(cA)).a === 0, { d: 0, a: 0 }, rvM.ok ? await acc(cA) : rvM.error);
  T('S76-21', 'seller obligation recalculated after the reversal (-206.83 g; 075 kept it)', r4(N(saB.l) - N(saC.l)) === 206.83, 206.83, r4(N(saB.l) - N(saC.l)));
  const rv2 = await L.rpc('manager', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: l1.data.legacy_debt_id, p_reason: 'yana' });
  T('S76-22', 'second reversal refused', !rv2.ok, 'refused', rv2.ok ? 'ACCEPTED' : rv2.error.slice(0, 60));
  // ================= 3 + 4 + 6: gram sale without a product, FIFO, stock =================
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const consIds = [];
  for (const [k, w0] of [[0, 4.25], [1, 5.1]]) {
    const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `S76 ${run} ${k}`, p_original_physical_g: 150, p_factory_markup_pct: [8, 10][k] });
    const ps = [...Array(15)].map((_, i) => ({ weight_grams: r4(w0 + (i % 5) * 1.15), model_code: `S76-${run}-${k}-${i}` }));
    const cs = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: sid('sellera'), p_factory_markup_pct: [8, 10][k], p_seller_markup_pct: 12, p_factory_receipt_id: rc.data.receipt_id, p_pieces: ps, p_idempotency_key: `S76-CONS-${run}-${k}` });
    op({ what: 'receipt+consignment', receipt: rc.ok && rc.data.receipt_id, consignment: cs.ok && cs.data.consignment_id, grams: r4(ps.reduce((a, p) => a + p.weight_grams, 0)), error: rc.error || cs.error });
    if (cs.ok) consIds.push(cs.data.consignment_id);
  }
  const cS = await mk('sellera', 'Sale100');
  const st0 = N((await sacc('sellera')).st); const h0 = await heldG('sellera');
  T('S76-30', 'before: seller gram stock = held barcode piece grams', Math.abs(st0 - h0) < 1e-9, st0, h0);
  const heldBefore = await held('sellera');
  const s100 = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cS, p_weight_grams: 100, p_client_markup_pct: 12, p_idempotency_key: `S76-WS100-${run}` });
  op({ what: 'weight sale 100 g @12 %', id: s100.ok ? s100.data.sale_id : null, error: s100.error });
  T('S76-31', 'seller sells 100 g @ 12 % WITHOUT choosing a product (075: ERR_PIECE_REQUIRED)', s100.ok, 'ok', s100.ok ? s100.data.sale_no : s100.error);
  if (s100.ok) {
    T('S76-32', 'customer debt = 112 g (12 % on the base 100 g)', N(s100.data.client_gold_due_grams) === 112 && (await acc(cS)).d === 112, 112, { due: s100.data.client_gold_due_grams, debt: (await acc(cS)).d });
    const st1 = N((await sacc('sellera')).st); const h1 = await heldG('sellera');
    T('S76-33', 'gram stock -100 g and held pieces -100 g (pieces == grams)', r4(st0 - st1) === 100 && r4(h0 - h1) === 100 && Math.abs(st1 - h1) < 1e-9, 100, { stock: r4(st0 - st1), pieces: r4(h0 - h1) });
    const al = await L.sel(`weight_sale_allocations?sale_id=eq.${s100.data.sale_id}&select=piece_id,grams,fully_consumed,consignment_id`);
    T('S76-34', 'allocations: sum 100 g, at most one piece cut', r4(al.reduce((a, x) => a + N(x.grams), 0)) === 100 && al.filter((x) => !x.fully_consumed).length <= 1, { g: 100, cut: '<=1' }, { g: r4(al.reduce((a, x) => a + N(x.grams), 0)), n: al.length, cut: al.filter((x) => !x.fully_consumed).length });
    // FIFO across consignments: every consignment older than the newest one used must be empty afterwards (except the one cut piece)
    const order = [...new Set(heldBefore.map((p) => p.consignment_id))];
    const used = new Set(al.map((x) => x.consignment_id)); const lastUsed = Math.max(...order.map((c, i) => (used.has(c) ? i : -1)));
    const heldAfter = await held('sellera'); const cutPiece = (al.find((x) => !x.fully_consumed) || {}).piece_id;
    const leftOlder = heldAfter.filter((p) => order.indexOf(p.consignment_id) < lastUsed && p.id !== cutPiece).length;
    T('S76-35', 'FIFO: older consignments are emptied before a newer one is used', leftOlder === 0, 0, { leftInOlder: leftOlder, consignmentsUsed: used.size });
    const again = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cS, p_weight_grams: 100, p_client_markup_pct: 12, p_idempotency_key: `S76-WS100-${run}` });
    T('S76-36', 'retry with the same key returns the same sale, nothing deducted twice', again.ok && again.data.sale_id === s100.data.sale_id && N((await sacc('sellera')).st) === st1, s100.data.sale_id, again.ok ? again.data.sale_id : again.error);
    const soldPiece = al.find((x) => x.fully_consumed);
    const bs = soldPiece ? await L.rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cS, p_piece_id: soldPiece.piece_id, p_client_markup_pct: 10 }) : { ok: true };
    T('S76-37', 'a piece consumed by the gram sale cannot be sold again by barcode', !bs.ok, 'refused', bs.ok ? 'ACCEPTED' : bs.error.slice(0, 70));
  }
  const cM = await mk('sellera', 'Markups'); let expM = 0;
  for (const m of [10, 12, 15, 25, 30, 35]) {
    const r = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cM, p_weight_grams: 1.37, p_client_markup_pct: m });
    expM = r4(expM + dueOf(1.37, m));
    T(`S76-38-${m}`, `${m} % on 1.37 g = ${dueOf(1.37, m)} g (no markup on markup)`, r.ok && N(r.data.client_gold_due_grams) === dueOf(1.37, m), dueOf(1.37, m), r.ok ? N(r.data.client_gold_due_grams) : r.error);
  }
  T('S76-39', 'customer debt = exact sum of the six sales', (await acc(cM)).d === expM, expM, (await acc(cM)).d);
  const stN = N((await sacc('sellera')).st);
  const over = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cM, p_weight_grams: r4(stN + 0.0001), p_client_markup_pct: 10 });
  T('S76-40', 'selling 0.0001 g more than the stock is refused (no negative stock)', !over.ok && /ERR_INSUFFICIENT/.test(over.error), 'refused', over.ok ? 'ACCEPTED' : over.error.slice(0, 50));
  for (const [n, a] of [['zero', { p_weight_grams: 0, p_client_markup_pct: 10 }], ['negative', { p_weight_grams: -1, p_client_markup_pct: 10 }], ['markup101', { p_weight_grams: 1, p_client_markup_pct: 101 }], ['markupNull', { p_weight_grams: 1, p_client_markup_pct: null }]]) {
    const r = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cM, ...a }); T(`S76-41-${n}`, `invalid sale (${n}) refused`, !r.ok, 'refused', r.ok ? 'ACCEPTED' : r.error.slice(0, 50));
  }
  const xw = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cB, p_weight_grams: 0.5, p_client_markup_pct: 10 });
  T('S76-42', "seller cannot sell BY WEIGHT to another seller's customer via the API (075 accepted)", denied(xw), '42501', xw.ok ? 'ACCEPTED' : `${xw.code} ${xw.error.slice(0, 60)}`);
  const hp = await held('sellera');
  const xbc = hp[0] ? await L.rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cB, p_piece_id: hp[0].id, p_client_markup_pct: 10 }) : { ok: true };
  T('S76-43', "seller cannot sell a BARCODE piece to another seller's customer via the API (075 accepted)", denied(xbc), '42501', xbc.ok ? 'ACCEPTED' : `${xbc.code} ${String(xbc.error).slice(0, 60)}`);
  const cP = await mk('sellera', 'Parallel'); const sp0 = N((await sacc('sellera')).st);
  const ps = await Promise.all([...Array(12)].map((_, i) => L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cP, p_weight_grams: 3, p_client_markup_pct: 10, p_idempotency_key: `S76-PAR-${run}-${i}` })));
  const okN = ps.filter((x) => x.ok).length; const sp1 = N((await sacc('sellera')).st); const hp1 = await heldG('sellera');
  T('S76-44', '12 parallel 3 g sales: stock decrease = accepted x 3 g, stock >= 0, pieces == grams', r4(sp0 - sp1) === r4(okN * 3) && sp1 >= 0 && Math.abs(sp1 - hp1) < 1e-9 && (await acc(cP)).d === r4(okN * 3.3), { dec: r4(okN * 3) }, { ok: okN, dec: r4(sp0 - sp1), stock: sp1, pieces: hp1, debt: (await acc(cP)).d });
  const pk = await Promise.all([...Array(8)].map(() => L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cP, p_weight_grams: 0.77, p_client_markup_pct: 12, p_idempotency_key: `S76-PK-${run}` })));
  T('S76-45', '8 parallel requests with ONE idempotency key -> exactly one sale', new Set(pk.filter((x) => x.ok).map((x) => x.data.sale_id)).size === 1, 1, { ok: pk.filter((x) => x.ok).length, distinct: new Set(pk.filter((x) => x.ok).map((x) => x.data.sale_id)).size });
  if (s100.ok) {
    const sR0 = N((await sacc('sellera')).st); const hR0 = await heldG('sellera'); const dR0 = (await acc(cS)).d;
    const rv = await L.rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: s100.data.sale_id, p_reason: 'qaytdi' });
    T('S76-46', 'manager reverses the 100 g sale: stock +100, pieces +100, debt -112', rv.ok && r4(N((await sacc('sellera')).st) - sR0) === 100 && r4((await heldG('sellera')) - hR0) === 100 && r4(dR0 - (await acc(cS)).d) === 112, { stock: 100, pieces: 100, debt: -112 }, rv.ok ? { stock: r4(N((await sacc('sellera')).st) - sR0), pieces: r4((await heldG('sellera')) - hR0) } : rv.error);
    const rv2s = await L.rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: s100.data.sale_id, p_reason: 'yana' });
    T('S76-47', 'second sale reversal refused', !rv2s.ok, 'refused', rv2s.ok ? 'ACCEPTED' : rv2s.error.slice(0, 50));
  }
  // ================= 5: cash reversal + downward reconciliation of a SALES debt =================
  const cap = await L.rpc('director', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 5000, p_currency: 'UZS', p_category: 'S76' });
  const cash0 = N((await vault()).c);
  const ex = await L.rpc('manager', 'rpc_record_financial_transaction', { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 1000, p_currency: 'UZS', p_category: 'S76', p_notes: 'S76' });
  const exId = ex.ok ? (ex.data.transaction_id || ex.data.id) : null;
  const fr = exId ? await L.rpc('manager', 'rpc_reverse_financial_transaction', { p_transaction_id: exId, p_reason: 'S76 xato' }) : ex;
  T('S76-50', 'manager reverses a cash expense with the UI call {p_transaction_id, p_reason} (075: HTTP 300 PGRST203 for every role)', cap.ok && fr.ok && N((await vault()).c) === cash0, { cash: cash0 }, fr.ok ? { cash: N((await vault()).c) } : `${fr.status} ${fr.error}`);
  const fr2 = exId ? await L.rpc('manager', 'rpc_reverse_financial_transaction', { p_transaction_id: exId, p_reason: 'yana' }) : { ok: true };
  T('S76-51', 'second cash reversal refused, cash not changed twice', !fr2.ok && N((await vault()).c) === cash0, 'refused', fr2.ok ? 'ACCEPTED' : fr2.error.slice(0, 60));
  const frS = exId ? await L.rpc('sellera', 'rpc_reverse_financial_transaction', { p_transaction_id: exId, p_reason: 'x' }) : { ok: true };
  T('S76-52', 'seller cannot reverse a cash operation', !frS.ok, 'refused', frS.ok ? 'ACCEPTED' : frS.error.slice(0, 50));
  // a SALES debt reconciled down to the notebook by the manager (075: check constraint error)
  const cR = await mk('sellerc', 'Recon');
  const sr = await L.rpc('sellerc', 'rpc_record_weight_sale', { p_customer_id: cR, p_weight_grams: 2, p_client_markup_pct: 10 });
  if (!sr.ok) { // sellerc may have no stock: give him one piece
    const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `S76 recon ${run}`, p_original_physical_g: 10, p_factory_markup_pct: 8 });
    await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: sid('sellerc'), p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.data.receipt_id, p_pieces: [{ weight_grams: 5 }] });
  }
  const sr2 = sr.ok ? sr : await L.rpc('sellerc', 'rpc_record_weight_sale', { p_customer_id: cR, p_weight_grams: 2, p_client_markup_pct: 10 });
  const tgt = r4((await acc(cR)).d - 1);
  const rdown = await leg('manager', cR, { p_entry_type: 'reconciliation_adjustment', p_amount_585_g: 0, p_target_final_balance: tgt });
  const lc = await sacc('sellerc');
  T('S76-53', `manager reconciles a SALES debt down by 1 g to the notebook (${tgt} g) - no constraint error (075 failed)`, sr2.ok && rdown.ok && (await acc(cR)).d === tgt && N(lc.l) >= 0, tgt, rdown.ok ? { debt: (await acc(cR)).d, sellerLegacy: lc.l } : rdown.error);
  // ================= 7: session refresh / logout =================
  {
    const t = 'sellerb'; const c = C[t];
    const lg = await fetch(`${L.URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: L.KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) }).then((r) => r.json());
    const rf = await fetch(`${L.URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: L.KEY, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: lg.refresh_token }) }).then((r) => r.json());
    const use = await fetch(`${L.URL}/rest/v1/rpc/rpc_get_seller_rates`, { method: 'POST', headers: { apikey: L.KEY, Authorization: `Bearer ${rf.access_token}`, 'content-type': 'application/json' }, body: '{}' });
    T('S76-60', 'refresh token gives a working new session', !!rf.access_token && use.ok, true, { refreshed: !!rf.access_token, status: use.status });
    const reuse = await fetch(`${L.URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: L.KEY, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: lg.refresh_token }) });
    op({ what: 'reuse of a rotated refresh token', status: reuse.status });
    const lo = await fetch(`${L.URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: L.KEY, Authorization: `Bearer ${rf.access_token}` } });
    const after = await fetch(`${L.URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: L.KEY, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: rf.refresh_token }) });
    T('S76-61', 'after logout the refresh token no longer works', lo.status < 300 && !after.ok, 'refused', { logout: lo.status, refreshAfterLogout: after.status });
  }
  fs.writeFileSync(OUT, JSON.stringify({ target: 'staging', schema: '076', frontend: '6956236', run, results: R, ops: OPS }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
