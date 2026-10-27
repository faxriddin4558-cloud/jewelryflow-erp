/**
 * Verify Commit 9ad1e94 on Live Production
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createBrowserClient } = require('@supabase/ssr');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const PROD_URL = 'https://goldia-sales-production.vercel.app';

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
    console.error('❌ ASSERT FAILED:', msg);
    throw new Error(msg);
  }
}

(async () => {
  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  console.log('Generating auth session for goldiaadmin@gmail.com on production...');
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

  // Test 1: Dashboard
  console.log('\n[PROD TEST 1] Verifying Dashboard...');
  await page.goto(`${PROD_URL}/sales/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const dashText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(dashText.includes('200.00 g'), 'Manager stock 200.00 g must be visible');
  assert(dashText.includes('500.00 g'), 'Total inventory 500.00 g must be visible');
  console.log('✅ Dashboard stock parity verified.');
  await page.screenshot({ path: 'scripts/prod-9ad1e94-dashboard.png', fullPage: true });

  // Test 2: Inventory page
  console.log('\n[PROD TEST 2] Verifying Inventory page...');
  await page.goto(`${PROD_URL}/sales/app/inventory`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Fizik Mahsulotlar (585)', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const invText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(invText.includes('Fizik Mahsulotlar (585)'), 'Ombor header must be Fizik Mahsulotlar (585)');
  assert(!invText.includes('Fizik Donalar (JF-PIECE)'), 'Ombor header must not have Fizik Donalar (JF-PIECE)');
  assert(invText.includes('100.00 g'), 'Mijozlarga sotilgan must be 100.00 g');
  console.log('✅ Inventory terminology and 100.00 g sold parity verified.');
  await page.screenshot({ path: 'scripts/prod-9ad1e94-inventory.png', fullPage: true });

  // Test 3: Purchases page
  console.log('\n[PROD TEST 3] Verifying Purchases page...');
  await page.goto(`${PROD_URL}/sales/app/purchases`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Kassadagi Valyuta ($ USD)', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const purText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(purText.includes('Kassadagi Valyuta ($ USD)'), 'Kassadagi Valyuta ($ USD) card must be present');
  assert(purText.includes('1,000 USD'), '$1,000 USD safe balance must be present');
  console.log('✅ Purchases page USD balance KPI verified.');
  await page.screenshot({ path: 'scripts/prod-9ad1e94-purchases.png', fullPage: true });

  // Test 4: Customers directory
  console.log('\n[PROD TEST 4] Verifying Customers directory...');
  await page.goto(`${PROD_URL}/sales/app/customers`, { waitUntil: 'networkidle' });
  await page.waitForSelector('td:has-text("Dilrabo Apka")', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const custText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(custText.includes("To'langan USD"), "Table header must have To'langan USD");
  assert(custText.includes('1,000 USD'), 'Dilrabo Apka must show 1,000 USD');
  assert(custText.includes('13.52 g'), 'Dilrabo Apka must show 13.52 g equivalent');
  assert(custText.includes('90.11 g'), 'Dilrabo Apka debt must remain exactly 90.11 g');
  console.log('✅ Customer paid USD and Dilrabo Apka 90.11 g debt verified.');
  await page.screenshot({ path: 'scripts/prod-9ad1e94-customers.png', fullPage: true });

  await browser.close();
  console.log('\n=======================================================');
  console.log('🎉 ALL PRODUCTION VERIFICATIONS PASSED WITH 100% PARITY');
  console.log('=======================================================');
})().catch(err => {
  console.error('Fatal error in verification:', err);
  process.exit(1);
});
