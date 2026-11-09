// UI verification of 076 on the LOCAL full stack (real GoTrue logins, PostgREST, the real Next.js build on :3300).
// Every check reported as UI is done by clicking in the browser; the database is read afterwards as ground truth.
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
// GA_TARGET=staging -> the real staging site + staging Supabase (synthetic audit organization only)
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const API_HOST = TARGET === 'staging' ? 'vouehtlmsunebracahon.supabase.co' : '127.0.0.1:54321';
const OUT = process.env.GA_OUT || path.join(__dirname, '..', 'evidence', `${TARGET}-ui-076.json`);
const SHOTS = path.join(__dirname, '..', 'evidence', `${TARGET}-ui-076-screens`);
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 220)}`); };
const N = Number; const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
async function login(br, tag, vp = { width: 1366, height: 860 }) {
  const c = L.creds()[tag];
  const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const p = await ctx.newPage(); const bad = []; const toasts = [];
  p.on('response', (r) => { if (r.url().includes(API_HOST) && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split(API_HOST)[1].split('?')[0]); });
  p.on('dialog', (d) => d.accept(p.__promptAnswer || 'UI test'));
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2000);
  return { ctx, p, bad, toasts, tag };
}
const go = async (s, u) => { await s.p.goto(BASE + u, { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1500); };
const row = (s, name) => s.p.locator(`tr:has-text("${name}"), div.rounded-2xl:has-text("${name}")`).locator('visible=true').last();
const bodyText = async (s) => (await s.p.locator('body').innerText()).replace(/\s+/g, ' ');
const debt = async (cust) => N(((await L.sel(`client_gold_accounts?customer_id=eq.${cust}&select=d:current_debt_grams`))[0] || { d: 0 }).d);
const legRows = async (cust) => L.sel(`client_legacy_debts?customer_id=eq.${cust}&select=id,delta_585_g,status,created_by&order=created_at`);
const sellerAcc = async (sid) => (await L.sel(`seller_gold_accounts?seller_id=eq.${sid}&select=l:seller_legacy_debt_obligation_g,st:current_physical_stock_g`))[0] || { l: 0, st: 0 };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = L.creds(); const run = Date.now().toString(36);
  // ---- setup through the same RPCs with real JWTs (manager / seller)
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: L.tashkentToday() });
  const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `UI076 ${run}`, p_original_physical_g: 120, p_factory_markup_pct: 8 });
  const pieces = [...Array(12)].map((_, i) => ({ weight_grams: r4(5.5 + (i % 4) * 1.25), model_code: `U76-${run}-${i}` }));
  const cons = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.data.receipt_id, p_pieces: pieces });
  if (!cons.ok) throw new Error('consignment ' + cons.error);
  const names = { a: `UI76 Aziza ${run}`, b: `UI76 Bobur ${run}`, m: `UI76 Mobil ${run}` };
  const cust = {};
  for (const k of Object.keys(names)) cust[k] = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: names[k] })).data.customer_id;
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  // ================= seller, desktop: legacy debt 206.83 g (the incident)
  let s = await login(br, 'sellera');
  await go(s, '/sales/app/customers');
  const obl0 = await sellerAcc(C.sellera.id);
  await row(s, names.a).locator('button', { hasText: 'Eski qarz' }).first().click();
  await s.p.waitForTimeout(800);
  const advHidden = await s.p.locator('[data-testid="legacy-advance-manager-only"]').isVisible();
  const advBtn = await s.p.locator('button', { hasText: 'Biz mijozga qarzdormiz' }).count();
  // 081 (business decision 2026-11-09) supersedes the 076 expectation: a seller sees the advance option for a customer
  // WITHOUT open debt (this one is new); with open debt the "menejer" note is shown instead (tested in adv-081.js)
  T('UI-01', 'seller legacy dialog: advance option available for a customer without debt (081), direct addition preselected', !advHidden && advBtn === 1, { note: false, advanceButton: 1 }, { note: advHidden, advanceButton: advBtn });
  await s.p.fill('input[placeholder="Masalan: 10.0000"]', '206.83');
  await s.p.fill('input[placeholder^="Daftar 14-bet"]', 'Daftar 3-bet, eski qarz');
  const submit = s.p.locator('button[type="submit"]', { hasText: /Tasdiqlash & Saqlash|Saqlanmoqda/ });
  await submit.dblclick();
  await s.p.waitForTimeout(3000);
  const txt1 = await bodyText(s);
  await s.p.screenshot({ path: path.join(SHOTS, '01-seller-legacy-206.83.png') });
  const rows1 = await legRows(cust.a);
  T('UI-02', 'seller saves 206.83 g legacy debt in the UI (075: permission denied) - success message, no error', /Eski qarz\/avans muvaffaqiyatli saqlandi/.test(txt1) && !/Permission denied|xatolik/i.test(txt1.slice(0, 4000)), 'success', (txt1.match(/Eski qarz[^.]{0,120}/) || [''])[0]);
  T('UI-03', 'double click on submit -> exactly one legacy row, customer debt 206.83 g', rows1.length === 1 && (await debt(cust.a)) === 206.83, { rows: 1, debt: 206.83 }, { rows: rows1.length, debt: await debt(cust.a) });
  const obl1 = await sellerAcc(C.sellera.id);
  T('UI-04', 'seller obligation +206.83 g, physical stock unchanged', r4(N(obl1.l) - N(obl0.l)) === 206.83 && N(obl1.st) === N(obl0.st), { l: 206.83, stock: 'same' }, { l: r4(N(obl1.l) - N(obl0.l)), stock0: obl0.st, stock1: obl1.st });
  // reconcile down in the UI -> client-side refusal, nothing saved
  await go(s, '/sales/app/customers');
  await row(s, names.a).locator('button', { hasText: 'Eski qarz' }).first().click();
  await s.p.waitForTimeout(800);
  const histReverse = await s.p.locator('button', { hasText: '↩️ Bekor qilish' }).locator('visible=true').count();
  T('UI-05', 'seller sees his legacy history but no reverse button', histReverse === 0, 0, histReverse);
  await s.p.locator('button', { hasText: 'Qayta solishtirish' }).click();
  await s.p.fill('input[placeholder="Masalan: 15.0000"]', '150');
  await s.p.fill('input[placeholder^="Daftar 14-bet"]', 'kamaytirish urinish');
  await s.p.locator('button[type="submit"]', { hasText: 'Tasdiqlash & Saqlash' }).click();
  await s.p.waitForTimeout(2000);
  const txt2 = await bodyText(s);
  T('UI-06', 'seller reconciling DOWN (206.83 -> 150) is refused with a clear message, nothing saved', /faqat qarz qo'sha oladi/.test(txt2) && (await legRows(cust.a)).length === 1 && (await debt(cust.a)) === 206.83, 'refused', (txt2.match(/Sotuvchi faqat[^.]{0,80}/) || ['-'])[0]);
  await s.p.keyboard.press('Escape').catch(() => {});
  // ================= seller, desktop: weight sale 30 g @ 12 % without choosing a piece
  await go(s, '/sales/app/customers');
  const st0 = N((await sellerAcc(C.sellera.id)).st);
  await row(s, names.b).locator('button', { hasText: /\+ Nasiya/ }).first().click();
  await s.p.waitForTimeout(1500);
  const pieceSel = s.p.locator('[data-testid="weight-sale-source-piece"]');
  const selVisible = await pieceSel.isVisible().catch(() => false);
  const selRequired = selVisible ? await pieceSel.evaluate((e) => e.required) : null;
  const selFirst = selVisible ? await pieceSel.locator('option').first().innerText() : null;
  T('UI-07', 'weight sale: piece choice shown as OPTIONAL ("Avtomatik"), not required', selVisible && selRequired === false && /Avtomatik/.test(selFirst), { visible: true, required: false }, { visible: selVisible, required: selRequired, first: selFirst });
  await s.p.locator('input[placeholder="Masalan: 15.0000"]').locator('visible=true').first().fill('30');
  await s.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).click();
  await s.p.waitForTimeout(3000);
  const txt3 = await bodyText(s);
  await s.p.screenshot({ path: path.join(SHOTS, '02-seller-weight-sale-30g.png') });
  T('UI-08', 'seller records a 30 g credit sale without a product (075: ERR_PIECE_REQUIRED) -> 33.6 g debt', /Vazn bo'yicha savdo muvaffaqiyatli/.test(txt3) && (await debt(cust.b)) === 33.6, 33.6, { msg: (txt3.match(/(Vazn bo'yicha savdo[^.]{0,60}|xatolik[^.]{0,120})/i) || ['-'])[0], debt: await debt(cust.b) });
  const st1 = N((await sellerAcc(C.sellera.id)).st);
  const held = r4((await L.sel(`consignment_pieces?seller_id=eq.${C.sellera.id}&status=eq.held_by_seller&select=weight_grams`)).reduce((x, y) => x + N(y.weight_grams), 0));
  T('UI-09', 'seller stock -30 g and held pieces == gram stock', r4(st0 - st1) === 30 && Math.abs(held - st1) < 1e-9, { dec: 30 }, { dec: r4(st0 - st1), held, stock: st1 });
  T('UI-10', 'no 4xx/5xx from the API during the seller session (except expected)', s.bad.length === 0, [], s.bad.slice(0, 5));
  await s.ctx.close();
  // ================= seller, mobile 390 px: legacy debt via the card button
  s = await login(br, 'sellera', { width: 390, height: 844 });
  await go(s, '/sales/app/customers');
  await row(s, names.m).locator('button', { hasText: 'Eski qarz' }).first().click();
  await s.p.waitForTimeout(800);
  await s.p.fill('input[placeholder="Masalan: 10.0000"]', '12.5');
  await s.p.fill('input[placeholder^="Daftar 14-bet"]', 'mobil');
  await s.p.locator('button[type="submit"]', { hasText: 'Tasdiqlash & Saqlash' }).click();
  await s.p.waitForTimeout(2500);
  const ov = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await s.p.screenshot({ path: path.join(SHOTS, '03-seller-mobile-legacy.png') });
  T('UI-11', 'seller on a 390 px phone saves 12.5 g legacy debt; no horizontal overflow', (await debt(cust.m)) === 12.5 && ov <= 1, { debt: 12.5, overflow: 0 }, { debt: await debt(cust.m), overflow: ov });
  await s.ctx.close();
  // ================= manager: reverse the 206.83 entry from the dialog history
  const oblBeforeRev = await sellerAcc(C.sellera.id);
  s = await login(br, 'manager');
  await go(s, '/sales/app/customers');
  await row(s, names.a).locator('button', { hasText: 'Eski qarz' }).first().click();
  await s.p.waitForTimeout(1500);
  s.p.__promptAnswer = 'Xato kiritilgan (UI test)';
  const rev = s.p.locator('button', { hasText: '↩️ Bekor qilish' }).locator('visible=true').first();
  const canRev = await rev.count();
  if (canRev) { await rev.click(); await s.p.waitForTimeout(2500); }
  const txt4 = await bodyText(s);
  const legA = await legRows(cust.a);
  T('UI-12', 'manager reverses the seller\'s 206.83 g entry in the UI (075: permission denied)', canRev > 0 && legA[0].status === 'reversed' && (await debt(cust.a)) === 0, { status: 'reversed', debt: 0 }, { button: canRev, status: legA[0] && legA[0].status, debt: await debt(cust.a), msg: (txt4.match(/(muvaffaqiyatli bekor qilindi|xatolik[^.]{0,100})/i) || ['-'])[0] });
  const obl2 = await sellerAcc(C.sellera.id);
  T('UI-13', 'seller obligation recalculated after the reversal (-206.83 g)', r4(N(oblBeforeRev.l) - N(obl2.l)) === 206.83, 206.83, r4(N(oblBeforeRev.l) - N(obl2.l)));
  // manager: director-only actions are not offered
  await go(s, '/sales/app/settings');
  const addPreset = await s.p.locator('#addFactoryPresetBtn, #addClientPresetBtn').count();
  await go(s, '/sales/app');
  const acctBtns = await s.p.locator('button', { hasText: /Tarkibini ko'rish|Boshlang'ich|Qayta tasnif/ }).count();
  T('UI-14', 'manager: no markup preset add buttons, no accounting baseline actions (server allows only the director)', addPreset === 0 && acctBtns === 0, { presets: 0, accounting: 0 }, { presets: addPreset, accounting: acctBtns });
  T('UI-15', 'no 4xx/5xx from the API during the manager session', s.bad.length === 0, [], s.bad.slice(0, 5));
  await s.ctx.close();
  // ================= director still sees them
  s = await login(br, 'director');
  await go(s, '/sales/app/settings');
  const addPresetD = await s.p.locator('#addFactoryPresetBtn, #addClientPresetBtn').count();
  T('UI-16', 'director still has the markup preset buttons', addPresetD === 2, 2, addPresetD);
  await s.ctx.close();
  // ================= financial reversal through PostgREST (the exact UI call) as manager
  await L.rpc('manager', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 5000, p_currency: 'UZS', p_category: 'test', p_notes: 'UI076 capital' });
  const ft = await L.rpc('manager', 'rpc_record_financial_transaction', { p_transaction_type: 'business_expense', p_source_till: 'manager_uzs', p_amount: 1000, p_currency: 'UZS', p_category: 'test', p_notes: 'UI076' });
  if (!ft.ok) console.log('financial setup:', ft.error);
  const fr = ft.ok ? await L.rpc('manager', 'rpc_reverse_financial_transaction', { p_transaction_id: ft.data.transaction_id || ft.data.id, p_reason: 'UI076' }) : ft;
  T('UI-17', 'manager reverses a cash operation with the UI call {p_transaction_id, p_reason} (075: HTTP 300 PGRST203)', fr.ok, 'ok', fr.ok ? 'ok' : fr.status + ' ' + fr.error);
  await br.close();
  let ver = null; try { ver = JSON.parse(require('child_process').execFileSync('curl', ['-s', '-m', '30', BASE + '/api/version']).toString()); } catch { ver = null; }
  fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, version: ver, run, results: R }, null, 2));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
