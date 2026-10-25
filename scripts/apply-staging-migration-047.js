const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql');

async function apply047() {
  const file = path.resolve(__dirname, '../supabase/migrations/20260101000047_goldia_automatic_profit_and_baseline_accounting.sql');
  const sql = fs.readFileSync(file, 'utf8');
  console.log('Applying Migration 047 to Staging (vouehtlmsunebracahon)...');
  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('Applied migration SQL successfully. Result:', res);

  // Register in supabase_migrations.schema_migrations
  const registerSql = "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260101000047', 'goldia_automatic_profit_and_baseline_accounting') ON CONFLICT (version) DO NOTHING;";
  const regRes = await runSqlQuery(registerSql, 'vouehtlmsunebracahon');
  console.log('Registered migration 047 in schema_migrations:', regRes);
}

apply047().catch(err => {
  console.error('Migration 047 Error:', err);
  process.exit(1);
});
