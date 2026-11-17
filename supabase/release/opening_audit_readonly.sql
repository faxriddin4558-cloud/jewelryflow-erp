-- READ ONLY. Independent audit of the CURRENT opening (A-J documents) of every organization that has an opening period.
-- Run through docs/releases/production-075/run-readonly-checks.ps1 -Target production-opening-audit
-- (explicit BEGIN TRANSACTION READ ONLY + guard, rolled back). One SELECT, no writes.
-- Privacy: no customer name / phone / code is printed (customers only as the first 8 characters of their id); free-text
-- notes are printed only for non-customer documents (A, B, C, C2, D, G, H, I), truncated; "other" (J) prints its type only.
-- Letters: A manager_inventory, B seller_inventory, C factory_obligation, C2 factory_advance, D seller_obligation,
--          E customer_gram, F customer_currency, G manager_cash, H manager_scrap, I manager_fine_gold, J other,
--          S factory_settled (088: seller goods settled with the factory before T0).
-- Output: AUDIT|<section>|... lines and RESULT|opening_audit|OK|REVIEW (REVIEW = an independent recomputation differs from
-- the stored balance, a B document is not linked to an A document, a receipt is used twice, or stock does not roll up).
with
orgs as (select distinct organization_id org from public.opening_periods),
per as (select distinct on (p.organization_id) p.* from public.opening_periods p order by p.organization_id, p.created_at desc),
rst as (select p.organization_id org, p.id period_id, p.status, p.t0, r.id restart_id, r.restart_no, r.created_at r_at
          from per p left join public.financial_restarts r on r.id = p.restart_id),
letter(kind, l, ord) as (values ('manager_inventory', 'A', 1), ('seller_inventory', 'B', 2), ('factory_obligation', 'C', 3), ('factory_advance', 'C2', 4),
  ('seller_obligation', 'D', 5), ('customer_gram', 'E', 6), ('customer_currency', 'F', 7), ('manager_cash', 'G', 8), ('manager_scrap', 'H', 9),
  ('manager_fine_gold', 'I', 10), ('other', 'J', 11), ('factory_settled', 'S', 12)),
docs as (select d.*, lt.l, lt.ord from public.opening_documents d join rst on rst.period_id = d.opening_period_id join letter lt on lt.kind = d.kind),
act as (select * from docs where status = 'active'),
-- factory side
op_rcpt as (select a.organization_id org, r.* from public.factory_receipts r join act a on a.factory_receipt_id = r.id
             where a.kind in ('manager_inventory', 'seller_inventory') and r.status not in ('reversed', 'cancelled')),
op_rcpt_u as (select distinct on (id) * from op_rcpt),
fac as (
  select rst.org,
    coalesce((select sum(factory_obligation_g) from op_rcpt_u u where u.org = rst.org), 0) op_obl,
    coalesce((select sum(original_physical_g) from op_rcpt_u u where u.org = rst.org), 0) op_phys,
    coalesce((select sum(available_physical_g) from op_rcpt_u u where u.org = rst.org), 0) op_avail,
    coalesce((select sum(amount) from act where act.organization_id = rst.org and kind = 'factory_obligation'), 0) c_amt,
    coalesce((select sum(amount) from act where act.organization_id = rst.org and kind = 'factory_advance'), 0) c2_amt,
    coalesce((select sum(amount) from act where act.organization_id = rst.org and kind = 'factory_settled'), 0) st_amt,
    coalesce((select sum(r.factory_obligation_g) from public.factory_receipts r where r.organization_id = rst.org and r.opening_document_id is null
               and r.status not in ('reversed', 'cancelled') and r.created_at > rst.r_at), 0) post_rcpt_obl,
    coalesce((select sum(r.original_physical_g) from public.factory_receipts r where r.organization_id = rst.org and r.opening_document_id is null
               and r.status not in ('reversed', 'cancelled') and r.created_at > rst.r_at), 0) post_rcpt_phys,
    coalesce((select sum(h.agreed_equivalent_g) from public.factory_gold_handovers h where h.organization_id = rst.org and h.status <> 'reversed'
               and h.created_at > rst.r_at), 0) post_hnd,
    (select count(*) from public.factory_receipts r where r.organization_id = rst.org and r.status not in ('reversed', 'cancelled') and r.created_at <= rst.r_at) old_live_rcpt,
    -- what the factory page cards compute (DirectorSalesWorkspace): every receipt with status <> 'reversed', minus handovers
    coalesce((select sum(r.factory_obligation_g) from public.factory_receipts r where r.organization_id = rst.org and r.status <> 'reversed'), 0) ui_rcpt_obl,
    coalesce((select sum(h.agreed_equivalent_g) from public.factory_gold_handovers h where h.organization_id = rst.org and h.status <> 'reversed'), 0) ui_hnd,
    coalesce((select sum(current_factory_obligation_grams) from public.seller_gold_accounts s where s.organization_id = rst.org), 0) seller_fac_cols,
    v.current_factory_obligation_g v_obl, v.current_factory_advance_g v_adv, v.total_factory_obligation_g v_tot_obl, v.total_factory_handed_over_g v_tot_hnd,
    v.manager_physical_stock_g v_mgr_stock, public.get_manager_available_stock_grams(rst.org) mgr_avail
  from rst left join public.manager_vault_account v on v.organization_id = rst.org),
-- stock side
stock as (
  select rst.org,
    coalesce((select sum(p.weight_grams) from public.consignment_pieces p where p.organization_id = rst.org and p.status = 'held_by_seller'), 0) held_g,
    coalesce((select sum(s.current_physical_stock_g) from public.seller_gold_accounts s where s.organization_id = rst.org), 0) seller_stock_g,
    coalesce((select sum(p.weight_grams) from public.consignment_pieces p join act a on a.consignment_id = p.consignment_id
               where a.organization_id = rst.org and p.status not in ('held_by_seller', 'cancelled')), 0) op_pieces_left_g,
    coalesce((select sum(physical_g) from act where act.organization_id = rst.org and kind = 'manager_inventory'), 0) a_phys,
    coalesce((select sum(physical_g) from act where act.organization_id = rst.org and kind = 'seller_inventory' and source_document_id is null), 0) b_own_phys,
    coalesce((select sum(physical_g) from act where act.organization_id = rst.org and kind = 'seller_inventory' and source_document_id is not null), 0) b_src_phys,
    coalesce((select sum(physical_g) from act where act.organization_id = rst.org and kind = 'seller_inventory'), 0) b_phys
  from rst),
-- seller side (independent): B (consignment obligation) + E (customer 585 g debts of HIS customers) + F (currency snapshots)
-- + D, then the post-opening documents: new consignments, legacy debts, settled to the manager
sel as (
  select e.organization_id org, e.id seller_id, coalesce(e.full_name, e.name, 'sotuvchi') sname,
    coalesce((select sum(c.seller_obligation_g) from public.seller_consignments c join act a on a.consignment_id = c.id where a.seller_id = e.id and a.kind = 'seller_inventory' and c.status <> 'cancelled'), 0) b_obl,
    coalesce((select sum(case a.side when 'debt' then a.amount else 0 end) from act a where a.kind = 'customer_gram' and a.seller_id = e.id), 0) e_debt,
    coalesce((select sum(case a.side when 'advance' then a.amount else 0 end) from act a where a.kind = 'customer_gram' and a.seller_id = e.id), 0) e_adv,
    coalesce((select sum(a.seller_obligation_g) from act a where a.kind = 'customer_currency' and a.seller_id = e.id), 0) f_obl,
    coalesce((select sum(a.amount) from act a where a.kind = 'seller_obligation' and a.seller_id = e.id), 0) d_obl,
    coalesce((select sum(coalesce(c.seller_obligation_g, c.factory_gold_due_grams)) from public.seller_consignments c, rst
               where rst.org = e.organization_id and c.seller_id = e.id and c.status <> 'cancelled' and c.created_at > rst.r_at
                 and not exists (select 1 from act a where a.consignment_id = c.id)), 0) post_cons,
    coalesce((select sum(case l.balance_type when 'debt' then l.amount_585_g else 0 end) from public.client_legacy_debts l, rst
               where rst.org = e.organization_id and l.seller_id = e.id and l.status <> 'reversed' and l.entry_type <> 'opening' and l.created_at > rst.r_at), 0) post_legacy,
    s.seller_owes_manager_g owes, s.total_seller_obligation_g tot_obl, s.total_settled_to_manager_g settled, s.seller_legacy_debt_obligation_g legacy_col,
    s.current_physical_stock_g stock_g, s.seller_till_cash_amount till_uzs, s.seller_till_usd_amount till_usd, s.seller_till_scrap_grams till_lom,
    public._goldia_opening_seller_obligation(e.id, e.organization_id) helper_df
  from public.employees e join orgs on orgs.org = e.organization_id left join public.seller_gold_accounts s on s.seller_id = e.id
  where public._goldia_is_seller_role(e.role::text)),
sel2 as (select *, round(b_obl + e_debt + f_obl + d_obl + post_cons + post_legacy - coalesce(settled, 0), 4) recomputed from sel),
blink as (
  select b.organization_id org, b.document_no, b.physical_g, b.source_document_id, s.document_no src_no, s.kind src_kind, s.status src_status,
         s.opening_period_id = b.opening_period_id same_period, b.factory_receipt_id, s.factory_receipt_id src_rcpt
    from act b left join public.opening_documents s on s.id = b.source_document_id where b.kind = 'seller_inventory'),
dup_rcpt as (select organization_id org, factory_receipt_id, count(*) n, string_agg(document_no, '+' order by document_no) nos
               from act where factory_receipt_id is not null and kind = 'manager_inventory' group by 1, 2 having count(*) > 1),
a_use as (select a.organization_id org, a.document_no, a.physical_g, coalesce(sum(b.physical_g), 0) b_from_it
            from act a left join act b on b.source_document_id = a.id and b.kind = 'seller_inventory' where a.kind = 'manager_inventory' group by 1, 2, 3),
-- 088 projection (read only): what factory_settled would subtract per B document, and the factory net under the rule
-- "seller goods at T0 were settled with the factory before T0" - computed two independent ways
proj as (
  select b.organization_id org, b.id b_id, b.document_no, b.physical_g, b.source_document_id,
         case when b.source_document_id is null then (select round(r.factory_obligation_g, 4) from public.factory_receipts r where r.id = b.factory_receipt_id and r.status <> 'reversed')
              else round(b.physical_g * (1 + coalesce((select a.factory_markup_pct from public.opening_documents a where a.id = b.source_document_id), 0) / 100.0), 4) end settle_g,
         case when b.source_document_id is null then (select r.factory_markup_pct from public.factory_receipts r where r.id = b.factory_receipt_id)
              else (select a.factory_markup_pct from public.opening_documents a where a.id = b.source_document_id) end pct,
         exists (select 1 from act s where s.kind = 'factory_settled' and s.source_document_id = b.id) already_settled
    from act b where b.kind = 'seller_inventory'),
proj_tot as (
  select f.org, coalesce((select sum(settle_g) from proj p where p.org = f.org and not p.already_settled), 0) to_settle,
         (coalesce(f.v_obl, 0) - coalesce(f.v_adv, 0)) - coalesce((select sum(settle_g) from proj p where p.org = f.org and not p.already_settled), 0) new_net_vault,
         coalesce((select sum(round((a.physical_g - a.b_from_it) * (1 + coalesce(d.factory_markup_pct, 0) / 100.0), 4)) from a_use a join act d on d.document_no = a.document_no where a.org = f.org), 0)
           + f.c_amt - f.c2_amt
           + f.post_rcpt_obl - f.post_hnd new_net_formula,
         coalesce((select sum(a.physical_g - a.b_from_it) from a_use a where a.org = f.org), 0) manager_a_left_g
    from fac f),
flags as (
  select rst.org,
    (select count(*) from blink where blink.org = rst.org and blink.source_document_id is null) b_without_a,
    (select count(*) from blink where blink.org = rst.org and blink.source_document_id is not null and (blink.src_kind <> 'manager_inventory' or blink.src_status <> 'active' or not blink.same_period)) b_bad_src,
    (select count(*) from dup_rcpt where dup_rcpt.org = rst.org) dup_receipts,
    (select count(*) from a_use where a_use.org = rst.org and a_use.b_from_it > a_use.physical_g + 0.0001) a_overdrawn,
    (select count(*) from sel2 where sel2.org = rst.org and abs(coalesce(sel2.owes, 0) - sel2.recomputed) > 0.0001) seller_diff,
    abs((f.op_obl + f.c_amt - f.c2_amt - f.st_amt + f.post_rcpt_obl - f.post_hnd) - (coalesce(f.v_obl, 0) - coalesce(f.v_adv, 0))) > 0.0001 factory_diff,
    abs((f.op_phys + f.post_rcpt_phys) - (f.mgr_avail + st.held_g + st.op_pieces_left_g)) > 0.0001 stock_diff,
    abs(st.a_phys + st.b_own_phys - f.op_phys) > 0.0001 doc_rollup_diff
  from rst join fac f on f.org = rst.org join stock st on st.org = rst.org),
lines(k, line) as (
  select '00', 'AUDIT|identity|history_latest=' || (select max(version) from supabase_migrations.schema_migrations) || '|history_count=' || (select count(*) from supabase_migrations.schema_migrations)
  union all
  select '01|' || rst.org, 'AUDIT|period|org=' || rst.org || '|' || coalesce((select coalesce(code, '') || ' ' || name from public.organizations o where o.id = rst.org), '-')
    || '|status=' || rst.status || '|t0_tashkent=' || to_char(rst.t0 at time zone 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI') || '|restart=' || coalesce(rst.restart_no, '-')
    || '|restart_at_tashkent=' || coalesce(to_char(rst.r_at at time zone 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI:SS'), '-')
    || '|freeze_active=' || (public._goldia_active_freeze(rst.org) is not null)
    || '|docs_active=' || (select count(*) from act where act.organization_id = rst.org) || '|docs_cancelled=' || (select count(*) from docs where docs.organization_id = rst.org and docs.status = 'cancelled')
  from rst
  union all
  select '10|' || d.organization_id || '|' || lpad(d.ord::text, 2, '0') || '|' || to_char(d.created_at, 'YYYYMMDDHH24MISSUS'),
    'AUDIT|doc|' || d.l || '|' || d.document_no || '|id=' || left(d.id::text, 8) || '|kind=' || d.kind || '|unit=' || coalesce(d.unit, '-') || '|side=' || coalesce(d.side, '-')
    || '|amount=' || d.amount || '|physical_g=' || coalesce(d.physical_g::text, '-') || '|proba=' || coalesce(d.proba::text, '-') || '|equiv_585_g=' || coalesce(d.equiv_585_g::text, '-')
    || '|factory_pct=' || coalesce(d.factory_markup_pct::text, '-') || '|seller_pct=' || coalesce(d.seller_markup_pct::text, '-')
    || '|usd_rate=' || coalesce(d.usd_rate::text, '-') || '|lom_rate=' || coalesce(d.lom_rate::text, '-')
    || '|seller_obl_g=' || d.seller_obligation_g || '|factory_obl_g=' || d.factory_obligation_g
    || '|source=' || coalesce((select s.document_no from public.opening_documents s where s.id = d.source_document_id), '-')
    || '|receipt=' || coalesce((select r.receipt_no || ' phys ' || r.original_physical_g || ' obl ' || r.factory_obligation_g || ' avail ' || r.available_physical_g || ' ' || r.status from public.factory_receipts r where r.id = d.factory_receipt_id), '-')
    || '|consignment=' || coalesce((select c.consignment_no || ' obl ' || coalesce(c.seller_obligation_g::text, '-') || ' ' || c.status from public.seller_consignments c where c.id = d.consignment_id), '-')
    || '|seller=' || coalesce((select coalesce(e.full_name, e.name) from public.employees e where e.id = d.seller_id), '-')
    || '|customer=' || coalesce(left(d.customer_id::text, 8), '-')
    || '|created_tashkent=' || to_char(d.created_at at time zone 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI:SS')
    || '|note=' || case when d.kind in ('customer_gram', 'customer_currency') then '(hidden: customer document)' when d.kind = 'other' then 'type: ' || coalesce(d.other_type, '-')
                        else coalesce(left(regexp_replace(coalesce(d.notes, d.formula, ''), '[\r\n|]+', ' ', 'g'), 80), '') end
  from act d
  union all
  select '20|' || f.org, 'AUDIT|C|org=' || f.org || '|C_factory_obligation_without_goods_g=' || f.c_amt || ' (' || (select count(*) from act where act.organization_id = f.org and kind = 'factory_obligation') || ' doc)'
    || '|C2_factory_advance_g=' || f.c2_amt || ' (' || (select count(*) from act where act.organization_id = f.org and kind = 'factory_advance') || ' doc)'
    || '|C_minus_C2=' || (f.c_amt - f.c2_amt) || '|_goldia_opening_factory_net=' || public._goldia_opening_factory_net(f.org)
  from fac f
  union all
  select '30|' || f.org, 'AUDIT|factory|org=' || f.org || '|opening_receipts_obl_g=' || f.op_obl || '|C=' || f.c_amt || '|C2=' || f.c2_amt || '|factory_settled_088=' || f.st_amt
    || '|post_opening_receipts_obl_g=' || f.post_rcpt_obl || '|post_opening_handovers_g=' || f.post_hnd
    || '|independent_net_g=' || (f.op_obl + f.c_amt - f.c2_amt - f.st_amt + f.post_rcpt_obl - f.post_hnd)
    || '|vault_current_obl_g=' || coalesce(f.v_obl::text, '-') || '|vault_current_adv_g=' || coalesce(f.v_adv::text, '-') || '|vault_net_g=' || (coalesce(f.v_obl, 0) - coalesce(f.v_adv, 0))
    || '|vault_total_obl_g=' || coalesce(f.v_tot_obl::text, '-') || '|vault_total_handed_g=' || coalesce(f.v_tot_hnd::text, '-')
    || '|old_receipts_still_live=' || f.old_live_rcpt
  from fac f
  union all
  select '31|' || f.org, 'AUDIT|factory_ui|org=' || f.org || '|card_Zavod_Oldidagi_Majburiyat=sum(receipts status<>reversed).factory_obligation_g=' || f.ui_rcpt_obl
    || '|card_Hozirgi_Sof_Zavod_Qarzi=max(0,' || f.ui_rcpt_obl || '-' || f.ui_hnd || ')=' || greatest(f.ui_rcpt_obl - f.ui_hnd, 0)
    || '|both_cards_ignore_C_and_C2=' || (f.c_amt <> 0 or f.c2_amt <> 0)
    || '|manager_panel_Zavod=vault_obl-vault_adv=' || (coalesce(f.v_obl, 0) - coalesce(f.v_adv, 0))
    || '|seller_rows_current_factory_obligation_grams_sum=' || f.seller_fac_cols
  from fac f
  union all
  select '40|' || b.org || '|' || b.document_no, 'AUDIT|B_link|' || b.document_no || '|physical_g=' || coalesce(b.physical_g::text, '-') || '|source=' || coalesce(b.src_no, 'NONE')
    || '|source_kind=' || coalesce(b.src_kind, '-') || '|source_status=' || coalesce(b.src_status, '-') || '|same_period=' || coalesce(b.same_period::text, '-')
    || '|receipt=' || case when b.source_document_id is null then 'OWN opening receipt (an EXTRA factory obligation for these grams)'
                           when b.factory_receipt_id is not distinct from b.src_rcpt then 'source A receipt (no extra factory obligation)' else 'DIFFERENT from the source A receipt' end
  from blink b
  union all
  select '41|' || a.org || '|' || a.document_no, 'AUDIT|A_use|' || a.document_no || '|physical_g=' || a.physical_g || '|moved_to_sellers_by_B_g=' || a.b_from_it || '|left_g=' || (a.physical_g - a.b_from_it)
  from a_use a
  union all
  select '42|' || x.org || '|' || x.nos, 'AUDIT|duplicate_receipt|' || x.nos || '|receipt=' || left(x.factory_receipt_id::text, 8) || '|docs=' || x.n from dup_rcpt x
  union all
  select '50|' || f.org, 'AUDIT|stock|org=' || f.org || '|opening_receipts_physical_g=' || f.op_phys || '|post_opening_receipts_physical_g=' || f.post_rcpt_phys
    || '|manager_available_g=' || f.mgr_avail || '|vault_manager_physical_stock_g=' || coalesce(f.v_mgr_stock::text, '-')
    || '|seller_held_pieces_g=' || st.held_g || '|seller_accounts_stock_g=' || st.seller_stock_g || '|opening_pieces_sold_or_returned_g=' || st.op_pieces_left_g
    || '|rollup=manager+held+sold_since=' || (f.mgr_avail + st.held_g + st.op_pieces_left_g) || ' vs receipts=' || (f.op_phys + f.post_rcpt_phys)
    || '|docs_A_phys=' || st.a_phys || '|docs_B_from_A_phys=' || st.b_src_phys || '|docs_B_own_receipt_phys=' || st.b_own_phys || '|docs_A_plus_B_own=' || (st.a_phys + st.b_own_phys)
  from fac f join stock st on st.org = f.org
  union all
  select '60|' || s.org || '|' || s.sname, 'AUDIT|seller|' || s.sname || '|id=' || left(s.seller_id::text, 8)
    || '|B_stock_markup_obl_g=' || s.b_obl || '|E_customer_585_debt_g=' || s.e_debt || '|E_customer_585_advance_g=' || s.e_adv || '|F_currency_snapshot_g=' || s.f_obl || '|D_g=' || s.d_obl
    || '|post_opening_consignments_g=' || s.post_cons || '|post_opening_legacy_g=' || s.post_legacy || '|settled_to_manager_g=' || coalesce(s.settled::text, '-')
    || '|recomputed_owes_g=' || s.recomputed || '|recorded_owes_g=' || coalesce(s.owes::text, '-') || '|diff_g=' || round(coalesce(s.owes, 0) - s.recomputed, 4)
    || '|recorded_total_obligation_g=' || coalesce(s.tot_obl::text, '-') || '|legacy_column_g=' || coalesce(s.legacy_col::text, '-') || '|helper_D_plus_F_g=' || s.helper_df
    || '|stock_g=' || coalesce(s.stock_g::text, '-') || '|till_uzs=' || coalesce(s.till_uzs::text, '-') || '|till_usd=' || coalesce(s.till_usd::text, '-') || '|till_lom_g=' || coalesce(s.till_lom::text, '-')
  from sel2 s
  union all
  select '70|' || p.org || '|' || p.document_no, 'AUDIT|projection_088_B|' || p.document_no || '|physical_g=' || coalesce(p.physical_g::text, '-') || '|factory_pct=' || coalesce(p.pct::text, '-')
    || '|source=' || case when p.source_document_id is null then 'own receipt' else 'A' end || '|factory_settled_g=' || coalesce(p.settle_g::text, '-') || '|already_settled=' || p.already_settled
  from proj p
  union all
  select '71|' || t.org, 'AUDIT|projection_088|org=' || t.org || '|manager_A_goods_left_g=' || t.manager_a_left_g || '|to_settle_g=' || t.to_settle
    || '|new_net_by_vault=vault_net-to_settle=' || round(t.new_net_vault, 4) || '|new_net_by_formula=sum_A(left_g*(1+A%))+C-C2+later_receipts-handovers=' || round(t.new_net_formula, 4)
    || '|agree=' || (abs(t.new_net_vault - t.new_net_formula) <= 0.001)
    || '|meaning=' || case when t.new_net_vault < 0 then 'the factory owes the manager ' || round(-t.new_net_vault, 4) || ' g' when t.new_net_vault > 0 then 'the manager owes the factory ' || round(t.new_net_vault, 4) || ' g' else 'closed' end
  from proj_tot t
  union all
  select '89|' || fl.org, 'AUDIT|flags|org=' || fl.org || '|B_without_A=' || fl.b_without_a || '|B_bad_source=' || fl.b_bad_src || '|duplicate_receipts=' || fl.dup_receipts
    || '|A_overdrawn_by_B=' || fl.a_overdrawn || '|seller_diff=' || fl.seller_diff || '|factory_diff=' || fl.factory_diff || '|stock_diff=' || fl.stock_diff || '|doc_rollup_diff=' || fl.doc_rollup_diff
  from flags fl
  union all
  select '99', 'RESULT|opening_audit|' || case when exists (select 1 from flags where b_without_a > 0 or b_bad_src > 0 or dup_receipts > 0 or a_overdrawn > 0 or seller_diff > 0
                                                  or factory_diff or stock_diff or doc_rollup_diff) then 'REVIEW' else 'OK' end
)
select line from lines order by k;
