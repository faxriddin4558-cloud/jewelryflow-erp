// REAL STAGING independent reconciliation (read only, service-role reads of raw document rows; synthetic audit org A):
//   RC-CUR  every customer x currency: debt - advance (client_currency_accounts) = active currency sales - (payments
//           applied to debt + payments put to advance) of active currency settlements  (exact, 0.00)
//   RC-STK  every seller: gram stock (seller_gold_accounts) = sum of held barcode pieces            (0.0000 g)
//   RC-585  organization: customer 585 net debt (client_gold_accounts) = documented history since the first document
//           (period report from 2026-11-01: opening 0 + flows = closing, closing = live)             (0.0000 g)
//   RC-OBL  every seller: legacy obligation = max(0, active legacy debt deltas)                      (0.0000 g)
//   RC-NEG  no negative stock / till / debt / advance anywhere in the organization
const fs = require('fs'); const path = require('path');
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const OUT = path.join(__dirname, '..', 'evidence', 'staging-079', 'staging-recon-079.json');
const N = Number; const R = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
const all = async (q) => { const out = []; for (let o = 0; ; o += 1000) { const p = await L.sel(`${q}${q.includes('?') ? '&' : '?'}limit=1000&offset=${o}`); out.push(...p); if (p.length < 1000) break; } return out; };
const u4 = (x) => Math.round(N(x) * 1e4); const u2 = (x) => Math.round(N(x) * 100);
(async () => {
  const ORG = L.ORG;
  // ---- RC-CUR
  const acc = await all(`client_currency_accounts?organization_id=eq.${ORG}&select=customer_id,currency,debt_amount,advance_amount&order=customer_id.asc,currency.asc`);
  const sales = await all(`jewelry_sales?organization_id=eq.${ORG}&sale_currency=in.(UZS,USD)&status=not.in.(reversed,cancelled)&select=customer_id,sale_currency,sale_amount&order=id.asc`);
  const pays = await all(`client_currency_settlements?organization_id=eq.${ORG}&status=neq.reversed&select=customer_id,debt_currency,applied_to_debt,to_advance&order=id.asc`);
  const model = new Map(); const k = (c, cur) => `${c}|${cur}`;
  for (const s of sales) model.set(k(s.customer_id, s.sale_currency), (model.get(k(s.customer_id, s.sale_currency)) || 0) + u2(s.sale_amount));
  for (const p of pays) model.set(k(p.customer_id, p.debt_currency), (model.get(k(p.customer_id, p.debt_currency)) || 0) - u2(p.applied_to_debt) - u2(p.to_advance));
  const curBad = []; const keys = new Set([...model.keys(), ...acc.map((a) => k(a.customer_id, a.currency))]);
  for (const key of keys) {
    const a = acc.find((x) => k(x.customer_id, x.currency) === key); const db = a ? u2(a.debt_amount) - u2(a.advance_amount) : 0; const m = model.get(key) || 0;
    if (db !== m) curBad.push({ key, db: db / 100, model: m / 100 });
  }
  const tot = (cur) => [...keys].filter((x) => x.endsWith(cur)).reduce((s, x) => s + (model.get(x) || 0), 0) / 100;
  T('RC-CUR', `every customer x currency (${keys.size}): DB net (debt - advance) = active currency sales - applied - advance of active payments`, curBad.length === 0, { diff: 0, net_uzs: tot('UZS'), net_usd: tot('USD') }, { mismatches: curBad.slice(0, 5), n: curBad.length, sales: sales.length, payments: pays.length });
  // ---- RC-STK
  const sga = await all(`seller_gold_accounts?organization_id=eq.${ORG}&select=seller_id,current_physical_stock_g,seller_legacy_debt_obligation_g,seller_till_cash_amount,seller_till_usd_amount,seller_till_scrap_grams`);
  const held = await all(`consignment_pieces?organization_id=eq.${ORG}&status=eq.held_by_seller&select=seller_id,weight_grams&order=id.asc`);
  const hs = new Map(); for (const p of held) hs.set(p.seller_id, (hs.get(p.seller_id) || 0) + u4(p.weight_grams));
  const stkBad = sga.filter((s) => u4(Math.max(0, N(s.current_physical_stock_g))) !== (hs.get(s.seller_id) || 0)).map((s) => ({ s: s.seller_id.slice(0, 8), db: N(s.current_physical_stock_g), pieces: (hs.get(s.seller_id) || 0) / 1e4 }));
  const stockTotal = sga.reduce((a, s) => a + u4(s.current_physical_stock_g), 0) / 1e4; const piecesTotal = [...hs.values()].reduce((a, x) => a + x, 0) / 1e4;
  T('RC-STK', `every seller (${sga.length}): physical gram stock = held barcode pieces`, stkBad.length === 0, { diff_g: '0.0000', total_g: piecesTotal }, { mismatches: stkBad, stock_total_g: stockTotal, pieces_total_g: piecesTotal });
  // ---- RC-585
  let rep; const repErrors = [];
  for (let i = 0; i < 3; i++) { rep = await L.rpc('manager', 'rpc_get_period_report', { p_from: '2026-11-01', p_to: L.tashkentToday() }); if (rep.ok) break; repErrors.push(`${rep.status} ${(rep.error || '').slice(0, 160)}`); }
  if (repErrors.length) console.log('period report errors before success:', JSON.stringify(repErrors));
  if (!rep.ok) {
    T('RC-585', 'customer 585 net debt = documented history (period report) - BLOCKED: the report timed out (finding F79-1, fixed by 080)', false, { diff_g: '0.0000' }, { errors: repErrors });
  } else {
  const flows = Object.values(rep.data.flows).reduce((a, x) => a + u4(x.customer_g585_change || 0), 0);
  const live = (await all(`client_gold_accounts?organization_id=eq.${ORG}&select=current_debt_grams,advance_balance_grams&order=customer_id.asc`)).reduce((a, x) => a + u4(x.current_debt_grams) - u4(x.advance_balance_grams), 0);
  const undoc = N(rep.data.undocumented_opening?.customer_debt_net_g585 || 0);
  T('RC-585', 'customer 585 net debt: opening (0, undocumented 0) + all documented flows since 01.11 = closing = live database', u4(rep.data.opening.customer_debt_net_g585) + flows === u4(rep.data.closing.customer_debt_net_g585) && u4(rep.data.closing.customer_debt_net_g585) === live && u4(undoc) === 0,
    { diff_g: '0.0000' }, { opening: rep.data.opening.customer_debt_net_g585, flows_g: flows / 1e4, closing: rep.data.closing.customer_debt_net_g585, live_g: live / 1e4, undocumented: undoc });
  }
  // ---- RC-OBL
  const leg = await all(`client_legacy_debts?organization_id=eq.${ORG}&status=neq.reversed&balance_type=eq.debt&select=seller_id,delta_585_g&order=id.asc`);
  const ls = new Map(); for (const d of leg) if (d.seller_id) ls.set(d.seller_id, (ls.get(d.seller_id) || 0) + u4(d.delta_585_g));
  const oblBad = sga.filter((s) => u4(s.seller_legacy_debt_obligation_g) !== Math.max(0, ls.get(s.seller_id) || 0)).map((s) => ({ s: s.seller_id.slice(0, 8), db: N(s.seller_legacy_debt_obligation_g), model: Math.max(0, ls.get(s.seller_id) || 0) / 1e4 }));
  T('RC-OBL', 'every seller: legacy 585 obligation = max(0, active legacy DEBT deltas; advances are booked on the customer only)', oblBad.length === 0, { diff_g: '0.0000' }, { mismatches: oblBad, rows: leg.length });
  // ---- RC-NEG
  const gacc = await all(`client_gold_accounts?organization_id=eq.${ORG}&select=current_debt_grams,advance_balance_grams&order=customer_id.asc`);
  const vault = (await L.sel(`manager_vault_account?organization_id=eq.${ORG}&select=manager_cash_amount,manager_usd_amount,manager_physical_stock_g`))[0];
  const neg = { seller: sga.filter((s) => N(s.current_physical_stock_g) < 0 || N(s.seller_till_cash_amount) < 0 || N(s.seller_till_usd_amount) < 0 || N(s.seller_till_scrap_grams) < 0).length,
    customer585: gacc.filter((x) => N(x.current_debt_grams) < 0 || N(x.advance_balance_grams) < 0).length, currency: acc.filter((x) => N(x.debt_amount) < 0 || N(x.advance_amount) < 0).length,
    vault: [vault.manager_cash_amount, vault.manager_usd_amount, vault.manager_physical_stock_g].filter((x) => N(x) < 0).length,
    debt_and_advance: acc.filter((x) => N(x.debt_amount) > 0 && N(x.advance_amount) > 0).length };
  T('RC-NEG', 'no negative stock, till, vault, 585 or currency balance; no currency account with debt and advance at once', Object.values(neg).every((x) => x === 0), 'all 0', neg);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ target: 'staging', at: new Date().toISOString(), results: R }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
