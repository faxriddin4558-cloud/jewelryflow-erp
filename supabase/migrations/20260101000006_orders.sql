-- =========================================================================
-- JewelryFlow ERP — Migration 006
-- Orders
-- =========================================================================

create table orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      text not null unique,          -- human-facing, e.g. 'ORD-2026-00042'
  customer_id       uuid not null references customers(id) on delete restrict,
  status            order_status not null default 'draft',
  priority          order_priority not null default 'normal',
  order_date        date not null default current_date,
  due_date          date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references employees(id) on delete set null,

  constraint orders_due_after_order check (due_date is null or due_date >= order_date)
);

comment on table orders is 'Customer purchase order for one or more jewelry models. Fulfilled via one or more production batches.';

create index idx_orders_customer on orders(customer_id);
create index idx_orders_status on orders(status);
create index idx_orders_priority on orders(priority);
create index idx_orders_due_date on orders(due_date);
create index idx_orders_number_trgm on orders using gin (order_number gin_trgm_ops);

create trigger set_orders_updated_at
  before update on orders
  for each row execute function moddatetime(updated_at);

-- -------------------------------------------------------------------------
-- Order line items: which models, and how many, were ordered.
-- -------------------------------------------------------------------------
create table order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  model_id        uuid not null references jewelry_models(id) on delete restrict,
  quantity        integer not null,
  ring_size       text,
  unit_notes      text,
  created_at      timestamptz not null default now(),

  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_unique_model unique (order_id, model_id, ring_size)
);

comment on table order_items is 'Requested models + quantities for an order.';

create index idx_order_items_order on order_items(order_id);
create index idx_order_items_model on order_items(model_id);
