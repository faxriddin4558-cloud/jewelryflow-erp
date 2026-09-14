-- =========================================================================
-- JewelryFlow ERP — Migration 005
-- Jewelry Models
-- =========================================================================
-- A "model" is the design/spec for a piece of jewelry (e.g. a specific ring
-- design) that can be produced across many orders/batches. Quantities are
-- NOT stored here — a model is a reusable template; per-order/per-batch
-- quantities live on `order_items` and `batch_models` respectively.
-- =========================================================================

create table jewelry_models (
  id                uuid primary key default gen_random_uuid(),
  model_code        text not null unique,
  name              text not null,
  category          text,                    -- e.g. 'ring', 'earring', 'pendant'
  ring_size         text,
  loops_count       integer not null default 0,
  locks_count       integer not null default 0,
  decorations       text,                    -- free-text description (stones, engraving, etc.)
  reference_weight_grams numeric(10,3),       -- expected/standard weight for 1 unit
  gold_purity       gold_purity,
  primary_image_url text,
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references employees(id) on delete set null,

  constraint jewelry_models_loops_nonneg check (loops_count >= 0),
  constraint jewelry_models_locks_nonneg check (locks_count >= 0),
  constraint jewelry_models_weight_positive check (reference_weight_grams is null or reference_weight_grams > 0)
);

comment on table jewelry_models is 'Reusable jewelry design templates: rings, earrings, pendants, etc.';

create index idx_jewelry_models_category on jewelry_models(category);
create index idx_jewelry_models_name_trgm on jewelry_models using gin (name gin_trgm_ops);
create index idx_jewelry_models_active on jewelry_models(is_active);

create trigger set_jewelry_models_updated_at
  before update on jewelry_models
  for each row execute function moddatetime(updated_at);

-- -------------------------------------------------------------------------
-- Model images (a model can have multiple reference photos: front, side,
-- CAD render, etc.) — separated from `batches` photo storage below.
-- -------------------------------------------------------------------------
create table jewelry_model_images (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references jewelry_models(id) on delete cascade,
  storage_path  text not null,      -- Supabase Storage object path
  caption       text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_jewelry_model_images_model on jewelry_model_images(model_id);
