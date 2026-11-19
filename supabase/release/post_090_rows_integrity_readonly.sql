-- READ ONLY. Rows written by the 090 / 091 / 092 operations since their release, and whether each one is consistent
-- with the documents it must have (no customer data: ids, numbers, grams, statuses only).
-- A row that fails any column below is a real inconsistency (do not release; report it).
begin transaction read only;
set local timezone = 'Asia/Tashkent';

\echo === 1. Counts (why "no_rows_written" became false) ===
select (select max(version) from supabase_migrations.schema_migrations) daraja,
       (select count(*) from public.factory_goods_returns) zavod_qaytarish, (select count(*) from public.factory_goods_returns where status = 'reversed') shundan_bekor,
       (select count(*) from public.sale_edits) savdo_tahrir,
       (select count(*) from public.seller_lom_purchases) lom_xarid,
       (select count(*) from public.opening_sale_returns) eski_savdo_vozvrat;

\echo === 2. 090 factory goods returns: each with its finished_goods_return handover, value = g x (1 + %), status pair, audit ===
select x.created_at vaqt, h.handover_no, x.grams gramm, x.factory_markup_pct foiz, x.factory_value_g qiymat, x.status, h.status topshiruv_holati,
       (h.id is not null and h.source_type = 'finished_goods_return' and h.organization_id = x.organization_id) topshiruv_bor,
       abs(h.agreed_equivalent_g - x.factory_value_g) < 0.00005 qiymat_mos,
       abs(x.factory_value_g - round(x.grams * (1 + x.factory_markup_pct / 100.0), 4)) < 0.00005 formula_mos,
       ((x.status = 'confirmed') = (h.status not in ('reversed', 'cancelled'))) holat_mos,
       exists (select 1 from public.audit_logs l where l.record_id = x.id::text and l.action = 'RETURN_GOODS_TO_FACTORY') audit_bor
  from public.factory_goods_returns x left join public.factory_gold_handovers h on h.id = x.handover_id
 order by x.created_at;

\echo === 3. 090 sale edits: original reversed, corrected sale exists (same organization / customer / seller), audit ===
select e.created_at vaqt, o.sale_no asl, n.sale_no yangi, o.status asl_holat, n.status yangi_holat, e.edited_role rol,
       (o.status = 'reversed') asl_bekor, (n.id is not null and n.organization_id = e.organization_id and n.customer_id = o.customer_id and n.seller_id = o.seller_id) juft_mos,
       exists (select 1 from public.audit_logs l where l.record_id = e.original_sale_id::text and l.action = 'EDIT_CLIENT_SALE') audit_bor
  from public.sale_edits e left join public.jewelry_sales o on o.id = e.original_sale_id left join public.jewelry_sales n on n.id = e.new_sale_id
 order by e.created_at;

\echo === 4. 091 seller LOM purchases: 585 = g x proba / 585, status pair, audit ===
select x.created_at vaqt, x.purchase_no, x.physical_g, x.proba, x.equiv_585_g, x.uzs_amount, x.status,
       abs(x.equiv_585_g - round(x.physical_g * x.proba / 585.0, 4)) < 0.00005 formula_mos,
       ((x.status = 'reversed') = (x.reversed_at is not null)) holat_mos,
       exists (select 1 from public.audit_logs l where l.record_id = x.id::text and l.action = 'SELLER_LOM_PURCHASE') audit_bor
  from public.seller_lom_purchases x order by x.created_at;

\echo === 5. RESULT: every row consistent? ===
select 'RESULT|post_090_rows|' || case when
  not exists (select 1 from public.factory_goods_returns x left join public.factory_gold_handovers h on h.id = x.handover_id
               where h.id is null or h.source_type <> 'finished_goods_return' or h.organization_id <> x.organization_id
                  or abs(h.agreed_equivalent_g - x.factory_value_g) >= 0.00005
                  or abs(x.factory_value_g - round(x.grams * (1 + x.factory_markup_pct / 100.0), 4)) >= 0.00005
                  or (x.status = 'confirmed') <> (h.status not in ('reversed', 'cancelled'))
                  or not exists (select 1 from public.audit_logs l where l.record_id = x.id::text and l.action = 'RETURN_GOODS_TO_FACTORY'))
  and not exists (select 1 from public.sale_edits e left join public.jewelry_sales o on o.id = e.original_sale_id left join public.jewelry_sales n on n.id = e.new_sale_id
                   where o.status is distinct from 'reversed' or n.id is null or n.organization_id <> e.organization_id
                      or n.customer_id <> o.customer_id or n.seller_id <> o.seller_id
                      or not exists (select 1 from public.audit_logs l where l.record_id = e.original_sale_id::text and l.action = 'EDIT_CLIENT_SALE'))
  then 'PASS' else 'FAIL' end;
rollback;
