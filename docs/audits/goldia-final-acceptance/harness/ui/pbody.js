const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { session, login, BASE } = require('./explore');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [role, email] of [['director', 't.director@audit.test'], ['manager', 't.manager@audit.test']]) {
    const s = await session(browser, role, email, { width: 1440, height: 900 });
    s.page.on('request', r => { if (r.url().includes('rpc_get_accounting_profit_summary')) console.log(role, 'REQ', r.postData()); });
    s.page.on('response', async r => { if (r.url().includes('rpc_get_accounting_profit_summary')) { const j = await r.json().catch(() => ({})); console.log(role, 'RES', j.period_accounting_result_585_g, 'rates', JSON.stringify(j.rates)); } });
    await login(s); await s.page.goto(BASE + '/sales/app', { waitUntil: 'networkidle' }); await s.page.waitForTimeout(2500);
    await s.ctx.close();
  }
  await browser.close();
})();
