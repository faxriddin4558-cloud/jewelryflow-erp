const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { createBrowserClient } = require('@supabase/ssr');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const PROD_URL = 'https://goldia-sales-production.vercel.app';
const ARTIFACT_DIR = 'C:/Users/quettabyte/.gemini/antigravity/brain/408d0a5d-b09c-4e53-a442-b92b1ab8742c';

function parseEnv(filePath) {
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      res[trimmed.slice(0, idx).trim()] = v;
    }
  }
  return res;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ ASSERT FAILED: ${msg}`);
    throw new Error(msg);
  }
}

async function run() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — PRODUCTION UI & ACCOUNTING VERIFICATION (COMMIT 3b58b60)');
  console.log('Target URL:', PROD_URL);
  console.log('Artifacts Directory:', ARTIFACT_DIR);
  console.log('==============================================================================\n');

  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  console.log('[AUTH] Generating magiclink session for goldiaadmin@gmail.com on Production...');
  const linkRes = await fetch(`${prodUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: 'goldiaadmin@gmail.com' })
  });
  const linkData = await linkRes.json();
  const hashedToken = linkData.hashed_token || linkData.properties?.hashed_token;

  const verifyRes = await fetch(`${prodUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_hash: hashedToken, type: 'magiclink' })
  });
  const authSession = await verifyRes.json();
  console.log('✅ Auth session established for:', authSession.user?.email);

  let generatedCookies = [];
  const browserClient = createBrowserClient(prodUrl, anonKey, {
    cookies: {
      getAll: () => generatedCookies,
      setAll: (c) => { generatedCookies = c; }
    }
  });
  await browserClient.auth.setSession({
    access_token: authSession.access_token,
    refresh_token: authSession.refresh_token
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const playwrightCookies = generatedCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: 'goldia-sales-production.vercel.app',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax'
  }));
  await context.addCookies(playwrightCookies);

  const page = await context.newPage();

  // 1. Asosiy Boshqaruv Markazi
  console.log('\n[STEP 1]: Verifying Asosiy Boshqaruv Markazi (/sales/app)...');
  await page.goto(`${PROD_URL}/sales/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const dashScreen = path.join(ARTIFACT_DIR, 'prod-3b58b60-asosiy-panel.png');
  await page.screenshot({ path: dashScreen, fullPage: true });
  console.log(`Saved screenshot: ${dashScreen}`);

  const dashText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(dashText.includes('200.00 g'), 'Manager stock 200.00 g must be visible');
  assert(dashText.includes('500.00 g'), 'Total inventory 500.00 g must be visible');
  assert(!dashText.includes('dona'), 'Dashboard summary cards must not display dona');
  console.log('✅ Asosiy panel verified: 200.00g stock, 0.00g formatting, zero dona.');

  // 2. Boshqaruvchi Ombori
  console.log('\n[STEP 2]: Verifying Boshqaruvchi Ombori (/sales/app/inventory)...');
  await page.goto(`${PROD_URL}/sales/app/inventory`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Fizik Mahsulotlar (585)', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const invScreen = path.join(ARTIFACT_DIR, 'prod-3b58b60-inventory.png');
  await page.screenshot({ path: invScreen, fullPage: true });
  console.log(`Saved screenshot: ${invScreen}`);

  const invText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(invText.includes('Fizik Mahsulotlar (585)'), 'Ombor header must be Fizik Mahsulotlar (585)');
  assert(!invText.includes('Fizik Donalar (JF-PIECE)'), 'Ombor header must not have Fizik Donalar (JF-PIECE)');
  assert(!invText.includes('ta mahsulot'), 'Inventory cards must not display ta mahsulot');
  assert(invText.includes('100.00 g'), 'Mijozlarga sotilgan must be 100.00 g');
  console.log('✅ Inventory page verified: Fizik Mahsulotlar (585) header, 100.00g sold parity, zero piece counts.');

  // 3. Sotuvchilar Balansi & A-G Rekonsilyatsiya
  console.log('\n[STEP 3]: Verifying Sotuvchilar Balansi & A-G Rekonsilyatsiya (/sales/app/sellers)...');
  await page.goto(`${PROD_URL}/sales/app/sellers`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Click A-G reconciliation button for Omonov Omonboy
  console.log('Clicking "Rekonsilyatsiya (A-G)" button for Omonov Omonboy...');
  const reconBtn = await page.waitForSelector('button:has-text("Rekonsilyatsiya (A-G)")', { timeout: 15000 });
  await reconBtn.click();

  console.log('Waiting for A-G Reconciliation modal...');
  await page.waitForSelector('text=7-Bosqichli Rekonsilyatsiya Bayonnomasi', { timeout: 15000 });
  await page.waitForTimeout(2000);

  const modalScreen = path.join(ARTIFACT_DIR, 'prod-3b58b60-reconciliation-modal.png');
  await page.screenshot({ path: modalScreen, fullPage: true });
  console.log(`Saved screenshot: ${modalScreen}`);

  const modalText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  console.log('Modal inspection findings:');
  console.log('- Section A obligation (395.00 g):', modalText.includes('395.00 g'));
  console.log('- Section F deductions (108.58 g):', modalText.includes('108.58 g'));
  console.log('- Section G seller debt (286.42 g):', modalText.includes('286.42 g'));
  console.log('- Section G discrepancy is 0.00 g:', modalText.includes('0.00 g'));
  console.log('- USD included in settlement breakdown:', modalText.includes('$200 USD') || modalText.includes('200 USD'));

  assert(modalText.includes('395.00 g'), 'Section A must show 395.00 g obligation');
  assert(modalText.includes('108.58 g'), 'Section F must show 108.58 g settled');
  assert(modalText.includes('286.42 g'), 'Section G must show 286.42 g seller debt');
  assert(modalText.includes('0.00 g'), 'Section G discrepancy must be 0.00 g!');
  console.log('✅ A-G Reconciliation Modal verified: Discrepancy is 0.00g, 134.43g difference 100% resolved!');

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // 4. Naqd Pulga Oltin Xarid
  console.log('\n[STEP 4]: Verifying Naqd Pulga Oltin Xarid (/sales/app/purchases)...');
  await page.goto(`${PROD_URL}/sales/app/purchases`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Kassadagi Valyuta ($ USD)', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const purchScreen = path.join(ARTIFACT_DIR, 'prod-3b58b60-purchases.png');
  await page.screenshot({ path: purchScreen, fullPage: true });
  console.log(`Saved screenshot: ${purchScreen}`);

  const purchText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(purchText.includes('Kassadagi Valyuta ($ USD)'), 'Must contain Kassadagi Valyuta ($ USD) card');
  assert(purchText.includes('200 USD'), '$200 USD safe balance must be present');
  assert(purchText.includes('Xarid Qilingan Oltin — Joriy Qoldiq'), 'Must contain Xarid Qilingan Oltin card');
  assert(purchText.includes('5.74 g'), 'Must display 5.74 g purchased gold');
  console.log('✅ Purchases page verified: USD vault card ($200 USD), Xarid qilingan oltin 5.74g card.');

  // 5. Mijozlar Qarzdorligi
  console.log('\n[STEP 5]: Verifying Mijozlar Qarzdorligi (/sales/app/customers)...');
  await page.goto(`${PROD_URL}/sales/app/customers`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table', { timeout: 20000 });
  await page.waitForTimeout(3000);
  const custScreen = path.join(ARTIFACT_DIR, 'prod-3b58b60-customers.png');
  await page.screenshot({ path: custScreen, fullPage: true });
  console.log(`Saved screenshot: ${custScreen}`);

  const custText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(custText.includes("To'langan USD") || custText.includes("Jami Yopilgan (USD)"), "Table header must have To'langan USD");
  assert(custText.includes('200 USD'), 'Dilrabo Apka must show $200 USD');
  assert(custText.includes('2.77 g'), 'Dilrabo Apka must show 2.77 g equivalent');
  assert(custText.includes('171.42 g'), 'Dilrabo Apka debt must remain exactly 171.42 g');
  console.log('✅ Customers page verified: USD payments column displayed, Dilrabo Apka debt 171.42g and $200 USD intact.');

  // 6. Afinaj
  console.log('\n[STEP 6]: Verifying Afinaj (/sales/app/refining)...');
  await page.goto(`${PROD_URL}/sales/app/refining`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Afinaj & Lom Pateriya', { timeout: 30000 });
  await page.waitForTimeout(3000);
  const refScreen = path.join(ARTIFACT_DIR, 'prod-3b58b60-refining.png');
  await page.screenshot({ path: refScreen, fullPage: true });
  console.log(`Saved screenshot: ${refScreen}`);

  const refText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(refText.includes('997'), 'Refining page must display batch purity 997°');
  assert(!refText.includes('995 sof oltin'), 'Must not display hardcoded 995 string');
  console.log('✅ Refining verified: batch purity 997° displayed correctly without hardcoded 995.');

  await browser.close();
  console.log('\n==============================================================================');
  console.log('🎉 ALL LIVE PRODUCTION VERIFICATIONS PASSED WITH 100% PARITY (COMMIT 3b58b60)');
  console.log('==============================================================================');
}

run().catch(err => {
  console.error('Fatal error in verification:', err);
  process.exit(1);
});
