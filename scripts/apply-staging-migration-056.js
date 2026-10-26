const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql.js');

async function main() {
  console.log('==============================================================================');
  console.log('APPLYING MIGRATION 056 TO STAGING (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const m = {
    version: '20260101000056',
    file: 'supabase/migrations/20260101000056_goldia_capital_legacy_debt_and_vault_parity.sql',
    name: 'goldia_capital_legacy_debt_and_vault_parity'
  };

  console.log(`\nChecking migration ${m.version}...`);
  const checkSql = `select version from supabase_migrations.schema_migrations where version = '${m.version}';`;
  const checkRes = await runSqlQuery(checkSql, 'vouehtlmsunebracahon');
  if (checkRes && checkRes.length > 0) {
    console.log(`Migration ${m.version} already recorded, executing idempotent update...`);
  }

  const migrationFile = path.resolve(__dirname, '..', m.file);
  const sql = fs.readFileSync(migrationFile, 'utf8');
  console.log(`Executing ${m.file} on Staging...`);
  await runSqlQuery(sql, 'vouehtlmsunebracahon');
  console.log(`Executed ${m.file}!`);

  const recordSql = `
    insert into supabase_migrations.schema_migrations (version, statements, name)
    values ('${m.version}', array['${path.basename(m.file)}'], '${m.name}')
    on conflict (version) do nothing;
  `;
  await runSqlQuery(recordSql, 'vouehtlmsunebracahon');
  console.log(`Recorded ${m.version} in schema_migrations!`);

  console.log('\nMigration 056 applied successfully to Staging!');
}

main().catch((err) => {
  console.error('Migration failed on Staging:', err);
  process.exit(1);
});
