import { describe, it, expect } from 'vitest';
import {
  detectBarcodeType,
  parseWeightValue,
  createEmptyScanSession,
  processScannedCode,
  removePieceFromSession,
  undoLastScannedPiece,
  addGrams,
  subtractGrams,
  formatGrams,
  generateBarTenderCsv,
  type JewelryModelItem,
  DEFAULT_SCANNER_CONFIG,
} from '../barcode-scanner-engine';

describe('Barcode Scanner 564 & BarTender Engine', () => {
  const sampleModels: JewelryModelItem[] = [
    {
      id: '88888888-8888-4001-8001-000000000001',
      model_code: 'JF-M-0001',
      name: 'Malika',
      category: 'Серьги',
      decorations: 'Дорика',
      reference_weight_grams: 14.5,
      gold_purity: 585,
    },
    {
      id: '88888888-8888-4001-8001-000000000002',
      model_code: 'JF-M-0002',
      name: 'Shahzoda',
      category: 'Uzuk',
      decorations: 'Brilliant',
      reference_weight_grams: 8.2,
      gold_purity: 585,
    },
  ];

  describe('1. Barcode Detection & Prefix Parsing', () => {
    it('detects model QR code with standard JF-M- prefix', () => {
      const res = detectBarcodeType('JF-M-0001');
      expect(res.type).toBe('model_qr');
      expect(res.extractedModelCode).toBe('JF-M-0001');
    });

    it('detects model QR code with M- prefix', () => {
      const res = detectBarcodeType('M-0001');
      expect(res.type).toBe('model_qr');
      expect(res.extractedModelCode).toBe('M-0001');
    });

    it('detects model QR code formatted as JSON payload', () => {
      const json = JSON.stringify({ type: 'model', model_code: 'JF-M-0001' });
      const res = detectBarcodeType(json);
      expect(res.type).toBe('model_qr');
      expect(res.extractedModelCode).toBe('JF-M-0001');
    });

    it('detects standard decimal weight barcode', () => {
      const res = detectBarcodeType('14.52');
      expect(res.type).toBe('weight_barcode');
      expect(res.cleanCode).toBe('14.52');
    });

    it('detects weight barcode with comma separator', () => {
      const res = detectBarcodeType('14,68');
      expect(res.type).toBe('weight_barcode');
      expect(res.cleanCode).toBe('14,68');
    });

    it('detects weight barcode with prefix like W: or WT-', () => {
      const res1 = detectBarcodeType('W:6.06');
      expect(res1.type).toBe('weight_barcode');
      expect(res1.cleanCode).toBe('6.06');

      const res2 = detectBarcodeType('WT-14.35');
      expect(res2.type).toBe('weight_barcode');
      expect(res2.cleanCode).toBe('14.35');
    });

    it('classifies unknown string safely', () => {
      const res = detectBarcodeType('INVALID_STRING_XYZ');
      expect(res.type).toBe('unknown');
    });
  });

  describe('2. Weight Parsing & Validation Safety', () => {
    it('parses dot decimals correctly', () => {
      const res = parseWeightValue('14.52');
      expect(res.success).toBe(true);
      expect(res.weightGrams).toBe(14.52);
    });

    it('parses comma decimals correctly in auto mode', () => {
      const res = parseWeightValue('6,06');
      expect(res.success).toBe(true);
      expect(res.weightGrams).toBe(6.06);
    });

    it('parses implicit 2-decimal numbers when configured', () => {
      const res = parseWeightValue('00606', 'implicit_2');
      expect(res.success).toBe(true);
      expect(res.weightGrams).toBe(6.06);
    });

    it('rejects zero or negative weight', () => {
      expect(parseWeightValue('0').success).toBe(false);
      expect(parseWeightValue('-14.52').success).toBe(false);
    });

    it('rejects non-numeric string as weight', () => {
      expect(parseWeightValue('abc').success).toBe(false);
      expect(parseWeightValue('14.5.2').success).toBe(false);
    });
  });

  describe('3. Precision Decimal Accumulation (Zero Float Drift)', () => {
    it('aggregates exact weights without IEEE-754 drift', () => {
      // 14.52 + 14.68 + 14.35 in raw JS is 43.550000000000004
      const sum1 = addGrams(14.52, 14.68);
      expect(sum1).toBe(29.2);

      const sum2 = addGrams(sum1, 14.35);
      expect(sum2).toBe(43.55);
      expect(formatGrams(sum2)).toBe('43.5500');
    });

    it('subtractsGrams accurately', () => {
      const diff = subtractGrams(43.55, 14.52);
      expect(diff).toBe(29.03);
      expect(formatGrams(diff)).toBe('29.0300');
    });
  });

  describe('4. Scanner 564 Draft Session Workflow', () => {
    it('requires scanning model QR before weight barcodes', () => {
      const session = createEmptyScanSession();
      const res = processScannedCode('14.52', session, sampleModels);
      expect(res.success).toBe(false);
      expect(res.action).toBe('error');
      expect(res.message).toContain('Avval Model QR kodini skaner qiling');
    });

    it('switches active model when model QR is scanned', () => {
      const session = createEmptyScanSession();
      const res = processScannedCode('JF-M-0001', session, sampleModels);
      expect(res.success).toBe(true);
      expect(res.action).toBe('model_switched');
      expect(res.session.activeModel?.name).toBe('Malika');
    });

    it('adds 1 unit with exact weight to active model', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;

      const res = processScannedCode('14.52', session, sampleModels);
      expect(res.success).toBe(true);
      expect(res.action).toBe('piece_added');
      expect(res.session.totalPieces).toBe(1);
      expect(res.session.totalWeightGrams).toBe(14.52);
      expect(res.session.byModel['JF-M-0001']?.count).toBe(1);
      expect(res.session.byModel['JF-M-0001']?.totalWeightGrams).toBe(14.52);
    });

    it('accumulates multiple weight scans for that model (e.g. 14.52, 14.68, 14.35 -> 3 units, 43.55g)', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;

      session = processScannedCode('14.52', session, sampleModels).session;
      session = processScannedCode('14.68', session, sampleModels).session;
      session = processScannedCode('14.35', session, sampleModels).session;

      expect(session.totalPieces).toBe(3);
      expect(session.totalWeightGrams).toBe(43.55);
      expect(session.byModel['JF-M-0001']?.count).toBe(3);
      expect(session.byModel['JF-M-0001']?.totalWeightGrams).toBe(43.55);
    });

    it('supports two different genuine physical pieces having the exact same weight', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;

      // First piece with 14.52g
      session = processScannedCode('14.52', session, sampleModels).session;

      // Second piece also happens to weigh 14.52g (with override/normal gap)
      const res = processScannedCode('14.52', session, sampleModels, DEFAULT_SCANNER_CONFIG, {
        allowDuplicateOverride: true,
      });
      expect(res.success).toBe(true);
      expect(res.session.totalPieces).toBe(2);
      expect(res.session.totalWeightGrams).toBe(29.04);
      // Both pieces have different unique IDs
      expect(res.session.pieces[0]?.id).not.toBe(res.session.pieces[1]?.id);
    });

    it('warns operator on accidental double scan bounce within debounce window', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;
      session = processScannedCode('14.52', session, sampleModels).session;

      // Simulate rapid second scan (< debounceMs) without override
      const res = processScannedCode('14.52', session, sampleModels, {
        ...DEFAULT_SCANNER_CONFIG,
        debounceMs: 500,
      });
      expect(res.success).toBe(false);
      expect(res.action).toBe('duplicate_warning');
      expect(res.session.totalPieces).toBe(1);
    });

    it('switches model seamlessly when another model QR is scanned', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;
      session = processScannedCode('14.52', session, sampleModels).session;

      // Switch to Shahzoda
      session = processScannedCode('JF-M-0002', session, sampleModels).session;
      expect(session.activeModel?.name).toBe('Shahzoda');

      // Scan Shahzoda weight: 8.20
      session = processScannedCode('8.20', session, sampleModels).session;

      expect(session.totalPieces).toBe(2);
      expect(session.totalWeightGrams).toBe(22.72);
      expect(session.byModel['JF-M-0001']?.count).toBe(1);
      expect(session.byModel['JF-M-0002']?.count).toBe(1);
    });

    it('undoes last scan correctly', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;
      session = processScannedCode('14.52', session, sampleModels).session;
      session = processScannedCode('14.68', session, sampleModels).session;

      expect(session.totalPieces).toBe(2);

      const undoRes = undoLastScannedPiece(session);
      expect(undoRes.removedPiece?.weightGrams).toBe(14.68);
      expect(undoRes.session.totalPieces).toBe(1);
      expect(undoRes.session.totalWeightGrams).toBe(14.52);
    });

    it('removes a piece by ID correctly', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;
      session = processScannedCode('14.52', session, sampleModels).session;
      const targetId = session.pieces[0]?.id || '';

      const updated = removePieceFromSession(session, targetId);
      expect(updated.totalPieces).toBe(0);
      expect(updated.totalWeightGrams).toBe(0);
      expect(updated.byModel['JF-M-0001']).toBeUndefined();
    });

    it('rejects weights outside physical min/max threshold', () => {
      let session = createEmptyScanSession();
      session = processScannedCode('JF-M-0001', session, sampleModels).session;

      const lowRes = processScannedCode('0.01', session, sampleModels, {
        ...DEFAULT_SCANNER_CONFIG,
        minWeightGrams: 0.1,
      });
      expect(lowRes.success).toBe(false);
      expect(lowRes.message).toContain("me'yordan tashqarida");

      const highRes = processScannedCode('1500.0', session, sampleModels);
      expect(highRes.success).toBe(false);
      expect(highRes.message).toContain("me'yordan tashqarida");
    });
  });

  describe('5. BarTender CSV Export & Tag Compatibility', () => {
    it('generates valid RFC-4180 CSV for BarTender data source', () => {
      const csv = generateBarTenderCsv(sampleModels);
      expect(csv).toContain('ModelCode,ModelName,Category,Purity,Decorations,ReferenceWeightGrams,QrPayload');
      expect(csv).toContain('"JF-M-0001","Malika","Серьги","585","Дорика","14.5000","JF-M-0001"');
      expect(csv).toContain('"JF-M-0002","Shahzoda","Uzuk","585","Brilliant","8.2000","JF-M-0002"');
    });
  });
});
