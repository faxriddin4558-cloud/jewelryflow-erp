-- GOLDIA — classify demo login accounts in production — READ ONLY (changes nothing).
-- An account is SAFE_TO_BLOCK only if its email is a known demo address AND neither the
-- account nor its employee record has any business activity. Everything else is REVIEW.

begin transaction read only;

with demo_list(email) as (
  values ('director@goldia.uz'), ('manager@goldia.uz'), ('seller@goldia.uz'), ('accountant@goldia.uz'),
         ('worker@goldia.uz'), ('xodim@goldia.uz'), ('jamshid@jewelryflow.uz'), ('dilshod@jewelryflow.uz'),
         ('jasur@jewelryflow.uz')
),
candidates as (
  select u.id as user_id, lower(u.email) as email, u.created_at, u.last_sign_in_at, u.banned_until
    from auth.users u
   where lower(u.email) in (select email from demo_list) or lower(u.email) like 'demo.%'
),
activity as (
  select c.*,
         e.id as employee_id, e.full_name as employee_name, e.role::text as employee_role, e.is_active,
         (select count(*) from public.jewelry_sales s where s.seller_id = e.id) as sales,
         (select count(*) from public.gold_settlements g where g.seller_id = e.id or g.recorded_by = e.id) as settlements,
         (select count(*) from public.seller_consignments sc where sc.seller_id = e.id) as consignments,
         (select count(*) from public.customers cu where cu.seller_id = e.id) as customers,
         (select count(*) from public.audit_logs a where a.actor_id = c.user_id) as audit_actions
    from candidates c
    left join public.employees e on e.user_id = c.user_id
)
select case when sales + settlements + consignments + customers + audit_actions = 0 then 'SAFE_TO_BLOCK'
            else 'REVIEW_HAS_ACTIVITY' end as classification,
       email, employee_name, employee_role, is_active, last_sign_in_at, banned_until,
       sales, settlements, consignments, customers, audit_actions
  from activity
 order by 1 desc, 2;

rollback;
