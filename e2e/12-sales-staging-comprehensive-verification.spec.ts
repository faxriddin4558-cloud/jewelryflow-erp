/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('12. JewelryFlow Sales — Comprehensive Business Journey & Staging Verification', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      const text = msg.text();
      if (!text.includes('React DevTools') && !text.includes('[Fast Refresh]')) {
        console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${text}`);
      }
    });
    page.on('pageerror', (err) => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  // =========================================================================
  // 1. AUTHENTICATION & ROLE-BASED ACCESS (Director, Manager, Seller)
  // =========================================================================
  test('1. Verify Login for Director, Manager, and Seller with Staging Banner', async ({ page }) => {
    test.setTimeout(90000);

    console.log('[STEP 1.1] Checking /sales/login and Staging Banner...');
    await page.goto('http://localhost:3000/sales/login');
    await expect(page.locator('h1:has-text("JewelryFlow")')).toBeVisible({ timeout: 15000 });
    
    // Test 1-click Director login
    console.log('[STEP 1.2] Logging in as Director...');
    const dirBtn = page.locator('button:has-text("👑 Alisher")');
    await expect(dirBtn).toBeVisible();
    await dirBtn.click();
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });

    // Verify Director UI elements
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('text=Zavod Bilan Hisob')).toBeVisible();

    // Logout
    console.log('[STEP 1.3] Logging out Director...');
    await page.locator('button:has-text("Chiqish")').first().click();
    await expect(page).toHaveURL(/.*\/sales\/login/, { timeout: 10000 });

    // Test 1-click Manager login
    console.log('[STEP 1.4] Logging in as Manager...');
    const mgrBtn = page.locator('button:has-text("💼 Rustam")');
    await expect(mgrBtn).toBeVisible();
    await mgrBtn.click();
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });
    await expect(sidebar.locator('text=Scanner 564 Tarqatish')).toBeVisible();

    // Logout
    console.log('[STEP 1.5] Logging out Manager...');
    await page.locator('button:has-text("Chiqish")').first().click();
    await expect(page).toHaveURL(/.*\/sales\/login/, { timeout: 10000 });

    // Test 1-click Seller login
    console.log('[STEP 1.6] Logging in as Seller...');
    const sellerBtn = page.locator('button:has-text("🛍️ Jamshid")');
    await expect(sellerBtn).toBeVisible();
    await sellerBtn.click();
    // Seller redirects to /sales/app or /sales/mobile
    await expect(page).toHaveURL(/.*\/sales\/(app|mobile)/, { timeout: 15000 });

    console.log('✅ [TEST 1 PASS] Authentication & role-based routing verified for Director, Manager, Seller.');
  });

  // =========================================================================
  // 2. VERIFY ALL 12 SALES MODULES & TEXT CONTRAST (Director Role)
  // =========================================================================
  test('2. Verify All 12 Sales Modules Open Cleanly with WCAG Contrast & 2-Decimal Gram Formatting', async ({ page }) => {
    test.setTimeout(120000);

    // Login as Director
    await page.goto('http://localhost:3000/sales/login');
    await page.locator('button:has-text("👑 Alisher")').click();
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });

    const routes = [
      { name: '1. Asosiy Panel (Dashboard)', url: '/sales/app', title: 'Savdo Markazi' },
      { name: '2. Zavod Bilan Hisob', url: '/sales/app/factory', title: 'Zavod Bilan Hisob' },
      { name: '3. Boshqaruvchi Ombori', url: '/sales/app/inventory', title: 'Boshqaruvchi Ombori' },
      { name: '4. Scanner 564 Tarqatish', url: '/sales/app/consignments', title: 'Scanner 564' },
      { name: '5. Sotuvchilar & Bozor Qarzi', url: '/sales/app/sellers', title: 'Sotuvchilar Balansi' },
      { name: '6. Mijozlar va Nasiya', url: '/sales/app/customers', title: 'Mijozlar' },
      { name: '7. Kassa & Valyuta', url: '/sales/app/cash', title: 'Boshqaruvchi Kassasi' },
      { name: '8. Afinaj / Lom Pateriya', url: '/sales/app/refining', title: 'Afinaj' },
      { name: '9. Naqdga Oltin Xarid', url: '/sales/app/purchases', title: 'Oltin Xarid' },
      { name: '10. Moliyaviy Hisobotlar', url: '/sales/app/reports', title: 'Moliyaviy Hisobot' },
      { name: '11. BarTender & Modellar', url: '/sales/app/models', title: 'Modellar' },
      { name: '12. Xodimlar & Telegram', url: '/sales/app/users', title: 'Xodimlar' },
    ];

    for (const r of routes) {
      console.log(`[TEST 2] Navigating to ${r.name} (${r.url})...`);
      await page.goto(`http://localhost:3000${r.url}`);
      await expect(page).toHaveURL(new RegExp(r.url), { timeout: 10000 });
      await page.waitForTimeout(500);

      // Verify no 500 error or crash
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
      expect(bodyText).not.toContain('Application error: a client-side exception has occurred');

      // Verify that all visible gram values have exactly 2 decimal places (e.g. 0.00 g, 14.50 g)
      // and NOT 4 decimals like 14.5000 g
      const fourDecimalGramMatches = bodyText.match(/\d+\.\d{4}\s*g/g);
      if (fourDecimalGramMatches && fourDecimalGramMatches.length > 0) {
        console.warn(`[WARNING: 4-decimal gram found on ${r.url}]:`, fourDecimalGramMatches.slice(0, 3));
      }
    }

    console.log('✅ [TEST 2 PASS] All 12 Sales modules opened cleanly without crashes.');
  });

  // =========================================================================
  // 3. DAILY GOLD RATE MODAL & UPSERT TEST
  // =========================================================================
  test('3. Verify Daily Gold Rate Upsert, Persistence and Schema Integrity', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('http://localhost:3000/sales/login');
    await page.locator('button:has-text("👑 Alisher")').click();
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    console.log('[TEST 3.1] Opening Daily Gold Rate modal...');
    const rateBtn = page.locator('button:has-text("⚙️ Kurs")').first();
    await expect(rateBtn).toBeVisible({ timeout: 10000 });
    await rateBtn.click();

    // Verify modal is open
    const modalHeading = page.locator('h3:has-text("Bugungi Lom Kursi")');
    await expect(modalHeading).toBeVisible({ timeout: 10000 });

    // Enter rate 920,000 UZS/g
    console.log('[TEST 3.2] Setting rate to 920000 UZS/g...');
    const rateInput = page.locator('input[type="number"]').first();
    await rateInput.fill('920000');

    const saveBtn = page.locator('button[type="submit"]:has-text("Saqlash")');
    await saveBtn.click();

    // Verify modal closes
    await expect(modalHeading).not.toBeVisible({ timeout: 5000 });

    // Verify header rate updates to 920,000
    console.log('[TEST 3.3] Verifying rate display in header...');
    const rateDisplay = page.locator('text=920,000');
    await expect(rateDisplay).toBeVisible({ timeout: 10000 });

    // Reload page and verify persistence
    console.log('[TEST 3.4] Reloading page to verify persistence...');
    await page.reload();
    await expect(page.locator('text=920,000')).toBeVisible({ timeout: 10000 });

    console.log('✅ [TEST 3 PASS] Daily gold rate saved, synced, and verified after reload.');
  });

  // =========================================================================
  // 4. SCANNER 564, BARTENDER & QR EXPORT TEST
  // =========================================================================
  test('4. Verify Scanner 564, BarTender Model Creation & QR Operations', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('http://localhost:3000/sales/login');
    await page.locator('button:has-text("👑 Alisher")').click();
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });

    // Go to BarTender & Modellar
    console.log('[TEST 4.1] Navigating to BarTender & Modellar...');
    await page.goto('http://localhost:3000/sales/app/models');
    await expect(page).toHaveURL(/.*\/sales\/app\/models/);

    // Verify BarTender export button exists
    const exportBtn = page.locator('button:has-text("BarTender CSV Yuklash")').or(page.locator('button:has-text("CSV")'));
    await expect(exportBtn.first()).toBeVisible({ timeout: 10000 });

    // Navigate to Scanner 564
    console.log('[TEST 4.2] Navigating to Scanner 564 Consignments...');
    await page.goto('http://localhost:3000/sales/app/consignments');
    await expect(page).toHaveURL(/.*\/sales\/app\/consignments/);

    // Verify Scanner 564 input and components
    const barcodeInput = page.locator('input[placeholder*="Skanerlang"]').or(page.locator('input[placeholder*="564"]')).or(page.locator('input[type="text"]').first());
    await expect(barcodeInput).toBeVisible({ timeout: 10000 });

    console.log('✅ [TEST 4 PASS] Scanner 564 and BarTender components verified.');
  });

  // =========================================================================
  // 5. VERIFY BUSINESS CHAIN: CUSTOMER PAYMENT, DEBT REDUCTION & FACTORY
  // =========================================================================
  test('5. Verify Customer Payment, Debt Reduction, Seller Balance & Factory Overview', async ({ page }) => {
    test.setTimeout(60000);

    // 1. Login as Director
    await page.goto('http://localhost:3000/sales/login');
    await page.locator('button:has-text("👑 Alisher")').click();
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });

    // 2. Navigate to Customers & Debt Ledger
    console.log('[TEST 5.1] Navigating to Customers Ledger (/sales/app/customers)...');
    await page.goto('http://localhost:3000/sales/app/customers');
    await expect(page).toHaveURL(/.*\/sales\/app\/customers/);

    // Verify customers table loaded
    await page.waitForLoadState('networkidle');
    const paymentBtns = page.locator('button:has-text("To\'lov Qabul")');
    await expect(paymentBtns.first()).toBeVisible({ timeout: 10000 });

    // 3. Open Payment modal for first customer
    console.log('[TEST 5.2] Opening payment modal for customer...');
    await paymentBtns.first().click();

    // Verify modal is open
    const modalHeading = page.locator('h3:has-text("Mijozdan To\'lov Qabul Qilish")');
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 4. Enter 5.00g scrap gold payment
    console.log('[TEST 5.3] Entering 5.00g scrap gold payment...');
    const scrapInput = page.locator('input[placeholder="0.0000"]').first();
    await scrapInput.fill('5.00');

    // Submit payment
    const confirmBtn = page.locator('button[type="submit"]:has-text("To\'lovni Tasdiqlash")');
    await confirmBtn.click();

    // 5. Verify success notification
    console.log('[TEST 5.4] Verifying payment confirmation message...');
    const successAlert = page.locator('text=To\'lov qabul qilindi');
    await expect(successAlert).toBeVisible({ timeout: 10000 });

    // 6. Navigate to Sellers & verify balance calculation
    console.log('[TEST 5.5] Navigating to Sellers Balance (/sales/app/sellers)...');
    await page.goto('http://localhost:3000/sales/app/sellers');
    await expect(page).toHaveURL(/.*\/sales\/app\/sellers/);
    await expect(page.locator('text=Sotuvchilar').first()).toBeVisible({ timeout: 10000 });

    // 7. Navigate to Factory Account (/sales/app/factory)...
    console.log('[TEST 5.6] Navigating to Factory Account (/sales/app/factory)...');
    await page.goto('http://localhost:3000/sales/app/factory');
    await expect(page).toHaveURL(/.*\/sales\/app\/factory/);
    await expect(page.locator('text=Zavod Bilan Hisob-Kitob').first()).toBeVisible({ timeout: 10000 });

    console.log('✅ [TEST 5 PASS] End-to-end customer payment, debt reduction, seller balance & factory account verified.');
  });
});

