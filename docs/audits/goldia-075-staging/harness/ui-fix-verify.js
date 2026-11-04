// Re-check of the 5 staging UI FAILs (F-UI-1 x3, F-UI-3 x2) + F-UI-2 with the fixed frontend, real GoTrue logins,
// three sellers' payments and the manager's till handovers, then an independent 0.0000 g reconciliation.
//   GA_TARGET=local   -> local disposable stack (PG17 + GoTrue + PostgREST, http://127.0.0.1:3300)
//   GA_TARGET=staging -> https://jewelryflow-sales-staging.vercel.app (needs GA_CREDS for the staging users)
// Setup (rates, receipt, consignments, customers, one sale each) uses the same RPCs with real JWTs; every check that
// is reported as UI is done in the browser. Writes go to the synthetic audit organization only.
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('./lib') : require('../../goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const API_HOST = TARGET === 'staging' ? 'vouehtlmsunebracahon.supabase.co' : '127.0.0.1:54321';
const { ORG, creds, rpc, sel, r4, tashkentToday } = L;
const OUT = path.join(__dirname, '..', 'evidence', `ui-fix-verify-${TARGET}.json`);
const SHOTS = path.join(__dirname, '..', 'evidence', `ui-fix-screens-${TARGET}`);
const R = []; const OPS = [];
const T = (id, title, ok, expected, actual, extra = {}) => { R.push({ id, title, ok: !!ok, expected, actual, ...extra }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(expected) + ' act=' + JSON.stringify(actual).slice(0, 320)); };
const U4 = (x) => Math.round(Number(x) * 1e4); const dh = (n, d) => Math.floor((2 * n + d) / (2 * d));
const due = (w, m) => dh(U4(w) * (100 + m), 100) / 1e4;
const grams = (cash, usd, scrap, proba, lom, usdRate) => r4((cash ? dh(cash * 1e4, lom) / 1e4 : 0) + (usd ? dh(usd * usdRate * 1e4, lom) / 1e4 : 0) + (scrap ? dh(U4(scrap) * proba, 585) / 1e4 : 0));
async function login(br, tag, vp) {
  const c = creds()[tag];
  const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const p = await ctx.newPage(); const bad = [];
  p.on('response', (r) => { if (r.url().includes(API_HOST) && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split(API_HOST)[1].split('?')[0]); });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2000);
  return { ctx, p, bad };
}
const go = async (s, u) => { await s.p.goto(BASE + u, { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1500); };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = creds(); const run = Date.now().toString(36);
  const S = { sellera: { markup: 15, lom: 890000, usd: 12500, w: [5.07, 6.13], sale: [6.13, 12] }, sellerb: { markup: 12, lom: 905000, usd: 12650, w: [4.19, 7.21], sale: [7.21, 14] }, sellerc: { markup: 10, lom: 895000, usd: 12550, w: [4.53, 6.57], sale: [6.57, 13] } };
  // ---------- setup with real JWTs ----------
  if (!(await rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: tashkentToday() })).ok) throw new Error('daily rate');
  const rc = await rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `fix-verify ${run}`, p_original_physical_g: 60, p_factory_markup_pct: 8 });
  for (const [tag, cfg] of Object.entries(S)) {
    const sid = C[tag].id;
    const cons = await rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: sid, p_factory_markup_pct: 8, p_seller_markup_pct: cfg.markup, p_factory_receipt_id: rc.data.receipt_id, p_pieces: cfg.w.map((w, i) => ({ weight_grams: w, model_code: `FX-${run}-${tag}-${i}` })) });
    cfg.pieces = cons.data.pieces;
    if (!(await rpc(tag, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: cfg.lom, p_usd_rate_uzs: cfg.usd, p_reason: 'fix verify' })).ok) throw new Error('rates ' + tag);
    const cu = await rpc(tag, 'rpc_create_customer_with_code', { p_contact_name: `FIX ${tag} mijoz ${run}` });
    cfg.customer = cu.data.customer_id; cfg.customerName = `FIX ${tag} mijoz ${run}`;
    const piece = cfg.pieces.find((p) => Math.abs(Number(p.weight_grams) - cfg.sale[0]) < 1e-6);
    const sale = await rpc(tag, 'rpc_record_barcode_piece_sale', { p_customer_id: cfg.customer, p_piece_id: piece.id, p_client_markup_pct: cfg.sale[1] });
    cfg.due = due(cfg.sale[0], cfg.sale[1]);
    OPS.push({ op: 'setup_sale', seller: tag, sale_id: sale.data.sale_id, expected_due: cfg.due, actual_due: Number(sale.data.client_gold_due_grams) });
    const acc = (await sel(`seller_gold_accounts?seller_id=eq.${sid}&select=st:total_settled_to_manager_g,ow:seller_owes_manager_g,c:seller_till_cash_amount,u:seller_till_usd_amount`))[0];
    cfg.before = acc;
  }
  // server protection unchanged: a seller sending another LOM rate is still refused
  const mis = await rpc('sellerb', 'rpc_record_client_settlement', { p_customer_id: S.sellerb.customer, p_cash_amount: 100000, p_rate_per_gram: 900000 });
  T('SRV-1', 'server still refuses a seller payment at another LOM rate (ERR_RATE_MISMATCH)', !mis.ok && /ERR_RATE_MISMATCH/.test(mis.error), 'ERR_RATE_MISMATCH', mis.ok ? 'ACCEPTED' : mis.error.slice(0, 90));
  const misU = await rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: S.sellera.customer, p_usd_amount: 10, p_usd_rate: 12999 });
  T('SRV-2', 'server still refuses a seller payment at another USD rate', !misU.ok && /ERR_RATE_MISMATCH/.test(misU.error), 'ERR_RATE_MISMATCH', misU.ok ? 'ACCEPTED' : misU.error.slice(0, 90));
  const vault0 = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=c:manager_cash_amount,u:manager_usd_amount`))[0];
  // ---------- UI: seller payments exactly as the dialog pre-fills them ----------
  const pay = { sellera: { vp: { width: 1366, height: 860 }, cash: 890000, usd: 100, scrap: 1.5, proba: 750 }, sellerb: { vp: { width: 390, height: 844 }, cash: 1810000, usd: 0, scrap: 0, proba: 585 }, sellerc: { vp: { width: 1366, height: 860 }, cash: 447500, usd: 50, scrap: 2, proba: 585 } };
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [tag, pcfg] of Object.entries(pay)) {
    const cfg = S[tag]; const form = pcfg.vp.width < 500 ? 'mobile' : 'desktop';
    const s = await login(br, tag, pcfg.vp);
    await go(s, '/sales/app/customers');
    const row = s.p.locator(`tr:has-text("${cfg.customerName}"), div.rounded-2xl.p-4:has-text("${cfg.customerName}")`).locator('visible=true').first();
    await row.locator('button', { hasText: "To'lov" }).locator('visible=true').first().click();
    await s.p.waitForFunction(() => { const i = document.querySelector('[data-testid="pay-lom-rate"]'); return i && i.value !== ''; }, null, { timeout: 15000 }).catch(() => {});
    const lomVal = await s.p.locator('[data-testid="pay-lom-rate"]').inputValue();
    const usdVal = await s.p.locator('[data-testid="pay-usd-rate"]').inputValue();
    const ro = await s.p.locator('[data-testid="pay-lom-rate"]').evaluate((e) => e.readOnly) && await s.p.locator('[data-testid="pay-usd-rate"]').evaluate((e) => e.readOnly);
    T(`F1-prefill-${tag}-${form}`, `${tag} (${form}) payment dialog pre-fills the seller's OWN stored rates ${cfg.lom}/${cfg.usd}, read-only`, Number(lomVal) === cfg.lom && Number(usdVal) === cfg.usd && ro,
      { lom: cfg.lom, usd: cfg.usd, readOnly: true }, { lom: lomVal, usd: usdVal, readOnly: ro });
    if (pcfg.scrap) { await s.p.fill('input[placeholder="0.0000"]', String(pcfg.scrap)); await s.p.locator('xpath=//label[contains(., "Lom Probasi")]/following::select[1]').selectOption(String(pcfg.proba)); }
    await s.p.fill('input[placeholder="0"]', String(pcfg.cash));
    if (pcfg.usd) await s.p.fill('input[placeholder="$ 0"]', String(pcfg.usd));
    const cashValid = await s.p.locator('input[placeholder="0"]').evaluate((e) => e.checkValidity());
    const before = (await sel(`gold_settlements?customer_id=eq.${cfg.customer}&select=id`)).length;
    await s.p.screenshot({ path: `${SHOTS}/F1-${tag}-${form}-prefilled.png` });
    await s.p.getByRole('button', { name: /To'lovni Tasdiqlash/ }).dblclick(); await s.p.waitForTimeout(4000);
    await s.p.screenshot({ path: `${SHOTS}/F1-${tag}-${form}-after.png` });
    const rows = await sel(`gold_settlements?customer_id=eq.${cfg.customer}&select=id,settlement_no,total_settled_grams&order=created_at.desc`);
    const exp = grams(pcfg.cash, pcfg.usd, pcfg.scrap, pcfg.proba, cfg.lom, cfg.usd);
    pcfg.expGrams = exp;
    T(`F1-pay-${tag}-${form}`, `${tag} (${form}) pays ${pcfg.cash} UZS${pcfg.usd ? ` + $${pcfg.usd}` : ''}${pcfg.scrap ? ` + ${pcfg.scrap} g @${pcfg.proba}` : ''} AS PRE-FILLED (double click): one payment of ${exp} g`,
      rows.length - before === 1 && Math.abs(Number(rows[0].total_settled_grams) - exp) < 5e-5, { payments: 1, grams: exp }, { payments: rows.length - before, grams: rows[0] && rows[0].total_settled_grams, failed_api: s.bad },
      { record_id: rows[0] && rows[0].id, settlement_no: rows[0] && rows[0].settlement_no });
    if (tag === 'sellerc') T('F2-447500', 'UZS 447,500 is accepted by the browser (step=1) and recorded', cashValid && rows.length - before === 1, { browser_valid: true, recorded: true }, { browser_valid: cashValid, recorded: rows.length - before === 1 });
    if (rows[0]) OPS.push({ op: 'ui_payment', seller: tag, form, settlement_id: rows[0].id, settlement_no: rows[0].settlement_no, expected_grams: exp, actual_grams: Number(rows[0].total_settled_grams) });
    await s.ctx.close();
  }
  // ---------- UI: manager receives every till as pre-filled ----------
  const m = await login(br, 'manager', { width: 1366, height: 860 });
  for (const tag of ['sellera', 'sellerc', 'sellerb']) {
    const sid = C[tag].id;
    const name = (await sel(`employees?id=eq.${sid}&select=full_name,name`))[0];
    const label = name.name || name.full_name;
    const till = (await sel(`seller_gold_accounts?seller_id=eq.${sid}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,st:total_settled_to_manager_g`))[0];
    await go(m, '/sales/app/sellers');
    const card = m.p.locator('xpath=//*[normalize-space(text())="' + label + '"]/ancestor::*[count(.//button[contains(., "Qabul Qilish")])=1][1]');
    await card.first().locator('button', { hasText: 'Qabul Qilish' }).click(); await m.p.waitForTimeout(2500);
    const rateField = m.p.locator('[data-testid="surrender-usd-rate"]');
    const rateVal = (await rateField.count()) ? await rateField.inputValue() : '(no USD)';
    const required = (await rateField.count()) ? await rateField.evaluate((e) => e.required) : false;
    const valuedInfo = (await m.p.locator('[data-testid="surrender-valued-usd"]').count()) ? (await m.p.locator('[data-testid="surrender-valued-usd"]').textContent()).replace(/\s+/g, ' ') : null;
    await m.p.screenshot({ path: `${SHOTS}/F3-handover-${tag}-prefilled.png` });
    if (Number(till.u) > 0) T(`F3-prefill-${tag}`, `handover dialog for ${tag}: USD rate field not empty (seller's stored ${S[tag].usd}), not required for dollars valued at payment time`,
      Number(rateVal) === S[tag].usd && !required && !!valuedInfo, { usd_rate: S[tag].usd, required: false, valued_info: true }, { usd_rate: rateVal, required, valued_info: valuedInfo });
    await m.p.getByRole('button', { name: /Qabul Qilish & Chek/ }).dblclick(); await m.p.waitForTimeout(4000);
    await m.p.screenshot({ path: `${SHOTS}/F3-handover-${tag}-after.png` });
    const after = (await sel(`seller_gold_accounts?seller_id=eq.${sid}&select=c:seller_till_cash_amount,u:seller_till_usd_amount,st:total_settled_to_manager_g`))[0];
    const settled = r4(Number(after.st) - Number(till.st)); const exp = pay[tag].expGrams;
    T(`F3-handover-${tag}`, `manager receives ${tag}'s till AS PRE-FILLED (double click): settled = grams captured at payment ${exp} g (no recalculation at today's rate), till 0`,
      Math.abs(settled - exp) < 5e-5 && Number(after.c) === 0 && Number(after.u) === 0, { settled: exp, till: [0, 0] }, { settled, till: [after.c, after.u], failed_api: m.bad });
    OPS.push({ op: 'ui_handover', seller: tag, expected_grams: exp, actual_grams: settled, cash: Number(till.c), usd: Number(till.u) });
    await m.p.keyboard.press('Escape').catch(() => {});
  }
  await m.ctx.close(); await br.close();
  // ---------- reconciliation (inputs only) ----------
  const rows = [];
  const cmp = (item, exp, act, money = false) => rows.push({ item, expected: exp, actual: Number(act), ok: Math.abs(Number(act) - exp) <= (money ? 0.5 : 0.00005) });
  for (const [tag, cfg] of Object.entries(S)) {
    const acc = (await sel(`client_gold_accounts?customer_id=eq.${cfg.customer}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
    cmp(`${tag} customer net (debt - advance)`, r4(cfg.due - pay[tag].expGrams), Number(acc.d) - Number(acc.a));
    const a = (await sel(`seller_gold_accounts?seller_id=eq.${C[tag].id}&select=st:total_settled_to_manager_g,ow:seller_owes_manager_g,c:seller_till_cash_amount,u:seller_till_usd_amount`))[0];
    cmp(`${tag} settled to manager (delta)`, pay[tag].expGrams, r4(Number(a.st) - Number(cfg.before.st)));
    cmp(`${tag} owes manager (delta)`, -pay[tag].expGrams, r4(Number(a.ow) - Number(cfg.before.ow)));
    cmp(`${tag} till cash`, 0, a.c, true); cmp(`${tag} till usd`, 0, a.u, true);
  }
  const v1 = (await sel(`manager_vault_account?organization_id=eq.${ORG}&select=c:manager_cash_amount,u:manager_usd_amount`))[0];
  cmp('manager cash UZS (delta)', Object.values(pay).reduce((x, p) => x + p.cash, 0), Number(v1.c) - Number(vault0.c), true);
  cmp('manager USD (delta)', Object.values(pay).reduce((x, p) => x + p.usd, 0), Number(v1.u) - Number(vault0.u), true);
  const opsBad = OPS.filter((o) => ('expected_due' in o && Math.abs(o.expected_due - o.actual_due) > 5e-5) || ('expected_grams' in o && Math.abs(o.expected_grams - o.actual_grams) > 5e-5));
  const maxG = Math.max(...rows.filter((r) => !/UZS|USD|till/.test(r.item)).map((r) => Math.abs(r.actual - r.expected)));
  T('RECON', `reconciliation from UI inputs only: ${rows.length} rows, every operation expected = actual`, rows.every((r) => r.ok) && opsBad.length === 0, { rows: rows.length, max_gram_diff: '0.0000' }, { bad_rows: rows.filter((r) => !r.ok), op_mismatches: opsBad.length, max_gram_diff: maxG.toFixed(4) });
  fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, base: BASE, at: new Date().toISOString(), checks: R, operations: OPS, reconciliation: rows }, null, 1));
  console.log('RESULT', TARGET, R.filter((x) => x.ok).length, '/', R.length);
})().catch((e) => { console.error('FATAL', e.stack.split('\n').slice(0, 3).join(' ')); fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, error: e.message, checks: R, operations: OPS }, null, 1)); process.exit(1); });
