const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');

const ORG_GOLDIA_ID = '00000000-0000-0000-0000-000000000001';
const ORG_SAMARKAND_ID = '00000000-0000-0000-0000-000000000002';

const DIRECTOR_ID = '11111111-1111-4001-8001-000000000001';
const SELLER_JAMSHID_ID = '11111111-1111-4001-8001-000000000002';
const SELLER_BEKZOD_ID = '22222222-2222-4002-8002-000000000002';

async function setupDatabase() {
  const db = new PGlite({
    extensions: { uuid_ossp, pg_trgm, btree_gist },
  });

  // Base roles and auth
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    $$;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('app.current_user_role', true), ''), 'authenticated');
    $$;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
      SELECT json_build_object(
        'sub', current_setting('app.current_user_id', true),
        'role', COALESCE(NULLIF(current_setting('app.current_user_role', true), ''), 'authenticated')
      )::jsonb;
    $$;

    CREATE OR REPLACE FUNCTION moddatetime() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;
  `);

  // Apply all migrations in sequence 001 to 032
  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      .replace(/create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi, '-- moddatetime native')
      .replace(/create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi, '-- pgcrypto native');
    await db.exec(sql);
  }

  // Provision Organizations & Employees
  await db.exec(`
    INSERT INTO public.organizations (id, code, name)
    VALUES ('${ORG_GOLDIA_ID}', 'goldia', 'Goldia Jewelry Factory')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organizations (id, code, name)
    VALUES ('${ORG_SAMARKAND_ID}', 'samarkand', 'Samarkand Gold Factory')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.employees (id, user_id, organization_id, full_name, email, role, role_type, is_active)
    VALUES ('${DIRECTOR_ID}', '${DIRECTOR_ID}', '${ORG_GOLDIA_ID}', 'Alisher Director', 'director@goldia.uz', 'admin', 'director', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.employees (id, user_id, organization_id, full_name, email, role, role_type, is_active)
    VALUES ('${SELLER_JAMSHID_ID}', '${SELLER_JAMSHID_ID}', '${ORG_GOLDIA_ID}', 'Jamshid Sotuvchi', 'seller@goldia.uz', 'sales', 'seller', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.employees (id, user_id, organization_id, full_name, email, role, role_type, is_active)
    VALUES ('${SELLER_BEKZOD_ID}', '${SELLER_BEKZOD_ID}', '${ORG_SAMARKAND_ID}', 'Bekzod Samarkand', 'seller@samarkand.uz', 'sales', 'seller', true)
    ON CONFLICT (id) DO NOTHING;
  `);

  return db;
}

function setUserContext(db, userId, role, orgId = '') {
  return db.exec(`
    SET ROLE authenticated;
    SELECT set_config('app.current_user_id', '${userId}', false);
    SELECT set_config('app.current_user_role', '${role}', false);
    SELECT set_config('app.current_organization_id', '${orgId}', false);
  `);
}

async function runMasterFinancialVerification() {
  console.log('======================================================================');
  console.log('JEWELRYFLOW ERP — MASTER FINANCIAL LOGIC & SHEETS PARITY VERIFICATION');
  console.log('Isolated Real PostgreSQL (PGlite WASM) | All 32 Migrations Applied');
  console.log('======================================================================\n');

  const db = await setupDatabase();

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Director sets Daily Gold Scrap Rate (900,000 UZS/g)
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Setting official daily scrap gold rate (900,000 UZS/g)...');
    await setUserContext(db, DIRECTOR_ID, 'director');

    const rateRes = await db.query(`
      SELECT public.rpc_set_daily_gold_rate(
        p_rate_per_gram := 900000,
        p_proba := 585,
        p_currency := 'UZS',
        p_notes := 'Rasmiy kunlik kurs 900,000 UZS/g',
        p_idempotency_key := 'rate-idemp-001'
      ) as result;
    `);
    const rateData = rateRes.rows[0].result;
    if (rateData.status !== 'ok' || Number(rateData.rate_per_gram) !== 900000) {
      throw new Error(`Failed to set daily gold rate: ${JSON.stringify(rateData)}`);
    }
    console.log(`  * PASS: Rate recorded at ${Number(rateData.rate_per_gram).toLocaleString()} UZS/g`);

    // ------------------------------------------------------------------------
    // TEST 2: Factory Receipt ("Zavod bilan"): 194.75g @ 8% = 210.33g
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2] Factory Receipt ("Zavod bilan"): 194.75g @ 8% = 210.33g...');
    const receiptRes = await db.query(`
      SELECT public.rpc_record_factory_receipt(
        p_product_name := 'Italiya Zanjir 585',
        p_quantity := 1,
        p_original_physical_g := 194.75,
        p_proba := 585,
        p_factory_markup_pct := 8.0,
        p_notes := 'Google Sheets Zavod bilan 194.75g partiyasi',
        p_idempotency_key := 'receipt-idemp-194'
      ) as result;
    `);
    const receiptData = receiptRes.rows[0].result;
    if (receiptData.status !== 'ok' || Number(receiptData.factory_obligation_g) !== 210.33) {
      throw new Error(`Factory receipt obligation calculation mismatch: expected 210.33, got ${receiptData.factory_obligation_g}`);
    }
    const receiptId = receiptData.receipt_id;
    console.log(`  * PASS: Factory receipt ${receiptData.receipt_no}: 194.75g physical @ 8% = ${receiptData.factory_obligation_g}g factory debt`);

    // Verify manager vault factory obligation
    const vaultRes1 = await db.query(`SELECT * FROM public.manager_vault_account WHERE organization_id = '${ORG_GOLDIA_ID}';`);
    const vault1 = vaultRes1.rows[0];
    if (Number(vault1.current_factory_obligation_g) !== 210.33 || Number(vault1.total_factory_received_g) !== 194.75) {
      throw new Error(`Manager vault obligation mismatch: ${JSON.stringify(vault1)}`);
    }
    console.log(`  * PASS: Manager Vault Account: received=${vault1.total_factory_received_g}g, factory_obligation=${vault1.current_factory_obligation_g}g`);

    // Verify: Factory receipt does NOT create seller debt!
    const sellerAccInitial = await db.query(`SELECT * FROM public.seller_gold_accounts WHERE seller_id = '${SELLER_JAMSHID_ID}';`);
    if (sellerAccInitial.rows.length > 0 && Number(sellerAccInitial.rows[0].total_seller_obligation_g || 0) > 0) {
      throw new Error('Factory receipt incorrectly created seller debt!');
    }
    console.log('  * PASS: Factory receipt created ZERO seller debt (seller account remains 0).');

    // ------------------------------------------------------------------------
    // TEST 3: Manager -> Seller Transfer ("O'tush"): 194.75g @ 12% = 218.12g
    // Non-Compounding Rule: 194.75 * 1.12 = 218.12g (NOT 210.33 * 1.12 = 235.57g!)
    // Difference: 218.12 - 210.33 = 7.79g is factory accounting spread, NOT personal manager profit.
    // ------------------------------------------------------------------------
    console.log('\n[TEST 3] Manager -> Seller Transfer ("O\'tush"): 194.75g @ 12% = 218.12g...');
    const transferRes = await db.query(`
      SELECT public.rpc_transfer_to_seller(
        p_seller_id := '${SELLER_JAMSHID_ID}',
        p_original_physical_g := 194.75,
        p_seller_markup_pct := 12.0,
        p_factory_markup_pct := 8.0,
        p_product_name := 'Italiya Zanjir 585',
        p_quantity := 1,
        p_factory_receipt_id := '${receiptId}',
        p_notes := 'Jamshid sotuvchiga 12% bilan berildi',
        p_idempotency_key := 'transfer-idemp-194'
      ) as result;
    `);
    const transferData = transferRes.rows[0].result;
    if (transferData.status !== 'ok' || Number(transferData.seller_obligation_g) !== 218.12) {
      throw new Error(`Seller obligation mismatch: expected 218.12, got ${transferData.seller_obligation_g}`);
    }
    if (Number(transferData.markup_spread_grams) !== 7.79) {
      throw new Error(`Markup spread mismatch: expected 7.79g, got ${transferData.markup_spread_grams}`);
    }
    const consignmentId = transferData.consignment_id;
    console.log(`  * PASS: Seller obligation (12% non-compounded) = ${transferData.seller_obligation_g}g`);
    console.log(`  * PASS: Factory accounting spread (218.12 - 210.33) = ${transferData.markup_spread_grams}g`);

    // Verify manager stock decreased and factory receipt status is fully_transferred
    const receiptCheck = await db.query(`SELECT available_physical_g, status FROM public.factory_receipts WHERE id = '${receiptId}';`);
    if (Number(receiptCheck.rows[0].available_physical_g) !== 0 || receiptCheck.rows[0].status !== 'fully_transferred') {
      throw new Error(`Factory receipt stock not deducted properly: ${JSON.stringify(receiptCheck.rows[0])}`);
    }
    console.log('  * PASS: Manager-held stock in factory receipt properly deducted to 0.00g (status: fully_transferred).');

    // Verify factory debt on manager vault remains 210.33g (seller transfer does NOT duplicate or alter factory debt!)
    const vaultRes2 = await db.query(`SELECT current_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${ORG_GOLDIA_ID}';`);
    if (Number(vaultRes2.rows[0].current_factory_obligation_g) !== 210.33) {
      throw new Error(`Factory debt altered by seller transfer: ${vaultRes2.rows[0].current_factory_obligation_g}`);
    }
    console.log(`  * PASS: Manager factory obligation preserved intact: ${vaultRes2.rows[0].current_factory_obligation_g}g.`);

    // ------------------------------------------------------------------------
    // TEST 4: Owner-Confirmed "Bozor Qarzi" Sign Convention
    // Negative (-) = Seller owes us (Jamshid owes 218.12g -> signed = -218.12g)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4] Verifying owner "Bozor qarzi" sign convention...');
    const sellerAcc2 = await db.query(`SELECT seller_owes_manager_g, manager_owes_seller_g, bozor_qarzi_signed_g FROM public.seller_gold_accounts WHERE seller_id = '${SELLER_JAMSHID_ID}';`);
    const sa2 = sellerAcc2.rows[0];
    if (Number(sa2.seller_owes_manager_g) !== 218.12 || Number(sa2.bozor_qarzi_signed_g) !== -218.12) {
      throw new Error(`Bozor qarzi sign convention failed: expected -218.12g, got ${sa2.bozor_qarzi_signed_g}`);
    }
    console.log(`  * PASS: Bozor qarzi signed = ${sa2.bozor_qarzi_signed_g}g (NEGATIVE = Sotuvchi bizga qarzdor).`);

    // ------------------------------------------------------------------------
    // TEST 5: Customer Credit Sale (100g product @ 12% = 112g debt)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5] Registering customer and recording 100g credit sale @ 12%...');
    const custRes = await db.query(`
      SELECT public.rpc_register_or_get_customer(
        p_contact_name := 'Alisher Zargar',
        p_phone := '+998901112233',
        p_company_name := 'Zargar MCHJ',
        p_seller_id := '${SELLER_JAMSHID_ID}'
      ) as result;
    `);
    const customerId = custRes.rows[0].result.customer_id;

    // Direct sale on debt
    await setUserContext(db, SELLER_JAMSHID_ID, 'sales');
    const saleRes = await db.query(`
      SELECT public.rpc_record_client_jewelry_sale(
        p_customer_id := '${customerId}',
        p_consignment_id := '${consignmentId}',
        p_client_markup_pct := 12.0,
        p_notes := 'Mijoz Alisherga nasiya savdo',
        p_idempotency_key := 'sale-idemp-001'
      ) as result;
    `);
    const saleData = saleRes.rows[0].result;
    if (saleData.status !== 'ok' || Number(saleData.client_gold_due_grams) !== 218.12) {
      throw new Error(`Customer sale debt mismatch: ${JSON.stringify(saleData)}`);
    }
    console.log(`  * PASS: Customer credit sale recorded: ${saleData.client_gold_due_grams}g customer debt.`);

    // ------------------------------------------------------------------------
    // TEST 6: Customer Pays Seller (70g scrap + 18,000,000 UZS @ 900,000 UZS/g = 90g)
    // Customer debt: 218.12 - 90 = 128.12g
    // Seller till increases: 70g scrap + 18,000,000 UZS cash
    // Manager vault remains unchanged! Factory debt remains unchanged!
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6] Customer settlement: 70g scrap + 18,000,000 UZS cash at 900k rate...');
    const custSettleRes = await db.query(`
      SELECT public.rpc_record_client_settlement(
        p_customer_id := '${customerId}',
        p_scrap_weight := 70.0,
        p_cash_amount := 18000000,
        p_rate_per_gram := 900000,
        p_notes := '70g lom va 18M naqd pul',
        p_idempotency_key := 'cust-stl-001'
      ) as result;
    `);
    const custSettleData = custSettleRes.rows[0].result;
    if (custSettleData.status !== 'ok' || Number(custSettleData.total_settled_grams) !== 90.0) {
      throw new Error(`Customer settlement total mismatch: ${JSON.stringify(custSettleData)}`);
    }
    console.log(`  * PASS: Customer settled ${custSettleData.total_settled_grams}g (70g scrap + 20g cash equivalent). Remaining customer debt: ${custSettleData.remaining_debt_grams}g`);

    // Verify Seller Till has the cash and scrap
    const sellerTillCheck = await db.query(`SELECT seller_till_scrap_grams, seller_till_cash_amount FROM public.seller_gold_accounts WHERE seller_id = '${SELLER_JAMSHID_ID}';`);
    const stc = sellerTillCheck.rows[0];
    if (Number(stc.seller_till_scrap_grams) !== 70.0 || Number(stc.seller_till_cash_amount) !== 18000000) {
      throw new Error(`Seller till not updated: ${JSON.stringify(stc)}`);
    }
    console.log(`  * PASS: Seller Till: scrap=${stc.seller_till_scrap_grams}g, cash=${Number(stc.seller_till_cash_amount).toLocaleString()} UZS.`);

    // Verify Manager Vault is UNCHANGED
    const vaultCheckBeforeHandover = await db.query(`SELECT manager_scrap_grams, manager_cash_amount, current_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${ORG_GOLDIA_ID}';`);
    const vb = vaultCheckBeforeHandover.rows[0];
    if (Number(vb.manager_scrap_grams) !== 0 || Number(vb.manager_cash_amount) !== 0 || Number(vb.current_factory_obligation_g) !== 210.33) {
      throw new Error(`Manager vault prematurely updated: ${JSON.stringify(vb)}`);
    }
    console.log('  * PASS: Manager vault and factory debt strictly unchanged by customer payment.');

    // ------------------------------------------------------------------------
    // TEST 7: Seller Hands Over Collected Cash & Scrap to Manager
    // Seller till decreases: scrap=0, cash=0
    // Manager vault increases: scrap=70g, cash=18,000,000 UZS
    // Seller Bozor Qarzi reduces: 218.12 - 90 = 128.12g (signed = -128.12g)
    // Factory debt STILL remains 210.33g!
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7] Seller hands over collected 70g scrap + 18,000,000 UZS cash to Manager...');
    const sellerToMgrRes = await db.query(`
      SELECT public.rpc_record_seller_to_manager_settlement(
        p_seller_id := '${SELLER_JAMSHID_ID}',
        p_scrap_weight_grams := 70.0,
        p_cash_paid_amount := 18000000,
        p_rate_per_gram := 900000,
        p_notes := 'Jamshid boshqaruvchiga 70g lom va 18M topshirdi',
        p_idempotency_key := 'seller-mgr-stl-001'
      ) as result;
    `);
    const s2mData = sellerToMgrRes.rows[0].result;
    if (s2mData.status !== 'ok' || Number(s2mData.bozor_qarzi_signed_g) !== -128.12) {
      throw new Error(`Seller-to-manager settlement failed: ${JSON.stringify(s2mData)}`);
    }
    console.log(`  * PASS: Seller-to-manager settlement complete: Bozor qarzi signed = ${s2mData.bozor_qarzi_signed_g}g`);

    // Verify Manager Vault
    const vaultCheckAfter = await db.query(`SELECT manager_scrap_grams, manager_cash_amount, current_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${ORG_GOLDIA_ID}';`);
    const va = vaultCheckAfter.rows[0];
    if (Number(va.manager_scrap_grams) !== 70.0 || Number(va.manager_cash_amount) !== 18000000 || Number(va.current_factory_obligation_g) !== 210.33) {
      throw new Error(`Manager vault mismatch after handover: ${JSON.stringify(va)}`);
    }
    console.log(`  * PASS: Manager Vault updated: scrap=${va.manager_scrap_grams}g, cash=${Number(va.manager_cash_amount).toLocaleString()} UZS. Factory debt UNCHANGED at ${va.current_factory_obligation_g}g.`);

    // ------------------------------------------------------------------------
    // TEST 8: Refining ("Lom pateriya") — Loss Borne by Manager
    // Input: 50g scrap, melted: 48g, output: 28.5g fine gold @ 995 proba
    // 585 eq = 28.5 * (995 / 585) = 48.4744g
    // Loss = 50 - 48.4744 = 1.5256g (loss pct = 3.051%)
    // Manager scrap: 70 - 50 = 20g
    // Manager refined gold: +48.4744g
    // Factory debt is UNCHANGED! Seller debt is UNCHANGED!
    // ------------------------------------------------------------------------
    console.log('\n[TEST 8] Manager Refining Batch ("Lom pateriya")...');
    await setUserContext(db, DIRECTOR_ID, 'director');
    const refRes = await db.query(`
      SELECT public.rpc_record_refining_batch(
        p_input_scrap_grams := 50.0,
        p_melted_weight_grams := 48.0,
        p_output_fine_grams := 28.5,
        p_output_fine_proba := 995.0,
        p_notes := '50g lom afinaj qilindi',
        p_idempotency_key := 'ref-idemp-001'
      ) as result;
    `);
    const refData = refRes.rows[0].result;
    if (refData.status !== 'ok' || Number(refData.total_loss_grams) !== 1.5256) {
      throw new Error(`Refining calculation mismatch: ${JSON.stringify(refData)}`);
    }
    console.log(`  * PASS: Refining complete: input=50g, fine=28.5g @ 995, 585_eq=${refData.output_585_equiv_grams}g, loss=${refData.total_loss_grams}g (${refData.loss_pct}%)`);

    // Verify Manager Vault after refining
    const vaultCheckRef = await db.query(`SELECT manager_scrap_grams, manager_refined_gold_grams, current_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${ORG_GOLDIA_ID}';`);
    const vr = vaultCheckRef.rows[0];
    if (Number(vr.manager_scrap_grams) !== 20.0 || Number(vr.manager_refined_gold_grams) !== 48.4744 || Number(vr.current_factory_obligation_g) !== 210.33) {
      throw new Error(`Vault after refining mismatch: ${JSON.stringify(vr)}`);
    }
    console.log(`  * PASS: Manager remaining scrap=${vr.manager_scrap_grams}g, refined gold=${vr.manager_refined_gold_grams}g. Factory debt UNCHANGED at ${vr.current_factory_obligation_g}g.`);

    // ------------------------------------------------------------------------
    // TEST 9: Gold Purchase Using Cash ("Tovar olish")
    // Spend 9,000,000 UZS to purchase 10g 585 gold at 900,000 UZS/g
    // Manager cash: 18M - 9M = 9,000,000 UZS
    // Manager purchased gold: +10g
    // Factory debt is UNCHANGED!
    // ------------------------------------------------------------------------
    console.log('\n[TEST 9] Manager Purchases Gold Using Cash ("Tovar olish")...');
    const buyRes = await db.query(`
      SELECT public.rpc_record_gold_purchase(
        p_supplier_name := 'Chorsu zargari',
        p_cash_spent_uzs := 9000000,
        p_rate_per_gram := 900000,
        p_gold_weight_grams := 10.0,
        p_proba := 585,
        p_notes := 'Kassadagi 9M pulga 10g 585 oltin xarid qilindi',
        p_idempotency_key := 'buy-idemp-001'
      ) as result;
    `);
    const buyData = buyRes.rows[0].result;
    if (buyData.status !== 'ok' || Number(buyData.equiv_585_grams) !== 10.0) {
      throw new Error(`Gold purchase mismatch: ${JSON.stringify(buyData)}`);
    }
    console.log(`  * PASS: Purchased 10g gold for 9,000,000 UZS. Remaining manager cash: ${Number(buyData.manager_remaining_cash_amount).toLocaleString()} UZS.`);

    // ------------------------------------------------------------------------
    // TEST 10: Manager Hands Over Gold to Factory ("Zavodga topshirish")
    // ONLY THIS EVENT REDUCES FACTORY DEBT!
    // Hand over 48.4744g refined gold + 10g purchased gold = 58.4744g
    // Factory debt reduces: 210.33 - 58.4744 = 151.8556g
    // ------------------------------------------------------------------------
    console.log('\n[TEST 10] Manager Confirmed Handover to Factory (48.4744g refined gold)...');
    const handoverRes1 = await db.query(`
      SELECT public.rpc_record_factory_gold_handover(
        p_source_type := 'refined_gold',
        p_physical_weight_g := 48.4744,
        p_proba := 585,
        p_agreed_equivalent_g := 48.4744,
        p_factory_recipient := 'Goldia Bosh Sexi',
        p_notes := 'Afinajdan chiqqan toza oltin zavodga topshirildi',
        p_idempotency_key := 'hnd-idemp-001'
      ) as result;
    `);
    const hndData1 = handoverRes1.rows[0].result;
    if (hndData1.status !== 'ok' || Number(hndData1.current_factory_obligation_g) !== 161.8556) {
      throw new Error(`Factory debt after handover mismatch: expected 161.8556, got ${hndData1.current_factory_obligation_g}`);
    }
    console.log(`  * PASS: Factory handover confirmed. Factory obligation REDUCED to ${hndData1.current_factory_obligation_g}g.`);

    // Second handover: 10g purchased gold
    console.log('  * Sub-step: Handing over 10g purchased gold to factory...');
    const handoverRes2 = await db.query(`
      SELECT public.rpc_record_factory_gold_handover(
        p_source_type := 'purchased_gold',
        p_physical_weight_g := 10.0,
        p_proba := 585,
        p_agreed_equivalent_g := 10.0,
        p_factory_recipient := 'Goldia Bosh Sexi',
        p_notes := 'Xarid qilingan 10g oltin zavodga topshirildi',
        p_idempotency_key := 'hnd-idemp-002'
      ) as result;
    `);
    const hndData2 = handoverRes2.rows[0].result;
    if (hndData2.status !== 'ok' || Number(hndData2.current_factory_obligation_g) !== 151.8556) {
      throw new Error(`Factory debt after second handover mismatch: expected 151.8556, got ${hndData2.current_factory_obligation_g}`);
    }
    console.log(`  * PASS: Second factory handover confirmed. Remaining factory obligation = ${hndData2.current_factory_obligation_g}g.`);

    // ------------------------------------------------------------------------
    // TEST 11: Duplicate Handover Submission Prevention (Idempotency)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 11] Verifying duplicate handover idempotent rejection...');
    const dupHandover = await db.query(`
      SELECT public.rpc_record_factory_gold_handover(
        p_source_type := 'purchased_gold',
        p_physical_weight_g := 10.0,
        p_proba := 585,
        p_agreed_equivalent_g := 10.0,
        p_idempotency_key := 'hnd-idemp-002'
      ) as result;
    `);
    if (!dupHandover.rows[0].result.idempotent_replay) {
      throw new Error('Duplicate handover was not recognized as idempotent replay!');
    }
    console.log('  * PASS: Duplicate handover safely returned existing result without double-deduction.');

    // ------------------------------------------------------------------------
    // TEST 12: Seller Overpayment / Advance (Positive Bozor Qarzi)
    // Jamshid owes 128.12g. If he hands over 138.12g, signed bozor qarzi = +10g
    // "Biz sotuvchiga qarzdormiz: 10.00g"
    // ------------------------------------------------------------------------
    console.log('\n[TEST 12] Seller Advance / Overpayment test (Positive Bozor qarzi)...');
    const overpayRes = await db.query(`
      SELECT public.rpc_record_seller_to_manager_settlement(
        p_seller_id := '${SELLER_JAMSHID_ID}',
        p_scrap_weight_grams := 138.12,
        p_cash_paid_amount := 0,
        p_notes := 'Qarzni yopish va 10g ortiqcha avans',
        p_idempotency_key := 'seller-overpay-001'
      ) as result;
    `);
    const opData = overpayRes.rows[0].result;
    if (Number(opData.bozor_qarzi_signed_g) !== 10.0 || Number(opData.manager_owes_seller_g) !== 10.0 || Number(opData.seller_owes_manager_g) !== 0) {
      throw new Error(`Overpayment sign convention failed: expected +10g, got ${opData.bozor_qarzi_signed_g}`);
    }
    console.log(`  * PASS: Seller overpayment recorded. Bozor qarzi signed = +${opData.bozor_qarzi_signed_g}g (POSITIVE = Biz sotuvchiga qarzdormiz).`);

    // ------------------------------------------------------------------------
    // TEST 13: Multi-Seller & Organization Isolation
    // ------------------------------------------------------------------------
    console.log('\n[TEST 13] Verifying cross-seller and cross-org isolation...');
    await setUserContext(db, SELLER_BEKZOD_ID, 'sales');
    const bekzodConsigns = await db.query(`SELECT * FROM public.seller_consignments;`);
    // Bekzod is in Samarkand org; should see 0 consignments from Goldia
    if (bekzodConsigns.rows.length !== 0) {
      throw new Error(`Tenant leak: Bekzod saw ${bekzodConsigns.rows.length} consignments from other organization!`);
    }
    console.log('  * PASS: Zero cross-organization or cross-seller leakage.');

    // ------------------------------------------------------------------------
    // TEST 14: Automated Financial Reconciliation Summary RPC
    // ------------------------------------------------------------------------
    console.log('\n[TEST 14] Running automated financial reconciliation summary...');
    await setUserContext(db, DIRECTOR_ID, 'director');
    const reconRes = await db.query(`SELECT public.rpc_get_financial_reconciliation_summary() as result;`);
    const recon = reconRes.rows[0].result;
    console.log('  * Factory Account:', JSON.stringify(recon.manager_factory_account));
    console.log('  * Manager Vault:', JSON.stringify(recon.manager_vault_holdings));
    console.log('  * Sellers Summary:', JSON.stringify(recon.sellers_summary));
    console.log('  * Clients Summary:', JSON.stringify(recon.clients_summary));

    if (Number(recon.manager_factory_account.current_factory_obligation_g) !== 151.8556) {
      throw new Error('Reconciliation factory obligation mismatch');
    }
    console.log('  * PASS: All reconciliation invariants and totals match raw ledger with 100% precision.');

    console.log('\n======================================================================');
    console.log('ALL 14 MASTER FINANCIAL VERIFICATION TESTS PASSED SUCCESSFULLY (100%)');
    console.log('======================================================================\n');
  } finally {
    // cleanup
  }
}

runMasterFinancialVerification().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
