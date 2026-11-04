// STAGING UI (075 frontend fc1a1fa, schema 075): the incident and the gram-sale rule through the real browser,
// synthetic audit seller. Shows what a worker meets today; repeat after 076 is on staging.
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const BASE = 'https://jewelryflow-sales-staging.vercel.app';
const TAG = process.env.TAG || '075';
const SHOTS = path.join(__dirname, '..', 'evidence', `staging-ui-${TAG}-screens`);
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 260)}`); };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = L.creds(); const run = Date.now().toString(36);
  const nm = `UI INC ${run}`;
  const cu = await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nm });
  const nm2 = `UI WS ${run}`; await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nm2 });
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const ctx = await br.newContext({ viewport: { width: 1366, height: 860 } }); const p = await ctx.newPage();
  const api = []; p.on('response', (r) => { if (r.url().includes('/rest/v1/rpc/') && r.request().method() === 'POST') api.push(r.status() + ' ' + r.url().split('/rpc/')[1]); });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', C.sellera.email); await p.fill('input[type="password"]', C.sellera.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2500);
  const ver = await (await ctx.request.get(BASE + '/api/version')).json();
  await p.goto(BASE + '/sales/app/customers', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  const row = (n) => p.locator(`tr:has-text("${n}"), div.rounded-2xl:has-text("${n}")`).locator('visible=true').last();
  await row(nm).locator('button', { hasText: 'Eski qarz' }).first().click(); await p.waitForTimeout(1000);
  const direct = p.locator('button', { hasText: "Qo'lda qo'shish" }); if (await direct.count()) await direct.first().click();
  await p.fill('input[placeholder="Masalan: 10.0000"]', '206.83');
  await p.fill('input[placeholder^="Daftar 14-bet"]', 'daftar');
  await p.locator('button[type="submit"]', { hasText: 'Tasdiqlash & Saqlash' }).click(); await p.waitForTimeout(3500);
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  await p.screenshot({ path: path.join(SHOTS, '01-seller-legacy-206.83.png') });
  const saved = /muvaffaqiyatli saqlandi/.test(txt); const denied = /Permission denied|ruxsat/i.test(txt);
  T(`STG-${TAG}-01`, `staging UI (${ver.commit}): seller enters 206.83 g legacy debt`, TAG === '076' ? saved : denied, TAG === '076' ? 'saved' : 'permission denied (incident reproduced)', (txt.match(/(Eski qarzni saqlashda xatolik:[^.]{0,160}|Eski qarz\/avans muvaffaqiyatli[^.]{0,60})/) || ['-'])[0]);
  // gram sale of 30 g in the UI
  await p.goto(BASE + '/sales/app/customers', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  await row(nm2).locator('button', { hasText: /\+ Nasiya/ }).first().click(); await p.waitForTimeout(2000);
  const sel = p.locator('[data-testid="weight-sale-source-piece"]');
  const hasSel = await sel.isVisible().catch(() => false);
  const req = hasSel ? await sel.evaluate((e) => e.required) : null;
  await p.locator('input[placeholder="Masalan: 15.0000"]').locator('visible=true').first().fill('30');
  if (hasSel && req) { const opts = await sel.locator('option').count(); if (opts > 1) await sel.selectOption({ index: opts - 1 }); }
  await p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).click(); await p.waitForTimeout(3500);
  const txt2 = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  await p.screenshot({ path: path.join(SHOTS, '02-seller-gram-sale-30g.png') });
  const ok2 = /Vazn bo'yicha savdo muvaffaqiyatli/.test(txt2);
  T(`STG-${TAG}-02`, `staging UI: seller sells 30 g by weight without choosing a product (piece select required=${req})`, TAG === '076' ? ok2 : !ok2, TAG === '076' ? 'sold' : 'blocked (rule 1 not met at 075)', (txt2.match(/(Vazn bo'yicha savdo muvaffaqiyatli[^.]{0,40}|Savdoni rasmiylashtirishda xatolik:[^.]{0,140}|Tanlangan dona[^.]{0,80}|Qaysi donadan[^.]{0,60})/) || ['-'])[0]);
  fs.writeFileSync(path.join(__dirname, '..', 'evidence', `staging-ui-${TAG}.json`), JSON.stringify({ version: ver, api, results: R }, null, 2));
  await br.close();
})().catch((e) => { console.error(e); process.exit(1); });
