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
    const retRes = await db.query<{ rpc_return_piece_to_manager: { status: string } }>(`
      SELECT public.rpc_return_piece_to_manager(
        p_piece_id := '${pieceId}'::uuid,
        p_notes := 'Audit test return 20g'
      ) as rpc_return_piece_to_manager;
    `);
    expect(retRes.rows[0]!.rpc_return_piece_to_manager.status).toBe("ok");

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
    const revRes = await db.query<{ rpc_reverse_refining_batch: { status: string } }>(`
      SELECT public.rpc_reverse_refining_batch(
        p_batch_id := '${refBatchId}'::uuid,
        p_reason := 'Audit test reversal'
      ) as rpc_reverse_refining_batch;
    `);
    expect(revRes.rows[0]!.rpc_reverse_refining_batch.status).toBe("ok");

    // Verify vault scrap restored to 10g and fine gold reduced
    const vaultRes = await db.query<{ manager_scrap_grams: number; manager_refined_gold_grams: number }>(`
      SELECT manager_scrap_grams, manager_refined_gold_grams FROM public.manager_vault_account WHERE organization_id = '${orgId}';
    `);
    expect(Number(vaultRes.rows[0]!.manager_scrap_grams)).toBe(10.0000);
    expect(Number(vaultRes.rows[0]!.manager_refined_gold_grams)).toBe(0.0000);
  });

  it("Issue 3: Reversing gold purchase is BLOCKED when an active factory handover is linked", async () => {
    // Create purchase BUY-AUDIT-01 for 1.10g 585 eq
    const purchRes = await db.query<{ id: string }>(`
      INSERT INTO public.gold_purchases (
        organization_id, purchase_no, supplier_name, gold_weight_grams, proba, equiv_585_grams, cash_spent_uzs, usd_spent, rate_per_gram, status
      ) VALUES (
        '${orgId}', 'BUY-20261028-F4F56B', 'Bozor Murod', 1.1000, 585, 1.1000, 860000, 10, 900000, 'confirmed'
      ) RETURNING id;
    `);
    const purchId = purchRes.rows[0]!.id;

    // Create active factory handover HND-AUDIT-01 for 0.50g linked to BUY-AUDIT-01
    await db.query(`
      INSERT INTO public.factory_gold_handovers (
        organization_id, handover_no, source_type, physical_weight_g, proba, agreed_equivalent_g, source_purchase_id, notes, status
      ) VALUES (
        '${orgId}', 'HND-20261028-E02B8F', 'purchased_gold', 0.5000, 585, 0.5000, '${purchId}', 'Purchase ref: BUY-20261028-F4F56B', 'confirmed'
      );
    `);

    // Attempting to reverse purchase BUY-20261028-F4F56B MUST fail with explicit error mentioning HND-20261028-E02B8F
    let rejected = false;
    try {
      await db.query(`
        SELECT public.rpc_reverse_gold_purchase(
          p_purchase_id := '${purchId}'::uuid,
          p_reason := 'Attempt reverse linked purchase'
        );
      `);
    } catch (err: unknown) {
      rejected = true;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("HND-20261028-E02B8F");
    }
    expect(rejected).toBe(true);
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
    const revSale = await db.query<{ rpc_reverse_jewelry_sale: { status: string } }>(`
      SELECT public.rpc_reverse_jewelry_sale(
        p_sale_id := '${saleId}'::uuid,
        p_reversal_reason := 'Customer return'
      ) as rpc_reverse_jewelry_sale;
    `);
    expect(revSale.rows[0]!.rpc_reverse_jewelry_sale.status).toBe("ok");

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
});
