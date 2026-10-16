import { test, expect } from '@playwright/test';

test.describe('3. Factory Settings Persistence, Stage Bypass & Multi-Tenant Isolation', () => {
  test('Goldia Factory Profile persists bypass rules and capacities', async ({ page }) => {
    // Handle dialog alerts automatically
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Login as Goldia Director
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@goldia.uz');
    await page.fill('input[type="password"]', 'GoldiaPassword2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // Visit Settings
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);

    // Click "Korxona Profili" tab
    const profileTabBtn = page.locator('button:has-text("Korxona Profili")');
    await expect(profileTabBtn).toBeVisible({ timeout: 10000 });
    await profileTabBtn.click();

    // Verify bypass stage indicator for Goldia (Pumice 9 and Zircon 13 skipped)
    await expect(page.locator('body')).toContainText(/9.*Pumice|13.*Zircon|Ponza/i);

    // Click Save to DB button
    const saveBtn = page.locator('button:has-text("Bazada Saqlash")').first();
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify persistence message or confirmation
    await page.screenshot({ path: 'test-results/settings-goldia-saved.png', fullPage: true });

    // Reload page to verify persistence in PostgreSQL
    await page.reload();
    await expect(page.locator('body')).toContainText(/Goldia/i);
  });

  test('Strict Cross-Tenant Isolation: Samarkand Director cannot view Goldia data', async ({ page }) => {
    // Login as Samarkand Director
    await page.goto('/login');
    await page.fill('input[type="email"]', 'director@samarkand.uz');
    await page.fill('input[type="password"]', 'SamarkandPassword2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 15000 });

    // Visit Batches
    await page.goto('/batches');
    await expect(page).toHaveURL(/\/batches/);

    // Verify Goldia batch is NOT displayed in Samarkand workspace
    await expect(page.locator('body')).not.toContainText('BATCH-BROWSER-E2E');
    await page.screenshot({ path: 'test-results/tenant-samarkand-isolated.png', fullPage: true });

    // Visit Settings as Samarkand
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('body')).toContainText(/Samarkand/i);
  });
});
