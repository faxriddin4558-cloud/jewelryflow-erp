// Synthetic multi-organization activity on the LOCAL disposable PG17 cluster at schema 062 (staging-like shape).
const { rpc, su, pool } = require('../../../audits/goldia-release-candidate-073/harness/lib');
const id = (p, k, n) => `${p}${String(k).padStart(4, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
(async () => {
  const tally = {};
  const t = (name, r) => { const k = `${name}:${r.ok ? 'ok' : 'fail'}`; tally[k] = (tally[k] || 0) + 1; if (!r.ok && !tally['e:' + name]) { tally['e:' + name] = r.error; } return r; };
  for (let k = 3; k <= 60; k++) {
    const org = `00000000-0000-0000-0000-${String(k).padStart(12, '0')}`;
    const D = id('d000', k, 1), M = id('d000', k, 2), S = id('d000', k, 3), S2 = id('d000', k, 4);
    await su(`insert into organizations (id, code, name, status) values ($1, $2, $3, 'ACTIVE')`, [org, `org${k}`, `Sintetik tashkilot ${k}`]);
    const people = [[D, 'admin', 'director', 'Director'], [M, 'production_manager', 'production manager', 'Production Manager'], [S, 'sales', 'seller', 'Seller']];
    if (k % 3 === 0) people.push([S2, 'sales', 'seller', 'Seller']);
    for (const [u, role, rt, pos] of people) {
      await su(`insert into auth.users (id, email, encrypted_password) values ($1, $2, 'x')`, [u, `u${u.slice(0, 8)}-${u.slice(-2)}@audit.test`]);
      await su(`insert into employees (id,user_id,employee_code,name,full_name,email,role,role_type,position,department,is_active,status,organization_id)
                values ($1,$1,$2,$3,$3,$4,$5,$6,$7,'Savdo',true,'active',$8)`, [u, `E${k}-${u.slice(-2)}`, `Xodim ${k}-${u.slice(-2)}`, `u${u.slice(0, 8)}-${u.slice(-2)}@audit.test`, role, rt, pos, org]);
    }
    if (k % 7 === 0) continue; // some organizations have no activity
    t('rate', await rpc(D, 'rpc_set_daily_gold_rate', { p_rate_per_gram: 900000 + k * 1000 }));
    const r = t('receipt', await rpc(M, 'rpc_record_factory_receipt', { p_product_name: `Partiya ${k}`, p_quantity: 3, p_original_physical_g: 30 + k, p_factory_markup_pct: 8 }));
    if (!r.ok) continue;
    const c = t('consign', await rpc(M, 'rpc_issue_barcode_consignment', { p_seller_id: S, p_factory_markup_pct: 8, p_seller_markup_pct: 12,
      p_pieces: [{ weight_grams: 10, model_code: `M${k}A`, purity: 585 }, { weight_grams: 8.5, model_code: `M${k}B`, purity: 585 }], p_factory_receipt_id: r.data.receipt_id }));
    const cu = t('customer', await rpc(S, 'rpc_create_customer_with_code', { p_contact_name: `Mijoz ${k} (sintetik)` }));
    if (!c.ok || !cu.ok) continue;
    const cust = cu.data.customer_id || cu.data.id || cu.data;
    t('weight_sale', await rpc(S, 'rpc_record_weight_sale', { p_customer_id: cust, p_weight_grams: 4 + (k % 5), p_client_markup_pct: 15, p_idempotency_key: `ws-${k}` }));
    if (k % 2 === 0) t('settlement', await rpc(S, 'rpc_record_client_settlement', { p_customer_id: cust, p_cash_amount: 1000000 + k * 10000, p_rate_per_gram: 900000 + k * 1000 }));
    if (k % 4 === 0) t('purchase', await rpc(M, 'rpc_record_gold_purchase', { p_supplier_name: 'Bozor (sintetik)', p_cash_spent_uzs: 900000, p_gold_weight_grams: 1, p_proba: 585, p_idempotency_key: `buy-${k}` }));
    if (k % 5 === 0) {
      const till = (await su(`select coalesce(seller_cash_on_hand,0) c from seller_gold_accounts where seller_id = $1`, [S]).catch(() => [{ c: 0 }]))[0] || { c: 0 };
      t('handover', await rpc(S, 'rpc_record_seller_to_manager_settlement', { p_seller_id: S, p_cash_paid_amount: Number(till.c), p_idempotency_key: `ho-${k}` }));
    }
  }
  console.log(JSON.stringify(tally, null, 1));
  await pool.end();
})();
