-- =========================================================================
-- JewelryFlow ERP — Migration 008
-- Batch Operations (per-stage execution tracking)
-- =========================================================================
-- This is the operational heart of the ERP. Every time a batch enters a
-- workflow stage (Wax Assembly, Investment, Burnout, Casting, ... ,
-- Packaging), one `batch_operations` row is created. It records exactly
-- what the spec requires: started_at, finished_at, employee, department,
-- duration, delay_reason — plus status so a department's Queue / Working /
-- Finished / Delayed board can be derived with a single filtered query.
--
-- A batch can revisit a stage (QC rejection -> rework), so this is a
-- one-to-many relationship between batches and workflow_stages, not 1:1.
-- `attempt_number` disambiguates repeat visits to the same stage.
-- =========================================================================

create table batch_operations (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references batches(id) on delete cascade,
  stage_id          uuid not null references workflow_stages(id) on delete restrict,
  department_id     uuid not null references departments(id) on delete restrict,
  attempt_number    integer not null default 1,

  status            operation_status not null default 'queued',

  assigned_employee_id uuid references employees(id) on delete set null,
  performed_by_employee_id uuid references employees(id) on delete set null,

  queued_at         timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  duration_seconds  integer generated always as (
                       case
                         when started_at is not null and finished_at is not null
                         then greatest(0, extract(epoch from (finished_at - started_at))::integer)
                         else null
                       end
                     ) stored,

  delay_reason_category delay_reason_category,
  delay_reason_notes    text,
  delayed_minutes        integer,

  input_weight_grams     numeric(10,3),
  output_weight_grams    numeric(10,3),

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint batch_operations_attempt_positive check (attempt_number > 0),
  constraint batch_operations_finished_after_started check (finished_at is null or started_at is null or finished_at >= started_at),
  constraint batch_operations_delay_requires_reason check (
    status <> 'delayed' or delay_reason_category is not null
  ),
  constraint batch_operations_unique_attempt unique (batch_id, stage_id, attempt_number)
);

comment on table batch_operations is 'One row per (batch, workflow stage, attempt). Tracks timing, assigned/performing employee, department, and delay reason for every production step.';

create index idx_batch_operations_batch on batch_operations(batch_id);
create index idx_batch_operations_stage on batch_operations(stage_id);
create index idx_batch_operations_department_status on batch_operations(department_id, status);
create index idx_batch_operations_employee on batch_operations(performed_by_employee_id);
create index idx_batch_operations_status on batch_operations(status);

-- Only one non-terminal (queued/in_progress/paused/delayed) operation per
-- batch at a time — a batch cannot be simultaneously "in progress" at two
-- stages. Completed/skipped/rejected rows are exempt so history is
-- preserved.
create unique index idx_batch_operations_one_active_per_batch
  on batch_operations(batch_id)
  where status in ('queued', 'in_progress', 'paused', 'delayed');

create trigger set_batch_operations_updated_at
  before update on batch_operations
  for each row execute function moddatetime(updated_at);

-- -------------------------------------------------------------------------
-- Keep `batches.current_stage_id` / `current_department_id` /
-- `assigned_employee_id` in sync with the latest non-completed operation,
-- and roll `batches.status` between queued / in_progress / delayed.
-- -------------------------------------------------------------------------
create or replace function sync_batch_current_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update batches
  set
    current_stage_id = new.stage_id,
    current_department_id = new.department_id,
    assigned_employee_id = coalesce(new.assigned_employee_id, batches.assigned_employee_id),
    status = case
      when new.status = 'in_progress' then 'in_progress'::batch_status
      when new.status = 'delayed' then 'delayed'::batch_status
      when new.status = 'queued' then 'queued'::batch_status
      else batches.status
    end,
    started_at = case when new.status = 'in_progress' and batches.started_at is null then new.started_at else batches.started_at end
  where id = new.batch_id;
  return new;
end;
$$;

create trigger trg_sync_batch_current_stage
  after insert or update on batch_operations
  for each row execute function sync_batch_current_stage();

-- -------------------------------------------------------------------------
-- When the terminal workflow stage (is_terminal = true, e.g. "Completed")
-- finishes, mark the parent batch completed.
-- -------------------------------------------------------------------------
create or replace function complete_batch_on_terminal_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_terminal boolean;
begin
  if new.status = 'completed' and new.finished_at is not null then
    select is_terminal into v_is_terminal from workflow_stages where id = new.stage_id;
    if v_is_terminal then
      update batches
      set status = 'completed', completed_at = new.finished_at
      where id = new.batch_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_complete_batch_on_terminal_stage
  after update on batch_operations
  for each row execute function complete_batch_on_terminal_stage();
