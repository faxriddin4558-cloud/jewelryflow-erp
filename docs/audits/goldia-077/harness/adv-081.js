// 081 seller legacy advance with real GoTrue logins through PostgREST + the real frontend (seller, manager, director):
//   SA-UI   seller enters an advance in the "Eski qarz" dialog for his own customer (double click -> one row); for a
//           customer with open debt the advance option is replaced by the "menejer" note
//   SA-API  server refusals: open debt, other seller's customer, another seller id, other organization, target balance,
//           reconciliation entry; nothing changes
//   SA-PAR  8 parallel requests with one key -> 1 row; 8 parallel with different keys -> 1 row (duplicate guard)
//   SA-MOD  no till / stock / vault / seller obligation movement; advance used by the next gram sale; manager reverses
//           (UI) the seller's advance, director enters an advance for any customer; no negative balance
//   SA-REC  reconciliation 0.0000 g: every seller's legacy obligation = max(0, active debt deltas); stock = held pieces
//   GA_TARGET=local (127.0.0.1:3300) | staging (synthetic organization only, after 081 is applied)
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const OB = TARGET === 'staging' ? (process.env.GA_OTHER_DIRECTOR || 'directorB') : 'director56'; // PHASE D: another synthetic org (C), B stays read-only
const EV = path.join(__dirname, '..', 'evidence', `${TARGET}-081`); fs.mkdirSync(EV, { recursive: true });
const N = Number; const r4 = (x) => Math.round(N(x) * 1e4) / 1e4; const u4 = (x) => Math.round(N(x) * 1e4);
const R = []; const OPS = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act, at: new Date().toISOString() }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
const acc = async (c) => { const a = (await L.sel(`client_gold_accounts?customer_id=eq.${c}&select=d:current_debt_grams,a:advance_balance_grams`))[0]; return a ? { d: r4(a.d), a: r4(a.a) } : { d: 0, a: 0 }; };
const legRows = async (c) => L.sel(`client_legacy_debts?customer_id=eq.${c}&select=id,balance_type,delta_585_g,status,created_by,seller_id&order=created_at.asc`);
const money = async (sid) => {
  const s = (await L.sel(`seller_gold_accounts?seller_id=eq.${sid}&select=st:current_physical_stock_g,o:total_seller_obligation_g,l:seller_legacy_debt_obligation_g,c:seller_till_cash_amount,u:seller_till_usd_amount,sc:seller_till_scrap_grams`))[0];
  const v = (await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=c:manager_cash_amount,u:manager_usd_amount,st:manager_physical_stock_g`))[0];
  return JSON.stringify({ s, v });
};
const adv = (c, g, extra = {}) => ({ p_customer_id: c, p_balance_type: 'advance', p_amount_585_g: g, p_as_of_date: L.tashkentToday(), p_notes: 'ADV081', p_entry_type: 'manual_addition', p_target_final_balance: null, ...extra });
async function login(br, tag, vp = { width: 1366, height: 860 }) {
  const c = L.creds()[tag]; const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const bad = [];
  p.on('response', (r) => { if (/supabase\.co|127\.0\.0\.1:54321/.test(r.url()) && r.status() >= 400) bad.push(r.status() + ' ' + (r.url().split('/rest/')[1] || r.url()).split('?')[0]); });
  p.on('dialog', (d) => d.accept('ADV081 bekor qilish'));
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2000); return { ctx, p, bad };
}
const go = async (s, u) => { await s.p.goto(BASE + u, { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1800); };
const row = (s, name) => s.p.locator(`tr:has-text("${name}")`).first();
(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday();
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `ADV81 ${run}`, p_original_physical_g: 20, p_factory_markup_pct: 8 });
  const cs = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.data.receipt_id, p_pieces: [{ weight_grams: 10 }, { weight_grams: 10 }] });
  if (!cs.ok) throw new Error('consignment ' + cs.error);
  const nA = `ADV81 Avans ${run}`, nD = `ADV81 Qarzdor ${run}`, nP = `ADV81 Parallel ${run}`, nQ = `ADV81 ParallelQ ${run}`;
  const A = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nA })).data.customer_id;
  const Dc = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nD })).data.customer_id;
  const P1 = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nP })).data.customer_id;
  const P2 = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nQ })).data.customer_id;
  const Bc = (await L.rpc('sellerb', 'rpc_create_customer_with_code', { p_contact_name: `ADV81 SellerB ${run}` })).data.customer_id;
  const X = (await L.rpc(OB, 'rpc_create_customer_with_code', { p_contact_name: `ADV81 Begona ${run}` })).data?.customer_id;
  await L.rpc('sellera', 'rpc_record_client_legacy_debt', { ...adv(Dc, 0), p_balance_type: 'debt', p_amount_585_g: 7, p_idempotency_key: `adv81-d-${run}` });
  const m0 = await money(C.sellera.id);
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  try {
    // ---------------- seller UI ----------------
    const s = await login(br, 'sellera');
    await go(s, '/sales/app/customers');
    await row(s, nA).locator('button', { hasText: 'Eski qarz' }).first().click(); await s.p.waitForTimeout(800);
    const advBtn = await s.p.locator('[data-testid="legacy-type-advance"]').count();
    await s.p.locator('[data-testid="legacy-type-advance"]').click();
    await s.p.fill('input[placeholder="Masalan: 10.0000"]', '12.5');
    await s.p.fill('input[placeholder^="Daftar 14-bet"]', 'ADV081 daftar: mijoz oldindan bergan');
    await s.p.locator('button[type="submit"]', { hasText: /Tasdiqlash & Saqlash|Saqlanmoqda/ }).dblclick(); await s.p.waitForTimeout(3000);
    const txt = (await s.p.locator('body').innerText()).replace(/\s+/g, ' ');
    const rA = await legRows(A);
    await s.p.screenshot({ path: path.join(EV, 'seller-advance-saved.png') });
    T('SA-UI-1', 'seller: advance option in the "Eski qarz" dialog; 12.5 g advance saved (double click -> exactly one row, type advance, booked on the seller)',
      advBtn === 1 && rA.length === 1 && rA[0].balance_type === 'advance' && N(rA[0].delta_585_g) === -12.5 && rA[0].seller_id === C.sellera.id && /muvaffaqiyatli saqlandi/.test(txt),
      { button: 1, rows: 1, delta: -12.5 }, { button: advBtn, rows: rA.length, row: rA[0], msg: (txt.match(/Eski qarz\/avans muvaffaqiyatli saqlandi[^.]*/) || [''])[0].slice(0, 90) });
    T('SA-MOD-1', 'customer: debt 0, advance 12.5 g; seller stock / tills / obligation and manager vault unchanged (no cash income, no stock out)', JSON.stringify(await acc(A)) === JSON.stringify({ d: 0, a: 12.5 }) && (await money(C.sellera.id)) === m0, { d: 0, a: 12.5, money: 'same' }, { acc: await acc(A), same: (await money(C.sellera.id)) === m0 });
    await go(s, '/sales/app/customers');
    await row(s, nD).locator('button', { hasText: 'Eski qarz' }).first().click(); await s.p.waitForTimeout(800);
    const note = await s.p.locator('[data-testid="legacy-advance-manager-only"]').isVisible(); const btn2 = await s.p.locator('[data-testid="legacy-type-advance"]').count();
    T('SA-UI-2', 'seller, customer with open 7 g debt: no advance button, the "menejer" note instead', note && btn2 === 0, { note: true, button: 0 }, { note, button: btn2 });
    T('SA-UI-3', 'no API 4xx / 5xx in the seller UI session', s.bad.length === 0, [], s.bad);
    await s.ctx.close();

    // ---------------- server refusals ----------------
    const at = {
      openDebt: await L.rpc('sellera', 'rpc_record_client_legacy_debt', adv(Dc, 3)),
      otherSellerCustomer: await L.rpc('sellera', 'rpc_record_client_legacy_debt', adv(Bc, 3)),
      otherSellerId: await L.rpc('sellera', 'rpc_record_client_legacy_debt', adv(A, 3, { p_seller_id: C.sellerb.id })),
      otherOrg: X ? await L.rpc('sellera', 'rpc_record_client_legacy_debt', adv(X, 3)) : { ok: false, error: 'Mijoz topilmadi (no foreign customer)' },
      targetBalance: await L.rpc('sellera', 'rpc_record_client_legacy_debt', adv(A, 0, { p_entry_type: 'reconciliation_adjustment', p_target_final_balance: 50 })),
      reconEntry: await L.rpc('sellera', 'rpc_record_client_legacy_debt', adv(A, 1, { p_entry_type: 'reconciliation_adjustment' })),
      sellerReverse: await L.rpc('sellera', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: rA[0].id, p_reason: 'x' }),
    };
    OPS.push({ kind: 'refusals', results: Object.fromEntries(Object.entries(at).map(([k, r]) => [k, r.ok ? 'ACCEPTED' : (r.error || '').slice(0, 90)])) });
    T('SA-API-1', 'server refuses: open debt, other seller customer, other seller id, other organization, target balance, reconciliation entry, seller reversal',
      Object.values(at).every((r) => !r.ok) && /ochiq qarz/.test(at.openDebt.error) && /biriktirilmagan/.test(at.otherSellerCustomer.error) && /nomiga/.test(at.otherSellerId.error) && /topilmadi/.test(at.otherOrg.error),
      'all refused', Object.fromEntries(Object.entries(at).map(([k, r]) => [k, r.ok ? 'ACCEPTED' : (r.error || '').slice(0, 45)])));
    T('SA-API-2', 'nothing changed by the refusals (A 12.5 advance, D 7 g debt, B / X untouched, money unchanged)',
      JSON.stringify(await acc(A)) === JSON.stringify({ d: 0, a: 12.5 }) && (await acc(Dc)).d === 7 && (await acc(Bc)).a === 0 && (await money(C.sellera.id)) === m0, 'unchanged', { A: await acc(A), D: await acc(Dc), B: await acc(Bc) });

    // ---------------- concurrency ----------------
    const p1 = await Promise.all(Array.from({ length: 8 }, () => L.rpc('sellera', 'rpc_record_client_legacy_debt', { ...adv(P1, 5), p_idempotency_key: `adv81-p1-${run}` })));
    const p2 = await Promise.all(Array.from({ length: 8 }, (_, i) => L.rpc('sellera', 'rpc_record_client_legacy_debt', { ...adv(P2, 5), p_idempotency_key: `adv81-p2-${run}-${i}` })));
    const r1 = await legRows(P1), r2 = await legRows(P2);
    T('SA-PAR', '8 parallel same key -> 1 row (advance 5); 8 parallel different keys -> 1 row, the rest refused as duplicates (advance 5)',
      r1.length === 1 && (await acc(P1)).a === 5 && r2.length === 1 && (await acc(P2)).a === 5 && p2.filter((r) => !r.ok).length === 7,
      { rows: [1, 1], advance: [5, 5] }, { rows: [r1.length, r2.length], advance: [(await acc(P1)).a, (await acc(P2)).a], ok_same_key: p1.filter((r) => r.ok).length, refused_other_keys: p2.filter((r) => !r.ok).length });

    // ---------------- advance used by a sale; manager reversal in the UI; director ----------------
    const o0 = (await L.sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=o:total_seller_obligation_g`))[0].o;
    const sale = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: A, p_weight_grams: 10, p_client_markup_pct: 10, p_idempotency_key: `adv81-s-${run}` });
    T('SA-MOD-2', 'next 10 g @ 10 % sale uses 11 g of the 12.5 g advance -> debt 0, advance 1.5; seller obligation +0 from the advance (consignment only)',
      sale.ok && N(sale.data.advance_applied_grams) === 11 && JSON.stringify(await acc(A)) === JSON.stringify({ d: 0, a: 1.5 }) && N((await L.sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=o:total_seller_obligation_g`))[0].o) === N(o0),
      { applied: 11, acc: { d: 0, a: 1.5 } }, { ok: sale.ok, err: sale.error, applied: sale.data && sale.data.advance_applied_grams, acc: await acc(A) });
    const m = await login(br, 'manager');
    await go(m, '/sales/app/customers');
    await row(m, nP).locator('button', { hasText: 'Eski qarz' }).first().click(); await m.p.waitForTimeout(1000);
    const rev = m.p.locator('button', { hasText: '↩️ Bekor qilish' }).locator('visible=true').first();
    const canRev = await rev.count(); if (canRev) { await rev.click(); await m.p.waitForTimeout(2500); }
    const rP = await legRows(P1);
    T('SA-MOD-3', "manager sees the seller's advance and reverses it in the UI -> advance 0, row reversed; no API error", canRev > 0 && rP[0].status === 'reversed' && (await acc(P1)).a === 0 && m.bad.length === 0, { reversed: true, advance: 0 }, { button: canRev, status: rP[0].status, acc: await acc(P1), bad: m.bad });
    await m.ctx.close();
    const d = await L.rpc('director', 'rpc_record_client_legacy_debt', adv(Bc, 2));
    T('SA-MOD-4', "director (= manager rights) enters an advance for another seller's customer", d.ok && (await acc(Bc)).a === 2, 2, { ok: d.ok, err: d.error, acc: await acc(Bc) });
  } finally { await br.close(); }

  // ---------------- reconciliation 0.0000 g + no negatives ----------------
  const sga = await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=seller_id,current_physical_stock_g,seller_legacy_debt_obligation_g`);
  const legAll = []; for (let o = 0; ; o += 1000) { const pg = await L.sel(`client_legacy_debts?organization_id=eq.${L.ORG}&status=neq.reversed&balance_type=eq.debt&select=seller_id,delta_585_g&order=id.asc&limit=1000&offset=${o}`); legAll.push(...pg); if (pg.length < 1000) break; }
  const held = []; for (let o = 0; ; o += 1000) { const pg = await L.sel(`consignment_pieces?organization_id=eq.${L.ORG}&status=eq.held_by_seller&select=seller_id,weight_grams&order=id.asc&limit=1000&offset=${o}`); held.push(...pg); if (pg.length < 1000) break; }
  const lm = new Map(); for (const x of legAll) lm.set(x.seller_id, (lm.get(x.seller_id) || 0) + u4(x.delta_585_g));
  const hm = new Map(); for (const x of held) hm.set(x.seller_id, (hm.get(x.seller_id) || 0) + u4(x.weight_grams));
  const oblBad = sga.filter((s) => u4(s.seller_legacy_debt_obligation_g) !== Math.max(0, lm.get(s.seller_id) || 0));
  const stkBad = sga.filter((s) => u4(Math.max(0, N(s.current_physical_stock_g))) !== (hm.get(s.seller_id) || 0));
  const neg = (await L.sel(`client_gold_accounts?organization_id=eq.${L.ORG}&or=(current_debt_grams.lt.0,advance_balance_grams.lt.0)&select=customer_id`)).length;
  const both = (await L.sel(`client_gold_accounts?organization_id=eq.${L.ORG}&current_debt_grams=gt.0&advance_balance_grams=gt.0&select=customer_id`)).length;
  T('SA-REC', `reconciliation (${sga.length} sellers): legacy obligation = max(0, active debt deltas), stock = held pieces - 0.0000 g; no negative balance, no debt + advance at once`,
    !oblBad.length && !stkBad.length && neg === 0 && both === 0, { diff_g: '0.0000', negative: 0, both: 0 }, { obligation: oblBad.length, stock: stkBad.length, negative: neg, both });
  fs.writeFileSync(path.join(EV, `${TARGET}-adv-081.json`), JSON.stringify({ target: TARGET, run, ids: { A, Dc, P1, P2, Bc, X }, results: R, ops: OPS }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
