const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql.js');

async function main() {
  console.log('==============================================================================');
  console.log('APPLYING MIGRATIONS 053, 054, 055 TO STAGING (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const migrations = [
    {
      version: '20260101000053',
      file: 'supabase/migrations/20260101000053_goldia_profit_summary_parity_and_hnd_cleanup.sql',
      name: 'goldia_profit_summary_parity_and_hnd_cleanup'
    },
    {
      version: '20260101000054',
      file: 'supabase/migrations/20260101000054_goldia_scanner_weight_model_and_consignment_parity.sql',
      name: 'goldia_scanner_weight_model_and_consignment_parity'
    },
    {
      version: '20260101000055',
      file: 'supabase/migrations/20260101000055_goldia_consignment_fifo_and_stock_parity.sql',
      name: 'goldia_consignment_fifo_and_stock_parity'
    }
  ];

  for (const m of migrations) {
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
  }

  console.log('\nAll migrations applied successfully to Staging!');
}

main().catch((err) => {
  console.error('Migration failed on Staging:', err);
  process.exit(1);
});
