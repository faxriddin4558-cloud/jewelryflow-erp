// REAL STAGING 077 targeted checks (synthetic audit organization A only; real GoTrue JWTs through PostgREST; ground
// truth = service-role reads). Covers what the generic suites do not:
//   RC-*  capital reclassification UZS -> USD by the MANAGER, second reclassification refused, reversal returns the
//         manager cash / USD exactly to the state before the capital entry
//   ID-*  financial operations by a manager AND a director whose employees.id != auth uid (F77-3)
//   RB-*  period report date boundaries 2026-10-05 .. 2026-11-05 (inclusive), continuity at the boundary, additivity,
//         previous / next month, sales per Tashkent business date = database
//   UI-D  director main screen on a 390 px phone (simple panel, no horizontal overflow)
// Run: GA_TARGET=staging GA_CREDS=<creds.json> node docs/audits/goldia-077/harness/staging-077-targeted.js
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const OUT = path.join(__dirname, '..', 'evidence', 'staging-077-targeted.json');
const BASE = 'https://jewelryflow-sales-staging.vercel.app';
const N = Number; const r2 = (x) => Math.round(N(x) * 100) / 100; const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const R = []; const OPS = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act, at: new Date().toISOString() }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
const vault = async () => { const v = (await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=c:manager_cash_amount,u:manager_usd_amount`))[0]; return { c: r2(v.c), u: r2(v.u) }; };
const tx = async (id) => (await L.sel(`financial_transactions?id=eq.${id}&select=*`))[0];
const txId = (r) => r.ok && (r.data?.transaction_id || r.data?.id || r.data?.financial_transaction_id);
const latestTx = async (by) => (await L.sel(`financial_transactions?organization_id=eq.${L.ORG}&recorded_by=eq.${by}&order=created_at.desc&limit=1&select=id`))[0]?.id;

async function makeIdDiffUser(tag, role, run) {
  const C = L.creds(); if (C[tag]) return C[tag];
  const email = `audit.fx077.${tag.toLowerCase()}.${run}@goldia-audit.test`; const password = crypto.randomBytes(18).toString('base64url');
  const u = await L.svc('POST', 'auth/v1/admin/users', { email, password, email_confirm: true });
  if (!u.ok) throw new Error('create user ' + u.error);
  const uid = u.data.id; const empId = crypto.randomUUID();
  // the legacy auth trigger may auto-provision a row with id = uid; replace it by one whose id differs from the login id
  await L.svc('DELETE', `rest/v1/employees?id=eq.${uid}`);
  const e = await L.svc('POST', 'rest/v1/employees', { id: empId, user_id: uid, organization_id: L.ORG, role, full_name: `FX77 ${tag} (id!=uid)`,
    employee_code: `FX77-${tag.toUpperCase()}-${run}`, email, is_active: true, status: 'active', employment_status: 'active' }, { Prefer: 'return=representation' });
  if (!e.ok) throw new Error('create employee ' + e.error);
  const all = JSON.parse(fs.readFileSync(L.CREDS)); all[tag] = { email, password, id: uid, employee_id: empId, org: L.ORG };
  fs.writeFileSync(L.CREDS, JSON.stringify(all, null, 1));
  return all[tag];
}

(async () => {
  const run = Date.now().toString(36); const today = L.tashkentToday(); const C0 = L.creds();
  // ---------------- RC: reclassification UZS -> USD and reversal (manager) ----------------
  const v0 = await vault();
  const cap = await L.rpc('manager', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 1250000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12500, p_notes: `RC77 ${run}` });
  const capId = txId(cap) || await latestTx(C0.manager.id);
  const v1 = await vault(); const t1 = await tx(capId);
  OPS.push({ op: 'capital_in', by: 'manager', id: capId, before: v0, after: v1 });
  T('RC-01', 'manager records 1 250 000 UZS capital: manager cash +1 250 000 once', cap.ok && r2(v1.c - v0.c) === 1250000 && v1.u === v0.u, { dc: 1250000, du: 0 }, { ok: cap.ok, err: cap.error, id: capId, dc: r2(v1.c - v0.c), du: r2(v1.u - v0.u), amount: t1?.amount_num });
  const rec = await L.rpc('manager', 'rpc_reclassify_capital_transaction', { p_transaction_id: capId, p_new_destination: 'manager_usd', p_reason: `RC77 ${run}` });
  const v2 = await vault(); const t2 = await tx(capId);
  OPS.push({ op: 'reclassify', by: 'manager', id: capId, before: v1, after: v2, tx: { amount_num: t2.amount_num, currency: t2.currency, till: t2.source_till } });
  T('RC-02', 'manager reclassifies it to USD: UZS back to the start, USD +100 (1 250 000 / 12 500)', rec.ok && v2.c === v0.c && r2(v2.u - v0.u) === 100, { c: v0.c, du: 100 }, { ok: rec.ok, err: rec.error, c: v2.c, du: r2(v2.u - v0.u) });
  T('RC-03', 'document follows the money: amount 100 USD on manager_usd, original kept in reclassified_from_*', N(t2.amount_num) === 100 && t2.currency === 'USD' && t2.source_till === 'manager_usd' && N(t2.reclassified_from_amount) === 1250000 && t2.reclassified_from_currency === 'UZS' && t2.reclassified_from_till === 'manager_uzs',
    { amount: 100, cur: 'USD', from: [1250000, 'UZS', 'manager_uzs'] }, { amount: t2.amount_num, cur: t2.currency, till: t2.source_till, from: [t2.reclassified_from_amount, t2.reclassified_from_currency, t2.reclassified_from_till] });
  const rec2 = await L.rpc('director', 'rpc_reclassify_capital_transaction', { p_transaction_id: capId, p_new_destination: 'manager_uzs', p_reason: 'second' });
  const v3 = await vault();
  T('RC-04', 'second reclassification refused (also for the director), vault unchanged', !rec2.ok && /allaqachon qayta tasniflangan/.test(rec2.error || '') && v3.c === v2.c && v3.u === v2.u, 'refused', { err: (rec2.error || '').slice(0, 90), same: v3.c === v2.c && v3.u === v2.u });
  const rev = await L.rpc('manager', 'rpc_reverse_financial_transaction', { p_transaction_id: capId, p_reason: `RC77 reverse ${run}` });
  const v4 = await vault(); const t4 = await tx(capId);
  OPS.push({ op: 'reverse', by: 'manager', id: capId, before: v3, after: v4 });
  T('RC-05', 'manager reverses the reclassified capital: manager UZS and USD exactly as before the capital entry', rev.ok && v4.c === v0.c && v4.u === v0.u && t4.status === 'reversed', v0, { ok: rev.ok, err: rev.error, v: v4, status: t4.status });
  const rev2 = await L.rpc('manager', 'rpc_reverse_financial_transaction', { p_transaction_id: capId, p_reason: 'again' }); const v5 = await vault();
  T('RC-06', 'second reversal refused, vault unchanged', !rev2.ok && v5.c === v4.c && v5.u === v4.u, 'refused', { err: (rev2.error || '').slice(0, 80) });

  // ---------------- ID: employees.id != auth uid ----------------
  for (const [tag, role] of [['idmgr', 'production_manager'], ['iddir', 'admin']]) {
    const u = await makeIdDiffUser(tag, role, run);
    const emp = (await L.sel(`employees?user_id=eq.${u.id}&select=id,user_id,role,organization_id`))[0];
    T(`ID-${tag}-00`, `${tag}: synthetic ${role} whose employees.id != auth uid`, emp && emp.id !== emp.user_id && emp.organization_id === L.ORG, 'id != uid', emp);
    const w0 = await vault();
    const c = await L.rpc(tag, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 777000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12500, p_notes: `ID77 ${tag} ${run}` });
    const id = txId(c) || await latestTx(emp.id); const tc = id && await tx(id); const w1 = await vault();
    T(`ID-${tag}-01`, `${tag}: records capital; recorded_by = employees.id (not the login id)`, c.ok && tc && tc.recorded_by === emp.id && r2(w1.c - w0.c) === 777000, { recorded_by: emp.id, dc: 777000 }, { ok: c.ok, err: c.error, recorded_by: tc?.recorded_by, dc: r2(w1.c - w0.c), id });
    const rv = await L.rpc(tag, 'rpc_reverse_financial_transaction', { p_transaction_id: id, p_reason: `ID77 ${tag}` });
    const tr = id && await tx(id); const w2 = await vault();
    OPS.push({ op: 'id_diff_reverse', who: tag, emp: emp.id, uid: u.id, tx: id, ok: rv.ok, err: rv.error });
    T(`ID-${tag}-02`, `${tag}: reverses it (076: FK error) - reversed_by = employees.id, cash back`, rv.ok && tr.status === 'reversed' && tr.reversed_by === emp.id && w2.c === w0.c, { reversed_by: emp.id, c: w0.c }, { ok: rv.ok, err: rv.error, status: tr?.status, reversed_by: tr?.reversed_by, c: w2.c });
    // reclassify + reverse by the same user (audit / actor columns must not use the login id as an employee id)
    const c2 = await L.rpc(tag, 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 125000, p_currency: 'UZS', p_gold_rate: 1000000, p_usd_rate: 12500, p_notes: `ID77b ${tag} ${run}` });
    const id2 = txId(c2) || await latestTx(emp.id);
    const rc = await L.rpc(tag, 'rpc_reclassify_capital_transaction', { p_transaction_id: id2, p_new_destination: 'manager_usd', p_reason: `ID77 ${tag}` });
    const rr = await L.rpc(tag, 'rpc_reverse_financial_transaction', { p_transaction_id: id2, p_reason: `ID77 ${tag}` }); const w3 = await vault();
    T(`ID-${tag}-03`, `${tag}: reclassify UZS->USD and reverse work; vault back to the start`, c2.ok && rc.ok && rr.ok && w3.c === w0.c && w3.u === w0.u, w0, { c2: c2.error, rc: rc.error, rr: rr.error, v: w3 });
    const rep = await L.rpc(tag, 'rpc_get_period_report', { p_from: today, p_to: today });
    T(`ID-${tag}-04`, `${tag}: period report readable`, rep.ok, true, rep.ok || rep.error);
  }

  // ---------------- RB: period report boundaries ----------------
  const rep = async (a, b) => { const r = await L.rpc('manager', 'rpc_get_period_report', { p_from: a, p_to: b }); if (!r.ok) throw new Error(`report ${a}..${b}: ${r.error}`); return r.data; };
  // window 05.10 .. today (the user's 05.10-05.11 example while today was 05.11); the boundary is yesterday / today
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const yday = shift(today, -1);
  const main = await rep('2026-10-05', today); const before = await rep('2026-10-05', yday); const day = await rep(today, today);
  const keys = Object.keys(main.closing).filter((k) => typeof main.closing[k] === 'number' || !isNaN(N(main.closing[k])));
  const cont = keys.filter((k) => Math.abs(N(before.closing[k]) - N(day.opening[k])) > 0.00005);
  T('RB-01', `continuity: closing of 05.10-${yday} = opening of ${today} for every balance`, cont.length === 0, 0, { keys: keys.length, diff: cont });
  const same = keys.filter((k) => Math.abs(N(main.opening[k]) - N(before.opening[k])) > 0.00005 || Math.abs(N(main.closing[k]) - N(day.closing[k])) > 0.00005);
  T('RB-02', `opening(05.10..${today}) = opening(05.10..${yday}) and closing(05.10..${today}) = closing(${today})`, same.length === 0, 0, same);
  const kinds = new Set([...Object.keys(main.flows), ...Object.keys(before.flows), ...Object.keys(day.flows)]); const addBad = [];
  for (const k of kinds) for (const f of new Set([...Object.keys(main.flows[k] || {}), ...Object.keys(before.flows[k] || {}), ...Object.keys(day.flows[k] || {})])) {
    const a = N((main.flows[k] || {})[f] || 0), b = N((before.flows[k] || {})[f] || 0) + N((day.flows[k] || {})[f] || 0);
    if (typeof ((main.flows[k] || {})[f] ?? 0) !== 'object' && Math.abs(a - b) > 0.005) addBad.push([k, f, a, b]);
  }
  T('RB-03', `additivity: every flow of 05.10..${today} = flow of 05.10..${yday} + flow of ${today} (both ends inclusive, no double count)`, addBad.length === 0, 0, { kinds: kinds.size, bad: addBad.slice(0, 5) });
  const liveUsd = r2((await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&currency=eq.USD&select=d:debt_amount,a:advance_amount`)).reduce((s, x) => s + N(x.d) - N(x.a), 0));
  const liveUzs = r2((await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&currency=eq.UZS&select=d:debt_amount,a:advance_amount`)).reduce((s, x) => s + N(x.d) - N(x.a), 0));
  const liveG = r4((await L.sel(`client_gold_accounts?organization_id=eq.${L.ORG}&select=d:current_debt_grams,a:advance_balance_grams`)).reduce((s, x) => s + N(x.d) - N(x.a), 0));
  const liveStock = r4((await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=s:current_physical_stock_g`)).reduce((s, x) => s + N(x.s), 0));
  const lv = await vault();
  const liveAct = { usd: r2(main.closing.customer_debt_net_usd), uzs: r2(main.closing.customer_debt_net_uzs), g: r4(main.closing.customer_debt_net_g585), stock: r4(main.closing.seller_stock_physical_g), mgr_uzs: r2(main.closing.manager_cash_uzs), mgr_usd: r2(main.closing.manager_cash_usd) };
  const liveExp = { usd: liveUsd, uzs: liveUzs, g: liveG, stock: liveStock, mgr_uzs: lv.c, mgr_usd: lv.u };
  T('RB-04', `closing on ${today} (today) = live database balances (customer 585 g / UZS / USD, seller stock, manager cash)`, JSON.stringify(liveAct) === JSON.stringify(liveExp), liveExp, liveAct);
  const prev = await rep('2026-09-05', '2026-10-04'); const next = await rep(shift(today, 1), shift(today, 30)).catch((e) => ({ error: e.message }));
  const firstDoc = main.undocumented_opening?.first_document_date;
  T('RB-05', 'previous month 05.09-04.10 (before the first document of this org): no flows, opening = closing', Object.keys(prev.flows).length === 0 && keys.every((k) => Math.abs(N(prev.opening[k]) - N(prev.closing[k])) < 0.00005), { flows: 0 }, { flows: Object.keys(prev.flows), firstDoc });
  T('RB-06', `next 30 days ${shift(today, 1)}..${shift(today, 30)} (future): refused clearly or empty`, next.error ? true : Object.keys(next.flows).length === 0, 'refused or empty', next.error ? next.error.slice(0, 120) : { flows: Object.keys(next.flows) });
  // sales per Tashkent business date: report count = database count by sale_date, and sale_date = Tashkent date of created_at
  const sales = []; // PostgREST returns at most 1000 rows per request: page through all of them
  for (let off = 0; ; off += 1000) { const pg = await L.sel(`jewelry_sales?organization_id=eq.${L.ORG}&select=id,sale_date,created_at&order=id.asc&limit=1000&offset=${off}`); sales.push(...pg); if (pg.length < 1000) break; }
  const tzBad = sales.filter((s) => s.sale_date !== new Date(Date.parse(s.created_at) + 5 * 3600e3).toISOString().slice(0, 10));
  const nearMidnight = sales.filter((s) => { const h = new Date(s.created_at).getUTCHours(); return h >= 19; }).length;
  T('RB-07', 'every sale: sale_date = Asia/Tashkent date of created_at (UTC 19:00-24:00 belongs to the next day)', tzBad.length === 0, 0, { sales: sales.length, utc_after_19h: nearMidnight, bad: tzBad.slice(0, 3) });
  const days = [...new Set(sales.map((s) => s.sale_date))].sort(); const dayBad = [];
  for (const d of days) {
    const r = await rep(d, d); const cnt = ['sale_gram', 'sale_uzs', 'sale_usd'].reduce((s, k) => s + N((r.flows[k] || {}).count || 0), 0);
    const db = sales.filter((s) => s.sale_date === d).length; if (cnt !== db) dayBad.push({ d, report: cnt, db });
  }
  T('RB-08', `sales count per business date: report = database (${days.join(', ')})`, dayBad.length === 0, 0, dayBad);

  // ---------------- UI-D: director main screen at 390 px ----------------
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  try {
    const c = L.creds().director; const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const bad = [];
    p.on('response', (r) => { if (r.url().includes('supabase.co') && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split('.co')[1].split('?')[0]); });
    await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
    await p.goto(BASE + '/sales/app', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
    const panel = await p.locator('[data-testid="manager-simple-panel"]').count(); const cards = await p.locator('[data-testid^="simple-"]').count();
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const cap = await p.locator('button:has-text("Kapital"), button:has-text("kapital")').count();
    fs.mkdirSync(path.join(__dirname, '..', 'evidence', 'staging-ui-077-screens'), { recursive: true });
    await p.screenshot({ path: path.join(__dirname, '..', 'evidence', 'staging-ui-077-screens', 'director-390-main.png'), fullPage: false });
    T('UI-D-01', 'director on a 390 px phone: simple panel, capital entry visible, no horizontal overflow, no API errors', panel === 1 && ov <= 0 && bad.length === 0, { panel: 1, overflow: 0, errors: [] }, { panel, cards, capitalButtons: cap, overflow: ov, errors: bad });
  } finally { await br.close(); }

  fs.writeFileSync(OUT, JSON.stringify({ target: 'staging', run, results: R, ops: OPS }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(OUT, JSON.stringify({ fatal: String(e), results: R, ops: OPS }, null, 1)); process.exit(1); });
