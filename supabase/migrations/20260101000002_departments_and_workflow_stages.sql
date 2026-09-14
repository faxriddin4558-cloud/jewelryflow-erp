-- =========================================================================
-- JewelryFlow ERP — Migration 002
-- Departments and Workflow Stages
-- =========================================================================
-- `departments` models the physical/organizational floor units (Casting,
-- Investment, Laser, etc). `workflow_stages` models the ordered production
-- sequence (Wax -> Wax Assembly -> Investment -> ... -> Completed) and maps
-- each stage to the department that owns it. Keeping this as data (not a
-- hardcoded enum) lets production management reorder or insert stages
-- without a schema migration, which the client explicitly needs since
-- factory routing changes over time (e.g. adding a new finishing step).
-- =========================================================================

create table departments (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,             -- e.g. 'CASTING', 'LASER'
  name              text not null,
  description       text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table departments is 'Physical/organizational factory departments. Each has a Queue / Working / Finished / Delayed board.';

create table workflow_stages (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,             -- e.g. 'WAX_ASSEMBLY'
  name              text not null,                     -- display name
  sequence_order    integer not null unique,           -- 1..N, defines the fixed pipeline order
  department_id     uuid not null references departments(id) on delete restrict,
  is_terminal       boolean not null default false,    -- true only for the final "Completed" stage
  is_active         boolean not null default true,
  default_sla_minutes integer,                          -- expected duration, used for delay detection
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint workflow_stages_sequence_positive check (sequence_order > 0),
  constraint workflow_stages_sla_positive check (default_sla_minutes is null or default_sla_minutes > 0)
);

comment on table workflow_stages is 'Ordered manufacturing pipeline: Wax -> Wax Assembly -> Investment -> Burnout Furnace -> Casting -> Tumbling -> Straightening -> Sanding -> Pumice -> Cleaning -> Pre-Polish -> Cleaning -> Zircon -> Cleaning -> Final Polish -> Laser Decoration -> Quick Polish -> Washing -> Packaging -> Completed.';

create index idx_workflow_stages_department on workflow_stages(department_id);
create index idx_workflow_stages_sequence on workflow_stages(sequence_order);

create trigger set_departments_updated_at
  before update on departments
  for each row execute function moddatetime(updated_at);

create trigger set_workflow_stages_updated_at
  before update on workflow_stages
  for each row execute function moddatetime(updated_at);
