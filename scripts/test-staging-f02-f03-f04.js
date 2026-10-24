/**
 * JEWELRYFLOW SALES — STAGING FINANCIAL CORE INTEGRATION TEST SUITE (T01 - T13)
 * Target: Staging Supabase (vouehtlmsunebracahon)
 *
 * Verifies:
 * - T01: Seller cash 0 / lom 0 -> nonzero settlement DENIED (ERR_INSUFFICIENT_SCRAP_BALANCE / ERR_INSUFFICIENT_CASH_BALANCE)
 * - T02: Seller cash & lom sufficient -> settlement PASS
 * - T03: Only cash insufficient -> atomic DENIED (rollback, scrap untouched)
 * - T04: Only scrap insufficient -> atomic DENIED (rollback, cash untouched)
 * - T05: Duplicate settlement submission (idempotency replay without double deduction)
 * - T07: Settlement create -> reverse restores EXACT starting balance (obligation, scrap, cash) (F04 fix)
 * - T08: Double reversal DENIED (already reversed guard)
 * - T11: Manager cash purchase with sufficient vault cash PASS (F02)
 * - T12: Manager cash purchase with 0 cash DENIED (F02)
 */

const { runSqlQuery } = require('./execute-staging-sql.js');

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const QA_SELLER_ID = '88888888-8888-4888-8888-888888888888';
const QA_MANAGER_ID = '77777777-7777-4777-7777-777777777777';

function withAuth(sql, userId = QA_MANAGER_ID) {
  return `
    select
      set_config('request.jwt.claims', '{"sub": "${userId}", "role": "authenticated"}', false),
      set_config('app.current_organization_id', '${ORG_ID}', false);
    ${sql}
  `;
}

async function setupTestEnvironment() {
  console.log('\n--- SETUP QA TEST ENVIRONMENT ON STAGING ---');
  // 1. Ensure test seller employee exists
  await runSqlQuery(`
    insert into public.employees (id, organization_id, user_id, full_name, role, is_active, status)
    values ('${QA_SELLER_ID}', '${ORG_ID}', '${QA_SELLER_ID}', 'QA Test Seller', 'sales', true, 'active')
    on conflict (id) do update set is_active = true, role = 'sales', status = 'active';
  `);

  // 2. Ensure test manager employee exists
  await runSqlQuery(`
    insert into public.employees (id, organization_id, user_id, full_name, role, is_active, status)
    values ('${QA_MANAGER_ID}', '${ORG_ID}', '${QA_MANAGER_ID}', 'QA Test Manager', 'production_manager', true, 'active')
    on conflict (id) do update set is_active = true, role = 'production_manager', status = 'active';
  `);

  // 3. Ensure test consignment exists (e.g. 50.00g assigned to QA seller)
  await runSqlQuery(`
    delete from public.gold_settlements where seller_id = '${QA_SELLER_ID}';
    delete from public.seller_consignments where seller_id = '${QA_SELLER_ID}';
    delete from public.seller_gold_accounts where seller_id = '${QA_SELLER_ID}';

    insert into public.seller_consignments (
      organization_id, seller_id, consignment_no, product_name,
      base_weight_grams, proba, factory_markup_pct, factory_gold_due_grams,
      factory_remaining_gold_grams, seller_markup_pct, seller_obligation_g, status
    ) values (
      '${ORG_ID}', '${QA_SELLER_ID}', 'QA-CONSIGN-01', 'QA Test Ring',
      50.0000, 585, 10.00, 55.0000, 55.0000, 10.00, 55.0000, 'held_by_seller'
    );
  `);

  // 4. Trigger sync will initialize seller_gold_accounts
  await runSqlQuery(`
    update public.seller_gold_accounts
    set seller_till_scrap_grams = 0,
        seller_till_cash_amount = 0
    where seller_id = '${QA_SELLER_ID}';
  `);

  console.log('✅ QA Test Seller setup completed: consigned=55.00g, scrap=0g, cash=0 UZS');
}

async function runTests() {
  const results = [];
  function record(id, title, pass, details) {
    results.push({ id, title, pass, details });
    console.log(`${pass ? '✅ PASS' : '❌ FAIL'} [${id}] ${title}: ${details}`);
  }

  // =========================================================================
  // T01: Seller cash 0 / lom 0 -> nonzero settlement DENIED
  // =========================================================================
  try {
    await runSqlQuery(withAuth(`
      select public.rpc_record_seller_to_manager_settlement(
        '${QA_SELLER_ID}',
        1.62,
        450000,
        900000,
        'T01 test: 0 balance transfer'
      );
    `));
    record('T01', 'Seller cash 0 / lom 0 settlement denial', false, 'Expected error, but call succeeded!');
  } catch (err) {
    const isDenied = err.message.includes('ERR_INSUFFICIENT_SCRAP_BALANCE') || err.message.includes('ERR_INSUFFICIENT_CASH_BALANCE');
    record('T01', 'Seller cash 0 / lom 0 settlement denial', isDenied, err.message);
  }

  // =========================================================================
  // T03: Only cash insufficient -> atomic DENIED
  // =========================================================================
  try {
    // Give 2.0g scrap, keep cash at 0
    await runSqlQuery(`
      update public.seller_gold_accounts
      set seller_till_scrap_grams = 2.0000, seller_till_cash_amount = 0
      where seller_id = '${QA_SELLER_ID}';
    `);

    await runSqlQuery(withAuth(`
      select public.rpc_record_seller_to_manager_settlement(
        '${QA_SELLER_ID}',
        1.00,
        500000,
        900000,
        'T03 test: partial cash missing'
      );
    `));
    record('T03', 'Only cash insufficient atomic denial', false, 'Expected error, but call succeeded!');
  } catch (err) {
    const isDenied = err.message.includes('ERR_INSUFFICIENT_CASH_BALANCE');
    const acc = await runSqlQuery(`select seller_till_scrap_grams from public.seller_gold_accounts where seller_id = '${QA_SELLER_ID}'`);
    const scrapIntact = Number(acc[0].seller_till_scrap_grams) === 2.0;
    record('T03', 'Only cash insufficient atomic denial', isDenied && scrapIntact, `Denied: ${isDenied}, Scrap intact at 2.0g: ${scrapIntact}`);
  }

  // =========================================================================
  // T04: Only scrap insufficient -> atomic DENIED
  // =========================================================================
  try {
    // Give 0 scrap, give 1,000,000 UZS cash
    await runSqlQuery(`
      update public.seller_gold_accounts
      set seller_till_scrap_grams = 0, seller_till_cash_amount = 1000000
      where seller_id = '${QA_SELLER_ID}';
    `);

    await runSqlQuery(withAuth(`
      select public.rpc_record_seller_to_manager_settlement(
        '${QA_SELLER_ID}',
        1.50,
        200000,
        900000,
        'T04 test: partial scrap missing'
      );
    `));
    record('T04', 'Only scrap insufficient atomic denial', false, 'Expected error, but call succeeded!');
  } catch (err) {
    const isDenied = err.message.includes('ERR_INSUFFICIENT_SCRAP_BALANCE');
    const acc = await runSqlQuery(`select seller_till_cash_amount from public.seller_gold_accounts where seller_id = '${QA_SELLER_ID}'`);
    const cashIntact = Number(acc[0].seller_till_cash_amount) === 1000000;
    record('T04', 'Only scrap insufficient atomic denial', isDenied && cashIntact, `Denied: ${isDenied}, Cash intact at 1,000,000 UZS: ${cashIntact}`);
  }

  // =========================================================================
  // T02: Seller cash & scrap sufficient -> settlement PASS
  // =========================================================================
  let settleId = null;
  let settleNo = null;
  try {
    // Provide 5.0g scrap and 2,000,000 UZS cash
    await runSqlQuery(`
      update public.seller_gold_accounts
      set seller_till_scrap_grams = 5.0000, seller_till_cash_amount = 2000000
      where seller_id = '${QA_SELLER_ID}';
    `);

    const res = await runSqlQuery(withAuth(`
      select public.rpc_record_seller_to_manager_settlement(
        '${QA_SELLER_ID}',
        1.5000,
        900000,
        900000,
        'T02 test: valid settlement',
        'T02-IDEMP-KEY-001'
      ) as res;
    `));

    const payload = res[0].res;
    settleId = payload.settlement_id;
    settleNo = payload.settlement_no;

    // Check balances
    const acc = await runSqlQuery(`select * from public.seller_gold_accounts where seller_id = '${QA_SELLER_ID}'`);
    const scrapAfter = Number(acc[0].seller_till_scrap_grams);
    const cashAfter = Number(acc[0].seller_till_cash_amount);
    const oblAfter = Number(acc[0].seller_owes_manager_g);

    // 5.0 - 1.5 = 3.5g scrap; 2,000,000 - 900,000 = 1,100,000 UZS cash
    // Total settled: 1.5 + (900000/900000) = 2.5g
    // Obligation: 55.0 - 2.5 = 52.5g
    const valid = scrapAfter === 3.5 && cashAfter === 1100000 && oblAfter === 52.5;
    record('T02', 'Seller sufficient balance settlement PASS', valid,
      `Scrap: ${scrapAfter} (exp 3.5), Cash: ${cashAfter} (exp 1100000), Obligation: ${oblAfter} (exp 52.5)`);
  } catch (err) {
    record('T02', 'Seller sufficient balance settlement PASS', false, err.message);
  }

  // =========================================================================
  // T05: Double-submit idempotency
  // =========================================================================
  try {
    const replayRes = await runSqlQuery(withAuth(`
      select public.rpc_record_seller_to_manager_settlement(
        '${QA_SELLER_ID}',
        1.5000,
        900000,
        900000,
        'T02 replay',
        'T02-IDEMP-KEY-001'
      ) as res;
    `));

    const acc = await runSqlQuery(`select * from public.seller_gold_accounts where seller_id = '${QA_SELLER_ID}'`);
    // Balances must remain EXACTLY unchanged (no double-deduction)
    const scrapAfter = Number(acc[0].seller_till_scrap_grams);
    const cashAfter = Number(acc[0].seller_till_cash_amount);
    const oblAfter = Number(acc[0].seller_owes_manager_g);

    const validIdemp = scrapAfter === 3.5 && cashAfter === 1100000 && oblAfter === 52.5;
    record('T05', 'Settlement double-submit idempotency guard', validIdemp,
      `Replay status: ${replayRes[0].res.status}, Scrap: ${scrapAfter}, Cash: ${cashAfter}, Obl: ${oblAfter}`);
  } catch (err) {
    record('T05', 'Settlement double-submit idempotency guard', false, err.message);
  }

  // =========================================================================
  // T07: Settlement create -> reverse restores EXACT starting balance
  // =========================================================================
  try {
    if (!settleId) throw new Error('No settlement ID from T02');

    const revRes = await runSqlQuery(withAuth(`
      select public.rpc_reverse_seller_to_manager_settlement(
        '${settleId}',
        'T07 test: accidental settlement reversal',
        'T07-REV-KEY-001'
      ) as res;
    `));

    const acc = await runSqlQuery(`select * from public.seller_gold_accounts where seller_id = '${QA_SELLER_ID}'`);
    const scrapRestored = Number(acc[0].seller_till_scrap_grams);
    const cashRestored = Number(acc[0].seller_till_cash_amount);
    const oblRestored = Number(acc[0].seller_owes_manager_g);

    // Starting balances were: scrap=5.0g, cash=2,000,000 UZS, obligation=55.0g
    const exactlyRestored = scrapRestored === 5.0 && cashRestored === 2000000 && oblRestored === 55.0;
    record('T07', 'Settlement create -> reverse EXACT balance restoration (F04 fix)', exactlyRestored,
      `Restored Scrap: ${scrapRestored} (exp 5.0), Cash: ${cashRestored} (exp 2000000), Obligation: ${oblRestored} (exp 55.0)`);
  } catch (err) {
    record('T07', 'Settlement create -> reverse EXACT balance restoration (F04 fix)', false, err.message);
  }

  // =========================================================================
  // T08: Double reversal DENIED
  // =========================================================================
  try {
    await runSqlQuery(withAuth(`
      select public.rpc_reverse_seller_to_manager_settlement(
        '${settleId}',
        'T08 test: duplicate reversal attempt'
      );
    `));
    record('T08', 'Double reversal denial guard', false, 'Expected error on duplicate reversal, but succeeded!');
  } catch (err) {
    const isBlocked = err.message.includes('allaqachon bekor qilingan') || err.message.includes('already reversed');
    record('T08', 'Double reversal denial guard', isBlocked, err.message);
  }

  // =========================================================================
  // T11: Manager cash purchase with sufficient vault cash PASS (F02)
  // =========================================================================
  try {
    // Put 10,000,000 UZS cash in manager vault
    await runSqlQuery(`
      select public._get_or_create_manager_vault('${ORG_ID}');
      update public.manager_vault_account
      set manager_cash_amount = 10000000
      where organization_id = '${ORG_ID}';
    `);

    const buyRes = await runSqlQuery(withAuth(`
      select public.rpc_record_gold_purchase(
        'Bozor ta''minotchi',
        4500000,
        900000,
        5.0000,
        585.0,
        'T11 test: manager gold purchase',
        'T11-BUY-KEY-001'
      ) as res;
    `));

    const vault = await runSqlQuery(`select * from public.manager_vault_account where organization_id = '${ORG_ID}'`);
    const cashRemaining = Number(vault[0].manager_cash_amount);
    const goldPurchased = Number(vault[0].manager_purchased_gold_grams);

    // 10,000,000 - 4,500,000 = 5,500,000 UZS; gold = 5.0g (585)
    const validBuy = cashRemaining === 5500000 && goldPurchased >= 5.0;
    record('T11', 'Manager cash purchase PASS (F02 role permission & vault debit)', validBuy,
      `Vault Cash: ${cashRemaining} (exp 5500000), Purchased Gold: ${goldPurchased}g (exp 5.0g)`);
  } catch (err) {
    record('T11', 'Manager cash purchase PASS (F02 role permission & vault debit)', false, err.message);
  }

  // =========================================================================
  // T12: Manager cash purchase with insufficient cash DENIED (F02)
  // =========================================================================
  try {
    // Reduce vault cash to 100,000 UZS
    await runSqlQuery(`
      update public.manager_vault_account
      set manager_cash_amount = 100000
      where organization_id = '${ORG_ID}';
    `);

    await runSqlQuery(withAuth(`
      select public.rpc_record_gold_purchase(
        'Bozor ta''minotchi',
        5000000,
        900000,
        5.5555,
        585.0,
        'T12 test: overdraft purchase'
      );
    `));
    record('T12', 'Manager cash purchase 0/insufficient cash DENIED', false, 'Expected overdraft error, but call succeeded!');
  } catch (err) {
    const isDenied = err.message.includes('ERR_INSUFFICIENT_VAULT_CASH') || err.message.includes('yetarli naqd pul mavjud emas');
    record('T12', 'Manager cash purchase 0/insufficient cash DENIED', isDenied, err.message);
  }

  // Cleanup test records
  await runSqlQuery(`
    delete from public.gold_settlements where seller_id = '${QA_SELLER_ID}';
    delete from public.seller_consignments where seller_id = '${QA_SELLER_ID}';
    delete from public.seller_gold_accounts where seller_id = '${QA_SELLER_ID}';
    delete from public.employees where id in ('${QA_SELLER_ID}', '${QA_MANAGER_ID}');
  `);

  console.log('\n==============================================================================');
  console.log('STAGING FINANCIAL INTEGRATION TEST SUITE SUMMARY:');
  console.log('==============================================================================');
  const allPass = results.every(r => r.pass);
  results.forEach(r => {
    console.log(`[${r.id}] ${r.pass ? 'PASS' : 'FAIL'} - ${r.title}`);
  });
  console.log(`\nTOTAL: ${results.filter(r => r.pass).length} / ${results.length} PASSED`);
  console.log(`OVERALL STATUS: ${allPass ? '✅ ALL FINANCIAL P0/P1 TESTS PASS' : '❌ SOME TESTS FAILED'}`);

  return allPass;
}

async function main() {
  await setupTestEnvironment();
  const passed = await runTests();
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
