// UI-4 (REAL staging site): error states, menus, forbidden URLs, other-organization view, logout on mobile/desktop.
const fs = require('fs');
const { ORG, ORG_B, creds, sel } = require('./lib');
const { browser, login, go, SHOTS, BASE } = require('./ui-lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = JSON.parse(fs.readFileSync(LOG));
const T = (id, title, ok, expected, actual, extra = {}) => { state.checks.push({ id, title, ok: !!ok, expected, actual, ...extra, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | exp=' + JSON.stringify(expected) + ' act=' + JSON.stringify(actual).slice(0, 300)); };
const save = () => fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
async function logoutForce(s) {
  for (const loc of [s.p.getByRole('button', { name: /Chiqish/ }), s.p.getByRole('button', { name: '🚪' })]) {
    const v = loc.locator('visible=true'); const n = await v.count();
    for (let i = 0; i < n; i++) { try { await v.nth(i).click({ timeout: 5000 }); return 'click'; } catch { try { await v.nth(i).click({ force: true, timeout: 5000 }); return 'force'; } catch { /* next */ } } }
  }
  const menu = s.p.getByRole('button', { name: '☰' }).locator('visible=true');
  if (await menu.count()) { await menu.first().click({ force: true }); await s.p.waitForTimeout(800); const v = s.p.getByRole('button', { name: /Chiqish/ }).locator('visible=true'); if (await v.count()) { await v.first().click({ force: true }); return 'menu'; } }
  return null;
}
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = creds();
  const br = await browser();
  // wrong password / unknown user
  for (const [label, email, pw] of [['wrong password', C.sellera.email, 'wrong-password-075'], ['unknown user', 'nobody.075@goldia-audit.test', 'x-y-z-123456']]) {
    const ctx = await br.newContext(); const p = await ctx.newPage();
    await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', pw);
    await p.click('button[type="submit"]'); await p.waitForTimeout(3500);
    const cookies = (await ctx.cookies()).filter((c) => c.name.includes('auth-token'));
    T(`UI4-${label.replace(' ', '-')}`, `${label}: stays on login, no session cookie`, p.url().includes('/sales/login') && cookies.length === 0, { url: '/sales/login', cookies: 0 }, { url: p.url().replace(BASE, ''), cookies: cookies.length });
    await ctx.close();
  }
  // anonymous access to protected pages
  { const ctx = await br.newContext(); const p = await ctx.newPage();
    for (const u of ['/sales/app', '/sales/app/customers', '/sales/app/sellers']) { await p.goto(BASE + u, { waitUntil: 'networkidle' }); T(`UI4-anon${u}`, `anonymous ${u} -> login`, p.url().includes('/sales/login'), '/sales/login', p.url().replace(BASE, '')); }
    await ctx.close(); }
  // seller menus + forbidden URLs, desktop and mobile; logout
  for (const [label, vp] of [['desktop', { width: 1366, height: 860 }], ['mobile', { width: 390, height: 844 }]]) {
    const s = await login(br, label === 'desktop' ? 'sellerc' : 'sellerb', vp);
    const nav = await s.p.locator('aside a, nav a').evaluateAll((as) => [...new Set(as.map((x) => x.getAttribute('href')).filter((h) => h && h.startsWith('/sales')))].sort());
    T(`UI4-menu-${label}`, `seller menu has exactly 5 sections (${label})`, JSON.stringify(nav) === JSON.stringify(['/sales/app', '/sales/app/customers', '/sales/app/kassam', '/sales/app/markup', '/sales/app/scan']), 5, nav);
    for (const u of ['/sales/director', '/sales/mobile', '/sales/app/factory', '/sales/app/inventory', '/sales/app/sellers', '/sales/app/settings', '/sales/app/users', '/']) {
      await go(s, u); const landed = s.p.url().replace(BASE, '').split('?')[0];
      const allowed = ['/sales/app', '/sales/app/scan', '/sales/app/customers', '/sales/app/kassam', '/sales/app/markup'];
      T(`UI4-forbid-${label}${u}`, `seller (${label}) opening ${u} stays inside the seller area`, allowed.includes(landed), 'seller area', landed);
    }
    // unknown weight on the scan screen -> warning, no sale
    const sales0 = (await sel(`jewelry_sales?seller_id=eq.${C[s.tag].id}&select=id`)).length;
    await go(s, '/sales/app/scan');
    await s.p.locator('input[placeholder*="Vazn shtrixkodini skaner qiling"]').first().fill('99.99'); await s.p.getByRole('button', { name: /^Kiritish$/ }).click(); await s.p.waitForTimeout(1500);
    const warn = await s.p.textContent('body');
    await s.p.getByRole('button', { name: /Savdoni Tasdiqlash/ }).click({ timeout: 5000 }).catch(() => {}); await s.p.waitForTimeout(2000);
    const sales1 = (await sel(`jewelry_sales?seller_id=eq.${C[s.tag].id}&select=id`)).length;
    T(`UI4-scan-unknown-${label}`, 'scanning a weight the seller does not hold warns and creates no sale', sales1 === sales0 && /topilmadi|Ogohlantirish/i.test(warn), { new_sales: 0, warning: true }, { new_sales: sales1 - sales0, warning: /topilmadi|Ogohlantirish/i.test(warn) });
    // weight sale without choosing a piece
    await go(s, '/sales/app/customers');
    const nasiya = s.p.locator('button', { hasText: '+ Nasiya' }).locator('visible=true');
    if (await nasiya.count()) {
      await nasiya.first().click(); await s.p.waitForTimeout(1200);
      await s.p.locator('input[placeholder="Masalan: 15.0000"]').first().fill('1');
      await s.p.locator('button[type="submit"]', { hasText: 'Nasiyani Rasmiylashtirish' }).click(); await s.p.waitForTimeout(2500);
      const sales2 = (await sel(`jewelry_sales?seller_id=eq.${C[s.tag].id}&select=id`)).length;
      T(`UI4-nopiece-${label}`, 'weight sale without choosing the source piece creates no sale', sales2 === sales1, 0, sales2 - sales1);
      await s.p.keyboard.press('Escape').catch(() => {});
    }
    const how = await logoutForce(s); await s.p.waitForTimeout(2500);
    await s.p.goto(BASE + '/sales/app', { waitUntil: 'load' }).catch(() => {}); await s.p.waitForTimeout(2000);
    T(`UI4-logout-${label}`, `seller logout (${label}) ends the session`, s.p.url().includes('/sales/login'), '/sales/login', { url: s.p.url().replace(BASE, ''), via: how });
    await s.ctx.close();
  }
  // director logout on mobile (the earlier attempt hit a covered button)
  { const d = await login(br, 'director', { width: 390, height: 844 }); const how = await logoutForce(d); await d.p.waitForTimeout(2500);
    await d.p.goto(BASE + '/sales/app', { waitUntil: 'load' }).catch(() => {}); await d.p.waitForTimeout(2000);
    T('UI4-logout-director-mobile', 'director logout (mobile) ends the session', d.p.url().includes('/sales/login'), '/sales/login', { url: d.p.url().replace(BASE, ''), via: how }); await d.ctx.close(); }
  // other organization: org B seller and director see only their own customers
  for (const tag of ['sellerB1', 'directorB']) {
    const s = await login(br, tag); await go(s, '/sales/app/customers');
    const body = await s.p.textContent('body');
    const aNames = (await sel(`customers?organization_id=eq.${ORG}&select=contact_name&limit=200`)).map((x) => x.contact_name).filter((n) => n.length > 8);
    const leaked = aNames.filter((n) => body.includes(n));
    await s.p.screenshot({ path: `${SHOTS}/UI4-${tag}-customers.png` });
    T(`UI4-orgB-${tag}`, `${tag} (other organization) sees none of organization A's customers in the UI`, leaked.length === 0, 0, { leaked: leaked.slice(0, 5) });
    await s.ctx.close();
  }
  // worker and employee-less logins
  for (const tag of ['worker', 'noemp']) {
    const s = await login(br, tag); await s.p.waitForTimeout(1500);
    const url = s.p.url().replace(BASE, ''); await go(s, '/sales/app/customers');
    const body = await s.p.textContent('body');
    const aNames = (await sel(`customers?organization_id=eq.${ORG}&select=contact_name&limit=200`)).map((x) => x.contact_name).filter((n) => n.length > 8);
    await s.p.screenshot({ path: `${SHOTS}/UI4-${tag}.png` });
    T(`UI4-${tag}`, `${tag} login sees no customer data`, aNames.filter((n) => body.includes(n)).length === 0, 'no data', { landed: url, customers_page: s.p.url().replace(BASE, ''), visible_org_A_customers: aNames.filter((n) => body.includes(n)).length });
    await s.ctx.close();
  }
  await br.close(); save();
})().catch((e) => { console.error('FATAL', e.stack.split('\n').slice(0, 3).join(' ')); save(); process.exit(1); });
