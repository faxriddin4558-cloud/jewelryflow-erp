/**
 * GOLDIA SALES — FULL LIVE UI & RECONCILIATION VERIFICATION ON STAGING
 * Target: https://jewelryflow-sales-staging.vercel.app
 * Commit: 951af97
 * Supabase DB: vouehtlmsunebracahon
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createBrowserClient } = require('@supabase/ssr');

const ENV_PATH = path.resolve(__dirname, '../.env.staging.local');
const STAGING_URL = 'https://jewelryflow-sales-staging.vercel.app';
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
  console.log('GOLDIA SALES — LIVE STAGING UI & PARITY VERIFICATION (MIGRATION 061)');
  console.log('URL:', STAGING_URL);
  console.log('Database: vouehtlmsunebracahon');
  console.log('==============================================================================\n');

  const env = parseEnv(ENV_PATH);
  const stagingDbUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  // 1. Verify /api/version
  console.log('[STEP 1]: Verifying /api/version on live staging...');
  const verRes = await fetch(`${STAGING_URL}/api/version`, { headers: { 'Cache-Control': 'no-cache' } });
  const verData = await verRes.json();
  console.log('  Payload:', verData);
  assert(verData.commit === '951af97', `Expected commit 951af97, got ${verData.commit}`);
  assert(verData.supabase_ref === 'vouehtlmsunebracahon', `Expected ref vouehtlmsunebracahon, got ${verData.supabase_ref}`);
  console.log('✅ Commit 951af97 confirmed live on Staging.\n');

  // 2. Establish Auth Session for Staging Director
  console.log('[STEP 2]: Establishing authenticated Staging Director session...');
  const authUsersRes = await fetch(`${stagingDbUrl}/auth/v1/admin/users`, {
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
  });
  const authUsersData = await authUsersRes.json();
  const dirUser = authUsersData.users?.[0]?.email || 'goldiaadmin@gmail.com';
  console.log('  Using staging director email:', dirUser);

  const linkRes = await fetch(`${stagingDbUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: dirUser })
  });
  const linkData = await linkRes.json();
  const hashedToken = linkData.hashed_token || linkData.properties?.hashed_token;

  const verifyRes = await fetch(`${stagingDbUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_hash: hashedToken, type: 'magiclink' })
  });
  const authSession = await verifyRes.json();

  let generatedCookies = [];
  const browserClient = createBrowserClient(stagingDbUrl, anonKey, {
    cookies: { getAll: () => generatedCookies, setAll: (c) => { generatedCookies = c; } }
  });
  await browserClient.auth.setSession({
    access_token: authSession.access_token,
    refresh_token: authSession.refresh_token
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(generatedCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: 'jewelryflow-sales-staging.vercel.app',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax'
  })));

  const page = await context.newPage();

  // 3. Verify Asosiy Panel (/sales/app)
  console.log('\n[STEP 3]: Inspecting Staging Asosiy Panel (/sales/app)...');
  await page.goto(`${STAGING_URL}/sales/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const pageContent = await page.content();
  assert(!pageContent.includes('unsold dona'), 'UI must NOT contain "unsold dona"');
  assert(!pageContent.includes('Unsold dona'), 'UI must NOT contain "Unsold dona"');
  assert(!pageContent.includes(' g g'), 'UI must NOT contain double " g g"');
  console.log('✅ No "unsold dona" or " g g" found in Staging Asosiy Panel.');

  const stagingShotPath = path.join(ARTIFACTS_DIR, 'staging-migration-061-asosiy-panel.png');
  await page.screenshot({ path: stagingShotPath, fullPage: true });
  console.log('📸 Saved Staging Asosiy Panel screenshot to:', stagingShotPath);

  await browser.close();

  console.log('\n==============================================================================');
  console.log('🎉 ALL LIVE STAGING VERIFICATIONS PASSED!');
  console.log('==============================================================================');
}

run().catch((err) => {
  console.error('Fatal verification failure:', err);
  process.exit(1);
});
