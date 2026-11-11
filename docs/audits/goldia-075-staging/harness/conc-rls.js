// Concurrency + cross-organization RLS on STAGING (075) with real sessions. Write probes only ever target rows of the
// synthetic organization B (filter organization_id = ORG_B), so even a leak could only touch synthetic data.
const fs = require('fs');
const { URL, KEY, ORG, ORG_B: ORG_B_REAL, creds, rpc, usel, uwrite, sel, R, T, tashkentToday } = require('./lib');
// PHASE D: GA_FOREIGN_ORG = the writable foreign synthetic org (C); org B is then only READ (B users read-probe, nobody writes B)
const ORG_B = process.env.GA_FOREIGN_ORG || ORG_B_REAL;
const FD = process.env.GA_OTHER_DIRECTOR || 'directorB'; const FM = process.env.GA_OTHER_MANAGER || 'managerB'; const FS = process.env.GA_OTHER_SELLER || 'sellerB1';
(async () => {
  const C = creds();
  await rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: tashkentToday() });
  await rpc(FD, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: tashkentToday() });
  const rc = (await rpc('manager', 'rpc_record_factory_receipt', { p_product_name: 'conc (sintetik)', p_original_physical_g: 40, p_factory_markup_pct: 8 })).data;
  const cons = (await rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 15, p_factory_receipt_id: rc.receipt_id,
    p_pieces: [{ weight_grams: 5, model_code: 'CONC-1' }, { weight_grams: 6, model_code: 'CONC-2' }, { weight_grams: 4, model_code: 'CONC-3' }] })).data;
  const cust = (await sel(`customers?organization_id=eq.${ORG}&seller_id=eq.${C.sellera.id}&select=id&limit=1`))[0].id;
  const [p1, p2, p3] = cons.pieces.map((p) => p.id);
  // K1: the same piece sold twice in parallel
  const k1 = await Promise.all([1, 2, 3].map(() => rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: p1, p_client_markup_pct: 12 })));
  const salesP1 = await sel(`jewelry_sales?piece_id=eq.${p1}&status=not.in.(reversed,cancelled)&select=id`).catch(async () => (await sel(`consignment_pieces?id=eq.${p1}&select=sale_id`)).filter((x) => x.sale_id));
  T('K1', '3 parallel barcode sales of the same piece: exactly one succeeds', k1.filter((x) => x.ok).length === 1, 1, { ok: k1.filter((x) => x.ok).map((x) => x.data.sale_id), errors: k1.filter((x) => !x.ok).map((x) => x.error.slice(0, 60)), sales: salesP1.length });
  // K2: parallel weight sales cutting the same 6 g piece by 4 g each (only one fits)
  const k2 = await Promise.all([1, 2].map((i) => rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cust, p_weight_grams: 4, p_client_markup_pct: 12, p_piece_ids: [p2], p_idempotency_key: `conc-ws-${Date.now()}-${i}` })));
  const p2now = (await sel(`consignment_pieces?id=eq.${p2}&select=weight_grams,status`))[0];
  T('K2', '2 parallel 4 g weight sales from the same 6 g piece: one succeeds, piece = 2 g, never negative', k2.filter((x) => x.ok).length === 1 && Number(p2now.weight_grams) === 2, { ok: 1, piece: 2 }, { ok: k2.filter((x) => x.ok).length, piece: p2now, errors: k2.filter((x) => !x.ok).map((x) => x.error.slice(0, 60)) });
  // K3: payment retried in parallel with the same idempotency key -> one settlement
  await rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12600, p_reason: 'conc' });
  const key = `conc-pay-${Date.now()}`;
  const k3 = await Promise.all([1, 2, 3, 4].map(() => rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: cust, p_cash_amount: 900000, p_idempotency_key: key })));
  const ids = [...new Set(k3.filter((x) => x.ok).map((x) => x.data.settlement_id))];
  T('K3', '4 parallel retries of one payment (same key): one settlement of 1.0 g', ids.length === 1 && k3.filter((x) => x.ok).every((x) => Number(x.data.total_settled_grams) === 1), { settlements: 1, grams: 1 }, { settlements: ids.length, errors: k3.filter((x) => !x.ok).map((x) => x.error.slice(0, 60)) });
  // K4: two parallel handovers of the same till -> grams closed once
  const till = (await sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=c:seller_till_cash_amount,st:total_settled_to_manager_g`))[0];
  const k4 = await Promise.all([1, 2].map((i) => rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: C.sellera.id, p_cash_paid_amount: Number(till.c), p_idempotency_key: `conc-ho-${Date.now()}-${i}` })));
  const after = (await sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=c:seller_till_cash_amount,st:total_settled_to_manager_g`))[0];
  T('K4', '2 parallel handovers of the same till: till closed once (settled grows by the till grams only)', k4.filter((x) => x.ok).length === 1 && Math.abs(Number(after.st) - Number(till.st) - 1) < 0.00005 && Number(after.c) === 0,
    { ok: 1, settled_delta: 1, till_after: 0 }, { ok: k4.filter((x) => x.ok).length, settled_delta: Number(after.st) - Number(till.st), till_after: after.c, errors: k4.filter((x) => !x.ok).map((x) => x.error.slice(0, 60)) });
  // K5: return and sale of the same piece in parallel
  const k5 = await Promise.all([rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: p3, p_client_markup_pct: 12 }), rpc('sellera', 'rpc_return_piece_to_manager', { p_piece_id: p3, p_notes: 'conc' })]);
  const p3now = (await sel(`consignment_pieces?id=eq.${p3}&select=status`))[0];
  T('K5', 'sale and return of the same piece in parallel: exactly one wins', k5.filter((x) => x.ok).length === 1, 1, { results: k5.map((x) => (x.ok ? 'OK' : x.error.slice(0, 50))), status: p3now.status });

  // ---------- RLS: every org table x every login (read), write probes against org B rows ----------
  const spec = await (await fetch(`${URL}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
  const defs = spec.definitions || {};
  const orgTables = Object.keys(defs).filter((t) => defs[t].properties && defs[t].properties.organization_id);
  // make sure org B has rows in the main tables
  const bc = (await rpc(FM, 'rpc_record_factory_receipt', { p_product_name: 'B partiya (sintetik)', p_original_physical_g: 20, p_factory_markup_pct: 8 })).data;
  const bcons = (await rpc(FM, 'rpc_issue_barcode_consignment', { p_seller_id: C[FS].id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: bc.receipt_id, p_pieces: [{ weight_grams: 5, model_code: 'B-1' }] })).data;
  const bcust = (await sel(`customers?organization_id=eq.${ORG_B}&select=id&limit=1`))[0].id;
  await rpc(FS, 'rpc_record_barcode_piece_sale', { p_customer_id: bcust, p_piece_id: bcons.pieces[0].id, p_client_markup_pct: 12 });
  await rpc(FS, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12600, p_reason: 'B' });
  await rpc(FS, 'rpc_record_client_settlement', { p_customer_id: bcust, p_cash_amount: 900000 });
  const readLeaks = []; let reads = 0;
  for (const tag of ['director', 'manager', 'sellera', 'sellerb', 'sellerc', 'worker', 'noemp', ...new Set(['directorB', 'sellerB1', FD, FS])]) {
    const other = (C[tag].org === ORG_B || C[tag].org === ORG_B_REAL) ? ORG : ORG_B;
    for (const t of orgTables) {
      const r = await usel(tag, `${t}?organization_id=eq.${other}&select=organization_id&limit=1`); reads++;
      if (r.ok && r.data.length) readLeaks.push(`${tag}:${t}`);
    }
  }
  T('RLS1', `no cross-org read (${orgTables.length} org tables/views x 9 logins, both directions)`, readLeaks.length === 0, 0, { reads, leaks: readLeaks });
  const bRowsBefore = JSON.stringify(await Promise.all(['customers', 'jewelry_sales', 'gold_settlements', 'consignment_pieces', 'seller_gold_accounts', 'client_gold_accounts', 'factory_receipts', 'manager_vault_account', 'seller_rates'].map((t) => sel(`${t}?organization_id=eq.${ORG_B}&select=*&order=id`).catch(() => []))));
  const writeLeaks = []; let writes = 0;
  const writableBase = Object.keys(spec.paths).filter((p) => !p.startsWith('/rpc/') && spec.paths[p].patch).map((p) => p.slice(1)).filter((t) => orgTables.includes(t));
  for (const tag of ['director', 'manager', 'sellera']) {
    for (const t of writableBase) {
      const u = await uwrite(tag, 'PATCH', `${t}?organization_id=eq.${ORG_B}`, { organization_id: ORG_B }); writes++;
      if (u.ok && u.data.length) writeLeaks.push(`update:${t}:${tag}:${u.data.length}`);
      const d = await uwrite(tag, 'DELETE', `${t}?organization_id=eq.${ORG_B}`); writes++;
      if (d.ok && d.data.length) writeLeaks.push(`delete:${t}:${tag}:${d.data.length}`);
    }
  }
  const bRowsAfter = JSON.stringify(await Promise.all(['customers', 'jewelry_sales', 'gold_settlements', 'consignment_pieces', 'seller_gold_accounts', 'client_gold_accounts', 'factory_receipts', 'manager_vault_account', 'seller_rates'].map((t) => sel(`${t}?organization_id=eq.${ORG_B}&select=*&order=id`).catch(() => []))));
  T('RLS2', `no cross-org UPDATE/DELETE (${writableBase.length} tables x 3 org-A logins, aimed at synthetic org B); org B rows unchanged`, writeLeaks.length === 0 && bRowsBefore === bRowsAfter, 0, { writes, leaks: writeLeaks, orgB_unchanged: bRowsBefore === bRowsAfter });
  const ins = await uwrite('manager', 'POST', 'jewelry_models', { organization_id: ORG_B, model_code: 'XORG', name: 'xorg probe' });
  const insR = await uwrite('sellera', 'POST', 'seller_rates', { organization_id: ORG_B, seller_id: C[FS].id, lom_rate_uzs: 1, usd_rate_uzs: 1 });
  T('RLS3', 'cross-org INSERT refused (jewelry_models, seller_rates)', !ins.ok && !insR.ok, 'refused', [ins.ok ? 'INSERTED' : ins.error.slice(0, 50), insR.ok ? 'INSERTED' : insR.error.slice(0, 50)]);
  const rpcs = {
    'sellera rates of org B seller': await rpc('sellera', 'rpc_get_seller_rates', { p_seller_id: C[FS].id }),
    'director markup report of org B seller': await rpc('director', 'rpc_get_seller_markup_difference_report', { p_seller_id: C[FS].id }),
    'director handover for org B seller': await rpc('director', 'rpc_record_seller_to_manager_settlement', { p_seller_id: C[FS].id, p_cash_paid_amount: 1 }),
    'manager consign to org B seller': await rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C[FS].id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_pieces: [{ weight_grams: 1 }] }),
    'sellera sale to org B customer': await rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: bcust, p_cash_amount: 1000 }),
  };
  // a leak = foreign rows or non-zero foreign totals in the answer; an empty report (no entries, all totals 0) is a refusal by content
  const emptyAnswer = (d) => (Array.isArray(d.sellers) && d.sellers.length === 0) || JSON.stringify(d) === '{}'
    || (Array.isArray(d.entries) && d.entries.length === 0 && (!d.by_seller || d.by_seller.length === 0) && Number(d.total_difference_g || 0) === 0 && Number(d.active_sales || 0) === 0);
  const leaked = Object.entries(rpcs).filter(([, r]) => r.ok && r.data && !emptyAnswer(r.data));
  T('RLS4', 'RPCs refuse to act on another organization (rates, reports, handover, consignment, payment)', leaked.length === 0, 'refused', Object.fromEntries(Object.entries(rpcs).map(([k, r]) => [k, r.ok ? 'OK:' + JSON.stringify(r.data).slice(0, 60) : r.error.slice(0, 50)])));
  fs.writeFileSync(__dirname + '/../evidence/concurrency-rls.json', JSON.stringify(R, null, 1));
  console.log('RESULT', R.filter((x) => x.ok).length, '/', R.length);
})().catch((e) => { console.error('FATAL', e.stack); process.exit(1); });
