const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql');

async function apply049() {
  const file = path.resolve(__dirname, '../supabase/migrations/20260101000049_goldia_profit_accounting_parity_and_inventory_fixes.sql');
  const sql = fs.readFileSync(file, 'utf8');
  console.log('Applying Migration 049 to Staging (vouehtlmsunebracahon)...');
  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('Applied migration 049 SQL successfully. Result:', res);

  // Register in supabase_migrations.schema_migrations
  const registerSql = "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260101000049', 'goldia_profit_accounting_parity_and_inventory_fixes') ON CONFLICT (version) DO NOTHING;";
  const regRes = await runSqlQuery(registerSql, 'vouehtlmsunebracahon');
  console.log('Registered migration 049 in schema_migrations:', regRes);
}

apply049().catch(err => {
  console.error('Migration 049 Staging Error:', err);
  process.exit(1);
});
