#!/usr/bin/env python3
# Generates supabase/migrations/20260101000085_goldia_financial_restart_and_opening_accounting.sql and its rollback from
# the LATEST repository bodies (exact, asserted patches; nothing else in those bodies moves).
import re, glob, pathlib
REPO = pathlib.Path(__file__).resolve().parents[3]
FILES = [f for f in sorted(glob.glob(str(REPO / "supabase/migrations/*.sql"))) if "20260101000085_" not in f]

def latest(fn):
    body = src = None
    for f in FILES:
        s = pathlib.Path(f).read_text(encoding="utf-8").replace("\r\n", "\n")
        for m in re.finditer(r"create\s+or\s+replace\s+function\s+public\." + re.escape(fn) + r"\s*\(", s, re.I):
            st = m.start()
            tag = re.search(r"\bas\s+(\$[a-z_]*\$)", s[st:st + 4000], re.I).group(1)
            e = s.find(tag, s.find(tag, st) + len(tag)) + len(tag)
            body, src = s[st:e], pathlib.Path(f).name
    assert body, fn
    return body, src

def patch(body, pairs, fn):
    for old, new in pairs:
        n = body.count(old)
        assert n == 1, (fn, n, old[:120])
        body = body.replace(old, new)
    return body

P = {}
# ------------------------------------------------------------------ seller obligation: + opening seller obligations
P["recalc_seller_gold_account"] = [
("""  v_total_obl := ROUND(v_consignment_obl + v_legacy_debt_obl, 4);""",
 """  -- 085: + opening seller obligations (an opening obligation document, the 585 g obligation of an opening UZS / USD
  -- customer debt computed once at its rate snapshot); never recomputed later
  v_total_obl := ROUND(v_consignment_obl + v_legacy_debt_obl + public._goldia_opening_seller_obligation(p_seller_id, p_org_id), 4);"""),
]
# ------------------------------------------------------------------ period report: opening documents without a row
P["_goldia_period_effects"] = [
("""    from public.gold_purchases p where p.organization_id = p_org and p.status in ('reversed', 'cancelled') and p.reversed_at is not null
$$""",
 """    from public.gold_purchases p where p.organization_id = p_org and p.status in ('reversed', 'cancelled') and p.reversed_at is not null
  -- 085: opening documents that have no row of their own (customer UZS / USD, manager cash, factory without goods);
  -- the other opening kinds are a factory receipt, a consignment or a legacy row and appear through those
  union all
  select 'opening_' || o.kind || coalesce('_' || lower(o.unit), '') || coalesce('_' || o.side, ''),
         public._goldia_business_date(o.effective_t0), o.seller_id, 1, 0,
         case when o.kind = 'customer_currency' and o.unit = 'UZS' then (case o.side when 'debt' then o.amount else -o.amount end) else 0 end,
         case when o.kind = 'customer_currency' and o.unit = 'USD' then (case o.side when 'debt' then o.amount else -o.amount end) else 0 end,
         0, 0, 0, 0,
         case when o.kind = 'manager_cash' and o.unit = 'UZS' then o.amount else 0 end,
         case when o.kind = 'manager_cash' and o.unit = 'USD' then o.amount else 0 end,
         case o.kind when 'factory_obligation' then o.amount when 'factory_advance' then -o.amount else 0 end,
         coalesce(o.physical_g, 0), coalesce(o.equiv_585_g, 0), o.amount, 0
    from public.opening_documents o
   where o.organization_id = p_org and o.kind in ('customer_currency', 'manager_cash', 'factory_obligation', 'factory_advance')
  union all
  select 'reversal_opening_' || o.kind || coalesce('_' || lower(o.unit), '') || coalesce('_' || o.side, ''),
         public._goldia_business_date(o.cancelled_at), o.seller_id, 1, 0,
         case when o.kind = 'customer_currency' and o.unit = 'UZS' then (case o.side when 'debt' then -o.amount else o.amount end) else 0 end,
         case when o.kind = 'customer_currency' and o.unit = 'USD' then (case o.side when 'debt' then -o.amount else o.amount end) else 0 end,
         0, 0, 0, 0,
         case when o.kind = 'manager_cash' and o.unit = 'UZS' then -o.amount else 0 end,
         case when o.kind = 'manager_cash' and o.unit = 'USD' then -o.amount else 0 end,
         case o.kind when 'factory_obligation' then -o.amount when 'factory_advance' then o.amount else 0 end,
         coalesce(o.physical_g, 0), coalesce(o.equiv_585_g, 0), o.amount, 0
    from public.opening_documents o
   where o.organization_id = p_org and o.kind in ('customer_currency', 'manager_cash', 'factory_obligation', 'factory_advance')
     and o.status = 'cancelled' and o.cancelled_at is not null
$$"""),
]
# ------------------------------------------------------------------ old test reset: never once the controlled opening is used
P["rpc_execute_full_test_reset"] = [
("""    raise exception 'Test hisobini tozalash sababi (audit uchun) kiritilishi shart';
  end if;""",
 """    raise exception 'Test hisobini tozalash sababi (audit uchun) kiritilishi shart';
  end if;
  -- 085: this test cleanup leaves UZS / USD balances behind; an organization that uses the controlled financial
  -- restart / opening accounting is never reset this way
  if exists (select 1 from public.opening_periods where organization_id = v_caller_org) then
    raise exception 'ERR_USE_FINANCIAL_RESTART: bu tashkilotda boshlang''ich hisob yuritiladi - sinov tozalash taqiqlangan (Boshlang''ich hisob sahifasidagi nazoratli qayta boshlashdan foydalaning)' using errcode = '55000';
  end if;"""),
]
# ------------------------------------------------------------------ profit summary: opening factory net + other items
OTHER_DECL = ("""  v_unvalued               text[] := array[]::text[];""",
"""  v_unvalued               text[] := array[]::text[];
  v_oth_assets_g           numeric(14, 4) := 0;
  v_oth_liab_g             numeric(14, 4) := 0;""")
P["rpc_get_accounting_profit_summary"] = [
OTHER_DECL,
("""  v_net_factory_g := v_factory_rcp_due_g - v_factory_hnd_paid_g;""",
 """  -- 085: + opening factory obligation / - opening factory advance (documents without goods)
  v_net_factory_g := v_factory_rcp_due_g - v_factory_hnd_paid_g + public._goldia_opening_factory_net(v_org_id);
  -- 085: other opening assets / liabilities, valued once at their rate snapshot (shown separately)
  select o.assets_g, o.liabilities_g into v_oth_assets_g, v_oth_liab_g from public._goldia_opening_other(v_org_id) o;"""),
("""    v_cur_uzs_debt_g + v_cur_usd_debt_g +
    v_factory_advance_g,
    4
  );

  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g + v_cur_uzs_adv_g + v_cur_usd_adv_g, 4);""",
 """    v_cur_uzs_debt_g + v_cur_usd_debt_g +
    v_factory_advance_g + v_oth_assets_g,
    4
  );

  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g + v_cur_uzs_adv_g + v_cur_usd_adv_g + v_oth_liab_g, 4);"""),
("""      'factory_advance_585_g', v_factory_advance_g
    ),
    'liabilities', jsonb_build_object(
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g,
      'customer_uzs_advance_585_eq_g', v_cur_uzs_adv_g,
      'customer_usd_advance_585_eq_g', v_cur_usd_adv_g
    )""",
 """      'factory_advance_585_g', v_factory_advance_g,
      'other_opening_assets_585_g', v_oth_assets_g
    ),
    'liabilities', jsonb_build_object(
      'factory_debt_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g,
      'customer_uzs_advance_585_eq_g', v_cur_uzs_adv_g,
      'customer_usd_advance_585_eq_g', v_cur_usd_adv_g,
      'other_opening_liabilities_585_g', v_oth_liab_g
    )"""),
]
# ------------------------------------------------------------------ baseline: same + O-2 check + lock the opening period
P["rpc_confirm_accounting_baseline"] = [
("""  v_factory_advance_g      numeric(14, 4);""",
 """  v_factory_advance_g      numeric(14, 4);
  v_open                   public.opening_periods%rowtype;
  v_open_fail              text;
  v_oth_assets_g           numeric(14, 4) := 0;
  v_oth_liab_g             numeric(14, 4) := 0;"""),
("""  v_net_factory_g := v_factory_rcp_g - v_factory_hnd_g;""",
 """  v_net_factory_g := v_factory_rcp_g - v_factory_hnd_g + public._goldia_opening_factory_net(v_org_id);
  select o.assets_g, o.liabilities_g into v_oth_assets_g, v_oth_liab_g from public._goldia_opening_other(v_org_id) o;"""),
("""    v_cur_uzs_debt_g + v_cur_usd_debt_g +
    v_factory_advance_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g + v_cur_uzs_adv_g + v_cur_usd_adv_g, 4);""",
 """    v_cur_uzs_debt_g + v_cur_usd_debt_g +
    v_factory_advance_g + v_oth_assets_g,
    4
  );

  v_total_liabilities_g := round(v_factory_obligation_g + v_customer_advances_g + v_cur_uzs_adv_g + v_cur_usd_adv_g + v_oth_liab_g, 4);"""),
("""  update public.accounting_baselines
     set status = 'archived'
   where organization_id = v_org_id and status = 'active';""",
 """  -- 085: a baseline confirmed while an opening period is in draft locks it; decision O-2: at T0 every seller till
  -- (UZS, USD, LOM) is empty - the money was handed to the manager before T0 and is part of the manager's opening
  select * into v_open from public.opening_periods where organization_id = v_org_id and status = 'draft' for update;
  if v_open.id is not null and (coalesce(v_seller_cash_uzs, 0) <> 0 or coalesce(v_seller_cash_usd, 0) <> 0
                                or coalesce(v_seller_scrap_585_eq_g, 0) <> 0) then
    raise exception 'ERR_OPENING_SELLER_TILL_NOT_EMPTY: Boshlang''ich hisobda sotuvchilar kassasi bo''sh bo''lishi shart (so''m %, USD %, lom % g)',
      coalesce(v_seller_cash_uzs, 0), coalesce(v_seller_cash_usd, 0), coalesce(v_seller_scrap_585_eq_g, 0) using errcode = '22023';
  end if;
  -- 085 (D-1): the server refuses an unreconciled opening - the UI button is not the only gate
  if v_open.id is not null then
    select string_agg(c.key, ', ' order by c.key) into v_open_fail
      from jsonb_each(public.rpc_get_opening_state() -> 'checks') c
     where (c.key = 'non_opening_documents_after_restart' and c.value <> '0'::jsonb)
        or (c.key <> 'non_opening_documents_after_restart' and c.value <> 'true'::jsonb);
    if v_open_fail is not null then
      raise exception 'ERR_OPENING_NOT_RECONCILED: boshlang''ich hisob solishtirilmagan: %', v_open_fail using errcode = '22023';
    end if;
  end if;

  update public.accounting_baselines
     set status = 'archived'
   where organization_id = v_org_id and status = 'active';"""),
("""    'customer_usd_advance_585_eq_g', v_cur_usd_adv_g
  );""",
 """    'customer_usd_advance_585_eq_g', v_cur_usd_adv_g,
    'other_opening_assets_585_g', v_oth_assets_g,
    'other_opening_liabilities_585_g', v_oth_liab_g,
    'opening_period_id', v_open.id
  );"""),
("""  ) returning id into v_baseline_id;""",
 """  ) returning id into v_baseline_id;

  if v_open.id is not null then
    update public.opening_periods
       set status = 'locked', locked_at = clock_timestamp(), locked_by = v_caller_emp_id, baseline_id = v_baseline_id
     where id = v_open.id;
  end if;"""),
]

NEW = r"""
-- ================================================================== 1. schema
-- one controlled financial restart per call; its documents are archived (never deleted) and listed row by row
create table if not exists public.financial_restarts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id),
  restart_no             text not null unique,
  t0                     timestamptz not null,
  reason                 text not null check (length(btrim(reason)) > 0),
  confirmed_by           uuid references public.employees(id),
  backup_verification_id uuid not null,
  archived_counts        jsonb not null default '{}'::jsonb,
  idempotency_key        text,
  created_at             timestamptz not null default now()
);
create table if not exists public.financial_restart_items (
  restart_id  uuid not null references public.financial_restarts(id),
  table_name  text not null,
  row_id      uuid not null,
  old_status  text,
  primary key (restart_id, table_name, row_id)
);
-- written ONLY by the release tooling (database owner / service role) after a backup was taken AND restored on a
-- disposable copy; signed-in users can read their organization's rows but never write them
create table if not exists public.financial_backup_verifications (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id),
  backup_reference       text not null check (length(btrim(backup_reference)) > 0),
  backup_sha256          text,
  restore_verified       boolean not null check (restore_verified),
  verified_at            timestamptz not null default now(),
  verified_by            text not null default current_user,
  consumed_by_restart_id uuid references public.financial_restarts(id)
);
create table if not exists public.opening_periods (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  period_no    text not null unique,
  restart_id   uuid references public.financial_restarts(id),
  t0           timestamptz not null,
  status       text not null default 'draft' check (status in ('draft', 'locked', 'closed')),
  created_by   uuid references public.employees(id),
  created_at   timestamptz not null default now(),
  locked_at    timestamptz,
  locked_by    uuid references public.employees(id),
  baseline_id  uuid references public.accounting_baselines(id),
  closed_at    timestamptz
);
create unique index if not exists opening_periods_one_draft on public.opening_periods (organization_id) where status = 'draft';
create table if not exists public.opening_documents (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id),
  opening_period_id   uuid not null references public.opening_periods(id),
  document_no         text not null unique,
  kind                text not null check (kind in ('manager_inventory', 'seller_inventory', 'factory_obligation', 'factory_advance',
                        'seller_obligation', 'customer_gram', 'customer_currency', 'manager_cash', 'manager_scrap',
                        'manager_fine_gold', 'other')),
  status              text not null default 'active' check (status in ('active', 'cancelled')),
  effective_t0        timestamptz not null,
  seller_id           uuid references public.employees(id),
  customer_id         uuid references public.customers(id),
  unit                text check (unit in ('G585', 'UZS', 'USD', 'SCRAP', 'FINE', 'FINISHED', 'GOLD')),
  side                text check (side in ('debt', 'advance', 'asset', 'liability')),
  amount              numeric(18, 4) not null check (amount > 0),
  physical_g          numeric(14, 4),
  proba               numeric(6, 2),
  factory_markup_pct  numeric(6, 2),
  seller_markup_pct   numeric(6, 2),
  usd_rate            numeric(18, 2),
  lom_rate            numeric(18, 2),
  equiv_585_g         numeric(14, 4),
  seller_obligation_g numeric(14, 4) not null default 0 check (seller_obligation_g >= 0),
  factory_obligation_g numeric(14, 4) not null default 0 check (factory_obligation_g >= 0),
  formula             text,
  counterparty        text,
  other_type          text,
  model_id            uuid,
  product_name        text,
  factory_receipt_id  uuid references public.factory_receipts(id),
  consignment_id      uuid references public.seller_consignments(id),
  legacy_debt_id      uuid references public.client_legacy_debts(id),
  source_document_id  uuid references public.opening_documents(id),
  notes               text,
  created_by          uuid references public.employees(id),
  created_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.employees(id),
  cancel_reason       text,
  idempotency_key     text,
  unique (organization_id, idempotency_key)
);
create index if not exists opening_documents_period on public.opening_documents (opening_period_id, kind, status);
create index if not exists opening_documents_seller on public.opening_documents (seller_id) where status = 'active';
alter table public.factory_receipts add column if not exists opening_document_id uuid references public.opening_documents(id);

-- legacy entries may be opening entries (customer 585 debt / advance of an opening period)
do $c$ declare r record; begin
  for r in select conname from pg_constraint where conrelid = 'public.client_legacy_debts'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%entry_type%' loop
    execute format('alter table public.client_legacy_debts drop constraint %I', r.conname);
  end loop;
end $c$;
alter table public.client_legacy_debts add constraint client_legacy_debts_entry_type_check
  check (entry_type in ('initial', 'reconciliation_adjustment', 'manual_addition', 'reversal', 'opening'));

-- RLS: read for the organization's management (and accountants); sellers read their own opening documents; no
-- direct writes for anybody (everything goes through the RPCs below)
alter table public.financial_restarts enable row level security;
alter table public.financial_restart_items enable row level security;
alter table public.financial_backup_verifications enable row level security;
alter table public.opening_periods enable row level security;
alter table public.opening_documents enable row level security;
drop policy if exists financial_restarts_select on public.financial_restarts;
create policy financial_restarts_select on public.financial_restarts for select to authenticated
  using (organization_id = public.current_organization_id() and public._goldia_is_management_role(public.current_employee_role_text()));
drop policy if exists financial_restart_items_select on public.financial_restart_items;
create policy financial_restart_items_select on public.financial_restart_items for select to authenticated
  using (exists (select 1 from public.financial_restarts r where r.id = restart_id and r.organization_id = public.current_organization_id())
         and public._goldia_is_management_role(public.current_employee_role_text()));
drop policy if exists financial_backup_verifications_select on public.financial_backup_verifications;
create policy financial_backup_verifications_select on public.financial_backup_verifications for select to authenticated
  using (organization_id = public.current_organization_id() and public._goldia_is_management_role(public.current_employee_role_text()));
drop policy if exists opening_periods_select on public.opening_periods;
create policy opening_periods_select on public.opening_periods for select to authenticated
  using (organization_id = public.current_organization_id());
drop policy if exists opening_documents_select on public.opening_documents;
create policy opening_documents_select on public.opening_documents for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or public.current_employee_role_text() in ('accountant', 'buxgalter')
              or seller_id in (select e.id from public.employees e where e.user_id = auth.uid())));
revoke all on public.financial_restarts, public.financial_restart_items, public.financial_backup_verifications,
              public.opening_periods, public.opening_documents from anon;
revoke insert, update, delete, truncate on public.financial_restarts, public.financial_restart_items,
              public.financial_backup_verifications, public.opening_periods, public.opening_documents from authenticated;
grant select on public.financial_restarts, public.financial_restart_items, public.financial_backup_verifications,
              public.opening_periods, public.opening_documents to authenticated;

-- ================================================================== 2. helpers (not callable by clients)
create or replace function public._goldia_opening_seller_obligation(p_seller uuid, p_org uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $f$
  select coalesce(sum(seller_obligation_g), 0)::numeric from public.opening_documents
   where organization_id = p_org and seller_id = p_seller and status = 'active' and kind in ('seller_obligation', 'customer_currency')
$f$;
create or replace function public._goldia_opening_factory_net(p_org uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $f$
  select coalesce(sum(case kind when 'factory_obligation' then amount else -amount end), 0)::numeric from public.opening_documents
   where organization_id = p_org and status = 'active' and kind in ('factory_obligation', 'factory_advance')
$f$;
create or replace function public._goldia_opening_other(p_org uuid, out assets_g numeric, out liabilities_g numeric)
language sql stable security definer set search_path = public, pg_temp as $f$
  select coalesce(sum(equiv_585_g) filter (where side = 'asset'), 0)::numeric, coalesce(sum(equiv_585_g) filter (where side = 'liability'), 0)::numeric
    from public.opening_documents where organization_id = p_org and status = 'active' and kind = 'other'
$f$;
-- add to the vault's factory totals and recompute the current obligation / advance (same rule as a receipt / handover)
create or replace function public._goldia_vault_factory_add(p_org uuid, p_obligation numeric, p_handed numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
declare v public.manager_vault_account%rowtype; v_net numeric;
begin
  perform public._get_or_create_manager_vault(p_org);
  select * into v from public.manager_vault_account where organization_id = p_org for update;
  v_net := round((v.total_factory_obligation_g + p_obligation) - (v.total_factory_handed_over_g + p_handed), 4);
  if v.total_factory_obligation_g + p_obligation < -0.00005 or v.total_factory_handed_over_g + p_handed < -0.00005 then
    raise exception 'ERR_OPENING_FACTORY_NEGATIVE: zavod hisobi manfiy bo''lib qoladi' using errcode = '22023';
  end if;
  update public.manager_vault_account
     set total_factory_obligation_g   = round(total_factory_obligation_g + p_obligation, 4),
         total_factory_handed_over_g  = round(total_factory_handed_over_g + p_handed, 4),
         current_factory_obligation_g = greatest(v_net, 0),
         current_factory_advance_g    = greatest(-v_net, 0),
         updated_at = clock_timestamp()
   where organization_id = p_org;
end $f$;
-- customer UZS / USD balance: + delta = more debt (or less advance), - delta = more advance (or less debt)
create or replace function public._goldia_currency_account_add(p_org uuid, p_customer uuid, p_seller uuid, p_cur text, p_delta numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
declare a public.client_currency_accounts%rowtype; v_net numeric(18, 2);
begin
  insert into public.client_currency_accounts (customer_id, currency, organization_id, seller_id)
  values (p_customer, p_cur, p_org, p_seller) on conflict (customer_id, currency) do nothing;
  select * into a from public.client_currency_accounts where customer_id = p_customer and currency = p_cur for update;
  v_net := round((a.debt_amount - a.advance_amount) + p_delta, 2);
  update public.client_currency_accounts
     set debt_amount = greatest(v_net, 0), advance_amount = greatest(-v_net, 0),
         seller_id = coalesce(seller_id, p_seller), updated_at = clock_timestamp()
   where customer_id = p_customer and currency = p_cur;
end $f$;
revoke all on function public._goldia_opening_seller_obligation(uuid, uuid) from public, anon, authenticated;
revoke all on function public._goldia_opening_factory_net(uuid) from public, anon, authenticated;
revoke all on function public._goldia_opening_other(uuid) from public, anon, authenticated;
revoke all on function public._goldia_vault_factory_add(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public._goldia_currency_account_add(uuid, uuid, uuid, text, numeric) from public, anon, authenticated;

-- ================================================================== 3. controlled financial restart (director only)
-- Archives every financial document of the organization (status reversed / cancelled with the restart time, so the
-- period report nets each one out on the restart day - nothing is deleted), lists each archived row with its old
-- status, empties every balance (585 g, UZS, USD, LOM, stock, factory / seller obligation, tills, vault), archives the
-- baseline and opens a draft opening period at T0. Customers, phones, seller assignment, employees, logins, models,
-- settings and rate settings are not touched. One transaction: any error leaves nothing changed.
create or replace function public.rpc_financial_restart(p_confirmation text, p_reason text, p_t0 timestamptz,
  p_backup_verification_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org     uuid := public.current_organization_id();
  v_emp     uuid := public.current_employee_id();
  v_role    text := public.current_employee_role_text();
  v_reason  text := nullif(btrim(p_reason), '');
  v_key     text := nullif(btrim(p_idempotency_key), '');
  v_ts      timestamptz := clock_timestamp();
  v_bv      public.financial_backup_verifications%rowtype;
  v_id      uuid;
  v_no      text;
  v_note    text;
  v_period  uuid;
  v_counts  jsonb := '{}'::jsonb;
  v_n       integer;
  v_payload jsonb;
  v_existing jsonb;
  v_res     jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  -- decision: only the director (owner / admin) restarts the books - not the manager
  if v_role is null or lower(v_role) not in ('admin', 'director', 'owner', 'direktor', 'rahbar') then
    raise exception 'Permission denied: moliyaviy hisobni qayta boshlashni faqat direktor bajaradi' using errcode = '42501';
  end if;
  if p_confirmation is distinct from 'MOLIYAVIY HISOBNI QAYTA BOSHLASH' then
    raise exception 'ERR_CONFIRMATION: tasdiqlash matni noto''g''ri (talab: MOLIYAVIY HISOBNI QAYTA BOSHLASH)' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'ERR_REASON: qayta boshlash sababi kiritilishi shart' using errcode = '22023';
  end if;
  if p_t0 is null then
    raise exception 'ERR_T0: boshlang''ich sana va vaqt (T0) kiritilishi shart' using errcode = '22023';
  end if;
  if v_key is null then
    raise exception 'ERR_IDEMPOTENCY: so''rov kaliti (idempotency key) majburiy' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object('t0', p_t0, 'reason', v_reason, 'backup', p_backup_verification_id);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_financial_restart', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;
  -- one restart at a time per organization (a second call waits, then sees the draft period below)
  perform pg_advisory_xact_lock(hashtext('goldia_financial_restart'), hashtext(v_org::text));
  if exists (select 1 from public.opening_periods where organization_id = v_org and status = 'draft') then
    raise exception 'ERR_RESTART_ALREADY_OPEN: qayta boshlash allaqachon bajarilgan - boshlang''ich hisob hali tasdiqlanmagan (avval uni yakunlang)' using errcode = '55000';
  end if;
  -- a backup restored on a disposable copy is mandatory; each verification serves one restart, within 24 hours
  select * into v_bv from public.financial_backup_verifications
   where id = p_backup_verification_id and organization_id = v_org for update;
  if v_bv.id is null or not v_bv.restore_verified or v_bv.consumed_by_restart_id is not null
     or v_bv.verified_at < v_ts - interval '24 hours' then
    raise exception 'ERR_BACKUP_NOT_VERIFIED: so''nggi 24 soatdagi tiklab sinalgan backup tasdig''i kerak (har biri bir marta)' using errcode = '55000';
  end if;

  v_no := 'RST-' || to_char(timezone('Asia/Tashkent', v_ts), 'YYYYMMDD-HH24MI') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
  insert into public.financial_restarts (organization_id, restart_no, t0, reason, confirmed_by, backup_verification_id, idempotency_key)
  values (v_org, v_no, p_t0, v_reason, v_emp, v_bv.id, v_key) returning id into v_id;
  v_note := 'MOLIYAVIY QAYTA BOSHLASH ' || v_no || ': ' || v_reason;

  -- returns first (a sale with returns cannot be reversed as a whole), then sales
  insert into public.financial_restart_items select v_id, 'jewelry_sale_returns', id, status from public.jewelry_sale_returns where organization_id = v_org and status = 'confirmed';
  update public.jewelry_sale_returns set status = 'reversed' where organization_id = v_org and status = 'confirmed';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sale_returns', v_n);
  insert into public.financial_restart_items select v_id, 'jewelry_sales', id, status from public.jewelry_sales where organization_id = v_org and status not in ('cancelled', 'reversed');
  update public.jewelry_sales set status = 'reversed', notes = coalesce(notes, '') || ' [' || v_note || ']', updated_at = v_ts
   where organization_id = v_org and status not in ('cancelled', 'reversed');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sales', v_n);
  insert into public.financial_restart_items select v_id, 'gold_settlements', id, status from public.gold_settlements where organization_id = v_org and coalesce(status, 'confirmed') not in ('cancelled', 'reversed');
  update public.gold_settlements set status = 'reversed', reversed_at = v_ts, reversed_by = v_emp, reversal_reason = v_note,
         notes = coalesce(notes, '') || ' [' || v_note || ']'
   where organization_id = v_org and coalesce(status, 'confirmed') not in ('cancelled', 'reversed');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('settlements', v_n);
  insert into public.financial_restart_items select v_id, 'client_currency_settlements', id, status from public.client_currency_settlements where organization_id = v_org and status <> 'reversed';
  update public.client_currency_settlements set status = 'reversed', reversed_at = v_ts, reversed_by = v_emp, reversal_reason = v_note
   where organization_id = v_org and status <> 'reversed';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('currency_settlements', v_n);
  insert into public.financial_restart_items select v_id, 'client_legacy_debts', id, status from public.client_legacy_debts where organization_id = v_org and status <> 'reversed';
  update public.client_legacy_debts set status = 'reversed', reversed_at = v_ts, reversed_by = v_emp, reversal_reason = v_note, updated_at = v_ts
   where organization_id = v_org and status <> 'reversed';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('legacy_entries', v_n);
  -- stock: pieces and consignments cancelled (weights kept - the period report nets them out on the restart day)
  insert into public.financial_restart_items select v_id, 'consignment_pieces', id, status from public.consignment_pieces where organization_id = v_org and status <> 'cancelled';
  update public.consignment_pieces set status = 'cancelled', notes = coalesce(notes, '') || ' [' || v_note || ']', updated_at = v_ts
   where organization_id = v_org and status <> 'cancelled';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pieces', v_n);
  insert into public.financial_restart_items select v_id, 'seller_consignments', id, status from public.seller_consignments where organization_id = v_org and status <> 'cancelled';
  update public.seller_consignments set status = 'cancelled', cancelled_at = v_ts, notes = coalesce(notes, '') || ' [' || v_note || ']', updated_at = v_ts
   where organization_id = v_org and status <> 'cancelled';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('consignments', v_n);
  insert into public.financial_restart_items select v_id, 'factory_receipts', id, status from public.factory_receipts where organization_id = v_org and status not in ('reversed', 'cancelled');
  update public.factory_receipts set status = 'reversed', reversed_at = v_ts, available_physical_g = 0,
         notes = coalesce(notes, '') || ' [' || v_note || ']', updated_at = v_ts
   where organization_id = v_org and status not in ('reversed', 'cancelled');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('factory_receipts', v_n);
  insert into public.financial_restart_items select v_id, 'factory_gold_handovers', id, status from public.factory_gold_handovers where organization_id = v_org and status <> 'reversed';
  update public.factory_gold_handovers set status = 'reversed', reversed_at = v_ts, notes = coalesce(notes, '') || ' [' || v_note || ']', updated_at = v_ts
   where organization_id = v_org and status <> 'reversed';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('factory_handovers', v_n);
  insert into public.financial_restart_items select v_id, 'refining_batches', id, status from public.refining_batches where organization_id = v_org and status not in ('cancelled', 'reversed');
  update public.refining_batches set status = 'reversed', reversed_at = v_ts, reversed_by = v_emp, reversal_reason = v_note, updated_at = v_ts
   where organization_id = v_org and status not in ('cancelled', 'reversed');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('refining', v_n);
  insert into public.financial_restart_items select v_id, 'financial_transactions', id, status from public.financial_transactions where organization_id = v_org and status not in ('cancelled', 'reversed');
  update public.financial_transactions set status = 'reversed', reversed_at = v_ts, reversed_by = v_emp, reversal_reason = v_note, updated_at = v_ts
   where organization_id = v_org and status not in ('cancelled', 'reversed');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('financial_transactions', v_n);
  insert into public.financial_restart_items select v_id, 'gold_purchases', id, status from public.gold_purchases where organization_id = v_org and status not in ('cancelled', 'reversed');
  update public.gold_purchases set status = 'reversed', reversed_at = v_ts, notes = coalesce(notes, '') || ' [' || v_note || ']'
   where organization_id = v_org and status not in ('cancelled', 'reversed');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('purchases', v_n);
  -- an earlier opening: its documents are cancelled (netted out on the restart day), its period closed
  insert into public.financial_restart_items select v_id, 'opening_documents', id, status from public.opening_documents where organization_id = v_org and status = 'active';
  update public.opening_documents set status = 'cancelled', cancelled_at = v_ts, cancelled_by = v_emp, cancel_reason = v_note
   where organization_id = v_org and status = 'active';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('opening_documents', v_n);
  update public.opening_periods set status = 'closed', closed_at = v_ts where organization_id = v_org and status = 'locked';

  -- balances: every one to exact zero
  update public.client_gold_accounts
     set current_debt_grams = 0, advance_balance_grams = 0, total_settled_grams = 0, total_purchased_gold_grams = 0,
         total_scrap_paid_grams = 0, total_cash_paid_amount = 0, total_cash_equiv_grams = 0, total_usd_paid_amount = 0,
         total_usd_equiv_grams = 0, updated_at = v_ts
   where organization_id = v_org;
  update public.client_currency_accounts
     set debt_amount = 0, advance_amount = 0, total_sold_amount = 0, total_paid_amount = 0, updated_at = v_ts
   where organization_id = v_org;
  update public.seller_gold_accounts
     set total_transferred_physical_g = 0, total_seller_obligation_g = 0, total_settled_to_manager_g = 0,
         seller_owes_manager_g = 0, manager_owes_seller_g = 0, bozor_qarzi_signed_g = 0, total_consigned_gold_grams = 0,
         current_factory_obligation_grams = 0, current_physical_stock_g = 0, seller_till_scrap_grams = 0,
         seller_till_scrap_physical_g = 0, seller_till_scrap_585_eq_g = 0, seller_till_cash_amount = 0,
         seller_till_usd_amount = 0, till_valued_cash_uzs = 0, till_valued_cash_585_g = 0, till_valued_usd = 0,
         till_valued_usd_585_g = 0, seller_legacy_debt_obligation_g = 0, updated_at = v_ts
   where organization_id = v_org;
  perform public._get_or_create_manager_vault(v_org);
  update public.manager_vault_account
     set manager_physical_stock_g = 0, manager_scrap_grams = 0, manager_scrap_physical_g = 0, manager_scrap_585_eq_g = 0,
         manager_refined_gold_grams = 0, manager_refined_gold_fine_grams = 0, manager_capital_pure_gold_g = 0,
         manager_capital_pure_gold_fine_g = 0, manager_finished_capital_g = 0, manager_purchased_gold_grams = 0,
         manager_cash_amount = 0, manager_usd_amount = 0, total_factory_received_g = 0, total_factory_obligation_g = 0,
         total_factory_handed_over_g = 0, current_factory_obligation_g = 0, current_factory_advance_g = 0, updated_at = v_ts
   where organization_id = v_org;
  update public.accounting_baselines set status = 'archived', notes = coalesce(notes, '') || ' [' || v_note || ']'
   where organization_id = v_org and status = 'active';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('baselines_archived', v_n);

  insert into public.opening_periods (organization_id, period_no, restart_id, t0, status, created_by)
  values (v_org, 'OPN-' || substr(v_no, 5), v_id, p_t0, 'draft', v_emp) returning id into v_period;
  update public.financial_restarts set archived_counts = v_counts where id = v_id;
  update public.financial_backup_verifications set consumed_by_restart_id = v_id where id = v_bv.id;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, new_data, reason)
  values (v_org, 'financial_restarts', v_id::text, 'FINANCIAL_RESTART', auth.uid(),
    jsonb_build_object('restart_no', v_no, 't0', p_t0, 'opening_period_id', v_period, 'backup_verification_id', v_bv.id,
                       'backup_reference', v_bv.backup_reference, 'archived', v_counts, 'employee_id', v_emp), v_reason);

  v_res := jsonb_build_object('status', 'ok', 'restart_id', v_id, 'restart_no', v_no, 'opening_period_id', v_period,
                              't0', p_t0, 'archived', v_counts);
  perform public.save_idempotency_response(v_key, 'rpc_financial_restart', v_res, v_payload);
  return v_res;
end;
$function$;
revoke all on function public.rpc_financial_restart(text, text, timestamptz, uuid, text) from public, anon;
grant execute on function public.rpc_financial_restart(text, text, timestamptz, uuid, text) to authenticated;

-- ================================================================== 4. opening documents (manager / director)
create or replace function public.rpc_record_opening_document(
  p_kind text, p_amount numeric default null, p_unit text default null, p_side text default null,
  p_seller_id uuid default null, p_customer_id uuid default null, p_physical_g numeric default null, p_proba numeric default null,
  p_factory_markup_pct numeric default null, p_seller_markup_pct numeric default null, p_usd_rate numeric default null,
  p_lom_rate numeric default null, p_equiv_585_g numeric default null, p_pieces jsonb default null,
  p_source_document_id uuid default null, p_model_id uuid default null, p_product_name text default null,
  p_counterparty text default null, p_other_type text default null, p_notes text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org      uuid := public.current_organization_id();
  v_emp      uuid := public.current_employee_id();
  v_kind     text := lower(btrim(coalesce(p_kind, '')));
  v_unit     text := upper(nullif(btrim(p_unit), ''));
  v_side     text := lower(nullif(btrim(p_side), ''));
  v_key      text := nullif(btrim(p_idempotency_key), '');
  v_per      public.opening_periods%rowtype;
  v_cust     public.customers%rowtype;
  v_src      public.opening_documents%rowtype;
  v_doc_id   uuid := gen_random_uuid();
  v_no       text;
  v_amt      numeric(18, 4);
  v_phys     numeric(14, 4);
  v_proba    numeric(6, 2);
  v_eq       numeric(14, 4);
  v_sobl     numeric(14, 4) := 0;
  v_fobl     numeric(14, 4) := 0;
  v_formula  text;
  v_seller   uuid := p_seller_id;
  v_rcp_id   uuid;
  v_con_id   uuid;
  v_leg_id   uuid;
  v_pieces   jsonb;
  v_r        jsonb;
  v_payload  jsonb;
  v_existing jsonb;
  v_res      jsonb;
  v_t0date   date;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_key is null then
    raise exception 'ERR_IDEMPOTENCY: so''rov kaliti (idempotency key) majburiy' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object('kind', v_kind, 'amount', p_amount, 'unit', v_unit, 'side', v_side, 'seller', p_seller_id,
                                  'customer', p_customer_id, 'physical', p_physical_g, 'pieces', p_pieces);
  v_existing := public.check_and_lock_idempotency(v_key, 'rpc_record_opening_document', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;
  select * into v_per from public.opening_periods where organization_id = v_org and status = 'draft' for update;
  if v_per.id is null then
    if exists (select 1 from public.opening_periods where organization_id = v_org and status = 'locked') then
      raise exception 'ERR_OPENING_LOCKED: boshlang''ich hisob tasdiqlangan va qulflangan' using errcode = '55000';
    end if;
    raise exception 'ERR_NO_OPENING_PERIOD: avval direktor moliyaviy hisobni qayta boshlashi (T0) kerak' using errcode = '55000';
  end if;
  v_t0date := public._goldia_business_date(v_per.t0);
  v_no := 'OPD-' || to_char(timezone('Asia/Tashkent', clock_timestamp()), 'YYYYMMDD') || '-' || upper(substr(v_doc_id::text, 1, 8));
  v_amt := round(coalesce(p_amount, 0)::numeric, 4);

  if v_kind = 'manager_inventory' then
    -- decision O-4: goods on the manager at T0 came from the factory on credit; markup per document (no default)
    v_phys := round(coalesce(p_physical_g, p_amount, 0)::numeric, 4);
    if v_phys <= 0 then raise exception 'Fizik vazn 0 dan katta bo''lishi shart'; end if;
    if p_factory_markup_pct is null or p_factory_markup_pct < 0 or p_factory_markup_pct > 100 then
      raise exception 'Zavod ustamasi (%%) kiritilishi shart (0 - 100)' using errcode = '22023';
    end if;
    v_r := public.rpc_record_factory_receipt(coalesce(nullif(btrim(p_product_name), ''), 'Boshlang''ich ombor ' || v_no), 1, v_phys, 585,
             p_factory_markup_pct, null, p_model_id, 'BOSHLANG''ICH HISOB ' || v_no || coalesce(': ' || p_notes, ''), v_key || ':rcp');
    v_rcp_id := (v_r ->> 'receipt_id')::uuid;
    update public.factory_receipts set receipt_date = v_t0date where id = v_rcp_id;
    select factory_obligation_g into v_fobl from public.factory_receipts where id = v_rcp_id;
    v_amt := v_phys; v_unit := 'FINISHED'; v_proba := 585;
    v_formula := v_phys || ' g x (1 + ' || p_factory_markup_pct || ' %) = ' || v_fobl || ' g zavod majburiyati';

  elsif v_kind = 'seller_inventory' then
    if v_seller is null or not exists (select 1 from public.employees e where e.id = v_seller and e.organization_id = v_org
                                        and public._goldia_is_seller_role(e.role::text)) then
      raise exception 'Sotuvchi tanlanishi shart (shu tashkilot sotuvchisi)' using errcode = '22023';
    end if;
    if p_seller_markup_pct is null or p_seller_markup_pct < 0 or p_seller_markup_pct > 100 then
      raise exception 'Sotuvchi majburiyati ustamasi (%%) kiritilishi shart (0 - 100)' using errcode = '22023';
    end if;
    v_pieces := case when p_pieces is not null and jsonb_typeof(p_pieces) = 'array' and jsonb_array_length(p_pieces) > 0 then p_pieces
                     when coalesce(p_physical_g, 0) > 0 then jsonb_build_array(jsonb_build_object('weight_grams', p_physical_g)) end;
    if v_pieces is null then raise exception 'Dona vaznlari (yoki jami vazn) kiritilishi shart'; end if;
    select round(sum((x ->> 'weight_grams')::numeric), 4) into v_phys from jsonb_array_elements(v_pieces) x;
    if coalesce(v_phys, 0) <= 0 then raise exception 'Fizik vazn 0 dan katta bo''lishi shart'; end if;
    if p_source_document_id is not null then
      -- the goods are part of an opening manager inventory: they move from the manager to the seller (counted once)
      select * into v_src from public.opening_documents where id = p_source_document_id and organization_id = v_org
         and opening_period_id = v_per.id and kind = 'manager_inventory' and status = 'active';
      if v_src.id is null then raise exception 'Manba (menejer boshlang''ich ombori) hujjati topilmadi'; end if;
      v_rcp_id := v_src.factory_receipt_id;
    else
      -- the goods are only on the seller (not in the manager's stock): one opening receipt for exactly these grams,
      -- consigned at once - the manager's stock is not increased (receipt fully transferred), nothing is invented
      if p_factory_markup_pct is null or p_factory_markup_pct < 0 or p_factory_markup_pct > 100 then
        raise exception 'Zavod ustamasi (%%) kiritilishi shart (0 - 100; zavodga qarzsiz bo''lsa 0 emas - bu qaror talab qiladi)' using errcode = '22023';
      end if;
      v_r := public.rpc_record_factory_receipt(coalesce(nullif(btrim(p_product_name), ''), 'Boshlang''ich sotuvchi ombori ' || v_no), 1, v_phys, 585,
               p_factory_markup_pct, null, p_model_id, 'BOSHLANG''ICH HISOB ' || v_no || ' (sotuvchida)', v_key || ':rcp');
      v_rcp_id := (v_r ->> 'receipt_id')::uuid;
      update public.factory_receipts set receipt_date = v_t0date where id = v_rcp_id;
      select factory_obligation_g into v_fobl from public.factory_receipts where id = v_rcp_id;
    end if;
    v_r := public.rpc_issue_barcode_consignment(v_seller, coalesce(p_factory_markup_pct, v_src.factory_markup_pct, 0), v_pieces,
             'BOSHLANG''ICH HISOB ' || v_no, v_key || ':con', v_rcp_id, p_seller_markup_pct);
    v_con_id := (v_r ->> 'consignment_id')::uuid;
    update public.seller_consignments set issued_at = v_per.t0 where id = v_con_id;
    select coalesce(seller_obligation_g, 0) into v_sobl from public.seller_consignments where id = v_con_id;
    v_amt := v_phys; v_unit := 'FINISHED'; v_proba := 585;
    v_formula := v_phys || ' g x (1 + ' || p_seller_markup_pct || ' %) = ' || v_sobl || ' g sotuvchi majburiyati'
                 || case when p_source_document_id is null then '; zavod: ' || v_fobl || ' g' else '' end;
    v_sobl := 0; -- the consignment carries the seller obligation (not the opening document)

  elsif v_kind in ('factory_obligation', 'factory_advance') then
    if v_amt <= 0 then raise exception 'Miqdor (585 g) 0 dan katta bo''lishi shart'; end if;
    v_unit := 'G585'; v_eq := v_amt;
    if v_kind = 'factory_obligation' then perform public._goldia_vault_factory_add(v_org, v_amt, 0);
    else perform public._goldia_vault_factory_add(v_org, 0, v_amt); end if;

  elsif v_kind = 'seller_obligation' then
    if v_seller is null or not exists (select 1 from public.employees e where e.id = v_seller and e.organization_id = v_org) then
      raise exception 'Sotuvchi tanlanishi shart' using errcode = '22023';
    end if;
    if v_amt <= 0 then raise exception 'Majburiyat (585 g) 0 dan katta bo''lishi shart'; end if;
    if nullif(btrim(p_notes), '') is null then raise exception 'Majburiyat asosi (izoh) kiritilishi shart'; end if;
    v_unit := 'G585'; v_eq := v_amt; v_sobl := v_amt;

  elsif v_kind in ('customer_gram', 'customer_currency') then
    select * into v_cust from public.customers where id = p_customer_id and organization_id = v_org;
    if v_cust.id is null then raise exception 'Mijoz topilmadi'; end if;
    if v_side not in ('debt', 'advance') then raise exception 'Qoldiq turi: debt (qarz) yoki advance (avans)'; end if;
    if v_amt <= 0 then raise exception 'Miqdor 0 dan katta bo''lishi shart'; end if;
    v_seller := v_cust.seller_id;
    if v_kind = 'customer_gram' then v_unit := 'G585';
    elsif v_unit not in ('UZS', 'USD') then raise exception 'Valyuta: UZS yoki USD'; end if;
    -- one opening balance per customer and unit (a second one would count the same debt twice)
    if exists (select 1 from public.opening_documents d where d.opening_period_id = v_per.id and d.customer_id = v_cust.id
                and d.status = 'active' and d.kind = v_kind and d.unit = v_unit) then
      raise exception 'ERR_OPENING_DUPLICATE: bu mijozning % boshlang''ich qoldig''i allaqachon kiritilgan (avval uni bekor qiling)', v_unit using errcode = '23505';
    end if;
    if v_kind = 'customer_gram' then
      v_r := public.rpc_record_client_legacy_debt(v_cust.id, v_side, v_amt, v_t0date,
               'BOSHLANG''ICH HISOB ' || v_no || coalesce(': ' || p_notes, ''), 'opening', null, v_key || ':leg', v_seller);
      v_leg_id := coalesce((v_r ->> 'legacy_debt_id')::uuid, (v_r ->> 'id')::uuid);
      v_eq := v_amt;
    else
      if v_side = 'debt' then
        -- decision O-3: the debt creates the seller's 585 g obligation ONCE, at the rate snapshot of this document
        if v_seller is null then raise exception 'Mijozga sotuvchi biriktirilmagan: valyuta qarzi sotuvchi majburiyatini yaratadi' using errcode = '22023'; end if;
        if coalesce(p_lom_rate, 0) <= 0 then raise exception 'ERR_RATE_REQUIRED: 585 kursi (so''m / g) kiritilishi shart' using errcode = '22023'; end if;
        if v_unit = 'USD' and coalesce(p_usd_rate, 0) <= 0 then raise exception 'ERR_RATE_REQUIRED: USD kursi (so''m) kiritilishi shart' using errcode = '22023'; end if;
        v_sobl := round(case when v_unit = 'UZS' then v_amt else v_amt * p_usd_rate end / p_lom_rate, 4);
        v_eq := v_sobl;
        v_formula := case when v_unit = 'UZS' then v_amt || ' so''m / ' || p_lom_rate || ' = ' || v_sobl || ' g'
                          else v_amt || ' USD x ' || p_usd_rate || ' / ' || p_lom_rate || ' = ' || v_sobl || ' g' end;
      end if;
      perform public._goldia_currency_account_add(v_org, v_cust.id, v_seller, v_unit, case v_side when 'debt' then v_amt else -v_amt end);
    end if;

  elsif v_kind = 'manager_cash' then
    if v_unit not in ('UZS', 'USD') then raise exception 'Valyuta: UZS yoki USD'; end if;
    if v_amt <= 0 then raise exception 'Summa 0 dan katta bo''lishi shart'; end if;
    perform public._get_or_create_manager_vault(v_org);
    update public.manager_vault_account
       set manager_cash_amount = round(manager_cash_amount + case when v_unit = 'UZS' then v_amt else 0 end, 2),
           manager_usd_amount = round(manager_usd_amount + case when v_unit = 'USD' then v_amt else 0 end, 2),
           updated_at = clock_timestamp()
     where organization_id = v_org;

  elsif v_kind in ('manager_scrap', 'manager_fine_gold') then
    v_phys := round(coalesce(p_physical_g, p_amount, 0)::numeric, 4);
    v_proba := round(p_proba::numeric, 2);
    if v_phys <= 0 then raise exception 'Fizik vazn 0 dan katta bo''lishi shart'; end if;
    v_eq := case when v_kind = 'manager_fine_gold' then 900 else 300 end; -- minimum proba (reused below)
    if v_proba is null or v_proba < v_eq or v_proba > 1000 then
      raise exception 'Proba noto''g''ri: % (lom 300 - 1000, toza oltin 900 - 1000)', v_proba using errcode = '22023';
    end if;
    v_eq := round(v_phys * v_proba / 585.0, 4); v_amt := v_phys;
    v_formula := v_phys || ' g x ' || v_proba || ' / 585 = ' || v_eq || ' g (585)';
    perform public._get_or_create_manager_vault(v_org);
    if v_kind = 'manager_scrap' then
      v_unit := 'SCRAP';
      update public.manager_vault_account
         set manager_scrap_grams = round(manager_scrap_grams + v_eq, 4),
             manager_scrap_physical_g = round(coalesce(manager_scrap_physical_g, 0) + v_phys, 4),
             manager_scrap_585_eq_g = round(coalesce(manager_scrap_585_eq_g, 0) + v_eq, 4), updated_at = clock_timestamp()
       where organization_id = v_org;
    else
      v_unit := 'FINE';
      update public.manager_vault_account
         set manager_refined_gold_grams = round(manager_refined_gold_grams + v_eq, 4),
             manager_refined_gold_fine_grams = round(coalesce(manager_refined_gold_fine_grams, 0) + v_phys * v_proba / 1000.0, 4),
             updated_at = clock_timestamp()
       where organization_id = v_org;
    end if;

  elsif v_kind = 'other' then
    -- decision O-6: other debts / claims kept apart - never added to factory, seller or customer balances
    if v_side not in ('asset', 'liability') then raise exception 'Yo''nalish: asset (bizga qarz) yoki liability (bizning qarzimiz)'; end if;
    if nullif(btrim(p_other_type), '') is null or nullif(btrim(p_counterparty), '') is null then
      raise exception 'Qarz turi va qarshi tomon kiritilishi shart' using errcode = '22023';
    end if;
    if v_unit not in ('UZS', 'USD', 'G585', 'GOLD') then raise exception 'Birlik: UZS, USD, G585 yoki GOLD (proba bilan)'; end if;
    if v_amt <= 0 then raise exception 'Summa 0 dan katta bo''lishi shart'; end if;
    if v_unit = 'G585' then v_eq := v_amt;
    elsif v_unit = 'GOLD' then
      v_proba := round(p_proba::numeric, 2);
      if v_proba is null or v_proba < 300 or v_proba > 1000 then raise exception 'Proba noto''g''ri'; end if;
      v_phys := v_amt; v_eq := round(v_amt * v_proba / 585.0, 4);
    else
      if coalesce(p_lom_rate, 0) <= 0 or (v_unit = 'USD' and coalesce(p_usd_rate, 0) <= 0) then
        raise exception 'ERR_RATE_REQUIRED: 585 ekvivalenti uchun kurs(lar) kiritilishi shart' using errcode = '22023';
      end if;
      v_eq := round(case when v_unit = 'UZS' then v_amt else v_amt * p_usd_rate end / p_lom_rate, 4);
    end if;
    v_formula := v_amt || ' ' || v_unit || ' = ' || v_eq || ' g (585)';
  else
    raise exception 'Noma''lum boshlang''ich hujjat turi: %', v_kind using errcode = '22023';
  end if;

  insert into public.opening_documents (id, organization_id, opening_period_id, document_no, kind, effective_t0, seller_id,
    customer_id, unit, side, amount, physical_g, proba, factory_markup_pct, seller_markup_pct, usd_rate, lom_rate, equiv_585_g,
    seller_obligation_g, factory_obligation_g, formula, counterparty, other_type, model_id, product_name, factory_receipt_id,
    consignment_id, legacy_debt_id, source_document_id, notes, created_by, idempotency_key)
  values (v_doc_id, v_org, v_per.id, v_no, v_kind, v_per.t0, v_seller, p_customer_id, v_unit, v_side, v_amt, v_phys, v_proba,
    p_factory_markup_pct, p_seller_markup_pct, nullif(p_usd_rate, 0), nullif(p_lom_rate, 0), v_eq, v_sobl, coalesce(v_fobl, 0),
    v_formula, nullif(btrim(p_counterparty), ''), nullif(btrim(p_other_type), ''), p_model_id, nullif(btrim(p_product_name), ''),
    v_rcp_id, v_con_id, v_leg_id, p_source_document_id, nullif(btrim(p_notes), ''), v_emp, v_key);
  if v_rcp_id is not null and v_kind = 'manager_inventory' or (v_kind = 'seller_inventory' and p_source_document_id is null) then
    update public.factory_receipts set opening_document_id = v_doc_id where id = v_rcp_id;
  end if;
  if v_seller is not null and v_kind in ('seller_obligation', 'customer_currency', 'customer_gram', 'seller_inventory') then
    perform public.recalc_seller_gold_account(v_seller, v_org);
  end if;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, new_data)
  values (v_org, 'opening_documents', v_doc_id::text, 'RECORD_OPENING_DOCUMENT', auth.uid(),
    jsonb_build_object('document_no', v_no, 'kind', v_kind, 'unit', v_unit, 'side', v_side, 'amount', v_amt, 'equiv_585_g', v_eq,
                       'seller_obligation_g', v_sobl, 'factory_obligation_g', v_fobl, 'formula', v_formula, 'usd_rate', p_usd_rate,
                       'lom_rate', p_lom_rate, 'opening_period_id', v_per.id, 't0', v_per.t0, 'employee_id', v_emp));
  v_res := jsonb_build_object('status', 'ok', 'document_id', v_doc_id, 'document_no', v_no, 'kind', v_kind, 'amount', v_amt,
             'unit', v_unit, 'equiv_585_g', v_eq, 'seller_obligation_g', v_sobl, 'factory_obligation_g', v_fobl, 'formula', v_formula,
             'factory_receipt_id', v_rcp_id, 'consignment_id', v_con_id, 'legacy_debt_id', v_leg_id);
  perform public.save_idempotency_response(v_key, 'rpc_record_opening_document', v_res, v_payload);
  return v_res;
end;
$function$;
revoke all on function public.rpc_record_opening_document(text, numeric, text, text, uuid, uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.rpc_record_opening_document(text, numeric, text, text, uuid, uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid, uuid, text, text, text, text, text) to authenticated;

-- cancel a wrong opening document while the opening period is in draft (after the baseline: locked)
create or replace function public.rpc_cancel_opening_document(p_document_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org    uuid := public.current_organization_id();
  v_emp    uuid := public.current_employee_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_d      public.opening_documents%rowtype;
  v_per    public.opening_periods%rowtype;
  v_rcp    public.factory_receipts%rowtype;
  v_con    public.seller_consignments%rowtype;
  v_v      public.manager_vault_account%rowtype;
  v_ts     timestamptz := clock_timestamp();
  v_res    jsonb;
  v_existing jsonb;
  v_payload jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  if v_reason is null then raise exception 'Bekor qilish sababi kiritilishi shart'; end if;
  v_payload := jsonb_build_object('document', p_document_id, 'reason', v_reason);
  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_cancel_opening_document', v_payload);
  if v_existing is not null then return v_existing; end if;
  select * into v_d from public.opening_documents where id = p_document_id and organization_id = v_org for update;
  if v_d.id is null then raise exception 'Boshlang''ich hujjat topilmadi'; end if;
  select * into v_per from public.opening_periods where id = v_d.opening_period_id for update;
  if v_per.status <> 'draft' then
    raise exception 'ERR_OPENING_LOCKED: boshlang''ich hisob tasdiqlangan - hujjatni bekor qilib bo''lmaydi' using errcode = '55000';
  end if;
  if v_d.status <> 'active' then raise exception 'Hujjat allaqachon bekor qilingan (%)', v_d.document_no; end if;

  if v_d.kind = 'manager_inventory' then
    if exists (select 1 from public.opening_documents s where s.source_document_id = v_d.id and s.status = 'active') then
      raise exception 'Avval bu ombordan sotuvchiga berilgan boshlang''ich hujjatlarni bekor qiling' using errcode = '55000';
    end if;
    perform public.rpc_reverse_factory_receipt(v_d.factory_receipt_id, 'BOSHLANG''ICH HUJJAT BEKOR: ' || v_reason, 'opening-cancel:' || v_d.id);
  elsif v_d.kind = 'seller_inventory' then
    select * into v_con from public.seller_consignments where id = v_d.consignment_id for update;
    if exists (select 1 from public.consignment_pieces p where p.consignment_id = v_con.id and p.status <> 'held_by_seller') then
      raise exception 'Bu sotuvchi omboridan savdo yoki qaytarish bo''lgan - avval ularni bekor qiling' using errcode = '55000';
    end if;
    update public.consignment_pieces set status = 'cancelled', updated_at = v_ts where consignment_id = v_con.id;
    update public.seller_consignments set status = 'cancelled', cancelled_at = v_ts, updated_at = v_ts where id = v_con.id;
    select * into v_rcp from public.factory_receipts where id = v_d.factory_receipt_id for update;
    if v_d.source_document_id is null then
      -- the opening receipt made for these goods goes away with them (factory obligation and received grams back)
      update public.factory_receipts set status = 'reversed', reversed_at = v_ts, available_physical_g = 0, updated_at = v_ts where id = v_rcp.id;
      perform public._goldia_vault_factory_add(v_org, -v_rcp.factory_obligation_g, 0);
      update public.manager_vault_account set total_factory_received_g = round(greatest(0, total_factory_received_g - v_rcp.original_physical_g), 4)
       where organization_id = v_org;
    else
      -- back to the manager's opening inventory
      update public.factory_receipts
         set available_physical_g = round(available_physical_g + v_d.amount, 4),
             transferred_physical_g = round(greatest(0, transferred_physical_g - v_d.amount), 4),
             status = 'in_manager_stock', updated_at = v_ts
       where id = v_rcp.id;
    end if;
    update public.manager_vault_account set manager_physical_stock_g = public.get_manager_available_stock_grams(v_org) where organization_id = v_org;
  elsif v_d.kind in ('factory_obligation', 'factory_advance') then
    if v_d.kind = 'factory_obligation' then perform public._goldia_vault_factory_add(v_org, -v_d.amount, 0);
    else perform public._goldia_vault_factory_add(v_org, 0, -v_d.amount); end if;
  elsif v_d.kind = 'customer_gram' then
    perform public.rpc_reverse_client_legacy_debt(v_d.legacy_debt_id, 'BOSHLANG''ICH HUJJAT BEKOR: ' || v_reason, 'opening-cancel:' || v_d.id);
  elsif v_d.kind = 'customer_currency' then
    perform public._goldia_currency_account_add(v_org, v_d.customer_id, v_d.seller_id, v_d.unit,
      case v_d.side when 'debt' then -v_d.amount else v_d.amount end);
  elsif v_d.kind in ('manager_cash', 'manager_scrap', 'manager_fine_gold') then
    select * into v_v from public.manager_vault_account where organization_id = v_org for update;
    if (v_d.kind = 'manager_cash' and ((v_d.unit = 'UZS' and v_v.manager_cash_amount < v_d.amount) or (v_d.unit = 'USD' and v_v.manager_usd_amount < v_d.amount)))
       or (v_d.kind = 'manager_scrap' and v_v.manager_scrap_grams < v_d.equiv_585_g - 0.00005)
       or (v_d.kind = 'manager_fine_gold' and v_v.manager_refined_gold_grams < v_d.equiv_585_g - 0.00005) then
      raise exception 'Menejer seyfida bu miqdor qolmagan - bekor qilib bo''lmaydi' using errcode = '55000';
    end if;
    update public.manager_vault_account
       set manager_cash_amount = round(manager_cash_amount - case when v_d.kind = 'manager_cash' and v_d.unit = 'UZS' then v_d.amount else 0 end, 2),
           manager_usd_amount = round(manager_usd_amount - case when v_d.kind = 'manager_cash' and v_d.unit = 'USD' then v_d.amount else 0 end, 2),
           manager_scrap_grams = round(manager_scrap_grams - case when v_d.kind = 'manager_scrap' then v_d.equiv_585_g else 0 end, 4),
           manager_scrap_physical_g = round(coalesce(manager_scrap_physical_g, 0) - case when v_d.kind = 'manager_scrap' then v_d.physical_g else 0 end, 4),
           manager_scrap_585_eq_g = round(coalesce(manager_scrap_585_eq_g, 0) - case when v_d.kind = 'manager_scrap' then v_d.equiv_585_g else 0 end, 4),
           manager_refined_gold_grams = round(manager_refined_gold_grams - case when v_d.kind = 'manager_fine_gold' then v_d.equiv_585_g else 0 end, 4),
           manager_refined_gold_fine_grams = round(coalesce(manager_refined_gold_fine_grams, 0)
             - case when v_d.kind = 'manager_fine_gold' then v_d.physical_g * v_d.proba / 1000.0 else 0 end, 4),
           updated_at = v_ts
     where organization_id = v_org;
  end if;
  update public.opening_documents set status = 'cancelled', cancelled_at = v_ts, cancelled_by = v_emp, cancel_reason = v_reason where id = v_d.id;
  if v_d.seller_id is not null then perform public.recalc_seller_gold_account(v_d.seller_id, v_org); end if;
  insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, old_data, new_data, reason)
  values (v_org, 'opening_documents', v_d.id::text, 'CANCEL_OPENING_DOCUMENT', auth.uid(),
          jsonb_build_object('status', 'active', 'document_no', v_d.document_no, 'kind', v_d.kind, 'amount', v_d.amount),
          jsonb_build_object('status', 'cancelled', 'employee_id', v_emp), v_reason);
  v_res := jsonb_build_object('status', 'ok', 'document_id', v_d.id, 'document_no', v_d.document_no);
  perform public.save_idempotency_response(p_idempotency_key, 'rpc_cancel_opening_document', v_res, v_payload);
  return v_res;
end;
$function$;
revoke all on function public.rpc_cancel_opening_document(uuid, text, text) from public, anon;
grant execute on function public.rpc_cancel_opening_document(uuid, text, text) to authenticated;

-- ================================================================== 5. opening state + reconciliation (read only)
create or replace function public.rpc_get_opening_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_org uuid := public.current_organization_id();
  v_per public.opening_periods%rowtype;
  v_res jsonb;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi',
                                             'accountant', 'buxgalter']);
  select * into v_per from public.opening_periods where organization_id = v_org and status in ('draft', 'locked')
   order by created_at desc limit 1;
  with d as (select * from public.opening_documents where opening_period_id = v_per.id),
  sel as (select e.id, coalesce(e.name, e.full_name) as name, a.current_physical_stock_g as stock, a.seller_owes_manager_g as owes,
                 a.seller_till_cash_amount as cash, a.seller_till_usd_amount as usd, a.seller_till_scrap_585_eq_g as scrap,
                 public.get_seller_available_stock_grams(e.id) as held
            from public.employees e left join public.seller_gold_accounts a on a.seller_id = e.id
           where e.organization_id = v_org and public._goldia_is_seller_role(e.role::text))
  select jsonb_build_object(
    'status', 'ok',
    'period', case when v_per.id is null then null else to_jsonb(v_per) end,
    'restart', (select to_jsonb(r) - 'idempotency_key' from public.financial_restarts r where r.id = v_per.restart_id),
    'backup_verifications', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'backup_reference', b.backup_reference,
         'verified_at', b.verified_at, 'usable', b.consumed_by_restart_id is null and b.verified_at > now() - interval '24 hours')
         order by b.verified_at desc) from public.financial_backup_verifications b where b.organization_id = v_org), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'document_no', d.document_no, 'kind', d.kind, 'status', d.status,
         'unit', d.unit, 'side', d.side, 'amount', d.amount, 'physical_g', d.physical_g, 'proba', d.proba, 'equiv_585_g', d.equiv_585_g,
         'seller_obligation_g', d.seller_obligation_g, 'factory_obligation_g', d.factory_obligation_g, 'formula', d.formula,
         'factory_markup_pct', d.factory_markup_pct, 'seller_markup_pct', d.seller_markup_pct, 'usd_rate', d.usd_rate, 'lom_rate', d.lom_rate,
         'seller_id', d.seller_id, 'seller_name', (select coalesce(e.name, e.full_name) from public.employees e where e.id = d.seller_id),
         'customer_id', d.customer_id, 'customer_name', (select c.contact_name from public.customers c where c.id = d.customer_id),
         'counterparty', d.counterparty, 'other_type', d.other_type, 'notes', d.notes, 'created_at', d.created_at,
         'created_by_name', (select coalesce(e.name, e.full_name) from public.employees e where e.id = d.created_by),
         'cancelled_at', d.cancelled_at, 'cancel_reason', d.cancel_reason) order by d.created_at) from d), '[]'::jsonb),
    'totals', jsonb_build_object(
      'manager_stock_g', public.get_manager_available_stock_grams(v_org),
      'sellers_stock_g', (select coalesce(sum(held), 0) from sel),
      'factory_obligation_g', (select current_factory_obligation_g from public.manager_vault_account where organization_id = v_org),
      'factory_advance_g', (select current_factory_advance_g from public.manager_vault_account where organization_id = v_org),
      'sellers_obligation_g', (select coalesce(sum(owes), 0) from sel),
      'customers_585_debt_g', (select coalesce(sum(current_debt_grams), 0) from public.client_gold_accounts where organization_id = v_org),
      'customers_585_advance_g', (select coalesce(sum(advance_balance_grams), 0) from public.client_gold_accounts where organization_id = v_org),
      'customers_uzs_debt', (select coalesce(sum(debt_amount), 0) from public.client_currency_accounts where organization_id = v_org and currency = 'UZS'),
      'customers_uzs_advance', (select coalesce(sum(advance_amount), 0) from public.client_currency_accounts where organization_id = v_org and currency = 'UZS'),
      'customers_usd_debt', (select coalesce(sum(debt_amount), 0) from public.client_currency_accounts where organization_id = v_org and currency = 'USD'),
      'customers_usd_advance', (select coalesce(sum(advance_amount), 0) from public.client_currency_accounts where organization_id = v_org and currency = 'USD'),
      'manager_uzs', (select manager_cash_amount from public.manager_vault_account where organization_id = v_org),
      'manager_usd', (select manager_usd_amount from public.manager_vault_account where organization_id = v_org),
      'manager_scrap_physical_g', (select manager_scrap_physical_g from public.manager_vault_account where organization_id = v_org),
      'manager_scrap_585_g', (select manager_scrap_grams from public.manager_vault_account where organization_id = v_org),
      'manager_fine_585_g', (select manager_refined_gold_grams from public.manager_vault_account where organization_id = v_org),
      -- D-1 (2026-11-11): every piece on the manager or a seller came FACTORY -> MANAGER; the factory obligation is
      -- created only at that stage (opening receipts) plus the obligation for goods already sold but not yet settled
      'opening_receipts_physical_g', (select coalesce(sum(r.original_physical_g), 0) from public.factory_receipts r
           where r.organization_id = v_org and r.status <> 'reversed' and r.opening_document_id is not null),
      'factory_obligation_from_goods_g', (select coalesce(sum(r.factory_obligation_g), 0) from public.factory_receipts r
           where r.organization_id = v_org and r.status <> 'reversed' and r.opening_document_id is not null),
      'factory_obligation_without_goods_g', (select coalesce(sum(amount), 0) from d where kind = 'factory_obligation' and status = 'active'),
      'factory_advance_documents_g', (select coalesce(sum(amount), 0) from d where kind = 'factory_advance' and status = 'active'),
      'other_assets_585_g', (select assets_g from public._goldia_opening_other(v_org)),
      'other_liabilities_585_g', (select liabilities_g from public._goldia_opening_other(v_org))),
    'sellers', coalesce((select jsonb_agg(jsonb_build_object('seller_id', s.id, 'name', s.name, 'stock_g', s.stock, 'held_g', s.held,
         'obligation_g', s.owes, 'till_uzs', s.cash, 'till_usd', s.usd, 'till_scrap_g', s.scrap) order by s.name) from sel s), '[]'::jsonb),
    -- every line must be true before the baseline (the baseline itself refuses non-empty seller tills)
    'checks', jsonb_build_object(
      'seller_tills_empty', not exists (select 1 from sel where coalesce(cash, 0) <> 0 or coalesce(usd, 0) <> 0 or coalesce(scrap, 0) <> 0),
      'seller_stock_equals_held_pieces', not exists (select 1 from sel where abs(coalesce(stock, 0) - coalesce(held, 0)) > 0.0001),
      'customer_585_equals_documents', (select coalesce(sum(case side when 'debt' then amount else -amount end), 0) from d
                                          where kind = 'customer_gram' and status = 'active')
        = (select coalesce(sum(current_debt_grams - advance_balance_grams), 0) from public.client_gold_accounts where organization_id = v_org),
      'customer_uzs_equals_documents', (select coalesce(sum(case side when 'debt' then amount else -amount end), 0) from d
                                          where kind = 'customer_currency' and unit = 'UZS' and status = 'active')
        = (select coalesce(sum(debt_amount - advance_amount), 0) from public.client_currency_accounts where organization_id = v_org and currency = 'UZS'),
      'customer_usd_equals_documents', (select coalesce(sum(case side when 'debt' then amount else -amount end), 0) from d
                                          where kind = 'customer_currency' and unit = 'USD' and status = 'active')
        = (select coalesce(sum(debt_amount - advance_amount), 0) from public.client_currency_accounts where organization_id = v_org and currency = 'USD'),
      -- D-1: manager stock + seller stock = the grams of the opening receipts (nothing on hand outside the chain)
      'inventory_equals_opening_receipts', abs(public.get_manager_available_stock_grams(v_org) + (select coalesce(sum(held), 0) from sel)
          - (select coalesce(sum(r.original_physical_g), 0) from public.factory_receipts r
              where r.organization_id = v_org and r.status <> 'reversed' and r.opening_document_id is not null)) < 0.0001,
      -- D-1: the factory account = opening receipts (goods) + sold-not-settled obligations - advances; a manager ->
      -- seller transfer neither creates nor lowers it
      'factory_obligation_equals_documents', abs(coalesce((select current_factory_obligation_g - current_factory_advance_g
            from public.manager_vault_account where organization_id = v_org), 0)
          - ((select coalesce(sum(r.factory_obligation_g), 0) from public.factory_receipts r
               where r.organization_id = v_org and r.status <> 'reversed' and r.opening_document_id is not null)
             + (select coalesce(sum(case kind when 'factory_obligation' then amount else -amount end), 0) from d
                 where kind in ('factory_obligation', 'factory_advance') and status = 'active'))) < 0.0001,
      'non_opening_documents_after_restart', (select count(*) from public.jewelry_sales s where s.organization_id = v_org and v_per.id is not null and s.status not in ('reversed', 'cancelled')
                                                and s.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        + (select count(*) from public.gold_settlements g where g.organization_id = v_org and v_per.id is not null and coalesce(g.status, 'confirmed') not in ('reversed', 'cancelled')
                                                and g.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        + (select count(*) from public.client_currency_settlements c where c.organization_id = v_org and v_per.id is not null and c.status <> 'reversed'
                                                and c.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        -- D-1 rule 7: the opening is entered through opening documents only (no ordinary receipt / consignment /
        -- legacy entry / capital / factory handover / purchase in the draft)
        + (select count(*) from public.factory_receipts r where r.organization_id = v_org and v_per.id is not null and r.opening_document_id is null and r.status <> 'reversed'
             and r.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        + (select count(*) from public.seller_consignments c where c.organization_id = v_org and v_per.id is not null
             and c.status <> 'cancelled' and not exists (select 1 from public.opening_documents o where o.consignment_id = c.id)
             and c.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        + (select count(*) from public.client_legacy_debts l where l.organization_id = v_org and v_per.id is not null and l.entry_type <> 'opening' and l.status <> 'reversed'
             and l.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        + (select count(*) from public.financial_transactions f where f.organization_id = v_org and v_per.id is not null and f.status <> 'reversed'
             and f.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        + (select count(*) from public.factory_gold_handovers h where h.organization_id = v_org and v_per.id is not null and h.status <> 'reversed'
             and h.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))
        + (select count(*) from public.gold_purchases g where g.organization_id = v_org and v_per.id is not null and g.status <> 'reversed'
             and g.created_at > (select created_at from public.financial_restarts where id = v_per.restart_id))))
    into v_res;
  return v_res;
end;
$function$;
revoke all on function public.rpc_get_opening_state() from public, anon;
grant execute on function public.rpc_get_opening_state() to authenticated;
"""

head = """-- 085 — Goldia Sales: controlled financial restart + opening accounting (decisions O-1 … O-6, 2026-11-11).
-- Generated by docs/releases/production-075/gen-085-opening.py. The migration creates schema and functions ONLY:
-- no restart runs, no balance or document changes. A restart is started later by the director (typed confirmation,
-- reason, T0, a backup verified by restore within 24 hours), opening documents are entered by the manager / director
-- while the opening period is in draft, and the baseline confirmation locks it.
"""
changed, rb = [], []
for fn, pairs in P.items():
    body, src = latest(fn)
    changed.append(f"\n-- ===== {fn} (from {src})\n" + patch(body, pairs, fn) + ";\n")
    rb.append(f"\n-- ===== {fn} (restore the body of {src})\n" + body + ";\n")
(REPO / "supabase/migrations/20260101000085_goldia_financial_restart_and_opening_accounting.sql").write_text(head + NEW + "".join(changed), encoding="utf-8")
(REPO / "supabase/rollback/20260101000085_rollback.sql").write_text(
    "-- Rollback of 085: refused once a restart or an opening document exists (the archive and the opening facts would be lost).\n"
    "do $g$ begin\n"
    "  if exists (select 1 from public.financial_restarts) or exists (select 1 from public.opening_documents) then\n"
    "    raise exception 'ROLLBACK 085 REFUSED: financial restarts / opening documents exist';\n"
    "  end if; end $g$;\n"
    + "".join(rb)
    + "drop function if exists public.rpc_get_opening_state();\n"
      "drop function if exists public.rpc_cancel_opening_document(uuid, text, text);\n"
      "drop function if exists public.rpc_record_opening_document(text, numeric, text, text, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, uuid, uuid, text, text, text, text, text);\n"
      "drop function if exists public.rpc_financial_restart(text, text, timestamptz, uuid, text);\n"
      "drop function if exists public._goldia_currency_account_add(uuid, uuid, uuid, text, numeric);\n"
      "drop function if exists public._goldia_vault_factory_add(uuid, numeric, numeric);\n"
      "drop function if exists public._goldia_opening_other(uuid);\n"
      "drop function if exists public._goldia_opening_factory_net(uuid);\n"
      "drop function if exists public._goldia_opening_seller_obligation(uuid, uuid);\n"
      "alter table public.client_legacy_debts drop constraint if exists client_legacy_debts_entry_type_check;\n"
      "alter table public.client_legacy_debts add constraint client_legacy_debts_entry_type_check\n"
      "  check (entry_type in ('initial', 'reconciliation_adjustment', 'manual_addition', 'reversal'));\n"
      "alter table public.factory_receipts drop column if exists opening_document_id;\n"
      "drop table if exists public.opening_documents;\n"
      "drop table if exists public.opening_periods;\n"
      "drop table if exists public.financial_backup_verifications;\n"
      "drop table if exists public.financial_restart_items;\n"
      "drop table if exists public.financial_restarts;\n", encoding="utf-8")
print("ok", len(P), "functions")
