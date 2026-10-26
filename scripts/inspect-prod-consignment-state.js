const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function parseEnv(filePath) {
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      res[k] = v;
    }
  }
  return res;
}

const env = parseEnv(path.resolve(__dirname, '../.env.production.local'));
const supabase = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function run() {
  const tables = [
    'organizations',
    'employees',
    'factory_receipts',
    'consignment_pieces',
    'seller_consignments',
    'factory_gold_handovers',
    'gold_settlements',
    'manager_vault_account',
    'seller_gold_accounts',
    'financial_transactions'
  ];

  for (const t of tables) {
    const { data, error, count } = await supabase.from(t).select('*', { count: 'exact' });
    console.log(`\n=== TABLE: ${t} (Count: ${count}) ===`);
    if (error) {
      console.log('Error:', error.message);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

run().catch(console.error);
