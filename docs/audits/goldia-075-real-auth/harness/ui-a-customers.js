// A — customer creation through the real UI (Playwright, real GoTrue login) on the LOCAL 075 stack, then the
// direct-INSERT bypass with the same users' real JWTs. Every expectation is checked in the database (service role).
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const fs = require('fs');
const { ORG, ORG56, creds, sel, uwrite, rpc, R, T } = require('./lib');
const BASE = 'http://127.0.0.1:3300';
const SHOTS = __dirname + '/../evidence/screens';
const canonicalMax = async (org) => Math.max(0, ...(await sel(`customers?organization_id=eq.${org}&select=customer_code`)).map((c) => (/^CUST-(\d{1,9})$/.exec(c.customer_code) || [])[1]).filter(Boolean).map(Number));
async function login(browser, tag, vp = { width: 1366, height: 860 }) {
  const c = creds()[tag];
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const p = await ctx.newPage(); const bad = [], errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  p.on('response', (r) => { if (r.status() >= 400 && r.url().includes(':54321')) bad.push(r.status() + ' ' + r.url().split(':54321')[1].slice(0, 90)); });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(1500);
  return { ctx, p, bad, errs };
}
async function createViaUi(s, name, { sellerLabel, dbl = false, shot } = {}) {
  await s.p.goto(BASE + '/sales/app/customers', { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1200);
  await s.p.getByRole('button', { name: /Yangi Mijoz Qo/ }).first().click();
  await s.p.fill('input[placeholder="Masalan: Dilrabo Karimova"]', name);
  if (sellerLabel) await s.p.locator('form select').first().selectOption({ label: sellerLabel });
  const btn = s.p.getByRole('button', { name: /Mijozni Saqlash/ });
  if (dbl) await btn.dblclick(); else await btn.click();
  await s.p.waitForTimeout(2500);
  if (shot) await s.p.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: false });
  const body = await s.p.textContent('body');
  return { saved: (body.match(/Yangi mijoz muvaffaqiyatli saqlandi: (CUST-[^\s—]+)/) || [])[1] || null, exists: /allaqachon mavjud/.test(body), error: (body.match(/Mijoz qo.shishda xatolik:[^\n]{0,120}/) || [])[0] || null };
}
const rows = (org, name) => sel(`customers?organization_id=eq.${org}&contact_name=eq.${encodeURIComponent(name)}&select=id,customer_code,seller_id,organization_id`);
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = creds();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // A1 seller A, desktop, double click on save
  const a = await login(browser, 'sellera');
  const a1 = await createViaUi(a, 'A mijoz 1 (UI)', { dbl: true, shot: 'A1-sellerA-create' });
  const r1 = await rows(ORG, 'A mijoz 1 (UI)');
  T('A1', 'seller A creates a customer in the UI (double click): one row, CUST-0001, own org, own seller', a1.saved === 'CUST-0001' && r1.length === 1 && r1[0].customer_code === 'CUST-0001' && r1[0].seller_id === C.sellera.id, { ui: 'CUST-0001', rows: 1 }, { ui: a1, rows: r1.length, row: r1[0] });
  const a2 = await createViaUi(a, 'A mijoz 2 (UI)');
  T('A2', 'second customer of org gets CUST-0002', a2.saved === 'CUST-0002', 'CUST-0002', a2);
  const dup = await createViaUi(a, 'a mijoz 1 (ui)', { shot: 'A3-duplicate' });
  T('A3', 'same name again (case-insensitive) is reported as existing, no new row', dup.exists && (await rows(ORG, 'a mijoz 1 (ui)')).length === 0, 'existing', dup);
  T('A4', 'seller A pages: no failed API calls during customer creation', a.bad.length === 0, [], a.bad);
  await a.ctx.close();
  // A5 mobile seller B
  const b = await login(browser, 'sellerb', { width: 390, height: 844 });
  const b1 = await createViaUi(b, 'B mijoz 1 (UI)', { shot: 'A5-sellerB-mobile-create' });
  const rb = await rows(ORG, 'B mijoz 1 (UI)');
  T('A5', 'seller B (mobile 390px) creates a customer: CUST-0003, seller B', b1.saved === 'CUST-0003' && rb.length === 1 && rb[0].seller_id === C.sellerb.id, 'CUST-0003', { ui: b1, row: rb[0] });
  await b.ctx.close();
  // A6 manager creates for seller C via the seller select
  const m = await login(browser, 'manager');
  const m1 = await createViaUi(m, 'C mijoz 1 (UI, menejer)', { sellerLabel: 'AUDIT sellerc', shot: 'A6-manager-for-sellerC' });
  const rm = await rows(ORG, 'C mijoz 1 (UI, menejer)');
  T('A6', 'manager creates a customer for seller C (legitimate)', m1.saved === 'CUST-0004' && rm.length === 1 && rm[0].seller_id === C.sellerc.id, { code: 'CUST-0004', seller: 'sellerc' }, { ui: m1, row: rm[0] });
  await m.ctx.close();
  // A7 organization 56 holds the planted long code: creation works and continues its own numbering
  const exp56 = 'CUST-' + String((await canonicalMax(ORG56)) + 1).padStart(4, '0');
  const s56 = await login(browser, 'seller56');
  const c56 = await createViaUi(s56, 'Org56 mijoz (UI)', { shot: 'A7-org56-create' });
  const r56 = await rows(ORG56, 'Org56 mijoz (UI)');
  T('A7', 'in the org with CUST-T056_1793002353699 the UI creates a customer (no overflow), next own number', c56.saved === exp56 && r56.length === 1, exp56, { ui: c56, row: r56[0] });
  await s56.ctx.close();
  await browser.close();
  // A8 the direct INSERT bypass with the same real sessions
  const direct = {};
  for (const tag of ['sellera', 'manager', 'director', 'seller56']) {
    const org = tag === 'seller56' ? ORG56 : ORG;
    const w = await uwrite(tag, 'POST', 'customers', { organization_id: org, customer_code: 'CUST-T999_9999999999999', contact_name: 'direct bypass', seller_id: C[tag].id });
    direct[tag] = w.ok ? 'INSERTED' : `${w.status} ${w.error.slice(0, 50)}`;
  }
  T('A8', 'direct PostgREST INSERT of a customer is refused for seller, manager, director', Object.values(direct).every((v) => !v.startsWith('INSERTED')) && (await sel(`customers?contact_name=eq.direct%20bypass&select=id`)).length === 0, 'refused x4', direct);
  const target = r1[0] && r1[0].id;
  const upCode = await uwrite('director', 'PATCH', `customers?id=eq.${target}`, { customer_code: 'CUST-T999_9999999999999' });
  const upPhone = await uwrite('director', 'PATCH', `customers?id=eq.${target}`, { phone: '+998900750001' });
  T('A9', 'direct UPDATE of customer_code refused; director can still edit the phone', !upCode.ok && upPhone.ok && upPhone.data.length === 1, { code: 'refused', phone: 'updated' }, { code: upCode.ok ? 'UPDATED' : upCode.error.slice(0, 60), phone: upPhone.ok ? upPhone.data.length : upPhone.error });
  const wrk = await rpc('worker', 'rpc_create_customer_with_code', { p_contact_name: 'by worker' });
  const forOther = await rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: 'for B', p_seller_id: C.sellerb.id });
  const foreignSeller = await rpc('director', 'rpc_create_customer_with_code', { p_contact_name: 'for org56', p_seller_id: C.seller56.id });
  T('A10', 'worker refused; seller cannot create for another seller; director cannot attach another org seller', !wrk.ok && !forOther.ok && !foreignSeller.ok, 'refused x3', [wrk.ok || wrk.error.slice(0, 50), forOther.ok || forOther.error.slice(0, 50), foreignSeller.ok || foreignSeller.error.slice(0, 50)]);
  // A11 F-STG-2 with real sessions
  const fsOwn = await rpc('director', 'rpc_get_factory_settings', { p_organization_id: ORG });
  const fsForeign = await rpc('director', 'rpc_get_factory_settings', { p_organization_id: ORG56 });
  const fsSeller = await rpc('sellera', 'rpc_get_factory_settings', { p_organization_id: ORG56 });
  const fsNoEmp = await rpc('noemp', 'rpc_get_factory_settings', {});
  T('A11', 'factory settings: own org returned; another org id refused (director, seller); no fallback without org', fsOwn.ok && fsOwn.data.organizationId === ORG && !fsForeign.ok && !fsSeller.ok && !fsNoEmp.ok, 'own only', { own: fsOwn.ok && fsOwn.data.organizationId, foreign: fsForeign.ok ? 'RETURNED' : fsForeign.error.slice(0, 50), seller: fsSeller.ok ? 'RETURNED' : 'refused', noemp: fsNoEmp.ok ? 'RETURNED' : 'refused' });
  fs.writeFileSync(__dirname + '/../evidence/A-customers.json', JSON.stringify(R, null, 1));
  console.log('RESULT A', R.filter((x) => x.ok).length, '/', R.length);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
