-- =========================================================================
-- JewelryFlow ERP — Migration 013
-- Reporting / Dashboard Views
-- =========================================================================
-- These views back the Factory Dashboard and per-department Queue /
-- Working / Finished / Delayed boards described in the spec. Kept as SQL
-- views (not materialized) for now since factory floor data must be
-- real-time; can be converted to materialized + refresh-on-trigger later
-- if read volume demands it.
-- =========================================================================

-- Per-department board: current operations grouped by status.
create view department_board as
select
  d.id as department_id,
  d.code as department_code,
  d.name as department_name,
  bo.id as operation_id,
  bo.status as operation_status,
  bo.batch_id,
  b.batch_number,
  b.priority as batch_priority,
  ws.id as stage_id,
  ws.name as stage_name,
  bo.assigned_employee_id,
  e.full_name as assigned_employee_name,
  bo.queued_at,
  bo.started_at,
  bo.delay_reason_category,
  bo.delayed_minutes
from batch_operations bo
join departments d on d.id = bo.department_id
join workflow_stages ws on ws.id = bo.stage_id
join batches b on b.id = bo.batch_id
left join employees e on e.id = bo.assigned_employee_id
where bo.status in ('queued', 'in_progress', 'paused', 'delayed', 'rejected');

comment on view department_board is 'Live Queue/Working/Delayed board per department, driving the manufacturing module UI.';

-- Factory-wide dashboard summary counts.
create view factory_dashboard_summary as
select
  (select count(*) from batches where status = 'in_progress') as batches_in_progress,
  (select count(*) from batches where status = 'delayed') as batches_delayed,
  (select count(*) from batches where status = 'on_hold') as batches_on_hold,
  (select count(*) from batches where status = 'pending') as batches_pending,
  (select count(*) from batches where status = 'completed' and completed_at >= date_trunc('day', now())) as batches_completed_today,
  (select count(*) from orders where status in ('confirmed', 'in_production')) as active_orders,
  (select count(*) from qc_inspections where result = 'fail' and inspected_at >= date_trunc('day', now())) as qc_failures_today,
  (select coalesce(sum(remaining_weight_grams), 0) from gold_lots) as gold_on_hand_grams;

comment on view factory_dashboard_summary is 'Single-row aggregate for the top-level Factory Dashboard KPI cards.';

-- Average stage duration, for SLA / bottleneck analysis in Reports & Analytics.
create view stage_duration_stats as
select
  ws.id as stage_id,
  ws.name as stage_name,
  ws.sequence_order,
  ws.default_sla_minutes,
  count(bo.id) filter (where bo.status = 'completed') as completed_count,
  avg(bo.duration_seconds) filter (where bo.status = 'completed') as avg_duration_seconds,
  percentile_cont(0.5) within group (order by bo.duration_seconds) filter (where bo.status = 'completed') as median_duration_seconds,
  count(bo.id) filter (where bo.status = 'delayed') as delayed_count
from workflow_stages ws
left join batch_operations bo on bo.stage_id = ws.id
group by ws.id, ws.name, ws.sequence_order, ws.default_sla_minutes
order by ws.sequence_order;

comment on view stage_duration_stats is 'Per-stage average/median duration and delay counts, for bottleneck reporting.';
