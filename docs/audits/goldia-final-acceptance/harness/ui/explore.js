// Browser acceptance run against local Next (127.0.0.1:3100) + local shim (127.0.0.1:54321). Synthetic users only.
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:3100'; const PW = 'Audit-Local-Only-1';
const results = []; const R = (id, role, title, ok, detail = '') => { results.push({ id, role, title, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + id, role, title, detail ? '| ' + String(detail).slice(0, 200) : ''); };
async function session(browser, role, email, viewport) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await ctx.newPage(); const errors = []; const hosts = new Set(); const bad = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  page.on('request', r => { try { hosts.add(new URL(r.url()).host); } catch {} });
  page.on('response', r => { if (r.status() >= 400 && r.url().includes(':54321')) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 140)}`); });
  return { ctx, page, errors, hosts, bad, role, email };
}
async function login(s) {
  await s.page.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await s.page.fill('input[type="email"]', s.email); await s.page.fill('input[type="password"]', PW);
  await Promise.all([s.page.waitForURL(u => !u.pathname.startsWith('/sales/login'), { timeout: 20000 }).catch(() => {}), s.page.click('button[type="submit"]')]);
  await s.page.waitForLoadState('networkidle').catch(() => {}); await s.page.waitForTimeout(1500);
  return s.page.url();
}
module.exports = { session, login, R, results, BASE, PW };
if (require.main === module) (async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // anonymous
  const an = await session(browser, 'ANON', '', { width: 1366, height: 860 });
  await an.page.goto(BASE + '/sales/app', { waitUntil: 'networkidle' });
  R('UI-A1', 'ANON', 'unauthenticated /sales/app redirects to login', an.page.url().includes('/sales/login'), an.page.url());
  await an.page.goto(BASE + '/sales/mobile', { waitUntil: 'networkidle' });
  R('UI-A2', 'ANON', 'unauthenticated /sales/mobile redirects to login', an.page.url().includes('/sales/login'), an.page.url());
  await an.page.screenshot({ path: 'shots/anon-login.png' });
  await an.page.fill('input[type="email"]', 't.director@audit.test'); await an.page.fill('input[type="password"]', 'wrong-password');
  await an.page.click('button[type="submit"]'); await an.page.waitForTimeout(1500);
  const body = await an.page.textContent('body');
  R('UI-A3', 'ANON', 'wrong password shows error and stays on login', an.page.url().includes('/sales/login') && /noto|Invalid|xato/i.test(body), an.page.url());
  await an.page.screenshot({ path: 'shots/anon-wrong-password.png' });
  await an.ctx.close();
  const pages = ['/sales/app', '/sales/app/factory-receive', '/sales/app/inventory', '/sales/app/consignments', '/sales/app/sellers', '/sales/app/customers', '/sales/app/cash', '/sales/app/handovers', '/sales/app/purchases', '/sales/app/refining', '/sales/app/factory', '/sales/app/reports', '/sales/app/models', '/sales/app/settings', '/sales/app/users', '/sales/director', '/sales/mobile'];
  for (const [role, email, vp] of [['DIRECTOR', 't.director@audit.test', { width: 1440, height: 900 }], ['MANAGER', 't.manager@audit.test', { width: 1366, height: 860 }], ['SELLER_A', 't.sellera@audit.test', { width: 390, height: 844 }]]) {
    const s = await session(browser, role, email, vp);
    const landed = await login(s);
    R(`UI-${role}-LOGIN`, role, 'login lands outside login page', !landed.includes('/sales/login'), landed);
    for (const p of pages) {
      const before = s.errors.length, badBefore = s.bad.length;
      await s.page.goto(BASE + p, { waitUntil: 'networkidle' }).catch(e => s.errors.push('NAV ' + e.message));
      await s.page.waitForTimeout(1200);
      const name = `${role}-${p.replace(/\//g, '_')}`; await s.page.screenshot({ path: `shots/${name}.png`, fullPage: true });
      const txt = (await s.page.textContent('body')) || '';
      fs.writeFileSync(`shots/${name}.txt`, txt.replace(/\s+/g, ' ').slice(0, 20000));
      R(`UI-${role}${p}`, role, `open ${p}`, s.errors.length === before, `url=${s.page.url().replace(BASE, '')} consoleErrors=${s.errors.length - before} api4xx5xx=${s.bad.length - badBefore} ${s.bad.slice(badBefore).join(' ; ')} ${s.errors.slice(before).join(' ; ')}`);
    }
    await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(800);
    R(`UI-${role}-REFRESH`, role, 'session persists after reload', !s.page.url().includes('/sales/login'), s.page.url());
    R(`UI-${role}-HOSTS`, role, 'browser contacted only local hosts', [...s.hosts].every(h => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h)), [...s.hosts].join(','));
    await s.ctx.close();
  }
  fs.writeFileSync('explore-results.json', JSON.stringify(results, null, 1));
  await browser.close();
})();
