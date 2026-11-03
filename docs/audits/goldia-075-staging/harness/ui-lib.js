// Playwright helpers for the REAL staging site (https://jewelryflow-sales-staging.vercel.app) with real GoTrue logins.
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const { creds } = require('./lib');
const BASE = 'https://jewelryflow-sales-staging.vercel.app';
const SHOTS = __dirname + '/../evidence/ui-screens';
async function browser() { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
async function login(br, tag, vp = { width: 1366, height: 860 }) {
  const c = creds()[tag];
  const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const p = await ctx.newPage(); const bad = [], errs = [], rpcs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  p.on('response', async (r) => {
    const u = r.url();
    if (!u.includes('vouehtlmsunebracahon.supabase.co')) return;
    const path = u.split('.supabase.co')[1].split('?')[0];
    if (r.status() >= 400) bad.push(r.status() + ' ' + path);
    if (path.startsWith('/rest/v1/rpc/') && r.request().method() === 'POST') {
      let body = null; try { body = await r.json(); } catch { body = null; }
      rpcs.push({ rpc: path.slice(13), status: r.status(), body });
    }
  });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2000);
  return { ctx, p, bad, errs, rpcs, tag };
}
async function go(s, path) { await s.p.goto(BASE + path, { waitUntil: 'networkidle' }); await s.p.waitForTimeout(1500); }
module.exports = { BASE, SHOTS, browser, login, go };
// logout through a "Chiqish" control that is inside the viewport; on mobile the sidebar is off-canvas -> open ☰ first
async function logout(s) {
  const vw = s.p.viewportSize();
  const inView = async (loc) => { const n = await loc.count(); for (let i = 0; i < n; i++) { const b = await loc.nth(i).boundingBox(); if (b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vw.width && b.y + b.height <= vw.height) return loc.nth(i); } return null; };
  const find = async () => (await inView(s.p.getByRole('button', { name: /Chiqish/ }))) || (await inView(s.p.locator('button[title="Chiqish"]')));
  let btn = await find();
  if (!btn) { const menu = await inView(s.p.getByRole('button', { name: '☰' })); if (menu) { await menu.click(); await s.p.waitForTimeout(1000); btn = await find(); } }
  if (!btn) return false;
  await btn.click(); return true;
}
module.exports.logout = logout;
