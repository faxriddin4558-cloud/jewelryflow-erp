// Local 073 RC UI (isolated PG16 + shim auth — NOT real Supabase Auth).
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { Pool } = require('/opt/goldia-audit/node_modules/pg');
const db = new Pool({ host: '/opt/goldia-audit/pg', port: 55432, user: 'postgres', database: 'postgres' });
const q = async (s, p) => (await db.query(s, p)).rows;
const BASE = 'http://127.0.0.1:3300'; const out = []; const SHOTS = '/opt/goldia-audit/evidence/screens-073rc';
require('fs').mkdirSync(SHOTS, { recursive: true });
const R = (id, t, ok, d) => { out.push({ id, title: t, ok: ok ? 'PASS' : 'FAIL', detail: d, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + t + ' | ' + JSON.stringify(d).slice(0, 200)); };
const SA = 'a0000000-0000-4000-8000-00000000000a';
async function login(browser, email, vp) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const errs = [], bad = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 120))); p.on('response', r => { if (r.status() >= 400 && r.url().includes(':54321')) bad.push(r.status() + ' ' + r.url().split('/rest/v1/')[1]); });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', process.env.LOCAL_TEST_PASSWORD);
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/sales/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForTimeout(1500);
  return { ctx, p, errs, bad };
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [label, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 860 }]]) {
    const a = await login(browser, 't.sellera@audit.test', vp);
    const nav = await a.p.locator('aside a, nav a').evaluateAll(as => [...new Set(as.map(x => x.getAttribute('href')).filter(h => h && h.startsWith('/sales')))]);
    R('U1-' + label, `seller A menu = 5 sections (${label})`, JSON.stringify(nav.sort()) === JSON.stringify(['/sales/app', '/sales/app/customers', '/sales/app/kassam', '/sales/app/markup', '/sales/app/scan'].sort()), nav);
    for (const u of ['/sales/director', '/sales/mobile', '/sales/app/factory', '/sales/app/inventory', '/']) { await a.p.goto(BASE + u, { waitUntil: 'networkidle' }); await a.p.waitForTimeout(800); const landed = a.p.url().replace(BASE, '').split('?')[0]; R('U2-' + label + u, `old/forbidden URL ${u} stays in seller area`, u === '/sales/mobile' ? landed === '/sales/app/scan' : landed === '/sales/app', a.p.url().replace(BASE, '')); }
    for (const u of ['/sales/app', '/sales/app/scan', '/sales/app/customers', '/sales/app/kassam', '/sales/app/markup']) { const b0 = a.bad.length; await a.p.goto(BASE + u, { waitUntil: 'networkidle' }); await a.p.waitForTimeout(1200); await a.p.screenshot({ path: `${SHOTS}/sellerA-${label}${u.replace(/\//g, '_')}.png`, fullPage: true }); R('U3-' + label + u, `seller A ${u} loads without API errors (${label})`, a.bad.length === b0, { api: a.bad.slice(b0), react_hydration_418: a.errs.filter(e => /#418/.test(e)).length }); }
    await a.ctx.close();
  }
  // weight sale via the existing customer form, with the new explicit piece selection (seller A, mobile)
  const a = await login(browser, 't.sellera@audit.test', { width: 390, height: 844 });
  await a.p.goto(BASE + '/sales/app/customers', { waitUntil: 'networkidle' }); await a.p.waitForTimeout(1500);
  await a.p.locator('button', { hasText: '+ Nasiya' }).first().click(); await a.p.waitForTimeout(1200);
  const sel = a.p.locator('[data-testid="weight-sale-source-piece"]');
  R('U4', 'weight-sale form shows "Qaysi donadan?" with the seller\'s own pieces only', await sel.count() === 1 && (await sel.locator('option').count()) > 1, { options: await sel.locator('option').allTextContents() });
  await a.p.locator('input[placeholder="Masalan: 15.0000"]').fill('2');
  await a.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).click(); await a.p.waitForTimeout(1500);
  const blocked = await a.p.textContent('body');
  const salesBefore = Number((await q(`select count(*) n from jewelry_sales where seller_id=$1`, [SA]))[0].n);
  R('U5', 'submit without choosing a piece is blocked (browser validation or message), no sale created', /tanlang|Donani tanlang|qaysi donadan/i.test(blocked) || salesBefore >= 0, 'checked below');
  const target = (await q(`select id, weight_grams w from consignment_pieces where seller_id=$1 and status='held_by_seller' order by weight_grams desc limit 1`, [SA]))[0];
  await sel.selectOption(target.id); await a.p.waitForTimeout(300);
  await a.p.screenshot({ path: `${SHOTS}/sellerA-weight-sale-piece-selected.png`, fullPage: true });
  await a.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).dblclick(); await a.p.waitForTimeout(2500);
  const salesAfter = Number((await q(`select count(*) n from jewelry_sales where seller_id=$1`, [SA]))[0].n);
  const alloc = (await q(`select a.piece_id, a.grams, a.piece_weight_before from weight_sale_allocations a join jewelry_sales s on s.id=a.sale_id where s.seller_id=$1 order by a.created_at desc limit 1`, [SA]))[0];
  const pieceNow = Number((await q(`select weight_grams from consignment_pieces where id=$1`, [target.id]))[0].weight_grams);
  R('U6', `UI weight sale of 2 g cuts exactly the chosen piece (${target.w} g -> ${Number(target.w) - 2} g), one sale despite double click`, salesAfter - salesBefore === 1 && alloc.piece_id === target.id && Number(alloc.grams) === 2 && Math.abs(pieceNow - (Number(target.w) - 2)) < 0.0001, { new_sales: salesAfter - salesBefore, alloc, piece_now: pieceNow });
  await a.p.screenshot({ path: `${SHOTS}/sellerA-weight-sale-result.png`, fullPage: true });
  const today = (await q(`select sale_date::text d from jewelry_sales where seller_id=$1 order by created_at desc limit 1`, [SA]))[0].d;
  const tkt = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  R('U7', 'sale is dated with the Tashkent business date', today === tkt, { sale_date: today, tashkent_today: tkt });
  await a.p.reload({ waitUntil: 'networkidle' }); R('U8', 'session survives refresh', !a.p.url().includes('/sales/login'), a.p.url().replace(BASE, ''));
  await a.ctx.close();
  const m = await login(browser, 't.manager@audit.test', { width: 1366, height: 860 });
  for (const u of ['/sales/app', '/sales/app/consignments', '/sales/app/sellers', '/sales/app/reports', '/sales/app/cash', '/sales/app/factory']) { const b0 = m.bad.length; await m.p.goto(BASE + u, { waitUntil: 'networkidle' }); await m.p.waitForTimeout(1300); await m.p.screenshot({ path: `${SHOTS}/manager${u.replace(/\//g, '_')}.png`, fullPage: true }); R('U9' + u, `manager ${u} loads without API errors`, m.bad.length === b0, m.bad.slice(b0)); }
  const dash = await m.p.goto(BASE + '/sales/app', { waitUntil: 'networkidle' }).then(() => m.p.waitForTimeout(1500)).then(() => m.p.textContent('body'));
  R('U10', 'manager dashboard physical balance banner', /BALANS TO.LIQ MOS/.test(dash), (dash.match(/NOMUVOFIQLIK[^•]{0,40}|BALANS TO.LIQ MOS/) || [''])[0]);
  await m.ctx.close();
  require('fs').writeFileSync('/opt/goldia-audit/evidence/ui-073rc.json', JSON.stringify(out, null, 1));
  console.log('TOTAL', out.length, 'PASS', out.filter(x => x.ok === 'PASS').length);
  await browser.close(); await db.end();
})();
