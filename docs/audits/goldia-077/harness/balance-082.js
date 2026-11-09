// Customer debt / advance canonical model (critical display bug 2026-11-09) with real GoTrue logins through PostgREST:
//   BM-SCN  8 scenario customers, 2 sellers: sale -> debt; legacy advance; payment larger than the debt (advance);
//           advance + later sale; reversed sale; reversed legacy debt; advance LARGER than the open debt (manager);
//           USD sale + USD overpayment (currency stays separate from grams). Expected values from an independent model.
//   BM-MR   monthly report (082): every customer of the organization: closing_net_g = live account (debt - advance),
//           closing_debt_g / closing_advance_g = its two sides, totals = sums of the rows, net = debt - advance,
//           seller filter adds up, previous month closing = this month opening (continuity), no clamping
//   BM-UL   unified ledger: open debt / open advance per scenario customer = account
//   BM-PR   period report (and therefore its CSV): customer_debt_net_g585 / _uzs / _usd = sum(debt - advance) per unit
//   BM-OBL  customer advances do not change the seller's 585 obligation (only debt-type legacy rows do)
//   BM-UI   (GA_UI=1, frontend with this fix) director card, manager panel (585 / UZS / USD), home card: signed net =
//           sum(debt) - sum(advance) of the database, gross debt and gross advance shown, negative net worded
//   GA_TARGET=local | staging (synthetic organization only). GA_MR_OLD=1: only measures the 073 report (before 082).
const fs = require('fs'); const path = require('path');
const TARGET = process.env.GA_TARGET || 'local';
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const OUT = process.env.GA_OUT || path.join(__dirname, '..', 'evidence', `${TARGET}-balance-082.json`);
const N = (x) => Number(x || 0); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4; const r2 = (x) => Math.round(N(x) * 100) / 100;
const R = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.status} ${r.error}`); return r.data; };
const accG = async (c) => { const a = (await L.sel(`client_gold_accounts?customer_id=eq.${c}&select=d:current_debt_grams,a:advance_balance_grams`))[0]; return a ? { d: r4(a.d), a: r4(a.a) } : { d: 0, a: 0 }; };
const accCur = async (c, cur) => { const a = (await L.sel(`client_currency_accounts?customer_id=eq.${c}&currency=eq.${cur}&select=d:debt_amount,a:advance_amount`))[0]; return a ? { d: r2(a.d), a: r2(a.a) } : { d: 0, a: 0 }; };
const totals = (rows, d, a) => { let gd = 0, ga = 0; for (const r of rows) { const n = r4(N(d(r)) - N(a(r))); if (n > 0) gd += n; else ga -= n; } return { gd: r4(gd), ga: r4(ga), net: r4(gd - ga) }; };

(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday();
  const [y, m] = today.split('-').map(Number); const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
  must(await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today }), 'rate');
  for (const s of ['sellera', 'sellerb']) await L.rpc(s, 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12500, p_reason: 'bm082' });
  const oblBefore = {}; for (const s of ['sellera', 'sellerb']) oblBefore[s] = r4(((await L.sel(`seller_gold_accounts?seller_id=eq.${C[s].id}&select=l:seller_legacy_debt_obligation_g`))[0] || { l: 0 }).l);
  // stock for the gram sales: 6 pieces x 10 g to sellera, 3 x 10 g to sellerb
  const rc = must(await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `BM82 ${run}`, p_original_physical_g: 90, p_factory_markup_pct: 8 }), 'receipt');
  must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.receipt_id, p_pieces: Array(6).fill({ weight_grams: 10 }) }), 'consignment a');
  must(await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellerb.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.receipt_id, p_pieces: Array(3).fill({ weight_grams: 10 }) }), 'consignment b');
  const cust = async (seller, name) => must(await L.rpc(seller, 'rpc_create_customer_with_code', { p_contact_name: `BM82 ${name} ${run}` }), 'customer ' + name).customer_id;
  const legacy = (who, c, type, g, k) => L.rpc(who, 'rpc_record_client_legacy_debt', { p_customer_id: c, p_balance_type: type, p_amount_585_g: g, p_as_of_date: today, p_notes: 'BM82', p_entry_type: 'manual_addition', p_target_final_balance: null, p_idempotency_key: `bm82-${k}-${run}` });
  const sale = (who, c, seller, g, pct, k) => L.rpc(who, 'rpc_record_weight_sale', { p_customer_id: c, p_seller_id: C[seller].id, p_weight_grams: g, p_client_markup_pct: pct, p_idempotency_key: `bm82-s-${k}-${run}` });
  const S = {};
  // A: sale 10 g @10 % -> debt 11
  S.A = { c: await cust('sellera', 'A qarz'), seller: 'sellera', exp: { d: 11, a: 0 } };
  must(await sale('sellera', S.A.c, 'sellera', 10, 10, 'a'), 'sale A');
  // B: legacy advance 5 (seller, 081) -> advance 5
  S.B = { c: await cust('sellera', 'B avans'), seller: 'sellera', exp: { d: 0, a: 5 } };
  must(await legacy('sellera', S.B.c, 'advance', 5, 'b'), 'advance B');
  // C: legacy debt 3, then payment of 8 g (7 200 000 so'm at 900 000) -> advance 5
  S.C = { c: await cust('sellera', 'C ortiqcha tolov'), seller: 'sellera', exp: { d: 0, a: 5 } };
  must(await legacy('sellera', S.C.c, 'debt', 3, 'c'), 'debt C');
  must(await L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: S.C.c, p_cash_amount: 7200000, p_rate_per_gram: 900000 }), 'payment C');
  // D: legacy advance 4, then sale 10 g @10 % (11 g) -> debt 7
  S.D = { c: await cust('sellera', 'D avans keyin sotuv'), seller: 'sellera', exp: { d: 7, a: 0 } };
  must(await legacy('sellera', S.D.c, 'advance', 4, 'd'), 'advance D');
  must(await sale('sellera', S.D.c, 'sellera', 10, 10, 'd'), 'sale D');
  // E: sellerb sale 10 g @0 % then reversal -> 0
  S.E = { c: await cust('sellerb', 'E bekor sotuv'), seller: 'sellerb', exp: { d: 0, a: 0 } };
  const se = must(await sale('sellerb', S.E.c, 'sellerb', 10, 0, 'e'), 'sale E');
  must(await L.rpc('manager', 'rpc_reverse_client_sale', { p_sale_id: se.sale_id, p_reason: 'BM82 reversal' }), 'reverse E');
  // F: sellerb legacy debt 6, reversed by the manager -> 0
  S.F = { c: await cust('sellerb', 'F bekor eski qarz'), seller: 'sellerb', exp: { d: 0, a: 0 } };
  const lf = must(await legacy('sellerb', S.F.c, 'debt', 6, 'f'), 'debt F');
  must(await L.rpc('manager', 'rpc_reverse_client_legacy_debt', { p_legacy_debt_id: lf.legacy_debt_id, p_reason: 'BM82 reversal' }), 'reverse F');
  // G: legacy debt 2, then the MANAGER records an advance of 9 (larger than the debt) -> advance 7
  S.G = { c: await cust('sellera', 'G avans qarzdan katta'), seller: 'sellera', exp: { d: 0, a: 7 } };
  must(await legacy('sellera', S.G.c, 'debt', 2, 'g1'), 'debt G');
  const sellerRefused = await legacy('sellera', S.G.c, 'advance', 9, 'g-seller');
  must(await legacy('manager', S.G.c, 'advance', 9, 'g2'), 'advance G (manager)');
  // H: sellerb USD sale 100 (1 g), USD payment 150 -> USD advance 50; grams untouched
  S.H = { c: await cust('sellerb', 'H USD'), seller: 'sellerb', exp: { d: 0, a: 0 }, usd: { d: 0, a: 50 } };
  must(await L.rpc('sellerb', 'rpc_record_currency_sale', { p_customer_id: S.H.c, p_seller_id: C.sellerb.id, p_currency: 'USD', p_amount: 100, p_weight_grams: 1, p_idempotency_key: `bm82-h-${run}` }), 'usd sale H');
  must(await L.rpc('sellerb', 'rpc_record_client_currency_settlement', { p_customer_id: S.H.c, p_currency: 'USD', p_usd_amount: 150, p_idempotency_key: `bm82-hp-${run}` }), 'usd payment H');

  // ---------------- BM-SCN: accounts = independent expectation
  const scn = {};
  for (const [k, s] of Object.entries(S)) scn[k] = await accG(s.c);
  T('BM-SCN-1', 'scenario accounts (585 g) = independent model: A 11 debt, B 5 adv, C 5 adv (overpaid), D 7 debt, E 0, F 0, G 7 adv (advance > debt), H 0',
    Object.entries(S).every(([k, s]) => scn[k].d === s.exp.d && scn[k].a === s.exp.a), Object.fromEntries(Object.entries(S).map(([k, s]) => [k, s.exp])), scn);
  T('BM-SCN-2', 'seller cannot enter an advance for a customer with open debt (081 rule kept); manager can', !sellerRefused.ok && /qarz bor/.test(String(sellerRefused.error)), 'refused', sellerRefused.ok ? 'ACCEPTED' : sellerRefused.error);
  const hUsd = await accCur(S.H.c, 'USD');
  T('BM-SCN-3', 'USD sale + overpayment: USD advance 50, gram account untouched (units not mixed)', hUsd.d === 0 && hUsd.a === 50 && scn.H.d === 0 && scn.H.a === 0, { usd: { d: 0, a: 50 }, g: { d: 0, a: 0 } }, { usd: hUsd, g: scn.H });
  T('BM-SCN-4', 'no account has debt and advance at the same time (585 and currency)',
    (await L.sel(`client_gold_accounts?current_debt_grams=gt.0&advance_balance_grams=gt.0&select=customer_id`)).length === 0 && (await L.sel(`client_currency_accounts?debt_amount=gt.0&advance_amount=gt.0&select=customer_id`)).length === 0, 0, 'checked');

  // ---------------- BM-OBL: seller obligation moves only with debt-type legacy rows (A/D sales are consignment-side)
  const oblAfter = {}; for (const s of ['sellera', 'sellerb']) oblAfter[s] = r4(((await L.sel(`seller_gold_accounts?seller_id=eq.${C[s].id}&select=l:seller_legacy_debt_obligation_g`))[0] || { l: 0 }).l);
  // sellera debt-type legacy: C +3, G +2 = +5 (advances B, D, G 0); sellerb: F +6 then reversed = 0
  T('BM-OBL', 'seller legacy obligation: sellera +5 (debt rows C 3 + G 2; advances B 5, D 4, G 9 do NOT reduce it), sellerb +0 (F reversed)',
    r4(oblAfter.sellera - oblBefore.sellera) === 5 && r4(oblAfter.sellerb - oblBefore.sellerb) === 0, { sellera: 5, sellerb: 0 }, { sellera: r4(oblAfter.sellera - oblBefore.sellera), sellerb: r4(oblAfter.sellerb - oblBefore.sellerb), before: oblBefore, after: oblAfter });

  // ---------------- BM-UL: unified ledger
  const ul = must(await L.rpc('director', 'rpc_get_unified_customer_ledger'), 'unified ledger');
  const ulBad = Object.entries(S).filter(([, s]) => { const it = ul.items.find((i) => i.customer_id === s.c); return !it || r4(it.net_debt_g) !== s.exp.d || r4(it.available_advance_g) !== s.exp.a; });
  T('BM-UL', 'unified ledger: open debt / open advance per scenario customer = account', ulBad.length === 0, 0, ulBad.map(([k]) => k));

  // ---------------- BM-MR: monthly report
  // every account of the organization (ids in chunks: one long in.() list overflows the request headers)
  const orgIds = (await L.sel(`customers?organization_id=eq.${L.ORG}&select=id`)).map((x) => x.id); const live = [];
  for (let i = 0; i < orgIds.length; i += 80) live.push(...await L.sel(`client_gold_accounts?select=customer_id,d:current_debt_grams,a:advance_balance_grams&customer_id=in.(${orgIds.slice(i, i + 80).join(',')})`));
  const liveMap = Object.fromEntries(live.map((x) => [x.customer_id, r4(N(x.d) - N(x.a))]));
  const mr = must(await L.rpc('director', 'rpc_get_customer_monthly_report', { p_year: y, p_month: m }), 'monthly report');
  const has082 = mr.items.length && mr.items[0].closing_net_g !== undefined;
  const itemNet = (it) => (has082 ? r4(it.closing_net_g) : r4(it.closing_debt_g));
  const mrScn = Object.fromEntries(Object.entries(S).map(([k, s]) => { const it = mr.items.find((i) => i.customer_id === s.c); return [k, it ? { debt: r4(it.closing_debt_g), adv: r4(it.closing_advance_g), net: itemNet(it) } : null]; }));
  const scnOk = Object.entries(S).every(([k, s]) => { const v = mrScn[k]; const net = r4(s.exp.d - s.exp.a); return net === 0 ? (!v || (v.net === 0)) : v && v.net === net && v.debt === s.exp.d && v.adv === s.exp.a; });
  T('BM-MR-1', `monthly report ${y}-${m}: scenario customers closing net / debt / advance = model${has082 ? '' : ' (073 report: no advance keys)'}`, scnOk, Object.fromEntries(Object.entries(S).map(([k, s]) => [k, r4(s.exp.d - s.exp.a)])), mrScn);
  const wrong = mr.items.filter((it) => liveMap[it.customer_id] !== undefined && Math.abs(itemNet(it) - liveMap[it.customer_id]) > 0.00005);
  const missing = Object.entries(liveMap).filter(([c, v]) => v !== 0 && !mr.items.some((it) => it.customer_id === c));
  T('BM-MR-2', `monthly report: EVERY customer of the organization: closing net = live account (debt - advance); no customer with a balance missing`,
    wrong.length === 0 && missing.length === 0, { wrong: 0, missing: 0 }, { wrong: wrong.length, missing: missing.length, customers: mr.items.length, first: wrong.slice(0, 3).map((w) => ({ c: w.customer_code, report: itemNet(w), live: liveMap[w.customer_id] })) });
  if (process.env.GA_MR_OLD) { fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, phase: 'before 082', results: R }, null, 2)); console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length}`); return; }
  const sumItems = (f) => r4(mr.items.reduce((a, it) => a + N(it[f]), 0));
  const sm = mr.summary;
  const lt = totals(live, (x) => x.d, (x) => x.a);
  T('BM-MR-3', 'monthly totals: closing debt / advance / net = sums of the rows = live gross debt / gross advance / net; net = debt - advance',
    r4(sm.total_closing_debt_g) === sumItems('closing_debt_g') && r4(sm.total_closing_advance_g) === sumItems('closing_advance_g') && r4(sm.total_closing_net_g) === sumItems('closing_net_g')
      && r4(sm.total_closing_net_g) === r4(sm.total_closing_debt_g - sm.total_closing_advance_g) && r4(sm.total_closing_debt_g) === lt.gd && r4(sm.total_closing_advance_g) === lt.ga,
    { debt: lt.gd, advance: lt.ga, net: lt.net }, { debt: sm.total_closing_debt_g, advance: sm.total_closing_advance_g, net: sm.total_closing_net_g });
  const mra = must(await L.rpc('director', 'rpc_get_customer_monthly_report', { p_seller_id: C.sellera.id, p_year: y, p_month: m }), 'monthly sellera');
  const mrb = must(await L.rpc('director', 'rpc_get_customer_monthly_report', { p_seller_id: C.sellerb.id, p_year: y, p_month: m }), 'monthly sellerb');
  const own = must(await L.rpc('sellera', 'rpc_get_customer_monthly_report', { p_year: y, p_month: m }), 'monthly as sellera');
  T('BM-MR-4', 'seller filter: sellera report = sellera\'s own report; its scenario rows are only sellera customers; A..D,G in sellera, E,F,H in sellerb',
    r4(mra.summary.total_closing_net_g) === r4(own.summary.total_closing_net_g) && ['A', 'B', 'C', 'D', 'G'].every((k) => mra.items.some((i) => i.customer_id === S[k].c) || r4(S[k].exp.d - S[k].exp.a) === 0)
      && !mra.items.some((i) => [S.E.c, S.F.c, S.H.c].includes(i.customer_id)) && mrb.items.some((i) => i.customer_id === S.H.c) === false,
    'consistent', { a: mra.summary.total_closing_net_g, own: own.summary.total_closing_net_g, b: mrb.summary.total_closing_net_g });
  const prev = must(await L.rpc('director', 'rpc_get_customer_monthly_report', { p_year: py, p_month: pm }), 'monthly previous');
  const prevClose = Object.fromEntries(prev.items.map((it) => [it.customer_id, r4(it.closing_net_g)]));
  const cont = mr.items.filter((it) => Math.abs(r4(it.opening_net_g) - (prevClose[it.customer_id] ?? 0)) > 0.00005);
  T('BM-MR-5', `continuity: closing net ${py}-${pm} = opening net ${y}-${m} for every customer (no clamping)`, cont.length === 0, 0, { mismatches: cont.length, first: cont.slice(0, 3).map((c) => c.customer_code) });
  const neg = mr.items.filter((it) => r4(it.closing_net_g) < 0);
  T('BM-MR-6', 'customers with a net ADVANCE are reported with a negative net and closing_advance_g (not hidden as 0)',
    neg.length > 0 && neg.every((it) => r4(it.closing_advance_g) === r4(-it.closing_net_g) && r4(it.closing_debt_g) === 0), '>0 rows, consistent', { rows: neg.length });

  // ---------------- BM-PR: period report (= its CSV)
  const pr = must(await L.rpc('director', 'rpc_get_period_report', { p_from: `${y}-${String(m).padStart(2, '0')}-01`, p_to: today, p_seller_id: null }), 'period report');
  const cur = await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&select=currency,d:debt_amount,a:advance_amount`).catch(async () => []);
  const usdT = totals(cur.filter((x) => x.currency === 'USD'), (x) => x.d, (x) => x.a); const uzsT = totals(cur.filter((x) => x.currency === 'UZS'), (x) => x.d, (x) => x.a);
  T('BM-PR', 'period report closing (UI + CSV): 585 / UZS / USD net = sum(debt - advance) per unit of the database',
    Math.abs(r4(pr.closing.customer_debt_net_g585) - lt.net) < 0.00005 && Math.abs(r2(pr.closing.customer_debt_net_usd) - r2(usdT.net)) < 0.005 && Math.abs(r2(pr.closing.customer_debt_net_uzs) - r2(uzsT.net)) < 0.005,
    { g585: lt.net, usd: r2(usdT.net), uzs: r2(uzsT.net) }, { g585: pr.closing.customer_debt_net_g585, usd: pr.closing.customer_debt_net_usd, uzs: pr.closing.customer_debt_net_uzs });

  // ---------------- BM-UI
  if (process.env.GA_UI) {
    const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
    const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
    const num = (t) => { const m2 = String(t).replace(/ /g, ' ').match(/(−|-)?\s*\$?([\d\s]+(?:[.,]\d+)?)/); return m2 ? (m2[1] ? -1 : 1) * Number(m2[2].replace(/\s/g, '').replace(',', '.')) : NaN; };
    const grab = async (tag, url, ids, before) => {
      const c = L.creds()[tag]; const ctx = await br.newContext({ viewport: { width: 1366, height: 900 } }); const p = await ctx.newPage(); const bad = [];
      p.on('response', (r) => { if (/supabase\.co|127\.0\.0\.1:54321/.test(r.url()) && r.status() >= 400) bad.push(r.status()); });
      await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
      await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
      await p.goto(BASE + url, { waitUntil: 'networkidle' });
      const out = { bad };
      if (before) Object.assign(out, await before(p));
      for (const id of ids) { await p.locator(`[data-testid="${id}"]`).first().waitFor({ timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500); out[id] = await p.locator(`[data-testid="${id}"]`).first().innerText().catch(() => ''); }
      await p.screenshot({ path: path.join(path.dirname(OUT), `bm082-${tag}-${url.replace(/\W+/g, '_')}.png`), fullPage: false }).catch(() => {});
      await ctx.close(); return out;
    };
    // the "Sof Nasiyasi" cards are inside the collapsed "Batafsil" section: open it first
    const mgr = await grab('manager', '/sales/app', ['simple-customer-g585', 'simple-customer-uzs', 'simple-customer-usd', 'home-client-net', 'home-client-breakdown'],
      async (p) => { await p.locator('[data-testid="dashboard-details"] summary').first().click().catch(() => {}); await p.waitForTimeout(1000); return {}; });
    const g = mgr['simple-customer-g585']; const u = mgr['simple-customer-usd'];
    const nums = (t) => (String(t).replace(/ /g, ' ').match(/[−-]?\$?\d[\d\s]*(?:[.,]\d+)?/g) || []).map(num);
    const gN = nums(g); const uN = nums(u);
    T('BM-UI-1', 'manager panel 585: net, gross debt, gross advance = database (sum(debt) - sum(advance)); wording matches the sign',
      Math.abs(gN[0] - lt.net) < 0.006 && Math.abs(gN[2] - lt.gd) < 0.006 && Math.abs(gN[3] - lt.ga) < 0.006 && (lt.net < 0 ? /Biz mijozlarga qarzdormiz/.test(g) : /bizga qarzdor|teng/.test(g)),
      { net: lt.net, debt: lt.gd, advance: lt.ga }, { text: g.replace(/\s+/g, ' '), parsed: gN });
    T('BM-UI-2', 'manager panel USD: own line, net = sum(debt) - sum(advance) in USD (never added to grams)',
      Math.abs(uN[0] - r2(usdT.net)) < 0.01 && /USD/.test(u), r2(usdT.net), { text: u.replace(/\s+/g, ' '), parsed: uN });
    T('BM-UI-3', 'no API error on the manager main screen', mgr.bad.length === 0, [], mgr.bad);
    const dir = await grab('director', '/sales/director', ['director-client-net', 'director-client-breakdown']);
    const dN = nums(dir['director-client-net']); const bN = nums(dir['director-client-breakdown']);
    T('BM-UI-4', 'director dashboard card: signed net + "qarz X - avans Y" = database', Math.abs(dN[0] - lt.net) < 0.006 && Math.abs(bN[0] - lt.gd) < 0.006 && Math.abs(bN[1] - lt.ga) < 0.006,
      { net: lt.net, debt: lt.gd, advance: lt.ga }, { net: dir['director-client-net'], breakdown: dir['director-client-breakdown'] });
    const hN = nums(mgr['home-client-net']); const hB = nums(mgr['home-client-breakdown']);
    T('BM-UI-5', 'main page card "Mijozlar Sof Nasiyasi": signed net = sum(debt) - sum(advance) (was: gross debt labelled "sof")',
      Math.abs(hN[0] - lt.net) < 0.006 && Math.abs(hB[0] - lt.gd) < 0.006 && Math.abs(hB[1] - lt.ga) < 0.006, { net: lt.net, debt: lt.gd, advance: lt.ga }, { net: mgr['home-client-net'], breakdown: mgr['home-client-breakdown'] });
    // monthly report tab: total + the row of G (advance larger than the debt) as "+7.00 g avans"
    const nameG = `BM82 G avans qarzdan katta ${run}`; const nameD = `BM82 D avans keyin sotuv ${run}`;
    const mon = await grab('director', '/sales/app/customers', ['mr-total-net', 'mr-total-breakdown'], async (p) => {
      await p.locator('button', { hasText: 'Oylik Hisobot' }).first().click(); await p.waitForTimeout(4000);
      const cell = async (n) => p.locator(`tr:has-text("${n}") [data-testid="mr-closing"]`).first().innerText().catch(() => '');
      return { rowG: await cell(nameG), rowD: await cell(nameD) };
    });
    const mN = nums(mon['mr-total-net']); const mB = nums(mon['mr-total-breakdown']);
    T('BM-UI-6', 'monthly report tab: total = server report (net, debt, advance); G row "+7.00 g avans" (was 2.00 g debt), D row 7.00 g (was 11.00 g)',
      Math.abs(mN[0] - r4(sm.total_closing_net_g)) < 0.006 && Math.abs(mB[0] - r4(sm.total_closing_debt_g)) < 0.006 && Math.abs(mB[1] - r4(sm.total_closing_advance_g)) < 0.006
        && /\+7\.00 g avans/.test(mon.rowG) && /^7\.00 g$/.test(mon.rowD.trim()) && mon.bad.length === 0,
      { net: r4(sm.total_closing_net_g), G: '+7.00 g avans', D: '7.00 g' }, { total: mon['mr-total-net'], breakdown: mon['mr-total-breakdown'], G: mon.rowG, D: mon.rowD, bad: mon.bad });
    await br.close();
  }
  fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, run, results: R }, null, 2));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
