// RLS4 re-check: an RPC that answers "ok" with an empty result for another organization's seller is not a leak.
// Proof: org B really has a markup difference; org B's own director sees it, org A's director gets zeros.
const fs = require('fs');
const { ORG_B, creds, rpc, sel, T, R } = require('./lib');
(async () => {
  const C = creds();
  const bSales = await sel(`jewelry_sales?organization_id=eq.${ORG_B}&status=not.in.(reversed,cancelled)&select=id,markup_difference_g`);
  const truth = bSales.reduce((a, s) => a + Number(s.markup_difference_g || 0), 0);
  const own = await rpc('directorB', 'rpc_get_seller_markup_difference_report', { p_seller_id: C.sellerB1.id });
  const foreign = await rpc('director', 'rpc_get_seller_markup_difference_report', { p_seller_id: C.sellerB1.id });
  T('RLS4b', 'markup report for another org seller reveals nothing (own director sees the real value, foreign director gets 0 / no entries)',
    truth !== 0 && own.ok && Math.abs(Number(own.data.total_difference_g) - truth) < 0.00005 && foreign.ok && Number(foreign.data.total_difference_g) === 0 && foreign.data.entries.length === 0,
    { orgB_truth: truth, own: truth, foreign: 0 }, { orgB_truth: truth, own: own.ok ? own.data.total_difference_g : own.error, foreign: foreign.ok ? { total: foreign.data.total_difference_g, entries: foreign.data.entries.length } : foreign.error });
  fs.writeFileSync(__dirname + '/../evidence/rls4-recheck.json', JSON.stringify(R, null, 1));
})();
