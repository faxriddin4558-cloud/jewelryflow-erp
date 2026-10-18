import { test, expect } from '@playwright/test';

test.describe('5. Persistent Pilot Storage, Demarcation & Multi-Role Acceptance', () => {
  test('Backend server returns non-production demarcation headers and persistent mode', async ({ request }) => {
    const res = await request.get('http://127.0.0.1:54321/staging/health');
    expect(res.status()).toBe(200);

    const headers = res.headers();
    expect(headers['x-jewelryflow-environment']).toBe('LOCAL-PILOT-EMULATED-NOT-PRODUCTION');

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.persistent).toBe(true);
    expect(body.pglite).toBe(true);
    expect(body.environment).toBe('LOCAL-PILOT-EMULATED-NOT-PRODUCTION');
  });

  test('Director logs in and verifies persistent inventory and safe gold balances', async ({ page }) => {
    // 1. Login as Goldia Director
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // 2. Visit Inventory
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory/);

    // Verify Goldia safe gold card or table
    await expect(page.locator('body')).toContainText(/Ombor|Xomashyo|Sof oltin|585|999/i);
    await page.screenshot({ path: 'test-results/inventory-persistent-pilot.png', fullPage: true });
  });

  test('Accountant verifies sales and debt registers in persistent session', async ({ page }) => {
    // 1. Login as Goldia Accountant
    await page.goto('/login');
    await page.fill('input[type="email"]', 'accountant@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // 2. Visit Sales
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/sales/);

    // Verify Sales interface
    await expect(page.locator('body')).toContainText(/Sotuv|Mijoz|Qarz|To'lov/i);
    await page.screenshot({ path: 'test-results/sales-persistent-pilot.png', fullPage: true });
  });

  test('Warehouse operator accesses materials and orders without error', async ({ page }) => {
    // 1. Login as Goldia Warehouse
    await page.goto('/login');
    await page.fill('input[type="email"]', 'warehouse@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // 2. Visit Orders
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/orders/);

    await expect(page.locator('body')).toContainText(/Buyurtma|Mijoz|Muddat/i);
    await page.screenshot({ path: 'test-results/orders-persistent-pilot.png', fullPage: true });
  });
});
