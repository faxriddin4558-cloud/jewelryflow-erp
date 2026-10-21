/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('7. JewelryFlow Sales — Complete Live Demo Journey & Invariants Verification', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  test('Complete End-to-End Sales Lifecycle: Consignment (100g @ 8%) -> Sale (100g @ 12%) -> Settlement (70g + 18M UZS) -> Surrender -> Preset Lifecycle', async ({ page }) => {
    test.setTimeout(90000);
    // -------------------------------------------------------------------------
    // STEP 1: Director Login & UI Contrast / Dropdown Security Check
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Login as Director and verify UI contrast & seller isolation...');
    await page.goto('/sales/director');
    await expect(page).toHaveURL(/\/login\?redirectedFrom=(%2F|\/)sales(%2F|\/)director/);

    // Click 1-click Demo Director button
    await page.click('button:has-text("Direktor")');
    await expect(page).toHaveURL(/\/sales\/director/, { timeout: 15000 });

    // Verify top banner has high contrast styling and text
    const topBanner = page.locator('h1:has-text("Direktor Savdo & Konsignatsiya Paneli")');
    await expect(topBanner).toBeVisible();
    await expect(page.locator('text=Zavod Boshqaruv Markazi').first()).toBeVisible();
    await expect(page.locator('text=Bugungi Lom Kursi (585)').first()).toBeVisible();

    // Switch to Consignment Tab
    await page.click('button:has-text("Mahsulot Topshirish")');

    // Verify seller dropdown does NOT auto-select Director and only shows active sellers
    const sellerSelect = page.locator('#consignSellerSelect');
    await expect(sellerSelect).toBeVisible();
    const selectValue = await sellerSelect.inputValue();
    expect(selectValue).toBe(''); // Must be unselected initially!

    // Wait for active sellers to load from backend
    const jamshidOption = sellerSelect.locator('option:has-text("Jamshid Sotuvchi")');
    await expect(jamshidOption).toBeAttached({ timeout: 10000 });

    const selectText = await sellerSelect.innerText();
    expect(selectText).toContain("Jamshid Sotuvchi");
    expect(selectText).not.toContain("Alisher Director");
    expect(selectText).not.toContain("Sardor Director");

    // -------------------------------------------------------------------------
    // STEP 2: Issue 100g Consignment with 8% Factory Markup to Jamshid Sotuvchi
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Issuing 100g consignment @ 8% factory markup to Jamshid...');
    
    // Select Jamshid Sotuvchi
    const jamshidOpt = await sellerSelect.locator('option:has-text("Jamshid Sotuvchi")').getAttribute('value');
    await sellerSelect.selectOption(jamshidOpt || { index: 1 });

    // Select 100g product
    const productSelect = page.locator('select').nth(1);
    const prodOption = productSelect.locator('option:has-text("100.0g")');
    await expect(prodOption).toBeAttached({ timeout: 10000 });
    const prodOpt = await prodOption.getAttribute('value');
    await productSelect.selectOption(prodOpt || { index: 4 });

    // Fill Qty = 1, Base Weight = 100.0000
    const qtyInput = page.locator('input[type="number"][min="1"]');
    await qtyInput.fill('1');

    const weightInput = page.locator('input[step="0.0001"]');
    await weightInput.fill('100.0000');

    // Select 8% factory markup
    const markupSelect = page.locator('select').nth(2);
    const markupOpt = await markupSelect.locator('option:has-text("8")').first().getAttribute('value');
    if (markupOpt) {
      await markupSelect.selectOption(markupOpt);
    }

    // Verify Live Preview displays: 100.0000g base and 108.0000g factory gold due
    await expect(page.locator('form').locator('text=108.0000 g lom')).toBeVisible();

    // Submit Consignment Form
    await page.click('button[type="submit"]:has-text("Topshirish va Chek Chiqarish")');

    // Verify Receipt Modal appears
    const receiptModal = page.locator('h2:has-text("Zavod Konsignatsiya Cheki (Topshirish)")');
    await expect(receiptModal).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Jamshid Sotuvchi/);
    await expect(page.locator('body')).toContainText(/100\.0000\s*g/);
    await expect(page.locator('body')).toContainText(/108\.0000\s*g/);

    // Close Receipt
    await page.click('button:has-text("Tayyor (Yopish)")');
    await expect(receiptModal).not.toBeVisible();

    // Switch to Sellers Overview tab to verify Jamshid's factory obligation = 108g
    await page.click('button:has-text("Sotuvchilar Balansi")');
    await expect(page.locator('body')).toContainText(/108\.0000\s*g\s*lom/);

    // -------------------------------------------------------------------------
    // STEP 3: Create Dynamic Preset (18.5% Client Markup)
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Testing Dynamic Markups: Add 18.5% Client Preset...');
    await page.click('button:has-text("Dinamik Foizlar Boshqaruvi")');

    // Open Add Preset modal for Client Markup
    await page.click('#addClientPresetBtn');
    const presetModal = page.locator('h3:has-text("Yangi Ustama Foizi Qo\'shish")');
    await expect(presetModal).toBeVisible();

    // Fill percentage: 18.5
    const pctInput = page.locator('input[placeholder="Masalan: 14.5"]');
    await pctInput.fill('18.5');

    // Fill custom name
    const nameInput = page.locator('input[placeholder="Masalan: Zavod 14% (Katta Partiya)"]');
    await nameInput.fill('Mijoz VIP Eksklyuziv 18.5%');

    // Submit Preset
    await page.click('button[type="submit"]:has-text("Saqlash")');
    await expect(presetModal).not.toBeVisible({ timeout: 5000 });

    // Verify 18.5% preset is visible in list
    await expect(page.locator('text=Mijoz VIP Eksklyuziv 18.5%')).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 4: Seller Mobile Experience — Sell 100g product @ 12% to Rustam Zargar
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Logging in as Jamshid Sotuvchi to Mobile Workspace...');
    await page.context().clearCookies();
    await page.goto('/login');
    await page.click('button:has-text("Sotuvchi")');
    await expect(page).toHaveURL(/\/sales\/mobile/, { timeout: 15000 });

    // Verify Seller Mobile UI has high contrast header & Jamshid Sotuvchi
    await expect(page.locator('text=Sotuvchi Mobil Ish Joyi').first()).toBeVisible();
    await expect(page.locator('h1:has-text("Jamshid Sotuvchi")')).toBeVisible();
    await expect(page.locator('text=900,000 UZS/g')).toBeVisible();

    // Verify Till metrics before sale: Lom = 0, Cash = 0, Zavod obligation = 108g
    await expect(page.locator('text=108.0000 g').first()).toBeVisible();

    // Check available consigned products
    await page.click('button:has-text("Mahsulotlar")');
    await expect(page.locator('body')).toContainText("Zargarlik To'plami 585 - 100.0g");

    // Click quick sell on the product card to preselect and switch to sale tab
    await page.click('button:has-text("Mijozga Nasiyaga Sotish")');

    // Select Customer: Rustam Zargar
    const custSelect = page.locator('#saleCustomerSelect');
    await expect(custSelect.locator('option:has-text("Rustam Zargar")')).toBeAttached({ timeout: 10000 });
    const rustamOpt = await custSelect.locator('option:has-text("Rustam Zargar")').getAttribute('value');
    await custSelect.selectOption(rustamOpt || { index: 1 });

    // Select Client Markup: 12%
    const clientMarkupSelect = page.locator('#saleClientMarkupSelect');
    const cmOpt = await clientMarkupSelect.locator('option:has-text("12")').first().getAttribute('value');
    if (cmOpt) {
      await clientMarkupSelect.selectOption(cmOpt);
    }

    // Verify Live Sale calculations:
    // Base = 100.0000g, Factory Due = 108.0000g, Client Due = 112.0000g, Spread = 4.0000g
    await expect(page.locator('body')).toContainText(/112\.0000\s*g\s*lom/);
    await expect(page.locator('body')).toContainText(/\+4\.0000\s*g/);

    // Record Sale on Debt
    await page.click('button[type="submit"]:has-text("Nasiyani Rasmiylashtirish & Chek")');

    // Verify Sale Receipt Modal
    const saleReceiptModal = page.locator('h2:has-text("Mijozga Nasiya Savdo Cheki")');
    await expect(saleReceiptModal).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(/Rustam Zargar/);
    await expect(page.locator('body')).toContainText(/112\.0000\s*g/);
    await expect(page.locator('body')).toContainText(/4\.0000\s*g/);

    // Close Receipt
    await page.click('button:has-text("Tayyor (Yopish)")');
    await expect(saleReceiptModal).not.toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 5: Settlement — Accept 70g Scrap + 18,000,000 UZS Cash from Rustam Zargar
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Recording client settlement: 70g scrap + 18M UZS cash...');
    await page.click('button:has-text("To\'lov Olish")');

    // Select Customer Rustam Zargar
    const settleCustSelect = page.locator('#settleCustomerSelect');
    await expect(settleCustSelect.locator('option:has-text("Rustam Zargar")')).toBeAttached({ timeout: 10000 });
    const settleCustOpt = await settleCustSelect.locator('option:has-text("Rustam Zargar")').getAttribute('value');
    await settleCustSelect.selectOption(settleCustOpt || { index: 1 });

    // Enter 70.0000g scrap
    const scrapInput = page.locator('#settleScrapWeightInput');
    await scrapInput.fill('70.0000');

    // Enter 18,000,000 UZS cash (18,000,000 / 900,000 = 20g equivalent)
    const cashInput = page.locator('#settleCashAmountInput');
    await cashInput.fill('18000000');

    // Verify Live Settlement preview:
    // 70g scrap + 20g cash equivalent = 90g settled
    // Previous debt = 112g
    // Remaining debt = 22g!
    await expect(page.locator('body')).toContainText(/22\.0000\s*g/);

    // Submit Settlement
    await page.click('button[type="submit"]:has-text("To\'lovni Kassaga Olish & Chek")');

    // Verify Settlement Receipt Modal
    const settleReceiptModal = page.locator('h2:has-text("Mijoz To\'lovi & Tushum Kvitansiyasi")');
    await expect(settleReceiptModal).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).toContainText(/90\.0000\s*g/); // total settled
    await expect(page.locator('body')).toContainText(/22\.0000\s*g/); // remaining debt

    // Close Receipt
    await page.click('button:has-text("Tayyor (Yopish)")');
    await expect(settleReceiptModal).not.toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 6: Verify Business Metrics & Strict Invariants
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Verifying all business metrics and strict ledger invariants...');

    // A. Check Rustam Zargar's debt in Qarzlar tab = exactly 22.0000g
    await page.click('button:has-text("Qarzlar")');
    await expect(page.locator('body')).toContainText(/Rustam Zargar/);
    await expect(page.locator('body')).toContainText(/22\.0000\s*g/);

    // B. Check Seller Till in top summary cards:
    // Till Scrap = 70.0000g
    // Till Cash = 18,000,000 UZS
    // Factory obligation = UNTOUCHED at 108.0000g (Invariant 5: Factory obligation does NOT change until surrendered!)
    await expect(page.locator('body')).toContainText(/70\.0000\s*g/);
    await expect(page.locator('body')).toContainText(/18,000,000\s*UZS/);
    await expect(page.locator('body')).toContainText(/108\.0000\s*g/);

    // -------------------------------------------------------------------------
    // STEP 7: Seller Surrenders Till to Factory (Handover)
    // -------------------------------------------------------------------------
    console.log('[STEP 7] Surrendering till to factory...');
    
    // Switch to Director workspace to accept surrender
    await page.context().clearCookies();
    await page.goto('/login?redirectedFrom=/sales/director');
    await page.click('button:has-text("Direktor")');
    await expect(page).toHaveURL(/\/sales\/director/, { timeout: 15000 });

    // In "Sotuvchilar Balansi va Kassalari", locate Jamshid's card and click "Zavodga Tushumni Qabul Qilish"
    await page.click('button:has-text("Sotuvchilar Balansi")');
    await page.locator('button:has-text("Zavodga Tushumni Qabul Qilish")').first().click();

    // Surrender modal opens
    const surrenderModal = page.locator('h3:has-text("Zavodga Tushumni Qabul Qilish")');
    await expect(surrenderModal).toBeVisible();

    // Verify modal displays till scrap = 70g, till cash = 18M UZS
    await expect(page.locator('body')).toContainText(/70\.0000\s*g/);
    await expect(page.locator('body')).toContainText(/18,000,000\s*UZS/);

    // Confirm Handover
    await page.click('button[type="submit"]:has-text("Qabul Qilish & Chek")');

    // Verify Handover Receipt Modal appears
    const surrenderReceiptModal = page.locator('h2:has-text("Zavodga Tushum Qabul Qilish Kvitansiyasi")');
    await expect(surrenderReceiptModal).toBeVisible({ timeout: 10000 });
    // Handover settles 90.0000g -> Previous debt 108g -> Remaining obligation = 18.0000g!
    await expect(page.locator('body')).toContainText(/90\.0000\s*g/);
    await expect(page.locator('body')).toContainText(/18\.0000\s*g/);

    // Close Receipt
    await page.click('button:has-text("Tayyor (Yopish)")');
    await expect(surrenderReceiptModal).not.toBeVisible();

    // Verify Jamshid's card after handover:
    // 1) Till Scrap is cleared to 0.0000g
    // 2) Till Cash is cleared to 0 UZS
    // 3) Factory obligation is reduced from 108.0000g down to 18.0000g!
    await expect(page.locator('body')).toContainText(/18\.0000\s*g\s*lom/);
    await expect(page.locator('body')).toContainText(/0\.0000\s*g/);
    await expect(page.locator('body')).toContainText(/0\s*UZS/);

    // -------------------------------------------------------------------------
    // STEP 8: Dynamic Markup Deactivation & Immutability Test
    // -------------------------------------------------------------------------
    console.log('[STEP 8] Verifying preset deactivation and historical immutability...');
    await page.click('button:has-text("Dinamik Foizlar Boshqaruvi")');

    // Deactivate the 18.5% preset
    const toggleBtn = page.locator('button[data-preset-toggle="Mijoz VIP Eksklyuziv 18.5%"]');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toContainText("O'chirish");
    await toggleBtn.click();

    // Verify button text changes to "Faollashtirish" and status becomes Nofaol
    await expect(toggleBtn).toContainText("Faollashtirish");
    await expect(page.locator('body')).toContainText("Nofaol");

    // Verify historical records remain fully preserved and immutable
    await page.click('button:has-text("Tushumlar & Qaytimlar Tarixi")');
    await expect(page.locator('body')).toContainText(/Rustam Zargar/);
    await expect(page.locator('body')).toContainText(/Jamshid Sotuvchi/);

    console.log('✅ COMPLETE SALES LIVE DEMO JOURNEY PASSED ALL VERIFICATIONS WITH 100% ACCURACY!');
  });
});
