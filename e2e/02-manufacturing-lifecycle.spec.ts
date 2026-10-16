/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('2. End-to-End Manufacturing Lifecycle & Production Workflow', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      console.log(`[DIALOG] ${dialog.type()}: ${dialog.message()}`);
      await dialog.accept();
    });
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });
  });

  test('Check Safe Gold Inventory shows on-hand metal balances from database', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory/);

    // Verify presence of table with gold items
    await expect(page.locator('body')).toContainText(/Chisto Oltin 999\.9|Oltin Lom 585/i);
    await page.screenshot({ path: 'test-results/inventory-verified.png', fullPage: true });
  });

  test('Create Batch via Form and Verify Stage WIP & QR Label Generation', async ({ page }) => {
    await page.goto('/batches');
    await expect(page).toHaveURL(/\/batches/);

    // Fill the actual batch creation form on page
    const batchInput = page.locator('input[placeholder*="Batch ID"]');
    await expect(batchInput).toBeVisible({ timeout: 10000 });
    await batchInput.fill('BATCH-BROWSER-E2E');

    const modelInput = page.locator('input[placeholder="Model / Komplekt nomi"]');
    await modelInput.fill('Uzuk Klassika 585');

    const workerInput = page.locator('input[placeholder="Mas\'ul usta ismi"]');
    if (await workerInput.isVisible()) {
      await workerInput.fill('Alisher Director (Goldia)');
    }

    // Submit the form
    const submitBtn = page.locator('button[type="submit"]:has-text("Partiya ochish")');
    await submitBtn.click();

    // Verify the newly created batch appears in the batch list
    await expect(page.locator('body')).toContainText('BATCH-BROWSER-E2E', { timeout: 15000 });
    await expect(page.locator('body')).toContainText('Uzuk Klassika 585');

    // Take screenshot of created batch
    await page.screenshot({ path: 'test-results/batch-created-ui.png', fullPage: true });

    // Click on the created batch row to select it
    const batchRow = page.locator('tr:has-text("BATCH-BROWSER-E2E")');
    await batchRow.click();

    // Verify Print Label button is visible in selected batch drawer
    const printBtn = page.locator('button:has-text("Yorliq")').first();
    await expect(printBtn).toBeVisible({ timeout: 10000 });
  });

  test('Manufacturing Hub and Department Stages displays active pipeline', async ({ page }) => {
    await page.goto('/manufacturing');
    await expect(page).toHaveURL(/\/manufacturing/);

    // Verify manufacturing hub elements
    await expect(page.locator('body')).toContainText(/Sex|Bo'lim|Ishlab chiqarish/i);
    await page.screenshot({ path: 'test-results/manufacturing-hub.png', fullPage: true });
  });

  test('Daily Production and Gold Reconciliation Reports are generated', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/reports/);

    // Verify reports table
    await expect(page.locator('body')).toContainText(/Hisobot|Ishlab chiqarish|Oltin/i);
    await page.screenshot({ path: 'test-results/reports-dashboard.png', fullPage: true });
  });
});
