import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 075 (real PostgreSQL 17 via PGlite, business calls as role `authenticated`):
//   F-STG-1 customer codes are numbered per organization, overflow-safe, and customers cannot be inserted directly;
//   F-STG-2 rpc_get_factory_settings never returns another organization's settings.
// The 074 behaviour is reproduced first by running the 075 rollback on the same database.

const MIG = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260101000075_goldia_customer_codes_per_org_and_factory_settings_isolation.sql"), "utf8");
const ROLLBACK = fs.readFileSync(path.resolve(process.cwd(), "supabase/rollback/20260101000075_rollback.sql"), "utf8");
const POSTFLIGHT = fs.readFileSync(path.resolve(process.cwd(), "supabase/release/075_postflight_readonly.sql"), "utf8")
  .split("\n").filter((l) => !/^\s*--/.test(l) && !/^\s*(begin transaction read only|rollback);\s*$/i.test(l)).join("\n").trim().replace(/;\s*$/, "");

describe("Goldia 075 — per-organization customer codes and tenant-pinned factory settings", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgA = "00000000-0000-0000-0000-0000000a0075";
  const orgB = "00000000-0000-0000-0000-0000000b0075";
  let dirA: { userId: string; employeeId: string }, mgrA: { userId: string; employeeId: string };
  let selA: { userId: string; employeeId: string }, selA2: { userId: string; employeeId: string };
  let workerA: { userId: string; employeeId: string }, dirB: { userId: string; employeeId: string }, selB: { userId: string; employeeId: string };
  let legacyCustomerB: string;

  const create = (name: string, extra = "") => t.rpc(`public.rpc_create_customer_with_code(p_contact_name => '${name}'${extra})`);
  const codesOf = async (org: string) => (await t.db.query<{ c: string }>(`SELECT customer_code AS c FROM public.customers WHERE organization_id = '${org}' ORDER BY customer_code`)).rows.map((r) => r.c);
  const snapshot = async () => {
    await t.asAdmin();
    return JSON.stringify((await t.db.query(`SELECT c.id, c.organization_id, c.customer_code, c.contact_name, a.current_debt_grams, a.advance_balance_grams
      FROM public.customers c LEFT JOIN public.client_gold_accounts a ON a.customer_id = c.id ORDER BY c.id`)).rows);
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES
      ('${orgA}', 'org-a-075', 'Org A', 'ACTIVE'), ('${orgB}', 'org-b-075', 'Org B', 'ACTIVE')`);
    dirA = await t.addUser(orgA, "dira075@goldia.uz", "DirA", "director");
    mgrA = await t.addUser(orgA, "mgra075@goldia.uz", "MgrA", "production_manager");
    selA = await t.addUser(orgA, "sela075@goldia.uz", "SelA", "sales");
    selA2 = await t.addUser(orgA, "sela2075@goldia.uz", "SelA2", "sales");
    workerA = await t.addUser(orgA, "wrka075@goldia.uz", "WrkA", "worker");
    dirB = await t.addUser(orgB, "dirb075@goldia.uz", "DirB", "director");
    selB = await t.addUser(orgB, "selb075@goldia.uz", "SelB", "sales");
  }, 120_000);

  it("074 (rolled back): one long code in another organization breaks customer creation for everybody", async () => {
    await t.asAdmin();
    await t.db.exec(ROLLBACK);
    // the shape found on staging (another tenant), planted by a plain seller with a direct INSERT
    await t.asUser(selB.userId);
    await t.db.exec(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${orgB}', 'CUST-T056_1793002353699', 'planted', '${selB.employeeId}')`);
    await t.asUser(selA.userId);
    await t.expectError(`SELECT public.rpc_create_customer_with_code(p_contact_name => 'A first')`, "out of range for type integer");
    await t.asUser(dirB.userId);
    const other = await t.rpc(`public.rpc_get_factory_settings('${orgA}')`);
    expect(other.organizationId).toBe(orgA); // F-STG-2 at 074
  });

  it("075 keeps every existing customer, code and balance unchanged; applying twice is a no-op", async () => {
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.customers (organization_id, customer_code, contact_name) VALUES ('${orgB}', 'CUST-0005', 'Legacy B')`);
    legacyCustomerB = (await t.db.query<{ id: string }>(`SELECT id FROM public.customers WHERE customer_code = 'CUST-0005'`)).rows[0]!.id;
    await t.db.exec(`INSERT INTO public.client_gold_accounts (customer_id, organization_id, current_debt_grams) VALUES ('${legacyCustomerB}', '${orgB}', 12.3456)
      ON CONFLICT (customer_id) DO UPDATE SET current_debt_grams = 12.3456`);
    const before = await snapshot();
    await t.db.exec(MIG);
    await t.db.exec(MIG);
    expect(await snapshot()).toBe(before);
    await t.db.exec(`CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('20260101000075') ON CONFLICT DO NOTHING`);
    const pf = (await t.db.query<Record<string, boolean>>(POSTFLIGHT)).rows[0]!;
    expect(Object.entries(pf).filter(([, v]) => v !== true).map(([k]) => k)).toEqual([]);
  });

  it("codes are numbered per organization; long/odd codes are ignored instead of overflowing", async () => {
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.customers (organization_id, customer_code, contact_name) VALUES
      ('${orgA}', 'CUST-99999999999999999999', 'odd A'), ('${orgA}', 'CUST-12AB34', 'hex A')`);
    await t.asUser(selA.userId);
    const a1 = await create("A first");
    const a2 = await create("A second");
    expect([a1.status, a1.customer_code, a2.customer_code]).toEqual(["ok", "CUST-0001", "CUST-0002"]);
    await t.asUser(selB.userId);
    const b1 = await create("B first");
    expect(b1.customer_code).toBe("CUST-0006"); // continues org B's own CUST-0005, not org A's numbers
    await t.asUser(dirB.userId);
    expect((await create("B director")).customer_code).toBe("CUST-0007");
    await t.asAdmin();
    expect(await codesOf(orgA)).toEqual(["CUST-0001", "CUST-0002", "CUST-12AB34", "CUST-99999999999999999999"]);
  });

  it("same code may exist in two organizations; duplicate name inside one org returns the existing customer", async () => {
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.customers (organization_id, customer_code, contact_name) VALUES ('${orgB}', 'CUST-0001', 'B with A code')`);
    await t.expectError(`INSERT INTO public.customers (organization_id, customer_code, contact_name) VALUES ('${orgA}', 'CUST-0001', 'dup')`, "customers_org_customer_code_key");
    await t.asUser(selA.userId);
    const again = await create("a first");
    expect(again.status).toBe("existing");
  });

  it("direct INSERT is refused for every role; code/organization cannot be rewritten directly; other edits still work", async () => {
    for (const u of [selA, mgrA, dirA]) {
      await t.asUser(u.userId);
      await t.expectError(`INSERT INTO public.customers (organization_id, customer_code, contact_name) VALUES ('${orgA}', 'CUST-T999_9999999999999', 'direct')`, "permission denied for table customers");
    }
    await t.asUser(dirA.userId);
    const target = (await t.db.query<{ id: string }>(`SELECT id FROM public.customers WHERE organization_id = '${orgA}' AND customer_code = 'CUST-0001'`)).rows[0]!.id;
    await t.expectError(`UPDATE public.customers SET customer_code = 'CUST-T999_9999999999999' WHERE id = '${target}'`, "faqat server tomonidan");
    await t.expectError(`UPDATE public.customers SET organization_id = '${orgB}' WHERE id = '${target}'`, "faqat server tomonidan");
    await t.db.exec(`UPDATE public.customers SET phone = '+998900000075' WHERE id = '${target}'`);
    await t.asAdmin();
    expect((await t.db.query<{ p: string }>(`SELECT phone AS p FROM public.customers WHERE id = '${target}'`)).rows[0]!.p).toBe("+998900000075");
    await t.db.exec(`RESET ROLE; SET ROLE anon;`);
    await t.expectError(`SELECT count(*) FROM public.customers`, "permission denied for table customers");
    await t.expectError(`SELECT public.rpc_create_customer_with_code(p_contact_name => 'anon')`, "permission denied for function");
    await t.asAdmin();
  });

  it("caller role and p_seller_id are checked; directors/managers keep creating for their sellers", async () => {
    await t.asUser(workerA.userId);
    await t.expectError(`SELECT public.rpc_create_customer_with_code(p_contact_name => 'by worker')`, "mijoz yaratish huquqi");
    await t.asUser(selA.userId);
    await t.expectError(`SELECT public.rpc_create_customer_with_code(p_contact_name => 'for A2', p_seller_id => '${selA2.employeeId}')`, "faqat o'zi uchun");
    await t.expectError(`SELECT public.rpc_create_customer_with_code(p_contact_name => 'for B', p_seller_id => '${selB.employeeId}')`, "boshqa tashkilotga");
    await t.asUser(mgrA.userId);
    const m = await create("manager for A2", `, p_seller_id => '${selA2.employeeId}'`);
    expect([m.status, m.seller_id]).toEqual(["ok", selA2.employeeId]);
    await t.asUser(dirA.userId);
    await t.expectError(`SELECT public.rpc_create_customer_with_code(p_contact_name => 'dir for B', p_seller_id => '${selB.employeeId}')`, "boshqa tashkilotga");
  });

  it("legacy register RPC still creates customers (SECURITY DEFINER path) and its codes do not disturb numbering", async () => {
    await t.asUser(selA.userId);
    const r = await t.rpc(`public.rpc_register_or_get_customer('Mobile mijoz', '+998901112233', NULL, NULL)`);
    expect(String(r.customer_code)).toMatch(/^CUST-/);
    // its random 6-hex code is sometimes all digits; numbering then simply continues after it (still canonical, no overflow)
    await t.asAdmin();
    const max = Number((await t.db.query<{ m: string }>(`SELECT max(substring(customer_code FROM '^CUST-([0-9]{1,9})$')::bigint)::text AS m FROM public.customers WHERE organization_id = '${orgA}'`)).rows[0]!.m);
    await t.asUser(selA.userId);
    expect((await create("after mobile")).customer_code).toBe(`CUST-${String(max + 1).padStart(4, "0")}`);
  });

  it("numbers above 9999 are not truncated (038 lpad turned 10000 into CUST-1000)", async () => {
    await t.asAdmin();
    await t.db.exec(`INSERT INTO public.customers (organization_id, customer_code, contact_name) VALUES ('${orgB}', 'CUST-9999', 'B 9999')`);
    await t.asUser(selB.userId);
    expect((await create("B ten thousand")).customer_code).toBe("CUST-10000");
    expect((await create("B ten thousand one")).customer_code).toBe("CUST-10001");
  });

  it("rpc_get_factory_settings: own organization only, no fallback for users without an organization", async () => {
    await t.asUser(dirA.userId);
    expect((await t.rpc(`public.rpc_get_factory_settings(NULL)`)).organizationId).toBe(orgA);
    expect((await t.rpc(`public.rpc_get_factory_settings('${orgA}')`)).organizationId).toBe(orgA);
    await t.expectError(`SELECT public.rpc_get_factory_settings('${orgB}')`, "boshqa tashkilot sozlamalari");
    await t.asUser(selA.userId);
    await t.expectError(`SELECT public.rpc_get_factory_settings('${orgB}')`, "boshqa tashkilot sozlamalari");
    await t.asUser(mgrA.userId);
    const upd = await t.rpc(`public.rpc_update_factory_settings(p_workers_count => 41)`);
    expect(upd.status).toBe("ok");
    expect((await t.rpc(`public.rpc_get_factory_settings(NULL)`)).workersCount).toBe(41);
    await t.asUser(dirB.userId);
    expect((await t.rpc(`public.rpc_get_factory_settings(NULL)`)).workersCount).not.toBe(41);
    await t.asAdmin();
    const noEmp = (await t.db.query<{ id: string }>(`INSERT INTO auth.users (email) VALUES ('noemp075@goldia.uz') RETURNING id`)).rows[0]!.id;
    await t.asUser(noEmp);
    await t.expectError(`SELECT public.rpc_get_factory_settings(NULL)`, "active organization");
    await t.expectError(`SELECT public.rpc_get_factory_settings('${orgA}')`, "active organization");
    await t.asAdmin();
  });

  it("rollback refuses while two organizations share a code, so it never renames customers", async () => {
    await t.asAdmin();
    let msg = "";
    try { await t.db.exec(ROLLBACK); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain("ROLLBACK 075 REFUSED");
    expect((await t.db.query(`SELECT 1 FROM pg_constraint WHERE conname = 'customers_org_customer_code_key'`)).rows.length).toBe(1);
  });
});
