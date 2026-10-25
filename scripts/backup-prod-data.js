const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../.env.production.local');
const EXPECTED_PROD_REF = 'vrozlllcaxinavzxueif';

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Env file not found: ${filePath}`);
    process.exit(1);
  }
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

async function backupProd() {
  console.log('==============================================================================');
  console.log('CREATING COMPREHENSIVE PRODUCTION DATA BACKUP (FAIL-CLOSED)');
  console.log(`Target Ref: ${EXPECTED_PROD_REF}`);
  console.log('==============================================================================');

  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!prodUrl || !prodUrl.includes(EXPECTED_PROD_REF)) {
    console.error(`CRITICAL: Target ref mismatch. Expected ${EXPECTED_PROD_REF}, got: ${prodUrl}`);
    process.exit(1);
  }

  if (!serviceRoleKey) {
    console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY missing in .env.production.local');
    process.exit(1);
  }

  const backupDir = path.resolve(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `prod-backup-${timestamp}.json`);
  const latestBackupFile = path.join(backupDir, 'prod-backup-latest.json');

  const tables = [
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

  const backupData = {
    timestamp: new Date().toISOString(),
    targetRef: EXPECTED_PROD_REF,
    tables: {},
    tableCounts: {},
    auth_users: []
  };

  const headers = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Accept': 'application/json'
  };

  for (const t of tables) {
    try {
      const res = await fetch(`${prodUrl}/rest/v1/${t}?select=*`, { headers });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const rows = await res.json();
      backupData.tables[t] = rows;
      backupData.tableCounts[t] = rows.length;
      console.log(`✅ Backed up ${t.padEnd(30)}: ${rows.length.toString().padStart(4)} rows`);
    } catch (err) {
      console.error(`❌ CRITICAL ERROR backing up table "${t}": ${err.message}`);
      console.error('Aborting backup to preserve integrity. FAIL-CLOSED.');
      process.exit(1);
    }
  }

  // Backup auth users
  try {
    const authRes = await fetch(`${prodUrl}/auth/v1/admin/users`, { headers });
    if (!authRes.ok) {
      const errorText = await authRes.text();
      throw new Error(`HTTP ${authRes.status}: ${errorText}`);
    }
    const authData = await authRes.json();
    const users = authData.users || [];
    backupData.auth_users = users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      user_metadata: u.user_metadata
    }));
    backupData.tableCounts['auth.users'] = users.length;
    console.log(`✅ Backed up auth.users:                 ${users.length.toString().padStart(4)} users`);
  } catch (err) {
    console.error(`❌ CRITICAL ERROR backing up auth.users: ${err.message}`);
    console.error('Aborting backup to preserve integrity. FAIL-CLOSED.');
    process.exit(1);
  }

  const jsonContent = JSON.stringify(backupData, null, 2);
  fs.writeFileSync(backupFile, jsonContent, 'utf8');
  fs.writeFileSync(latestBackupFile, jsonContent, 'utf8');

  console.log('==============================================================================');
  console.log(`🎉 Complete production backup successfully saved to:\n  - ${backupFile}\n  - ${latestBackupFile}`);
  console.log('==============================================================================');
}

backupProd().catch(err => {
  console.error('Unexpected backup fatal error:', err);
  process.exit(1);
});
