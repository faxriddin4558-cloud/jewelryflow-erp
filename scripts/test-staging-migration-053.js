const fs = require('fs');
const path = require('path');
const { runSqlQuery } = require('./execute-staging-sql.js');

async function testMigration053Staging() {
  console.log('==============================================================================');
  console.log('APPLYING MIGRATION 053 TO STAGING (vouehtlmsunebracahon)');
  console.log('==============================================================================');

  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, '../supabase/migrations/20260101000053_goldia_profit_summary_parity_and_hnd_cleanup.sql'),
    'utf8'
  );

  console.log('[STEP 1]: Applying migration SQL to Staging...');
  const res = await runSqlQuery(migrationSql);
  console.log('Migration 053 executed on Staging successfully.');

  console.log('\n[STEP 2]: Testing rpc_get_accounting_profit_summary on Staging...');
  const rpcTestSql = `
    SELECT public.rpc_get_accounting_profit_summary(
      p_start_date => null,
      p_end_date => null,
      p_gold_rate => 890000.00,
      p_usd_rate => 12850.00
    ) as summary;
  `;
  const rpcRes = await runSqlQuery(rpcTestSql);
  const summary = rpcRes[0]?.summary;
  console.log('Profit Summary Result on Staging:');
  console.log(JSON.stringify(summary, null, 2));

  // Assertions
  if (!summary) throw new Error('rpc_get_accounting_profit_summary returned null!');
  if (summary.has_baseline === true) {
    console.log('[INFO] Staging has a baseline.');
  } else {
    console.log('[INFO] Staging has NO baseline.');
    if (summary.status !== 'baseline_not_set') throw new Error(`Expected status baseline_not_set, got ${summary.status}`);
    if (summary.period_accounting_result_585_g !== null) throw new Error(`Expected period_accounting_result_585_g null, got ${summary.period_accounting_result_585_g}`);
    console.log(`[PASS] Live Net Assets Preview: ${summary.current_net_assets_585_g}g 585 eq`);
    console.log(`[PASS] Profit Result is null ("Hisoblanmagan"): ${summary.period_accounting_result_585_g === null}`);
  }

  console.log('\n==============================================================================');
  console.log('>>> MIGRATION 053 STAGING TEST 100% PASSED! <<<');
  console.log('==============================================================================');
}

testMigration053Staging().catch(err => {
  console.error('STAGING MIGRATION 053 TEST FAILED:', err);
  process.exit(1);
});
