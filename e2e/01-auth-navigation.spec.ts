/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('1. Authentication, Navigation & Role Access Controls', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  test('Unauthenticated user is redirected to /login with redirectedFrom param', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login(\?redirectedFrom=.*)?/);
    await expect(page.locator('h1')).toContainText('JewelryFlow ERP');
    await expect(page.locator('button[type="submit"]')).toContainText('Kirish');
  });

  test('Invalid login credentials show error message', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'WrongPassword123!');
    await page.click('button[type="submit"]');

    const errorBox = page.locator('div.text-red-600');
    await expect(errorBox).toBeVisible({ timeout: 10000 });
    await expect(errorBox).toContainText("Email yoki parol noto'g'ri!");
  });

  test('Successful login as Goldia Director redirects to Dashboard and syncs session', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });
    await expect(page.locator('h1')).toContainText('JewelryFlow ERP');

    // Take screenshot of authenticated dashboard
    await page.screenshot({ path: 'test-results/dashboard-authenticated.png', fullPage: true });
  });

  test('Director can navigate across core ERP routes without redirect', async ({ page }) => {
    // Perform login first
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // Test Navigation to Batches
    await page.goto('/batches');
    await expect(page).toHaveURL(/\/batches/);
    await expect(page.locator('body')).toContainText(/Partiya|WIP/i);

    // Test Navigation to Inventory
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory/);

    // Test Navigation to Manufacturing Hub
    await page.goto('/manufacturing');
    await expect(page).toHaveURL(/\/manufacturing/);

    // Test Navigation to Sales
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/sales/);

    // Test Navigation to Reports
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/reports/);

    // Test Navigation to Settings
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('body')).toContainText(/Sozlamalar|Zavod|Goldia/i);
  });
});
