/**
 * TEST: Scanner 564 WEIGHT_ONLY Mode and Rapid 10x 1g Scan Handling (F06, Section B)
 */

const {
  processScannedCode,
  createEmptyScanSession,
  DEFAULT_SCANNER_CONFIG,
} = require('../src/lib/barcode-scanner-engine.ts');

async function testScannerWeightOnly() {
  console.log('--- TEST SCANNER 564: WEIGHT_ONLY MODE & 10x 1g SCANS ---');
  let session = createEmptyScanSession();

  // Test 1: Scan weight directly without scanning Model QR first (WEIGHT_ONLY default)
  const res1 = processScannedCode('14.52', session, [], DEFAULT_SCANNER_CONFIG);
  if (!res1.success || res1.action !== 'piece_added') {
    throw new Error(`Test 1 Failed: Expected piece_added in WEIGHT_ONLY mode, got: ${JSON.stringify(res1)}`);
  }
  console.log('✅ Test 1 PASS: Direct weight scan accepted without prior model selection!');

  // Test 2: Rapid 10x 1g scans (each scanned ~100ms apart, i.e. separate physical items)
  session = createEmptyScanSession();
  let accepted = 0;
  for (let i = 0; i < 10; i++) {
    // simulate 100ms time step between physical piece scans
    const scanRes = processScannedCode('1.00', session, [], {
      ...DEFAULT_SCANNER_CONFIG,
      debounceMs: 80,
    });
    if (scanRes.success && scanRes.action === 'piece_added') {
      session = scanRes.session;
      accepted++;
    } else {
      console.log(`Scan ${i + 1} rejected:`, scanRes.message);
    }
    // Simulate real passage of time for next scan
    session.lastScanTimestamp -= 120; // 120ms prior to ensure > 80ms interval
  }

  console.log(`Total 1g pieces accepted: ${accepted}/10`);
  console.log(`Total session pieces: ${session.totalPieces}, total weight: ${session.totalWeightGrams}g`);

  if (accepted === 10 && session.totalPieces === 10 && session.totalWeightGrams === 10) {
    console.log('✅ Test 2 PASS: All 10 rapid 1.00g scans accepted as 10 distinct items (Total: 10.00g)!');
  } else {
    throw new Error(`Test 2 Failed: Expected 10 pieces with 10.00g, got ${session.totalPieces} pieces with ${session.totalWeightGrams}g`);
  }

  // Test 3: Hardware bounce (< 80ms) rejected as duplicate
  session = createEmptyScanSession();
  const firstScan = processScannedCode('2.50', session, [], DEFAULT_SCANNER_CONFIG);
  session = firstScan.session;
  // Exact same timestamp (0ms delta = bounce)
  const bounceScan = processScannedCode('2.50', session, [], DEFAULT_SCANNER_CONFIG);
  if (!bounceScan.success && bounceScan.action === 'duplicate_warning') {
    console.log('✅ Test 3 PASS: Hardware switch bounce (<80ms) cleanly detected and discarded!');
  } else {
    throw new Error(`Test 3 Failed: Hardware bounce was not rejected: ${JSON.stringify(bounceScan)}`);
  }

  console.log('\n🎉 ALL SCANNER 564 WEIGHT_ONLY TESTS PASSED!');
}

testScannerWeightOnly().catch(err => {
  console.error('Fatal scanner test error:', err);
  process.exit(1);
});
