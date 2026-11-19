-- READ ONLY. Consignment cancellation audit (e.g. a 39.46 g consignment entered twice, one cancelled).
-- Works on production at 088 / 089 (no 090 table needed). No customer data: only staff (seller) names and documents.
-- Shows, for every CANCELLED consignment and every consignment of the same weight:
--   1. the documents (when issued / cancelled, from which factory receipt, opening A or a later receipt)
--   2. each factory receipt it touched: original - given to sellers - in manager stock must be 0; what the active
--      consignments still hold from that receipt vs what the receipt says it gave out
--   3. the seller ledger: stored physical stock vs the pieces the seller really holds
--   4. the report double count (088 / 089 code): a cancelled consignment counted as consignment_cancelled AND its pieces
--      as return_to_manager at the same moment
--   5. the audit log rows of the cancellations
-- Param: weight in grams (default 39.46).  psql -v w=39.46 -f this_file
\if :{?w}
\else
\set w 39.46
\endif
begin transaction read only;
set local timezone = 'Asia/Tashkent';

\echo === 1. Consignments of this weight and every cancelled consignment ===
select o.name tashkilot, c.consignment_no hujjat, e.full_name sotuvchi, c.status holat,
       c.created_at kiritilgan, c.cancelled_at bekor_qilingan, c.cancellation_reason sabab,
       coalesce(c.original_base_weight_grams, c.base_weight_grams) asl_g, c.base_weight_grams hozir_g, c.returned_weight_grams qaytgan_g,
       r.receipt_no kirim, case when r.opening_document_id is not null then 'boshlangich A' when r.id is not null then 'keyingi kirim' else 'kirimsiz' end kirim_turi,
       (select string_agg(p.status || '=' || n::text || ' dona/' || g::text || ' g', ', ')
          from (select p.status, count(*) n, round(sum(p.weight_grams), 4) g from public.consignment_pieces p where p.consignment_id = c.id group by p.status) p) donalar,
       (select count(*) from public.seller_consignments d where d.organization_id = c.organization_id and d.seller_id = c.seller_id and d.id <> c.id
          and abs(coalesce(d.original_base_weight_grams, d.base_weight_grams) - coalesce(c.original_base_weight_grams, c.base_weight_grams)) < 0.00005
          and abs(extract(epoch from d.created_at - c.created_at)) < 86400) bir_kunda_shu_vazn_boshqa
  from public.seller_consignments c
  join public.organizations o on o.id = c.organization_id
  left join public.employees e on e.id = c.seller_id
  left join public.factory_receipts r on r.id = c.factory_receipt_id
 where c.status in ('cancelled', 'reversed')
    or abs(coalesce(c.original_base_weight_grams, c.base_weight_grams) - :w) < 0.00005
 order by o.name, c.created_at;

\echo === 2. Factory receipts touched by these consignments: is the receipt arithmetic consistent ===
with touched as (
  select distinct c.factory_receipt_id id from public.seller_consignments c
   where c.factory_receipt_id is not null
     and (c.status in ('cancelled', 'reversed') or abs(coalesce(c.original_base_weight_grams, c.base_weight_grams) - :w) < 0.00005)
)
select o.name tashkilot, r.receipt_no kirim, r.receipt_date sana, case when r.opening_document_id is not null then 'boshlangich A' else 'keyingi kirim' end turi,
       r.original_physical_g asl_g, r.transferred_physical_g sotuvchilarga_g, r.available_physical_g menejerda_g,
       round(r.original_physical_g - r.transferred_physical_g - r.available_physical_g, 4) qoldiq_0_bolishi_kerak,
       -- what ACTIVE consignments that name this receipt still hold (held + sold pieces; returned pieces went back)
       (select round(coalesce(sum(p.weight_grams), 0), 4) from public.consignment_pieces p join public.seller_consignments c on c.id = p.consignment_id
         where c.factory_receipt_id = r.id and c.status not in ('cancelled', 'reversed') and p.status in ('held_by_seller', 'sold')) faol_konsignatsiyalarda_g,
       -- grams of B opening documents taken from this A (they are not consignments with a factory_receipt_id)
       (select round(coalesce(sum(b.physical_g), 0), 4) from public.opening_documents b
         where r.opening_document_id is not null and b.source_document_id = r.opening_document_id and b.kind = 'seller_inventory' and b.status = 'active') b_hujjatlarda_g,
       (select count(*) from public.seller_consignments c where c.factory_receipt_id = r.id and c.status in ('cancelled', 'reversed')) bekor_qilinganlar,
       r.status
  from public.factory_receipts r join touched t on t.id = r.id join public.organizations o on o.id = r.organization_id
 order by o.name, r.receipt_date, r.receipt_no;

\echo === 2b. Every receipt of the organizations involved (a cancel may have put grams on the WRONG receipt) ===
select o.name tashkilot, r.receipt_no kirim, r.receipt_date sana, case when r.opening_document_id is not null then 'boshlangich A' else 'keyingi kirim' end turi,
       r.original_physical_g asl_g, r.transferred_physical_g sotuvchilarga_g, r.available_physical_g menejerda_g,
       round(r.original_physical_g - r.transferred_physical_g - r.available_physical_g, 4) qoldiq_0_bolishi_kerak, r.status
  from public.factory_receipts r join public.organizations o on o.id = r.organization_id
 where r.organization_id in (select c.organization_id from public.seller_consignments c where c.status in ('cancelled', 'reversed')
                              or abs(coalesce(c.original_base_weight_grams, c.base_weight_grams) - :w) < 0.00005)
   and r.status not in ('reversed', 'cancelled')
 order by o.name, r.receipt_date, r.created_at;

\echo === 3. Seller ledger: stored physical stock vs the pieces really held (sellers with a cancelled consignment or this weight) ===
select o.name tashkilot, e.full_name sotuvchi, a.current_physical_stock_g saqlangan_g,
       (select round(coalesce(sum(p.weight_grams), 0), 4) from public.consignment_pieces p where p.seller_id = a.seller_id and p.status = 'held_by_seller') qolidagi_donalar_g,
       round(a.current_physical_stock_g - (select coalesce(sum(p.weight_grams), 0) from public.consignment_pieces p where p.seller_id = a.seller_id and p.status = 'held_by_seller'), 4) farq_g,
       a.seller_owes_manager_g sotuvchi_qarzi_g
  from public.seller_gold_accounts a join public.employees e on e.id = a.seller_id join public.organizations o on o.id = a.organization_id
 where a.seller_id in (select c.seller_id from public.seller_consignments c where c.status in ('cancelled', 'reversed')
                        or abs(coalesce(c.original_base_weight_grams, c.base_weight_grams) - :w) < 0.00005)
 order by 1, 2;

\echo === 4. Report double count (088 / 089 report code): cancelled consignment pieces ALSO counted as return_to_manager at the same moment ===
select o.name tashkilot, c.consignment_no hujjat, e.full_name sotuvchi, c.cancelled_at,
       c.base_weight_grams consignment_cancelled_qatori_g,
       (select round(coalesce(sum(p.weight_grams), 0), 4) from public.consignment_pieces p where p.consignment_id = c.id and p.returned_to_manager_at = c.cancelled_at) return_to_manager_qatori_g,
       'hisobotda ikki marta ayirilgan (090 tuzatadi, balanslar emas - faqat hisobot)' izoh
  from public.seller_consignments c join public.organizations o on o.id = c.organization_id left join public.employees e on e.id = c.seller_id
 where c.status = 'cancelled'
   and exists (select 1 from public.consignment_pieces p where p.consignment_id = c.id and p.returned_to_manager_at = c.cancelled_at)
 order by o.name, c.cancelled_at;

\echo === 5. Audit log rows of the cancellations ===
select o.name tashkilot, l.created_at, l.action, l.actor_name, l.reason, l.old_data ->> 'consignment_no' hujjat,
       l.old_data ->> 'base_weight_g' asl_g, coalesce(l.new_data ->> 'restored_physical_g', l.new_data ->> 'restored_weight_grams') tiklangan_g
  from public.audit_logs l join public.organizations o on o.id = l.organization_id
 where l.table_name = 'seller_consignments' and (l.action ilike '%cancel%' or l.action ilike '%revers%')
 order by o.name, l.created_at;

rollback;
