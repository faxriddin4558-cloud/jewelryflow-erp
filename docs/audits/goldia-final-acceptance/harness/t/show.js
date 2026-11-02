const { pool } = require('./lib'); const { snap } = require('./snap');
(async () => { const s = await snap(); const v = s.v;
 console.log('RECEIPTS', s.fr, 'mgrStock(fn)=', s.mgrStock);
 console.log('VAULT', ['manager_physical_stock_g','manager_scrap_grams','manager_scrap_physical_g','manager_cash_amount','manager_usd_amount','manager_purchased_gold_grams','manager_refined_gold_grams','manager_refined_gold_fine_grams','total_factory_obligation_g','total_factory_handed_over_g','current_factory_obligation_g','current_factory_advance_g','valued_cash_uzs','valued_cash_585_g','valued_usd','valued_usd_585_g'].map(k=>k+'='+Number(v[k])).join(' '));
 for (const x of s.sellers) console.log('SELLER', x.code, ['total_transferred_physical_g','current_physical_stock_g','total_seller_obligation_g','total_settled_to_manager_g','seller_owes_manager_g','manager_owes_seller_g','seller_till_scrap_grams','seller_till_scrap_physical_g','seller_till_cash_amount','seller_till_usd_amount','seller_legacy_debt_obligation_g'].map(k=>k.replace(/_g$|_grams$|seller_|total_/g,'')+'='+Number(x[k])).join(' '));
 for (const x of s.clients) console.log('CLIENT', x.code, ['total_purchased_gold_grams','total_settled_grams','current_debt_grams','advance_balance_grams','total_scrap_paid_grams','total_cash_paid_amount','total_usd_paid_amount','total_cash_equiv_grams'].map(k=>k.replace(/_grams$|total_/g,'')+'='+Number(x[k])).join(' '));
 console.log('PIECES', JSON.stringify(s.pieces)); console.log('SALES', JSON.stringify(s.sales));
 for (const r of s.rateDiff) console.log('RATEDIFF', JSON.stringify(r));
 await pool.end(); })();
