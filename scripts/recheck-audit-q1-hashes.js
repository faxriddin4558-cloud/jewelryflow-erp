const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROD_ENV = path.resolve(__dirname, '../.env.production.local');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
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

const env = parseEnv(PROD_ENV);
const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const prodKey = env['SUPABASE_SERVICE_ROLE_KEY'];
const prodDbUrl = env['DATABASE_URL'];

async function inspectMigrationsAndRPCs() {
  console.log('=== QUESTION 1: MIGRATION 043 & SCHEMA PARITY CHECK ===');

  // 1. Supabase CLI migration list for Production
  console.log('\n[PROD] Supabase CLI Migration List:');
  const prodList = spawnSync('npx', ['supabase', 'migration', 'list', '--db-url', prodDbUrl], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    encoding: 'utf8'
  });
  const prodLines = (prodList.stdout || '').split('\n').filter(l => l.includes('20260101000043'));
  console.log('Prod 043 row:', prodLines.join(' | ') || 'NOT FOUND');

  // 2. OpenAPI schema inspection for Production
  const prodRest = await fetch(`${prodUrl}/rest/v1/`, {
    headers: { 'apikey': prodKey, 'Authorization': `Bearer ${prodKey}` }
  });
  const prodSpec = await prodRest.json();

  const targetRpcs = [
    'fn_sync_seller_gold_account', // (this is a trigger function)
    'rpc_record_seller_to_manager_settlement',
    'rpc_reverse_seller_to_manager_settlement',
    'rpc_record_gold_purchase'
  ];

  console.log('\n[PROD] RPC OpenAPI Paths:');
  for (const r of targetRpcs) {
    const p = `/rpc/${r}`;
    if (prodSpec.paths && prodSpec.paths[p]) {
      console.log(`  ✅ ${p} exists on Production. Methods:`, Object.keys(prodSpec.paths[p]));
      console.log(`     Parameters:`, JSON.stringify(prodSpec.paths[p]?.post?.parameters?.map(x => x.name) || []));
    } else {
      console.log(`  ℹ️ ${p} not directly in OpenAPI paths (if it is a trigger function, it is not an HTTP RPC)`);
    }
  }

  // 3. Staging OpenAPI schema inspection
  // Get staging key via CLI
  let stagingKey = '';
  try {
    const raw = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', 'vouehtlmsunebracahon', '--output', 'json'], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      encoding: 'utf8'
    });
    const s = raw.stdout || '';
    const j1 = s.indexOf('[');
    const j2 = s.lastIndexOf(']') + 1;
    if (j1 >= 0 && j2 > j1) {
      const keys = JSON.parse(s.slice(j1, j2));
      for (const k of keys) {
        if (k.name === 'service_role') stagingKey = k.api_key;
      }
    }
  } catch (e) {
    console.error('Error fetching staging key:', e.message);
  }

  if (stagingKey) {
    const stgRest = await fetch(`https://vouehtlmsunebracahon.supabase.co/rest/v1/`, {
      headers: { 'apikey': stagingKey, 'Authorization': `Bearer ${stagingKey}` }
    });
    const stgSpec = await stgRest.json();
    console.log('\n[STAGING] RPC OpenAPI Paths Comparison:');
    for (const r of targetRpcs) {
      const p = `/rpc/${r}`;
      const prodHas = Boolean(prodSpec.paths && prodSpec.paths[p]);
      const stgHas = Boolean(stgSpec.paths && stgSpec.paths[p]);
      const prodParams = JSON.stringify(prodSpec.paths?.[p]?.post?.parameters?.map(x => x.name) || []);
      const stgParams = JSON.stringify(stgSpec.paths?.[p]?.post?.parameters?.map(x => x.name) || []);
      const paramsMatch = prodParams === stgParams;
      console.log(`  ${r}: Prod=${prodHas}, Stg=${stgHas}, ParamsMatch=${paramsMatch}`);
      if (!paramsMatch) {
        console.log(`    Prod params: ${prodParams}`);
        console.log(`    Stg params:  ${stgParams}`);
      }
    }
  }
}

inspectMigrationsAndRPCs().catch(console.error);
