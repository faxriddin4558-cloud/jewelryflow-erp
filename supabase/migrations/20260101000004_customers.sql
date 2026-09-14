-- =========================================================================
-- JewelryFlow ERP — Migration 004
-- Customers
-- =========================================================================

create table customers (
  id              uuid primary key default gen_random_uuid(),
  customer_code   text not null unique,
  company_name    text,
  contact_name    text not null,
  email           text,
  phone           text,
  billing_address text,
  shipping_address text,
  tax_id          text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references employees(id) on delete set null
);

comment on table customers is 'Wholesale/retail customers placing jewelry manufacturing orders.';

create index idx_customers_name_trgm on customers using gin (coalesce(company_name, contact_name) gin_trgm_ops);
create index idx_customers_active on customers(is_active);

create trigger set_customers_updated_at
  before update on customers
  for each row execute function moddatetime(updated_at);
