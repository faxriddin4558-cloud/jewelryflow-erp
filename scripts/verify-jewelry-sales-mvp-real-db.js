const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');

const ORG_GOLDIA_ID = '00000000-0000-0000-0000-000000000001';
const ORG_SAMARKAND_ID = '00000000-0000-0000-0000-000000000002';

const DIRECTOR_ID = '11111111-1111-4001-8001-000000000001';
const SELLER_ID = '11111111-1111-4001-8001-000000000002';
const SELLER_B_ID = '22222222-2222-4002-8002-000000000002';

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

  // Apply all migrations 001 - 026
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
    VALUES ('${SELLER_ID}', '${SELLER_ID}', '${ORG_GOLDIA_ID}', 'Jamshid Sotuvchi', 'seller@goldia.uz', 'sales', 'seller', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.employees (id, user_id, organization_id, full_name, email, role, role_type, is_active)
    VALUES ('${SELLER_B_ID}', '${SELLER_B_ID}', '${ORG_SAMARKAND_ID}', 'Bekzod Samarkand', 'seller@samarkand.uz', 'sales', 'seller', true)
    ON CONFLICT (id) DO NOTHING;
  `);

  return db;
}

function setUserContext(db, userId, role) {
  return db.exec(`
    SELECT set_config('app.current_user_id', '${userId}', false);
    SELECT set_config('app.current_user_role', '${role}', false);
  `);
}

async function runRealDbSalesVerification() {
  console.log('======================================================================');
  console.log('JEWELRYFLOW SALES MVP — REAL POSTGRESQL VERIFICATION (MIGRATION 26)');
  console.log('Engine: Isolated Disposable PGlite (Real PostgreSQL WASM)');
  console.log('======================================================================\n');

  const db = await setupDatabase();

  try {
    // ------------------------------------------------------------------------
    // STEP 1: Director sets Daily Gold Scrap Rate
    // ------------------------------------------------------------------------
    console.log('[STEP 1] Director sets daily gold scrap rate (900,000 UZS/g)...');
    await setUserContext(db, DIRECTOR_ID, 'director');

    const rateRes = await db.query(`
      SELECT public.rpc_set_daily_gold_rate(
        p_rate_per_gram := 900000,
        p_proba := 585,
        p_currency := 'UZS',
        p_notes := 'Kunlik rasmiy kurs (900k)',
        p_idempotency_key := 'idemp-rate-001'
      ) as result;
    `);
    const rateData = rateRes.rows[0].result;
    if (rateData.status !== 'ok' || Number(rateData.rate_per_gram) !== 900000) {
      throw new Error(`Failed to set daily rate: ${JSON.stringify(rateData)}`);
    }
    console.log(`  * Confirmed rate: 585 proba = ${Number(rateData.rate_per_gram).toLocaleString()} UZS/g`);

    // ------------------------------------------------------------------------
    // STEP 2: Register Customer with Permanent ID and Unique Code
    // ------------------------------------------------------------------------
    console.log('\n[STEP 2] Registering customer with permanent ID...');
    const custRes = await db.query(`
      SELECT public.rpc_register_or_get_customer(
        p_contact_name := 'Bekzod Zargar',
        p_phone := '+998901234567',
        p_company_name := 'Bekzod Savdo MCHJ',
        p_seller_id := '${SELLER_ID}'
      ) as result;
    `);
    const custData = custRes.rows[0].result;
    const customerId = custData.customer_id;
    if (!customerId || !custData.customer_code.startsWith('CUST-')) {
      throw new Error(`Failed to register customer: ${JSON.stringify(custData)}`);
    }
    console.log(`  * Customer registered: ID ${customerId}, Code: ${custData.customer_code}`);

    // ------------------------------------------------------------------------
    // STEP 3: Factory issues 100g product to Seller with 8% Factory Markup
    // ------------------------------------------------------------------------
    console.log('\n[STEP 3] Factory issues 100g product to Seller with 8% markup...');
    // Create finished jewelry product in vitrina
    const prodRes = await db.query(`
      INSERT INTO public.products (organization_id, name, category, proba, stock, quantity, weight)
      VALUES ('${ORG_GOLDIA_ID}', 'Zanjir Italiya 585', 'Zanjir', 585, 5, 5, 100.0000)
      RETURNING id;
    `);
    const productId = prodRes.rows[0].id;

    // Issue consignment
    const consignRes = await db.query(`
      SELECT public.rpc_issue_seller_consignment(
        p_seller_id := '${SELLER_ID}',
        p_product_id := '${productId}',
        p_quantity := 1,
        p_factory_markup_pct := 8.0,
        p_notes := '100g zanjir, zavod 8% bilan Jamshidga berildi',
        p_idempotency_key := 'idemp-consign-001'
      ) as result;
    `);
    const consignData = consignRes.rows[0].result;
    const consignmentId = consignData.consignment_id;
    if (consignData.status !== 'ok' || Number(consignData.factory_gold_due_grams) !== 108.0) {
      throw new Error(`Consignment issue failed: ${JSON.stringify(consignData)}`);
    }
    console.log(`  * Consignment issued: Base weight = 100.0000g, Factory Due (8%) = ${consignData.factory_gold_due_grams}g lom`);

    // Verify Seller's Factory Obligation
    const sellerAcc1 = await db.query(`SELECT current_factory_obligation_grams FROM public.seller_gold_accounts WHERE seller_id = '${SELLER_ID}';`);
    if (Number(sellerAcc1.rows[0].current_factory_obligation_grams) !== 108.0) {
      throw new Error(`Seller obligation mismatch: ${sellerAcc1.rows[0].current_factory_obligation_grams}`);
    }
    console.log(`  * Seller Factory Obligation: ${sellerAcc1.rows[0].current_factory_obligation_grams}g lom`);

    // ------------------------------------------------------------------------
    // STEP 4: Seller sells 100g product to Client with 12% Client Markup
    // ------------------------------------------------------------------------
    console.log('\n[STEP 4] Seller sells product to Client with 12% markup...');
    await setUserContext(db, SELLER_ID, 'sales');

    const saleRes = await db.query(`
      SELECT public.rpc_record_client_jewelry_sale(
        p_customer_id := '${customerId}',
        p_consignment_id := '${consignmentId}',
        p_client_markup_pct := 12.0,
        p_notes := 'Mijoz Bekzodga 12% bilan sotildi',
        p_idempotency_key := 'idemp-sale-001'
      ) as result;
    `);
    const saleData = saleRes.rows[0].result;
    const saleId = saleData.sale_id;
    if (saleData.status !== 'ok' || Number(saleData.client_gold_due_grams) !== 112.0) {
      throw new Error(`Client sale failed: ${JSON.stringify(saleData)}`);
    }
    console.log(`  * Client Sale recorded: ID ${saleId}`);
    console.log(`  * Client Initial Debt: ${saleData.client_gold_due_grams}g (100 * 1.12)`);
    console.log(`  * Markup Spread: ${saleData.markup_spread_grams}g (112 - 108)`);

    // Verify client running account
    const cliAcc1 = await db.query(`SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${customerId}';`);
    if (Number(cliAcc1.rows[0].current_debt_grams) !== 112.0) {
      throw new Error(`Client debt account mismatch: ${cliAcc1.rows[0].current_debt_grams}`);
    }
    console.log(`  * Client running debt verified: 112.0000g`);

    // ------------------------------------------------------------------------
    // STEP 5: Settlement — 70g Scrap + 18,000,000 UZS Cash (at 900,000 UZS/g)
    // ------------------------------------------------------------------------
    console.log('\n[STEP 5] Client settlement: 70g scrap + 18M UZS cash at 900k UZS/g...');
    const settlRes = await db.query(`
      SELECT public.rpc_record_client_settlement(
        p_customer_id := '${customerId}',
        p_sale_id := '${saleId}',
        p_scrap_weight := 70.0000,
        p_scrap_proba := 585,
        p_cash_amount := 18000000,
        p_rate_per_gram := 900000,
        p_notes := '70g lom va 18mln naqd pul tolandi',
        p_idempotency_key := 'idemp-settl-001'
      ) as result;
    `);
    const sData = settlRes.rows[0].result;
    if (sData.status !== 'ok') {
      throw new Error(`Settlement failed: ${JSON.stringify(sData)}`);
    }

    console.log(`  * Scrap paid: ${sData.scrap_weight_grams}g`);
    console.log(`  * Cash paid: ${Number(sData.cash_paid_amount).toLocaleString()} UZS`);
    console.log(`  * Cash equivalent: ${sData.cash_equivalent_grams}g (18,000,000 / 900,000 = 20g)`);
    console.log(`  * Total settled: ${sData.total_settled_grams}g (70 + 20 = 90g)`);
    console.log(`  * Remaining client debt: ${sData.remaining_debt_grams}g (112 - 90 = 22g)`);

    if (Number(sData.cash_equivalent_grams) !== 20.0 ||
        Number(sData.total_settled_grams) !== 90.0 ||
        Number(sData.remaining_debt_grams) !== 22.0) {
      throw new Error(`Mathematical mismatch in settlement: ${JSON.stringify(sData)}`);
    }
    console.log('  * [MATHEMATICAL PROOF] 112g - 90g = 22g EXACT MATCH!');

    // ------------------------------------------------------------------------
    // STEP 6: Verify Rule 5 — Seller Till Segregation vs Factory Obligation
    // ------------------------------------------------------------------------
    console.log('\n[STEP 6] Verifying Rule 5: Money & scrap enter Seller Till, Factory Obligation untouched...');
    const sellerAcc2 = await db.query(`
      SELECT current_factory_obligation_grams, seller_till_scrap_grams, seller_till_cash_amount
      FROM public.seller_gold_accounts WHERE seller_id = '${SELLER_ID}';
    `);
    const row2 = sellerAcc2.rows[0];
    console.log(`  * Seller till scrap: ${row2.seller_till_scrap_grams}g (Collected from client)`);
    console.log(`  * Seller till cash: ${Number(row2.seller_till_cash_amount).toLocaleString()} UZS (Collected from client)`);
    console.log(`  * Factory obligation still: ${row2.current_factory_obligation_grams}g (Untouched because not yet surrendered to factory!)`);

    if (Number(row2.seller_till_scrap_grams) !== 70.0 ||
        Number(row2.seller_till_cash_amount) !== 18000000 ||
        Number(row2.current_factory_obligation_grams) !== 108.0) {
      throw new Error(`Rule 5 segregation violated: ${JSON.stringify(row2)}`);
    }
    console.log('  * [RULE 5 PROOF] Segregation 100% verified: Factory obligation is still 108.0000g.');

    // ------------------------------------------------------------------------
    // STEP 7: Seller Surrenders collected payments to Factory (Seller -> Factory)
    // ------------------------------------------------------------------------
    console.log('\n[STEP 7] Seller surrenders collected 70g scrap + 18M UZS cash to Factory...');
    await setUserContext(db, DIRECTOR_ID, 'director');

    const surrRes = await db.query(`
      SELECT public.rpc_record_seller_to_factory_settlement(
        p_seller_id := '${SELLER_ID}',
        p_scrap_weight := 70.0000,
        p_cash_amount := 18000000,
        p_rate_per_gram := 900000,
        p_notes := 'Zavodga 70g lom va 18mln naqd topshirildi',
        p_idempotency_key := 'idemp-surr-001'
      ) as result;
    `);
    const surrData = surrRes.rows[0].result;
    if (surrData.status !== 'ok') {
      throw new Error(`Factory surrender failed: ${JSON.stringify(surrData)}`);
    }
    console.log(`  * Surrendered to factory: ${surrData.surrendered_gold_grams}g`);
    console.log(`  * Previous factory obligation: ${surrData.previous_obligation}g`);
    console.log(`  * Remaining factory obligation: ${surrData.remaining_obligation}g (108 - 90 = 18g)`);

    if (Number(surrData.remaining_obligation) !== 18.0) {
      throw new Error(`Factory obligation not reduced accurately: ${JSON.stringify(surrData)}`);
    }

    // Verify Seller Till is now 0 after handing over
    const sellerAcc3 = await db.query(`
      SELECT current_factory_obligation_grams, seller_till_scrap_grams, seller_till_cash_amount
      FROM public.seller_gold_accounts WHERE seller_id = '${SELLER_ID}';
    `);
    const row3 = sellerAcc3.rows[0];
    if (Number(row3.seller_till_scrap_grams) !== 0 || Number(row3.seller_till_cash_amount) !== 0) {
      throw new Error(`Seller till was not cleared upon surrender: ${JSON.stringify(row3)}`);
    }
    console.log('  * [FACTORY SURRENDER PROOF] Seller till cleared to 0, Factory obligation reduced to 18.0000g.');

    // ------------------------------------------------------------------------
    // STEP 8: Rule 10 — Advance / Excess Settlement Preservation
    // ------------------------------------------------------------------------
    console.log('\n[STEP 8] Verifying Rule 10: Excess settlement preserved as advance balance...');
    await setUserContext(db, SELLER_ID, 'sales');

    // Client owes 22g. Client brings 30g scrap.
    const excessRes = await db.query(`
      SELECT public.rpc_record_client_settlement(
        p_customer_id := '${customerId}',
        p_sale_id := '${saleId}',
        p_scrap_weight := 30.0000,
        p_cash_amount := 0,
        p_notes := 'Mijoz 30g lom olib keldi (qarz 22g, ortiqcha 8g)',
        p_idempotency_key := 'idemp-excess-001'
      ) as result;
    `);
    const exData = excessRes.rows[0].result;
    console.log(`  * Total paid: ${exData.total_settled_grams}g`);
    console.log(`  * Applied to debt: ${exData.applied_to_debt_grams}g`);
    console.log(`  * Excess gold: ${exData.excess_gold_grams}g (Preserved!)`);
    console.log(`  * Remaining debt: ${exData.remaining_debt_grams}g`);

    if (Number(exData.excess_gold_grams) !== 8.0 || Number(exData.remaining_debt_grams) !== 0) {
      throw new Error(`Rule 10 excess gold not tracked properly: ${JSON.stringify(exData)}`);
    }

    const cliAcc2 = await db.query(`SELECT current_debt_grams, advance_balance_grams FROM public.client_gold_accounts WHERE customer_id = '${customerId}';`);
    if (Number(cliAcc2.rows[0].advance_balance_grams) !== 8.0 || Number(cliAcc2.rows[0].current_debt_grams) !== 0) {
      throw new Error(`Advance balance not recorded on customer account: ${JSON.stringify(cliAcc2.rows[0])}`);
    }
    console.log('  * [RULE 10 PROOF] Advance balance: 8.0000g safely recorded on customer account.');

    // ------------------------------------------------------------------------
    // STEP 9: Cross-Seller & Cross-Tenant Boundary RLS
    // ------------------------------------------------------------------------
    console.log('\n[STEP 9] Testing Cross-Seller & Cross-Tenant RLS isolation...');
    await setUserContext(db, SELLER_B_ID, 'sales'); // Seller from Samarkand tenant

    let blockedCrossover = false;
    try {
      await db.query(`
        SELECT public.rpc_record_client_jewelry_sale(
          p_customer_id := '${customerId}',
          p_consignment_id := '${consignmentId}',
          p_client_markup_pct := 10.0
        );
      `);
    } catch (err) {
      blockedCrossover = true;
    }
    if (!blockedCrossover) {
      throw new Error('Cross-tenant/cross-seller sale was not blocked by RLS!');
    }
    console.log('  * [RLS PROOF] Cross-tenant and cross-seller tampering strictly blocked.');

    // ------------------------------------------------------------------------
    // STEP 10: Idempotency Duplication Guard
    // ------------------------------------------------------------------------
    console.log('\n[STEP 10] Testing Idempotency Duplicate Submissions...');
    await setUserContext(db, SELLER_ID, 'sales');

    const dupRes = await db.query(`
      SELECT public.rpc_record_client_settlement(
        p_customer_id := '${customerId}',
        p_sale_id := '${saleId}',
        p_scrap_weight := 70.0000,
        p_cash_amount := 18000000,
        p_rate_per_gram := 900000,
        p_idempotency_key := 'idemp-settl-001'
      ) as result;
    `);
    if (dupRes.rows[0].result.settlement_no !== sData.settlement_no) {
      throw new Error('Duplicate idempotency failed to return cached response!');
    }
    console.log('  * [IDEMPOTENCY PROOF] Duplicate submission safely returned cached response without double write.');

    // ------------------------------------------------------------------------
    // STEP 11: Dynamic Markup Presets (Director CRUD & Active Dropdowns)
    // ------------------------------------------------------------------------
    console.log('\n[STEP 11] Verifying Dynamic Markup Presets (Director CRUD)...');
    await setUserContext(db, DIRECTOR_ID, 'admin');

    // Add custom factory markup: 14%
    const addFactoryRes = await db.query(`
      SELECT public.rpc_manage_sales_markup_preset(
        p_type := 'factory_markup',
        p_name := 'Zavod 14% (Katta Partiya)',
        p_percentage := 14.0,
        p_is_active := true,
        p_is_default := false
      ) as res;
    `);
    console.log('  * Custom factory markup added:', addFactoryRes.rows[0].res);

    // Add custom client markup: 18% & 25% & custom 22%
    const addClientRes = await db.query(`
      SELECT public.rpc_manage_sales_markup_preset(
        p_type := 'client_markup',
        p_name := 'Mijoz 22% (Premium)',
        p_percentage := 22.0,
        p_is_active := true,
        p_is_default := false
      ) as res;
    `);
    console.log('  * Custom client markup added:', addClientRes.rows[0].res);

    // Switch to seller role to retrieve active markups
    await setUserContext(db, SELLER_ID, 'sales');
    const activeMarkupsRes = await db.query(`
      SELECT public.rpc_get_active_sales_markups('client_markup') as res;
    `);
    const activeList = activeMarkupsRes.rows[0].res;
    console.log('  * Active client markups available to seller count:', activeList.length);
    const has22 = activeList.some(m => Number(m.percentage) === 22);
    if (!has22) {
      throw new Error('Newly created dynamic markup 22% not found in active markups list!');
    }
    console.log('  * [DYNAMIC MARKUP PROOF] Seller successfully retrieved active director-approved markups.');

    // ------------------------------------------------------------------------
    // STEP 12: Historical Immutability Guard
    // ------------------------------------------------------------------------
    console.log('\n[STEP 12] Verifying Historical Immutability (Past Sales Untouched)...');
    // Director updates or deactivates a preset
    await setUserContext(db, DIRECTOR_ID, 'admin');
    await db.query(`
      UPDATE public.sales_markup_presets
      SET percentage = 99.0, is_active = false
      WHERE percentage = 12.0 AND type = 'client_markup' AND organization_id = '${ORG_GOLDIA_ID}';
    `);

    // Verify historical sale records still have original 12% and spread
    const pastSaleCheck = await db.query(`
      SELECT client_markup_pct, factory_markup_pct, markup_spread_grams
      FROM public.jewelry_sales
      WHERE id = '${saleId}';
    `);
    const sRow = pastSaleCheck.rows[0];
    if (Number(sRow.client_markup_pct) !== 12.0 || Number(sRow.markup_spread_grams) !== 4.0) {
      throw new Error(`Historical sale was mutated! Expected 12% / 4g, got: ${JSON.stringify(sRow)}`);
    }
    console.log('  * [HISTORICAL IMMUTABILITY PROOF] Existing sale preserved original 12.00% markup and 4.0000g spread.');

    console.log('\n======================================================================');
    console.log('ALL JEWELRY SALES MVP REAL DATABASE TESTS PASSED (100%)');
    console.log('All 12 user requirements & dynamic markup presets verified on PostgreSQL.');
    console.log('======================================================================\n');
  } catch (err) {
    console.error('\n[FATAL ERROR] Sales verification failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runRealDbSalesVerification();
}

module.exports = { runRealDbSalesVerification };
