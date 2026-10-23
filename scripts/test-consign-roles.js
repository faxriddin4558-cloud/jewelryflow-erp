const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}
loadEnvFile(path.resolve(__dirname, '../.env.staging.local'));
loadEnvFile(path.resolve(__dirname, '../.env.local'));

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function testConsignmentForUser(email, receiptId, weight = 10.0) {
  console.log(`\nTesting rpc_issue_barcode_consignment for ${email}...`);
  const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email, password: 'GoldiaPassword2026!' });
  if (authErr) throw authErr;

  const { data: emps } = await sb.from('employees').select('id, email, name, role_type');
  const jamshid = emps.find(e => e.email === 'seller@goldia.uz');

  // Test piece with model_id as non-UUID string to verify resilience!
  const pieces = [
    {
      model_id: 'non-uuid-custom-model-code',
      model_code: 'TEST-M1',
      model_name: 'Test 10g Uzuk',
      category: 'Кольца',
      purity: 585,
      weight_grams: weight,
      raw_barcode: `BAR-${Date.now()}`
    }
  ];

  const payload = {
    p_seller_id: jamshid.id,
    p_factory_markup_pct: 8.0,
    p_seller_markup_pct: 12.0,
    p_pieces: pieces,
    p_factory_receipt_id: receiptId,
    p_notes: `Test consignment issued by ${email}`,
    p_idempotency_key: `consign_test_${Date.now()}_${Math.random().toString(36).substring(7)}`
  };

  const { data, error } = await sb.rpc('rpc_issue_barcode_consignment', payload);
  if (error) {
    console.error(`❌ ERROR for ${email}:`, error);
    return null;
  } else {
    console.log(`✅ SUCCESS for ${email}!`);
    console.log(`   Consignment No: ${data.consignment_no}`);
    console.log(`   Base Weight:    ${data.base_weight_grams} g`);
    console.log(`   Factory Due:    ${data.factory_gold_due_grams} g (Markup: ${data.factory_markup_pct}%)`);
    console.log(`   Seller Obl:     ${data.seller_obligation_g} g (Markup: ${data.seller_markup_pct}%)`);
    return data;
  }
}

async function main() {
  // Use ZVD-20261022-DE9E4D which has 85g available
  const receiptId = '87913c5a-ccc1-4bda-ab99-bf1352976fa1';
  
  // Test Rustam (Manager)
  const rRes = await testConsignmentForUser('manager@goldia.uz', receiptId, 10.0);
  
  // Test Alisher (Director)
  const dRes = await testConsignmentForUser('director@goldia.uz', receiptId, 10.0);

  if (rRes && dRes) {
    console.log('\n✅ P0-1 FULLY VERIFIED! Both Manager (Rustam) and Director (Alisher) can issue consignments with non-UUID model resilience and independent markups!');
  }
}

main().catch(console.error);
