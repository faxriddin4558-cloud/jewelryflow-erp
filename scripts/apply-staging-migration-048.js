const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql');

async function apply048() {
  const file = path.resolve(__dirname, '../supabase/migrations/20260101000048_goldia_profit_accounting_hardening_and_fx_parity.sql');
  const sql = fs.readFileSync(file, 'utf8');
  console.log('Applying Migration 048 to Staging (vouehtlmsunebracahon)...');
  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('Applied migration 048 SQL successfully. Result:', res);

  // Register in supabase_migrations.schema_migrations
  const registerSql = "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260101000048', 'goldia_profit_accounting_hardening_and_fx_parity') ON CONFLICT (version) DO NOTHING;";
  const regRes = await runSqlQuery(registerSql, 'vouehtlmsunebracahon');
  console.log('Registered migration 048 in schema_migrations:', regRes);
}

apply048().catch(err => {
  console.error('Migration 048 Staging Error:', err);
  process.exit(1);
});
