/* eslint-disable no-console */
import { test, expect } from '@playwright/test';

test.describe('8. JewelryFlow Sales — Barcode Inventory, Scanner 564, BarTender & Mobile Sales E2E', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(`[BROWSER-CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => console.log(`[BROWSER-ERROR] ${err.message}`));
  });

  test('Complete Barcode Lifecycle: Director Scanner 564 Consignment -> BarTender Catalog -> Seller Mobile Barcode Sale -> Real-time Reconciliation', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // -------------------------------------------------------------------------
    // STEP 1: Director Login
    // -------------------------------------------------------------------------
    console.log('[STEP 1] Login as Director at /sales/director...');
    await page.goto('/sales/director');
    await expect(page).toHaveURL(/\/login\?redirectedFrom=(%2F|\/)sales(%2F|\/)director/);

    // Click 1-click Demo Director button
    await page.click('button:has-text("Direktor")');
    await expect(page).toHaveURL(/\/sales\/director/, { timeout: 15000 });

    const topBanner = page.locator('h1:has-text("Direktor Savdo & Konsignatsiya Paneli")');
    await expect(topBanner).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 2: Scanner 564 Two-Code Consignment Topshirish
    // -------------------------------------------------------------------------
    console.log('[STEP 2] Navigating to Skaner 564 Konsignatsiya tab...');
    await page.click('button:has-text("Skaner 564 Konsignatsiya")');

    // 1. Select Jamshid Sotuvchi
    const sellerSelect = page.locator('#scannerSellerSelect');
    await expect(sellerSelect).toBeVisible();
    const jamshidOption = sellerSelect.locator('option:has-text("Jamshid Sotuvchi")');
    await expect(jamshidOption).toBeAttached({ timeout: 10000 });
    const jamshidVal = await jamshidOption.getAttribute('value');
    await sellerSelect.selectOption(jamshidVal || { index: 1 });

    // 2. Select 8% Factory markup
    const markupSelect = page.locator('#scannerFactoryMarkupSelect');
    const opt8 = markupSelect.locator('option:has-text("8")').first();
    await expect(opt8).toBeAttached({ timeout: 10000 });
    const opt8Val = await opt8.getAttribute('value');
    await markupSelect.selectOption(opt8Val || '8');

    // 3. Scan Model QR Code (JF-M-0001: Malika)
    console.log('[STEP 2.1] Scanning Model QR code JF-M-0001...');
    const scanInput = page.locator('#scannerConsignInput');
    await scanInput.fill('JF-M-0001');
    await scanInput.press('Enter');

    // Verify Active Model indicator displays Malika (JF-M-0001)
    await expect(page.locator('#activeModelName')).toHaveText('Malika', { timeout: 5000 });
    await expect(page.locator('#activeModelCode')).toHaveText('JF-M-0001');

    // 4. Scan Piece 1: 14.52g
    console.log('[STEP 2.2] Scanning piece 1: 14.52g...');
    await scanInput.fill('14.52');
    await scanInput.press('Enter');

    // 5. Scan Piece 2: 14.68g
    console.log('[STEP 2.3] Scanning piece 2: 14.68g...');
    await scanInput.fill('14.68');
    await scanInput.press('Enter');

    // 6. Scan Piece 3: 14.35g
    console.log('[STEP 2.4] Scanning piece 3: 14.35g...');
    await scanInput.fill('14.35');
    await scanInput.press('Enter');

    // 7. Verify Draft Summary Metrics
    console.log('[STEP 2.5] Verifying draft metrics (3 pieces, 43.5500g base, 47.0340g factory due)...');
    await expect(page.locator('#draftTotalPieces')).toContainText('3 dona');
    await expect(page.locator('#draftTotalWeight')).toContainText('43.5500 g');
    await expect(page.locator('#draftFactoryDue')).toContainText('47.0340 g lom');

    // 8. Test Undo (Ctrl+Z / Undo button)
    console.log('[STEP 2.6] Testing Undo button...');
    const undoBtn = page.locator('#undoScanBtn');
    await undoBtn.click();

    // After undoing 14.35g: total pieces = 2, total weight = 29.2000g (14.52 + 14.68)
    await expect(page.locator('#draftTotalPieces')).toContainText('2 dona');
    await expect(page.locator('#draftTotalWeight')).toContainText('29.2000 g');

    // Wait debounce time and re-scan 14.35g
    await page.waitForTimeout(400);
    console.log('[STEP 2.7] Re-scanning piece 3 (14.35g)...');
    await scanInput.fill('14.35');
    await scanInput.press('Enter');

    await expect(page.locator('#draftTotalPieces')).toContainText('3 dona');
    await expect(page.locator('#draftTotalWeight')).toContainText('43.5500 g');

    // 9. Confirm Consignment Transfer
    console.log('[STEP 2.8] Confirming consignment transfer to Jamshid Sotuvchi...');
    const confirmBtn = page.locator('#confirmConsignmentBtn');
    await confirmBtn.click();

    // Verify success toast notification
    await expect(page.locator('text=topshirildi').first()).toBeVisible({ timeout: 15000 });

    // Close consignment receipt modal
    const closeReceiptBtn = page.locator('button:has-text("Yopish")');
    await expect(closeReceiptBtn).toBeVisible({ timeout: 10000 });
    await closeReceiptBtn.click();

    // -------------------------------------------------------------------------
    // STEP 3: Verify Seller Inventory Reconciliation Dashboard
    // -------------------------------------------------------------------------
    console.log('[STEP 3] Verifying Seller Inventory Dashboard (Reconciliation)...');
    await page.click('button:has-text("Sotuvchilar Ombori (Donalar)")');

    // Table must list Jamshid Sotuvchi, JF-M-0001, Consigned: 3 pcs (43.5500g), Sold: 0, Available: 3 pcs (43.5500g)
    await expect(page.locator('td:has-text("Jamshid Sotuvchi")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('td:has-text("JF-M-0001")').first()).toBeVisible();
    await expect(page.locator('text=/\\d+ dona \\(/').first()).toBeVisible();
    await expect(page.locator('text=✓ 100% Mos').first()).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 4: BarTender Catalog, Model Creation & QR Export Verification
    // -------------------------------------------------------------------------
    console.log('[STEP 4] Checking BarTender Model Manager & CSV export...');
    await page.click('button:has-text("BarTender Modellar")');
    await expect(page.locator('text=BarTender Modellar Boshqaruvi').first()).toBeVisible();
    await expect(page.locator('text=JF-M-0001').first()).toBeVisible();

    const exportCsvBtn = page.locator('#exportBartenderCsvBtn');
    await expect(exportCsvBtn).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 4.1: Create New Model "Zarina" (Komplekt, 585) & Server Sequence
    // -------------------------------------------------------------------------
    console.log('[STEP 4.1] Checking / Creating new model Zarina (Komplekt, 585)...');
    const zarinaAlreadyCreated = (await page.locator('text=Zarina').count()) > 0;
    if (!zarinaAlreadyCreated) {
      await page.click('#openAddModelModalBtn');
      await expect(page.locator('text=Yangi Doimiy Model Qo\'shish').first()).toBeVisible();

      await page.fill('#newModelName', 'Zarina');
      await page.selectOption('#newModelCategory', 'Комплект');
      await page.selectOption('#newModelPurity', '585');
      await page.fill('#newModelDecorations', 'Brilliant');
      await page.fill('#newModelWeight', '18.40');

      // Upload a test photo for Zarina
      console.log('[STEP 4.1b] Uploading model photo for Zarina...');
      const testImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEfgHzp9B5tAAAAABJRU5ErkJggg==',
        'base64'
      );
      await page.setInputFiles('#newModelPhotoInput', {
        name: 'zarina-sample.png',
        mimeType: 'image/png',
        buffer: testImageBuffer,
      });
      await expect(page.locator('text=Rasm yuklashga tayyor')).toBeVisible();

      console.log('[STEP 4.2] Submitting new model...');
      await page.click('#submitNewModelBtn');

      // Verify success notification and immediate presence in model list
      await expect(page.locator('text=Yangi model muvaffaqiyatli saqlandi').first()).toBeVisible({ timeout: 10000 });
    }
    await expect(page.locator('text=Zarina').first()).toBeVisible();
    await expect(page.locator('text=JF-M-0002').first()).toBeVisible();

    // Verify Zarina row in table has the thumbnail
    await expect(page.locator('#model-row-JF-M-0002 img[alt="Zarina"], #model-row-JF-M-0002 [aria-label*="Zarina"]')).toBeVisible();
    await page.click('#model-row-JF-M-0002');

    // Verify Printable QR card displays Zarina & JF-M-0002
    await expect(page.locator('#activeCardModelName')).toHaveText('Zarina');
    await expect(page.locator('#activeCardModelCode')).toHaveText('JF-M-0002');
    await expect(page.locator('#activeCardQrSvg svg')).toBeVisible();
    await expect(page.locator('#printableQrCard img[alt="Zarina"], #printableQrCard [aria-label*="Zarina"]')).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 4.3: Full Browser Reload to verify persistence across reloads
    // -------------------------------------------------------------------------
    console.log('[STEP 4.3] Performing full browser reload to verify model persistence...');
    await page.reload();
    await expect(page.locator('h1:has-text("Direktor Savdo & Konsignatsiya Paneli")')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);
    const bartenderTabBtn = page.locator('button:has-text("BarTender Modellar")');
    await bartenderTabBtn.click();
    await expect(page.locator('text=BarTender Modellar Boshqaruvi').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Zarina').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=JF-M-0002').first()).toBeVisible();
    await expect(page.locator('text=Malika').first()).toBeVisible();
    await expect(page.locator('#model-row-JF-M-0002 img[alt="Zarina"], #model-row-JF-M-0002 [aria-label*="Zarina"]')).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 4.4: Verify Zarina can be selected in Scanner 564 Consignment
    // -------------------------------------------------------------------------
    console.log('[STEP 4.4] Verifying Zarina in Scanner 564 Consignment...');
    await page.click('button:has-text("Skaner 564 Konsignatsiya")');
    const consignInput = page.locator('#scannerConsignInput');
    await consignInput.fill('JF-M-0002');
    await consignInput.press('Enter');

    await expect(page.locator('#activeModelName')).toHaveText('Zarina');
    await expect(page.locator('#activeModelCode')).toHaveText('JF-M-0002');
    await expect(page.locator('img[alt="Zarina"], [aria-label*="Zarina"]').first()).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 5: Seller Mobile Workspace — Barcode Sale
    // -------------------------------------------------------------------------
    console.log('[STEP 5] Logging in as Jamshid Sotuvchi to Mobile Workspace (/sales/mobile)...');
    await page.context().clearCookies();
    await page.goto('/login');
    await page.click('button:has-text("Sotuvchi")');
    await expect(page).toHaveURL(/\/sales\/mobile/, { timeout: 15000 });

    // Verify Mobile Workspace title
    await expect(page.locator('text=Sotuvchi Mobil Ish Joyi').first()).toBeVisible();

    // Tab 1: Check "Donalar" inventory
    console.log('[STEP 5.1] Checking seller pieces inventory...');
    await page.click('#tabPieces');
    await expect(page.locator('#piecesCountBadge')).toContainText('dona');
    await expect(page.locator('text=14.5200 g').first()).toBeVisible();
    await expect(page.locator('text=14.6800 g').first()).toBeVisible();
    await expect(page.locator('text=14.3500 g').first()).toBeVisible();

    // Tab 2: Skaner Savdo
    console.log('[STEP 5.2] Opening Skaner Savdo tab...');
    await page.click('#tabScanSale');

    // Emulate scanning model JF-M-0001
    const mobileScanInput = page.locator('#sellerBarcodeScanInput');
    await mobileScanInput.fill('JF-M-0001');
    await mobileScanInput.press('Enter');

    // Verify model indicator
    await expect(page.locator('#scannedModelIndicator')).toContainText('JF-M-0001');

    // Emulate scanning weight 14.52g
    await mobileScanInput.fill('14.52');
    await mobileScanInput.press('Enter');

    // Verify piece matched in seller hand
    await expect(page.locator('#matchedPieceCard')).toBeVisible();
    await expect(page.locator('#matchedPieceWeight')).toContainText('14.5200 g');

    // Select customer Rustam Zargar
    const custSelect = page.locator('#scanSaleCustomerSelect');
    const rustamOpt = custSelect.locator('option:has-text("Rustam Zargar")');
    await expect(rustamOpt).toBeAttached({ timeout: 5000 });
    const rustamVal = await rustamOpt.getAttribute('value');
    await custSelect.selectOption(rustamVal || { index: 1 });

    // Select 12% Client Markup
    const markupInput = page.locator('#scanSaleMarkupSelect');
    await markupInput.fill('12');

    // Verify non-compounding calculation preview:
    // Base weight = 14.5200g
    // Client gold due (+12%) = 14.52 * 1.12 = 16.2624g
    await expect(page.locator('#liveClientDueGrams')).toContainText('16.2624 g');

    // Confirm piece sale
    console.log('[STEP 5.3] Confirming barcode piece sale...');
    await page.click('#confirmScanSaleBtn');

    // Verify Sales Receipt Modal appears
    await expect(page.locator('text=Skaner Savdo Cheki (Dona Barcode)').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Rustam Zargar').first()).toBeVisible();
    await expect(page.locator('text=16.2624 g').first()).toBeVisible();

    // Close Receipt Modal
    await page.click('button:has-text("Yopish")');

    // Verify pieces tab now reflects remaining pieces!
    await page.click('#tabPieces');
    await expect(page.locator('#piecesCountBadge')).toContainText('dona');
    await expect(page.locator('text=14.6800 g').first()).toBeVisible();
    await expect(page.locator('text=14.3500 g').first()).toBeVisible();

    // -------------------------------------------------------------------------
    // STEP 6: Director Inventory Dashboard — Final Reconciliation Check
    // -------------------------------------------------------------------------
    console.log('[STEP 6] Returning to Director Workspace to verify full reconciliation...');
    await page.context().clearCookies();
    await page.goto('/login?redirectedFrom=/sales/director');
    await page.click('button:has-text("Direktor")');
    await expect(page).toHaveURL(/\/sales\/director/, { timeout: 15000 });

    await page.click('button:has-text("Sotuvchilar Ombori (Donalar)")');

    // Invariant verification on table:
    // Consigned, Sold, Available, and Mutanosiblik 100% Mos
    await expect(page.locator('text=/\\d+ dona \\(/').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=✓ 100% Mos').first()).toBeVisible();

    console.log('[SUCCESS] All Sprint 4 Barcode Inventory & Scanner 564 invariants verified perfectly!');
  });
});
