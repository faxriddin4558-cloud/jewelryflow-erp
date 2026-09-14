-- =========================================================================
-- JewelryFlow ERP — Migration 011
-- Quality Control
-- =========================================================================
-- QC checks are attached to a specific batch_operation (i.e. a specific
-- stage attempt) so inspectors can fail a specific step and trigger rework
-- without ambiguity about which stage attempt is being evaluated.
-- =========================================================================

create table qc_checklists (
  id            uuid primary key default gen_random_uuid(),
  stage_id      uuid references workflow_stages(id) on delete set null,
  name          text not null,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table qc_checklists is 'Named QC checklist templates, optionally scoped to a specific workflow stage.';

create table qc_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  checklist_id    uuid not null references qc_checklists(id) on delete cascade,
  label           text not null,
  sort_order      integer not null default 0,
  is_required     boolean not null default true
);

create index idx_qc_checklist_items_checklist on qc_checklist_items(checklist_id);

create table qc_inspections (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references batches(id) on delete cascade,
  batch_operation_id  uuid references batch_operations(id) on delete set null,
  checklist_id        uuid references qc_checklists(id) on delete set null,
  inspector_id        uuid not null references employees(id) on delete restrict,
  result              qc_result not null,
  defect_notes        text,
  inspected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  constraint qc_inspections_fail_requires_notes check (result <> 'fail' or defect_notes is not null)
);

comment on table qc_inspections is 'A single inspection event against a batch (optionally scoped to a specific stage attempt).';

create index idx_qc_inspections_batch on qc_inspections(batch_id, inspected_at desc);
create index idx_qc_inspections_operation on qc_inspections(batch_operation_id);
create index idx_qc_inspections_result on qc_inspections(result);

create table qc_inspection_results (
  id                  uuid primary key default gen_random_uuid(),
  inspection_id       uuid not null references qc_inspections(id) on delete cascade,
  checklist_item_id   uuid not null references qc_checklist_items(id) on delete restrict,
  passed              boolean not null,
  comment             text,

  constraint qc_inspection_results_unique unique (inspection_id, checklist_item_id)
);

create index idx_qc_inspection_results_inspection on qc_inspection_results(inspection_id);

-- -------------------------------------------------------------------------
-- On a QC failure, automatically mark the related batch_operation as
-- 'rejected' so it surfaces in the department's rework queue, and flag
-- the parent batch 'on_hold'.
-- -------------------------------------------------------------------------
create or replace function handle_qc_failure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.result = 'fail' then
    if new.batch_operation_id is not null then
      update batch_operations
      set status = 'rejected'
      where id = new.batch_operation_id;
    end if;

    update batches
    set status = 'on_hold'
    where id = new.batch_id;
  end if;
  return new;
end;
$$;

create trigger trg_handle_qc_failure
  after insert on qc_inspections
  for each row execute function handle_qc_failure();
