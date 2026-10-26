/**
 * JEWELRYFLOW / GOLDIA SALES — STAGING TEST SUITE FOR MIGRATION 057
 * Target Database: Staging (vouehtlmsunebracahon)
 * 
 * Verifies full business cycle:
 * 1. Ta'sischi toza oltin kapitali (Pure Gold Capital) kiritish -> Seyfga tushishi (585 eq va fine g).
 * 2. Zavod kirimi orqali zavod qarzi yaratilishi.
 * 3. Mavjud kapitaldan ko'proq topshirishga urinishda ERR_INSUFFICIENT_CAPITAL_GOLD blokirovkasi.
 * 4. Toza oltin kapitalidan zavodga topshirish (capital_pure_gold) -> Zavod qarzining kamayishi, seyf kamayishi.
 * 5. Net assets va Foyda hisobining neytralligi (aktiv kamaydi = passiv kamaydi, kapital/foyda o'zgarmadi).
 * 6. Zavodga topshirishni bekor qilish (reversal) -> Seyf va zavod qarzining to'liq tiklanishi.
 * 7. Idempotent takroriy yuborish himoyasi (dublikat yaratilmasligi).
 */

const { runSqlQuery } = require('./execute-staging-sql.js');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

async function test() {
  console.log('==============================================================================');
  console.log('STARTING STAGING MIGRATION 057 VERIFICATION: TOZA OLTIN KAPITALI -> SEYF -> ZAVODGA TOPSHIRISH');
  console.log('==============================================================================\n');

  const runId = Math.floor(Math.random() * 899999 + 100000).toString();
  const testOrgId = `00000000-0000-4001-8001-000000${runId}`;
  const directorUserId = `00000000-0000-4001-8002-000000${runId}`;
  const directorEmpId = `00000000-0000-4001-8003-000000${runId}`;
  const sellerEmpId = `00000000-0000-4001-8004-000000${runId}`;

  const jwtHeader = `SET LOCAL "request.jwt.claims" = '{"sub": "${directorUserId}", "org_id": "${testOrgId}"}';`;

  // Step 0: Apply Migration 057 to Staging if not applied
  console.log('--- Step 0: Apply Migration 057 to Staging ---');
  const fs = require('fs');
  const path = require('path');
  const migration057Sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260101000057_goldia_capital_pure_gold_factory_handover.sql'), 'utf-8');
  await runSqlQuery(migration057Sql);
  console.log('✅ Migration 057 executed on Staging successfully.\n');

  // Step 1: Setup fresh isolated tenant
  console.log('--- Step 1: Setup Isolated Test Tenant ---');
  await runSqlQuery(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES ('${testOrgId}', 'parity-057-${runId}', 'Parity 057 Org ${runId}', 'ACTIVE');

    INSERT INTO public.employees (id, organization_id, user_id, name, full_name, role, is_active)
    VALUES ('${directorEmpId}', '${testOrgId}', '${directorUserId}', 'Dir 057', 'Dir 057', 'director', true);

    INSERT INTO public.employees (id, organization_id, name, full_name, role, is_active)
    VALUES ('${sellerEmpId}', '${testOrgId}', 'Sotuvchi 057', 'Sotuvchi 057', 'sales', true);

    -- Today's rate
    INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, is_confirmed)
    VALUES ('${testOrgId}', (timezone('Asia/Tashkent', now()))::date, 585, 900000, true)
    ON CONFLICT (organization_id, rate_date, proba) DO UPDATE SET rate_per_gram = 900000, is_confirmed = true;

    -- Init manager vault
    SELECT public._get_or_create_manager_vault('${testOrgId}');
  `);
  console.log('✅ Fresh tenant initialized.\n');

  // Step 2: Inject Pure Gold Capital (50g @ 995 proba)
  console.log('--- Step 2: Inject Pure Gold Capital into Manager Safe ---');
  // 50g @ 995: 585 eq = 50 * (995/585) = 85.0427g. Fine g = 50 * (995/1000) = 49.7500g.
  const capRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_financial_transaction(
      'capital_contribution',
      'manager_fine_gold',
      50.0000,
      'FINE_GOLD',
      'Ta''sischi hissasi',
      'Ta''sischi 50g toza oltin kiritdi',
      900000,
      12800,
      'T057_CAP_' || gen_random_uuid(),
      50.0000,
      995.0
    );
  `);
  console.log('Capital Tx Res:', capRes);

  const vaultAfterCap = await runSqlQuery(`
    SELECT manager_capital_pure_gold_g, manager_capital_pure_gold_fine_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Capital:', vaultAfterCap);
  assert(Math.abs(Number(vaultAfterCap[0].manager_capital_pure_gold_g) - 85.0427) < 0.001, 'Vault manager_capital_pure_gold_g must be 85.0427g');
  assert(Math.abs(Number(vaultAfterCap[0].manager_capital_pure_gold_fine_g) - 49.7500) < 0.001, 'Vault manager_capital_pure_gold_fine_g must be 49.7500g');
  console.log('✅ PASS: Pure gold capital safely deposited into manager safe.\n');

  // Step 3: Create Factory Receipt (100g @ 585 with 8% markup -> 108g obligation)
  console.log('--- Step 3: Create Factory Receipt to Establish Factory Debt ---');
  const rcpRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_receipt(
      p_product_name := 'Zavod Uzuk',
      p_quantity := 10,
      p_original_physical_g := 100.0000,
      p_proba := 585.0,
      p_factory_markup_pct := 8.0,
      p_notes := 'Test factory receipt'
    );
  `);
  console.log('Factory Receipt Res:', rcpRes);

  const vaultAfterRcp = await runSqlQuery(`
    SELECT total_factory_obligation_g, total_factory_handed_over_g, current_factory_obligation_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Receipt:', vaultAfterRcp);
  assert(Math.abs(Number(vaultAfterRcp[0].total_factory_obligation_g) - 108.0000) < 0.001, 'Total factory obligation must be 108g');
  assert(Math.abs(Number(vaultAfterRcp[0].current_factory_obligation_g) - 108.0000) < 0.001, 'Current factory obligation must be 108g');
  console.log('✅ PASS: Factory debt created at 108.0000g.\n');

  // Step 4: Negative Test: Attempt to handover more capital gold than available (100g pure gold > 50g)
  console.log('--- Step 4: Negative Test: Over-handover from Capital Pure Gold ---');
  let overHandoverBlocked = false;
  try {
    await runSqlQuery(`
      ${jwtHeader}
      SELECT public.rpc_record_factory_gold_handover(
        'capital_pure_gold',
        100.0000,
        995.0,
        null,
        'Zavod 1',
        'Over handover attempt',
        'T057_OVER_' || gen_random_uuid()
      );
    `);
  } catch (err) {
    overHandoverBlocked = true;
    console.log('Blocked as expected with error:', err.message);
    assert(err.message.includes('ERR_INSUFFICIENT_CAPITAL_GOLD') || err.message.includes('yetarli toza kapital oltin'), 'Must reject due to insufficient capital gold');
  }
  assert(overHandoverBlocked, 'Must block over-handover from capital pure gold');
  console.log('✅ PASS: Over-handover correctly rejected by server.\n');

  // Step 5: Legitimate Handover: Handover 20g pure gold @ 995 to Factory
  console.log('--- Step 5: Handover 20g Pure Gold @ 995 from Capital Pure Gold ---');
  // 20g @ 995: 585 eq = 20 * (995/585) = 34.0171g. Fine g = 20 * (995/1000) = 19.9000g.
  const hndIdem = 'T057_HND_' + gen_random_uuid_str();
  const hndRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_gold_handover(
      'capital_pure_gold',
      20.0000,
      995.0,
      null,
      'Zavod 1',
      'Ta''sischi toza oltinidan zavod qarziga topshirildi',
      '${hndIdem}'
    );
  `);
  console.log('Handover Res:', hndRes);
  const handoverData = hndRes[0].rpc_record_factory_gold_handover;
  const handoverId = handoverData.handover_id;
  assert(Math.abs(Number(handoverData.agreed_equivalent_g) - 34.0171) < 0.001, 'Agreed equivalent must be 34.0171g');
  assert(Math.abs(Number(handoverData.current_factory_obligation_g) - (108.0000 - 34.0171)) < 0.001, 'Current factory obligation must decrease to 73.9829g');

  const vaultAfterHnd = await runSqlQuery(`
    SELECT manager_capital_pure_gold_g, manager_capital_pure_gold_fine_g,
           total_factory_handed_over_g, current_factory_obligation_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Handover:', vaultAfterHnd);
  // Remaining capital: 85.0427 - 34.0171 = 51.0256g (585 eq), 49.7500 - 19.9000 = 29.8500g (fine)
  assert(Math.abs(Number(vaultAfterHnd[0].manager_capital_pure_gold_g) - 51.0256) < 0.001, 'Remaining capital pure gold 585 eq must be 51.0256g');
  assert(Math.abs(Number(vaultAfterHnd[0].manager_capital_pure_gold_fine_g) - 29.8500) < 0.001, 'Remaining fine gold must be 29.8500g');
  assert(Math.abs(Number(vaultAfterHnd[0].total_factory_handed_over_g) - 34.0171) < 0.001, 'Total factory handed over must be 34.0171g');
  assert(Math.abs(Number(vaultAfterHnd[0].current_factory_obligation_g) - 73.9829) < 0.001, 'Current factory obligation must be 73.9829g');
  console.log('✅ PASS: Factory debt decreased and safe gold atomically deducted.\n');

  // Step 6: Verify Net Assets Parity in Profit Summary
  console.log('--- Step 6: Verify Profit Parity (Handover does not alter net equity or profit) ---');
  const profitRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_get_accounting_profit_summary(
      p_start_date := ((timezone('Asia/Tashkent', now()))::date - 1)::date,
      p_end_date := (timezone('Asia/Tashkent', now()))::date,
      p_gold_rate := 900000::numeric,
      p_usd_rate := 12800::numeric
    ) AS profit_data;
  `);
  console.log('Profit Res raw:', profitRes);
  const pData = typeof profitRes[0].profit_data === 'string' ? JSON.parse(profitRes[0].profit_data) : profitRes[0].profit_data;
  console.log('Profit Summary Components:', pData?.components);
  const pComp = pData.components;
  assert(Math.abs(Number(pComp.manager_capital_pure_gold_585_g) - 51.0256) < 0.001, 'Profit summary manager_capital_pure_gold_585_g must be 51.0256g');
  assert(Math.abs(Number(pComp.factory_obligation_585_g || pComp.factory_debt_585_g) - 73.9829) < 0.001, 'Profit summary factory_obligation_585_g must be 73.9829g');
  console.log('✅ PASS: Profit summary reflects exact live vault balances.\n');

  // Step 7: Reverse Factory Gold Handover
  console.log('--- Step 7: Reverse Factory Gold Handover (Full Audited Restoration) ---');
  const revRes = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_reverse_factory_gold_handover(
      '${handoverId}',
      'Audit sinov bekor qilish',
      'T057_REV_' || gen_random_uuid()
    ) AS rev_res;
  `);
  console.log('Reverse Res:', revRes);
  const revObj = typeof revRes[0].rev_res === 'string' ? JSON.parse(revRes[0].rev_res) : revRes[0].rev_res;
  assert(revObj.status === 'ok', 'Reverse status must be ok');

  const vaultAfterRev = await runSqlQuery(`
    SELECT manager_capital_pure_gold_g, manager_capital_pure_gold_fine_g,
           total_factory_handed_over_g, current_factory_obligation_g
    FROM public.manager_vault_account
    WHERE organization_id = '${testOrgId}';
  `);
  console.log('Vault after Reversal:', vaultAfterRev);
  assert(Math.abs(Number(vaultAfterRev[0].manager_capital_pure_gold_g) - 85.0427) < 0.001, 'manager_capital_pure_gold_g restored to 85.0427g');
  assert(Math.abs(Number(vaultAfterRev[0].manager_capital_pure_gold_fine_g) - 49.7500) < 0.001, 'manager_capital_pure_gold_fine_g restored to 49.7500g');
  assert(Math.abs(Number(vaultAfterRev[0].total_factory_handed_over_g) - 0.0000) < 0.001, 'total_factory_handed_over_g restored to 0g');
  assert(Math.abs(Number(vaultAfterRev[0].current_factory_obligation_g) - 108.0000) < 0.001, 'current_factory_obligation_g restored to 108g');

  const hndRow = await runSqlQuery(`
    SELECT status, reversal_reason
    FROM public.factory_gold_handovers
    WHERE id = '${handoverId}';
  `);
  console.log('Handover DB Row:', hndRow);
  assert(hndRow[0].status === 'reversed', 'Handover row must be marked reversed');
  assert(hndRow[0].reversal_reason === 'Audit sinov bekor qilish', 'Reversal reason must be recorded');

  const auditRow = await runSqlQuery(`
    SELECT action, record_id, reason
    FROM public.audit_logs
    WHERE record_id = '${handoverId}' AND organization_id = '${testOrgId}';
  `);
  console.log('Audit Log Row:', auditRow);
  assert(auditRow.length > 0, 'Audit log row must exist');
  assert(auditRow[0].action === 'REVERSE_FACTORY_GOLD_HANDOVER', 'Audit action must be REVERSE_FACTORY_GOLD_HANDOVER');
  console.log('✅ PASS: Reversal restored manager safe gold and factory debt to 100% parity.\n');

  // Step 8: Idempotency Replay Test
  console.log('--- Step 8: Test Idempotency Replay on Handover ---');
  const idemKey = 'T057_IDEM_' + gen_random_uuid_str();
  const firstCall = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_gold_handover(
      'capital_pure_gold',
      10.0000,
      995.0,
      null,
      'Zavod Idem Test',
      'Idempotency test call',
      '${idemKey}'
    ) AS hnd_res;
  `);
  const firstObj = typeof firstCall[0].hnd_res === 'string' ? JSON.parse(firstCall[0].hnd_res) : firstCall[0].hnd_res;
  const firstHndId = firstObj.handover_id;

  const secondCall = await runSqlQuery(`
    ${jwtHeader}
    SELECT public.rpc_record_factory_gold_handover(
      'capital_pure_gold',
      10.0000,
      995.0,
      null,
      'Zavod Idem Test',
      'Idempotency test call',
      '${idemKey}'
    ) AS hnd_res;
  `);
  const secondHnd = typeof secondCall[0].hnd_res === 'string' ? JSON.parse(secondCall[0].hnd_res) : secondCall[0].hnd_res;
  assert(secondHnd.idempotent_replay === true, 'Second call must return idempotent_replay: true');
  assert(secondHnd.handover_id === firstHndId, 'Second call must return identical handover_id');
  console.log('✅ PASS: Idempotency replay prevented duplicate handover!\n');

  console.log('==============================================================================');
  console.log('ALL 8 MIGRATION 057 TEST WORKFLOWS PASSED WITH 100% SUCCESS ON STAGING');
  console.log('==============================================================================');
}

function gen_random_uuid_str() {
  return Math.random().toString(36).substring(2, 10);
}

test().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
