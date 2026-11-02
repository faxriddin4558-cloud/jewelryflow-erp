const { U, rpc, pool } = require('./lib');
(async () => {
  const OB = '00000000-0000-0000-0000-0000000000b2', OA = '00000000-0000-0000-0000-000000000001';
  for (const [who, org] of [['SA', OA], ['SA', OB], ['NOEMP', OA], ['NOORG', OA], ['SX', OA], ['DB', OA]]) {
    const r = await rpc(U[who], 'rpc_get_accounting_profit_summary', { p_org_id: org });
    console.log(who, '->', org.slice(-2), r.ok ? 'LEAK: status=' + r.data.status + ' assets=' + JSON.stringify(r.data.assets).slice(0, 160) : 'DENIED ' + r.error);
  }
  for (const who of ['SA', 'NOEMP']) { const r = await rpc(U[who], 'get_manager_available_stock_grams', { p_org_id: OA }); console.log('mgrstock', who, r.ok ? r.data : r.error); }
  await pool.end();
})();
