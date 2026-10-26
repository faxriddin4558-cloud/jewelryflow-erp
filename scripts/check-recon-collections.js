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

async function testReconciliationCollections() {
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

  const sp = createClient(prodUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const sellerId = '69ad3650-1437-4d63-af78-19f71f99dca6';

  // 1. Check seller reconciliation statement
  const { data: recon, error: reconErr } = await sp.rpc('rpc_get_seller_reconciliation_statement', { p_seller_id: sellerId });
  if (reconErr) console.error('reconErr:', reconErr);
  else {
    console.log('Recon Section A (Received + Legacy):', recon.section_a);
    console.log('Recon Section B (Goods Unsold):', recon.section_b);
    console.log('Recon Section C (Goods Sold):', recon.section_c);
    console.log('Recon Section D (Customer Receivables):', recon.section_d);
    console.log('Recon Section E (Seller Holdings):', recon.section_e);
    console.log('Recon Section F (Settled to manager):', recon.section_f);
    console.log('Recon Section G (Signed Bozor Qarzi):', recon.section_g);
  }

  // 2. Check monthly report
  const { data: monthly, error: monErr } = await sp.rpc('rpc_get_customer_monthly_report', { p_year: 2026, p_month: 10 });
  if (monErr) console.error('monErr:', monErr);
  else {
    console.log('Monthly Report summary:', monthly.summary);
  }

  // 3. Check daily sales ledger
  const { data: ledger, error: ledErr } = await sp.rpc('rpc_get_daily_sales_ledger', {});
  if (ledErr) console.error('ledErr:', ledErr);
  else {
    console.log('Daily Ledger entries count:', ledger?.length);
    const revEntries = ledger?.filter(l => l.status === 'reversed');
    console.log('Reversed entries in ledger count:', revEntries?.length);
    if (revEntries?.length) console.log('Reversed entry sample:', revEntries[0]);
  }
}

testReconciliationCollections().catch(console.error);
