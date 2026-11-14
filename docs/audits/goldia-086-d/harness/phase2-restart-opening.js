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
  // ---------------------------------------------------------------- P0 / P1: nothing changed since the freeze; the verification
  const fz = (await L.sel(`financial_write_freezes?organization_id=eq.${L.ORG}&released_at=is.null&select=id,frozen_at`))[0];
  const fpNow = await fpD();
  T('P0', 'org D unchanged since the freeze of step 1 (fingerprint), freeze still active', !!fz && fpNow === ST.fp, { same: true }, { same: fpNow === ST.fp, frozen: fz && fz.frozen_at });
  if (fpNow !== ST.fp) { console.error('STOPPED: org D changed during the freeze'); process.exit(2); }
  const bvs = await L.sel(`financial_backup_verifications?organization_id=eq.${L.ORG}&select=id,backup_reference,backup_sha256,verified_at,consumed_by_restart_id,verified_by&order=verified_at`);
  const bv = bvs.find((x) => x.backup_sha256 === process.env.GA_BACKUP_SHA256 && !x.consumed_by_restart_id);
  T('P1', 'exactly one tooling-written verification for D (owner\'s dump SHA-256), written after the freeze started, unconsumed',
    bvs.length === 1 && !!bv && new Date(bv.verified_at) >= new Date(fz.frozen_at), { rows: 1, afterFreeze: true }, { rows: bvs.length, sha: bv && bv.backup_sha256.slice(0, 12), ref: bv && bv.backup_reference, afterFreeze: bv && new Date(bv.verified_at) >= new Date(fz.frozen_at) });
  if (!bv) { console.error('STOPPED: no matching verification'); process.exit(2); }
  // ---------------------------------------------------------------- P2: server-side T0 refusals (nothing consumed)
  const tr = (t0) => L.rpc('director', 'rpc_financial_restart', { p_confirmation: 'MOLIYAVIY HISOBNI QAYTA BOSHLASH', p_reason: 'T0 test', p_t0: t0, p_backup_verification_id: bv.id, p_idempotency_key: key('t0') });
  const fut = await tr(new Date(Date.now() + 10 * 60e3).toISOString()); const tooOld = await tr(new Date(Date.now() - 25 * 3600e3).toISOString());
  const cons0 = (await L.sel(`financial_backup_verifications?id=eq.${bv.id}&select=consumed_by_restart_id`))[0].consumed_by_restart_id;
  T('P2', 'T0 on the server: +10 min refused ERR_T0_FUTURE, -25 h refused ERR_T0_TOO_OLD; verification not consumed, no restart',
    /ERR_T0_FUTURE/.test(fut.error) && /ERR_T0_TOO_OLD/.test(tooOld.error) && !cons0 && (await L.sel(`financial_restarts?organization_id=eq.${L.ORG}&select=id`)).length === 0,
    'refused', { fut: String(fut.error).slice(0, 40), old: String(tooOld.error).slice(0, 40), consumed: cons0 });

  // ---------------------------------------------------------------- P3: restart in the UI from a browser in Tokyo (UTC+9)
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
  const intended = new Date(Math.floor((Date.now() - 5 * 60e3) / 60e3) * 60e3); // a whole minute, 5 min ago
  const wall = new Date(intended.getTime() + 5 * 3600e3).toISOString().slice(0, 16); // Tashkent wall clock
  {
    const { ctx, p, bad } = await login('director', { width: 1366, height: 900 }, 'Asia/Tokyo');
    const freezeShown = await p.locator('[data-testid="restart-freeze"]').count();
    await p.fill('[data-testid="restart-t0"]', wall);
    const tashkentShown = await p.locator('[data-testid="restart-t0-tashkent"]').innerText().catch(() => '');
    await p.fill('[data-testid="restart-reason"]', `F3 D sinov ${run}`);
    await p.selectOption('[data-testid="restart-backup"]', bv.id);
    await p.fill('[data-testid="restart-confirm"]', 'moliyaviy hisobni qayta boshlash');
    const disabledWrong = await p.locator('[data-testid="restart-submit"]').isDisabled();
    await p.fill('[data-testid="restart-confirm"]', 'MOLIYAVIY HISOBNI QAYTA BOSHLASH');
    await p.locator('[data-testid="restart-submit"]').dblclick(); await p.waitForTimeout(6000);
    await p.screenshot({ path: path.join(EV, 'p3-director-restart-tokyo.png') }).catch(() => {});
    await ctx.close();
    const rs = await L.sel(`financial_restarts?organization_id=eq.${L.ORG}&select=id,t0,backup_verification_id`);
    const drafts = await L.sel(`opening_periods?organization_id=eq.${L.ORG}&status=eq.draft&select=id`);
    T('P3', 'director UI in a Tokyo (UTC+9) browser: freeze shown, wrong phrase disabled, double click -> exactly one restart with T0 = the typed Tashkent wall clock, one draft',
      freezeShown === 1 && disabledWrong && rs.length === 1 && drafts.length === 1 && new Date(rs[0].t0).getTime() === intended.getTime() && rs[0].backup_verification_id === bv.id && bad.length === 0,
      { restarts: 1, t0: intended.toISOString() }, { freezeShown, disabledWrong, restarts: rs.length, t0: rs[0] && rs[0].t0, drafts: drafts.length, tashkentShown, bad });
    if (rs.length !== 1) { console.error('STOPPED: restart failed'); process.exit(1); }
  }
  // P4 draft: ordinary writes refused, identities kept, balances zero
  {
    const tries = [
      ['sellera', 'rpc_record_barcode_piece_sale', { p_customer_id: cu1, p_piece_id: ST.old.held[0].id, p_client_markup_pct: 12, p_idempotency_key: key('x') }],
      ['sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cu2, p_currency: 'USD', p_usd_amount: 5, p_usd_rate: 12600, p_idempotency_key: key('x') }],
      ['sellerb', 'rpc_record_client_legacy_debt', { p_customer_id: cu3, p_balance_type: 'debt', p_amount_585_g: 1, p_as_of_date: L.tashkentToday(), p_idempotency_key: key('x') }],
      ['manager', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 1000, p_currency: 'UZS', p_gold_rate: 900000, p_idempotency_key: key('x') }],
      ['director', 'rpc_record_factory_receipt', { p_product_name: 'x', p_original_physical_g: 1, p_factory_markup_pct: 8, p_idempotency_key: key('x') }],
    ];
    const res = await Promise.all(tries.map(([u, f, a]) => L.rpc(u, f, a)));
    const second = await L.rpc('director', 'rpc_financial_restart', { p_confirmation: 'MOLIYAVIY HISOBNI QAYTA BOSHLASH', p_reason: 'replay', p_t0: new Date(Date.now() - 60e3).toISOString(), p_backup_verification_id: bv.id, p_idempotency_key: key('rp') });
    const acc = await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=current_physical_stock_g,seller_owes_manager_g,seller_till_cash_amount,seller_till_usd_amount`);
    const zero = acc.every((a) => N(a.current_physical_stock_g) === 0 && N(a.seller_owes_manager_g) === 0 && N(a.seller_till_cash_amount) === 0 && N(a.seller_till_usd_amount) === 0);
    const custs = (await L.sel(`customers?organization_id=eq.${L.ORG}&select=id,seller_id`)).length;
    T('P4', 'draft: 5 ordinary writes (seller A / B, manager, director) refused; replay of the used verification refused; customers kept; every seller balance 0',
      res.every((r) => !r.ok && /ERR_OPENING_DRAFT|ERR_FINANCIAL_FREEZE/.test(r.error)) && !second.ok && zero && custs === 3, 'refused / 0',
      { errs: [...new Set(res.map((r) => (r.error || 'OK').slice(0, 30)))], replay: String(second.error).slice(0, 40), zero, custs });
  }
  // ---------------------------------------------------------------- P5 openings A-G + J from the frozen old balances
  const old = ST.old; const sa = old.sellers.find((s) => s.seller_id === A); const sb = old.sellers.find((s) => s.seller_id === B);
  const LOM = 900000; const USDR = 12600;
  // sellers handed their tills to the manager before T0: till value leaves their obligation, the cash is the manager's
  const handA = r4(N(sa.seller_till_cash_amount) / LOM + N(sa.seller_till_usd_amount) * USDR / LOM);
  const handB = r4(N(sb.seller_till_cash_amount) / LOM + N(sb.seller_till_usd_amount) * USDR / LOM);
  const oblA = r4(N(sa.seller_owes_manager_g) - handA); const oblB = r4(N(sb.seller_owes_manager_g) - handB);
  const heldA = old.held.filter((h) => ST.pieces.a.includes(h.id)); const heldB = old.held.filter((h) => ST.pieces.b.includes(h.id));
  const g = (c) => N((old.client_gold.find((x) => x.customer_id === c) || {}).current_debt_grams);
  const cur = (c, k) => N((old.client_currency.find((x) => x.customer_id === c && x.currency === k) || {}).debt_amount);
  const autoA = r4(heldA.reduce((s, h) => s + N(h.weight_grams), 0) * 1.10 + g(cu1) + g(cu2) + r4(cur(cu2, 'USD') * USDR / LOM));
  const autoB = r4(heldB.reduce((s, h) => s + N(h.weight_grams), 0) * 1.12 + g(cu3) + r4(cur(cu3, 'UZS') / LOM));
  const extraA = r4(oblA - autoA); const extraB = r4(oblB - autoB);
  const mgrStock = N(old.vault.manager_physical_stock_g); const heldAll = old.held.reduce((s, h) => s + N(h.weight_grams), 0);
  const facWithoutGoods = r4(N(old.vault.current_factory_obligation_g) - r4(mgrStock * 1.08) - r4(heldAll * 1.08));
  const cashUzs = N(sa.seller_till_cash_amount) + N(sb.seller_till_cash_amount) + N(old.vault.manager_cash_amount);
  const cashUsd = N(sa.seller_till_usd_amount) + N(sb.seller_till_usd_amount) + N(old.vault.manager_usd_amount);
  console.log(JSON.stringify({ plan: { A_manager_g: mgrStock, B_sellerA: heldA.map((h) => h.weight_grams), B_sellerB: heldB.map((h) => h.weight_grams), C_factory_without_goods_g: facWithoutGoods,
    D_extraA_g: extraA, D_extraB_g: extraB, E: { cu1: g(cu1), cu2: g(cu2), cu3: g(cu3) }, F: { cu2_usd: cur(cu2, 'USD'), cu3_uzs: cur(cu3, 'UZS') }, G: { uzs: cashUzs, usd: cashUsd }, oblA, oblB } }));
  const doc = async (u, a) => must(await L.rpc(u, 'rpc_record_opening_document', { ...a, p_idempotency_key: key('d') }), 'opening ' + a.p_kind);
  await doc('manager', { p_kind: 'manager_inventory', p_physical_g: mgrStock, p_factory_markup_pct: 8, p_product_name: 'A: menejer ombori' });
  await doc('manager', { p_kind: 'seller_inventory', p_seller_id: A, p_pieces: heldA.map((h) => ({ weight_grams: N(h.weight_grams) })), p_factory_markup_pct: 8, p_seller_markup_pct: 10 });
  await doc('director', { p_kind: 'seller_inventory', p_seller_id: B, p_pieces: heldB.map((h) => ({ weight_grams: N(h.weight_grams) })), p_factory_markup_pct: 8, p_seller_markup_pct: 12 });
  await doc('manager', { p_kind: 'factory_obligation', p_amount: facWithoutGoods, p_notes: 'C: sotilgan, zavodga to\'lanmagan' });
  if (extraA > 0) await doc('manager', { p_kind: 'seller_obligation', p_seller_id: A, p_amount: extraA, p_notes: 'D: sotilgan mahsulot kurs farqi (eski hisob)' });
  if (extraB > 0) await doc('manager', { p_kind: 'seller_obligation', p_seller_id: B, p_amount: extraB, p_notes: 'D: sotilgan mahsulot kurs farqi (eski hisob)' });
  for (const c of [cu1, cu2, cu3]) await doc('manager', { p_kind: 'customer_gram', p_customer_id: c, p_side: 'debt', p_amount: g(c) });
  await doc('manager', { p_kind: 'customer_currency', p_customer_id: cu2, p_unit: 'USD', p_side: 'debt', p_amount: cur(cu2, 'USD'), p_usd_rate: USDR, p_lom_rate: LOM });
  await doc('director', { p_kind: 'customer_currency', p_customer_id: cu3, p_unit: 'UZS', p_side: 'debt', p_amount: cur(cu3, 'UZS'), p_lom_rate: LOM });
  if (cashUsd > 0) await doc('manager', { p_kind: 'manager_cash', p_unit: 'USD', p_amount: cashUsd });
  await doc('manager', { p_kind: 'other', p_side: 'asset', p_unit: 'UZS', p_amount: 500000, p_lom_rate: LOM, p_other_type: 'ustaxona qarzi (sintetik)', p_counterparty: 'Usta (sintetik)' });
  // G UZS cash through the real manager UI (double click = once)
  {
    const { ctx, p, bad } = await login('manager');
    await p.selectOption('[data-testid="opening-kind"]', 'manager_cash'); await p.waitForTimeout(300);
    await p.selectOption('[data-testid="opening-unit"]', 'UZS'); await p.fill('[data-testid="opening-amount"]', String(cashUzs));
    await p.locator('[data-testid="opening-submit"]').dblclick(); await p.waitForTimeout(4000);
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
    const checks = await p.locator('[data-testid="opening-reconciliation"] li').allInnerTexts();
    await p.screenshot({ path: path.join(EV, 'p5-manager-openings.png'), fullPage: true }).catch(() => {});
    await ctx.close();
    const st = must(await L.rpc('manager', 'rpc_get_opening_state', {}), 'state');
    const acc = await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=seller_id,current_physical_stock_g,seller_owes_manager_g,seller_till_cash_amount,seller_till_usd_amount`);
    const a2 = acc.find((x) => x.seller_id === A); const b2 = acc.find((x) => x.seller_id === B);
    const v2 = (await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=manager_physical_stock_g,current_factory_obligation_g,manager_cash_amount,manager_usd_amount`))[0];
    const cg2 = await L.sel(`client_gold_accounts?organization_id=eq.${L.ORG}&select=customer_id,current_debt_grams`);
    const cc2 = await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&select=customer_id,currency,debt_amount`);
    const cashDocs = (await L.sel(`opening_documents?organization_id=eq.${L.ORG}&kind=eq.manager_cash&unit=eq.UZS&status=eq.active&select=id`)).length;
    const custOk = [cu1, cu2, cu3].every((c) => r4((cg2.find((x) => x.customer_id === c) || {}).current_debt_grams) === r4(g(c)))
      && N((cc2.find((x) => x.customer_id === cu2 && x.currency === 'USD') || {}).debt_amount) === cur(cu2, 'USD') && N((cc2.find((x) => x.customer_id === cu3 && x.currency === 'UZS') || {}).debt_amount) === cur(cu3, 'UZS');
    T('P5', 'openings A-G + J from the old balances: seller obligations = old minus the handed-over till (A ' + oblA + ', B ' + oblB + '), stock = held pieces, tills 0, every customer debt (g / USD / UZS) = old, factory 64.8 = old (no double count), manager stock = old, cash = tills handed over; UI cash entry once; reconciliation all green',
      r4(a2.seller_owes_manager_g) === oblA && r4(b2.seller_owes_manager_g) === oblB && N(a2.current_physical_stock_g) === N(sa.current_physical_stock_g) && N(b2.current_physical_stock_g) === N(sb.current_physical_stock_g)
        && N(a2.seller_till_cash_amount) + N(b2.seller_till_cash_amount) + N(a2.seller_till_usd_amount) === 0 && custOk
        && r4(v2.current_factory_obligation_g) === r4(old.vault.current_factory_obligation_g) && N(v2.manager_physical_stock_g) === mgrStock && N(v2.manager_cash_amount) === cashUzs && N(v2.manager_usd_amount) === cashUsd
        && cashDocs === 1 && Object.values(st.checks).every((x) => x === true || x === 0) && checks.length > 0 && checks.every((x) => x.startsWith('✅')) && bad.length === 0,
      { oblA, oblB, factory: old.vault.current_factory_obligation_g, cash: [cashUzs, cashUsd] },
      { oblA: a2.seller_owes_manager_g, oblB: b2.seller_owes_manager_g, stock: [a2.current_physical_stock_g, b2.current_physical_stock_g], factory: v2.current_factory_obligation_g, mgr: v2.manager_physical_stock_g, cash: [v2.manager_cash_amount, v2.manager_usd_amount], custOk, cashDocs, checks: st.checks, other: st.totals && st.totals.other_assets_585_g, bad });
  }
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
  fs.writeFileSync(path.join(EV, 'phase2-restart-opening.json'), JSON.stringify({ run, results: R }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error('STOPPED', e.message); process.exit(1); });
