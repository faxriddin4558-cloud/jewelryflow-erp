// UI-4b: seller logout re-check from a clean page (UI4 attempt left the "+ Nasiya" dialog open over the logout button).
const fs = require('fs');
const { browser, login, go, BASE, logout } = require('./ui-lib');
const LOG = __dirname + '/../evidence/ui-operations.json';
const state = JSON.parse(fs.readFileSync(LOG));
const T = (id, title, ok, expected, actual) => { state.checks.push({ id, title, ok: !!ok, expected, actual, at: new Date().toISOString() }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' | ' + JSON.stringify(actual)); };
(async () => {
  for (const c of state.checks) if (/^UI4-logout-(desktop|mobile)$/.test(c.id) && !c.id.endsWith('-try1')) { c.id += '-try1'; c.note = 'the "+ Nasiya" dialog from the previous step was still open over the logout button (Escape does not close it); forced click landed on the overlay'; }
  const br = await browser();
  for (const [tag, label, vp] of [['sellerc', 'desktop', { width: 1366, height: 860 }], ['sellerb', 'mobile', { width: 390, height: 844 }], ['sellera', 'mobile', { width: 390, height: 844 }], ['manager', 'mobile', { width: 390, height: 844 }]]) {
    const s = await login(br, tag, vp); await go(s, '/sales/app');
    const ok = await logout(s); await s.p.waitForTimeout(2500);
    await s.p.goto(BASE + '/sales/app', { waitUntil: 'load' }).catch(() => {}); await s.p.waitForTimeout(2000);
    const cookies = (await s.ctx.cookies()).filter((c) => c.name.includes('auth-token') && c.value);
    T(`UI4-logout-${tag}-${label}`, `${tag} logout (${label}) from a clean page ends the session`, s.p.url().includes('/sales/login') && cookies.length === 0, { url: '/sales/login', cookies: 0 }, { clicked: ok, url: s.p.url().replace(BASE, ''), cookies: cookies.length });
    await s.ctx.close();
  }
  await br.close(); fs.writeFileSync(LOG, JSON.stringify(state, null, 1));
})();
