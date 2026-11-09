// 077 through the real browser (real GoTrue logins, PostgREST, Next.js build): manager parity in the UI (capital entry,
// presets), simple main screen, UZS / USD price sale, currency payment (same currency + cross currency at the seller's
// own rate), manager reversal of a currency payment, period report (dates, CSV, start new period without any reset),
// mobile 390 px, seller kept out of the report. Ground truth = service-role reads.
//   GA_TARGET=local (127.0.0.1:3300) | staging (real staging, synthetic organization only)
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const API_HOST = TARGET === 'staging' ? 'vouehtlmsunebracahon.supabase.co' : '127.0.0.1:54321';
const EV = path.join(__dirname, '..', 'evidence'); const SHOTS = path.join(EV, `${TARGET}-ui-077-screens`);
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 220)}`); };
const N = Number; const r2 = (x) => Math.round(N(x) * 100) / 100;
async function login(br, tag, vp = { width: 1366, height: 860 }) {
  const c = L.creds()[tag];
  const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500, acceptDownloads: true });
  const p = await ctx.newPage(); const bad = [];
  p.on('response', (r) => { if (r.url().includes(API_HOST) && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split(API_HOST)[1].split('?')[0]); });
  p.on('dialog', (d) => d.accept(p.__answer || 'UI 077 test'));
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2000);
  return { ctx, p, bad };
}
const go = async (s, u) => { await s.p.goto(BASE + u, { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1500); };
const row = (s, name) => s.p.locator(`tr:has-text("${name}"), div.rounded-2xl:has-text("${name}")`).locator('visible=true').last();
const body = async (s) => (await s.p.locator('body').innerText()).replace(/\s+/g, ' ');
const vault = async () => (await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=c:manager_cash_amount,u:manager_usd_amount`))[0] || { c: 0, u: 0 };
const curAcc = async (cust, cur) => { const r = (await L.sel(`client_currency_accounts?customer_id=eq.${cust}&currency=eq.${cur}&select=d:debt_amount,a:advance_amount`))[0]; return r ? { d: N(r.d), a: N(r.a) } : { d: 0, a: 0 }; };
const sacc = async (sid) => (await L.sel(`seller_gold_accounts?seller_id=eq.${sid}&select=st:current_physical_stock_g,o:total_seller_obligation_g,c:seller_till_cash_amount,u:seller_till_usd_amount`))[0];
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday();
  // setup with real JWTs: 30 g to seller A at 10 %, seller rates, two customers
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `UI77 ${run}`, p_original_physical_g: 60, p_factory_markup_pct: 8 });
  const cs = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.data.receipt_id, p_pieces: [{ weight_grams: 8 }, { weight_grams: 12 }, { weight_grams: 10 }] });
  if (!cs.ok) throw new Error('consignment ' + cs.error);
  await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12500, p_reason: 'ui 077' });
  const nUsd = `UI77 Dollar ${run}`, nUzs = `UI77 Som ${run}`;
  const cUsd = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nUsd })).data.customer_id;
  const cUzs = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nUzs })).data.customer_id;
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });

  // ================= manager: simple panel, capital entry, presets
  let s = await login(br, 'manager');
  await go(s, '/sales/app');
  const panel = await s.p.locator('[data-testid="manager-simple-panel"]').isVisible();
  const cards = await s.p.locator('[data-testid^="simple-"]').count();
  const detailsOpen = await s.p.locator('[data-testid="dashboard-details"]').evaluate((e) => e.open).catch(() => null);
  await s.p.screenshot({ path: path.join(SHOTS, '01-manager-simple-panel.png'), fullPage: false });
  T('U77-01', 'manager main screen: simple panel with key balances + action links; detailed part folded under "Batafsil"', panel && cards >= 7 && detailsOpen === false, { panel: true, cards: '>=7', detailsOpen: false }, { panel, cards, detailsOpen });
  const capBtn = s.p.locator('button', { hasText: 'Xarajat / Kapital amali' });
  T('U77-02', 'manager sees the capital / expense button again (076 had hidden it)', (await capBtn.count()) > 0, '>0', await capBtn.count());
  const v0 = await vault();
  await capBtn.first().click(); await s.p.waitForTimeout(800);
  await s.p.locator('button', { hasText: 'Kapital Kiritish' }).first().click(); await s.p.waitForTimeout(500);
  await s.p.locator('input[placeholder="0"]').locator('visible=true').first().fill('3000000');
  await s.p.locator('button', { hasText: /Tasdiqlash & Yozish/ }).first().click(); await s.p.waitForTimeout(3000);
  const v1 = await vault();
  const ftx = (await L.sel(`financial_transactions?organization_id=eq.${L.ORG}&transaction_type=eq.capital_contribution&recorded_by=eq.${C.manager.id}&order=created_at.desc&limit=1&select=amount_num,source_till,currency`))[0];
  T('U77-03', 'manager records 3 000 000 UZS capital in the UI; manager cash +3 000 000 exactly once', N(v1.c) - N(v0.c) === 3000000 && ftx && N(ftx.amount_num) === 3000000, 3000000, { delta: N(v1.c) - N(v0.c), tx: ftx });
  await go(s, '/sales/app/settings');
  const presets = await s.p.locator('#addFactoryPresetBtn, #addClientPresetBtn').count();
  T('U77-04', 'manager has the markup preset buttons (director = manager)', presets === 2, 2, presets);
  T('U77-05', 'no API 4xx/5xx in the manager session', s.bad.length === 0, [], s.bad.slice(0, 5));
  await s.ctx.close();

  // ================= seller: USD price sale + currency payments
  s = await login(br, 'sellera');
  await go(s, '/sales/app/customers');
  const st0 = await sacc(C.sellera.id);
  await row(s, nUsd).locator('button', { hasText: /\+ Nasiya/ }).first().click(); await s.p.waitForTimeout(1500);
  await s.p.locator('[data-testid="sale-pricing-USD"]').click();
  await s.p.locator('input[placeholder="Masalan: 15.0000"]').locator('visible=true').first().fill('20');
  await s.p.locator('[data-testid="sale-amount"]').fill('2000');
  const markupHidden = (await s.p.locator('label', { hasText: 'Mijoz Ustama Foizi' }).count()) === 0;
  await s.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).dblclick(); await s.p.waitForTimeout(3500);
  const st1 = await sacc(C.sellera.id);
  const salesN = (await L.sel(`jewelry_sales?customer_id=eq.${cUsd}&select=id,sale_currency,sale_amount,base_weight_grams,client_gold_due_grams`));
  await s.p.screenshot({ path: path.join(SHOTS, '02-seller-usd-sale.png') });
  T('U77-10', 'seller sells 20 g for $2000 in the UI (double click -> one sale); no markup field for a price sale', salesN.length === 1 && salesN[0].sale_currency === 'USD' && N(salesN[0].sale_amount) === 2000 && markupHidden, { sales: 1, currency: 'USD', amount: 2000 }, { sales: salesN.length, row: salesN[0], markupHidden });
  T('U77-11', 'seller stock -20 g; the 33 g (30 g x 1.10) obligation is unchanged by the sale', r2(N(st0.st) - N(st1.st)) === 20 && N(st1.o) === N(st0.o), { stock: -20, obligation: 'same' }, { stock: r2(N(st1.st) - N(st0.st)), o0: st0.o, o1: st1.o });
  T('U77-12', 'customer owes 2000 USD; 585 gram debt untouched (0)', (await curAcc(cUsd, 'USD')).d === 2000 && N(((await L.sel(`client_gold_accounts?customer_id=eq.${cUsd}&select=d:current_debt_grams`))[0] || { d: 0 }).d) === 0, 2000, await curAcc(cUsd, 'USD'));
  // payment 500 USD (same currency)
  await go(s, '/sales/app/customers');
  await row(s, nUsd).locator('[data-testid="open-currency-payment"]').first().click(); await s.p.waitForTimeout(1500);
  await s.p.locator('[data-testid="currency-tab-USD"]').click();
  await s.p.locator('[data-testid="cpay-usd"]').fill('500');
  await s.p.locator('[data-testid="cpay-submit"]').dblclick(); await s.p.waitForTimeout(3000);
  const t1 = await sacc(C.sellera.id);
  T('U77-13', 'seller takes 500 USD in the UI (double click -> once): USD debt 1500, till +500 USD', (await curAcc(cUsd, 'USD')).d === 1500 && r2(N(t1.u) - N(st1.u)) === 500, { debt: 1500, till: 500 }, { debt: (await curAcc(cUsd, 'USD')).d, till: r2(N(t1.u) - N(st1.u)) });
  // cross currency: 1 250 000 so'm at the seller's 12 500 -> 100 USD
  await go(s, '/sales/app/customers');
  await row(s, nUsd).locator('[data-testid="open-currency-payment"]').first().click(); await s.p.waitForTimeout(1500);
  await s.p.locator('[data-testid="currency-tab-USD"]').click();
  // the modal loads balances, history and THEN the seller's own rates: wait for the rates line instead of a fixed delay
  await s.p.waitForFunction(() => /USD\s+[\d\s\u00a0]+\s*so/.test((document.querySelector('[data-testid="cpay-own-rates"]') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
  const ownRatesShown = await s.p.locator('[data-testid="cpay-own-rates"]').innerText().catch(() => '');
  // 084: the seller's saved rate is the editable default of the rate field (was hidden / locked before 084)
  await s.p.waitForFunction(() => ((document.querySelector('[data-testid="cpay-usd-rate"]') || {}).value || '') !== '', null, { timeout: 20000 }).catch(() => {});
  const rateValue = await s.p.locator('[data-testid="cpay-usd-rate"]').inputValue().catch(() => '');
  await s.p.locator('[data-testid="cpay-cash"]').fill('1250000');
  const preview = await s.p.locator('[data-testid="cpay-preview"]').innerText();
  await s.p.locator('[data-testid="cpay-submit"]').click(); await s.p.waitForTimeout(3000);
  const t2 = await sacc(C.sellera.id);
  T('U77-14', "seller pays a USD debt with 1 250 000 so'm at his saved 12 500 rate (prefilled default, editable since 084) -> 100 USD; till +1 250 000 so'm", (await curAcc(cUsd, 'USD')).d === 1400 && r2(N(t2.c) - N(t1.c)) === 1250000 && N(rateValue) === 12500 && /12[\s ]?500/.test(ownRatesShown) && /100/.test(preview), { debt: 1400, tillUzs: 1250000 }, { debt: (await curAcc(cUsd, 'USD')).d, till: r2(N(t2.c) - N(t1.c)), rateValue, ownRatesShown, preview: preview.slice(0, 60) });
  // UZS price sale on a phone
  await s.ctx.close();
  s = await login(br, 'sellera', { width: 390, height: 844 });
  await go(s, '/sales/app/customers');
  await row(s, nUzs).locator('button', { hasText: /\+ Nasiya/ }).first().click(); await s.p.waitForTimeout(1500);
  await s.p.locator('[data-testid="sale-pricing-UZS"]').click();
  await s.p.locator('input[placeholder="Masalan: 15.0000"]').locator('visible=true').first().fill('2.5');
  await s.p.locator('[data-testid="sale-amount"]').fill('3100000');
  await s.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).click(); await s.p.waitForTimeout(3500);
  const ov = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await s.p.screenshot({ path: path.join(SHOTS, '03-seller-mobile-uzs-sale.png') });
  T('U77-15', "seller on a 390 px phone sells 2.5 g for 3 100 000 so'm; no horizontal overflow", (await curAcc(cUzs, 'UZS')).d === 3100000 && ov <= 1, { debt: 3100000, overflow: 0 }, { debt: (await curAcc(cUzs, 'UZS')).d, ov });
  // seller cannot open the period report
  await go(s, '/sales/app/period-report');
  const sellerPath = new URL(s.p.url()).pathname;
  const sellerRpc = await L.rpc('sellera', 'rpc_get_period_report', { p_from: today, p_to: today });
  T('U77-16', 'seller is kept out of the period report (page + server)', sellerPath !== '/sales/app/period-report' && !sellerRpc.ok, 'redirected + 42501', { path: sellerPath, rpc: sellerRpc.ok ? 'ACCEPTED' : sellerRpc.error.slice(0, 50) });
  T('U77-17', 'no API 4xx/5xx in the seller sessions except the deliberate report probe', s.bad.filter((b) => !b.includes('rpc_get_period_report')).length === 0, [], s.bad.slice(0, 5));
  await s.ctx.close();

  // ================= manager: reverse one currency payment, period report, CSV, close period
  s = await login(br, 'manager');
  await go(s, '/sales/app/customers');
  await row(s, nUsd).locator('[data-testid="open-currency-payment"]').first().click(); await s.p.waitForTimeout(1500);
  s.p.__answer = 'UI test bekor';
  const rv = s.p.locator('[data-testid="cpay-history"] button').first();
  const canRev = await rv.count(); if (canRev) { await rv.click(); await s.p.waitForTimeout(2500); }
  T('U77-20', 'manager reverses the latest currency payment (100 USD) in the UI -> USD debt 1500', canRev > 0 && (await curAcc(cUsd, 'USD')).d === 1500, 1500, { button: canRev, debt: (await curAcc(cUsd, 'USD')).d });
  await go(s, '/sales/app/period-report');
  await s.p.locator('[data-testid="report-from"]').fill(today);
  await s.p.locator('[data-testid="report-to"]').fill(today);
  // wait for THIS report's response (a fixed 3 s was too short once staging held more data: the page still showed the
  // previous first-of-month report when it was read - staging 078 audit, harness timing, not an app defect)
  await Promise.all([
    s.p.waitForResponse((r) => r.url().includes('rpc_get_period_report') && (r.request().postData() || '').includes(`"p_from":"${today}"`), { timeout: 60000 }),
    s.p.locator('[data-testid="report-load"]').click(),
  ]);
  await s.p.waitForTimeout(1500);
  const flowUsd = await s.p.locator('[data-testid="flow-sale_usd"]').innerText().catch(() => '');
  const flowUzs = await s.p.locator('[data-testid="flow-sale_uzs"]').innerText().catch(() => '');
  await s.p.screenshot({ path: path.join(SHOTS, '04-manager-period-report.png'), fullPage: true });
  const api = await L.rpc('manager', 'rpc_get_period_report', { p_from: today, p_to: today });
  const dig = (x) => String(x).replace(/[^0-9]/g, '');
  // the page shows money with 2 decimals for USD ("$58 012,52") and whole so'm: compare with the exact amount, not a rounded one
  const amountShown = (text, amount) => { const t = dig(text); return t.includes(dig(N(amount).toFixed(2))) || (Number.isInteger(N(amount)) && t.includes(dig(N(amount)))); };
  const apiUsd = api.ok ? api.data.flows.sale_usd : null; const apiUzs = api.ok ? api.data.flows.sale_uzs : null;
  T('U77-21', 'period report shows UZS and USD sales separately; the page equals the server report (count, amount, physical g)',
    apiUsd && apiUzs && amountShown(flowUsd, apiUsd.amount) && amountShown(flowUzs, apiUzs.amount)
      && N(apiUsd.amount) >= 2000 && N(apiUzs.amount) >= 3100000 && flowUsd.includes(`\t${apiUsd.count}\t`),
    { usd: apiUsd && apiUsd.amount, uzs: apiUzs && apiUzs.amount }, { flowUsd: flowUsd.slice(0, 90), flowUzs: flowUzs.slice(0, 90) });
  const closeUsd = await s.p.locator('[data-testid="close-customer_debt_net_usd"]').innerText();
  const liveUsd = (await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&currency=eq.USD&select=debt_amount,advance_amount`)).reduce((a, x) => a + N(x.debt_amount) - N(x.advance_amount), 0);
  T('U77-22', 'report closing USD customer debt = live USD balances of the organization', N(closeUsd.replace(/[^0-9.,-]/g, '').replace(/\s/g, '').replace(',', '.')) === r2(liveUsd), r2(liveUsd), closeUsd);
  const [dl] = await Promise.all([s.p.waitForEvent('download', { timeout: 15000 }).catch(() => null), s.p.locator('[data-testid="report-csv"]').click()]);
  let csvOk = false; let csvHead = '';
  if (dl) { const fp = path.join(EV, `${TARGET}-period-report-077.csv`); await dl.saveAs(fp); const txt = fs.readFileSync(fp, 'utf8'); csvHead = txt.slice(0, 120); csvOk = /Mijozlar qarzi \(USD savdolar\)/.test(txt) && /Savdo: aniq USD narxda/.test(txt); }
  T('U77-23', 'CSV export downloads with balances and the USD sale flows', csvOk, true, csvHead.replace(/\r?\n/g, ' | ').slice(0, 100));
  // start a new period: nothing changes
  const snap = async () => JSON.stringify([await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&select=customer_id,currency,debt_amount,advance_amount&order=customer_id,currency`), await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=seller_id,current_physical_stock_g,seller_till_cash_amount,seller_till_usd_amount,seller_owes_manager_g&order=seller_id`), await vault()]);
  const b0 = await snap();
  const yesterday = new Date(Date.parse(today) - 86400e3).toISOString().slice(0, 10);
  await s.p.locator('[data-testid="report-from"]').fill(yesterday.slice(0, 8) + '01');
  await s.p.locator('[data-testid="report-to"]').fill(yesterday);
  await s.p.locator('[data-testid="report-load"]').click(); await s.p.waitForTimeout(2500);
  await s.p.locator('[data-testid="report-close-period"]').click(); await s.p.waitForTimeout(3000);
  const msg = await s.p.locator('[data-testid="report-msg"]').innerText().catch(() => '');
  const periods = await L.sel(`goldia_report_periods?organization_id=eq.${L.ORG}&select=period_start,period_end`);
  const b1 = await snap();
  T('U77-24', '"Yangi davrni boshlash" stores the period, says so; debts, stock, tills, vault unchanged', periods.some((p) => p.period_end === yesterday) && b0 === b1 && /saqlandi|avval yopilgan/.test(msg), { stored: yesterday, unchanged: true }, { msg: msg.slice(0, 80), periods: periods.length, unchanged: b0 === b1 });
  await s.p.locator('[data-testid="report-periods"] button').first().click(); await s.p.waitForTimeout(1500);
  const storedMsg = await s.p.locator('[data-testid="report-msg"]').innerText().catch(() => '');
  T('U77-25', 'a closed period can be opened again from the list (report kept)', /Saqlangan davr hisoboti/.test(storedMsg), 'shown', storedMsg.slice(0, 80));
  T('U77-26', 'no API 4xx/5xx in the manager session', s.bad.length === 0, [], s.bad.slice(0, 5));
  await s.ctx.close();
  s = await login(br, 'manager', { width: 390, height: 844 });
  await go(s, '/sales/app/period-report');
  await s.p.locator('[data-testid="report-load"]').click(); await s.p.waitForTimeout(2500);
  const ovm = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await go(s, '/sales/app');
  const ovd = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await s.p.screenshot({ path: path.join(SHOTS, '05-manager-mobile-panel.png') });
  T('U77-27', 'manager on a 390 px phone: period report and main screen without horizontal overflow', ovm <= 1 && ovd <= 1, 0, { report: ovm, main: ovd });
  await s.ctx.close();
  await br.close();
  let ver = null; try { ver = JSON.parse(require('child_process').execFileSync('curl', ['-s', '-m', '30', BASE + '/api/version']).toString()); } catch { ver = null; }
  fs.writeFileSync(path.join(EV, `${TARGET}-ui-077.json`), JSON.stringify({ target: TARGET, version: ver, run, results: R }, null, 2));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
