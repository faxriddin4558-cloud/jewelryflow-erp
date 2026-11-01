const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { session, login, BASE } = require('./explore');
const label = process.argv[2]; const dir = '/opt/goldia-audit/evidence/screens'; require('fs').mkdirSync(dir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [role, email, vp, pages] of [['director', 't.director@audit.test', { width: 1440, height: 900 }, ['/sales/app', '/sales/app/customers', '/sales/app/sellers', '/sales/app/reports', '/sales/app/factory', '/sales/app/cash']], ['manager', 't.manager@audit.test', { width: 1366, height: 860 }, ['/sales/app', '/sales/app/consignments', '/sales/app/refining', '/sales/app/purchases']], ['seller-a', 't.sellera@audit.test', { width: 390, height: 844 }, ['/sales/mobile', '/sales/app/customers']]]) {
    const s = await session(browser, role, email, vp); await login(s);
    for (const p of pages) { await s.page.goto(BASE + p, { waitUntil: 'networkidle' }); await s.page.waitForTimeout(1500); await s.page.screenshot({ path: `${dir}/${label}-${role}${p.replace(/\//g, '_')}.png`, fullPage: true });
      const t = (await s.page.textContent('body')).replace(/\s+/g, ' '); const m = t.match(/(BALANS TO.LIQ MOS|NOMUVOFIQLIK: [0-9.]+ g)/); const pr = t.match(/Kapital harakatlariga tuzatilgan([+\-−]?[0-9.]+ g)/);
      console.log(label, role, p, m ? m[0] : '', pr ? 'profit=' + pr[1] : ''); }
    await s.ctx.close();
  }
  await browser.close();
})();
