const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { session, login, R, BASE } = require('./explore');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [role, email, vp, start] of [['SELLER_A', 't.sellera@audit.test', { width: 390, height: 844 }, '/sales/mobile'], ['DIRECTOR', 't.director@audit.test', { width: 1440, height: 900 }, '/sales/app']]) {
    const s = await session(browser, role, email, vp); await login(s);
    await s.page.goto(BASE + start, { waitUntil: 'networkidle' }); await s.page.waitForTimeout(800);
    const c1 = (await s.ctx.cookies()).filter(c => c.name.startsWith('sb-')).length;
    const btns = await s.page.locator('button, a').evaluateAll(els => els.map(e => e.textContent.trim()).filter(t => /chiq|logout|exit/i.test(t)));
    const b = s.page.locator('button, a').filter({ hasText: /Chiqish|Tizimdan chiq/i }).first();
    if (await b.count()) { await b.evaluate(el => el.click()); } else if (vp.width < 500) { await s.page.locator('button').filter({ hasText: '☰' }).first().click().catch(() => {}); await s.page.waitForTimeout(400); await s.page.locator('button, a').filter({ hasText: /Chiqish/i }).first().click({ force: true }).catch(() => {}); }
    await s.page.waitForTimeout(2000);
    const c2 = (await s.ctx.cookies()).filter(c => c.name.startsWith('sb-')).length;
    await s.page.goto('http://localhost:3100' + start, { waitUntil: 'networkidle' });
    R(`UI-${role}-LOGOUT`, role, 'logout clears session; protected page redirects to login', s.page.url().includes('/sales/login'), `buttons=${JSON.stringify(btns)} sbCookies ${c1}->${c2} url=${s.page.url()}`);
    await s.ctx.close();
  }
  await browser.close();
})();
