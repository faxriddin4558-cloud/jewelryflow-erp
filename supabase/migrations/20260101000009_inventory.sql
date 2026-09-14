-- =========================================================================
-- JewelryFlow ERP — Migration 009
-- Inventory (non-gold materials: gemstones, findings, consumables)
-- =========================================================================
-- Gold has its own dedicated subsystem (migration 010) because of karat
-- purity + melting-loss reconciliation requirements. This table covers
-- everything else the factory stocks: gemstones, clasps, wax, investment
-- plaster, polishing compounds, packaging materials, etc.
-- =========================================================================

create table inventory_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  parent_id     uuid references inventory_categories(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table inventory_items (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null unique,
  name              text not null,
  category_id       uuid references inventory_categories(id) on delete set null,
  unit              inventory_unit not null,
  quantity_on_hand  numeric(14,3) not null default 0,
  reorder_threshold numeric(14,3),
  unit_cost         numeric(14,4),
  supplier_name     text,
  location          text,          -- warehouse bin / shelf reference
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint inventory_items_qty_nonneg check (quantity_on_hand >= 0),
  constraint inventory_items_reorder_nonneg check (reorder_threshold is null or reorder_threshold >= 0),
  constraint inventory_items_unit_cost_nonneg check (unit_cost is null or unit_cost >= 0)
);

comment on table inventory_items is 'Non-gold stock: gemstones, findings, wax, investment plaster, polishing compounds, packaging.';

create index idx_inventory_items_category on inventory_items(category_id);
create index idx_inventory_items_active on inventory_items(is_active);
create index idx_inventory_items_low_stock on inventory_items(quantity_on_hand) where reorder_threshold is not null;
create index idx_inventory_items_name_trgm on inventory_items using gin (name gin_trgm_ops);

create trigger set_inventory_items_updated_at
  before update on inventory_items
  for each row execute function moddatetime(updated_at);

-- -------------------------------------------------------------------------
-- Immutable ledger of every stock movement. `quantity_on_hand` on
-- `inventory_items` is a denormalized running balance maintained by the
-- trigger below — never written to directly by the application.
-- -------------------------------------------------------------------------
create table inventory_transactions (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references inventory_items(id) on delete restrict,
  type            inventory_transaction_type not null,
  quantity        numeric(14,3) not null,       -- always positive; `type` determines sign applied to balance
  batch_id        uuid references batches(id) on delete set null,
  unit_cost       numeric(14,4),
  reference_note  text,
  performed_by    uuid references employees(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint inventory_transactions_qty_positive check (quantity > 0)
);

comment on table inventory_transactions is 'Immutable stock movement ledger. Drives inventory_items.quantity_on_hand via trigger.';

create index idx_inventory_transactions_item on inventory_transactions(item_id, created_at desc);
create index idx_inventory_transactions_batch on inventory_transactions(batch_id);
create index idx_inventory_transactions_type on inventory_transactions(type);

create or replace function apply_inventory_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sign integer;
begin
  v_sign := case
    when new.type in ('purchase_in', 'production_return', 'adjustment_in') then 1
    else -1
  end;

  update inventory_items
  set quantity_on_hand = quantity_on_hand + (v_sign * new.quantity)
  where id = new.item_id;

  return new;
end;
$$;

create trigger trg_apply_inventory_transaction
  after insert on inventory_transactions
  for each row execute function apply_inventory_transaction();
