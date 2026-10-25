const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0) {
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[trimmed.slice(0, idx).trim()] = v;
  }
}

const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const candidateTables = [
  'organizations',
  'employees',
  'customers',
  'products',
  'jewelry_models',
  'factory_receipts',
  'consignment_pieces',
  'seller_consignments',
  'jewelry_sales',
  'gold_settlements',
  'client_gold_accounts',
  'seller_gold_accounts',
  'manager_vault_account',
  'daily_gold_rates',
  'sales_markup_presets',
  'refining_batches',
  'factory_gold_handovers',
  'accounting_baselines',
  'financial_transactions',
  'sales_login_audit_logs'
];

async function main() {
  console.log('Probing tables on Production REST API...');
  const headers = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Prefer': 'count=exact'
  };

  for (const t of candidateTables) {
    const res = await fetch(`${prodUrl}/rest/v1/${t}?select=*&limit=1`, { headers });
    if (res.ok) {
      const countHeader = res.headers.get('content-range');
      console.log(`✅ Table exists: ${t.padEnd(25)} (range: ${countHeader})`);
    } else {
      console.log(`❌ Table missing: ${t.padEnd(25)} (status: ${res.status})`);
    }
  }
}

main().catch(console.error);
