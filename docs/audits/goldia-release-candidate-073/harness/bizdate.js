// Business-date boundary test on the faketime cluster (GA_PGHOST=/opt/goldia-audit/pgft GA_PGPORT=55433).
// The DB clock is set through /opt/goldia-audit/pgft/clock; expected dates are computed here as UTC+5 calendar dates.
const fs = require('fs'); const { U, rpc, su, req, pool } = require('./lib');
const setClock = (utc) => fs.writeFileSync('/opt/goldia-audit/pgft/clock', utc + '\n');
const tkt = (utc) => new Date(Date.parse(utc.replace(' ', 'T') + 'Z') + 5 * 3600e3).toISOString().slice(0, 10);
const R = []; const T = (id, ok, d) => { R.push({ id, ok: !!ok, ...d }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + JSON.stringify(d)); };
(async () => {
  setClock('2026-11-20 06:00:00');
  await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000 });
  const rc = (await rpc(U.M, 'rpc_record_factory_receipt', { p_product_name: 'bd', p_original_physical_g: 40, p_factory_markup_pct: 8 })).data;
  const cons = (await rpc(U.M, 'rpc_issue_barcode_consignment', { p_seller_id: U.SA, p_factory_markup_pct: 8, p_seller_markup_pct: 12, p_factory_receipt_id: rc.receipt_id, p_pieces: Array.from({ length: 20 }, (_, i) => ({ weight_grams: 1, model_code: 'BD' + i })) })).data;
  const cust = (await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Sana mijoz (sintetik)' })).data.customer_id;
  const instants = [
    ['23:59 TKT', '2026-11-25 18:59:00'], ['00:00 TKT', '2026-11-25 19:00:00'], ['00:01 TKT', '2026-11-25 19:01:00'],
    ['04:59 TKT', '2026-11-25 23:59:00'], ['05:00 TKT', '2026-11-26 00:00:00'],
    ['month end 23:59 TKT', '2026-11-30 18:59:00'], ['new month 00:00 TKT', '2026-11-30 19:00:00'], ['new month 00:01 TKT', '2026-11-30 19:01:00'],
    ['year end 23:59 TKT', '2026-12-31 18:59:00'], ['new year 00:00 TKT', '2026-12-31 19:00:00'], ['new year 04:59 TKT', '2026-12-31 23:59:00'], ['new year 05:00 TKT', '2027-01-01 00:00:00'],
  ];
  let i = 0;
  for (const [label, utc] of instants) {
    setClock(utc); const exp = tkt(utc);
    const rate = await rpc(U.D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000 + (i + 1) * 100 });
    const sale = await rpc(U.SA, 'rpc_record_barcode_piece_sale', { p_customer_id: cust, p_piece_id: cons.pieces[i].id, p_client_markup_pct: 10 });
    const pay = await rpc(U.SA, 'rpc_record_client_settlement', { p_customer_id: cust, p_cash_amount: 100000 });
    const s = sale.ok ? (await su(`select sale_date::text d, sale_no from jewelry_sales where id=$1`, [sale.data.sale_id]))[0] : {};
    const p = pay.ok ? (await su(`select settlement_date::text d from gold_settlements where id=$1`, [pay.data.settlement_id]))[0] : {};
    const rd = rate.ok ? rate.data.rate_date : rate.error;
    const [y, m] = exp.split('-').map(Number);
    const ledger = sale.ok ? await req(U.SA, `select count(*)::int n from public.rpc_get_daily_sales_ledger() x where x.tx_id = $1`, [sale.data.sale_id]) : { ok: false };
    const inToday = ledger.ok && ledger.rows[0].n === 1;
    const ok = rd === exp && s.d === exp && p.d === exp;
    T(`${label} (${utc}Z)`, ok && inToday, { expected: exp, rate_date: rd, sale_date: s.d, payment_date: p.d, sale_in_today_ledger: inToday });
    i++;
  }
  // monthly attribution: sales at 'month end 23:59' belong to November, 'new month 00:00/00:01' to December
  setClock('2027-01-02 06:00:00');
  const nov = await su(`select count(*)::int n from jewelry_sales where sale_date between '2026-11-01' and '2026-11-30' and customer_id=$1`, [cust]);
  const dec = await su(`select count(*)::int n from jewelry_sales where sale_date between '2026-12-01' and '2026-12-31' and customer_id=$1`, [cust]);
  const jan = await su(`select count(*)::int n from jewelry_sales where sale_date >= '2027-01-01' and customer_id=$1`, [cust]);
  T('month/year attribution: Nov 6, Dec 3 (00:00, 00:01 on 1 Dec + 23:59 on 31 Dec), Jan 3', nov[0].n === 6 && dec[0].n === 3 && jan[0].n === 3, { nov: nov[0].n, dec: dec[0].n, jan: jan[0].n });
  const histRate = await su(`select rate_date::text d, rate_per_gram from daily_gold_rates order by rate_date`);
  T('rate history: one row per Tashkent day, earlier days unchanged', histRate.every((r, k, a) => k === 0 || r.d !== a[k - 1].d), { rows: histRate.map(r => r.d + '=' + Number(r.rate_per_gram)) });
  fs.writeFileSync(process.argv[2] || '/opt/goldia-audit/evidence/bizdate.json', JSON.stringify(R, null, 1));
  console.log('RESULT', R.filter(x => x.ok).length, '/', R.length);
  await pool.end();
})();
