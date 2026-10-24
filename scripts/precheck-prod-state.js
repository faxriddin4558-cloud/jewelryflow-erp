const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const EXPECTED_PROD_REF = 'vrozlllcaxinavzxueif';

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

const env = parseEnv(ENV_PATH);
const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

async function checkCounts() {
  console.log('=== PRODUCTION INTEGRITY PRE-CHECK ===');
  console.log('Target URL:', prodUrl);

  // 1. Auth users
  const authRes = await fetch(`${prodUrl}/auth/v1/admin/users`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const authData = await authRes.json();
  const users = authData.users || [];
  console.log(`Live Auth Users: ${users.length}`);
  users.forEach(u => console.log(`  - User: ${u.email} (id: ${u.id})`));

  // 2. Customers
  const custRes = await fetch(`${prodUrl}/rest/v1/customers?select=id,customer_code,contact_name`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const customers = await custRes.json();
  console.log(`Live Customers: ${customers.length}`);
  customers.forEach(c => console.log(`  - Customer: ${c.customer_code} / ${c.contact_name}`));

  // 3. Employees
  const empRes = await fetch(`${prodUrl}/rest/v1/employees?select=id,name,role,email`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`
    }
  });
  const emps = await empRes.json();
  console.log(`Live Employees: ${emps.length}`);
  emps.forEach(e => console.log(`  - Employee: ${e.name} (${e.role}) ${e.email || ''}`));

  // 4. Sales / Settlements / Consignments
  for (const table of ['jewelry_sales', 'gold_settlements', 'seller_consignments', 'client_gold_accounts', 'seller_gold_accounts']) {
    const res = await fetch(`${prodUrl}/rest/v1/${table}?select=count`, {
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'count=exact'
      }
    });
    const cr = res.headers.get('content-range');
    const count = cr ? cr.split('/')[1] : '0';
    console.log(`Table ${table} rows: ${count}`);
  }
}

checkCounts().catch(console.error);
