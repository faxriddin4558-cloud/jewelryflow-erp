-- GOLDIA — accounting consistency investigation — READ ONLY.
-- Reports IDs, codes and numbers only (no customer names or phones). Changes nothing.

begin transaction read only;

-- I1. Incident: factory receipt ZVD-20261029-01E161 and consignment CONS-BC-56F8946B
select 'I1_receipt' as check, receipt_no, status, original_physical_g, available_physical_g,
       transferred_physical_g, factory_markup_pct, factory_obligation_g, created_at
  from public.factory_receipts where receipt_no = 'ZVD-20261029-01E161';

select 'I1_consignment' as check, sc.consignment_no, sc.status, sc.factory_markup_pct, sc.seller_markup_pct,
       sc.quantity, sc.sold_quantity, sc.returned_quantity, sc.base_weight_grams, sc.returned_weight_grams,
       sc.seller_obligation_g, sc.returned_seller_obligation_g, sc.created_at
  from public.seller_consignments sc
 where sc.consignment_no = 'CONS-BC-56F8946B'
    or sc.factory_receipt_id in (select id from public.factory_receipts where receipt_no = 'ZVD-20261029-01E161');

select 'I1_pieces' as check, sc.consignment_no, cp.status, count(*) as pieces, sum(cp.weight_grams) as grams,
       min(cp.seller_markup_pct) as min_pct, max(cp.seller_markup_pct) as max_pct
  from public.consignment_pieces cp join public.seller_consignments sc on sc.id = cp.consignment_id
 where sc.consignment_no = 'CONS-BC-56F8946B'
    or sc.factory_receipt_id in (select id from public.factory_receipts where receipt_no = 'ZVD-20261029-01E161')
 group by 2, 3 order by 2, 3;

select 'I1_sales' as check, js.sale_no, js.status, js.sale_type, js.base_weight_grams, js.client_markup_pct,
       js.client_gold_due_grams, js.settled_gold_grams, js.remaining_gold_grams, js.created_at
  from public.jewelry_sales js
 where js.consignment_id in (select id from public.seller_consignments
                              where consignment_no = 'CONS-BC-56F8946B'
                                 or factory_receipt_id in (select id from public.factory_receipts where receipt_no = 'ZVD-20261029-01E161'))
 order by js.created_at;

-- I2. Manager vault: stored value vs canonical function (UI double count shows as stored+returned)
select 'I2_manager_stock' as check, mva.organization_id, mva.manager_physical_stock_g as stored_g,
       public.get_manager_available_stock_grams(mva.organization_id) as canonical_g,
       mva.manager_scrap_grams, mva.manager_cash_amount, mva.manager_usd_amount
  from public.manager_vault_account mva;

-- I3. Seller accounts: stored vs recomputed with the canonical recalc formula (diff > 0.0001)
with r as (
  select sga.seller_id, sga.organization_id,
         sga.current_physical_stock_g as stored_stock,
         greatest(0,
           (select coalesce(sum(base_weight_grams), 0) from public.seller_consignments sc
             where sc.seller_id = sga.seller_id and sc.status in ('held_by_seller', 'partially_sold', 'fully_sold'))
         - (select coalesce(sum(base_weight_grams), 0) from public.jewelry_sales js
             where js.seller_id = sga.seller_id and js.status not in ('cancelled', 'reversed'))) as calc_stock,
         sga.seller_owes_manager_g as stored_owes,
         greatest(0,
           (select coalesce(sum(coalesce(seller_obligation_g, factory_gold_due_grams)), 0) from public.seller_consignments sc
             where sc.seller_id = sga.seller_id and sc.status in ('held_by_seller', 'partially_sold', 'fully_sold'))
         + (select coalesce(sum(delta_585_g), 0) from public.client_legacy_debts d
             where d.seller_id = sga.seller_id and d.balance_type = 'debt' and d.status <> 'reversed')
         - (select coalesce(sum(total_settled_grams), 0) from public.gold_settlements gs
             where gs.seller_id = sga.seller_id and gs.direction in ('seller_to_manager', 'seller_to_factory')
               and coalesce(gs.status, '') not in ('reversed', 'cancelled') and gs.reversal_of_id is null)) as calc_owes,
         sga.seller_till_cash_amount, sga.seller_till_usd_amount, sga.seller_till_scrap_grams
    from public.seller_gold_accounts sga
)
select 'I3_seller_mismatch' as check, * from r
 where abs(stored_stock - calc_stock) > 0.0001 or abs(stored_owes - calc_owes) > 0.0001
    or seller_till_cash_amount < 0 or coalesce(seller_till_usd_amount, 0) < 0 or seller_till_scrap_grams < 0;

-- I4. Customers: stored debt/advance vs sales and settlements ledger (REVIEW, legacy debts listed apart)
with c as (
  select cga.customer_id, cga.seller_id, cga.current_debt_grams, cga.advance_balance_grams,
         (select coalesce(sum(client_gold_due_grams), 0) from public.jewelry_sales js
           where js.customer_id = cga.customer_id and js.status not in ('cancelled', 'reversed')) as sales_due,
         (select coalesce(sum(total_settled_grams), 0) from public.gold_settlements gs
           where gs.customer_id = cga.customer_id and gs.direction = 'client_to_seller'
             and coalesce(gs.status, '') not in ('cancelled', 'reversed')) as settled,
         (select coalesce(sum(case when balance_type = 'debt' then delta_585_g else -delta_585_g end), 0)
            from public.client_legacy_debts d where d.customer_id = cga.customer_id and d.status <> 'reversed') as legacy_signed
    from public.client_gold_accounts cga
)
select 'I4_customer_review' as check, customer_id, seller_id, current_debt_grams, advance_balance_grams,
       sales_due, settled, legacy_signed,
       round((current_debt_grams - advance_balance_grams) - (sales_due + legacy_signed - settled), 4) as diff_g
  from c
 where abs((current_debt_grams - advance_balance_grams) - (sales_due + legacy_signed - settled)) > 0.001
 order by abs((current_debt_grams - advance_balance_grams) - (sales_due + legacy_signed - settled)) desc;

-- I5. Piece integrity (one physical item, one sale)
select 'I5_sold_piece_without_active_sale' as check, cp.id, cp.status, cp.sale_id, js.status as sale_status
  from public.consignment_pieces cp left join public.jewelry_sales js on js.id = cp.sale_id
 where cp.status = 'sold' and (cp.sale_id is null or js.id is null or js.status in ('reversed', 'cancelled'));
select 'I5_held_piece_with_sale' as check, cp.id, cp.sale_id
  from public.consignment_pieces cp where cp.status = 'held_by_seller' and cp.sale_id is not null;
select 'I5_sale_linked_to_many_pieces' as check, sale_id, count(*)
  from public.consignment_pieces where sale_id is not null group by sale_id having count(*) > 1;
select 'I5_non_positive_piece_weight' as check, id, status, weight_grams
  from public.consignment_pieces where weight_grams <= 0 and status not in ('cancelled', 'reversed');
select 'I5_piece_owner_differs_from_consignment' as check, cp.id, cp.seller_id, sc.seller_id as consignment_seller
  from public.consignment_pieces cp join public.seller_consignments sc on sc.id = cp.consignment_id
 where cp.seller_id is distinct from sc.seller_id and cp.status = 'held_by_seller';

-- I6. Consignment and receipt balances
select 'I6_fully_sold_with_held_pieces' as check, sc.consignment_no, sc.quantity, sc.sold_quantity,
       count(cp.id) filter (where cp.status = 'held_by_seller') as held
  from public.seller_consignments sc left join public.consignment_pieces cp on cp.consignment_id = sc.id
 where sc.status = 'fully_sold' group by 1, 2, 3, 4 having count(cp.id) filter (where cp.status = 'held_by_seller') > 0;
select 'I6_consignment_base_vs_held_pieces' as check, sc.consignment_no, sc.status, sc.base_weight_grams,
       coalesce(sum(cp.weight_grams) filter (where cp.status in ('held_by_seller', 'sold')), 0) as pieces_g
  from public.seller_consignments sc left join public.consignment_pieces cp on cp.consignment_id = sc.id
 where sc.status in ('held_by_seller', 'partially_sold')
 group by 1, 2, 3, 4
having abs(sc.base_weight_grams - coalesce(sum(cp.weight_grams) filter (where cp.status in ('held_by_seller', 'sold')), 0)) > 0.0001;
select 'I6_receipt_out_of_range' as check, receipt_no, status, original_physical_g, available_physical_g, transferred_physical_g
  from public.factory_receipts
 where available_physical_g < -0.0001 or available_physical_g > original_physical_g + 0.0001;

-- I7. Duplicate inventory signals (same model + weight barcode held more than once)
select 'I7_duplicate_held_barcode' as check, model_code, raw_barcode, count(*) as held_count
  from public.consignment_pieces
 where status = 'held_by_seller' and raw_barcode is not null
 group by 1, 2, 3 having count(*) > 1 order by 4 desc limit 50;

-- I8. Physical mass balance per organization (components; review, not auto-judged)
select 'I8_mass_balance' as check, fr.organization_id,
       sum(fr.original_physical_g) as received_g,
       sum(fr.available_physical_g) as manager_receipts_available_g,
       (select coalesce(sum(base_weight_grams), 0) from public.seller_consignments sc
         where sc.organization_id = fr.organization_id and sc.status in ('held_by_seller', 'partially_sold', 'fully_sold')) as consigned_active_base_g,
       (select coalesce(sum(base_weight_grams), 0) from public.jewelry_sales js
         where js.organization_id = fr.organization_id and js.status not in ('cancelled', 'reversed')) as sold_g
  from public.factory_receipts fr where fr.status not in ('reversed', 'cancelled')
 group by fr.organization_id;

-- I9. Reversal / cancellation volume and settlements whose reversal could hit spent advance
select 'I9_status_counts' as check, 'jewelry_sales' t, status, count(*) from public.jewelry_sales group by 3
union all select 'I9_status_counts', 'gold_settlements', coalesce(status, 'NULL'), count(*) from public.gold_settlements group by 3
union all select 'I9_status_counts', 'seller_consignments', status, count(*) from public.seller_consignments group by 3
union all select 'I9_status_counts', 'factory_receipts', status, count(*) from public.factory_receipts group by 3
order by 2, 3;
select 'I9_settlement_with_excess_advance' as check, settlement_no, excess_gold_grams, status, created_at
  from public.gold_settlements
 where direction = 'client_to_seller' and coalesce(excess_gold_grams, 0) > 0 and coalesce(status, '') not in ('reversed', 'cancelled');

rollback;
