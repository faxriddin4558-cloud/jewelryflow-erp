import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 069: no anonymous access to SECURITY DEFINER RPCs; rpc_get_unified_customer_ledger needs a
// real session, organization and role, with seller isolation and no financial writes from strangers.

describe("Goldia 069 — anon/role security hotfix", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const orgA = "00000000-0000-0000-0000-00000000a001";
  const orgB = "00000000-0000-0000-0000-00000000b002";
  let dirA: { userId: string; employeeId: string };
  let sellerA1: { userId: string; employeeId: string };
  let sellerA2: { userId: string; employeeId: string };
  let dirB: { userId: string; employeeId: string };
  let custA1: string, custA2: string, custB: string;

  const asAnon = () => t.db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', true); SELECT set_config('request.jwt.claim.role', 'anon', true); SET ROLE anon;`);
  const ledger = (customer?: string, seller?: string) =>
    t.rpc(`public.rpc_get_unified_customer_ledger(${customer ? `p_customer_id := '${customer}'` : "p_customer_id := null"}${seller ? `, p_seller_id := '${seller}'` : ""})`);
  const customerNames = (r: Record<string, unknown>) => {
    const rows = (r.items ?? []) as Record<string, unknown>[];
    return Array.isArray(rows) ? rows.map((x) => x.customer_id) : [];
  };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES
      ('${orgA}', 'org-a', 'Org A', 'ACTIVE'), ('${orgB}', 'org-b', 'Org B', 'ACTIVE')`);
    const mk = async (org: string, tag: string, role: string) => {
      const s = await t.addUser(org, `${tag}@goldia.uz`, tag, role);
      return s;
    };
    dirA = await mk(orgA, "dirA", "director");
    sellerA1 = await mk(orgA, "sellerA1", "sales");
    sellerA2 = await mk(orgA, "sellerA2", "sales");
    dirB = await mk(orgB, "dirB", "director");
    const cust = async (org: string, code: string, seller: string) =>
      (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
        VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99890${code}', '${seller}') RETURNING id`)).rows[0]!.id;
    custA1 = await cust(orgA, "A1", sellerA1.employeeId);
    custA2 = await cust(orgA, "A2", sellerA2.employeeId);
    custB = await cust(orgB, "B1", dirB.employeeId);
  });

  it("1-2: anon and unauthenticated are denied EXECUTE on the ledger and on financial-write RPCs", async () => {
    await asAnon();
    await t.expectError(`SELECT public.rpc_get_unified_customer_ledger(null, null)`, "permission denied for function");
    await t.expectError(`SELECT public.rpc_record_weight_sale(p_customer_id := '${custA1}', p_weight_grams := 1, p_client_markup_pct := 10)`, "permission denied for function");
    await t.expectError(`SELECT public.rpc_reverse_financial_transaction('${custA1}'::uuid, 'x', null)`, "permission denied for function");
    // No anon-executable SECURITY DEFINER rpc_* remains
    const left = await t.scalar(`(SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef AND p.proname LIKE 'rpc\\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE'))`);
    expect(left).toBe(0);
  });

  it("3-4: a signed-in user without an employee row, or with no org, is denied", async () => {
    await t.asAdmin();
    const ghost = (await t.db.query<{ id: string }>(`INSERT INTO auth.users (email) VALUES ('ghost@x.uz') RETURNING id`)).rows[0]!.id;
    await t.asUser(ghost); // authenticated, but no employee -> no org, no role
    await t.expectError(`SELECT public.rpc_get_unified_customer_ledger(null, null)`, "Permission denied");
  });

  it("5: a cross-tenant request cannot read the other organization's customers", async () => {
    await t.asUser(dirA.userId);
    // Director A asks for org B's customer: the function filters by the caller's own org, so B is not returned.
    const r = await ledger(custB);
    expect(customerNames(r)).not.toContain(custB);
    const own = await ledger();
    expect(customerNames(own).map(String).sort()).toEqual([custA1, custA2].sort());
  });

  it("6-7: a seller sees only their own customers and cannot read another seller's", async () => {
    await t.asUser(sellerA1.userId);
    expect(customerNames(await ledger()).map(String)).toEqual([custA1]);
    await t.expectError(`SELECT public.rpc_get_unified_customer_ledger(p_customer_id := '${custA2}')`, "biriktirilmagan");
    await t.expectError(`SELECT public.rpc_get_unified_customer_ledger(p_seller_id := '${sellerA2.employeeId}')`, "Cross-seller");
  });

  it("8-9: director and manager see their authorized organization data", async () => {
    await t.asUser(dirA.userId);
    expect(customerNames(await ledger()).length).toBe(2);
    await t.asUser(dirB.userId);
    expect(customerNames(await ledger()).map(String)).toEqual([custB]);
  });

  it("10: an unauthorized ledger call never mutates client_gold_accounts", async () => {
    await t.asAdmin();
    const snap = async () => (await t.db.query<{ v: string }>(
      `SELECT coalesce(string_agg(customer_id || ':' || current_debt_grams || ':' || advance_balance_grams, ',' ORDER BY customer_id), '-') AS v FROM public.client_gold_accounts`)).rows[0]!.v;
    const before = await snap();
    await asAnon();
    let denied = false;
    try { await t.db.query(`SELECT public.rpc_get_unified_customer_ledger(null, null)`); } catch { denied = true; }
    expect(denied).toBe(true);
    await t.asAdmin();
    expect(await snap()).toBe(before);
  });

  it("11-12: authenticated roles keep EXECUTE on every RPC 069 touched, and the ledger shape is intact", async () => {
    // 069 only changed EXECUTE grants and the ledger's guards. Prove authenticated still holds EXECUTE on
    // every SECURITY DEFINER rpc_* (so no workflow lost access) and the ledger still returns {items, summary}.
    await t.asAdmin();
    const lost = await t.scalar(`(SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef AND p.proname LIKE 'rpc\\_%' AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    expect(lost).toBe(0);
    const anonLeft = await t.scalar(`(SELECT count(*) FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.proname LIKE 'rpc\\_%'
      AND a.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = 'anon')))`);
    expect(anonLeft).toBe(0);

    // A real director read still returns the documented shape and only its own organization's customers.
    await t.asUser(dirA.userId);
    const r = await ledger();
    expect(r.items).toBeDefined();
    expect(r.summary).toBeDefined();
    expect(customerNames(r).map(String).sort()).toEqual([custA1, custA2].sort());
  });
});
