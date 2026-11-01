const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { session, login, R, BASE } = require('./explore');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const s = await session(browser, 'SELLER_A', 't.sellera@audit.test', { width: 390, height: 844 }); await login(s);
  await s.page.goto(BASE + '/sales/mobile', { waitUntil: 'networkidle' });
  await s.page.waitForTimeout(20000);
  const bad0 = s.bad.length;
  await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(2500);
  const t = await s.page.textContent('body');
  R('UI-EXP1', 'SELLER_A', 'expired access token is refreshed transparently (stale mobile session)', !s.page.url().includes('/sales/login') && /Sotuvchi A/.test(t) && s.bad.length === bad0, `url=${s.page.url()} api4xx=${s.bad.slice(bad0).join(';')}`);
  await s.ctx.close(); await browser.close();
})();
