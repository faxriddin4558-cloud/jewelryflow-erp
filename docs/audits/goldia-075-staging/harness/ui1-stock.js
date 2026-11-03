// UI-1 (REAL staging site, Playwright, real logins): director sets the daily rate in the UI, manager receives goods
// from the factory in the UI and distributes pieces to the three sellers with the barcode consignment screen.
// After every action the database is read (service role) and compared with independently expected values.
const fs = require('fs');
const { ORG, creds, rpc, sel, r4, tashkentToday } = require('./lib');
const { browser, login, go, SHOTS } = require('./ui-lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG)) : { checks: [], notes: [] };
const T = (id, title, ok, expected, actual, extra = {}) => { state.checks.push({ id, title, ok: !!ok, expected, actual, ...extra, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(expected) + ' act=' + JSON.stringify(actual).slice(0, 300)); };
const save = () => fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
const vault = async () => (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=o:current_factory_obligation_g,s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0] || { o: 0, s: 0, c: 0, u: 0 };
const sga = async (id) => (await sel(`seller_gold_accounts?seller_id=eq.${id}&select=o:total_seller_obligation_g,s:current_physical_stock_g`))[0] || { o: 0, s: 0 };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = creds();
  const br = await browser();
  // --- director: daily rate through the header "Kurs" dialog
  const d = await login(br, 'director');
  T('UI-L1', 'director logs in (real GoTrue) and lands in the sales app', d.p.url().includes('/sales/app'), '/sales/app', d.p.url());
  await d.p.getByRole('button', { name: /Kurs$/ }).first().click(); await d.p.waitForTimeout(800);
  await d.p.fill('input[placeholder="Masalan: 1050000"]', '900000');
  await d.p.locator('form:has(input[placeholder="Masalan: 1050000"]) button[type="submit"]').click(); await d.p.waitForTimeout(2500);
  await d.p.screenshot({ path: `${SHOTS}/01-director-daily-rate.png` });
  const rate = (await sel(`daily_gold_rates?organization_id=eq.${ORG}&rate_date=eq.${tashkentToday()}&select=id,rate_per_gram&order=created_at.desc&limit=1`))[0];
  T('UI-1', 'director sets today\'s 585 rate 900,000 in the UI', rate && Number(rate.rate_per_gram) === 900000, 900000, rate, { record_id: rate && rate.id });
  T('UI-1e', 'director session: no failed API call', d.bad.length === 0, [], d.bad);
  await d.ctx.close();
  // --- manager: factory receipt 200 g @ 8%
  const m = await login(br, 'manager');
  const v0 = await vault();
  await go(m, '/sales/app/factory-receive');
  await m.p.fill('input[placeholder="Masalan: Malika sirg\'a partiyasi, zanjir..."]', 'UI audit partiya (sintetik)');
  const nums = m.p.locator('form:has(input[placeholder="Masalan: Malika sirg\'a partiyasi, zanjir..."]) input[type="number"]');
  await nums.nth(0).fill('200'); await nums.nth(1).fill('8');
  await m.p.getByRole('button', { name: /Zavoddan Tovar Qabul Qilish/ }).last().dblclick(); await m.p.waitForTimeout(3000);
  await m.p.screenshot({ path: `${SHOTS}/02-manager-factory-receipt.png` });
  const v1 = await vault();
  const rcs = await sel(`factory_receipts?organization_id=eq.${ORG}&product_name=eq.${encodeURIComponent('UI audit partiya (sintetik)')}&status=not.in.(reversed,cancelled)&select=id,original_physical_g,factory_obligation_g`);
  T('UI-2', 'manager receives 200 g @8% in the UI (double click): one receipt, obligation +216, stock +200', rcs.length === 1 && Math.abs(v1.o - v0.o - 216) < 5e-5 && Math.abs(v1.s - v0.s - 200) < 5e-5,
    { receipts: 1, obligation_delta: 216, stock_delta: 200 }, { receipts: rcs.length, obligation_delta: r4(v1.o - v0.o), stock_delta: r4(v1.s - v0.s) }, { record_id: rcs[0] && rcs[0].id });
  // --- jewelry model for the barcode screen (API setup, real manager JWT)
  let model = (await sel(`jewelry_models?organization_id=eq.${ORG}&model_code=eq.UIM-1&select=id,model_code`))[0];
  if (!model) { const r = await rpc('manager', 'rpc_create_jewelry_model', { p_name: 'UI audit model', p_model_code: 'UIM-1' }); model = r.ok ? { id: r.data.id, model_code: 'UIM-1' } : null; state.notes.push({ setup: 'jewelry model via RPC (manager JWT)', ok: r.ok, error: r.ok ? null : r.error }); }
  // --- manager: barcode consignment to each seller (distinct weights so the scan screen can match them)
  const plan = { sellera: { markup: 15, w: [5.11, 6.23, 7.37, 8.41, 12.53, 3.29] }, sellerb: { markup: 12, w: [4.17, 5.29, 6.31, 9.43] }, sellerc: { markup: 10, w: [4.61, 5.73, 6.87, 7.91] } };
  state.pieces = state.pieces || {};
  for (const [tag, cfg] of Object.entries(plan)) {
    const before = await sga(C[tag].id); const vb = await vault();
    await go(m, '/sales/app/consignments');
    const selects = m.p.locator('select');
    await selects.nth(0).selectOption(C[tag].id);
    await m.p.fill('input[placeholder="8.00"]', '8'); await m.p.fill('input[placeholder="12.00"]', String(cfg.markup));
    const rcSel = m.p.locator('select:has(option[value="' + rcs[0].id + '"])');
    if (await rcSel.count()) await rcSel.first().selectOption(rcs[0].id);
    const mdSel = m.p.locator('select:has(option[value="' + (model && model.id) + '"])');
    if (model && await mdSel.count()) await mdSel.first().selectOption(model.id);
    const scan = m.p.locator('#scannerConsignInput');
    for (const w of cfg.w) { await scan.fill(String(w)); await scan.press('Enter'); await m.p.waitForTimeout(400); }
    await m.p.locator('input[type="checkbox"]').last().check();
    await m.p.getByRole('button', { name: /Konsignatsiyani Tasdiqlash/ }).click(); await m.p.waitForTimeout(3500);
    await m.p.screenshot({ path: `${SHOTS}/03-consignment-${tag}.png` });
    const after = await sga(C[tag].id); const va = await vault();
    const total = r4(cfg.w.reduce((a, b) => a + b, 0)); const expObl = r4(total * (1 + cfg.markup / 100));
    const pcs = await sel(`consignment_pieces?seller_id=eq.${C[tag].id}&status=eq.held_by_seller&select=id,weight_grams,model_code,consignment_id`);
    T('UI-3-' + tag, `manager distributes ${cfg.w.length} pieces (${total} g) to ${tag} @${cfg.markup}% in the barcode screen`,
      Math.abs(after.o - before.o - expObl) < 5e-5 && Math.abs(after.s - before.s - total) < 5e-5 && Math.abs(vb.s - va.s - total) < 5e-5 && pcs.length === cfg.w.length,
      { pieces: cfg.w.length, obligation_delta: expObl, seller_stock_delta: total, manager_stock_delta: -total }, { pieces: pcs.length, obligation_delta: r4(after.o - before.o), seller_stock_delta: r4(after.s - before.s), manager_stock_delta: r4(va.s - vb.s) },
      { record_ids: [...new Set(pcs.map((p) => p.consignment_id))] });
    state.pieces[tag] = pcs;
  }
  T('UI-3e', 'manager session: no failed API call', m.bad.length === 0, [], m.bad);
  await m.ctx.close(); await br.close(); save();
})().catch((e) => { console.error('FATAL', e.stack); save(); process.exit(1); });
