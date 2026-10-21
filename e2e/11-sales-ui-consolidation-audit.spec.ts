/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('11. JewelryFlow Sales — UI & Navigation Consolidation Verification', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  test('Verify UI Consolidation: No Duplicate Forms, Clean Scoped Views, Canonical Pages', async ({ page }) => {
    test.setTimeout(90000);

    // 1. Login as Director
    console.log('[STEP 1] Login as Director via 1-click pilot switcher...');
    await page.goto('http://localhost:3000/sales/login');
    const quickDirectorBtn = page.locator('button:has-text("👑 Alisher")');
    await expect(quickDirectorBtn).toBeVisible({ timeout: 15000 });
    await quickDirectorBtn.click();
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });

    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // 2. Test Factory Accounting Hub (/sales/app/factory)
    console.log('[STEP 2] Testing /sales/app/factory Hub & segmented control...');
    await sidebar.locator('a:has-text("Zavod Bilan Hisob")').click();
    await expect(page).toHaveURL(/.*\/sales\/app\/factory/, { timeout: 10000 });

    // Segmented buttons should be present
    const btnAll = page.locator('button:has-text("Barchasi (Kirim & Chiqim)")');
    const btnReceive = page.locator('button:has-text("Faqat Zavoddan Qabul")');
    const btnHandover = page.locator('button:has-text("Faqat Zavodga Topshirish")');

    await expect(btnAll).toBeVisible();
    await expect(btnReceive).toBeVisible();
    await expect(btnHandover).toBeVisible();

    // In 'All' view, both forms should exist
    await expect(page.locator('h3:has-text("Zavoddan Tovar Qabul Qilish")')).toBeVisible();
    await expect(page.locator('h3:has-text("Zavodga Oltin Topshirish")')).toBeVisible();

    // Click 'Faqat Zavoddan Qabul' -> Handover form must disappear
    await btnReceive.click();
    await expect(page.locator('h3:has-text("Zavoddan Tovar Qabul Qilish")')).toBeVisible();
    await expect(page.locator('h3:has-text("Zavodga Oltin Topshirish")')).not.toBeVisible();

    // Click 'Faqat Zavodga Topshirish' -> Receipt form must disappear
    await btnHandover.click();
    await expect(page.locator('h3:has-text("Zavodga Oltin Topshirish")')).toBeVisible();
    await expect(page.locator('h3:has-text("Zavoddan Tovar Qabul Qilish")')).not.toBeVisible();

    // 3. Test Scoped Factory Subroutes (/sales/app/factory-receive and /sales/app/handovers)
    console.log('[STEP 3] Testing scoped factory subroutes for backward compatibility...');
    await page.goto('http://localhost:3000/sales/app/factory-receive');
    await expect(page.locator('h3:has-text("Zavoddan Tovar Qabul Qilish")')).toBeVisible();
    await expect(page.locator('h3:has-text("Zavodga Oltin Topshirish")')).not.toBeVisible();

    await page.goto('http://localhost:3000/sales/app/handovers');
    await expect(page.locator('h3:has-text("Zavodga Oltin Topshirish")')).toBeVisible();
    await expect(page.locator('h3:has-text("Zavoddan Tovar Qabul Qilish")')).not.toBeVisible();

    // 4. Test Kassa & Seyf Balansi (/sales/app/cash) - Must NOT show forms, only overview & navigation
    console.log('[STEP 4] Testing /sales/app/cash Treasury overview (no overlapping forms)...');
    await sidebar.locator('a:has-text("Kassa & Valyuta")').click();
    await expect(page).toHaveURL(/.*\/sales\/app\/cash/, { timeout: 10000 });
    await expect(page.locator('h2:has-text("Boshqaruvchi Kassasi & Seyf Balansi")')).toBeVisible();

    // Verify quick action links are present
    await expect(page.locator('text=Afinaj & Lom Pateriya Bo\'limiga O\'tish')).toBeVisible();
    await expect(page.locator('text=Naqdga Oltin Xarid Bo\'limiga O\'tish')).toBeVisible();

    // Verify forms are NOT rendered on cash overview
    await expect(page.locator('h3:has-text("Afinaj (Eritish & Qayta Ishlash)")')).not.toBeVisible();
    await expect(page.locator('h3:has-text("Tovar Olish (Naqdga Oltin Xarid Qilish)")')).not.toBeVisible();

    // 5. Test Afinaj (/sales/app/refining) - ONLY Afinaj form, NO purchase form
    console.log('[STEP 5] Testing /sales/app/refining scoped view...');
    await sidebar.locator('a:has-text("Afinaj / Lom Pateriya")').click();
    await expect(page).toHaveURL(/.*\/sales\/app\/refining/, { timeout: 10000 });
    await expect(page.locator('h3:has-text("Afinaj (Eritish & Qayta Ishlash)")')).toBeVisible();
    await expect(page.locator('h3:has-text("Tovar Olish (Naqdga Oltin Xarid Qilish)")')).not.toBeVisible();
    await expect(page.locator('h3:has-text("Afinaj Partiyalari Ro\'yxati")')).toBeVisible();
    await expect(page.locator('h3:has-text("Oltin Xaridlari Tarixi")')).not.toBeVisible();

    // 6. Test Purchases (/sales/app/purchases) - ONLY Purchase form, NO afinaj form
    console.log('[STEP 6] Testing /sales/app/purchases scoped view...');
    await sidebar.locator('a:has-text("Naqdga Oltin Xarid")').click();
    await expect(page).toHaveURL(/.*\/sales\/app\/purchases/, { timeout: 10000 });
    await expect(page.locator('h3:has-text("Tovar Olish (Naqdga Oltin Xarid Qilish)")')).toBeVisible();
    await expect(page.locator('h3:has-text("Afinaj (Eritish & Qayta Ishlash)")')).not.toBeVisible();
    await expect(page.locator('h3:has-text("Oltin Xaridlari Tarixi")')).toBeVisible();
    await expect(page.locator('h3:has-text("Afinaj Partiyalari Ro\'yxati")')).not.toBeVisible();

    // 7. Test Settings (/sales/app/settings) - Clean 2-tab bar, NO 13 tabs bar
    console.log('[STEP 7] Testing /sales/app/settings clean scoped tabs...');
    await sidebar.locator('a:has-text("Sozlamalar & Import")').click();
    await expect(page).toHaveURL(/.*\/sales\/app\/settings/, { timeout: 10000 });

    // Ensure 13 raw tabs are NOT rendered (e.g., "Sotuvchilar Balansi & Bozor Qarzi" as tab button)
    await expect(page.locator('button:has-text("Sotuvchilar Balansi & Bozor Qarzi")')).not.toBeVisible();
    await expect(page.locator('button:has-text("BarTender Modellar")')).not.toBeVisible();

    // Ensure our clean 2-tab control works
    const btnPresets = page.locator('button:has-text("Dinamik Ustama Foizlar")');
    const btnSheets = page.locator('button:has-text("Sheets Import")');
    await expect(btnPresets).toBeVisible();
    await expect(btnSheets).toBeVisible();

    // Switch to Sheets Import
    await btnSheets.click();
    await expect(page.locator('text=Google Sheets Import Dasturi')).toBeVisible({ timeout: 5000 });

    // Switch back to Presets
    await btnPresets.click();
    await expect(page.locator('text=Dinamik Foizlar Qoidasi')).toBeVisible({ timeout: 5000 });

    // 8. Test Physical Inventory vs Seller Financial Liabilities
    console.log('[STEP 8] Verifying clear distinction between Inventory and Sellers...');
    await sidebar.locator('a:has-text("Boshqaruvchi Ombori")').click();
    await expect(page).toHaveURL(/.*\/sales\/app\/inventory/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Boshqaruvchi Ombori: Fizik Donalar (JF-PIECE)")')).toBeVisible();

    await sidebar.locator('a:has-text("Sotuvchilar & Bozor Qarzi")').click();
    await expect(page).toHaveURL(/.*\/sales\/app\/sellers/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Sotuvchilar Balansi & Bozor Qarzi")')).toBeVisible();

    console.log('🎉 ALL UI CONSOLIDATION & ANTI-DUPLICATION AUDIT TESTS PASSED 100%!');
  });
});
