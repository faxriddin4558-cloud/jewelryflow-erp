const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql.js');

async function main() {
  console.log('==============================================================================');
  console.log('APPLYING MIGRATION 051 TO STAGING (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const migrationFile = path.resolve(__dirname, '../supabase/migrations/20260101000051_goldia_legacy_debt_and_universal_reversals.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  console.log('Executing Migration 051 SQL on Staging...');
  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('SQL Execution complete! Result:', res);

  // Record in schema migrations
  const recordSql = `
    insert into supabase_migrations.schema_migrations (version, statements, name)
    values ('20260101000051', array['20260101000051_goldia_legacy_debt_and_universal_reversals.sql'], 'goldia_legacy_debt_and_universal_reversals')
    on conflict (version) do nothing;
  `;
  await runSqlQuery(recordSql, 'vouehtlmsunebracahon');
  console.log('Migration 051 recorded in supabase_migrations.schema_migrations');
}

main().catch(console.error);
