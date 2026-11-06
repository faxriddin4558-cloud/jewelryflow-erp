// REAL STAGING 080 - period report performance + correctness (synthetic audit org A, real GoTrue JWTs through PostgREST,
// ground truth = service-role reads of raw document rows). Read-only except the browser page loads.
//   P80-T*  timings: the 01.11-06.11 window that returned HTTP 500 under 077, as director and as manager (5 runs each),
//           other windows and every seller filter - no 5xx, no timeout
//   P80-OLD old vs new: the period reports frozen by the OLD 077 function (goldia_report_periods: 01-04.11, 05.11)
//           recomputed by the 080 function - flows, opening, closing, undocumented opening and per-seller period
//           figures identical (only the "live" / "today" fields legitimately move)
//   P80-CUR UZS / USD figures of the report vs raw rows: sales (count, amount), sale reversals, payments (credited,
//           advance), payment reversals, customer net debt = independent RC-CUR model
//   P80-UI  report page desktop (director) and 390 px (manager): page = server, no API error, no horizontal overflow
const fs = require('fs'); const path = require('path');
const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const EV = path.join(__dirname, '..', 'evidence', 'staging-080'); fs.mkdirSync(EV, { recursive: true });
const BASE = 'https://jewelryflow-sales-staging.vercel.app';
const N = Number; const u2 = (x) => Math.round(N(x) * 100); const u4 = (x) => Math.round(N(x) * 1e4);
const R = []; const TIMES = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act, at: new Date().toISOString() }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 320)}`); };
const all = async (q) => { const out = []; for (let o = 0; ; o += 1000) { const p = await L.sel(`${q}${q.includes('?') ? '&' : '?'}limit=1000&offset=${o}`); out.push(...p); if (p.length < 1000) break; } return out; };
const timed = async (who, from, to, seller = null) => {
  const t0 = Date.now(); const r = await L.rpc(who, 'rpc_get_period_report', { p_from: from, p_to: to, p_seller_id: seller });
  const ms = Date.now() - t0; TIMES.push({ who, from, to, seller, ms, status: r.ok ? 200 : r.status, error: r.ok ? undefined : (r.error || '').slice(0, 120) }); return { r, ms };
};
(async () => {
  const today = L.tashkentToday(); const C = L.creds(); const ORG = L.ORG;
  // ---------------- timings ----------------
  for (const who of ['director', 'manager']) {
    const runs = []; for (let i = 0; i < 5; i++) runs.push(await timed(who, '2026-11-01', '2026-11-06'));
    const ms = runs.map((x) => x.ms); const bad = runs.filter((x) => !x.r.ok);
    T(`P80-T-${who}`, `${who}: 01.11-06.11 (HTTP 500 under 077) - 5 runs, all HTTP 200`, bad.length === 0, { status: 200, runs: 5 },
      { ms, max_ms: Math.max(...ms), errors: bad.map((x) => `${x.r.status} ${(x.r.error || '').slice(0, 60)}`) });
  }
  const sellers = (await L.sel(`seller_gold_accounts?organization_id=eq.${ORG}&select=seller_id&order=seller_id.asc`)).map((s) => s.seller_id);
  const windows = [['2026-11-01', today], [today, today], ['2026-11-05', '2026-11-05'], ['2026-10-01', '2026-10-31'], ['2026-10-05', today], ['2026-11-01', '2026-11-04']];
  const wres = [];
  for (const [f, t] of windows) { const a = await timed('manager', f, t); wres.push(a); for (const s of sellers) wres.push(await timed('manager', f, t, s)); }
  const wbad = wres.filter((x) => !x.r.ok); const wms = wres.map((x) => x.ms);
  T('P80-T-windows', `${windows.length} windows x (no seller + ${sellers.length} sellers) = ${wres.length} reports: all HTTP 200`, wbad.length === 0, { status: 200 },
    { reports: wres.length, max_ms: Math.max(...wms), avg_ms: Math.round(wms.reduce((a, b) => a + b, 0) / wms.length), errors: wbad.length });
  // seller filter consistency: sum of per-seller sale counts = unfiltered (seller-bound kinds)
  const full = (await timed('manager', '2026-11-01', today)).r.data;
  let sumSeller = 0; for (const s of sellers) { const r = (await timed('manager', '2026-11-01', today, s)).r.data; sumSeller += ['sale_gram', 'sale_uzs', 'sale_usd'].reduce((a, k) => a + N((r.flows[k] || {}).count || 0), 0); }
  const sumFull = ['sale_gram', 'sale_uzs', 'sale_usd'].reduce((a, k) => a + N((full.flows[k] || {}).count || 0), 0);
  T('P80-SELLER', 'seller filter: sales of every seller add up to the unfiltered report', sumSeller === sumFull, sumFull, sumSeller);

  // ---------------- old (077, frozen) vs new (080) ----------------
  const periods = await L.sel(`goldia_report_periods?organization_id=eq.${ORG}&select=id,period_start,period_end,report&order=period_end.asc`);
  const strip = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('live_') && !k.startsWith('closing_')));
  const oldNew = [];
  for (const p of periods) {
    const fresh = (await timed('manager', p.period_start, p.period_end)).r.data; const old = p.report;
    const diff = [];
    for (const key of ['flows', 'opening', 'closing', 'undocumented_opening', 'rates']) if (JSON.stringify(old[key]) !== JSON.stringify(fresh[key])) diff.push(key);
    const so = (old.sellers || []).map(strip), sn = (fresh.sellers || []).map(strip);
    if (JSON.stringify(so) !== JSON.stringify(sn)) diff.push('sellers (period figures)');
    oldNew.push({ window: `${p.period_start}..${p.period_end}`, diff, flow_kinds: Object.keys(old.flows || {}).length });
  }
  T('P80-OLD', `old 077 report (frozen copies, ${periods.length} periods) = new 080 report for the same windows: flows, opening, closing, undocumented, rates, per-seller period figures`,
    periods.length > 0 && oldNew.every((x) => x.diff.length === 0), 'identical', oldNew);

  // ---------------- UZS / USD vs raw rows (window 01.11 .. today covers the whole org history) ----------------
  const sales = await all(`jewelry_sales?organization_id=eq.${ORG}&sale_currency=in.(UZS,USD)&select=id,sale_currency,sale_amount,status,sale_date&order=id.asc`);
  const pays = await all(`client_currency_settlements?organization_id=eq.${ORG}&select=id,debt_currency,credited_amount,to_advance,status,settlement_date&order=id.asc`);
  const acc = await all(`client_currency_accounts?organization_id=eq.${ORG}&select=currency,debt_amount,advance_amount&order=customer_id.asc`);
  const curRes = {}; let curOk = true;
  for (const cur of ['UZS', 'USD']) {
    const k = cur.toLowerCase(); const S = sales.filter((s) => s.sale_currency === cur); const P = pays.filter((p) => p.debt_currency === cur);
    const exp = {
      sale_count: S.length, sale_amount: S.reduce((a, s) => a + u2(s.sale_amount), 0),
      reversed_sales: S.filter((s) => ['reversed', 'cancelled'].includes(s.status)).length,
      payment_count: P.length, credited: P.reduce((a, p) => a + u2(p.credited_amount), 0), advance: P.reduce((a, p) => a + u2(p.to_advance), 0),
      reversed_payments: P.filter((p) => p.status === 'reversed').length,
      net_debt: acc.filter((a) => a.currency === cur).reduce((a, x) => a + u2(x.debt_amount) - u2(x.advance_amount), 0),
    };
    const f = full.flows;
    const act = {
      sale_count: N((f[`sale_${k}`] || {}).count || 0), sale_amount: u2((f[`sale_${k}`] || {}).amount || 0),
      reversed_sales: null,
      payment_count: N((f[`payment_${k}`] || {}).count || 0), credited: u2((f[`payment_${k}`] || {}).amount || 0), advance: u2((f[`payment_${k}`] || {}).advance_created || 0),
      reversed_payments: N((f[`reversal_payment_${k}`] || {}).count || 0),
      net_debt: u2(full.closing[`customer_debt_net_${k}`]),
    };
    // sale reversals of this currency: report change of the currency debt by reversal_sale = - amount of reversed sales of this currency
    const revAmt = S.filter((s) => ['reversed', 'cancelled'].includes(s.status)).reduce((a, s) => a + u2(s.sale_amount), 0);
    const revRep = -u2((f.reversal_sale || {})[`customer_${k}_change`] || 0);
    act.reversed_sales = exp.reversed_sales; // count is shared with gram reversals in the report; the amount is checked below
    const ok = exp.sale_count === act.sale_count && exp.sale_amount === act.sale_amount && exp.payment_count === act.payment_count && exp.credited === act.credited
      && exp.advance === act.advance && exp.reversed_payments === act.reversed_payments && exp.net_debt === act.net_debt && revAmt === revRep;
    curOk = curOk && ok; curRes[cur] = { ok, exp, act, reversed_sale_amount: { raw: revAmt / 100, report: revRep / 100 } };
  }
  T('P80-CUR', 'UZS and USD: sales (count, amount), sale reversals (amount), payments (count, credited, advance), payment reversals, closing net debt = raw rows', curOk, 'equal', curRes);

  // ---------------- UI desktop (director) + 390 px (manager) ----------------
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  try {
    for (const [who, vp] of [['director', { width: 1366, height: 860 }], ['manager', { width: 390, height: 844 }]]) {
      const c = C[who]; const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500, acceptDownloads: true }); const p = await ctx.newPage(); const bad = [];
      p.on('response', (r) => { if (r.url().includes('supabase.co') && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split('/rest/')[1]); });
      await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
      await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
      await p.goto(BASE + '/sales/app/period-report', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
      await p.locator('[data-testid="report-from"]').fill('2026-11-01'); await p.locator('[data-testid="report-to"]').fill('2026-11-06');
      const t0 = Date.now();
      const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes('rpc_get_period_report') && (r.request().postData() || '').includes('"p_from":"2026-11-01"'), { timeout: 60000 }), p.locator('[data-testid="report-load"]').click()]);
      const ms = Date.now() - t0; await p.waitForTimeout(1500);
      const usd = await p.locator('[data-testid="flow-sale_usd"]').innerText().catch(() => '');
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const srv = (await L.rpc(who, 'rpc_get_period_report', { p_from: '2026-11-01', p_to: '2026-11-06' })).data;
      const cnt = srv.flows.sale_usd ? srv.flows.sale_usd.count : 0;
      await p.screenshot({ path: path.join(EV, `report-${who}-${vp.width}.png`), fullPage: vp.width > 500 });
      T(`P80-UI-${who}-${vp.width}`, `${who} ${vp.width} px: 01.11-06.11 report page loads (HTTP ${resp.status()}), USD sales count = server, no API error, no horizontal overflow`,
        resp.status() === 200 && usd.includes(`\t${cnt}\t`) && bad.length === 0 && ov <= 0, { status: 200, usd_count: cnt, overflow: 0 }, { status: resp.status(), ms, shown: usd.slice(0, 70), bad, overflow: ov });
      TIMES.push({ who, from: '2026-11-01', to: '2026-11-06', ui: true, ms, status: resp.status() });
      await ctx.close();
    }
  } finally { await br.close(); }
  fs.writeFileSync(path.join(EV, 'staging-report-080.json'), JSON.stringify({ target: 'staging', at: new Date().toISOString(), results: R, timings: TIMES }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`);
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(path.join(EV, 'staging-report-080.json'), JSON.stringify({ fatal: String(e), results: R, timings: TIMES }, null, 1)); process.exit(1); });
