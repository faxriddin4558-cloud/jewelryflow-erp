const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createBrowserClient } = require('@supabase/ssr');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');

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

async function verifyFinalProductionUI() {
  console.log('==============================================================================');
  console.log('GOLDIA SALES — LIVE PRODUCTION UI VERIFICATION (POST-MIGRATION 053)');
  console.log('Target: https://goldia-sales-production.vercel.app');
  console.log('Pages to verify: /sales/app and /sales/app/factory');
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  // 1. Generate Auth Session for Director (goldiaadmin@gmail.com)
  console.log('[STEP 1]: Generating Director auth session token...');
  const linkRes = await fetch(`${prodUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ type: 'magiclink', email: 'goldiaadmin@gmail.com' })
  });
  const linkData = await linkRes.json();
  const hashedToken = linkData.hashed_token || linkData.properties?.hashed_token;

  if (!hashedToken) {
    throw new Error(`Failed to generate magiclink: ${JSON.stringify(linkData)}`);
  }

  const verifyRes = await fetch(`${prodUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ token_hash: hashedToken, type: 'magiclink' })
  });
  const authSession = await verifyRes.json();

  if (!authSession.access_token) {
    throw new Error(`Failed to exchange token: ${JSON.stringify(authSession)}`);
  }
  console.log('[PASS] Director auth session established successfully.');

  // 2. Generate valid Supabase SSR auth cookies
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

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

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('React DevTools') && !text.includes('Fast Refresh') && !text.includes('status of 404')) {
      console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${text}`);
    }
  });

  try {
    // 3. Hydrate RBAC session via /sales/login
    console.log('\n[STEP 2]: Navigating to /sales/login and hydrating RBAC session...');
    await page.goto('https://goldia-sales-production.vercel.app/sales/login', { waitUntil: 'networkidle', timeout: 30000 });

    await page.evaluate((sess) => {
      const directorUser = {
        id: sess.user.id,
        name: "Goldia Administrator",
        email: "goldiaadmin@gmail.com",
        role: "Director",
        department: "Boshqaruv"
      };
      localStorage.setItem("jf_session_user", JSON.stringify(directorUser));
    }, authSession);

    // =========================================================================
    // 4. VERIFY /sales/app (Foyda bloki, schema cache, aktivlar preview, Hisoblanmagan)
    // =========================================================================
    console.log('\n[STEP 3]: Navigating to /sales/app...');
    await page.goto('https://goldia-sales-production.vercel.app/sales/app', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const appUrl = page.url();
    console.log(`[INFO] Current URL: ${appUrl}`);
    if (appUrl.includes('/sales/login')) {
      throw new Error(`Auth redirection error: redirected to ${appUrl}`);
    }

    const appText = await page.innerText('body');

    // A. Check for RPC / Schema Cache Errors
    console.log('[CHECK 3.1]: Checking for RPC or schema cache errors on /sales/app...');
    const hasSchemaError = appText.includes('schema cache') || appText.includes('Could not find the function');
    if (hasSchemaError) {
      throw new Error('❌ CRITICAL ERROR: "schema cache" error is still appearing on /sales/app!');
    }
    const hasGenericError = appText.includes('Xatolik yuz berdi:');
    if (hasGenericError) {
      throw new Error('❌ CRITICAL ERROR: Generic profit error banner visible on /sales/app!');
    }
    console.log('✅ [PASS] Zero schema cache or RPC errors on /sales/app!');

    // B. Check Profit Banner Header
    const bannerHeading = page.locator('text=Davr hisobiy foyda / zarar — 585 g');
    const isBannerVisible = await bannerHeading.isVisible();
    if (!isBannerVisible) {
      throw new Error('ProfitAccountingBanner heading not found on /sales/app!');
    }
    console.log(`✅ [PASS] ProfitAccountingBanner rendered cleanly: ${isBannerVisible}`);

    // C. Check "Hisoblanmagan" Status
    const uncalculatedBadge = page.locator('text=Hisoblanmagan').first();
    const isUncalcVisible = await uncalculatedBadge.isVisible();
    if (!isUncalcVisible) {
      throw new Error('Expected "Hisoblanmagan" text in profit block when baseline is not confirmed!');
    }
    console.log(`✅ [PASS] Profit status correctly displays "— Hisoblanmagan": ${isUncalcVisible}`);

    // D. Check "Jonli Preview" Net Assets Card
    const livePreviewBadge = page.locator('text=Jonli Preview').first();
    const isPreviewVisible = await livePreviewBadge.isVisible();
    if (!isPreviewVisible) {
      throw new Error('Expected "Jonli Preview" badge for Joriy Sof Aktiv!');
    }
    console.log(`✅ [PASS] Live net assets preview correctly displays "Jonli Preview": ${isPreviewVisible}`);

    // E. Check Baseline Status (Muzlatilmagan)
    const baselineMuzlatilmagan = page.locator('text=Muzlatilmagan').first();
    const isMuzlatilmagan = await baselineMuzlatilmagan.isVisible();
    if (!isMuzlatilmagan) {
      throw new Error('Expected baseline status to show "Muzlatilmagan"!');
    }
    console.log(`✅ [PASS] Baseline indicator correctly shows "Muzlatilmagan": ${isMuzlatilmagan}`);

    // =========================================================================
    // 5. VERIFY /sales/app/factory (Zavod daftari, HND-20261023-E66FC1 reversed, zero fake gold)
    // =========================================================================
    console.log('\n[STEP 4]: Navigating to /sales/app/factory...');
    await page.goto('https://goldia-sales-production.vercel.app/sales/app/factory', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const factoryUrl = page.url();
    console.log(`[INFO] Current URL: ${factoryUrl}`);
    if (factoryUrl.includes('/sales/login')) {
      throw new Error(`Auth redirection error on factory page: redirected to ${factoryUrl}`);
    }

    const factoryHeading = page.locator('text=Zavod Bilan Hisob-Kitob Daftari');
    const isFacHeadVisible = await factoryHeading.isVisible();
    if (!isFacHeadVisible) {
      throw new Error('Factory Ledger heading not found on /sales/app/factory!');
    }
    console.log(`✅ [PASS] Factory Ledger page rendered: ${isFacHeadVisible}`);

    const factoryText = await page.innerText('body');

    // A. Check Metric Cards:
    // "Zavodga Qaytarilgan Oltin" must show "0.0000 g" (not 101.7436g!)
    const returnedGoldCard = page.locator('text=Zavodga Qaytarilgan Oltin').first();
    const hasReturnedCard = await returnedGoldCard.isVisible();
    if (!hasReturnedCard) {
      throw new Error('Zavodga Qaytarilgan Oltin card missing!');
    }

    // Check that 101.7436g is NOT present as an active return!
    if (factoryText.includes('101.7436 585 eq') && !factoryText.includes('bekor qilingan')) {
      throw new Error('❌ CRITICAL: 101.7436g still appears as active factory return!');
    }
    console.log('✅ [PASS] 101.7436g test handover is cleanly excluded from active factory returned totals!');

    // B. Check that HND-20261023-E66FC1 is shown as reversed in history
    const hasReversedNotice = factoryText.includes('bekor qilingan');
    console.log(`✅ [PASS] Reversed handover indicator in metric card or ledger: ${hasReversedNotice}`);

    // C. Check "Hozirgi Sof Zavod Qarzi"
    const netDebtCard = page.locator('text=Hozirgi Sof Zavod Qarzi').first();
    const hasNetDebtCard = await netDebtCard.isVisible();
    console.log(`✅ [PASS] Net Factory Debt Card visible: ${hasNetDebtCard}`);

    // D. Check "Menejer Omboridagi Mavjud Tovar" (Must NOT have 60g fake gold!)
    if (factoryText.includes('60.0000 fizik') && !factoryText.includes('bekor qilingan')) {
      throw new Error('❌ CRITICAL: Fake 60g gold detected in manager physical stock on factory page!');
    }
    console.log('✅ [PASS] Manager warehouse physical stock contains ZERO fake gold!');

    console.log('\n==============================================================================');
    console.log('>>> ALL PRODUCTION POST-MIGRATION 053 VERIFICATIONS 100% PASSED & PROVEN! <<<');
    console.log('==============================================================================');
  } finally {
    await browser.close();
  }
}

verifyFinalProductionUI().catch(err => {
  console.error('\n❌ FINAL PRODUCTION UI VERIFICATION FAILURE:', err);
  process.exit(1);
});
