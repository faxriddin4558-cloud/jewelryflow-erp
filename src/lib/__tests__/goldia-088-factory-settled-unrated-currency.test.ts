import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 088 (2026-11-17): (1) seller goods settled with the factory before T0 leave the factory account only (factory_settled),
// (2) UZS / USD opening customer debts without a rate stay in their currency until each payment values its own part.
// Shape of the real opening: two A documents with DIFFERENT factory %, two sellers with own-receipt B documents, C2.
// Every expected value is computed here (oracle).
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 088 — factory_settled + unrated UZS / USD opening debts", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-0000000008e8";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S1: U, S2: U;
  let c1 = "", c2 = "", c3 = "", c4 = "";
  let a1 = "", b1 = "", b2 = "", b3 = "", fs1 = "", fs3 = "";
  let kn = 0;
  const key = (p: string) => `g88-${p}-${++kn}`;
  const RATE = 900000;
  // the oracle
  const A1 = { g: 300, pct: 8 }, A2 = { g: 198.21, pct: 10 };
  const B1 = { g: 926.92, fpct: 8, spct: 10 }, B2 = { g: 784.17, fpct: 9, spct: 12 };
  const C2 = 1717.58;
  const aObl = r4(A1.g * (1 + A1.pct / 100)) + r4(A2.g * (1 + A2.pct / 100));            // 324 + 218.031
  const b1Fac = r4(B1.g * (1 + B1.fpct / 100)), b2Fac = r4(B2.g * (1 + B2.fpct / 100));   // 1001.0736, 854.7453
  const s1Base = r4(r4(B1.g * (1 + B1.spct / 100)) + 50 + 10);                             // B1 + E 50 g + rated F 10 g
  const s2Base = r4(B2.g * (1 + B2.spct / 100));

  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const doc = async (args: string, who?: U) => { await t.asUser((who ?? mgr).userId); return t.rpc(`public.rpc_record_opening_document(${args}, p_idempotency_key := '${key("d")}')`); };
  const owes = async (s: U) => N((await one(`SELECT seller_owes_manager_g v FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`)).v);
  const stock = async (s: U) => N((await one(`SELECT current_physical_stock_g v FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`)).v);
  const vault = async () => one(`SELECT current_factory_obligation_g o, current_factory_advance_g a, manager_physical_stock_g m FROM public.manager_vault_account WHERE organization_id = '${org}'`);
  const net = async () => { const v = await vault(); return r4(N(v.o) - N(v.a)); };
  type OpeningState = { checks: Record<string, unknown>; totals: Record<string, unknown> };
  const state = async () => { await t.asUser(mgr.userId); return (await t.rpc(`public.rpc_get_opening_state()`)) as unknown as OpeningState; };

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-88', 'Goldia 88', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-88@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-88@goldia.uz", "Menejer", "manager");
    S1 = await t.addUser(org, "s1-88@goldia.uz", "Sotuvchi 1", "sales");
    S2 = await t.addUser(org, "s2-88@goldia.uz", "Sotuvchi 2", "sales");
    const c = async (code: string, s: U) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99890${code.replace(/\D/g, "").padStart(7, "0")}', '${s.employeeId}') RETURNING id`)).id as string;
    c1 = await c("K88-1", S1); c2 = await c("K88-2", S1); c3 = await c("K88-3", S2); c4 = await c("K88-4", S1);
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true), ('${org}', public._goldia_business_date(), 585, ${RATE}, 'UZS', true) ON CONFLICT DO NOTHING`);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 'g88 window', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 'g88.dump', true) RETURNING id`)).id;
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'g88', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 'g88-restart')`);
    a1 = (await doc(`p_kind := 'manager_inventory', p_physical_g := ${A1.g}, p_factory_markup_pct := ${A1.pct}`)).document_id as string;
    await doc(`p_kind := 'manager_inventory', p_physical_g := ${A2.g}, p_factory_markup_pct := ${A2.pct}`);
    b1 = (await doc(`p_kind := 'seller_inventory', p_seller_id := '${S1.employeeId}', p_pieces := '[{"weight_grams":500},{"weight_grams":426.92}]'::jsonb, p_factory_markup_pct := ${B1.fpct}, p_seller_markup_pct := ${B1.spct}`)).document_id as string;
    b2 = (await doc(`p_kind := 'seller_inventory', p_seller_id := '${S2.employeeId}', p_pieces := '[{"weight_grams":784.17}]'::jsonb, p_factory_markup_pct := ${B2.fpct}, p_seller_markup_pct := ${B2.spct}`)).document_id as string;
    await doc(`p_kind := 'factory_advance', p_amount := ${C2}, p_notes := 'oldingi haqdorlik'`);
    await doc(`p_kind := 'customer_gram', p_customer_id := '${c1}', p_side := 'debt', p_amount := 50`);
    await doc(`p_kind := 'customer_currency', p_customer_id := '${c4}', p_unit := 'UZS', p_side := 'debt', p_amount := 9000000, p_lom_rate := 900000`);
  }, 180000);

  it("Z1 before the correction: the seller goods are a factory obligation (the old logic): net = A + B receipts - C2", async () => {
    expect(await net()).toBe(r4(aObl + b1Fac + b2Fac - C2));
    expect(await owes(S1)).toBe(s1Base);
    expect(await owes(S2)).toBe(s2Base);
  });

  it("Z2 factory_settled per B: factory net = A (each with its own %) - C2 (negative = the factory owes the manager); sellers, stock, C2 untouched", async () => {
    fs1 = (await doc(`p_kind := 'factory_settled', p_source_document_id := '${b1}', p_notes := 'T0 dan oldin zavod bilan hisob-kitob qilingan'`)).document_id as string;
    const r2 = await doc(`p_kind := 'factory_settled', p_source_document_id := '${b2}', p_notes := 'T0 dan oldin zavod bilan hisob-kitob qilingan'`);
    expect(N(r2.amount)).toBe(b2Fac);
    expect(N((await one(`SELECT amount v FROM public.opening_documents WHERE id = '${fs1}'`)).v)).toBe(b1Fac);
    const v = await vault();
    expect(r4(N(v.o) - N(v.a))).toBe(r4(aObl - C2));
    expect(N(v.o)).toBe(0);
    expect(N(v.a)).toBe(r4(C2 - aObl));
    expect(N(v.m)).toBe(r4(A1.g + A2.g));
    expect(await owes(S1)).toBe(s1Base);
    expect(await owes(S2)).toBe(s2Base);
    expect(await stock(S1)).toBe(B1.g);
    expect(await stock(S2)).toBe(B2.g);
    expect(N((await one(`SELECT sum(amount) v FROM public.opening_documents WHERE organization_id = '${org}' AND kind = 'factory_advance' AND status = 'active'`)).v)).toBe(C2);
    const st = await state();
    expect(st.checks.factory_obligation_equals_documents).toBe(true);
    expect(st.checks.inventory_equals_opening_receipts).toBe(true);
    expect(N(st.totals.factory_settled_seller_goods_g)).toBe(r4(b1Fac + b2Fac));
    expect(N(st.totals.factory_net_g)).toBe(r4(aObl - C2));
  });

  it("Z3 no double subtraction: a second settlement of the same B is refused; B from an A uses the A %; cancel puts it back; a settled B cannot be cancelled", async () => {
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'factory_settled', p_source_document_id := '${b1}', p_notes := 'x', p_idempotency_key := '${key("dup")}')`, "ERR_OPENING_DUPLICATE");
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'factory_settled', p_source_document_id := '${a1}', p_notes := 'x', p_idempotency_key := '${key("a")}')`, "ERR_FACTORY_SETTLED_SOURCE");
    await t.expectError(`SELECT public.rpc_record_opening_document(p_kind := 'factory_settled', p_source_document_id := '${b2}', p_idempotency_key := '${key("n")}')`, "Asos");
    const n0 = await net();
    b3 = (await doc(`p_kind := 'seller_inventory', p_seller_id := '${S1.employeeId}', p_pieces := '[{"weight_grams":10}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := '${a1}'`)).document_id as string;
    expect(await net()).toBe(n0); // a manager -> seller transfer neither creates nor lowers the factory account
    fs3 = (await doc(`p_kind := 'factory_settled', p_source_document_id := '${b3}', p_notes := 'A dan berilgan, oldin hisob-kitob qilingan'`)).document_id as string;
    expect(await net()).toBe(r4(n0 - r4(10 * (1 + A1.pct / 100))));
    await t.expectError(`SELECT public.rpc_cancel_opening_document('${b3}', 'x', '${key("c")}')`, "zavod bilan hisob-kitob");
    await t.rpc(`public.rpc_cancel_opening_document('${fs3}', 'sinov', '${key("c")}')`);
    expect(await net()).toBe(n0);
    await t.rpc(`public.rpc_cancel_opening_document('${b3}', 'sinov', '${key("c")}')`);
    expect(await net()).toBe(n0);
    expect(await owes(S1)).toBe(s1Base);
    expect((await state()).checks.factory_obligation_equals_documents).toBe(true);
  });

  it("U1 F without a rate: amount and currency kept, NOT valued (no 0 / 1 / today's rate), no seller grams, shown as not yet valued", async () => {
    const u = await doc(`p_kind := 'customer_currency', p_customer_id := '${c2}', p_unit := 'UZS', p_side := 'debt', p_amount := 10000000`);
    const d = await doc(`p_kind := 'customer_currency', p_customer_id := '${c3}', p_unit := 'USD', p_side := 'debt', p_amount := 1000, p_lom_rate := 900000`); // USD without the USD rate = not valued
    for (const id of [u.document_id, d.document_id]) {
      const r = await one(`SELECT equiv_585_g e, seller_obligation_g s, lom_rate l, usd_rate u, formula f FROM public.opening_documents WHERE id = '${id}'`);
      expect(r.e).toBeNull(); expect(N(r.s)).toBe(0); expect(r.l).toBeNull(); expect(r.u).toBeNull(); expect(String(r.f)).toMatch(/hali hisoblanmagan/);
    }
    expect(await owes(S1)).toBe(s1Base);
    expect(await owes(S2)).toBe(s2Base);
    expect(N((await one(`SELECT debt_amount v FROM public.client_currency_accounts WHERE customer_id = '${c2}' AND currency = 'UZS'`)).v)).toBe(10000000);
    const st = await state();
    expect(N(st.totals.customers_uzs_unvalued)).toBe(10000000);
    expect(N(st.totals.customers_usd_unvalued)).toBe(1000);
    expect(N(st.totals.customers_unvalued_documents)).toBe(2);
    expect(Object.values(st.checks).every((x) => x === true || x === 0)).toBe(true);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0 088', p_idempotency_key := '${key("b")}', p_usd_rate := 12500)`);
    expect((await one(`SELECT status v FROM public.opening_periods WHERE organization_id = '${org}' ORDER BY created_at DESC LIMIT 1`)).v).toBe("locked");
  });

  it("U2 payments value only their own part at their own rate; a rate change on the next payment; reversal takes it out; nothing counted twice", async () => {
    await t.asUser(S1.userId);
    const p1 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c2}', p_currency := 'UZS', p_cash_uzs := 4000000, p_lom_rate := 900000, p_idempotency_key := '${key("p")}')`);
    expect(N(p1.unrated_opening_debt_valued_g)).toBe(r4(4000000 / 900000));
    expect(await owes(S1)).toBe(r4(s1Base + r4(4000000 / 900000)));
    await t.asUser(S1.userId);
    const p2 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c2}', p_currency := 'UZS', p_cash_uzs := 3000000, p_lom_rate := 1000000, p_idempotency_key := '${key("p")}')`);
    expect(N(p2.unrated_opening_debt_valued_g)).toBe(3);
    expect(await owes(S1)).toBe(r4(s1Base + r4(4000000 / 900000) + 3));
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_reverse_client_currency_settlement(p_settlement_id := '${p2.settlement_id}', p_reason := 'xato', p_idempotency_key := '${key("r")}')`);
    expect(await owes(S1)).toBe(r4(s1Base + r4(4000000 / 900000)));
    expect(N((await one(`SELECT debt_amount v FROM public.client_currency_accounts WHERE customer_id = '${c2}' AND currency = 'UZS'`)).v)).toBe(6000000);
    // the handover of that cash closes exactly the valued part (another handover rate: the company's difference)
    await t.asUser(S1.userId);
    await t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${S1.employeeId}', p_cash_paid_amount := 4000000, p_rate_per_gram := 950000, p_idempotency_key := '${key("h")}')`);
    expect(await owes(S1)).toBe(s1Base);
    // the rated debt keeps the 085 rule: payment snapshot from the document, obligation unchanged until the handover
    await t.asUser(S1.userId);
    const p3 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c4}', p_currency := 'UZS', p_cash_uzs := 9000000, p_idempotency_key := '${key("p")}')`);
    expect(N(p3.opening_snapshot_585_g)).toBe(10);
    expect(p3.unrated_opening_debt_valued_g ?? null).toBeNull();
    expect(await owes(S1)).toBe(s1Base);
  });

  it("U3 USD unrated debt: paid part = USD x USD rate / 585 rate of that payment; an overpayment's advance part is not valued", async () => {
    await t.asUser(S2.userId);
    const p = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c3}', p_currency := 'USD', p_usd_amount := 300, p_usd_rate := 12600, p_lom_rate := 900000, p_idempotency_key := '${key("p")}')`);
    expect(N(p.unrated_opening_debt_valued_g)).toBe(4.2);
    expect(await owes(S2)).toBe(r4(s2Base + 4.2));
    await t.asUser(S2.userId);
    const p2 = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c3}', p_currency := 'USD', p_usd_amount := 800, p_usd_rate := 12500, p_lom_rate := 1000000, p_idempotency_key := '${key("p")}')`);
    expect(N(p2.applied_to_debt)).toBe(700);
    expect(N(p2.to_advance)).toBe(100);
    expect(N(p2.unrated_opening_debt_valued_g)).toBe(r4(700 * 12500 / 1000000));
    expect(await owes(S2)).toBe(r4(s2Base + 4.2 + r4(700 * 12500 / 1000000)));
  });
});
