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

async function backupProd() {
  console.log('=== CREATING PRODUCTION DATA BACKUP (REST ADMIN API) ===');
  const env = parseEnv(ENV_PATH);
  const prodUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!prodUrl || !prodUrl.includes(EXPECTED_PROD_REF)) {
    console.error('Target ref mismatch:', prodUrl);
    process.exit(1);
  }

  const backupDir = path.resolve(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `prod-backup-${timestamp}.json`);

  const tables = [
    'organizations',
    'employees',
    'customers',
    'client_gold_accounts',
    'seller_gold_accounts',
    'manager_vault_account',
    'daily_gold_rates',
    'sales_markup_presets'
  ];

  const backupData = {
    timestamp: new Date().toISOString(),
    targetRef: EXPECTED_PROD_REF,
    tables: {}
  };

  const headers = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`
  };

  for (const t of tables) {
    try {
      const res = await fetch(`${prodUrl}/rest/v1/${t}?select=*`, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const rows = await res.json();
      backupData.tables[t] = rows;
      console.log(`✅ Backed up ${t}: ${rows.length} rows`);
    } catch (err) {
      console.error(`❌ Error backing up ${t}:`, err.message);
      backupData.tables[t] = { error: err.message };
    }
  }

  // Backup auth users
  try {
    const authRes = await fetch(`${prodUrl}/auth/v1/admin/users`, { headers });
    if (!authRes.ok) throw new Error(`HTTP ${authRes.status}: ${await authRes.text()}`);
    const authData = await authRes.json();
    const users = authData.users || [];
    backupData.auth_users = users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      user_metadata: u.user_metadata
    }));
    console.log(`✅ Backed up auth.users: ${users.length} users`);
  } catch (err) {
    console.error('❌ Error backing up auth.users:', err.message);
    backupData.auth_users = { error: err.message };
  }

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`\n🎉 Production backup successfully saved to:\n${backupFile}`);
}

backupProd().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
