const { U, rpc, su, rec, pool } = require('./lib');
(async () => {
  // clean the 3 noise pieces by returning them to manager
  for (const p of await su(`select id, seller_id from consignment_pieces where weight_grams < 0.01`))
    rec('S3.9', 'manager returns noise piece to stock', await rpc(U.M, 'rpc_return_piece_to_manager', { p_piece_id: p.id, p_notes: 'cleanup' }));
  const ca1 = rec('S4.1', 'SA creates customer CA1', await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Mijoz A1 (sintetik)', p_phone: '+000000001' }));
  const ca2 = rec('S4.2', 'SA creates customer CA2', await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Mijoz A2 (sintetik)', p_phone: '+000000002' }));
  const cb1 = rec('S4.3', 'SB creates customer CB1', await rpc(U.SB, 'rpc_create_customer_with_code', { p_contact_name: 'Mijoz B1 (sintetik)' }));
  rec('S4.4', 'SA creates customer assigned to SB (forged seller id)', await rpc(U.SA, 'rpc_create_customer_with_code', { p_contact_name: 'Forged', p_seller_id: U.SB }));
  console.log(JSON.stringify(await su(`select customer_code, contact_name, seller_id from customers order by created_at`)));
  await pool.end();
})();
