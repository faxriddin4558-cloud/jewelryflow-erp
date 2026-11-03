// Local 072 (isolated PG16 + shim auth, NOT real Supabase Auth): Kassam rate editing, UI payment at own rate, snapshot.
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { Pool } = require('/opt/goldia-audit/node_modules/pg');
const db = new Pool({ host: '/opt/goldia-audit/pg', port: 55432, user: 'postgres', database: 'postgres' });
const q1 = async (s, p) => (await db.query(s, p)).rows[0];
const BASE = 'http://127.0.0.1:3300'; const out = [];
const R = (id, t, ok, d) => { out.push({ id, title: t, ok: ok ? 'PASS' : 'FAIL', detail: d }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + t + ' | ' + JSON.stringify(d).slice(0, 220)); };
const SB = 'a0000000-0000-4000-8000-00000000000b';
async function login(browser, email, vp) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const errs = [], bad = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 120))); p.on('response', r => { if (r.status() >= 400 && r.url().includes(':54321')) bad.push(r.status() + ' ' + r.url().split('/rest/v1/')[1]); });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', process.env.LOCAL_TEST_PASSWORD);
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/sales/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')]); await p.waitForTimeout(1500);
  return { ctx, p, errs, bad };
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const b = await login(browser, 't.sellerb@audit.test', { width: 390, height: 844 });
  await b.p.goto(BASE + '/sales/app/kassam', { waitUntil: 'networkidle' }); await b.p.waitForTimeout(1500);
  const shown = await b.p.locator('[data-testid="own-lom-rate"]').textContent().catch(() => null);
  R('K1', 'Kassam shows seller B own LOM rate 900,000', /900[\s,. ]?000/.test(shown || ''), shown);
  await b.p.screenshot({ path: '/opt/goldia-audit/evidence/screens/local072-kassam-before.png', fullPage: true });
  const hist0 = (await q1(`select count(*)::int n from seller_rate_history where seller_id=$1`, [SB])).n;
  await b.p.getByLabel('Yangi LOM kursi').fill('905000'); await b.p.getByLabel('Izoh').fill('UI audit');
  await b.p.locator('[data-testid="seller-rates-card"] button[type="submit"]').dblclick(); await b.p.waitForTimeout(2500);
  const rate = await q1(`select lom_rate_uzs l, usd_rate_uzs u from seller_rates where seller_id=$1`, [SB]);
  const hist1 = (await q1(`select count(*)::int n from seller_rate_history where seller_id=$1`, [SB])).n;
  R('K2', 'UI rate edit 905,000 saved; USD kept 12,700; history rows +1 or +2 (double click)', Number(rate.l) === 905000 && Number(rate.u) === 12700 && hist1 > hist0, { lom: rate.l, usd: rate.u, history_added: hist1 - hist0 });
  await b.p.screenshot({ path: '/opt/goldia-audit/evidence/screens/local072-kassam-after.png', fullPage: true });
  const bad = await (async () => { await b.p.getByLabel('Yangi LOM kursi').fill('5000000'); await b.p.locator('[data-testid="seller-rates-card"] button[type="submit"]').click(); await b.p.waitForTimeout(1500); return (await q1(`select lom_rate_uzs l from seller_rates where seller_id=$1`, [SB])).l; })();
  const msg = await b.p.locator('[data-testid="seller-rates-card"]').textContent();
  R('K3', 'out-of-range rate 5,000,000 rejected server-side and shown to user', Number(bad) === 905000 && /ERR_RATE|oraliq|ruxsat|foiz/i.test(msg), { stored: bad, message: (msg.match(/ERR_RATE[^.]*|ruxsat[^.]*/i) || [''])[0].slice(0, 90) });
  R('K4', 'no failed API calls except the rejected rate (400/403)', b.bad.every(x => /rpc_set_my_seller_rates/.test(x)), b.bad);
  await b.ctx.close();
  // seller A must not see seller B rate in UI
  const a = await login(browser, 't.sellera@audit.test', { width: 390, height: 844 });
  await a.p.goto(BASE + '/sales/app/kassam', { waitUntil: 'networkidle' }); await a.p.waitForTimeout(1500);
  const aTxt = await a.p.textContent('body');
  R('K5', 'seller A Kassam shows only own rate (920,000), never seller B 905,000', /920[\s,. ]?000/.test(aTxt) && !/905[\s,. ]?000/.test(aTxt), (aTxt.match(/LOM[^U]{0,60}/) || [''])[0]);
  await a.p.screenshot({ path: '/opt/goldia-audit/evidence/screens/local072-kassam-sellerA.png', fullPage: true });
  for (const u of ['/sales/app/markup', '/sales/app/scan', '/sales/app/customers', '/sales/app']) { const b0 = a.bad.length; await a.p.goto(BASE + u, { waitUntil: 'networkidle' }); await a.p.waitForTimeout(1200); await a.p.screenshot({ path: `/opt/goldia-audit/evidence/screens/local072-sellerA${u.replace(/\//g, '_')}.png`, fullPage: true }); R('K6' + u, 'seller A page ' + u + ' loads without API errors', a.bad.length === b0 && a.p.url().endsWith(u), a.bad.slice(b0)); }
  await a.ctx.close();
  const m = await login(browser, 't.manager@audit.test', { width: 1366, height: 860 });
  await m.p.goto(BASE + '/sales/app/sellers', { waitUntil: 'networkidle' }); await m.p.waitForTimeout(1500);
  const mTxt = await m.p.textContent('body');
  R('K7', 'manager sees both seller rates (920,000 and 905,000)', /920[\s,. ]?000/.test(mTxt) && /905[\s,. ]?000/.test(mTxt), '');
  await m.p.screenshot({ path: '/opt/goldia-audit/evidence/screens/local072-manager-sellers.png', fullPage: true });
  for (const u of ['/sales/app', '/sales/app/reports', '/sales/app/cash', '/sales/app/factory']) { const b0 = m.bad.length; await m.p.goto(BASE + u, { waitUntil: 'networkidle' }); await m.p.waitForTimeout(1500); await m.p.screenshot({ path: `/opt/goldia-audit/evidence/screens/local072-manager${u.replace(/\//g, '_')}.png`, fullPage: true }); R('K8' + u, 'manager page ' + u + ' without API errors', m.bad.length === b0, m.bad.slice(b0)); }
  const dash = await m.p.goto(BASE + '/sales/app', { waitUntil: 'networkidle' }).then(() => m.p.waitForTimeout(1500)).then(() => m.p.textContent('body'));
  R('K9', 'manager dashboard: physical balance and profit before/after expenses visible', /BALANS TO.LIQ MOS/.test(dash) && /Xarajatlardan oldin/.test(dash), (dash.match(/NOMUVOFIQLIK[^•]{0,40}|BALANS TO.LIQ MOS/) || [''])[0]);
  await m.ctx.close();
  // snapshot: the B settlement recorded earlier keeps its 900,000 rate after the change
  const st = await q1(`select gold_rate_applied r, applied_usd_rate u from gold_settlements where seller_id=$1 and direction='client_to_seller' order by created_at limit 1`, [SB]);
  R('K10', 'historical snapshot: earlier B payment keeps 900,000 / 12,700 after rate change', Number(st.r) === 900000 && Number(st.u) === 12700, st);
  require('fs').writeFileSync('/opt/goldia-audit/evidence/local072-ui.json', JSON.stringify(out, null, 1));
  console.log('TOTAL', out.length, 'PASS', out.filter(x => x.ok === 'PASS').length);
  await browser.close(); await db.end();
})();
