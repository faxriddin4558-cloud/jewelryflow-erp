// Deterministic regression test for the period-report race found in the staging 078 audit (U77-21): the page's automatic
// first-of-month report is delayed by 6 s in the browser (Playwright route), the manager meanwhile picks today and
// loads. Correct: the page keeps showing TODAY's report = the server report for today. Bug: the late month report
// overwrites it. Read-only (only report reads).  GA_TARGET=local | staging
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
(async () => {
  const c = L.creds().manager; const today = L.tashkentToday();
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const p = await (await br.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  let first = true; const seen = [];
  await p.route('**/rest/v1/rpc/rpc_get_period_report', async (route) => {
    const body = route.request().postData(); seen.push(body);
    const resp = await route.fetch();
    if (first) { first = false; await new Promise((r) => setTimeout(r, 6000)); }
    await route.fulfill({ response: resp });
  });
  await p.goto(BASE + '/sales/app/period-report'); await p.waitForTimeout(1500);
  await p.locator('[data-testid="report-from"]').fill(today); await p.locator('[data-testid="report-to"]').fill(today);
  await p.locator('[data-testid="report-load"]').click();
  await p.waitForTimeout(9000); // the delayed first-of-month response has arrived by now
  const shown = await p.locator('[data-testid="flow-sale_usd"]').innerText().catch(() => '');
  const api = await L.rpc('manager', 'rpc_get_period_report', { p_from: today, p_to: today });
  const cnt = api.ok && api.data.flows.sale_usd ? api.data.flows.sale_usd.count : 0;
  const ok = cnt === 0 ? shown === '' : shown.includes(`\t${cnt}\t`);
  const res = { target: TARGET, version: (await (await fetch(BASE + '/api/version').catch(() => null))?.json?.().catch(() => null)) || null, requests: seen, shown: shown.slice(0, 90), server_today_usd_sales: cnt, ok };
  console.log(`${ok ? 'PASS' : 'FAIL'} RACE-01 a late first-of-month report must not overwrite the report of the chosen dates | exp=count ${cnt} act=${JSON.stringify(shown.slice(0, 80))}`);
  fs.writeFileSync(path.join(__dirname, '..', 'evidence', `${TARGET}-ui-078-report-race.json`), JSON.stringify(res, null, 1));
  await br.close(); process.exit(ok ? 0 : 1);
})();
