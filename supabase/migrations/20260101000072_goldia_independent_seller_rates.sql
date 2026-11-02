-- JewelryFlow ERP Migration 20260101000072
-- GOLDIA SALES: independent seller LOM / USD rates with immutable snapshots
--
-- 1. seller_rates: each seller's own LOM (UZS per 585 g) and USD (UZS per USD) rate. Sellers change ONLY their
--    own rates through rpc_set_my_seller_rates (validated server-side, limits from seller_rate_limits, every
--    change written to seller_rate_history and audit_logs). No client writes on any of the new tables.
-- 2. rpc_record_client_settlement: when a seller records a cash / USD payment the server uses that seller's
--    stored rate (a different rate sent by the browser is rejected, never trusted). Without an own LOM rate the
--    official 585 rate is used exactly as before; a USD payment needs an own USD rate. Management entries are
--    unchanged. The rate is stored on the settlement (gold_rate_applied / applied_usd_rate) as before.
-- 3. Valued till pool: every cash / USD payment recorded from now on adds its UZS/USD amount AND the grams it
--    was credited at to the seller's till pool (seller_gold_accounts.till_valued_*). A handover to the manager
--    closes the seller's obligation with exactly those captured grams (average of the pool), so changing a rate
--    between collection and handover can neither create nor destroy grams. Cash already in the till before
--    072 (no captured value) keeps the pre-072 rule (official rate for sellers). Reversals of payments and
--    handovers move the pool back. The 066 manager valued pool and company rate difference keep reading
--    cash_equivalent_grams / usd_equivalent_grams, which are now the captured grams -> no double counting.
-- 4. No existing row is changed: debts, settlements, tills and balances stay identical; pools start at 0.
-- Rollback: supabase/rollback/20260101000072_rollback.sql

-- ------------------------------------------------------------------ storage
create table if not exists public.seller_rate_limits (
  organization_id        uuid primary key references public.organizations(id) on delete cascade,
  lom_min_uzs            numeric(18, 2) not null default 100000,
  lom_max_uzs            numeric(18, 2) not null default 3000000,
  usd_min_uzs            numeric(18, 2) not null default 5000,
  usd_max_uzs            numeric(18, 2) not null default 30000,
  max_lom_deviation_pct  numeric(6, 2)  default 25,  -- vs the official 585 rate; null = no deviation check
  updated_by             uuid,
  updated_at             timestamptz not null default now(),
  constraint chk_seller_rate_limits check (
    lom_min_uzs > 0 and lom_max_uzs > lom_min_uzs and usd_min_uzs > 0 and usd_max_uzs > usd_min_uzs
    and (max_lom_deviation_pct is null or (max_lom_deviation_pct > 0 and max_lom_deviation_pct <= 100)))
);

create table if not exists public.seller_rates (
  seller_id        uuid primary key references public.employees(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lom_rate_uzs     numeric(18, 2) check (lom_rate_uzs is null or lom_rate_uzs > 0),
  usd_rate_uzs     numeric(18, 2) check (usd_rate_uzs is null or usd_rate_uzs > 0),
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);
create index if not exists idx_seller_rates_org on public.seller_rates(organization_id);

create table if not exists public.seller_rate_history (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  seller_id        uuid not null references public.employees(id) on delete cascade,
  old_lom_rate_uzs numeric(18, 2),
  new_lom_rate_uzs numeric(18, 2),
  old_usd_rate_uzs numeric(18, 2),
  new_usd_rate_uzs numeric(18, 2),
  changed_by       uuid,
  reason           text,
  changed_at       timestamptz not null default now()
);
create index if not exists idx_seller_rate_history_seller on public.seller_rate_history(seller_id, changed_at desc);

alter table public.seller_gold_accounts
  add column if not exists till_valued_cash_uzs   numeric(18, 2) not null default 0,
  add column if not exists till_valued_cash_585_g numeric(18, 6) not null default 0,
  add column if not exists till_valued_usd        numeric(18, 2) not null default 0,
  add column if not exists till_valued_usd_585_g  numeric(18, 6) not null default 0;

-- What each settlement put into / took out of the seller's valued till pool (so reversals are exact).
alter table public.gold_settlements
  add column if not exists till_pool_cash_uzs   numeric(18, 2) not null default 0,
  add column if not exists till_pool_cash_585_g numeric(18, 6) not null default 0,
  add column if not exists till_pool_usd        numeric(18, 2) not null default 0,
  add column if not exists till_pool_usd_585_g  numeric(18, 6) not null default 0;

-- ------------------------------------------------------------------ access: read through RLS, write only through RPCs
alter table public.seller_rate_limits  enable row level security;
alter table public.seller_rates        enable row level security;
alter table public.seller_rate_history enable row level security;

revoke all on public.seller_rate_limits, public.seller_rates, public.seller_rate_history from public, anon, authenticated;
grant select on public.seller_rate_limits, public.seller_rates, public.seller_rate_history to authenticated;
grant all on public.seller_rate_limits, public.seller_rates, public.seller_rate_history to service_role;

create or replace function public._goldia_is_management_role(p_role text)
returns boolean
language sql
immutable
as $$
  select coalesce(lower(p_role), '') in ('admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
                                         'manager', 'production_manager', 'boshqaruvchi');
$$;

drop policy if exists seller_rate_limits_select on public.seller_rate_limits;
create policy seller_rate_limits_select on public.seller_rate_limits for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists seller_rates_select on public.seller_rates;
create policy seller_rates_select on public.seller_rates for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or seller_id = public.current_employee_id()));

drop policy if exists seller_rate_history_select on public.seller_rate_history;
create policy seller_rate_history_select on public.seller_rate_history for select to authenticated
  using (organization_id = public.current_organization_id()
         and (public._goldia_is_management_role(public.current_employee_role_text())
              or seller_id = public.current_employee_id()));

-- ------------------------------------------------------------------ limits and validation
create or replace function public._goldia_seller_rate_limits(p_org_id uuid)
returns public.seller_rate_limits
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.seller_rate_limits%rowtype;
begin
  select * into v from public.seller_rate_limits where organization_id = p_org_id;
  if not found then
    v.organization_id := p_org_id;
    v.lom_min_uzs := 100000; v.lom_max_uzs := 3000000;
    v.usd_min_uzs := 5000;   v.usd_max_uzs := 30000;
    v.max_lom_deviation_pct := 25;
  end if;
  return v;
end;
$$;

create or replace function public._goldia_validate_rate_value(p_value numeric, p_min numeric, p_max numeric, p_label text)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_value is null or p_value::text in ('NaN', 'Infinity', '-Infinity') or p_value <= 0 then
    raise exception 'ERR_RATE_INVALID: % musbat va chekli son bo''lishi shart', p_label using errcode = '22023';
  end if;
  if p_value < p_min or p_value > p_max then
    raise exception 'ERR_RATE_OUT_OF_RANGE: % % ruxsat etilgan oraliqdan tashqarida (% — %)', p_label, p_value, p_min, p_max
      using errcode = '22023';
  end if;
  return round(p_value, 2);
end;
$$;

-- ------------------------------------------------------------------ seller sets own rates
create or replace function public.rpc_set_my_seller_rates(
  p_lom_rate_uzs numeric default null,
  p_usd_rate_uzs numeric default null,
  p_reason       text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org     uuid := public.current_organization_id();
  v_role    text := public.current_employee_role_text();
  v_emp     uuid := public.current_employee_id();
  v_lim     public.seller_rate_limits%rowtype;
  v_old     public.seller_rates%rowtype;
  v_lom     numeric(18, 2);
  v_usd     numeric(18, 2);
  v_off     numeric(18, 2);
begin
  if v_org is null or v_emp is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  -- Only a seller sets rates, and only their own (the seller id is never taken from the request).
  perform public.assert_erp_permission(array['sales', 'seller', 'sotuvchi']);
  if not public._goldia_is_seller_role(v_role) then
    raise exception 'Ruxsat etilmadi: kursni faqat sotuvchi o''zi uchun belgilaydi' using errcode = '42501';
  end if;
  if p_lom_rate_uzs is null and p_usd_rate_uzs is null then
    raise exception 'ERR_RATE_INVALID: LOM yoki USD kursidan kamida bittasi kiritilishi shart' using errcode = '22023';
  end if;

  v_lim := public._goldia_seller_rate_limits(v_org);

  insert into public.seller_rates (seller_id, organization_id, updated_by)
  values (v_emp, v_org, v_emp)
  on conflict (seller_id) do nothing;
  select * into v_old from public.seller_rates where seller_id = v_emp and organization_id = v_org for update;
  if not found then
    raise exception 'Ruxsat etilmadi' using errcode = '42501';
  end if;

  v_lom := v_old.lom_rate_uzs;
  v_usd := v_old.usd_rate_uzs;
  if p_lom_rate_uzs is not null then
    v_lom := public._goldia_validate_rate_value(p_lom_rate_uzs, v_lim.lom_min_uzs, v_lim.lom_max_uzs, 'LOM kursi (UZS/g)');
    v_off := public._goldia_official_585_rate(v_org);
    if v_lim.max_lom_deviation_pct is not null and v_off is not null and v_off > 0
       and abs(v_lom - v_off) > v_off * v_lim.max_lom_deviation_pct / 100.0 then
      raise exception 'ERR_RATE_OUT_OF_RANGE: LOM kursi rasmiy 585 kursidan (% UZS/g) % foizdan ortiq farq qila olmaydi',
        v_off, v_lim.max_lom_deviation_pct using errcode = '22023';
    end if;
  end if;
  if p_usd_rate_uzs is not null then
    v_usd := public._goldia_validate_rate_value(p_usd_rate_uzs, v_lim.usd_min_uzs, v_lim.usd_max_uzs, 'USD kursi (UZS)');
  end if;

  update public.seller_rates
     set lom_rate_uzs = v_lom, usd_rate_uzs = v_usd, updated_by = v_emp, updated_at = now()
   where seller_id = v_emp;

  insert into public.seller_rate_history (organization_id, seller_id, old_lom_rate_uzs, new_lom_rate_uzs,
                                          old_usd_rate_uzs, new_usd_rate_uzs, changed_by, reason)
  values (v_org, v_emp, v_old.lom_rate_uzs, v_lom, v_old.usd_rate_uzs, v_usd, v_emp, p_reason);

  insert into public.audit_logs (table_name, record_id, action, actor_id, actor_role, old_data, new_data, reason, organization_id)
  values ('seller_rates', v_emp::text, 'SET_SELLER_RATES', v_emp, v_role,
          jsonb_build_object('lom_rate_uzs', v_old.lom_rate_uzs, 'usd_rate_uzs', v_old.usd_rate_uzs),
          jsonb_build_object('lom_rate_uzs', v_lom, 'usd_rate_uzs', v_usd), p_reason, v_org);

  return jsonb_build_object('status', 'ok', 'seller_id', v_emp, 'lom_rate_uzs', v_lom, 'usd_rate_uzs', v_usd,
                            'previous_lom_rate_uzs', v_old.lom_rate_uzs, 'previous_usd_rate_uzs', v_old.usd_rate_uzs);
end;
$$;

-- Seller: own rates only. Management: every seller of the organization (or one).
create or replace function public.rpc_get_seller_rates(p_seller_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := public.current_organization_id();
  v_role text := public.current_employee_role_text();
  v_emp  uuid := public.current_employee_id();
  v_lim  public.seller_rate_limits%rowtype;
  v_filter uuid;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi']);
  if public._goldia_is_seller_role(v_role) then
    if p_seller_id is not null and p_seller_id is distinct from v_emp then
      raise exception 'Ruxsat etilmadi: boshqa sotuvchining kursini ko''rish mumkin emas' using errcode = '42501';
    end if;
    v_filter := v_emp;
  else
    v_filter := p_seller_id;
  end if;
  v_lim := public._goldia_seller_rate_limits(v_org);
  return jsonb_build_object(
    'status', 'ok',
    'official_585_rate', public._goldia_official_585_rate(v_org),
    'limits', jsonb_build_object('lom_min_uzs', v_lim.lom_min_uzs, 'lom_max_uzs', v_lim.lom_max_uzs,
                                 'usd_min_uzs', v_lim.usd_min_uzs, 'usd_max_uzs', v_lim.usd_max_uzs,
                                 'max_lom_deviation_pct', v_lim.max_lom_deviation_pct),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object('seller_id', e.id, 'seller_name', coalesce(e.name, e.full_name),
               'lom_rate_uzs', r.lom_rate_uzs, 'usd_rate_uzs', r.usd_rate_uzs, 'updated_at', r.updated_at)
             order by coalesce(e.name, e.full_name))
        from public.employees e
        left join public.seller_rates r on r.seller_id = e.id and r.organization_id = v_org
       where e.organization_id = v_org
         and coalesce(e.is_active, true)
         and (v_filter is null and public._goldia_is_seller_role(coalesce(
                nullif(nullif(public.normalize_erp_role_token(e.role_type), 'worker'), 'viewer'),
                public.normalize_erp_role_token(e.role::text)))
              or e.id = v_filter)), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h order by h.changed_at desc) from (
        select seller_id, old_lom_rate_uzs, new_lom_rate_uzs, old_usd_rate_uzs, new_usd_rate_uzs, changed_by, reason, changed_at
          from public.seller_rate_history
         where organization_id = v_org and (v_filter is null or seller_id = v_filter)
         order by changed_at desc limit 50) h), '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_set_seller_rate_limits(
  p_lom_min_uzs numeric, p_lom_max_uzs numeric, p_usd_min_uzs numeric, p_usd_max_uzs numeric,
  p_max_lom_deviation_pct numeric default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := public.current_organization_id();
  v_emp  uuid := public.current_employee_id();
  v_old  public.seller_rate_limits%rowtype;
begin
  if v_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar', 'manager', 'production_manager', 'boshqaruvchi']);
  v_old := public._goldia_seller_rate_limits(v_org);
  insert into public.seller_rate_limits (organization_id, lom_min_uzs, lom_max_uzs, usd_min_uzs, usd_max_uzs, max_lom_deviation_pct, updated_by, updated_at)
  values (v_org, p_lom_min_uzs, p_lom_max_uzs, p_usd_min_uzs, p_usd_max_uzs, p_max_lom_deviation_pct, v_emp, now())
  on conflict (organization_id) do update set
    lom_min_uzs = excluded.lom_min_uzs, lom_max_uzs = excluded.lom_max_uzs,
    usd_min_uzs = excluded.usd_min_uzs, usd_max_uzs = excluded.usd_max_uzs,
    max_lom_deviation_pct = excluded.max_lom_deviation_pct, updated_by = v_emp, updated_at = now();
  insert into public.audit_logs (table_name, record_id, action, actor_id, actor_role, old_data, new_data, organization_id)
  values ('seller_rate_limits', v_org::text, 'SET_SELLER_RATE_LIMITS', v_emp, public.current_employee_role_text(),
          to_jsonb(v_old), jsonb_build_object('lom_min_uzs', p_lom_min_uzs, 'lom_max_uzs', p_lom_max_uzs,
            'usd_min_uzs', p_usd_min_uzs, 'usd_max_uzs', p_usd_max_uzs, 'max_lom_deviation_pct', p_max_lom_deviation_pct), v_org);
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ------------------------------------------------------------------ valued till pool (mirrors the 066 manager pool)
create or replace function public.trg_goldia_seller_till_pool()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acc    public.seller_gold_accounts%rowtype;
  v_take   numeric(18, 2);
  v_take_g numeric(18, 6);
begin
  if new.seller_id is null or new.direction not in ('client_to_seller', 'seller_to_manager') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.reversal_of_id is not null or coalesce(new.status, 'confirmed') <> 'confirmed' then
      return new;
    end if;
    if new.direction = 'client_to_seller' then
      -- record exactly what this payment adds to the pool
      new.till_pool_cash_uzs   := case when coalesce(new.cash_paid_amount, 0) > 0 then new.cash_paid_amount else 0 end;
      new.till_pool_cash_585_g := case when coalesce(new.cash_paid_amount, 0) > 0 then coalesce(new.cash_equivalent_grams, 0) else 0 end;
      new.till_pool_usd        := case when coalesce(new.usd_paid_amount, 0) > 0 then new.usd_paid_amount else 0 end;
      new.till_pool_usd_585_g  := case when coalesce(new.usd_paid_amount, 0) > 0 then coalesce(new.usd_equivalent_grams, 0) else 0 end;
      if new.till_pool_cash_uzs = 0 and new.till_pool_usd = 0 then
        return new;
      end if;
      insert into public.seller_gold_accounts (seller_id, organization_id, till_valued_cash_uzs, till_valued_cash_585_g,
                                               till_valued_usd, till_valued_usd_585_g, updated_at)
      values (new.seller_id, new.organization_id, new.till_pool_cash_uzs, new.till_pool_cash_585_g,
              new.till_pool_usd, new.till_pool_usd_585_g, now())
      on conflict (seller_id) do update set
        till_valued_cash_uzs   = round(seller_gold_accounts.till_valued_cash_uzs + excluded.till_valued_cash_uzs, 2),
        till_valued_cash_585_g = round(seller_gold_accounts.till_valued_cash_585_g + excluded.till_valued_cash_585_g, 6),
        till_valued_usd        = round(seller_gold_accounts.till_valued_usd + excluded.till_valued_usd, 2),
        till_valued_usd_585_g  = round(seller_gold_accounts.till_valued_usd_585_g + excluded.till_valued_usd_585_g, 6);
    else
      -- handover: the RPC already chose what it takes out of the pool
      update public.seller_gold_accounts
         set till_valued_cash_uzs   = round(greatest(0, till_valued_cash_uzs - new.till_pool_cash_uzs), 2),
             till_valued_cash_585_g = round(greatest(0, till_valued_cash_585_g - new.till_pool_cash_585_g), 6),
             till_valued_usd        = round(greatest(0, till_valued_usd - new.till_pool_usd), 2),
             till_valued_usd_585_g  = round(greatest(0, till_valued_usd_585_g - new.till_pool_usd_585_g), 6)
       where seller_id = new.seller_id;
    end if;
    return new;
  end if;

  -- UPDATE: a confirmed settlement was reversed -> move its own pool share back
  if old.status is distinct from 'reversed' and new.status = 'reversed' and new.reversal_of_id is null then
    select * into v_acc from public.seller_gold_accounts where seller_id = new.seller_id for update;
    if not found then
      return new;
    end if;
    if new.direction = 'client_to_seller' then
      if new.till_pool_cash_uzs > 0 then
        v_take   := least(v_acc.till_valued_cash_uzs, new.till_pool_cash_uzs);
        v_take_g := least(v_acc.till_valued_cash_585_g, new.till_pool_cash_585_g * v_take / new.till_pool_cash_uzs);
        v_acc.till_valued_cash_uzs := v_acc.till_valued_cash_uzs - v_take;
        v_acc.till_valued_cash_585_g := v_acc.till_valued_cash_585_g - v_take_g;
      end if;
      if new.till_pool_usd > 0 then
        v_take   := least(v_acc.till_valued_usd, new.till_pool_usd);
        v_take_g := least(v_acc.till_valued_usd_585_g, new.till_pool_usd_585_g * v_take / new.till_pool_usd);
        v_acc.till_valued_usd := v_acc.till_valued_usd - v_take;
        v_acc.till_valued_usd_585_g := v_acc.till_valued_usd_585_g - v_take_g;
      end if;
    else
      v_acc.till_valued_cash_uzs   := v_acc.till_valued_cash_uzs + new.till_pool_cash_uzs;
      v_acc.till_valued_cash_585_g := v_acc.till_valued_cash_585_g + new.till_pool_cash_585_g;
      v_acc.till_valued_usd        := v_acc.till_valued_usd + new.till_pool_usd;
      v_acc.till_valued_usd_585_g  := v_acc.till_valued_usd_585_g + new.till_pool_usd_585_g;
    end if;
    update public.seller_gold_accounts
       set till_valued_cash_uzs = round(v_acc.till_valued_cash_uzs, 2), till_valued_cash_585_g = round(v_acc.till_valued_cash_585_g, 6),
           till_valued_usd = round(v_acc.till_valued_usd, 2), till_valued_usd_585_g = round(v_acc.till_valued_usd_585_g, 6)
     where seller_id = new.seller_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_goldia_seller_till_pool on public.gold_settlements;
create trigger trg_goldia_seller_till_pool
  before insert or update of status on public.gold_settlements
  for each row execute function public.trg_goldia_seller_till_pool();

revoke all on function public.trg_goldia_seller_till_pool() from public, anon, authenticated;
revoke all on function public._goldia_seller_rate_limits(uuid) from public, anon, authenticated;
revoke all on function public._goldia_validate_rate_value(numeric, numeric, numeric, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ rpc_record_client_settlement (071 body + seller rates)
CREATE OR REPLACE FUNCTION public.rpc_record_client_settlement(p_customer_id uuid, p_sale_id uuid DEFAULT NULL::uuid, p_scrap_weight numeric DEFAULT 0, p_scrap_proba numeric DEFAULT NULL::numeric, p_cash_amount numeric DEFAULT 0, p_rate_per_gram numeric DEFAULT NULL::numeric, p_settlement_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_seller_id uuid DEFAULT NULL::uuid, p_usd_amount numeric DEFAULT 0, p_usd_rate numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_org        uuid := public.current_organization_id();
  v_seller            public.employees%rowtype;
  v_customer          public.customers%rowtype;
  v_rate              numeric(18, 2);
  v_usd_rate          numeric(18, 2);
  v_physical_scrap    numeric(14, 4);
  v_proba             numeric(6, 2);
  v_fine_gold         numeric(14, 4) := 0;
  v_scrap_585_eq      numeric(14, 4) := 0;
  v_cash              numeric(18, 2);
  v_usd               numeric(18, 2);
  v_cash_equiv        numeric(14, 4) := 0;
  v_usd_equiv         numeric(14, 4) := 0;
  v_total_settled     numeric(14, 4);
  v_settle_id         uuid;
  v_settle_no         text;
  v_client_acc        public.client_gold_accounts%rowtype;
  v_prev_debt         numeric(14, 4) := 0;
  v_applied_to_debt   numeric(14, 4) := 0;
  v_excess_advance    numeric(14, 4) := 0;
  v_rem_debt          numeric(14, 4) := 0;
  v_new_advance       numeric(14, 4) := 0;
  v_payload           jsonb;
  v_existing          jsonb;
  v_caller_role       text := public.current_employee_role_text();
  v_caller_emp_id     uuid := public.current_employee_id();
  v_official_rate     numeric(18, 2);
  v_seller_rate       public.seller_rates%rowtype;
  v_own_usd_rate      numeric(18, 2);
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);

  v_physical_scrap := round(greatest(0, coalesce(p_scrap_weight, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_amount, 0))::numeric, 2);
  v_usd  := round(greatest(0, coalesce(p_usd_amount, 0))::numeric, 2);

  if v_physical_scrap <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'To''lov uchun lom vazni, naqd so''m yoki dollar summasi kiritilishi shart';
  end if;

  -- 1. Scrap validation
  if v_physical_scrap > 0 then
    if p_scrap_proba is null or p_scrap_proba <= 0 then
      raise exception 'Lom oltin probasi aniq ko''rsatilishi shart (masalan: 375, 585, 750, 995, 999.9)';
    end if;
    v_proba := round(p_scrap_proba::numeric, 2);
    if v_proba < 300.0 or v_proba > 1000.0 then
      raise exception 'Noto''g''ri proba kiritildi: % (ruxsat: 300 - 1000)', v_proba;
    end if;

    v_fine_gold := round((v_physical_scrap * (v_proba / 1000.0))::numeric, 4);
    v_scrap_585_eq := round((v_physical_scrap * (v_proba / 585.0))::numeric, 4);
  else
    v_proba := 585.0;
    v_fine_gold := 0;
    v_scrap_585_eq := 0;
  end if;

  -- 2. 585 Gold rate determination.
  v_official_rate := public._goldia_official_585_rate(v_caller_org);
  if public._goldia_is_seller_role(v_caller_role) and (v_cash > 0 or v_usd > 0) then
    -- 072: a seller's cash / USD payment uses the seller's OWN stored rates; the browser value is only checked.
    -- A retry of an already recorded payment returns the original response (original rate snapshot).
    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement',
      jsonb_build_object('action', 'record_client_settlement', 'customer_id', p_customer_id,
                         'scrap_weight', v_physical_scrap, 'cash_amount', v_cash, 'usd_amount', v_usd));
    if v_existing is not null then
      return v_existing;
    end if;
    select * into v_seller_rate from public.seller_rates
     where seller_id = v_caller_emp_id and organization_id = v_caller_org
     for share;
    v_rate := coalesce(v_seller_rate.lom_rate_uzs, v_official_rate);  -- no own LOM rate: official rate (pre-072 rule)
    if v_rate is null or v_rate <= 0 then
      raise exception 'ERR_DAILY_RATE_NOT_SET: LOM kursingiz belgilanmagan. Avval o''z kursingizni kiriting.';
    end if;
    if p_rate_per_gram is not null and p_rate_per_gram > 0 and abs(round(p_rate_per_gram::numeric, 2) - v_rate) > 0.01 then
      raise exception 'ERR_RATE_MISMATCH: Sizning joriy LOM kursingiz % UZS/g. Yuborilgan kurs: % UZS/g. Sahifani yangilang.',
        v_rate, p_rate_per_gram using errcode = '42501';
    end if;
    if v_usd > 0 then
      if v_seller_rate.usd_rate_uzs is null then
        raise exception 'ERR_USD_RATE_NOT_SET: Dollar qabul qilish uchun avval o''z USD kursingizni belgilang.';
      end if;
      if p_usd_rate is not null and p_usd_rate > 0 and abs(round(p_usd_rate::numeric, 2) - v_seller_rate.usd_rate_uzs) > 0.01 then
        raise exception 'ERR_RATE_MISMATCH: Sizning joriy USD kursingiz % UZS. Yuborilgan kurs: % UZS. Sahifani yangilang.',
          v_seller_rate.usd_rate_uzs, p_usd_rate using errcode = '42501';
      end if;
      v_own_usd_rate := v_seller_rate.usd_rate_uzs;
    end if;
  else
    if p_rate_per_gram is not null and p_rate_per_gram > 0 then
      v_rate := round(p_rate_per_gram::numeric, 2);
    else
      v_rate := v_official_rate;
    end if;
    perform public._goldia_assert_seller_rate(v_caller_role, v_rate, v_official_rate, (v_cash > 0 or v_usd > 0));
  end if;

  if (v_cash > 0 or v_usd > 0) and (v_rate is null or v_rate <= 0) then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Naqd pul yoki dollarni qabul qilish uchun 585 oltin kursi kiritilishi shart! Avval kunlik kursni belgilang.';
  end if;

  -- Sentinel rate for scrap-only to satisfy DB check constraint
  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0;
  end if;

  -- 3. USD rate determination (NO SILENT 12,850 FALLBACK!)
  if v_usd > 0 then
    if v_own_usd_rate is not null then
      v_usd_rate := v_own_usd_rate;
    elsif p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) to''lovini hisoblash uchun USD kursi (CBU yoki qo''lda) kiritilishi shart!';
    end if;

    -- USD -> UZS -> 585 Gold Grams
    v_usd_equiv := round(((v_usd * v_usd_rate) / v_rate)::numeric, 4);
  else
    v_usd_rate := null;
    v_usd_equiv := 0;
  end if;

  if v_cash > 0 then
    v_cash_equiv := round((v_cash / v_rate)::numeric, 4);
  else
    v_cash_equiv := 0;
  end if;

  -- 4. Total settled grams = scrap (in 585 eq) + UZS equiv + USD equiv
  v_total_settled := round(v_scrap_585_eq + v_cash_equiv + v_usd_equiv, 4);

  -- 5. Customer lookup
  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  limit 1;
  if not found then
    raise exception 'Mijoz (%) topilmadi', p_customer_id;
  end if;

  -- 6. Seller lookup
  if p_seller_id is not null then
    select * into v_seller
    from public.employees
    where id = p_seller_id and organization_id = v_caller_org
    limit 1;
  elsif v_customer.seller_id is not null then
    select * into v_seller
    from public.employees
    where id = v_customer.seller_id and organization_id = v_caller_org
    limit 1;
  else
    select * into v_seller
    from public.employees
    where user_id = auth.uid() and organization_id = v_caller_org
    limit 1;
  end if;

  if v_seller.id is null then
    raise exception 'Sotuvchi aniqlanmadi';
  end if;

  -- 065: sellers may only collect for themselves and their own customers
  if public._goldia_is_seller_role(v_caller_role) then
    if v_caller_emp_id is null or v_seller.id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z kassasiga to''lov qabul qila oladi' using errcode = '42501';
    end if;
    if v_customer.seller_id is not null and v_customer.seller_id <> v_caller_emp_id then
      raise exception 'Ruxsat etilmadi: Ushbu mijoz sizga biriktirilmagan' using errcode = '42501';
    end if;
  end if;

  if p_sale_id is not null and not exists (
    select 1 from public.jewelry_sales s
     where s.id = p_sale_id and s.organization_id = v_caller_org and s.customer_id = v_customer.id
       and s.status not in ('reversed', 'cancelled')
  ) then
    raise exception 'Savdo hujjati ushbu mijozga tegishli emas yoki bekor qilingan (%)', p_sale_id;
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_client_settlement',
    'customer_id', p_customer_id,
    'scrap_weight', v_physical_scrap,
    'cash_amount', v_cash,
    'usd_amount', v_usd
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 7. Lock client gold account FOR UPDATE (070: create the row first so concurrent first payments serialize)
  insert into public.client_gold_accounts (customer_id, organization_id, seller_id)
  values (v_customer.id, v_caller_org, v_seller.id)
  on conflict (customer_id) do nothing;
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_prev_debt := coalesce(v_client_acc.current_debt_grams, 0);
  else
    v_prev_debt := 0;
  end if;

  -- Debt reduction math
  if v_total_settled <= v_prev_debt then
    v_applied_to_debt := v_total_settled;
    v_excess_advance  := 0;
    v_rem_debt        := round((v_prev_debt - v_total_settled)::numeric, 4);
    v_new_advance     := coalesce(v_client_acc.advance_balance_grams, 0);
  else
    v_applied_to_debt := v_prev_debt;
    v_excess_advance  := round((v_total_settled - v_prev_debt)::numeric, 4);
    v_rem_debt        := 0;
    v_new_advance     := round((coalesce(v_client_acc.advance_balance_grams, 0) + v_excess_advance)::numeric, 4);
  end if;

  v_settle_no := 'SETTL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  insert into public.gold_settlements (
    organization_id, settlement_no, direction, seller_id, customer_id, sale_id,
    settlement_date, gold_rate_applied,
    scrap_weight_grams, physical_scrap_grams, scrap_proba, fine_gold_grams, scrap_585_equiv_grams,
    cash_paid_amount, currency, cash_equivalent_grams,
    usd_paid_amount, applied_usd_rate, usd_equivalent_grams,
    total_settled_grams, applied_to_debt_grams, excess_gold_grams,
    previous_debt_grams, remaining_debt_grams,
    status, notes, recorded_by, idempotency_key
  ) values (
    v_caller_org, v_settle_no, 'client_to_seller', v_seller.id, v_customer.id, p_sale_id,
    coalesce(p_settlement_date, current_date), v_rate,
    v_scrap_585_eq, v_physical_scrap, v_proba, v_fine_gold, v_scrap_585_eq,
    v_cash, 'UZS', v_cash_equiv,
    v_usd, v_usd_rate, v_usd_equiv,
    v_total_settled, v_applied_to_debt, v_excess_advance,
    v_prev_debt, v_rem_debt,
    'confirmed', p_notes, coalesce(public.current_employee_id(), v_seller.id), nullif(btrim(p_idempotency_key), '')
  ) returning id into v_settle_id;

  -- 8. Update client_gold_accounts atomically
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id, total_purchased_gold_grams,
    total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    v_customer.id, v_caller_org, v_seller.id, 0,
    v_scrap_585_eq, v_cash, round(v_cash_equiv + v_usd_equiv, 4), v_total_settled,
    v_rem_debt, v_new_advance, now()
  )
  on conflict (customer_id) do update set
    total_scrap_paid_grams = round((client_gold_accounts.total_scrap_paid_grams + v_scrap_585_eq)::numeric, 4),
    total_cash_paid_amount = round((client_gold_accounts.total_cash_paid_amount + v_cash)::numeric, 2),
    total_cash_equiv_grams = round((client_gold_accounts.total_cash_equiv_grams + v_cash_equiv + v_usd_equiv)::numeric, 4),
    total_usd_paid_amount  = round((coalesce(client_gold_accounts.total_usd_paid_amount, 0) + v_usd)::numeric, 2),
    total_usd_equiv_grams  = round((coalesce(client_gold_accounts.total_usd_equiv_grams, 0) + v_usd_equiv)::numeric, 4),
    total_settled_grams    = round((client_gold_accounts.total_settled_grams + v_total_settled)::numeric, 4),
    current_debt_grams     = v_rem_debt,
    advance_balance_grams  = v_new_advance,
    updated_at             = now();

  -- 9. Update seller till with received scrap (PHYSICAL and 585 EQ), cash UZS and cash USD
  insert into public.seller_gold_accounts (
    seller_id, organization_id,
    seller_till_scrap_grams, seller_till_scrap_physical_g, seller_till_scrap_585_eq_g,
    seller_till_cash_amount, seller_till_usd_amount, updated_at
  ) values (
    v_seller.id, v_caller_org,
    v_scrap_585_eq, v_physical_scrap, v_scrap_585_eq,
    v_cash, v_usd, now()
  )
  on conflict (seller_id) do update set
    seller_till_scrap_grams        = round((seller_gold_accounts.seller_till_scrap_grams + v_scrap_585_eq)::numeric, 4),
    seller_till_scrap_physical_g   = round((coalesce(seller_gold_accounts.seller_till_scrap_physical_g, 0) + v_physical_scrap)::numeric, 4),
    seller_till_scrap_585_eq_g     = round((coalesce(seller_gold_accounts.seller_till_scrap_585_eq_g, 0) + v_scrap_585_eq)::numeric, 4),
    seller_till_cash_amount        = round((seller_gold_accounts.seller_till_cash_amount + v_cash)::numeric, 2),
    seller_till_usd_amount         = round((coalesce(seller_gold_accounts.seller_till_usd_amount, 0) + v_usd)::numeric, 2),
    updated_at                     = now();

  -- If linked to specific sale, update settled amount on sale
  if p_sale_id is not null then
    update public.jewelry_sales
    set settled_gold_grams = round((coalesce(settled_gold_grams, 0) + v_applied_to_debt)::numeric, 4),
        remaining_gold_grams = round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4),
        status = case
          when round(greatest(0, remaining_gold_grams - v_applied_to_debt)::numeric, 4) <= 0.0001 then 'fully_paid'
          else 'partially_paid'
        end,
        updated_at = now()
    where id = p_sale_id and organization_id = v_caller_org;
  end if;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'physical_scrap_grams', v_physical_scrap,
    'scrap_weight_grams', v_physical_scrap,
    'scrap_proba', v_proba,
    'fine_gold_grams', v_fine_gold,
    'scrap_585_equiv_grams', v_scrap_585_eq,
    'cash_paid_amount', v_cash,
    'usd_paid_amount', v_usd,
    'usd_rate_applied', v_usd_rate,
    'rate_applied', v_rate,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
    'total_settled_585_grams', v_total_settled,
    'total_settled_grams', v_total_settled,
    'previous_debt_grams', v_prev_debt,
    'applied_to_debt_grams', v_applied_to_debt,
    'excess_gold_advance_grams', v_excess_advance,
    'excess_gold_grams', v_excess_advance,
    'remaining_debt_grams', v_rem_debt,
    'advance_balance_grams', v_new_advance,
    'seller_id', v_seller.id,
    'customer_id', v_customer.id
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_settlement', v_existing, v_payload);

  return v_existing;
end;
$function$;

-- ------------------------------------------------------------------ rpc_record_seller_to_manager_settlement (071 body + valued pool)
CREATE OR REPLACE FUNCTION public.rpc_record_seller_to_manager_settlement(p_seller_id uuid, p_scrap_weight_grams numeric DEFAULT 0, p_cash_paid_amount numeric DEFAULT 0, p_rate_per_gram numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_usd_paid_amount numeric DEFAULT 0, p_usd_rate numeric DEFAULT NULL::numeric, p_physical_scrap_g numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org_id          uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_rate            numeric(18, 2);
  v_usd_rate        numeric(18, 2);
  v_scrap_585_eq    numeric(14, 4);
  v_scrap_phys      numeric(14, 4);
  v_cash            numeric(18, 2);
  v_usd             numeric(18, 2);
  v_cash_equiv      numeric(14, 4) := 0;
  v_usd_equiv       numeric(14, 4) := 0;
  v_total_settled   numeric(14, 4);
  v_settle_no       text;
  v_settle_id       uuid;
  v_seller_acc      public.seller_gold_accounts%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_existing        jsonb;
  v_payload         jsonb;
  v_caller_role     text := public.current_employee_role_text();
  v_official_rate   numeric(18, 2);
  v_pool_uzs        numeric(18, 2) := 0;
  v_pool_uzs_g      numeric(18, 6) := 0;
  v_pool_usd        numeric(18, 2) := 0;
  v_pool_usd_g      numeric(18, 6) := 0;
  v_val_cash        numeric(18, 2) := 0;
  v_val_cash_g      numeric(18, 6) := 0;
  v_val_usd         numeric(18, 2) := 0;
  v_val_usd_g       numeric(18, 6) := 0;
  v_leg_cash        numeric(18, 2) := 0;
  v_leg_usd         numeric(18, 2) := 0;
  v_rate_applied    numeric(18, 2);
begin
  if v_org_id is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter',
    'manager', 'production_manager', 'boshqaruvchi', 'sales', 'seller', 'sotuvchi'
  ]);
  -- 065: a seller can only hand over their own till
  if public._goldia_is_seller_role(v_caller_role) and (v_caller_emp_id is null or p_seller_id is distinct from v_caller_emp_id) then
    raise exception 'Ruxsat etilmadi: Sotuvchi faqat o''z kassasini topshira oladi' using errcode = '42501';
  end if;

  v_scrap_585_eq := round(greatest(0, coalesce(p_scrap_weight_grams, 0))::numeric, 4);
  v_scrap_phys   := round(greatest(0, coalesce(p_physical_scrap_g, p_scrap_weight_grams, 0))::numeric, 4);
  v_cash := round(greatest(0, coalesce(p_cash_paid_amount, 0))::numeric, 2);
  v_usd  := round(greatest(0, coalesce(p_usd_paid_amount, 0))::numeric, 2);

  if v_scrap_585_eq <= 0 and v_cash <= 0 and v_usd <= 0 then
    raise exception 'Settlement must include either scrap gold grams, UZS cash, or USD cash';
  end if;

  v_payload := jsonb_build_object(
    'action', 'record_seller_to_manager_settlement',
    'seller_id', p_seller_id,
    'scrap_w', v_scrap_585_eq,
    'scrap_phys', v_scrap_phys,
    'cash', v_cash,
    'usd', v_usd
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  -- 1. STRICT LOCK ORDER HIERARCHY: Lock Manager Vault FIRST
  perform public._get_or_create_manager_vault(v_org_id);

  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_org_id
  for update;

  -- 2. STRICT LOCK ORDER HIERARCHY: Lock Seller Gold Account SECOND
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id and organization_id = v_org_id
  for update;

  if not found then
    raise exception 'Sotuvchi oltin hisobi topilmadi: %', p_seller_id;
  end if;

  -- 3. HARD BALANCE CHECK (F03):
  if v_scrap_585_eq > 0 and v_seller_acc.seller_till_scrap_grams < v_scrap_585_eq then
    raise exception 'ERR_INSUFFICIENT_SCRAP_BALANCE: Sotuvchi kassasida yetarli lom mavjud emas (Kassada: % g, Talab: % g)',
      v_seller_acc.seller_till_scrap_grams, v_scrap_585_eq;
  end if;

  if v_cash > 0 and v_seller_acc.seller_till_cash_amount < v_cash then
    raise exception 'ERR_INSUFFICIENT_CASH_BALANCE: Sotuvchi kassasida yetarli naqd pul (UZS) mavjud emas (Kassada: % UZS, Talab: % UZS)',
      v_seller_acc.seller_till_cash_amount, v_cash;
  end if;

  if v_usd > 0 and coalesce(v_seller_acc.seller_till_usd_amount, 0) < v_usd then
    raise exception 'ERR_INSUFFICIENT_USD_BALANCE: Sotuvchi kassasida yetarli dollar (USD) mavjud emas (Kassada: % USD, Talab: % USD)',
      coalesce(v_seller_acc.seller_till_usd_amount, 0), v_usd;
  end if;

  -- 072: cash / USD collected since 072 carries the grams it was credited at (valued till pool). That part
  -- closes the obligation with exactly those grams (pool average); the pool never exceeds what is in the till.
  v_pool_uzs := least(coalesce(v_seller_acc.till_valued_cash_uzs, 0), greatest(0, coalesce(v_seller_acc.seller_till_cash_amount, 0)));
  if v_pool_uzs > 0 then
    v_pool_uzs_g := v_seller_acc.till_valued_cash_585_g * v_pool_uzs / v_seller_acc.till_valued_cash_uzs;
  end if;
  v_pool_usd := least(coalesce(v_seller_acc.till_valued_usd, 0), greatest(0, coalesce(v_seller_acc.seller_till_usd_amount, 0)));
  if v_pool_usd > 0 then
    v_pool_usd_g := v_seller_acc.till_valued_usd_585_g * v_pool_usd / v_seller_acc.till_valued_usd;
  end if;
  v_val_cash := least(v_cash, v_pool_uzs);
  v_val_cash_g := case when v_pool_uzs > 0 then round(v_pool_uzs_g * v_val_cash / v_pool_uzs, 6) else 0 end;
  v_val_usd := least(v_usd, v_pool_usd);
  v_val_usd_g := case when v_pool_usd > 0 then round(v_pool_usd_g * v_val_usd / v_pool_usd, 6) else 0 end;
  v_leg_cash := v_cash - v_val_cash;  -- pre-072 cash without a captured value
  v_leg_usd  := v_usd - v_val_usd;

  -- 4. Gold Rate determination for the pre-072 part. Sellers must use the official confirmed rate (065).
  v_official_rate := public._goldia_official_585_rate(v_org_id);
  if p_rate_per_gram is not null and p_rate_per_gram > 0 then
    v_rate := round(p_rate_per_gram::numeric, 2);
  else
    v_rate := v_official_rate;
  end if;
  if (v_leg_cash > 0 or v_leg_usd > 0) and (v_rate is null or v_rate <= 0) then
    raise exception 'ERR_DAILY_RATE_NOT_SET: Bugungi 585 oltin kursi belgilanmagan! Naqd pul topshirish uchun avval kunlik kursni kiriting.';
  end if;
  -- a rate the seller sends must still be the official one (065), even when the captured value is used
  perform public._goldia_assert_seller_rate(v_caller_role, v_rate, v_official_rate,
    (v_leg_cash > 0 or v_leg_usd > 0) or ((v_cash > 0 or v_usd > 0) and p_rate_per_gram is not null and p_rate_per_gram > 0));
  if v_rate is null or v_rate <= 0 then
    v_rate := 1.0; -- Safe sentinel rate for DB check constraint (gold_rate_applied > 0) when cash is 0
  end if;
  -- 5. USD Rate determination (only the pre-072 USD needs a rate now)
  if v_leg_usd > 0 then
    if p_usd_rate is not null and p_usd_rate > 0 then
      v_usd_rate := round(p_usd_rate::numeric, 2);
    else
      raise exception 'ERR_USD_RATE_NOT_SET: Dollar (USD) topshirish uchun USD kursi kiritilishi shart!';
    end if;
  else
    v_usd_rate := null;
  end if;
  v_usd_equiv := case when v_usd > 0
    then round((v_val_usd_g + case when v_leg_usd > 0 then (v_leg_usd * v_usd_rate) / v_rate else 0 end)::numeric, 4) else 0 end;
  v_cash_equiv := case when v_cash > 0
    then round((v_val_cash_g + case when v_leg_cash > 0 then v_leg_cash / v_rate else 0 end)::numeric, 4) else 0 end;
  -- recorded rate = the effective UZS per gram of this handover (gold_rate_applied * cash_equivalent = cash)
  v_rate_applied := case when v_cash > 0 and v_cash_equiv > 0 then round(v_cash / v_cash_equiv, 2) else v_rate end;

  v_total_settled := round(v_scrap_585_eq + v_cash_equiv + v_usd_equiv, 4);

  if v_caller_emp_id is null then
    select id into v_caller_emp_id
    from public.employees
    where user_id = auth.uid() and organization_id = v_org_id
    limit 1;
    if v_caller_emp_id is null then
      v_caller_emp_id := p_seller_id;
    end if;
  end if;

  -- 6. Deduct exactly from seller till (both physical and 585 eq scrap)
  update public.seller_gold_accounts
  set seller_till_scrap_grams        = round(seller_till_scrap_grams - v_scrap_585_eq, 4),
      seller_till_scrap_585_eq_g     = round(greatest(0, coalesce(seller_till_scrap_585_eq_g, 0) - v_scrap_585_eq), 4),
      seller_till_scrap_physical_g   = round(greatest(0, coalesce(seller_till_scrap_physical_g, 0) - v_scrap_phys), 4),
      seller_till_cash_amount        = round(seller_till_cash_amount - v_cash, 2),
      seller_till_usd_amount         = round(coalesce(seller_till_usd_amount, 0) - v_usd, 2),
      updated_at = now()
  where seller_id = p_seller_id;

  -- 7. Add to manager vault (both physical and 585 eq scrap)
  update public.manager_vault_account
  set manager_scrap_grams        = round(manager_scrap_grams + v_scrap_585_eq, 4),
      manager_scrap_585_eq_g     = round(coalesce(manager_scrap_585_eq_g, 0) + v_scrap_585_eq, 4),
      manager_scrap_physical_g   = round(coalesce(manager_scrap_physical_g, 0) + v_scrap_phys, 4),
      manager_cash_amount        = round(manager_cash_amount + v_cash, 2),
      manager_usd_amount         = round(coalesce(manager_usd_amount, 0) + v_usd, 2),
      updated_at = now()
  where organization_id = v_org_id
  returning * into v_vault;

  -- 8. Insert gold settlement
  v_settle_no := 'STL-MGR-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  insert into public.gold_settlements (
    organization_id,
    settlement_no,
    direction,
    seller_id,
    gold_rate_applied,
    scrap_weight_grams,
    physical_scrap_grams,
    scrap_proba,
    scrap_585_equiv_grams,
    cash_paid_amount,
    currency,
    cash_equivalent_grams,
    usd_paid_amount,
    applied_usd_rate,
    usd_equivalent_grams,
    total_settled_grams,
    till_pool_cash_uzs,
    till_pool_cash_585_g,
    till_pool_usd,
    till_pool_usd_585_g,
    applied_to_debt_grams,
    excess_gold_grams,
    previous_debt_grams,
    remaining_debt_grams,
    status,
    notes,
    recorded_by,
    idempotency_key
  ) values (
    v_org_id,
    v_settle_no,
    'seller_to_manager',
    p_seller_id,
    v_rate_applied,
    v_scrap_585_eq,
    v_scrap_phys,
    585,
    v_scrap_585_eq,
    v_cash,
    'UZS',
    v_cash_equiv,
    v_usd,
    v_usd_rate,
    v_usd_equiv,
    v_total_settled,
    v_val_cash,
    v_val_cash_g,
    v_val_usd,
    v_val_usd_g,
    v_total_settled,
    0,
    coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0),
    round(greatest(0, coalesce(v_seller_acc.seller_owes_manager_g, v_seller_acc.current_factory_obligation_grams, 0) - v_total_settled), 4),
    'confirmed',
    p_notes,
    v_caller_emp_id,
    p_idempotency_key
  ) returning id into v_settle_id;

  -- 9. Read synced seller gold account
  select * into v_seller_acc
  from public.seller_gold_accounts
  where seller_id = p_seller_id;

  v_existing := jsonb_build_object(
    'status', 'ok',
    'settlement_id', v_settle_id,
    'settlement_no', v_settle_no,
    'scrap_grams_settled', v_scrap_585_eq,
    'scrap_weight_grams', v_scrap_585_eq,
    'scrap_physical_grams', v_scrap_phys,
    'cash_amount_settled', v_cash,
    'usd_amount_settled', v_usd,
    'applied_usd_rate', v_usd_rate,
    'applied_rate_per_gram', v_rate_applied,
    'valued_cash_uzs', v_val_cash,
    'valued_usd', v_val_usd,
    'cash_equivalent_grams', v_cash_equiv,
    'usd_equivalent_grams', v_usd_equiv,
    'total_settled_grams', v_total_settled,
    'remaining_seller_obligation_g', v_seller_acc.seller_owes_manager_g,
    'seller_owes_manager_g', v_seller_acc.seller_owes_manager_g,
    'bozor_qarzi_signed_g', v_seller_acc.bozor_qarzi_signed_g,
    'seller_till_scrap_grams', v_seller_acc.seller_till_scrap_grams,
    'seller_till_scrap_physical_g', v_seller_acc.seller_till_scrap_physical_g,
    'seller_till_cash_amount', v_seller_acc.seller_till_cash_amount,
    'seller_till_usd_amount', v_seller_acc.seller_till_usd_amount,
    'manager_scrap_grams', v_vault.manager_scrap_grams,
    'manager_scrap_physical_g', v_vault.manager_scrap_physical_g,
    'manager_cash_amount', v_vault.manager_cash_amount,
    'manager_usd_amount', v_vault.manager_usd_amount
  );

  perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_seller_to_manager_settlement', v_existing, v_payload);

  return v_existing;
end;
$function$;

revoke execute on function public.rpc_set_my_seller_rates(numeric, numeric, text) from public, anon;
revoke execute on function public.rpc_get_seller_rates(uuid) from public, anon;
revoke execute on function public.rpc_set_seller_rate_limits(numeric, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.rpc_set_my_seller_rates(numeric, numeric, text) to authenticated, service_role;
grant execute on function public.rpc_get_seller_rates(uuid) to authenticated, service_role;
grant execute on function public.rpc_set_seller_rate_limits(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;
revoke execute on function public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric) from public, anon;
revoke execute on function public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.rpc_record_client_settlement(uuid, uuid, numeric, numeric, numeric, numeric, date, text, text, uuid, numeric, numeric) to authenticated, service_role;
grant execute on function public.rpc_record_seller_to_manager_settlement(uuid, numeric, numeric, numeric, text, text, numeric, numeric, numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
