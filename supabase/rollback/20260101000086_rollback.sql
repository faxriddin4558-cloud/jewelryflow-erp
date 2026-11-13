-- Rollback of 086 (financial write freeze + server-side T0): back to exactly 085.
-- Refused once a freeze was ever recorded (its history belongs to the restart audit trail).
do $g$ begin
  if exists (select 1 from public.financial_write_freezes) then
    raise exception 'ROLLBACK 086 REFUSED: financial write freezes exist (history of a backup / restart window)';
  end if; end $g$;

drop trigger if exists trg_goldia_restart_freeze_t0 on public.financial_restarts;
drop function if exists public._goldia_guard_restart_t0();

-- ===== _goldia_guard_opening_draft (restore the body of 20260101000085_goldia_financial_restart_and_opening_accounting.sql)
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
  -- restart runs the write is refused at once, otherwise it holds the shared lock until it commits
  if not pg_try_advisory_xact_lock_shared(hashtext('goldia_financial_restart'), hashtext(v_org::text)) then
    raise exception 'ERR_OPENING_DRAFT: moliyaviy hisob hozir qayta boshlanmoqda - amalni keyinroq takrorlang' using errcode = '55000';
  end if;
  if exists (select 1 from public.opening_periods where organization_id = v_org and status = 'draft') then
    raise exception 'ERR_OPENING_DRAFT: boshlang''ich hisob tasdiqlanmagan - oddiy moliyaviy amallar qulflangan (avval boshlang''ich hisobni yakunlang)'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end $f$;
revoke all on function public._goldia_guard_opening_draft() from public, anon, authenticated;

drop function if exists public._goldia_financial_freeze(uuid, text, boolean);
drop function if exists public._goldia_active_freeze(uuid);
drop table if exists public.financial_write_freezes;
