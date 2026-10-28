const fs = require('fs');
const path = require('path');

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

const prodEnv = parseEnv('.env.production.local');
const prodUrl = prodEnv['NEXT_PUBLIC_SUPABASE_URL'];
const serviceKey = prodEnv['SUPABASE_SERVICE_ROLE_KEY'];
const anonKey = prodEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`Fetch attempt ${i + 1} failed (${err.message}). Retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

(async () => {
  const linkRes = await fetchWithRetry(`${prodUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: 'goldiaadmin@gmail.com' })
  });
  const linkData = await linkRes.json();
  const token = linkData.hashed_token || linkData.properties?.hashed_token;

  const verifyRes = await fetchWithRetry(`${prodUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_hash: token, type: 'magiclink' })
  });
  const session = await verifyRes.json();
  const userToken = session.access_token;

  const rpcRes = await fetchWithRetry(`${prodUrl}/rest/v1/rpc/rpc_get_seller_reconciliation_statement`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_seller_id: '69ad3650-1437-4d63-af78-19f71f99dca6' })
  });

  const data = await rpcRes.json();
  console.log('FULL PRODUCTION RECONCILIATION RESULT:\n', JSON.stringify(data, null, 2));
})();
