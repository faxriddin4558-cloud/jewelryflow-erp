import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 092 (2026-11-19, owner rule): an old-sale return's 585 value lowers THIS customer's old (opening) debt first, then his
// new debt, the rest becomes his advance; an old debt of 0 / no opening debt document does not block the return.
// Old / new / advance parts stored apart; balances never negative; no double credit; seller obligation, stock and the
// manager handover rules unchanged; opening documents (LOCK) untouched.
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 092 — old-sale return: old debt -> new debt -> advance, no opening debt allowed", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-000000000921";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S1: U, S2: U;
  let cO = "", cN = "", cA = "", cB = "";
  let kn = 0;
  const key = (p: string) => `t92-${p}-${++kn}`;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const doc = async (args: string) => { await t.asUser(mgr.userId); return t.rpc(`public.rpc_record_opening_document(${args}, p_idempotency_key := '${key("d")}')`); };
  const gnet = async (c: string) => { const r = await one(`SELECT current_debt_grams d, advance_balance_grams a FROM public.client_gold_accounts WHERE customer_id = '${c}'`); return r4(N(r.d) - N(r.a)); };
  const sacc = async (s: U) => one(`SELECT seller_owes_manager_g o, current_physical_stock_g st FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`);
  const mgrStock = async () => N((await one(`SELECT public.get_manager_available_stock_grams('${org}') v`)).v);
  const ret = (c: string, w: number, pct: number, recv: string, k: string) =>
    `public.rpc_record_opening_sale_return(p_customer_id := '${c}', p_unit := 'G585', p_weight_grams := ${w}, p_customer_markup_pct := ${pct}, p_credit_amount := null, p_receiver := '${recv}', p_seller_markup_pct := null, p_reason := 'eski savdo qaytdi', p_confirmed := true, p_idempotency_key := '${k}')`;
  const ledger = async (c: string) => { await t.asUser(mgr.userId); const r = await t.rpc(`public.rpc_get_unified_customer_ledger(p_customer_id := '${c}')`); return (r.items as Record<string, unknown>[])[0] ?? {}; };
  const sell = async (s: U, c: string, w: number, pct: number) => { await t.asUser(s.userId); return t.rpc(`public.rpc_record_weight_sale(p_customer_id := '${c}', p_weight_grams := ${w}, p_client_markup_pct := ${pct}, p_idempotency_key := '${key("s")}')`); };
  let openingDocs = "";

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-92', 'Goldia 92', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-92@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-92@goldia.uz", "Menejer", "manager");
    S1 = await t.addUser(org, "s1-92@goldia.uz", "Sotuvchi 1", "sales");
    S2 = await t.addUser(org, "s2-92@goldia.uz", "Sotuvchi 2", "sales");
    const c = async (code: string, s: U) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99891${code.replace(/\D/g, "").padStart(7, "0")}', '${s.employeeId}') RETURNING id`)).id as string;
    cO = await c("O-1", S1); cN = await c("N-2", S1); cA = await c("A-3", S1); cB = await c("B-4", S2);
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, 900000, 'UZS', true), ('${org}', public._goldia_business_date(), 585, 900000, 'UZS', true) ON CONFLICT DO NOTHING`);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 't92', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 't92.dump', true) RETURNING id`)).id;
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 't92', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 't92-restart')`);
    const a = (await doc(`p_kind := 'manager_inventory', p_physical_g := 100, p_factory_markup_pct := 8`)).document_id as string;
    await doc(`p_kind := 'seller_inventory', p_seller_id := '${S1.employeeId}', p_pieces := '[{"weight_grams":30}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := '${a}'`);
    await doc(`p_kind := 'seller_inventory', p_seller_id := '${S2.employeeId}', p_pieces := '[{"weight_grams":10}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := '${a}'`);
    await doc(`p_kind := 'customer_gram', p_customer_id := '${cO}', p_side := 'debt', p_amount := 10`);   // old debt 10 g
    await doc(`p_kind := 'customer_gram', p_customer_id := '${cA}', p_side := 'debt', p_amount := 4`);    // old debt 4 g, no new
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0 t92', p_idempotency_key := '${key("b")}', p_usd_rate := 12500)`);
    openingDocs = JSON.stringify((await t.db.query(`SELECT id, amount, status, side FROM public.opening_documents WHERE organization_id = '${org}' ORDER BY id`)).rows);
    await sell(S1, cN, 5, 10);   // N: no old debt, new 5.5
    await sell(S1, cO, 5, 10);   // O: old 10 + new 5.5
  }, 240000);

  it("R1 no old debt (no opening document): not blocked - 2 g x 1.1 = 2.2 off the NEW debt, advance 0; goods to the manager, seller obligation unchanged", async () => {
    const s0 = await sacc(S1), m0 = await mgrStock();
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT ${ret(cN, 2, 10, "seller", key("x"))}`, "ERR_SELLER_KEEP_NOT_DOCUMENTED"); // no documented old obligation to move
    const k = key("n1");
    const r = await (async () => { await t.asUser(mgr.userId); return t.rpc(ret(cN, 2, 10, "manager", k)); })();
    expect([r.has_opening_document, N(r.credit), N(r.opening_part), N(r.new_debt_part), N(r.advance_created)]).toEqual([false, 2.2, 0, 2.2, 0]);
    expect(await gnet(cN)).toBe(3.3);
    const st = await one(`SELECT opening_document_id d, opening_part o, new_debt_part n, advance_created a FROM public.opening_sale_returns WHERE id = '${r.return_id}'`);
    expect([st.d, N(st.o), N(st.n), N(st.a)]).toEqual([null, 0, 2.2, 0]);
    expect(N((await sacc(S1)).o)).toBe(N(s0.o));                 // seller obligation unchanged
    expect(N((await sacc(S1)).st)).toBe(N(s0.st));               // seller stock unchanged (the lot went on to the manager)
    expect(r4((await mgrStock()) - m0)).toBe(2);                 // manager stock + 2 g physical
    // replay: the same request credits once
    const again = await (async () => { await t.asUser(mgr.userId); return t.rpc(ret(cN, 2, 10, "manager", k)); })();
    expect(again.return_id).toBe(r.return_id);
    expect(await gnet(cN)).toBe(3.3);
  });

  it("R2 old 10 + new 5.5: a 13 g return takes 10 off the old and 3 off the new; the next 5 g return: old 0, new 2.5, advance 2.5", async () => {
    await t.asUser(mgr.userId);
    const a = await t.rpc(ret(cO, 10, 30, "manager", key("o1")));
    expect([N(a.credit), N(a.opening_part), N(a.new_debt_part), N(a.advance_created)]).toEqual([13, 10, 3, 0]);
    expect(await gnet(cO)).toBe(2.5);
    const b = await t.rpc(ret(cO, 5, 0, "manager", key("o2")));
    expect([N(b.credit), N(b.opening_part), N(b.new_debt_part), N(b.advance_created)]).toEqual([5, 0, 2.5, 2.5]);
    expect(await gnet(cO)).toBe(-2.5);                            // advance 2.5
    const L = await ledger(cO);
    // the ledger: old column exactly what is left of the old debt (0, never negative), net / advance = the stored account
    expect([N(L.legacy_debt_g), N(L.net_debt_g), N(L.available_advance_g)]).toEqual([0, 0, 2.5]);
    // the parts add up to the value; nothing credited twice
    const sum = await one(`SELECT sum(credit_amount) c, sum(opening_part) o, sum(new_debt_part) n, sum(advance_created) a FROM public.opening_sale_returns WHERE customer_id = '${cO}' AND status = 'confirmed'`);
    expect([N(sum.c), N(sum.o), N(sum.n), N(sum.a)]).toEqual([18, 10, 5.5, 2.5]);
  });

  it("R3 old debt only (4 g), return 6 g x 1.0: 4 off the old, the rest 2 to the advance; old never below 0", async () => {
    await t.asUser(mgr.userId);
    const r = await t.rpc(ret(cA, 6, 0, "manager", key("a1")));
    expect([N(r.opening_part), N(r.new_debt_part), N(r.advance_created)]).toEqual([4, 0, 2]);
    expect(await gnet(cA)).toBe(-2);
    const L = await ledger(cA);
    expect([N(L.legacy_debt_g), N(L.available_advance_g)]).toEqual([0, 2]);
  });

  it("R4 isolation: another customer / seller untouched; a seller cannot record; opening documents (LOCK) unchanged", async () => {
    const b0 = await gnet(cB), s2 = await sacc(S2);
    await t.asUser(S1.userId);
    await t.expectError(`SELECT ${ret(cN, 1, 10, "manager", key("s"))}`, "ermission");
    expect([await gnet(cB), N((await sacc(S2)).o)]).toEqual([b0, N(s2.o)]);
    await t.asAdmin();
    const docsNow = JSON.stringify((await t.db.query(`SELECT id, amount, status, side FROM public.opening_documents WHERE organization_id = '${org}' ORDER BY id`)).rows);
    expect(docsNow).toBe(openingDocs);
  });

  it("R5 reversal of a return without an opening document restores the customer exactly; double reversal refused; rollback 092 refused", async () => {
    const before = await gnet(cN), m0 = await mgrStock();
    await t.asUser(mgr.userId);
    const r = await t.rpc(ret(cN, 1, 10, "manager", key("n2")));
    expect(await gnet(cN)).toBe(r4(before - 1.1));
    await t.rpc(`public.rpc_reverse_opening_sale_return('${r.return_id}', 'xato', '${key("rv")}')`);
    expect([await gnet(cN), await mgrStock()]).toEqual([before, m0]);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_opening_sale_return('${r.return_id}', 'yana', '${key("rv2")}')`, "allaqachon");
    await t.asAdmin();
    const fs = await import("node:fs");
    let msg = "";
    try { await t.db.exec(fs.readFileSync("supabase/rollback/20260101000092_rollback.sql", "utf8")); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).toContain("ROLLBACK 092 REFUSED");
  });
});
