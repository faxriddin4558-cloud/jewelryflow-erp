const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { runSqlQuery } = require('./execute-staging-sql.js');

const envPath = path.resolve(__dirname, '../.env.production.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0) {
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[trimmed.slice(0, idx).trim()] = v;
  }
}

async function checkModels() {
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: consignments } = await c.from('seller_consignments').select('*');
  console.log('prod seller_consignments:', JSON.stringify(consignments, null, 2));
  const { data: pieces } = await c.from('consignment_pieces').select('*');
  console.log('prod consignment_pieces:', JSON.stringify(pieces, null, 2));
  const { data: receipts } = await c.from('factory_receipts').select('id, receipt_no, status, available_physical_g, product_name');
  console.log('prod factory_receipts:', JSON.stringify(receipts, null, 2));
  const { data: handovers } = await c.from('factory_gold_handovers').select('id, handover_no, status, total_585_equiv_grams');
  console.log('prod factory_gold_handovers:', JSON.stringify(handovers, null, 2));
  const { data: vault } = await c.from('manager_vault_account').select('*');
  console.log('prod manager_vault_account:', JSON.stringify(vault, null, 2));
}

checkModels().catch(console.error);
