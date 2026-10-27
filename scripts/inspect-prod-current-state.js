const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function parseEnv(filePath) {
  const res = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      res[trimmed.slice(0, idx).trim()] = v;
    }
  }
  return res;
}

const env = parseEnv(path.resolve(__dirname, '../.env.production.local'));
const prod = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY']);

async function inspect() {
  console.log('==============================================================================');
  console.log('PRODUCTION AUDIT INVESTIGATION (vrozlllcaxinavzxueif)');
  console.log('==============================================================================\n');

  // 1. Factory Receipts
  const { data: receipts } = await prod.from('factory_receipts').select('*').order('created_at', { ascending: false });
  console.log('Factory Receipts (' + receipts.length + '):');
  receipts.forEach(r => console.log(`  ${r.receipt_no} | status=${r.status} | name=${r.product_name} | orig=${r.original_physical_g}g | avail=${r.available_physical_g}g | transf=${r.transferred_physical_g}g | obl=${r.factory_obligation_g}g`));

  // 2. Consignments
  const { data: consignments } = await prod.from('seller_consignments').select('*').order('created_at', { ascending: false });
  console.log('\nSeller Consignments (' + consignments.length + '):');
  consignments.forEach(c => console.log(`  ${c.consignment_no} | status=${c.status} | base_w=${c.base_weight_grams}g | qty=${c.quantity} | ret_w=${c.returned_weight_grams}g | ret_qty=${c.returned_quantity} | obl=${c.seller_obligation_g}g | orig_w=${c.original_base_weight_grams}g`));

  // 3. Consignment Pieces
  const { data: pieces } = await prod.from('consignment_pieces').select('*').order('created_at', { ascending: false });
  console.log('\nConsignment Pieces (' + pieces.length + '):');
  pieces.forEach(p => console.log(`  ${p.id.slice(0,8)} | code=${p.model_code} | status=${p.status} | weight=${p.weight_grams}g | consign_id=${p.consignment_id?.slice(0,8)} | ret_at=${p.returned_to_manager_at}`));

  // 4. Sales
  const { data: sales } = await prod.from('jewelrysales').select('*').order('created_at', { ascending: false });
  // Note: table is jewelry_sales
  const { data: jSales } = await prod.from('jewelry_sales').select('*').order('created_at', { ascending: false });
  console.log('\nJewelry Sales (' + (jSales?.length || 0) + '):');
  jSales?.forEach(s => console.log(`  ${s.sale_no} | status=${s.status} | gross_w=${s.gross_weight_grams}g | due=${s.client_gold_due_grams}g | rem=${s.remaining_gold_grams}g | piece=${s.piece_id?.slice(0,8)}`));

  // 5. Settlements
  const { data: settlements } = await prod.from('gold_settlements').select('*').order('created_at', { ascending: false });
  console.log('\nGold Settlements (' + settlements.length + '):');
  settlements.forEach(s => console.log(`  ${s.settlement_no} | dir=${s.direction} | status=${s.status} | scrap=${s.scrap_weight_grams}g | cash=${s.cash_paid_amount} ${s.currency} | cash_eq=${s.cash_equivalent_grams}g | total_settled=${s.total_settled_grams}g | rem_debt=${s.remaining_debt_grams}g | notes=${s.notes}`));

  // 6. Refining batches
  const { data: refBatches } = await prod.from('refining_batches').select('*').order('created_at', { ascending: false });
  console.log('\nRefining Batches (' + refBatches.length + '):');
  refBatches.forEach(b => console.log(`  ${b.batch_no} | status=${b.status} | in_scrap=${b.input_scrap_grams}g | out_fine=${b.output_fine_grams}g | out_585=${b.output_585_equiv_grams}g | loss=${b.total_loss_grams}g`));

  // 7. Client accounts
  const { data: clients } = await prod.from('client_gold_accounts').select('*');
  console.log('\nClient Gold Accounts:');
  clients.forEach(c => console.log(`  cust_id=${c.customer_id?.slice(0,8)} | debt=${c.current_debt_grams}g | adv=${c.advance_balance_grams}g | total_settled=${c.total_settled_grams}g`));

  // 8. Seller accounts
  const { data: sellers } = await prod.from('seller_gold_accounts').select('*');
  console.log('\nSeller Gold Accounts:');
  sellers.forEach(s => console.log(`  seller_id=${s.seller_id?.slice(0,8)} | phys_stock=${s.current_physical_stock_g}g | owes_mgr=${s.seller_owes_manager_g}g | scrap=${s.seller_till_scrap_grams}g | cash_uzs=${s.seller_till_cash_amount} | cash_usd=${s.seller_till_usd_amount}`));

  // 9. Manager vault
  const { data: vault } = await prod.from('manager_vault_account').select('*');
  console.log('\nManager Vault:');
  vault.forEach(v => console.log(`  phys_stock=${v.manager_physical_stock_g}g | scrap=${v.manager_scrap_grams}g | refined_585=${v.manager_refined_gold_grams}g | refined_fine=${v.manager_refined_gold_fine_grams}g | cap_pure=${v.manager_capital_pure_gold_g}g | f_cap=${v.manager_finished_capital_g}g | cash=${v.manager_cash_amount} UZS | usd=$${v.manager_usd_amount} | f_obl=${v.current_factory_obligation_g}g | f_adv=${v.current_factory_advance_g}g`));

  // 10. Financial transactions
  const { data: finTx } = await prod.from('financial_transactions').select('*').order('created_at', { ascending: false });
  console.log('\nFinancial Transactions (' + finTx.length + '):');
  finTx.forEach(t => console.log(`  ${t.transaction_no} | type=${t.transaction_type} | till=${t.source_till} | amt=${t.amount_num} ${t.currency} | equiv=${t.equiv_585_grams}g | status=${t.status}`));
}

inspect().catch(console.error);
