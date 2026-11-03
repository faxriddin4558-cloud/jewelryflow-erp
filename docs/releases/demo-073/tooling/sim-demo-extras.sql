-- simulate the demo project's out-of-repo 070-072 (additive objects + drift), for local testing only
create table public.deployment_settings (id boolean primary key default true, environment text not null, updated_at timestamptz default now());
insert into public.deployment_settings (environment) values ('demo');
create function public.deployment_environment() returns text language sql stable as $$ select environment from public.deployment_settings limit 1 $$;
create table public.organization_profiles (organization_id uuid primary key, company_name text);
create table public.currency_rates (id uuid primary key default gen_random_uuid(), organization_id uuid, from_currency text, to_currency text, rate_to_uzs numeric, rate_date date, source text, created_at timestamptz default now());
create function public.rpc_get_organization_profile() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create function public.demo_seed_synthetic_data(p_demo_domain text) returns jsonb language sql as $$ select '{}'::jsonb $$;
-- drift: 3-arg overload dropped, an extra Goldia-named overload, a modified Goldia body, an extra permissive policy
drop function public.rpc_reverse_financial_transaction(uuid, text, text);
create function public.rpc_get_seller_available_pieces(p_seller_code text) returns jsonb language sql as $$ select '[]'::jsonb $$;
create or replace function public.current_employee_role_text() returns text language sql stable security definer set search_path = public, pg_temp as $$ select 'admin'::text $$;
create policy demo_open_customers on public.customers for select to authenticated using (true);
