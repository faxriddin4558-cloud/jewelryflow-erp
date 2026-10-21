/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('10. JewelryFlow Sales — Real Authentication, Session Verification, Role-Based Panels & Hydration Check', () => {
  const browserErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    browserErrors.length = 0;
    page.on('console', (msg) => {
      const text = msg.text();
      console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${text}`);
      if (text.includes('Hydration failed') || text.includes('React hydration') || text.includes('Text content does not match')) {
        browserErrors.push(text);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`[BROWSER-ERROR] ${err.message}`);
      browserErrors.push(err.message);
    });
  });

  test('Complete Login & Role Verification: Director, Manager, Seller, Error Handling & Hydration Integrity', async ({ page }) => {
    test.setTimeout(120000);

    // -------------------------------------------------------------------------
    // TEST 1: Hydration Integrity & Login Page UI
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Visiting /sales/login and ensuring 0 hydration issues...');
    await page.goto('http://localhost:3000/sales/login');
    await expect(page.locator('h1:has-text("JewelryFlow")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Boshqaruv, Konsignatsiya')).toBeVisible();

    // Verify no Next.js hydration error overlay
    const nextErrorBadge = page.locator('button[data-nextjs-toast="true"]');
    await expect(nextErrorBadge).not.toBeVisible();
    expect(browserErrors.filter((e) => e.includes('Hydration failed'))).toHaveLength(0);

    // -------------------------------------------------------------------------
    // TEST 2: Real Form Login Failure on Invalid Password
    // -------------------------------------------------------------------------
    console.log('[TEST 2] Testing real form login with wrong password...');
    await page.fill('input[type="email"]', 'seller@goldia.uz');
    await page.fill('input[type="password"]', 'WrongPasswordXYZ!');
    await page.click('button:has-text("Tizimga Kirish")');

    // Wait for explicit error notification
    await expect(page.locator('text=Email yoki parol noto\'g\'ri')).toBeVisible({ timeout: 8000 });

    // Ensure it remained on login page and did not redirect
    expect(page.url()).toContain('/sales/login');

    // Ensure submit button is re-enabled and not stuck on "Kirilmoqda..."
    const submitBtn = page.locator('button:has-text("Tizimga Kirish")');
    await expect(submitBtn).toBeEnabled();
    await expect(submitBtn).not.toHaveText('Kirilmoqda...');

    // -------------------------------------------------------------------------
    // TEST 3: Real Form Login as Director (director@goldia.uz)
    // -------------------------------------------------------------------------
    console.log('[TEST 3] Real Form Login as Director (director@goldia.uz)...');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button:has-text("Tizimga Kirish")');

    // Should redirect to /sales/app
    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });

    // Verify Director role badge in the left sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('text=Director').first()).toBeVisible({ timeout: 10000 });

    // Verify Director-only navigation items exist
    await expect(sidebar.locator('a:has-text("Zavod Bilan Hisob")')).toBeVisible();
    await expect(sidebar.locator('a:has-text("Scanner 564 Tarqatish")')).toBeVisible();
    await expect(sidebar.locator('a:has-text("Afinaj / Lom Pateriya")')).toBeVisible();

    // Verify page reload preserves authenticated session and role
    console.log('[TEST 3.1] Testing page reload persistence for Director...');
    await page.reload();
    await expect(page).toHaveURL(/.*\/sales\/app/);
    await expect(sidebar.locator('text=Director').first()).toBeVisible({ timeout: 10000 });

    // Logout
    console.log('[TEST 3.2] Logging out Director...');
    const logoutBtn = sidebar.locator('button[title="Chiqish"]');
    await logoutBtn.click();
    await page.waitForURL('**/sales/login**', { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // TEST 4: Real Form Login as Manager (manager@goldia.uz)
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Real Form Login as Manager (manager@goldia.uz)...');
    await page.fill('input[type="email"]', 'manager@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button:has-text("Tizimga Kirish")');

    // Should redirect to /sales/app
    await page.waitForURL('**/sales/app**', { timeout: 15000 });
    await expect(sidebar).toBeVisible();

    // Verify Manager / Production Manager badge
    await expect(sidebar.locator('text=Production Manager').or(sidebar.locator('text=Manager')).first()).toBeVisible({ timeout: 10000 });
    await expect(sidebar.locator('a:has-text("Boshqaruvchi Ombori")')).toBeVisible();
    await expect(sidebar.locator('a:has-text("Scanner 564 Tarqatish")')).toBeVisible();

    // Logout
    console.log('[TEST 4.1] Logging out Manager...');
    await sidebar.locator('button[title="Chiqish"]').click();
    await page.waitForURL('**/sales/login**', { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // TEST 5: Real Form Login as Seller (seller@goldia.uz)
    // -------------------------------------------------------------------------
    console.log('[TEST 5] Real Form Login as Seller (seller@goldia.uz)...');
    await page.fill('input[type="email"]', 'seller@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button:has-text("Tizimga Kirish")');

    // Should redirect to /sales/app
    await page.waitForURL('**/sales/app**', { timeout: 15000 });
    await expect(sidebar).toBeVisible();

    // Verify Seller badge
    await expect(sidebar.locator('text=Seller').first()).toBeVisible({ timeout: 10000 });

    // Verify restricted manager/director links are NOT visible for seller
    await expect(sidebar.locator('a:has-text("Zavod Bilan Hisob")')).not.toBeVisible();
    await expect(sidebar.locator('a:has-text("Scanner 564 Tarqatish")')).not.toBeVisible();
    await expect(sidebar.locator('a:has-text("Afinaj / Lom Pateriya")')).not.toBeVisible();

    // Allowed seller links must be visible
    await expect(sidebar.locator('a:has-text("Asosiy Panel")')).toBeVisible();
    await expect(sidebar.locator('a:has-text("Mijozlar va Nasiya")')).toBeVisible();
    await expect(sidebar.locator('a:has-text("Kassa & Valyuta")')).toBeVisible();

    // Logout
    console.log('[TEST 5.1] Logging out Seller...');
    await sidebar.locator('button[title="Chiqish"]').click();
    await page.waitForURL('**/sales/login**', { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // TEST 6: 1-Click Pilot Switcher Login (Director Alisher)
    // -------------------------------------------------------------------------
    console.log('[TEST 6] Testing 1-click pilot switcher for Director...');
    const quickDirectorBtn = page.locator('button:has-text("👑 Alisher")');
    await expect(quickDirectorBtn).toBeVisible();
    await quickDirectorBtn.click();

    await expect(page).toHaveURL(/.*\/sales\/app/, { timeout: 15000 });
    await expect(sidebar.locator('text=Director').first()).toBeVisible({ timeout: 10000 });

    console.log('✅ ALL LOGIN, SESSION, MIDDLEWARE & ROLE TESTS PASSED PERFECTLY!');
  });
});
