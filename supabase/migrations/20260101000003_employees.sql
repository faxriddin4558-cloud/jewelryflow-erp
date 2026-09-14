-- =========================================================================
-- JewelryFlow ERP — Migration 003
-- Employees (profiles linked 1:1 to Supabase auth.users)
-- =========================================================================
-- Every authenticated user (factory staff, managers, admins) has exactly
-- one `employees` row. We do not store credentials here — Supabase Auth
-- owns identity/password/session; this table owns HR + operational data
-- and is what the rest of the schema (batch_operations, gold_transactions,
-- audit_log, etc.) foreign-keys against.
-- =========================================================================

create table employees (
  id                  uuid primary key references auth.users(id) on delete cascade,
  employee_code       text not null unique,             -- factory badge / ID number
  full_name           text not null,
  phone               text,
  role                app_role not null default 'department_operator',
  primary_department_id uuid references departments(id) on delete set null,
  employment_status   employment_status not null default 'active',
  hired_at            date,
  photo_url           text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table employees is 'Factory staff profile, 1:1 with auth.users. Drives RBAC and is the FK target for all "performed by" columns.';

create index idx_employees_department on employees(primary_department_id);
create index idx_employees_role on employees(role);
create index idx_employees_status on employees(employment_status);
create unique index idx_employees_code_lower on employees (lower(employee_code));

create trigger set_employees_updated_at
  before update on employees
  for each row execute function moddatetime(updated_at);

-- -------------------------------------------------------------------------
-- Auto-provision an employee row whenever a new Supabase auth user is
-- created via invite/sign-up, so the app never has to handle a "profile
-- missing" edge case.
-- -------------------------------------------------------------------------
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.employees (id, employee_code, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'employee_code', 'PENDING-' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce((new.raw_user_meta_data ->> 'role')::app_role, 'viewer')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
