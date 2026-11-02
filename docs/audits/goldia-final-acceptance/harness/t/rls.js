// Visibility matrix: what each identity can SELECT directly (PostgREST /rest/v1/<table>), with RLS.
const { U, req, su, pool } = require('./lib');
(async () => {
  const tables = ['factory_receipts','manager_vault_account','seller_consignments','consignment_pieces','jewelry_sales','gold_settlements','seller_gold_accounts','client_gold_accounts','customers','employees','gold_purchases','refining_batches','factory_gold_handovers','financial_transactions','company_rate_differences','client_legacy_debts','daily_gold_rates','idempotency_keys','audit_logs','accounting_baselines','weight_sale_allocations','organizations','sales_login_audit_logs'];
  const ids = { DIR: U.D, MGR: U.M, SA: U.SA, SB: U.SB, INACT: U.SX, NOEMP: U.NOEMP, NOORG: U.NOORG, ORGB_DIR: U.DB, ANON: null };
  const totals = {};
  for (const t of tables) totals[t] = (await su(`select count(*)::int c from public.${t}`))[0].c;
  const rows = [];
  for (const t of tables) {
    const row = { table: t, total: totals[t] };
    for (const [k, uid] of Object.entries(ids)) {
      let sellerCol = '';
      const r = await req(uid, `select count(*)::int c ${['jewelry_sales','consignment_pieces','seller_gold_accounts','gold_settlements','seller_consignments','client_gold_accounts'].includes(t) ? `, count(*) filter (where seller_id is distinct from '${uid}')::int foreign` : ''} from public.${t}`);
      row[k] = r.ok ? (r.rows[0].foreign !== undefined ? `${r.rows[0].c}(${r.rows[0].foreign} other)` : String(r.rows[0].c)) : 'DENY';
    }
    rows.push(row);
  }
  console.table(rows);
  require('fs').writeFileSync('/opt/goldia-audit/rls-matrix.json', JSON.stringify(rows, null, 1));
  await pool.end();
})();
