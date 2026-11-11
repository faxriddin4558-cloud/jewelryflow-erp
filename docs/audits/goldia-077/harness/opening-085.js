// 085 controlled financial restart + opening accounting through the REAL frontend (real GoTrue logins).
// It RESTARTS the books of the synthetic audit organization only (customers / users kept). GA_TARGET=local by default;
// on staging it runs only with GA_ALLOW_RESTART=1 (synthetic organization, owner's approval).
//   OP-1  backup verification written by the service role (release tooling); a signed-in director cannot write one
//   OP-2  director UI: restart needs the typed confirmation; double click -> exactly one restart, one draft period
//   OP-3  identities kept: customers / phones / seller assignment / employees unchanged; balances zero
//   OP-4  manager UI: opening manager inventory 100 g @8 % (stock 100, factory 108), seller inventory 30 g from it @12 %
//   OP-5  manager UI: opening UZS debt 8 600 000 @ 860 000 -> customer UZS 8.6 M, seller obligation +10 g (snapshot)
//   OP-6  reconciliation all green; lock with the baseline; afterwards opening entry refused
//   OP-7  phone width 390 px: the page has no horizontal overflow
//   OP-8  after the opening: a normal weight sale from the opening seller stock works
const fs = require('fs'); const path = require('path');
const TARGET = process.env.GA_TARGET || 'local';
if (TARGET !== 'local' && process.env.GA_ALLOW_RESTART !== '1') { console.error('refused: set GA_ALLOW_RESTART=1 for a non-local target'); process.exit(2); }
const L = TARGET === 'staging' ? require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib') : require('/home/user/jewelryflow-erp/docs/audits/goldia-075-real-auth/harness/lib');
const OUT = process.env.GA_OUT || path.join(__dirname, '..', 'evidence', `${TARGET}-opening-085.json`);
const BASE = TARGET === 'staging' ? 'https://jewelryflow-sales-staging.vercel.app' : 'http://127.0.0.1:3300';
const N = (x) => Number(x || 0); const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const R = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 300)}`); };
(async () => {
  const { chromium } = require('/home/user/jewelryflow-erp/node_modules/playwright');
  const C = L.creds(); const run = Date.now().toString(36);
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy: TARGET === 'staging' && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const login = async (tag, vp = { width: 1366, height: 900 }) => {
    const c = C[tag]; const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 }); const p = await ctx.newPage(); const bad = [];
    p.on('response', (r) => { if (/supabase\.co|127\.0\.0\.1:54321/.test(r.url()) && r.status() >= 400) bad.push(r.status() + ' ' + (r.url().split('/rest/')[1] || r.url())); });
    await p.goto(BASE + '/sales/login', { waitUntil: 'networkidle' }); await p.fill('input[type="email"]', c.email); await p.fill('input[type="password"]', c.password);
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/sales/login'), { timeout: 45000 }).catch(() => {}), p.click('button[type="submit"]')]);
    await p.goto(BASE + '/sales/app/opening', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    return { ctx, p, bad };
  };
  const shot = (n) => path.join(path.dirname(OUT), `op85-${n}.png`);
  const idsOf = async () => JSON.stringify((await L.sel(`customers?organization_id=eq.${L.ORG}&select=id,contact_name,phone,seller_id&order=id`)))
    + JSON.stringify(await L.sel(`employees?organization_id=eq.${L.ORG}&select=id,user_id,role&order=id`));

  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: L.tashkentToday() });
  // OP-1
  const fake = await L.rpc('director', 'rpc_get_opening_state', {}); void fake;
  const denied = await L.uwrite('director', 'POST', 'financial_backup_verifications', { organization_id: L.ORG, backup_reference: 'fake', restore_verified: true });
  const bv = await L.svc('POST', 'rest/v1/financial_backup_verifications', { organization_id: L.ORG, backup_reference: `local-backup-${run}.dump`, restore_verified: true }, { Prefer: 'return=representation' });
  T('OP-1', 'backup verification: service role (release tooling) writes it; a signed-in director cannot', !denied.ok && bv.ok, 'service only', { director: denied.status, service: bv.status });
  const draftBefore = (await L.sel(`opening_periods?organization_id=eq.${L.ORG}&status=eq.draft&select=id`)).length;
  const ids0 = await idsOf();

  // OP-2 director restart through the UI (button disabled until the exact phrase is typed; double click)
  {
    const { ctx, p, bad } = await login('director');
    const panel = await p.locator('[data-testid="restart-panel"]').count();
    await p.fill('[data-testid="restart-t0"]', new Date(Date.now() + 5 * 3600e3 - 3600e3).toISOString().slice(0, 16));
    await p.fill('[data-testid="restart-reason"]', `OP85 sinov ${run}`);
    await p.selectOption('[data-testid="restart-backup"]', bv.ok ? bv.data[0].id : '');
    await p.fill('[data-testid="restart-confirm"]', 'moliyaviy hisobni qayta boshlash');
    const disabledWrong = await p.locator('[data-testid="restart-submit"]').isDisabled();
    await p.fill('[data-testid="restart-confirm"]', 'MOLIYAVIY HISOBNI QAYTA BOSHLASH');
    await p.locator('[data-testid="restart-submit"]').dblclick(); await p.waitForTimeout(5000);
    const status = await p.locator('[data-testid="opening-period"]').innerText().catch(() => '');
    await p.screenshot({ path: shot('director-restart') }).catch(() => {});
    await ctx.close();
    const restarts = await L.sel(`financial_restarts?organization_id=eq.${L.ORG}&reason=eq.${encodeURIComponent(`OP85 sinov ${run}`)}&select=id`);
    const drafts = await L.sel(`opening_periods?organization_id=eq.${L.ORG}&status=eq.draft&select=id`);
    T('OP-2', 'director UI: wrong phrase keeps the button disabled; exact phrase + double click -> exactly one restart and one draft period', panel === 1 && disabledWrong && restarts.length === 1 && drafts.length === 1 && draftBefore === 0 && /qoralama/.test(status) && bad.length === 0,
      { restarts: 1, drafts: 1 }, { panel, disabledWrong, restarts: restarts.length, drafts: drafts.length, draftBefore, status: status.slice(0, 80), bad });
  }
  // OP-3
  const ids1 = await idsOf();
  const acc = await L.sel(`seller_gold_accounts?organization_id=eq.${L.ORG}&select=current_physical_stock_g,seller_owes_manager_g,seller_till_cash_amount,seller_till_usd_amount`);
  const cg = await L.sel(`client_gold_accounts?organization_id=eq.${L.ORG}&select=current_debt_grams,advance_balance_grams`);
  const cc = await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&select=debt_amount,advance_amount`);
  const sum = (a, ks) => a.reduce((s, x) => s + ks.reduce((t, k) => t + Math.abs(N(x[k])), 0), 0);
  T('OP-3', 'identities kept (customers, phones, seller assignment, employees, logins); every balance zero', ids1 === ids0 && sum(acc, ['current_physical_stock_g', 'seller_owes_manager_g', 'seller_till_cash_amount', 'seller_till_usd_amount']) === 0
    && sum(cg, ['current_debt_grams', 'advance_balance_grams']) === 0 && sum(cc, ['debt_amount', 'advance_amount']) === 0, 'kept / 0', { idsSame: ids1 === ids0, sellers: sum(acc, ['current_physical_stock_g', 'seller_owes_manager_g']), cust: sum(cg, ['current_debt_grams']) });

  // OP-4 / OP-5 manager enters openings in the UI
  const cust = (await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `OP85 ${run}` })).data.customer_id;
  // OP-9 D-4: during the draft every ordinary financial write is refused BY THE DATABASE - direct RPC, parallel requests,
  // seller / manager / director alike (customers may still be created)
  {
    const calls = [];
    for (let i = 0; i < 4; i++) calls.push(L.rpc('sellera', 'rpc_record_client_legacy_debt', { p_customer_id: cust, p_balance_type: 'debt', p_amount_585_g: 1 + i, p_as_of_date: L.tashkentToday(), p_idempotency_key: `op85-leg-${run}-${i}` }));
    for (let i = 0; i < 3; i++) calls.push(L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cust, p_currency: 'USD', p_usd_amount: 10 + i, p_idempotency_key: `op85-cp-${run}-${i}` }));
    calls.push(L.rpc('manager', 'rpc_record_financial_transaction', { p_transaction_type: 'capital_contribution', p_source_till: 'manager_uzs', p_amount: 1000, p_currency: 'UZS', p_gold_rate: 900000, p_idempotency_key: `op85-cap-${run}` }));
    calls.push(L.rpc('director', 'rpc_record_factory_receipt', { p_product_name: 'x', p_original_physical_g: 1, p_factory_markup_pct: 8, p_idempotency_key: `op85-rc-${run}` }));
    calls.push(L.rpc('manager', 'rpc_execute_full_test_reset', { p_confirmation_code: 'RESET_TEST_ACCOUNT_2026', p_reason: 'bypass try' }));
    const res = await Promise.all(calls);
    const refused = res.filter((r) => !r.ok && /ERR_OPENING_DRAFT|ERR_USE_FINANCIAL_RESTART|Permission denied/.test(r.error)).length;
    const live = (await L.sel(`client_legacy_debts?organization_id=eq.${L.ORG}&status=neq.reversed&select=id`)).length
      + (await L.sel(`client_currency_settlements?organization_id=eq.${L.ORG}&status=neq.reversed&select=id`)).length;
    T('OP-9', 'D-4: 10 parallel direct RPC writes in the draft (seller legacy / currency payments, manager capital, director receipt, old reset) -> all refused, nothing written', refused === res.length && live === 0,
      { refused: res.length, live: 0 }, { refused, live, errors: [...new Set(res.map((r) => (r.error || 'OK').slice(0, 40)))] });
  }
  {
    const { ctx, p, bad } = await login('manager');
    const kind = async (k) => { await p.selectOption('[data-testid="opening-kind"]', k); await p.waitForTimeout(300); };
    const submit = async () => { await p.locator('[data-testid="opening-submit"]').dblclick(); await p.waitForTimeout(3500); };
    await kind('manager_inventory'); await p.fill('[data-testid="opening-physical"]', '100'); await p.fill('[data-testid="opening-factory-pct"]', '8'); await submit();
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    await kind('seller_inventory'); await p.selectOption('[data-testid="opening-seller"]', C.sellera.id); await p.fill('[data-testid="opening-pieces"]', '10 20');
    const src = await p.locator('[data-testid="opening-source"] option').nth(1).getAttribute('value'); await p.selectOption('[data-testid="opening-source"]', src);
    await p.fill('[data-testid="opening-seller-pct"]', '12'); await submit();
    await kind('customer_currency'); await p.waitForTimeout(800); await p.selectOption('[data-testid="opening-customer"]', cust);
    await p.selectOption('[data-testid="opening-unit"]', 'UZS'); await p.selectOption('[data-testid="opening-side"]', 'debt');
    await p.fill('[data-testid="opening-amount"]', '8600000'); await p.fill('[data-testid="opening-lom-rate"]', '860000'); await submit();
    await kind('manager_cash'); await p.selectOption('[data-testid="opening-unit"]', 'UZS'); await p.fill('[data-testid="opening-amount"]', '5000000'); await submit();
    const rows = await p.locator('[data-testid="opening-row"]').count();
    await p.screenshot({ path: shot('manager-openings'), fullPage: true }).catch(() => {});
    const checks = await p.locator('[data-testid="opening-reconciliation"] li').allInnerTexts();
    // OP-6 lock
    await p.fill('[data-testid="lock-usd-rate"]', '12500');
    await p.locator('[data-testid="lock-submit"]').dblclick(); await p.waitForTimeout(4500);
    const status = await p.locator('[data-testid="opening-period"]').innerText().catch(() => '');
    await ctx.close();
    const docs = await L.sel(`opening_documents?organization_id=eq.${L.ORG}&status=eq.active&select=kind,amount,seller_obligation_g,factory_obligation_g,lom_rate`);
    const mstock = N((await L.rpc('manager', 'rpc_get_opening_state', {})).data.totals.manager_stock_g);
    const sa = (await L.sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=current_physical_stock_g,seller_owes_manager_g`))[0];
    const vault = (await L.sel(`manager_vault_account?organization_id=eq.${L.ORG}&select=current_factory_obligation_g,manager_cash_amount`))[0];
    const uzs = (await L.sel(`client_currency_accounts?customer_id=eq.${cust}&currency=eq.UZS&select=debt_amount`))[0] || {};
    T('OP-4', 'manager UI (double clicks): 4 documents once each; manager stock 100 - 30 = 70, factory 108, seller A stock 30', docs.length === 4 && rows === 4 && mstock === 70 && N(vault.current_factory_obligation_g) === 108 && N(sa.current_physical_stock_g) === 30 && bad.length === 0,
      { docs: 4, mstock: 70, factory: 108, sellerStock: 30 }, { docs: docs.length, rows, mstock, factory: vault.current_factory_obligation_g, sellerStock: sa.current_physical_stock_g, bad });
    T('OP-5', 'opening UZS debt 8 600 000 @ 860 000: customer UZS debt 8.6 M, seller obligation 33.6 + 10 = 43.6 g (snapshot 860 000 stored)',
      N(uzs.debt_amount) === 8600000 && r4(sa.seller_owes_manager_g) === 43.6 && docs.some((d) => d.kind === 'customer_currency' && N(d.seller_obligation_g) === 10 && N(d.lom_rate) === 860000),
      { uzs: 8600000, owes: 43.6 }, { uzs: uzs.debt_amount, owes: sa.seller_owes_manager_g });
    const after = await L.rpc('manager', 'rpc_record_opening_document', { p_kind: 'manager_cash', p_unit: 'UZS', p_amount: 1, p_idempotency_key: `op85-late-${run}` });
    const per = (await L.sel(`opening_periods?organization_id=eq.${L.ORG}&order=created_at.desc&limit=1&select=status,baseline_id`))[0];
    T('OP-6', 'reconciliation all green, lock via the baseline (double click once): period locked; a later opening entry is refused',
      checks.length === 8 && checks.every((x) => x.startsWith('✅')) && per.status === 'locked' && !!per.baseline_id && /qulflangan/.test(status) && !after.ok && /ERR_OPENING_LOCKED/.test(after.error),
      'locked', { checks, period: per, after: after.error });
  }
  // OP-7 phone width
  {
    const { ctx, p } = await login('manager', { width: 390, height: 844 });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.screenshot({ path: shot('manager-390') }).catch(() => {});
    await ctx.close();
    T('OP-7', 'opening page on a 390 px phone: no horizontal page overflow', overflow <= 0, 0, overflow);
  }
  // OP-8
  const sale = await L.rpc('sellera', 'rpc_record_weight_sale', { p_customer_id: cust, p_seller_id: C.sellera.id, p_weight_grams: 5, p_client_markup_pct: 10, p_idempotency_key: `op85-s-${run}` });
  const sa2 = (await L.sel(`seller_gold_accounts?seller_id=eq.${C.sellera.id}&select=current_physical_stock_g,seller_owes_manager_g`))[0];
  T('OP-8', 'after the opening: weight sale 5 g from the opening seller stock -> stock 25, obligation unchanged 43.6', sale.ok && r4(sa2.current_physical_stock_g) === 25 && r4(sa2.seller_owes_manager_g) === 43.6,
    { stock: 25, owes: 43.6 }, sale.ok ? sa2 : sale.error);
  // OP-10 race: a restart and 10 parallel ordinary writes at the same moment -> the restart serializes with them; afterwards
  // nothing ordinary is live in the new draft (each write either finished before and was archived, or was refused)
  {
    const bv2 = await L.svc('POST', 'rest/v1/financial_backup_verifications', { organization_id: L.ORG, backup_reference: `local-backup-${run}-2.dump`, restore_verified: true }, { Prefer: 'return=representation' });
    const writes = [];
    for (let i = 0; i < 6; i++) writes.push(L.rpc('sellera', 'rpc_record_client_legacy_debt', { p_customer_id: cust, p_balance_type: 'debt', p_amount_585_g: 2 + i, p_as_of_date: L.tashkentToday(), p_idempotency_key: `op85-race-leg-${run}-${i}` }));
    for (let i = 0; i < 4; i++) writes.push(L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: cust, p_currency: 'USD', p_usd_amount: 5 + i, p_idempotency_key: `op85-race-cp-${run}-${i}` }));
    const rs = L.rpc('director', 'rpc_financial_restart', { p_confirmation: 'MOLIYAVIY HISOBNI QAYTA BOSHLASH', p_reason: `OP85 race ${run}`, p_t0: new Date().toISOString(), p_backup_verification_id: bv2.data[0].id, p_idempotency_key: `op85-race-${run}` });
    const all = await Promise.all([rs, ...writes]);
    const restart = all[0]; const w = all.slice(1);
    const okOrRefused = w.every((r) => r.ok || /ERR_OPENING_DRAFT/.test(r.error));
    const live = (await L.sel(`client_legacy_debts?organization_id=eq.${L.ORG}&status=neq.reversed&select=id`)).length
      + (await L.sel(`client_currency_settlements?organization_id=eq.${L.ORG}&status=neq.reversed&select=id`)).length;
    const st = (await L.rpc('manager', 'rpc_get_opening_state', {})).data;
    T('OP-10', 'race: restart + 10 parallel writes -> restart ok, every write either archived (before) or refused (after), nothing live in the draft, reconciliation counts 0',
      restart.ok && okOrRefused && live === 0 && st.checks.non_opening_documents_after_restart === 0,
      { restart: 'ok', live: 0 }, { restart: restart.ok || restart.error, accepted: w.filter((r) => r.ok).length, refused: w.filter((r) => !r.ok).length, live, other: w.filter((r) => !r.ok && !/ERR_OPENING_DRAFT/.test(r.error)).map((r) => r.error) });
  }
  await br.close();
  fs.writeFileSync(OUT, JSON.stringify({ target: TARGET, run, results: R }, null, 2));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
  process.exit(R.every((x) => x.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
