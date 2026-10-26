const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
function parseEnv(filePath) {
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      res[trimmed.slice(0, idx).trim()] = v;
    }
  }
  return res;
}

async function inspectSellerState() {
  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  const sp = createClient(prodUrl, serviceRoleKey);
  const { data: sellers } = await sp.from('seller_gold_accounts').select('*');
  console.log('Seller gold accounts on Prod:');
  console.log(JSON.stringify(sellers, null, 2));

  const { data: legDebts } = await sp.from('client_legacy_debts').select('*');
  console.log('Client legacy debts on Prod:');
  console.log(JSON.stringify(legDebts, null, 2));

  const { data: settlements } = await sp.from('gold_settlements').select('*');
  console.log('Gold settlements on Prod:');
  console.log(JSON.stringify(settlements, null, 2));
}

inspectSellerState().catch(console.error);
