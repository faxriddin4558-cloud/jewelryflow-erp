-- ============================================================================
-- JEWELRYFLOW ERP — OPERATOR SCRIPT: SAFE DIRECTOR/ADMIN ACCOUNT LINKING
-- ============================================================================
-- File: supabase/scripts/02_manual_link_director_admin.sql
-- Purpose: Safely link the verified Supabase Auth user 'admin@goldia.uz' to an
--          active, authoritative Director/Admin record in `public.employees`.
--
-- INSTRUCTIONS FOR OPERATOR:
-- 1. Review this script carefully before executing.
-- 2. Execute within the Supabase SQL Editor as `postgres` or `service_role`.
-- 3. This script is fully idempotent and transactional. If no auth user exists
--    with email 'admin@goldia.uz', it raises an informative notice and does not fail.
-- ============================================================================

begin;

do $$
declare
  v_user_id uuid;
  v_emp_id_text text;
  v_existing_user_id uuid;
  v_existing_email text;
  v_role_col_type text;
begin
  -- Step 1: Look up the verified auth user id
  select id into v_user_id
  from auth.users
  where lower(email) = 'admin@goldia.uz'
  limit 1;

  if v_user_id is null then
    raise notice 'ATTENTION: No Supabase Auth user found with email admin@goldia.uz. Please ensure the user has signed up or been invited in Supabase Auth before running this link script.';
    return;
  end if;

  -- Inspect the data type of public.employees.role to handle enum vs text gracefully
  select data_type into v_role_col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'employees' and column_name = 'role';

  -- Step 2: Safe lookup by exact matching email 'admin@goldia.uz'
  select id::text, user_id, email into v_emp_id_text, v_existing_user_id, v_existing_email
  from public.employees
  where lower(btrim(coalesce(email, ''))) = 'admin@goldia.uz'
  order by id asc
  limit 1;

  -- Safety Guard A: If an employee record already has email 'admin@goldia.uz' but points to another auth user
  if v_emp_id_text is not null and v_existing_user_id is not null and v_existing_user_id <> v_user_id then
    raise exception 'SAFETY VIOLATION: Employee ID % already has email admin@goldia.uz but is linked to another auth user (%). Aborting to prevent identity collision.',
      v_emp_id_text, v_existing_user_id;
  end if;

  -- Safety Guard B: If no employee record has email 'admin@goldia.uz', check if any record points to v_user_id
  if v_emp_id_text is null then
    select id::text, email into v_emp_id_text, v_existing_email
    from public.employees
    where user_id = v_user_id
    limit 1;

    -- If that employee record has a DIFFERENT email (e.g., worker@goldia.uz), DO NOT overwrite or elevate them!
    if v_emp_id_text is not null and v_existing_email is not null and lower(btrim(v_existing_email)) <> 'admin@goldia.uz' then
      raise exception 'SAFETY VIOLATION: Employee ID % is linked to auth user % but belongs to another identity (email: %). Aborting to prevent accidental privilege escalation.',
        v_emp_id_text, v_user_id, v_existing_email;
    end if;
  end if;

  if v_emp_id_text is not null then
    -- Safely update the verified record to full Director / Admin authority
    update public.employees
    set
      user_id = v_user_id,
      email = 'admin@goldia.uz',
      name = coalesce(nullif(btrim(name), ''), 'Bosh Direktor'),
      full_name = coalesce(nullif(btrim(full_name), ''), nullif(btrim(name), ''), 'Bosh Direktor'),
      role = 'admin',
      role_type = 'Director',
      position = 'Director',
      department = coalesce(nullif(btrim(department), ''), 'Boshqaruv'),
      status = 'active',
      employment_status = 'active',
      is_active = true
    where id::text = v_emp_id_text;

    raise notice 'SUCCESS: Updated verified employee record (ID: %) with Director/Admin credentials linked to auth user %.', v_emp_id_text, v_user_id;
  else
    -- Insert a canonical Director employee record linked to the auth user
    insert into public.employees (
      employee_code,
      name,
      full_name,
      email,
      department,
      role,
      role_type,
      position,
      salary_type,
      rate,
      balance,
      status,
      employment_status,
      is_active,
      user_id
    ) values (
      'EMP-DIR-001',
      'Bosh Direktor',
      'Bosh Direktor',
      'admin@goldia.uz',
      'Boshqaruv',
      'admin',
      'Director',
      'Director',
      'Oylik (Fixed)',
      0,
      0,
      'active',
      'active',
      true,
      v_user_id
    );

    raise notice 'SUCCESS: Created new employee record EMP-DIR-001 with Director/Admin credentials linked to auth user %.', v_user_id;
  end if;
end $$;

commit;

-- Verification Query: Inspect the updated employee and auth user linkage
select
  e.id as employee_id,
  e.user_id as linked_auth_user_id,
  u.email as auth_email,
  e.email as employee_email,
  e.name,
  e.full_name,
  e.role,
  e.role_type,
  e.position,
  e.department,
  e.status,
  e.employment_status,
  e.is_active
from public.employees e
join auth.users u on u.id = e.user_id
where lower(u.email) = 'admin@goldia.uz';
