const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { session, login, R, results, BASE } = require('./explore');
const { Pool } = require('/opt/goldia-audit/node_modules/pg');
const db = new Pool({ host: '/opt/goldia-audit/pg', port: 55432, user: 'postgres', database: 'postgres' });
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const s = await session(browser, 'SELLER_A', 't.sellera@audit.test', { width: 390, height: 844 });
  await login(s); await s.page.goto(BASE + '/sales/mobile', { waitUntil: 'networkidle' }); await s.page.waitForTimeout(1500);
  const ca2 = (await q1(`select id from customers where customer_code='CUST-0002'`)).id;
  const before = await q1(`select current_debt_grams d from client_gold_accounts where customer_id=$1`, [ca2]);
  const nBefore = (await q1(`select count(*)::int n from gold_settlements where customer_id=$1`, [ca2])).n;
  // --- payment via UI: 2.0 g 750 scrap + 100,000 UZS
  await s.page.getByRole('button', { name: /To.lov Olish/ }).click(); await s.page.waitForTimeout(600);
  const sel = s.page.locator('select').filter({ has: s.page.locator(`option[value="${ca2}"]`) }).first();
  await sel.selectOption(ca2);
  await s.page.fill('#settleScrapWeightInput', '2.0'); await s.page.selectOption('#settleScrapPuritySelect', '750');
  const cash = s.page.locator('input[placeholder="0"]').first(); await cash.fill('100000');
  await s.page.screenshot({ path: 'shots/ui-seller-payment-form.png', fullPage: true });
  const submit = s.page.locator('form button[type="submit"]').filter({ hasText: /To.lov|Qabul|Saqlash|Tasdiq/ }).first();
  // double-click quickly to test double submission
  await submit.dblclick().catch(() => {}); await s.page.waitForTimeout(3000);
  await s.page.screenshot({ path: 'shots/ui-seller-payment-result.png', fullPage: true });
  const after = await q1(`select current_debt_grams d from client_gold_accounts where customer_id=$1`, [ca2]);
  const nAfter = (await q1(`select count(*)::int n from gold_settlements where customer_id=$1`, [ca2])).n;
  const exp = Math.round((Number(before.d) - (2.0 * 750 / 585) - 0.1) * 10000) / 10000;
  R('UI-S1', 'SELLER_A', 'UI payment 2.0g@750 + 100,000 UZS reduces CA2 debt by 2.6641 g, exactly one settlement despite double-click', nAfter - nBefore === 1 && Math.abs(Number(after.d) - exp) < 0.0002, `debt ${before.d} -> ${after.d} (expected ${exp}); new settlements=${nAfter - nBefore}`);
  // refresh + new login persistence
  await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(1200);
  const txt = await s.page.textContent('body');
  R('UI-S2', 'SELLER_A', 'after reload, till shows 100 000 UZS and scrap 2.56 g', /100[\s,. ]?000/.test(txt) && /2\.56/.test(txt), (txt.match(/Kassamdagi Lom.{0,30}|Kassamdagi Naqd.{0,30}/g) || []).join(' | '));
  await s.page.screenshot({ path: 'shots/ui-seller-after-reload.png', fullPage: true });
  // --- scanner sale: weight barcode 7.65 -> ZN-03 piece
  await s.page.getByRole('button', { name: /Skaner Savdo/ }).click(); await s.page.waitForTimeout(500);
  const scan = s.page.locator('input[placeholder*="shtrixkod"]').first(); await scan.fill('7.65'); await scan.press('Enter'); await s.page.waitForTimeout(1200);
  await s.page.screenshot({ path: 'shots/ui-seller-scan-matched.png', fullPage: true });
  const ca1 = (await q1(`select id from customers where customer_code='CUST-0001'`)).id;
  const scanSel = s.page.locator('select').filter({ has: s.page.locator(`option[value="${ca1}"]`) }).first();
  await scanSel.selectOption(ca1).catch(e => console.log('select err', e.message));
  const markup = s.page.locator('input[type="number"]').filter({ hasNot: s.page.locator('[disabled]') });
  const salesBefore = (await q1(`select count(*)::int n from jewelry_sales where seller_id=$1`, ['a0000000-0000-4000-8000-00000000000a'])).n;
  const btn = s.page.locator('form button[type="submit"]').filter({ hasText: /Sot|Tasdiq|Savdo/ }).first();
  await btn.click().catch(e => console.log('btn err', e.message)); await s.page.waitForTimeout(2500);
  await s.page.screenshot({ path: 'shots/ui-seller-scan-sale-result.png', fullPage: true });
  const lastSale = await q1(`select sale_no, base_weight_grams, client_markup_pct, client_gold_due_grams, status from jewelry_sales where seller_id=$1 order by created_at desc limit 1`, ['a0000000-0000-4000-8000-00000000000a']);
  const salesAfter = (await q1(`select count(*)::int n from jewelry_sales where seller_id=$1`, ['a0000000-0000-4000-8000-00000000000a'])).n;
  R('UI-S3', 'SELLER_A', 'scanner sale of 7.65 g piece creates exactly one sale', salesAfter - salesBefore === 1 && Number(lastSale.base_weight_grams) === 7.65, JSON.stringify(lastSale));
  // seller sees only own customers in the payment dropdown
  const opts = await s.page.locator('option').allTextContents();
  R('UI-S4', 'SELLER_A', 'seller dropdowns list no customers of other sellers', !opts.some(o => /Mijoz B1|Avans mijoz|Mijoz C1|Forged/.test(o)), opts.filter(o => /Mijoz|CUST/.test(o)).join(' ; ').slice(0, 300));
  // logout
  await s.page.goto(BASE + '/sales/app', { waitUntil: 'networkidle' });
  const out = s.page.getByRole('button', { name: /Chiqish/ }).first(); await out.click().catch(() => {}); await s.page.waitForTimeout(1500);
  await s.page.goto(BASE + '/sales/mobile', { waitUntil: 'networkidle' });
  R('UI-S5', 'SELLER_A', 'after logout protected page redirects to login', s.page.url().includes('/sales/login'), s.page.url());
  console.log('console errors:', s.errors.slice(0, 5)); console.log('api errors:', s.bad.slice(0, 5));
  require('fs').writeFileSync('interact-results.json', JSON.stringify(results, null, 1));
  await browser.close(); await db.end();
})();
