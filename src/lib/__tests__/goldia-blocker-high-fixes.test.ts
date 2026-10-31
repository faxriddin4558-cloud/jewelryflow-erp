import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";
import path from "node:path";

// Regression suite for migration 065. Unlike the older suites, every business call here runs as
// the real `authenticated` role with Supabase-style default grants and RLS left ON, so permission
// and isolation fixes are exercised the way production executes them.

type Json = Record<string, unknown>;

describe("Goldia migration 065 — BLOCKER / HIGH regression suite", () => {
  let db: PGlite;
  const orgId = "00000000-0000-0000-0000-0000000000a1";
  const otherOrgId = "00000000-0000-0000-0000-0000000000b2";
  let directorUser: string;
  let sellerAUser: string;
  let sellerBUser: string;
  let sellerA: string;
  let sellerB: string;
  let customerA: string;
  let customerB: string;
  let modelId: string;

  const asAdmin = () => db.exec(`RESET ROLE;`);
  const asUser = (userId: string) =>
    db.exec(`
      RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

  async function rpc(sql: string): Promise<Json> {
    const res = await db.query<{ r: unknown }>(`SELECT (${sql}) AS r`);
    const raw = res.rows[0]!.r;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Json;
  }

  async function scalar(sql: string): Promise<number> {
    const res = await db.query<{ v: unknown }>(`SELECT (${sql})::numeric AS v`);
    return Number(res.rows[0]!.v);
  }

  async function expectError(sql: string, fragment: string) {
    let message = "";
    try {
      await db.query(sql);
    } catch (err: unknown) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message, `expected error containing "${fragment}"`).toContain(fragment);
  }

  async function issue(sellerId: string, pieces: { w: number; code?: string }[]): Promise<Json> {
    const payload = JSON.stringify(
      pieces.map((p) => ({ weight_grams: p.w, model_code: p.code ?? "M-065", model_id: modelId, purity: 585 }))
    );
    return rpc(`public.rpc_issue_barcode_consignment(
      p_seller_id := '${sellerId}'::uuid, p_factory_markup_pct := 8.0,
      p_pieces := '${payload}'::jsonb, p_notes := '065 test', p_seller_markup_pct := 12.0)`);
  }

  async function heldPieces(consignmentId: string): Promise<{ id: string; weight_grams: string }[]> {
    await asAdmin();
    const res = await db.query<{ id: string; weight_grams: string }>(
      `SELECT id, weight_grams FROM public.consignment_pieces
        WHERE consignment_id = '${consignmentId}' AND status = 'held_by_seller' ORDER BY weight_grams`
    );
    return res.rows;
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { uuid_ossp, pg_trgm, btree_gist } });

    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT,
        raw_user_meta_data JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now());
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated'); $$;
      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
        SELECT jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true)); $$;
      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, owner UUID,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), public BOOLEAN DEFAULT false);
      CREATE TABLE IF NOT EXISTS storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT,
        name TEXT, owner UUID, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), metadata JSONB);
      CREATE OR REPLACE FUNCTION moddatetime() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

      -- Supabase platform defaults: API roles get table privileges, RLS decides the rest.
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    `);

    const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8")
        .replace(/create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi, "-- moddatetime handled")
        .replace(/create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi, "-- pgcrypto handled");
      await db.exec(sql);
    }

    await db.exec(`
      INSERT INTO public.organizations (id, code, name, status) VALUES
        ('${orgId}', 'goldia-065', 'Goldia 065', 'ACTIVE'),
        ('${otherOrgId}', 'other-065', 'Other Org', 'ACTIVE');
    `);

    const user = async (email: string) =>
      (await db.query<{ id: string }>(`INSERT INTO auth.users (email) VALUES ('${email}') RETURNING id`)).rows[0]!.id;
    const employee = async (userId: string, name: string, role: string) =>
      (await db.query<{ id: string }>(`
        INSERT INTO public.employees (organization_id, user_id, name, full_name, role, is_active)
        VALUES ('${orgId}', '${userId}', '${name}', '${name}', '${role}', true) RETURNING id`)).rows[0]!.id;

    directorUser = await user("director065@goldia.uz");
    await employee(directorUser, "Alisher", "director");
    sellerAUser = await user("sellera065@goldia.uz");
    sellerA = await employee(sellerAUser, "Jamshid", "sales");
    sellerBUser = await user("sellerb065@goldia.uz");
    sellerB = await employee(sellerBUser, "Dilshod", "sales");

    const customer = async (code: string, sellerId: string) =>
      (await db.query<{ id: string }>(`
        INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
        VALUES ('${orgId}', '${code}', 'Mijoz ${code}', '+998900000000', '${sellerId}') RETURNING id`)).rows[0]!.id;
    customerA = await customer("C065-A", sellerA);
    customerB = await customer("C065-B", sellerB);

    modelId = (await db.query<{ id: string }>(`
      INSERT INTO public.jewelry_models (model_code, name) VALUES ('M-065', 'Uzuk 065') RETURNING id`)).rows[0]!.id;

    await db.exec(`
      INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed)
      VALUES ('${orgId}', CURRENT_DATE, 585, 900000, 'UZS', true);
      INSERT INTO public.factory_receipts (organization_id, receipt_no, product_name, original_physical_g,
        available_physical_g, proba, factory_markup_pct, factory_obligation_g, status)
      VALUES ('${orgId}', 'ZVD-065-1000', 'Test partiya', 1000, 1000, 585, 8.0, 1080, 'in_manager_stock');
    `);
  });

  it("returning a 10 g piece reduces seller stock by exactly 10 g and keeps both stock formulas equal", async () => {
    await asUser(directorUser);
    const cons = await issue(sellerA, [{ w: 10 }, { w: 20 }]);
    expect(cons.status).toBe("ok");
    const [p10] = await heldPieces(String(cons.consignment_id));
    const managerBefore = await scalar(`public.get_manager_available_stock_grams()`);

    await asUser(sellerAUser);
    expect(await scalar(`public.get_seller_available_stock_grams('${sellerA}')`)).toBe(30);
    const ret = await rpc(`public.rpc_return_piece_to_manager('${p10!.id}', 'qaytarish testi', null)`);
    expect(ret.status).toBe("ok");

    expect(await scalar(`public.get_seller_available_stock_grams('${sellerA}')`)).toBe(20);
    await asAdmin();
    expect(await scalar(`(SELECT current_physical_stock_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerA}')`)).toBe(20);
    await asUser(directorUser);
    expect(await scalar(`public.get_manager_available_stock_grams()`)).toBe(managerBefore + 10);
  });

  it("piece sale uses exactly the markup sent (no hidden 15% default) and rejects missing/out-of-range markup", async () => {
    await asUser(directorUser);
    const cons = await issue(sellerA, [{ w: 10 }]);
    const [piece] = await heldPieces(String(cons.consignment_id));

    await asUser(sellerAUser);
    await expectError(`SELECT public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_piece_id := '${piece!.id}')`, "ERR_MARKUP_REQUIRED");
    await expectError(`SELECT public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_piece_id := '${piece!.id}', p_client_markup_pct := 150)`, "ERR_MARKUP_OUT_OF_RANGE");
    const sale = await rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_piece_id := '${piece!.id}', p_client_markup_pct := 12)`);
    expect(Number(sale.client_markup_pct)).toBe(12);
    expect(Number(sale.client_gold_due_grams)).toBe(11.2);
  });

  it("a seller cannot sell another seller's piece, and a manager cannot attribute it to the wrong seller", async () => {
    await asUser(directorUser);
    const cons = await issue(sellerA, [{ w: 7 }]);
    const [piece] = await heldPieces(String(cons.consignment_id));

    await asUser(sellerBUser);
    await expectError(`SELECT public.rpc_record_barcode_piece_sale(p_customer_id := '${customerB}', p_piece_id := '${piece!.id}', p_client_markup_pct := 12)`, "boshqa sotuvchiga biriktirilgan");
    await expectError(`SELECT public.rpc_record_barcode_piece_sale(p_customer_id := '${customerB}', p_seller_id := '${sellerA}', p_piece_id := '${piece!.id}', p_client_markup_pct := 12)`, "o'z nomidan");

    await asUser(directorUser);
    await expectError(`SELECT public.rpc_record_barcode_piece_sale(p_customer_id := '${customerB}', p_seller_id := '${sellerB}', p_piece_id := '${piece!.id}', p_client_markup_pct := 12)`, "boshqa sotuvchiga biriktirilgan");
  });

  it("sellers must use the official rate, cannot collect for other sellers' customers, and the sale must belong to the customer", async () => {
    await asUser(sellerAUser);
    // 12 UZS at a fake rate of 1 UZS/g would have cancelled 12 g of debt.
    await expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${customerA}', p_cash_amount := 12, p_rate_per_gram := 1)`, "ERR_RATE_MISMATCH");
    await expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${customerB}', p_cash_amount := 900000)`, "o'z kassasiga");
    await expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${customerB}', p_cash_amount := 900000, p_seller_id := '${sellerA}')`, "sizga biriktirilmagan");
    await expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${customerA}', p_cash_amount := 900000, p_seller_id := '${sellerB}')`, "o'z kassasiga");

    await asAdmin();
    const otherSale = (await db.query<{ id: string }>(`SELECT id FROM public.jewelry_sales WHERE customer_id <> '${customerA}' LIMIT 1`)).rows[0];
    await asUser(sellerAUser);
    if (otherSale) {
      await expectError(`SELECT public.rpc_record_client_settlement(p_customer_id := '${customerA}', p_cash_amount := 900000, p_sale_id := '${otherSale.id}')`, "tegishli emas");
    }

    const ok = await rpc(`public.rpc_record_client_settlement(p_customer_id := '${customerA}', p_cash_amount := 900000, p_rate_per_gram := 900000)`);
    expect(ok.status).toBe("ok");
    expect(Number(ok.cash_equivalent_grams)).toBe(1);

    await expectError(`SELECT public.rpc_record_seller_to_manager_settlement(p_seller_id := '${sellerB}', p_cash_paid_amount := 1000)`, "o'z kassasini");
    await expectError(`SELECT public.rpc_record_seller_to_manager_settlement(p_seller_id := '${sellerA}', p_cash_paid_amount := 900000, p_rate_per_gram := 1)`, "ERR_RATE_MISMATCH");
  });

  it("reversing a piece sale restores the consignment sold count so the piece is sellable by model + weight again", async () => {
    await asUser(directorUser);
    const cons = await issue(sellerA, [{ w: 5.5, code: "M-065" }, { w: 5.5, code: "M-065" }]);
    const consId = String(cons.consignment_id);

    await asUser(sellerAUser);
    const sale1 = await rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_model_id := '${modelId}', p_weight_grams := 5.5, p_client_markup_pct := 10)`);
    expect(sale1.status).toBe("ok");
    // Before 065 the second model+weight sale failed: original_quantity defaults to 1.
    const sale2 = await rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_model_id := '${modelId}', p_weight_grams := 5.5, p_client_markup_pct := 10)`);
    expect(sale2.status).toBe("ok");

    await asUser(directorUser);
    await rpc(`public.rpc_reverse_client_sale('${sale2.sale_id}', 'xato sotuv', null)`);
    await asAdmin();
    const c = (await db.query<{ sold_quantity: number; status: string }>(`SELECT sold_quantity, status FROM public.seller_consignments WHERE id = '${consId}'`)).rows[0]!;
    expect(Number(c.sold_quantity)).toBe(1);
    expect(c.status).toBe("partially_sold");

    await asUser(sellerAUser);
    const sale3 = await rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerA}', p_model_id := '${modelId}', p_weight_grams := 5.5, p_client_markup_pct := 10)`);
    expect(sale3.status).toBe("ok");
  });

  it("weight-sale reversal restores the exact piece that was reduced", async () => {
    // Dedicated seller so FIFO picks a known consignment
    await asAdmin();
    const u = (await db.query<{ id: string }>(`INSERT INTO auth.users (email) VALUES ('sellerc065@goldia.uz') RETURNING id`)).rows[0]!.id;
    const sellerC = (await db.query<{ id: string }>(`INSERT INTO public.employees (organization_id, user_id, name, full_name, role, is_active)
      VALUES ('${orgId}', '${u}', 'Jasur', 'Jasur', 'sales', true) RETURNING id`)).rows[0]!.id;
    const cust = (await db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'C065-C', 'Mijoz C', '+998900000001', '${sellerC}') RETURNING id`)).rows[0]!.id;

    await asUser(directorUser);
    const cons = await issue(sellerC, [{ w: 8 }, { w: 9 }]);
    const consId = String(cons.consignment_id);

    await asUser(u);
    const sale = await rpc(`public.rpc_record_weight_sale(p_customer_id := '${cust}', p_weight_grams := 3, p_client_markup_pct := 10)`);
    expect(sale.status).toBe("ok");

    await asAdmin();
    const reduced = (await db.query<{ id: string; weight_grams: string }>(`SELECT id, weight_grams FROM public.consignment_pieces
      WHERE consignment_id = '${consId}' AND weight_grams NOT IN (8, 9)`)).rows[0]!;
    // Make the other piece the most recently updated one (the old reversal picked that piece).
    await db.exec(`UPDATE public.consignment_pieces SET updated_at = now() + interval '1 hour'
      WHERE consignment_id = '${consId}' AND id <> '${reduced.id}'`);

    await asUser(directorUser);
    await rpc(`public.rpc_reverse_client_sale('${sale.sale_id}', 'vazn sotuvini bekor qilish', null)`);
    const pieces = await heldPieces(consId);
    expect(pieces.map((p) => Number(p.weight_grams))).toEqual([8, 9]);
  });

  it("reversing a settlement whose advance was already spent turns that advance back into debt", async () => {
    await asUser(directorUser);
    const cons = await issue(sellerB, [{ w: 10 }]);
    const [piece] = await heldPieces(String(cons.consignment_id));

    // Customer B has no debt: 1,800,000 UZS at 900,000 UZS/g becomes a 2 g advance.
    await asUser(sellerBUser);
    const pay = await rpc(`public.rpc_record_client_settlement(p_customer_id := '${customerB}', p_cash_amount := 1800000, p_rate_per_gram := 900000)`);
    expect(Number(pay.excess_gold_grams)).toBe(2);

    // 10 g @ 0% sale consumes the 2 g advance -> 8 g debt
    await rpc(`public.rpc_record_barcode_piece_sale(p_customer_id := '${customerB}', p_piece_id := '${piece!.id}', p_client_markup_pct := 0)`);
    await asAdmin();
    expect(await scalar(`(SELECT current_debt_grams FROM public.client_gold_accounts WHERE customer_id = '${customerB}')`)).toBe(8);

    await asUser(directorUser);
    const rev = await rpc(`public.rpc_reverse_client_settlement('${pay.settlement_id}', 'pul qaytarildi', null)`);
    expect(Number(rev.advance_shortfall_added_to_debt_grams)).toBe(2);
    await asAdmin();
    const acc = (await db.query<{ current_debt_grams: string; advance_balance_grams: string }>(
      `SELECT current_debt_grams, advance_balance_grams FROM public.client_gold_accounts WHERE customer_id = '${customerB}'`)).rows[0]!;
    expect(Number(acc.current_debt_grams)).toBe(10);
    expect(Number(acc.advance_balance_grams)).toBe(0);
  });

  it("clients cannot write ledger/stock tables directly, but can still read them", async () => {
    await asUser(directorUser);
    await expectError(`UPDATE public.manager_vault_account SET manager_cash_amount = 999999999`, "permission denied");
    await expectError(`UPDATE public.consignment_pieces SET weight_grams = 0.01`, "permission denied");
    await expectError(`INSERT INTO public.daily_gold_rates (organization_id, rate_per_gram) VALUES ('${orgId}', 1)`, "permission denied");
    await expectError(`UPDATE public.client_gold_accounts SET current_debt_grams = 0`, "permission denied");
    const rows = await db.query(`SELECT 1 FROM public.consignment_pieces LIMIT 1`);
    expect(rows.rows.length).toBe(1);
    await expectError(`SELECT public.recalc_seller_gold_account('${sellerA}', '${orgId}')`, "permission denied");
  });

  it("seller data isolation: no access to another seller's statement or stock, or another organization's stock", async () => {
    await asUser(sellerBUser);
    await expectError(`SELECT public.rpc_get_seller_reconciliation_statement('${sellerA}')`, "o'z hisobotini");
    await expectError(`SELECT public.get_seller_available_stock_grams('${sellerA}')`, "o'z qoldig'ini");
    const own = await rpc(`public.rpc_get_seller_reconciliation_statement('${sellerB}')`);
    expect(own.status).toBe("ok");
    await expectError(`SELECT public.get_manager_available_stock_grams('${otherOrgId}')`, "boshqa tashkilot");
  });

  it("the mobile 'return' path (rpc_return_piece_to_factory) works and really reduces the seller obligation", async () => {
    await asUser(directorUser);
    const cons = await issue(sellerA, [{ w: 4 }]);
    const [piece] = await heldPieces(String(cons.consignment_id));
    const before = await scalar(`(SELECT total_seller_obligation_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerA}')`);

    await asUser(sellerAUser);
    const res = await rpc(`public.rpc_return_piece_to_factory('${piece!.id}', 'mobil qaytarish', null)`);
    expect(res.status).toBe("ok");
    expect(Number(res.factory_due_deducted_grams)).toBe(4.48);
    await asAdmin();
    const after = await scalar(`(SELECT total_seller_obligation_g FROM public.seller_gold_accounts WHERE seller_id = '${sellerA}')`);
    expect(Math.round((before - after) * 10000) / 10000).toBe(4.48);
  });
});
