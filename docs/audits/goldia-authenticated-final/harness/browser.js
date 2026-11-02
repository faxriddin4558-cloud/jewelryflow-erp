// REAL Supabase Auth (isolated test project) + local build of 2a70155. Credentials are read from creds.json and never logged.
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const fs = require('fs'); require('./guard');
const creds = JSON.parse(fs.readFileSync('/opt/goldia-audit/real/creds.json'));
const BASE = 'http://127.0.0.1:3200'; const out = []; const R = (id, role, title, ok, detail) => { out.push({ id, role, title, ok: ok === null ? 'NOT TESTED' : ok ? 'PASS' : 'FAIL', detail, at: new Date().toISOString() }); console.log((ok === null ? 'N/T ' : ok ? 'PASS ' : 'FAIL ') + id + ' ' + role + ' ' + title + (detail ? ' | ' + String(detail).slice(0, 230) : '')); };
const MGMT = ['/sales/app', '/sales/app/factory', '/sales/app/inventory', '/sales/app/consignments', '/sales/app/sellers', '/sales/app/scan', '/sales/app/customers', '/sales/app/cash', '/sales/app/refining', '/sales/app/purchases', '/sales/app/reports', '/sales/app/models', '/sales/app/users', '/sales/app/settings'];
const SELLER_OK = ['/sales/app', '/sales/app/scan', '/sales/app/customers', '/sales/app/kassam', '/sales/app/markup'];
const SELLER_FORBIDDEN = ['/sales/app/factory', '/sales/app/inventory', '/sales/app/sellers', '/sales/app/cash', '/sales/app/reports', '/sales/app/purchases', '/sales/app/settings', '/sales/director', '/sales/mobile', '/', '/dashboard'];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } });
  const roles = [['DIRECTOR', 'director', { width: 1440, height: 900 }], ['MANAGER', 'manager', { width: 1366, height: 860 }], ['SELLER_A', 'sellera', { width: 390, height: 844 }], ['SELLER_B', 'sellerb', { width: 390, height: 844 }], ['SELLER_C', 'sellerc', { width: 1280, height: 800 }]];
  // anonymous
  { const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); const p = await ctx.newPage();
    for (const u of ['/sales/app', '/sales/app/kassam', '/sales/app/reports']) { await p.goto(BASE + u, { waitUntil: 'domcontentloaded' }); R('A-' + u, 'ANON', 'protected route redirects to login', p.url().includes('/sales/login'), p.url().replace(/^https?:\/\/[^/]+/, '')); }
    await p.fill('input[type="email"]', creds.director.email); await p.fill('input[type="password"]', 'definitely-wrong'); await p.click('button[type="submit"]'); await p.waitForTimeout(3000);
    R('A-wrongpw', 'ANON', 'wrong password rejected by real Supabase Auth', p.url().includes('/sales/login') && (await ctx.cookies()).filter(c => c.name.startsWith('sb-')).length === 0, (await p.textContent('body')).match(/Invalid login credentials|noto.g.ri/i)?.[0]);
    await ctx.close(); }
  for (const [ROLE, key, vp] of roles) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    const p = await ctx.newPage(); const errs = []; const bad = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 150)));
    p.on('response', r => { if (r.status() >= 400 && r.url().includes('supabase.co')) bad.push(`${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, '').split('?')[0]}`); });
    await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', creds[key].email); await p.fill('input[type="password"]', creds[key].password);
    await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/sales/login'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')]);
    await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(2500);
    const sb = (await ctx.cookies()).filter(c => c.name.startsWith('sb-') && c.name.includes('auth-token'));
    R('L-' + ROLE, ROLE, 'real Supabase Auth login; session cookie for test project', !p.url().includes('/sales/login') && sb.length > 0 && sb[0].name.includes('yvvbdoqncubtwlzskgml'), `landed=${p.url().replace(BASE, '')} cookie=${sb.length ? sb[0].name.replace(/-auth-token.*/, '-auth-token') : 'none'}`);
    await p.screenshot({ path: `shots/${ROLE}-landing.png`, fullPage: true });
    const nav = await p.locator('aside a, nav a').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/sales')))]);
    const isSeller = ROLE.startsWith('SELLER');
    if (isSeller) R('N-' + ROLE, ROLE, 'seller menu = exactly 5 sections', JSON.stringify(nav.sort()) === JSON.stringify([...SELLER_OK].sort()), nav.join(' '));
    else R('N-' + ROLE, ROLE, 'management menu contains reports/factory/cash', ['/sales/app/reports', '/sales/app/factory', '/sales/app/cash'].every(h => nav.includes(h)), nav.length + ' links');
    const pages = isSeller ? SELLER_OK : MGMT;
    for (const u of pages) {
      const e0 = errs.length, b0 = bad.length;
      await p.goto(BASE + u, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500);
      await p.screenshot({ path: `shots/${ROLE}${u.replace(/\//g, '_')}.png`, fullPage: true });
      R('P-' + ROLE + u, ROLE, 'open ' + u, p.url().replace(BASE, '').split('?')[0] === u && bad.length === b0, `url=${p.url().replace(BASE, '')} api_errors=${bad.slice(b0).join(';')} console=${errs.length - e0}`);
    }
    if (isSeller) for (const u of SELLER_FORBIDDEN) {
      await p.goto(BASE + u, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1200);
      const landed = p.url().replace(BASE, '').split('?')[0];
      R('F-' + ROLE + u, ROLE, 'forbidden/old URL keeps seller in seller area', SELLER_OK.includes(landed) || landed.startsWith('/sales/login') === false && landed === '/sales/app', landed);
    }
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    R('R-' + ROLE, ROLE, 'session survives refresh', !p.url().includes('/sales/login'), p.url().replace(BASE, ''));
    const lo = p.locator('button, a').filter({ hasText: /Chiqish/i }).first();
    if (await lo.count()) { await lo.evaluate(el => el.click()); await p.waitForTimeout(2500); }
    await p.goto(BASE + (isSeller ? '/sales/app/kassam' : '/sales/app/reports'), { waitUntil: 'networkidle' });
    R('O-' + ROLE, ROLE, 'logout ends the session', p.url().includes('/sales/login'), p.url().replace(BASE, ''));
    fs.writeFileSync(`shots/${ROLE}-errors.json`, JSON.stringify({ console: errs, api: bad }, null, 1));
    await ctx.close();
  }
  fs.writeFileSync('/opt/goldia-audit/real/browser-results.json', JSON.stringify(out, null, 1));
  console.log('TOTAL', out.length, 'PASS', out.filter(x => x.ok === 'PASS').length, 'FAIL', out.filter(x => x.ok === 'FAIL').length);
  await browser.close();
})();
