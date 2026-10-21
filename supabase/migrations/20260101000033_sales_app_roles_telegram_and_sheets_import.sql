-- =========================================================================
-- JewelryFlow Sales — Migration 033
-- Independent Sales App: Telegram Link, Sales Login Audit & Sheets Import
-- =========================================================================

-- 1. Extend employees with Telegram fields & active status
alter table public.employees
  add column if not exists telegram_user_id text,
  add column if not exists telegram_username text,
  add column if not exists telegram_linked_at timestamptz,
  add column if not exists telegram_link_code text,
  add column if not exists telegram_link_expires_at timestamptz,
  add column if not exists is_active boolean not null default true;

create unique index if not exists idx_employees_telegram_user_id
  on public.employees (telegram_user_id)
  where telegram_user_id is not null;

create index if not exists idx_employees_telegram_link_code
  on public.employees (telegram_link_code)
  where telegram_link_code is not null;

-- 2. Sales Login Audit Trail
create table if not exists public.sales_login_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  user_id uuid,
  email text,
  role text not null,
  login_method text not null, -- 'password', 'telegram', 'local_demo', 'token'
  telegram_user_id text,
  ip_address text,
  user_agent text,
  status text not null, -- 'success', 'failed', 'blocked'
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_login_audit_employee on public.sales_login_audit_logs(employee_id);
create index if not exists idx_sales_login_audit_created on public.sales_login_audit_logs(created_at desc);

-- 3. Google Sheets Historical Import Batches
create table if not exists public.sheets_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  batch_no text not null unique,
  sheet_name text not null, -- 'Zavod bilan', 'Tovar olish', 'Lom pateriya', 'Sanatoni sotuv', 'Otush sotuv', 'Buxoro sotuv', 'opening_balances'
  imported_by uuid references public.employees(id) on delete set null,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  skipped_rows integer not null default 0,
  total_weight_g numeric(18, 4) not null default 0,
  total_cash_amount numeric(18, 2) not null default 0,
  is_opening_balance boolean not null default false,
  status text not null default 'completed',
  notes text,
  raw_data_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sheets_import_batches_org on public.sheets_import_batches(organization_id);
create index if not exists idx_sheets_import_batches_name on public.sheets_import_batches(sheet_name);

-- -------------------------------------------------------------------------
-- RPC: rpc_generate_telegram_link_code
-- Director or Manager generates a secure 6-digit OTP to link Telegram
-- -------------------------------------------------------------------------
create or replace function public.rpc_generate_telegram_link_code(
  p_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_expires timestamptz;
  v_emp record;
begin
  select id, full_name, role into v_emp
  from public.employees
  where id = p_employee_id;

  if not found then
    raise exception 'Xodim topilmadi: %', p_employee_id;
  end if;

  -- Generate 6-digit random code
  v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
  v_expires := now() + interval '15 minutes';

  update public.employees
  set telegram_link_code = v_code,
      telegram_link_expires_at = v_expires
  where id = p_employee_id;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'full_name', v_emp.full_name,
    'role', v_emp.role::text,
    'link_code', v_code,
    'expires_at', v_expires
  );
end;
$$;

-- -------------------------------------------------------------------------
-- RPC: rpc_verify_and_link_telegram
-- Verifies the 6-digit OTP and links Telegram User ID to the employee profile
-- -------------------------------------------------------------------------
create or replace function public.rpc_verify_and_link_telegram(
  p_link_code text,
  p_telegram_user_id text,
  p_telegram_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_emp record;
begin
  if p_link_code is null or length(trim(p_link_code)) = 0 then
    raise exception 'Tasdiqlash kodi kiritilishi shart!';
  end if;

  if p_telegram_user_id is null or length(trim(p_telegram_user_id)) = 0 then
    raise exception 'Telegram User ID kiritilishi shart!';
  end if;

  -- Check if telegram_user_id is already linked to another employee
  select id, full_name into v_emp
  from public.employees
  where telegram_user_id = trim(p_telegram_user_id);

  if found then
    raise exception 'Ushbu Telegram hisobi allaqachon boshqa xodimga (%) ulangan!', v_emp.full_name;
  end if;

  -- Verify active OTP
  select id, full_name, role, organization_id, email into v_emp
  from public.employees
  where telegram_link_code = trim(p_link_code)
    and telegram_link_expires_at > now()
    and is_active = true;

  if not found then
    raise exception 'Noto''g''ri yoki muddati o''tgan tasdiqlash kodi!';
  end if;

  -- Link Telegram identity and clear single-use token
  update public.employees
  set telegram_user_id = trim(p_telegram_user_id),
      telegram_username = nullif(trim(p_telegram_username), ''),
      telegram_linked_at = now(),
      telegram_link_code = null,
      telegram_link_expires_at = null
  where id = v_emp.id;

  return jsonb_build_object(
    'success', true,
    'employee_id', v_emp.id,
    'full_name', v_emp.full_name,
    'role', v_emp.role::text,
    'organization_id', v_emp.organization_id,
    'email', v_emp.email,
    'telegram_user_id', p_telegram_user_id,
    'telegram_username', p_telegram_username,
    'linked_at', now()
  );
end;
$$;

-- -------------------------------------------------------------------------
-- RPC: rpc_unlink_telegram
-- Unlinks Telegram identity from employee account
-- -------------------------------------------------------------------------
create or replace function public.rpc_unlink_telegram(
  p_employee_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.employees
  set telegram_user_id = null,
      telegram_username = null,
      telegram_linked_at = null,
      telegram_link_code = null,
      telegram_link_expires_at = null
  where id = p_employee_id;

  return true;
end;
$$;

-- -------------------------------------------------------------------------
-- RPC: rpc_record_login_audit
-- Audit log recording for all authentication attempts
-- -------------------------------------------------------------------------
create or replace function public.rpc_record_login_audit(
  p_employee_id uuid default null,
  p_email text default null,
  p_role text default 'unknown',
  p_login_method text default 'password',
  p_telegram_user_id text default null,
  p_status text default 'success',
  p_failure_reason text default null,
  p_ip text default null,
  p_ip_address text default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_id uuid;
begin
  if p_employee_id is not null then
    select organization_id into v_org_id from public.employees where id = p_employee_id;
  end if;

  if v_org_id is null then
    select id into v_org_id from public.organizations limit 1;
  end if;

  insert into public.sales_login_audit_logs (
    organization_id,
    employee_id,
    email,
    role,
    login_method,
    telegram_user_id,
    ip_address,
    user_agent,
    status,
    failure_reason
  ) values (
    v_org_id,
    p_employee_id,
    p_email,
    p_role,
    p_login_method,
    p_telegram_user_id,
    coalesce(p_ip_address, p_ip),
    p_user_agent,
    p_status,
    p_failure_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- -------------------------------------------------------------------------
-- RPC: rpc_execute_sheets_historical_import
-- Atomically imports historical batches from Google Sheets with strict validation
-- -------------------------------------------------------------------------
create or replace function public.rpc_execute_sheets_historical_import(
  p_sheet_type text,
  p_batch_no text,
  p_rows jsonb,
  p_is_opening_balance boolean default false,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_caller_emp_id uuid;
  v_row jsonb;
  v_total_rows integer := 0;
  v_valid_rows integer := 0;
  v_skipped_rows integer := 0;
  v_total_weight numeric(18, 4) := 0;
  v_total_cash numeric(18, 2) := 0;
  v_receipt_no text;
  v_purchase_no text;
  v_batch_no text;
  v_weight numeric(18, 4);
  v_proba numeric(18, 4);
  v_markup numeric(18, 4);
  v_oblig numeric(18, 4);
  v_cash numeric(18, 2);
  v_rate numeric(18, 2);
  v_seller_id uuid;
  v_seller_name text;
  v_prod_name text;
begin
  select id into v_org_id from public.organizations limit 1;
  select id into v_caller_emp_id from public.employees where user_id = auth.uid() limit 1;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Import qilish uchun qatorlar mavjud emas!';
  end if;

  v_total_rows := jsonb_array_length(p_rows);

  -- Process based on sheet type
  case p_sheet_type
    when 'Zavod bilan' then
      for v_row in select * from jsonb_array_elements(p_rows) loop
        v_weight := coalesce((v_row ->> 'weight_g')::numeric, 0);
        v_proba := coalesce((v_row ->> 'proba')::numeric, 585);
        v_markup := coalesce((v_row ->> 'markup_pct')::numeric, 8.0);
        v_prod_name := coalesce(v_row ->> 'product_name', 'Zavod tovari (Import)');

        if v_weight > 0 then
          v_oblig := round(v_weight * (1 + (v_markup / 100.0)), 4);
          v_receipt_no := 'IMP-ZVD-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

          insert into public.factory_receipts (
            organization_id,
            receipt_no,
            receipt_date,
            product_name,
            proba,
            quantity,
            original_physical_g,
            factory_markup_pct,
            factory_obligation_g,
            transferred_physical_g,
            available_physical_g,
            status,
            notes
          ) values (
            v_org_id,
            v_receipt_no,
            coalesce((v_row ->> 'date')::date, current_date),
            v_prod_name,
            v_proba,
            coalesce((v_row ->> 'quantity')::integer, 1),
            v_weight,
            v_markup,
            v_oblig,
            0,
            v_weight,
            'in_manager_stock',
            'Sheets import: ' || coalesce(p_notes, p_batch_no)
          );

          v_valid_rows := v_valid_rows + 1;
          v_total_weight := v_total_weight + v_weight;
        else
          v_skipped_rows := v_skipped_rows + 1;
        end if;
      end loop;

    when 'Tovar olish' then
      for v_row in select * from jsonb_array_elements(p_rows) loop
        v_weight := coalesce((v_row ->> 'weight_g')::numeric, 0);
        v_cash := coalesce((v_row ->> 'cash_uzs')::numeric, 0);
        v_rate := coalesce((v_row ->> 'rate_per_g')::numeric, 900000);
        v_proba := coalesce((v_row ->> 'proba')::numeric, 585);

        if v_weight > 0 and v_cash > 0 then
          v_purchase_no := 'IMP-BUY-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

          insert into public.gold_purchases (
            organization_id,
            purchase_no,
            purchase_date,
            supplier_name,
            cash_spent_uzs,
            rate_per_gram,
            gold_weight_grams,
            proba,
            equiv_585_grams,
            notes
          ) values (
            v_org_id,
            v_purchase_no,
            coalesce((v_row ->> 'date')::date, current_date),
            coalesce(v_row ->> 'supplier', 'Bozor (Import)'),
            v_cash,
            v_rate,
            v_weight,
            v_proba,
            round(v_weight * (v_proba / 585.0), 4),
            'Sheets import: ' || coalesce(p_notes, p_batch_no)
          );

          v_valid_rows := v_valid_rows + 1;
          v_total_weight := v_total_weight + v_weight;
          v_total_cash := v_total_cash + v_cash;
        else
          v_skipped_rows := v_skipped_rows + 1;
        end if;
      end loop;

    when 'Lom pateriya' then
      for v_row in select * from jsonb_array_elements(p_rows) loop
        v_weight := coalesce((v_row ->> 'input_scrap_g')::numeric, 0);
        v_oblig := coalesce((v_row ->> 'output_fine_g')::numeric, 0);
        v_proba := coalesce((v_row ->> 'fine_proba')::numeric, 995);

        if v_weight > 0 and v_oblig > 0 then
          v_batch_no := 'IMP-REF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
          declare
            v_eq585 numeric(18, 4) := round(v_oblig * (v_proba / 585.0), 4);
            v_loss numeric(18, 4) := greatest(0, round(v_weight - v_eq585, 4));
            v_loss_p numeric(18, 3) := case when v_weight > 0 then round((v_loss / v_weight) * 100.0, 3) else 0 end;
          begin
            insert into public.refining_batches (
              organization_id,
              batch_no,
              batch_date,
              input_scrap_grams,
              melted_weight_grams,
              melt_loss_grams,
              output_fine_grams,
              output_fine_proba,
              output_585_equiv_grams,
              total_loss_grams,
              loss_pct,
              status,
              notes
            ) values (
              v_org_id,
              v_batch_no,
              coalesce((v_row ->> 'date')::date, current_date),
              v_weight,
              coalesce((v_row ->> 'melted_g')::numeric, v_weight),
              greatest(0, v_weight - coalesce((v_row ->> 'melted_g')::numeric, v_weight)),
              v_oblig,
              v_proba,
              v_eq585,
              v_loss,
              v_loss_p,
              'completed',
              'Sheets import: ' || coalesce(p_notes, p_batch_no)
            );
          end;

          v_valid_rows := v_valid_rows + 1;
          v_total_weight := v_total_weight + v_weight;
        else
          v_skipped_rows := v_skipped_rows + 1;
        end if;
      end loop;

    else -- Seller sheets: 'Sanatoni sotuv', 'Otush sotuv', 'Buxoro sotuv', etc.
      v_seller_name := split_part(p_sheet_type, ' ', 1);
      -- Find or identify seller employee
      select id into v_seller_id from public.employees
      where lower(full_name) like '%' || lower(v_seller_name) || '%'
      limit 1;

      if v_seller_id is null then
        select id into v_seller_id from public.employees
        where role in ('sales', 'seller')
        limit 1;
      end if;

      for v_row in select * from jsonb_array_elements(p_rows) loop
        v_weight := coalesce((v_row ->> 'weight_g')::numeric, 0);
        v_markup := coalesce((v_row ->> 'markup_pct')::numeric, 12.0);

        if v_weight > 0 and v_seller_id is not null then
          v_oblig := round(v_weight * (1 + (v_markup / 100.0)), 4);

          insert into public.seller_consignments (
            organization_id,
            consignment_no,
            seller_id,
            consignment_date,
            total_items_count,
            total_physical_weight_grams,
            gold_purity,
            factory_markup_pct,
            seller_markup_pct,
            remaining_gold_due_grams,
            seller_obligation_g,
            notes
          ) values (
            v_org_id,
            'IMP-CSG-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6),
            v_seller_id,
            coalesce((v_row ->> 'date')::date, current_date),
            1,
            v_weight,
            585,
            8.0,
            v_markup,
            v_oblig,
            v_oblig,
            'Sheets import: ' || p_sheet_type || ' ' || coalesce(p_notes, '')
          );

          v_valid_rows := v_valid_rows + 1;
          v_total_weight := v_total_weight + v_weight;
        else
          v_skipped_rows := v_skipped_rows + 1;
        end if;
      end loop;
  end case;

  -- Record import in sheets_import_batches
  insert into public.sheets_import_batches (
    organization_id,
    batch_no,
    sheet_name,
    imported_by,
    total_rows,
    valid_rows,
    skipped_rows,
    total_weight_g,
    total_cash_amount,
    is_opening_balance,
    notes,
    raw_data_json
  ) values (
    v_org_id,
    p_batch_no,
    p_sheet_type,
    v_caller_emp_id,
    v_total_rows,
    v_valid_rows,
    v_skipped_rows,
    v_total_weight,
    v_total_cash,
    p_is_opening_balance,
    p_notes,
    p_rows
  );

  return jsonb_build_object(
    'success', true,
    'batch_no', p_batch_no,
    'sheet_name', p_sheet_type,
    'total_rows', v_total_rows,
    'valid_rows', v_valid_rows,
    'skipped_rows', v_skipped_rows,
    'total_weight_g', v_total_weight,
    'total_cash_amount', v_total_cash
  );
end;
$$;

-- Security & Grants
grant all on table public.sales_login_audit_logs to authenticated, service_role;
grant all on table public.sheets_import_batches to authenticated, service_role;
grant select on table public.sales_login_audit_logs to anon;
grant select on table public.sheets_import_batches to anon;

grant execute on function public.rpc_generate_telegram_link_code to authenticated, service_role;
grant execute on function public.rpc_verify_and_link_telegram to anon, authenticated, service_role;
grant execute on function public.rpc_unlink_telegram to authenticated, service_role;
grant execute on function public.rpc_record_login_audit to anon, authenticated, service_role;
grant execute on function public.rpc_execute_sheets_historical_import to authenticated, service_role;
