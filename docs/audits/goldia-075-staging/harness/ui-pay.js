// UI payment on the REAL staging site (Mijozlar -> To'lov): (a) submit the form exactly as the UI pre-fills it,
// (b) the seller types his own LOM/USD rates. Network responses and DB rows are recorded.
// Usage: node ui-pay.js <sellerTag> <desktop|mobile> <customerName> <ownLom> <ownUsd> <cash> <usd> <scrapG> <proba> <expectedDebtBefore>
const fs = require('fs');
const { creds, sel, r4 } = require('./lib');
const { browser, login, go, SHOTS } = require('./ui-lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = JSON.parse(fs.readFileSync(LOG));
const T = (id, title, ok, expected, actual, extra = {}) => { state.checks.push({ id, title, ok: !!ok, expected, actual, ...extra, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(expected) + ' act=' + JSON.stringify(actual).slice(0, 360)); };
const U4 = (x) => Math.round(Number(x) * 1e4); const dh = (n, d) => Math.floor((2 * n + d) / (2 * d));
const [tag, form, custName, lomS, usdS, cashS, usdPS, scrapS, probaS, debtS] = process.argv.slice(2);
const lom = Number(lomS), usdRate = Number(usdS), cash = Number(cashS), usdPaid = Number(usdPS), scrapG = Number(scrapS), proba = Number(probaS);
const P = `UIPAY-${tag}-${form}`;
(async () => {
  const C = creds();
  const CID = (await sel(`customers?contact_name=eq.${encodeURIComponent(custName)}&select=id`))[0].id;
  const br = await browser();
  const s = await login(br, tag, form === 'mobile' ? { width: 390, height: 844 } : { width: 1366, height: 860 });
  const open = async () => {
    await go(s, '/sales/app/customers');
    const row = s.p.locator(`tr:has-text("${custName}"), div.rounded-2xl.p-4:has-text("${custName}")`).locator('visible=true').first();
    await row.locator('button', { hasText: "To'lov" }).locator('visible=true').first().click(); await s.p.waitForTimeout(2500);
    if (scrapG) { await s.p.fill('input[placeholder="0.0000"]', String(scrapG)); await s.p.locator('xpath=//label[contains(., "Lom Probasi")]/following::select[1]').selectOption(String(proba)); }
    if (cash) await s.p.fill('input[placeholder="0"]', String(cash));
    if (usdPaid) await s.p.fill('input[placeholder="$ 0"]', String(usdPaid));
  };
  const submit = async () => {
    const n0 = s.rpcs.length; const c0 = (await sel(`gold_settlements?customer_id=eq.${CID}&select=id`)).length;
    await s.p.getByRole('button', { name: /To'lovni Tasdiqlash/ }).click(); await s.p.waitForTimeout(4000);
    const calls = s.rpcs.slice(n0).filter((x) => x.rpc === 'rpc_record_client_settlement');
    const invalid = await s.p.evaluate(() => [...document.querySelectorAll('form input:invalid')].map((i) => i.placeholder || i.type));
    const rows = await sel(`gold_settlements?customer_id=eq.${CID}&select=id,settlement_no,total_settled_grams,cash_equivalent_grams,usd_equivalent_grams&order=created_at.desc`);
    return { calls, invalid, newRows: rows.length - c0, row: rows[0] };
  };
  // (a) as pre-filled by the UI
  await open();
  const pre = { lom: await s.p.locator('input[placeholder="Masalan: 950000"]').inputValue(), usd: await s.p.locator('input[placeholder="Masalan: 12800"]').first().inputValue(), preview: (await s.p.locator('text=/Jami hisobdan/').locator('xpath=..').textContent().catch(() => '')).replace(/\s+/g, ' ') };
  await s.p.screenshot({ path: `${SHOTS}/${P}-a-prefilled.png` });
  const a = await submit();
  const msgA = ((await s.p.textContent('body')).match(/(ERR_[A-Z_]+[^\n]{0,90})|(xatolik[^\n]{0,90})/i) || [''])[0];
  await s.p.screenshot({ path: `${SHOTS}/${P}-a-after-submit.png` });
  T(`${P}-a`, `payment form pre-fill: LOM rate = seller's own ${lom}, USD rate = seller's own ${usdRate}; submitting as pre-filled records the payment`,
    Number(pre.lom) === lom && Number(pre.usd) === usdRate && a.newRows === 1, { form_lom: lom, form_usd: usdRate, payment: 1 },
    { form_lom: pre.lom, form_usd: pre.usd || '(empty)', preview: pre.preview.slice(0, 120), payment_rows: a.newRows, rpc: a.calls.map((c) => [c.status, c.body && (c.body.message || c.body.code)]), browser_invalid_fields: a.invalid, message: msgA });
  // (b) seller corrects the rates by hand
  if (a.newRows === 0) {
    await s.p.keyboard.press('Escape').catch(() => {});
    await open();
    await s.p.fill('input[placeholder="Masalan: 950000"]', String(lom));
    if (usdPaid) await s.p.locator('input[placeholder="Masalan: 12800"]').first().fill(String(usdRate));
    const b = await submit();
    const g = r4((cash ? dh(cash * 1e4, lom) / 1e4 : 0) + (usdPaid ? dh(usdPaid * usdRate * 1e4, lom) / 1e4 : 0) + (scrapG ? dh(U4(scrapG) * proba, 585) / 1e4 : 0));
    await s.p.screenshot({ path: `${SHOTS}/${P}-b-own-rates.png` });
    T(`${P}-b`, `with own rates typed by hand the payment is recorded: ${g} g`, b.newRows === 1 && Math.abs(Number(b.row.total_settled_grams) - g) < 5e-5, { payment: 1, grams: g },
      { payment_rows: b.newRows, grams: b.row && b.row.total_settled_grams, rpc: b.calls.map((c) => [c.status, c.body && (c.body.message || c.body.code)]), invalid: b.invalid }, { record_id: b.row && b.row.id, settlement_no: b.row && b.row.settlement_no });
    if (b.newRows === 1) {
      state.ops.push({ op: 'payment', ui: P, customer: CID, settlement_id: b.row.id, settlement_no: b.row.settlement_no, cash, usd: usdPaid, scrap_g: scrapG, proba, rate: lom, usd_rate: usdRate, expected_grams: g, actual_grams: Number(b.row.total_settled_grams), note: 'rates typed by hand' });
      const acc = (await sel(`client_gold_accounts?customer_id=eq.${CID}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
      const exp = r4(Number(debtS) - g);
      T(`${P}-d`, `customer debt after the payment = ${exp} g`, Math.abs(Number(acc.d) - Number(acc.a) - exp) < 5e-5, exp, r4(Number(acc.d) - Number(acc.a)));
    }
  } else state.ops.push({ op: 'payment', ui: P, customer: CID, settlement_id: a.row.id, settlement_no: a.row.settlement_no, cash, usd: usdPaid, scrap_g: scrapG, proba, expected_grams: null, actual_grams: Number(a.row.total_settled_grams), note: 'as pre-filled' });
  await br.close(); fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
})().catch((e) => { console.error('FATAL', e.stack.split('\n').slice(0, 3).join(' ')); fs.writeFileSync(LOG, JSON.stringify(state, null, 1)); process.exit(1); });
