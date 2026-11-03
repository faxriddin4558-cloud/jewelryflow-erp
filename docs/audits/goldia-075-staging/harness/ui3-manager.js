// UI-3 (REAL staging site): manager receives each seller's till ("Qabul Qilish" + receipt), reverses a sale from the
// daily journal, creates a customer for seller C; director views. DB compared after every action.
const fs = require('fs');
const { ORG, creds, sel, r4 } = require('./lib');
const { browser, login, go, SHOTS, BASE, logout } = require('./ui-lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = JSON.parse(fs.readFileSync(LOG));
const T = (id, title, ok, expected, actual, extra = {}) => { state.checks.push({ id, title, ok: !!ok, expected, actual, ...extra, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(expected) + ' act=' + JSON.stringify(actual).slice(0, 360)); };
const save = () => fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
const vault = async () => (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount,sc:manager_scrap_grams`))[0];
(async () => {
  const C = creds();
  const br = await browser();
  const m = await login(br, 'manager');
  // --- handovers: expected grams = the captured grams of the UI payments of that seller
  for (const tag of ['sellera', 'sellerb', 'sellerc']) {
    const SID = C[tag].id;
    const till = (await sel(`seller_gold_accounts?seller_id=eq.${SID}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,st:total_settled_to_manager_g,ow:seller_owes_manager_g`))[0];
    const myCust = (await sel(`customers?seller_id=eq.${SID}&select=id`)).map((x) => x.id);
    const expGrams = r4(state.ops.filter((o) => o.op === 'payment' && myCust.includes(o.customer) && !o.handed_over).reduce((a, o) => a + o.expected_grams, 0));
    const v0 = await vault();
    await go(m, '/sales/app/sellers');
    const card = m.p.getByText(`UI75 ${tag}`, { exact: true }).first().locator('xpath=ancestor::*[.//button[contains(., "Qabul Qilish")]][1]');
    await card.locator('button', { hasText: 'Qabul Qilish' }).first().click(); await m.p.waitForTimeout(1500);
    const form = m.p.locator('form:has(button:has-text("Qabul Qilish & Chek"))');
    const pre = await form.locator('input[type="number"]').evaluateAll((els) => els.map((e) => e.value));
    const n0 = m.rpcs.length;
    await m.p.getByRole('button', { name: /Qabul Qilish & Chek/ }).dblclick(); await m.p.waitForTimeout(4000);
    await m.p.screenshot({ path: `${SHOTS}/UI3-handover-${tag}.png` });
    const calls = m.rpcs.slice(n0).filter((x) => x.rpc === 'rpc_record_seller_to_manager_settlement');
    const after = (await sel(`seller_gold_accounts?seller_id=eq.${SID}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,st:total_settled_to_manager_g,ow:seller_owes_manager_g`))[0];
    const v1 = await vault();
    const settled = r4(Number(after.st) - Number(till.st));
    const okCall = calls.find((c) => c.status === 200);
    T(`UI3-H-${tag}`, `manager receives ${tag}'s till in the UI (double click): settled = captured ${expGrams} g, till 0, vault +cash/+USD`,
      Math.abs(settled - expGrams) < 5e-5 && Number(after.c) === 0 && Number(after.u) === 0 && Number(v1.c) - Number(v0.c) === Number(till.c) && Number(v1.u) - Number(v0.u) === Number(till.u),
      { settled: expGrams, till_after: 0, vault_cash_delta: Number(till.c), vault_usd_delta: Number(till.u) },
      { settled, till_after: [after.c, after.u, after.s], vault_cash_delta: Number(v1.c) - Number(v0.c), vault_usd_delta: Number(v1.u) - Number(v0.u), prefilled_form: pre, rpc: calls.map((c) => [c.status, c.body && (c.body.message || c.body.settlement_id || c.body.handover_id || 'ok')]) },
      { record_id: okCall && okCall.body && (okCall.body.settlement_id || okCall.body.id) });
    if (Math.abs(settled - expGrams) < 5e-5) state.ops.filter((o) => o.op === 'payment' && myCust.includes(o.customer)).forEach((o) => { o.handed_over = true; });
    state.ops.push({ op: 'handover', ui: 'UI3', seller: tag, expected_grams: expGrams, actual_grams: settled, cash: Number(till.c), usd: Number(till.u), record_id: okCall && okCall.body && (okCall.body.settlement_id || okCall.body.id) });
    await m.p.keyboard.press('Escape').catch(() => {});
  }
  // --- reversal of seller B's scan sale from the daily journal
  const target = state.ops.find((o) => o.op === 'scan_sale' && String(o.ui).startsWith('UI2-sellerb'));
  const piece = (await sel(`consignment_pieces?sale_id=eq.${target.sale_id}&select=id,weight_grams,status`))[0];
  const accB0 = (await sel(`client_gold_accounts?customer_id=eq.${target.customer}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
  await go(m, '/sales/app/customers');
  await m.p.getByRole('button', { name: /Kunlik Savdo Jurnali/ }).first().click(); await m.p.waitForTimeout(2500);
  const jrow = m.p.locator(`tr:has-text("${target.sale_no}")`).locator('visible=true').first();
  const found = await jrow.count();
  if (found) {
    await jrow.locator('button', { hasText: 'Bekor qilish' }).first().click(); await m.p.waitForTimeout(800);
    await m.p.fill('textarea[placeholder*="Xato kiritilgan summa"]', 'UI audit: mijoz tovarni qaytardi');
    await m.p.getByRole('button', { name: /Tasdiqlash & Bekor Qilish/ }).dblclick(); await m.p.waitForTimeout(4000);
  }
  await m.p.screenshot({ path: `${SHOTS}/UI3-reversal.png` });
  const sale = (await sel(`jewelry_sales?id=eq.${target.sale_id}&select=status`))[0];
  const pieceNow = piece ? (await sel(`consignment_pieces?id=eq.${piece.id}&select=status,weight_grams`))[0] : null;
  const accB1 = (await sel(`client_gold_accounts?customer_id=eq.${target.customer}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
  const netDelta = r4((Number(accB1.d) - Number(accB1.a)) - (Number(accB0.d) - Number(accB0.a)));
  T('UI3-REV', `manager reverses seller B's scan sale ${target.sale_no} in the daily journal: sale reversed, piece back with the seller, customer net -${target.expected_due} g`,
    found && sale.status === 'reversed' && pieceNow && pieceNow.status === 'held_by_seller' && Math.abs(netDelta + target.expected_due) < 5e-5,
    { status: 'reversed', piece: 'held_by_seller', net_delta: -target.expected_due }, { row_found: found, status: sale.status, piece: pieceNow, net_delta: netDelta }, { record_id: target.sale_id });
  if (sale.status === 'reversed') state.ops.push({ op: 'reversal', ui: 'UI3', sale_id: target.sale_id, sale_no: target.sale_no, customer: target.customer, expected_due_removed: target.expected_due });
  // --- manager creates a customer for seller C
  await go(m, '/sales/app/customers');
  await m.p.getByRole('button', { name: /Yangi Mijoz Qo/ }).first().click();
  await m.p.fill('input[placeholder="Masalan: Dilrabo Karimova"]', 'UI C mijoz 2 (menejer, sintetik)');
  await m.p.locator('form:has(input[placeholder="Masalan: Dilrabo Karimova"]) select').first().selectOption(C.sellerc.id);
  await m.p.getByRole('button', { name: /Mijozni Saqlash/ }).click(); await m.p.waitForTimeout(3000);
  const mc = await sel(`customers?contact_name=eq.${encodeURIComponent('UI C mijoz 2 (menejer, sintetik)')}&select=id,customer_code,seller_id`);
  T('UI3-C', 'manager creates a customer for seller C in the UI', mc.length === 1 && mc[0].seller_id === C.sellerc.id, { rows: 1, seller: 'sellerc' }, mc, { record_id: mc[0] && mc[0].id });
  for (const pg of ['/sales/app', '/sales/app/reports', '/sales/app/cash', '/sales/app/inventory', '/sales/app/factory']) {
    const b0 = m.bad.length; await go(m, pg); await m.p.screenshot({ path: `${SHOTS}/UI3-manager${pg.replace(/\//g, '_')}.png` });
    T(`UI3-PG${pg}`, `manager ${pg} loads without failed API calls`, m.bad.length === b0, [], m.bad.slice(b0));
  }
  await logout(m); await m.p.goto(BASE + '/sales/app', { waitUntil: 'networkidle' });
  T('UI3-O', 'manager logout ends the session', m.p.url().includes('/sales/login'), '/sales/login', m.p.url().replace(BASE, ''));
  await m.ctx.close();
  // --- director (mobile) views
  const d = await login(br, 'director', { width: 390, height: 844 });
  for (const pg of ['/sales/app', '/sales/app/customers', '/sales/app/reports', '/sales/app/sellers', '/sales/app/settings']) {
    const b0 = d.bad.length; await go(d, pg); await d.p.screenshot({ path: `${SHOTS}/UI3-director-mobile${pg.replace(/\//g, '_')}.png` });
    T(`UI3-D${pg}`, `director (mobile) ${pg} loads without failed API calls`, d.bad.length === b0, [], d.bad.slice(b0));
  }
  await d.p.reload({ waitUntil: 'networkidle' });
  T('UI3-DF', 'director session survives refresh (mobile)', !d.p.url().includes('/sales/login'), 'logged in', d.p.url().replace(BASE, ''));
  await logout(d); await d.p.goto(BASE + '/sales/app', { waitUntil: 'networkidle' });
  T('UI3-DO', 'director logout (mobile) ends the session', d.p.url().includes('/sales/login'), '/sales/login', d.p.url().replace(BASE, ''));
  await br.close(); save();
})().catch((e) => { console.error('FATAL', e.stack.split('\n').slice(0, 3).join(' ')); save(); process.exit(1); });
