const { execSync } = require('child_process');

function getStagingKeys() {
  const raw = execSync('npx supabase projects api-keys --project-ref vouehtlmsunebracahon --output json', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const jsonStart = raw.indexOf('[');
  const jsonEnd = raw.lastIndexOf(']') + 1;
  const keys = JSON.parse(raw.slice(jsonStart, jsonEnd));
  let serviceRoleKey = '';
  for (const k of keys) {
    if (k.name === 'service_role') serviceRoleKey = k.api_key;
  }
  return serviceRoleKey;
}

async function searchStaging() {
  const key = getStagingKeys();
  const url = 'https://vouehtlmsunebracahon.supabase.co';

  console.log('Searching staging tables for STL-MGR or Dilshod...');
  
  // 1. Check manager_seller_settlements
  const mss = await fetch(`${url}/rest/v1/manager_seller_settlements?select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  }).then(r => r.json());
  console.log('manager_seller_settlements rows count:', mss?.length || 0);
  if (Array.isArray(mss)) {
    mss.forEach(r => console.log('MSS row:', r.document_number, r.status, r.cash_amount, r.scrap_grams, r.total_585_equiv_grams, r.seller_id));
  }

  // 2. Check gold_settlements
  const gs = await fetch(`${url}/rest/v1/gold_settlements?select=*&order=created_at.desc&limit=20`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  }).then(r => r.json());
  console.log('gold_settlements recent rows:', gs?.length || 0);
  if (Array.isArray(gs)) {
    gs.forEach(r => console.log('GS row:', r.document_number, r.status, r.cash_paid_amount, r.scrap_weight_grams, r.cash_equivalent_grams));
  }

  // 3. Check audit_logs
  const al = await fetch(`${url}/rest/v1/audit_logs?select=*&entity_type=eq.manager_seller_settlement&order=created_at.desc&limit=10`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  }).then(r => r.json());
  console.log('audit_logs MSS entries:', al?.length || 0);
  if (Array.isArray(al)) {
    al.forEach(r => console.log('Audit log:', r.entity_id, r.action, r.created_at, JSON.stringify(r.details)));
  }

  // 4. Check all seller_gold_accounts on staging
  const sga = await fetch(`${url}/rest/v1/seller_gold_accounts?select=*`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  }).then(r => r.json());
  console.log('\nAll seller_gold_accounts on staging:', sga?.length || 0);
  if (Array.isArray(sga)) {
    sga.forEach(r => console.log('SGA:', r.seller_id, 'obligation:', r.current_factory_obligation_grams, 'consigned:', r.total_consigned_gold_grams, 'settled:', r.total_factory_settled_gold_grams, 'cash:', r.cash_balance_uzs, 'scrap:', r.scrap_gold_balance_grams));
  }
}

searchStaging().catch(console.error);
