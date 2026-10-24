const { runSqlQuery } = require('./execute-staging-sql');

async function main() {
  console.log('Recording migrations 043 and 044 in schema_migrations on staging...');
  const sql = `
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES
      ('20260101000043', 'goldia_core_financial_and_reversal_parity'),
      ('20260101000044', 'goldia_p0_safety_and_lock_order_parity')
    ON CONFLICT (version) DO NOTHING;
  `;
  const res = await runSqlQuery(sql);
  console.log('Result:', res);

  const check = await runSqlQuery(`
    SELECT version, name FROM supabase_migrations.schema_migrations
    WHERE version >= '20260101000040'
    ORDER BY version ASC;
  `);
  console.log('Applied migrations on staging (040-044):', check);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
