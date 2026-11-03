begin;
-- seller of synthetic org 3 (not org 1)
select set_config('request.jwt.claims', '{"sub":"d0000003-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select 'seller org3 visible models', count(*), count(*) filter (where organization_id <> '00000000-0000-0000-0000-000000000003' or organization_id is null) from public.jewelry_models;
with u as (update public.jewelry_models set name = name where organization_id = '00000000-0000-0000-0000-000000000001' returning 1) select 'seller org3 updated org1 models', count(*) from u;
with d as (delete from public.jewelry_models where organization_id = '00000000-0000-0000-0000-000000000001' returning 1) select 'seller org3 deleted org1 models', count(*) from d;
with u as (update public.stage_loss_configs set organization_id = organization_id where organization_id = '00000000-0000-0000-0000-000000000001' returning 1) select 'seller org3 updated org1 stage_loss_configs', count(*) from u;
reset role;
select set_config('request.jwt.claims', '{"sub":"d0000003-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
with u as (update public.stage_loss_configs set organization_id = organization_id where organization_id = '00000000-0000-0000-0000-000000000001' returning 1) select 'director org3 updated org1 stage_loss_configs', count(*) from u;
rollback;
