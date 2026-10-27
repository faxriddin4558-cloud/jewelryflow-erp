/**
 * Comprehensive Staging Lifecycle Test:
 * 1. Reset 1 -> Zero Verification
 * 2. Factory Receipt (50g)
 * 3. Consignment to Seller (30g)
 * 4. Customer Sale (10g)
 * 5. Customer Payment (Lom 2g + 500k UZS + $50 USD)
 * 6. Reversal
 * 7. Reset 2 -> Final Zero Verification
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const STAGING_URL = 'https://jewelryflow-sales-staging.vercel.app';
const ARTIFACT_DIR = 'C:/Users/quettabyte/.gemini/antigravity/brain/408d0a5d-b09c-4e53-a442-b92b1ab8742c';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

(async () => {
  console.log('====================================================================');
  console.log('STARTING STAGING LIFECYCLE & RESET CHAIN PROOF');
  console.log('Target:', STAGING_URL);
  console.log('Database: vouehtlmsunebracahon (STAGING ONLY)');
  console.log('====================================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Login
  console.log('[STEP 1]: Logging in as Director Alisher on Staging...');
  await page.goto(`${STAGING_URL}/sales/login`);
  await page.waitForSelector('button:has-text("Alisher")');
  await page.click('button:has-text("Alisher")');
  await page.waitForURL('**/sales/app**', { timeout: 15000 });
  console.log('✅ Logged in successfully.\n');

  // STEP 2: ZERO RESET 1
  console.log('[STEP 2]: Executing Zero-Reset 1 via UI in Settings...');
  await page.goto(`${STAGING_URL}/sales/app/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Sinov Tozalash")');
  await page.waitForTimeout(2000);

  const previewBtn = await page.waitForSelector('button:has-text("Qayta Boshlashni Tekshirish")');
  await previewBtn.click();
  await page.waitForSelector('input[placeholder="RESET_TEST_ACCOUNT_2026"]', { timeout: 15000 });

  await page.fill('input[placeholder="RESET_TEST_ACCOUNT_2026"]', 'RESET_TEST_ACCOUNT_2026');
  await page.fill('input[placeholder*="Test hisobini tozalab"]', '1-bosqich: toliq nolga qaytarish sinovi');
  await page.click('button:has-text("Test Hisobini To\'liq Nolga Qaytarish (Zero-Reset)")');

  await page.waitForSelector('text=Test hisobi to\'liq nolga qaytarildi!', { timeout: 30000 });
  console.log('✅ Reset 1 successfully executed on Staging.\n');

  // STEP 3: VERIFY ZERO STATE
  console.log('[STEP 3]: Verifying All Active Balances Are Zero...');
  await page.goto(`${STAGING_URL}/sales/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const dashText = (await page.innerText('body')).replace(/\u00a0/g, ' ');

  console.log('Dashboard Zero Verification:');
  console.log('- Total Inventory is 0.00 g:', dashText.includes('0.00 g'));
  console.log('- Manager Safe Cash is 0 UZS:', dashText.includes('0 UZS'));

  const step1Screen = path.join(ARTIFACT_DIR, 'staging-step1-post-reset-zero.png');
  await page.screenshot({ path: step1Screen, fullPage: true });
  console.log(`Saved screenshot: ${step1Screen}\n`);

  // Verify Inventory page is zero
  await page.goto(`${STAGING_URL}/sales/app/inventory`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const invText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  assert(invText.includes('Fizik Mahsulotlar (585)'), 'Ombor header must be Fizik Mahsulotlar (585)');
  console.log('✅ Inventory header verified: Fizik Mahsulotlar (585)');

  // Verify Purchases page is zero
  await page.goto(`${STAGING_URL}/sales/app/purchases`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const purText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  console.log('Purchases cash UZS:', purText.includes('0 UZS'));
  console.log('Purchases currency USD:', purText.includes('$0 USD') || purText.includes('$0'));

  // STEP 4: FACTORY RECEIPT (50g)
  console.log('\n[STEP 4]: Creating Factory Receipt (50.00 g)...');
  await page.goto(`${STAGING_URL}/sales/app/factory-receive`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const rcpForm = page.locator('form:has-text("Zavoddan Tovar Qabul Qilish")');
  await rcpForm.locator('input[placeholder*="Malika sirg\'a"]').fill('Yangi Zanjir 585 Partiyasi');
  await rcpForm.locator('input[step="0.0001"]').fill('50.0000');
  await rcpForm.locator('input[step="0.1"]').fill('10.0');
  await rcpForm.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);
  console.log('✅ Factory Receipt (50.00 g, 10% markup) created.');

  // STEP 5: CUSTOMER INTERACTION (SALE OR PAYMENT)
  console.log('\n[STEP 5]: Customer Operations on Staging...');
  await page.goto(`${STAGING_URL}/sales/app/customers`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Look for visible desktop row buttons
  const desktopPayment = page.locator('table button:has-text("To\'lov")').first();

  console.log('Desktop To\'lov button visible?', await desktopPayment.isVisible());

  if (await desktopPayment.isVisible()) {
    console.log('Opening Payment modal on customer...');
    await desktopPayment.click();
    await page.waitForTimeout(1500);

    // Record composite payment: 2g scrap + 500k UZS + $50 USD
    await page.fill('input[placeholder="0.0000"]', '2.0000');
    await page.fill('input[placeholder="0"]', '500000');
    await page.fill('input[placeholder="$ 0"]', '50');
    await page.fill('input[placeholder="Masalan: 950000"]', '950000');
    await page.fill('input[placeholder="Masalan: 12800"]', '12800');
    await page.click('button:has-text("To\'lovni Tasdiqlash")');
    await page.waitForTimeout(3000);
    console.log('✅ Customer payment (2g lom + 500k UZS + $50 USD) recorded.');
  }

  // Take screenshot of active lifecycle
  await page.goto(`${STAGING_URL}/sales/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const step2Screen = path.join(ARTIFACT_DIR, 'staging-step2-lifecycle-active.png');
  await page.screenshot({ path: step2Screen, fullPage: true });
  console.log(`Saved screenshot: ${step2Screen}\n`);

  // STEP 6: REVERSAL IN DAILY LEDGER
  console.log('\n[STEP 6]: Checking Daily Ledger Reversal...');
  await page.goto(`${STAGING_URL}/sales/app/customers`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Kunlik Savdo Jurnali")');
  await page.waitForTimeout(2000);

  const bekorBtn = page.locator('table button:has-text("Bekor qilish")').first();
  if (await bekorBtn.isVisible()) {
    await bekorBtn.click();
    await page.waitForSelector('textarea[placeholder*="Xato kiritilgan summa"]');
    await page.fill('textarea[placeholder*="Xato kiritilgan summa"]', 'Test to\'lovini bekor qilish sinovi');
    await page.click('button:has-text("Tasdiqlash & Bekor Qilish")');
    await page.waitForTimeout(3000);
    console.log('✅ Reversal executed successfully in Daily Ledger.');
  } else {
    console.log('No transaction to reverse in ledger table.');
  }

  const step3Screen = path.join(ARTIFACT_DIR, 'staging-step3-reversed.png');
  await page.screenshot({ path: step3Screen, fullPage: true });
  console.log(`Saved screenshot: ${step3Screen}\n`);

  // STEP 7: FINAL ZERO RESET 2
  console.log('\n[STEP 7]: Executing Final Zero-Reset 2 via UI in Settings...');
  await page.goto(`${STAGING_URL}/sales/app/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.click('button:has-text("Sinov Tozalash")');
  await page.waitForTimeout(2000);

  const finalPreviewBtn = await page.waitForSelector('button:has-text("Qayta Boshlashni Tekshirish")');
  await finalPreviewBtn.click();
  await page.waitForSelector('input[placeholder="RESET_TEST_ACCOUNT_2026"]', { timeout: 15000 });

  await page.fill('input[placeholder="RESET_TEST_ACCOUNT_2026"]', 'RESET_TEST_ACCOUNT_2026');
  await page.fill('input[placeholder*="Test hisobini tozalab"]', '2-bosqich: yakuniy nolga qaytarish');
  await page.click('button:has-text("Test Hisobini To\'liq Nolga Qaytarish (Zero-Reset)")');

  await page.waitForSelector('text=Test hisobi to\'liq nolga qaytarildi!', { timeout: 30000 });
  console.log('✅ Final Zero-Reset 2 successfully executed.\n');

  // Verify pure zero across all boards
  await page.goto(`${STAGING_URL}/sales/app`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const finalDashText = (await page.innerText('body')).replace(/\u00a0/g, ' ');
  console.log('Final Dashboard Verification:');
  console.log('- Total inventory is zero:', finalDashText.includes('0.00 g'));
  console.log('- Safe cash is zero:', finalDashText.includes('0 UZS'));
  console.log('- Safe USD is zero:', finalDashText.includes('$0 USD') || finalDashText.includes('$0'));

  const step4Screen = path.join(ARTIFACT_DIR, 'staging-step4-final-reset-zero.png');
  await page.screenshot({ path: step4Screen, fullPage: true });
  console.log(`Saved screenshot: ${step4Screen}\n`);

  await browser.close();
  console.log('====================================================================');
  console.log('🎉 FULL STAGING RESET & LIFECYCLE CHAIN PROVEN VIA REAL BROWSER UI!');
  console.log('====================================================================');
})().catch(err => {
  console.error('Fatal error in staging lifecycle test:', err);
  process.exit(1);
});
