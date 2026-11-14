// PHASE F3 step 2 on STAGING (087), org D only. Needs the ONE tooling-written verification of the backup taken inside D's
// freeze (GA_BACKUP_SHA256). Restart through the real UI in a browser of ANOTHER time zone, openings A-G + J from the old
// balances of step 1 (nothing invented: each value derived below from the frozen balances), reconciliation, lock (the freeze
// ends by itself), then D-1..D-6 and 077-085 regression in D. Prints ids / numbers / error codes only.
const fs = require('fs'); const path = require('path');
const L = require('./lib');
if (!/^[0-9a-f]{64}$/.test(process.env.GA_BACKUP_SHA256 || '')) { console.error('refused: GA_BACKUP_SHA256 (the owner\'s verified dump) is required'); process.exit(2); }
const N = (x) => Number(x || 0); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 320)}`); };
const EV = '/home/user/jewelryflow-erp/docs/audits/goldia-086-d/evidence';
const BASE = 'https://jewelryflow-sales-staging.vercel.app';
const FP_TABLES = ['client_gold_accounts', 'client_currency_accounts', 'seller_gold_accounts', 'manager_vault_account', 'customers', 'jewelry_sales', 'jewelry_sale_returns',
  'gold_settlements', 'client_currency_settlements', 'client_legacy_debts', 'seller_consignments', 'consignment_pieces', 'factory_receipts', 'factory_gold_handovers',
  'refining_batches', 'financial_transactions', 'gold_purchases', 'accounting_baselines', 'opening_periods', 'opening_documents', 'financial_restarts'];
async function fpD() {
  const parts = [];
  for (const t of FP_TABLES) {
    const rows = await L.sel(`${t}?organization_id=eq.${L.ORG}&select=*`);
    parts.push(t + ':' + rows.length + ':' + rows.map((r) => { const c = { ...r }; delete c.updated_at; return JSON.stringify(c, Object.keys(c).sort()); }).sort().join('|'));
  }
  return require('crypto').createHash('sha256').update(parts.join('\n')).digest('hex');
}
(async () => {
  const C = L.creds(); const ST = JSON.parse(fs.readFileSync(L.STATE)); const run = Date.now().toString(36); let kn = 0; const key = (p) => `f3d2-${run}-${p}-${++kn}`;
  const must = (r, n) => { if (!r.ok) throw new Error(`${n}: ${r.status} ${r.error}`); return r.data; };
  const A = C.sellera.id; const B = C.sellerb.id; const { cu1, cu2, cu3 } = ST.customers;
  const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const login = async (tag, vp = { width: 1366, height: 900 }, tz = 'Asia/Tashkent') => {
    const c = C[tag]; const ctx = await br.newContext({ viewport: vp, timezoneId: tz, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const bad = [];
    p.on('response', (r) => { if (/supabase\.co/.test(r.url()) && r.status() >= 500) bad.push(r.status() + ' ' + (r.url().split('/rest/')[1] || '')); });
    await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
    await p.goto(BASE + '/sales/app/opening', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
    return { ctx, p, bad };
  };
  const old = ST.old; const sa = old.sellers.find((s) => s.seller_id === A); const sb = old.sellers.find((s) => s.seller_id === B);
  // RESUME after P5 (the lock of the first run needed today's confirmed 585 rate): the director confirms today's rate
  const rate = await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: L.tashkentToday() });
  T('P6a', 'director confirms today\'s 585 rate (not a guarded financial table; needed by the baseline)', rate.ok, 'ok', rate.ok || rate.error);
  // ---------------------------------------------------------------- P6 lock -> the freeze ends by itself; ordinary work resumes
  {
    const lock = await L.rpc('manager', 'rpc_confirm_accounting_baseline', { p_notes: 'T0 F3 D', p_idempotency_key: key('b'), p_usd_rate: 12500 });
    const per = (await L.sel(`opening_periods?organization_id=eq.${L.ORG}&order=created_at.desc&limit=1&select=status,baseline_id`))[0];
    const fzRow = (await L.sel(`financial_write_freezes?organization_id=eq.${L.ORG}&select=released_at`))[0];
    const late = await L.rpc('manager', 'rpc_record_opening_document', { p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 1, p_idempotency_key: key('late') });
    const okWrite = await L.rpc('sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cu1, p_piece_id: (await L.sel(`consignment_pieces?organization_id=eq.${L.ORG}&status=eq.held_by_seller&weight_grams=eq.8&select=id`))[0].id, p_client_markup_pct: 12, p_idempotency_key: key('sale') });
    T('P6', 'lock with the baseline: period locked, the freeze ends automatically (no release step), a late opening entry refused, an ordinary sale works again',
      lock.ok && per.status === 'locked' && !!per.baseline_id && late.ok === false && /ERR_OPENING_LOCKED/.test(late.error) && okWrite.ok, 'locked + unfrozen',
      { lock: lock.ok || lock.error, period: per.status, freezeRowReleasedAt: fzRow.released_at, late: String(late.error).slice(0, 30), sale: okWrite.ok || okWrite.error });
    ST.saleId = okWrite.ok ? (okWrite.data.sale_id || okWrite.data.id) : null;
  }
  // ---------------------------------------------------------------- P7 rules after the opening (D-1 .. D-6) + 077-085 regression
  {
    const owes = async (s) => r4((await L.sel(`seller_gold_accounts?seller_id=eq.${s}&select=v:seller_owes_manager_g`))[0].v);
    const fac = async () => r4((await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=v:current_factory_obligation_g`))[0].v);
    const f0 = await fac(); const oA0 = await owes(A); const oB0 = await owes(B);
    // D-2 UZS: seller B's customer pays 5 000 000 of the opening UZS debt (snapshot 5.5556 g), hand over at 900 000
    const pay = must(await L.rpc('sellerb', 'rpc_record_client_currency_settlement', { p_customer_id: cu3, p_currency: 'UZS', p_cash_uzs: 5000000, p_idempotency_key: key('p') }), 'uzs pay');
    const oB1 = await owes(B);
    const h = must(await L.rpc('sellerb', 'rpc_record_seller_to_manager_settlement', { p_seller_id: B, p_cash_paid_amount: 5000000, p_rate_per_gram: 900000, p_idempotency_key: key('h') }), 'handover');
    const oB2 = await owes(B);
    T('D-2', 'seller B customer pays the opening UZS debt 5 000 000: snapshot 5.5556 g, obligation unchanged at payment, -5.5556 g at the handover (own seller\'s obligation)',
      r4(pay.opening_snapshot_585_g) === 5.5556 && oB1 === oB0 && r4(oB0 - oB2) === 5.5556, { snap: 5.5556, d: 5.5556 }, { snap: pay.opening_snapshot_585_g, oB0, oB1, oB2, diff: h.company_rate_difference_585_g });
    // D-3 USD advance of a new customer of seller A: no obligation change
    const c4 = must(await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `D86 Mijoz 4 ${run}` }), 'c4').customer_id;
    must(await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: c4, p_currency: 'USD', p_usd_amount: 50, p_usd_rate: 12500, p_idempotency_key: key('adv') }), 'advance');
    const adv = N((await L.sel(`client_currency_accounts?customer_id=eq.${c4}&currency=eq.USD&select=a:advance_amount`))[0].a);
    T('D-3', 'USD 50 advance (new customer of seller A): advance 50, seller A obligation unchanged', adv === 50 && (await owes(A)) === oA0, { adv: 50, owes: oA0 }, { adv, owes: await owes(A) });
    // 083 partial return of 2 g of the P6 sale (to the seller), 084 per-operation rate on a USD payment
    const sale = (await L.sel(`jewelry_sales?organization_id=eq.${L.ORG}&status=neq.reversed&order=created_at.desc&limit=1&select=id`))[0];
    const ret = await L.rpc('sellera', 'rpc_record_sale_return', { p_sale_id: sale.id, p_weight_grams: 2, p_reason: 'qisman qaytarish (sinov)', p_destination: 'seller', p_idempotency_key: key('ret') });
    const usdPay = await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cu2, p_currency: 'USD', p_usd_amount: 100, p_usd_rate: 12500, p_idempotency_key: key('up') });
    const cap = await L.rpc('manager', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 100000, p_currency: 'UZS', p_gold_rate: 900000, p_idempotency_key: key('cap') });
    const rep = await L.rpc('director', 'rpc_get_period_report', { p_from: L.tashkentToday(), p_to: L.tashkentToday() });
    const ps = await L.rpc('manager', 'rpc_get_accounting_profit_summary', { p_gold_rate: 900000, p_usd_rate: 12500 });
    T('REG', '077-085 regression in D after the opening: partial return 2 g (083), USD payment with its own rate 12 500 (084, snapshot 1.4 g), manager capital (077 parity), period report (080), profit summary',
      ret.ok && usdPay.ok && r4(usdPay.data.opening_snapshot_585_g) === 1.4 && cap.ok && rep.ok && ps.ok, 'all ok',
      { ret: ret.ok || ret.error, usd: usdPay.ok ? usdPay.data.opening_snapshot_585_g : usdPay.error, cap: cap.ok || cap.error, rep: rep.ok || rep.error, ps: ps.ok || ps.error });
    // D-1: factory obligation untouched by every seller / customer flow; D-5 other asset kept apart
    const st = must(await L.rpc('manager', 'rpc_get_opening_state', {}), 'state');
    T('D-1/D-5', 'factory obligation unchanged by the sale, return, payments, handover and advance (64.8); the other asset (J) stays separate (0.5556 g, not in any seller / customer / factory balance)',
      (await fac()) === f0 && f0 === r4(old.vault.current_factory_obligation_g) && r4(st.totals.other_assets_585_g) === 0.5556, { factory: f0, other: 0.5556 }, { factory: await fac(), other: st.totals.other_assets_585_g });
  }
  // P8 phone width
  {
    const { ctx, p } = await login('manager', { width: 390, height: 844 });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.screenshot({ path: path.join(EV, 'p8-manager-390.png') }).catch(() => {}); await ctx.close();
    T('P8', 'opening page on a 390 px phone: no horizontal overflow', overflow <= 0, 0, overflow);
  }
  await br.close();
  fs.writeFileSync(path.join(EV, 'phase2b-lock-regression.json'), JSON.stringify({ run, results: R }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
