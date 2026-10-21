/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('9. JewelryFlow Sales — Dedicated Application, Vertical Sidebar, Role-Based Login & Sheets Import', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  test('Dedicated Sales App Lifecycle: Login -> Sidebar Navigation -> Telegram OTP -> Sheets Preview', async ({ page }) => {
    test.setTimeout(90000);

    // -------------------------------------------------------------------------
    // STEP 1: Dedicated Sales Login Page (/sales/login)
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Navigating to /sales/login and checking role switcher...');
    await page.goto('/sales/login');
    await expect(page.locator('h1:has-text("JewelryFlow")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Boshqaruv, Konsignatsiya')).toBeVisible();


    // Verify 1-click pilot role buttons are visible
    const directorBtn = page.locator('button:has-text("Alisher")');
    const managerBtn = page.locator('button:has-text("Rustam")');
    const sellerBtn = page.locator('button:has-text("Jamshid")');

    await expect(directorBtn).toBeVisible();
    await expect(managerBtn).toBeVisible();
    await expect(sellerBtn).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 2: Login as Director and enter /sales/app
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Logging in as Director via 1-click pilot switch...');
    await directorBtn.click();

    // Wait for redirect to /sales/app
    await expect(page).toHaveURL(/\/sales\/app/, { timeout: 15000 });

    // -------------------------------------------------------------------------
    // STEP 3: Verify Permanent Vertical Left Sidebar
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Verifying permanent vertical left sidebar and header...');
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Brand and gold badge
    await expect(sidebar.locator('text=JewelryFlow').first()).toBeVisible();
    await expect(sidebar.locator('text=585').first()).toBeVisible();

    // User profile card
    await expect(sidebar.locator('text=Director').first()).toBeVisible();

    // Daily gold rate card
    await expect(sidebar.locator('text=Bugungi Lom (585)').first()).toBeVisible();

    // Navigation groups
    await expect(sidebar.locator('text=BOSHQARUV & BALANS')).toBeVisible();
    await expect(sidebar.locator('text=OMBOR & KONSIGNATSIYA')).toBeVisible();
    await expect(sidebar.locator('text=SAVDO & KASSALAR')).toBeVisible();
    await expect(sidebar.locator('text=AFINAJ & ZAVOD BALANSI')).toBeVisible();
    await expect(sidebar.locator('text=TAHLIL & TIZIM')).toBeVisible();

    // Master live reconciliation equation card on /sales/app
    await expect(page.locator('text=Global Rekonsilyatsiya Formulari')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=BALANS TO\'LIQ MOS')).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 4: Navigate to Subpages via Sidebar Links
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Navigating to subpages via vertical sidebar...');

    // 1. Zavod Bilan Hisob
    await sidebar.locator('a:has-text("Zavod Bilan Hisob")').click();
    await expect(page).toHaveURL(/\/sales\/app\/factory/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Zavod Bilan")')).toBeVisible();

    // 2. Scanner 564 Tarqatish
    await sidebar.locator('a:has-text("Scanner 564 Tarqatish")').click();
    await expect(page).toHaveURL(/\/sales\/app\/consignments/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Scanner 564")')).toBeVisible();

    // 3. Mijozlar va Nasiya
    await sidebar.locator('a:has-text("Mijozlar va Nasiya")').click();
    await expect(page).toHaveURL(/\/sales\/app\/customers/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Mijozlar")')).toBeVisible();

    // 4. Xodimlar & Telegram
    await sidebar.locator('a:has-text("Xodimlar & Telegram")').click();
    await expect(page).toHaveURL(/\/sales\/app\/users/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Xodimlar Boshqaruvi")')).toBeVisible();

    // Verify OTP generation action
    const otpBtn = page.locator('button:has-text("OTP Kodi")').first();
    await expect(otpBtn).toBeVisible();
    await otpBtn.click();
    await expect(page.locator('text=Telegram Ulanish Kodi (OTP)')).toBeVisible({ timeout: 5000 });
    // Close modal
    await page.locator('button:has-text("Yopish")').click();

    // 5. Sozlamalar & Import
    await sidebar.locator('a:has-text("Sozlamalar & Import")').click();
    await expect(page).toHaveURL(/\/sales\/app\/settings/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Sozlamalar")')).toBeVisible();

    // Switch to Sheets Import tab
    const sheetsTab = page.locator('button:has-text("Sheets Import")');
    await expect(sheetsTab).toBeVisible();
    await sheetsTab.click();

    // Verify Sheets Import Section
    await expect(page.locator('text=Google Sheets Import Dasturi')).toBeVisible({ timeout: 5000 });

    // Click load sample button
    await page.locator('button:has-text("Namuna ma\'lumotlarini yuklash")').click();
    await expect(page.locator('text=Zavod bilan" uchun namuna')).toBeVisible();

    // Click Preview
    await page.locator('button:has-text("Tekshirish & Ko\'rish (Preview)")').click();
    await expect(page.locator('text=Import Oldindan Ko\'rish Natijalari')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=To\'g\'ri: 3')).toBeVisible();
    await expect(page.locator('text=275.70 g')).toBeVisible();

    console.log('[SUCCESS] All dedicated Sales application flows verified!');
  });
});
