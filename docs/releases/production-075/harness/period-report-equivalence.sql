-- LOCAL ONLY (disposable copy). Computes rpc_get_period_report for every organization (as one of its management logins),
-- 5 date windows x (no seller filter + every seller of the organization) and stores the jsonb in public.<:tbl>.
-- Run once before and once after a migration, then compare the two tables (see test-period-report-equivalence.sh).
create table if not exists public.:tbl (org uuid, wfrom date, wto date, seller uuid, rep jsonb, ms numeric);
truncate public.:tbl;
select set_config('goldia.eq_tbl', :'tbl', false);
do $$
declare r record; w record; s record; j jsonb; t0 timestamptz; today date := (timezone('Asia/Tashkent', now()))::date;
begin
  for r in select distinct on (e.organization_id) e.organization_id as org, e.user_id
             from public.employees e
            where e.is_active and e.user_id is not null and e.organization_id is not null
              and public._goldia_is_management_role(coalesce(e.role::text, ''))
            order by e.organization_id, e.id loop
    perform set_config('request.jwt.claim.sub', r.user_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    for w in select * from (values ('2026-11-01'::date, today), (today, today), (today - 1, today - 1), ('2026-10-01'::date, '2026-10-31'::date), ('2026-11-01'::date, today - 1)) v(f, t) loop
      t0 := clock_timestamp(); j := public.rpc_get_period_report(w.f, w.t, null);
      execute format('insert into public.%I values ($1, $2, $3, null, $4, $5)', current_setting('goldia.eq_tbl')) using r.org, w.f, w.t, j, extract(epoch from clock_timestamp() - t0) * 1000;
      for s in select seller_id from public.seller_gold_accounts where organization_id = r.org order by seller_id loop
        t0 := clock_timestamp(); j := public.rpc_get_period_report(w.f, w.t, s.seller_id);
        execute format('insert into public.%I values ($1, $2, $3, $4, $5, $6)', current_setting('goldia.eq_tbl')) using r.org, w.f, w.t, s.seller_id, j, extract(epoch from clock_timestamp() - t0) * 1000;
      end loop;
    end loop;
  end loop;
end $$;
select count(*) as reports, round(sum(ms)) as total_ms, round(max(ms)) as max_ms from public.:tbl;
