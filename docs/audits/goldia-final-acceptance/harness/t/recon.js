// Independent reconciliation: recompute every balance from source documents and compare with stored balances/RPC output.
const { U, rpc, su, pool } = require('./lib');
const ORG = '00000000-0000-0000-0000-000000000001';
const r4 = (x) => Math.round(Number(x) * 10000) / 10000;
(async () => {
  const out = []; const chk = (name, expected, actual, tol = 0.0005) => { const ok = Math.abs(r4(expected) - r4(actual)) <= tol; out.push({ check: name, expected: r4(expected), actual: r4(actual), ok }); };
  const one = async (sql, p = []) => (await su(sql, p))[0];
  // 1. physical conservation
  const rc = await one(`select coalesce(sum(original_physical_g),0) o, coalesce(sum(available_physical_g),0) a from factory_receipts where organization_id=$1 and status<>'reversed'`, [ORG]);
  const held = await one(`select coalesce(sum(weight_grams),0) g from consignment_pieces where organization_id=$1 and status='held_by_seller'`, [ORG]);
  const sold = await one(`select coalesce(sum(base_weight_grams),0) g from jewelry_sales where organization_id=$1 and status not in ('reversed','cancelled')`, [ORG]);
  const rtf = await one(`select coalesce(sum(weight_grams),0) g from consignment_pieces where organization_id=$1 and status='returned_to_factory'`, [ORG]);
  const mgrFn = Number((await one(`select get_manager_available_stock_grams($1) g`, [ORG])).g);
  chk('PHYS: receipts = manager + seller-held pieces + sold + returned_to_factory', rc.o, mgrFn + Number(held.g) + Number(sold.g) + Number(rtf.g));
  // 2. per seller stock
  for (const s of await su(`select e.employee_code code, e.id, a.current_physical_stock_g st, a.total_seller_obligation_g obl, a.seller_legacy_debt_obligation_g leg, a.total_settled_to_manager_g stl, a.seller_owes_manager_g owes, a.manager_owes_seller_g mowes, a.seller_till_cash_amount tc, a.seller_till_usd_amount tu, a.seller_till_scrap_grams ts from seller_gold_accounts a join employees e on e.id=a.seller_id where a.organization_id=$1 order by 1`, [ORG])) {
    const hp = await one(`select coalesce(sum(weight_grams),0) g from consignment_pieces where seller_id=$1 and status='held_by_seller'`, [s.id]);
    chk(`STOCK ${s.code}: held pieces = stored stock`, hp.g, s.st);
    // obligation: what the seller still holds (pieces) + what was sold from their consignments, each at the consignment's seller markup
    const ob = await one(`select (select coalesce(sum(round(cp.weight_grams * (1 + sc.seller_markup_pct/100.0), 4)),0) from consignment_pieces cp join seller_consignments sc on sc.id=cp.consignment_id where cp.seller_id=$1 and cp.status='held_by_seller')
                              + (select coalesce(sum(round(js.base_weight_grams * (1 + coalesce(sc.seller_markup_pct, 0)/100.0), 4)),0) from jewelry_sales js left join seller_consignments sc on sc.id=js.consignment_id where js.seller_id=$1 and js.status not in ('reversed','cancelled')
                                   and not exists (select 1 from weight_sale_allocations w where w.sale_id=js.id and w.reversed_at is null))
                              + (select coalesce(sum(round(w.grams * (1 + sc.seller_markup_pct/100.0), 4)),0) from weight_sale_allocations w join jewelry_sales js on js.id=w.sale_id join seller_consignments sc on sc.id=w.consignment_id
                                   where js.seller_id=$1 and js.status not in ('reversed','cancelled') and w.reversed_at is null)
                              + (select coalesce(sum(round((js.base_weight_grams - a.g) * (1 + coalesce(sc.seller_markup_pct,0)/100.0), 4)),0) from jewelry_sales js left join seller_consignments sc on sc.id=js.consignment_id
                                   join (select sale_id, sum(grams) g from weight_sale_allocations where reversed_at is null group by 1) a on a.sale_id=js.id where js.seller_id=$1 and js.status not in ('reversed','cancelled')) g`, [s.id]);
    const leg = await one(`select coalesce(sum(delta_585_g),0) g from client_legacy_debts where seller_id=$1 and balance_type='debt' and status<>'reversed'`, [s.id]);
    chk(`OBLIG ${s.code}: (held pieces + sold) x (1+seller%) + legacy = stored obligation`, Number(ob.g) + Number(leg.g), s.obl, 0.002);
    const st = await one(`select coalesce(sum(total_settled_grams),0) g from gold_settlements where seller_id=$1 and direction in ('seller_to_manager','seller_to_factory') and coalesce(status,'confirmed') not in ('reversed','cancelled') and reversal_of_id is null`, [s.id]);
    chk(`OWES ${s.code}: obligation - handovers = owes - manager_owes`, Number(s.obl) - Number(st.g), Number(s.owes) - Number(s.mowes));
    const till = await one(`select coalesce(sum(case when direction='client_to_seller' then cash_paid_amount else -cash_paid_amount end),0) c,
                             coalesce(sum(case when direction='client_to_seller' then usd_paid_amount else -usd_paid_amount end),0) u,
                             coalesce(sum(case when direction='client_to_seller' then scrap_585_equiv_grams else -scrap_585_equiv_grams end),0) s
                            from gold_settlements where seller_id=$1 and coalesce(status,'confirmed') not in ('reversed','cancelled') and reversal_of_id is null`, [s.id]);
    chk(`TILL-UZS ${s.code}`, till.c, s.tc, 0.01); chk(`TILL-USD ${s.code}`, till.u, s.tu, 0.01); chk(`TILL-SCRAP ${s.code}`, till.s, s.ts);
  }
  // 3. customers: debt - advance = sales due + legacy - payments
  for (const c of await su(`select cu.customer_code code, cu.id, a.current_debt_grams d, a.advance_balance_grams adv from client_gold_accounts a join customers cu on cu.id=a.customer_id where a.organization_id=$1 order by 1`, [ORG])) {
    const sd = await one(`select coalesce(sum(client_gold_due_grams),0) g from jewelry_sales where customer_id=$1 and status not in ('reversed','cancelled')`, [c.id]);
    const lg = await one(`select coalesce(sum(delta_585_g),0) g from client_legacy_debts where customer_id=$1 and status<>'reversed'`, [c.id]);
    const pm = await one(`select coalesce(sum(total_settled_grams),0) g from gold_settlements where customer_id=$1 and direction='client_to_seller' and coalesce(status,'confirmed') not in ('reversed','cancelled') and reversal_of_id is null`, [c.id]);
    chk(`CUST ${c.code}: sales+legacy-payments = debt-advance`, Number(sd.g) + Number(lg.g) - Number(pm.g), Number(c.d) - Number(c.adv));
  }
  // 4. manager vault cash
  const v = await one(`select * from manager_vault_account where organization_id=$1`, [ORG]);
  const ho = await one(`select coalesce(sum(cash_paid_amount),0) c, coalesce(sum(usd_paid_amount),0) u, coalesce(sum(scrap_585_equiv_grams),0) s from gold_settlements where organization_id=$1 and direction='seller_to_manager' and coalesce(status,'confirmed') not in ('reversed','cancelled') and reversal_of_id is null`, [ORG]);
  const pu = await one(`select coalesce(sum(cash_spent_uzs),0) c, coalesce(sum(usd_spent),0) u, coalesce(sum(equiv_585_grams),0) g from gold_purchases where organization_id=$1 and status<>'reversed'`, [ORG]);
  const ft = await one(`select coalesce(sum(case when transaction_type='capital_contribution' then amount_num when transaction_type in ('capital_distribution','business_expense') then -amount_num end) filter (where source_till='manager_uzs'),0) c from financial_transactions where organization_id=$1 and status<>'reversed'`, [ORG]);
  chk('VAULT-UZS: handovers - purchases + capital - expenses', Number(ho.c) - Number(pu.c) + Number(ft.c), v.manager_cash_amount, 0.01);
  chk('VAULT-USD: handovers - purchases', Number(ho.u) - Number(pu.u), v.manager_usd_amount, 0.01);
  const rf = await one(`select coalesce(sum(input_585_equiv_grams),0) i, coalesce(sum(output_585_equiv_grams),0) o from refining_batches where organization_id=$1 and status='completed'`, [ORG]);
  const fh = await one(`select coalesce(sum(agreed_equivalent_g) filter (where source_type='refined_gold'),0) r, coalesce(sum(agreed_equivalent_g) filter (where source_type='purchased_gold'),0) p, coalesce(sum(agreed_equivalent_g),0) t from factory_gold_handovers where organization_id=$1 and status<>'reversed'`, [ORG]);
  chk('VAULT-SCRAP: handover scrap - refining input', Number(ho.s) - Number(rf.i), v.manager_scrap_grams);
  chk('VAULT-REFINED(585): refining output - refined handovers', Number(rf.o) - Number(fh.r), v.manager_refined_gold_grams);
  chk('VAULT-PURCHASED(585): purchases - purchased handovers', Number(pu.g) - Number(fh.p), v.manager_purchased_gold_grams);
  const fo = await one(`select coalesce(sum(factory_obligation_g),0) g from factory_receipts where organization_id=$1 and status<>'reversed'`, [ORG]);
  chk('FACTORY: receipts obligation - handovers = current obligation - advance', Number(fo.g) - Number(fh.t), Number(v.current_factory_obligation_g) - Number(v.current_factory_advance_g));
  chk('VAULT stored manager_physical_stock_g = canonical fn', mgrFn, v.manager_physical_stock_g);
  // 5. RPC summary vs stored
  const fr = await rpc(U.D, 'rpc_get_financial_reconciliation_summary', {});
  const cd = await one(`select coalesce(sum(current_debt_grams),0) g from client_gold_accounts where organization_id=$1`, [ORG]);
  chk('RPC recon summary client debt = Σ accounts', cd.g, fr.data.clients_summary.total_client_debt_grams);
  // 6. sale-level vs account-level debt
  const sl = await one(`select coalesce(sum(remaining_gold_grams),0) g from jewelry_sales where organization_id=$1 and status not in ('reversed','cancelled')`, [ORG]);
  const lgAll = await one(`select coalesce(sum(delta_585_g),0) g from client_legacy_debts where organization_id=$1 and status<>'reversed'`, [ORG]);
  const advAll = await one(`select coalesce(sum(advance_balance_grams),0) g from client_gold_accounts where organization_id=$1`, [ORG]);
  chk('INFO sale-level remaining + legacy = account debt - advance (sale rows are not updated by account-level payments)', Number(sl.g) + Number(lgAll.g), Number(cd.g) - Number(advAll.g), 1e9);
  console.table(out);
  const fails = out.filter(o => !o.ok); console.log('CHECKS', out.length, 'FAIL', fails.length);
  require('fs').writeFileSync(process.argv[2] || '/opt/goldia-audit/recon.json', JSON.stringify(out, null, 1));
  await pool.end();
})();
