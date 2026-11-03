// UI-3b (REAL staging site): retry of the manager steps with corrected selectors.
// Handover: (a) as pre-filled; if the browser blocks it (empty required USD rate), (b) manager types the USD rate.
const fs = require('fs');
const { ORG, creds, sel, r4 } = require('./lib');
const { browser, login, go, SHOTS, BASE, logout } = require('./ui-lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = JSON.parse(fs.readFileSync(LOG));
const T = (id, title, ok, expected, actual, extra = {}) => { state.checks.push({ id, title, ok: !!ok, expected, actual, ...extra, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(expected) + ' act=' + JSON.stringify(actual).slice(0, 360)); };
const save = () => fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
const vault = async () => (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=s:manager_physical_stock_g,c:manager_cash_amount,u:manager_usd_amount`))[0];
(async () => {
  for (const c of state.checks) if (/^UI3-(H-|REV)/.test(c.id) && !c.id.includes('try1')) { c.id = c.id.replace('UI3-', 'UI3-try1-'); c.note = 'try 1: card selector opened seller C for every seller; USD rate field empty (CBU 503) blocked submit; journal row looked up by sale number (column not shown)'; }
  const C = creds();
  const br = await browser();
  const m = await login(br, 'manager');
  const openCard = async (tag) => {
    await go(m, '/sales/app/sellers');
    const card = m.p.locator('xpath=//*[normalize-space(text())="UI75 ' + tag + '"]/ancestor::*[count(.//button[contains(., "Qabul Qilish")])=1][1]');
    const n = await card.count();
    if (!n) return false;
    await card.first().locator('button', { hasText: 'Qabul Qilish' }).click(); await m.p.waitForTimeout(1500);
    return (await m.p.locator('text=Sotuvchi: UI75 ' + tag).count()) > 0;
  };
  for (const tag of ['sellerb', 'sellera', 'sellerc']) {
    const SID = C[tag].id;
    const till = (await sel(`seller_gold_accounts?seller_id=eq.${SID}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,st:total_settled_to_manager_g`))[0];
    const myCust = (await sel(`customers?seller_id=eq.${SID}&select=id`)).map((x) => x.id);
    const expGrams = r4(state.ops.filter((o) => o.op === 'payment' && myCust.includes(o.customer) && !o.handed_over).reduce((a, o) => a + o.expected_grams, 0));
    const v0 = await vault();
    const opened = await openCard(tag);
    const usdBox = m.p.locator('form:has(button:has-text("Qabul Qilish & Chek")) input[placeholder="Masalan: 12800"]');
    const usdPre = opened ? await usdBox.inputValue().catch(() => '') : null;
    let n0 = m.rpcs.length;
    await m.p.getByRole('button', { name: /Qabul Qilish & Chek/ }).dblclick(); await m.p.waitForTimeout(4000);
    let calls = m.rpcs.slice(n0).filter((x) => x.rpc === 'rpc_record_seller_to_manager_settlement');
    let mode = 'as pre-filled';
    if (!calls.length && Number(till.u) > 0) {
      T(`UI3-H-${tag}-a`, `${tag} till with USD: submitting the pre-filled handover form`, false, 'submitted', { usd_rate_field: usdPre || '(empty, CBU unavailable)', blocked: 'browser required-field validation' });
      const seller = (await sel(`seller_rates?seller_id=eq.${SID}&select=usd_rate_uzs`))[0];
      await usdBox.fill(String(seller.usd_rate_uzs)); mode = `USD rate ${seller.usd_rate_uzs} typed by the manager`;
      n0 = m.rpcs.length; await m.p.getByRole('button', { name: /Qabul Qilish & Chek/ }).dblclick(); await m.p.waitForTimeout(4000);
      calls = m.rpcs.slice(n0).filter((x) => x.rpc === 'rpc_record_seller_to_manager_settlement');
    }
    await m.p.screenshot({ path: `${SHOTS}/UI3b-handover-${tag}.png` });
    const after = (await sel(`seller_gold_accounts?seller_id=eq.${SID}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,s:seller_till_scrap_grams,st:total_settled_to_manager_g`))[0];
    const v1 = await vault(); const settled = r4(Number(after.st) - Number(till.st));
    const okCall = calls.find((c) => c.status === 200);
    T(`UI3-H-${tag}`, `manager receives ${tag}'s till in the UI (${mode}, double click): settled = captured ${expGrams} g, till 0, vault +cash/+USD`,
      opened && Math.abs(settled - expGrams) < 5e-5 && Number(after.c) === 0 && Number(after.u) === 0 && Number(v1.c) - Number(v0.c) === Number(till.c) && Number(v1.u) - Number(v0.u) === Number(till.u),
      { settled: expGrams, till_after: 0, vault_cash_delta: Number(till.c), vault_usd_delta: Number(till.u) },
      { card_opened: opened, settled, till_after: [after.c, after.u, after.s], vault_cash_delta: Number(v1.c) - Number(v0.c), vault_usd_delta: Number(v1.u) - Number(v0.u), rpc: calls.map((c) => [c.status, c.body && (c.body.message || 'ok')]) },
      { record_id: okCall && okCall.body && (okCall.body.settlement_id || okCall.body.id || null) });
    if (Math.abs(settled - expGrams) < 5e-5 && settled > 0) state.ops.filter((o) => o.op === 'payment' && myCust.includes(o.customer)).forEach((o) => { o.handed_over = true; });
    state.ops.push({ op: 'handover', ui: 'UI3b', seller: tag, mode, expected_grams: expGrams, actual_grams: settled, cash: Number(till.c), usd: Number(till.u), record_id: okCall && okCall.body && (okCall.body.settlement_id || okCall.body.id || null) });
    await m.p.keyboard.press('Escape').catch(() => {});
  }
  // reversal: journal row by customer name + sold grams
  const target = state.ops.find((o) => o.op === 'scan_sale' && String(o.ui).startsWith('UI2-sellerb'));
  const custName = (await sel(`customers?id=eq.${target.customer}&select=contact_name`))[0].contact_name;
  const piece = (await sel(`consignment_pieces?sale_id=eq.${target.sale_id}&select=id`))[0];
  const acc0 = (await sel(`client_gold_accounts?customer_id=eq.${target.customer}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
  await go(m, '/sales/app/customers');
  await m.p.getByRole('button', { name: /Kunlik Savdo Jurnali/ }).first().click(); await m.p.waitForTimeout(3000);
  const jrow = m.p.locator('tr').filter({ hasText: custName }).filter({ hasText: target.piece_g.toFixed(2) + ' g' }).filter({ hasText: 'Savdo' }).locator('visible=true').first();
  const found = await jrow.count();
  if (found) {
    await jrow.locator('button', { hasText: 'Bekor qilish' }).first().click(); await m.p.waitForTimeout(800);
    await m.p.fill('textarea[placeholder*="Xato kiritilgan summa"]', 'UI audit: mijoz tovarni qaytardi');
    await m.p.getByRole('button', { name: /Tasdiqlash & Bekor Qilish/ }).dblclick(); await m.p.waitForTimeout(4000);
  }
  await m.p.screenshot({ path: `${SHOTS}/UI3b-reversal.png` });
  const sale = (await sel(`jewelry_sales?id=eq.${target.sale_id}&select=status`))[0];
  const pieceNow = (await sel(`consignment_pieces?id=eq.${piece ? piece.id : '00000000-0000-0000-0000-000000000000'}&select=status,weight_grams`))[0]
    || (await sel(`consignment_pieces?seller_id=eq.${C.sellerb.id}&weight_grams=eq.${target.piece_g}&select=status,weight_grams`))[0];
  const acc1 = (await sel(`client_gold_accounts?customer_id=eq.${target.customer}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
  const netDelta = r4((Number(acc1.d) - Number(acc1.a)) - (Number(acc0.d) - Number(acc0.a)));
  T('UI3-REV', `manager reverses seller B's scan sale (${custName}, ${target.piece_g} g) in the daily journal: reversed, piece back with seller B, customer net -${target.expected_due} g`,
    found && sale.status === 'reversed' && pieceNow && pieceNow.status === 'held_by_seller' && Math.abs(netDelta + target.expected_due) < 5e-5,
    { status: 'reversed', piece: 'held_by_seller', net_delta: -target.expected_due }, { row_found: found, status: sale.status, piece: pieceNow, net_delta: netDelta }, { record_id: target.sale_id });
  if (sale.status === 'reversed') state.ops.push({ op: 'reversal', ui: 'UI3b', sale_id: target.sale_id, sale_no: target.sale_no, customer: target.customer, expected_due_removed: target.expected_due });
  await logout(m); await m.p.waitForTimeout(2000); await m.p.goto(BASE + '/sales/app', { waitUntil: 'load' }).catch(() => {}); await m.p.waitForTimeout(2000);
  T('UI3-O', 'manager logout ends the session', m.p.url().includes('/sales/login'), '/sales/login', m.p.url().replace(BASE, ''));
  await m.ctx.close();
  const d = await login(br, 'director', { width: 390, height: 844 });
  for (const pg of ['/sales/app', '/sales/app/customers', '/sales/app/reports', '/sales/app/sellers', '/sales/app/settings']) {
    const b0 = d.bad.length; await go(d, pg); await d.p.screenshot({ path: `${SHOTS}/UI3-director-mobile${pg.replace(/\//g, '_')}.png` });
    T(`UI3-D${pg}`, `director (mobile) ${pg} loads without failed API calls`, d.bad.length === b0, [], d.bad.slice(b0));
  }
  await d.p.reload({ waitUntil: 'networkidle' });
  T('UI3-DF', 'director session survives refresh (mobile)', !d.p.url().includes('/sales/login'), 'logged in', d.p.url().replace(BASE, ''));
  await logout(d); await d.p.waitForTimeout(2000); await d.p.goto(BASE + '/sales/app', { waitUntil: 'load' }).catch(() => {}); await d.p.waitForTimeout(2000);
  T('UI3-DO', 'director logout (mobile) ends the session', d.p.url().includes('/sales/login'), '/sales/login', d.p.url().replace(BASE, ''));
  await br.close(); save();
})().catch((e) => { console.error('FATAL', e.stack.split('\n').slice(0, 3).join(' ')); save(); process.exit(1); });
