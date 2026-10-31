-- GOLDIA — block unused demo login accounts in production. NO DELETES.
--
-- Run ONLY after demo_accounts_identify_readonly.sql was reviewed. Touches only accounts that
-- the same rule classifies as SAFE_TO_BLOCK (known demo email + zero business activity).
-- Accounts with any activity are never touched. Real employee accounts are never touched.
--
-- Effect per demo account (all reversible):
--   auth.users.banned_until = 'infinity'   -> Supabase Auth refuses sign-in and token refresh
--   auth.refresh_tokens.revoked = true     -> existing sessions cannot be renewed
--   public.employees.is_active = false     -> every RPC rejects the account immediately
--
-- Undo for one account (if ever needed):
--   update auth.users set banned_until = null where lower(email) = '<email>';
--   update public.employees set is_active = true where user_id = (select id from auth.users where lower(email) = '<email>');

begin;

create temporary table goldia_demo_block on commit drop as
with demo_list(email) as (
  values ('director@goldia.uz'), ('manager@goldia.uz'), ('seller@goldia.uz'), ('accountant@goldia.uz'),
         ('worker@goldia.uz'), ('xodim@goldia.uz'), ('jamshid@jewelryflow.uz'), ('dilshod@jewelryflow.uz'),
         ('jasur@jewelryflow.uz')
)
select u.id as user_id, lower(u.email) as email, e.id as employee_id
  from auth.users u
  left join public.employees e on e.user_id = u.id
 where (lower(u.email) in (select email from demo_list) or lower(u.email) like 'demo.%')
   and not exists (select 1 from public.jewelry_sales s where s.seller_id = e.id)
   and not exists (select 1 from public.gold_settlements g where g.seller_id = e.id or g.recorded_by = e.id)
   and not exists (select 1 from public.seller_consignments sc where sc.seller_id = e.id)
   and not exists (select 1 from public.customers cu where cu.seller_id = e.id)
   and not exists (select 1 from public.audit_logs a where a.actor_id = u.id);

-- Safety net: never more accounts than the demo list can contain.
do $$
begin
  if (select count(*) from goldia_demo_block) > 20 then
    raise exception 'Unexpected number of demo accounts (%); aborting, nothing changed', (select count(*) from goldia_demo_block);
  end if;
end $$;

select 'WILL_BLOCK' as action, email from goldia_demo_block order by email;

update auth.users u set banned_until = 'infinity'
  from goldia_demo_block d where u.id = d.user_id;

update auth.refresh_tokens t set revoked = true
  from goldia_demo_block d where t.user_id::text = d.user_id::text and coalesce(t.revoked, false) = false;

update public.employees e set is_active = false
  from goldia_demo_block d where e.id = d.employee_id and coalesce(e.is_active, true) = true;

select 'BLOCKED' as result, d.email, u.banned_until, e.is_active as employee_active
  from goldia_demo_block d
  join auth.users u on u.id = d.user_id
  left join public.employees e on e.id = d.employee_id
 order by d.email;

commit;
