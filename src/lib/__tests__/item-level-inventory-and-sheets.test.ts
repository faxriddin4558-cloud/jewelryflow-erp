import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";
import path from "node:path";
import type { SellerReconciliationData } from "@/components/sales/SellerReconciliationModal";
import type { DailyLedgerEntry, MonthlyReportPayload } from "@/components/sales/CustomerLedgerAndSheetsSection";

interface RpcReceiptResult {
  status: string;
  original_physical_g: number;
  factory_markup_pct: number;
  factory_obligation_g: number;
  receipt_id: string;
}

interface RpcConsignmentResult {
  status: string;
  consignment_id: string;
  quantity: number;
  base_weight_grams: number;
  seller_markup_pct: number;
  seller_obligation_g: number;
}

interface RpcPieceSaleResult {
  status: string;
  sale_id: string;
  weight_grams: number;
  client_markup_pct: number;
  client_gold_due_grams: number;
  gross_gold_due_grams?: number;
  net_remaining_debt_grams?: number;
  advance_applied_grams?: number;
}

interface RpcSettlementResult {
  status: string;
  scrap_weight_grams: number;
  remaining_debt_grams: number;
}

interface RpcSellerSettlementResult {
  status: string;
  scrap_weight_grams: number;
  seller_owes_manager_g: number;
  bozor_qarzi_signed_g: number;
  manager_scrap_grams: number;
}

interface RpcReturnResult {
  status: string;
  weight_grams: number;
  seller_markup_pct: number;
  seller_obligation_deducted_g: number;
  seller_owes_manager_g: number;
  bozor_qarzi_signed_g: number;
}

interface RpcCustomerResult {
  status: string;
  customer_code: string;
  contact_name: string;
}

describe("JewelryFlow Sales — Item-Level Inventory, 3-Tier Debt, Sheets Parity & Section 18 Journey", () => {
  let db: PGlite;
  let orgId: string;
  let sellerJamshidId: string;
  let custDilraboId: string;
  let modelMalikaId: string;
  let modelZarinaId: string;
  let pieceA_Id: string;
  let pieceB_Id: string;
  let pieceC_Id: string;

  beforeAll(async () => {
    db = new PGlite({
      extensions: { uuid_ossp, pg_trgm, btree_gist },
    });

    // 1. Setup mock Supabase auth environment
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
        last_accessed_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB
      );

      CREATE OR REPLACE FUNCTION moddatetime() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$;
    `);

    // 2. Run all 34 migrations in sequential order
    const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
    const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8")
        .replace(/create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi, "-- moddatetime handled")
        .replace(/create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi, "-- pgcrypto handled");
      await db.exec(sql);
    }

    // 3. Use seeded Goldia organization ID
    orgId = "00000000-0000-0000-0000-000000000001";

    // Manager user & employee
    const mgrUserRes = await db.query<{ id: string }>(`
      INSERT INTO auth.users (email) VALUES ('manager@goldia.uz') RETURNING id;
    `);
    await db.query<{ id: string }>(`
      INSERT INTO public.employees (organization_id, user_id, name, full_name, role, is_active)
      VALUES ('${orgId}', '${mgrUserRes.rows[0]!.id}', 'Rustam', 'Rustam Boshqaruvchi', 'director', true)
      RETURNING id;
    `);

    // Seller Jamshid user & employee
    const sellerUserRes = await db.query<{ id: string }>(`
      INSERT INTO auth.users (email) VALUES ('jamshid@goldia.uz') RETURNING id;
    `);
    const sellerEmpRes = await db.query<{ id: string }>(`
      INSERT INTO public.employees (organization_id, user_id, name, full_name, role, is_active)
      VALUES ('${orgId}', '${sellerUserRes.rows[0]!.id}', 'Jamshid', 'Jamshid Sotuvchi', 'sales', true)
      RETURNING id;
    `);
    sellerJamshidId = sellerEmpRes.rows[0]!.id;

    // Models: Malika and Zarina
    const malikaRes = await db.query<{ id: string }>(`
      INSERT INTO public.jewelry_models (organization_id, model_code, name, category, gold_purity, reference_weight_grams)
      VALUES ('${orgId}', 'JF-M-0001', 'Malika', 'Кольцо', 585, 6.00)
      ON CONFLICT (model_code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `);
    modelMalikaId = malikaRes.rows[0]!.id;

    const zarinaRes = await db.query<{ id: string }>(`
      INSERT INTO public.jewelry_models (organization_id, model_code, name, category, gold_purity, reference_weight_grams)
      VALUES ('${orgId}', 'JF-M-0002', 'Zarina', 'Серьги', 585, 4.80)
      ON CONFLICT (model_code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `);
    modelZarinaId = zarinaRes.rows[0]!.id;

    // Customer: Dilrabo
    const custRes = await db.query<{ id: string }>(`
      INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'CUST-0001', 'Dilrabo', '+998 90 123 45 67', '${sellerJamshidId}')
      ON CONFLICT (customer_code) DO UPDATE SET contact_name = EXCLUDED.contact_name
      RETURNING id;
    `);
    custDilraboId = custRes.rows[0]!.id;

    // Daily gold rate: 900,000 UZS/g
    await db.exec(`
      INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, notes)
      VALUES ('${orgId}', CURRENT_DATE, 585, 900000, 'Test daily rate')
      ON CONFLICT DO NOTHING;
    `);

    // Set active authentication context to Manager
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${mgrUserRes.rows[0]!.id}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
  }, 45000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("Step 1: Factory receives goods (16.85g) with 8% factory markup", async () => {
    // 16.85g at 8% factory markup = 18.198g obligation to factory
    const res = await db.query<{ rpc_record_factory_receipt: RpcReceiptResult }>(`
      SELECT public.rpc_record_factory_receipt(
        p_product_name := 'Aralash Zargarlik Partiyasi',
        p_quantity := 3,
        p_original_physical_g := 16.85,
        p_proba := 585,
        p_factory_markup_pct := 8.0,
        p_model_id := '${modelMalikaId}'
      ) as rpc_record_factory_receipt;
    `);

    const receipt = res.rows[0]!.rpc_record_factory_receipt;
    expect(receipt.status).toBe("ok");
    expect(Number(receipt.original_physical_g)).toBe(16.85);
    expect(Number(receipt.factory_markup_pct)).toBe(8.0);
    expect(Number(receipt.factory_obligation_g)).toBe(18.198);

    // Verify manager vault factory obligation
    const vaultRes = await db.query<{ current_factory_obligation_g: string }>(`
      SELECT current_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${orgId}';
    `);
    expect(Number(vaultRes.rows[0]!.current_factory_obligation_g)).toBe(18.198);
  });

  it("Step 2: Manager consigns 3 items to Seller Jamshid (12% seller markup)", async () => {
    // Malika item A: 5.90 g
    // Malika item B: 6.15 g
    // Zarina item C: 4.80 g
    // Total base weight = 16.85 g
    // Seller markup = 12% -> Initial seller obligation = 16.85 * 1.12 = 18.872 g
    const piecesPayload = JSON.stringify([
      {
        model_id: modelMalikaId,
        model_code: "JF-M-0001",
        model_name: "Malika",
        category: "Кольцо",
        purity: 585,
        weight_grams: 5.90,
        raw_barcode: "000590",
      },
      {
        model_id: modelMalikaId,
        model_code: "JF-M-0001",
        model_name: "Malika",
        category: "Кольцо",
        purity: 585,
        weight_grams: 6.15,
        raw_barcode: "000615",
      },
      {
        model_id: modelZarinaId,
        model_code: "JF-M-0002",
        model_name: "Zarina",
        category: "Серьги",
        purity: 585,
        weight_grams: 4.80,
        raw_barcode: "000480",
      },
    ]);

    const res = await db.query<{ rpc_issue_barcode_consignment: RpcConsignmentResult }>(`
      SELECT public.rpc_issue_barcode_consignment(
        p_seller_id := '${sellerJamshidId}',
        p_seller_markup_pct := 12.0,
        p_factory_markup_pct := 8.0,
        p_pieces := '${piecesPayload}'::jsonb,
        p_notes := 'Section 18 Test Consignment'
      ) as rpc_issue_barcode_consignment;
    `);

    const consign = res.rows[0]!.rpc_issue_barcode_consignment;
    expect(consign.status).toBe("ok");
    expect(consign.quantity).toBe(3);
    expect(Number(consign.base_weight_grams)).toBe(16.85);
    expect(Number(consign.seller_markup_pct)).toBe(12.0);
    expect(Number(consign.seller_obligation_g)).toBe(18.872);

    // Retrieve piece IDs
    const piecesRes = await db.query<{ id: string; model_name: string; weight_grams: string; status: string }>(`
      SELECT id, model_name, weight_grams, status
      FROM public.consignment_pieces
      WHERE consignment_id = '${consign.consignment_id}'
      ORDER BY weight_grams ASC;
    `);

    expect(piecesRes.rows.length).toBe(3);
    // 4.80g (Zarina), 5.90g (Malika A), 6.15g (Malika B)
    pieceC_Id = piecesRes.rows[0]!.id; // 4.80g Zarina
    pieceA_Id = piecesRes.rows[1]!.id; // 5.90g Malika A
    pieceB_Id = piecesRes.rows[2]!.id; // 6.15g Malika B

    expect(Number(piecesRes.rows[0]!.weight_grams)).toBe(4.80);
    expect(Number(piecesRes.rows[1]!.weight_grams)).toBe(5.90);
    expect(Number(piecesRes.rows[2]!.weight_grams)).toBe(6.15);
    expect(piecesRes.rows.every((p) => p.status === "held_by_seller")).toBe(true);

    // Verify Seller Gold Account initial obligation
    const sellerAcc = await db.query<{ total_seller_obligation_g: string; seller_owes_manager_g: string; bozor_qarzi_signed_g: string }>(`
      SELECT total_seller_obligation_g, seller_owes_manager_g, bozor_qarzi_signed_g
      FROM public.seller_gold_accounts
      WHERE seller_id = '${sellerJamshidId}';
    `);
    expect(Number(sellerAcc.rows[0]!.total_seller_obligation_g)).toBe(18.872);
    expect(Number(sellerAcc.rows[0]!.seller_owes_manager_g)).toBe(18.872);
    expect(Number(sellerAcc.rows[0]!.bozor_qarzi_signed_g)).toBe(-18.872);
  });

  it("Step 3: Seller sells Malika item B (6.15g) to customer Dilrabo at 15% customer markup", async () => {
    // Base weight = 6.15 g
    // Customer markup = 15% -> Customer obligation = 6.15 * 1.15 = 7.0725 g
    const saleRes = await db.query<{ rpc_record_barcode_piece_sale: RpcPieceSaleResult }>(`
      SELECT public.rpc_record_barcode_piece_sale(
        p_customer_id := '${custDilraboId}',
        p_seller_id := '${sellerJamshidId}',
        p_piece_id := '${pieceB_Id}',
        p_client_markup_pct := 15.0,
        p_notes := 'Sale to Dilrabo'
      ) as rpc_record_barcode_piece_sale;
    `);

    const sale = saleRes.rows[0]!.rpc_record_barcode_piece_sale;
    expect(sale.status).toBe("ok");
    expect(Number(sale.weight_grams)).toBe(6.15);
    expect(Number(sale.client_markup_pct)).toBe(15.0);
    expect(Number(sale.gross_gold_due_grams ?? sale.client_gold_due_grams)).toBe(7.0725);

    // Verify Piece B status is now 'sold' and linked to sale
    const pieceB = await db.query<{ status: string; sale_id: string }>(`
      SELECT status, sale_id FROM public.consignment_pieces WHERE id = '${pieceB_Id}';
    `);
    expect(pieceB.rows[0]!.status).toBe("sold");
    expect(pieceB.rows[0]!.sale_id).toBeTruthy();

    // Verify Piece A and Piece C remain unsold in seller inventory
    const unsoldPieces = await db.query<{ id: string; weight_grams: string }>(`
      SELECT id, weight_grams FROM public.consignment_pieces
      WHERE seller_id = '${sellerJamshidId}' AND status = 'held_by_seller'
      ORDER BY weight_grams ASC;
    `);
    expect(unsoldPieces.rows.length).toBe(2);
    expect(Number(unsoldPieces.rows[0]!.weight_grams)).toBe(4.80);
    expect(Number(unsoldPieces.rows[1]!.weight_grams)).toBe(5.90);

    // CRITICAL: Seller liability to manager remains 18.872g! (Selling to customer does NOT settle manager debt)
    const sellerAcc = await db.query<{ seller_owes_manager_g: string; bozor_qarzi_signed_g: string }>(`
      SELECT seller_owes_manager_g, bozor_qarzi_signed_g
      FROM public.seller_gold_accounts
      WHERE seller_id = '${sellerJamshidId}';
    `);
    expect(Number(sellerAcc.rows[0]!.seller_owes_manager_g)).toBe(18.872);
    expect(Number(sellerAcc.rows[0]!.bozor_qarzi_signed_g)).toBe(-18.872);

    // Dilrabo customer debt is 7.0725g
    const clientAcc = await db.query<{ current_debt_grams: string }>(`
      SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${custDilraboId}';
    `);
    expect(Number(clientAcc.rows[0]!.current_debt_grams)).toBe(7.0725);
  });

  it("Step 4: Dilrabo pays 2.00g scrap gold to seller Jamshid", async () => {
    // 2.00g scrap payment
    // Dilrabo debt: 7.0725 - 2.00 = 5.0725 g
    // Seller till scrap: 0.00 + 2.00 = 2.00 g
    // Seller liability to manager: UNCHANGED at 18.872 g
    const payRes = await db.query<{ rpc_record_client_settlement: RpcSettlementResult }>(`
      SELECT public.rpc_record_client_settlement(
        p_customer_id := '${custDilraboId}',
        p_scrap_weight := 2.00,
        p_scrap_proba := 585.0,
        p_notes := 'Dilrabo partial scrap payment'
      ) as rpc_record_client_settlement;
    `);

    const pay = payRes.rows[0]!.rpc_record_client_settlement;
    expect(pay.status).toBe("ok");
    expect(Number(pay.scrap_weight_grams)).toBe(2.00);
    expect(Number(pay.remaining_debt_grams)).toBe(5.0725);

    // Verify Dilrabo debt in client_gold_accounts
    const clientAcc = await db.query<{ current_debt_grams: string }>(`
      SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${custDilraboId}';
    `);
    expect(Number(clientAcc.rows[0]!.current_debt_grams)).toBe(5.0725);

    // Verify Seller till scrap is now 2.00g
    const sellerAcc = await db.query<{ seller_till_scrap_grams: string; seller_owes_manager_g: string }>(`
      SELECT seller_till_scrap_grams, seller_owes_manager_g
      FROM public.seller_gold_accounts
      WHERE seller_id = '${sellerJamshidId}';
    `);
    expect(Number(sellerAcc.rows[0]!.seller_till_scrap_grams)).toBe(2.00);
    // Seller liability to manager REMAINS 18.872g!
    expect(Number(sellerAcc.rows[0]!.seller_owes_manager_g)).toBe(18.872);
  });

  it("Step 5: Seller hands over 2.00g scrap to Manager", async () => {
    // Seller hands 2.00g scrap to manager
    // Seller till scrap: 2.00 - 2.00 = 0.00 g
    // Manager scrap: 0.00 + 2.00 = 2.00 g
    // Seller liability to manager: 18.872 - 2.00 = 16.872 g!
    // Factory liability: UNCHANGED at 18.198 g
    const stlRes = await db.query<{ rpc_record_seller_to_manager_settlement: RpcSellerSettlementResult }>(`
      SELECT public.rpc_record_seller_to_manager_settlement(
        p_seller_id := '${sellerJamshidId}',
        p_scrap_weight_grams := 2.00,
        p_notes := 'Jamshid hands scrap to Manager'
      ) as rpc_record_seller_to_manager_settlement;
    `);

    const stl = stlRes.rows[0]!.rpc_record_seller_to_manager_settlement;
    expect(stl.status).toBe("ok");
    expect(Number(stl.scrap_weight_grams)).toBe(2.00);
    expect(Number(stl.seller_owes_manager_g)).toBe(16.872);
    expect(Number(stl.bozor_qarzi_signed_g)).toBe(-16.872);
    expect(Number(stl.manager_scrap_grams)).toBe(2.00);

    // Verify seller till scrap is now 0.00g
    const sellerAcc = await db.query<{ seller_till_scrap_grams: string; seller_owes_manager_g: string }>(`
      SELECT seller_till_scrap_grams, seller_owes_manager_g
      FROM public.seller_gold_accounts
      WHERE seller_id = '${sellerJamshidId}';
    `);
    expect(Number(sellerAcc.rows[0]!.seller_till_scrap_grams)).toBe(0.00);
    expect(Number(sellerAcc.rows[0]!.seller_owes_manager_g)).toBe(16.872);

    // Verify factory debt remains unchanged at 18.198g
    const vaultRes = await db.query<{ current_factory_obligation_g: string }>(`
      SELECT current_factory_obligation_g FROM public.manager_vault_account WHERE organization_id = '${orgId}';
    `);
    expect(Number(vaultRes.rows[0]!.current_factory_obligation_g)).toBe(18.198);
  });

  it("Step 6: Seller returns unsold Zarina item C (4.80g) to Manager", async () => {
    // Piece C: 4.80g original weight, 12% seller markup
    // Obligation deducted = 4.80 * 1.12 = 5.376 g
    // New seller liability to manager = 16.872 - 5.376 = 11.496 g!
    // Piece C status becomes 'returned_to_manager'
    const retRes = await db.query<{ rpc_return_piece_to_manager: RpcReturnResult }>(`
      SELECT public.rpc_return_piece_to_manager(
        p_piece_id := '${pieceC_Id}',
        p_notes := 'Unsold Zarina returned to manager stock'
      ) as rpc_return_piece_to_manager;
    `);

    const ret = retRes.rows[0]!.rpc_return_piece_to_manager;
    expect(ret.status).toBe("ok");
    expect(Number(ret.weight_grams)).toBe(4.80);
    expect(Number(ret.seller_markup_pct)).toBe(12.0);
    expect(Number(ret.seller_obligation_deducted_g)).toBe(5.376);
    expect(Number(ret.seller_owes_manager_g)).toBe(11.496);
    expect(Number(ret.bozor_qarzi_signed_g)).toBe(-11.496);

    // Verify Piece C in database
    const pieceC = await db.query<{ status: string; returned_to_manager_at: string }>(`
      SELECT status, returned_to_manager_at FROM public.consignment_pieces WHERE id = '${pieceC_Id}';
    `);
    expect(pieceC.rows[0]!.status).toBe("returned_to_manager");
    expect(pieceC.rows[0]!.returned_to_manager_at).toBeTruthy();

    // Only Piece A (5.90g Malika) remains in seller unsold inventory
    const remainingUnsold = await db.query<{ id: string; weight_grams: string }>(`
      SELECT id, weight_grams FROM public.consignment_pieces
      WHERE seller_id = '${sellerJamshidId}' AND status = 'held_by_seller';
    `);
    expect(remainingUnsold.rows.length).toBe(1);
    expect(remainingUnsold.rows[0]!.id).toBe(pieceA_Id);
    expect(Number(remainingUnsold.rows[0]!.weight_grams)).toBe(5.90);
  });

  it("Step 7: Verify Seller Reconciliation Statement (Sections A through G)", async () => {
    const recRes = await db.query<{ rpc_get_seller_reconciliation_statement: SellerReconciliationData }>(`
      SELECT public.rpc_get_seller_reconciliation_statement('${sellerJamshidId}') as rpc_get_seller_reconciliation_statement;
    `);

    const stmt = recRes.rows[0]!.rpc_get_seller_reconciliation_statement;

    // Section A: Received from manager: 16.85g original, 18.872g obligation
    expect(Number(stmt.section_a.original_grams)).toBe(16.85);
    expect(Number(stmt.section_a.seller_markup_obligation_grams)).toBe(18.872);
    expect(stmt.section_a.item_count).toBe(3);

    // Section B: Goods unsold: 1 item, 5.90g, 5.90 * 1.12 = 6.608g
    expect(stmt.section_b.item_count).toBe(1);
    expect(Number(stmt.section_b.original_grams)).toBe(5.90);
    expect(Number(stmt.section_b.seller_markup_equivalent_grams)).toBe(6.608);

    // Section C: Goods sold: 1 item, 6.15g, 6.15 * 1.12 = 6.888g
    expect(stmt.section_c.item_count).toBe(1);
    expect(Number(stmt.section_c.original_grams)).toBe(6.15);
    expect(Number(stmt.section_c.seller_markup_equivalent_grams)).toBe(6.888);

    // Section D: Customer receivables: 7.0725g obligation, 2.00g collected, 5.0725g outstanding
    expect(Number(stmt.section_d.customer_markup_obligation_grams)).toBe(7.0725);
    expect(Number(stmt.section_d.scrap_collected_grams)).toBe(2.00);
    expect(Number(stmt.section_d.outstanding_customer_debt_grams)).toBe(5.0725);

    // Section E: Seller holdings: 0g scrap, 0 UZS cash
    expect(Number(stmt.section_e.scrap_grams)).toBe(0);
    expect(Number(stmt.section_e.cash_uzs)).toBe(0);

    // Section F: Settlements & returns: 2.00g scrap settled, 1 returned piece (4.80g, 5.376g)
    expect(Number(stmt.section_f.settlements_scrap_grams)).toBe(2.00);
    expect(stmt.section_f.returned_unsold_items_count).toBe(1);
    expect(Number(stmt.section_f.returned_unsold_original_grams)).toBe(4.80);
    expect(Number(stmt.section_f.returned_unsold_seller_obligation_grams)).toBe(5.376);

    // Section G: Signed Bozor Qarzi: -11.496g, discrepancy: 0.0000g, is_reconciled: true
    expect(Number(stmt.section_g.seller_owes_manager_grams)).toBe(11.496);
    expect(Number(stmt.section_g.bozor_qarzi_signed_grams)).toBe(-11.496);
    expect(Number(stmt.section_g.discrepancy_grams)).toBe(0);
    expect(stmt.section_g.is_reconciled).toBe(true);
  });

  it("Step 8: Verify Daily Sales Ledger (Лист1) Parity", async () => {
    const ledgerRes = await db.query<DailyLedgerEntry>(`
      SELECT * FROM public.rpc_get_daily_sales_ledger('${sellerJamshidId}');
    `);

    expect(ledgerRes.rows.length).toBe(2);

    const saleRow = ledgerRes.rows.find((r) => r.tx_type === "sale");
    expect(saleRow).toBeTruthy();
    expect(saleRow!.customer_name).toBe("Dilrabo");
    expect(Number(saleRow!.sold_weight_g)).toBe(6.15);
    expect(Number(saleRow!.markup_pct)).toBe(15.0);
    expect(Number(saleRow!.obligation_g)).toBe(7.0725);
    expect(saleRow!.item_id).toBe(pieceB_Id);

    const paymentRow = ledgerRes.rows.find((r) => r.tx_type === "payment");
    expect(paymentRow).toBeTruthy();
    expect(paymentRow!.customer_name).toBe("Dilrabo");
    expect(Number(paymentRow!.scrap_received_g)).toBe(2.00);
    expect(Number(paymentRow!.closing_debt_g)).toBe(5.0725);
  });

  it("Step 9: Verify Monthly Customer Report (Ойлик Ҳисобот) Parity", async () => {
    const reportRes = await db.query<{ rpc_get_customer_monthly_report: MonthlyReportPayload }>(`
      SELECT public.rpc_get_customer_monthly_report('${sellerJamshidId}') as rpc_get_customer_monthly_report;
    `);

    const report = reportRes.rows[0]!.rpc_get_customer_monthly_report;
    expect(report.items.length).toBe(1);

    const dilraboItem = report.items[0]!;
    expect(dilraboItem.customer_name).toBe("Dilrabo");
    expect(Number(dilraboItem.sales_in_month_g)).toBe(7.0725);
    expect(Number(dilraboItem.scrap_received_g)).toBe(2.00);
    expect(Number(dilraboItem.closing_debt_g)).toBe(5.0725);

    expect(Number(report.summary.total_distributed_month_g)).toBe(7.0725);
    expect(Number(report.summary.total_collected_month_g)).toBe(2.00);
    expect(Number(report.summary.total_customer_debt_g)).toBe(5.0725);
    expect(Number(report.summary.seller_manager_bozor_qarzi_g)).toBe(-11.496);
  });

  it("Step 10: Verify Customer Creation with Sequential Stable Code (CUST-xxxx)", async () => {
    const newCustRes = await db.query<{ rpc_create_customer_with_code: RpcCustomerResult }>(`
      SELECT public.rpc_create_customer_with_code(
        p_contact_name := 'Shahzoda Zargarlik',
        p_phone := '+998 93 999 88 77',
        p_seller_id := '${sellerJamshidId}'
      ) as rpc_create_customer_with_code;
    `);

    const cust = newCustRes.rows[0]!.rpc_create_customer_with_code;
    expect(cust.status).toBe("ok");
    expect(cust.customer_code).toBe("CUST-0002");
    expect(cust.contact_name).toBe("Shahzoda Zargarlik");

    // Duplicate check
    const dupRes = await db.query<{ rpc_create_customer_with_code: RpcCustomerResult }>(`
      SELECT public.rpc_create_customer_with_code(
        p_contact_name := 'Shahzoda Zargarlik',
        p_seller_id := '${sellerJamshidId}'
      ) as rpc_create_customer_with_code;
    `);
    expect(dupRes.rows[0]!.rpc_create_customer_with_code.status).toBe("existing");
  });
});
