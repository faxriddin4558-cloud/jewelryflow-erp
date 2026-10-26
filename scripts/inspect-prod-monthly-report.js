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

async function testMonthlyReport() {
  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  const linkRes = await fetch(`${prodUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: 'goldiaadmin@gmail.com' })
  });
  const linkData = await linkRes.json();
  const hashedToken = linkData.hashed_token || linkData.properties?.hashed_token;

  const verifyRes = await fetch(`${prodUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_hash: hashedToken, type: 'magiclink' })
  });
  const session = await verifyRes.json();
  const token = session.access_token;
  console.log('Got access token for user:', session.user?.email);

  const sp = createClient(prodUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const rep = await sp.rpc('rpc_get_customer_monthly_report', { p_year: 2026, p_month: 10 });
  console.log('Monthly Report Data on Prod:');
  console.log(JSON.stringify(rep.data, null, 2));

  // Also check customer list as loaded by /sales/app/customers
  const custRes = await sp.from('customers').select('*, client_gold_accounts(*)');
  console.log('Customer list with client_gold_accounts:');
  console.log(JSON.stringify(custRes.data, null, 2));
}

testMonthlyReport().catch(console.error);
