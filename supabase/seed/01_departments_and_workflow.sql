-- =========================================================================
-- JewelryFlow ERP — Seed: Departments + Workflow Stages
-- =========================================================================
-- This seeds the fixed production pipeline exactly as specified. It is
-- reference/configuration data, not business logic: production management
-- can edit sequence_order / add stages later via the Settings module
-- without a code deploy.
-- =========================================================================

insert into departments (code, name, description) values
  ('WAX',        'Wax',               'Wax pattern preparation'),
  ('WAX_ASM',    'Wax Assembly',      'Assembling wax trees'),
  ('INVESTMENT', 'Investment',        'Gypsum/plaster investment'),
  ('BURNOUT',    'Burnout Furnace',   'Wax burnout firing'),
  ('CASTING',    'Casting',           'Gold casting'),
  ('TUMBLING',   'Tumbling',          'Tumble finishing'),
  ('STRAIGHTEN', 'Straightening',     'Straightening rings/findings'),
  ('SANDING',    'Sanding',           'Surface sanding'),
  ('PUMICE',     'Pumice Machine',    'Pumice finishing'),
  ('CLEANING',   'Cleaning',          'Ultrasonic/manual cleaning'),
  ('PRE_POLISH', 'Pre-Polish Machine','Pre-polish finishing'),
  ('ZIRCON',     'Zircon Machine',    'Zircon setting/finishing'),
  ('FINAL_POLISH','Final Polish',    'Final hand polish'),
  ('LASER',      'Laser Decoration',  'Laser engraving/decoration'),
  ('QUICK_POLISH','Quick Polish',    'Final quick polish pass'),
  ('WASHING',    'Washing',           'Final wash'),
  ('PACKAGING',  'Packaging',         'Packing for shipment')
on conflict (code) do nothing;

-- Stages reuse the Cleaning department 3 times in the pipeline (after
-- Pumice, after Pre-Polish, after Zircon) — modeled as three distinct
-- workflow_stages rows pointing at the same CLEANING department, since a
-- workflow stage is "a step in the sequence", not "a department".
insert into workflow_stages (code, name, sequence_order, department_id, is_terminal, default_sla_minutes)
select code, name, sequence_order, (select id from departments where code = dept_code), is_terminal, sla
from (values
  ('WAX',              'Wax',                 1,  'WAX',         false, 60),
  ('WAX_ASSEMBLY',      'Wax Assembly',        2,  'WAX_ASM',     false, 90),
  ('INVESTMENT',        'Investment',          3,  'INVESTMENT',  false, 120),
  ('BURNOUT_FURNACE',   'Burnout Furnace',     4,  'BURNOUT',     false, 480),
  ('CASTING',           'Casting',             5,  'CASTING',     false, 60),
  ('TUMBLING',          'Tumbling',            6,  'TUMBLING',    false, 120),
  ('STRAIGHTENING',     'Straightening',       7,  'STRAIGHTEN',  false, 60),
  ('SANDING',           'Sanding',             8,  'SANDING',     false, 60),
  ('PUMICE_MACHINE',    'Pumice Machine',      9,  'PUMICE',      false, 45),
  ('CLEANING_1',        'Cleaning',            10, 'CLEANING',    false, 20),
  ('PRE_POLISH_MACHINE','Pre-Polish Machine',  11, 'PRE_POLISH',  false, 45),
  ('CLEANING_2',        'Cleaning',            12, 'CLEANING',    false, 20),
  ('ZIRCON_MACHINE',    'Zircon Machine',      13, 'ZIRCON',      false, 45),
  ('CLEANING_3',        'Cleaning',            14, 'CLEANING',    false, 20),
  ('FINAL_POLISH',      'Final Polish',        15, 'FINAL_POLISH',false, 60),
  ('LASER_DECORATION',  'Laser Decoration',    16, 'LASER',       false, 30),
  ('QUICK_POLISH',      'Quick Polish',        17, 'QUICK_POLISH',false, 20),
  ('WASHING',           'Washing',             18, 'WASHING',     false, 15),
  ('PACKAGING',         'Packaging',           19, 'PACKAGING',   false, 20),
  ('COMPLETED',         'Completed',           20, 'PACKAGING',   true,  null)
) as s(code, name, sequence_order, dept_code, is_terminal, sla)
on conflict (code) do nothing;
