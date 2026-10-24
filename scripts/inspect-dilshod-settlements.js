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

async function inspectDilshodSettlements() {
  const key = getStagingKeys();
  const url = 'https://vouehtlmsunebracahon.supabase.co';
  const dilshodId = '11111111-1111-4001-8001-000000000018';

  const res = await fetch(`${url}/rest/v1/gold_settlements?seller_id=eq.${dilshodId}&select=*&order=created_at.desc`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  }).then(r => r.json());

  console.log(`Found ${res.length} settlements for Dilshod:`);
  res.forEach(r => {
    console.log(JSON.stringify(r, null, 2));
  });
}

inspectDilshodSettlements().catch(console.error);
