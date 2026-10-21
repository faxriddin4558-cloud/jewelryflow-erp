/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('6. Sales Demo Login & Role Routing (Director vs Seller)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  test('Unauthenticated access to /sales/director redirects to /login?redirectedFrom=/sales/director', async ({ page }) => {
    await page.goto('/sales/director');
    await expect(page).toHaveURL(/\/login\?redirectedFrom=(%2F|\/)sales(%2F|\/)director/);
    await expect(page.locator('h1')).toContainText('JewelryFlow ERP');
    // Verify Local Pilot badge and demo buttons are present in local staging
    await expect(page.locator('text=LOKAL PILOT REJIMI')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=director@goldia.uz')).toBeVisible();
    await expect(page.locator('text=seller@goldia.uz')).toBeVisible();
  });

  test('One-click Demo Director login succeeds and returns to /sales/director', async ({ page }) => {
    await page.goto('/sales/director');
    await expect(page).toHaveURL(/\/login\?redirectedFrom=(%2F|\/)sales(%2F|\/)director/);

    // Click 1-click Demo Director button
    await page.click('button:has-text("Direktor")');

    // Should redirect back to /sales/director
    await expect(page).toHaveURL(/\/sales\/director/, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Direktor Paneli|Savdo Boshqaruv/i);
  });

  test('One-click Demo Seller login succeeds and redirects to /sales/mobile', async ({ page }) => {
    await page.goto('/sales/mobile');
    await expect(page).toHaveURL(/\/login\?redirectedFrom=(%2F|\/)sales(%2F|\/)mobile/);

    // Click 1-click Demo Seller button
    await page.click('button:has-text("Sotuvchi")');

    // Should redirect to /sales/mobile
    await expect(page).toHaveURL(/\/sales\/mobile/, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Sotuvchi|Mobil/i);
  });

  test('Invalid password displays non-crashing friendly alert banner', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'seller@goldia.uz');
    await page.fill('input[type="password"]', 'CompletelyWrongPass123!');
    await page.click('button[type="submit"]');

    const alertBox = page.locator('div.text-red-600');
    await expect(alertBox).toBeVisible({ timeout: 10000 });
    await expect(alertBox).toContainText("Email yoki parol noto'g'ri!");
  });
});
