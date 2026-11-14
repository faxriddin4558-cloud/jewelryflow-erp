-- ROLLBACK 087: restores the 086 body of public._goldia_guard_restart_t0 byte for byte (the 086 trigger is unchanged).
-- No business row is touched. The migration history row is handled by the emergency file / release tooling.
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
