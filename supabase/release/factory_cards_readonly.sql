-- READ ONLY. Every card of the factory page ("Zavod bilan hisob"), recomputed from the documents exactly like
-- src/lib/factory-account-summary.ts, per organization, with the T0 split. No customer data.
-- Cards:
--   K1 Zavoddan olingan tovar         = sum(original_physical_g) of active receipts                      (cumulative since T0)
--   K2 Menejer omboridagi tovar        = sum(available_physical_g) of active receipts                     (CURRENT stock)
--   K3 Zavod tovari uchun majburiyat   = sum(factory_obligation_g) of active receipts - B factory_settled  (cumulative since T0)
--   K4 Zavodga berilgan oltin (jami)   = C2 factory_advance documents + active handovers (585 eq)         (cumulative since T0)
--   K5 Joriy qoldiq                    = vault current_factory_obligation_g - current_factory_advance_g   (CURRENT balance)
--   parts net (K3 + C - K4) must equal K5; a difference is the "Kartalar ... mos emas" warning on the page.
-- The 085 financial restart reversed every handover before T0, so every active handover is after T0.
begin transaction read only;
set local timezone = 'Asia/Tashkent';

\echo === 1. Cards per organization (T0 = opening lock) ===
with t0 as (select organization_id, max(locked_at) locked_at from public.opening_periods where status in ('locked', 'closed') group by 1),
r as (select organization_id,
             sum(original_physical_g) k1, sum(available_physical_g) k2, sum(factory_obligation_g) obl,
             sum(factory_obligation_g) filter (where opening_document_id is not null) obl_a,
             sum(factory_obligation_g) filter (where opening_document_id is null) obl_later
        from public.factory_receipts where status <> 'reversed' group by 1),
d as (select organization_id,
             sum(amount) filter (where kind = 'factory_settled') settled, sum(amount) filter (where kind = 'factory_obligation') c,
             sum(amount) filter (where kind = 'factory_advance') c2
        from public.opening_documents where status = 'active' and kind in ('factory_settled', 'factory_obligation', 'factory_advance') group by 1),
h as (select organization_id, sum(agreed_equivalent_g) hnd, count(*) n,
             sum(agreed_equivalent_g) filter (where source_type = 'finished_goods_return') fgr
        from public.factory_gold_handovers where status <> 'reversed' group by 1)
select o.name tashkilot, t0.locked_at t0,
       round(coalesce(r.k1, 0), 4) k1_olingan_tovar_fizik_g,
       round(coalesce(r.k2, 0), 4) k2_menejer_omborida_g,
       round(coalesce(r.obl, 0) - coalesce(d.settled, 0), 4) k3_tovar_majburiyati_g,
       round(coalesce(r.obl_a, 0), 4) k3_a_boshlangich_a_g, round(coalesce(r.obl_later, 0), 4) k3_b_t0_dan_keyin_g, round(coalesce(d.settled, 0), 4) k3_minus_b_settled_g,
       round(coalesce(d.c, 0), 4) c_tovarsiz_majburiyat_g,
       round(coalesce(d.c2, 0) + coalesce(h.hnd, 0), 4) k4_berilgan_oltin_jami_g,
       round(coalesce(d.c2, 0), 4) k4_a_c2_boshlangich_g, round(coalesce(h.hnd, 0) - coalesce(h.fgr, 0), 4) k4_b_t0_dan_keyin_oltin_g,
       round(coalesce(h.fgr, 0), 4) k4_c_qaytarilgan_tovar_g, coalesce(h.n, 0) topshiruv_hujjatlari,
       round(coalesce(r.obl, 0) - coalesce(d.settled, 0) + coalesce(d.c, 0) - coalesce(d.c2, 0) - coalesce(h.hnd, 0), 4) qismlar_neti_g,
       round(v.current_factory_obligation_g - v.current_factory_advance_g, 4) k5_joriy_qoldiq_seyf_g,
       round((coalesce(r.obl, 0) - coalesce(d.settled, 0) + coalesce(d.c, 0) - coalesce(d.c2, 0) - coalesce(h.hnd, 0))
             - (v.current_factory_obligation_g - v.current_factory_advance_g), 4) kartalar_farqi_g,
       v.total_factory_obligation_g seyf_jami_majburiyat_g, v.total_factory_handed_over_g seyf_jami_topshirilgan_g
  from public.manager_vault_account v join public.organizations o on o.id = v.organization_id
  left join t0 on t0.organization_id = o.id left join r on r.organization_id = o.id left join d on d.organization_id = o.id left join h on h.organization_id = o.id
 where coalesce(r.k1, 0) <> 0 or coalesce(d.c2, 0) <> 0 or coalesce(h.hnd, 0) <> 0 or v.current_factory_obligation_g <> 0 or v.current_factory_advance_g <> 0
 order by 1;

\echo === 2. Handovers after T0 (every row of K4 b / c), with the stored handed-over total after each one ===
select o.name tashkilot, h.handover_date sana, h.created_at, h.source_type turi, h.physical_weight_g fizik_g, h.agreed_equivalent_g ekv_585_g, h.status,
       round(sum(h.agreed_equivalent_g) over (partition by h.organization_id order by h.created_at, h.id), 4) yigindi_g
  from public.factory_gold_handovers h join public.organizations o on o.id = h.organization_id
 where h.status <> 'reversed'
 order by o.name, h.created_at;

\echo === 3. Factory receipts after T0 (K3 b) ===
select o.name tashkilot, r.receipt_no, r.receipt_date, r.original_physical_g fizik_g, r.factory_markup_pct foiz, r.factory_obligation_g majburiyat_g, r.available_physical_g omborda_g
  from public.factory_receipts r join public.organizations o on o.id = r.organization_id
 where r.status <> 'reversed' and r.opening_document_id is null
 order by o.name, r.receipt_date, r.created_at;
rollback;
