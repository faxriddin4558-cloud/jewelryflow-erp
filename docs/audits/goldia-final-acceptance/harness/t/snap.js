const { su } = require('./lib');
const ORG = '00000000-0000-0000-0000-000000000001';
async function snap() {
  const n = (x) => Number(x);
  const [fr] = await su(`select coalesce(sum(original_physical_g),0) orig, coalesce(sum(available_physical_g),0) avail, coalesce(sum(transferred_physical_g),0) transf, coalesce(sum(factory_obligation_g),0) obl, count(*) cnt from factory_receipts where organization_id=$1 and status not in ('reversed','cancelled')`, [ORG]);
  const [v] = await su(`select * from manager_vault_account where organization_id=$1`, [ORG]);
  const sellers = await su(`select e.employee_code code, s.* from seller_gold_accounts s join employees e on e.id=s.seller_id where s.organization_id=$1 order by 1`, [ORG]);
  const clients = await su(`select c.customer_code code, a.* from client_gold_accounts a join customers c on c.id=a.customer_id where a.organization_id=$1 order by 1`, [ORG]);
  const pieces = await su(`select status, count(*)::int cnt, sum(weight_grams) g from consignment_pieces where organization_id=$1 group by 1 order by 1`, [ORG]);
  const [sales] = await su(`select count(*)::int cnt, coalesce(sum(base_weight_grams),0) base, coalesce(sum(client_gold_due_grams),0) due, coalesce(sum(remaining_gold_grams),0) rem from jewelry_sales where organization_id=$1 and status not in ('reversed','cancelled')`, [ORG]);
  const [mgrStock] = await su(`select get_manager_available_stock_grams($1) g`, [ORG]);
  const rateDiff = await su(`select * from company_rate_differences where organization_id=$1 order by created_at`, [ORG]).catch(() => []);
  return { fr, v, sellers, clients, pieces, sales, mgrStock: n(mgrStock.g), rateDiff };
}
module.exports = { snap, ORG };
