import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";
import path from "node:path";

describe("Goldia Audit Production Fixes Suite", () => {
  let db: PGlite;
  let orgId: string;
  let managerUserId: string;
  let managerEmpId: string;
  let sellerUserId: string;
  let sellerEmpId: string;
  let custId: string;

  beforeAll(async () => {
    db = new PGlite({
      extensions: { uuid_ossp, pg_trgm, btree_gist },
    });

    // 1. Base auth & storage tables
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
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
      $$;

      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
        SELECT json_build_object(
          'sub', current_setting('request.jwt.claim.sub', true),
          'role', COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
        )::jsonb;
      $$;

      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        public BOOLEAN DEFAULT false
      );
      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT,
        name TEXT,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB
      );

      CREATE OR REPLACE FUNCTION moddatetime() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$;
    `);

    // 2. Apply all 64 migrations
    const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
    const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8")
        .replace(/create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi, "-- moddatetime handled")
        .replace(/create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi, "-- pgcrypto handled");
      await db.exec(sql);
    }

    await db.exec(`
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
      GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;
      ALTER TABLE public.seller_consignments DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.consignment_pieces DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.jewelry_sales DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.factory_receipts DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.gold_purchases DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.factory_gold_handovers DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.refining_batches DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.manager_vault_account DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.seller_gold_accounts DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.client_gold_accounts DISABLE ROW LEVEL SECURITY;
    `);

    orgId = "00000000-0000-0000-0000-000000000001";

    // Setup Organization
    await db.exec(`
      INSERT INTO public.organizations (id, code, name, status)
      VALUES ('${orgId}', 'goldia-main', 'Goldia Jewelry', 'ACTIVE')
      ON CONFLICT DO NOTHING;
    `);

    // Setup Manager & Seller
    const mgrUserRes = await db.query<{ id: string }>(`
      INSERT INTO auth.users (email) VALUES ('manager@goldia.uz') RETURNING id;
    `);
    managerUserId = mgrUserRes.rows[0]!.id;
    const mgrEmpRes = await db.query<{ id: string }>(`
      INSERT INTO public.employees (organization_id, user_id, name, full_name, role, is_active)
      VALUES ('${orgId}', '${managerUserId}', 'Rustam', 'Rustam Boshqaruvchi', 'director', true)
      RETURNING id;
    `);
    managerEmpId = mgrEmpRes.rows[0]!.id;
    expect(managerEmpId).toBeTruthy();

    const sellerUserRes = await db.query<{ id: string }>(`
      INSERT INTO auth.users (email) VALUES ('seller@goldia.uz') RETURNING id;
    `);
    sellerUserId = sellerUserRes.rows[0]!.id;
    const sellerEmpRes = await db.query<{ id: string }>(`
      INSERT INTO public.employees (organization_id, user_id, name, full_name, role, is_active)
      VALUES ('${orgId}', '${sellerUserId}', 'Dilshod', 'Dilshod Sotuvchi', 'sales', true)
      RETURNING id;
    `);
    sellerEmpId = sellerEmpRes.rows[0]!.id;

    const custRes = await db.query<{ id: string }>(`
      INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'CUST-AUDIT-01', 'Malika Client', '+998901234567', '${sellerEmpId}')
      RETURNING id;
    `);
    custId = custRes.rows[0]!.id;

    // Set JWT claim to manager
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${managerUserId}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);
  });

  it("Issue 1: Consignment return double counting / deduction reproduction", async () => {
    // Setup Manager with 200g receipt, consign 120g (11% markup) to Seller
    const rcpRes = await db.query<{ id: string }>(`
      INSERT INTO public.factory_receipts (
        organization_id, receipt_no, product_name, original_physical_g, available_physical_g, proba, factory_markup_pct, factory_obligation_g, status
      ) VALUES (
        '${orgId}', 'ZVD-TEST-001', 'Uzuklar 200g', 200.0000, 80.0000, 585, 8.0, 216.0000, 'partially_transferred'
      ) RETURNING id;
    `);
    const receiptId = rcpRes.rows[0]!.id;

    const consignRes = await db.query<{ id: string }>(`
      INSERT INTO public.seller_consignments (
        organization_id, consignment_no, product_name, seller_id, factory_receipt_id, quantity, base_weight_grams, proba, seller_markup_pct, seller_obligation_g, factory_gold_due_grams, factory_remaining_gold_grams, status
      ) VALUES (
        '${orgId}', 'CONS-TEST-001', 'Uzuklar', '${sellerEmpId}', '${receiptId}', 2, 120.0000, 585, 11.0, 133.2000, 129.6000, 129.6000, 'held_by_seller'
      ) RETURNING id;
    `);
    const consignId = consignRes.rows[0]!.id;

    const pieceRes = await db.query<{ id: string }>(`
      INSERT INTO public.consignment_pieces (
        organization_id, consignment_id, seller_id, model_code, model_name, weight_grams, proba, seller_markup_pct, status
      ) VALUES (
        '${orgId}', '${consignId}', '${sellerEmpId}', 'MOD-20', '20g Ring', 20.0000, 585, 11.0, 'held_by_seller'
      ) RETURNING id;
    `);
    const pieceId = pieceRes.rows[0]!.id;

    // Remaining piece 100g
    await db.query(`
      INSERT INTO public.consignment_pieces (
        organization_id, consignment_id, seller_id, model_code, model_name, weight_grams, proba, seller_markup_pct, status
      ) VALUES (
        '${orgId}', '${consignId}', '${sellerEmpId}', 'MOD-100', '100g Chain', 100.0000, 585, 11.0, 'held_by_seller'
      );
    `);

    // Recalculate initial seller account
    await db.query(`SELECT public.recalc_seller_gold_account('${sellerEmpId}', '${orgId}');`);

    // Return 20g piece to manager
    const retRes = await db.query<{ rpc_return_piece_to_manager: any }>(`
      SELECT public.rpc_return_piece_to_manager(
        p_piece_id := '${pieceId}'::uuid,
        p_notes := 'Audit test return 20g'
      ) as rpc_return_piece_to_manager;
    `);
    const retVal = typeof retRes.rows[0]!.rpc_return_piece_to_manager === 'string'
      ? JSON.parse(retRes.rows[0]!.rpc_return_piece_to_manager)
      : retRes.rows[0]!.rpc_return_piece_to_manager;
    expect(retVal.status).toBe("ok");

    // Check manager physical stock from function
    const mgrStock = await db.query<{ get_manager_available_stock_grams: number }>(`
      SELECT public.get_manager_available_stock_grams('${orgId}') as get_manager_available_stock_grams;
    `);

    const mgrVal = Number(mgrStock.rows[0]!.get_manager_available_stock_grams);

    const sellerAcc = await db.query<{ current_physical_stock_g: number }>(`
      SELECT current_physical_stock_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';
    `);
    const sellerVal = Number(sellerAcc.rows[0]!.current_physical_stock_g);

    // Verified: Manager = 100g, Seller = 100g
    expect(mgrVal).toBe(100.0000);
    expect(sellerVal).toBe(100.0000);
  });

  it("Issue 2: Refining reversal RPC overload resolution", async () => {
    // Setup manager vault with 8g scrap + 1.9809g fine gold
    await db.query(`
      INSERT INTO public.manager_vault_account (
        organization_id, manager_scrap_grams, manager_scrap_physical_g, manager_scrap_585_eq_g, manager_refined_gold_grams, manager_refined_gold_fine_grams
      ) VALUES (
        '${orgId}', 8.0000, 8.0000, 8.0000, 1.9809, 1.1600
      ) ON CONFLICT (organization_id) DO UPDATE SET manager_refined_gold_grams = 1.9809, manager_scrap_grams = 8.0000;
    `);

    // Perform refining batch: 2g 585 scrap -> 1.16g 999 fine gold
    const refRes = await db.query<{ id: string }>(`
      INSERT INTO public.refining_batches (
        organization_id, batch_no, input_scrap_grams, input_585_equiv_grams, melted_weight_grams, output_fine_grams, output_fine_proba, output_585_equiv_grams, total_loss_grams, status
      ) VALUES (
        '${orgId}', 'REF-TEST-001', 2.0000, 2.0000, 2.0000, 1.1600, 999, 1.9809, 0.0191, 'completed'
      ) RETURNING id;
    `);
    const refBatchId = refRes.rows[0]!.id;

    // Call rpc_reverse_refining_batch - Should resolve without candidate function ambiguity error
    const revRes = await db.query<{ rpc_reverse_refining_batch: any }>(`
      SELECT public.rpc_reverse_refining_batch(
        p_batch_id := '${refBatchId}'::uuid,
        p_reason := 'Audit test reversal'
      ) as rpc_reverse_refining_batch;
    `);
    const revVal = typeof revRes.rows[0]!.rpc_reverse_refining_batch === 'string'
      ? JSON.parse(revRes.rows[0]!.rpc_reverse_refining_batch)
      : revRes.rows[0]!.rpc_reverse_refining_batch;
    expect(revVal.status).toBe("ok");

    // Verify vault scrap restored to 10g and fine gold reduced
    const vaultRes = await db.query<{ manager_scrap_grams: number; manager_refined_gold_grams: number }>(`
      SELECT manager_scrap_grams, manager_refined_gold_grams FROM public.manager_vault_account WHERE organization_id = '${orgId}';
    `);
    expect(Number(vaultRes.rows[0]!.manager_scrap_grams)).toBe(10.0000);
    expect(Number(vaultRes.rows[0]!.manager_refined_gold_grams)).toBe(0.0000);
  });

  it("Issue 3: Reversing gold purchase is BLOCKED when an active factory handover is linked (Via REAL RPCs without notes)", async () => {
    // Fund manager vault cash for purchase
    await db.query(`
      UPDATE public.manager_vault_account
         SET manager_cash_amount = 10000000
       WHERE organization_id = '${orgId}';
    `);

    // Record purchase via rpc_record_gold_purchase
    const buyRes = await db.query<{ rpc_record_gold_purchase: any }>(`
      SELECT public.rpc_record_gold_purchase(
        p_supplier_name := 'Bozor Real RPC',
        p_cash_spent_uzs := 1000000,
        p_gold_weight_grams := 2.0000,
        p_proba := 585,
        p_usd_spent := 0,
        p_notes := null
      ) as rpc_record_gold_purchase;
    `);
    const buyObj = typeof buyRes.rows[0]!.rpc_record_gold_purchase === 'string'
      ? JSON.parse(buyRes.rows[0]!.rpc_record_gold_purchase)
      : buyRes.rows[0]!.rpc_record_gold_purchase;
    const purchaseId = buyObj.purchase_id;

    // Record factory handover via rpc_record_factory_gold_handover with EMPTY notes
    const hndRes = await db.query<{ rpc_record_factory_gold_handover: any }>(`
      SELECT public.rpc_record_factory_gold_handover(
        p_source_type := 'purchased_gold',
        p_physical_weight_g := 1.0000,
        p_proba := 585,
        p_agreed_equivalent_g := 1.0000,
        p_factory_recipient := 'Zavod RPC',
        p_notes := null,
        p_purchase_id := '${purchaseId}'::uuid
      ) as rpc_record_factory_gold_handover;
    `);
    const hndObj = typeof hndRes.rows[0]!.rpc_record_factory_gold_handover === 'string'
      ? JSON.parse(hndRes.rows[0]!.rpc_record_factory_gold_handover)
      : hndRes.rows[0]!.rpc_record_factory_gold_handover;
    const handoverId = hndObj.handover_id;

    // Attempting to reverse purchase MUST fail because purchase_id links the active handover!
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_reverse_gold_purchase(
          p_purchase_id := '${purchaseId}'::uuid,
          p_reason := 'Attempt reverse linked purchase without notes'
        );
      `);
    } catch (err: unknown) {
      rejected = true;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("faol zavodga topshirish");
    }
    expect(rejected).toBe(true);

    // Reversing handover first, then reversing purchase succeeds cleanly
    const revHnd = await db.query<{ rpc_reverse_factory_gold_handover: any }>(`
      SELECT public.rpc_reverse_factory_gold_handover(
        p_handover_id := '${handoverId}'::uuid,
        p_reason := 'Reversing handover first'
      ) as rpc_reverse_factory_gold_handover;
    `);
    const revHndObj = typeof revHnd.rows[0]!.rpc_reverse_factory_gold_handover === 'string'
      ? JSON.parse(revHnd.rows[0]!.rpc_reverse_factory_gold_handover)
      : revHnd.rows[0]!.rpc_reverse_factory_gold_handover;
    expect(revHndObj.status).toBe("ok");

    const revBuy = await db.query<{ rpc_reverse_gold_purchase: any }>(`
      SELECT public.rpc_reverse_gold_purchase(
        p_purchase_id := '${purchaseId}'::uuid,
        p_reason := 'Reversing purchase after handover cancellation'
      ) as rpc_reverse_gold_purchase;
    `);
    const revBuyObj = typeof revBuy.rows[0]!.rpc_reverse_gold_purchase === 'string'
      ? JSON.parse(revBuy.rows[0]!.rpc_reverse_gold_purchase)
      : revBuy.rows[0]!.rpc_reverse_gold_purchase;
    expect(revBuyObj.status).toBe("ok");
  });

  it("Issue 4: Restored consignment piece after sale reversal retains active status", async () => {
    // Consign piece to seller
    const consignRes = await db.query<{ id: string }>(`
      INSERT INTO public.seller_consignments (
        organization_id, consignment_no, product_name, seller_id, quantity, base_weight_grams, proba, seller_markup_pct, seller_obligation_g, factory_gold_due_grams, factory_remaining_gold_grams, status
      ) VALUES (
        '${orgId}', 'CONS-SALE-01', 'Uzuk 10g', '${sellerEmpId}', 1, 10.0000, 585, 12.0, 11.2000, 10.8000, 10.8000, 'partially_sold'
      ) RETURNING id;
    `);
    const consignId = consignRes.rows[0]!.id;

    const pieceRes = await db.query<{ id: string }>(`
      INSERT INTO public.consignment_pieces (
        organization_id, consignment_id, seller_id, model_code, model_name, weight_grams, proba, seller_markup_pct, status
      ) VALUES (
        '${orgId}', '${consignId}', '${sellerEmpId}', 'MOD-10', '10g Ring', 10.0000, 585, 12.0, 'sold'
      ) RETURNING id;
    `);
    const pieceId = pieceRes.rows[0]!.id;

    // Create sale for this piece
    const saleRes = await db.query<{ id: string }>(`
      INSERT INTO public.jewelry_sales (
        organization_id, sale_no, customer_id, seller_id, base_weight_grams, client_markup_pct, client_gold_due_grams, remaining_gold_grams, factory_gold_due_grams, status
      ) VALUES (
        '${orgId}', 'SALE-AUDIT-01', '${custId}', '${sellerEmpId}', 10.0000, 20.0, 12.0000, 12.0000, 10.8000, 'open_debt'
      ) RETURNING id;
    `);
    const saleId = saleRes.rows[0]!.id;

    await db.query(`UPDATE public.consignment_pieces SET sale_id = '${saleId}' WHERE id = '${pieceId}';`);

    // Reverse sale
    const revSale = await db.query<{ rpc_reverse_jewelry_sale: any }>(`
      SELECT public.rpc_reverse_jewelry_sale(
        p_sale_id := '${saleId}'::uuid,
        p_reversal_reason := 'Customer return'
      ) as rpc_reverse_jewelry_sale;
    `);
    const revSaleObj = typeof revSale.rows[0]!.rpc_reverse_jewelry_sale === 'string'
      ? JSON.parse(revSale.rows[0]!.rpc_reverse_jewelry_sale)
      : revSale.rows[0]!.rpc_reverse_jewelry_sale;
    expect(revSaleObj.status).toBe("ok");

    // Verify restored piece status is 'held_by_seller' and parent consignment status is not blank/null
    const pieceCheck = await db.query<{ status: string }>(`
      SELECT status FROM public.consignment_pieces WHERE id = '${pieceId}';
    `);
    expect(pieceCheck.rows[0]!.status).toBe("held_by_seller");

    const consignCheck = await db.query<{ status: string }>(`
      SELECT status FROM public.seller_consignments WHERE id = '${consignId}';
    `);
    expect(consignCheck.rows[0]!.status).toBeTruthy();
    expect(consignCheck.rows[0]!.status).not.toBe("");
  });

  it("Regression Test: capital_pure_gold handover and reversal restores exact state", async () => {
    // Setup vault with capital_pure_gold = 50g 585 eq (49.95g fine gold 999)
    await db.query(`
      UPDATE public.manager_vault_account
         SET manager_capital_pure_gold_g = 50.0000,
             manager_capital_pure_gold_fine_g = 49.9500,
             total_factory_handed_over_g = 0.0000,
             total_factory_obligation_g = 0.0000,
             current_factory_obligation_g = 0.0000,
             current_factory_advance_g = 0.0000
       WHERE organization_id = '${orgId}';
    `);

    // Hand over 10g fine gold (17.0769g 585 eq) from capital_pure_gold to factory
    const hndRes = await db.query<{ rpc_record_factory_gold_handover: any }>(`
      SELECT public.rpc_record_factory_gold_handover(
        p_source_type := 'capital_pure_gold',
        p_physical_weight_g := 10.0000,
        p_proba := 999,
        p_agreed_equivalent_g := 17.0769,
        p_factory_recipient := 'Zavod Capital Test',
        p_notes := 'Capital pure gold handover test'
      ) as rpc_record_factory_gold_handover;
    `);
    const hndObj = typeof hndRes.rows[0]!.rpc_record_factory_gold_handover === 'string'
      ? JSON.parse(hndRes.rows[0]!.rpc_record_factory_gold_handover)
      : hndRes.rows[0]!.rpc_record_factory_gold_handover;
    const handoverId = hndObj.handover_id;

    // Check vault after handover
    const vaultMid = await db.query<{ manager_capital_pure_gold_g: number; manager_capital_pure_gold_fine_g: number; current_factory_advance_g: number }>(`
      SELECT manager_capital_pure_gold_g, manager_capital_pure_gold_fine_g, current_factory_advance_g
      FROM public.manager_vault_account WHERE organization_id = '${orgId}';
    `);
    expect(Number(vaultMid.rows[0]!.manager_capital_pure_gold_g)).toBe(32.9231);
    expect(Number(vaultMid.rows[0]!.current_factory_advance_g)).toBe(17.0769);

    // Reverse handover
    const revRes = await db.query<{ rpc_reverse_factory_gold_handover: any }>(`
      SELECT public.rpc_reverse_factory_gold_handover(
        p_handover_id := '${handoverId}'::uuid,
        p_reason := 'Reversing capital pure gold handover test'
      ) as rpc_reverse_factory_gold_handover;
    `);
    const revObj = typeof revRes.rows[0]!.rpc_reverse_factory_gold_handover === 'string'
      ? JSON.parse(revRes.rows[0]!.rpc_reverse_factory_gold_handover)
      : revRes.rows[0]!.rpc_reverse_factory_gold_handover;
    expect(revObj.status).toBe("ok");

    // Check vault after reversal: 100% restored to 50g 585 eq and 0 advance!
    const vaultFinal = await db.query<{ manager_capital_pure_gold_g: number; current_factory_advance_g: number }>(`
      SELECT manager_capital_pure_gold_g, current_factory_advance_g
      FROM public.manager_vault_account WHERE organization_id = '${orgId}';
    `);
    expect(Number(vaultFinal.rows[0]!.manager_capital_pure_gold_g)).toBe(50.0000);
    expect(Number(vaultFinal.rows[0]!.current_factory_advance_g)).toBe(0.0000);
  });

  it("Regression Test: Automatic FIFO consignment issuance (stock 0 rejected vs 100g -> 80g manager & 20g seller)", async () => {
    // 1. When no active receipts exist, FIFO consignment MUST abort with exception
    await db.query(`UPDATE public.factory_receipts SET available_physical_g = 0, status = 'fully_transferred' WHERE organization_id = '${orgId}';`);

    let fifoRejected = false;
    try {
      await db.query(`
        SELECT public.rpc_issue_barcode_consignment(
          p_seller_id := '${sellerEmpId}'::uuid,
          p_factory_markup_pct := 8.0,
          p_pieces := '[{"weight_grams": 20.0, "model_code": "FIFO-1", "purity": 585}]'::jsonb,
          p_notes := 'FIFO 0 stock test'
        );
      `);
    } catch (err: unknown) {
      fifoRejected = true;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("Menejer omborida yetarli tovar yo'q");
    }
    expect(fifoRejected).toBe(true);

    // 2. Create factory receipt with 100g available stock
    await db.query(`
      INSERT INTO public.factory_receipts (
        organization_id, receipt_no, product_name, original_physical_g, available_physical_g, proba, factory_markup_pct, factory_obligation_g, status
      ) VALUES (
        '${orgId}', 'ZVD-FIFO-100', '100g Factory Receipt', 100.0000, 100.0000, 585, 8.0, 108.0000, 'in_manager_stock'
      );
    `);

    // Get current seller physical stock
    const sellerBefore = await db.query<{ current_physical_stock_g: number }>(`
      SELECT current_physical_stock_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';
    `);
    const initialSellerStock = Number(sellerBefore.rows[0]!.current_physical_stock_g);

    // Issue 20g consignment via FIFO (p_factory_receipt_id IS NULL)
    const fifoIssue = await db.query<{ rpc_issue_barcode_consignment: any }>(`
      SELECT public.rpc_issue_barcode_consignment(
        p_seller_id := '${sellerEmpId}'::uuid,
        p_factory_markup_pct := 8.0,
        p_pieces := '[{"weight_grams": 20.0, "model_code": "FIFO-20", "purity": 585}]'::jsonb,
        p_notes := 'FIFO 20g issue test'
      ) as rpc_issue_barcode_consignment;
    `);
    const fifoObj = typeof fifoIssue.rows[0]!.rpc_issue_barcode_consignment === 'string'
      ? JSON.parse(fifoIssue.rows[0]!.rpc_issue_barcode_consignment)
      : fifoIssue.rows[0]!.rpc_issue_barcode_consignment;
    expect(fifoObj.status).toBe("ok");

    // Manager stock should decrease from 100g to 80g
    const mgrStock = await db.query<{ get_manager_available_stock_grams: number }>(`
      SELECT public.get_manager_available_stock_grams('${orgId}') as get_manager_available_stock_grams;
    `);
    expect(Number(mgrStock.rows[0]!.get_manager_available_stock_grams)).toBe(80.0000);

    // Seller physical stock should increase by 20g
    const sellerAfter = await db.query<{ current_physical_stock_g: number }>(`
      SELECT current_physical_stock_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerEmpId}';
    `);
    expect(Number(sellerAfter.rows[0]!.current_physical_stock_g)).toBe(initialSellerStock + 20.0000);
  });

  it("Regression Test: Partial sale (100g -> 10g sale) and sale reversal chain", async () => {
    // 1. Record receipt 100g and issue 100g consignment (10g piece + 90g piece)
    await db.query(`
      INSERT INTO public.factory_receipts (
        organization_id, receipt_no, product_name, original_physical_g, available_physical_g, proba, factory_markup_pct, factory_obligation_g, status
      ) VALUES (
        '${orgId}', 'ZVD-SALE-100', '100g Batch', 100.0000, 100.0000, 585, 8.0, 108.0000, 'in_manager_stock'
      );
    `);

    const consignRes = await db.query<{ rpc_issue_barcode_consignment: any }>(`
      SELECT public.rpc_issue_barcode_consignment(
        p_seller_id := '${sellerEmpId}'::uuid,
        p_factory_markup_pct := 8.0,
        p_pieces := '[{"weight_grams": 10.0, "model_code": "P-10", "purity": 585}, {"weight_grams": 90.0, "model_code": "P-90", "purity": 585}]'::jsonb,
        p_notes := '100g consignment'
      ) as rpc_issue_barcode_consignment;
    `);
    const consignObj = typeof consignRes.rows[0]!.rpc_issue_barcode_consignment === 'string'
      ? JSON.parse(consignRes.rows[0]!.rpc_issue_barcode_consignment)
      : consignRes.rows[0]!.rpc_issue_barcode_consignment;

    const consignId = consignObj.consignment_id;

    // Fetch the 10g piece directly from database
    const pieceRow = await db.query<{ id: string }>(`
      SELECT id FROM public.consignment_pieces
      WHERE consignment_id = '${consignId}'::uuid
      ORDER BY weight_grams ASC
      LIMIT 1;
    `);
    const piece10Id = pieceRow.rows[0]!.id;

    // 2. Sell 10g piece via rpc_record_barcode_piece_sale
    const saleRes = await db.query<{ rpc_record_barcode_piece_sale: any }>(`
      SELECT public.rpc_record_barcode_piece_sale(
        p_customer_id := '${custId}'::uuid,
        p_seller_id := '${sellerEmpId}'::uuid,
        p_piece_id := '${piece10Id}'::uuid,
        p_client_markup_pct := 20.0,
        p_notes := '10g sale test'
      ) as rpc_record_barcode_piece_sale;
    `);
    const saleObj = typeof saleRes.rows[0]!.rpc_record_barcode_piece_sale === 'string'
      ? JSON.parse(saleRes.rows[0]!.rpc_record_barcode_piece_sale)
      : saleRes.rows[0]!.rpc_record_barcode_piece_sale;
    const saleId = saleObj.sale_id;

    // 3. Reverse sale
    const revRes = await db.query<{ rpc_reverse_jewelry_sale: any }>(`
      SELECT public.rpc_reverse_jewelry_sale(
        p_sale_id := '${saleId}'::uuid,
        p_reversal_reason := 'Reversing 10g test sale'
      ) as rpc_reverse_jewelry_sale;
    `);
    const revObj = typeof revRes.rows[0]!.rpc_reverse_jewelry_sale === 'string'
      ? JSON.parse(revRes.rows[0]!.rpc_reverse_jewelry_sale)
      : revRes.rows[0]!.rpc_reverse_jewelry_sale;
    expect(revObj.status).toBe("ok");

    // 4. Verify piece 10g is held_by_seller, total active seller pieces sum to 100g
    const activePiecesSum = await db.query<{ total_g: number }>(`
      SELECT COALESCE(SUM(weight_grams), 0) as total_g
      FROM public.consignment_pieces
      WHERE consignment_id = '${consignId}'::uuid
        AND status = 'held_by_seller';
    `);
    expect(Number(activePiecesSum.rows[0]!.total_g)).toBe(100.0000);
  });
});
