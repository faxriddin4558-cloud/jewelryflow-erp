// UI-2 (REAL staging site): one seller session end to end — rates (Kassam), customer, scan sale + receipt, weight sale
// with the chosen piece, UZS/USD/LOM payment, wrong-rate attempt, refresh, logout. DB checked after every action.
// Usage: node ui2-seller.js <sellerTag> <mobile|desktop> <lom> <usd> <customerName> <scanWeight> <scanMarkup> <cutPieceWeight> <cutGrams> <cutMarkup> <cash> <usdPaid> <scrapG> <scrapProba>
const fs = require('fs');
const { creds, sel, r4 } = require('./lib');
const { browser, login, go, SHOTS, BASE } = require('./ui-lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = JSON.parse(fs.readFileSync(LOG));
const T = (id, title, ok, expected, actual, extra = {}) => { state.checks.push({ id, title, ok: !!ok, expected, actual, ...extra, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(expected) + ' act=' + JSON.stringify(actual).slice(0, 300)); };
const save = () => fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
const U4 = (x) => Math.round(Number(x) * 1e4); const dh = (n, d) => Math.floor((2 * n + d) / (2 * d));
const [tag, form, lomS, usdS, custName, scanW, scanM, cutPieceW, cutG, cutM, cashS, usdPaidS, scrapS, probaS] = process.argv.slice(2);
const lom = Number(lomS), usdRate = Number(usdS), cash = Number(cashS), usdPaid = Number(usdPaidS), scrapG = Number(scrapS), proba = Number(probaS);
const P = `UI2-${tag}-${form}`;
(async () => {
  const C = creds(); const SID = C[tag].id;
  const vp = form === 'mobile' ? { width: 390, height: 844 } : { width: 1366, height: 860 };
  const br = await browser();
  const s = await login(br, tag, vp);
  T(`${P}-L`, `${tag} logs in (${form})`, s.p.url().includes('/sales/app'), '/sales/app', s.p.url().replace(BASE, ''));
  const acct = async () => (await sel(`seller_gold_accounts?seller_id=eq.${SID}&select=o:total_seller_obligation_g,ph:current_physical_stock_g,c:seller_till_cash_amount,u:seller_till_usd_amount,sc:seller_till_scrap_grams`))[0];
  // 1. rates in Kassam (double click), then an out-of-range rate
  await go(s, '/sales/app/kassam');
  const hist0 = (await sel(`seller_rate_history?seller_id=eq.${SID}&select=id`)).length;
  await s.p.getByLabel('Yangi LOM kursi').fill(String(lom)); await s.p.getByLabel('Yangi USD kursi').fill(String(usdRate)); await s.p.getByLabel('Izoh').fill('UI audit');
  await s.p.locator('[data-testid="seller-rates-card"] button[type="submit"]').dblclick(); await s.p.waitForTimeout(3000);
  const rate1 = (await sel(`seller_rates?seller_id=eq.${SID}&select=lom_rate_uzs,usd_rate_uzs`))[0];
  const hist1 = (await sel(`seller_rate_history?seller_id=eq.${SID}&select=id`)).length;
  T(`${P}-R1`, `rates ${lom}/${usdRate} saved from Kassam (double click)`, rate1 && Number(rate1.lom_rate_uzs) === lom && Number(rate1.usd_rate_uzs) === usdRate && hist1 - hist0 >= 1 && hist1 - hist0 <= 2, { lom, usd: usdRate }, { ...rate1, history_added: hist1 - hist0 });
  await s.p.getByLabel('Yangi LOM kursi').fill('5000000'); await s.p.locator('[data-testid="seller-rates-card"] button[type="submit"]').click(); await s.p.waitForTimeout(2500);
  const rate2 = (await sel(`seller_rates?seller_id=eq.${SID}&select=lom_rate_uzs`))[0];
  const cardText = await s.p.locator('[data-testid="seller-rates-card"]').textContent();
  T(`${P}-R2`, 'out-of-range LOM 5,000,000 refused by the server, error shown, rate unchanged', Number(rate2.lom_rate_uzs) === lom && /ERR_RATE_OUT_OF_RANGE|diapazon|oraliq|ruxsat/i.test(cardText), { lom, message: 'shown' }, { lom: rate2.lom_rate_uzs, message: (cardText.match(/ERR_[A-Z_]+[^.]{0,60}/) || [''])[0] });
  await s.p.screenshot({ path: `${SHOTS}/${P}-kassam.png` });
  // 2. new customer
  await go(s, '/sales/app/customers');
  await s.p.getByRole('button', { name: /Yangi Mijoz Qo/ }).first().click();
  await s.p.fill('input[placeholder="Masalan: Dilrabo Karimova"]', custName);
  await s.p.getByRole('button', { name: /Mijozni Saqlash/ }).dblclick(); await s.p.waitForTimeout(3000);
  const custRows = await sel(`customers?contact_name=eq.${encodeURIComponent(custName)}&select=id,customer_code,seller_id,organization_id`);
  T(`${P}-C`, `customer "${custName}" created in the UI (double click -> one row, own seller)`, custRows.length === 1 && custRows[0].seller_id === SID, { rows: 1, seller: tag }, custRows, { record_id: custRows[0] && custRows[0].id });
  const CID = custRows[0].id;
  // 3. scan sale + receipt
  const pieces = await sel(`consignment_pieces?seller_id=eq.${SID}&status=eq.held_by_seller&select=id,weight_grams`);
  const scanPiece = pieces.find((p) => Math.abs(Number(p.weight_grams) - Number(scanW)) < 1e-6);
  const a0 = await acct();
  await go(s, '/sales/app/scan');
  const scanIn = s.p.locator('input[placeholder*="Vazn shtrixkodini skaner qiling"]').first();
  await scanIn.fill(String(scanW)); await s.p.getByRole('button', { name: /^Kiritish$/ }).click(); await s.p.waitForTimeout(1200);
  await s.p.locator(`select:has(option[value="${CID}"])`).first().selectOption(CID);
  const mk = s.p.locator('form:has(button:has-text("Savdoni Tasdiqlash")) input[type="number"]').first();
  await mk.fill(String(scanM));
  const n0 = s.rpcs.length;
  await s.p.getByRole('button', { name: /Savdoni Tasdiqlash/ }).dblclick(); await s.p.waitForTimeout(4000);
  const saleCalls = s.rpcs.slice(n0).filter((x) => x.rpc === 'rpc_record_barcode_piece_sale');
  const receiptVisible = await s.p.locator('text=/SALE-|Chek|Kvitansiya/i').first().isVisible().catch(() => false);
  await s.p.screenshot({ path: `${SHOTS}/${P}-scan-receipt.png` });
  const scanSales = await sel(`jewelry_sales?customer_id=eq.${CID}&status=not.in.(reversed,cancelled)&select=id,sale_no,base_weight_grams,client_gold_due_grams,sale_type`);
  const dueScan = dh(U4(scanW) * (100 + Number(scanM)), 100) / 1e4;
  const a1 = await acct();
  T(`${P}-S1`, `scan sale of the ${scanW} g piece @${scanM}% (double click): one sale, due ${dueScan} g, piece sold, seller stock -${scanW}`,
    scanPiece && scanSales.length === 1 && Number(scanSales[0].client_gold_due_grams) === dueScan && Math.abs(a0.ph - a1.ph - Number(scanW)) < 5e-5,
    { sales: 1, due: dueScan, stock_delta: -Number(scanW) }, { sales: scanSales.length, due: scanSales[0] && scanSales[0].client_gold_due_grams, stock_delta: r4(a1.ph - a0.ph), rpc_calls: saleCalls.map((x) => x.status) }, { record_id: scanSales[0] && scanSales[0].id, sale_no: scanSales[0] && scanSales[0].sale_no });
  state.ops = state.ops || [];
  if (scanSales[0]) state.ops.push({ op: 'scan_sale', ui: P, customer: CID, sale_id: scanSales[0].id, sale_no: scanSales[0].sale_no, piece_g: Number(scanW), markup: Number(scanM), expected_due: dueScan, actual_due: Number(scanSales[0].client_gold_due_grams) });
  T(`${P}-S2`, 'receipt (kvitansiya) shown after the scan sale', receiptVisible, 'visible', receiptVisible);
  // 4. weight sale with the chosen piece
  await go(s, '/sales/app/customers');
  const visibleRow = () => s.p.locator(`tr:has-text("${custName}"), div.rounded-2xl.p-4:has-text("${custName}")`).locator('visible=true').first();
  const row = visibleRow();
  const nasiyaBtn = row.locator('button', { hasText: '+ Nasiya' }).locator('visible=true');
  if (await nasiyaBtn.count()) await nasiyaBtn.first().click(); else { await s.p.getByRole('button', { name: /Nasiya savdo|\+ Nasiya/ }).first().click(); }
  await s.p.waitForTimeout(1200);
  const custSel = s.p.locator(`form select:has(option[value="${CID}"])`);
  if (await custSel.count()) await custSel.first().selectOption(CID);
  const cutPiece = pieces.find((p) => Math.abs(Number(p.weight_grams) - Number(cutPieceW)) < 1e-6);
  await s.p.locator('input[placeholder="Masalan: 15.0000"]').first().fill(String(cutG));
  await s.p.locator('[data-testid="weight-sale-source-piece"]').selectOption(cutPiece.id);
  await s.p.locator('xpath=//label[contains(., "Mijoz Ustama Foizi")]/following::input[1]').fill(String(cutM));
  await s.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).dblclick(); await s.p.waitForTimeout(4000);
  await s.p.screenshot({ path: `${SHOTS}/${P}-weight-sale.png` });
  const wSales = await sel(`jewelry_sales?customer_id=eq.${CID}&sale_type=eq.weight&status=not.in.(reversed,cancelled)&select=id,sale_no,client_gold_due_grams`);
  const alloc = wSales[0] ? await sel(`weight_sale_allocations?sale_id=eq.${wSales[0].id}&select=piece_id,grams`) : [];
  const cutNow = (await sel(`consignment_pieces?id=eq.${cutPiece.id}&select=weight_grams`))[0];
  const dueCut = dh(U4(cutG) * (100 + Number(cutM)), 100) / 1e4;
  T(`${P}-W`, `weight sale ${cutG} g @${cutM}% cut from the chosen ${cutPieceW} g piece (double click -> one sale)`,
    wSales.length === 1 && Number(wSales[0].client_gold_due_grams) === dueCut && alloc.length === 1 && alloc[0].piece_id === cutPiece.id && Math.abs(Number(cutNow.weight_grams) - (Number(cutPieceW) - Number(cutG))) < 5e-5,
    { sales: 1, due: dueCut, piece_left: r4(Number(cutPieceW) - Number(cutG)) }, { sales: wSales.length, due: wSales[0] && wSales[0].client_gold_due_grams, alloc, piece_left: cutNow.weight_grams }, { record_id: wSales[0] && wSales[0].id, sale_no: wSales[0] && wSales[0].sale_no });
  if (wSales[0]) state.ops.push({ op: 'weight_sale', ui: P, customer: CID, sale_id: wSales[0].id, sale_no: wSales[0].sale_no, grams: Number(cutG), piece: cutPiece.id, markup: Number(cutM), expected_due: dueCut, actual_due: Number(wSales[0].client_gold_due_grams) });
  if (cash || usdPaid || scrapG) {
  // 5. payment UZS + USD + LOM at the seller's own rate; then a wrong-rate attempt
  const payGrams = r4((cash ? dh(cash * 1e4, lom) / 1e4 : 0) + (usdPaid ? dh(usdPaid * usdRate * 1e4, lom) / 1e4 : 0) + (scrapG ? dh(U4(scrapG) * proba, 585) / 1e4 : 0));
  const openPay = async () => {
    await go(s, '/sales/app/customers');
    const r2 = visibleRow();
    const b = r2.locator('button', { hasText: "To'lov" }).locator('visible=true');
    if (await b.count()) await b.first().click(); else await s.p.getByRole('button', { name: /To'lov olish|To'lov Qabul/ }).first().click();
    await s.p.waitForTimeout(1200);
    const cs = s.p.locator(`form select:has(option[value="${CID}"])`); if (await cs.count()) await cs.first().selectOption(CID);
  };
  await openPay();
  const shownLom = await s.p.locator('input[placeholder="Masalan: 950000"]').inputValue().catch(() => null);
  const shownUsd = await s.p.locator('input[placeholder="Masalan: 12800"]').first().inputValue().catch(() => null);
  if (scrapG) { await s.p.fill('input[placeholder="0.0000"]', String(scrapG)); await s.p.locator('xpath=//label[contains(., "Lom Probasi")]/following::select[1]').selectOption(String(proba)).catch(() => {}); }
  if (cash) await s.p.fill('input[placeholder="0"]', String(cash));
  if (usdPaid) await s.p.fill('input[placeholder="$ 0"]', String(usdPaid));
  const set0 = (await sel(`gold_settlements?customer_id=eq.${CID}&select=id`)).length;
  await s.p.locator('form:has(input[placeholder="$ 0"]) button[type="submit"]').dblclick(); await s.p.waitForTimeout(4000);
  await s.p.screenshot({ path: `${SHOTS}/${P}-payment.png` });
  const setl = await sel(`gold_settlements?customer_id=eq.${CID}&select=id,settlement_no,total_settled_grams,rate_applied,usd_rate_applied&order=created_at.desc`);
  const acc = (await sel(`client_gold_accounts?customer_id=eq.${CID}&select=d:current_debt_grams,a:advance_balance_grams`))[0];
  const expDebt = r4(dueScan + dueCut - payGrams);
  T(`${P}-P1`, `payment ${cash} UZS + ${usdPaid} USD + ${scrapG} g @${proba} at own rate ${lom}/${usdRate} (double click -> one payment)`,
    setl.length - set0 === 1 && Math.abs(Number(setl[0].total_settled_grams) - payGrams) < 5e-5 && Number(setl[0].rate_applied) === lom,
    { payments: 1, grams: payGrams, rate: lom }, { payments: setl.length - set0, grams: setl[0] && setl[0].total_settled_grams, rate: setl[0] && setl[0].rate_applied, usd_rate: setl[0] && setl[0].usd_rate_applied, form_rates: [shownLom, shownUsd] }, { record_id: setl[0] && setl[0].id, settlement_no: setl[0] && setl[0].settlement_no });
  if (setl[0] && setl.length - set0 === 1) state.ops.push({ op: 'payment', ui: P, customer: CID, settlement_id: setl[0].id, settlement_no: setl[0].settlement_no, cash, usd: usdPaid, scrap_g: scrapG, proba, rate: lom, usd_rate: usdRate, expected_grams: payGrams, actual_grams: Number(setl[0].total_settled_grams) });
  T(`${P}-P2`, `customer debt after the two sales and the payment = ${expDebt} g`, Math.abs(Number(acc.d) - Number(acc.a) - expDebt) < 5e-5, expDebt, r4(Number(acc.d) - Number(acc.a)));
  const a2 = await acct();
  T(`${P}-P3`, 'seller till holds exactly the paid cash/USD/scrap', Number(a2.c) - Number(a1.c) === cash && Number(a2.u) - Number(a1.u) === usdPaid && Math.abs(Number(a2.sc) - Number(a1.sc) - (scrapG ? dh(U4(scrapG) * proba, 585) / 1e4 : 0)) < 5e-5,
    { cash, usd: usdPaid }, { cash: Number(a2.c) - Number(a1.c), usd: Number(a2.u) - Number(a1.u), scrap585: r4(Number(a2.sc) - Number(a1.sc)) });
  await openPay();
  await s.p.fill('input[placeholder="0"]', '100000');
  const rateBox = s.p.locator('input[placeholder="Masalan: 950000"]');
  const editable = await rateBox.isEditable().catch(() => false);
  if (editable) await rateBox.fill(String(lom + 10000));
  const set1 = (await sel(`gold_settlements?customer_id=eq.${CID}&select=id`)).length;
  await s.p.locator('form:has(input[placeholder="$ 0"]) button[type="submit"]').click(); await s.p.waitForTimeout(3000);
  const body = await s.p.textContent('body');
  const set2 = (await sel(`gold_settlements?customer_id=eq.${CID}&select=id`)).length;
  T(`${P}-P4`, editable ? 'payment at another rate typed in the form is refused by the server (ERR_RATE_MISMATCH), no settlement' : 'rate field is read-only for the seller (cannot pay at another rate)',
    editable ? set2 === set1 && /RATE_MISMATCH|kurs/i.test(body) : true, editable ? 'refused' : 'read-only', editable ? { new_settlements: set2 - set1, message: (body.match(/ERR_RATE_MISMATCH[^.]{0,60}/) || [''])[0] } : 'read-only');
  if (set2 > set1) state.notes.push({ warning: `${P}: wrong-rate payment accepted`, settlements: set2 - set1 });
  await s.p.keyboard.press('Escape').catch(() => {});
  }
  // 6. refresh + logout
  await s.p.reload({ waitUntil: 'networkidle' }); await s.p.waitForTimeout(1500);
  T(`${P}-F`, 'session survives a refresh', !s.p.url().includes('/sales/login'), 'logged in', s.p.url().replace(BASE, ''));
  await require('./ui-lib').logout(s);
  await s.p.waitForTimeout(2500); await s.p.goto(BASE + '/sales/app', { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1500);
  T(`${P}-O`, 'logout ends the session (protected page goes to login)', s.p.url().includes('/sales/login'), '/sales/login', s.p.url().replace(BASE, ''));
  T(`${P}-E`, `${tag} session: no unexpected failed API call`, s.bad.filter((b) => !/rpc_record_client_settlement|rpc_set_my_seller_rates/.test(b)).length === 0, [], s.bad);
  state.sessions = state.sessions || {}; state.sessions[P] = { customer: CID, scan_sale: scanSales[0], weight_sale: wSales[0], expDebt: r4(dueScan + dueCut) };
  await br.close(); save();
})().catch((e) => { console.error('FATAL', e.stack.split('\n').slice(0, 3).join(' ')); save(); process.exit(1); });
