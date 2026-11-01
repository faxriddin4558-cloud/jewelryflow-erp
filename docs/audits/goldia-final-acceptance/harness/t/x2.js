const { U, req, su, pool } = require('./lib');
(async () => {
  console.log('orgB director UPDATE orgA director role->viewer:', JSON.stringify(await req(U.DB, `update employees set is_active=false where id='${U.D}' returning id`)));
  console.log('orgB director reads orgA idempotency response:', JSON.stringify((await req(U.DB, `select operation_name, left(response_data::text,120) r from idempotency_keys limit 2`)).rows));
  console.log('SB reads SA legacy debt:', JSON.stringify((await req(U.SB, `select customer_id, seller_id, delta_585_g from client_legacy_debts`)).rows));
  console.log('SA moves himself to org B (self update organization_id):', JSON.stringify(await req(U.SA, `update employees set organization_id='00000000-0000-0000-0000-0000000000b2' where id='${U.SA}' returning organization_id`)));
  console.log('SA changes own position/name:', JSON.stringify(await req(U.SA, `update employees set position='Director', name='X' where id='${U.SA}' returning position`)));
  console.log('SA changes own role:', JSON.stringify(await req(U.SA, `update employees set role='admin' where id='${U.SA}' returning role`)));
  console.log('SA inserts customer with forged org B:', JSON.stringify(await req(U.SA, `insert into customers (customer_code, contact_name, organization_id, seller_id) values ('HACK1','h','00000000-0000-0000-0000-0000000000b2','${U.SA}') returning id`)));
  console.log('SA updates customer of SB to himself:', JSON.stringify(await req(U.SA, `update customers set seller_id='${U.SA}' where customer_code='CUST-0003' returning id`)));
  console.log('SA writes jewelry_sales directly:', JSON.stringify(await req(U.SA, `update jewelry_sales set remaining_gold_grams=0 returning id`)));
  console.log('SA inserts client_gold_accounts:', JSON.stringify(await req(U.SA, `update client_gold_accounts set current_debt_grams=0 returning customer_id`)));
  console.log('ANON reads customers:', JSON.stringify(await req(null, `select count(*) from customers`)));
  await pool.end();
})();
