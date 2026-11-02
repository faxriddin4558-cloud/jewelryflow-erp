import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";
import { buildSellerDashboard } from "@/components/sales/SellerDashboard";
import { isRouteAllowedForSeller, isSellerUiRole } from "@/lib/sales-role-access";

// Migration 071 + seller UI cleanup: sellers see only their own data; company totals, the manager stock,
// factory/refining/vault and other sellers' data are refused by the database itself. Director and manager
// keep their screens. Calls run as the `authenticated` role with RLS on.

describe("Goldia 071 — seller role access", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgId = "00000000-0000-0000-0000-0000000000f1";
  let director: { userId: string; employeeId: string };
  let manager: { userId: string; employeeId: string };
  let sellerA: { userId: string; employeeId: string; customer: string };
  let sellerB: { userId: string; employeeId: string; customer: string };

  const newSeller = async (tag: string) => {
    const s = await t.addUser(orgId, `${tag}@goldia.uz`, tag, "sales");
    await t.asAdmin();
    const c = (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${orgId}', 'C-${tag}', 'Mijoz ${tag}', '+998900000000', '${s.employeeId}') RETURNING id`)).rows[0]!.id;
    return { ...s, customer: c };
  };
  const consign = async (sellerId: string, n: number) => {
    await t.asUser(director.userId);
    const pieces = JSON.stringify(Array.from({ length: n }, () => ({ weight_grams: 100, model_code: "M1" })));
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${sellerId}', p_factory_markup_pct := 8,
      p_pieces := '${pieces}'::jsonb, p_notes := 'test', p_seller_markup_pct := 12)`);
  };
  const companyStock = async () => {
    await t.asAdmin();
    return t.scalar(`public.get_manager_available_stock_grams('${orgId}')`);
  };
  const asAnon = () => t.db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;`);

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${orgId}', 'goldia-071', 'Goldia 071', 'ACTIVE')`);
    director = await t.addUser(orgId, "dir071@goldia.uz", "Direktor", "director");
    manager = await t.addUser(orgId, "mgr071@goldia.uz", "Menejer", "manager");
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.factory_receipts (organization_id, receipt_no, product_name, original_physical_g,
      available_physical_g, proba, factory_markup_pct, factory_obligation_g, status)
      VALUES ('${orgId}', 'ZVD-071', 'Partiya 071', 3000, 3000, 585, 8, 3240, 'in_manager_stock')`);
    sellerA = await newSeller("sa071");
    sellerB = await newSeller("sb071");
    await consign(sellerA.employeeId, 3);
    await consign(sellerB.employeeId, 2);
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${sellerA.customer}', p_weight_grams := 50, p_client_markup_pct := 15)`);
  });

  it("a seller cannot read the company manager stock, directly or through the wrapper", async () => {
    await t.asUser(sellerA.userId);
    await t.expectError(`SELECT public.get_manager_available_stock_grams()`, "permission denied for function");
    await t.expectError(`SELECT public.get_manager_available_stock_grams('${orgId}')`, "permission denied for function");
    await t.expectError(`SELECT public.rpc_get_manager_available_stock_grams()`, "Permission denied");
    await asAnon();
    await t.expectError(`SELECT public.rpc_get_manager_available_stock_grams()`, "permission denied for function");
    await t.expectError(`SELECT public.get_manager_available_stock_grams()`, "permission denied for function");
  });

  it("director and manager still read the same manager stock", async () => {
    const expected = await companyStock();
    expect(expected).toBe(2500); // 3000 received - 5 x 100 consigned
    for (const u of [director, manager]) {
      await t.asUser(u.userId);
      expect(await t.scalar(`public.rpc_get_manager_available_stock_grams()`)).toBe(expected);
    }
  });

  it("seller workflows that use the helper internally keep working (return a piece to the manager)", async () => {
    await t.asAdmin();
    const piece = (await t.db.query<{ id: string }>(`SELECT id FROM public.consignment_pieces
      WHERE seller_id = '${sellerA.employeeId}' AND status = 'held_by_seller' AND weight_grams = 100 LIMIT 1`)).rows[0]!.id;
    const before = await companyStock();
    await t.asUser(sellerA.userId);
    await t.rpc(`public.rpc_return_piece_to_manager('${piece}', 'qaytarildi', null)`);
    expect(await companyStock()).toBe(before + 100);
    await t.asUser(director.userId);
    expect(await t.scalar(`public.rpc_get_manager_available_stock_grams()`)).toBe(before + 100);
  });

  it("seller dashboard sources are own-scoped and add up", async () => {
    await t.asUser(sellerA.userId);
    const st = await t.rpc(`public.rpc_get_seller_reconciliation_statement('${sellerA.employeeId}')`);
    const pieces = (await t.db.query<{ model_code: string; weight_grams: string }>(
      `SELECT model_code, weight_grams FROM public.consignment_pieces WHERE status = 'held_by_seller'`)).rows;
    const ledger = (await t.db.query<Record<string, unknown>>(
      `SELECT * FROM public.rpc_get_daily_sales_ledger('${sellerA.employeeId}', current_date, current_date)`)).rows;
    const markup = await t.rpc(`public.rpc_get_seller_markup_difference_report('${sellerA.employeeId}', null, null)`);
    const d = buildSellerDashboard(st as never, pieces as never, ledger as never, Number(markup.total_difference_g));

    // 3 x 100 consigned, 50 g sold, one 100 g piece returned -> 150 g on the shelf
    expect(d.stockG).toBe(150);
    expect(d.stockModels).toBe(1);
    expect(d.obligationSigned).toBeLessThan(0); // seller owes the manager
    expect(d.customersDebtG).toBeGreaterThan(0);
    expect(d.todaySales).toBe(1);
    expect(d.todaySoldG).toBe(50);
    expect(d.markupDiffG).toBeCloseTo(1.5, 4); // 50 g x (15 % - 12 %)
    // Only seller A's own rows are visible
    expect(ledger.every((r) => r.seller_id === sellerA.employeeId)).toBe(true);
    expect((await t.db.query(`SELECT 1 FROM public.consignment_pieces WHERE seller_id = '${sellerB.employeeId}'`)).rows.length).toBe(0);
  });

  it("a seller cannot read another seller's statement, ledger, customers or pieces", async () => {
    await t.asUser(sellerA.userId);
    await t.expectError(`SELECT public.rpc_get_seller_reconciliation_statement('${sellerB.employeeId}')`, "o'z");
    let ledgerB: Record<string, unknown>[] = [];
    try {
      ledgerB = (await t.db.query<Record<string, unknown>>(
        `SELECT * FROM public.rpc_get_daily_sales_ledger('${sellerB.employeeId}', null, null)`)).rows;
    } catch { ledgerB = []; }
    expect(ledgerB.some((r) => r.seller_id === sellerB.employeeId)).toBe(false);
    for (const table of ["customers", "client_gold_accounts", "seller_gold_accounts", "jewelry_sales", "seller_consignments"]) {
      const rows = (await t.db.query(`SELECT 1 FROM public.${table} WHERE seller_id = '${sellerB.employeeId}'`)).rows;
      expect(rows.length, table).toBe(0);
    }
  });

  it("a seller cannot read company reports, vault, factory, refining or purchases, nor set the rate", async () => {
    await t.asUser(sellerA.userId);
    for (const fn of [
      "rpc_get_accounting_profit_summary()",
      "rpc_get_company_rate_difference_report()",
      "rpc_get_financial_reconciliation_summary()",
      "rpc_get_three_tier_ledger_summary()",
      "rpc_get_director_sales_overview()",
    ]) {
      await t.expectError(`SELECT public.${fn}`, "ermission denied");
    }
    for (const table of ["manager_vault_account", "factory_receipts", "factory_gold_handovers", "refining_batches", "gold_purchases", "company_rate_differences"]) {
      expect((await t.db.query(`SELECT 1 FROM public.${table}`)).rows.length, table).toBe(0);
    }
    await t.expectError(`SELECT public.rpc_set_daily_gold_rate(900000)`, "ermission denied");
  });

  it("director and manager keep the company dashboard reads", async () => {
    for (const u of [director, manager]) {
      await t.asUser(u.userId);
      expect((await t.db.query(`SELECT 1 FROM public.seller_gold_accounts`)).rows.length).toBe(2);
      expect((await t.db.query(`SELECT 1 FROM public.factory_receipts`)).rows.length).toBe(1);
      const summary = await t.rpc(`public.rpc_get_three_tier_ledger_summary()`);
      expect(summary).toBeTruthy();
    }
  });
});

describe("Seller UI route allowlist", () => {
  it("recognizes seller role spellings", () => {
    for (const r of ["Seller", "seller", "sales", "Sotuvchi"]) expect(isSellerUiRole(r)).toBe(true);
    for (const r of ["Director", "manager", "Production Manager", "Accountant", "", null, undefined]) expect(isSellerUiRole(r)).toBe(false);
  });

  it("allows only the seller's own screens", () => {
    for (const p of ["/sales/app", "/sales/app/", "/sales/app/customers", "/sales/mobile"]) expect(isRouteAllowedForSeller(p), p).toBe(true);
    for (const p of [
      "/sales/app/cash", "/sales/app/factory", "/sales/app/factory-receive", "/sales/app/handovers", "/sales/app/inventory",
      "/sales/app/consignments", "/sales/app/sellers", "/sales/app/refining", "/sales/app/purchases", "/sales/app/reports",
      "/sales/app/models", "/sales/app/users", "/sales/app/settings", "/sales/director", "/sales/app/customersX",
    ]) expect(isRouteAllowedForSeller(p), p).toBe(false);
  });
});
