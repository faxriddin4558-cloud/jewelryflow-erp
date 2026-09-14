-- =========================================================================
-- JewelryFlow ERP — Migration 012
-- Audit Log
-- =========================================================================
-- A generic, append-only audit trail across sensitive tables (orders,
-- batches, gold_lots, gold_transactions, inventory_transactions,
-- employees). This is separate from `batch_status_history`, which is a
-- purpose-built, UI-facing history feed; `audit_log` is the compliance /
-- forensic record capturing full before/after row state as JSON.
-- =========================================================================

create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,
  record_id     uuid not null,
  action        text not null check (action in ('insert', 'update', 'delete')),
  old_data      jsonb,
  new_data      jsonb,
  changed_by    uuid references employees(id) on delete set null,
  changed_at    timestamptz not null default now()
);

create index idx_audit_log_table_record on audit_log(table_name, record_id);
create index idx_audit_log_changed_at on audit_log(changed_at desc);

create or replace function record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op in ('update', 'delete') then to_jsonb(old) else null end,
    case when tg_op in ('insert', 'update') then to_jsonb(new) else null end,
    nullif(current_setting('app.current_employee_id', true), '')::uuid
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_orders
  after insert or update or delete on orders
  for each row execute function record_audit_event();

create trigger audit_batches
  after insert or update or delete on batches
  for each row execute function record_audit_event();

create trigger audit_gold_lots
  after insert or update or delete on gold_lots
  for each row execute function record_audit_event();

create trigger audit_gold_transactions
  after insert or delete on gold_transactions
  for each row execute function record_audit_event();

create trigger audit_inventory_transactions
  after insert or delete on inventory_transactions
  for each row execute function record_audit_event();

create trigger audit_employees
  after insert or update or delete on employees
  for each row execute function record_audit_event();
