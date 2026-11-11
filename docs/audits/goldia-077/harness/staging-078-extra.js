// REAL STAGING 078 - what ui-078-archive.js does not cover (synthetic audit organizations A / B only; real GoTrue JWTs
// through PostgREST; ground truth = service-role reads):
//   AR-*  archive keeps EVERY balance and history row (585 legacy debt, UZS debt, USD advance, sales, currency and gram
//         payments, legacy rows) byte-identical; 8 parallel archive calls -> exactly one operation; the archived customer
//         stays in the ledgers and the period report and its debts are still collectible (gram + UZS) and reversible
//   BY-*  direct PostgREST bypass attempts (other seller, unassigned, seller_id hijack, DELETE, worker, other org)
//   PR-*  period close / reopen latest / older refused / repeat idempotent / re-close; stored history kept; no balance moves
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const L = require('/home/user/jewelryflow-erp/docs/audits/goldia-075-staging/harness/lib');
const OUT = path.join(__dirname, '..', 'evidence', 'staging-078-extra.json');
const N = Number; const r2 = (x) => Math.round(N(x) * 100) / 100; const r4 = (x) => Math.round(N(x) * 1e4) / 1e4;
const R = []; const OPS = [];
const T = (id, title, ok, exp, act) => { R.push({ id, title, ok: !!ok, expected: exp, actual: act, at: new Date().toISOString() }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} | exp=${JSON.stringify(exp)} act=${JSON.stringify(act).slice(0, 320)}`); };
const op = (kind, r, extra = {}) => { OPS.push({ at: new Date().toISOString(), kind, ok: r.ok, error: r.ok ? undefined : (r.error || '').slice(0, 160), data: r.ok ? r.data : undefined, ...extra }); return r; };
const md5 = (x) => crypto.createHash('md5').update(JSON.stringify(x)).digest('hex');
const gold = async (c) => { const a = (await L.sel(`client_gold_accounts?customer_id=eq.${c}&select=d:current_debt_grams,a:advance_balance_grams`))[0]; return { d: a ? r4(a.d) : 0, a: a ? r4(a.a) : 0 }; };
const cur = async (c, k) => { const a = (await L.sel(`client_currency_accounts?customer_id=eq.${c}&currency=eq.${k}&select=d:debt_amount,a:advance_amount`))[0]; return { d: a ? r2(a.d) : 0, a: a ? r2(a.a) : 0 }; };
// every row that makes up the customer's money history (ordered, full rows) -> one fingerprint
const history = async (c) => {
  const q = async (t, order = 'id') => L.sel(`${t}?customer_id=eq.${c}&order=${order}.asc&select=*`);
  const rows = { sales: await q('jewelry_sales'), cur_pay: await q('client_currency_settlements'), gold_pay: await q('gold_settlements'), legacy: await q('client_legacy_debts'),
    gold_acc: await q('client_gold_accounts', 'customer_id'), cur_acc: await q('client_currency_accounts', 'currency') };
  // the account rows carry an updated_at that a READ-ONLY ledger refresh may touch; compare balances only
  rows.gold_acc = rows.gold_acc.map((x) => ({ d: x.current_debt_grams, a: x.advance_balance_grams }));
  rows.cur_acc = rows.cur_acc.map((x) => ({ k: x.currency, d: x.debt_amount, a: x.advance_amount }));
  return { counts: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])), hash: md5(rows) };
};
const orgBalances = async (org) => {
  const v = (await L.sel(`manager_vault_account?organization_id=eq.${org}&select=*`))[0] || {};
  const s = await L.sel(`seller_gold_accounts?organization_id=eq.${org}&order=seller_id.asc&select=seller_id,current_physical_stock_g,total_seller_obligation_g,seller_till_cash_amount,seller_till_usd_amount,seller_till_scrap_grams`);
  const g = await L.sel(`client_gold_accounts?organization_id=eq.${org}&order=customer_id.asc&select=customer_id,current_debt_grams,advance_balance_grams`);
  const c = await L.sel(`client_currency_accounts?organization_id=eq.${org}&order=customer_id.asc,currency.asc&select=customer_id,currency,debt_amount,advance_amount`);
  return md5({ v: { c: v.manager_cash_amount, u: v.manager_usd_amount, s: v.manager_physical_stock_g, o: v.current_factory_obligation_g }, s, g, c });
};
const yesterday = (d) => new Date(Date.parse(d + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);

(async () => {
  const C = L.creds(); const run = Date.now().toString(36); const today = L.tashkentToday();
  // ---------------- setup: customer X of seller A with every kind of balance ----------------
  await L.rpc('director', 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000, p_rate_date: today });
  const rc = op('receipt', await L.rpc('manager', 'rpc_record_factory_receipt', { p_product_name: `X78 ${run}`, p_original_physical_g: 15, p_factory_markup_pct: 8 }));
  op('consignment', await L.rpc('manager', 'rpc_issue_barcode_consignment', { p_seller_id: C.sellera.id, p_factory_markup_pct: 8, p_seller_markup_pct: 10, p_factory_receipt_id: rc.data.receipt_id, p_pieces: [{ weight_grams: 5 }, { weight_grams: 5 }, { weight_grams: 5 }] }));
  await L.rpc('sellera', 'rpc_set_my_seller_rates', { p_lom_rate_uzs: 900000, p_usd_rate_uzs: 12500, p_reason: 'x78' });
  const X = op('customer', await L.rpc('sellera', 'rpc_create_customer_with_code', { p_contact_name: `X78 Arxiv ${run}` })).data.customer_id;
  const steps = [
    ['legacy 20 g', 'rpc_record_client_legacy_debt', { p_customer_id: X, p_balance_type: 'debt', p_amount_585_g: 20, p_as_of_date: today, p_notes: 'X78', p_entry_type: 'manual_addition', p_target_final_balance: null, p_idempotency_key: `x78l-${run}` }],
    ['UZS sale 2 g / 2 500 000', 'rpc_record_currency_sale', { p_customer_id: X, p_currency: 'UZS', p_amount: 2500000, p_weight_grams: 2, p_idempotency_key: `x78s1-${run}` }],
    ['USD sale 3 g / $600', 'rpc_record_currency_sale', { p_customer_id: X, p_currency: 'USD', p_amount: 600, p_weight_grams: 3, p_idempotency_key: `x78s2-${run}` }],
    ['USD pay $700 (-> $100 advance)', 'rpc_record_client_currency_settlement', { p_customer_id: X, p_currency: 'USD', p_usd_amount: 700, p_idempotency_key: `x78p1-${run}` }],
    ['UZS pay 500 000', 'rpc_record_client_currency_settlement', { p_customer_id: X, p_currency: 'UZS', p_cash_uzs: 500000, p_idempotency_key: `x78p2-${run}` }],
    ['gram debt cash 900 000 (1 g)', 'rpc_record_client_settlement', { p_customer_id: X, p_cash_amount: 900000, p_rate_per_gram: 900000 }],
  ];
  for (const [label, fn, args] of steps) { const r = op(label, await L.rpc('sellera', fn, args)); if (!r.ok) throw new Error(`${label}: ${r.error}`); }
  const g0 = await gold(X), u0 = await cur(X, 'UZS'), d0 = await cur(X, 'USD'); const h0 = await history(X);
  T('AR-00', 'setup: 585 debt 19 g, UZS debt 2 000 000, USD debt 0 + advance $100, 2 sales, 2 currency + 1 gram payment, 1 legacy row',
    g0.d === 19 && u0.d === 2000000 && d0.d === 0 && d0.a === 100 && h0.counts.sales === 2 && h0.counts.cur_pay === 2 && h0.counts.gold_pay >= 1 && h0.counts.legacy === 1,
    { g: 19, uzs: 2000000, usd: [0, 100] }, { g0, u0, d0, counts: h0.counts });

  // ---------------- AR: archive (8 parallel calls) keeps everything ----------------
  const auditsOf = async () => (await L.sel(`audit_logs?table_name=eq.customers&record_id=eq.${X}&action=eq.ARCHIVE_CUSTOMER&select=id,new_data`));
  const par = await Promise.all(Array.from({ length: 8 }, () => L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: X, p_archive: true })));
  const changed = par.filter((r) => r.ok && r.data.changed === true).length; const okAll = par.every((r) => r.ok); const a1 = await auditsOf();
  OPS.push({ kind: 'archive x8 parallel', results: par.map((r) => (r.ok ? `ok changed=${r.data.changed}` : r.error)) });
  T('AR-01', '8 parallel archive calls by the seller: all ok, exactly one changed the row, one audit row', okAll && changed === 1 && a1.length === 1, { ok: 8, changed: 1, audits: 1 }, { ok: par.filter((r) => r.ok).length, changed, audits: a1.length });
  const ob = a1[0]?.new_data?.open_balances || {};
  T('AR-02', 'audit row records the open balances at archive time (19 g, 2 000 000 UZS, $100 advance)', N(ob.debt_g585) === 19 && N(ob.debt_uzs) === 2000000 && N(ob.advance_usd) === 100, { g: 19, uzs: 2000000, adv_usd: 100 }, ob);
  const h1 = await history(X);
  T('AR-03', 'archive changed NO money row: sales, currency / gram payments, legacy rows and all balances identical (fingerprint)', h1.hash === h0.hash, h0, h1);
  // ---------------- still in the ledgers / report ----------------
  const lm = op('ledger manager', await L.rpc('manager', 'rpc_get_unified_customer_ledger', {}));
  const ls = op('ledger seller', await L.rpc('sellera', 'rpc_get_unified_customer_ledger', {}));
  const inL = (r) => (r.ok && (r.data?.items || []).find((i) => i.customer_id === X)) || null;
  T('AR-04', 'archived customer still in the unified ledger (manager and own seller) with its 19 g debt', inL(lm) && inL(ls) && r4(inL(lm).net_debt_g) === 19, 19, { manager: inL(lm)?.net_debt_g, seller: inL(ls)?.net_debt_g });
  const rep = op('period report', await L.rpc('manager', 'rpc_get_period_report', { p_from: today, p_to: today }));
  const liveUzs = r2((await L.sel(`client_currency_accounts?organization_id=eq.${L.ORG}&currency=eq.UZS&select=d:debt_amount,a:advance_amount`)).reduce((s, x) => s + N(x.d) - N(x.a), 0));
  const liveG = r4((await L.sel(`client_gold_accounts?organization_id=eq.${L.ORG}&select=d:current_debt_grams,a:advance_balance_grams`)).reduce((s, x) => s + N(x.d) - N(x.a), 0));
  T('AR-05', 'period report closing (customer 585 g / UZS) = live balances including the archived customer', rep.ok && r2(rep.data.closing.customer_debt_net_uzs) === liveUzs && r4(rep.data.closing.customer_debt_net_g585) === liveG, { uzs: liveUzs, g: liveG }, rep.ok ? { uzs: rep.data.closing.customer_debt_net_uzs, g: rep.data.closing.customer_debt_net_g585 } : rep.error);
  // ---------------- collectible and reversible while archived ----------------
  const pg = op('gram payment while archived', await L.rpc('sellera', 'rpc_record_client_settlement', { p_customer_id: X, p_cash_amount: 1800000, p_rate_per_gram: 900000 }));
  const pu = op('UZS payment while archived', await L.rpc('sellera', 'rpc_record_client_currency_settlement', { p_customer_id: X, p_currency: 'UZS', p_cash_uzs: 1000000, p_idempotency_key: `x78p3-${run}` }));
  const g2 = await gold(X), u2 = await cur(X, 'UZS');
  T('AR-06', 'archived customer pays: 1 800 000 so\'m -> 585 debt 19 -> 17 g; 1 000 000 so\'m -> UZS debt 1 000 000', pg.ok && pu.ok && g2.d === 17 && u2.d === 1000000, { g: 17, uzs: 1000000 }, { g2, u2, e: [pg.error, pu.error] });
  const sid = (await L.sel(`client_currency_settlements?customer_id=eq.${X}&idempotency_key=eq.x78p3-${run}&select=id`))[0]?.id;
  const rv = op('manager reverses archived customer payment', await L.rpc('manager', 'rpc_reverse_client_currency_settlement', { p_settlement_id: sid, p_reason: 'X78 test' }));
  T('AR-07', 'manager reverses that UZS payment of the archived customer -> UZS debt back to 2 000 000', rv.ok && (await cur(X, 'UZS')).d === 2000000, 2000000, { ok: rv.ok, err: rv.error, uzs: (await cur(X, 'UZS')).d });
  const stillArch = (await L.sel(`customers?id=eq.${X}&select=is_archived`))[0].is_archived;
  T('AR-08', 'customer stays archived through payments / reversals (no silent restore)', stillArch === true, true, stillArch);

  // ---------------- BY: direct API bypass attempts ----------------
  const Y = (await L.rpc('sellerb', 'rpc_create_customer_with_code', { p_contact_name: `X78 SellerB ${run}` })).data.customer_id;
  const F = (await L.svc('POST', 'rest/v1/customers', { organization_id: L.ORG, contact_name: `X78 Free ${run}`, customer_code: `X78F-${run}`.slice(0, 16), seller_id: null }, { Prefer: 'return=representation' })).data[0].id;
  const st = async (id) => (await L.sel(`customers?id=eq.${id}&select=is_archived,archived_at,archived_by,seller_id`))[0];
  const y0 = await st(Y), f0 = await st(F), x0 = await st(X);
  const by = {
    otherPatchArch: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${Y}`, { is_archived: true }),
    otherPatchAt: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${Y}`, { archived_at: new Date().toISOString() }),
    freePatchBy: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${F}`, { archived_by: C.sellera.id }),
    freePatchArch: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${F}`, { is_archived: true }),
    hijack: await L.uwrite('sellera', 'PATCH', `customers?id=eq.${X}`, { is_archived: false, seller_id: C.sellerb.id }),
    delOwn: await L.uwrite('sellera', 'DELETE', `customers?id=eq.${X}`),
    delOther: await L.uwrite('sellera', 'DELETE', `customers?id=eq.${Y}`),
    workerRpc: await L.rpc('worker', 'rpc_archive_customer', { p_customer_id: Y, p_archive: true }),
    orgBRpc: await L.rpc((process.env.GA_OTHER_DIRECTOR || 'directorB'), 'rpc_archive_customer', { p_customer_id: X, p_archive: false }),
    orgBPatch: await L.uwrite((process.env.GA_OTHER_DIRECTOR || 'directorB'), 'PATCH', `customers?id=eq.${X}`, { is_archived: false }),
    sellerBRestoreA: await L.rpc('sellerb', 'rpc_archive_customer', { p_customer_id: X, p_archive: false }),
  };
  const empty = (r) => r.ok && Array.isArray(r.data) && r.data.length === 0;
  const refused = (r) => !r.ok;
  const verdict = {
    otherPatchArch: empty(by.otherPatchArch), otherPatchAt: empty(by.otherPatchAt), freePatchBy: refused(by.freePatchBy), freePatchArch: refused(by.freePatchArch),
    hijack: refused(by.hijack) || empty(by.hijack), delOwn: refused(by.delOwn) || empty(by.delOwn), delOther: empty(by.delOther) || refused(by.delOther),
    workerRpc: refused(by.workerRpc), orgBRpc: refused(by.orgBRpc) && /topilmadi/.test(by.orgBRpc.error || ''), orgBPatch: empty(by.orgBPatch), sellerBRestoreA: refused(by.sellerBRestoreA),
  };
  const y1 = await st(Y), f1 = await st(F), x1 = await st(X);
  OPS.push({ kind: 'bypass attempts', results: Object.fromEntries(Object.entries(by).map(([k, r]) => [k, r.ok ? `ok rows=${Array.isArray(r.data) ? r.data.length : '-'}` : (r.error || '').slice(0, 100)])) });
  T('BY-01', 'every direct bypass refused / matched 0 rows (other seller PATCH, unassigned PATCH, seller_id hijack, DELETE own / other, worker, other org RPC + PATCH, other seller restore)',
    Object.values(verdict).every(Boolean), 'all true', verdict);
  T('BY-02', 'no row changed by the attempts (other seller, unassigned, archived customer X still archived and assigned to seller A)',
    JSON.stringify(y0) === JSON.stringify(y1) && JSON.stringify(f0) === JSON.stringify(f1) && JSON.stringify(x0) === JSON.stringify(x1) && x1.is_archived && x1.seller_id === C.sellera.id, 'unchanged', { y1, f1, x1 });
  T('BY-03', 'archived customer X history still intact after the bypass attempts (DELETE refused)', (await L.sel(`customers?id=eq.${X}&select=id`)).length === 1 && (await history(X)).counts.sales === 2, { exists: true, sales: 2 }, (await history(X)).counts);
  // seller restores X with the RPC; repeat is a no-op
  const rs1 = await L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: X, p_archive: false }); const rs2 = await L.rpc('sellera', 'rpc_archive_customer', { p_customer_id: X, p_archive: false });
  T('BY-04', 'seller restores X; repeated restore = ok, changed false; balances still 17 g / 2 000 000 UZS / $100 advance',
    rs1.ok && rs1.data.changed === true && rs2.ok && rs2.data.changed === false && (await gold(X)).d === 17 && (await cur(X, 'UZS')).d === 2000000 && (await cur(X, 'USD')).a === 100, true, { rs1: rs1.data || rs1.error, rs2: rs2.data || rs2.error });

  // ---------------- PR: period close / reopen ----------------
  const periods = async () => L.sel(`goldia_report_periods?organization_id=eq.${L.ORG}&order=period_end.asc&select=id,period_start,period_end`);
  const p0 = await periods(); const bal0 = await orgBalances(L.ORG); const end = yesterday(today);
  const cl = op('close period', await L.rpc('manager', 'rpc_close_report_period', { p_end: end }));
  const p1 = await periods(); const latest = p1[p1.length - 1];
  T('PR-01', `manager closes the period up to ${end}; stored after the earlier periods; no balance moved`, cl.ok && latest.period_end === end && p1.length === p0.length + (cl.data.already_closed ? 0 : 1) && (await orgBalances(L.ORG)) === bal0,
    { end, balances: 'unchanged' }, { r: cl.data || cl.error, before: p0.map((p) => `${p.period_start}..${p.period_end}`), after: p1.map((p) => `${p.period_start}..${p.period_end}`) });
  const older = p1.length > 1 ? p1[p1.length - 2] : null;
  const roOld = older ? await L.rpc('manager', 'rpc_reopen_report_period', { p_period_id: older.id }) : { ok: false, error: 'no older period' };
  const roSeller = await L.rpc('sellera', 'rpc_reopen_report_period', { p_period_id: latest.id });
  const roOrgB = await L.rpc((process.env.GA_OTHER_MANAGER || 'managerB'), 'rpc_reopen_report_period', { p_period_id: latest.id });
  const p2 = await periods();
  T('PR-02', 'reopen refused for an older period, for a seller; other organization gets changed=false; nothing removed',
    !roOld.ok && /oxirgi/.test(roOld.error || '') && !roSeller.ok && roOrgB.ok && roOrgB.data.changed === false && p2.length === p1.length, 'refused / no-op',
    { old: (roOld.error || '').slice(0, 80), seller: (roSeller.error || '').slice(0, 60), orgB: roOrgB.data || roOrgB.error, n: p2.length });
  const ro1 = op('reopen latest', await L.rpc('director', 'rpc_reopen_report_period', { p_period_id: latest.id, p_reason: 'X78 test' }));
  const ro2 = await L.rpc('manager', 'rpc_reopen_report_period', { p_period_id: latest.id });
  const p3 = await periods(); const aud = await L.sel(`audit_logs?table_name=eq.goldia_report_periods&record_id=eq.${latest.id}&action=eq.REOPEN_REPORT_PERIOD&select=old_data`);
  T('PR-03', 'director reopens the latest period (manager repeat = changed false); earlier periods kept; frozen report kept in the audit log; balances unchanged',
    ro1.ok && ro1.data.changed === true && ro2.ok && ro2.data.changed === false && p3.length === p1.length - 1 && p3.every((p) => p0.some((q) => q.id === p.id)) && aud.length === 1 && aud[0].old_data?.report && (await orgBalances(L.ORG)) === bal0,
    { removed: 1, kept: p0.length, audit: 1 }, { ro1: ro1.data || ro1.error, ro2: ro2.data || ro2.error, n: p3.length, audit: aud.length });
  const cl2 = op('close again', await L.rpc('manager', 'rpc_close_report_period', { p_end: end }));
  const p4 = await periods();
  T('PR-04', 'the same period can be closed again after reopening; balances unchanged', cl2.ok && p4[p4.length - 1].period_end === end && (await orgBalances(L.ORG)) === bal0, end, { r: cl2.data || cl2.error });

  fs.writeFileSync(OUT, JSON.stringify({ target: 'staging', run, ids: { X, Y, F }, results: R, ops: OPS }, null, 1));
  console.log(`TOTAL ${R.filter((x) => x.ok).length}/${R.length} -> ${OUT}`);
})().catch((e) => { console.error('FATAL', e); fs.writeFileSync(OUT, JSON.stringify({ fatal: String(e), results: R, ops: OPS }, null, 1)); process.exit(1); });
