-- 087 — Goldia Sales: the backup verification used by a restart must be written INSIDE the active freeze, and one freeze
-- serves one restart (PHASE F3 security audit, 2026-11-14). Minimal: only public._goldia_guard_restart_t0 (086) changes;
-- no business row is written; no other function, table or grant changes.
--
-- Gap closed (found in the F3 staging audit): 085 / 086 accepted any unconsumed verification younger than 24 hours. A
-- verification written BEFORE the freeze (or a second verification of the same backup kept for later) could be used for
-- a restart although ordinary writes happened between that backup and the freeze - the backup would not contain them.
-- * ERR_BACKUP_BEFORE_FREEZE: the verification row must be written at or after the start of the active freeze. The
--   tooling writes it only after a full dump taken inside the freeze and restored on a disposable copy, so the backup
--   contains every committed ordinary write (the freeze refuses new ones).
-- * ERR_FREEZE_ALREADY_USED: a restart already happened during this freeze; the next restart needs a NEW freeze and a NEW
--   backup (no replay of a second verification of an older backup).
-- The 086 rules (freeze required, T0 not in the future / not older than 24 h / not more than 1 h before the freeze, in
-- Asia/Tashkent wording) are kept unchanged, in the same order, before the new checks.

create or replace function public._goldia_guard_restart_t0()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_frozen timestamptz; v_bv_at timestamptz;
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
  -- 087: the backup must belong to THIS freeze (verification written at / after its start)
  select v.verified_at into v_bv_at from public.financial_backup_verifications v
   where v.id = new.backup_verification_id and v.organization_id = new.organization_id;
  if v_bv_at is null or v_bv_at < v_frozen then
    raise exception 'ERR_BACKUP_BEFORE_FREEZE: backup tasdig''i (%) muzlatishdan (%) oldin yozilgan - muzlatishdan keyin yangi backup kerak (Toshkent vaqti)',
      coalesce(to_char(v_bv_at at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI:SS'), '-'), to_char(v_frozen at time zone 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI:SS') using errcode = '55000';
  end if;
  -- 087: one freeze -> one restart (a second restart needs a new freeze and a new backup)
  if exists (select 1 from public.financial_restarts r where r.organization_id = new.organization_id and r.created_at >= v_frozen) then
    raise exception 'ERR_FREEZE_ALREADY_USED: shu muzlatish davrida qayta boshlash allaqachon bajarilgan - yangi muzlatish va yangi backup kerak' using errcode = '55000';
  end if;
  return new;
end $f$;
revoke all on function public._goldia_guard_restart_t0() from public, anon, authenticated;
