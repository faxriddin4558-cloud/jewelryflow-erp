-- READ ONLY. Is the opening C2 factory advance still in the factory account after later gold handovers?
-- Known defect: rpc_record_factory_gold_handover sets total_factory_handed_over_g = sum of handover rows. That drops the
-- C2 advance, which opening documents add to that total. The stored total should be:
--   active handovers + active C2 advance (+ C2 factory_settled parts, as recorded by the opening).
-- No customer data.
begin transaction read only;
select o.name tashkilot,
       v.total_factory_handed_over_g saqlangan_topshirilgan_g,
       (select coalesce(sum(h.agreed_equivalent_g), 0) from public.factory_gold_handovers h
         where h.organization_id = o.id and coalesce(h.status, 'confirmed') not in ('reversed', 'cancelled')) topshiruvlar_g,
       (select coalesce(sum(d.amount), 0) from public.opening_documents d
         where d.organization_id = o.id and d.kind = 'factory_advance' and d.status = 'active') c2_avans_g,
       (select count(*) from public.factory_gold_handovers h join public.opening_periods p on p.organization_id = h.organization_id and p.status in ('locked', 'closed')
         where h.organization_id = o.id and h.created_at > p.created_at) t0_dan_keyin_topshiruvlar,
       round(v.total_factory_handed_over_g
             - (select coalesce(sum(h.agreed_equivalent_g), 0) from public.factory_gold_handovers h
                 where h.organization_id = o.id and coalesce(h.status, 'confirmed') not in ('reversed', 'cancelled'))
             - (select coalesce(sum(d.amount), 0) from public.opening_documents d
                 where d.organization_id = o.id and d.kind = 'factory_advance' and d.status = 'active'), 4) farq_0_bolishi_kerak,
       round(v.current_factory_obligation_g - v.current_factory_advance_g, 4) zavod_neti_g
  from public.manager_vault_account v join public.organizations o on o.id = v.organization_id
 where v.total_factory_handed_over_g <> 0 or exists (select 1 from public.opening_documents d where d.organization_id = o.id and d.kind = 'factory_advance')
 order by 1;
rollback;
