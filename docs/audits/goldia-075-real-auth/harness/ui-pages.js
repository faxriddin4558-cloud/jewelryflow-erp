// D/UI: seller and manager screens on the LOCAL 075 stack with real GoTrue logins (Playwright), plus a weight sale
// through the customer form with the explicit piece selection; every effect is checked in the database.
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const fs = require('fs');
const { ORG, creds, sel, R, T } = require('./lib');
const BASE = 'http://127.0.0.1:3300'; const SHOTS = __dirname + '/../evidence/screens';
async function login(browser, tag, vp) {
  const c = creds()[tag];
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const errs = [], bad = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  p.on('response', (r) => { if (r.status() >= 400 && r.url().includes(':54321')) bad.push(r.status() + ' ' + r.url().split(':54321')[1].slice(0, 100)); });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForTimeout(1500);
  return { ctx, p, errs, bad };
}
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = creds(); const SA = C.sellera.id;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [label, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 860 }]]) {
    const a = await login(browser, 'sellera', vp);
    const nav = await a.p.locator('aside a, nav a').evaluateAll((as) => [...new Set(as.map((x) => x.getAttribute('href')).filter((h) => h && h.startsWith('/sales')))]);
    T('U1-' + label, `seller A menu = 5 sections (${label})`, JSON.stringify(nav.sort()) === JSON.stringify(['/sales/app', '/sales/app/customers', '/sales/app/kassam', '/sales/app/markup', '/sales/app/scan'].sort()), 5, nav);
    for (const u of ['/sales/director', '/sales/app/factory', '/sales/app/inventory', '/']) {
      await a.p.goto(BASE + u, { waitUntil: 'networkidle' }); await a.p.waitForTimeout(800);
      const landed = a.p.url().replace(BASE, '').split('?')[0];
      T('U2-' + label + u, `forbidden URL ${u} keeps the seller in the seller area`, landed.startsWith('/sales/app') && !landed.startsWith('/sales/app/factory') && !landed.startsWith('/sales/app/inventory'), '/sales/app*', landed);
    }
    for (const u of ['/sales/app', '/sales/app/scan', '/sales/app/customers', '/sales/app/kassam', '/sales/app/markup']) {
      const b0 = a.bad.length; await a.p.goto(BASE + u, { waitUntil: 'networkidle' }); await a.p.waitForTimeout(1200);
      await a.p.screenshot({ path: `${SHOTS}/sellerA-${label}${u.replace(/\//g, '_')}.png`, fullPage: false });
      T('U3-' + label + u, `seller A ${u} loads without failed API calls (${label})`, a.bad.length === b0, [], a.bad.slice(b0));
    }
    await a.ctx.close();
  }
  // weight sale through the customer form with an explicit piece (mobile)
  const a = await login(browser, 'sellera', { width: 390, height: 844 });
  await a.p.goto(BASE + '/sales/app/customers', { waitUntil: 'networkidle' }); await a.p.waitForTimeout(1500);
  await a.p.locator('button', { hasText: '+ Nasiya' }).first().click(); await a.p.waitForTimeout(1200);
  const selEl = a.p.locator('[data-testid="weight-sale-source-piece"]');
  const opts = await selEl.locator('option').count();
  T('U4', 'weight-sale form shows "Qaysi donadan?" with the seller\'s own pieces', (await selEl.count()) === 1 && opts > 1, '>1 options', opts);
  const salesBefore = (await sel(`jewelry_sales?seller_id=eq.${SA}&select=id`)).length;
  await a.p.locator('input[placeholder="Masalan: 15.0000"]').first().fill('1');
  await a.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).click(); await a.p.waitForTimeout(1500);
  const blockedNoPiece = (await sel(`jewelry_sales?seller_id=eq.${SA}&select=id`)).length === salesBefore;
  T('U5', 'submit without choosing a piece creates no sale', blockedNoPiece, 0, (await sel(`jewelry_sales?seller_id=eq.${SA}&select=id`)).length - salesBefore);
  const target = (await sel(`consignment_pieces?seller_id=eq.${SA}&status=eq.held_by_seller&order=weight_grams.desc&limit=1&select=id,weight_grams`))[0];
  await selEl.selectOption(target.id); await a.p.waitForTimeout(300);
  await a.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).dblclick(); await a.p.waitForTimeout(3000);
  await a.p.screenshot({ path: `${SHOTS}/sellerA-weight-sale-result.png`, fullPage: false });
  const after = await sel(`jewelry_sales?seller_id=eq.${SA}&select=id,sale_date,created_at&order=created_at.desc`);
  const alloc = after[0] ? await sel(`weight_sale_allocations?sale_id=eq.${after[0].id}&select=piece_id,grams`) : [];
  const pieceNow = Number((await sel(`consignment_pieces?id=eq.${target.id}&select=weight_grams`))[0].weight_grams);
  T('U6', `UI weight sale of 1 g cuts exactly the chosen piece (${target.weight_grams} g -> ${Number(target.weight_grams) - 1} g), one sale despite double click`,
    after.length - salesBefore === 1 && alloc.length === 1 && alloc[0].piece_id === target.id && Number(alloc[0].grams) === 1 && Math.abs(pieceNow - (Number(target.weight_grams) - 1)) < 0.00005,
    { new_sales: 1, piece: target.id.slice(0, 8), grams: 1 }, { new_sales: after.length - salesBefore, alloc, piece_now: pieceNow });
  T('U7', 'UI sale dated with the Tashkent business date', after[0] && after[0].sale_date === new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10), 'today TKT', after[0] && after[0].sale_date);
  await a.p.reload({ waitUntil: 'networkidle' }); T('U8', 'session survives refresh', !a.p.url().includes('/sales/login'), 'logged in', a.p.url().replace(BASE, ''));
  await a.ctx.close();
  const m = await login(browser, 'manager', { width: 1366, height: 860 });
  for (const u of ['/sales/app', '/sales/app/consignments', '/sales/app/sellers', '/sales/app/reports', '/sales/app/cash', '/sales/app/factory', '/sales/app/customers']) {
    const b0 = m.bad.length; await m.p.goto(BASE + u, { waitUntil: 'networkidle' }); await m.p.waitForTimeout(1300);
    await m.p.screenshot({ path: `${SHOTS}/manager${u.replace(/\//g, '_')}.png`, fullPage: false });
    T('U9' + u, `manager ${u} loads without failed API calls`, m.bad.length === b0, [], m.bad.slice(b0));
  }
  await m.ctx.close();
  const d = await login(browser, 'director', { width: 1366, height: 860 });
  for (const u of ['/sales/app', '/sales/app/customers', '/sales/app/reports']) {
    const b0 = d.bad.length; await d.p.goto(BASE + u, { waitUntil: 'networkidle' }); await d.p.waitForTimeout(1300);
    T('U10' + u, `director ${u} loads without failed API calls`, d.bad.length === b0, [], d.bad.slice(b0));
  }
  await d.ctx.close();
  // wrong password rejected
  const w = await browser.newContext(); const wp = await w.newPage();
  await wp.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await wp.fill('input[type="email"]', C.sellera.email); await wp.fill('input[type="password"]', 'wrong-password-075');
  await wp.click('button[type="submit"]'); await wp.waitForTimeout(2500);
  T('U11', 'wrong password stays on the login page', wp.url().includes('/sales/login'), '/sales/login', wp.url().replace(BASE, ''));
  await browser.close();
  fs.writeFileSync(__dirname + '/../evidence/UI-pages.json', JSON.stringify(R, null, 1));
  console.log('RESULT UI', R.filter((x) => x.ok).length, '/', R.length);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
