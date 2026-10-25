const { chromium } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { createChunks } = require('@supabase/ssr/dist/main/utils');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');

function parseEnv(filePath) {
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      res[k] = v;
    }
  }
  return res;
}

async function testInventory() {
  const env = parseEnv(ENV_PATH);
  const url = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
  const projectRef = 'vrozlllcaxinavzxueif';

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

  const { data: linkData } = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: 'goldiaadmin@gmail.com' });
  const { data: sessionData } = await anonClient.auth.verifyOtp({ token_hash: linkData.properties.hashed_token, type: 'magiclink' });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const sessionStr = JSON.stringify(sessionData.session);
  const base64Val = 'base64-' + Buffer.from(sessionStr).toString('base64url');
  const chunks = createChunks('sb-' + projectRef + '-auth-token', base64Val);

  await context.addCookies(chunks.map(c => ({
    name: c.name, value: c.value, domain: 'goldia-sales-production.vercel.app', path: '/', httpOnly: false, secure: true, sameSite: 'Lax'
  })));

  await context.addInitScript(({ session, user, ref }) => {
    localStorage.setItem('sb-' + ref + '-auth-token', JSON.stringify(session));
    localStorage.setItem('jf_session_user', JSON.stringify({
      id: user.id, name: 'Goldia Administrator', email: user.email, role: 'Director', department: 'Rahbariyat'
    }));
  }, { session: sessionData.session, user: sessionData.user, ref: projectRef });

  const page = await context.newPage();
  await page.goto('https://goldia-sales-production.vercel.app/sales/app/inventory', { waitUntil: 'networkidle', timeout: 35000 });
  await page.waitForTimeout(2000);

  const shot = path.resolve(__dirname, '../test-results/prod-verification/prod-sales-app-inventory.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log('Saved inventory screenshot to:', shot);

  const text = await page.textContent('body');
  console.log('Inventory page text includes 165:', text.includes('165'));
  console.log('Inventory page text includes ZVD:', text.includes('ZVD'));

  // Switch to "Zavod Partiyalari (Bo'linmagan)" tab if present
  const batchTab = page.locator('button', { hasText: 'Zavod Partiyalari' });
  if (await batchTab.count() > 0) {
    console.log('Clicking Zavod Partiyalari tab...');
    await batchTab.first().click();
    await page.waitForTimeout(1000);
    const batchShot = path.resolve(__dirname, '../test-results/prod-verification/prod-inventory-batches.png');
    await page.screenshot({ path: batchShot, fullPage: true });
    console.log('Saved batches view screenshot to:', batchShot);
    const batchText = await page.textContent('body');
    console.log('Batch text includes 165.00g:', batchText.includes('165.00') || batchText.includes('165'));
  }

  await browser.close();
}

testInventory().catch(e => console.error(e));
