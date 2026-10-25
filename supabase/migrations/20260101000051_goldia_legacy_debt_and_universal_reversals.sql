-- =========================================================================
-- MIGRATION 051: Goldia Sales MVP — Legacy Debt, Universal Reversals,
--                Correction Workflows & Selective Test Cleanup
-- =========================================================================

-- 1. Table: client_legacy_debts (Daftar bo'yicha eski qarz / avans yozuvlari)
create table if not exists public.client_legacy_debts (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  customer_id            uuid not null references public.customers(id) on delete cascade,
  seller_id              uuid references public.employees(id) on delete set null,
  balance_type           text not null check (balance_type in ('debt', 'advance')), -- 'debt' = mijoz qarzdor, 'advance' = mijoz haqi
  amount_585_g           numeric(14, 4) not null check (amount_585_g >= 0),
  previous_debt_585_g    numeric(14, 4) not null default 0,
  previous_advance_585_g numeric(14, 4) not null default 0,
  delta_585_g            numeric(14, 4) not null default 0,
  new_debt_585_g         numeric(14, 4) not null default 0,
  new_advance_585_g      numeric(14, 4) not null default 0,
  as_of_date             date not null,
  notes                  text,
  entry_type             text not null default 'initial' check (entry_type in ('initial', 'reconciliation_adjustment', 'manual_addition', 'reversal')),
  status                 text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  reversed_at            timestamptz,
  reversed_by            uuid references public.employees(id) on delete set null,
  reversal_reason        text,
  idempotency_key        text unique,
  created_by             uuid references public.employees(id) on delete set null,
  created_at             timestamptz not null default clock_timestamp(),
  updated_at             timestamptz not null default clock_timestamp()
);

create index if not exists idx_client_legacy_debts_cust on public.client_legacy_debts(customer_id, organization_id);
create index if not exists idx_client_legacy_debts_status on public.client_legacy_debts(status);
create index if not exists idx_client_legacy_debts_date on public.client_legacy_debts(organization_id, as_of_date);

-- Table grants and RLS for client_legacy_debts
alter table public.client_legacy_debts enable row level security;

revoke all on table public.client_legacy_debts from public, anon;
grant select on table public.client_legacy_debts to authenticated;

drop policy if exists "client_legacy_debts_select_policy" on public.client_legacy_debts;
create policy "client_legacy_debts_select_policy"
  on public.client_legacy_debts for select
  using (
    organization_id = public.current_organization_id()
  );

-- 2. Schema Hardening on existing financial tables for Universal Reversals
-- A) jewelry_sales: ensure piece sales columns exist & status constraint allows unpaid/reversed
alter table public.jewelry_sales
  alter column product_name drop not null,
  alter column markup_spread_grams drop not null,
  alter column markup_spread_grams set default 0,
  add column if not exists model_id uuid references public.jewelry_models(id) on delete set null,
  add column if not exists model_code text,
  add column if not exists model_name text,
  add column if not exists category text,
  add column if not exists purity numeric(6, 2) default 585,
  add column if not exists seller_profit_spread_grams numeric(14, 4) default 0;

alter table public.jewelry_sales
  drop constraint if exists jewelry_sales_status_check;
alter table public.jewelry_sales
  add constraint jewelry_sales_status_check check (status in ('open_debt', 'unpaid', 'partially_paid', 'fully_paid', 'reversed', 'cancelled'));

-- B) financial_transactions: add reversal columns and update trigger
alter table public.financial_transactions
  add column if not exists status text not null default 'confirmed',
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.employees(id) on delete set null,
  add column if not exists reversal_reason text;

alter table public.financial_transactions
  drop constraint if exists chk_financial_transactions_status;
alter table public.financial_transactions
  add constraint chk_financial_transactions_status check (status in ('confirmed', 'reversed'));

-- Update trigger function to allow audited reversal
create or replace function public.trg_prevent_financial_transaction_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'ERR_FINANCIAL_TRANSACTION_IMMUTABLE: Tasdiqlangan moliyaviy operatsiya yozuvini o''chirish taqiqlanadi (ID: %)', OLD.id
      using errcode = '42501';
  end if;

  if TG_OP = 'UPDATE' then
    -- Allow transition from 'confirmed' to 'reversed' ONLY, no financial numbers can be altered
    if OLD.status = 'confirmed' and NEW.status = 'reversed'
       and NEW.id = OLD.id
       and NEW.organization_id = OLD.organization_id
       and NEW.transaction_no = OLD.transaction_no
       and NEW.transaction_date = OLD.transaction_date
       and NEW.transaction_type = OLD.transaction_type
       and NEW.source_till = OLD.source_till
       and NEW.amount_num = OLD.amount_num
       and NEW.currency = OLD.currency
       and NEW.equiv_585_grams = OLD.equiv_585_grams then
      return NEW;
    end if;

    raise exception 'ERR_FINANCIAL_TRANSACTION_IMMUTABLE: Tasdiqlangan moliyaviy operatsiya ko''rsatkichlarini o''zgartirish taqiqlanadi (ID: %)', OLD.id
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

-- B) refining_batches: update status check and add reversal columns
alter table public.refining_batches
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.employees(id) on delete set null,
  add column if not exists reversal_reason text;

alter table public.refining_batches
  drop constraint if exists refining_batches_status_check;
alter table public.refining_batches
  add constraint refining_batches_status_check check (status in ('pending', 'completed', 'cancelled', 'reversed'));

-- C) factory_gold_handovers: add status and reversal columns
alter table public.factory_gold_handovers
  add column if not exists status text not null default 'confirmed',
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.employees(id) on delete set null,
  add column if not exists reversal_reason text;

alter table public.factory_gold_handovers
  drop constraint if exists chk_factory_gold_handovers_status;
alter table public.factory_gold_handovers
  add constraint chk_factory_gold_handovers_status check (status in ('confirmed', 'reversed'));

-- D) gold_purchases: add status and reversal columns
alter table public.gold_purchases
  add column if not exists status text not null default 'confirmed',
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.employees(id) on delete set null,
  add column if not exists reversal_reason text;

alter table public.gold_purchases
  drop constraint if exists chk_gold_purchases_status;
alter table public.gold_purchases
  add constraint chk_gold_purchases_status check (status in ('confirmed', 'reversed'));

-- E) Set clock_timestamp default for precise post-baseline event sequencing
alter table public.client_legacy_debts
  alter column created_at set default clock_timestamp();

alter table public.financial_transactions
  alter column created_at set default clock_timestamp();

alter table public.accounting_baselines
  alter column created_at set default clock_timestamp();

-- F) customers: archive flag & deletion guard
alter table public.customers
  add column if not exists is_archived boolean not null default false;

create or replace function public.fn_guard_customer_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.jewelry_sales where customer_id = OLD.id) or
     exists (select 1 from public.gold_settlements where customer_id = OLD.id) or
     exists (select 1 from public.client_legacy_debts where customer_id = OLD.id) then
    raise exception 'Ushbu mijozga bog''langan operatsiyalar mavjud. Uni o''chirish taqiqlanadi! Arxivlashdan (is_archived = true) foydalaning.'
      using errcode = '23503';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_guard_customer_deletion on public.customers;
create trigger trg_guard_customer_deletion
  before delete on public.customers
  for each row execute function public.fn_guard_customer_deletion();

-- Customer archive RPC
create or replace function public.rpc_archive_customer(
  p_customer_id uuid,
  p_archive boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org uuid := public.current_organization_id();
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array['admin', 'director', 'owner', 'direktor', 'rahbar']);

  update public.customers
     set is_archived = p_archive,
         updated_at = now()
   where id = p_customer_id and organization_id = v_caller_org;

  if not found then
    raise exception 'Mijoz topilmadi: %', p_customer_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'customer_id', p_customer_id,
    'is_archived', p_archive
  );
end;
$$;
grant execute on function public.rpc_archive_customer(uuid, boolean) to authenticated;


-- =========================================================================
-- 3. RPC: rpc_record_client_legacy_debt (Mijozning eski qarzini kiritish / tuzatish)
-- =========================================================================
create or replace function public.rpc_record_client_legacy_debt(
  p_customer_id          uuid,
  p_balance_type         text, -- 'debt' yoki 'advance'
  p_amount_585_g         numeric,
  p_as_of_date           date,
  p_notes                text default null,
  p_entry_type           text default 'initial', -- 'initial', 'reconciliation_adjustment', 'manual_addition'
  p_target_final_balance numeric default null, -- if provided in reconciliation mode
  p_idempotency_key      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org           uuid := public.current_organization_id();
  v_caller_emp_id        uuid := public.current_employee_id();
  v_customer             public.customers%rowtype;
  v_seller_id            uuid;
  v_client_acc           public.client_gold_accounts%rowtype;
  v_cur_debt             numeric(14, 4) := 0;
  v_cur_adv              numeric(14, 4) := 0;
  v_target               numeric(14, 4);
  v_delta                numeric(14, 4) := 0;
  v_new_debt             numeric(14, 4) := 0;
  v_new_adv              numeric(14, 4) := 0;
  v_amt                  numeric(14, 4);
  v_entry_type           text := coalesce(nullif(btrim(p_entry_type), ''), 'initial');
  v_bal_type             text := coalesce(nullif(btrim(p_balance_type), ''), 'debt');
  v_legacy_id            uuid;
  v_payload              jsonb;
  v_existing             jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  -- Only Director / Admin can record or adjust legacy debts
  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

  if p_customer_id is null then
    raise exception 'Mijoz tanlanishi shart';
  end if;

  if p_as_of_date is null then
    raise exception 'Qarz qaysi sanadagi holat ekani ko''rsatilishi shart';
  end if;

  if v_bal_type not in ('debt', 'advance') then
    raise exception 'Qoldiq turi faqat "debt" (qarz) yoki "advance" (avans) bo''lishi mumkin';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Mijoz topilmadi: %', p_customer_id;
  end if;

  v_seller_id := v_customer.seller_id;

  -- Idempotency check
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_payload := jsonb_build_object(
      'action', 'record_client_legacy_debt',
      'customer_id', p_customer_id,
      'balance_type', v_bal_type,
      'amount_585_g', p_amount_585_g,
      'target_balance', p_target_final_balance,
      'as_of_date', p_as_of_date
    );

    v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_record_client_legacy_debt', v_payload);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  -- Lock client gold account
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = p_customer_id and organization_id = v_caller_org
  for update;

  if found then
    v_cur_debt := coalesce(v_client_acc.current_debt_grams, 0);
    v_cur_adv  := coalesce(v_client_acc.advance_balance_grams, 0);
  else
    v_cur_debt := 0;
    v_cur_adv  := 0;
  end if;

  -- -------------------------------------------------------------
  -- CALCULATION MODE: Reconciliation vs Direct
  -- -------------------------------------------------------------
  if p_target_final_balance is not null then
    -- RECONCILIATION MODE: User provides notebook's actual current figure
    v_target := round(abs(p_target_final_balance::numeric), 4);

    if v_bal_type = 'debt' then
      -- Target is positive net debt (+v_target)
      -- Current net position is (v_cur_debt - v_cur_adv)
      v_delta := round(v_target - (v_cur_debt - v_cur_adv), 4);
      if v_delta = 0 then
        -- No change needed!
        v_existing := jsonb_build_object(
          'status', 'ok',
          'no_change_needed', true,
          'message', 'Daftar qoldig''i tizimdagi joriy qoldiqqa teng (O''zgarish: 0.0000 g)',
          'previous_debt_585_g', v_cur_debt,
          'previous_advance_585_g', v_cur_adv,
          'delta_585_g', 0,
          'current_debt_585_g', v_cur_debt,
          'current_advance_585_g', v_cur_adv
        );
        if p_idempotency_key is not null then
          perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_legacy_debt', v_existing, v_payload);
        end if;
        return v_existing;
      end if;

      v_amt := abs(v_delta);
      v_entry_type := 'reconciliation_adjustment';

      v_new_debt := v_target;
      v_new_adv  := 0;

    else -- v_bal_type = 'advance'
      -- Target is advance of v_target (net position is -v_target)
      v_delta := round((-v_target) - (v_cur_debt - v_cur_adv), 4);
      if v_delta = 0 then
        v_existing := jsonb_build_object(
          'status', 'ok',
          'no_change_needed', true,
          'message', 'Daftar qoldig''i tizimdagi joriy avansga teng (O''zgarish: 0.0000 g)',
          'previous_debt_585_g', v_cur_debt,
          'previous_advance_585_g', v_cur_adv,
          'delta_585_g', 0,
          'current_debt_585_g', v_cur_debt,
          'current_advance_585_g', v_cur_adv
        );
        if p_idempotency_key is not null then
          perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_legacy_debt', v_existing, v_payload);
        end if;
        return v_existing;
      end if;

      v_amt := abs(v_delta);
      v_entry_type := 'reconciliation_adjustment';

      v_new_adv  := v_target;
      v_new_debt := 0;
    end if;

  else
    -- DIRECT ADDITION MODE
    v_amt := round(greatest(0, coalesce(p_amount_585_g, 0))::numeric, 4);
    if v_amt <= 0 then
      raise exception 'Qarz yoki avans miqdori 0 dan katta bo''lishi shart';
    end if;

    if v_bal_type = 'debt' then
      v_delta := v_amt;
      -- If customer had advance, debt offsets advance first
      if v_cur_adv > 0 then
        if v_cur_adv >= v_amt then
          v_new_adv  := round(v_cur_adv - v_amt, 4);
          v_new_debt := v_cur_debt;
        else
          v_new_debt := round(v_cur_debt + (v_amt - v_cur_adv), 4);
          v_new_adv  := 0;
        end if;
      else
        v_new_debt := round(v_cur_debt + v_amt, 4);
        v_new_adv  := 0;
      end if;
    else -- advance
      v_delta := -v_amt;
      if v_cur_debt > 0 then
        if v_cur_debt >= v_amt then
          v_new_debt := round(v_cur_debt - v_amt, 4);
          v_new_adv  := v_cur_adv;
        else
          v_new_adv  := round(v_cur_adv + (v_amt - v_cur_debt), 4);
          v_new_debt := 0;
        end if;
      else
        v_new_adv  := round(v_cur_adv + v_amt, 4);
        v_new_debt := 0;
      end if;
    end if;
  end if;

  -- Insert client_legacy_debts audit record
  insert into public.client_legacy_debts (
    organization_id, customer_id, seller_id, balance_type,
    amount_585_g, previous_debt_585_g, previous_advance_585_g, delta_585_g,
    new_debt_585_g, new_advance_585_g, as_of_date, notes,
    entry_type, status, created_by
  ) values (
    v_caller_org, p_customer_id, v_seller_id, v_bal_type,
    v_amt, v_cur_debt, v_cur_adv, v_delta,
    v_new_debt, v_new_adv, p_as_of_date, p_notes,
    v_entry_type, 'confirmed', v_caller_emp_id
  ) returning id into v_legacy_id;

  -- Synchronize client_gold_accounts cache
  insert into public.client_gold_accounts (
    customer_id, organization_id, seller_id,
    total_purchased_gold_grams, total_scrap_paid_grams,
    total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
    current_debt_grams, advance_balance_grams, updated_at
  ) values (
    p_customer_id, v_caller_org, v_seller_id,
    0, 0, 0, 0, 0,
    v_new_debt, v_new_adv, now()
  )
  on conflict (customer_id) do update set
    seller_id = coalesce(client_gold_accounts.seller_id, excluded.seller_id),
    current_debt_grams = v_new_debt,
    advance_balance_grams = v_new_adv,
    updated_at = now();

  -- Audit log entry
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'client_legacy_debts', v_legacy_id::text,
    'RECORD_CLIENT_LEGACY_DEBT', auth.uid(),
    jsonb_build_object('debt_g', v_cur_debt, 'advance_g', v_cur_adv),
    jsonb_build_object('debt_g', v_new_debt, 'advance_g', v_new_adv, 'delta_g', v_delta),
    coalesce(p_notes, 'Eski daftar qarzi kiritildi')
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'legacy_debt_id', v_legacy_id,
    'customer_id', p_customer_id,
    'customer_name', v_customer.contact_name,
    'balance_type', v_bal_type,
    'entry_type', v_entry_type,
    'previous_debt_585_g', v_cur_debt,
    'previous_advance_585_g', v_cur_adv,
    'delta_585_g', v_delta,
    'new_debt_585_g', v_new_debt,
    'new_advance_585_g', v_new_adv,
    'as_of_date', p_as_of_date
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_record_client_legacy_debt', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_record_client_legacy_debt(uuid, text, numeric, date, text, text, numeric, text) to authenticated;


-- =========================================================================
-- 4. RPC: rpc_reverse_client_legacy_debt (Eski qarz yozuvini bekor qilish)
-- =========================================================================
create or replace function public.rpc_reverse_client_legacy_debt(
  p_legacy_debt_id  uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_rec             public.client_legacy_debts%rowtype;
  v_client_acc      public.client_gold_accounts%rowtype;
  v_cur_debt        numeric(14, 4);
  v_cur_adv         numeric(14, 4);
  v_rev_net         numeric(14, 4);
  v_rev_debt        numeric(14, 4);
  v_rev_adv         numeric(14, 4);
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

  if v_clean_reason is null then
    raise exception 'Eski qarzni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_client_legacy_debt',
    'legacy_debt_id', p_legacy_debt_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_client_legacy_debt', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_rec
  from public.client_legacy_debts
  where id = p_legacy_debt_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Eski qarz yozuvi topilmadi: %', p_legacy_debt_id;
  end if;

  if v_rec.status = 'reversed' then
    raise exception 'Ushbu eski qarz yozuvi allaqachon bekor qilingan';
  end if;

  -- Lock client gold account
  select * into v_client_acc
  from public.client_gold_accounts
  where customer_id = v_rec.customer_id and organization_id = v_caller_org
  for update;

  v_cur_debt := coalesce(v_client_acc.current_debt_grams, 0);
  v_cur_adv  := coalesce(v_client_acc.advance_balance_grams, 0);

  -- Reversing delta mathematically: Net position = (debt - advance) - delta
  v_rev_net := round((v_cur_debt - v_cur_adv) - v_rec.delta_585_g, 4);
  if v_rev_net >= 0 then
    v_rev_debt := v_rev_net;
    v_rev_adv  := 0;
  else
    v_rev_debt := 0;
    v_rev_adv  := abs(v_rev_net);
  end if;

  -- Update client_gold_accounts
  update public.client_gold_accounts
     set current_debt_grams = v_rev_debt,
         advance_balance_grams = v_rev_adv,
         updated_at = now()
   where customer_id = v_rec.customer_id and organization_id = v_caller_org;

  -- Mark legacy debt row as reversed
  update public.client_legacy_debts
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason,
         updated_at = now()
   where id = p_legacy_debt_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'client_legacy_debts', p_legacy_debt_id::text,
    'REVERSE_CLIENT_LEGACY_DEBT', auth.uid(),
    jsonb_build_object('status', 'confirmed', 'debt_g', v_cur_debt, 'advance_g', v_cur_adv),
    jsonb_build_object('status', 'reversed', 'debt_g', v_rev_debt, 'advance_g', v_rev_adv),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'legacy_debt_id', p_legacy_debt_id,
    'customer_id', v_rec.customer_id,
    'reversed_delta_g', v_rec.delta_585_g,
    'new_debt_585_g', v_rev_debt,
    'new_advance_585_g', v_rev_adv,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_client_legacy_debt', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_client_legacy_debt(uuid, text, text) to authenticated;


-- =========================================================================
-- 5. RPC: rpc_reverse_refining_batch (Affinaj partiyasini bekor qilish)
-- =========================================================================
create or replace function public.rpc_reverse_refining_batch(
  p_batch_id        uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_batch           public.refining_batches%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Affinajni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_refining_batch',
    'batch_id', p_batch_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_refining_batch', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_batch
  from public.refining_batches
  where id = p_batch_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Affinaj partiyasi topilmadi: %', p_batch_id;
  end if;

  if v_batch.status = 'reversed' then
    raise exception 'Ushbu affinaj partiyasi allaqachon bekor qilingan (%s)', v_batch.batch_no;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_caller_org
  for update;

  -- PHYSICAL REALITY CHECK: Has the refined gold already been spent or handed over?
  if coalesce(v_vault.manager_refined_gold_grams, 0) < v_batch.output_585_equiv_grams or
     coalesce(v_vault.manager_refined_gold_fine_grams, 0) < v_batch.output_fine_grams then
    raise exception 'Affinajni bekor qilib bo''lmaydi: olingan toza oltin allaqachon ishlatib yuborilgan (Mavjud 585: % g, Talab: % g). Avval bog''langan chiqimlarni bekor qiling.',
      coalesce(v_vault.manager_refined_gold_grams, 0), v_batch.output_585_equiv_grams;
  end if;

  -- Atomically deduct refined gold and restore scrap gold in vault
  update public.manager_vault_account
     set manager_refined_gold_grams = round((manager_refined_gold_grams - v_batch.output_585_equiv_grams)::numeric, 4),
         manager_refined_gold_fine_grams = round(greatest(0, coalesce(manager_refined_gold_fine_grams, 0) - v_batch.output_fine_grams)::numeric, 4),
         manager_scrap_grams = round((manager_scrap_grams + v_batch.input_scrap_grams)::numeric, 4),
         manager_scrap_585_eq_g = round((coalesce(manager_scrap_585_eq_g, 0) + v_batch.input_scrap_grams)::numeric, 4),
         manager_scrap_physical_g = round((coalesce(manager_scrap_physical_g, 0) + v_batch.input_scrap_grams)::numeric, 4),
         updated_at = now()
   where organization_id = v_caller_org;

  -- Mark refining batch as reversed
  update public.refining_batches
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = p_batch_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'refining_batches', p_batch_id::text,
    'REVERSE_REFINING_BATCH', auth.uid(),
    jsonb_build_object('batch_no', v_batch.batch_no, 'output_fine_g', v_batch.output_fine_grams, 'input_scrap_g', v_batch.input_scrap_grams),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'batch_id', p_batch_id,
    'batch_no', v_batch.batch_no,
    'restored_scrap_grams', v_batch.input_scrap_grams,
    'deducted_refined_grams', v_batch.output_585_equiv_grams,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_refining_batch', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_refining_batch(uuid, text, text) to authenticated;


-- =========================================================================
-- 6. RPC: rpc_reverse_factory_gold_handover (Zavodga oltin topshirishni bekor qilish)
-- =========================================================================
create or replace function public.rpc_reverse_factory_gold_handover(
  p_handover_id     uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_hnd             public.factory_gold_handovers%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Zavodga topshirishni bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_factory_gold_handover',
    'handover_id', p_handover_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_hnd
  from public.factory_gold_handovers
  where id = p_handover_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Zavodga oltin topshirish hujjati topilmadi: %', p_handover_id;
  end if;

  if v_hnd.status = 'reversed' then
    raise exception 'Ushbu zavodga topshirish hujjati allaqachon bekor qilingan (%s)', v_hnd.handover_no;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_caller_org
  for update;

  -- Restore handed-over gold to manager vault according to source_type
  if coalesce(v_hnd.handover_material_type, 'refined_gold') = 'refined_gold' then
    update public.manager_vault_account
       set manager_refined_gold_grams = round((manager_refined_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           manager_refined_gold_fine_grams = round((coalesce(manager_refined_gold_fine_grams, 0) + coalesce(v_hnd.physical_weight_g, v_hnd.agreed_equivalent_g))::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  elsif v_hnd.handover_material_type = 'purchased_gold' then
    update public.manager_vault_account
       set manager_purchased_gold_grams = round((manager_purchased_gold_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  else -- scrap_gold
    update public.manager_vault_account
       set manager_scrap_grams = round((manager_scrap_grams + v_hnd.agreed_equivalent_g)::numeric, 4),
           manager_scrap_585_eq_g = round((coalesce(manager_scrap_585_eq_g, 0) + v_hnd.agreed_equivalent_g)::numeric, 4),
           updated_at = now()
     where organization_id = v_caller_org;
  end if;

  -- Mark handover as reversed
  update public.factory_gold_handovers
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = p_handover_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'factory_gold_handovers', p_handover_id::text,
    'REVERSE_FACTORY_GOLD_HANDOVER', auth.uid(),
    jsonb_build_object('handover_no', v_hnd.handover_no, 'agreed_eq_g', v_hnd.agreed_equivalent_g),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'handover_id', p_handover_id,
    'handover_no', v_hnd.handover_no,
    'restored_gold_grams', v_hnd.agreed_equivalent_g,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_factory_gold_handover', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_factory_gold_handover(uuid, text, text) to authenticated;


-- =========================================================================
-- 7. RPC: rpc_reverse_financial_transaction (Moliyaviy operatsiyani bekor qilish)
-- =========================================================================
create or replace function public.rpc_reverse_financial_transaction(
  p_transaction_id  uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_tx              public.financial_transactions%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar', 'accountant', 'buxgalter'
  ]);

  if v_clean_reason is null then
    raise exception 'Moliyaviy operatsiyani bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_financial_transaction',
    'transaction_id', p_transaction_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_financial_transaction', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_tx
  from public.financial_transactions
  where id = p_transaction_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Moliyaviy operatsiya topilmadi: %', p_transaction_id;
  end if;

  if v_tx.status = 'reversed' then
    raise exception 'Ushbu moliyaviy operatsiya allaqachon bekor qilingan (%s)', v_tx.transaction_no;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_caller_org
  for update;

  -- Reversal math based on transaction type
  if v_tx.transaction_type = 'capital_contribution' then
    -- Original injected capital into till -> reversal DEDUCTS from till!
    if v_tx.source_till = 'manager_uzs' then
      if v_vault.manager_cash_amount < v_tx.amount_num then
        raise exception 'Operatsiyani bekor qilib bo''lmaydi: seyfda yetarli naqd pul (UZS) mavjud emas (Mavjud: % UZS, Talab: % UZS)',
          v_vault.manager_cash_amount, v_tx.amount_num;
      end if;
      update public.manager_vault_account
         set manager_cash_amount = round((manager_cash_amount - v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;

    elsif v_tx.source_till = 'manager_usd' then
      if coalesce(v_vault.manager_usd_amount, 0) < v_tx.amount_num then
        raise exception 'Operatsiyani bekor qilib bo''lmaydi: seyfda yetarli dollar (USD) mavjud emas (Mavjud: % USD, Talab: % USD)',
          coalesce(v_vault.manager_usd_amount, 0), v_tx.amount_num;
      end if;
      update public.manager_vault_account
         set manager_usd_amount = round((coalesce(manager_usd_amount, 0) - v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;

    elsif v_tx.source_till = 'manager_vault_gold' then
      if v_vault.manager_refined_gold_grams < v_tx.equiv_585_grams then
        raise exception 'Operatsiyani bekor qilib bo''lmaydi: seyfda yetarli oltin mavjud emas (Mavjud: % g, Talab: % g)',
          v_vault.manager_refined_gold_grams, v_tx.equiv_585_grams;
      end if;
      update public.manager_vault_account
         set manager_refined_gold_grams = round((manager_refined_gold_grams - v_tx.equiv_585_grams)::numeric, 4), updated_at = now()
       where organization_id = v_caller_org;
    end if;

  elsif v_tx.transaction_type in ('capital_distribution', 'business_expense') then
    -- Original deducted cash/gold from till -> reversal RESTORES to till!
    if v_tx.source_till = 'manager_uzs' then
      update public.manager_vault_account
         set manager_cash_amount = round((manager_cash_amount + v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;
    elsif v_tx.source_till = 'manager_usd' then
      update public.manager_vault_account
         set manager_usd_amount = round((coalesce(manager_usd_amount, 0) + v_tx.amount_num)::numeric, 2), updated_at = now()
       where organization_id = v_caller_org;
    elsif v_tx.source_till = 'manager_vault_gold' then
      update public.manager_vault_account
         set manager_refined_gold_grams = round((manager_refined_gold_grams + v_tx.equiv_585_grams)::numeric, 4), updated_at = now()
       where organization_id = v_caller_org;
    end if;
  end if;

  -- Mark financial transaction as reversed
  update public.financial_transactions
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = p_transaction_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'financial_transactions', p_transaction_id::text,
    'REVERSE_FINANCIAL_TRANSACTION', auth.uid(),
    jsonb_build_object('tx_no', v_tx.transaction_no, 'amount', v_tx.amount_num, 'type', v_tx.transaction_type),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'transaction_id', p_transaction_id,
    'transaction_no', v_tx.transaction_no,
    'transaction_type', v_tx.transaction_type,
    'amount_num', v_tx.amount_num,
    'currency', v_tx.currency,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_financial_transaction', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_financial_transaction(uuid, text, text) to authenticated;


-- =========================================================================
-- 8. RPC: rpc_reverse_gold_purchase (Oltin xaridini bekor qilish)
-- =========================================================================
create or replace function public.rpc_reverse_gold_purchase(
  p_purchase_id     uuid,
  p_reason          text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org      uuid := public.current_organization_id();
  v_caller_emp_id   uuid := public.current_employee_id();
  v_clean_reason    text := nullif(btrim(p_reason), '');
  v_purch           public.gold_purchases%rowtype;
  v_vault           public.manager_vault_account%rowtype;
  v_payload         jsonb;
  v_existing        jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar',
    'production_manager', 'manager', 'boshqaruvchi'
  ]);

  if v_clean_reason is null then
    raise exception 'Oltin xaridini bekor qilish sababi kiritilishi shart';
  end if;

  v_payload := jsonb_build_object(
    'action', 'reverse_gold_purchase',
    'purchase_id', p_purchase_id,
    'reason', v_clean_reason
  );

  v_existing := public.check_and_lock_idempotency(p_idempotency_key, 'rpc_reverse_gold_purchase', v_payload);
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_purch
  from public.gold_purchases
  where id = p_purchase_id and organization_id = v_caller_org
  for update;

  if not found then
    raise exception 'Oltin xaridi topilmadi: %', p_purchase_id;
  end if;

  if v_purch.status = 'reversed' then
    raise exception 'Ushbu oltin xaridi allaqachon bekor qilingan (%s)', v_purch.purchase_no;
  end if;

  -- Lock manager vault
  perform public._get_or_create_manager_vault(v_caller_org);
  select * into v_vault
  from public.manager_vault_account
  where organization_id = v_caller_org
  for update;

  -- Check if purchased gold is still in vault
  if coalesce(v_vault.manager_purchased_gold_grams, 0) < v_purch.equiv_585_grams then
    raise exception 'Oltin xaridini bekor qilib bo''lmaydi: xarid qilingan oltin allaqachon zavodga topshirilgan yoki ishlatilgan (Mavjud: % g, Talab: % g).',
      coalesce(v_vault.manager_purchased_gold_grams, 0), v_purch.equiv_585_grams;
  end if;

  -- Revert vault balance: deduct purchased gold, restore cash/USD
  if coalesce(v_purch.currency, 'UZS') = 'USD' then
    update public.manager_vault_account
       set manager_purchased_gold_grams = round((manager_purchased_gold_grams - v_purch.equiv_585_grams)::numeric, 4),
           manager_usd_amount = round((coalesce(manager_usd_amount, 0) + coalesce(v_purch.usd_spent, 0))::numeric, 2),
           updated_at = now()
     where organization_id = v_caller_org;
  else
    update public.manager_vault_account
       set manager_purchased_gold_grams = round((manager_purchased_gold_grams - v_purch.equiv_585_grams)::numeric, 4),
           manager_cash_amount = round((manager_cash_amount + v_purch.cash_spent_uzs)::numeric, 2),
           updated_at = now()
     where organization_id = v_caller_org;
  end if;

  -- Mark gold purchase as reversed
  update public.gold_purchases
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = v_caller_emp_id,
         reversal_reason = v_clean_reason
   where id = p_purchase_id;

  -- Audit log
  insert into public.audit_logs (
    organization_id, table_name, record_id, action, actor_id,
    old_data, new_data, reason
  ) values (
    v_caller_org, 'gold_purchases', p_purchase_id::text,
    'REVERSE_GOLD_PURCHASE', auth.uid(),
    jsonb_build_object('purchase_no', v_purch.purchase_no, 'equiv_585_g', v_purch.equiv_585_grams, 'currency', v_purch.currency),
    jsonb_build_object('status', 'reversed'),
    v_clean_reason
  );

  v_existing := jsonb_build_object(
    'status', 'ok',
    'purchase_id', p_purchase_id,
    'purchase_no', v_purch.purchase_no,
    'restored_cash_amount', case when coalesce(v_purch.currency, 'UZS') = 'USD' then v_purch.usd_spent else v_purch.cash_spent_uzs end,
    'currency', coalesce(v_purch.currency, 'UZS'),
    'deducted_purchased_gold_grams', v_purch.equiv_585_grams,
    'reason', v_clean_reason
  );

  if p_idempotency_key is not null then
    perform public.save_idempotency_response(p_idempotency_key, 'rpc_reverse_gold_purchase', v_existing, v_payload);
  end if;

  return v_existing;
end;
$$;

grant execute on function public.rpc_reverse_gold_purchase(uuid, text, text) to authenticated;


-- =========================================================================
-- 9. RPC: Selective Test Data Cleanup Preview & Execution
-- =========================================================================
create or replace function public.rpc_preview_selective_test_cleanup(
  p_receipt_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org     uuid := public.current_organization_id();
  v_preview_token  text;
  v_tot_phys_g     numeric(14, 4) := 0;
  v_tot_obl_g      numeric(14, 4) := 0;
  v_blocked_items  jsonb := '[]'::jsonb;
  v_clean_items    jsonb := '[]'::jsonb;
  v_r_id           uuid;
  v_r_rec          public.factory_receipts%rowtype;
  v_sold_count     int;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  if p_receipt_ids is null or array_length(p_receipt_ids, 1) = 0 then
    -- Default to all unreversed factory receipts in organization that have available stock
    select coalesce(array_agg(id), array[]::uuid[])
    into p_receipt_ids
    from public.factory_receipts
    where organization_id = v_caller_org and status <> 'reversed';
  end if;

  v_preview_token := 'CLN-PREV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));

  foreach v_r_id in array coalesce(p_receipt_ids, array[]::uuid[])
  loop
    select * into v_r_rec
    from public.factory_receipts
    where id = v_r_id and organization_id = v_caller_org;

    if found then
      -- Check if any pieces from this receipt have been sold or distributed
      select count(*) into v_sold_count
      from public.consignment_pieces cp
      join public.seller_consignments sc on sc.id = cp.consignment_id
      where sc.factory_receipt_id = v_r_rec.id and cp.status = 'sold';

      if v_sold_count > 0 or v_r_rec.available_physical_g < (v_r_rec.original_physical_g - 0.0001) then
        v_blocked_items := v_blocked_items || jsonb_build_object(
          'receipt_id', v_r_rec.id,
          'receipt_no', v_r_rec.receipt_no,
          'product_name', v_r_rec.product_name,
          'blocked_reason', format('Ushbu partiyadan tovarlar allaqachon sotilgan yoki konsignatsiyaga tarqatilgan (%s dona sotilgan).', v_sold_count)
        );
      else
        v_tot_phys_g := round(v_tot_phys_g + v_r_rec.available_physical_g, 4);
        v_tot_obl_g  := round(v_tot_obl_g + v_r_rec.factory_obligation_g, 4);
        v_clean_items := v_clean_items || jsonb_build_object(
          'receipt_id', v_r_rec.id,
          'receipt_no', v_r_rec.receipt_no,
          'product_name', v_r_rec.product_name,
          'physical_g', v_r_rec.available_physical_g,
          'obligation_g', v_r_rec.factory_obligation_g,
          'status', v_r_rec.status
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'preview_token', v_preview_token,
    'cleanable_items', v_clean_items,
    'blocked_items', v_blocked_items,
    'summary', jsonb_build_object(
      'cleanable_count', jsonb_array_length(v_clean_items),
      'blocked_count', jsonb_array_length(v_blocked_items),
      'inventory_reduction_585_g', v_tot_phys_g,
      'factory_obligation_reduction_g', v_tot_obl_g
    ),
    'confirmation_instructions', 'Tasdiqlash uchun confirmation_code="CONFIRM_TEST_CLEANUP_2026" va sabab kiriting.'
  );
end;
$$;

grant execute on function public.rpc_preview_selective_test_cleanup(uuid[]) to authenticated;


create or replace function public.rpc_execute_selective_test_cleanup(
  p_receipt_ids        uuid[],
  p_confirmation_code  text,
  p_reason             text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org         uuid := public.current_organization_id();
  v_caller_emp_id      uuid := public.current_employee_id();
  v_clean_reason       text := nullif(btrim(p_reason), '');
  v_r_id               uuid;
  v_cleaned_count      int := 0;
  v_tot_phys_g         numeric(14, 4) := 0;
  v_tot_obl_g          numeric(14, 4) := 0;
  v_rev_res            jsonb;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  perform public.assert_erp_permission(array[
    'admin', 'director', 'owner', 'direktor', 'rahbar'
  ]);

  if p_confirmation_code <> 'CONFIRM_TEST_CLEANUP_2026' then
    raise exception 'Tasdiqlash kodi noto''g''ri! Talab qilinadi: CONFIRM_TEST_CLEANUP_2026';
  end if;

  if v_clean_reason is null then
    raise exception 'Sinov ma''lumotlarini tozalash sababi kiritilishi shart';
  end if;

  if p_receipt_ids is null or array_length(p_receipt_ids, 1) = 0 then
    raise exception 'Tozalanadigan sinov partiyalari tanlanmadi';
  end if;

  foreach v_r_id in array p_receipt_ids
  loop
    -- Execute audited reversal for each target receipt
    v_rev_res := public.rpc_reverse_factory_receipt(v_r_id, v_clean_reason, null);
    v_cleaned_count := v_cleaned_count + 1;
    v_tot_obl_g := v_tot_obl_g + coalesce((v_rev_res->>'deducted_obligation_grams')::numeric, 0);
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'cleaned_receipts_count', v_cleaned_count,
    'total_deducted_obligation_g', v_tot_obl_g,
    'reason', v_clean_reason,
    'message', format('%s ta sinov partiyasi muvaffaqiyatli tozalandi (bekor qilindi).', v_cleaned_count)
  );
end;
$$;

grant execute on function public.rpc_execute_selective_test_cleanup(uuid[], text, text) to authenticated;


-- =========================================================================
-- 10. UPDATE rpc_get_unified_customer_ledger (Integrate legacy debts)
-- =========================================================================
drop function if exists public.rpc_get_unified_customer_ledger(uuid, uuid);
drop function if exists public.rpc_get_unified_customer_ledger();

create or replace function public.rpc_get_unified_customer_ledger(
  p_seller_id   uuid default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_org    uuid := public.current_organization_id();
  v_caller_emp_id uuid := public.current_employee_id();
  v_caller_role   text := public.current_employee_role_text();
  v_cust_rec      record;
  v_rows          jsonb := '[]'::jsonb;
  v_gross_sales   numeric(14, 4);
  v_legacy_debt   numeric(14, 4);
  v_gross_debt    numeric(14, 4);
  v_paid_scrap    numeric(14, 4);
  v_paid_cash_g   numeric(14, 4);
  v_paid_cash_uzs numeric(18, 2);
  v_total_paid    numeric(14, 4);
  v_net_debt      numeric(14, 4);
  v_avail_adv     numeric(14, 4);
  v_applied_adv   numeric(14, 4);
  v_tot_gross     numeric(14, 4) := 0;
  v_tot_paid      numeric(14, 4) := 0;
  v_tot_net       numeric(14, 4) := 0;
  v_tot_adv       numeric(14, 4) := 0;
  v_tot_cash_uzs  numeric(18, 2) := 0;
  v_filter_seller uuid := null;
begin
  if v_caller_org is null then
    raise exception 'Permission denied: User must belong to an active organization' using errcode = '42501';
  end if;

  if v_caller_role in ('seller', 'sotuvchi', 'sales') then
    if p_seller_id is not null and p_seller_id <> v_caller_emp_id then
      raise exception 'Cross-seller violation: Sotuvchilar faqat o''z mijozlarini ko''ra oladi' using errcode = '42501';
    end if;
    v_filter_seller := v_caller_emp_id;

    if p_customer_id is not null then
      if not exists (
        select 1 from public.customers
        where id = p_customer_id
          and organization_id = v_caller_org
          and (seller_id = v_caller_emp_id or seller_id is null)
      ) then
        raise exception 'Cross-seller violation: Ushbu mijoz sizga biriktirilmagan' using errcode = '42501';
      end if;
    end if;
  else
    v_filter_seller := p_seller_id;
  end if;

  for v_cust_rec in
    select c.id, c.customer_code, c.contact_name, c.phone, c.company_name, c.seller_id,
           coalesce(e.full_name, e.name, 'Biriktirilmagan') as seller_name
    from public.customers c
    left join public.employees e on e.id = c.seller_id
    where c.organization_id = v_caller_org
      and (p_customer_id is null or c.id = p_customer_id)
      and (v_filter_seller is null or c.seller_id = v_filter_seller)
    order by c.contact_name asc
  loop
    -- 1. Total Unreversed Gross Sales Due
    select coalesce(sum(client_gold_due_grams), 0)
    into v_gross_sales
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    -- 2. Total Unreversed Legacy Debt / Advance (Signed Delta Sum)
    select coalesce(sum(delta_585_g), 0)
    into v_legacy_debt
    from public.client_legacy_debts
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    -- 3. Total Unreversed Scrap Gold Paid
    select coalesce(sum(coalesce(scrap_585_equiv_grams, scrap_weight_grams)), 0)
    into v_paid_scrap
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    -- 4. Total Unreversed Cash Equivalent Paid
    select
      coalesce(sum(cash_equivalent_grams), 0),
      coalesce(sum(cash_paid_amount), 0)
    into v_paid_cash_g, v_paid_cash_uzs
    from public.gold_settlements
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and direction = 'client_to_seller'
      and status <> 'reversed';

    v_total_paid := round(v_paid_scrap + v_paid_cash_g, 4);

    -- Gross obligation combining sales and legacy debt
    if v_legacy_debt >= 0 then
      v_gross_debt := round(v_gross_sales + v_legacy_debt, 4);
      if v_gross_debt >= v_total_paid then
        v_net_debt := round((v_gross_debt - v_total_paid)::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round((v_total_paid - v_gross_debt)::numeric, 4);
      end if;
    else
      -- Negative legacy debt means customer had pre-existing advance
      v_gross_debt := v_gross_sales;
      if v_gross_sales >= (v_total_paid + abs(v_legacy_debt)) then
        v_net_debt := round((v_gross_sales - (v_total_paid + abs(v_legacy_debt)))::numeric, 4);
        v_avail_adv := 0;
      else
        v_net_debt := 0;
        v_avail_adv := round(((v_total_paid + abs(v_legacy_debt)) - v_gross_sales)::numeric, 4);
      end if;
    end if;

    -- Applied Advance
    select coalesce(sum(settled_gold_grams), 0)
    into v_applied_adv
    from public.jewelry_sales
    where customer_id = v_cust_rec.id
      and organization_id = v_caller_org
      and status <> 'reversed';

    v_rows := v_rows || jsonb_build_object(
      'customer_id', v_cust_rec.id,
      'customer_code', v_cust_rec.customer_code,
      'contact_name', v_cust_rec.contact_name,
      'phone', v_cust_rec.phone,
      'company_name', v_cust_rec.company_name,
      'seller_id', v_cust_rec.seller_id,
      'seller_name', v_cust_rec.seller_name,
      'gross_debt_g', v_gross_debt,
      'legacy_debt_g', v_legacy_debt,
      'paid_scrap_equivalent_g', v_paid_scrap,
      'paid_cash_equivalent_g', v_paid_cash_g,
      'paid_cash_amount_uzs', v_paid_cash_uzs,
      'total_paid_g', v_total_paid,
      'applied_advance_g', v_applied_adv,
      'available_advance_g', v_avail_adv,
      'net_debt_g', v_net_debt
    );

    v_tot_gross := v_tot_gross + v_gross_debt;
    v_tot_paid  := v_tot_paid + v_total_paid;
    v_tot_net   := v_tot_net + v_net_debt;
    v_tot_adv   := v_tot_adv + v_avail_adv;
    v_tot_cash_uzs := v_tot_cash_uzs + v_paid_cash_uzs;

    -- Sync client_gold_accounts cache
    insert into public.client_gold_accounts (
      customer_id, organization_id, seller_id, total_purchased_gold_grams,
      total_scrap_paid_grams, total_cash_paid_amount, total_cash_equiv_grams, total_settled_grams,
      current_debt_grams, advance_balance_grams, updated_at
    ) values (
      v_cust_rec.id, v_caller_org, v_cust_rec.seller_id, v_gross_debt,
      v_paid_scrap, v_paid_cash_uzs, v_paid_cash_g, v_total_paid,
      v_net_debt, v_avail_adv, now()
    )
    on conflict (customer_id) do update set
      seller_id = coalesce(excluded.seller_id, client_gold_accounts.seller_id),
      total_purchased_gold_grams = excluded.total_purchased_gold_grams,
      total_scrap_paid_grams = excluded.total_scrap_paid_grams,
      total_cash_paid_amount = excluded.total_cash_paid_amount,
      total_cash_equiv_grams = excluded.total_cash_equiv_grams,
      total_settled_grams = excluded.total_settled_grams,
      current_debt_grams = excluded.current_debt_grams,
      advance_balance_grams = excluded.advance_balance_grams,
      updated_at = now();
  end loop;

  return jsonb_build_object(
    'items', v_rows,
    'summary', jsonb_build_object(
      'total_gross_debt_g', v_tot_gross,
      'total_paid_g', v_tot_paid,
      'total_net_debt_g', v_tot_net,
      'total_available_advance_g', v_tot_adv,
      'total_cash_paid_uzs', v_tot_cash_uzs
    )
  );
end;
$$;

grant execute on function public.rpc_get_unified_customer_ledger(uuid, uuid) to authenticated;


-- =========================================================================
-- 11. UPDATE rpc_get_accounting_profit_summary (Hardened for Universal Reversals and Legacy Debts)
-- =========================================================================
create or replace function public.rpc_get_accounting_profit_summary(
  p_org_id      uuid default null,
  p_gold_rate   numeric default null,
  p_start_date  date default null,
  p_end_date    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id                uuid := coalesce(p_org_id, public.current_organization_id());
  v_today                 date := (timezone('Asia/Tashkent', now()))::date;
  v_start_dt              timestamptz;
  v_end_dt                timestamptz;
  v_gold_rate_585         numeric(18, 2);
  v_usd_rate              numeric(18, 2);
  v_rate_confirmed        boolean := false;
  v_base                  public.accounting_baselines%rowtype;

  -- Live Asset Components (585 Eq)
  v_mgr_stock_g           numeric(14, 4) := 0;
  v_seller_stock_g        numeric(14, 4) := 0;
  v_mgr_scrap_g           numeric(14, 4) := 0;
  v_seller_scrap_g        numeric(14, 4) := 0;
  v_mgr_refined_g         numeric(14, 4) := 0;
  v_mgr_purchased_g       numeric(14, 4) := 0;
  v_cust_debts_g          numeric(14, 4) := 0;
  v_mgr_cash_uzs          numeric(18, 2) := 0;
  v_seller_cash_uzs       numeric(18, 2) := 0;
  v_total_cash_uzs        numeric(18, 2) := 0;
  v_cash_585_eq_g         numeric(14, 4) := 0;
  v_mgr_usd               numeric(18, 2) := 0;
  v_seller_usd            numeric(18, 2) := 0;
  v_total_usd             numeric(18, 2) := 0;
  v_usd_585_eq_g          numeric(14, 4) := 0;
  v_tot_assets_g          numeric(14, 4) := 0;

  -- Live Liability Components
  v_factory_rcp_due_g     numeric(14, 4) := 0;
  v_factory_hnd_paid_g    numeric(14, 4) := 0;
  v_factory_debt_g        numeric(14, 4) := 0;
  v_cust_advances_g       numeric(14, 4) := 0;
  v_tot_liabilities_g     numeric(14, 4) := 0;
  v_cur_net_assets_g      numeric(14, 4) := 0;

  -- Period Capital Flows & Adjustments
  v_cap_in_g              numeric(14, 4) := 0;
  v_cap_out_g             numeric(14, 4) := 0;
  v_expenses_g            numeric(14, 4) := 0;
  v_post_base_legacy_adj  numeric(14, 4) := 0;

  -- Final Capital-Adjusted Period Result
  v_period_accounting_res numeric(14, 4) := 0;
  v_seller_rec            record;
  v_vault_rec             public.manager_vault_account%rowtype;
begin
  if v_org_id is null then
    return jsonb_build_object(
      'status', 'error',
      'error', 'Tashkilot aniqlanmadi (organization_id is null)',
      'is_computable', false
    );
  end if;

  -- Look up active baseline
  select * into v_base
  from public.accounting_baselines
  where organization_id = v_org_id and status = 'active'
  order by baseline_date desc, created_at desc
  limit 1;

  -- PILOT PERIOD LOCK:
  if p_end_date is not null and p_end_date <> v_today then
    return jsonb_build_object(
      'status', 'unsupported_pilot_period',
      'error', format('Pilot davrida faqat bugungi kungacha (jonli real-time) hisoblash qo''llab-quvvatlanadi. Tanlangan oxirgi sana: %s, Bugun: %s.', p_end_date, v_today),
      'is_computable', false,
      'is_complete', false,
      'accounting_method', 'realtime_pilot_locked'
    );
  end if;

  if p_start_date is not null and v_base.id is not null and p_start_date <> v_base.baseline_date then
    return jsonb_build_object(
      'status', 'unsupported_pilot_period',
      'error', format('Pilot davrida faqat tasdiqlangan boshlang''ich hisob sanasidan (%s) boshlab hisoblash mumkin. Tarixiy sanalar bo''yicha alohida qoldiqlar arxivi keyingi bosqichda faollashadi.', v_base.baseline_date),
      'is_computable', false,
      'is_complete', false,
      'accounting_method', 'realtime_pilot_locked'
    );
  end if;

  -- Gold & USD rates from today's daily_gold_rates
  select rate_per_gram, is_confirmed into v_gold_rate_585, v_rate_confirmed
  from public.daily_gold_rates
  where organization_id = v_org_id and proba = 585 and rate_date = v_today
  order by created_at desc
  limit 1;

  if v_gold_rate_585 is null or v_gold_rate_585 <= 0 then
    select rate_per_gram, is_confirmed into v_gold_rate_585, v_rate_confirmed
    from public.daily_gold_rates
    where organization_id = v_org_id and proba = 585
    order by rate_date desc, created_at desc
    limit 1;
  end if;

  select usd_rate into v_usd_rate
  from public.accounting_baselines
  where organization_id = v_org_id
  order by baseline_date desc, created_at desc
  limit 1;

  if v_usd_rate is null or v_usd_rate <= 0 then
    v_usd_rate := 12800.00;
  end if;

  if p_gold_rate is not null and p_gold_rate > 0 and (v_gold_rate_585 is null or not v_rate_confirmed) then
    v_gold_rate_585 := round(p_gold_rate::numeric, 2);
    v_rate_confirmed := false;
  end if;

  -- 1. ASSET: Manager finished goods in stock (excluding reversed receipts)
  select coalesce(sum(available_physical_g), 0) into v_mgr_stock_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  -- 2. ASSET: Seller consignment pieces
  select coalesce(sum(public.get_seller_available_stock_grams(e.id)), 0) into v_seller_stock_g
  from public.employees e
  where e.organization_id = v_org_id and e.role::text in ('seller', 'sales', 'sotuvchi');

  -- 3. ASSET: Manager Vault Holdings
  select * into v_vault_rec
  from public.manager_vault_account
  where organization_id = v_org_id;

  if found then
    v_mgr_scrap_g     := coalesce(v_vault_rec.manager_scrap_585_eq_g, coalesce(v_vault_rec.manager_scrap_grams, 0));
    v_mgr_refined_g   := coalesce(v_vault_rec.manager_refined_gold_grams, 0);
    v_mgr_purchased_g := coalesce(v_vault_rec.manager_purchased_gold_grams, 0);
    v_mgr_cash_uzs    := coalesce(v_vault_rec.manager_cash_amount, 0);
    v_mgr_usd         := coalesce(v_vault_rec.manager_usd_amount, 0);
  end if;

  -- 4. ASSET: Seller Till Holdings
  for v_seller_rec in
    select coalesce(seller_till_scrap_585_eq_g, coalesce(seller_till_scrap_grams, 0)) as scrap_585,
           coalesce(seller_till_cash_amount, 0) as cash_uzs,
           coalesce(seller_till_usd_amount, 0) as cash_usd
    from public.seller_gold_accounts
    where organization_id = v_org_id
  loop
    v_seller_scrap_g  := v_seller_scrap_g + v_seller_rec.scrap_585;
    v_seller_cash_uzs := v_seller_cash_uzs + v_seller_rec.cash_uzs;
    v_seller_usd      := v_seller_usd + v_seller_rec.cash_usd;
  end loop;

  -- 5. ASSET: Client Debts and Advances
  select coalesce(sum(current_debt_grams), 0),
         coalesce(sum(advance_balance_grams), 0)
    into v_cust_debts_g, v_cust_advances_g
    from public.client_gold_accounts
   where organization_id = v_org_id;

  -- 6. Cash and USD 585 Gold Equivalents
  v_total_cash_uzs := round(v_mgr_cash_uzs + v_seller_cash_uzs, 2);
  v_total_usd      := round(v_mgr_usd + v_seller_usd, 2);

  if v_gold_rate_585 is not null and v_gold_rate_585 > 0 then
    v_cash_585_eq_g := round((v_total_cash_uzs / v_gold_rate_585)::numeric, 4);
    if v_usd_rate is not null and v_usd_rate > 0 then
      v_usd_585_eq_g := round(((v_total_usd * v_usd_rate) / v_gold_rate_585)::numeric, 4);
    end if;
  end if;

  v_tot_assets_g := round(
    v_mgr_stock_g + v_seller_stock_g + v_mgr_scrap_g + v_seller_scrap_g +
    v_mgr_refined_g + v_mgr_purchased_g + v_cust_debts_g +
    v_cash_585_eq_g + v_usd_585_eq_g,
    4
  );

  -- 7. LIABILITIES: Factory Obligations (excluding reversed receipts/handovers)
  select coalesce(sum(factory_obligation_g), 0) into v_factory_rcp_due_g
  from public.factory_receipts
  where organization_id = v_org_id and status <> 'reversed';

  select coalesce(sum(agreed_equivalent_g), 0) into v_factory_hnd_paid_g
  from public.factory_gold_handovers
  where organization_id = v_org_id and status <> 'reversed';

  v_factory_debt_g := round(greatest(0, v_factory_rcp_due_g - v_factory_hnd_paid_g)::numeric, 4);
  v_tot_liabilities_g := round(v_factory_debt_g + v_cust_advances_g, 4);
  v_cur_net_assets_g  := round(v_tot_assets_g - v_tot_liabilities_g, 4);

  -- 8. Capital Flows & Post-Baseline Legacy Adjustments
  if v_base.id is not null then
    v_start_dt := coalesce(v_base.created_at, v_base.baseline_date::timestamptz);
    v_end_dt   := now();

    -- Financial transactions during period (strictly post-baseline)
    select
      coalesce(sum(case when transaction_type = 'capital_contribution' then equiv_585_grams else 0 end), 0),
      coalesce(sum(case when transaction_type = 'capital_distribution' then equiv_585_grams else 0 end), 0),
      coalesce(sum(case when transaction_type = 'business_expense' then equiv_585_grams else 0 end), 0)
    into v_cap_in_g, v_cap_out_g, v_expenses_g
    from public.financial_transactions
    where organization_id = v_org_id
      and status <> 'reversed'
      and created_at > v_base.created_at;

    -- Legacy debt baseline adjustments: strictly post-baseline entered legacy debts
    select coalesce(sum(delta_585_g), 0)
    into v_post_base_legacy_adj
    from public.client_legacy_debts
    where organization_id = v_org_id
      and status <> 'reversed'
      and created_at > v_base.created_at;

    -- Formula: Period Result = Current Net Assets - Baseline Net Assets - Capital Injected + Capital Distributed - Legacy Debt Adjustments
    v_period_accounting_res := round(
      (v_cur_net_assets_g - v_base.net_assets_585_g - v_cap_in_g + v_cap_out_g - v_post_base_legacy_adj)::numeric,
      4
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'is_computable', true,
    'is_complete', (v_rate_confirmed = true and v_base.id is not null),
    'accounting_method', 'capital_adjusted_net_assets_585_locked',
    'pilot_notice', 'Pilot davrida kapital harakatlariga tuzatilgan umumiy sof aktiv o''zgarishi ko''rsatiladi. Valyuta kursi tebranishini (FX) savdo marjasidan ajratish xronologik konvertatsiya to''liq shakllangach taqdim etiladi.',
    'baseline', case when v_base.id is null then null else jsonb_build_object(
      'id', v_base.id,
      'baseline_no', v_base.baseline_no,
      'baseline_date', v_base.baseline_date,
      'net_assets_585_g', v_base.net_assets_585_g,
      'gold_rate_585', v_base.gold_rate_585,
      'usd_rate', v_base.usd_rate,
      'created_at', v_base.created_at
    ) end,
    'rates', jsonb_build_object(
      'gold_rate_585', v_gold_rate_585,
      'is_gold_rate_confirmed', v_rate_confirmed,
      'usd_rate', v_usd_rate,
      'rate_date', v_today
    ),
    'period', jsonb_build_object(
      'start_date', case when v_base.id is not null then v_base.baseline_date else null end,
      'end_date', v_today,
      'mode', 'locked_pilot_realtime'
    ),
    'current_assets', jsonb_build_object(
      'manager_stock_585_g', v_mgr_stock_g,
      'seller_stock_585_g', v_seller_stock_g,
      'manager_scrap_585_g', v_mgr_scrap_g,
      'seller_scrap_585_g', v_seller_scrap_g,
      'manager_refined_gold_585_g', v_mgr_refined_g,
      'manager_purchased_gold_585_g', v_mgr_purchased_g,
      'customer_debts_585_g', v_cust_debts_g,
      'cash_uzs_amount', v_total_cash_uzs,
      'cash_uzs_585_eq_g', v_cash_585_eq_g,
      'usd_amount', v_total_usd,
      'usd_585_eq_g', v_usd_585_eq_g,
      'total_assets_585_g', v_tot_assets_g
    ),
    'current_liabilities', jsonb_build_object(
      'factory_receipts_due_585_g', v_factory_rcp_due_g,
      'factory_handovers_settled_585_g', v_factory_hnd_paid_g,
      'factory_obligation_585_g', v_factory_debt_g,
      'customer_advances_585_g', v_cust_advances_g,
      'total_liabilities_585_g', v_tot_liabilities_g
    ),
    'current_net_assets_585_g', v_cur_net_assets_g,
    'capital_movements', jsonb_build_object(
      'capital_injected_585_g', v_cap_in_g,
      'capital_distributed_585_g', v_cap_out_g,
      'business_expenses_585_g', v_expenses_g,
      'legacy_debt_adjustments_585_g', v_post_base_legacy_adj
    ),
    'period_accounting_result_585_g', case when v_base.id is not null then v_period_accounting_res else null end,
    'operational_trading_result_585_g', null,
    'as_of_time', now()
  );
end;
$$;

grant execute on function public.rpc_get_accounting_profit_summary(uuid, numeric, date, date) to authenticated;
