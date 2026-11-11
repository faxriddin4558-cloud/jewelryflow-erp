// 083 partial / full customer returns with real GoTrue logins through PostgREST (GA_TARGET=local | staging, synthetic org).
// Every expected value is computed here independently from the sale's own numbers (never read back from the return).
//   RT-W    100 g @12 % weight sale: return 20 g -> 22.4 g off the debt, sale stays 100 g, seller stock +20 g, 20 g held piece
//   RT-RPT  further partial returns 30 g + 50 g (last takes the exact remainder: 112 - 22.4 - 33.6 = 56); over-return and
//           return of a fully returned sale refused
//   RT-PAID fully paid sale: return -> 0 debt reduction, the value becomes an advance (no negative debt, no cash)
//   RT-PART partially paid: debt part + advance part split exactly
//   RT-ADV  customer with an applied advance: the full return restores debt part + advance part
//   RT-USD / RT-UZS  currency sales: 3 returns of 1 g each add up EXACTLY to the original amount (cents / tiyin)
//   RT-PC   barcode piece: partial refused, whole piece back on the shelf, second return refused
//   RT-MGR  manager receives the goods: seller stock unchanged, manager stock +w, seller obligation -w x (1 + markup)
//   RT-SEC  other seller, seller -> "manager", other organization, anon, no key, 0 / negative weight: refused, no change
//   RT-IDEM same key twice -> one document (replay); 8 parallel same key -> 1; 8 parallel different keys -> no over-return
//   RT-REV  a sale with returns cannot be reversed as a whole; a sale without returns still can (076-081 rule unchanged)
//   RT-REC  reconciliation: stock = held pieces, unified ledger / monthly report / period report = live accounts,
//           markup report = sale - returned share, seller obligations unchanged by seller-side returns
const fs = require('fs'); const path = require('path');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const OB = TARGET === 'staging' ? (process.env.GA_OTHER_DIRECTOR || 'directorB') : 'director56'; // PHASE D: another synthetic org (C), B stays read-only
const OUT = process.env.GA_OUT || path.join(__dirname, '..', 'evidence', `${TARGET}-ret-083.json`);
const N = (x) => Number(x || 0); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4; const r2 = (x) => Math.round(N(x) * 100) / 100;
const R = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 280)}`); };
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.status} ${r.error}`); return r.data; };
(async () => {
  let mgrObl = null;
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday(); let kn = 0; const key = (t) => `rt83-${t}-${run}-${++kn}`;
  const accG = async (c) => { const a = (await L.sel(`client_gold_accounts?customer_id=eq.${c}&select=d:current_debt_grams,a:advance_balance_grams`))[0]; return a ? { d: r4(a.d), a: r4(a.a) } : { d: 0, a: 0 }; };
  const accC = async (c, cur) => { const a = (await L.sel(`client_currency_accounts?customer_id=eq.${c}&currency=eq.${cur}&select=d:debt_amount,a:advance_amount`))[0]; return a ? { d: r2(a.d), a: r2(a.a) } : { d: 0, a: 0 }; };
  const seller = async (s) => { const a = (await L.sel(`seller_gold_accounts?seller_id=eq.${C[s].id}&select=st:current_physical_stock_g,o:total_seller_obligation_g,l:seller_legacy_debt_obligation_g`))[0] || {}; const held = (await L.sel(`consignment_pieces?seller_id=eq.${C[s].id}&status=eq.held_by_seller&select=weight_grams`)).reduce((x, y) => x + N(y.weight_grams), 0); return { st: r4(a.st), o: r4(a.o), held: r4(held) }; };
  const mgrStock = async () => r4((await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=m:manager_physical_stock_g`))[0]?.m);
  const ret = (who, sale, w, extra = {}) => L.rpc(who, 'rpc_record_sale_return', { p_sale_id: sale, p_weight_grams: w, p_reason: 'RT83 test', p_destination: 'seller', p_idempotency_key: key('r'), ...extra });
  const cust = async (s, n) => must(await L.rpc(s, 'rpc_create_customer_with_code', { p_contact_name: `RT83 ${n} ${run}` }), 'customer').customer_id;
  const wsale = async (s, c, g, pct) => must(await L.rpc(s, 'rpc_record_weight_sale', { p_customer_id: c, p_seller_id: C[s].id, p_weight_grams: g, p_client_markup_pct: pct, p_idempotency_key: key('s') }), 'weight sale').sale_id;
  const saleRow = async (id) => (await L.sel(`jewelry_sales?id=eq.${id}&select=base_weight_grams,client_gold_due_grams,sale_amount,status,markup_difference_g`))[0];

  must(await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today }), 'rate');
  for (const s of ['sellera', 'sellerb']) await L.rpc(s, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12500, p_reason: 'rt83' });
  const rc = must(await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `RT83 ${run}`, p_original_physical_g: 300, p_factory_markup_pct: 8 }), 'receipt');
  must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.receipt_id, p_pieces: Array(22).fill({ weight_grams: 10 }) }), 'consignment a');
  const cb = must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellerb.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.receipt_id, p_pieces: Array(4).fill({ weight_grams: 10 }) }), 'consignment b');
  const s0 = await seller('sellera'); const sb0 = await seller('sellerb');

  // ---------------- RT-W: 100 g @12 %, return 20 g
  const C1 = await cust('sellera', 'W100'); const W1 = await wsale('sellera', C1, 100, 12);
  const a1 = await accG(C1); const sA = await seller('sellera');
  const r1 = await ret('sellera', W1, 20);
  const a1b = await accG(C1); const sA1 = await seller('sellera'); const sale1 = await saleRow(W1);
  T('RT-W-1', '100 g @12 % (112 g due): return 20 g -> debt -22.4 g; sale document still 100 g / 112 g; return document 20 g / 22.4 g',
    r1.ok && r4(a1.d - a1b.d) === 22.4 && r4(sale1.base_weight_grams) === 100 && r4(sale1.client_gold_due_grams) === 112 && r4(r1.data.returned_due_g585) === 22.4 && r4(r1.data.remaining_sale_weight_g) === 80,
    { debtDown: 22.4, sale: [100, 112], remaining: 80 }, r1.ok ? { debtDown: r4(a1.d - a1b.d), sale: [sale1.base_weight_grams, sale1.client_gold_due_grams], ret: r1.data } : r1.error);
  T('RT-W-2', 'seller stock +20 g = held pieces; consignment obligation unchanged (seller holds the goods again)', r4(sA1.st - sA.st) === 20 && sA1.st === sA1.held && sA1.o === sA.o, { stock: 20, obligation: 'same' }, { stock: r4(sA1.st - sA.st), held: sA1.held, st: sA1.st, o: [sA.o, sA1.o] });
  // ---------------- RT-RPT
  const r2r = await ret('sellera', W1, 30); const r3r = await ret('manager', W1, 50);
  const over = await ret('sellera', W1, 1); const a1c = await accG(C1);
  const rows1 = await L.sel(`jewelry_sale_returns?sale_id=eq.${W1}&select=returned_weight_grams,client_gold_due_returned_g,return_no&order=created_at`);
  T('RT-RPT-1', 'returns 20 + 30 + 50 g: values 22.4 + 33.6 + 56.0 = 112.0 exactly (last = remainder); debt 0', r2r.ok && r3r.ok && rows1.map((x) => r4(x.client_gold_due_returned_g)).join() === '22.4,33.6,56' && r4(rows1.reduce((a, x) => a + N(x.client_gold_due_returned_g), 0)) === 112 && a1c.d === 0 && a1c.a === 0,
    [22.4, 33.6, 56], { rows: rows1.map((x) => [x.return_no, r4(x.returned_weight_grams), r4(x.client_gold_due_returned_g)]), acc: a1c, e: [r2r.error, r3r.error] });
  T('RT-RPT-2', 'fully returned sale: next return refused', !over.ok && /to'liq qaytarilgan/.test(over.error), 'refused', over.error);
  const C1b = await cust('sellera', 'Over'); const W1b = await wsale('sellera', C1b, 10, 10);
  await ret('sellera', W1b, 4); const ov = await ret('sellera', W1b, 7);
  T('RT-RPT-3', 'over-return (7 g of the 6 g left) refused, nothing changed', !ov.ok && /oshadi/.test(ov.error) && (await accG(C1b)).d === r4(11 - 4.4), 'refused', { e: ov.error, acc: await accG(C1b) });
  // ---------------- RT-PAID
  const C2 = await cust('sellera', 'Paid'); const W2 = await wsale('sellera', C2, 10, 10);
  must(await L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: C2, p_cash_amount: 9900000, p_rate_per_gram: 900000 }), 'pay C2');
  const p2 = await ret('sellera', W2, 5); const a2 = await accG(C2);
  T('RT-PAID', 'fully paid 11 g: return 5 g (5.5 g) -> debt reduction 0, advance 5.5 g (no negative debt, no cash)', p2.ok && r4(p2.data.debt_reduced) === 0 && r4(p2.data.advance_created) === 5.5 && a2.d === 0 && a2.a === 5.5, { d: 0, a: 5.5 }, p2.ok ? { acc: a2, ret: [p2.data.debt_reduced, p2.data.advance_created] } : p2.error);
  // ---------------- RT-PART
  const C3 = await cust('sellera', 'Part'); const W3 = await wsale('sellera', C3, 10, 10);
  must(await L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: C3, p_cash_amount: 5400000, p_rate_per_gram: 900000 }), 'pay C3');
  const p3 = await ret('sellera', W3, 6); const a3 = await accG(C3);
  T('RT-PART', 'partly paid (debt 5 g): return 6 g (6.6 g) -> 5 g debt reduction + 1.6 g advance', p3.ok && r4(p3.data.debt_reduced) === 5 && r4(p3.data.advance_created) === 1.6 && a3.d === 0 && a3.a === 1.6, { reduced: 5, advance: 1.6 }, p3.ok ? { acc: a3, ret: [p3.data.debt_reduced, p3.data.advance_created] } : p3.error);
  // ---------------- RT-ADV
  const C4 = await cust('sellera', 'Adv');
  must(await L.rpc('sellera', 'rpc_record_client_legacy_debt', { p_customer_id: C4, p_balance_type: 'advance', p_amount_585_g: 3, p_as_of_date: today, p_notes: 'RT83', p_entry_type: 'manual_addition', p_target_final_balance: null, p_idempotency_key: key('adv') }), 'adv C4');
  const W4 = await wsale('sellera', C4, 10, 10); const a4a = await accG(C4);
  const p4 = await ret('sellera', W4, 10); const a4 = await accG(C4);
  T('RT-ADV', 'advance 3 g used by an 11 g sale (debt 8): full return -> 8 g debt off + 3 g advance back', a4a.d === 8 && p4.ok && r4(p4.data.debt_reduced) === 8 && r4(p4.data.advance_created) === 3 && a4.d === 0 && a4.a === 3, { before: 8, after: { d: 0, a: 3 } }, p4.ok ? { before: a4a, after: a4 } : p4.error);
  // ---------------- RT-USD / RT-UZS
  for (const [cur, amount] of [['USD', 100], ['UZS', 1000001]]) {
    const Cc = await cust('sellerb', cur); const sc = must(await L.rpc('sellerb', 'rpc_record_currency_sale', { p_customer_id: Cc, p_seller_id: C.sellerb.id, p_currency: cur, p_amount: amount, p_weight_grams: 3, p_idempotency_key: key('c') }), 'currency sale ' + cur);
    const parts = []; for (let i = 0; i < 3; i++) { const x = await ret('sellerb', sc.sale_id, 1); parts.push(x.ok ? r2(x.data.returned_amount) : x.error); }
    const third = r2(amount - 2 * Math.round(amount / 3 * 100) / 100);
    const acc = await accC(Cc, cur); const g = await accG(Cc);
    T(`RT-${cur}`, `${cur} ${amount} for 3 g: three 1 g returns = ${r2(amount / 3)} + ${r2(amount / 3)} + ${third} = ${amount} exactly; ${cur} debt 0; grams untouched`,
      parts[0] === r2(amount / 3) && parts[1] === r2(amount / 3) && parts[2] === third && r2(parts[0] + parts[1] + parts[2]) === amount && acc.d === 0 && acc.a === 0 && g.d === 0,
      { parts: [r2(amount / 3), r2(amount / 3), third] }, { parts, acc, g });
  }
  // ---------------- RT-PC barcode piece
  const C7 = await cust('sellerb', 'Piece');
  // an untouched 10 g piece of this run's consignment (earlier weight sales take pieces FIFO by creation time + id, so
  // cb.pieces[0] may already be partly sold)
  const ids = cb.pieces.map((x) => x.id);
  const free = await L.sel(`consignment_pieces?id=in.(${ids.join(',')})&status=eq.held_by_seller&sale_id=is.null&weight_grams=eq.10&select=id`);
  const pc = free[0].id;
  const ps = must(await L.rpc('sellerb', 'rpc_record_barcode_piece_sale', { p_customer_id: C7, p_piece_id: pc, p_client_markup_pct: 12, p_idempotency_key: key('pc') }), 'piece sale');
  const sbBefore = await seller('sellerb');
  const pPart = await ret('sellerb', ps.sale_id, 5); const pFull = await ret('sellerb', ps.sale_id, 10); const pAgain = await ret('sellerb', ps.sale_id, 10);
  const piece = (await L.sel(`consignment_pieces?id=eq.${pc}&select=status,sale_id`))[0]; const sbAfter = await seller('sellerb');
  T('RT-PC', 'barcode piece: 5 g of 10 g refused; whole piece -> same piece back on the shelf (held, no sale); second return refused',
    !pPart.ok && /butun dona/.test(pPart.error) && pFull.ok && pFull.data.piece_id === pc && piece.status === 'held_by_seller' && !piece.sale_id && !pAgain.ok && r4(sbAfter.st - sbBefore.st) === 10 && sbAfter.st === sbAfter.held,
    'ok', { part: pPart.error, full: pFull.ok ? pFull.data.piece_id : pFull.error, piece, again: pAgain.error, stock: r4(sbAfter.st - sbBefore.st) });
  // ---------------- RT-MGR
  const C8 = await cust('sellera', 'Mgr'); const W8 = await wsale('sellera', C8, 10, 8);
  const sm0 = await seller('sellera'); const m0 = await mgrStock();
  const pm = await ret('manager', W8, 4, { p_destination: 'manager' });
  const sm1 = await seller('sellera'); const m1 = await mgrStock(); const pmPiece = pm.ok ? (await L.sel(`consignment_pieces?id=eq.${pm.data.piece_id}&select=status,weight_grams`))[0] : null;
  // the obligation goes down by w x (1 + seller markup of the consignment the SALE took its gold from - FIFO, may be an older one)
  const al8 = (await L.sel(`weight_sale_allocations?sale_id=eq.${W8}&select=piece_id,created_at&order=created_at.desc&limit=1`))[0];
  const srcMk = N((await L.sel(`consignment_pieces?id=eq.${al8.piece_id}&select=m:seller_markup_pct`))[0].m);
  const expObl = r4(4 * (1 + srcMk / 100)); mgrObl = expObl;
  T('RT-MGR', `manager receives 4 g: seller stock unchanged (= held pieces), manager stock +4 g, seller obligation -${expObl} g (4 x (1 + ${srcMk} % of the source consignment)), piece returned_to_manager`,
    pm.ok && sm1.st === sm0.st && sm1.st === sm1.held && r4(m1 - m0) === 4 && r4(sm0.o - sm1.o) === expObl && pmPiece.status === 'returned_to_manager' && r4(pmPiece.weight_grams) === 4,
    { seller: 0, manager: 4, obligation: -expObl }, pm.ok ? { seller: r4(sm1.st - sm0.st), manager: r4(m1 - m0), obligation: r4(sm1.o - sm0.o), piece: pmPiece } : pm.error);
  // ---------------- RT-SEC
  const C9 = await cust('sellera', 'Sec'); const W9 = await wsale('sellera', C9, 10, 10); const a9 = await accG(C9);
  const x1 = await ret('sellerb', W9, 1); const x2 = await ret('sellera', W9, 1, { p_destination: 'manager' }); const x3 = await ret(OB, W9, 1);
  const x4 = await L.rpc('sellera', 'rpc_record_sale_return', { p_sale_id: W9, p_weight_grams: 1, p_reason: 'no key', p_destination: 'seller' });
  const x5 = await ret('sellera', W9, 0); const x6 = await ret('sellera', W9, -2); const x7 = await ret('sellera', W9, 1, { p_reason: ' ' });
  const anon = await fetch(`${L.URL}/rest/v1/rpc/rpc_record_sale_return`, { method: 'POST', headers: { apikey: L.ANON || L.KEY, Authorization: `Bearer ${L.ANON || ''}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_sale_id: W9, p_weight_grams: 1, p_reason: 'x', p_idempotency_key: key('anon') }) });
  const nRows9 = (await L.sel(`jewelry_sale_returns?sale_id=eq.${W9}&select=id`)).length;
  T('RT-SEC', 'refused: other seller (42501), seller -> manager, other organization, no key, 0 g, -2 g, empty reason, anon; nothing recorded',
    !x1.ok && !x2.ok && !x3.ok && !x4.ok && !x5.ok && !x6.ok && !x7.ok && anon.status >= 400 && nRows9 === 0 && JSON.stringify(await accG(C9)) === JSON.stringify(a9),
    'all refused', { other: x1.error, toMgr: x2.error, org: x3.error, noKey: x4.error, zero: x5.error, neg: x6.error, reason: x7.error, anon: anon.status, rows: nRows9 });
  // ---------------- RT-IDEM
  const C10 = await cust('sellera', 'Idem'); const W10 = await wsale('sellera', C10, 10, 10);
  const k1 = key('same'); const i1 = await ret('sellera', W10, 2, { p_idempotency_key: k1 }); const i2 = await ret('sellera', W10, 2, { p_idempotency_key: k1 });
  const kp = key('par'); const par = await Promise.all(Array.from({ length: 8 }, () => ret('sellera', W10, 1, { p_idempotency_key: kp })));
  const C11 = await cust('sellera', 'Par'); const W11 = await wsale('sellera', C11, 10, 10);
  const par2 = await Promise.all(Array.from({ length: 8 }, (_, i) => ret('sellera', W11, 3 + i * 0.0001)));
  const rows10 = await L.sel(`jewelry_sale_returns?sale_id=eq.${W10}&select=id`); const rows11 = await L.sel(`jewelry_sale_returns?sale_id=eq.${W11}&select=returned_weight_grams`);
  const w11 = r4(rows11.reduce((a, x) => a + N(x.returned_weight_grams), 0));
  T('RT-IDEM', 'same key twice -> one document (replay); 8 parallel same key -> 1 more; 8 parallel ~3 g on a 10 g sale -> at most 10 g returned, the rest refused',
    i1.ok && i2.ok && i1.data.return_no === i2.data.return_no && rows10.length === 2 && par.every((x) => x.ok) && w11 <= 10 && rows11.length === 3 && par2.filter((x) => !x.ok).length === 5,
    { docs: 2, w11: '<= 10', accepted: 3 }, { replay: [i1.data && i1.data.return_no, i2.data && i2.data.return_no], docs: rows10.length, w11, accepted: rows11.length, refused: par2.filter((x) => !x.ok).map((x) => x.error).slice(0, 2) });
  // ---------------- RT-REV
  const rv = await L.rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: W10, p_reason: 'RT83 full reversal after a return' });
  const C12 = await cust('sellera', 'Rev'); const W12 = await wsale('sellera', C12, 5, 10); const rv2 = await L.rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: W12, p_reason: 'RT83 plain reversal' });
  T('RT-REV', 'a sale with returns cannot be reversed as a whole (ERR_SALE_HAS_RETURNS); a sale without returns still can', !rv.ok && /ERR_SALE_HAS_RETURNS/.test(rv.error) && rv2.ok && (await saleRow(W10)).status !== 'reversed', 'refused / ok', { withReturns: rv.error, plain: rv2.ok || rv2.error });

  // ---------------- RT-REC reconciliation (independent sums)
  for (const s of ['sellera', 'sellerb']) { const x = await seller(s); T(`RT-REC-STK-${s}`, `${s}: stock = held pieces (0.0000 g)`, x.st === x.held, x.held, x); }
  const sA9 = await seller('sellera');
  T('RT-REC-OBL', 'sellera obligation changed ONLY by the manager-received return; seller-side returns leave it unchanged', r4(sA9.o - s0.o) === -mgrObl, -mgrObl, { before: s0.o, after: sA9.o });
  const ul = must(await L.rpc('director', 'rpc_get_unified_customer_ledger'), 'unified');
  const custIds = [C1, C1b, C2, C3, C4, C8, C9, C10, C11];
  const ulBad = []; for (const c of custIds) { const it = ul.items.find((i) => i.customer_id === c); const a = await accG(c); if (!it || r4(it.net_debt_g) !== a.d || r4(it.available_advance_g) !== a.a) ulBad.push({ c, it: it && [it.net_debt_g, it.available_advance_g], a }); }
  T('RT-REC-UL', 'unified ledger (documents) = live account for every return scenario customer', ulBad.length === 0, 0, ulBad.slice(0, 3));
  const [y, m] = today.split('-').map(Number);
  const mr = must(await L.rpc('director', 'rpc_get_customer_monthly_report', { p_year: y, p_month: m }), 'monthly');
  const mrBad = []; for (const c of custIds) { const it = mr.items.find((i) => i.customer_id === c); const a = await accG(c); const net = r4(a.d - a.a); if (net !== 0 || it) if (!it || r4(it.closing_net_g) !== net) mrBad.push({ c, it: it && it.closing_net_g, net }); }
  const it1 = mr.items.find((i) => i.customer_id === C1);
  T('RT-REC-MR', 'monthly report: closing net = live account; C1 row: sales 112, returns 112', mrBad.length === 0 && it1 && r4(it1.sales_in_month_g) === 112 && r4(it1.returns_in_month_g) === 112, 0, { bad: mrBad.slice(0, 3), c1: it1 && [it1.sales_in_month_g, it1.returns_in_month_g, it1.closing_net_g] });
  const pr = must(await L.rpc('director', 'rpc_get_period_report', { p_from: today, p_to: today, p_seller_id: null }), 'period');
  const live = await L.sel(`client_gold_accounts?select=d:current_debt_grams,a:advance_balance_grams,customers!inner(organization_id)&customers.organization_id=eq.${L.ORG}`);
  const liveNet = r4(live.reduce((a, x) => a + N(x.d) - N(x.a), 0));
  const cur = await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&select=currency,d:debt_amount,a:advance_amount`);
  const usd = r2(cur.filter((x) => x.currency === 'USD').reduce((a, x) => a + N(x.d) - N(x.a), 0));
  T('RT-REC-PR', 'period report closing (585 net, USD net) = live accounts; return flows listed', Math.abs(r4(pr.closing.customer_debt_net_g585) - liveNet) < 0.00005 && Math.abs(r2(pr.closing.customer_debt_net_usd) - usd) < 0.005 && !!pr.flows.return_gram && !!pr.flows.return_usd,
    { g585: liveNet, usd }, { g585: pr.closing.customer_debt_net_g585, usd: pr.closing.customer_debt_net_usd, flows: Object.keys(pr.flows).filter((k) => k.startsWith('return')) });
  const dl = must(await L.rpc('director', 'rpc_get_daily_sales_ledger', { p_seller_id: C.sellera.id, p_start_date: today, p_end_date: today }), 'daily');
  const dlRet = dl.filter((x) => x.tx_type === 'return' && x.customer_id === C1);
  T('RT-REC-DL', 'daily ledger: C1 shows the 100 g sale and 3 return rows (-20, -30, -50 g; -22.4, -33.6, -56 g)', dlRet.length === 3 && r4(dlRet.reduce((a, x) => a + N(x.sold_weight_g), 0)) === -100 && r4(dlRet.reduce((a, x) => a + N(x.obligation_g), 0)) === -112 && dl.some((x) => x.tx_type === 'sale' && x.customer_id === C1 && r4(x.sold_weight_g) === 100),
    3, dlRet.map((x) => [x.sold_weight_g, x.obligation_g]));
  const md = must(await L.rpc('director', 'rpc_get_seller_markup_difference_report', { p_seller_id: C.sellera.id, p_from: today, p_to: today }), 'markup');
  const e1 = md.entries.find((x) => x.sale_id === W1);
  T('RT-REC-MD', 'markup difference report: C1 sale entry keeps its own difference and shows the returned share (whole sale returned)', e1 && r4(e1.returned_markup_difference_g) === r4(e1.markup_difference_g), 'equal', e1 && [e1.markup_difference_g, e1.returned_markup_difference_g]);
  // ---------------- RT-UI (GA_UI=1): seller returns 3 g of a 10 g @10 % sale in the "↩️ Vozvrat" dialog, double click
  if (process.env.GA_UI) {
    const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
    const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
    const nUi = `RT83 UI ${run}`; const CU = must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nUi }), 'ui customer').customer_id;
    const WU = await wsale('sellera', CU, 10, 10); const aU0 = await accG(CU);
    const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
    const shot = (n) => path.join(path.dirname(OUT), `rt83-${n}.png`);
    for (const [tag, vp, w, label] of [['sellera', { width: 1366, height: 900 }, 3, 'desktop'], ['sellera', { width: 390, height: 844 }, 2, 'phone']]) {
      const c = L.creds()[tag]; const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const bad = [];
      p.on('response', (r) => { if (/supabase\.co|127\.0\.0\.1:54321/.test(r.url()) && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split('/rest/')[1]); });
      await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
      await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
      await p.goto(BASE + '/sales/app/customers', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
      await p.locator('button', { hasText: 'Kunlik Savdo Jurnali' }).first().click(); await p.waitForTimeout(3000);
      const row = p.locator(`tr:has-text("${nUi}"):has-text("Savdo")`).first();
      await row.locator('[data-testid="open-sale-return"]').click();
      await p.locator('[data-testid="return-remaining"]').waitFor({ timeout: 20000 });
      await p.locator('[data-testid="return-weight"]').fill(String(w)); await p.locator('[data-testid="return-reason"]').fill(`RT83 UI ${label}`);
      const preview = await p.locator('[data-testid="return-preview"]').innerText();
      await p.locator('[data-testid="return-submit"]').dblclick(); await p.waitForTimeout(4000);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await p.screenshot({ path: shot(label) }).catch(() => {});
      R.push({ id: `RT-UI-${label}-raw`, title: 'ui observations', ok: true, expected: null, actual: { preview, bad, overflow } });
      await ctx.close();
      const rowsU = await L.sel(`jewelry_sale_returns?sale_id=eq.${WU}&select=returned_weight_grams,client_gold_due_returned_g&order=created_at`);
      const exp = label === 'desktop' ? [[3, 3.3]] : [[3, 3.3], [2, 2.2]];
      T(`RT-UI-${label}`, `seller UI (${label}): return ${w} g of 10 g @10 % with a double click -> exactly one return document, value = ${r4(w * 1.1)} g (preview shows it), no API error${vp.width < 500 ? ', no horizontal overflow' : ''}`,
        JSON.stringify(rowsU.map((x) => [r4(x.returned_weight_grams), r4(x.client_gold_due_returned_g)])) === JSON.stringify(exp) && preview.includes(r4(w * 1.1).toFixed(4)) && bad.length === 0 && (vp.width >= 500 || overflow <= 0),
        exp, { rows: rowsU.map((x) => [r4(x.returned_weight_grams), r4(x.client_gold_due_returned_g)]), preview: preview.slice(0, 90), bad, overflow });
    }
    const aU1 = await accG(CU);
    T('RT-UI-ACC', 'after both UI returns the customer owes 11 - 3.3 - 2.2 = 5.5 g', r4(aU0.d - aU1.d) === 5.5 && aU1.d === 5.5, 5.5, { before: aU0, after: aU1 });
    await br.close();
  }
  fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, run, results: R }, null, 2));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
