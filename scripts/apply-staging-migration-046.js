const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql');

async function apply046() {
  const file = path.resolve(__dirname, '../supabase/migrations/20260101000046_goldia_unified_vault_and_tills_parity.sql');
  const sql = fs.readFileSync(file, 'utf8');
  console.log('Applying Migration 046 to Staging (vouehtlmsunebracahon)...');
  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('Applied migration SQL successfully. Result:', res);

  // Register in supabase_migrations.schema_migrations
  const registerSql = "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260101000046', 'goldia_unified_vault_and_tills_parity') ON CONFLICT (version) DO NOTHING;";
  const regRes = await runSqlQuery(registerSql, 'vouehtlmsunebracahon');
  console.log('Registered migration 046 in schema_migrations:', regRes);
}

apply046().catch(err => {
  console.error('Migration 046 Error:', err);
  process.exit(1);
});
