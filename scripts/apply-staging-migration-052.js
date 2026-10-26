const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql.js');

async function main() {
  console.log('==============================================================================');
  console.log('APPLYING MIGRATION 052 TO STAGING (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const migrationFile = path.resolve(__dirname, '../supabase/migrations/20260101000052_goldia_reversal_parity_and_audit_fixes.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  console.log('Executing Migration 052 SQL on Staging...');
  const res = await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log('SQL Execution complete! Result:', res);

  const recordSql = `
    insert into supabase_migrations.schema_migrations (version, statements, name)
    values ('20260101000052', array['20260101000052_goldia_reversal_parity_and_audit_fixes.sql'], 'goldia_reversal_parity_and_audit_fixes')
    on conflict (version) do nothing;
  `;
  await runSqlQuery(recordSql, 'vouehtlmsunebracahon');
  console.log('Migration 052 recorded in supabase_migrations.schema_migrations on Staging');
}

main().catch((err) => {
  console.error('Migration 052 failed on Staging:', err);
  process.exit(1);
});
