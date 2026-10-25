const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql.js');

async function main() {
  console.log('==============================================================================');
  console.log('APPLYING MIGRATION 050 TO STAGING (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const migrationFile = path.resolve(__dirname, '../supabase/migrations/20260101000050_goldia_pilot_profit_hardening_and_period_lock.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  console.log('Executing Migration 050 SQL...');
  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('SQL Execution complete! Result:', res);

  // Record in schema migrations
  const recordSql = `
    insert into supabase_migrations.schema_migrations (version, statements, name)
    values ('20260101000050', array['20260101000050_goldia_pilot_profit_hardening_and_period_lock.sql'], 'goldia_pilot_profit_hardening_and_period_lock')
    on conflict (version) do nothing;
  `;
  await runSqlQuery(recordSql, 'vouehtlmsunebracahon');
  console.log('Migration 050 recorded in supabase_migrations.schema_migrations');
}

main().catch(console.error);
