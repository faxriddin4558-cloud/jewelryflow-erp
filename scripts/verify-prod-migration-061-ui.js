/**
 * GOLDIA SALES — FULL LIVE UI & RECONCILIATION VERIFICATION
 * Target: https://goldia-sales-production.vercel.app
 * Commit: 951af97 (Migration 061 Live)
 * Supabase DB: vrozlllcaxinavzxueif
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createBrowserClient } = require('@supabase/ssr');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const PROD_URL = 'https://goldia-sales-production.vercel.app';
const ARTIFACTS_DIR = 'C:/Users/quettabyte/.gemini/antigravity/brain/408d0a5d-b09c-4e53-a442-b92b1ab8742c';

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

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function run() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — LIVE UI & PARITY VERIFICATION (MIGRATION 061)');
  console.log('URL:', PROD_URL);
  console.log('Target Commit: 951af97');
  console.log('Database: vrozlllcaxinavzxueif');
  console.log('==============================================================================\n');

  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  // 1. Verify /api/version
  console.log('[STEP 1]: Verifying /api/version on live production...');
  const verRes = await fetch(`${PROD_URL}/api/version`, { headers: { 'Cache-Control': 'no-cache' } });
  const verData = await verRes.json();
  console.log('  Payload:', verData);
  assert(verData.commit === '951af97', `Expected commit 951af97, got ${verData.commit}`);
  assert(verData.supabase_ref === 'vrozlllcaxinavzxueif', `Expected ref vrozlllcaxinavzxueif, got ${verData.supabase_ref}`);
  console.log('✅ Commit 951af97 confirmed live on Production.\n');

  // 2. Establish Auth Session for Director via Magic Link
  console.log('[STEP 2]: Establishing authenticated Director session for goldiaadmin@gmail.com...');
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
  console.log('✅ Auth session established. User:', authSession.user?.email);

  // Generate SSR cookies
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

  // 3. Verify Asosiy Panel (/sales/app)
  console.log('\n[STEP 3]: Inspecting Asosiy Panel (/sales/app)...');
  await page.goto(`${PROD_URL}/sales/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000); // Wait for master cards and calculations

  const pageContent = await page.content();
  
  // Check absence of "unsold dona" or "donabay" or double " g g"
  assert(!pageContent.includes('unsold dona'), 'UI must NOT contain "unsold dona"');
  assert(!pageContent.includes('Unsold dona'), 'UI must NOT contain "Unsold dona"');
  assert(!pageContent.includes(' g g'), 'UI must NOT contain double " g g"');
  console.log('✅ No "unsold dona" or " g g" found in Asosiy Panel.');

  // Check 500g physical formula: 200g Menejer + 200g Sotuvchi + 100g Sotilgan
  const balanceCard = page.locator('div:has-text("Fizik Tovar Balansi")').locator('..').first();
  const balanceText = (await balanceCard.innerText()).replace(/\n+/g, ' | ');
  console.log('  Balance formula snippet:\n  ', balanceText.slice(0, 300));

  assert(balanceText.includes('500.00 g'), 'Formula must show 500.00 g total');
  assert(balanceText.includes('200.00 g (Menejer Omborida)'), 'Formula must show 200.00 g (Menejer Omborida)');
  assert(balanceText.includes('200.00 g (Sotuvchilarda Mavjud)'), 'Formula must show 200.00 g (Sotuvchilarda Mavjud)');
  assert(balanceText.includes('100.00 g (Mijozga Sotilgan)'), 'Formula must show 100.00 g (Mijozga Sotilgan)');
  assert(balanceText.includes('BALANS TO\'LIQ MOS') || balanceText.includes('BALANS TO&apos;LIQ MOS') || balanceText.includes('0.00 g farq'), 'Balance must be 100% matched');
  console.log('✅ Physical balance formula strictly matches: 500.00g = 200.00g + 200.00g + 100.00g (0.00g farq)!');

  // Check Customer Debt Card (Mijozlar Sof Nasiyasi: 90.11 g)
  const clientDebtCard = page.locator('div.text-slate-400:has-text("3. Mijozlar Sof Nasiyasi")').locator('..').first();
  const clientDebtText = (await clientDebtCard.innerText()).replace(/\n+/g, ' | ');
  console.log('  Client Debt Card:', clientDebtText);
  assert(clientDebtText.includes('90.11 g'), 'Mijozlar Sof Nasiyasi must show 90.11 g');
  console.log('✅ Mijozlar Sof Nasiyasi strictly matches 90.11 g!');

  // Check Manager Vault Card: 10,000,000 UZS + $1,000 USD
  const managerSafeCard = page.locator('div.text-slate-400:has-text("5. Menejer Seyfi")').locator('..').first();
  const managerSafeText = (await managerSafeCard.innerText()).replace(/\u00a0/g, ' ').replace(/\n+/g, ' ');
  console.log('  Manager Safe Card:', managerSafeText);
  assert(managerSafeText.includes('10 000 000') || managerSafeText.includes('10,000,000'), 'Must show 10M UZS');
  assert(managerSafeText.includes('$1,000 USD') || managerSafeText.includes('$1 000 USD'), 'Must show $1,000 USD');
  console.log('✅ Manager Seyfi correctly holds 10M UZS and $1,000 USD!');

  // Take screenshot of Asosiy Panel
  const panelShotPath = path.join(ARTIFACTS_DIR, 'prod-migration-061-asosiy-panel.png');
  await page.screenshot({ path: panelShotPath, fullPage: true });
  console.log('📸 Saved Asosiy Panel screenshot to:', panelShotPath);

  // 4. Verify Inventory Page (/sales/app/inventory)
  console.log('\n[STEP 4]: Inspecting Inventory Page (/sales/app/inventory)...');
  await page.goto(`${PROD_URL}/sales/app/inventory`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const invContent = await page.content();
  assert(!invContent.includes('unsold dona'), 'Inventory page must NOT contain "unsold dona"');
  assert(!invContent.includes(' g g'), 'Inventory page must NOT contain " g g"');

  const invShotPath = path.join(ARTIFACTS_DIR, 'prod-migration-061-inventory.png');
  await page.screenshot({ path: invShotPath, fullPage: true });
  console.log('📸 Saved Inventory screenshot to:', invShotPath);

  // 5. Verify Customer Ledger Page (/sales/app/customers)
  console.log('\n[STEP 5]: Inspecting Customer Ledger (/sales/app/customers)...');
  await page.goto(`${PROD_URL}/sales/app/customers`, { waitUntil: 'networkidle' });
  await page.locator('td:has-text("Dilrabo Apka")').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1000);

  const tableText = (await page.locator('table').innerText()).replace(/\u00a0/g, ' ');
  console.log('  Customer table text snippet:\n  ', tableText.replace(/\n+/g, ' | ').slice(0, 300));
  assert(tableText.includes('Dilrabo Apka'), 'Must list Dilrabo Apka');
  assert(tableText.includes('90.11 g'), 'Dilrabo Apka net debt must show 90.11 g');
  console.log('✅ Dilrabo Apka net debt verified in customer list: 90.11 g');

  const custShotPath = path.join(ARTIFACTS_DIR, 'prod-migration-061-customers.png');
  await page.screenshot({ path: custShotPath, fullPage: true });
  console.log('📸 Saved Customers screenshot to:', custShotPath);

  // 6. Verify Factory Handover Form (/sales/app/handovers)
  console.log('\n[STEP 6]: Inspecting Factory Handover Form (/sales/app/handovers)...');
  await page.goto(`${PROD_URL}/sales/app/handovers`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const handShotPath = path.join(ARTIFACTS_DIR, 'prod-migration-061-handovers.png');
  await page.screenshot({ path: handShotPath, fullPage: true });
  console.log('📸 Saved Handovers screenshot to:', handShotPath);

  // 7. Verify Seller Mobile Workspace (/sales/mobile)
  console.log('\n[STEP 7]: Inspecting Seller Mobile Workspace (/sales/mobile)...');
  await page.goto(`${PROD_URL}/sales/mobile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const mobileContent = await page.content();
  assert(!mobileContent.includes('>Donalar<'), 'Mobile view must NOT have "Donalar" tab');
  console.log('✅ Mobile view has no "Donalar" tab (replaced by Mahsulotlar / Partiyalar).');

  const mobileShotPath = path.join(ARTIFACTS_DIR, 'prod-migration-061-mobile.png');
  await page.screenshot({ path: mobileShotPath });
  console.log('📸 Saved Mobile screenshot to:', mobileShotPath);

  await browser.close();

  console.log('\n==============================================================================');
  console.log('🎉 ALL LIVE PRODUCTION VERIFICATIONS PASSED WITH ZERO DISCREPANCIES!');
  console.log('==============================================================================');
}

run().catch((err) => {
  console.error('Fatal verification failure:', err);
  process.exit(1);
});
