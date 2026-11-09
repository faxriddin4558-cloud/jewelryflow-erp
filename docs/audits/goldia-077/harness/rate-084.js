// 084 per-operation rates + currency valuation, real GoTrue logins through PostgREST (GA_TARGET=local | staging).
//   RR-1..4   gram payment: seller default = saved rate; seller enters another rate (was ERR_RATE_MISMATCH) -> accepted and
//             snapshotted, grams = cash / entered rate; outside the deviation limit -> refused; manager USD without a rate
//             -> refused (no 12 800 / CBU guess)
//   RR-5..6   UZS / USD payment: seller enters own USD rate; manager LOM default = official rate (was "required")
//   RR-7      handover of cash WITHOUT captured value at an entered rate: grams = valued part + rest / entered rate
//   RR-8      old documents keep their snapshot after the saved rate changes (no re-pricing)
//   RR-9..11  profit summary: customer UZS / USD balances present; without a USD rate -> listed as not valued, no period
//             result, never 12 800; with a rate -> valued exactly; baseline: USD rate required when customers hold USD,
//             no 1.0 placeholder, snapshot marks currency receivables included
const fs = require('fs'); const path = require('path');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const OUT = process.env.GA_OUT || path.join(__dirname, '..', 'evidence', `${TARGET}-rate-084.json`);
const N = (x) => Number(x || 0); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4; const r2 = (x) => Math.round(N(x) * 100) / 100;
const R = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.status} ${r.error}`); return r.data; };
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday(); let kn = 0; const key = (t) => `rr84-${t}-${run}-${++kn}`;
  const OFF = 900000;
  must(await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: OFF, p_rate_date: today }), 'rate');
  must(await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 910000, p_usd_rate_uzs: 12600, p_reason: 'rr84' }), 'seller rates');
  const rc = must(await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `RR84 ${run}`, p_original_physical_g: 60, p_factory_markup_pct: 8 }), 'receipt');
  must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.receipt_id, p_pieces: Array(6).fill({ weight_grams: 10 }) }), 'consignment');
  const cust = async (n) => must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `RR84 ${n} ${run}` }), 'customer').customer_id;
  const sale = async (c, g) => must(await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: c, p_seller_id: C.sellera.id, p_weight_grams: g, p_client_markup_pct: 10, p_idempotency_key: key('s') }), 'sale');
  const pay = (who, c, extra) => L.rpc(who, 'rpc_record_client_settlement', { p_customer_id: c, p_idempotency_key: key('p'), ...extra });
  const sett = async (id) => (await L.sel(`gold_settlements?id=eq.${id}&select=gold_rate_applied,applied_usd_rate,cash_equivalent_grams,usd_equivalent_grams,total_settled_grams`))[0];

  // RR-1 default = saved rate
  const C1 = await cust('Def'); await sale(C1, 10);
  const p1 = await pay('sellera', C1, { p_cash_amount: 910000 }); const s1 = p1.ok ? await sett(p1.data.settlement_id) : null;
  T('RR-1', 'seller pays 910 000 so\'m without a rate -> his saved 910 000 is used and snapshotted (1.0000 g)', p1.ok && N(s1.gold_rate_applied) === 910000 && r4(s1.cash_equivalent_grams) === 1, { rate: 910000, g: 1 }, p1.ok ? s1 : p1.error);
  // RR-2 another rate is accepted
  const p2 = await pay('sellera', C1, { p_cash_amount: 920000, p_rate_per_gram: 920000 }); const s2 = p2.ok ? await sett(p2.data.settlement_id) : null;
  T('RR-2', 'seller enters 920 000 (saved 910 000) -> accepted (was ERR_RATE_MISMATCH), snapshot 920 000, 1.0000 g', p2.ok && N(s2.gold_rate_applied) === 920000 && r4(s2.cash_equivalent_grams) === 1, { rate: 920000, g: 1 }, p2.ok ? s2 : p2.error);
  // RR-3 outside the deviation limit
  const lim = must(await L.rpc('sellera', 'rpc_get_seller_rates', {}), 'limits').limits; const far = Math.round(OFF * (1 + (N(lim.max_lom_deviation_pct) + 10) / 100));
  const p3 = await pay('sellera', C1, { p_cash_amount: 100000, p_rate_per_gram: far });
  T('RR-3', `seller rate ${far} (> ${lim.max_lom_deviation_pct} % from the official ${OFF}) -> refused, nothing recorded`, !p3.ok && /ERR_RATE_OUT_OF_RANGE/.test(p3.error), 'refused', p3.error);
  // RR-4 manager USD without a rate
  const p4 = await pay('manager', C1, { p_usd_amount: 10 });
  T('RR-4', 'manager receives 10 USD without a USD rate -> ERR_RATE_REQUIRED (no 12 800 / CBU guess)', !p4.ok && /ERR_RATE_REQUIRED/.test(p4.error), 'refused', p4.error);
  const p4b = await pay('manager', C1, { p_usd_amount: 10, p_usd_rate: 12700 }); const s4b = p4b.ok ? await sett(p4b.data.settlement_id) : null;
  T('RR-4b', 'manager enters 12 700 -> snapshot 12 700, grams = 10 x 12 700 / 900 000', p4b.ok && N(s4b.applied_usd_rate) === 12700 && r4(s4b.usd_equivalent_grams) === r4(10 * 12700 / OFF), r4(10 * 12700 / OFF), p4b.ok ? s4b : p4b.error);
  // RR-5 / RR-6 currency payments
  const C5 = await cust('USD'); must(await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: C5, p_seller_id: C.sellera.id, p_currency: 'USD', p_amount: 300, p_weight_grams: 2, p_idempotency_key: key('cs') }), 'usd sale');
  const q5 = await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: C5, p_currency: 'USD', p_cash_uzs: 1270000, p_usd_rate: 12700, p_idempotency_key: key('cp') });
  const cs5 = q5.ok ? (await L.sel(`client_currency_settlements?id=eq.${q5.data.settlement_id}&select=rate_usd_uzs,credited_amount`))[0] : null;
  T('RR-5', 'seller pays a USD debt with 1 270 000 so\'m at his entered 12 700 (saved 12 600) -> credited 100.00 USD, snapshot 12 700', q5.ok && N(cs5.rate_usd_uzs) === 12700 && r2(cs5.credited_amount) === 100, { rate: 12700, credited: 100 }, q5.ok ? cs5 : q5.error);
  const q6 = await L.rpc('manager', 'rpc_record_client_currency_settlement', { p_customer_id: C5, p_currency: 'USD', p_scrap_weight: 1, p_scrap_proba: 585, p_usd_rate: 12500, p_idempotency_key: key('cp') });
  const cs6 = q6.ok ? (await L.sel(`client_currency_settlements?id=eq.${q6.data.settlement_id}&select=rate_lom_uzs,credited_amount`))[0] : null;
  T('RR-6', 'manager scrap payment without a LOM rate -> default = official 900 000 (was "required"), credited 900 000 / 12 500 = 72.00 USD', q6.ok && N(cs6.rate_lom_uzs) === OFF && r2(cs6.credited_amount) === 72, { rate: OFF, credited: 72 }, q6.ok ? cs6 : q6.error);
  // RR-7 handover of unvalued cash at an entered rate
  const acc = (await L.sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=c:seller_till_cash_amount,pu:till_valued_cash_uzs,pg:till_valued_cash_585_g`))[0];
  const pool = Math.min(N(acc.pu), N(acc.c)); const legacy = r2(N(acc.c) - pool);
  if (legacy >= 100000) {
    const cash = r2(pool + 100000); const poolG = pool > 0 ? N(acc.pg) * pool / N(acc.pu) : 0;
    const h = await L.rpc('sellera', 'rpc_record_seller_to_manager_settlement', { p_seller_id: C.sellera.id, p_cash_paid_amount: cash, p_rate_per_gram: 905000, p_idempotency_key: key('h') });
    const exp = r4(Math.round(poolG * 1e6) / 1e6 + 100000 / 905000);
    const hs = h.ok ? await sett(h.data.settlement_id) : null;
    T('RR-7', `handover ${cash} so'm: ${pool} valued (pool grams) + 100 000 unvalued at the entered 905 000 -> ${exp} g`, h.ok && Math.abs(r4(hs.cash_equivalent_grams) - exp) <= 0.0001, exp, h.ok ? hs : h.error);
  } else T('RR-7', 'handover of unvalued cash', false, 'till with >= 100 000 unvalued so\'m', { till: acc });
  // RR-8 snapshots stay after the saved rate changes
  must(await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 895000, p_usd_rate_uzs: 12400, p_reason: 'rr84 change' }), 'change rates');
  const s1b = await sett(p1.data.settlement_id); const s2b = await sett(p2.data.settlement_id);
  T('RR-8', 'after the saved rate changes, earlier payments keep 910 000 / 920 000 and their grams (no re-pricing)', N(s1b.gold_rate_applied) === 910000 && N(s2b.gold_rate_applied) === 920000 && r4(s1b.cash_equivalent_grams) === 1, [910000, 920000], [s1b.gold_rate_applied, s2b.gold_rate_applied]);
  // RR-9..11 profit summary + baseline
  const cur = await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&select=currency,d:debt_amount,a:advance_amount`);
  const side = (c, f) => r2(cur.filter((x) => x.currency === c).reduce((s, x) => s + Math.max(0, f(x)), 0));
  const usdD = side('USD', (x) => N(x.d) - N(x.a)), usdA = side('USD', (x) => N(x.a) - N(x.d)), uzsD = side('UZS', (x) => N(x.d) - N(x.a));
  const ps0 = must(await L.rpc('director', 'rpc_get_accounting_profit_summary', { p_gold_rate: OFF }), 'profit');
  const comp = ps0.components;
  T('RR-9', 'profit summary lists customers\' UZS / USD balances (debt and advance per currency = accounts)', r2(comp.customer_usd_debt_amount) === usdD && r2(comp.customer_usd_advance_amount) === usdA && r2(comp.customer_uzs_debt_amount) === uzsD,
    { usdD, usdA, uzsD }, { usdD: comp.customer_usd_debt_amount, usdA: comp.customer_usd_advance_amount, uzsD: comp.customer_uzs_debt_amount });
  const noUsdRate = ps0.rates.usd_rate === null;
  T('RR-10', 'without a USD rate: USD listed as not valued, no period result, no 12 800 anywhere', noUsdRate ? (ps0.period_accounting_result_585_g === null && ps0.not_valued.some((x) => /USD/.test(x)) && !JSON.stringify(ps0).includes('12800')) : true,
    'not valued', { usd_rate: ps0.rates.usd_rate, result: ps0.period_accounting_result_585_g, not_valued: ps0.not_valued });
  const ps1 = must(await L.rpc('director', 'rpc_get_accounting_profit_summary', { p_gold_rate: OFF, p_usd_rate: 12500 }), 'profit usd');
  T('RR-10b', 'with USD 12 500: customer USD debt valued = debt x 12 500 / 900 000, included in assets', r4(ps1.components.customer_usd_debt_585_eq_g) === r4(usdD * 12500 / OFF) && r4(ps1.assets.customer_usd_debt_585_eq_g) === r4(usdD * 12500 / OFF),
    r4(usdD * 12500 / OFF), ps1.components.customer_usd_debt_585_eq_g);
  if (process.env.GA_BASELINE) {   // archives the active baseline of the synthetic organization
    const b0 = await L.rpc('director', 'rpc_confirm_accounting_baseline', { p_notes: 'RR84 no usd rate', p_idempotency_key: key('b') });
    const b1 = await L.rpc('director', 'rpc_confirm_accounting_baseline', { p_notes: 'RR84 with usd rate', p_usd_rate: 12500, p_idempotency_key: key('b') });
    const bRow = (await L.sel(`accounting_baselines?organization_id=eq.${L.ORG}&status=eq.active&select=usd_rate,components_snapshot`))[0];
    T('RR-11', 'baseline: refused without a USD rate while customers hold USD; with 12 500 stored, snapshot marks currency receivables included',
      (usdD + usdA > 0 ? !b0.ok && /ERR_USD_RATE_NOT_SET/.test(b0.error) : true) && b1.ok && N(bRow.usd_rate) === 12500 && bRow.components_snapshot.currency_receivables_included === true && r2(bRow.components_snapshot.usd_receivable_total) === r2(usdD - usdA),
      'ok', { b0: b0.ok || b0.error, b1: b1.ok || b1.error, row: bRow && { usd: bRow.usd_rate, inc: bRow.components_snapshot.currency_receivables_included } });
  }
  // ---------------- RR-UI (GA_UI=1): the rate is typed in the real frontend
  if (process.env.GA_UI) {
    const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
    const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
    const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
    const shot = (n) => path.join(path.dirname(OUT), `rr84-${n}.png`);
    const login = async (tag, vp) => {
      const c = L.creds()[tag]; const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const bad = [];
      p.on('response', (r) => { if (/supabase\.co|127\.0\.0\.1:54321/.test(r.url()) && r.status() >= 400) bad.push(r.status() + ' ' + (r.url().split('/rest/')[1] || r.url())); });
      await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
      await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
      return { ctx, p, bad };
    };
    // UI-1 seller phone: the saved LOM rate at this moment (895 000 since RR-8) is the prefilled default; the seller types 920 000
    const SAVED = 895000;
    const nUi = `RR84 UI ${run}`; const cUi = must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nUi }), 'ui customer').customer_id;
    await sale(cUi, 5);
    {
      const { ctx, p, bad } = await login('sellera', { width: 390, height: 844 });
      await p.goto(BASE + '/sales/app/customers?tab=settle', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
      await p.locator('#settleCustomerSelect').selectOption(cUi); await p.waitForTimeout(800);
      const pre = await p.locator('[data-testid="settle-lom-rate"]').inputValue();
      const editable = await p.locator('[data-testid="settle-lom-rate"]').isEditable();
      await p.locator('#settleCashAmountInput').fill('920000');
      await p.locator('[data-testid="settle-lom-rate"]').fill('920000');
      await p.locator('form button[type="submit"]').last().dblclick(); await p.waitForTimeout(4000);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await p.screenshot({ path: shot('seller-390') }).catch(() => {});
      await ctx.close();
      const rows = await L.sel(`gold_settlements?customer_id=eq.${cUi}&status=eq.confirmed&select=gold_rate_applied,cash_equivalent_grams`);
      T('RR-UI-1', `seller phone: LOM field prefilled with the current saved ${SAVED} and editable; typed 920 000 + double click -> exactly one payment at 920 000 = 1.0000 g, no API error, no overflow`,
        N(pre) === SAVED && editable && rows.length === 1 && N(rows[0].gold_rate_applied) === 920000 && r4(rows[0].cash_equivalent_grams) === 1 && bad.length === 0 && overflow <= 0,
        { pre: SAVED, rows: [[920000, 1]] }, { pre, editable, rows: rows.map((x) => [N(x.gold_rate_applied), r4(x.cash_equivalent_grams)]), bad, overflow });
    }
    // UI-2 manager handover dialog: LOM rate field present, default = official 900 000, editable; handover of valued cash
    // settles exactly the grams captured at payment time (the typed rate cannot change them)
    {
      const { ctx, p, bad } = await login('manager', { width: 1366, height: 900 });
      const sid = C.sellera.id;
      const nm = (await L.sel(`employees?id=eq.${sid}&select=full_name,name`))[0]; const label = nm.name || nm.full_name;
      const t0 = (await L.sel(`seller_gold_accounts?seller_id=eq.${sid}&select=c:seller_till_cash_amount,vc:till_valued_cash_uzs,vg:till_valued_cash_585_g,st:total_settled_to_manager_g`))[0];
      await p.goto(BASE + '/sales/app/sellers', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
      const card = p.locator('xpath=//*[normalize-space(text())="' + label + '"]/ancestor::*[count(.//button[contains(., "Qabul Qilish")])=1][1]');
      await card.first().locator('button', { hasText: 'Qabul Qilish' }).click(); await p.waitForTimeout(2500);
      const f = p.locator('[data-testid="surrender-lom-rate"]');
      const present = await f.count(); const pre = present ? await f.inputValue() : null; const editable = present ? await f.isEditable() : false;
      const legacy = r2(N(t0.c) - N(t0.vc));
      if (present) await f.fill('905000');
      await p.screenshot({ path: shot('manager-handover') }).catch(() => {});
      await p.getByRole('button', { name: /Qabul Qilish & Chek/ }).dblclick(); await p.waitForTimeout(4500);
      await ctx.close();
      const t1 = (await L.sel(`seller_gold_accounts?seller_id=eq.${sid}&select=c:seller_till_cash_amount,st:total_settled_to_manager_g`))[0];
      const expG = r4(N(t0.vg) + (legacy > 0 ? legacy / 905000 : 0));
      const settledCash = r4(N(t1.st) - N(t0.st));
      R.push({ id: 'RR-UI-2-raw', title: 'handover observations', ok: true, expected: null, actual: { till_before: t0, till_after: t1, legacy } });
      T('RR-UI-2', `manager handover dialog: LOM field present, default official ${OFF}, editable; typed 905 000 -> cash till 0, settled >= captured ${r4(N(t0.vg))} g + legacy / 905 000 (${expG} g), no API error`,
        present === 1 && N(pre) === OFF && editable && N(t1.c) === 0 && settledCash >= expG - 5e-5 && bad.length === 0,
        { pre: OFF, till: 0, min_settled: expG }, { present, pre, editable, till: N(t1.c), settled: settledCash, bad });
    }
    await br.close();
  }
  fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, run, results: R }, null, 2));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
