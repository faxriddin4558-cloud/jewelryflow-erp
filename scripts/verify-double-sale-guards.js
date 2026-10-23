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

async function main() {
  await sb.auth.signInWithPassword({ email: 'seller@goldia.uz', password: 'GoldiaPassword2026!' });

  console.log('--- TEST 1: Attempting to sell already sold piece b60069f0 via rpc_record_barcode_piece_sale ---');
  const pieceRes = await sb.rpc('rpc_record_barcode_piece_sale', {
    p_customer_id: '7c7fefa7-660a-4ffe-ac90-6fc7249bc734',
    p_seller_id: '11111111-1111-4001-8001-000000000017',
    p_piece_id: 'b60069f0-ca7c-4642-b4ba-32d75272327a',
    p_client_markup_pct: 12.0
  });

  if (pieceRes.error) {
    console.log('✅ TEST 1 BLOCKED AS EXPECTED:', pieceRes.error.message);
  } else {
    console.error('❌ TEST 1 FAILED: Piece sale should have been blocked!', pieceRes.data);
  }

  console.log('\n--- TEST 2: Attempting to sell consignment CONS-BC-A8CD8E61 via legacy rpc_record_client_jewelry_sale ---');
  const batchRes = await sb.rpc('rpc_record_client_jewelry_sale', {
    p_customer_id: '7c7fefa7-660a-4ffe-ac90-6fc7249bc734',
    p_consignment_id: '30e03932-52d4-48de-a3a6-acc72558b123',
    p_client_markup_pct: 12.0
  });

  if (batchRes.error) {
    console.log('✅ TEST 2 BLOCKED AS EXPECTED:', batchRes.error.message);
  } else {
    console.error('❌ TEST 2 FAILED: Legacy sale should have been blocked!', batchRes.data);
  }
}

main().catch(console.error);
