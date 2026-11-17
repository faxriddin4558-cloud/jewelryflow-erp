import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// 088 money model (2026-11-17, director's request): an independent oracle for payments of opening UZS debts (rated and
// unrated) mixed with ordinary sale debts, partial handovers, reversals, retries and idempotency. Every expected gram is
// computed here from first principles:
//   * the opening part of a payment carries its grams into the valued pool (rated: the document snapshot; unrated: this
//     payment's rate) - unrated grams also enter the seller's obligation at that moment;
//   * the sale part stays unvalued and is converted at the handover rate;
//   * a handover lowers the obligation by (valued grams taken) + (unvalued cash / handover rate);
//   * nothing is lost or counted twice: reversing handover -> payment -> handing over again ends at the exact value.
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const N = (x: unknown) => Number(x ?? 0);

describe("Goldia 088 — money model: opening + sale debts, partial handover, reversal, retry", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-0000000008e9";
  type U = { userId: string; employeeId: string };
  let dir: U, mgr: U, S1: U, S2: U;
  let cR = "", cU = "", cX = "", cZ = "", cW = "";
  let kn = 0;
  const key = (p: string) => `mm-${p}-${++kn}`;
  const RATE = 900000;
  const one = async (sql: string) => { await t.asAdmin(); return (await t.db.query<Record<string, unknown>>(sql)).rows[0] ?? {}; };
  const doc = async (args: string) => { await t.asUser(mgr.userId); return t.rpc(`public.rpc_record_opening_document(${args}, p_idempotency_key := '${key("d")}')`); };
  const owes = async (s: U) => N((await one(`SELECT seller_owes_manager_g v FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`)).v);
  const pay = async (s: U, c: string, cash: number, lom: number, k = key("p")) => { await t.asUser(s.userId); return t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${c}', p_currency := 'UZS', p_cash_uzs := ${cash}, p_lom_rate := ${lom}, p_idempotency_key := '${k}')`); };
  const handover = async (s: U, cash: number, rate: number) => { await t.asUser(s.userId); return t.rpc(`public.rpc_record_seller_to_manager_settlement(p_seller_id := '${s.employeeId}', p_cash_paid_amount := ${cash}, p_rate_per_gram := ${rate}, p_idempotency_key := '${key("h")}')`); };
  const revPay = async (id: string, k = key("rp")) => { await t.asUser(mgr.userId); return t.rpc(`public.rpc_reverse_client_currency_settlement(p_settlement_id := '${id}', p_reason := 'xato', p_idempotency_key := '${k}')`); };
  const revHand = async (id: string) => { await t.asUser(mgr.userId); return t.rpc(`public.rpc_reverse_seller_to_manager_settlement(p_settlement_id := '${id}', p_reason := 'xato', p_idempotency_key := '${key("rh")}')`); };
  const till = async (s: U) => one(`SELECT seller_till_cash_amount c, till_valued_cash_uzs pc, till_valued_cash_585_g pg FROM public.seller_gold_accounts WHERE seller_id = '${s.employeeId}'`);

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'goldia-mm', 'Goldia MM', 'ACTIVE')`);
    dir = await t.addUser(org, "dir-mm@goldia.uz", "Direktor", "director");
    mgr = await t.addUser(org, "mgr-mm@goldia.uz", "Menejer", "manager");
    S1 = await t.addUser(org, "s1-mm@goldia.uz", "Sotuvchi 1", "sales");
    S2 = await t.addUser(org, "s2-mm@goldia.uz", "Sotuvchi 2", "sales");
    const c = async (code: string, s: U) => (await one(`INSERT INTO public.customers (organization_id, customer_code, contact_name, phone, seller_id)
      VALUES ('${org}', '${code}', 'Mijoz ${code}', '+99891${code.replace(/\D/g, "").padStart(7, "0")}', '${s.employeeId}') RETURNING id`)).id as string;
    cR = await c("MM-1", S1); cU = await c("MM-2", S1); cX = await c("MM-3", S1); cZ = await c("MM-4", S2); cW = await c("MM-5", S2);
    await t.db.exec(`INSERT INTO public.daily_gold_rates (organization_id, rate_date, proba, rate_per_gram, currency, is_confirmed) VALUES ('${org}', CURRENT_DATE, 585, ${RATE}, 'UZS', true), ('${org}', public._goldia_business_date(), 585, ${RATE}, 'UZS', true) ON CONFLICT DO NOTHING`);
    await t.db.query(`SELECT public._goldia_financial_freeze('${org}', 'mm window', true)`);
    const bv = (await one(`INSERT INTO public.financial_backup_verifications (organization_id, backup_reference, restore_verified) VALUES ('${org}', 'mm.dump', true) RETURNING id`)).id;
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_financial_restart('MOLIYAVIY HISOBNI QAYTA BOSHLASH', 'mm', '${new Date(Date.now() - 60_000).toISOString()}', '${bv}', 'mm-restart')`);
    const a = (await doc(`p_kind := 'manager_inventory', p_physical_g := 100, p_factory_markup_pct := 8`)).document_id as string;
    await doc(`p_kind := 'seller_inventory', p_seller_id := '${S1.employeeId}', p_pieces := '[{"weight_grams":10},{"weight_grams":12}]'::jsonb, p_seller_markup_pct := 10, p_source_document_id := '${a}'`);
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cR}', p_unit := 'UZS', p_side := 'debt', p_amount := 9000000, p_lom_rate := 900000`); // rated: 10 g
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cU}', p_unit := 'UZS', p_side := 'debt', p_amount := 2000000`);                      // unrated
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cX}', p_unit := 'UZS', p_side := 'debt', p_amount := 1000000`);                      // unrated, for the other-seller test
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cZ}', p_unit := 'UZS', p_side := 'debt', p_amount := 1000000, p_lom_rate := 900000`); // rated 1.1111 g (seller 2)
    await doc(`p_kind := 'customer_currency', p_customer_id := '${cW}', p_unit := 'UZS', p_side := 'debt', p_amount := 2000000`);                      // unrated (seller 2)
  }, 180000);

  it("M5 baseline values unrated UZS debts for the report only: the seller's 585 obligation does not change at the lock", async () => {
    const o0 = await owes(S1);
    await t.asUser(mgr.userId);
    await t.rpc(`public.rpc_confirm_accounting_baseline(p_notes := 'T0 mm', p_idempotency_key := '${key("b")}', p_usd_rate := 12500)`);
    expect(await owes(S1)).toBe(o0);
  });

  it("M1 rated opening debt + ordinary sale debt of one customer: only the opening part is valued; the sale part gets its full handover credit", async () => {
    const pc = (await one(`SELECT id, weight_grams w FROM public.consignment_pieces WHERE organization_id = '${org}' AND seller_id = '${S1.employeeId}' AND status = 'held_by_seller' ORDER BY weight_grams LIMIT 1`));
    await t.asUser(S1.userId);
    await t.rpc(`public.rpc_record_currency_sale(p_customer_id := '${cR}', p_currency := 'UZS', p_amount := 5000000, p_weight_grams := ${N(pc.w)}, p_piece_ids := array['${pc.id}']::uuid[], p_idempotency_key := '${key("s")}')`);
    const o0 = await owes(S1);
    const p = await pay(S1, cR, 14000000, 1000000);
    expect(N(p.opening_snapshot_585_g)).toBe(10);
    expect(await owes(S1)).toBe(o0); // rated: the 10 g were already in the obligation since T0
    const row = await one(`SELECT opening_applied_amount a, pool_cash_uzs pc, pool_cash_585_g pg FROM public.client_currency_settlements WHERE id = '${p.settlement_id}'`);
    expect([N(row.a), N(row.pc), N(row.pg)]).toEqual([9000000, 9000000, 10]);
    await handover(S1, 14000000, 1000000);
    // oracle: 10 g (valued opening part) + 5 000 000 / 1 000 000 (sale part) = 15 g (085 gave 10 g: 5 g lost)
    expect(await owes(S1)).toBe(r4(o0 - 15));
  });

  it("M2 partial handover then reversal: refused with a clear error; reverse handover -> payment -> hand over again ends exactly (0 g lost)", async () => {
    const base = await owes(S1);
    const p1 = await pay(S1, cU, 1000000, 800000);   // 1.25 g
    const p2 = await pay(S1, cU, 1000000, 1100000);  // 0.9091 g
    expect([N(p1.unrated_opening_debt_valued_g), N(p2.unrated_opening_debt_valued_g)]).toEqual([1.25, 0.9091]);
    expect(await owes(S1)).toBe(r4(base + 1.25 + 0.9091));
    const h = await handover(S1, 1000000, 1000000);  // takes the pool average: (1.25 + 0.9091) / 2 g
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reverse_client_currency_settlement(p_settlement_id := '${p1.settlement_id}', p_reason := 'xato', p_idempotency_key := '${key("x")}')`, "ERR_TILL_ALREADY_HANDED_OVER");
    await revHand(h.settlement_id as string);
    expect(N((await till(S1)).pg)).toBe(r4(1.25 + 0.9091));
    await revPay(p1.settlement_id as string);
    expect(await owes(S1)).toBe(r4(base + 0.9091));
    expect([N((await till(S1)).pc), N((await till(S1)).pg)]).toEqual([1000000, 0.9091]);
    await handover(S1, 1000000, 1000000);
    expect(await owes(S1)).toBe(r4(base)); // the remaining 0.9091 g closed exactly by its own money
    expect([N((await till(S1)).pc), N((await till(S1)).pg)]).toEqual([0, 0]);
  });

  it("M3 retry and idempotency: the same payment key twice writes once; the same reversal key twice reverses once", async () => {
    const base = await owes(S1);
    const k = key("retry");
    const a = await pay(S1, cU, 500000, 1000000, k);
    const b = await pay(S1, cU, 500000, 1000000, k);
    expect(b.settlement_id).toBe(a.settlement_id);
    expect(N((await one(`SELECT count(*) n FROM public.client_currency_settlements WHERE idempotency_key = '${k}'`)).n)).toBe(1);
    expect(await owes(S1)).toBe(r4(base + 0.5));
    const rk = key("rretry");
    await revPay(a.settlement_id as string, rk);
    const again = await revPay(a.settlement_id as string, rk);
    expect(again.status).toBe("ok");
    expect(await owes(S1)).toBe(base);
    expect(N((await one(`SELECT debt_amount v FROM public.client_currency_accounts WHERE customer_id = '${cU}' AND currency = 'UZS'`)).v)).toBe(1000000);
  });

  it("M4 a payment into ANOTHER seller's till is refused for an open opening debt; into the owner's till it works", async () => {
    await t.asUser(dir.userId);
    await t.expectError(`SELECT public.rpc_record_client_currency_settlement(p_customer_id := '${cX}', p_currency := 'UZS', p_cash_uzs := 100000, p_lom_rate := 1000000, p_seller_id := '${S2.employeeId}', p_idempotency_key := '${key("o")}')`, "ERR_OPENING_DEBT_OTHER_SELLER");
    const s2 = await owes(S2);
    expect(N((await one(`SELECT coalesce(sum(seller_till_cash_amount), 0) v FROM public.seller_gold_accounts WHERE seller_id = '${S2.employeeId}'`)).v)).toBe(0);
    await t.asUser(dir.userId);
    const ok = await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${cX}', p_currency := 'UZS', p_cash_uzs := 100000, p_lom_rate := 1000000, p_seller_id := '${S1.employeeId}', p_idempotency_key := '${key("o")}')`);
    expect(N(ok.unrated_opening_debt_valued_g)).toBe(0.1);
    expect(await owes(S2)).toBe(s2);
  });

  it("M6 a rated debt paid in 25 parts and handed over in full leaves no rounding residue on the seller", async () => {
    const base = await owes(S2); // includes the rated 1.1111 g
    for (let i = 0; i < 25; i++) await pay(S2, cZ, 40000, 1000000);
    expect(N((await one(`SELECT debt_amount v FROM public.client_currency_accounts WHERE customer_id = '${cZ}' AND currency = 'UZS'`)).v)).toBe(0);
    expect(N((await one(`SELECT sum(snapshot_released_g) v FROM public.client_currency_settlements WHERE customer_id = '${cZ}' AND status <> 'reversed'`)).v)).toBe(1.1111);
    await handover(S2, 1000000, 1000000);
    expect(await owes(S2)).toBe(r4(base - 1.1111));
  });

  it("M7 a concurrent handover (its timestamp earlier than the payment's) still blocks the payment's reversal: order numbers, not clocks", async () => {
    const p1 = await pay(S2, cW, 1000000, 800000);
    const p2 = await pay(S2, cW, 1000000, 1100000);
    const h = await handover(S2, 1000000, 1000000);
    // emulate the race of the audit: the handover's transaction started before the payments committed
    await t.asAdmin();
    await t.db.exec(`UPDATE public.gold_settlements SET created_at = created_at - interval '1 hour' WHERE id = '${h.settlement_id}'`);
    for (const p of [p1, p2]) {
      await t.asUser(mgr.userId);
      await t.expectError(`SELECT public.rpc_reverse_client_currency_settlement(p_settlement_id := '${p.settlement_id}', p_reason := 'xato', p_idempotency_key := '${key("x")}')`, "ERR_TILL_ALREADY_HANDED_OVER");
    }
    await revHand(h.settlement_id as string);
    await revPay(p2.settlement_id as string); // allowed again once the handover is reversed
  });
});
