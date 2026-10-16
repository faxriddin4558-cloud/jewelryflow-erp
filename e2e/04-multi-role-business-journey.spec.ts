/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('4. Multi-Role Access, Cross-Department Journeys & Session Persistence [SIMULATED SUPABASE BACKEND E2E]', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  test('Production Manager (manager@goldia.uz) logs in, inspects manufacturing pipeline, orders, and batch operations', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'manager@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });
    await expect(page.locator('h1')).toContainText('JewelryFlow ERP');

    // Production Manager navigates to Manufacturing Hub
    await page.goto('/manufacturing');
    await expect(page).toHaveURL(/\/manufacturing/);
    await expect(page.locator('body')).toContainText(/Sex|Bo'lim|Ishlab chiqarish/i);

    // Navigates to Orders
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/orders/);
    await expect(page.locator('body')).toContainText(/Buyurtma|Mijoz|Status/i);

    // Navigates to Batches
    await page.goto('/batches');
    await expect(page).toHaveURL(/\/batches/);
    await expect(page.locator('body')).toContainText(/Partiya|WIP/i);

    await page.screenshot({ path: 'test-results/role-manager-verified.png', fullPage: true });
  });

  test('Department Operator (operator@goldia.uz) logs in and accesses shopfloor workstation', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'operator@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // Operator accesses manufacturing shopfloor
    await page.goto('/manufacturing');
    await expect(page).toHaveURL(/\/manufacturing/);
    await expect(page.locator('body')).toContainText(/Sex|Bo'lim|Ishlab chiqarish/i);

    // Operator accesses batches view
    await page.goto('/batches');
    await expect(page).toHaveURL(/\/batches/);
    await expect(page.locator('body')).toContainText(/Partiya|WIP/i);

    await page.screenshot({ path: 'test-results/role-operator-verified.png', fullPage: true });
  });

  test('Quality Inspector (qc@goldia.uz) logs in, verifies QC pipeline and manufacturing stages', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'qc@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // QC Inspector verifies manufacturing pipeline
    await page.goto('/manufacturing');
    await expect(page).toHaveURL(/\/manufacturing/);
    await expect(page.locator('body')).toContainText(/Sex|Bo'lim|Ishlab chiqarish/i);

    // QC Inspector verifies batches
    await page.goto('/batches');
    await expect(page).toHaveURL(/\/batches/);
    await expect(page.locator('body')).toContainText(/Partiya|WIP/i);

    await page.screenshot({ path: 'test-results/role-qc-verified.png', fullPage: true });
  });

  test('Accountant (accountant@goldia.uz) logs in, audits sales transactions, gold inventory and reports', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'accountant@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // Accountant verifies sales & debt records
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/sales/);
    await expect(page.locator('body')).toContainText(/Sotuv|Mijoz|Qarz/i);

    // Accountant audits Safe Gold inventory
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory/);
    await expect(page.locator('body')).toContainText(/Chisto Oltin 999\.9|Oltin Lom 585/i);

    // Accountant audits Financial Reports
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.locator('body')).toContainText(/Hisobot|Ishlab chiqarish|Oltin/i);

    await page.screenshot({ path: 'test-results/role-accountant-verified.png', fullPage: true });
  });

  test('SIMULATED SUPABASE BACKEND E2E: Database persistence across browser reloads and deep navigation', async ({ page }) => {
    // Login as Goldia Director
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // Navigate to inventory
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory/);
    await expect(page.locator('body')).toContainText(/Chisto Oltin 999\.9/i);

    // Reload page — verify session remains active and data persists
    await page.reload();
    await expect(page).toHaveURL(/\/inventory/);
    await expect(page.locator('body')).toContainText(/Chisto Oltin 999\.9/i);

    // Navigate to settings and reload
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
    await page.reload();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('body')).toContainText(/Goldia/i);

    await page.screenshot({ path: 'test-results/session-persistence-verified.png', fullPage: true });
  });
});
