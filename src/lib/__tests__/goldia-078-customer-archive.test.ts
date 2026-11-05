import { describe, it, expect, beforeAll } from "vitest";
import { createGoldiaDb } from "./helpers/goldia-pglite";

// Migration 078: a seller archives ("Mijozni o'chirish") / restores HIS OWN customer; director and manager every
// customer of their organization; soft delete only (debts, sales, payments, audit kept and still collectible);
// idempotent; direct table writes follow the same rule. Plus: the latest stored report period can be reopened (F77-11).
describe("Goldia 078 — seller customer archive (soft delete) and report period reopen", () => {
  let t: Awaited<ReturnType<typeof createGoldiaDb>>;
  const org = "00000000-0000-0000-0000-00000000a078";
  const orgB = "00000000-0000-0000-0000-00000000b078";
  let dir: { userId: string; employeeId: string };
  let mgr: { userId: string; employeeId: string };
  let seller: { userId: string; employeeId: string };
  let seller2: { userId: string; employeeId: string };
  let worker: { userId: string; employeeId: string };
  let sellerB: { userId: string; employeeId: string };
  let own: string;
  let other: string;
  let unassigned: string;
  let foreign: string;
  const today = `(timezone('Asia/Tashkent', now()))::date`;
  const n = async (sql: string) => { await t.asAdmin(); return Number(await t.scalar(sql)); };
  const archived = async (c: string) => {
    await t.asAdmin();
    const r = await t.db.query<{ a: boolean; at: string | null; by: string | null }>(`SELECT is_archived a, archived_at at, archived_by by FROM public.customers WHERE id = '${c}'`);
    return r.rows[0]!;
  };
  const usdDebt = async (c: string) => n(`(SELECT coalesce(sum(debt_amount), 0) FROM public.client_currency_accounts WHERE customer_id = '${c}' AND currency = 'USD')`);
  const auditRows = async (c: string) => n(`(SELECT count(*) FROM public.audit_logs WHERE table_name = 'customers' AND record_id = '${c}' AND action IN ('ARCHIVE_CUSTOMER', 'RESTORE_CUSTOMER'))`);

  beforeAll(async () => {
    t = await createGoldiaDb();
    await t.db.exec(`INSERT INTO public.organizations (id, code, name, status) VALUES ('${org}', 'org-078', 'Org 078', 'ACTIVE'), ('${orgB}', 'org-078b', 'Org 078 B', 'ACTIVE')`);
    dir = await t.addUser(org, "dir078@goldia.uz", "Dir", "director");
    mgr = await t.addUser(org, "mgr078@goldia.uz", "Mgr", "production_manager");
    seller = await t.addUser(org, "sel078@goldia.uz", "Sel", "sales");
    seller2 = await t.addUser(org, "sel078b@goldia.uz", "Sel2", "sales");
    worker = await t.addUser(org, "wrk078@goldia.uz", "Wrk", "worker");
    sellerB = await t.addUser(orgB, "selb078@goldia.uz", "SelB", "sales");
    await t.asAdmin();
    const ins = async (o: string, code: string, s: string | null) => (await t.db.query<{ id: string }>(`INSERT INTO public.customers (organization_id, customer_code, contact_name, seller_id)
      VALUES ('${o}', '${code}', '${code}', ${s ? `'${s}'` : "null"}) RETURNING id`)).rows[0]!.id;
    own = await ins(org, "C078-OWN", seller.employeeId);
    other = await ins(org, "C078-OTHER", seller2.employeeId);
    unassigned = await ins(org, "C078-FREE", null);
    foreign = await ins(orgB, "C078-B", sellerB.employeeId);
    await t.asUser(dir.userId);
    await t.rpc(`public.rpc_set_daily_gold_rate(p_rate_per_gram := 900000, p_rate_date := ${today})`);
    await t.asUser(mgr.userId);
    const r = await t.rpc(`public.rpc_record_factory_receipt(p_product_name := 'R', p_original_physical_g := 40, p_factory_markup_pct := 8)`);
    await t.rpc(`public.rpc_issue_barcode_consignment(p_seller_id := '${seller.employeeId}', p_factory_markup_pct := 8, p_seller_markup_pct := 10,
      p_factory_receipt_id := '${r.receipt_id}', p_pieces := '[{"weight_grams":8},{"weight_grams":12},{"weight_grams":10}]'::jsonb)`);
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_set_my_seller_rates(p_lom_rate_uzs := 900000, p_usd_rate_uzs := 12500)`);
    // open debt on the seller's own customer: 20 g sold for $2000
    await t.rpc(`public.rpc_record_currency_sale(p_customer_id := '${own}', p_currency := 'USD', p_amount := 2000, p_weight_grams := 20, p_idempotency_key := 'a78-sale')`);
  });

  it("SEC-1: a seller archives his own customer (one write, audit with the open debt); a repeated click changes nothing", async () => {
    expect(await usdDebt(own)).toBe(2000);
    await t.asUser(seller.userId);
    const r = await t.rpc(`public.rpc_archive_customer(p_customer_id := '${own}', p_archive := true)`);
    expect(r.status).toBe("ok");
    expect(r.changed).toBe(true);
    expect(Number((r.open_balances as Record<string, number>).debt_usd)).toBe(2000);
    const a = await archived(own);
    expect(a.a).toBe(true);
    expect(a.by).toBe(seller.employeeId);
    expect(a.at).not.toBeNull();
    expect(await auditRows(own)).toBe(1);
    await t.asUser(seller.userId);
    const again = await t.rpc(`public.rpc_archive_customer(p_customer_id := '${own}', p_archive := true)`);
    expect(again.status).toBe("ok");
    expect(again.changed).toBe(false);
    expect(await auditRows(own)).toBe(1);
  });

  it("SEC-2: a seller cannot archive another seller's, an unassigned or another organization's customer (RPC and direct table write)", async () => {
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_archive_customer(p_customer_id := '${other}', p_archive := true)`, "sizga biriktirilmagan");
    await t.expectError(`SELECT public.rpc_archive_customer(p_customer_id := '${unassigned}', p_archive := true)`, "sizga biriktirilmagan");
    await t.expectError(`SELECT public.rpc_archive_customer(p_customer_id := '${foreign}', p_archive := true)`, "Mijoz topilmadi");
    // direct PostgREST-style writes: another seller's / foreign rows are invisible (0 rows), the unassigned one is
    // visible to a seller by the 038 policy, so the 078 guard trigger must stop it
    await t.asUser(seller.userId);
    const hidden = await t.db.query(`UPDATE public.customers SET is_archived = true WHERE id IN ('${other}', '${foreign}') RETURNING id`);
    expect(hidden.rows.length).toBe(0);
    await t.expectError(`UPDATE public.customers SET is_archived = true WHERE id = '${unassigned}'`, "Ruxsat etilmadi");
    await t.asUser(worker.userId);
    await t.expectError(`SELECT public.rpc_archive_customer(p_customer_id := '${own}', p_archive := false)`, "Ruxsat etilmadi");
    expect((await archived(other)).a).toBe(false);
    expect((await archived(unassigned)).a).toBe(false);
    expect((await archived(foreign)).a).toBe(false);
    expect((await archived(own)).a).toBe(true);
  });

  it("SEC-3: archiving keeps the open debt and the history; the debt stays in the report and is still collectible", async () => {
    expect(await n(`(SELECT count(*) FROM public.customers WHERE id = '${own}')`)).toBe(1);
    expect(await n(`(SELECT count(*) FROM public.jewelry_sales WHERE customer_id = '${own}')`)).toBe(1);
    expect(await usdDebt(own)).toBe(2000);
    await t.asUser(mgr.userId);
    const rep = await t.rpc(`public.rpc_get_period_report(p_from := ${today}, p_to := ${today})`) as { closing: Record<string, number> };
    expect(Number(rep.closing.customer_debt_net_usd)).toBe(2000);
    // the seller collects $500 from the archived customer
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_record_client_currency_settlement(p_customer_id := '${own}', p_currency := 'USD', p_usd_amount := 500, p_idempotency_key := 'a78-pay')`);
    expect(await usdDebt(own)).toBe(1500);
    expect((await archived(own)).a).toBe(true);
    // physical delete of a customer with operations stays impossible (051 guard)
    await t.asAdmin();
    await t.expectError(`DELETE FROM public.customers WHERE id = '${own}'`, "Arxivlashdan");
  });

  it("SEC-4: restoring works (seller: own customer; director / manager: any customer of the organization)", async () => {
    await t.asUser(seller.userId);
    const r = await t.rpc(`public.rpc_archive_customer(p_customer_id := '${own}', p_archive := false)`);
    expect(r.changed).toBe(true);
    const a = await archived(own);
    expect(a.a).toBe(false);
    expect(a.at).toBeNull();
    expect(a.by).toBeNull();
    expect(await usdDebt(own)).toBe(1500);
    // management: another seller's customer and an unassigned one, archive and restore (director = manager)
    for (const who of [mgr, dir]) {
      await t.asUser(who.userId);
      for (const c of [other, unassigned]) {
        expect((await t.rpc(`public.rpc_archive_customer(p_customer_id := '${c}', p_archive := true)`)).changed).toBe(true);
        expect((await archived(c)).a).toBe(true);
        await t.asUser(who.userId);
        expect((await t.rpc(`public.rpc_archive_customer(p_customer_id := '${c}', p_archive := false)`)).changed).toBe(true);
        expect((await archived(c)).a).toBe(false);
        await t.asUser(who.userId);
      }
      await t.expectError(`SELECT public.rpc_archive_customer(p_customer_id := '${foreign}', p_archive := true)`, "Mijoz topilmadi");
    }
    // the seller may also use a direct write on his own customer (same rule as the RPC) but not move it to someone else
    await t.asUser(seller.userId);
    const d = await t.db.query(`UPDATE public.customers SET is_archived = true WHERE id = '${own}' RETURNING id`);
    expect(d.rows.length).toBe(1);
    await t.expectError(`UPDATE public.customers SET is_archived = false, seller_id = '${seller2.employeeId}' WHERE id = '${own}'`, "Ruxsat etilmadi");
    await t.asUser(seller.userId);
    await t.rpc(`public.rpc_archive_customer(p_customer_id := '${own}', p_archive := false)`);
    expect((await archived(own)).a).toBe(false);
  });

  it("F77-11: the latest stored report period can be reopened; older ones and sellers cannot", async () => {
    await t.asUser(mgr.userId);
    const p1 = await t.rpc(`public.rpc_close_report_period(p_end := '2000-01-31'::date)`);
    await t.asUser(mgr.userId);
    // the mistake blocks the next close (2000-02-01 .. yesterday exceeds the 10-year window)
    await t.expectError(`SELECT public.rpc_close_report_period(p_end := ${today} - 1)`, "10 yildan");
    await t.asUser(mgr.userId);
    const p2 = await t.rpc(`public.rpc_close_report_period(p_end := '2000-03-31'::date)`);
    await t.asUser(mgr.userId);
    await t.expectError(`SELECT public.rpc_reopen_report_period(p_period_id := '${p1.id}')`, "oxirgi saqlangan davr");
    await t.asUser(seller.userId);
    await t.expectError(`SELECT public.rpc_reopen_report_period(p_period_id := '${p2.id}')`, "ermission");
    const before = await n(`(SELECT md5(string_agg(t::text, '' ORDER BY t::text)) IS NOT NULL FROM public.client_currency_accounts t)::int`);
    const usd0 = await usdDebt(own);
    await t.asUser(dir.userId);
    expect((await t.rpc(`public.rpc_reopen_report_period(p_period_id := '${p2.id}', p_reason := 'xato sana')`)).changed).toBe(true);
    await t.asUser(mgr.userId);
    expect((await t.rpc(`public.rpc_reopen_report_period(p_period_id := '${p2.id}')`)).changed).toBe(false);
    await t.asUser(mgr.userId);
    expect((await t.rpc(`public.rpc_reopen_report_period(p_period_id := '${p1.id}')`)).changed).toBe(true);
    expect(await n(`(SELECT count(*) FROM public.goldia_report_periods WHERE organization_id = '${org}')`)).toBe(0);
    expect(await n(`(SELECT count(*) FROM public.audit_logs WHERE action = 'REOPEN_REPORT_PERIOD' AND organization_id = '${org}')`)).toBe(2);
    expect(before).toBe(1);
    expect(await usdDebt(own)).toBe(usd0);
    // now the normal close works again
    await t.asUser(mgr.userId);
    const ok = await t.rpc(`public.rpc_close_report_period(p_end := ${today} - 1)`);
    expect(ok.status).toBe("ok");
  });
});
