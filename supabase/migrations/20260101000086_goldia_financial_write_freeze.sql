-- 086 — Goldia Sales: server-side financial WRITE FREEZE for the backup -> restart window + server-side T0 validation
-- (PHASE F2 final safety fix, 2026-11-13). Minimal: no 077-085 function is changed except _goldia_guard_opening_draft,
-- which gets one more refusal. No business row is written by this migration.
--
-- * public.financial_write_freezes: one ACTIVE freeze per organization. Only the release tooling (database owner /
--   service role) can set or release it: public._goldia_financial_freeze(org, reason, on). Signed-in users can read
--   their organization's rows (the opening page shows the state) but never write them.
-- * While a freeze is active, every ordinary financial write of that organization (the 12 tables of the 085 draft guard)
--   is refused by the database: ERR_FINANCIAL_FREEZE. The restart and the opening documents pass (they mark their own
--   transaction, goldia.opening_write = txid, exactly as in 085). Other organizations are not affected.
-- * Race safety: setting the freeze takes the EXCLUSIVE per-organization restart lock (waits at most lock_timeout for
--   writes that already passed the guard - each holds the shared lock until it commits), so after the freeze commits
--   no ordinary write of that organization can be in flight or start.
-- * A freeze ends automatically when an opening period created after it is LOCKED (baseline confirmed) - ordinary work
--   then resumes with no extra step - or explicitly by _goldia_financial_freeze(org, reason, false) (abort before /
--   after a failed restart: the restart is one transaction, a failure changes nothing, the freeze simply stays).
-- * rpc_financial_restart (unchanged) inserts into financial_restarts first; a BEFORE INSERT trigger now refuses it
--   unless a freeze is active, and validates T0 on the server: not more than 1 minute in the future, not older than
--   24 hours, not more than 1 hour before the freeze started (a browser in another time zone sends a wrong instant;
--   the frontend sends the Tashkent wall clock as +05:00). The refusal rolls back the whole restart.

create table if not exists public.financial_write_freezes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id),
  frozen_at        timestamptz not null default now(),
  reason           text not null check (length(btrim(reason)) > 0),
  frozen_by        text not null default current_user,
  released_at      timestamptz,
  released_reason  text,
  released_by      text
);
create unique index if not exists financial_write_freezes_one_active on public.financial_write_freezes (organization_id) where released_at is null;
alter table public.financial_write_freezes enable row level security;
drop policy if exists financial_write_freezes_select on public.financial_write_freezes;
create policy financial_write_freezes_select on public.financial_write_freezes for select to authenticated
  using (organization_id = public.current_organization_id());
revoke all on public.financial_write_freezes from anon;
revoke insert, update, delete, truncate on public.financial_write_freezes from authenticated;
grant select on public.financial_write_freezes to authenticated;

-- the active freeze of an organization (its start), null when none; a freeze is over once an opening period created
-- after it has been locked (the baseline confirmation) or closed
create or replace function public._goldia_active_freeze(p_org uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $f$
  select f.frozen_at from public.financial_write_freezes f
   where f.organization_id = p_org and f.released_at is null
     and not exists (select 1 from public.opening_periods p where p.organization_id = p_org and p.status in ('locked', 'closed') and p.created_at > f.frozen_at)
   limit 1
$f$;
revoke all on function public._goldia_active_freeze(uuid) from public, anon, authenticated;

-- set (p_on = true) or release (false) the freeze of one organization; release tooling only
create or replace function public._goldia_financial_freeze(p_org uuid, p_reason text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_at timestamptz; v_id uuid;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'ERR_FREEZE: organization not found' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'ERR_FREEZE: reason required' using errcode = '22023';
  end if;
  if p_on then
    if public._goldia_active_freeze(p_org) is not null then
      select id, frozen_at into v_id, v_at from public.financial_write_freezes where organization_id = p_org and released_at is null;
      return jsonb_build_object('status', 'already_active', 'freeze_id', v_id, 'frozen_at', v_at);
    end if;
    -- a stale row (its opening was locked meanwhile) is closed first
    update public.financial_write_freezes set released_at = now(), released_reason = 'ended by a locked opening', released_by = current_user
     where organization_id = p_org and released_at is null;
    -- wait (bounded) for every ordinary write that already passed the guard; new ones are refused while we hold it
    perform set_config('lock_timeout', '30s', true);
    perform pg_advisory_xact_lock(hashtext('goldia_financial_restart'), hashtext(p_org::text));
    -- the moment AFTER every earlier writer has committed (not the start of this transaction)
    insert into public.financial_write_freezes (organization_id, reason, frozen_at) values (p_org, btrim(p_reason), clock_timestamp()) returning id, frozen_at into v_id, v_at;
    insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, new_data, reason)
    values (p_org, 'financial_write_freezes', v_id::text, 'FINANCIAL_FREEZE_ON', null, jsonb_build_object('frozen_at', v_at, 'by', current_user), btrim(p_reason));
    return jsonb_build_object('status', 'frozen', 'freeze_id', v_id, 'frozen_at', v_at);
  end if;
  update public.financial_write_freezes set released_at = now(), released_reason = btrim(p_reason), released_by = current_user
   where organization_id = p_org and released_at is null returning id into v_id;
  if v_id is not null then
    insert into public.audit_logs (organization_id, table_name, record_id, action, actor_id, new_data, reason)
    values (p_org, 'financial_write_freezes', v_id::text, 'FINANCIAL_FREEZE_OFF', null, jsonb_build_object('by', current_user), btrim(p_reason));
  end if;
  return jsonb_build_object('status', case when v_id is null then 'not_active' else 'released' end, 'freeze_id', v_id);
end $f$;
revoke all on function public._goldia_financial_freeze(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public._goldia_financial_freeze(uuid, text, boolean) to service_role;

-- 085 draft guard + the freeze refusal (the opening / restart transaction mark still passes first)
create or replace function public._goldia_guard_opening_draft()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_org uuid;
begin
  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if v_org is null then return coalesce(new, old); end if;
  if current_setting('goldia.opening_write', true) is not distinct from txid_current()::text then
    return coalesce(new, old);
  end if;
  -- never WAIT here: an ordinary write may already hold row locks the restart needs (waiting = deadlock); while a
  -- restart or a freeze is being set the write is refused at once, otherwise it holds the shared lock until it commits
  if not pg_try_advisory_xact_lock_shared(hashtext('goldia_financial_restart'), hashtext(v_org::text)) then
    raise exception 'ERR_OPENING_DRAFT: moliyaviy hisob hozir qayta boshlanmoqda - amalni keyinroq takrorlang' using errcode = '55000';
  end if;
  if exists (select 1 from public.opening_periods where organization_id = v_org and status = 'draft') then
    raise exception 'ERR_OPENING_DRAFT: boshlang''ich hisob tasdiqlanmagan - oddiy moliyaviy amallar qulflangan (avval boshlang''ich hisobni yakunlang)'
      using errcode = '55000';
  end if;
  -- 086: backup -> restart window
  if public._goldia_active_freeze(v_org) is not null then
    raise exception 'ERR_FINANCIAL_FREEZE: moliyaviy yozuvlar vaqtincha to''xtatilgan (backup va qayta boshlash) - amal bajarilmadi'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end $f$;
revoke all on function public._goldia_guard_opening_draft() from public, anon, authenticated;

-- 086: a restart only inside an active freeze, with a T0 the server accepts
create or replace function public._goldia_guard_restart_t0()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_frozen timestamptz;
begin
  v_frozen := public._goldia_active_freeze(new.organization_id);
  if v_frozen is null then
    raise exception 'ERR_FREEZE_REQUIRED: qayta boshlashdan oldin moliyaviy yozuvlar muzlatilishi (backup oynasi) shart' using errcode = '55000';
  end if;
  if new.t0 > now() + interval '1 minute' then
    raise exception 'ERR_T0_FUTURE: T0 (%) kelajakda bo''lishi mumkin emas (server vaqti %, Toshkent)',
      to_char(new.t0 at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI'), to_char(now() at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI') using errcode = '22023';
  end if;
  if new.t0 < now() - interval '24 hours' then
    raise exception 'ERR_T0_TOO_OLD: T0 (%) 24 soatdan eski bo''lishi mumkin emas', to_char(new.t0 at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI') using errcode = '22023';
  end if;
  if new.t0 < v_frozen - interval '1 hour' then
    raise exception 'ERR_T0_BEFORE_FREEZE: T0 (%) muzlatishdan (%) 1 soatdan ko''p oldin - vaqt zonasi xatosi bo''lishi mumkin (T0 Toshkent vaqtida kiritiladi)',
      to_char(new.t0 at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI'), to_char(v_frozen at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI') using errcode = '22023';
  end if;
  return new;
end $f$;
revoke all on function public._goldia_guard_restart_t0() from public, anon, authenticated;
drop trigger if exists trg_goldia_restart_freeze_t0 on public.financial_restarts;
create trigger trg_goldia_restart_freeze_t0 before insert on public.financial_restarts
  for each row execute function public._goldia_guard_restart_t0();
