// 078 "Mijozni o'chirish" through the real browser (real GoTrue logins, PostgREST, Next.js build) + server-side
// attacks with real JWTs. The 4 mandatory security tests:
//   SEC-1 seller archives his own customer (UI, one confirmation, double click -> one operation)
//   SEC-2 seller cannot archive another seller's / an unassigned / another organization's customer (RPC + table write)
//   SEC-3 open debt (585 g legacy + USD) and history kept, visible under "Arxivlangan mijozlar", still collectible
//   SEC-4 restore works (seller own; manager any)
//   GA_TARGET=local (127.0.0.1:3300) | staging (real staging, synthetic organization only, after 078 is applied)
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const API_HOST = TARGET === 'staging' ? 'vouehtlmsunebracahon.supabase.co' : '127.0.0.1:54321';
const OTHER_ORG = TARGET === 'staging' ? 'directorB' : 'director56';
const EV = path.join(__dirname, '..', 'evidence'); const SHOTS = path.join(EV, `${TARGET}-ui-078-screens`);
const R = []; const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 260)}`); };
const N = Number;
async function login(br, tag, vp = { width: 1366, height: 860 }) {
  const c = L.creds()[tag];
  const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const p = await ctx.newPage(); const bad = []; const dialogs = [];
  p.on('response', (r) => { if (r.url().includes(API_HOST) && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split(API_HOST)[1].split('?')[0]); });
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
  await p.waitForTimeout(2000);
  return { ctx, p, bad, dialogs };
}
const go = async (s, u) => { await s.p.goto(BASE + u, { waitUntil: 'networkidle' }); await s.p.waitForTimeout(2000); };
const row = (s, name) => s.p.locator(`tr:has-text("${name}"), div.rounded-2xl:has-text("${name}")`).locator('visible=true').last();
const cust = async (id) => (await L.sel(`customers?id=eq.${id}&select=is_archived,archived_at,archived_by,seller_id`))[0];
const audits = async (id) => (await L.sel(`audit_logs?table_name=eq.customers&record_id=eq.${id}&action=in.(ARCHIVE_CUSTOMER,RESTORE_CUSTOMER)&select=action`)).length;
const gold = async (id) => { const a = (await L.sel(`client_gold_accounts?customer_id=eq.${id}&select=d:current_debt_grams`))[0]; return a ? N(a.d) : 0; };
const usd = async (id) => { const a = (await L.sel(`client_currency_accounts?customer_id=eq.${id}&currency=eq.USD&select=d:debt_amount`))[0]; return a ? N(a.d) : 0; };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday();
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const rc = await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `UI78 ${run}`, p_original_physical_g: 20, p_factory_markup_pct: 8 });
  const cs = await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.data.receipt_id, p_pieces: [{ weight_grams: 5 }, { weight_grams: 5 }] });
  if (!cs.ok) throw new Error('consignment ' + cs.error);
  await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12500, p_reason: 'ui 078' });
  const nOwn = `UI78 Ochiriladi ${run}`, nOther = `UI78 Boshqa ${run}`, nFree = `UI78 Biriktirilmagan ${run}`;
  const own = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: nOwn })).data.customer_id;
  const other = (await L.rpc('sellerb', 'rpc_create_customer_with_code', { p_contact_name: nOther })).data.customer_id;
  const free = (await L.svc('POST', 'rest/v1/customers', { organization_id: L.ORG, contact_name: nFree, customer_code: `UI78F-${run}`.slice(0, 16), seller_id: null }, { Prefer: 'return=representation' })).data[0].id;
  const foreign = (await L.rpc(OTHER_ORG, 'rpc_create_customer_with_code', { p_contact_name: `UI78 Begona ${run}` })).data?.customer_id;
  // open debts on the own customer: $1000 currency sale (5 g) + 12.5 g legacy debt
  const sale = await L.rpc('sellera', 'rpc_record_currency_sale', { p_customer_id: own, p_currency: 'USD', p_amount: 1000, p_weight_grams: 5, p_idempotency_key: `ui78-${run}` });
  const leg = await L.rpc('sellera', 'rpc_record_client_legacy_debt', { p_customer_id: own, p_balance_type: 'debt', p_amount_585_g: 12.5, p_as_of_date: today, p_notes: 'UI78', p_entry_type: 'manual_addition', p_target_final_balance: null, p_idempotency_key: `ui78l-${run}` });
  if (!sale.ok || !leg.ok) throw new Error(`setup ${sale.error || ''} ${leg.error || ''}`);
  const g0 = await gold(own), u0 = await usd(own);
  const sales0 = (await L.sel(`jewelry_sales?customer_id=eq.${own}&select=id`)).length;

  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  try {
    // ---------- SEC-1 seller archives his own customer in the UI ----------
    const s = await login(br, 'sellera');
    await go(s, '/sales/app/customers');
    const btnOwn = await row(s, nOwn).locator('[data-testid="archive-customer"]').count();
    const btnFree = await row(s, nFree).locator('[data-testid="archive-customer"]').count().catch(() => 0);
    T('U78-01', 'seller sees "Mijozni o\'chirish" on his own customer, not on an unassigned one', btnOwn === 1 && btnFree === 0, { own: 1, unassigned: 0 }, { own: btnOwn, unassigned: btnFree });
    await row(s, nOwn).locator('[data-testid="archive-customer"]').dblclick(); await s.p.waitForTimeout(3500);
    const a1 = await cust(own); const au1 = await audits(own);
    // the success message also names the customer: count the customer's row (its archive button), not the text
    const listed = await s.p.locator(`tr:has-text("${nOwn}"), div.rounded-2xl:has-text("${nOwn}")`).locator('[data-testid="archive-customer"]').locator('visible=true').count();
    T('U78-02', 'one confirmation, double click -> exactly one archive operation; archived_by = the seller; gone from the normal list', a1.is_archived && a1.archived_by === C.sellera.id && au1 === 1 && listed === 0 && s.dialogs.length >= 1 && /o'chirasizmi/.test(s.dialogs[0]),
      { archived: true, audits: 1, listed: 0 }, { archived: a1.is_archived, by: a1.archived_by === C.sellera.id, audits: au1, listed, dialogs: s.dialogs.length, msg: (s.dialogs[0] || '').slice(0, 120) });
    await s.p.screenshot({ path: path.join(SHOTS, '01-seller-after-archive.png') });

    // ---------- SEC-2 server-side refusals with real JWTs ----------
    const rOther = await L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: other, p_archive: true });
    const rFree = await L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: free, p_archive: true });
    const rForeign = foreign ? await L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: foreign, p_archive: true }) : { ok: false, error: 'Mijoz topilmadi (no foreign customer)' };
    const wOther = await L.uwrite('sellera', 'PATCH', `customers?id=eq.${other}`, { is_archived: true });
    const wFree = await L.uwrite('sellera', 'PATCH', `customers?id=eq.${free}`, { is_archived: true });
    const st = { other: (await cust(other)).is_archived, free: (await cust(free)).is_archived, foreign: foreign ? (await cust(foreign)).is_archived : false };
    T('U78-03', 'seller cannot archive another seller\'s / unassigned / other organization\'s customer (RPC 42501 / not found; direct PATCH 0 rows / refused); nothing changed',
      !rOther.ok && /biriktirilmagan/.test(rOther.error || '') && !rFree.ok && !rForeign.ok && /topilmadi/.test(rForeign.error || '')
        && (!wOther.ok || (Array.isArray(wOther.data) && wOther.data.length === 0)) && !wFree.ok && !st.other && !st.free && !st.foreign,
      'all refused', { other: (rOther.error || '').slice(0, 70), free: (rFree.error || '').slice(0, 50), foreign: (rForeign.error || '').slice(0, 40), patchOther: wOther.ok ? wOther.data : wOther.error, patchFree: (wFree.error || 'ok').slice(0, 60), st });

    // ---------- SEC-3 debt and history kept, archived list, still collectible ----------
    const sales1 = (await L.sel(`jewelry_sales?customer_id=eq.${own}&select=id`)).length;
    await s.p.locator('[data-testid="toggle-archived"]').first().click(); await s.p.waitForTimeout(1000);
    const archivedRow = await row(s, nOwn).innerText().catch(() => '');
    const pay = await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: own, p_currency: 'USD', p_usd_amount: 200, p_idempotency_key: `ui78p-${run}` });
    const rep = await L.rpc('manager', 'rpc_get_period_report', { p_from: today, p_to: today });
    const liveUsd = (await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&currency=eq.USD&select=d:debt_amount,a:advance_amount`)).reduce((x, y) => x + N(y.d) - N(y.a), 0);
    T('U78-04', 'archived: 585 g debt and USD debt unchanged, sales kept, shown under "Arxivlangan mijozlar" with the debt; a $200 payment still works; report includes it',
      g0 === await gold(own) && sales1 === sales0 && /12[.,]5/.test(archivedRow) && pay.ok && await usd(own) === u0 - 200 && Math.abs(N(rep.data?.closing?.customer_debt_net_usd) - liveUsd) < 0.005,
      { g585: g0, usd: u0 - 200, sales: sales0 }, { g585: await gold(own), usd: await usd(own), sales: sales1, rowShown: archivedRow.replace(/\s+/g, ' ').slice(0, 90), pay: pay.ok || pay.error, reportUsd: rep.data?.closing?.customer_debt_net_usd, liveUsd });
    await s.p.screenshot({ path: path.join(SHOTS, '02-seller-archived-list.png') });

    // ---------- SEC-4 restore (seller own) ----------
    await row(s, nOwn).locator('[data-testid="restore-customer"]').click(); await s.p.waitForTimeout(3000);
    const a2 = await cust(own);
    await s.p.locator('[data-testid="toggle-archived"]').first().click(); await s.p.waitForTimeout(1000);
    const back = await s.p.locator(`tr:has-text("${nOwn}"), div.rounded-2xl:has-text("${nOwn}")`).locator('[data-testid="archive-customer"]').locator('visible=true').count();
    T('U78-05', 'seller restores his own customer from "Arxivlangan mijozlar"; back in the normal list; debts unchanged', !a2.is_archived && a2.archived_at === null && back >= 1 && g0 === await gold(own), { archived: false, listed: '>=1' }, { archived: a2.is_archived, at: a2.archived_at, listed: back, audits: await audits(own) });
    T('U78-06', 'no API 4xx/5xx in the seller UI session', s.bad.length === 0, [], s.bad);
    await s.ctx.close();

    // ---------- management: archive + restore another seller's customer in the UI ----------
    const m = await login(br, 'manager');
    await go(m, '/sales/app/customers');
    await row(m, nOther).locator('[data-testid="archive-customer"]').click(); await m.p.waitForTimeout(3000);
    const o1 = await cust(other);
    await m.p.locator('[data-testid="toggle-archived"]').first().click(); await m.p.waitForTimeout(1000);
    await row(m, nOther).locator('[data-testid="restore-customer"]').click(); await m.p.waitForTimeout(3000);
    const o2 = await cust(other);
    T('U78-07', 'manager archives and restores another seller\'s customer in the UI (director = manager)', o1.is_archived && o1.archived_by !== null && !o2.is_archived && m.bad.length === 0, { archived: true, restored: true }, { a: o1.is_archived, r: !o2.is_archived, bad: m.bad });
    const rDir = await L.rpc('director', 'rpc_archive_customer', { p_customer_id: free, p_archive: true }); const rDir2 = await L.rpc('director', 'rpc_archive_customer', { p_customer_id: free, p_archive: false });
    T('U78-08', 'director archives / restores an unassigned customer via the API', rDir.ok && rDir2.ok && !(await cust(free)).is_archived, true, { a: rDir.ok || rDir.error, r: rDir2.ok || rDir2.error });
    await m.ctx.close();

    // ---------- 390 px phone ----------
    const ph = await login(br, 'sellera', { width: 390, height: 844 });
    await go(ph, '/sales/app/customers');
    const vis = await row(ph, nOwn).locator('[data-testid="archive-customer"]').count();
    const ov = await ph.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await ph.p.screenshot({ path: path.join(SHOTS, '03-seller-390-archive-button.png') });
    T('U78-09', 'seller on a 390 px phone: "Mijozni o\'chirish" in the mobile card, no horizontal overflow', vis === 1 && ov <= 0, { button: 1, overflow: 0 }, { button: vis, overflow: ov });
    await ph.ctx.close();
  } finally { await br.close(); }
  fs.writeFileSync(path.join(EV, `${TARGET}-ui-078-archive.json`), JSON.stringify({ target: TARGET, run, ids: { own, other, free, foreign }, results: R }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
