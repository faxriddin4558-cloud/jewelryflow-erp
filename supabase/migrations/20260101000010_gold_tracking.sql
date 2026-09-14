-- =========================================================================
-- JewelryFlow ERP — Migration 010
-- Gold Tracking
-- =========================================================================
-- Gold requires factory-grade chain-of-custody: every gram entering the
-- building (as raw lots) must be traceable through issuance to batches,
-- melting loss at Burnout/Casting, scrap recovery from polishing dust, and
-- final output — because gold is the highest-value, most auditable input
-- in the entire operation.
-- =========================================================================

create table gold_lots (
  id                uuid primary key default gen_random_uuid(),
  lot_number        text not null unique,
  purity            gold_purity not null,
  source            text not null,               -- supplier / refinery / recycled-internal
  received_weight_grams numeric(12,3) not null,
  remaining_weight_grams numeric(12,3) not null,
  cost_per_gram     numeric(14,4),
  received_at       timestamptz not null default now(),
  received_by       uuid references employees(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint gold_lots_received_positive check (received_weight_grams > 0),
  constraint gold_lots_remaining_nonneg check (remaining_weight_grams >= 0),
  constraint gold_lots_remaining_le_received check (remaining_weight_grams <= received_weight_grams)
);

comment on table gold_lots is 'A physically received (or internally recovered) quantity of gold at a given purity, tracked down to remaining balance.';

create index idx_gold_lots_purity on gold_lots(purity);
create index idx_gold_lots_remaining on gold_lots(remaining_weight_grams) where remaining_weight_grams > 0;

create trigger set_gold_lots_updated_at
  before update on gold_lots
  for each row execute function moddatetime(updated_at);

-- -------------------------------------------------------------------------
-- Immutable ledger of gold movement: issuance to a batch, returns,
-- melting loss, scrap recovery. `gold_lots.remaining_weight_grams` is a
-- denormalized balance maintained by trigger.
-- -------------------------------------------------------------------------
create table gold_transactions (
  id              uuid primary key default gen_random_uuid(),
  lot_id          uuid not null references gold_lots(id) on delete restrict,
  type            gold_transaction_type not null,
  weight_grams    numeric(12,3) not null,        -- always positive; `type` determines sign
  batch_id        uuid references batches(id) on delete set null,
  batch_operation_id uuid references batch_operations(id) on delete set null,
  performed_by    uuid references employees(id) on delete set null,
  reference_note  text,
  created_at      timestamptz not null default now(),

  constraint gold_transactions_weight_positive check (weight_grams > 0)
);

comment on table gold_transactions is 'Immutable gold movement ledger: lot receipt, issuance to batch, returns, melting loss, scrap recovery.';

create index idx_gold_transactions_lot on gold_transactions(lot_id, created_at desc);
create index idx_gold_transactions_batch on gold_transactions(batch_id);
create index idx_gold_transactions_type on gold_transactions(type);

create or replace function apply_gold_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sign integer;
begin
  v_sign := case
    when new.type in ('lot_received', 'returned_from_batch', 'scrap_recovered', 'adjustment') then 1
    else -1
  end;

  update gold_lots
  set remaining_weight_grams = remaining_weight_grams + (v_sign * new.weight_grams)
  where id = new.lot_id;

  return new;
end;
$$;

create trigger trg_apply_gold_transaction
  after insert on gold_transactions
  for each row execute function apply_gold_transaction();

-- -------------------------------------------------------------------------
-- Per-batch gold summary view: total issued vs. returned vs. lost vs. net
-- consumed, joined against the batch's recorded output weight so
-- production managers can see melting-loss % at a glance.
-- -------------------------------------------------------------------------
create view batch_gold_summary as
select
  b.id as batch_id,
  b.batch_number,
  coalesce(sum(gt.weight_grams) filter (where gt.type = 'issued_to_batch'), 0) as issued_grams,
  coalesce(sum(gt.weight_grams) filter (where gt.type = 'returned_from_batch'), 0) as returned_grams,
  coalesce(sum(gt.weight_grams) filter (where gt.type = 'melting_loss'), 0) as melting_loss_grams,
  coalesce(sum(gt.weight_grams) filter (where gt.type = 'scrap_recovered'), 0) as scrap_recovered_grams,
  coalesce(sum(gt.weight_grams) filter (where gt.type = 'issued_to_batch'), 0)
    - coalesce(sum(gt.weight_grams) filter (where gt.type = 'returned_from_batch'), 0) as net_consumed_grams
from batches b
left join gold_transactions gt on gt.batch_id = b.id
group by b.id, b.batch_number;

comment on view batch_gold_summary is 'Aggregated gold issued/returned/lost/recovered per batch for the Gold Tracking dashboard.';
