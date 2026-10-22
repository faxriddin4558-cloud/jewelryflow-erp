const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

function getSupabaseAccessToken() {
  const psPath = path.resolve(__dirname, 'get-token.ps1');
  return execSync(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { encoding: 'utf8' }).trim();
}

async function runSqlQuery(sqlQuery, projectRef = 'vouehtlmsunebracahon') {
  const token = getSupabaseAccessToken();
  if (!token) throw new Error('Supabase CLI access token not found in Windows Credential Manager');

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sqlQuery });
    const req = https.request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`Supabase API error (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('Testing SQL query on vouehtlmsunebracahon...');
  const testRes = await runSqlQuery('SELECT current_database(), current_user;');
  console.log('Connected! Result:', testRes);

  const migrationFile = path.resolve(__dirname, '../supabase/migrations/20260101000036_security_hardening_seller_isolation_and_factory_permissions.sql');
  console.log('Reading Migration 036 from:', migrationFile);
  const sql = fs.readFileSync(migrationFile, 'utf8');

  console.log('Applying Migration 036 to vouehtlmsunebracahon...');
  const applyRes = await runSqlQuery(sql);
  console.log('Migration 036 applied successfully! Result:', applyRes);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runSqlQuery };
