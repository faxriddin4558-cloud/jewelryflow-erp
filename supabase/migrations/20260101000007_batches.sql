-- =========================================================================
-- JewelryFlow ERP — Migration 007
-- Batches
-- =========================================================================
-- A batch is a physical production run: a set of jewelry models/quantities
-- pulled from one order and moved together through the 20-stage workflow.
-- `current_stage_id` / `current_department_id` are denormalized pointers
-- maintained by triggers on `batch_operations` (migration 009) so that
-- dashboard/queue queries never need to compute "latest operation" via a
-- correlated subquery — they read directly off `batches`.
-- =========================================================================

create table batches (
  id                    uuid primary key default gen_random_uuid(),
  batch_number          text not null unique,        -- human-facing, e.g. 'B-2026-0317'
  order_id              uuid not null references orders(id) on delete restrict,
  status                batch_status not null default 'pending',
  priority              batch_priority not null default 'normal',
  current_stage_id      uuid references workflow_stages(id) on delete set null,
  current_department_id uuid references departments(id) on delete set null,
  assigned_employee_id  uuid references employees(id) on delete set null,
  started_at            timestamptz,
  completed_at          timestamptz,
  due_date              date,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references employees(id) on delete set null,

  constraint batches_completed_after_started check (completed_at is null or started_at is null or completed_at >= started_at)
);

comment on table batches is 'A physical production run of jewelry models moving through the manufacturing pipeline as one unit.';

create index idx_batches_order on batches(order_id);
create index idx_batches_status on batches(status);
create index idx_batches_priority on batches(priority);
create index idx_batches_current_stage on batches(current_stage_id);
create index idx_batches_current_department on batches(current_department_id);
create index idx_batches_number_trgm on batches using gin (batch_number gin_trgm_ops);

create trigger set_batches_updated_at
  before update on batches
  for each row execute function moddatetime(updated_at);

-- -------------------------------------------------------------------------
-- Models included in a batch, and the quantity of each pulled into this
-- production run (a batch can fulfill multiple order_items, and an
-- order_item can be split across multiple batches).
-- -------------------------------------------------------------------------
create table batch_models (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references batches(id) on delete cascade,
  model_id        uuid not null references jewelry_models(id) on delete restrict,
  order_item_id   uuid references order_items(id) on delete set null,
  quantity        integer not null,
  weight_grams    numeric(10,3),
  notes           text,
  created_at      timestamptz not null default now(),

  constraint batch_models_quantity_positive check (quantity > 0),
  constraint batch_models_weight_positive check (weight_grams is null or weight_grams > 0)
);

comment on table batch_models is 'Models + quantities included in a specific batch.';

create index idx_batch_models_batch on batch_models(batch_id);
create index idx_batch_models_model on batch_models(model_id);
create index idx_batch_models_order_item on batch_models(order_item_id);

-- -------------------------------------------------------------------------
-- Batch photos (progress photos, defect photos, final photos) — distinct
-- from the model's reference images.
-- -------------------------------------------------------------------------
create table batch_images (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references batches(id) on delete cascade,
  stage_id      uuid references workflow_stages(id) on delete set null,
  storage_path  text not null,
  caption       text,
  uploaded_by   uuid references employees(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index idx_batch_images_batch on batch_images(batch_id);
create index idx_batch_images_stage on batch_images(stage_id);

-- -------------------------------------------------------------------------
-- Full audit trail of status/priority/assignment changes on a batch
-- (the "History" requirement). This is distinct from `batch_operations`
-- (migration 009), which tracks per-stage work; this table tracks
-- batch-level metadata changes (status flips, reassignments, priority
-- escalations) regardless of which stage they happened at.
-- -------------------------------------------------------------------------
create table batch_status_history (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references batches(id) on delete cascade,
  previous_status batch_status,
  new_status      batch_status not null,
  previous_priority batch_priority,
  new_priority    batch_priority,
  changed_by      uuid references employees(id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now()
);

comment on table batch_status_history is 'Immutable audit log of batch status/priority changes — powers the batch "History" tab.';

create index idx_batch_status_history_batch on batch_status_history(batch_id, created_at desc);

-- -------------------------------------------------------------------------
-- Auto-log status/priority changes whenever `batches` is updated.
-- -------------------------------------------------------------------------
create or replace function log_batch_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.status is distinct from new.status) or (old.priority is distinct from new.priority) then
    insert into batch_status_history (
      batch_id, previous_status, new_status, previous_priority, new_priority, changed_by
    ) values (
      new.id, old.status, new.status, old.priority, new.priority,
      coalesce(current_setting('app.current_employee_id', true)::uuid, null)
    );
  end if;
  return new;
end;
$$;

create trigger trg_log_batch_status_change
  after update on batches
  for each row execute function log_batch_status_change();
