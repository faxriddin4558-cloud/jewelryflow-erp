const { U, rpc, pool } = require('./lib');
(async () => { for (const k of ['D', 'M']) { const r = await rpc(U[k], 'rpc_get_accounting_profit_summary', {}); console.log(k, r.ok ? JSON.stringify({ res: r.data.period_accounting_result_585_g, net: r.data.current_net_assets_585_g, assets: r.data.assets }) : r.error); } await pool.end(); })();
